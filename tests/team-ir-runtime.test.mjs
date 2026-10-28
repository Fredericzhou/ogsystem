import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyTeamJoinEvent, compileTeamIr, createTeamA2ABinding, createTeamJoinRound, FileTeamArtifactStore, FileTeamReviewStore, FileTeamRunStore, MemoryTeamArtifactBackend, MemoryTeamRunStore, TeamArtifactStore, TeamBindingError, TeamReviewRuntime, TeamRuntime, selectTeamHandoffs } from "../dist/team-ir/index.js";

function team() {
  return {
    schemaVersion: 2,
    team: { id: "demo", version: "1" },
    runInput: { dataSchema: { type: "object", properties: { prompt: { type: "string" }, kind: { type: "string" } }, required: ["prompt"], additionalProperties: false }, preferencesSchema: { type: "object" }, artifactSlots: {} },
    runResult: { dataSchema: { type: "object" }, artifactSlots: {} },
    executionPolicy: { resultMode: "allow_empty", activeExecutionBudgetMs: 5000 },
    agents: [{ id: "worker", packageRef: "role:worker@1", bindingRef: "binding:worker", inputPorts: { default: { dataSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false } } }, outputPorts: { DONE: { dataSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } } } }],
    handoffs: [
      { id: "start", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, when: { priority: 1 }, delivery: { deadlineMs: 2000 } },
      { id: "fallback", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, when: { condition: { op: "and", args: [{ op: "exists", args: [{ "$ref": "$.run.input.kind" }] }, { op: "equals", args: [{ "$ref": "$.run.input.kind" }, { "$literal": "fallback" }] }] }, priority: 0 }, delivery: { deadlineMs: 2000 } }
    ],
    orchestration: { routes: [{ from: { kind: "run" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["start", "fallback"] }], joins: [], loops: [], reviews: [] },
    bindings: [{ id: "binding:worker", kind: "model", modelRef: "models/default", attemptTimeoutMs: 1000, retry: { maxAttempts: 2, retryOn: ["transport", "timeout"], backoff: { mode: "constant", delayMs: 5 } } }]
  };
}

function setup(binding, clockOptions = {}) {
  let now = 100;
  const clock = {
    now: () => now,
    sleep: clockOptions.sleep ?? ((ms, signal) => new Promise((resolve) => {
      const timer = setTimeout(() => { now += ms; resolve(); }, 0);
      signal?.addEventListener("abort", () => clearTimeout(timer), { once: true });
    }))
  };
  const store = new MemoryTeamRunStore();
  const bindings = typeof binding?.invoke === "function" ? { "binding:worker": binding } : binding;
  return { clock, store, runtime: new TeamRuntime({ store, clock, bindings }) };
}

function withinTimeout(promise, label, timeoutMs = 5000) {
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

test("route selection evaluates conditions and exclusive priority deterministically", () => {
  const plan = compileTeamIr(team());
  assert.deepEqual(selectTeamHandoffs(plan, { kind: "run" }, {}, { task: "t", input: { prompt: "hi" } }), ["start"]);
  assert.deepEqual(selectTeamHandoffs(plan, { kind: "run" }, {}, { task: "t", input: { prompt: "hi", kind: "fallback" } }), ["fallback"]);
});

test("active Run resume rejects a changed compiled dependency digest without side effects", async () => {
  let calls = 0;
  const store = new MemoryTeamRunStore();
  const runtime = new TeamRuntime({
    store,
    clock: { now: () => 100, sleep: () => new Promise(() => {}) },
    bindings: { "binding:worker": { async invoke() { calls += 1; throw new Error("must not invoke"); } } }
  });
  const originalPlan = compileTeamIr(team(), { packageDigests: { "role:worker@1": "package-v1" } });
  const changedPlan = compileTeamIr(team(), { packageDigests: { "role:worker@1": "package-v2" } });
  await runtime.createRun(originalPlan, { runId: "changed-plan-run", task: "work", input: { prompt: "hello" } });
  await runtime.claim("changed-plan-run", originalPlan.compiledPlanDigest);
  const beforeResume = await store.load("changed-plan-run");

  await assert.rejects(runtime.executeRun(changedPlan, "changed-plan-run"), /compiledPlanDigest mismatch/);
  assert.deepEqual(await store.load("changed-plan-run"), beforeResume);
  assert.equal(calls, 0);
});

test("FileTeamRunStore recovery rejects package, Binding, adapter, and Schema digest drift before side effects", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-closure-drift-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseOptions = {
    packageDigests: { "role:worker@1": "package-v1" },
    bindingDigests: { "binding:worker": "binding-v1" },
    adapterVersions: { model: "adapter-v1" },
    schemaDigests: { "schemas/worker-output.json": "schema-v1" }
  };
  const driftCases = [
    ["package", (options) => { options.packageDigests["role:worker@1"] = "package-v2"; }],
    ["binding", (options) => { options.bindingDigests["binding:worker"] = "binding-v2"; }],
    ["adapter", (options) => { options.adapterVersions.model = "adapter-v2"; }],
    ["schema", (options) => { options.schemaDigests["schemas/worker-output.json"] = "schema-v2"; }]
  ];

  for (const [dimension, mutate] of driftCases) {
    let bindingCalls = 0;
    const runsRoot = join(root, dimension);
    const originalStore = new FileTeamRunStore(runsRoot);
    const bindings = { "binding:worker": { async invoke() {
      bindingCalls += 1;
      return { kind: "completed", output: { event: "DONE", data: { answer: "unexpected" } } };
    } } };
    const originalOptions = structuredClone(baseOptions);
    const changedOptions = structuredClone(baseOptions);
    mutate(changedOptions);
    const originalPlan = compileTeamIr(team(), originalOptions);
    const changedPlan = compileTeamIr(team(), changedOptions);
    assert.notEqual(originalPlan.compiledPlanDigest, changedPlan.compiledPlanDigest, `${dimension} drift must alter the plan digest`);

    const firstRuntime = new TeamRuntime({ store: originalStore, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
    const runId = `closure-drift-${dimension}`;
    await firstRuntime.createRun(originalPlan, { runId, task: "recover frozen closure", input: { prompt: "hello" } });
    await firstRuntime.claim(runId, originalPlan.compiledPlanDigest);
    const beforeRecovery = await originalStore.load(runId);

    const recoveryRuntime = new TeamRuntime({
      store: new FileTeamRunStore(runsRoot),
      clock: { now: () => 200, sleep: () => new Promise(() => {}) },
      bindings
    });
    await assert.rejects(recoveryRuntime.executeRun(changedPlan, runId), (error) =>
      error.name === "TeamRunConflictError" && error.message === "compiledPlanDigest mismatch",
    `${dimension} drift must fail recovery with the stable digest conflict`);
    assert.deepEqual(await originalStore.load(runId), beforeRecovery, `${dimension} drift must not mutate the persisted Run`);
    assert.equal(bindingCalls, 0, `${dimension} drift must be rejected before Binding invocation`);
  }
});

test("Runtime persists invocation, retries transport failure and completes once", async () => {
  let calls = 0;
  const { runtime, store } = setup({
    async invoke(args) {
      calls += 1;
      assert.equal(args.idempotencyKey, "run-1:start");
      if (calls === 1) throw new TeamBindingError("temporary", "transport");
      return { kind: "completed", output: { event: "DONE", data: { answer: "ok" } } };
    }
  });
  const plan = compileTeamIr(team());
  await runtime.createRun(plan, { runId: "run-1", task: "work", input: { prompt: "hello" } });
  const created = (await store.load("run-1")).events[0];
  assert.deepEqual(created.data, { compiledPlanDigest: plan.compiledPlanDigest });
  await runtime.claim("run-1", plan.compiledPlanDigest);
  const record = await runtime.executeHandoff(plan, "run-1", "start", { task: "work", input: { prompt: "hello" } });
  assert.equal(calls, 2);
  assert.equal(record.status, "running");
  assert.equal(record.invocations["run-1:start"].status, "completed");
  assert.equal(record.invocations["run-1:start"].attempt, 2);
  assert.equal((await store.load("run-1")).events.filter((item) => item.type === "handoff.completed").length, 1);
});

test("input-required pauses the Run and cannot be resumed by execution", async () => {
  const { runtime } = setup({ async invoke() { return { kind: "input-required", remoteTaskId: "remote-1", messageParts: [{ text: "more" }] }; } });
  const plan = compileTeamIr(team());
  await runtime.createRun(plan, { runId: "run-2", task: "work", input: { prompt: "hello" } });
  await runtime.claim("run-2", plan.compiledPlanDigest);
  const record = await runtime.executeHandoff(plan, "run-2", "start", { task: "work", input: { prompt: "hello" } });
  assert.equal(record.status, "paused_input_required");
  assert.equal(record.pendingInput.remoteTaskId, "remote-1");
  await assert.rejects(runtime.executeHandoff(plan, "run-2", "fallback", { task: "work", input: { prompt: "hello" } }), /Cannot execute Handoff/);
});

function a2aFanoutTeam() {
  const value = team();
  value.agents.push({
    id: "sibling", packageRef: "role:sibling@1", bindingRef: "binding:sibling",
    inputPorts: { default: structuredClone(value.agents[0].inputPorts.default) },
    outputPorts: structuredClone(value.agents[0].outputPorts)
  });
  value.handoffs = [
    { id: "remote-start", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, delivery: { deadlineMs: 2000 } },
    { id: "sibling-start", from: { kind: "run" }, to: { kind: "agent", agentId: "sibling", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, delivery: { deadlineMs: 2000 } }
  ];
  value.orchestration.routes = [{ from: { kind: "run" }, mode: "parallel_fanout", onNoMatch: "fail", handoffIds: ["remote-start", "sibling-start"] }];
  value.bindings[0] = { id: "binding:worker", kind: "a2a", agentCardRef: "https://agents.example/reviewer/card.json", attemptTimeoutMs: 1000, retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } } };
  value.bindings.push({ id: "binding:sibling", kind: "model", modelRef: "models/default", attemptTimeoutMs: 1000, retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } } });
  return value;
}

