import { inspectProjectReadiness } from "../../../dist/visualizer/project-readiness.js";
import { computeProjectAssetDigest } from "../../../dist/runtime/project-asset-digest.js";

export function createRuntimeTaskExecutionReadiness({ inspect = inspectProjectReadiness, assertTeamVersionContracts } = {}) {
  return Object.freeze({
    inspect,
    async requireCurrentConfirmation(project) {
      const trainedTeamVersion = project.projectType !== "collaboration" && ["trained", "archived"].includes(project.teamVersionStatus);
      const confirmedCollaborationProject = project.projectType === "collaboration"
        && project.projectStatus === "confirmed" && project.confirmedAt;
      if (!(trainedTeamVersion || confirmedCollaborationProject) || !project.projectDigest) {
        throw new Error("PROJECT_NOT_CONFIRMED: train the TeamVersion or confirm the Collaboration Project before preparing or running a task.");
      }
      if (trainedTeamVersion && typeof assertTeamVersionContracts === "function") {
        await assertTeamVersionContracts(project);
      }
      if (await computeProjectAssetDigest(project.workdir) !== project.projectDigest) {
        const remedy = trainedTeamVersion
          ? "trained TeamVersion assets changed; create and train a new TeamVersion"
          : "Project semantic files changed; confirm the Project again";
        throw new Error(`PROJECT_CONFIRMATION_STALE: ${remedy}.`);
      }
    }
  });
}
