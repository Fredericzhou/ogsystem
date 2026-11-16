import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFileSharedResourceStore } from "../infrastructure/file-shared-resource-store.mjs";

async function withRoot(run) {
  const directory = await mkdtemp(join(tmpdir(), "ogs-shared-resources-"));
  try { await run(directory, createFileSharedResourceStore({ root: join(directory, "resources") })); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("shared catalog serializes concurrent writes without dropping entries", async () => {
  await withRoot(async (_directory, store) => {
    await Promise.all([
      store.putCatalogItem("tools", { id: "search", name: "Search", type: "exec" }),
      store.putCatalogItem("tools", { id: "extract", name: "Extract", type: "mcp" })
    ]);
    assert.deepEqual((await store.listCatalog("tools")).tools.map((item) => item.id).sort(), ["extract", "search"]);
    const catalog = JSON.parse(await readFile(join(_directory, "resources", "resources.json"), "utf8"));
    assert.equal(catalog.version, 1);
  });
});

test("dataset versions publish atomically, are immutable, and return the published snapshot", async () => {
  await withRoot(async (_directory, store) => {
    const payload = { resourceId: "reference", versionId: "v1", name: "Reference data", files: [{ path: "guide/readme.md", content: "fixed snapshot" }] };
    const [first, concurrent] = await Promise.allSettled([store.createDatasetVersion(payload), store.createDatasetVersion(payload)]);
    assert.equal([first, concurrent].filter((result) => result.status === "fulfilled").length, 1);
    assert.equal([first, concurrent].find((result) => result.status === "rejected").reason.message, "RESOURCE_VERSION_IMMUTABLE");
    const result = await store.readDatasetFiles("reference", "v1");
    assert.equal(result.metadata.readOnly, true);
    assert.equal(result.files[0].content, "fixed snapshot");
    await assert.rejects(store.createDatasetVersion(payload), /RESOURCE_VERSION_IMMUTABLE/);
    assert.equal((await store.listDatasets()).datasets.length, 1);
  });
});

test("role template versions are immutable and only expose allowlisted assets", async () => {
  await withRoot(async (_directory, store) => {
    const payload = { roleId: "analyst", versionId: "v1", metadata: { name: "Analyst" }, assets: { "prompt.md": "Analyze evidence.", "role.json": "{}" } };
    await store.createRoleTemplate(payload);
    await assert.rejects(store.createRoleTemplate(payload), /RESOURCE_VERSION_IMMUTABLE/);
    await assert.rejects(store.createRoleTemplate({ ...payload, versionId: "v2", assets: { "../outside": "no" } }), /ROLE_TEMPLATE_ASSET_INVALID/);
    const result = await store.readRoleTemplate("analyst", "v1");
    assert.equal(result.template.name, "Analyst");
    assert.deepEqual(result.assets, payload.assets);
    assert.equal((await store.listRoleTemplates()).templates.length, 1);
  });
});

test("shared resource storage rejects linked roots and linked dataset evidence", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ogs-shared-resource-links-"));
  const outside = join(directory, "outside");
  const root = join(directory, "resource-link");
  await mkdir(outside);
  try {
    try { await symlink(outside, root, "junction"); }
    catch (error) { t.skip(`Directory links are unavailable: ${error.message}`); return; }
    const linkedStore = createFileSharedResourceStore({ root });
    await assert.rejects(linkedStore.listCatalog("tools"), /RESOURCE_PATH_UNSAFE/);

    await rm(root, { recursive: true, force: true });
    const store = createFileSharedResourceStore({ root: join(directory, "safe") });
    await store.createDatasetVersion({ resourceId: "reference", versionId: "v1", files: [{ path: "docs/readme.md", content: "safe" }] });
    await rm(join(directory, "safe", "datasets", "reference", "v1", "docs"), { recursive: true, force: true });
    await symlink(outside, join(directory, "safe", "datasets", "reference", "v1", "docs"), "junction");
    await writeFile(join(outside, "readme.md"), "outside");
    await assert.rejects(store.readDatasetFiles("reference", "v1"), /RESOURCE_PATH_UNSAFE/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
