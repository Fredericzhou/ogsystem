import { createFileRunQueryStore } from "./file-run-query-store.mjs";

export function createTeamIrTaskAttemptStore({ projectsRoot }) {
  const v2Store = createFileRunQueryStore({ projectsRoot });
  async function readRunArtifacts(projectId, taskId, runId) {
    const plan = await v2Store.readRunPlan(projectId, taskId, runId);
    if (plan?.engine !== "team-ir-v2") {
      throw new Error("TEAM_IR_V2_REQUIRED: Project Task attempts must use a Team IR v2 Run.");
    }
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
  return Object.freeze({
    readAttempt: readRunArtifacts,
    readRunArtifacts
  });
}
