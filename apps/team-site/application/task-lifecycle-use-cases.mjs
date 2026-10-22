import { assertTaskExecutionSlot, assertTaskTransition, isTerminalTaskStatus } from "../domain/task.mjs";

const reviewDecisions = new Set(["approve", "rework", "pause", "terminate"]);
const activeTaskStatuses = new Set(["running", "planning", "ready", "waiting_review", "paused", "pause_requested", "cancel_requested"]);

function findTask(project, taskId) {
  const task = (project?.taskRecords || []).find((item) => item.taskId === taskId && !item.deletedAt);
  if (!task) throw new Error("TASK_NOT_FOUND: task does not exist.");
  return task;
}

function taskUpdate(projectStore, project, taskId, update) {
  const task = findTask(project, taskId);
  if (update.status && update.status !== task.status) assertTaskTransition(task.status, update.status);
  return projectStore.saveTaskRecord(project, taskId, update);
}

function projectRunEvidenceOwnerId(project, task) {
  if (!task.teamVersionId) throw new Error("TASK_TEAM_VERSION_INVALID: Task has no bound TeamVersion.");
  return project.projectId;
}

function assertNoPendingReviewTransition(task) {
  if (task.reviewTransition) throw new Error("TASK_REVIEW_RECOVERY_REQUIRED: finish the pending review decision before changing this Task.");
}

function actionableReviews(snapshot) {
  return (Array.isArray(snapshot?.reviews) ? snapshot.reviews : []).filter((item) => item && ["pending", "paused"].includes(item.currentStatus));
}

function normalizeReviewComment(comment) {
  return String(comment || "").trim().slice(0, 4000);
}

function reviewAllows(review, decision) {
  return Array.isArray(review?.allowedDecisions) && review.allowedDecisions.some((item) => reviewDecisions.has(item) && item === decision);
}

function reviewIsCommitted(review, decision) {
  return review?.decision === decision && ["recorded", "pending_reconcile", "applied"].includes(review.decisionPhase)
    || review?.decision === decision && review.currentStatus === "resolved";
}

