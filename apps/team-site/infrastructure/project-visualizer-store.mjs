import {
  createProjectVisualization,
  inspectProjectWorkspace,
  exportTeamPackage,
  loadTeamPackage
} from "../../../dist/visualizer/project-projection.js";

export const projectVisualizerStore = Object.freeze({
  createWorkspace: createProjectVisualization,
  inspectWorkspace: inspectProjectWorkspace,
  exportTeamPackage,
  loadTeamPackage
});
