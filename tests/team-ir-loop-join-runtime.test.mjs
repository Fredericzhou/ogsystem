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

async function branchHistoryDebateFixture() {
  const team = await fixture();
  const port = team.agents.find((agent) => agent.id === "neutral-judge").inputPorts.review;
  port.dataSchema.properties.proponentPriorArgument = { type: "string" };
  port.dataSchema.properties.opponentPriorArgument = { type: "string" };
  team.handoffs.find((handoff) => handoff.id === "proponent-to-judge").map.data.proponentPriorArgument = {
    "$ref": "$.loop.previous.proponent.output.data.argument"
  };
  team.handoffs.find((handoff) => handoff.id === "opponent-to-judge").map.data.opponentPriorArgument = {
    "$ref": "$.loop.previous.opponent.output.data.argument"
  };
  return team;
}

async function parallelLineageDebateFixture() {
  const team = await branchHistoryDebateFixture();
  team.runInput.dataSchema.properties.requestAlt = { type: "string", minLength: 1 };
  team.runInput.dataSchema.required.push("requestAlt");
  team.handoffs.push({
    id: "run-to-host-alt", from: { kind: "run" }, to: { kind: "agent", agentId: "debate-host", inputPort: "default" },
    map: { data: { brief: { "$ref": "$.run.input.requestAlt" } } }, delivery: { deadlineMs: 180000 }
  });
  team.orchestration.routes.unshift({
    from: { kind: "run" }, mode: "parallel_fanout", onNoMatch: "fail", handoffIds: ["run-to-host", "run-to-host-alt"]
  });
  team.orchestration.loops[0].entryHandoffIds.push("run-to-host-alt");
  team.executionPolicy.resultMode = "allow_empty";
  team.handoffs = team.handoffs.filter((handoff) => handoff.id !== "reporter-to-result");
  return team;
}

async function quorumDebateFixture({ threshold = 1, timeoutMs = 300000 } = {}) {
  const team = await fixture();
  const join = team.orchestration.joins[0];
  join.mode = "quorum_of";
  join.threshold = threshold;
  join.timeoutMs = timeoutMs;
  const targetPort = team.agents.find((agent) => agent.id === join.agentId).inputPorts[join.inputPort];
  targetPort.dataSchema.required = [];
  return team;
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
      const data = output ?? {
        decision: turn === 1 ? "rebuttal" : "final",
        ...(turn === 1 ? { request: "address the strongest objection" } : {}),
        proponentSummary: `proponent summary ${turn}`,
        opponentSummary: `opponent summary ${turn}`,
        rationale: `judge rationale ${turn}`
      };
      return { kind: "completed", output: { event: data.decision === "rebuttal" ? "REBUTTAL" : "FINAL", data } };
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
  const firstRound = persisted.scheduler.joinRounds["debate-positions:1"];
  const secondRound = persisted.scheduler.joinRounds["debate-positions:2"];
  assert.equal(firstRound.key, "debate-positions:classic-debate:run:1");
  assert.equal(secondRound.key, "debate-positions:classic-debate:run:2");
  assert.notEqual(firstRound.key, secondRound.key);
  assert.equal(firstRound.status, "ready");
  assert.equal(secondRound.status, "ready");
  assert.deepEqual(firstRound.sourceStates, { "proponent-to-judge": "arrived", "opponent-to-judge": "arrived" });
  assert.deepEqual(secondRound.sourceStates, { "proponent-to-judge": "arrived", "opponent-to-judge": "arrived" });
  assert.deepEqual(firstRound.contributions, {
    "proponent-to-judge": { data: { proponentArgument: "pro-1" }, artifacts: {} },
    "opponent-to-judge": { data: { opponentArgument: "con-1" }, artifacts: {} }
  });
  assert.deepEqual(secondRound.contributions, {
    "proponent-to-judge": { data: { proponentArgument: "pro-2" }, artifacts: {} },
    "opponent-to-judge": { data: { opponentArgument: "con-2" }, artifacts: {} }
  });
  assert.deepEqual(firstRound.merged.data, { proponentArgument: "pro-1", opponentArgument: "con-1" });
  assert.deepEqual(secondRound.merged.data, { proponentArgument: "pro-2", opponentArgument: "con-2" });
});

