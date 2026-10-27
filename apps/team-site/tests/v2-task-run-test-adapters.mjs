import { createFileRunQueryStore } from "../infrastructure/file-run-query-store.mjs";

export function createV2AwareTaskAttemptStore({ projectsRoot, legacyStore }) {
  const v2Store = createFileRunQueryStore({ projectsRoot });
  return Object.freeze({
    async readAttempt(projectId, taskId, runId) {
      const plan = await v2Store.readRunPlan(projectId, taskId, runId).catch((error) => {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      });
      if (plan?.engine !== "team-ir-v2") return legacyStore.readAttempt(projectId, taskId, runId);
      const [state, owner] = await Promise.all([
        v2Store.readRunState(projectId, taskId, runId),
        v2Store.readRunOwner(projectId, taskId, runId)
      ]);
      return {
        state: { ...state, attemptNumber: owner.attemptNumber },
        plan,
        outputSummary: typeof state.result?.summary === "string" ? state.result.summary : ""
      };
    }
  });
}

export function createV2AwareTaskRetryStore({ projectsRoot, legacyStore }) {
  const v2Store = createFileRunQueryStore({ projectsRoot });
  async function v2Plan(projectId, taskId, runId) {
    return v2Store.readRunPlan(projectId, taskId, runId).catch((error) => {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    });
  }
  return Object.freeze({
    ...legacyStore,
    async readRunState(projectId, taskId, runId) {
      let plan;
      try {
        plan = await v2Plan(projectId, taskId, runId);
      } catch (error) {
        if (error?.code !== "RUN_NOT_FOUND" && !/^RUN_NOT_FOUND:/.test(error?.message || "")) throw error;
        return legacyStore.readRunState(projectId, taskId, runId);
      }
      return plan?.engine === "team-ir-v2"
        ? v2Store.readRunState(projectId, taskId, runId)
        : legacyStore.readRunState(projectId, taskId, runId);
    },
    async loadMaterialSnapshots(projectId, taskId, runId) {
      const plan = await v2Plan(projectId, taskId, runId);
      return plan?.engine === "team-ir-v2"
        ? []
        : legacyStore.loadMaterialSnapshots(projectId, taskId, runId);
    }
  });
}