test("A2A input-required durably pauses, cancels fanout siblings, rejects resume, and requires a new Run for changed input", async () => {
  let remoteCalls = 0;
  let siblingCalls = 0;
  let siblingCancels = 0;
  const remote = createTeamA2ABinding({
    expectedProtocolVersion: "1.0", expectedAgentVersion: "v1", sleep: async () => {},
    client: {
      async getAgentCard() {
        return { protocolVersion: "1.0", name: "Reviewer", version: "v1", defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"], capabilities: { streaming: false, pushNotifications: false } };
      },
      async sendMessage() {
        remoteCalls += 1;
        return remoteCalls === 1
          ? { id: "remote-task-1", status: "input-required", messageParts: [{ text: "Need scope" }], requestedInputSchema: { type: "object", required: ["scope"] } }
          : { id: "remote-task-2", status: "completed", result: { event: "DONE", data: { answer: "reviewed" } } };
      },
      async getTask() { throw new Error("not expected"); },
      async cancelTask() { return true; }
    }
  });
  let rejectSibling;
  const siblingBinding = {
    invoke() {
      siblingCalls += 1;
      if (siblingCalls > 1) return Promise.resolve({ kind: "completed", output: { event: "DONE", data: { answer: "sibling done" } } });
      return new Promise((_resolve, reject) => { rejectSibling = reject; });
    },
    async cancel() {
      siblingCancels += 1;
      rejectSibling(new TeamBindingError("sibling canceled", "cancelled"));
      return true;
    }
  };
  const { runtime, store } = setup({ "binding:worker": remote, "binding:sibling": siblingBinding }, { sleep: () => new Promise(() => {}) });
  const plan = compileTeamIr(a2aFanoutTeam());
  await runtime.createRun(plan, { runId: "a2a-paused", task: "Review", input: { prompt: "review this" } });
  const paused = await runtime.executeRun(plan, "a2a-paused");
  assert.equal(paused.status, "paused_input_required");
  assert.deepEqual(paused.pendingInput, {
    handoffId: "remote-start", agentId: "worker", bindingId: "binding:worker", remoteTaskId: "remote-task-1",
    kind: "input-required",
    messageParts: [{ text: "Need scope" }], requestedInputSchema: { type: "object", required: ["scope"] }
  });
  assert.equal(siblingCancels, 1);
  assert.equal(paused.invocations["a2a-paused:sibling-start"].status, "cancelled");
  assert.equal(paused.invocations["a2a-paused:sibling-start"].outcomeUnknown, false);
  assert.ok(paused.events.some((item) => item.type === "invocation.cancelled_for_input_required"));
  assert.equal((await store.load("a2a-paused")).status, "paused_input_required");
  await assert.rejects(runtime.executeRun(plan, "a2a-paused"), /TEAM_RUN_INPUT_REQUIRED_NEW_RUN/);
  await assert.rejects(runtime.executeHandoff(plan, "a2a-paused", "remote-start", { task: "changed", input: { prompt: "new scope" } }), /Cannot execute Handoff/);

  await runtime.createRun(plan, { runId: "a2a-new-run", task: "Review with scope", input: { prompt: "review with clarified scope" } });
  const completed = await runtime.executeRun(plan, "a2a-new-run");
  assert.equal(completed.status, "completed");
  assert.equal(completed.runInput.input.prompt, "review with clarified scope");
  assert.equal(remoteCalls, 2);
});

test("timeout starts failure intent; cancellation and failure settle only their winning intent", async () => {
  const { runtime } = setup({ async invoke() { return new Promise(() => {}); } });
  const plan = compileTeamIr(team());
  await runtime.createRun(plan, { runId: "run-3", task: "work", input: { prompt: "hello" } });
  await runtime.claim("run-3", plan.compiledPlanDigest);
  const timed = await runtime.executeHandoff(plan, "run-3", "start", { task: "work", input: { prompt: "hello" } });
  assert.equal(timed.status, "failing");
  assert.equal((await runtime.settle("run-3")).status, "failed");

  await runtime.createRun(plan, { runId: "run-4", task: "work", input: { prompt: "hello" } });
  await runtime.claim("run-4", plan.compiledPlanDigest);
  await runtime.cancel("run-4");
  assert.equal((await runtime.settle("run-4")).status, "cancelled");
});

test("unconfirmed timeout cancellation records unknown outcome and does not retry", async () => {
  let calls = 0;
  const { runtime } = setup({
    async invoke() {
      calls += 1;
      return new Promise(() => {});
    }
  });
  const plan = compileTeamIr(team());
  await runtime.createRun(plan, { runId: "run-5", task: "work", input: { prompt: "hello" } });
  await runtime.claim("run-5", plan.compiledPlanDigest);
  const record = await runtime.executeHandoff(plan, "run-5", "start", { task: "work", input: { prompt: "hello" } });
  assert.equal(calls, 1);
  assert.equal(record.status, "failing");
  assert.equal(record.invocations["run-5:start"].outcomeUnknown, true);
  assert.equal((await runtime.settle("run-5")).status, "failed");
});

test("invalid mapped input fails before Binding invocation and invalid output fails before delivery", async () => {
  const inputTeam = team();
  inputTeam.agents[0].inputPorts.default.dataSchema.properties.prompt.minLength = 3;
  let inputCalls = 0;
  const inputSetup = setup({ async invoke() { inputCalls += 1; return { kind: "completed", output: { event: "DONE", data: { answer: "ok" } } }; } });
  const inputPlan = compileTeamIr(inputTeam);
  await inputSetup.runtime.createRun(inputPlan, { runId: "run-6", task: "work", input: { prompt: "hi" } });
  await inputSetup.runtime.claim("run-6", inputPlan.compiledPlanDigest);
  const inputFailed = await inputSetup.runtime.executeHandoff(inputPlan, "run-6", "start", { task: "different", input: { prompt: "unused" } });
  assert.equal(inputCalls, 0);
  assert.equal(inputFailed.status, "failing");

  const outputSetup = setup({ async invoke() { return { kind: "completed", output: { event: "DONE", data: {} } }; } });
  const outputPlan = compileTeamIr(team());
  await outputSetup.runtime.createRun(outputPlan, { runId: "run-7", task: "work", input: { prompt: "hello" } });
  await outputSetup.runtime.claim("run-7", outputPlan.compiledPlanDigest);
  await outputSetup.runtime.executeHandoff(outputPlan, "run-7", "start", { task: "work", input: { prompt: "hello" } });
  const failed = await outputSetup.store.load("run-7");
  assert.equal(failed.status, "failing");
  assert.equal(failed.invocations["run-7:start"].status, "failed");
});

test("executeRun schedules the classic software Team through fanout, Join, and one result write", async () => {
  const fixture = JSON.parse(await readFile(new URL("../examples/team-ir-v2/classic-software-team.json", import.meta.url), "utf8"));
  const plan = compileTeamIr(fixture);
  const calls = [];
  const responses = {
    planner: { event: "PLAN", data: { plan: "Implement the request." } },
    implementer: { event: "IMPLEMENTED", data: { changes: "Implemented the requested change." } },
    tester: { event: "TESTED", data: { tests: "All checks passed." } },
    lead: { event: "DELIVERED", data: { summary: "Implemented and verified." } }
  };
  const bindings = Object.fromEntries(Object.entries(responses).map(([agentId, output]) => [
    `binding:${agentId}`,
    { async invoke(args) { calls.push({ agentId, input: args.input }); return { kind: "completed", output }; } }
  ]));
  const { runtime, store } = setup(bindings);
  await runtime.createRun(plan, { runId: "classic-run", task: "Implement a small change", input: { request: "Add a greeting endpoint" } });
  const result = await runtime.executeRun(plan, "classic-run");
  assert.equal(result.status, "completed", JSON.stringify(result.events.map((item) => [item.type, item.data])));
  assert.deepEqual(result.result, { summary: "Implemented and verified." });
  assert.equal(result.events.filter((item) => item.type === "run.result.written").length, 1);
  assert.deepEqual(calls.map((item) => item.agentId).sort(), ["implementer", "lead", "planner", "tester"]);
  const lead = calls.find((item) => item.agentId === "lead");
  assert.deepEqual(lead.input, { changes: "Implemented the requested change.", tests: "All checks passed." });
  assert.equal((await store.load("classic-run")).status, "completed");
});

test("classic software Team retries a transient planner failure before completing the joined Result", async () => {
  const fixture = JSON.parse(await readFile(new URL("../examples/team-ir-v2/classic-software-team.json", import.meta.url), "utf8"));
  const plan = compileTeamIr(fixture);
  const attempts = { planner: 0 };
  const outputs = {
    implementer: { event: "IMPLEMENTED", data: { changes: "Implemented the requested change." } },
    tester: { event: "TESTED", data: { tests: "All checks passed." } },
    lead: { event: "DELIVERED", data: { summary: "Implemented and verified." } }
  };
  const bindings = Object.fromEntries(Object.entries(outputs).map(([agentId, output]) => [
    `binding:${agentId}`,
    { async invoke() { return { kind: "completed", output }; } }
  ]));
  bindings["binding:planner"] = {
    async invoke() {
      attempts.planner += 1;
      if (attempts.planner === 1) throw new TeamBindingError("temporary upstream error", "transport");
      return { kind: "completed", output: { event: "PLAN", data: { plan: "Implement the request." } } };
    }
  };
  const { runtime, store } = setup(bindings);
  await runtime.createRun(plan, { runId: "classic-retry", task: "Implement a small change", input: { request: "Add a greeting endpoint" } });
  const result = await runtime.executeRun(plan, "classic-retry");

  assert.equal(result.status, "completed", JSON.stringify(result.events.filter((item) => item.type === "run.failing")));
  assert.equal(result.invocations["classic-retry:run-to-planner"].attempt, 2);
  assert.equal(attempts.planner, 2);
  assert.deepEqual(result.result, { summary: "Implemented and verified." });
  assert.equal(result.events.filter((item) => item.type === "run.result.written").length, 1);
  assert.equal((await store.load("classic-retry")).status, "completed");
});

test("a cancellation intent that wins the Result CAS race prevents Result commit", async () => {
  const backing = new MemoryTeamRunStore();
  let reachedResultCommit;
  const resultCommitReached = new Promise((resolve) => { reachedResultCommit = resolve; });
  let releaseResultCommit;
  const resultCommitGate = new Promise((resolve) => { releaseResultCommit = resolve; });
  let paused = false;
  const store = {
    create: (record) => backing.create(record),
    load: (runId) => backing.load(runId),
    async compareAndSet(runId, expectedRevision, record) {
      if (record.status === "completed" && record.resultWritten && !paused) {
        paused = true;
        reachedResultCommit();
        await resultCommitGate;
      }
      return backing.compareAndSet(runId, expectedRevision, record);
    }
  };
  const runtime = new TeamRuntime({
    store,
    clock: { now: () => 100, sleep: () => new Promise(() => {}) },
    bindings: { "binding:worker": { async invoke() { return { kind: "completed", output: { event: "DONE", data: { answer: "late" } } }; } } }
  });
  const value = team();
  value.handoffs.push({ id: "result", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } } });
  const plan = compileTeamIr(value);
  await runtime.createRun(plan, { runId: "result-cancel-race", task: "race", input: { prompt: "check" } });
  const execution = runtime.executeRun(plan, "result-cancel-race");
  await resultCommitReached;
  const cancelled = await runtime.cancel("result-cancel-race");
  assert.equal(cancelled.status, "cancelling");
  releaseResultCommit();
  await assert.rejects(execution, /Cannot complete Run in cancelling/);
  const persisted = await store.load("result-cancel-race");
  assert.equal(persisted.status, "cancelling");
  assert.equal(persisted.resultWritten, undefined);
  assert.equal(persisted.result, undefined);
  assert.deepEqual(persisted.pendingResult, { value: { answer: "late" }, handoffId: "result" });
  assert.equal(persisted.events.some((item) => item.type === "run.result.written"), false);
  const settled = await runtime.settle("result-cancel-race");
  assert.equal(settled.status, "cancelled");
  assert.equal(settled.pendingResult, undefined);
  assert.equal(settled.resultWritten, undefined);
  assert.equal(settled.result, undefined);
  assert.equal(settled.events.some((item) => item.type === "run.result.written"), false);
});

test("a crash before terminal commit keeps Result private and recovery commits it without repeating the Binding", async () => {
  const backing = new MemoryTeamRunStore();
  let failTerminalCommit = true;
  const store = {
    create: (record) => backing.create(record),
    load: (runId) => backing.load(runId),
    async compareAndSet(runId, expectedRevision, record) {
      if (record.status === "completed" && failTerminalCommit) {
        failTerminalCommit = false;
        throw new Error("simulated crash before terminal commit");
      }
      return backing.compareAndSet(runId, expectedRevision, record);
    }
  };
  let calls = 0;
  const runtime = new TeamRuntime({
    store,
    clock: { now: () => 100, sleep: () => new Promise(() => {}) },
    bindings: { "binding:worker": { async invoke() { calls += 1; return { kind: "completed", output: { event: "DONE", data: { answer: "durable" } } }; } } }
  });
  const value = team();
  value.handoffs.push({ id: "result", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } } });
  const plan = compileTeamIr(value);
  await runtime.createRun(plan, { runId: "result-crash-recovery", task: "recover", input: { prompt: "check" } });
  await assert.rejects(runtime.executeRun(plan, "result-crash-recovery"), /simulated crash/);
  const interrupted = await backing.load("result-crash-recovery");
  assert.equal(interrupted.status, "running");
  assert.equal(interrupted.result, undefined, JSON.stringify(interrupted));
  assert.equal(interrupted.resultWritten, undefined);
  assert.deepEqual(interrupted.pendingResult, { value: { answer: "durable" }, handoffId: "result" });
  const recovered = await new TeamRuntime({ store: backing, clock: { now: () => 200, sleep: () => new Promise(() => {}) }, bindings: { "binding:worker": { async invoke() { calls += 1; throw new Error("must not replay"); } } } }).executeRun(plan, "result-crash-recovery");
  assert.equal(recovered.status, "completed");
  assert.deepEqual(recovered.result, { answer: "durable" });
  assert.equal(recovered.resultWritten, true);
  assert.equal(recovered.pendingResult, undefined);
  assert.equal(calls, 1);
  assert.equal(recovered.events.filter((item) => item.type === "run.result.written").length, 1);
  assert.equal(recovered.events.filter((item) => item.type === "run.completed").length, 1);
});

