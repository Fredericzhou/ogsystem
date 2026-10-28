import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyTeamJoinEvent, compileTeamIr, createTeamJoinRound, FileTeamRunStore, TeamBindingError, TeamRuntime } from "../dist/team-ir/index.js";

function within(promise, label, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function fakeClock(initial = 0) {
  let now = initial;
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

async function until(predicate, label) {
  const started = Date.now();
  while (Date.now() - started < 3000) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function fixture() {
  return JSON.parse(await readFile(new URL("../examples/team-ir-v2/classic-structured-debate.json", import.meta.url), "utf8"));
}

function debateBindings({ failJudge = false, onJudge } = {}) {
  let proponentRound = 0;
  let opponentRound = 0;
  const calls = [];
  const bindings = {
    "binding:debate-host": { async invoke(invocation) {
      calls.push(["debate-host", invocation.input]);
      return { kind: "completed", output: { event: "BRIEF", data: { brief: invocation.input.brief } } };
    } },
    "binding:proponent": { async invoke(invocation) {
      calls.push(["proponent", invocation.input]);
      return { kind: "completed", output: { event: "ARGUMENT", data: { argument: `pro-${++proponentRound}` } } };
    } },
    "binding:opponent": { async invoke(invocation) {
      calls.push(["opponent", invocation.input]);
      return { kind: "completed", output: { event: "ARGUMENT", data: { argument: `con-${++opponentRound}` } } };
    } },
    "binding:neutral-judge": { async invoke(invocation) {
      calls.push(["neutral-judge", invocation.input]);
      if (failJudge) throw new TeamBindingError("judge unavailable", "policy");
      const output = onJudge ? await onJudge(invocation, calls.filter(([agentId]) => agentId === "neutral-judge").length) : undefined;
      const turn = calls.filter(([agentId]) => agentId === "neutral-judge").length;
      return { kind: "completed", output: { event: "JUDGMENT", data: output ?? { decision: turn === 1 ? "rebuttal" : "final", request: turn === 1 ? "address the strongest objection" : "prepare the conclusion" } } };
    } },
    "binding:debate-reporter": { async invoke(invocation) {
      calls.push(["debate-reporter", invocation.input]);
      return { kind: "completed", output: { event: "REPORT", data: { summary: "balanced conclusion" } } };
    } }
  };
  return { calls, bindings };
}

test("classic structured debate runs two Loop rounds through all_of Join, rebuttal and reporter exit", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-loop-join-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const team = await fixture();
  const plan = compileTeamIr(team);
  const { calls, bindings } = debateBindings();
  const store = new FileTeamRunStore(join(root, "runs"));
  const runtime = new TeamRuntime({ store, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  await runtime.createRun(plan, { runId: "classic-debate", task: "debate", input: { request: "Assess the proposal" } });
  let result;
  try { result = await runtime.executeRun(plan, "classic-debate"); }
  catch (error) { throw new Error(JSON.stringify({ error: error.message, state: await store.load("classic-debate") })); }
  assert.equal(result.status, "completed", JSON.stringify({ events: result.events.filter((entry) => entry.type === "run.failing"), rounds: result.scheduler?.joinRounds, calls, invocations: result.invocations }));
  assert.deepEqual(result.result, { summary: "balanced conclusion" });
  assert.deepEqual(calls.filter(([agentId]) => agentId === "debate-host" || agentId === "neutral-judge" || agentId === "debate-reporter").map(([agentId]) => agentId), [
    "debate-host", "neutral-judge", "debate-host", "neutral-judge", "debate-reporter"
  ]);
  assert.equal(calls.filter(([agentId]) => agentId === "proponent").length, 2);
  assert.equal(calls.filter(([agentId]) => agentId === "opponent").length, 2);
  assert.deepEqual(calls.filter(([agentId]) => agentId === "neutral-judge").map(([, input]) => input), [
    { proponentArgument: "pro-1", opponentArgument: "con-1" },
    { proponentArgument: "pro-2", opponentArgument: "con-2" }
  ]);
  assert.equal(result.loopStates["debate-rounds"].rounds, 2);
  assert.equal(Object.values(result.invocations).filter((invocation) => invocation.agentId === "neutral-judge").length, 2);
  const persisted = await new FileTeamRunStore(join(root, "runs")).load("classic-debate");
  assert.equal(persisted.scheduler.joinRounds["debate-positions:1"].status, "ready");
  assert.deepEqual(persisted.scheduler.joinRounds["debate-positions:1"].merged.data, { proponentArgument: "pro-1", opponentArgument: "con-1" });
  assert.equal(persisted.scheduler.joinRounds["debate-positions:2"].status, "ready");
});

test("classic structured debate fails the Run when the Loop Join target fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-loop-join-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const team = await fixture();
  const plan = compileTeamIr(team);
  const { calls, bindings } = debateBindings({ failJudge: true });
  const runtime = new TeamRuntime({ store: new FileTeamRunStore(join(root, "runs")), clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  await runtime.createRun(plan, { runId: "classic-debate-fail", task: "debate", input: { request: "Assess the proposal" } });
  const result = await runtime.executeRun(plan, "classic-debate-fail");
  assert.equal(result.status, "failed");
  assert.equal(result.events.some((entry) => entry.type === "run.failing"), true);
  assert.equal(calls.filter(([agentId]) => agentId === "neutral-judge").length, 1);
  assert.equal(calls.some(([agentId]) => agentId === "debate-reporter"), false);
});

test("Loop-scoped all_of Join timeout fails the Run and cancels active round sources", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-loop-join-timeout-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const team = await fixture();
  team.orchestration.joins[0].timeoutMs = 50;
  const plan = compileTeamIr(team);
  const clock = fakeClock(100);
  const store = new FileTeamRunStore(join(root, "runs"));
  const started = { proponent: false, opponent: false };
  const cancels = { proponent: 0, opponent: 0 };
  const waitForCancel = (role) => ({
    async invoke() { started[role] = true; return new Promise(() => {}); },
    async cancel() { cancels[role] += 1; return true; }
  });
  const runtime = new TeamRuntime({
    store,
    clock,
    bindings: {
      "binding:debate-host": { async invoke() { return { kind: "completed", output: { event: "BRIEF", data: { brief: "brief" } } }; } },
      "binding:proponent": waitForCancel("proponent"),
      "binding:opponent": waitForCancel("opponent"),
      "binding:neutral-judge": { async invoke() { throw new Error("Join target must not run after timeout"); } },
      "binding:debate-reporter": { async invoke() { throw new Error("Reporter must not run after timeout"); } }
    }
  });
  const runId = "classic-debate-join-timeout";
  await runtime.createRun(plan, { runId, task: "debate", input: { request: "Assess the proposal" } });
  const running = runtime.executeRun(plan, runId);
  await until(async () => {
    const current = await store.load(runId);
    const round = current.scheduler?.joinRounds?.["debate-positions:1"];
    return started.proponent && started.opponent && round?.deadlineAt !== undefined;
  }, "Loop Join round deadline and both source activations");
  const collecting = await store.load(runId);
  assert.equal(collecting.scheduler.joinRounds["debate-positions:1"].startedAt, 100);
  assert.equal(collecting.scheduler.joinRounds["debate-positions:1"].deadlineAt, 150);
  clock.advanceTo(150);
  const result = await within(running, "Loop Join timeout settlement");
  assert.equal(result.status, "failed");
  assert.equal(result.events.some((entry) => entry.type === "run.failing" && entry.data?.code === "JOIN_TIMEOUT"), true);
  assert.equal(result.scheduler.joinRounds["debate-positions:1"].failure.code, "JOIN_TIMEOUT");
  assert.deepEqual(cancels, { proponent: 1, opponent: 1 });
  assert.equal(result.invocations[Object.keys(result.invocations).find((id) => id.includes("host-to-proponent"))].status, "failed");
});

test("FileTeamRunStore recovery preserves a Loop Join round deadline and waits only the remaining time", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-loop-join-timeout-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const team = await fixture();
  team.orchestration.joins[0].timeoutMs = 50;
  const plan = compileTeamIr(team);
  const runId = "classic-debate-join-timeout-recovery";
  const firstStore = new FileTeamRunStore(join(root, "runs"));
  const firstClock = fakeClock(100);
  const noCall = { async invoke() { throw new Error("checkpoint setup must not execute bindings"); } };
  const initialRuntime = new TeamRuntime({
    store: firstStore, clock: firstClock,
    bindings: Object.fromEntries(team.agents.map((agent) => [agent.bindingRef, noCall]))
  });
  await initialRuntime.createRun(plan, { runId, task: "debate", input: { request: "Assess the proposal" } });
  await initialRuntime.claim(runId, plan.compiledPlanDigest);
  const round = applyTeamJoinEvent(createTeamJoinRound({
    joinId: "debate-positions", runId, lineage: "run", loopRound: 1, mode: "all_of",
    handoffIds: ["proponent-to-judge", "opponent-to-judge"], timeoutMs: 50,
    requiredSourceIds: ["proponent-to-judge", "opponent-to-judge"],
    requiredFields: ["proponentArgument", "opponentArgument"]
  }), { type: "predecessor_activated", at: 100 });
  const checkpoint = await firstStore.load(runId);
  const expectedRevision = checkpoint.revision;
  checkpoint.loopStates["debate-rounds"] = {
    rounds: 1, agentActivations: 1,
    previousOutputs: { "debate-host": { event: "BRIEF", data: { brief: "persisted brief" } } },
    currentOutputs: {}
  };
  checkpoint.scheduler.pending = ["host-to-proponent", "host-to-opponent"];
  checkpoint.scheduler.sources = { "agent:debate-host:BRIEF": { event: "BRIEF", data: { brief: "persisted brief" } } };
  checkpoint.scheduler.visited = {};
  checkpoint.scheduler.invocationIds = {};
  checkpoint.scheduler.joinRounds = { "debate-positions:1": round };
  checkpoint.revision = expectedRevision + 1;
  assert.equal(await firstStore.compareAndSet(runId, expectedRevision, checkpoint), true);

  const clock = fakeClock(125);
  const cancels = { proponent: 0, opponent: 0 };
  const waitForCancel = (role) => ({
    async invoke() { return new Promise(() => {}); },
    async cancel() { cancels[role] += 1; return true; }
  });
  const recoveredRuntime = new TeamRuntime({
    store: new FileTeamRunStore(join(root, "runs")), clock,
    bindings: {
      "binding:debate-host": noCall,
      "binding:proponent": waitForCancel("proponent"),
      "binding:opponent": waitForCancel("opponent"),
      "binding:neutral-judge": noCall,
      "binding:debate-reporter": noCall
    }
  });
  const running = recoveredRuntime.executeRun(plan, runId);
  await until(async () => {
    const current = await firstStore.load(runId);
    return Object.values(current.invocations).some((invocation) => invocation.agentId === "proponent" && invocation.status === "running")
      && Object.values(current.invocations).some((invocation) => invocation.agentId === "opponent" && invocation.status === "running");
  }, "recovered Loop source activations");
  const restored = await firstStore.load(runId);
  assert.equal(restored.scheduler.joinRounds["debate-positions:1"].startedAt, 100);
  assert.equal(restored.scheduler.joinRounds["debate-positions:1"].deadlineAt, 150);
  clock.advanceTo(149);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await firstStore.load(runId)).status, "running");
  assert.deepEqual(cancels, { proponent: 0, opponent: 0 });
  clock.advanceTo(150);
  const result = await within(running, "recovered Loop Join timeout settlement");
  assert.equal(result.status, "failed");
  assert.equal(result.events.some((entry) => entry.type === "run.failing" && entry.data?.code === "JOIN_TIMEOUT"), true);
  assert.deepEqual(cancels, { proponent: 1, opponent: 1 });
});

test("Loop Join checkpoint recovers a committed round without repeating its contribution calls", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-loop-join-recover-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const team = await fixture();
  const plan = compileTeamIr(team);
  const fileStore = new FileTeamRunStore(join(root, "runs"));
  let crashAfterJoinCheckpoint = true;
  const crashStore = {
    create: (...args) => fileStore.create(...args),
    load: (...args) => fileStore.load(...args),
    async compareAndSet(runId, revision, record) {
      const committed = await fileStore.compareAndSet(runId, revision, record);
      const readyRound = Object.values(record.scheduler?.joinRounds ?? {}).some((round) => round.status === "ready");
      if (committed && crashAfterJoinCheckpoint && readyRound && !Object.values(record.invocations).some((invocation) => invocation.agentId === "neutral-judge")) {
        crashAfterJoinCheckpoint = false;
        throw new Error("simulated process crash after Loop Join checkpoint");
      }
      return committed;
    }
  };
  const { calls, bindings } = debateBindings();
  const firstRuntime = new TeamRuntime({ store: crashStore, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  await firstRuntime.createRun(plan, { runId: "classic-debate-recover", task: "debate", input: { request: "Assess the proposal" } });
  await assert.rejects(within(firstRuntime.executeRun(plan, "classic-debate-recover"), "simulated crash"), /simulated process crash/);
  const crashed = await fileStore.load("classic-debate-recover");
  assert.equal(crashed.scheduler.joinRounds["debate-positions:1"].status, "ready");
  assert.equal(crashed.scheduler.joinRounds["debate-positions:1"].deadlineAt, 100 + 300000);
  const contributionCallsBeforeResume = calls.filter(([agentId]) => agentId === "proponent" || agentId === "opponent").length;

  const resumedRuntime = new TeamRuntime({ store: new FileTeamRunStore(join(root, "runs")), clock: { now: () => 200, sleep: () => new Promise(() => {}) }, bindings });
  const resumed = await within(resumedRuntime.executeRun(plan, "classic-debate-recover"), "recovered Run");
  assert.equal(resumed.status, "completed", JSON.stringify(resumed.events.filter((entry) => entry.type === "run.failing")));
  assert.equal(calls.filter(([agentId]) => agentId === "proponent" || agentId === "opponent").length, contributionCallsBeforeResume + 2);
  assert.equal(resumed.scheduler.joinRounds["debate-positions:1"].deadlineAt, 100 + 300000);
  assert.equal(resumed.scheduler.joinRounds["debate-positions:2"].deadlineAt, 200 + 300000);
});

test("Join readiness tracks selected and skipped handoff IDs when two sources share one endpoint", async (t) => {
  const value = {
    schemaVersion: 2,
    team: { id: "same-endpoint-join", version: "1" },
    runInput: { dataSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false }, preferencesSchema: { type: "object" }, artifactSlots: {} },
    runResult: { dataSchema: { type: "object" }, artifactSlots: {} },
    executionPolicy: { resultMode: "allow_empty", activeExecutionBudgetMs: 10000 },
    agents: [
      { id: "source", packageRef: "role:source@1", bindingRef: "binding:source", inputPorts: { default: { dataSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false } } }, outputPorts: { DONE: { dataSchema: { type: "object", properties: { includeLeft: { type: "boolean" }, left: { type: "string" }, right: { type: "string" } }, required: ["includeLeft", "left", "right"], additionalProperties: false } } } },
      { id: "joiner", packageRef: "role:joiner@1", bindingRef: "binding:joiner", inputPorts: { default: { dataSchema: { type: "object", properties: { left: { type: "string" }, right: { type: "string" } }, required: [], additionalProperties: false } } }, outputPorts: { DONE: { dataSchema: { type: "object" } } } }
    ],
    handoffs: [
      { id: "start", from: { kind: "run" }, to: { kind: "agent", agentId: "source", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, when: { priority: 0 }, delivery: { deadlineMs: 2000 } },
      { id: "left-contribution", from: { kind: "agent", agentId: "source", outputPort: "DONE" }, to: { kind: "agent", agentId: "joiner", inputPort: "default" }, map: { data: { left: { "$ref": "$.output.data.left" } } }, when: { condition: { op: "equals", args: [{ "$ref": "$.output.data.includeLeft" }, { "$literal": true }] } }, delivery: { deadlineMs: 2000 } },
      { id: "right-contribution", from: { kind: "agent", agentId: "source", outputPort: "DONE" }, to: { kind: "agent", agentId: "joiner", inputPort: "default" }, map: { data: { right: { "$ref": "$.output.data.right" } } }, when: { condition: { op: "equals", args: [{ "$ref": "$.output.data.includeLeft" }, { "$literal": false }] } }, delivery: { deadlineMs: 2000 } }
    ],
    orchestration: {
      routes: [
        { from: { kind: "run" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["start"] },
        { from: { kind: "agent", agentId: "source", outputPort: "DONE" }, mode: "parallel_fanout", onNoMatch: "finish", handoffIds: ["left-contribution", "right-contribution"] }
      ],
      joins: [{ id: "same-endpoint", agentId: "joiner", inputPort: "default", mode: "all_of", handoffIds: ["left-contribution", "right-contribution"], scope: { kind: "run" }, timeoutMs: 1000, onTimeout: "fail" }],
      loops: [], reviews: []
    },
    bindings: ["source", "joiner"].map((id) => ({ id: `binding:${id}`, kind: "model", modelRef: "models/default", attemptTimeoutMs: 1000, retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } } }))
  };
  let plan;
  try { plan = compileTeamIr(value); } catch (error) { throw new Error(JSON.stringify(error.diagnostics || error.issues || error.message)); }
  let joinInput;
  const root = await mkdtemp(join(tmpdir(), "team-ir-same-endpoint-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new FileTeamRunStore(join(root, "runs"));
  const runtime = new TeamRuntime({
    store,
    clock: { now: () => 100, sleep: () => new Promise(() => {}) },
    bindings: {
      "binding:source": { async invoke() { return { kind: "completed", output: { event: "DONE", data: { includeLeft: true, left: "chosen", right: "unselected" } } }; } },
      "binding:joiner": { async invoke(invocation) { joinInput = invocation.input; return { kind: "completed", output: { event: "DONE", data: {} } }; } }
    }
  });
  await runtime.createRun(plan, { runId: "same-endpoint-run", task: "join", input: { prompt: "check" } });
  const result = await runtime.executeRun(plan, "same-endpoint-run");
  assert.equal(result.status, "completed");
  assert.deepEqual(joinInput, { left: "chosen" });
  const round = result.scheduler.joinRounds["same-endpoint"];
  assert.deepEqual(round.sourceStates, { "left-contribution": "arrived", "right-contribution": "skipped" });
  assert.deepEqual(round.merged.data, { left: "chosen" });
});
