import {
  createProjectVisualization,
  inspectProjectWorkspace
} from "../../../dist/visualizer/project-projection.js";

export const projectVisualizerStore = Object.freeze({
  createWorkspace: createProjectVisualization,
  inspectWorkspace: inspectProjectWorkspace
});