test("Join tracks selected and skipped Handoffs separately when candidates share one source endpoint", async () => {
  const value = team();
  const agent = (id, inputSchema, outputSchema) => ({
    id, packageRef: `role:${id}@1`, bindingRef: `binding:${id}`,
    inputPorts: { default: { dataSchema: inputSchema } },
    outputPorts: { DONE: { dataSchema: outputSchema } }
  });
  value.agents = [
    agent("left", { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false },
      { type: "object", properties: { include: { type: "boolean" }, value: { type: "string" } }, required: ["include", "value"], additionalProperties: false }),
    agent("right", { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false },
      { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false }),
    agent("joiner", { type: "object", properties: { leftValue: { type: "string" }, otherLeftValue: { type: "string" }, rightValue: { type: "string" } }, required: [], additionalProperties: false },
      { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false })
  ];
  value.handoffs = [
    { id: "start-left", from: { kind: "run" }, to: { kind: "agent", agentId: "left", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, delivery: { deadlineMs: 2000 } },
    { id: "start-right", from: { kind: "run" }, to: { kind: "agent", agentId: "right", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, delivery: { deadlineMs: 2000 } },
    { id: "left-join", from: { kind: "agent", agentId: "left", outputPort: "DONE" }, to: { kind: "agent", agentId: "joiner", inputPort: "default" }, map: { data: { leftValue: { "$ref": "$.output.data.value" } } }, when: { condition: { op: "equals", args: [{ "$ref": "$.output.data.include" }, { "$literal": true }] }, priority: 0 }, delivery: { deadlineMs: 2000 } },
    { id: "left-other", from: { kind: "agent", agentId: "left", outputPort: "DONE" }, to: { kind: "agent", agentId: "joiner", inputPort: "default" }, map: { data: { otherLeftValue: { "$ref": "$.output.data.value" } } }, when: { condition: { op: "equals", args: [{ "$ref": "$.output.data.include" }, { "$literal": false }] }, priority: 1 }, delivery: { deadlineMs: 2000 } },
    { id: "right-join", from: { kind: "agent", agentId: "right", outputPort: "DONE" }, to: { kind: "agent", agentId: "joiner", inputPort: "default" }, map: { data: { rightValue: { "$ref": "$.output.data.value" } } }, delivery: { deadlineMs: 2000 } },
    { id: "join-result", from: { kind: "agent", agentId: "joiner", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { summary: { "$ref": "$.output.data.summary" } } } }
  ];
  value.orchestration = {
    routes: [
      { from: { kind: "run" }, mode: "parallel_fanout", onNoMatch: "fail", handoffIds: ["start-left", "start-right"] },
      { from: { kind: "agent", agentId: "left", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "finish", handoffIds: ["left-join", "left-other"] }
    ],
    joins: [{ id: "optional-join", agentId: "joiner", inputPort: "default", mode: "all_of", handoffIds: ["left-join", "left-other", "right-join"], scope: { kind: "run" }, timeoutMs: 2000, onTimeout: "fail" }],
    loops: [], reviews: []
  };
  value.runResult.dataSchema = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false };
  value.executionPolicy.resultMode = "required";
  value.bindings = value.agents.map((item) => ({ id: item.bindingRef, kind: "model", modelRef: "models/default", attemptTimeoutMs: 1000, retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } } }));
  const seenJoinInputs = [];
  const bindings = Object.fromEntries(value.agents.map((item) => [`binding:${item.id}`, {
    async invoke() {
      if (item.id === "left") return { kind: "completed", output: { event: "DONE", data: { include: false, value: "omit" } } };
      if (item.id === "right") return { kind: "completed", output: { event: "DONE", data: { value: "keep" } } };
      return { kind: "completed", output: { event: "DONE", data: { summary: "joined" } } };
    }
  }]));
  const originalJoinInvoke = bindings["binding:joiner"].invoke;
  bindings["binding:joiner"].invoke = async (invocation) => {
    seenJoinInputs.push(invocation.input);
    return originalJoinInvoke();
  };
  let plan;
  try { plan = compileTeamIr(value); } catch (error) { throw new Error(JSON.stringify(error.diagnostics || error.issues || error.message)); }
  const store = new MemoryTeamRunStore();
  const runtime = new TeamRuntime({ store, clock: { now: () => 10, sleep: () => new Promise(() => {}) }, bindings });
  await runtime.createRun(plan, { runId: "optional-join", task: "check", input: { prompt: "check" } });
  const completed = await runtime.executeRun(plan, "optional-join");
  assert.equal(completed.status, "completed", JSON.stringify(completed.events.filter((entry) => entry.type === "run.failing")));
  assert.deepEqual(seenJoinInputs, [{ otherLeftValue: "omit", rightValue: "keep" }]);
  assert.equal(completed.scheduler.skippedHandoffs.includes("left-join"), true);
  assert.equal(completed.scheduler.arrivedHandoffs.includes("left-other"), true);

  value.agents[2].inputPorts.default.dataSchema.required = ["leftValue"];
  assert.throws(() => compileTeamIr(value), /Team IR compilation failed/);
});

function quorumTeam({ threshold = 1, conditionalLeft = false } = {}) {
  const value = team();
  const agent = (id, properties, required, outputProperties, outputRequired) => ({
    id, packageRef: `role:${id}@1`, bindingRef: `binding:${id}`,
    inputPorts: { default: { dataSchema: { type: "object", properties, required, additionalProperties: false } } },
    outputPorts: { DONE: { dataSchema: { type: "object", properties: outputProperties, required: outputRequired, additionalProperties: false } } }
  });
  value.agents = [
    agent("left", { prompt: { type: "string" } }, ["prompt"], { value: { type: "string" }, include: { type: "boolean" } }, ["value", "include"]),
    agent("right", { prompt: { type: "string" } }, ["prompt"], { value: { type: "string" } }, ["value"]),
    agent("joiner", { leftValue: { type: "string" }, rightValue: { type: "string" } }, [], { summary: { type: "string" } }, ["summary"])
  ];
  const joinWhen = conditionalLeft
    ? { condition: { op: "equals", args: [{ "$ref": "$.output.data.include" }, { "$literal": true }] }, priority: 0 }
    : undefined;
  value.handoffs = [
    { id: "start-left", from: { kind: "run" }, to: { kind: "agent", agentId: "left", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, delivery: { deadlineMs: 2000 } },
    { id: "start-right", from: { kind: "run" }, to: { kind: "agent", agentId: "right", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, delivery: { deadlineMs: 2000 } },
    { id: "left-join", from: { kind: "agent", agentId: "left", outputPort: "DONE" }, to: { kind: "agent", agentId: "joiner", inputPort: "default" }, map: { data: { leftValue: { "$ref": "$.output.data.value" } } }, when: joinWhen ?? { priority: 0 }, delivery: { deadlineMs: 2000 } },
    { id: "right-join", from: { kind: "agent", agentId: "right", outputPort: "DONE" }, to: { kind: "agent", agentId: "joiner", inputPort: "default" }, map: { data: { rightValue: { "$ref": "$.output.data.value" } } }, when: { priority: 0 }, delivery: { deadlineMs: 2000 } },
    { id: "join-result", from: { kind: "agent", agentId: "joiner", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { summary: { "$ref": "$.output.data.summary" } } }, when: { priority: 0 } }
  ];
  value.orchestration = {
    routes: [
      { from: { kind: "run" }, mode: "parallel_fanout", onNoMatch: "fail", handoffIds: ["start-left", "start-right"] },
      { from: { kind: "agent", agentId: "left", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "finish", handoffIds: ["left-join"] },
      { from: { kind: "agent", agentId: "right", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "finish", handoffIds: ["right-join"] },
      { from: { kind: "agent", agentId: "joiner", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "finish", handoffIds: ["join-result"] }
    ],
    joins: [{ id: "quorum", agentId: "joiner", inputPort: "default", mode: "quorum_of", threshold, handoffIds: ["left-join", "right-join"], scope: { kind: "run" }, timeoutMs: 1500, onTimeout: "fail" }],
    loops: [], reviews: []
  };
  value.runResult.dataSchema = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false };
  value.executionPolicy.resultMode = "required";
  value.bindings = value.agents.map((item) => ({ id: item.bindingRef, kind: "model", modelRef: "models/default", attemptTimeoutMs: 1000, retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } } }));
  return value;
}

function joinTimeoutTeam(mode = "all_of") {
  const value = quorumTeam({ threshold: mode === "quorum_of" ? 2 : 1 });
  const join = value.orchestration.joins[0];
  join.mode = mode;
  join.timeoutMs = 50;
  if (mode === "all_of") delete join.threshold;
  return value;
}

function joinTimeoutBindings({ leftCompletes = true, cancels }) {
  return {
    "binding:left": { async invoke() {
      if (!leftCompletes) return new Promise(() => {});
      return { kind: "completed", output: { event: "DONE", data: { value: "left", include: true } } };
    } },
    "binding:right": {
      async invoke() { return new Promise(() => {}); },
      async cancel() { cancels.right += 1; return true; }
    },
    "binding:joiner": { async invoke() { throw new Error("Join target must not run after timeout"); } }
  };
}

for (const mode of ["all_of", "quorum_of"]) {
  test(`${mode} Join timeout is enforced by the scheduler and cancels an active source`, async () => {
    const plan = compileTeamIr(joinTimeoutTeam(mode));
    const clock = fakeClock(100);
    const store = new MemoryTeamRunStore();
    const cancels = { right: 0 };
    const runtime = new TeamRuntime({ store, clock, bindings: joinTimeoutBindings({ cancels }) });
    await runtime.createRun(plan, { runId: `join-timeout-${mode}`, task: "check", input: { prompt: "check" } });
    const running = runtime.executeRun(plan, `join-timeout-${mode}`);
    await until(() => store.load(`join-timeout-${mode}`).then((record) => record.scheduler?.joinRounds?.quorum?.deadlineAt !== undefined
      && record.invocations[`join-timeout-${mode}:start-right`]?.status === "running"), `${mode} persisted deadline and slow source activation`);
    const started = await store.load(`join-timeout-${mode}`);
    assert.equal(started.scheduler.joinRounds.quorum.deadlineAt, 150);
    clock.advanceTo(150);
    const result = await withinTimeout(running, `${mode} timeout settlement`);
    assert.equal(result.status, "failed");
    assert.equal(result.events.some((entry) => entry.type === "run.failing" && entry.data?.code === "JOIN_TIMEOUT"), true);
    assert.equal(result.scheduler.joinRounds.quorum.failure.code, "JOIN_TIMEOUT");
    assert.equal(cancels.right, 1);
    assert.equal(result.invocations[`join-timeout-${mode}:start-right`].status, "failed");
  });
}

test("pausing for required input disarms the process-local Join timer but preserves its deadline", async () => {
  const plan = compileTeamIr(joinTimeoutTeam("all_of"));
  const clock = fakeClock(100);
  const store = new MemoryTeamRunStore();
  const cancels = { right: 0 };
  const bindings = joinTimeoutBindings({ cancels });
  let rejectRight;
  bindings["binding:right"].invoke = async () => new Promise((_resolve, reject) => { rejectRight = reject; });
  bindings["binding:right"].cancel = async () => {
    cancels.right += 1;
    rejectRight(new Error("canceled after input required"));
    return true;
  };
  bindings["binding:left"].invoke = async () => ({
    kind: "input-required", remoteTaskId: "remote-input", messageParts: [], requestedInputSchema: { type: "object" }
  });
  const runtime = new TeamRuntime({ store, clock, bindings });
  await runtime.createRun(plan, { runId: "join-timeout-paused", task: "check", input: { prompt: "check" } });
  const paused = await runtime.executeRun(plan, "join-timeout-paused");
  assert.equal(paused.status, "paused_input_required");
  assert.equal(paused.scheduler.joinRounds.quorum.deadlineAt, 150);
  assert.equal(clock.sleepers.size, 0);
  assert.equal(cancels.right, 1);
});

test("FileTeamRunStore recovery arms a collecting Join with only its persisted remaining deadline", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-join-timeout-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runId = "join-timeout-recovery";
  const plan = compileTeamIr(joinTimeoutTeam("quorum_of"));
  const clock = fakeClock(125);
  const store = new FileTeamRunStore(root);
  const cancels = { right: 0 };
  const bindings = joinTimeoutBindings({ cancels });
  const firstRuntime = new TeamRuntime({ store, clock, bindings });
  await firstRuntime.createRun(plan, { runId, task: "check", input: { prompt: "check" } });
  await firstRuntime.claim(runId, plan.compiledPlanDigest);
  const round = applyTeamJoinEvent(createTeamJoinRound({
    joinId: "quorum", runId, lineage: "run", mode: "quorum_of", threshold: 2,
    handoffIds: ["left-join", "right-join"], timeoutMs: 50
  }), { type: "predecessor_activated", at: 100 });
  const checkpoint = await store.load(runId);
  const expectedRevision = checkpoint.revision;
  checkpoint.scheduler.joinRounds = { quorum: round };
  checkpoint.revision = expectedRevision + 1;
  assert.equal(await store.compareAndSet(runId, expectedRevision, checkpoint), true);

  const recovered = new TeamRuntime({ store: new FileTeamRunStore(root), clock, bindings });
  const running = recovered.executeRun(plan, runId);
  await until(() => store.load(runId).then((record) => record.invocations[`${runId}:start-right`]?.status === "running"), "recovered slow source activation");
  const restored = await store.load(runId);
  assert.equal(restored.scheduler.joinRounds.quorum.startedAt, 100);
  assert.equal(restored.scheduler.joinRounds.quorum.deadlineAt, 150);
  clock.advanceTo(149);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await store.load(runId)).status, "running");
  assert.equal(cancels.right, 0);
  clock.advanceTo(150);
  const result = await withinTimeout(running, "recovered Join timeout settlement");
  assert.equal(result.status, "failed");
  assert.equal(result.events.some((entry) => entry.type === "run.failing" && entry.data?.code === "JOIN_TIMEOUT"), true);
  assert.equal(cancels.right, 1);
});

