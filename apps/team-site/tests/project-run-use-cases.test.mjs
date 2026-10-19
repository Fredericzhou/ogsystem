import assert from "node:assert/strict";
import test from "node:test";
import { createProjectRunUseCases } from "../application/project-run-use-cases.mjs";

function fixture({ execute, acquireRunLock, readSnapshot } = {}) {
  const project = { projectId: "project-1", projectType: "collaboration", teamVersionId: "team-version-1", workdir: "/projects/project-1", projectStatus: "confirmed", projectDigest: "digest", confirmedAt: "confirmed", materials: { materials: [] }, taskRecords: [] };
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
    runStore,
    readiness: { async requireCurrentConfirmation() {}, async inspect() { return { canDryRun: true, blockers: [] }; } },
    identifiers: {
      createRunId: () => "run-1",
      fingerprint: (value) => JSON.stringify(value)
    },
    evaluateResult: ({ state }) => ({ status: state.status }),
    now: () => "2026-10-19T00:00:00.000Z"
  });
  return { useCases, ledger, calls };
}

test("Project Run reserves before execute and replays the completed idempotent request", async () => {
  const { useCases, ledger, calls } = fixture();
  const response = await useCases.startProjectRun("project-1", { prompt: "Run this", idempotencyKey: "request-1" });
  assert.equal(response.runId, "run-1");
  assert.equal(response.collaborationProjectId, null);
  assert.equal(response.taskId, null);
  assert.equal(response.teamVersionId, "team-version-1");
  assert.equal(response.runtimeProjectId, "project-1");
  assert.equal(Object.hasOwn(response, "projectId"), false);
  assert.equal(Object.hasOwn(response.state, "projectId"), false);
  assert.equal(Object.hasOwn(response.runPlan, "projectId"), false);
  assert.deepEqual(calls.slice(0, 3), [["project-lock", "run-snapshot"], ["ledger", "running"], ["run-lock", "run-1"]]);
  assert.equal(ledger["request-1"].status, "completed");
  const replay = await useCases.startProjectRun("project-1", { prompt: "Run this", idempotencyKey: "request-1" });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(calls.filter(([kind]) => kind === "execute").length, 1);
});

test("Project Run lock reservation failure is persisted as failed and never executes", async () => {
  const { useCases, ledger, calls } = fixture({
    acquireRunLock: async () => { throw new Error("RUN_LOCK_BUSY: already running."); }
  });
  await assert.rejects(
    () => useCases.startProjectRun("project-1", { prompt: "Run this", idempotencyKey: "request-1" }),
    /RUN_LOCK_BUSY/
  );
  assert.equal(ledger["request-1"].status, "failed");
  assert.match(ledger["request-1"].error, /RUN_LOCK_BUSY/);
  assert.equal(calls.some(([kind]) => kind === "execute"), false);
});

test("Project Run resumes the same reserved run ID when ledger exists without Run files", async () => {
  let snapshotReads = 0;
  const { useCases, ledger, calls } = fixture({
    readSnapshot: async (runId) => runId === "reserved-run" && snapshotReads++ === 0
      ? { plan: undefined, state: undefined }
      : { plan: { projectId: "project-1", runId }, state: { projectId: "project-1", status: "completed", runId } }
  });
  ledger["request-1"] = {
    status: "running",
    runId: "reserved-run",
    mode: "dry-run",
    requestFingerprint: JSON.stringify({ collaborationProjectId: null, taskId: null, runtimeProjectId: "project-1", teamVersionId: "team-version-1", prompt: "Run this", mode: "dry-run", materialInputsOverride: null, resumeRunId: null })
  };
  const response = await useCases.startProjectRun("project-1", { prompt: "Run this", idempotencyKey: "request-1" });
  assert.equal(response.runId, "reserved-run");
  assert.ok(calls.some(([kind, runId]) => kind === "execute" && runId === "reserved-run"));
});

test("Project Run plan or Runtime failure records a failed request and releases both locks", async () => {
  const { useCases, ledger, calls } = fixture({ execute: async () => { throw new Error("RUN_PLAN_CREATE_FAILED: invalid graph."); } });
  await assert.rejects(
    () => useCases.startProjectRun("project-1", { prompt: "Run this", idempotencyKey: "request-1" }),
    /RUN_PLAN_CREATE_FAILED/
  );
  assert.equal(ledger["request-1"].status, "failed");
  assert.ok(calls.some(([kind, name]) => kind === "project-unlock" && name === "run-snapshot"));
  assert.ok(calls.some(([kind]) => kind === "run-unlock"));
});
