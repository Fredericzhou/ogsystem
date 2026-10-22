import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFileProjectRunStore } from "../infrastructure/file-project-run-store.mjs";

async function fixture() {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-project-run-snapshot-"));
  const task = {
    taskId: "task-1", taskNumber: 1, currentRunId: "run-1", runIds: ["run-1"],
    teamVersionId: "team-1", teamCoreDigest: "a".repeat(64), teamDigestVersion: 3
  };
  const project = { projectId: "project-1", workdir, taskRecords: [task] };
  const runDir = join(workdir, ".ogs", "runs", "run-1");
  await mkdir(join(runDir, "control"), { recursive: true });
  await writeFile(join(runDir, "run-owner.json"), JSON.stringify({
    version: 1, runKind: "project_task", projectId: project.projectId, taskId: task.taskId,
    taskNumber: task.taskNumber, attemptNumber: 1, teamVersionId: task.teamVersionId,
    teamCoreDigest: task.teamCoreDigest, teamDigestVersion: task.teamDigestVersion, runId: "run-1"
  }));
  await writeFile(join(runDir, "run-plan.json"), JSON.stringify({ runId: "run-1" }));
  await writeFile(join(runDir, "control", "state.json"), JSON.stringify({ runId: "run-1", status: "completed" }));
  await writeFile(join(runDir, "task.json"), JSON.stringify({ prompt: "task" }));
  return { workdir, project, runDir };
}

test("Project Run snapshots require a safe Run directory and matching owner before reads", async (t) => {
  await t.test("reads an owned snapshot", async () => {
    const value = await fixture();
    try {
      const snapshot = await createFileProjectRunStore().readSnapshot(value.project, "run-1");
      assert.equal(snapshot.plan.runId, "run-1");
      assert.equal(snapshot.state.status, "completed");
    } finally { await rm(value.workdir, { recursive: true, force: true }); }
  });

  await t.test("rejects a Run directory junction before reading snapshot files", async (t) => {
    const value = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "ogs-project-run-outside-"));
    try {
      await rm(value.runDir, { recursive: true, force: true });
      await symlink(outside, value.runDir, "junction");
      await assert.rejects(createFileProjectRunStore().readSnapshot(value.project, "run-1"), /symlinks or junctions/);
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return t.skip("directory links are unavailable on this host");
      throw error;
    } finally {
      await rm(value.workdir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  await t.test("rejects an owner from another Task", async () => {
    const value = await fixture();
    try {
      value.project.taskRecords[0] = { ...value.project.taskRecords[0], taskId: "task-other" };
      await assert.rejects(createFileProjectRunStore().readSnapshot(value.project, "run-1"), /does not belong/);
    } finally { await rm(value.workdir, { recursive: true, force: true }); }
  });

  for (const filename of ["task.json", "run-plan.json"]) {
    await t.test(`resume rejects linked ${filename}`, async (t) => {
      const value = await fixture();
      const outside = join(value.workdir, `outside-${filename}`);
      const target = join(value.runDir, filename);
      try {
        await writeFile(outside, JSON.stringify(filename === "task.json" ? { prompt: "outside" } : { projectId: "project-1" }));
        await rm(target);
        try { await symlink(outside, target, "file"); }
        catch (error) {
          if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code)) return t.skip("file links unavailable: " + error.code);
          throw error;
        }
        await assert.rejects(createFileProjectRunStore().validateResume(value.project, "run-1"), /symlinks or junctions/);
      } finally { await rm(value.workdir, { recursive: true, force: true }); }
    });
  }
});
