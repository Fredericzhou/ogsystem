import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTeamIrTaskAttemptStore } from "../infrastructure/v2-aware-task-attempt-store.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ogs-recent-run-safe-"));
  const projectId = "project-1";
  const task = { taskId: "task-1", taskNumber: 1, currentRunId: "run-1", runIds: ["run-1"], teamVersionId: "team-1", teamCoreDigest: "a".repeat(64) };
  const projectRoot = join(root, projectId);
  const runDir = join(projectRoot, ".ogs", "runs", "run-1");
  const stateDir = join(runDir, "team-ir-v2-state");
  await mkdir(stateDir, { recursive: true });
  await mkdir(join(projectRoot, ".site"), { recursive: true });
  await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [task] }));
  await writeFile(join(runDir, "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId, taskId: task.taskId, taskNumber: task.taskNumber, attemptNumber: 1, teamVersionId: task.teamVersionId, teamCoreDigest: task.teamCoreDigest, runId: "run-1" }));
  await writeFile(join(stateDir, "run-1.json"), JSON.stringify({
    runId: "run-1", status: "completed", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:01Z",
    owner: { attemptNumber: 1 }, result: { summary: "done" }, events: []
  }));
  return { root, projectRoot, runDir, stateDir };
}

test("Team IR attempt reads reject linked Project metadata, Run owner, and v2 checkpoint", async (t) => {
  for (const relativePath of [
    [".site", "project.json"],
    [".ogs", "runs", "run-1", "run-owner.json"],
    [".ogs", "runs", "run-1", "team-ir-v2-state", "run-1.json"]
  ]) {
    await t.test(relativePath.join("/"), async (t) => {
      const value = await fixture();
      const outside = join(value.root, "outside.json");
      const target = join(value.projectRoot, ...relativePath);
      try {
        await writeFile(outside, JSON.stringify({ status: "outside" }));
        await rm(target);
        try { await symlink(outside, target, "file"); }
        catch (error) {
          if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code)) return t.skip("filesystem links unavailable: " + error.code);
          throw error;
        }
        await assert.rejects(createTeamIrTaskAttemptStore({ projectsRoot: value.root }).readRunArtifacts("project-1", "task-1", "run-1"), /symlinks or junctions/);
      } finally { await rm(value.root, { recursive: true, force: true }); }
    });
  }
});
