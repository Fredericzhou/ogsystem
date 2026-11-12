import { normalizeMaterialPath } from "../domain/material-path.mjs";

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
        const encoding = file?.encoding === "base64" ? "base64" : "utf-8";
        if (file?.encoding !== undefined && !["utf-8", "base64"].includes(file.encoding)) throw new Error("MATERIAL_ENCODING_INVALID: use utf-8 or base64.");
        if (typeof file?.content !== "string") throw new Error("Material content must be a string encoded as utf-8 or base64.");
        let bytes;
        try {
          if (encoding === "base64" && (file.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content))) throw new Error("invalid base64");
          bytes = encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content, "utf8");
        }
        catch { throw new Error("MATERIAL_CONTENT_INVALID: unable to decode file content."); }
        if (bytes.byteLength > MAX_MATERIAL_SIZE) throw new Error("Material content must be text or binary up to 1 MB.");
        const size = bytes.byteLength;
        totalSize += size;
        if (totalSize > MAX_BATCH_SIZE) throw new Error("Material batch must be no larger than 8 MB.");
        return {
          filename,
          content: file.content,
          contentType: file.contentType || "text/plain",
          encoding,
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
