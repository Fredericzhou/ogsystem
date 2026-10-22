import { inspectProjectReadiness } from "../../../dist/visualizer/project-readiness.js";

export function createRuntimeProjectReadinessInspector({
  inspect = inspectProjectReadiness,
  getRuntimeModelConfig = async () => undefined
} = {}) {
  return Object.freeze({
    async inspect(workdir) {
      const modelConfig = await getRuntimeModelConfig();
      if (!modelConfig?.modelCatalogModels) return inspect(workdir);
      return inspect(workdir, {
        modelCatalogModels: modelConfig.modelCatalogModels,
        modelCatalogGeneratedAt: modelConfig.modelCatalogGeneratedAt
      });
    }
  });
}
