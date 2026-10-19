import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { normalizeMaterialPath } from "../domain/material-path.mjs";

function slug(value) {
  const normalized = String(value || "material").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 48) || "material";
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readOptionalFile(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function restoreFile(path, previous) {
  if (previous === undefined) await rm(path, { force: true });
  else {
    await mkdir(resolve(path, ".."), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, previous);
    await rename(temp, path);
  }
}

export function createFileProjectMaterialStore({ computeProjectDefinitionDigest }) {
  if (typeof computeProjectDefinitionDigest !== "function") {
    throw new TypeError("File Project material store requires the Project definition digest operation.");
  }

  return Object.freeze({
    async addMaterials(project, materials) {
      const safeMaterials = materials.map((material) => ({
        ...material,
        filename: normalizeMaterialPath(material.filename)
      }));
      const batchId = randomUUID();
      const tempRoot = resolve(project.workdir, ".site", "material-upload", batchId);
      const finalRoot = resolve(project.workdir, "workspace", "files", batchId);
      const indexPath = join(project.workdir, "workspace", "index.json");
      const metadataPath = join(project.workdir, ".site", "project.json");
      const entries = [];
      let moved = false;
      let indexWritten = false;
      let metadataWritten = false;
      let previousIndex;
      let previousMetadata;
      try {
        previousIndex = await readOptionalFile(indexPath);
        previousMetadata = await readFile(metadataPath);
        const metadata = JSON.parse(previousMetadata.toString("utf8"));
        for (const material of safeMaterials) {
          const extension = extname(material.filename).toLowerCase();
          const materialId = `${slug(material.filename.replaceAll("/", "-").slice(0, -extension.length))}-${randomUUID().slice(0, 6)}`;
          const target = resolve(tempRoot, material.filename);
          await mkdir(resolve(target, ".."), { recursive: true });
          await writeFile(target, material.content, "utf8");
          entries.push({
            materialId,
            filename: material.filename,
            path: `workspace/files/${batchId}/${material.filename}`,
            contentType: material.contentType,
            size: material.size,
            contentHash: createHash("sha256").update(material.content).digest("hex"),
            status: "indexed",
            createdAt: new Date().toISOString()
          });
        }

        const index = project.materials && Array.isArray(project.materials.materials)
          ? { ...project.materials, materials: [...project.materials.materials, ...entries] }
          : { version: 1, materials: entries };
        const nextMetadata = {
          ...metadata,
          projectDefinitionDigest: computeProjectDefinitionDigest({ ...project, ...metadata, materials: index }),
          updatedAt: new Date().toISOString()
        };
        await mkdir(resolve(finalRoot, ".."), { recursive: true });
        await rename(tempRoot, finalRoot);
        moved = true;
        await writeJson(indexPath, index);
        indexWritten = true;
        await writeJson(metadataPath, nextMetadata);
        metadataWritten = true;
        return entries;
      } catch (error) {
        await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
        if (metadataWritten || indexWritten) {
          if (metadataWritten) await restoreFile(metadataPath, previousMetadata).catch(() => undefined);
          if (indexWritten) await restoreFile(indexPath, previousIndex).catch(() => undefined);
        }
        if (moved) await rm(finalRoot, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    }
  });
}