test("Join timeout confirmed during invocation publication prevents the Binding from starting", async () => {
  for (const cancellationConfirmed of [true, false]) {
    const runId = `join-timeout-publish-cancel-${cancellationConfirmed ? "confirmed" : "unconfirmed"}`;
    const rightInvocationId = `${runId}:start-right`;
    const backing = new MemoryTeamRunStore();
    let reachedRunningCheckpoint;
    const runningCheckpointReached = new Promise((resolve) => { reachedRunningCheckpoint = resolve; });
    let releaseRunningCheckpoint;
    const runningCheckpointGate = new Promise((resolve) => { releaseRunningCheckpoint = resolve; });
    let checkpointPaused = false;
    const store = {
      create: (record) => backing.create(record),
      load: (id) => backing.load(id),
      async compareAndSet(id, revision, record) {
        const committed = await backing.compareAndSet(id, revision, record);
        if (committed && id === runId && !checkpointPaused
          && record.invocations?.[rightInvocationId]?.status === "running"
          && record.invocations[rightInvocationId].attempt === 0) {
          checkpointPaused = true;
          reachedRunningCheckpoint();
          await runningCheckpointGate;
        }
        return committed;
      }
    };
    const clock = fakeClock(100);
    let rightCalls = 0;
    let finishRight;
    const rightResponse = new Promise((resolve) => { finishRight = resolve; });
    let cancelRight;
    const rightCancellationAttempted = new Promise((resolve) => { cancelRight = resolve; });
    const cancels = { right: 0 };
    const bindings = {
      "binding:left": { async invoke() { return { kind: "completed", output: { event: "DONE", data: { value: "first", include: true } } }; } },
      "binding:right": {
        async invoke() { rightCalls += 1; return rightResponse; },
        async cancel() { cancels.right += 1; cancelRight(); return cancellationConfirmed; }
      },
      "binding:joiner": { async invoke() { throw new Error("Join target must not run after timeout"); } }
    };
    const plan = compileTeamIr(joinTimeoutTeam("quorum_of"));
    const runtime = new TeamRuntime({ store, clock, bindings });
    await runtime.createRun(plan, { runId, task: "check", input: { prompt: "check" } });
    const running = runtime.executeRun(plan, runId);
    try {
      await withinTimeout(runningCheckpointReached, "right running checkpoint publication");
      assert.equal(rightCalls, 0, "the Binding has not started while its running checkpoint is being published");
      clock.advanceTo(150);
      await withinTimeout(rightCancellationAttempted, "cancellation attempt in the publication window");
    } finally {
      releaseRunningCheckpoint();
    }

    if (!cancellationConfirmed) {
      await until(() => rightCalls === 1, "unconfirmed cancellation leaves the Binding active");
      finishRight({ kind: "completed", output: { event: "DONE", data: { value: "late" } } });
    }
    const result = await withinTimeout(running, "Run settlement after publication-window cancellation");
    assert.equal(result.status, "failed");
    assert.equal(result.scheduler.joinRounds.quorum.failure.code, "JOIN_TIMEOUT");
    assert.equal(result.invocations[rightInvocationId].status, "failed");
    assert.equal(rightCalls, cancellationConfirmed ? 0 : 1,
      cancellationConfirmed ? "confirmed cancellation before Binding start must not invoke it later" : "unconfirmed cancellation must not suppress an active Binding");
    assert.equal(cancels.right, 1);
  }
});

async function assertUnsupportedQuorumFailsBeforeBinding(teamValue, runId) {
  let calls = 0;
  let plan;
  try { plan = compileTeamIr(teamValue); } catch (error) { throw new Error(JSON.stringify(error.diagnostics || error.issues || error.message)); }
  const bindings = Object.fromEntries(teamValue.agents.map((agent) => [agent.bindingRef, {
    async invoke() {
      calls += 1;
      return { kind: "completed", output: { event: "DONE", data: { answer: "unexpected" } } };
    }
  }]));
  const store = new MemoryTeamRunStore();
  const runtime = new TeamRuntime({ store, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  await runtime.createRun(plan, { runId, task: "check", input: { prompt: "check" } });
  const result = await runtime.executeRun(plan, runId);
  assert.equal(result.status, "failed");
  assert.equal(result.events.some((entry) => entry.type === "run.failing" && entry.data?.code === "TEAM_QUORUM_TOPOLOGY_UNSUPPORTED"), true);
  assert.equal(calls, 0);
}

test("quorum Join starts at threshold and persists the selected contributions and original deadline across FileTeamRunStore instances", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-quorum-run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let plan;
  try { plan = compileTeamIr(quorumTeam()); } catch (error) { throw new Error(JSON.stringify(error.diagnostics || error.issues || error.message)); }
  let releaseRight;
  let rightStarted;
  const rightStartedPromise = new Promise((resolve) => { rightStarted = resolve; });
  let joinStarted;
  const joinStartedPromise = new Promise((resolve) => { joinStarted = resolve; });
  const calls = [];
  const bindings = {
    "binding:left": { async invoke() { return { kind: "completed", output: { event: "DONE", data: { value: "first", include: true } } }; } },
    "binding:right": { async invoke() { rightStarted(); await new Promise((resolve) => { releaseRight = resolve; }); return { kind: "completed", output: { event: "DONE", data: { value: "late" } } }; } },
    "binding:joiner": { async invoke(args) { calls.push(args.input); joinStarted(); return { kind: "completed", output: { event: "DONE", data: { summary: "joined" } } }; } }
  };
  const store = new FileTeamRunStore(root);
  const runtime = new TeamRuntime({ store, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  await runtime.createRun(plan, { runId: "quorum-early", task: "check", input: { prompt: "check" } });
  const running = runtime.executeRun(plan, "quorum-early");
  try {
    await withinTimeout(rightStartedPromise, "right source activation");
    await withinTimeout(joinStartedPromise, "quorum target activation");
    assert.deepEqual(calls, [{ leftValue: "first" }]);
  } finally {
    releaseRight?.();
    await withinTimeout(running.catch(() => undefined), "quorum Run settlement");
  }
  const result = await running;
  assert.equal(result.status, "completed", JSON.stringify(result.events.map((entry) => [entry.type, entry.data])));
  assert.equal(calls.length, 1);
  const reloaded = await new FileTeamRunStore(root).load("quorum-early");
  const round = reloaded.scheduler.joinRounds.quorum;
  assert.equal(round.status, "ready");
  assert.deepEqual(round.merged.data, { leftValue: "first" });
  assert.equal(round.deadlineAt, round.startedAt + 1500);
  assert.equal(round.audit.some((entry) => entry.type === "join.source.late_arrival" && entry.sourceId === "right-join"), true);
});

test("quorum Join fails when conditional source skips make the threshold unreachable", async () => {
  let plan;
  try { plan = compileTeamIr(quorumTeam({ threshold: 2, conditionalLeft: true })); } catch (error) { throw new Error(JSON.stringify(error.diagnostics || error.issues || error.message)); }
  const bindings = {
    "binding:left": { async invoke() { return { kind: "completed", output: { event: "DONE", data: { value: "omit", include: false } } }; } },
    "binding:right": { async invoke() { return { kind: "completed", output: { event: "DONE", data: { value: "only" } } }; } },
    "binding:joiner": { async invoke() { throw new Error("unreachable Join target must not run"); } }
  };
  const store = new MemoryTeamRunStore();
  const runtime = new TeamRuntime({ store, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  await runtime.createRun(plan, { runId: "quorum-unreachable", task: "check", input: { prompt: "check" } });
  const result = await runtime.executeRun(plan, "quorum-unreachable");
  assert.equal(result.status, "failed");
  assert.equal(result.events.some((entry) => entry.type === "run.failing" && entry.data?.code === "JOIN_QUORUM_UNREACHABLE"), true);
});

test("quorum topologies outside the single no-Loop Join contract fail before any Binding call", async () => {
  const withLoop = quorumTeam();
  withLoop.handoffs = withLoop.handoffs.filter((handoff) => handoff.id !== "join-result");
  withLoop.orchestration.routes = withLoop.orchestration.routes.filter((route) => route.from.kind !== "agent" || route.from.agentId !== "joiner");
  withLoop.agents.push({
    id: "loop-worker", packageRef: "role:loop-worker@1", bindingRef: "binding:loop-worker",
    inputPorts: {
      default: { dataSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false } },
      revise: { dataSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } }
    },
    outputPorts: { DONE: { dataSchema: { type: "object", properties: { answer: { type: "string" }, again: { type: "boolean" } }, required: ["answer", "again"], additionalProperties: false } } }
  });
  withLoop.handoffs.push(
    { id: "loop-entry", from: { kind: "run" }, to: { kind: "agent", agentId: "loop-worker", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, delivery: { deadlineMs: 2000 } },
    { id: "loop-continue", from: { kind: "agent", agentId: "loop-worker", outputPort: "DONE" }, to: { kind: "agent", agentId: "loop-worker", inputPort: "revise" }, map: { data: { answer: { "$ref": "$.loop.previous.loop-worker.output.data.answer" } } }, when: { condition: { op: "equals", args: [{ "$ref": "$.output.data.again" }, { "$literal": true }] }, priority: 0 }, delivery: { deadlineMs: 2000 } },
    { id: "loop-exit", from: { kind: "agent", agentId: "loop-worker", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { summary: { "$ref": "$.output.data.answer" } } }, when: { priority: 1 } }
  );
  withLoop.orchestration.routes.find((route) => route.from.kind === "run").handoffIds.push("loop-entry");
  withLoop.orchestration.routes.push({
    from: { kind: "agent", agentId: "loop-worker", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["loop-continue", "loop-exit"]
  });
  withLoop.orchestration.loops = [{
    id: "loop-topology", members: ["loop-worker"], boundaryAgentId: "loop-worker", entryHandoffIds: ["loop-entry"],
    continueHandoffIds: ["loop-continue"], exitHandoffIds: ["loop-exit"], maxRounds: 2, maxAgentActivations: 3, onExhausted: "fail"
  }];
  withLoop.bindings.push({
    id: "binding:loop-worker", kind: "model", modelRef: "models/default", attemptTimeoutMs: 1000,
    retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } }
  });
  await assertUnsupportedQuorumFailsBeforeBinding(withLoop, "quorum-loop-unsupported");

  const multiple = quorumTeam();
  const clonedAgents = structuredClone(multiple.agents).map((agent) => {
    const oldId = agent.id;
    agent.id = `${oldId}-two`;
    agent.packageRef = `role:${agent.id}@1`;
    agent.bindingRef = `binding:${agent.id}`;
    return agent;
  });
  multiple.agents.push(...clonedAgents);
  const clonedHandoffs = multiple.handoffs
    .filter((handoff) => ["start-left", "start-right", "left-join", "right-join"].includes(handoff.id))
    .map((handoff) => {
      const clone = structuredClone(handoff);
      clone.id = `${clone.id}-two`;
      if (clone.from.kind === "agent") clone.from.agentId = `${clone.from.agentId}-two`;
      if (clone.to.kind === "agent") clone.to.agentId = `${clone.to.agentId}-two`;
      return clone;
    });
  multiple.handoffs.push(...clonedHandoffs);
  const [startLeft, startRight, leftJoin, rightJoin] = clonedHandoffs;
  multiple.orchestration.routes.find((route) => route.from.kind === "run").handoffIds.push(startLeft.id, startRight.id);
  multiple.orchestration.routes.push(
    { from: { kind: "agent", agentId: "left-two", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "finish", handoffIds: [leftJoin.id] },
    { from: { kind: "agent", agentId: "right-two", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "finish", handoffIds: [rightJoin.id] }
  );
  multiple.orchestration.joins.push({
    ...structuredClone(multiple.orchestration.joins[0]), id: "quorum-two", agentId: "joiner-two",
    handoffIds: [leftJoin.id, rightJoin.id]
  });
  multiple.bindings.push(...clonedAgents.map((agent) => ({
    id: agent.bindingRef, kind: "model", modelRef: "models/default", attemptTimeoutMs: 1000,
    retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } }
  })));
  await assertUnsupportedQuorumFailsBeforeBinding(multiple, "quorum-multiple-unsupported");

  const mixed = structuredClone(multiple);
  mixed.team.id = "quorum-mixed";
  mixed.orchestration.joins[1].mode = "all_of";
  delete mixed.orchestration.joins[1].threshold;
  await assertUnsupportedQuorumFailsBeforeBinding(mixed, "quorum-mixed-unsupported");
});

test("multiple independent all_of Joins recover after a ready round checkpoint", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-multiple-join-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = quorumTeam();
  value.team.id = "multiple-all-of-joins";
  value.executionPolicy.resultMode = "allow_empty";
  value.handoffs = value.handoffs.filter((handoff) => handoff.id !== "join-result");
  value.orchestration.routes = value.orchestration.routes.filter((route) => route.from.kind !== "agent" || route.from.agentId !== "joiner");
  value.orchestration.joins[0].mode = "all_of";
  delete value.orchestration.joins[0].threshold;
  value.orchestration.joins[0].id = "join-one";

  const cloneSource = (id) => {
    const original = value.agents.find((agent) => agent.id === id);
    const clone = structuredClone(original);
    clone.id = `${id}-two`;
    clone.packageRef = `role:${clone.id}@1`;
    clone.bindingRef = `binding:${clone.id}`;
    value.agents.push(clone);
    value.bindings.push({
      id: clone.bindingRef, kind: "model", modelRef: "models/default", attemptTimeoutMs: 1000,
      retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } }
    });
    return clone;
  };
  const left = cloneSource("left");
  const right = cloneSource("right");
  value.agents.push({
    id: "joiner-two", packageRef: "role:joiner-two@1", bindingRef: "binding:joiner-two",
    inputPorts: { default: { dataSchema: { type: "object", properties: { leftValue: { type: "string" }, rightValue: { type: "string" } }, required: ["leftValue", "rightValue"], additionalProperties: false } } },
    outputPorts: { DONE: { dataSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false } } }
  });
  value.bindings.push({
    id: "binding:joiner-two", kind: "model", modelRef: "models/default", attemptTimeoutMs: 1000,
    retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } }
  });
  const addSource = (source, sourceValue) => {
    const startId = `start-${source.id}`;
    const joinId = `${source.id}-to-joiner-two`;
    value.handoffs.push(
      { id: startId, from: { kind: "run" }, to: { kind: "agent", agentId: source.id, inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, delivery: { deadlineMs: 2000 } },
      { id: joinId, from: { kind: "agent", agentId: source.id, outputPort: "DONE" }, to: { kind: "agent", agentId: "joiner-two", inputPort: "default" }, map: { data: { [sourceValue]: { "$ref": "$.output.data.value" } } }, when: { priority: 0 }, delivery: { deadlineMs: 2000 } }
    );
    value.orchestration.routes.find((route) => route.from.kind === "run").handoffIds.push(startId);
    value.orchestration.routes.push({
      from: { kind: "agent", agentId: source.id, outputPort: "DONE" },
      mode: "exclusive_priority", onNoMatch: "finish", handoffIds: [joinId]
    });
    return joinId;
  };
  const leftJoinId = addSource(left, "leftValue");
  const rightJoinId = addSource(right, "rightValue");
  value.orchestration.joins.push({
    id: "join-two", agentId: "joiner-two", inputPort: "default", mode: "all_of",
    handoffIds: [leftJoinId, rightJoinId], scope: { kind: "run" }, timeoutMs: 1500, onTimeout: "fail"
  });

  const plan = compileTeamIr(value);
  const calls = [];
  const sourceCalls = new Map();
  const fileStore = new FileTeamRunStore(join(root, "runs"));
  let crashAfterReadyJoin = true;
  const crashStore = {
    create: (...args) => fileStore.create(...args),
    load: (...args) => fileStore.load(...args),
    async compareAndSet(runId, revision, record) {
      const committed = await fileStore.compareAndSet(runId, revision, record);
      const joinReady = Object.values(record.scheduler?.joinRounds ?? {}).some((round) => round.status === "ready");
      const targetStarted = Object.values(record.invocations).some((invocation) => invocation.agentId.startsWith("joiner"));
      if (committed && crashAfterReadyJoin && joinReady && !targetStarted) {
        crashAfterReadyJoin = false;
        throw new Error("simulated process crash after a multi-Join ready checkpoint");
      }
      return committed;
    }
  };
  const bindings = {
    "binding:left": { async invoke() {
      sourceCalls.set("left", (sourceCalls.get("left") ?? 0) + 1);
      return { kind: "completed", output: { event: "DONE", data: { value: "left-one", include: true } } };
    } },
    "binding:right": { async invoke() {
      sourceCalls.set("right", (sourceCalls.get("right") ?? 0) + 1);
      return { kind: "completed", output: { event: "DONE", data: { value: "right-one" } } };
    } },
    "binding:left-two": { async invoke() {
      sourceCalls.set("left-two", (sourceCalls.get("left-two") ?? 0) + 1);
      return { kind: "completed", output: { event: "DONE", data: { value: "left-two", include: true } } };
    } },
    "binding:right-two": { async invoke() {
      sourceCalls.set("right-two", (sourceCalls.get("right-two") ?? 0) + 1);
      return { kind: "completed", output: { event: "DONE", data: { value: "right-two" } } };
    } },
    "binding:joiner": { async invoke(invocation) {
      calls.push(["join-one", invocation.input]);
      return { kind: "completed", output: { event: "DONE", data: { summary: "one" } } };
    } },
    "binding:joiner-two": { async invoke(invocation) {
      calls.push(["join-two", invocation.input]);
      return { kind: "completed", output: { event: "DONE", data: { summary: "two" } } };
    } }
  };
  const runtime = new TeamRuntime({
    store: crashStore,
    clock: { now: () => 100, sleep: () => new Promise(() => {}) },
    bindings
  });
  const runId = "multiple-all-of-joins";
  await runtime.createRun(plan, { runId, task: "join", input: { prompt: "collect" } });
  await assert.rejects(runtime.executeRun(plan, runId), /simulated process crash after a multi-Join ready checkpoint/);
  const crashed = await fileStore.load(runId);
  assert.equal(Object.values(crashed.scheduler.joinRounds).filter((round) => round.status === "ready").length, 1);
  assert.equal(Object.values(crashed.invocations).filter((invocation) => invocation.agentId.startsWith("joiner")).length, 0);
  assert.deepEqual([...sourceCalls.values()], [1, 1, 1, 1]);

  const resumedRuntime = new TeamRuntime({
    store: new FileTeamRunStore(join(root, "runs")),
    clock: { now: () => 200, sleep: () => new Promise(() => {}) },
    bindings
  });
  const result = await resumedRuntime.executeRun(plan, runId);

  assert.equal(result.status, "completed");
  assert.equal(result.result, undefined);
  assert.deepEqual([...sourceCalls.values()], [1, 1, 1, 1], "recovery reuses completed source invocations");
  assert.deepEqual(calls.sort(([leftId], [rightId]) => leftId.localeCompare(rightId)), [
    ["join-one", { leftValue: "left-one", rightValue: "right-one" }],
    ["join-two", { leftValue: "left-two", rightValue: "right-two" }]
  ]);
  assert.equal(result.scheduler.joinRounds["join-one"].status, "ready");
  assert.equal(result.scheduler.joinRounds["join-two"].status, "ready");
  assert.deepEqual(result.scheduler.joinRounds["join-one"].merged.data, { leftValue: "left-one", rightValue: "right-one" });
  assert.deepEqual(result.scheduler.joinRounds["join-two"].merged.data, { leftValue: "left-two", rightValue: "right-two" });
  assert.equal(Object.values(result.invocations).filter((invocation) => invocation.agentId.startsWith("joiner")).length, 2);
});

