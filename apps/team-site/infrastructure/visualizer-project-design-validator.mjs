import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serializeAuthoringToMermaid } from "../../../dist/visualizer/studio-authoring.js";
import { validateProjectSystemSource } from "../../../dist/visualizer/project-projection.js";

export function createVisualizerProjectDesignValidator({
  serialize = serializeAuthoringToMermaid,
  validate = validateProjectSystemSource,
  read = readFile,
  getRuntimeModelConfig = async () => undefined
} = {}) {
  return Object.freeze({
    async validate(project, body = {}) {
      const systemSource = typeof body.systemSource === "string"
        ? body.systemSource
        : body.authoring && typeof body.authoring === "object"
          ? serialize(body.authoring)
          : await read(join(project.workdir, "system.mmd"), "utf8");
      const modelConfig = await getRuntimeModelConfig();
      return validate({
        workdir: project.workdir,
        systemSource,
        systemPath: join(project.workdir, "system.mmd"),
        ...(modelConfig?.modelCatalogModels ? {
          modelCatalogModels: modelConfig.modelCatalogModels,
          modelCatalogGeneratedAt: modelConfig.modelCatalogGeneratedAt
        } : {})
      });
    }
  });
}
