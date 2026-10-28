import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { createTaskExecutionUseCases } from "../application/task-execution-use-cases.mjs";
import { createFileTaskExecutionStore } from "../infrastructure/file-task-execution-store.mjs";
import { createFileTeamIrStore } from "../infrastructure/file-team-ir-store.mjs";
import { createRuntimeTeamIrProjectRunExecutor } from "../infrastructure/runtime-team-ir-project-run-executor.mjs";

function harness({ reserveAttempt, teamVersionStatus = "released", team: teamInfo = {}, teamIrRunStore, mountedTeams = [{ teamVersionId: "team-v1" }], execute = async () => ({ state: { status: "completed" }, result: { finalOutputsByRoleId: { writer: [{ content: "done" }] }, finalOutputRoleOrder: ["writer"] } }) } = {}) {
  const calls = [];
  const semanticDigest = "a".repeat(64);
  const compiledPlanDigest = "b".repeat(64);
  const task = { taskId: "task-1", input: "Do the work", status: "queued", teamVersionId: "team-v1", teamIrSemanticDigest: semanticDigest, compiledPlanDigest, runIds: [], attemptRequests: {} };
  const project = { projectId: "project-1", workdir: "/project", taskRecords: [task], mountedTeams, materials: { materials: [] } };
  const workers = new Map();
  const team = { teamIrSemanticDigest: semanticDigest, compiledPlanDigest, teamCoreDigest: "c".repeat(64), teamDigestVersion: 3, ...teamInfo };
  const v2RunStore = teamIrRunStore === undefined ? {
    async execute(project, options) {
      calls.push(["execute-v2", project, options]);
      return execute(project.projectId, options);
    }
  } : teamIrRunStore;
  const useCases = createTaskExecutionUseCases({
    projectStore: { async getProject() { return project; } },
    teamStore: { async getTeamVersion(id) { return id === "team-v1" ? { projectId: id, teamVersionId: id, teamVersionStatus, workdir: "/team-v1", ...team } : undefined; } },
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
    runStore: { async execute(...args) { calls.push(["legacy-execute", ...args]); return execute(...args); } },
    teamIrRunStore: v2RunStore,
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

test("Task attempt summary stores readable Team IR v2 result text before applying its length limit", async () => {
  const task = { taskId: "task-1", currentRunId: "run-1", status: "running" };
  const project = { projectId: "project-1", taskRecords: [task] };
  const store = createFileTaskExecutionStore({
    projectStore: {
      async getProject() { return project; },
      async withProjectWriteLock(_id, _operation, action) { return action(); },
      async saveTaskRecord(_project, _taskId, update) { Object.assign(task, update); return task; }
    }
  });
  const answer = `Readable delivery\n${"x".repeat(600)}`;
  await store.completeAttempt({
    projectId: "project-1", taskId: "task-1", runId: "run-1", startedAt: "start", now: "finish",
    result: { state: { status: "completed" }, result: { teamResult: { answer } } }
  });
  assert.equal(task.outputSummary.length, 500);
  assert.equal(task.outputSummary, answer.slice(0, 500));
});

test("Task execution reserves an immutable attempt under its Collaboration Project before launching the Run", async () => {
  const testHarness = harness();
  const task = await testHarness.useCases.startProjectTask("project-1", "task-1", { idempotencyKey: "request-1" });
  assert.deepEqual(testHarness.calls.slice(0, 2).map(([name]) => name), ["reserve", "execute-v2"]);
  assert.equal(testHarness.calls[0][1].teamVersionId, "team-v1");
  const options = testHarness.calls[1][2];
  assert.equal(options.prompt, "Do the work");
  assert.equal(options.runId, "run-1");
  assert.equal(options.teamIrSemanticDigest, "a".repeat(64));
  assert.equal(options.compiledPlanDigest, "b".repeat(64));
  assert.equal(options.idempotencyKey, "task:project-1:task-1:request-1");
  assert.deepEqual(options.materialSnapshotPolicy, { kind: "project_current" });
  await testHarness.useCases.startProjectTask("project-1", "task-1", { idempotencyKey: "request-1" });
  assert.equal(testHarness.calls.filter(([name]) => name === "reserve").length, 1);
});

test("Task execution carries the frozen Artifact references into each Run attempt", async () => {
  const testHarness = harness();
  const reference = { artifactId: `art_${"a".repeat(36)}`, mediaType: "text/plain" };
  testHarness.project.taskRecords[0].runInputAttachments = { brief: reference };
  await testHarness.useCases.startProjectTask("project-1", "task-1", { mode: "sandbox", idempotencyKey: "artifact-attempt" });
  const reservation = testHarness.calls.find(([name]) => name === "reserve")[1];
  const [, , options] = testHarness.calls.find(([name]) => name === "execute-v2");
  assert.deepEqual(reservation.artifactReferences, { brief: reference });
  assert.deepEqual(options.attachments, { brief: reference });
});

test("Run state initialization failure leaves reservation handling to the atomic attempt store", async () => {
  const testHarness = harness({ reserveAttempt: async () => { throw new Error("state write failed"); } });
  await assert.rejects(() => testHarness.useCases.startProjectTask("project-1", "task-1"), /state write failed/);
  assert.equal(testHarness.project.taskRecords[0].currentRunId, undefined);
  assert.equal(testHarness.calls.some(([name]) => name === "fail"), false);
  assert.equal(testHarness.calls.some(([name]) => name === "execute-v2"), false);
  assert.equal(testHarness.calls.some(([name]) => name === "legacy-execute"), false);
});

test("Task Run reservation write failure leaves the queued Task unchanged and never starts Runtime", async () => {
  const testHarness = harness({ reserveAttempt: async () => { throw new Error("Task reservation write failed"); } });
  await assert.rejects(() => testHarness.useCases.startProjectTask("project-1", "task-1"), /Task reservation write failed/);
  assert.equal(testHarness.project.taskRecords[0].status, "queued");
  assert.equal(testHarness.project.taskRecords[0].currentRunId, undefined);
  assert.deepEqual(testHarness.project.taskRecords[0].runIds, []);
  assert.equal(testHarness.calls.some(([name]) => name === "execute-v2"), false);
  assert.equal(testHarness.calls.some(([name]) => name === "legacy-execute"), false);
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
  const [, project, options] = testHarness.calls.find(([name]) => name === "execute-v2");
  assert.equal(project.projectId, "project-1");
  assert.equal(options.teamVersionId, "team-v1");
  assert.equal(Object.hasOwn(options, "workdir"), false);
  assert.equal(Object.hasOwn(options, "runEvidenceRoot"), false);
});

test("Task execution refuses a frozen v2 plan until the v2 Sandbox executor is connected", async () => {
  const semanticDigest = "a".repeat(64);
  const compiledPlanDigest = "b".repeat(64);
  const testHarness = harness({ team: { teamIrSemanticDigest: semanticDigest, compiledPlanDigest }, teamIrRunStore: null });
  Object.assign(testHarness.project.taskRecords[0], { teamIrSemanticDigest: semanticDigest, compiledPlanDigest });
  await assert.rejects(() => testHarness.useCases.startProjectTask("project-1", "task-1"), /TEAM_IR_V2_EXECUTOR_UNAVAILABLE/);
  assert.equal(testHarness.calls.some(([name]) => name === "reserve"), false);
  assert.equal(testHarness.calls.some(([name]) => name === "legacy-execute"), false);
});

test("production Team IR executor rejects unavailable trusted resolvers before reserving a Task Run", async () => {
  const semanticDigest = "a".repeat(64);
  const compiledPlanDigest = "b".repeat(64);
  const teamIrRunStore = createRuntimeTeamIrProjectRunExecutor({
    teamStore: { async getTeamVersion() { assert.fail("Team lookup must not run while resolvers are unavailable."); } },
    teamIrStore: createFileTeamIrStore()
  });
  const testHarness = harness({ team: { teamIrSemanticDigest: semanticDigest, compiledPlanDigest }, teamIrRunStore });
  Object.assign(testHarness.project.taskRecords[0], { teamIrSemanticDigest: semanticDigest, compiledPlanDigest });
  await assert.rejects(() => testHarness.useCases.startProjectTask("project-1", "task-1"), /TEAM_IR_V2_EXECUTOR_UNAVAILABLE/);
  assert.equal(testHarness.calls.some(([name]) => name === "reserve"), false);
  assert.equal(testHarness.calls.some(([name]) => name === "legacy-execute"), false);
});

test("Task execution sends frozen v2 digests to the Project-owned Team IR executor without invoking the legacy Run store", async () => {
  const semanticDigest = "a".repeat(64);
  const compiledPlanDigest = "b".repeat(64);
  const teamIrRunStore = { async execute(project, options) {
    return { state: { status: "completed" }, result: { teamResult: { summary: "v2 result" } }, project, options };
  } };
  const testHarness = harness({ team: { teamIrSemanticDigest: semanticDigest, compiledPlanDigest }, teamIrRunStore });
  Object.assign(testHarness.project.taskRecords[0], { teamIrSemanticDigest: semanticDigest, compiledPlanDigest });
  const task = await testHarness.useCases.startProjectTask("project-1", "task-1", { mode: "sandbox" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(task.currentRunId, "run-1");
  assert.equal(testHarness.calls.some(([name]) => name === "legacy-execute"), false);
  assert.equal(testHarness.calls.some(([name]) => name === "reserve"), true);
  const completed = testHarness.calls.find(([name]) => name === "complete");
  assert.deepEqual(completed[1].result.result, { teamResult: { summary: "v2 result" } });
});

test("Task execution rejects an unbound legacy Task before invoking either executor", async () => {
  const testHarness = harness();
  delete testHarness.project.taskRecords[0].teamIrSemanticDigest;
  delete testHarness.project.taskRecords[0].compiledPlanDigest;
  await assert.rejects(() => testHarness.useCases.startProjectTask("project-1", "task-1"), /TEAM_IR_V2_REQUIRED/);
  assert.equal(testHarness.calls.some(([name]) => name === "reserve"), false);
  assert.equal(testHarness.calls.some(([name]) => name === "legacy-execute" || name === "execute-v2"), false);
});

test("Team IR human-review wait maps to Task waiting_review while preserving the Runtime checkpoint", async () => {
  const semanticDigest = "a".repeat(64);
  const compiledPlanDigest = "b".repeat(64);
  const waitingRun = {
    runId: "run-1", status: "waiting_human_review",
    waitingReview: { reviewId: "maker-checker-review", lineage: "run", loopRound: 1 }
  };
  const teamIrRunStore = { async execute() {
    return {
      state: { status: "waiting_human_review", runId: "run-1", teamIrSemanticDigest: semanticDigest, compiledPlanDigest },
      result: null,
      teamRun: waitingRun
    };
  } };
  const testHarness = harness({ team: { teamIrSemanticDigest: semanticDigest, compiledPlanDigest }, teamIrRunStore });
  Object.assign(testHarness.project.taskRecords[0], { teamIrSemanticDigest: semanticDigest, compiledPlanDigest });

  await testHarness.useCases.startProjectTask("project-1", "task-1", { mode: "sandbox" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const completed = testHarness.calls.find(([name]) => name === "complete")[1];
  assert.equal(completed.result.state.status, "waiting_review");
  assert.equal(completed.result.teamRun.status, "waiting_human_review");
  assert.deepEqual(completed.result.teamRun.waitingReview, { reviewId: "maker-checker-review", lineage: "run", loopRound: 1 });
});

test("Review recovery serializes same-attempt dispatch and projects the resumed Team Run back to its Task", async () => {
  const semanticDigest = "a".repeat(64);
  const compiledPlanDigest = "b".repeat(64);
  const task = {
    taskId: "task-1", taskNumber: 1, input: "Do the work", status: "waiting_review", currentRunId: "run-1",
    runIds: ["run-1"], teamVersionId: "team-v1", teamIrSemanticDigest: semanticDigest, compiledPlanDigest
  };
  let active = 0;
  let maxActive = 0;
  let call = 0;
  const teamIrRunStore = {
    async resume(_project, options) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      call += 1;
      await new Promise((resolveWait) => setTimeout(resolveWait, 5));
      active -= 1;
      assert.deepEqual({ runId: options.runId, attemptNumber: options.attemptNumber, reviewId: options.reviewId, dispatchId: options.dispatchId }, {
        runId: "run-1", attemptNumber: 1, reviewId: "review-1", dispatchId: "run-1:team-review:review-1:run:run"
      });
      return {
        state: { runId: "run-1", status: call === 1 ? "waiting_human_review" : "completed" },
        result: { teamResult: { summary: "done" } }
      };
    }
  };
  const testHarness = harness({ team: { teamIrSemanticDigest: semanticDigest, compiledPlanDigest }, teamIrRunStore });
  testHarness.project.taskRecords[0] = task;
  const recovery = {
    reviewId: "review-1", lineage: "run", dispatchId: "run-1:team-review:review-1:run:run"
  };
  const [first, second] = await Promise.all([
    testHarness.useCases.resumeProjectTaskRun("project-1", "task-1", "run-1", recovery),
    testHarness.useCases.resumeProjectTaskRun("project-1", "task-1", "run-1", recovery)
  ]);
  assert.equal(maxActive, 1);
  assert.equal(call, 2);
  assert.deepEqual([first.state.status, second.state.status], ["waiting_review", "completed"]);
  assert.equal(testHarness.calls.filter(([name]) => name === "reserve").length, 0);
  const completed = testHarness.calls.filter(([name]) => name === "complete");
  assert.equal(completed.length, 2);
  assert.deepEqual(completed.map(([, input]) => input.result.state.status), ["waiting_review", "completed"]);
  assert.equal(testHarness.project.taskRecords[0].currentRunId, "run-1");
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
