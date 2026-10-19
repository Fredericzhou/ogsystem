import { saveProjectSystemSource } from "../../../dist/visualizer/project-projection.js";

export function createVisualizerProjectDesignStore({ save = saveProjectSystemSource } = {}) {
  if (typeof save !== "function") throw new TypeError("Visualizer design store requires a save operation.");
  return Object.freeze({
    saveSystemSource: ({ workdir, systemSource }) => save({ workdir, systemSource })
  });
}
