import assert from "node:assert/strict";
import test from "node:test";
import { createProjectRunUseCases } from "../application/project-run-use-cases.mjs";

function setup({ status = "completed", runIds = ["run-1"] } = {}) {
  const calls = [];
  const project = {
    projectId: "project-1",
    projectType: "collaboration",
    workspaceId: "workspace-1",
    workspaceBackend: "git-lfs",
    taskRecords: [{ taskId: "task-1", runIds, teamVersionId: "team-1" }]
  };
  const runStore = Object.fromEntries([
    "validateResume", "readLedger", "writeLedger", "acquireProjectWriteLock", "acquireRunLock",
    "writeResumeControl", "materialInputs", "execute", "rebuildIndex", "recordTask"
  ].map((name) => [name, async () => undefined]));
  runStore.acquireProjectWriteLock = async () => ({ async release() {} });
  runStore.readSnapshot = async () => ({ state: { status } });
  runStore.cleanupWorkspace = async (_project, args) => { calls.push(args); return { removedWorktrees: [], removedBranches: [] }; };
  const useCases = createProjectRunUseCases({
    projectStore: { async getProject() { return project; } },
    teamStore: { async getTeamVersion() { return {}; } },
    runStore,
    readiness: { async requireCurrentConfirmation() {}, async inspect() {} },
    identifiers: { createRunId() {}, fingerprint() {} },
    evaluateResult() { return {}; }
  });
  return { calls, useCases };
}

test("Project Run Workspace cleanup requires an owned terminal Run and matching Workspace", async () => {
  const pending = setup({ status: "waiting_review" });
  await assert.rejects(
    () => pending.useCases.cleanupProjectRunWorkspace("project-1", "task-1", "run-1", { workspaceId: "workspace-1", expectedCanonicalHead: "a".repeat(40) }),
    /WORKSPACE_CLEANUP_RUN_NOT_TERMINAL/
  );
  assert.deepEqual(pending.calls, []);

  const wrongWorkspace = setup();
  await assert.rejects(
    () => wrongWorkspace.useCases.cleanupProjectRunWorkspace("project-1", "task-1", "run-1", { workspaceId: "workspace-other", expectedCanonicalHead: "a".repeat(40) }),
    /WORKSPACE_CLEANUP_WORKSPACE_MISMATCH/
  );
  assert.deepEqual(wrongWorkspace.calls, []);

  const wrongRun = setup({ runIds: ["another-run"] });
  await assert.rejects(
    () => wrongRun.useCases.cleanupProjectRunWorkspace("project-1", "task-1", "run-1", { workspaceId: "workspace-1", expectedCanonicalHead: "a".repeat(40) }),
    /RUN_NOT_FOUND/
  );
  assert.deepEqual(wrongRun.calls, []);
});

test("Project Run Workspace cleanup forwards terminal identity and expected head", async () => {
  const { calls, useCases } = setup({ status: "cancelled" });
  const result = await useCases.cleanupProjectRunWorkspace("project-1", "task-1", "run-1", {
    workspaceId: "workspace-1",
    expectedCanonicalHead: "b".repeat(40)
  });
  assert.deepEqual(calls, [{
    runId: "run-1",
    terminalStatus: "terminated",
    workspaceId: "workspace-1",
    expectedCanonicalHead: "b".repeat(40)
  }]);
  assert.deepEqual(result, {
    projectId: "project-1",
    taskId: "task-1",
    runId: "run-1",
    workspaceId: "workspace-1",
    removedWorktrees: [],
    removedBranches: []
  });
});
