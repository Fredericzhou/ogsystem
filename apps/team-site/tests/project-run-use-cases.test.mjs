import assert from "node:assert/strict";
import test from "node:test";
import { createProjectRunUseCases } from "../application/project-run-use-cases.mjs";

function fixture({ execute, acquireRunLock, readSnapshot } = {}) {
  const project = {
    projectId: "project-1", projectType: "collaboration", teamVersionId: "team-version-1", workdir: "/projects/project-1",
    projectStatus: "confirmed", projectDigest: "digest", confirmedAt: "confirmed", materials: { materials: [] },
    taskRecords: [{ taskId: "task-1", taskNumber: 1, teamVersionId: "team-version-1", currentRunId: "run-1", runIds: ["run-1"] }]
  };
  const ledger = {};
  const calls = [];
  const runStore = {
    async validateResume() { return undefined; },
    async readLedger() { return ledger; },
    async writeLedger(_project, next) { Object.assign(ledger, next); calls.push(["ledger", next["request-1"]?.status]); },
    async acquireProjectWriteLock(_project, operation) { calls.push(["project-lock", operation]); return { async release() { calls.push(["project-unlock", operation]); } }; },
    async acquireRunLock(_project, runId) { calls.push(["run-lock", runId]); return acquireRunLock ? acquireRunLock(runId) : { async release() { calls.push(["run-unlock", runId]); } }; },
    async writeResumeControl() {},
    materialInputs() { return []; },
    async execute(_project, options) {
      calls.push(["execute", options.runId]);
      await options.onPrepared();
      return execute ? execute(options) : { finalOutput: "result" };
    },
    async rebuildIndex() { calls.push(["rebuild"]); },
    async readSnapshot(_project, runId, options) {
      if (readSnapshot) return readSnapshot(runId, options);
      return { plan: { projectId: "project-1", runId }, state: { projectId: "project-1", status: "completed", runId } };
    },
    async recordTask() { calls.push(["task-record"]); }
  };
  const useCases = createProjectRunUseCases({
    projectStore: { async getProject() { return project; } },
    teamStore: { async getTeamVersion() { return { projectId: "team-version-1", teamVersionId: "team-version-1", teamCoreDigest: "team-digest", workdir: "/teams/team-version-1", teamVersionStatus: "released" }; } },
    runStore,
    readiness: { async requireCurrentConfirmation() {}, async inspect() { return { canDryRun: true, blockers: [] }; } },
    identifiers: {
      createRunId: () => "run-1",
      fingerprint: (value) => JSON.stringify(value)
    },
    evaluateResult: ({ state }) => ({ status: state.status }),
    now: () => "2026-10-19T00:00:00.000Z"
  });
  const startOwnedRun = (options = {}) => {
    const task = project.taskRecords[0];
    const runId = options.requestedRunId || task.currentRunId;
    return useCases.startProjectRun("project-1", {
      runKind: "project_task", taskId: task.taskId, taskNumber: task.taskNumber,
      attemptNumber: task.runIds.indexOf(runId) + 1, teamVersionId: task.teamVersionId,
      requestedRunId: runId, ...options
    });
  };
  return { useCases, startOwnedRun, ledger, calls, project };
}

test("Project Run reserves before execute and replays the completed idempotent request", async () => {
  const { startOwnedRun, ledger, calls } = fixture();
  const response = await startOwnedRun({ prompt: "Run this", idempotencyKey: "request-1" });
  assert.equal(response.runId, "run-1");
  assert.equal(response.taskId, "task-1");
  assert.equal(response.teamVersionId, "team-version-1");
  assert.equal(Object.hasOwn(response, "projectId"), false);
  assert.equal(Object.hasOwn(response.state, "projectId"), false);
  assert.equal(Object.hasOwn(response.runPlan, "projectId"), false);
  assert.deepEqual(calls.slice(0, 3), [["project-lock", "run-snapshot"], ["ledger", "running"], ["run-lock", "run-1"]]);
  assert.equal(ledger["request-1"].status, "completed");
  const replay = await startOwnedRun({ prompt: "Run this", idempotencyKey: "request-1" });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(calls.filter(([kind]) => kind === "execute").length, 1);
});

