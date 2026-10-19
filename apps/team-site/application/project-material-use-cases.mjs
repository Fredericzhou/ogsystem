import { isSupportedMaterialPath, normalizeMaterialPath } from "../domain/material-path.mjs";

const MAX_MATERIALS_PER_BATCH = 200;
const MAX_MATERIAL_SIZE = 1024 * 1024;
const MAX_BATCH_SIZE = 8 * 1024 * 1024;

export function createProjectMaterialUseCases({ projectStore, materialStore, confirmation }) {
  if (typeof projectStore?.getProject !== "function" || typeof projectStore?.withProjectWriteLock !== "function") {
    throw new TypeError("Project material use cases require Project read and write-lock operations.");
  }
  if (typeof materialStore?.addMaterials !== "function" || typeof confirmation?.assertCurrent !== "function") {
    throw new TypeError("Project material use cases require a material store and confirmation check.");
  }

  async function addProjectMaterials(projectId, files = []) {
    return projectStore.withProjectWriteLock(projectId, "material-upload", async () => {
      const project = await projectStore.getProject(projectId);
      if (project.projectType !== "collaboration") await confirmation.assertCurrent(project);
      const normalizedFiles = Array.isArray(files) ? files : [];
      if (!normalizedFiles.length || normalizedFiles.length > MAX_MATERIALS_PER_BATCH) {
        throw new Error("MATERIAL_BATCH_INVALID: provide between 1 and 200 files.");
      }

      let totalSize = 0;
      const materials = normalizedFiles.map((file) => {
        const filename = normalizeMaterialPath(file?.filename);
        if (!isSupportedMaterialPath(filename)) {
          throw new Error("Only md, txt, json, yaml, yml, and csv materials are supported.");
        }
        if (typeof file?.content !== "string" || file.content.length > MAX_MATERIAL_SIZE) {
          throw new Error("Material content must be text up to 1 MB.");
        }
        const size = Buffer.byteLength(file.content);
        totalSize += size;
        if (totalSize > MAX_BATCH_SIZE) throw new Error("Material batch must be no larger than 8 MB.");
        return {
          filename,
          content: file.content,
          contentType: file.contentType || "text/plain",
          size
        };
      });
      return materialStore.addMaterials(project, materials);
    });
  }

  return Object.freeze({
    addProjectMaterials,
    async addProjectMaterial(projectId, material) {
      return (await addProjectMaterials(projectId, [material]))[0];
    }
  });
}
