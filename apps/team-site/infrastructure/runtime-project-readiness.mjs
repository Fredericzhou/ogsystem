import { inspectProjectReadiness } from "../../../dist/visualizer/project-readiness.js";

export function createRuntimeProjectReadinessInspector({ inspect = inspectProjectReadiness } = {}) {
  return Object.freeze({ inspect });
}
