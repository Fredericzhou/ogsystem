import { ACTIVE_RUN_STATUSES } from "../domain/contracts.mjs";
import { assertRunTransition } from "../domain/run.mjs";

const validId = (value) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value || ""));

export function createRunRecoveryUseCases({ recoveryStore, now = () => new Date().toISOString() }) {
  for (const operation of [
    "listProjectIds", "listRunIds", "readRunState", "updateRunState",
    "removeRunDirectory", "readProjectMetadata", "writeProjectMetadata"
  ]) {
    if (typeof recoveryStore?.[operation] !== "function") {
      throw new TypeError(`Run recovery requires ${operation}.`);
    }
  }

  return Object.freeze({
    async recoverOrphanedRuns() {
      const projectIds = await recoveryStore.listProjectIds();
      const recovered = [];
      const metadataByProject = new Map();
      const taskRunReferences = new Set();
      for (const projectId of projectIds) {
        if (!validId(projectId)) continue;
        const metadata = await recoveryStore.readProjectMetadata(projectId);
        metadataByProject.set(projectId, metadata);
        if (!metadata) continue;
        if (metadata.projectType === "collaboration" && !Array.isArray(metadata.taskRecords)) {
          throw new Error(`RUN_RECOVERY_METADATA_INVALID: Task history is unreadable for Project ${projectId}.`);
        }
        for (const task of Array.isArray(metadata.taskRecords) ? metadata.taskRecords : []) {
          if (!task || typeof task !== "object") continue;
          const runtimeProjectId = task.runProjectId || task.teamVersionId || projectId;
          const runIds = new Set([
            ...(Array.isArray(task.runIds) ? task.runIds : []),
            ...(task.currentRunId ? [task.currentRunId] : []),
            ...Object.values(task.attemptRequests || {}).map((attempt) => attempt?.runId).filter(Boolean)
          ]);
          for (const runId of runIds) {
            taskRunReferences.add(`${projectId}:${task.taskId}:${runtimeProjectId}:${runId}`);
          }
        }
      }

      for (const projectId of projectIds) {
        if (!validId(projectId)) continue;
        for (const runId of await recoveryStore.listRunIds(projectId)) {
          if (!validId(runId)) continue;
          const state = await recoveryStore.readRunState(projectId, runId);
          if (!state || !ACTIVE_RUN_STATUSES.has(state.status)) continue;
          const reservation = state.taskReservation;
          if (reservation?.kind === "task-attempt") {
            const referenceKey = `${reservation.collaborationProjectId}:${reservation.taskId}:${projectId}:${runId}`;
            if (!taskRunReferences.has(referenceKey)
              && state.status === "planning"
              && !state.startedAt
              && !state.finishedAt
              && !state.error
              && Object.keys(state.nodes || {}).length === 0
              && (state.attempts || []).length === 0
              && (state.reviews || []).length === 0) {
              await recoveryStore.removeRunDirectory(projectId, runId);
              recovered.push({ projectId, runId, action: "removed-uncommitted-task-reservation" });
              continue;
            }
          }
          const timestamp = now();
          await recoveryStore.updateRunState(projectId, runId, (current) => {
            if (!current || !ACTIVE_RUN_STATUSES.has(current.status)) return current;
            assertRunTransition(current.status, "failed");
            return {
              ...current,
              status: "failed",
              error: "RUNNER_RESTARTED: the service restarted before this run reached a terminal state.",
              finishedAt: timestamp,
              updatedAt: timestamp
            };
          });
          recovered.push({ projectId, runId });
        }
      }

      for (const projectId of projectIds) {
        if (!validId(projectId)) continue;
        const metadata = metadataByProject.get(projectId);
        if (!metadata || !Array.isArray(metadata.taskRecords)) continue;
        let changed = false;
        const timestamp = now();
        const taskRecords = await Promise.all(metadata.taskRecords.map(async (storedTask) => {
          if (!storedTask || storedTask.deletedAt) return storedTask;
          const task = storedTask;
          const currentRunId = task.currentRunId || null;
          if (!currentRunId) return task;
          const runProjectId = task.runProjectId || task.teamVersionId || projectId;
          if (!validId(runProjectId) || !validId(currentRunId)) {
            if (!ACTIVE_RUN_STATUSES.has(task.status)) return task;
            changed = true;
            return { ...task, status: "failed", lastError: "RUN_RESERVATION_INVALID: the reserved Run identifier is invalid.", completedAt: timestamp, updatedAt: timestamp };
          }
          const state = await recoveryStore.readRunState(runProjectId, currentRunId);
          if (!state?.status) {
            if (!ACTIVE_RUN_STATUSES.has(task.status)) return task;
            changed = true;
            return { ...task, status: "failed", lastError: "RUN_STATE_MISSING: the reserved Run has no durable state after service restart.", completedAt: timestamp, updatedAt: timestamp };
          }
          if (task.status === state.status && (task.lastError || null) === (state.error || null)) return task;
          changed = true;
          return {
            ...task,
            status: state.status,
            startedAt: task.startedAt || state.startedAt || null,
            completedAt: ACTIVE_RUN_STATUSES.has(state.status) ? null : (state.finishedAt || timestamp),
            lastError: state.error || null,
            updatedAt: state.updatedAt || timestamp
          };
        }));
        if (changed) await recoveryStore.writeProjectMetadata(projectId, { ...metadata, taskRecords, updatedAt: timestamp });
      }
      return recovered;
    }
  });
}
