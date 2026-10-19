export function createTaskRetryUseCases({ taskStore, projectStore, runStore }) {
  if (typeof taskStore?.startTask !== "function") {
    throw new TypeError("Task retry requires a Task start operation.");
  }
  if (typeof projectStore?.getProject !== "function") {
    throw new TypeError("Task retry requires Project lookup.");
  }
  if (typeof runStore?.readRunState !== "function" || typeof runStore?.loadMaterialSnapshots !== "function"
    || typeof runStore?.resolveMaterialPath !== "function" || typeof runStore?.resolveRunArtifactPath !== "function") {
    throw new TypeError("Task retry requires Run state and material snapshot reads.");
  }

  return Object.freeze({
    async retryProjectTask(projectId, taskId, { mode = "dry-run", idempotencyKey } = {}) {
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

  const runProject = await projectStore.getProject(task.runProjectId || task.teamVersionId);
  const originalRunState = await runStore.readRunState(runProject.workdir, originalRunId).catch((error) => {
    if (error?.code === "ENOENT" || /^RUN_STATE_MISSING:/.test(error instanceof Error ? error.message : String(error))) return undefined;
    throw error;
  });
  const missingRunState = !originalRunState?.status && /^RUN_STATE_MISSING:/.test(task.lastError || "");
  if (!missingRunState && originalRunState?.status !== "failed") {
    throw new Error("TASK_RETRY_UNSUPPORTED: only a Task with a failed current Run can be retried.");
  }

  let retryInputs;
  let retrySourceRoot;
  if (missingRunState) {
    retryInputs = (project.materials?.materials || []).map((item) => ({
      materialId: item.materialId,
      sourcePath: runStore.resolveMaterialPath(project.workdir, item.path),
      contentType: item.contentType
    }));
    retrySourceRoot = project.workdir;
  } else {
    const snapshots = await runStore.loadMaterialSnapshots(runProject.workdir, originalRunId);
    retryInputs = snapshots.map((item) => ({
      materialId: item.materialId,
      sourcePath: runStore.resolveRunArtifactPath(runProject.workdir, originalRunId, item.snapshotPath),
      contentType: item.contentType,
      selectedRanges: item.selectedRanges,
      consumingNodeIds: item.consumingNodeIds
    }));
  }

  return taskStore.startTask(projectId, taskId, {
    mode,
    retrySourceRunId: originalRunId,
    retryInputs,
    retrySourceRoot,
    idempotencyKey
  });
}