test("an active quorum sibling failure after target activation still fails the Run", async () => {
  const plan = compileTeamIr(quorumTeam());
  let releaseRight;
  let rightStarted;
  const rightStartedPromise = new Promise((resolve) => { rightStarted = resolve; });
  let joinStarted;
  const joinStartedPromise = new Promise((resolve) => { joinStarted = resolve; });
  const bindings = {
    "binding:left": { async invoke() { return { kind: "completed", output: { event: "DONE", data: { value: "first", include: true } } }; } },
    "binding:right": { async invoke() { rightStarted(); await new Promise((resolve) => { releaseRight = resolve; }); throw new TeamBindingError("late sibling failed", "transport"); } },
    "binding:joiner": { async invoke() { joinStarted(); return { kind: "completed", output: { event: "DONE", data: { summary: "joined" } } }; } }
  };
  const store = new MemoryTeamRunStore();
  const runtime = new TeamRuntime({ store, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  await runtime.createRun(plan, { runId: "quorum-late-failure", task: "check", input: { prompt: "check" } });
  const running = runtime.executeRun(plan, "quorum-late-failure");
  try {
    await withinTimeout(rightStartedPromise, "right source activation");
    await withinTimeout(joinStartedPromise, "quorum target activation");
  } finally {
    releaseRight?.();
    await withinTimeout(running.catch(() => undefined), "quorum Run settlement");
  }
  const result = await running;
  assert.equal(result.status, "failed");
  assert.equal(result.events.some((entry) => entry.type === "run.failing"), true);
});

test("TeamRuntime projects authorized Artifact refs, injects an allowlist resolver, registers output and persists only opaque result refs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-artifact-run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = team();
  value.runInput.artifactSlots = { brief: { required: true, acceptedMediaTypes: ["text/plain"], cardinality: "single" } };
  value.runResult.artifactSlots = { report: { required: true, acceptedMediaTypes: ["text/markdown"], cardinality: "single" } };
  value.agents[0].inputPorts.default.artifactSlots = { sources: { required: true, acceptedMediaTypes: ["text/plain"], cardinality: "single" } };
  value.agents[0].outputPorts.DONE.artifactSlots = { report: { required: true, mediaTypes: ["text/markdown"], cardinality: "single" } };
  value.handoffs = [
    { id: "start", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } }, artifacts: { sources: { "$ref": "$.run.attachments.brief" } } }, when: { priority: 0 }, delivery: { deadlineMs: 2000 } },
    { id: "result", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: { data: {}, artifacts: { report: { "$ref": "$.output.artifacts.report" } } } }
  ];
  value.orchestration.routes = [];
  const plan = compileTeamIr(value);
  const artifacts = new FileTeamArtifactStore(join(root, "artifacts"));
  const inputArtifact = await artifacts.registerRunInput({
    team: value, projectId: "project-1", slotId: "brief", mediaType: "text/plain", content: Buffer.from("source content"), authorizeUpload: () => true
  });
  let observedRead;
  const binding = {
    async invoke(invocation) {
      assert.deepEqual(invocation.input.artifacts, { sources: inputArtifact });
      observedRead = Buffer.from(await invocation.artifactResolver.read(inputArtifact.artifactId)).toString();
      await assert.rejects(
        invocation.artifactResolver.read("art_00000000-0000-0000-0000-000000000000"),
        (error) => error?.code === "ARTIFACT_ACCESS_DENIED"
      );
      return { kind: "completed", output: { event: "DONE", data: { answer: "verified" }, artifacts: { report: { mediaType: "text/markdown", content: Buffer.from("private report") } } } };
    }
  };
  const store = new FileTeamRunStore(join(root, "runs"));
  const runtime = new TeamRuntime({
    store,
    clock: {
      now: () => 100,
      sleep: (_ms, signal) => new Promise((resolve) => signal?.addEventListener("abort", resolve, { once: true }))
    },
    bindings: { "binding:worker": binding },
    artifactStore: artifacts
  });
  await runtime.createRun(plan, { runId: "artifact-run", projectId: "project-1", task: "check", input: { prompt: "check" }, attachments: { brief: inputArtifact } });
  const result = await runtime.executeRun(plan, "artifact-run");
  assert.equal(result.status, "completed", JSON.stringify(result.events.filter((item) => item.type === "run.failing")));
  assert.equal(observedRead, "source content");
  assert.equal(result.result.artifacts.report.mediaType, "text/markdown");
  assert.equal("contentDigest" in result.result.artifacts.report, false);
  assert.equal("content" in result.result.artifacts.report, false);
  const persisted = await new FileTeamRunStore(join(root, "runs")).load("artifact-run");
  assert.deepEqual(persisted.result, result.result);
  assert.equal(JSON.stringify(persisted).includes("private report"), false);
  const storedOutput = persisted.invocations["artifact-run:start"].output.output.artifacts.report;
  const resolver = await new FileTeamArtifactStore(join(root, "artifacts")).createInvocationResolver({
    owner: { projectId: "project-1", runId: "artifact-run" }, allowedArtifacts: [storedOutput]
  });
  assert.equal(Buffer.from(await resolver.read(storedOutput.artifactId)).toString(), "private report");
});

