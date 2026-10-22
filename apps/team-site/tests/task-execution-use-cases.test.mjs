import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { createTaskExecutionUseCases } from "../application/task-execution-use-cases.mjs";
import { createFileTaskExecutionStore } from "../infrastructure/file-task-execution-store.mjs";

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

test("Task execution reserves an immutable attempt under its Collaboration Project before launching the Run", async () => {
  const testHarness = harness();
  const task = await testHarness.useCases.startProjectTask("project-1", "task-1", { idempotencyKey: "request-1" });
  assert.deepEqual(testHarness.calls.slice(0, 2).map(([name]) => name), ["reserve", "execute"]);
  assert.equal(testHarness.calls[0][1].teamVersionId, "team-v1");
  assert.deepEqual(testHarness.calls[1][2], {
    prompt: "Do the work",
    mode: "dry-run",
    requestedRunId: "run-1",
    runKind: "project_task",
    taskId: "task-1",
    taskNumber: undefined,
    attemptNumber: 1,
    teamVersionId: "team-v1",
    teamCoreDigest: undefined,
    teamDigestVersion: undefined,
    readinessChecked: false,
    idempotencyKey: "task:project-1:task-1:request-1",
    materialInputsOverride: [],
    materialSourceRoot: "/project",
    materialSnapshotPolicy: { kind: "project_current" },
    recordTask: false
  });
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

test("Task execution launches the archived fixed TeamVersion using Project-owned evidence after it is unmounted", async () => {
  const testHarness = harness({ teamVersionStatus: "archived", mountedTeams: [] });
  const task = await testHarness.useCases.startProjectTask("project-1", "task-1");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(task.currentRunId, "run-1");
  const [, projectId, options] = testHarness.calls.find(([name]) => name === "execute");
  assert.equal(projectId, "project-1");
  assert.equal(options.teamVersionId, "team-v1");
  assert.equal(Object.hasOwn(options, "workdir"), false);
  assert.equal(Object.hasOwn(options, "runEvidenceRoot"), false);
});

test("Task Run reservation rejects linked Project evidence roots before committing the Task", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "ogs-task-reservation-link-"));
  const projectRoot = resolve(root, "project-1");
  const outside = resolve(root, "outside");
  const task = { taskId: "task-1", status: "queued", teamVersionId: "team-v1", runIds: [] };
  const project = { projectId: "project-1", projectType: "collaboration", workdir: projectRoot, taskRecords: [task] };
  try {
    await mkdir(projectRoot, { recursive: true });
    await mkdir(outside, { recursive: true });
    try {
      await symlink(outside, resolve(projectRoot, ".ogs"), "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code)) return t.skip(`directory links unavailable: ${error.code}`);
      throw error;
    }
    const store = createFileTaskExecutionStore({
      projectStore: {
        async getProject() { return project; },
        async withProjectWriteLock(_projectId, _operation, action) { return action(); },
        async saveTaskRecord() { assert.fail("Task must not be committed when evidence path is linked."); }
      }
    });
    await assert.rejects(store.reserveAttempt({
      projectId: "project-1", taskId: "task-1", attemptKey: "request-1", attemptFingerprint: "fingerprint",
      runId: "run-1", mode: "dry-run", startedAt: "2026-10-19T00:00:00.000Z", teamVersionId: "team-v1"
    }), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
    assert.equal(task.currentRunId, undefined);
    assert.deepEqual(task.runIds, []);
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retry reservation clears review state owned by the previous failed Run", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "ogs-task-retry-review-state-"));
  const projectRoot = resolve(root, "project-1");
  const task = {
    taskId: "task-1", taskNumber: 1, status: "failed", currentRunId: "run-old", runIds: ["run-old"],
    teamVersionId: "team-v1", review: { decision: "rework" },
    reviewTransition: { runId: "run-old", reviewId: "review-1", decision: "rework" }
  };
  const project = { projectId: "project-1", projectType: "collaboration", workdir: projectRoot, taskRecords: [task] };
  try {
    await mkdir(projectRoot, { recursive: true });
    const store = createFileTaskExecutionStore({
      projectStore: {
        async getProject() { return project; },
        async withProjectWriteLock(_projectId, _operation, action) { return action(); },
        async saveTaskRecord(_project, taskId, update) {
          Object.assign(task, update);
          return task;
        }
      }
    });
    const result = await store.reserveAttempt({
      projectId: "project-1", taskId: "task-1", retrySourceRunId: "run-old", materialSnapshotPolicy: { kind: "source_run_snapshot" },
      attemptKey: "retry-1", attemptFingerprint: "retry-fingerprint", runId: "run-new", mode: "sandbox",
      startedAt: "2026-10-21T00:00:00.000Z", teamVersionId: "team-v1"
    });
    assert.equal(result.task.currentRunId, "run-new");
    assert.equal(result.task.review, null);
    assert.equal(result.task.reviewTransition, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
