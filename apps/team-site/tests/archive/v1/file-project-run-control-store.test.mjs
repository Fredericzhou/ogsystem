import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFileProjectRunControlStore } from "../infrastructure/file-project-run-control-store.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ogs-run-control-owner-"));
  const projectId = "project-1";
  const runId = "run-1";
  const task = {
    taskId: "task-1", taskNumber: 2, teamVersionId: "team-1", teamCoreDigest: "a".repeat(64),
    currentRunId: runId, runIds: ["run-0", runId]
  };
  const project = { projectId, projectType: "collaboration", workdir: root, taskRecords: [task] };
  const runDir = join(root, ".ogs", "runs", runId);
  await mkdir(join(runDir, "control"), { recursive: true });
  await writeFile(join(runDir, "run-owner.json"), JSON.stringify({
    version: 1, runKind: "project_task", projectId, taskId: task.taskId, taskNumber: task.taskNumber,
    attemptNumber: 2, teamVersionId: task.teamVersionId, teamCoreDigest: task.teamCoreDigest, runId
  }));
  await writeFile(join(runDir, "control", "state.json"), JSON.stringify({ version: 1, runId, status: "paused" }));
  await writeFile(join(runDir, "run-plan.json"), JSON.stringify({ executionPolicy: { mode: "sandbox" } }));
  await writeFile(join(runDir, "task.json"), JSON.stringify({ prompt: "continue this existing Task" }));
  return { root, project, task, runDir, runId };
}

test("Run control store resolves only the persisted current Task owner and returns resume identity", async () => {
  const value = await fixture();
  const store = createFileProjectRunControlStore();
  try {
    assert.equal((await store.readState(value.project, value.runId)).status, "paused");
    const resume = await store.readResumeData(value.project, value.runId);
    assert.equal(resume.projectTask.taskId, value.task.taskId);
    assert.equal(resume.owner.attemptNumber, 2);
    assert.equal(resume.owner.teamVersionId, value.task.teamVersionId);
    assert.equal(resume.task.prompt, "continue this existing Task");
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("Run control rejects missing, stale, mismatched, and linked evidence owners", async (t) => {
  await t.test("missing owner file", async () => {
    const value = await fixture();
    try {
      await rm(join(value.runDir, "run-owner.json"));
      await assert.rejects(createFileProjectRunControlStore().readState(value.project, value.runId), /run owner does not match/);
    } finally { await rm(value.root, { recursive: true, force: true }); }
  });
  await t.test("old Run is not the current Task Run", async () => {
    const value = await fixture();
    try {
      await assert.rejects(createFileProjectRunControlStore().readState(value.project, "run-0"), /current Project Task/);
    } finally { await rm(value.root, { recursive: true, force: true }); }
  });
  await t.test("wrong Task owner", async () => {
    const value = await fixture();
    try {
      value.project.taskRecords[0] = { ...value.task, taskId: "task-other" };
      await assert.rejects(createFileProjectRunControlStore().readState(value.project, value.runId), /does not belong to this Project Task/);
    } finally { await rm(value.root, { recursive: true, force: true }); }
  });
  await t.test("wrong Project owner in persisted Run metadata", async () => {
    const value = await fixture();
    try {
      await writeFile(join(value.runDir, "run-owner.json"), JSON.stringify({
        version: 1, runKind: "project_task", projectId: "project-other", taskId: value.task.taskId,
        taskNumber: value.task.taskNumber, attemptNumber: 2, teamVersionId: value.task.teamVersionId,
        teamCoreDigest: value.task.teamCoreDigest, runId: value.runId
      }));
      await assert.rejects(createFileProjectRunControlStore().readState(value.project, value.runId), /does not match this Project/);
    } finally { await rm(value.root, { recursive: true, force: true }); }
  });
  await t.test("linked Run directory", async (t) => {
    const value = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "ogs-run-control-run-outside-"));
    try {
      await rm(value.runDir, { recursive: true, force: true });
      await symlink(outside, value.runDir, "junction");
      await assert.rejects(createFileProjectRunControlStore().readState(value.project, value.runId), /symlinks or junctions/);
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return t.skip("directory links are unavailable on this host");
      throw error;
    } finally {
      await rm(value.root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
  await t.test("linked runs directory", async (t) => {
    const value = await fixture();
    const runsDirectory = join(value.root, ".ogs", "runs");
    const outside = await mkdtemp(join(tmpdir(), "ogs-run-control-runs-outside-"));
    try {
      await rm(runsDirectory, { recursive: true, force: true });
      await symlink(outside, runsDirectory, "junction");
      await assert.rejects(createFileProjectRunControlStore().readState(value.project, value.runId), /symlinks or junctions/);
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return t.skip("directory links are unavailable on this host");
      throw error;
    } finally {
      await rm(value.root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
  await t.test("linked control directory", async () => {
    const value = await fixture();
    const controlPath = join(value.runDir, "control");
    const outside = await mkdtemp(join(tmpdir(), "ogs-run-control-outside-"));
    try {
      await rm(controlPath, { recursive: true, force: true });
      await symlink(outside, controlPath, "junction");
      await assert.rejects(createFileProjectRunControlStore().writeControl(value.project, value.runId, "pause"), /symlinks or junctions/);
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return t.skip("directory links are unavailable on this host");
      throw error;
    } finally {
      await rm(value.root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
  for (const file of ["run-plan.json", "task.json"]) {
    await t.test(`resume rejects linked ${file}`, async (t) => {
      const value = await fixture();
      const outside = join(value.root, `outside-${file}`);
      const target = join(value.runDir, file);
      try {
        await writeFile(outside, JSON.stringify(file === "task.json" ? { prompt: "outside" } : { executionPolicy: { mode: "sandbox" } }));
        await rm(target);
        try { await symlink(outside, target, "file"); }
        catch (error) {
          if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code)) return t.skip("file links are unavailable on this host");
          throw error;
        }
        await assert.rejects(createFileProjectRunControlStore().readResumeData(value.project, value.runId), /symlinks or junctions/);
      } finally { await rm(value.root, { recursive: true, force: true }); }
    });
  }
});
