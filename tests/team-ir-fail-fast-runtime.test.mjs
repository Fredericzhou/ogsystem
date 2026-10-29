import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileTeamIr, TeamBindingError, TeamRuntime, FileTeamRunStore, MemoryTeamRunStore } from "../dist/team-ir/index.js";

function failFastTeam() {
  return {
    schemaVersion: 2,
    team: { id: "fail-fast", version: "1" },
    runInput: { dataSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false }, preferencesSchema: { type: "object" }, artifactSlots: {} },
    runResult: { dataSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false }, artifactSlots: {} },
    executionPolicy: { resultMode: "required", activeExecutionBudgetMs: 10000 },
    agents: ["fast-failure", "slow-branch"].map((id) => ({
      id, packageRef: `role:${id}@1`, bindingRef: `binding:${id}`,
      inputPorts: { default: { dataSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false } } },
      outputPorts: { DONE: { dataSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false } } }
    })),
    handoffs: [
      { id: "start-failure", from: { kind: "run" }, to: { kind: "agent", agentId: "fast-failure", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, delivery: { deadlineMs: 100 } },
      { id: "start-slow", from: { kind: "run" }, to: { kind: "agent", agentId: "slow-branch", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, delivery: { deadlineMs: 100 } },
      { id: "late-result", from: { kind: "agent", agentId: "slow-branch", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { summary: { "$ref": "$.output.data.summary" } } } }
    ],
    orchestration: {
      routes: [{ from: { kind: "run" }, mode: "parallel_fanout", onNoMatch: "fail", handoffIds: ["start-failure", "start-slow"] }],
      joins: [], loops: [], reviews: []
    },
    bindings: ["fast-failure", "slow-branch"].map((id) => ({
      id: `binding:${id}`, kind: "model", modelRef: "models/default", attemptTimeoutMs: 60,
      retry: { maxAttempts: 2, retryOn: ["transport", "timeout", "server_error"], backoff: { mode: "none" } }
    }))
  };
}

