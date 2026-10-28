import { teamIRSemanticDigest } from "../../../dist/team-ir/index.js";

export function createRuntimeTaskExecutionReadiness({ inspect, teamIrStore, confirmation } = {}) {
  return Object.freeze({
    inspect,
    async requireCurrentConfirmation(project) {
      const releasedTeamVersion = project.projectType !== "collaboration" && ["released", "archived"].includes(project.teamVersionStatus);
      const confirmedCollaborationProject = project.projectType === "collaboration"
        && project.projectStatus === "confirmed" && project.confirmedAt;
      if (!(releasedTeamVersion || confirmedCollaborationProject) || !project.projectDigest) {
        throw new Error("PROJECT_NOT_CONFIRMED: release the TeamVersion or confirm the Collaboration Project before preparing or running a task.");
      }
      const stored = await teamIrStore?.read?.({ workdir: project.workdir });
      if (stored?.teamIR?.schemaVersion !== 2) {
        throw new Error("TEAM_IR_V2_REQUIRED: TeamVersion must contain a native Team IR v2 document.");
      }
      const semanticDigest = teamIRSemanticDigest(stored.teamIR);
      if (project.teamIrSemanticDigest && project.teamIrSemanticDigest !== semanticDigest) {
        throw new Error("TEAM_IR_SEMANTIC_DIGEST_MISMATCH: the frozen Team IR changed after release.");
      }
      if (typeof confirmation?.computeDigests !== "function") {
        throw new Error("TEAM_IR_CONFIRMATION_UNAVAILABLE: native Team IR v2 confirmation is not configured.");
      }
      const current = await confirmation.computeDigests(project);
      if (current.projectDigest !== project.projectDigest) {
        throw new Error("PROJECT_CONFIRMATION_STALE: frozen Team IR changed; release the TeamVersion again.");
      }
    }
  });
}
