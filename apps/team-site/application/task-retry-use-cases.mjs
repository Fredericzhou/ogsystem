export function createTaskRetryUseCases({ taskStore, projectStore, runStore }) {
  if (typeof taskStore?.startTask !== "function") {
    throw new TypeError("Task retry requires a Task start operation.");
  }
  if (typeof projectStore?.getProject !== "function") {
    throw new TypeError("Task retry requires Project lookup.");
  }
  if (typeof runStore?.readRunState !== "function" || typeof runStore?.loadMaterialSnapshots !== "function"
    ) {
    throw new TypeError("Task retry requires Team IR v2 Run state and frozen input reads.");
  }

  return Object.freeze({
    async retryProjectTask(projectId, taskId, { mode = "sandbox", idempotencyKey } = {}) {
      if (mode !== "sandbox") throw new Error("TEAM_IR_V2_SANDBOX_REQUIRED: Team IR v2 Task retries require Sandbox execution mode.");
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(taskId || ""))) {
        throw new Error("TASK_NOT_FOUND: task does not exist.");
      }

      const project = await projectStore.getProject(projectId);
      if (project.projectType !== "collaboration") {
        throw new Error("PROJECT_TYPE_INVALID: only collaboration Tasks can be retried here.");
      }
      const task = (project.taskRecords || []).find((item) => item.taskId === taskId && !item.deletedAt);
      if (!task) throw new Error("TASK_NOT_FOUND: task does not exist.");
      const attemptKey = String(idempotencyKey || "").trim().slice(0, 160);
      const existingAttempt = attemptKey && task.attemptRequests?.[attemptKey];
      if (existingAttempt) {
        if (existingAttempt.mode === mode && existingAttempt.sourceRunId === task.currentRunId) {
          return { ...task, idempotentReplay: true };
        }
        if (existingAttempt.mode === mode && existingAttempt.sourceRunId && task.runIds?.includes(existingAttempt.runId)) {
          return { ...task, idempotentReplay: true };
        }
        throw new Error("IDEMPOTENCY_KEY_REUSE: attempt key was already used with a different request.");
      }
      return retryFromTask(project, task, { projectId, taskId, mode, idempotencyKey, taskStore, projectStore, runStore });
    }
  });
}

async function retryFromTask(project, task, { projectId, taskId, mode, idempotencyKey, taskStore, projectStore, runStore }) {
  const originalRunId = task.currentRunId;
  if (!originalRunId || task.status !== "failed") {
    throw new Error("TASK_RETRY_UNSUPPORTED: only a Task with a failed current Run can be retried.");
  }

  const originalRunState = await runStore.readRunState(projectId, taskId, originalRunId);
  if (originalRunState?.status !== "failed") {
    throw new Error("TASK_RETRY_UNSUPPORTED: only a Task with a failed current Run can be retried.");
  }

  await runStore.loadMaterialSnapshots(projectId, taskId, originalRunId);

  return taskStore.startTask(projectId, taskId, {
    mode,
    retrySourceRunId: originalRunId,
    retryInputs: [],
    materialSnapshotPolicy: { kind: "team-ir-v2-task-snapshot", sourceRunId: originalRunId },
    idempotencyKey
  });
}