test("Artifact registered before a failed completion checkpoint is not published or retried after recovery", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-artifact-checkpoint-fault-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = team();
  value.runResult.dataSchema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
  value.executionPolicy.resultMode = "required";
  value.agents[0].outputPorts.DONE.artifactSlots = { report: { required: true, mediaTypes: ["text/markdown"], cardinality: "single" } };
  value.runResult.artifactSlots = { report: { required: true, acceptedMediaTypes: ["text/markdown"], cardinality: "single" } };
  value.handoffs = [
    { id: "start", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, when: { priority: 0 }, delivery: { deadlineMs: 2000 } },
    { id: "result", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { "$ref": "$.output.data.answer" } }, artifacts: { report: { "$ref": "$.output.artifacts.report" } } } }
  ];
  value.orchestration.routes = [{ from: { kind: "run" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["start"] }];
  value.bindings[0].retry = { maxAttempts: 2, retryOn: ["transport"], backoff: { mode: "none" } };
  const plan = compileTeamIr(value);
  const artifactStore = new FileTeamArtifactStore(join(root, "artifacts"));
  let registeredReference;
  const registerOutput = artifactStore.registerOutput.bind(artifactStore);
  artifactStore.registerOutput = async (args) => {
    registeredReference = await registerOutput(args);
    return registeredReference;
  };
  const backingStore = new FileTeamRunStore(join(root, "runs"));
  let failCompletionCheckpoint = true;
  const faultyStore = {
    create: (...args) => backingStore.create(...args),
    load: (...args) => backingStore.load(...args),
    compareAndSet: (runId, revision, record) => {
      if (failCompletionCheckpoint && record.invocations[`${runId}:start`]?.status === "completed") {
        failCompletionCheckpoint = false;
        throw new Error("injected Run completion checkpoint failure");
      }
      return backingStore.compareAndSet(runId, revision, record);
    }
  };
  let bindingCalls = 0;
  const bindings = { "binding:worker": { async invoke() {
    bindingCalls += 1;
    return { kind: "completed", output: { event: "DONE", data: { answer: "must-not-publish" }, artifacts: { report: { mediaType: "text/markdown", content: Buffer.from("private uncommitted report") } } } };
  } } };
  const clock = { now: () => 100, sleep: async () => undefined };
  const firstRuntime = new TeamRuntime({ store: faultyStore, clock, bindings, artifactStore });
  await firstRuntime.createRun(plan, { runId: "artifact-checkpoint-fault", projectId: "project-1", task: "check", input: { prompt: "check" } });
  await assert.rejects(firstRuntime.executeRun(plan, "artifact-checkpoint-fault"), /injected Run completion checkpoint failure/);

  const interrupted = await backingStore.load("artifact-checkpoint-fault");
  assert.equal(interrupted.status, "running");
  assert.equal(interrupted.invocations["artifact-checkpoint-fault:start"].status, "running");
  assert.equal(interrupted.invocations["artifact-checkpoint-fault:start"].output, undefined);
  assert.equal(interrupted.resultWritten, undefined);
  assert.equal(interrupted.events.some((entry) => entry.type === "run.result.written"), false);
  assert.ok(registeredReference, "the crash point occurs after Artifact registration");

  const recoveredRuntime = new TeamRuntime({ store: new FileTeamRunStore(join(root, "runs")), clock, bindings, artifactStore: new FileTeamArtifactStore(join(root, "artifacts")) });
  const recovered = await recoveredRuntime.executeRun(plan, "artifact-checkpoint-fault");
  assert.equal(recovered.status, "failed");
  assert.equal(recovered.result, undefined);
  assert.equal(recovered.resultWritten, undefined);
  assert.equal(recovered.invocations["artifact-checkpoint-fault:start"].outcomeUnknown, true);
  assert.equal(recovered.invocations["artifact-checkpoint-fault:start"].output, undefined);
  assert.equal(recovered.events.some((entry) => entry.type === "run.result.written"), false);
  assert.equal(bindingCalls, 1, "a result whose completion checkpoint failed must not be retried after restart");
  assert.equal(JSON.stringify(recovered).includes("private uncommitted report"), false);
  assert.equal(JSON.stringify(recovered).includes(registeredReference.artifactId), false, "the uncommitted Artifact reference is not exposed in the Run record");
});

test("Artifact invocation resolver failure is attributed before Binding invocation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-artifact-resolver-fault-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = team();
  value.runInput.artifactSlots = { brief: { required: true, acceptedMediaTypes: ["text/plain"], cardinality: "single" } };
  value.agents[0].inputPorts.default.artifactSlots = { sources: { required: true, acceptedMediaTypes: ["text/plain"], cardinality: "single" } };
  value.handoffs = [
    { id: "start", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } }, artifacts: { sources: { "$ref": "$.run.attachments.brief" } } }, when: { priority: 0 }, delivery: { deadlineMs: 2000 } }
  ];
  value.orchestration.routes = [{ from: { kind: "run" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["start"] }];
  const plan = compileTeamIr(value);
  const artifactStore = new FileTeamArtifactStore(join(root, "artifacts"));
  const inputArtifact = await artifactStore.registerRunInput({
    team: value, projectId: "project-1", slotId: "brief", mediaType: "text/plain", content: Buffer.from("input"), authorizeUpload: () => true
  });
  artifactStore.createInvocationResolver = async () => { throw new Error("injected artifact resolver failure"); };
  let bindingCalls = 0;
  const runtime = new TeamRuntime({
    store: new FileTeamRunStore(join(root, "runs")),
    clock: { now: () => 100, sleep: async () => undefined },
    bindings: { "binding:worker": { async invoke() { bindingCalls += 1; return { kind: "completed", output: { event: "DONE", data: { answer: "unexpected" } } }; } } },
    artifactStore
  });
  await runtime.createRun(plan, { runId: "artifact-resolver-fault", projectId: "project-1", task: "check", input: { prompt: "check" }, attachments: { brief: inputArtifact } });
  const failed = await runtime.executeRun(plan, "artifact-resolver-fault");
  assert.equal(failed.status, "failed");
  assert.equal(failed.invocations["artifact-resolver-fault:start"].error, "ARTIFACT_RESOLVER_UNAVAILABLE");
  assert.equal(failed.invocations["artifact-resolver-fault:start"].outcomeUnknown, false);
  assert.equal(bindingCalls, 0);
});

test("TeamRuntime hands an Agent Artifact to one downstream allowlist and persists a cross-instance authorized result", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-artifact-handoff-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = team();
  const worker = value.agents[0];
  worker.outputPorts.DONE.artifactSlots = { draft: { required: true, mediaTypes: ["text/markdown"], cardinality: "single" } };
  value.agents.push({
    id: "reviewer", packageRef: "role:reviewer@1", bindingRef: "binding:reviewer",
    inputPorts: {
      default: {
        dataSchema: structuredClone(worker.inputPorts.default.dataSchema),
        artifactSlots: { sources: { required: true, acceptedMediaTypes: ["text/markdown"], cardinality: "single" } }
      }
    },
    outputPorts: {
      DONE: {
        dataSchema: structuredClone(worker.outputPorts.DONE.dataSchema),
        artifactSlots: { final: { required: true, mediaTypes: ["text/markdown"], cardinality: "single" } }
      }
    }
  });
  value.runResult.dataSchema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
  value.runResult.artifactSlots = { report: { required: true, acceptedMediaTypes: ["text/markdown"], cardinality: "single" } };
  value.executionPolicy.resultMode = "required";
  value.handoffs = [
    { id: "start", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, when: { priority: 0 }, delivery: { deadlineMs: 2000 } },
    { id: "review", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "agent", agentId: "reviewer", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } }, artifacts: { sources: { "$ref": "$.output.artifacts.draft" } } }, delivery: { deadlineMs: 2000 } },
    { id: "result", from: { kind: "agent", agentId: "reviewer", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { "$ref": "$.output.data.answer" } }, artifacts: { report: { "$ref": "$.output.artifacts.final" } } } }
  ];
  value.orchestration.routes = [{ from: { kind: "run" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["start"] }];
  value.bindings = value.agents.map((agent) => ({ id: agent.bindingRef, kind: "model", modelRef: "models/default", attemptTimeoutMs: 1000, retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } } }));
  let plan;
  try { plan = compileTeamIr(value); } catch (error) { throw new Error(JSON.stringify(error.diagnostics || error.issues || error.message)); }
  const artifactsRoot = join(root, "artifacts");
  const artifacts = new FileTeamArtifactStore(artifactsRoot);
  const reads = [];
  const bindings = {
    "binding:worker": { async invoke() {
      return { kind: "completed", output: { event: "DONE", data: { answer: "drafted" }, artifacts: { draft: { mediaType: "text/markdown", content: Buffer.from("private draft") } } } };
    } },
    "binding:reviewer": { async invoke(invocation) {
      const reference = invocation.input.artifacts.sources;
      reads.push(Buffer.from(await invocation.artifactResolver.read(reference.artifactId)).toString());
      await assert.rejects(invocation.artifactResolver.read("art_00000000-0000-0000-0000-000000000000"), (error) => error?.code === "ARTIFACT_ACCESS_DENIED");
      return { kind: "completed", output: { event: "DONE", data: { answer: "reviewed" }, artifacts: { final: { mediaType: "text/markdown", content: Buffer.from("private final") } } } };
    } }
  };
  const runtime = new TeamRuntime({ store: new FileTeamRunStore(join(root, "runs")), clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings, artifactStore: artifacts });
  await runtime.createRun(plan, { runId: "artifact-handoff-run", projectId: "project-1", task: "review", input: { prompt: "review" } });
  const completed = await runtime.executeRun(plan, "artifact-handoff-run");
  assert.equal(completed.status, "completed", JSON.stringify(completed.events.filter((item) => item.type === "run.failing")));
  assert.deepEqual(reads, ["private draft"]);
  assert.equal(completed.result.data.answer, "reviewed");
  assert.deepEqual(Object.keys(completed.result.artifacts.report).sort(), ["artifactId", "mediaType"]);
  assert.equal(JSON.stringify(completed).includes("private draft"), false);
  assert.equal(JSON.stringify(completed).includes("private final"), false);

  const reopenedArtifacts = new FileTeamArtifactStore(artifactsRoot);
  const persistedResult = await new FileTeamRunStore(join(root, "runs")).load("artifact-handoff-run");
  const resultRef = persistedResult.result.artifacts.report;
  const resolver = await reopenedArtifacts.createInvocationResolver({ owner: { projectId: "project-1", runId: "artifact-handoff-run" }, allowedArtifacts: [resultRef] });
  assert.equal(Buffer.from(await resolver.read(resultRef.artifactId)).toString(), "private final");
  await assert.rejects(reopenedArtifacts.createInvocationResolver({ owner: { projectId: "other-project", runId: "artifact-handoff-run" }, allowedArtifacts: [resultRef] }), (error) => error?.code === "ARTIFACT_REFERENCE_INVALID");
});

function loopTeam({ maxRounds = 3, maxAgentActivations = 4, onExhausted = "fail" } = {}) {
  const value = team();
  value.runResult.dataSchema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
  value.executionPolicy.resultMode = "required";
  value.agents[0].inputPorts = {
    draft: { dataSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false } },
    revise: { dataSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } }
  };
  value.agents[0].outputPorts.DONE.dataSchema = {
    type: "object", properties: { answer: { type: "string" }, again: { type: "boolean" } }, required: ["answer", "again"], additionalProperties: false
  };
  value.handoffs = [
    { id: "entry", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "draft" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, when: { priority: 0 }, delivery: { deadlineMs: 2000 } },
    { id: "revise", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "agent", agentId: "worker", inputPort: "revise" }, map: { data: { answer: { "$ref": "$.loop.previous.worker.output.data.answer" } } }, when: { condition: { op: "equals", args: [{ "$ref": "$.output.data.again" }, { "$literal": true }] }, priority: 0 }, delivery: { deadlineMs: 2000 } },
    { id: "exit", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } }, when: { priority: 1 } }
  ];
  value.orchestration = {
    routes: [
      { from: { kind: "run" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["entry"] },
      { from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["revise", "exit"] }
    ],
    joins: [], loops: [{ id: "revision", members: ["worker"], boundaryAgentId: "worker", entryHandoffIds: ["entry"], continueHandoffIds: ["revise"], exitHandoffIds: ["exit"], maxRounds, maxAgentActivations, onExhausted }], reviews: []
  };
  return value;
}

