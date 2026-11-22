import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const runExecutorSourcePath = new URL("../infrastructure/runtime-project-run-executor.mjs", import.meta.url);

test("Project Workspace identity survives Task metadata persistence", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-workspace-project-test-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  try {
    const store = await import(`../infrastructure/file-project-store.mjs?test=${Date.now()}`);
    const project = await store.createProject({
      name: "Workspace persistence",
      overview: "Regression test",
      source: "collaboration-project"
    });
    const initialized = await store.initializeCollaborationProject(project.projectId, {
      projectDefinitionDigest: "a".repeat(64)
    });
    assert.equal(initialized.workspaceBackend, "git-lfs");
    assert.ok(initialized.workspaceId);

    await store.saveProjectMetadata(project.projectId, {
      ...initialized,
      taskRecords: [{ taskId: "task-1", status: "queued" }]
    });
    const withTask = await store.getProject(project.projectId);
    await store.saveTaskRecord(withTask, "task-1", { status: "pending" });

    const reloaded = await store.getProject(project.projectId);
    assert.equal(reloaded.workspaceId, initialized.workspaceId);
    assert.equal(reloaded.workspaceBackend, "git-lfs");
    assert.equal(reloaded.taskRecords[0].status, "pending");
  } finally {
    delete process.env.OGS_SITE_PROJECTS_DIR;
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("Project Task Run uses the persisted Project Workspace identity", async () => {
  const source = await readFile(runExecutorSourcePath, "utf8");
  assert.match(source, /PROJECT_WORKSPACE_ID_REQUIRED/);
  assert.match(source, /createWorkspaceCoordinator\(\{[\s\S]*?workspaceId: project\.workspaceId/);
  assert.match(source, /evidenceDir: resolve\(ogsDir, "\.ogs", "runs", runId\)/);
  assert.equal((source.match(/worktreeRoot: resolve\(ogsDir, "\.ogs", "worktrees"\)/g) || []).length, 2);
});

test("collaboration Project metadata rejects missing or non Git LFS Workspace bindings", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-workspace-project-binding-test-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  try {
    const store = await import(`../infrastructure/file-project-store.mjs?binding-test=${Date.now()}`);
    const valid = { projectId: "project-1", overview: "Binding", projectType: "collaboration", workspaceId: "workspace-1", workspaceBackend: "git-lfs" };
    assert.equal(store.fileProjectStoreInternals.normalizeMeta(valid, "project-1").workspaceId, "workspace-1");
    assert.throws(() => store.fileProjectStoreInternals.normalizeMeta({ ...valid, workspaceId: undefined }, "project-1"), /Git LFS Workspace binding/);
    assert.throws(() => store.fileProjectStoreInternals.normalizeMeta({ ...valid, workspaceBackend: "local" }, "project-1"), /Git LFS Workspace binding/);
  } finally {
    delete process.env.OGS_SITE_PROJECTS_DIR;
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
