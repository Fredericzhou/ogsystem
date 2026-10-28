import assert from "node:assert/strict";
import test from "node:test";
import { compileTeamIr, TeamBindingError, TeamRuntime, MemoryTeamRunStore } from "../dist/team-ir/index.js";

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
