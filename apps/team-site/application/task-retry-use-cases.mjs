import { projectWorkspaceDirectory } from "../domain/project.mjs";

export function createTaskRetryUseCases({ taskStore, projectStore, runStore }) {
  if (typeof taskStore?.startTask !== "function") {
    throw new TypeError("Task retry requires a Task start operation.");
  }
  if (typeof projectStore?.getProject !== "function") {
    throw new TypeError("Task retry requires Project lookup.");
  }
  if (typeof runStore?.readRunState !== "function" || typeof runStore?.loadMaterialSnapshots !== "function"
    || typeof runStore?.resolveMaterialPath !== "function" || typeof runStore?.resolveRunArtifactPath !== "function"
    || typeof runStore?.resolveRunArtifactDirectory !== "function") {
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

  const taskRunIds = Array.isArray(task.runIds) ? task.runIds : [originalRunId];
  const originalRunIndex = taskRunIds.indexOf(originalRunId);
  const currentAttempt = Object.values(task.attemptRequests || {}).find((attempt) => attempt?.runId === originalRunId);
  const inheritedSnapshotRunId = currentAttempt?.sourceRunId;
  const hasOwnedInheritedSnapshot = typeof inheritedSnapshotRunId === "string"
    && taskRunIds.indexOf(inheritedSnapshotRunId) >= 0
    && taskRunIds.indexOf(inheritedSnapshotRunId) < originalRunIndex;

  const originalRunState = await runStore.readRunState(projectId, taskId, originalRunId).catch((error) => {
    if (error?.code === "ENOENT" || /^RUN_STATE_MISSING:/.test(error instanceof Error ? error.message : String(error))) return undefined;
    throw error;
  });
  const missingRunState = !originalRunState?.status
    && (/^RUN_STATE_MISSING:/.test(task.lastError || "") || hasOwnedInheritedSnapshot);
  if (!missingRunState && originalRunState?.status !== "failed") {
    throw new Error("TASK_RETRY_UNSUPPORTED: only a Task with a failed current Run can be retried.");
  }

  let retryInputs;
  let retrySourceRoot;
  let materialSnapshotPolicy;
  if (missingRunState && !hasOwnedInheritedSnapshot) {
    retryInputs = (project.materials?.materials || []).map((item) => ({
      materialId: item.materialId,
      sourcePath: runStore.resolveMaterialPath(projectId, item.path),
      contentType: item.contentType
    }));
    retrySourceRoot = projectWorkspaceDirectory(project);
    materialSnapshotPolicy = {
      kind: "current_project_fallback",
      sourceRunId: originalRunId,
      reason: "source_run_state_missing"
    };
  } else {
    let sourceRunId = missingRunState ? inheritedSnapshotRunId : originalRunId;
    const sourceRunState = sourceRunId === originalRunId
      ? originalRunState
      : await runStore.readRunState(projectId, taskId, sourceRunId);
    if (!sourceRunState?.status) throw new Error("TASK_RETRY_UNSUPPORTED: the source Run snapshot is unavailable.");
    let snapshots;
    try {
      snapshots = await runStore.loadMaterialSnapshots(projectId, taskId, sourceRunId);
    } catch (error) {
      if (error?.code !== "ENOENT" || sourceRunId !== originalRunId || !hasOwnedInheritedSnapshot) throw error;
      sourceRunId = inheritedSnapshotRunId;
      const inheritedState = await runStore.readRunState(projectId, taskId, sourceRunId);
      if (!inheritedState?.status) throw new Error("TASK_RETRY_UNSUPPORTED: the source Run snapshot is unavailable.");
      snapshots = await runStore.loadMaterialSnapshots(projectId, taskId, sourceRunId);
    }
    retryInputs = await Promise.all(snapshots.map(async (item) => ({
      materialId: item.materialId,
      sourcePath: await runStore.resolveRunArtifactPath(projectId, taskId, sourceRunId, item.snapshotPath),
      contentType: item.contentType,
      selectedRanges: item.selectedRanges,
      consumingNodeIds: item.consumingNodeIds
    })));
    retrySourceRoot = snapshots.length > 0
      ? await runStore.resolveRunArtifactDirectory(projectId, taskId, sourceRunId, "inputs")
      : projectWorkspaceDirectory(project);
    materialSnapshotPolicy = { kind: "source_run_snapshot", sourceRunId };
  }

  return taskStore.startTask(projectId, taskId, {
    mode,
    retrySourceRunId: originalRunId,
    retryInputs,
    retrySourceRoot,
    materialSnapshotPolicy,
    idempotencyKey
  });
}
