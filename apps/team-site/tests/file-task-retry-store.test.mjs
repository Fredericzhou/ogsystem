import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFileTaskRetryStore } from "../infrastructure/file-task-retry-store.mjs";

async function fixture() {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-task-retry-"));
  const workdir = join(projectsRoot, "project-1");
  const runDir = join(workdir, ".ogs", "runs", "run-1");
  const task = { taskId: "task-1", taskNumber: 1, status: "failed", currentRunId: "run-1", runIds: ["run-1"], teamVersionId: "team-1", teamCoreDigest: "a".repeat(64) };
  await mkdir(join(workdir, ".site"), { recursive: true });
  await mkdir(join(runDir, "control"), { recursive: true });
  await writeFile(join(workdir, ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [task] }));
  await writeFile(join(runDir, "run-owner.json"), JSON.stringify({
    version: 1, runKind: "project_task", projectId: "project-1", taskId: task.taskId,
    taskNumber: task.taskNumber, attemptNumber: 1, teamVersionId: task.teamVersionId,
    teamCoreDigest: task.teamCoreDigest, runId: "run-1"
  }));
  await writeFile(join(runDir, "control", "materials.json"), JSON.stringify([
    { materialId: "mat-1", snapshotPath: "inputs/input.txt", contentType: "text/plain" }
  ]));
  await writeFile(join(runDir, "control", "state.json"), JSON.stringify({ status: "failed" }));
  return { projectsRoot, workdir, runDir };
}

test("Task retry refuses material snapshots reached through a linked Run parent", async (t) => {
  const value = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "ogs-task-retry-outside-"));
  try {
    await writeFile(join(outside, "input.txt"), "outside data");
    await symlink(outside, join(value.runDir, "inputs"), "junction");
    const store = createFileTaskRetryStore({ projectsRoot: value.projectsRoot });
    await assert.rejects(store.loadMaterialSnapshots("project-1", "task-1", "run-1"), /symlinks or junctions/);
    await assert.rejects(store.resolveRunArtifactPath("project-1", "task-1", "run-1", "inputs/input.txt"), /symlinks or junctions/);
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return t.skip("directory links are unavailable on this host");
    throw error;
  } finally {
    await rm(value.projectsRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("Task retry rejects traversal in snapshot paths", async () => {
  const value = await fixture();
  try {
    const store = createFileTaskRetryStore({ projectsRoot: value.projectsRoot });
    await assert.rejects(store.resolveRunArtifactPath("project-1", "task-1", "run-1", "../outside.txt"), /RUN_NOT_FOUND|material snapshot path is invalid/);
  } finally { await rm(value.projectsRoot, { recursive: true, force: true }); }
});

test("Task retry refuses a linked Run state file", async (t) => {
  const value = await fixture();
  const outside = join(value.projectsRoot, "outside-state.json");
  const target = join(value.runDir, "control", "state.json");
  try {
    await writeFile(outside, JSON.stringify({ status: "failed" }));
    await rm(target);
    try { await symlink(outside, target, "file"); }
    catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code)) return t.skip("file links unavailable: " + error.code);
      throw error;
    }
    const store = createFileTaskRetryStore({ projectsRoot: value.projectsRoot });
    await assert.rejects(store.readRunState("project-1", "task-1", "run-1"), /symlinks or junctions/);
  } finally { await rm(value.projectsRoot, { recursive: true, force: true }); }
});