test("classic structured debate reports an unresolved rebuttal when the round limit is reached", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-loop-join-exhausted-rebuttal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const team = await fixture();
  const plan = compileTeamIr(team);
  const { calls, bindings } = debateBindings({ onJudge: (_invocation, turn) => ({ decision: "rebuttal", request: "one more clarification", proponentSummary: `proponent summary ${turn}`, opponentSummary: `opponent summary ${turn}`, rationale: `judge rationale ${turn}` }) });
  const store = new FileTeamRunStore(join(root, "runs"));
  const runtime = new TeamRuntime({ store, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  await runtime.createRun(plan, { runId: "classic-debate-exhausted-rebuttal", task: "debate", input: { request: "Assess the proposal" } });
  const result = await runtime.executeRun(plan, "classic-debate-exhausted-rebuttal");

  assert.equal(result.status, "completed", JSON.stringify(result.events.filter((entry) => entry.type === "run.failing")));
  assert.equal(result.loopStates["debate-rounds"].rounds, 2);
  assert.deepEqual(calls.filter(([agentId]) => agentId === "debate-reporter").map(([, input]) => input), [{
    decision: "rebuttal",
    proponentSummary: "proponent summary 2",
    opponentSummary: "opponent summary 2",
    rationale: "judge rationale 2"
  }]);
});

test("Loop Join skips an unselected candidate sharing an arrived source endpoint", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-loop-join-same-endpoint-skip-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const team = await fixture();
  const judgePort = team.agents.find((agent) => agent.id === "neutral-judge").inputPorts.review;
  judgePort.dataSchema.required = [];
  judgePort.dataSchema.properties.proponentNote = { type: "string" };
  const selectedContribution = team.handoffs.find((handoff) => handoff.id === "proponent-to-judge");
  selectedContribution.when = { priority: 2 };
  team.handoffs.push({
    id: "proponent-optional-note",
    from: { kind: "agent", agentId: "proponent", outputPort: "ARGUMENT" },
    to: { kind: "agent", agentId: "neutral-judge", inputPort: "review" },
    map: { data: { proponentNote: { "$ref": "$.output.data.argument" } } },
    when: { condition: { op: "equals", args: [{ "$ref": "$.output.data.argument" }, { "$literal": "never-selected" }] }, priority: 1 },
    delivery: { deadlineMs: 300000 }
  });
  team.orchestration.joins[0].handoffIds.push("proponent-optional-note");
  team.orchestration.routes.push({
    from: { kind: "agent", agentId: "proponent", outputPort: "ARGUMENT" },
    mode: "exclusive_priority", onNoMatch: "fail",
    handoffIds: ["proponent-to-judge", "proponent-optional-note"]
  });
  const plan = compileTeamIr(team);
  const { calls, bindings } = debateBindings();
  const store = new FileTeamRunStore(join(root, "runs"));
  const runtime = new TeamRuntime({ store, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  await runtime.createRun(plan, { runId: "loop-same-endpoint-skip", task: "debate", input: { request: "Assess the proposal" } });
  const result = await runtime.executeRun(plan, "loop-same-endpoint-skip");

  assert.equal(result.status, "completed", JSON.stringify(result.events.filter((entry) => entry.type === "run.failing")));
  assert.equal(calls.filter(([agentId]) => agentId === "neutral-judge").length, 2);
  assert.deepEqual(calls.filter(([agentId]) => agentId === "neutral-judge").map(([, input]) => input), [
    { proponentArgument: "pro-1", opponentArgument: "con-1" },
    { proponentArgument: "pro-2", opponentArgument: "con-2" }
  ]);
  for (const roundKey of ["debate-positions:1", "debate-positions:2"]) {
    const round = result.scheduler.joinRounds[roundKey];
    assert.deepEqual(round.sourceStates, {
      "proponent-to-judge": "arrived",
      "opponent-to-judge": "arrived",
      "proponent-optional-note": "skipped"
    });
    assert.equal(round.merged.data.proponentNote, undefined);
  }
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

test("Loop quorum Join triggers once at threshold and keeps a late source out of the merged input", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-loop-quorum-late-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const team = await quorumDebateFixture({ threshold: 1 });
  const plan = compileTeamIr(team);
  let releaseOpponent;
  let opponentStarted;
  const opponentStartedPromise = new Promise((resolve) => { opponentStarted = resolve; });
  let judgeStarted;
  const judgeStartedPromise = new Promise((resolve) => { judgeStarted = resolve; });
  const judgeInputs = [];
  const calls = { judge: 0 };
  const bindings = {
    "binding:debate-host": { async invoke(invocation) { return { kind: "completed", output: { event: "BRIEF", data: { brief: invocation.input.brief } } }; } },
    "binding:proponent": { async invoke() { return { kind: "completed", output: { event: "ARGUMENT", data: { argument: "first contribution" } } }; } },
    "binding:opponent": { async invoke() {
      opponentStarted();
      await new Promise((resolve) => { releaseOpponent = resolve; });
      return { kind: "completed", output: { event: "ARGUMENT", data: { argument: "late contribution" } } };
    } },
    "binding:neutral-judge": { async invoke(invocation) {
      calls.judge += 1;
      judgeInputs.push(invocation.input);
      judgeStarted();
      return { kind: "completed", output: { event: "FINAL", data: {
        decision: "final", proponentSummary: "included", opponentSummary: "not included", rationale: "threshold met"
      } } };
    } },
    "binding:debate-reporter": { async invoke() { return { kind: "completed", output: { event: "REPORT", data: { summary: "reported" } } }; } }
  };
  const store = new FileTeamRunStore(join(root, "runs"));
  const runtime = new TeamRuntime({ store, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  await runtime.createRun(plan, { runId: "loop-quorum-late", task: "debate", input: { request: "Assess the proposal" } });
  const running = runtime.executeRun(plan, "loop-quorum-late");
  try {
    await within(opponentStartedPromise, "late quorum source activation");
    await within(judgeStartedPromise, "Loop quorum target starts at threshold");
    assert.deepEqual(judgeInputs, [{ proponentArgument: "first contribution" }]);
  } finally {
    releaseOpponent?.();
  }
  const result = await within(running, "Loop quorum settlement");
  const round = result.scheduler.joinRounds["debate-positions:1"];
  assert.equal(result.status, "completed");
  assert.equal(calls.judge, 1);
  assert.equal(round.mode, "quorum_of");
  assert.equal(round.threshold, 1);
  assert.equal(round.status, "ready");
  assert.deepEqual(round.merged.data, { proponentArgument: "first contribution" });
  assert.equal(round.sourceStates["opponent-to-judge"], "arrived");
  assert.equal(round.audit.some((entry) => entry.type === "join.source.late_arrival" && entry.sourceId === "opponent-to-judge"), true);
});

test("Loop quorum Join timeout fails the Run and cancels the outstanding round source", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-loop-quorum-timeout-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const team = await quorumDebateFixture({ threshold: 2, timeoutMs: 50 });
  const plan = compileTeamIr(team);
  const clock = fakeClock(100);
  const store = new FileTeamRunStore(join(root, "runs"));
  let opponentStarted;
  const opponentStartedPromise = new Promise((resolve) => { opponentStarted = resolve; });
  const cancels = { opponent: 0 };
  let judgeCalls = 0;
  const bindings = {
    "binding:debate-host": { async invoke(invocation) { return { kind: "completed", output: { event: "BRIEF", data: { brief: invocation.input.brief } } }; } },
    "binding:proponent": { async invoke() { return { kind: "completed", output: { event: "ARGUMENT", data: { argument: "one" } } }; } },
    "binding:opponent": {
      async invoke() { opponentStarted(); return new Promise(() => {}); },
      async cancel() { cancels.opponent += 1; return true; }
    },
    "binding:neutral-judge": { async invoke() { judgeCalls += 1; throw new Error("quorum target must not run before threshold"); } },
    "binding:debate-reporter": { async invoke() { throw new Error("reporter must not run after timeout"); } }
  };
  const runtime = new TeamRuntime({ store, clock, bindings });
  await runtime.createRun(plan, { runId: "loop-quorum-timeout", task: "debate", input: { request: "Assess the proposal" } });
  const running = runtime.executeRun(plan, "loop-quorum-timeout");
  await within(opponentStartedPromise, "second quorum source activation");
  await until(async () => (await store.load("loop-quorum-timeout")).scheduler.joinRounds["debate-positions:1"]?.deadlineAt === 150, "persisted Loop quorum deadline");
  clock.advanceTo(150);
  const result = await within(running, "Loop quorum timeout settlement");
  assert.equal(result.status, "failed");
  assert.equal(result.scheduler.joinRounds["debate-positions:1"].failure.code, "JOIN_TIMEOUT");
  assert.equal(result.events.some((entry) => entry.type === "run.failing" && entry.data?.code === "JOIN_TIMEOUT"), true);
  assert.equal(cancels.opponent, 1);
  assert.equal(judgeCalls, 0);
});

test("FileTeamRunStore restores the remaining deadline for a collecting Loop quorum Join", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-loop-quorum-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const team = await quorumDebateFixture({ threshold: 2, timeoutMs: 50 });
  const plan = compileTeamIr(team);
  const runId = "loop-quorum-recovery";
  const runsRoot = join(root, "runs");
  const firstStore = new FileTeamRunStore(runsRoot);
  const firstRuntime = new TeamRuntime({
    store: firstStore,
    clock: fakeClock(100),
    bindings: Object.fromEntries(team.agents.map((agent) => [agent.bindingRef, { async invoke() { throw new Error("checkpoint setup must not invoke bindings"); } }]))
  });
  await firstRuntime.createRun(plan, { runId, task: "debate", input: { request: "Assess the proposal" } });
  await firstRuntime.claim(runId, plan.compiledPlanDigest);
  const round = applyTeamJoinEvent(createTeamJoinRound({
    joinId: "debate-positions", runId, lineage: "run", loopRound: 1, mode: "quorum_of", threshold: 2,
    handoffIds: ["proponent-to-judge", "opponent-to-judge"], timeoutMs: 50, requiredSourceIds: []
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
  let opponentStarted;
  const opponentStartedPromise = new Promise((resolve) => { opponentStarted = resolve; });
  const cancels = { opponent: 0 };
  const bindings = {
    "binding:debate-host": { async invoke() { throw new Error("host output is restored from the checkpoint"); } },
    "binding:proponent": { async invoke() { return { kind: "completed", output: { event: "ARGUMENT", data: { argument: "one" } } }; } },
    "binding:opponent": {
      async invoke() { opponentStarted(); return new Promise(() => {}); },
      async cancel() { cancels.opponent += 1; return true; }
    },
    "binding:neutral-judge": { async invoke() { throw new Error("quorum threshold must not be reached"); } },
    "binding:debate-reporter": { async invoke() { throw new Error("reporter must not run after timeout"); } }
  };
  const recovered = new TeamRuntime({ store: new FileTeamRunStore(runsRoot), clock, bindings });
  const running = recovered.executeRun(plan, runId);
  await within(opponentStartedPromise, "recovered outstanding Loop source");
  const restored = await firstStore.load(runId);
  assert.equal(restored.scheduler.joinRounds["debate-positions:1"].startedAt, 100);
  assert.equal(restored.scheduler.joinRounds["debate-positions:1"].deadlineAt, 150);
  clock.advanceTo(149);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await firstStore.load(runId)).status, "running");
  assert.equal(cancels.opponent, 0);
  clock.advanceTo(150);
  const result = await within(running, "recovered Loop quorum timeout settlement");
  assert.equal(result.status, "failed");
  assert.equal(result.scheduler.joinRounds["debate-positions:1"].failure.code, "JOIN_TIMEOUT");
  assert.equal(cancels.opponent, 1);
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

test("Loop fanout keeps branch-local previous outputs through a ready Join checkpoint restart", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-loop-lineage-recover-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = compileTeamIr(await branchHistoryDebateFixture());
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
        throw new Error("simulated process crash after branch Join checkpoint");
      }
      return committed;
    }
  };
  const { calls, bindings } = debateBindings();
  const firstRuntime = new TeamRuntime({ store: crashStore, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  await firstRuntime.createRun(plan, { runId: "lineage-debate", task: "debate", input: { request: "Assess the proposal" } });
  await assert.rejects(within(firstRuntime.executeRun(plan, "lineage-debate"), "branch checkpoint crash"), /simulated process crash/);
  const crashed = await fileStore.load("lineage-debate");
  const firstRound = crashed.scheduler.joinRounds["debate-positions:1"];
  assert.equal(firstRound.status, "ready");
  assert.equal(firstRound.lineage, "run");
  const contributionCallsBeforeResume = calls.filter(([agentId]) => agentId === "proponent" || agentId === "opponent").length;

  const resumedRuntime = new TeamRuntime({ store: new FileTeamRunStore(join(root, "runs")), clock: { now: () => 200, sleep: () => new Promise(() => {}) }, bindings });
  const resumed = await within(resumedRuntime.executeRun(plan, "lineage-debate"), "branch Join recovery");
  assert.equal(resumed.status, "completed", JSON.stringify(resumed.events.filter((entry) => entry.type === "run.failing")));
  assert.equal(calls.filter(([agentId]) => agentId === "proponent" || agentId === "opponent").length, contributionCallsBeforeResume + 2);
  assert.deepEqual(calls.filter(([agentId]) => agentId === "neutral-judge").map(([, input]) => input), [
    { proponentArgument: "pro-1", opponentArgument: "con-1" },
    { proponentArgument: "pro-2", opponentArgument: "con-2", proponentPriorArgument: "pro-1", opponentPriorArgument: "con-1" }
  ]);
  assert.equal(resumed.scheduler.joinRounds["debate-positions:2"].lineage, "run");
  assert.deepEqual(resumed.scheduler.joinRounds["debate-positions:2"].merged.data, {
    proponentArgument: "pro-2", opponentArgument: "con-2", proponentPriorArgument: "pro-1", opponentPriorArgument: "con-1"
  });
});

test("parallel Loop entries isolate same-boundary lineages and Loop Join recovery", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-parallel-loop-lineages-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = compileTeamIr(await parallelLineageDebateFixture());
  const fileStore = new FileTeamRunStore(join(root, "runs"));
  let crashAfterEntryInvocations = true;
  let crashAfterJoinCheckpoint = true;
  const crashStore = {
    create: (...args) => fileStore.create(...args),
    load: (...args) => fileStore.load(...args),
    async compareAndSet(runId, revision, record) {
      const committed = await fileStore.compareAndSet(runId, revision, record);
      const completedHosts = Object.values(record.invocations).filter((invocation) => invocation.agentId === "debate-host" && invocation.status === "completed");
      if (committed && crashAfterEntryInvocations && completedHosts.length === 2
        && !Object.values(record.invocations).some((invocation) => invocation.agentId !== "debate-host")) {
        crashAfterEntryInvocations = false;
        throw new Error("simulated crash after both entry invocations");
      }
      const readyRound = Object.values(record.scheduler?.joinRounds ?? {}).some((round) => round.status === "ready");
      if (committed && crashAfterJoinCheckpoint && readyRound && !Object.values(record.invocations).some((invocation) => invocation.agentId === "neutral-judge")) {
        crashAfterJoinCheckpoint = false;
        throw new Error("simulated crash after one lineage Join checkpoint");
      }
      return committed;
    }
  };
  const judgeInputs = [];
  const calls = new Map();
  let hostCalls = 0;
  const branchName = (brief) => brief.split(/-(?:revise|pro|con)-/)[0];
  const next = (key) => (calls.set(key, (calls.get(key) ?? 0) + 1), calls.get(key));
  const bindings = {
    "binding:debate-host": { async invoke(invocation) {
      hostCalls += 1;
      return { kind: "completed", output: { event: "BRIEF", data: { brief: invocation.input.brief } } };
    } },
    "binding:proponent": { async invoke(invocation) {
      const name = branchName(invocation.input.brief);
      return { kind: "completed", output: { event: "ARGUMENT", data: { argument: `${name}-pro-${next(`${name}:pro`)}` } } };
    } },
    "binding:opponent": { async invoke(invocation) {
      const name = branchName(invocation.input.brief);
      return { kind: "completed", output: { event: "ARGUMENT", data: { argument: `${name}-con-${next(`${name}:con`)}` } } };
    } },
    "binding:neutral-judge": { async invoke(invocation) {
      const input = invocation.input;
      judgeInputs.push(input);
      const name = branchName(input.proponentArgument);
      const turn = input.proponentPriorArgument ? 2 : 1;
      return { kind: "completed", output: { event: "REBUTTAL", data: {
        decision: "rebuttal", request: `${name}-revise-${turn}`,
        proponentSummary: `pro-${turn}`, opponentSummary: `con-${turn}`, rationale: `reason-${turn}`
      } } };
    } },
    "binding:debate-reporter": { async invoke() {
      return { kind: "completed", output: { event: "REPORT", data: { summary: "closed" } } };
    } }
  };
  const firstRuntime = new TeamRuntime({ store: crashStore, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  await firstRuntime.createRun(plan, { runId: "parallel-loop-lineages", task: "debate", input: { request: "alpha", requestAlt: "beta" } });
  await assert.rejects(within(firstRuntime.executeRun(plan, "parallel-loop-lineages"), "entry invocation crash"), /simulated crash after both entry invocations/);
  const entryCrashed = await fileStore.load("parallel-loop-lineages");
  assert.equal(hostCalls, 2);
  const persistedEntryLineages = entryCrashed.scheduler.pending.map((key) => key.slice(0, key.indexOf("\u001f")));
  assert.equal(new Set(persistedEntryLineages).size, 2);
  assert.ok(persistedEntryLineages.every((lineage) => lineage.includes("branch:run-to-host")));
  await assert.rejects(within(new TeamRuntime({ store: crashStore, clock: { now: () => 150, sleep: () => new Promise(() => {}) }, bindings })
    .executeRun(plan, "parallel-loop-lineages"), "lineage Join crash"), /simulated crash after one lineage Join checkpoint/);
  assert.equal(hostCalls, 2, "completed entry calls are not replayed after scheduler restart");
  const crashed = await fileStore.load("parallel-loop-lineages");
  const readyRounds = Object.values(crashed.scheduler.joinRounds).filter((round) => round.status === "ready");
  assert.equal(readyRounds.length, 1);
  const firstLineage = readyRounds[0].lineage;
  assert.match(firstLineage, /run-to-host/);
  const branchCallsBeforeResume = [...calls.values()].reduce((sum, count) => sum + count, 0);

  const resumed = await within(new TeamRuntime({
    store: new FileTeamRunStore(join(root, "runs")), clock: { now: () => 200, sleep: () => new Promise(() => {}) }, bindings
  }).executeRun(plan, "parallel-loop-lineages"), "lineage Join recovery");
  assert.equal(resumed.status, "completed", JSON.stringify(resumed.events.filter((entry) => entry.type === "run.failing")));
  assert.equal(hostCalls, 4, "only the two second-round host calls occur after Join checkpoint restart");
  assert.equal([...calls.values()].reduce((sum, count) => sum + count, 0), branchCallsBeforeResume + 4);
  const roundOne = Object.values(resumed.scheduler.joinRounds).filter((round) => round.loopRound === 1 && round.status === "ready");
  const roundTwo = Object.values(resumed.scheduler.joinRounds).filter((round) => round.loopRound === 2 && round.status === "ready");
  assert.equal(roundOne.length, 2);
  assert.equal(roundTwo.length, 2);
  assert.equal(new Set(roundOne.map((round) => round.lineage)).size, 2);
  assert.equal(new Set(roundTwo.map((round) => round.lineage)).size, 2);
  const inputsByBranch = new Map();
  for (const input of judgeInputs) {
    const name = branchName(input.proponentArgument);
    inputsByBranch.set(name, [...(inputsByBranch.get(name) ?? []), input]);
  }
  for (const [name, inputs] of inputsByBranch) {
    assert.equal(inputs.length, 2, `${name} judge activation count`);
    assert.equal(inputs[1].proponentPriorArgument, `${name}-pro-1`);
    assert.equal(inputs[1].opponentPriorArgument, `${name}-con-1`);
  }
  for (const lineage of new Set(roundOne.map((round) => round.lineage))) {
    assert.equal(resumed.loopStates[`debate-rounds\u001f${lineage}`].rounds, 2);
  }
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