test("Loop executes bounded sequential rounds and resolves only the immediately previous output", async () => {
  const seen = [];
  let round = 0;
  const { runtime, store } = setup({ async invoke(args) {
    round += 1;
    seen.push(args.input);
    return { kind: "completed", output: { event: "DONE", data: { answer: `round-${round}`, again: round < 3 } } };
  } });
  const plan = compileTeamIr(loopTeam());
  await runtime.createRun(plan, { runId: "loop-run", task: "revise", input: { prompt: "draft" } });
  const result = await runtime.executeRun(plan, "loop-run");
  assert.equal(result.status, "completed", JSON.stringify(result.events.map((item) => [item.type, item.data])));
  assert.deepEqual(result.result, { answer: "round-3" });
  assert.deepEqual(seen, [{ prompt: "draft" }, { answer: "round-1" }, { answer: "round-2" }]);
  assert.equal(result.loopStates.revision.rounds, 3);
  assert.equal(result.loopStates.revision.agentActivations, 3);
  assert.equal((await store.load("loop-run")).loopStates.revision.rounds, 3);
});

test("Loop exhaustion fails closed and finish selects a declared exit only", async () => {
  const failing = setup({ async invoke() { return { kind: "completed", output: { event: "DONE", data: { answer: "draft", again: true } } }; } });
  const failPlan = compileTeamIr(loopTeam({ maxRounds: 1, onExhausted: "fail" }));
  await failing.runtime.createRun(failPlan, { runId: "loop-fail", task: "revise", input: { prompt: "draft" } });
  const failed = await failing.runtime.executeRun(failPlan, "loop-fail");
  assert.equal(failed.status, "failed");
  assert.equal(failed.events.find((item) => item.type === "run.failing").data.code, "LOOP_EXHAUSTED", JSON.stringify(failed.events.map((item) => [item.type, item.data])));

  let calls = 0;
  const finishing = setup({ async invoke() {
    calls += 1;
    return { kind: "completed", output: { event: "DONE", data: { answer: "final", again: true } } };
  } });
  const finishPlan = compileTeamIr(loopTeam({ maxRounds: 1, onExhausted: "finish" }));
  await finishing.runtime.createRun(finishPlan, { runId: "loop-finish", task: "revise", input: { prompt: "draft" } });
  const finished = await finishing.runtime.executeRun(finishPlan, "loop-finish");
  assert.equal(finished.status, "completed");
  assert.deepEqual(finished.result, { answer: "final" });
  assert.equal(calls, 1);
});

test("Loop activation budget exhaustion fails closed before the next member call", async () => {
  let calls = 0;
  const { runtime } = setup({ async invoke() {
    calls += 1;
    return { kind: "completed", output: { event: "DONE", data: { answer: `round-${calls}`, again: true } } };
  } });
  const plan = compileTeamIr(loopTeam({ maxRounds: 4, maxAgentActivations: 1, onExhausted: "fail" }));
  await runtime.createRun(plan, { runId: "loop-budget", task: "revise", input: { prompt: "draft" } });
  const result = await runtime.executeRun(plan, "loop-budget");
  assert.equal(result.status, "failed");
  assert.equal(result.events.find((item) => item.type === "run.failing").data.code, "LOOP_EXHAUSTED");
  assert.equal(calls, 1);
  assert.equal(result.loopStates.revision.agentActivations, 1);
});

test("active Run re-entry without a scheduler checkpoint is rejected without side effects", async () => {
  let calls = 0;
  const { runtime, store } = setup({ async invoke() { calls += 1; throw new Error("must not invoke"); } });
  const plan = compileTeamIr(loopTeam());
  await runtime.createRun(plan, { runId: "loop-resume", task: "revise", input: { prompt: "draft" } });
  const queued = await store.load("loop-resume");
  const expectedRevision = queued.revision;
  delete queued.scheduler;
  queued.revision += 1;
  assert.equal(await store.compareAndSet("loop-resume", expectedRevision, queued), true);
  await runtime.claim("loop-resume", plan.compiledPlanDigest);
  const before = await store.load("loop-resume");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(runtime.executeRun(plan, "loop-resume"), /TEAM_RUN_RESUME_UNSUPPORTED: no scheduler checkpoint exists/);
    assert.deepEqual(await store.load("loop-resume"), before);
  }
  assert.equal(calls, 0);
});

test("FileTeamRunStore recovery attempts cancel but keeps an active invocation outcome unknown without replay", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-active-invocation-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let cancels = 0;
  let calls = 0;
  const store = new FileTeamRunStore(root);
  const bindings = { "binding:worker": {
    async invoke() { calls += 1; throw new Error("must not replay unknown invocation"); },
    async cancel(input) { cancels += 1; assert.equal(input.idempotencyKey, "unknown-run:start"); return true; }
  } };
  const runtime = new TeamRuntime({ store, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  const plan = compileTeamIr(team());
  await runtime.createRun(plan, { runId: "unknown-run", task: "recover", input: { prompt: "recover" } });
  await runtime.claim("unknown-run", plan.compiledPlanDigest);
  const claimed = await store.load("unknown-run");
  claimed.scheduler = { pending: ["start"], sources: {}, skippedHandoffs: [], arrivedHandoffs: [], visited: {}, invocationIds: {} };
  claimed.invocations["unknown-run:start"] = {
    id: "unknown-run:start", handoffId: "start", agentId: "worker", bindingId: "binding:worker",
    status: "running", deadlineAt: 2000, attempt: 1
  };
  claimed.revision += 1;
  assert.equal(await store.compareAndSet("unknown-run", claimed.revision - 1, claimed), true);

  const recoveredRuntime = new TeamRuntime({ store: new FileTeamRunStore(root), clock: { now: () => 500, sleep: () => new Promise(() => {}) }, bindings });
  const result = await recoveredRuntime.executeRun(plan, "unknown-run");
  assert.equal(result.status, "failed");
  assert.equal(result.terminalIntent, "failed");
  assert.equal(result.invocations["unknown-run:start"].status, "failed");
  assert.equal(result.invocations["unknown-run:start"].outcomeUnknown, true);
  assert.equal(result.invocations["unknown-run:start"].error, "BINDING_OUTCOME_UNKNOWN_AFTER_RESTART");
  assert.equal(cancels, 1);
  assert.equal(calls, 0);
  assert.equal(result.events.some((entry) => entry.type === "binding.outcome_unknown" && entry.data?.reason === "scheduler_recovery_found_active_invocation"), true);
  const reopened = await new TeamRuntime({ store: new FileTeamRunStore(root), clock: { now: () => 600, sleep: () => new Promise(() => {}) }, bindings }).executeRun(plan, "unknown-run");
  assert.deepEqual(reopened, result);
  assert.equal(cancels, 1);
  assert.equal(calls, 0);
});

test("scheduler checkpoint resumes from a completed invocation across FileTeamRunStore instances without repeating the Binding call", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-scheduler-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = compileTeamIr(loopTeam());
  const firstStore = new FileTeamRunStore(root);
  let crashAfterCompletedInvocation = true;
  const crashStore = {
    create: (...args) => firstStore.create(...args),
    load: (...args) => firstStore.load(...args),
    async compareAndSet(...args) {
      const [runId, expectedRevision, record] = args;
      const committed = await firstStore.compareAndSet(runId, expectedRevision, record);
      if (committed && crashAfterCompletedInvocation && Object.values(record.invocations).some((invocation) => invocation.status === "completed")) {
        crashAfterCompletedInvocation = false;
        throw new Error("simulated process crash after invocation commit");
      }
      return committed;
    }
  };
  let calls = 0;
  const binding = { async invoke() {
    calls += 1;
    return { kind: "completed", output: { event: "DONE", data: { answer: `round-${calls}`, again: calls < 3 } } };
  } };
  const firstRuntime = new TeamRuntime({ store: crashStore, clock: { now: () => 10, sleep: () => new Promise(() => {}) }, bindings: { "binding:worker": binding } });
  await firstRuntime.createRun(plan, { runId: "recovered-run", task: "recover", input: { prompt: "recover" } });
  await assert.rejects(firstRuntime.executeRun(plan, "recovered-run"), /simulated process crash/);
  const crashed = await firstStore.load("recovered-run");
  assert.equal(crashed.status, "running");
  assert.equal(crashed.scheduler.pending[0], "entry");
  assert.equal(crashed.invocations["recovered-run:entry:loop:revision:activation:1"].status, "completed");
  assert.equal(crashed.loopStates.revision.agentActivations, 1);
  assert.equal(crashed.loopStates.revision.rounds, 0);

  const secondStore = new FileTeamRunStore(root);
  const secondRuntime = new TeamRuntime({ store: secondStore, clock: { now: () => 20, sleep: () => new Promise(() => {}) }, bindings: { "binding:worker": binding } });
  const resumed = await secondRuntime.executeRun(plan, "recovered-run");
  assert.equal(resumed.status, "completed");
  assert.equal(calls, 3);
  assert.deepEqual(resumed.result, { answer: "round-3" });
  assert.equal(resumed.loopStates.revision.rounds, 3);
  assert.equal(resumed.loopStates.revision.agentActivations, 3);
  assert.deepEqual(resumed.invocations["recovered-run:entry:loop:revision:activation:1"].output, { kind: "completed", output: { event: "DONE", data: { answer: "round-1", again: true } } });
});

test("Loop-scoped Join continuation is rejected before member invocation with a stable failure", async () => {
  let calls = 0;
  const { runtime } = setup({ async invoke() {
    calls += 1;
    return { kind: "completed", output: { event: "DONE", data: { answer: "unexpected", again: false } } };
  } });
  const value = loopTeam();
  value.agents[0].inputPorts.revise.dataSchema.required = [];
  value.handoffs.find((handoff) => handoff.id === "revise").map.data.answer = { "$ref": "$.output.data.answer" };
  value.orchestration.joins = [{
    id: "revision-join", agentId: "worker", inputPort: "revise", mode: "all_of",
    handoffIds: ["revise"], scope: { kind: "loop", loopId: "revision" }, timeoutMs: 2000, onTimeout: "fail"
  }];
  let plan;
  try { plan = compileTeamIr(value); } catch (error) { throw new Error(JSON.stringify(error.diagnostics || error.issues || error.message)); }
  await runtime.createRun(plan, { runId: "loop-join", task: "revise", input: { prompt: "draft" } });
  const result = await runtime.executeRun(plan, "loop-join");
  assert.equal(result.status, "failed");
  assert.equal(result.events.find((item) => item.type === "run.failing").data.code, "TEAM_LOOP_TOPOLOGY_UNSUPPORTED");
  assert.equal(calls, 0);
  const settled = result.events.filter((item) => item.type === "run.failed");
  assert.equal(settled.length, 1);
});

test("Loop parallel fan-out is rejected before member invocation to avoid unsupported multi-lineage history", async () => {
  let calls = 0;
  const { runtime } = setup({ async invoke() {
    calls += 1;
    return { kind: "completed", output: { event: "DONE", data: { answer: "unexpected", again: false } } };
  } });
  const value = loopTeam();
  value.orchestration.routes.find((route) => route.from.kind === "agent").mode = "parallel_fanout";
  delete value.handoffs.find((handoff) => handoff.id === "revise").when.priority;
  delete value.handoffs.find((handoff) => handoff.id === "exit").when;
  const plan = compileTeamIr(value);
  await runtime.createRun(plan, { runId: "loop-fanout", task: "revise", input: { prompt: "draft" } });
  const result = await runtime.executeRun(plan, "loop-fanout");
  assert.equal(result.status, "failed");
  assert.equal(result.events.find((item) => item.type === "run.failing").data.code, "TEAM_LOOP_TOPOLOGY_UNSUPPORTED");
  assert.equal(calls, 0);
});

