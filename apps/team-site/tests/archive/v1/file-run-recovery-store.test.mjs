import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileRunRecoveryStore } from "../infrastructure/file-run-recovery-store.mjs";
import { saveProjectRunState } from "../../../dist/runtime/project-run-state.js";

async function withTempDirectory(action) {
  const root = await mkdtemp(join(tmpdir(), "ogs-run-recovery-store-"));
  try {
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createProjectRun(root, projectId = "project-1", runId = "run-1") {
  const projectRoot = join(root, projectId);
  const runDir = join(projectRoot, ".ogs", "runs", runId);
  await mkdir(join(projectRoot, ".site"), { recursive: true });
  await mkdir(join(runDir, "control"), { recursive: true });
  await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [] }), "utf8");
  await writeFile(join(runDir, "run-owner.json"), JSON.stringify({
    version: 1, runKind: "project_task", projectId, taskId: "task-1", taskNumber: 1,
    attemptNumber: 1, teamVersionId: "team-1", runId
  }), "utf8");
  await saveProjectRunState(runDir, { status: "running", taskReservation: { kind: "task-attempt", projectId, taskId: "task-1", teamVersionId: "team-1", runId }, nodes: {}, attempts: [], reviews: [] });
  return { projectRoot, runDir };
}

function linkUnavailable(error) {
  return ["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code);
}

async function linkOrSkip(t, target, path, type) {
  try {
    await symlink(target, path, type);
    return true;
  } catch (error) {
    if (linkUnavailable(error)) {
      t.skip("filesystem links unavailable: " + error.code);
      return false;
    }
    throw error;
  }
}

test("recovery store validates project root before metadata access", async (t) => {
  await withTempDirectory(async (root) => {
    const outside = join(root, "outside-project");
    await mkdir(join(outside, ".site"), { recursive: true });
    await writeFile(join(outside, ".site", "project.json"), JSON.stringify({ projectType: "collaboration" }));
    const projectsRoot = join(root, "projects");
    await mkdir(projectsRoot, { recursive: true });
    if (!await linkOrSkip(t, outside, join(projectsRoot, "project-1"), process.platform === "win32" ? "junction" : "dir")) return;
    const store = createFileRunRecoveryStore({ projectsRoot });
    await assert.rejects(store.readProjectMetadata("project-1"), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
    await assert.rejects(store.listProjectIds(), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
  });
});

test("recovery store rejects linked metadata and Run namespace components", async (t) => {
  await withTempDirectory(async (root) => {
    const { projectRoot } = await createProjectRun(root);
    const store = createFileRunRecoveryStore({ projectsRoot: root });
    const outsideMetadata = join(root, "outside-project.json");
    await writeFile(outsideMetadata, JSON.stringify({ projectType: "collaboration" }));
    const metadataPath = join(projectRoot, ".site", "project.json");
    await rm(metadataPath);
    if (!await linkOrSkip(t, outsideMetadata, metadataPath, "file")) return;
    await assert.rejects(store.readProjectMetadata("project-1"), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
    await rm(metadataPath);

    const outsideSite = join(root, "outside-site");
    await mkdir(outsideSite, { recursive: true });
    await writeFile(join(outsideSite, "project.json"), JSON.stringify({ projectType: "collaboration" }));
    await rm(join(projectRoot, ".site"), { recursive: true });
    if (!await linkOrSkip(t, outsideSite, join(projectRoot, ".site"), process.platform === "win32" ? "junction" : "dir")) return;
    await assert.rejects(store.readProjectMetadata("project-1"), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
    await assert.rejects(store.writeProjectMetadata("project-1", { projectType: "collaboration" }), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
    await rm(join(projectRoot, ".site"), { recursive: true });
    await mkdir(join(projectRoot, ".site"), { recursive: true });
    await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [] }), "utf8");

    const outsideRuns = join(root, "outside-runs");
    await mkdir(outsideRuns, { recursive: true });
    await rm(join(projectRoot, ".ogs", "runs"), { recursive: true });
    if (!await linkOrSkip(t, outsideRuns, join(projectRoot, ".ogs", "runs"), process.platform === "win32" ? "junction" : "dir")) return;
    await assert.rejects(store.listRunIds("project-1"), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
    await assert.rejects(store.readRunState("project-1", "run-1"), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
    await assert.rejects(store.updateRunState("project-1", "run-1", (state) => state), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
    await assert.rejects(store.removeRunDirectory("project-1", "run-1"), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
  });
});

test("recovery store rejects linked state and refuses to delete linked Run directories", async (t) => {
  await withTempDirectory(async (root) => {
    const { runDir } = await createProjectRun(root);
    const store = createFileRunRecoveryStore({ projectsRoot: root });
    const outsideState = join(root, "outside-state.json");
    await writeFile(outsideState, JSON.stringify({ status: "running" }), "utf8");
    const statePath = join(runDir, "control", "state.json");
    await rm(statePath);
    if (!await linkOrSkip(t, outsideState, statePath, "file")) return;
    await assert.rejects(store.readRunState("project-1", "run-1"), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
    await assert.rejects(store.updateRunState("project-1", "run-1", (state) => state), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
    await rm(statePath);

    const outsideRun = join(root, "outside-run");
    await mkdir(join(outsideRun, "control"), { recursive: true });
    await writeFile(join(outsideRun, "control", "state.json"), JSON.stringify({ status: "running" }));
    await writeFile(join(outsideRun, "run-owner.json"), JSON.stringify({
      version: 1, runKind: "project_task", projectId: "project-1", taskId: "task-1", taskNumber: 1,
      attemptNumber: 1, teamVersionId: "team-1", runId: "run-1"
    }));
    await rm(runDir, { recursive: true });
    if (!await linkOrSkip(t, outsideRun, runDir, process.platform === "win32" ? "junction" : "dir")) return;
    await assert.rejects(store.removeRunDirectory("project-1", "run-1"), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
    assert.equal(JSON.parse(await readFile(join(outsideRun, "control", "state.json"), "utf8")).status, "running");
  });
});
