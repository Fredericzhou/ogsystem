import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProjectMaterialUseCases } from "../application/project-material-use-cases.mjs";
import { computeProjectDefinitionDigest } from "../infrastructure/package-integrity.mjs";
import { createFileProjectMaterialStore } from "../infrastructure/file-project-material-store.mjs";

test("material application validates and persists a complete batch with updated definition digest", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-project-materials-"));
  const project = {
    projectId: "project-1",
    projectType: "collaboration",
    workdir,
    materials: { version: 1, materials: [] },
    projectDefinitionDigest: "before"
  };
  await mkdir(join(workdir, ".site"), { recursive: true });
  await writeFile(join(workdir, ".site", "project.json"), JSON.stringify(project), "utf8");
  const calls = [];
  const useCases = createProjectMaterialUseCases({
    projectStore: {
      getProject: async () => project,
      withProjectWriteLock: async (_id, operation, action) => (calls.push(operation), action())
    },
    materialStore: createFileProjectMaterialStore({ computeProjectDefinitionDigest }),
    confirmation: { assertCurrent: async () => { throw new Error("collaboration Project should not require Team confirmation"); } }
  });

  try {
    const entries = await useCases.addProjectMaterials("project-1", [
      { filename: "brief/notes.md", content: "Notes", contentType: "text/markdown" },
      { filename: "data.json", content: "{}" }
    ]);
    assert.deepEqual(calls, ["material-upload"]);
    assert.deepEqual(entries.map(({ filename }) => filename), ["brief/notes.md", "data.json"]);
    assert.ok(entries.every((entry) => entry.status === "indexed" && /^[a-f0-9]{64}$/.test(entry.contentHash)));
    assert.equal(await readFile(join(workdir, entries[0].path), "utf8"), "Notes");
    const index = JSON.parse(await readFile(join(workdir, "workspace", "index.json"), "utf8"));
    assert.deepEqual(index.materials, entries);
    const metadata = JSON.parse(await readFile(join(workdir, ".site", "project.json"), "utf8"));
    assert.match(metadata.projectDefinitionDigest, /^[a-f0-9]{64}$/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("material application rejects unsafe or invalid batches before the store writes", async () => {
  let writes = 0;
  const useCases = createProjectMaterialUseCases({
    projectStore: {
      getProject: async () => ({ projectType: "collaboration" }),
      withProjectWriteLock: async (_id, _operation, action) => action()
    },
    materialStore: { addMaterials: async () => { writes += 1; } },
    confirmation: { assertCurrent: async () => {} }
  });

  await assert.rejects(() => useCases.addProjectMaterials("project-1", []), /MATERIAL_BATCH_INVALID/);
  await assert.rejects(() => useCases.addProjectMaterials("project-1", [{ filename: "../escape.md", content: "x" }]), /MATERIAL_PATH_INVALID/);
  await assert.rejects(() => useCases.addProjectMaterials("project-1", [{ filename: "script.exe", content: "x" }]), /Only md, txt, json, yaml, yml, and csv/);
  await assert.rejects(() => useCases.addProjectMaterials("project-1", [{ filename: "large.md", content: "x".repeat(1024 * 1024 + 1) }]), /up to 1 MB/);
  assert.equal(writes, 0);
});

test("file material store removes staged files when a batch contains an unsupported path", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-project-material-failure-"));
  const store = createFileProjectMaterialStore({ computeProjectDefinitionDigest });
  try {
    await assert.rejects(() => store.addMaterials({ workdir, materials: { version: 1, materials: [] } }, [
      { filename: "valid.md", content: "valid", size: 5, contentType: "text/plain" },
      { filename: "../escape.md", content: "bad", size: 3, contentType: "text/plain" }
    ]), /MATERIAL_PATH_INVALID/);
    assert.deepEqual(await readdir(join(workdir, ".site", "material-upload")).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error)), []);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
