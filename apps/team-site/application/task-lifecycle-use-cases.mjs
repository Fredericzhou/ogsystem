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

function runProjectId(project, task) {
  return task.runProjectId || task.teamVersionId || project.projectId;
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
          if (isTerminalTaskStatus(latestTask.status)) throw new Error(`TASK_CONTROL_INVALID: task is already ${latestTask.status}.`);
          if (!latestTask.currentRunId) {
            return taskUpdate(projectStore, latest, taskId, {
              status: "cancelled",
              completedAt: new Date().toISOString()
            });
          }

          const result = await runControlStore.controlRun(
            runProjectId(latest, latestTask),
            latestTask.currentRunId,
            "cancel"
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
      if (isTerminalTaskStatus(task.status)) throw new Error(`TASK_CONTROL_INVALID: task is already ${task.status}.`);

      if (task.currentRunId) {
        if (control === "start") throw new Error("TASK_CONTROL_INVALID: task already has a run.");
        if (control === "resume") assertTaskExecutionSlot(project, taskId);
        const result = await runControlStore.controlRun(runProjectId(project, task), task.currentRunId, control);
        const status = result.state?.status || (control === "cancel" ? "cancel_requested" : control === "pause" ? "pause_requested" : "running");
        return projectStore.withProjectWriteLock(projectId, "project-task-control", async () =>
          taskUpdate(projectStore, await projectStore.getProject(projectId), taskId, { status, currentRunId: task.currentRunId }));
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
      const project = await projectStore.getProject(projectId);
      const task = findTask(project, taskId);
      if (!["waiting_review", "paused"].includes(task.status) && !task.currentRunId) {
        throw new Error(`TASK_REVIEW_NOT_ALLOWED: task status is ${task.status}.`);
      }

      let reviewResult;
      if (task.currentRunId) {
        const reviews = await reviewStore.listReviews(project, task);
        const candidates = (Array.isArray(reviews?.reviews) ? reviews.reviews : []).filter((item) => item && ["pending", "paused"].includes(item.currentStatus));
        const selected = reviewId ? candidates.find((item) => item.reviewId === reviewId) : candidates[0];
        if (selected?.reviewId) reviewResult = await reviewStore.decideReview(project, task, selected.reviewId, decision, comment);
      }
      const nextStatus = decision === "approve" || decision === "rework" ? "queued" : decision === "pause" ? "paused" : "cancelled";
      const updated = await projectStore.withProjectWriteLock(projectId, "project-task-review", async () => taskUpdate(projectStore, await projectStore.getProject(projectId), taskId, {
        status: nextStatus,
        review: { decision, comment: String(comment || "").trim().slice(0, 4000), reviewId: reviewId || reviewResult?.reviewId || null, decidedAt: new Date().toISOString() }
      }));
      if (reviewResult && ["approve", "rework"].includes(decision)) await runControlStore.controlRun(runProjectId(project, task), task.currentRunId, "resume").catch(() => undefined);
      if (reviewResult && decision === "terminate") await runControlStore.controlRun(runProjectId(project, task), task.currentRunId, "cancel").catch(() => undefined);
      return { task: updated, review: reviewResult || updated.review };
    },

    async deleteProjectTask(projectId, taskId) {
      return projectStore.withProjectWriteLock(projectId, "project-task-delete", async () => {
        const project = await projectStore.getProject(projectId);
        const task = findTask(project, taskId);
        if (activeTaskStatuses.has(task.status) && task.currentRunId) {
          await runControlStore.controlRun(runProjectId(project, task), task.currentRunId, "cancel");
        }
        const now = new Date().toISOString();
        return taskUpdate(projectStore, await projectStore.getProject(projectId), taskId, {
          status: "deleted", deletedAt: now, completedAt: now
        });
      });
    }
  });
}
