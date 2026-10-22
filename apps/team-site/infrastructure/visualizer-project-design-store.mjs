import { saveProjectSystemSource, validateProjectSystemSource } from "../../../dist/visualizer/project-projection.js";
import { saveStudioAuthoringDraft, serializeAuthoringToMermaid } from "../../../dist/visualizer/studio-authoring.js";

export function createVisualizerProjectDesignStore({ save = saveProjectSystemSource, saveAuthoringDraft = saveStudioAuthoringDraft, validate = validateProjectSystemSource, serialize = serializeAuthoringToMermaid, getRuntimeModelConfig = async () => undefined } = {}) {
  if (typeof save !== "function" || typeof saveAuthoringDraft !== "function" || typeof validate !== "function" || typeof serialize !== "function") throw new TypeError("Visualizer design store requires save operations.");
  return Object.freeze({
    async saveSystemSource({ workdir, systemSource }) {
      const modelConfig = await getRuntimeModelConfig();
      return save({ workdir, systemSource, ...modelConfig });
    },
    async saveAuthoring({ workdir, authoring }) {
      const systemSource = serialize(authoring);
      const modelConfig = await getRuntimeModelConfig();
      const result = await saveAuthoringDraft({
        workdir,
        authoring,
        validateSystemSource: (input) => validate({ ...input, ...modelConfig }),
        ...modelConfig,
        persistCanonicalDesign: true
      });
      if (result.validation?.ok !== true) return result;
      const sourceSave = await save({ workdir, systemSource, ...modelConfig });
      return { ...result, validation: sourceSave.validation, systemSource };
    }
  });
}
