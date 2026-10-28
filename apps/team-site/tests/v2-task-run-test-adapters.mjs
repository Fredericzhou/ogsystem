import { createFileRunQueryStore } from "../infrastructure/file-run-query-store.mjs";

export function createV2AwareTaskRetryStore({ projectsRoot }) {
  const v2Store = createFileRunQueryStore({ projectsRoot });
  async function v2Plan(projectId, taskId, runId) {
    return v2Store.readRunPlan(projectId, taskId, runId).catch((error) => {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    });
  }
  return Object.freeze({
    async readRunState(projectId, taskId, runId) {
      const plan = await v2Plan(projectId, taskId, runId);
      if (plan?.engine !== "team-ir-v2") throw new Error("TEAM_IR_V2_REQUIRED: Task retry requires a Team IR v2 Run.");
      return v2Store.readRunState(projectId, taskId, runId);
    },
    async loadMaterialSnapshots(projectId, taskId, runId) {
      const plan = await v2Plan(projectId, taskId, runId);
      if (plan?.engine !== "team-ir-v2") throw new Error("TEAM_IR_V2_REQUIRED: Task retry requires a Team IR v2 Run.");
      return [];
    }
  });
}