export function createTaskLifecycleUseCases({ projectStore, runControlStore, reviewStore }) {
  if (typeof projectStore?.getProject !== "function"
    || typeof projectStore?.withProjectWriteLock !== "function"
    || typeof projectStore?.saveTaskRecord !== "function") {
    throw new TypeError("Task lifecycle use cases require Project read, lock, and Task persistence operations.");
  }
  if (typeof runControlStore?.controlRun !== "function") throw new TypeError("Task lifecycle use cases require Run control.");
  if (typeof reviewStore?.listReviews !== "function" || typeof reviewStore?.decideReview !== "function") {
    throw new TypeError("Task lifecycle use cases require human review operations.");
  }

  return Object.freeze({
    async controlProjectTask(projectId, taskId, control) {
      if (!["start", "pause", "resume", "cancel"].includes(control)) throw new Error("TASK_CONTROL_INVALID: unsupported task control.");
      if (control === "cancel") {
        return projectStore.withProjectWriteLock(projectId, "project-task-cancel", async () => {
          const latest = await projectStore.getProject(projectId);
          const latestTask = findTask(latest, taskId);
          assertNoPendingReviewTransition(latestTask);
          if (isTerminalTaskStatus(latestTask.status)) throw new Error(`TASK_CONTROL_INVALID: task is already ${latestTask.status}.`);
          if (!latestTask.currentRunId) {
            return taskUpdate(projectStore, latest, taskId, {
              status: "cancelled",
              completedAt: new Date().toISOString()
            });
          }

          const result = await runControlStore.controlRun(
            projectRunEvidenceOwnerId(latest, latestTask),
            latestTask.currentRunId,
            "cancel",
            { projectLockHeld: true }
          );
          const status = result.state?.status || "cancel_requested";
          return taskUpdate(projectStore, await projectStore.getProject(projectId), taskId, {
            status,
            currentRunId: latestTask.currentRunId,
            ...(isTerminalTaskStatus(status) ? { completedAt: new Date().toISOString() } : {})
          });
        });
      }
      const project = await projectStore.getProject(projectId);
      const task = findTask(project, taskId);
      assertNoPendingReviewTransition(task);
      if (isTerminalTaskStatus(task.status)) throw new Error(`TASK_CONTROL_INVALID: task is already ${task.status}.`);

      if (task.currentRunId && control === "resume") {
        const current = await projectStore.withProjectWriteLock(projectId, "project-task-resume-run", async () => {
          const latest = await projectStore.getProject(projectId);
          const latestTask = findTask(latest, taskId);
          assertNoPendingReviewTransition(latestTask);
          if (latestTask.currentRunId !== task.currentRunId) throw new Error("TASK_CONTROL_CONFLICT: the current Run changed; refresh Task state before retrying.");
          if (!(["paused", "pause_requested"].includes(latestTask.status))) {
            throw new Error(`TASK_RESUME_NOT_ALLOWED: task status is ${latestTask.status}.`);
          }
          assertTaskExecutionSlot(latest, taskId);
          return latestTask;
        });
        const result = await runControlStore.controlRun(projectRunEvidenceOwnerId(project, current), current.currentRunId, "resume");
        return projectStore.withProjectWriteLock(projectId, "project-task-resume-complete", async () => {
          const latest = await projectStore.getProject(projectId);
          const latestTask = findTask(latest, taskId);
          if (latestTask.currentRunId !== current.currentRunId) throw new Error("TASK_CONTROL_CONFLICT: the current Run changed while resuming.");
          const status = result.state?.status || "running";
          return taskUpdate(projectStore, latest, taskId, { status, currentRunId: current.currentRunId });
        });
      }
      if (task.currentRunId) {
        if (control === "start") throw new Error("TASK_CONTROL_INVALID: task already has a run.");
        const operation = control === "resume" ? "project-task-resume-run" : "project-task-control";
        return projectStore.withProjectWriteLock(projectId, operation, async () => {
          const latest = await projectStore.getProject(projectId);
          const latestTask = findTask(latest, taskId);
          assertNoPendingReviewTransition(latestTask);
          if (latestTask.currentRunId !== task.currentRunId) throw new Error("TASK_CONTROL_CONFLICT: the current Run changed; refresh Task state before retrying.");
          if (isTerminalTaskStatus(latestTask.status)) throw new Error(`TASK_CONTROL_INVALID: task is already ${latestTask.status}.`);
          if (control === "resume") {
            if (!(["paused", "pause_requested", "waiting_review"].includes(latestTask.status))) {
              throw new Error(`TASK_RESUME_NOT_ALLOWED: task status is ${latestTask.status}.`);
            }
            assertTaskExecutionSlot(latest, taskId);
          }
          const result = await runControlStore.controlRun(projectRunEvidenceOwnerId(latest, latestTask), latestTask.currentRunId, control, { projectLockHeld: true });
          const status = result.state?.status || (control === "cancel" ? "cancel_requested" : control === "pause" ? "pause_requested" : "running");
          return taskUpdate(projectStore, await projectStore.getProject(projectId), taskId, { status, currentRunId: latestTask.currentRunId });
        });
      }

      if (control === "start") {
        if (task.status !== "queued") throw new Error(`TASK_START_NOT_ALLOWED: task status is ${task.status}.`);
        assertTaskExecutionSlot(project, taskId);
        return projectStore.withProjectWriteLock(projectId, "project-task-start", async () => {
          const latest = await projectStore.getProject(projectId);
          const latestTask = findTask(latest, taskId);
          if (latestTask.status !== "queued") throw new Error(`TASK_START_NOT_ALLOWED: task status is ${latestTask.status}.`);
          assertTaskExecutionSlot(latest, taskId);
          return taskUpdate(projectStore, latest, taskId, { status: "running", startedAt: new Date().toISOString() });
        });
      }
      if (control === "pause" && ["paused", "pause_requested"].includes(task.status)) return task;
      if (control === "resume" && task.status !== "paused") throw new Error(`TASK_RESUME_NOT_ALLOWED: task status is ${task.status}.`);

      const status = control === "pause" ? "paused" : "queued";
      const operation = control === "pause" ? "project-task-pause" : control === "resume" ? "project-task-resume" : "project-task-cancel";
      return projectStore.withProjectWriteLock(projectId, operation, async () => taskUpdate(projectStore, await projectStore.getProject(projectId), taskId, {
        status,
        ...(control === "cancel" ? { completedAt: new Date().toISOString() } : {})
      }));
    },

    async reviewProjectTask(projectId, taskId, { decision, comment, reviewId } = {}) {
      if (!reviewDecisions.has(decision)) throw new Error("TASK_REVIEW_INVALID: unsupported review decision.");
      const normalizedComment = normalizeReviewComment(comment);
      const result = await projectStore.withProjectWriteLock(projectId, "project-task-review", async () => {
        let project = await projectStore.getProject(projectId);
        let task = findTask(project, taskId);
        if (!task.currentRunId || !["waiting_review", "paused"].includes(task.status)) {
          throw new Error(`TASK_REVIEW_NOT_ALLOWED: task status is ${task.status}.`);
        }

        const snapshot = await reviewStore.listReviews(project, task);
        const pending = task.reviewTransition;
        if (pending && (pending.decision !== decision || pending.comment !== normalizedComment
          || (reviewId && pending.reviewId !== reviewId))) {
          throw new Error("TASK_REVIEW_RECOVERY_REQUIRED: retry the pending decision with the same request before choosing another action.");
        }
        const selectedId = pending?.reviewId || reviewId;
        const selected = selectedId
          ? (snapshot?.reviews || []).find((item) => item?.reviewId === selectedId)
          : actionableReviews(snapshot)[0];
        if (!selected?.reviewId) throw new Error("TASK_REVIEW_NOT_ALLOWED: no active review request exists for this Run.");

        const alreadyCommitted = reviewIsCommitted(selected, decision);
        if (!alreadyCommitted) {
          if (!["pending", "paused"].includes(selected.currentStatus)) {
            throw new Error("TASK_REVIEW_NOT_ALLOWED: review request is no longer actionable.");
          }
          if (!reviewAllows(selected, decision)) throw new Error("TASK_REVIEW_NOT_ALLOWED: decision is not allowed by this review request.");
          if (!pending) {
            task = await taskUpdate(projectStore, project, taskId, {
              reviewTransition: {
                reviewId: selected.reviewId,
                runId: task.currentRunId,
                decision,
                comment: normalizedComment,
                startedAt: new Date().toISOString()
              }
            });
            project = await projectStore.getProject(projectId);
          }
          try {
            await reviewStore.decideReview(project, task, selected.reviewId, decision, normalizedComment, selected.spec?.terminateScope);
          } catch (error) {
            const latestReviews = await reviewStore.listReviews(project, task).catch(() => undefined);
            const persisted = (latestReviews?.reviews || []).find((item) => item?.reviewId === selected.reviewId);
            if (!reviewIsCommitted(persisted, decision)) throw error;
          }
        }

        const latest = await projectStore.getProject(projectId);
        const latestTask = findTask(latest, taskId);
        if (latestTask.reviewTransition?.reviewId !== selected.reviewId
          || latestTask.reviewTransition?.decision !== decision) {
          throw new Error("TASK_REVIEW_RECOVERY_REQUIRED: the durable review transition marker is missing or changed.");
        }
        return { project: latest, task: latestTask, selected };
      });
      const { selected, task: committedTask } = result;
      let nextStatus;
      if (["approve", "rework"].includes(decision) || (decision === "terminate" && selected.spec?.terminateScope === "branch")) {
        const resumed = await runControlStore.controlRun(projectRunEvidenceOwnerId(result.project, committedTask), committedTask.currentRunId, "resume");
        nextStatus = resumed.state?.status || "running";
      } else if (decision === "terminate") {
        const cancelled = await runControlStore.controlRun(projectRunEvidenceOwnerId(result.project, committedTask), committedTask.currentRunId, "cancel");
        nextStatus = cancelled.state?.status || "cancel_requested";
      } else {
        nextStatus = "paused";
      }
      const updated = await projectStore.withProjectWriteLock(projectId, "project-task-review-complete", async () => {
        const latest = await projectStore.getProject(projectId);
        const latestTask = findTask(latest, taskId);
        if (latestTask.reviewTransition?.reviewId !== selected.reviewId
          || latestTask.reviewTransition?.decision !== decision
          || latestTask.currentRunId !== committedTask.currentRunId) {
          throw new Error("TASK_REVIEW_RECOVERY_REQUIRED: the durable review transition marker is missing or changed.");
        }
        return taskUpdate(projectStore, latest, taskId, {
          status: nextStatus,
          review: { decision, comment: normalizedComment, reviewId: selected.reviewId, decidedAt: selected.decidedAt || new Date().toISOString() },
          reviewTransition: null
        });
      });
      const reviewResult = { reviewId: selected.reviewId, decision };
      return { task: updated, review: reviewResult };
    },

    async getProjectTaskReviewContext(projectId, taskId) {
      const project = await projectStore.getProject(projectId);
      const task = findTask(project, taskId);
      if (!task.currentRunId) throw new Error(`TASK_REVIEW_NOT_ALLOWED: task ${taskId} has no Run to review.`);
      const snapshot = await reviewStore.listReviews(project, task);
      const transition = task.reviewTransition;
      const reviews = (Array.isArray(snapshot?.reviews) ? snapshot.reviews : [])
        .filter((item) => item && (transition
          ? item.reviewId === transition.reviewId
          : ["pending", "paused"].includes(item.currentStatus)))
        .map((item) => ({
          reviewId: item.reviewId,
          roleId: item.roleId,
          branchId: item.branchId,
          currentStatus: item.currentStatus,
          selectedEvent: item.selectedEvent,
          draftResult: item.draftResult,
          humanReviewContext: item.humanReviewContext,
          spec: item.spec,
          allowedDecisions: Array.isArray(item.allowedDecisions)
            ? item.allowedDecisions.filter((decision) => reviewDecisions.has(decision))
            : [],
          ...(transition?.reviewId === item.reviewId ? {
            recoveryDecision: transition.decision,
            recoveryComment: transition.comment
          } : {})
        }));
      return { projectId, taskId, runId: task.currentRunId, reviews };
    },

    async deleteProjectTask(projectId, taskId) {
      return projectStore.withProjectWriteLock(projectId, "project-task-delete", async () => {
        const project = await projectStore.getProject(projectId);
        const task = findTask(project, taskId);
        assertNoPendingReviewTransition(task);
        if (activeTaskStatuses.has(task.status) && task.currentRunId) {
          await runControlStore.controlRun(projectRunEvidenceOwnerId(project, task), task.currentRunId, "cancel", { projectLockHeld: true });
        }
        const now = new Date().toISOString();
        return taskUpdate(projectStore, await projectStore.getProject(projectId), taskId, {
          status: "deleted", deletedAt: now, completedAt: now
        });
      });
    }
  });
}
