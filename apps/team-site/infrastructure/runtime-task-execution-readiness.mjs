import { inspectProjectReadiness } from "../../../dist/visualizer/project-readiness.js";
import { computeProjectAssetDigest } from "../../../dist/runtime/project-asset-digest.js";

export function createRuntimeTaskExecutionReadiness({ inspect = inspectProjectReadiness } = {}) {
  return Object.freeze({
    inspect,
    async requireCurrentConfirmation(project) {
      if (project.projectStatus !== "confirmed" || !project.projectDigest || !project.confirmedAt) {
        throw new Error("PROJECT_NOT_CONFIRMED: confirm the team design before preparing or running a task.");
      }
      if (await computeProjectAssetDigest(project.workdir) !== project.projectDigest) {
        throw new Error("PROJECT_CONFIRMATION_STALE: semantic project files changed; confirm the project again.");
      }
    }
  });
}
