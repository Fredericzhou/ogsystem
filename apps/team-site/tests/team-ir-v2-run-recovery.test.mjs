import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileTeamRunStore } from "../../../dist/team-ir/index.js";
import { createRunRecoveryUseCases } from "../application/run-recovery-use-cases.mjs";
import { createFileRunRecoveryStore } from "../infrastructure/file-run-recovery-store.mjs";

async function makeRun(t, { status, invocations = {} }) {
  const projectsRoot = await mkdtemp(join(tmpdir(), "team-ir-v2-recovery-"));
  t.after(() => rm(projectsRoot, { recursive: true, force: true }));
  const projectId = "project-v2";
  const taskId = "task-v2";
  const runId = "run-v2";
  const teamVersionId = "team-v2";
  const projectRoot = join(projectsRoot, projectId);
  const runRoot = join(projectRoot, ".ogs", "runs", runId);
  const stateDirectory = join(runRoot, "team-ir-v2-state");
  await mkdir(stateDirectory, { recursive: true });
  await mkdir(join(projectRoot, ".site"), { recursive: true });
  await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify({
    projectType: "collaboration",
    taskRecords: [{ taskId, taskNumber: 1, currentRunId: runId, runIds: [runId], teamVersionId, status: "running" }]
  }));
  await writeFile(join(runRoot, "run-owner.json"), JSON.stringify({
    version: 1, runKind: "project_task", projectId, taskId, taskNumber: 1, runId, attemptNumber: 1, teamVersionId
  }));
  await new FileTeamRunStore(stateDirectory).create({
    runId, revision: 0, status, createdAt: 1000, updatedAt: 2000,
    projectId, events: [], invocations, result: status === "completed" ? { summary: "done" } : undefined,
    resultWritten: status === "completed"
  });
  const recoveryStore = createFileRunRecoveryStore({ projectsRoot });
  return { projectsRoot, projectId, taskId, runId, recoveryStore };
}

test("startup recovery preserves terminal Team IR v2 Run and synchronizes its Task", async (t) => {
  const h = await makeRun(t, { status: "completed" });
  const recovery = createRunRecoveryUseCases({ recoveryStore: h.recoveryStore, now: () => "2026-10-28T12:00:00.000Z" });
  assert.deepEqual(await recovery.recoverOrphanedRuns(), []);
  const metadata = await h.recoveryStore.readProjectMetadata(h.projectId);
  assert.equal(metadata.taskRecords[0].status, "completed");
  assert.equal(metadata.taskRecords[0].lastError, null);
});

test("startup recovery marks an interrupted Team IR v2 invocation outcome unknown and failed", async (t) => {
  const h = await makeRun(t, {
    status: "running",
    invocations: { "run-v2:handoff": { id: "run-v2:handoff", status: "running", attempt: 1 } }
  });
  const recovery = createRunRecoveryUseCases({ recoveryStore: h.recoveryStore, now: () => "2026-10-28T12:00:00.000Z" });
  assert.deepEqual(await recovery.recoverOrphanedRuns(), [{ projectId: h.projectId, runId: h.runId }]);
  const record = await new FileTeamRunStore(join(h.projectsRoot, h.projectId, ".ogs", "runs", h.runId, "team-ir-v2-state")).load(h.runId);
  assert.equal(record.status, "failed");
  assert.equal(record.invocations["run-v2:handoff"].outcomeUnknown, true);
  assert.ok(record.events.some((event) => event.type === "binding.outcome_unknown"));
  const recoveredState = await h.recoveryStore.readRunState(h.projectId, h.runId);
  assert.equal(recoveredState.status, "failed");
  assert.equal(recoveredState.error, "RUNNER_RESTARTED: the service restarted before this run reached a terminal state.");
  assert.equal((await h.recoveryStore.readProjectMetadata(h.projectId)).taskRecords[0].status, "failed");
});

test("startup recovery preserves paused and waiting Review Team IR v2 Runs", async (t) => {
  const h = await makeRun(t, { status: "waiting_human_review" });
  const recordPath = join(h.projectsRoot, h.projectId, ".ogs", "runs", h.runId, "team-ir-v2-state");
  await new FileTeamRunStore(recordPath).compareAndSet(h.runId, 0, {
    ...(await new FileTeamRunStore(recordPath).load(h.runId)), revision: 1, waitingReview: { reviewId: "review-v2" }
  });
  const recovery = createRunRecoveryUseCases({ recoveryStore: h.recoveryStore });
  assert.deepEqual(await recovery.recoverOrphanedRuns(), []);
  const metadata = await h.recoveryStore.readProjectMetadata(h.projectId);
  assert.equal(metadata.taskRecords[0].status, "waiting_review");
  assert.equal((await new FileTeamRunStore(recordPath).load(h.runId)).status, "waiting_human_review");
});