function fakeClock() {
  let now = 0;
  const sleepers = new Set();
  return {
    now: () => now,
    sleepers,
    sleep(ms, signal) {
      return new Promise((resolve) => {
        const sleeper = { due: now + ms, resolve, signal, abort: undefined };
        sleeper.abort = () => { sleepers.delete(sleeper); resolve(); };
        sleepers.add(sleeper);
        signal?.addEventListener("abort", sleeper.abort, { once: true });
      });
    },
    advanceTo(at) {
      now = at;
      for (const sleeper of [...sleepers]) {
        if (sleeper.due > at) continue;
        sleepers.delete(sleeper);
        sleeper.signal?.removeEventListener("abort", sleeper.abort);
        sleeper.resolve();
      }
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function until(predicate, label, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test("parallel fail-fast cancels and closes a sibling when Binding confirms cancellation", async () => {
  const plan = compileTeamIr(failFastTeam());
  const clock = fakeClock();
  const store = new MemoryTeamRunStore();
  const entered = { failure: deferred(), slow: deferred() };
  const releaseFailure = deferred();
  const cancelRequested = deferred();
  let slowCalls = 0;
  const runtime = new TeamRuntime({
    store,
    clock,
    bindings: {
      "binding:fast-failure": { async invoke() {
        entered.failure.resolve();
        await releaseFailure.promise;
        throw new TeamBindingError("permanent branch failure", "policy");
      } },
      "binding:slow-branch": {
        async invoke() { slowCalls += 1; entered.slow.resolve(); return new Promise(() => {}); },
        async cancel() { cancelRequested.resolve(); return true; }
      }
    }
  });
  await runtime.createRun(plan, { runId: "fail-fast-confirmed", task: "parallel", input: { prompt: "start" } });
  const running = runtime.executeRun(plan, "fail-fast-confirmed");
  await Promise.all([entered.failure.promise, entered.slow.promise]);
  releaseFailure.resolve();
  await cancelRequested.promise;
  const result = await running;
  assert.equal(result.status, "failed");
  assert.equal(result.terminalIntent, "failed");
  assert.equal(result.events.find((entry) => entry.type === "run.failing")?.data.code, "BINDING_POLICY",
    "a sibling's cancellation rejection must not replace the branch failure that started fail-fast convergence");
  assert.equal(result.invocations["fail-fast-confirmed:start-slow"].status, "failed");
  assert.equal(result.invocations["fail-fast-confirmed:start-slow"].outcomeUnknown, false);
  assert.equal(slowCalls, 1);
  assert.equal(result.resultWritten, undefined);
  assert.equal(result.events.some((entry) => entry.type === "invocation.cancelled_after_sibling_failure"), true);
  assert.equal(clock.now(), 0);
});

test("unconfirmed sibling cancellation waits through the remaining attempt deadline and ignores a late success", async () => {
  const plan = compileTeamIr(failFastTeam());
  const clock = fakeClock();
  const store = new MemoryTeamRunStore();
  const entered = { failure: deferred(), slow: deferred() };
  const releaseFailure = deferred();
  const cancelRequested = deferred();
  const lateSuccess = deferred();
  let slowCalls = 0;
  let completed = false;
  const runtime = new TeamRuntime({
    store,
    clock,
    bindings: {
      "binding:fast-failure": { async invoke() {
        entered.failure.resolve();
        await releaseFailure.promise;
        throw new TeamBindingError("permanent branch failure", "policy");
      } },
      "binding:slow-branch": {
        async invoke() { slowCalls += 1; entered.slow.resolve(); return lateSuccess.promise; },
        async cancel() { cancelRequested.resolve(); return false; }
      }
    }
  });
  await runtime.createRun(plan, { runId: "fail-fast-unconfirmed", task: "parallel", input: { prompt: "start" } });
  const running = runtime.executeRun(plan, "fail-fast-unconfirmed").then((result) => { completed = true; return result; });
  await Promise.all([entered.failure.promise, entered.slow.promise]);
  releaseFailure.resolve();
  await cancelRequested.promise;
  await until(() => clock.sleepers.size > 0, "original attempt deadline waiter");
  assert.equal(completed, false);
  const duringCancel = await store.load("fail-fast-unconfirmed");
  assert.equal(duringCancel.status, "failing");
  assert.equal(duringCancel.invocations["fail-fast-unconfirmed:start-slow"].status, "running");
  clock.advanceTo(60);
  const result = await running;
  assert.equal(result.status, "failed");
  assert.equal(result.invocations["fail-fast-unconfirmed:start-slow"].status, "failed");
  assert.equal(result.invocations["fail-fast-unconfirmed:start-slow"].outcomeUnknown, true);
  assert.equal(slowCalls, 1);
  assert.equal(result.resultWritten, undefined);
  lateSuccess.resolve({ kind: "completed", output: { event: "DONE", data: { summary: "too late" } } });
  await new Promise((resolve) => setImmediate(resolve));
  const afterLateSuccess = await store.load("fail-fast-unconfirmed");
  assert.equal(afterLateSuccess.resultWritten, undefined);
  assert.equal(afterLateSuccess.events.some((entry) => entry.type === "run.result.written"), false);
  assert.equal(afterLateSuccess.invocations["fail-fast-unconfirmed:start-slow"].status, "failed");
  assert.equal(slowCalls, 1);
});

test("parallel fail-fast waits for every active sibling outcome before settling", async () => {
  const team = failFastTeam();
  const extra = structuredClone(team.agents.find((agent) => agent.id === "slow-branch"));
  extra.id = "second-slow-branch";
  extra.packageRef = "role:second-slow-branch@1";
  extra.bindingRef = "binding:second-slow-branch";
  team.agents.push(extra);
  team.handoffs.push({
    id: "start-second-slow",
    from: { kind: "run" },
    to: { kind: "agent", agentId: extra.id, inputPort: "default" },
    map: { data: { prompt: { "$ref": "$.run.input.prompt" } } },
    delivery: { deadlineMs: 100 }
  });
  team.orchestration.routes[0].handoffIds.push("start-second-slow");
  team.bindings.push({
    id: extra.bindingRef, kind: "model", modelRef: "models/default", attemptTimeoutMs: 60,
    retry: { maxAttempts: 2, retryOn: ["transport", "timeout", "server_error"], backoff: { mode: "none" } }
  });
  const plan = compileTeamIr(team);
  const clock = fakeClock();
  const store = new MemoryTeamRunStore();
  const entered = { failure: deferred(), slow: deferred(), secondSlow: deferred() };
  const releaseFailure = deferred();
  const cancelRequests = { slow: deferred(), secondSlow: deferred() };
  const lateSuccess = deferred();
  const runtime = new TeamRuntime({
    store,
    clock,
    bindings: {
      "binding:fast-failure": { async invoke() {
        entered.failure.resolve();
        await releaseFailure.promise;
        throw new TeamBindingError("permanent branch failure", "policy");
      } },
      "binding:slow-branch": {
        async invoke() { entered.slow.resolve(); return new Promise(() => {}); },
        async cancel() { cancelRequests.slow.resolve(); return true; }
      },
      [extra.bindingRef]: {
        async invoke() { entered.secondSlow.resolve(); return lateSuccess.promise; },
        async cancel() { cancelRequests.secondSlow.resolve(); return false; }
      }
    }
  });
  await runtime.createRun(plan, { runId: "fail-fast-all-siblings", task: "parallel", input: { prompt: "start" } });
  const running = runtime.executeRun(plan, "fail-fast-all-siblings");
  await Promise.all(Object.values(entered).map((item) => item.promise));
  releaseFailure.resolve();
  await Promise.all(Object.values(cancelRequests).map((item) => item.promise));
  await until(async () => (await store.load("fail-fast-all-siblings"))
    .invocations["fail-fast-all-siblings:start-slow"].status === "failed", "confirmed sibling cancellation persistence");

  const duringCancel = await store.load("fail-fast-all-siblings");
  assert.equal(duringCancel.status, "failing");
  assert.equal(duringCancel.invocations["fail-fast-all-siblings:start-slow"].status, "failed");
  assert.equal(duringCancel.invocations["fail-fast-all-siblings:start-second-slow"].status, "running");
  assert.equal(duringCancel.resultWritten, undefined);
  assert.equal(clock.sleepers.size, 1, "the unconfirmed sibling retains its original attempt deadline");

  clock.advanceTo(60);
  const result = await running;
  assert.equal(result.status, "failed");
  assert.equal(result.invocations["fail-fast-all-siblings:start-slow"].outcomeUnknown, false);
  assert.equal(result.invocations["fail-fast-all-siblings:start-second-slow"].outcomeUnknown, true);
  assert.equal(result.resultWritten, undefined);
  lateSuccess.resolve({ kind: "completed", output: { event: "DONE", data: { summary: "too late" } } });
  await new Promise((resolve) => setImmediate(resolve));
  const afterLateSuccess = await store.load("fail-fast-all-siblings");
  assert.equal(afterLateSuccess.resultWritten, undefined);
  assert.equal(afterLateSuccess.events.some((entry) => entry.type === "run.result.written"), false);
  assert.equal(afterLateSuccess.invocations["fail-fast-all-siblings:start-second-slow"].status, "failed");
});

test("first terminal intent wins a concurrent cancellation and Binding failure race", async (t) => {
  for (const winner of ["cancel", "failure"]) {
    await t.test(`${winner} wins`, async () => {
      const plan = compileTeamIr(failFastTeam());
      const clock = fakeClock();
      const store = new MemoryTeamRunStore();
      const entered = { failure: deferred(), slow: deferred() };
      const releaseFailure = deferred();
      const runtime = new TeamRuntime({
        store,
        clock,
        bindings: {
          "binding:fast-failure": { async invoke() {
            entered.failure.resolve();
            await releaseFailure.promise;
            throw new TeamBindingError("permanent branch failure", "policy");
          } },
          "binding:slow-branch": {
            async invoke() { entered.slow.resolve(); return new Promise(() => {}); },
            async cancel() { return true; }
          }
        }
      });
      const runId = `intent-race-${winner}`;
      await runtime.createRun(plan, { runId, task: "parallel", input: { prompt: "start" } });
      const execution = runtime.executeRun(plan, runId);
      await Promise.all([entered.failure.promise, entered.slow.promise]);

      if (winner === "cancel") {
        const cancel = runtime.cancel(runId);
        await until(async () => (await store.load(runId)).terminalIntent === "cancelled", "cancellation intent");
        const cancelling = await store.load(runId);
        assert.equal(cancelling.terminalIntent, "cancelled");
        releaseFailure.resolve();
        const requested = await cancel;
        assert.equal(requested.status, "cancelled");
        assert.equal((await execution).status, "cancelled");
        const settled = await store.load(runId);
        assert.equal(settled.terminalIntent, "cancelled");
        assert.equal(settled.events.some((entry) => entry.type === "run.failing"), false);
        assert.equal(settled.events.some((entry) => entry.type === "invocation.late_failure_ignored"), true);
        assert.equal(settled.resultWritten, undefined);
      } else {
        releaseFailure.resolve();
        await until(async () => (await store.load(runId)).terminalIntent === "failed", "failure intent");
        await assert.rejects(runtime.cancel(runId), /Cannot cancel Run in (failing|failed)/);
        const settled = await execution;
        assert.equal(settled.status, "failed");
        assert.equal(settled.terminalIntent, "failed");
        assert.equal(settled.events.filter((entry) => entry.type === "run.failing").length, 1);
        assert.equal(settled.events.some((entry) => entry.type === "run.cancelling"), false);
        assert.equal(settled.resultWritten, undefined);
      }
    });
  }
});

test("a new Runtime recovers a persisted cancellation intent without replaying an active Binding", async () => {
  const plan = compileTeamIr(failFastTeam());
  const store = new MemoryTeamRunStore();
  const original = new TeamRuntime({ store, clock: { now: () => 100, sleep: async () => undefined }, bindings: {} });
  await original.createRun(plan, { runId: "cancel-restart", task: "recover cancellation", input: { prompt: "start" } });
  const record = await store.load("cancel-restart");
  record.status = "cancelling";
  record.terminalIntent = "cancelled";
  record.invocations["cancel-restart:start-slow"] = {
    id: "cancel-restart:start-slow", handoffId: "start-slow", agentId: "slow-branch", bindingId: "binding:slow-branch",
    status: "running", deadlineAt: 100, attempt: 1
  };
  record.revision += 1;
  assert.equal(await store.compareAndSet("cancel-restart", record.revision - 1, record), true);
  let invocations = 0;
  let cancels = 0;
  const recovered = await new TeamRuntime({
    store,
    clock: { now: () => 100, sleep: async () => undefined },
    bindings: { "binding:slow-branch": {
      async invoke() { invocations += 1; throw new Error("recovery must not replay"); },
      async cancel(input) { cancels += 1; assert.equal(input.idempotencyKey, "cancel-restart:start-slow"); return false; }
    } }
  }).executeRun(plan, "cancel-restart");
  assert.equal(recovered.status, "cancelled");
  assert.equal(recovered.terminalIntent, "cancelled");
  assert.equal(recovered.invocations["cancel-restart:start-slow"].outcomeUnknown, true);
  assert.equal(recovered.events.filter((entry) => entry.type === "run.cancelled").length, 1);
  assert.equal(cancels, 1);
  assert.equal(invocations, 0);
});

test("FileTeamRunStore recovery waits for the persisted cancellation deadline before settling an unknown outcome", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-cancel-deadline-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = compileTeamIr(failFastTeam());
  const store = new FileTeamRunStore(root);
  let now = 0;
  const sleepers = new Set();
  const clock = {
    now: () => now,
    sleep(ms) {
      return new Promise((resolve) => sleepers.add({ due: now + ms, resolve }));
    },
    advanceTo(value) {
      now = value;
      for (const sleeper of [...sleepers]) {
        if (sleeper.due > value) continue;
        sleepers.delete(sleeper);
        sleeper.resolve();
      }
    }
  };
  const firstRuntime = new TeamRuntime({ store, clock, bindings: {} });
  await firstRuntime.createRun(plan, { runId: "cancel-file-deadline", task: "recover cancellation", input: { prompt: "start" } });
  const record = await store.load("cancel-file-deadline");
  record.status = "cancelling";
  record.terminalIntent = "cancelled";
  record.invocations["cancel-file-deadline:start-slow"] = {
    id: "cancel-file-deadline:start-slow", handoffId: "start-slow", agentId: "slow-branch", bindingId: "binding:slow-branch",
    status: "running", deadlineAt: 100, attempt: 1
  };
  record.revision += 1;
  assert.equal(await store.compareAndSet("cancel-file-deadline", record.revision - 1, record), true);

  let invocations = 0;
  let cancels = 0;
  const bindings = { "binding:slow-branch": {
    async invoke() { invocations += 1; throw new Error("recovery must not replay"); },
    async cancel(input) {
      cancels += 1;
      assert.equal(input.idempotencyKey, "cancel-file-deadline:start-slow");
      return false;
    }
  } };
  const reopeningStore = new FileTeamRunStore(root);
  const recovery = new TeamRuntime({ store: reopeningStore, clock, bindings }).executeRun(plan, "cancel-file-deadline");
  await until(() => sleepers.size === 1, "persisted cancellation deadline wait");
  const pending = await reopeningStore.load("cancel-file-deadline");
  assert.equal(pending.status, "cancelling");
  assert.equal(pending.invocations["cancel-file-deadline:start-slow"].status, "running");
  assert.equal(invocations, 0);
  assert.equal(cancels, 1);

  clock.advanceTo(99);
  assert.equal((await reopeningStore.load("cancel-file-deadline")).status, "cancelling");
  clock.advanceTo(100);
  const cancelled = await recovery;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.invocations["cancel-file-deadline:start-slow"].outcomeUnknown, true);
  assert.equal(cancelled.events.filter((entry) => entry.type === "run.cancelled").length, 1);
  assert.equal(cancelled.resultWritten, undefined);
  assert.equal(invocations, 0);

  const reopened = await new TeamRuntime({ store: new FileTeamRunStore(root), clock, bindings }).executeRun(plan, "cancel-file-deadline");
  assert.equal(reopened.status, "cancelled");
  assert.equal(cancels, 1);
  assert.equal(invocations, 0);
  assert.equal(reopened.events.filter((entry) => entry.type === "run.cancelled").length, 1);
});

test("unconfirmed Run cancellation waits for the original Handoff deadline and ignores late completions", async () => {
  const plan = compileTeamIr(failFastTeam());
  const clock = fakeClock();
  const store = new MemoryTeamRunStore();
  const entered = { failure: deferred(), slow: deferred() };
  const lateResults = { failure: deferred(), slow: deferred() };
  const runtime = new TeamRuntime({
    store,
    clock,
    bindings: {
      "binding:fast-failure": { async invoke() { entered.failure.resolve(); return lateResults.failure.promise; }, async cancel() { return false; } },
      "binding:slow-branch": { async invoke() { entered.slow.resolve(); return lateResults.slow.promise; }, async cancel() { return false; } }
    }
  });
  await runtime.createRun(plan, { runId: "cancel-unconfirmed", task: "parallel", input: { prompt: "start" } });
  const execution = runtime.executeRun(plan, "cancel-unconfirmed");
  await Promise.all([entered.failure.promise, entered.slow.promise]);
  const cancellation = runtime.cancel("cancel-unconfirmed");
  await until(async () => (await store.load("cancel-unconfirmed")).terminalIntent === "cancelled", "cancellation intent");
  await until(() => clock.sleepers.size > 0, "original Handoff deadline wait");
  assert.equal((await store.load("cancel-unconfirmed")).status, "cancelling");
  clock.advanceTo(100);
  const cancelled = await cancellation;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.invocations["cancel-unconfirmed:start-failure"].outcomeUnknown, true);
  assert.equal(cancelled.invocations["cancel-unconfirmed:start-slow"].outcomeUnknown, true);
  lateResults.failure.resolve({ kind: "completed", output: { event: "DONE", data: { summary: "late" } } });
  lateResults.slow.resolve({ kind: "completed", output: { event: "DONE", data: { summary: "late" } } });
  const executionResult = await execution;
  assert.equal(executionResult.status, "cancelled");
  const afterLateResults = await store.load("cancel-unconfirmed");
  assert.equal(afterLateResults.resultWritten, undefined);
  assert.equal(afterLateResults.events.some((entry) => entry.type === "run.result.written"), false);
});
