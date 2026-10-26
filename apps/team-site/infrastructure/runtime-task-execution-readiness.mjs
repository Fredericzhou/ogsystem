import { inspectProjectReadiness } from "../../../dist/visualizer/project-readiness.js";
import { computeProjectAssetDigest } from "../../../dist/runtime/project-asset-digest.js";

export function createRuntimeTaskExecutionReadiness({ inspect = inspectProjectReadiness } = {}) {
  return Object.freeze({
    inspect,
    async requireCurrentConfirmation(project) {
      const releasedTeamVersion = project.projectType !== "collaboration" && ["released", "archived"].includes(project.teamVersionStatus);
      const confirmedCollaborationProject = project.projectType === "collaboration"
        && project.projectStatus === "confirmed" && project.confirmedAt;
      if (!(releasedTeamVersion || confirmedCollaborationProject) || !project.projectDigest) {
        throw new Error("PROJECT_NOT_CONFIRMED: release the TeamVersion or confirm the Collaboration Project before preparing or running a task.");
      }
      if (await computeProjectAssetDigest(project.workdir) !== project.projectDigest) {
        throw new Error("PROJECT_CONFIRMATION_STALE: semantic project files changed; confirm the project again.");
      }
    }
  });
}
