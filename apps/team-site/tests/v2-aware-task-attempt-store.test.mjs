import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTeamIrTaskAttemptStore } from "../infrastructure/v2-aware-task-attempt-store.mjs";

test("Task attempt query uses the persisted Team IR v2 terminal checkpoint", async (t) => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "v2-aware-task-attempt-"));
  t.after(() => rm(projectsRoot, { recursive: true, force: true }));
  const projectId = "project-v2";
  const taskId = "task-v2";
  const runId = "run-v2";
  const projectRoot = join(projectsRoot, projectId);
  const runRoot = join(projectRoot, ".ogs", "runs", runId);
  const stateDirectory = join(runRoot, "team-ir-v2-state");
  await mkdir(stateDirectory, { recursive: true });
  await mkdir(join(projectRoot, ".site"), { recursive: true });
  await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify({
    projectType: "collaboration",
    taskRecords: [{ taskId, taskNumber: 1, currentRunId: runId, runIds: [runId], teamVersionId: "team-v2" }]
  }));
  await writeFile(join(runRoot, "run-owner.json"), JSON.stringify({
    version: 1, runKind: "project_task", projectId, taskId, taskNumber: 1, runId,
    attemptNumber: 1, teamVersionId: "team-v2"
  }));
  await writeFile(join(stateDirectory, `${runId}.json`), JSON.stringify({
    runId, status: "completed", createdAt: 1000, updatedAt: 2000,
    result: { summary: "UAT completed" }, resultWritten: true, events: []
  }));

  const store = createTeamIrTaskAttemptStore({ projectsRoot });
  const attempt = await store.readAttempt(projectId, taskId, runId);
  assert.equal(attempt.state.status, "completed");
  assert.equal(attempt.outputSummary, "UAT completed");
  assert.equal(attempt.plan.engine, "team-ir-v2");
  assert.deepEqual(await store.readRunArtifacts(projectId, taskId, runId), attempt);
});

test("Task attempt query rejects a legacy Run plan without a fallback reader", async (t) => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "v2-only-task-attempt-"));
  t.after(() => rm(projectsRoot, { recursive: true, force: true }));
  const projectId = "project-v1";
  const taskId = "task-v1";
  const runId = "run-v1";
  const projectRoot = join(projectsRoot, projectId);
  const runRoot = join(projectRoot, ".ogs", "runs", runId);
  await mkdir(runRoot, { recursive: true });
  await mkdir(join(projectRoot, ".site"), { recursive: true });
  await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify({
    projectType: "collaboration",
    taskRecords: [{ taskId, taskNumber: 1, currentRunId: runId, runIds: [runId] }]
  }));
  await writeFile(join(runRoot, "run-owner.json"), JSON.stringify({
    version: 1, runKind: "project_task", projectId, taskId, taskNumber: 1, runId,
    attemptNumber: 1
  }));
  await writeFile(join(runRoot, "run-plan.json"), JSON.stringify({ version: 1, source: "legacy-mermaid" }));

  const store = createTeamIrTaskAttemptStore({ projectsRoot });
  await assert.rejects(store.readAttempt(projectId, taskId, runId), /TEAM_IR_V2_REQUIRED/);
});
