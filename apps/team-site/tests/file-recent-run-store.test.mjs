import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFileRecentRunStore } from "../infrastructure/file-recent-run-store.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ogs-recent-run-safe-"));
  const projectId = "project-1";
  const task = { taskId: "task-1", taskNumber: 1, currentRunId: "run-1", runIds: ["run-1"], teamVersionId: "team-1", teamCoreDigest: "a".repeat(64) };
  const projectRoot = join(root, projectId);
  const runDir = join(projectRoot, ".ogs", "runs", "run-1");
  await mkdir(join(runDir, "control"), { recursive: true });
  await mkdir(join(projectRoot, ".site"), { recursive: true });
  await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [task] }));
  await writeFile(join(runDir, "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId, taskId: task.taskId, taskNumber: task.taskNumber, attemptNumber: 1, teamVersionId: task.teamVersionId, teamCoreDigest: task.teamCoreDigest, runId: "run-1" }));
  await writeFile(join(runDir, "control", "state.json"), JSON.stringify({ status: "completed" }));
  await writeFile(join(runDir, "run-plan.json"), JSON.stringify({ runId: "run-1" }));
  await writeFile(join(runDir, "state.json"), JSON.stringify({ graphState: { finalOutput: "done" } }));
  return { root, projectRoot, runDir };
}

test("Recent Run reads reject linked Project metadata and Run artifacts", async (t) => {
  for (const relativePath of [
    [".site", "project.json"],
    [".ogs", "runs", "run-1", "control", "state.json"],
    [".ogs", "runs", "run-1", "run-plan.json"],
    [".ogs", "runs", "run-1", "state.json"]
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
        await assert.rejects(createFileRecentRunStore({ projectsRoot: value.root }).readRunArtifacts("project-1", "task-1", "run-1"), /symlinks or junctions/);
      } finally { await rm(value.root, { recursive: true, force: true }); }
    });
  }
});
