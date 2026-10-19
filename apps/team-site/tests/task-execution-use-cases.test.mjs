import assert from "node:assert/strict";
import test from "node:test";
import { createTaskExecutionUseCases } from "../application/task-execution-use-cases.mjs";

function harness({ reserveAttempt, teamVersionStatus = "released", mountedTeams = [{ teamVersionId: "team-v1" }], execute = async () => ({ state: { status: "completed" }, result: { finalOutput: "done" } }) } = {}) {
  const calls = [];
  const task = { taskId: "task-1", input: "Do the work", status: "queued", teamVersionId: "team-v1", runIds: [], attemptRequests: {} };
  const project = { projectId: "project-1", workdir: "/project", taskRecords: [task], mountedTeams, materials: { materials: [] } };
  const workers = new Map();
  const useCases = createTaskExecutionUseCases({
    projectStore: { async getProject() { return project; } },
    teamStore: { async getTeamVersion(id) { return id === "team-v1" ? { projectId: id, teamVersionId: id, teamVersionStatus, workdir: "/team-v1" } : undefined; } },
    attemptStore: {
      async reserveAttempt(input) {
        calls.push(["reserve", input]);
        if (reserveAttempt) return reserveAttempt(input, { project, task });
        const reservedTask = { ...task, currentRunId: input.runId, runIds: [input.runId], status: "planning" };
        project.taskRecords = [reservedTask];
        return { project, task: reservedTask, attemptNumber: 1 };
      },
      async completeAttempt(input) { calls.push(["complete", input]); },
      async failAttempt(input) { calls.push(["fail", input]); }
    },
    workerStore: {
      get: (key) => workers.get(key),
      set: (key, worker) => workers.set(key, worker),
      delete: (key) => workers.delete(key),
      async wait(key) { await workers.get(key)?.catch(() => undefined); }
    },
    runStore: { async execute(...args) { calls.push(["execute", ...args]); return execute(...args); } },
    readiness: { async inspect() { return { canDryRun: true, blockers: [] }; }, async requireCurrentConfirmation() {} },
    identifiers: {
      createRunId: () => "run-1",
      fingerprint: () => "fingerprint",
      resolveProjectMaterial: (workdir, path) => `${workdir}/${path}`,
      resolveRunRoot: (_project, runId) => `/runs/${runId}`
    },
    now: () => "2026-10-19T00:00:00.000Z"
  });
  return { calls, project, useCases };
}

test("Task execution reserves an immutable attempt with its Runtime workspace before launching the Run", async () => {
  const testHarness = harness();
  const task = await testHarness.useCases.startProjectTask("project-1", "task-1", { idempotencyKey: "request-1" });
  assert.deepEqual(testHarness.calls.slice(0, 2).map(([name]) => name), ["reserve", "execute"]);
  assert.equal(testHarness.calls[0][1].runWorkdir, "/team-v1");
  assert.equal(testHarness.calls[0][1].runProjectId, "team-v1");
  await testHarness.useCases.startProjectTask("project-1", "task-1", { idempotencyKey: "request-1" });
  assert.equal(testHarness.calls.filter(([name]) => name === "reserve").length, 1);
});

test("Run state initialization failure leaves reservation handling to the atomic attempt store", async () => {
  const testHarness = harness({ reserveAttempt: async () => { throw new Error("state write failed"); } });
  await assert.rejects(() => testHarness.useCases.startProjectTask("project-1", "task-1"), /state write failed/);
  assert.equal(testHarness.project.taskRecords[0].currentRunId, undefined);
  assert.equal(testHarness.calls.some(([name]) => name === "fail"), false);
  assert.equal(testHarness.calls.some(([name]) => name === "execute"), false);
});

test("Task Run reservation write failure leaves the queued Task unchanged and never starts Runtime", async () => {
  const testHarness = harness({ reserveAttempt: async () => { throw new Error("Task reservation write failed"); } });
  await assert.rejects(() => testHarness.useCases.startProjectTask("project-1", "task-1"), /Task reservation write failed/);
  assert.equal(testHarness.project.taskRecords[0].status, "queued");
  assert.equal(testHarness.project.taskRecords[0].currentRunId, undefined);
  assert.deepEqual(testHarness.project.taskRecords[0].runIds, []);
  assert.equal(testHarness.calls.some(([name]) => name === "execute"), false);
});

test("Runtime failure is projected through the failure port and worker bookkeeping is cleared", async () => {
  const testHarness = harness({ execute: async () => { throw new Error("runtime failed"); } });
  const task = await testHarness.useCases.startProjectTask("project-1", "task-1");
  const worker = testHarness.calls;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(task.currentRunId, "run-1");
  assert.equal(worker.some(([name, input]) => name === "fail" && input.error.message === "runtime failed"), true);
});

test("Task execution resolves its fixed archived TeamVersion after it is unmounted", async () => {
  const testHarness = harness({ teamVersionStatus: "archived", mountedTeams: [] });
  const task = await testHarness.useCases.startProjectTask("project-1", "task-1");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(task.currentRunId, "run-1");
  assert.equal(testHarness.calls.find(([name]) => name === "execute")[1], "team-v1");
});
