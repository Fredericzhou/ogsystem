import { assertTaskExecutionSlot, assertTaskTransition, isTerminalTaskStatus } from "../domain/task.mjs";

const activeTaskStatuses = new Set(["running", "planning", "ready", "waiting_review", "paused", "paused_input_required", "cancel_requested"]);

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

export function createTaskLifecycleUseCases({ projectStore, runControlStore }) {
  if (typeof projectStore?.getProject !== "function"
    || typeof projectStore?.withProjectWriteLock !== "function"
    || typeof projectStore?.saveTaskRecord !== "function") {
    throw new TypeError("Task lifecycle use cases require Project read, lock, and Task persistence operations.");
  }
  if (typeof runControlStore?.controlRun !== "function") throw new TypeError("Task lifecycle use cases require Run control.");

  return Object.freeze({
    async controlProjectTask(projectId, taskId, control) {
      if (!["start", "cancel"].includes(control)) throw new Error("TASK_CONTROL_INVALID: unsupported task control.");
      if (control === "cancel") {
        return projectStore.withProjectWriteLock(projectId, "project-task-cancel", async () => {
          const latest = await projectStore.getProject(projectId);
          const task = findTask(latest, taskId);
          if (isTerminalTaskStatus(task.status)) throw new Error(`TASK_CONTROL_INVALID: task is already ${task.status}.`);
          if (!task.currentRunId) {
            return taskUpdate(projectStore, latest, taskId, {
              status: "cancelled",
              completedAt: new Date().toISOString()
            });
          }

          const result = await runControlStore.controlRun(
            projectRunEvidenceOwnerId(latest, task),
            task.currentRunId,
            "cancel",
            { projectLockHeld: true }
          );
          const status = result.state?.status || "cancel_requested";
          return taskUpdate(projectStore, await projectStore.getProject(projectId), taskId, {
            status,
            currentRunId: task.currentRunId,
            ...(isTerminalTaskStatus(status) ? { completedAt: new Date().toISOString() } : {})
          });
        });
      }

      const project = await projectStore.getProject(projectId);
      const task = findTask(project, taskId);
      if (isTerminalTaskStatus(task.status)) throw new Error(`TASK_CONTROL_INVALID: task is already ${task.status}.`);
      if (task.currentRunId) throw new Error("TASK_CONTROL_INVALID: task already has a run.");
      if (task.status !== "queued") throw new Error(`TASK_START_NOT_ALLOWED: task status is ${task.status}.`);
      assertTaskExecutionSlot(project, taskId);
      return projectStore.withProjectWriteLock(projectId, "project-task-start", async () => {
        const latest = await projectStore.getProject(projectId);
        const latestTask = findTask(latest, taskId);
        if (latestTask.currentRunId) throw new Error("TASK_CONTROL_INVALID: task already has a run.");
        if (latestTask.status !== "queued") throw new Error(`TASK_START_NOT_ALLOWED: task status is ${latestTask.status}.`);
        assertTaskExecutionSlot(latest, taskId);
        return taskUpdate(projectStore, latest, taskId, { status: "running", startedAt: new Date().toISOString() });
      });
    },

    async deleteProjectTask(projectId, taskId) {
      return projectStore.withProjectWriteLock(projectId, "project-task-delete", async () => {
        const project = await projectStore.getProject(projectId);
        const task = findTask(project, taskId);
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