test("Project Run lock reservation failure is persisted as failed and never executes", async () => {
  const { startOwnedRun, ledger, calls } = fixture({
    acquireRunLock: async () => { throw new Error("RUN_LOCK_BUSY: already running."); }
  });
  await assert.rejects(
    () => startOwnedRun({ prompt: "Run this", idempotencyKey: "request-1" }),
    /RUN_LOCK_BUSY/
  );
  assert.equal(ledger["request-1"].status, "failed");
  assert.match(ledger["request-1"].error, /RUN_LOCK_BUSY/);
  assert.equal(calls.some(([kind]) => kind === "execute"), false);
});

test("Project Run resumes the same reserved run ID when ledger exists without Run files", async () => {
  let snapshotReads = 0;
  const { startOwnedRun, ledger, calls, project } = fixture({
    readSnapshot: async (runId) => runId === "reserved-run" && snapshotReads++ === 0
      ? { plan: undefined, state: undefined }
      : { plan: { projectId: "project-1", runId }, state: { projectId: "project-1", status: "completed", runId } }
  });
  project.taskRecords[0].currentRunId = "reserved-run";
  project.taskRecords[0].runIds.push("reserved-run");
  ledger["request-1"] = {
    status: "running",
    runId: "reserved-run",
    mode: "dry-run",
    requestFingerprint: JSON.stringify({ collaborationProjectId: "project-1", taskId: "task-1", runId: "reserved-run", teamVersionId: "team-version-1", prompt: "Run this", mode: "dry-run", materialInputsOverride: null, resumeRunId: null })
  };
  const response = await startOwnedRun({ prompt: "Run this", idempotencyKey: "request-1" });
  assert.equal(response.runId, "reserved-run");
  assert.ok(calls.some(([kind, runId]) => kind === "execute" && runId === "reserved-run"));
});

test("Project Run plan or Runtime failure records a failed request and releases both locks", async () => {
  const { startOwnedRun, ledger, calls } = fixture({ execute: async () => { throw new Error("RUN_PLAN_CREATE_FAILED: invalid graph."); } });
  await assert.rejects(
    () => startOwnedRun({ prompt: "Run this", idempotencyKey: "request-1" }),
    /RUN_PLAN_CREATE_FAILED/
  );
  assert.equal(ledger["request-1"].status, "failed");
  assert.ok(calls.some(([kind, name]) => kind === "project-unlock" && name === "run-snapshot"));
  assert.ok(calls.some(([kind]) => kind === "run-unlock"));
});

test("Project Run rejects starts without a persisted Task owner", async () => {
  const { useCases, calls } = fixture();
  for (const options of [
    { prompt: "Legacy unowned run" },
    { prompt: "Legacy unowned retry", retrySourceRunId: "run-0" }
  ]) {
    await assert.rejects(() => useCases.startProjectRun("project-1", options), /PROJECT_RUN_OWNER_INVALID/);
  }
  assert.equal(calls.some(([kind]) => kind === "project-lock" || kind === "execute"), false);
});

test("Project Run rejects a mismatched Task, Run, version, or attempt owner before locking", async () => {
  for (const options of [
    { taskId: "task-other" },
    { requestedRunId: "run-other" },
    { teamVersionId: "team-other" },
    { attemptNumber: 2 }
  ]) {
    const { useCases, calls } = fixture();
    await assert.rejects(() => useCases.startProjectRun("project-1", {
      prompt: "Run this", runKind: "project_task", taskId: "task-1", taskNumber: 1,
      attemptNumber: 1, teamVersionId: "team-version-1", requestedRunId: "run-1", ...options
    }), /PROJECT_RUN_OWNER_INVALID/);
    assert.equal(calls.some(([kind]) => kind === "project-lock" || kind === "execute"), false);
  }
});
