import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFilePackageTransactionStore } from "../infrastructure/file-package-transaction-store.mjs";

function createStore(projectsRoot) {
  return createFilePackageTransactionStore({
    projectsRoot,
    stagingRoot: join(projectsRoot, ".staging"),
    projectPath: (id) => join(projectsRoot, id),
    readProject: async (id) => ({ projectId: id }),
    getProject: async (id) => ({ projectId: id }),
    listProjects: async () => [],
    listTeamRepository: async () => [],
    createProject: async () => ({}),
    createProjectAt: async () => undefined,
    withProjectWriteLock: async (_id, _reason, operation) => operation(),
    acquireProjectWriteLock: async () => ({ release: async () => undefined }),
    readJson: async () => ({}),
    writeJson: async () => undefined,
    normalizeMeta: (meta) => meta,
    writeTeamReferenceFiles: async () => undefined,
    computeTeamCoreDigest: async () => "team-core",
    exportTeamPackage: async (workdir) => ({ workdir }),
    loadTeamPackage: async () => ({ validation: { ok: true } }),
    createWorkspace: async () => ({ projectId: "project-1" }),
    normalizeMaterialPath: (path) => path,
    slug: (name) => name.toLowerCase()
  });
}

test("package transaction adapter requires the filesystem and workspace ports it uses", () => {
  assert.throws(() => createFilePackageTransactionStore({}), /requires projectsRoot/);
});

test("package transaction adapter exports package snapshots through the file store", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-file-package-store-"));
  try {
    const store = createStore(projectsRoot);
    const exported = await store.exportTeamPackage("team-1");
    assert.equal(exported.team.project.projectId, "team-1");
    assert.equal(exported.teamCoreDigest, "team-core");
    assert.equal(exported.packageDigest.length, 64);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
