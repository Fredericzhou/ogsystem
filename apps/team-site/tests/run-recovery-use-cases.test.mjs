import assert from "node:assert/strict";
import test from "node:test";
import { createRunRecoveryUseCases } from "../application/run-recovery-use-cases.mjs";

test("Run recovery repairs Task projection after a terminal Run commit and is repeatable", async () => {
  const runStates = new Map([["team-1:run-1", {
    status: "running",
    startedAt: "2026-10-19T00:00:00.000Z"
  }]]);
  let metadata = {
    taskRecords: [{
      taskId: "task-1",
      status: "running",
      currentRunId: "run-1",
      runIds: ["run-1"],
      runProjectId: "team-1"
    }]
  };
  let failProjectionWrite = true;
  let projectionWrites = 0;
  const recoveryStore = {
    async listProjectIds() { return ["team-1", "project-1"]; },
    async listRunIds(projectId) { return projectId === "team-1" ? ["run-1"] : []; },
    async readRunState(projectId, runId) { return runStates.get(`${projectId}:${runId}`); },
    async updateRunState(projectId, runId, update) {
      const key = `${projectId}:${runId}`;
      const current = runStates.get(key);
      const next = update(current);
      runStates.set(key, next);
      return next;
    },
    async removeRunDirectory(projectId, runId) { runStates.delete(`${projectId}:${runId}`); },
    async readProjectMetadata(projectId) { return projectId === "project-1" ? metadata : undefined; },
    async writeProjectMetadata(_projectId, next) {
      projectionWrites += 1;
      if (failProjectionWrite) {
        failProjectionWrite = false;
        throw new Error("simulated Task projection write failure");
      }
      metadata = next;
    }
  };
  const recover = createRunRecoveryUseCases({
    recoveryStore,
    now: () => "2026-10-19T00:00:01.000Z"
  });

  await assert.rejects(recover.recoverOrphanedRuns(), /Task projection write failure/);
  assert.equal(runStates.get("team-1:run-1").status, "failed");
  assert.equal(metadata.taskRecords[0].status, "running");

  assert.deepEqual(await recover.recoverOrphanedRuns(), []);
  assert.equal(metadata.taskRecords[0].status, "failed");
  assert.equal(metadata.taskRecords[0].currentRunId, "run-1");
  assert.deepEqual(metadata.taskRecords[0].runIds, ["run-1"]);
  assert.match(metadata.taskRecords[0].lastError, /^RUNNER_RESTARTED:/);
  const committedMetadata = structuredClone(metadata);
  const committedRunState = structuredClone(runStates.get("team-1:run-1"));

  assert.deepEqual(await recover.recoverOrphanedRuns(), []);
  assert.deepEqual(metadata, committedMetadata);
  assert.deepEqual(runStates.get("team-1:run-1"), committedRunState);
  assert.equal(projectionWrites, 2);
});

test("startup recovery removes only an uncommitted, unstarted Task Run reservation", async () => {
  const runStates = new Map([
    ["team-1:orphan-run", {
      status: "planning",
      taskReservation: { kind: "task-attempt", collaborationProjectId: "project-1", taskId: "task-1", runId: "orphan-run", attemptKey: "request-1" },
      nodes: {}, attempts: [], reviews: []
    }],
    ["team-1:studio-run", { status: "running", nodes: { role: { status: "running" } }, attempts: [], reviews: [] }]
  ]);
  const metadata = new Map([
    ["team-1", { projectType: "team", taskRecords: [] }],
    ["project-1", { projectType: "collaboration", taskRecords: [{ taskId: "task-1", status: "queued", currentRunId: null, runIds: [], attemptRequests: {} }] }]
  ]);
  const removed = [];
  const recovery = createRunRecoveryUseCases({
    recoveryStore: {
      async listProjectIds() { return [...metadata.keys()]; },
      async listRunIds(projectId) { return projectId === "team-1" ? ["orphan-run", "studio-run"] : []; },
      async readRunState(projectId, runId) { return runStates.get(`${projectId}:${runId}`); },
      async updateRunState(projectId, runId, update) {
        const key = `${projectId}:${runId}`;
        const next = update(runStates.get(key));
        runStates.set(key, next);
        return next;
      },
      async removeRunDirectory(projectId, runId) { removed.push(`${projectId}:${runId}`); runStates.delete(`${projectId}:${runId}`); },
      async readProjectMetadata(projectId) { return metadata.get(projectId); },
      async writeProjectMetadata(projectId, value) { metadata.set(projectId, value); }
    }
  });

  const first = await recovery.recoverOrphanedRuns();
  assert.deepEqual(removed, ["team-1:orphan-run"]);
  assert.deepEqual(first.find((item) => item.runId === "orphan-run"), {
    projectId: "team-1", runId: "orphan-run", action: "removed-uncommitted-task-reservation"
  });
  assert.equal(runStates.has("team-1:studio-run"), true);
  assert.equal(runStates.get("team-1:studio-run").status, "failed");
  assert.deepEqual(await recovery.recoverOrphanedRuns(), []);
  assert.deepEqual(removed, ["team-1:orphan-run"]);
  assert.equal(metadata.get("project-1").taskRecords[0].currentRunId, null);
  assert.deepEqual(metadata.get("project-1").taskRecords[0].runIds, []);
});

test("startup recovery preserves an unreferenced Task Run that has execution evidence", async () => {
  const state = {
    status: "running",
    taskReservation: { kind: "task-attempt", collaborationProjectId: "project-1", taskId: "task-1", runId: "evidence-run", attemptKey: "request-1" },
    nodes: { role: { status: "completed" } }, attempts: [{ roleId: "role" }], reviews: []
  };
  const runStates = new Map([["team-1:evidence-run", state]]);
  const recovery = createRunRecoveryUseCases({
    recoveryStore: {
      async listProjectIds() { return ["team-1", "project-1"]; },
      async listRunIds(projectId) { return projectId === "team-1" ? ["evidence-run"] : []; },
      async readRunState(projectId, runId) { return runStates.get(`${projectId}:${runId}`); },
      async updateRunState(projectId, runId, update) {
        const key = `${projectId}:${runId}`;
        const next = update(runStates.get(key));
        runStates.set(key, next);
        return next;
      },
      async removeRunDirectory() { assert.fail("Run with execution evidence must not be deleted."); },
      async readProjectMetadata(projectId) { return projectId === "team-1" ? { taskRecords: [] } : { projectType: "collaboration", taskRecords: [] }; },
      async writeProjectMetadata() {}
    }
  });

  await recovery.recoverOrphanedRuns();
  assert.equal(runStates.get("team-1:evidence-run").status, "failed");
  assert.match(runStates.get("team-1:evidence-run").error, /^RUNNER_RESTARTED:/);
});

test("startup recovery fails closed when collaboration Task references cannot be read", async () => {
  let removed = false;
  const recovery = createRunRecoveryUseCases({
    recoveryStore: {
      async listProjectIds() { return ["team-1", "project-1"]; },
      async listRunIds() { return ["orphan-run"]; },
      async readRunState() { return { status: "planning", taskReservation: { kind: "task-attempt" }, nodes: {}, attempts: [], reviews: [] }; },
      async updateRunState() {},
      async removeRunDirectory() { removed = true; },
      async readProjectMetadata(projectId) {
        if (projectId === "project-1") throw new Error("metadata unreadable");
        return { taskRecords: [] };
      },
      async writeProjectMetadata() {}
    }
  });

  await assert.rejects(recovery.recoverOrphanedRuns(), /metadata unreadable/);
  assert.equal(removed, false);
});
