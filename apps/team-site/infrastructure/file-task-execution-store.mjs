import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { saveProjectRunState, loadProjectRunState } from "../../../dist/runtime/project-run-state.js";
import { assertTaskExecutionSlot } from "../domain/task.mjs";
import { assertRunTransition } from "../domain/run.mjs";

export function createFileTaskExecutionStore({ projectStore }) {
  if (typeof projectStore?.getProject !== "function"
    || typeof projectStore?.withProjectWriteLock !== "function"
    || typeof projectStore?.saveTaskRecord !== "function") {
    throw new TypeError("File Task execution store requires Project reads, locks, and Task persistence.");
  }

  async function taskAt(projectId, taskId) {
    const project = await projectStore.getProject(projectId);
    const task = (project.taskRecords || []).find((item) => item.taskId === taskId && !item.deletedAt);
    if (!task) throw new Error("TASK_NOT_FOUND: task does not exist.");
    return { project, task };
  }

  return Object.freeze({
    async reserveAttempt({ projectId, taskId, retrySourceRunId, attemptKey, attemptFingerprint, runId, mode, startedAt, runProjectId, runWorkdir }) {
      return projectStore.withProjectWriteLock(projectId, "project-task-bind-run", async () => {
        const { project, task } = await taskAt(projectId, taskId);
        if (!(retrySourceRunId ? ["queued", "failed"].includes(task.status) : task.status === "queued")) {
          if (task.currentRunId && task.currentRunId !== retrySourceRunId) return { project, task };
          throw new Error(`TASK_START_NOT_ALLOWED: task status is ${task.status}.`);
        }
        if (task.currentRunId && task.currentRunId !== retrySourceRunId) return { project, task };
        assertTaskExecutionSlot(project, taskId);
        const existing = task.attemptRequests?.[attemptKey];
        if (existing) {
          if (existing.requestFingerprint !== attemptFingerprint) throw new Error("IDEMPOTENCY_KEY_REUSE: attempt key was already used with a different request.");
          return { project, task };
        }
        const attemptNumber = (task.runIds || []).length + 1;
        const attemptRequests = {
          ...(task.attemptRequests || {}),
          [attemptKey]: { requestFingerprint: attemptFingerprint, runId, attemptNumber, mode, sourceRunId: retrySourceRunId || null }
        };
        if (!runWorkdir) throw new TypeError("Task Run reservation requires its Runtime workspace.");
        const runDir = resolve(runWorkdir, ".ogs", "runs", runId);
        await saveProjectRunState(runDir, {
        version: 1,
        runId,
        attemptNumber,
        status: "planning",
        taskReservation: { kind: "task-attempt", collaborationProjectId: projectId, taskId, runId, attemptKey },
        control: { paused: false, cancelRequested: false },
        nodes: {},
        attempts: [],
        reviews: [],
          updatedAt: startedAt
        });
        try {
          const reservedTask = await projectStore.saveTaskRecord(project, taskId, {
            currentRunId: runId,
            runIds: [...(task.runIds || []), runId],
            attemptRequests,
            runProjectId,
            status: "planning",
            completedAt: null,
            startedAt,
            lastError: null,
            outputSummary: ""
          });
          return { project, task: reservedTask, attemptNumber };
        } catch (error) {
          const latest = await taskAt(projectId, taskId).catch(() => undefined);
          const wasCommitted = latest?.task.currentRunId === runId || latest?.task.runIds?.includes(runId);
          if (!wasCommitted) await rm(runDir, { recursive: true, force: true }).catch(() => undefined);
          throw error;
        }
      });
    },

    async completeAttempt({ projectId, taskId, runId, startedAt, result, now }) {
      return projectStore.withProjectWriteLock(projectId, "project-task-finish", async () => {
        const { project, task } = await taskAt(projectId, taskId);
        if (task.currentRunId !== runId) return task;
        return projectStore.saveTaskRecord(project, taskId, {
          status: result.state?.status || "running",
          startedAt,
          completedAt: ["completed", "failed", "cancelled"].includes(result.state?.status) ? (result.state?.finishedAt || now) : null,
          outputSummary: typeof result.result?.finalOutput === "string" ? result.result.finalOutput.slice(0, 500) : task.outputSummary
        });
      });
    },

    async failAttempt({ projectId, taskId, runProject, runId, error, now }) {
      const failureMessage = error instanceof Error ? error.message : String(error);
      const runDir = resolve(runProject.workdir, ".ogs", "runs", runId);
      const currentState = await loadProjectRunState(runDir).catch(() => undefined);
      if (currentState) {
        if (currentState.status !== "failed") assertRunTransition(currentState.status, "failed");
        await saveProjectRunState(runDir, {
          ...currentState,
          status: "failed",
          error: failureMessage,
          finishedAt: now,
          updatedAt: now
        });
      }
      await projectStore.withProjectWriteLock(projectId, "project-task-start-failure", async () => {
        const { project, task } = await taskAt(projectId, taskId);
        if (task.currentRunId !== runId) return task;
        return projectStore.saveTaskRecord(project, taskId, { status: "failed", completedAt: now, lastError: failureMessage });
      });
    }
  });
}