function makerCheckerTeam() {
  const value = loopTeam({ maxRounds: 3, onExhausted: "finish" });
  value.agents[0].inputPorts.revise.dataSchema.properties.comments = { type: "string", minLength: 1 };
  const revise = value.handoffs.find((handoff) => handoff.id === "revise");
  revise.map.data.comments = { "$ref": "$.review.feedback.comments" };
  revise.when = { condition: { op: "equals", args: [{ "$ref": "$.review.decision" }, { "$literal": "reject" }] }, priority: 0 };
  value.handoffs.find((handoff) => handoff.id === "exit").when = {
    condition: { op: "equals", args: [{ "$ref": "$.review.decision" }, { "$literal": "approve" }] }, priority: 1
  };
  value.orchestration.reviews = [{
    id: "maker-checker-review", at: { kind: "agentOutput", agentId: "worker", outputPort: "DONE" },
    feedbackSchema: { type: "object", properties: { comments: { type: "string", minLength: 1 } }, required: ["comments"], additionalProperties: false },
    timeoutMs: 1000, onTimeout: "fail"
  }];
  return value;
}

test("Maker-Checker reject then approve uses round-scoped Review and resumes without repeating a completed invocation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-maker-checker-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const makerChecker = makerCheckerTeam();
  makerChecker.orchestration.reviews[0].timeoutMs = 10000;
  const plan = compileTeamIr(makerChecker);
  const runStore = new FileTeamRunStore(join(root, "runs"));
  const reviewStore = new FileTeamReviewStore(join(root, "reviews"));
  let now = 100;
  const makeReviewRuntime = () => new TeamReviewRuntime({ store: reviewStore, now: () => now, authorizeReviewer: ({ reviewerId }) => reviewerId === "reviewer" });
  let calls = 0;
  const inputs = [];
  const bindings = { "binding:worker": { async invoke(invocation) {
    calls += 1;
    now += 5;
    inputs.push(invocation.input);
    return { kind: "completed", output: { event: "DONE", data: { answer: `draft-${calls}`, again: false } } };
  } } };
  const runtime1 = new TeamRuntime({ store: runStore, clock: { now: () => now, sleep: () => new Promise(() => {}) }, bindings, reviewRuntime: makeReviewRuntime() });
  const runId = "maker-checker-rounds";
  await runtime1.createRun(plan, { runId, task: "review draft", input: { prompt: "draft" } });
  const waiting1 = await runtime1.executeRun(plan, runId);
  assert.equal(waiting1.status, "waiting_human_review");
  assert.equal(waiting1.waitingReview.loopRound, 1);
  assert.equal(waiting1.activeExecutionMs, 5);
  now += 6000;
  const review1 = await reviewStore.load("maker-checker-rounds:maker-checker-review:run:1");
  assert.ok(review1);
  await makeReviewRuntime().decide({ runId, reviewId: "maker-checker-review", loopRound: 1, revisionToken: review1.revisionToken, idempotencyKey: "reject-1", reviewerId: "reviewer", decision: "reject", feedback: { comments: "Add a stronger qualification." }, plan });

  const runtime2 = new TeamRuntime({ store: new FileTeamRunStore(join(root, "runs")), clock: { now: () => now, sleep: () => new Promise(() => {}) }, bindings, reviewRuntime: makeReviewRuntime() });
  const waiting2 = await runtime2.executeRun(plan, runId);
  assert.equal(waiting2.status, "waiting_human_review");
  assert.equal(waiting2.waitingReview.loopRound, 2);
  assert.equal(waiting2.activeExecutionMs, 10);
  now += 6000;
  assert.equal(calls, 2, "resume must reuse completed round 1 invocation and only run the new revision");
  assert.deepEqual(inputs, [
    { prompt: "draft" },
    { answer: "draft-1", comments: "Add a stronger qualification." }
  ]);
  const review2 = await reviewStore.load("maker-checker-rounds:maker-checker-review:run:2");
  assert.ok(review2);
  await makeReviewRuntime().decide({ runId, reviewId: "maker-checker-review", loopRound: 2, revisionToken: review2.revisionToken, idempotencyKey: "approve-2", reviewerId: "reviewer", decision: "approve", plan });

  const runtime3 = new TeamRuntime({ store: new FileTeamRunStore(join(root, "runs")), clock: { now: () => now, sleep: () => new Promise(() => {}) }, bindings, reviewRuntime: makeReviewRuntime() });
  const completed = await runtime3.executeRun(plan, runId);
  assert.equal(completed.status, "completed", JSON.stringify(completed.events.filter((item) => item.type === "run.failing")));
  assert.deepEqual(completed.result, { answer: "draft-2" });
  assert.equal(completed.activeExecutionMs, 10, "Review wait time must not consume the Run active execution budget");
  assert.equal(completed.loopStates.revision.rounds, 2);
  assert.equal(calls, 2, "approve exit must not replay the completed Maker invocation");
  assert.equal(completed.events.filter((item) => item.type === "run.waiting_human_review").length, 2);
  assert.equal((await reviewStore.load("maker-checker-rounds:maker-checker-review:run:1")).status, "rejected");
  assert.equal((await reviewStore.load("maker-checker-rounds:maker-checker-review:run:2")).status, "approved");
  assert.equal(completed.events.filter((item) => item.type === "run.review.rejected" && item.data?.loopRound === 1).length, 1);
  assert.equal(completed.events.filter((item) => item.type === "run.review.approved" && item.data?.loopRound === 2).length, 1);
});

test("Maker-Checker Review timeout fails closed for its Loop round without repeating the Maker", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-maker-checker-timeout-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = compileTeamIr(makerCheckerTeam());
  const runStore = new FileTeamRunStore(join(root, "runs"));
  const reviewStore = new FileTeamReviewStore(join(root, "reviews"));
  let now = 100;
  let calls = 0;
  const reviewRuntime = new TeamReviewRuntime({ store: reviewStore, now: () => now, authorizeReviewer: () => true });
  const runtime = new TeamRuntime({
    store: runStore,
    clock: { now: () => now, sleep: () => new Promise(() => {}) },
    reviewRuntime,
    bindings: { "binding:worker": { async invoke() {
      calls += 1;
      return { kind: "completed", output: { event: "DONE", data: { answer: "draft", again: false } } };
    } } }
  });
  const runId = "maker-checker-timeout";
  await runtime.createRun(plan, { runId, task: "review draft", input: { prompt: "draft" } });
  const waiting = await runtime.executeRun(plan, runId);
  assert.equal(waiting.status, "waiting_human_review");
  assert.equal(waiting.waitingReview.loopRound, 1);
  now = 1100;
  const failed = await runtime.executeRun(plan, runId);
  assert.equal(failed.status, "failed");
  assert.equal(failed.events.some((item) => item.type === "run.failing" && item.data?.code === "REVIEW_TIMEOUT"), true);
  assert.equal(calls, 1);
  assert.equal((await reviewStore.load("maker-checker-timeout:maker-checker-review:run:1")).status, "timed_out");
});

test("TeamRuntime waits for an authorized FileStore Review decision and resumes the same completed output", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-review-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = team();
  value.agents[0].outputPorts.DONE.dataSchema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
  value.agents.push({
    id: "reviewer", packageRef: "role:reviewer@1", bindingRef: "binding:reviewer",
    inputPorts: { default: { dataSchema: { type: "object", properties: { approval: { type: "string", enum: ["approve", "reject"] }, comments: { type: "string" } }, required: ["approval"], additionalProperties: false } } },
    outputPorts: { DONE: { dataSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } } }
  });
  value.runResult.dataSchema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
  value.executionPolicy.resultMode = "required";
  value.handoffs = [
    { id: "start", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, when: { priority: 0 }, delivery: { deadlineMs: 2000 } },
    { id: "after-review", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "agent", agentId: "reviewer", inputPort: "default" }, map: { data: { approval: { "$ref": "$.review.decision" }, comments: { "$ref": "$.review.feedback.comments" } } }, when: { priority: 0 }, delivery: { deadlineMs: 2000 } },
    { id: "result", from: { kind: "agent", agentId: "reviewer", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } } }
  ];
  value.orchestration.routes = [
    { from: { kind: "run" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["start"] },
    { from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["after-review"] }
  ];
  value.orchestration.reviews = [{ id: "worker-review", at: { kind: "agentOutput", agentId: "worker", outputPort: "DONE" }, feedbackSchema: { type: "object", properties: { comments: { type: "string", minLength: 1 } }, required: ["comments"], additionalProperties: false }, timeoutMs: 5000, onTimeout: "fail" }];
  value.bindings = value.agents.map((agent) => ({ id: agent.bindingRef, kind: "model", modelRef: "models/default", attemptTimeoutMs: 1000, retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } } }));
  let plan;
  try { plan = compileTeamIr(value); } catch (error) { throw new Error(JSON.stringify(error.diagnostics || error.issues || error.message)); }
  let now = 100;
  const reviewRoot = join(root, "reviews");
  let token = 0;
  const reviewRuntime = new TeamReviewRuntime({ store: new FileTeamReviewStore(reviewRoot), now: () => now, makeRevisionToken: () => `review-token-${++token}`, authorizeReviewer: async ({ reviewerId }) => reviewerId === "reviewer-1" });
  let workerCalls = 0;
  const seenInputs = [];
  const bindings = {
    "binding:worker": { async invoke() { workerCalls += 1; return { kind: "completed", output: { event: "DONE", data: { answer: "draft" } } }; } },
    "binding:reviewer": { async invoke(invocation) { seenInputs.push(invocation.input); return { kind: "completed", output: { event: "DONE", data: { answer: "approved result" } } }; } }
  };
  const runRoot = join(root, "runs");
  const firstRuntime = new TeamRuntime({ store: new FileTeamRunStore(runRoot), clock: { now: () => now, sleep: () => new Promise(() => {}) }, bindings, reviewRuntime });
  await firstRuntime.createRun(plan, { runId: "review-run", task: "review", input: { prompt: "review" } });
  const waiting = await firstRuntime.executeRun(plan, "review-run");
  assert.equal(waiting.status, "waiting_human_review");
  assert.equal(workerCalls, 1);
  assert.equal(seenInputs.length, 0);
  const pending = await firstRuntime.getReview("review-run", "worker-review");

  await assert.rejects(firstRuntime.decideReview({ runId: "review-run", reviewId: "worker-review", revisionToken: pending.revisionToken, idempotencyKey: "denied", reviewerId: "intruder", decision: "approve", plan }), (error) => error.code === "REVIEW_UNAUTHORIZED");
  const reviewerAfterRestart = new TeamReviewRuntime({ store: new FileTeamReviewStore(reviewRoot), now: () => now, makeRevisionToken: () => `restart-token-${++token}`, authorizeReviewer: async ({ reviewerId }) => reviewerId === "reviewer-1" });
  await reviewerAfterRestart.decide({ runId: "review-run", reviewId: "worker-review", revisionToken: pending.revisionToken, idempotencyKey: "approved-1", reviewerId: "reviewer-1", decision: "approve", feedback: { comments: "Proceed" }, plan });
  now += 1;
  const resumedRuntime = new TeamRuntime({ store: new FileTeamRunStore(runRoot), clock: { now: () => now, sleep: () => new Promise(() => {}) }, bindings, reviewRuntime: reviewerAfterRestart });
  const completed = await resumedRuntime.executeRun(plan, "review-run");
  assert.equal(completed.status, "completed");
  assert.equal(workerCalls, 1, "completed source invocation must not be repeated after review wait");
  assert.deepEqual(seenInputs, [{ approval: "approve", comments: "Proceed" }]);
  assert.deepEqual(completed.result, { answer: "approved result" });
  assert.equal(completed.events.filter((item) => item.type === "run.waiting_human_review").length, 1);

  await resumedRuntime.createRun(plan, { runId: "rejected-review-run", task: "review", input: { prompt: "review" } });
  const rejectedWaiting = await resumedRuntime.executeRun(plan, "rejected-review-run");
  assert.equal(rejectedWaiting.status, "waiting_human_review");
  const rejectedPending = await resumedRuntime.getReview("rejected-review-run", "worker-review");
  await reviewerAfterRestart.decide({ runId: "rejected-review-run", reviewId: "worker-review", revisionToken: rejectedPending.revisionToken, idempotencyKey: "rejected-1", reviewerId: "reviewer-1", decision: "reject", feedback: { comments: "Revise first" }, plan });
  const rejectedRun = await resumedRuntime.executeRun(plan, "rejected-review-run");
  assert.equal(rejectedRun.status, "failed");
  assert.equal(rejectedRun.events.find((item) => item.type === "run.failing").data.code, "REVIEW_REJECTED");
  assert.equal(seenInputs.length, 1, "a rejected Review must not invoke downstream Agents");
});
