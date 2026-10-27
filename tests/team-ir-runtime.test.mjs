import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileTeamIr, createTeamA2ABinding, FileTeamArtifactStore, FileTeamRunStore, MemoryTeamArtifactBackend, MemoryTeamRunStore, TeamArtifactStore, TeamBindingError, TeamRuntime, selectTeamHandoffs } from "../dist/team-ir/index.js";

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

test("route selection evaluates conditions and exclusive priority deterministically", () => {
  const plan = compileTeamIr(team());
  assert.deepEqual(selectTeamHandoffs(plan, { kind: "run" }, {}, { task: "t", input: { prompt: "hi" } }), ["start"]);
  assert.deepEqual(selectTeamHandoffs(plan, { kind: "run" }, {}, { task: "t", input: { prompt: "hi", kind: "fallback" } }), ["fallback"]);
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

test("active Run re-entry is rejected until scheduler checkpoint recovery exists", async () => {
  const { runtime } = setup({ async invoke() { throw new Error("must not invoke"); } });
  const plan = compileTeamIr(loopTeam());
  await runtime.createRun(plan, { runId: "loop-resume", task: "revise", input: { prompt: "draft" } });
  await runtime.claim("loop-resume", plan.compiledPlanDigest);
  await assert.rejects(runtime.executeRun(plan, "loop-resume"), /TEAM_RUN_RESUME_UNSUPPORTED/);
});
