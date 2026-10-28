import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileTeamIr, MemoryTeamRunStore, TeamRuntime } from "../dist/team-ir/index.js";

const fixtureUrl = new URL("../examples/team-ir-v2/classic-expert-consultation.json", import.meta.url);

async function loadFixture() {
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
}

function runtime(bindings) {
  const store = new MemoryTeamRunStore();
  const instance = new TeamRuntime({ store, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  return { store, runtime: instance };
}

function completed(event, data) {
  return { kind: "completed", output: { event, data } };
}

function expertBindings(experts, chief) {
  const bindings = {
    "binding:dispatcher": { async invoke({ input }) { return completed("BRIEF", { brief: `Case: ${input.request}` }); } },
    "binding:chief-reviewer": { invoke: chief }
  };
  for (const [agentId, invoke] of Object.entries(experts)) bindings[`binding:${agentId}`] = { invoke };
  return bindings;
}

function withConditionalExpertResponses(fixture) {
  const targetEdges = new Map();
  for (const handoff of fixture.handoffs) {
    if (!handoff.id.endsWith("-to-chief")) continue;
    const expertId = handoff.from.agentId;
    const outputSchema = fixture.agents.find((agent) => agent.id === expertId).outputPorts.REVIEW.dataSchema;
    outputSchema.properties.reviewable = { type: "boolean" };
    outputSchema.required.push("reviewable");
    handoff.when = {
      condition: { op: "equals", args: [{ "$ref": "$.output.data.reviewable" }, { "$literal": true }] },
      priority: 0
    };
    targetEdges.set(expertId, handoff.id);
  }
  fixture.orchestration.routes.push(...[...targetEdges].map(([agentId, handoffId]) => ({
    from: { kind: "agent", agentId, outputPort: "REVIEW" },
    mode: "exclusive_priority",
    onNoMatch: "finish",
    handoffIds: [handoffId]
  })));
  return fixture;
}

test("classic expert consultation runs three specialists and starts chief at quorum two without merging the late opinion", async () => {
  const fixture = await loadFixture();
  const plan = compileTeamIr(fixture);
  let releaseImaging;
  let imagingStarted;
  const imagingStartedPromise = new Promise((resolve) => { imagingStarted = resolve; });
  let chiefStarted;
  const chiefStartedPromise = new Promise((resolve) => { chiefStarted = resolve; });
  const chiefInputs = [];
  const bindings = expertBindings({
    cardiology: async ({ input }) => {
      assert.deepEqual(input, { brief: "Case: recurring headache with brief blurred vision" });
      return completed("REVIEW", { review: "Cardiovascular red flags not established; confirm relevant history." });
    },
    neurology: async ({ input }) => {
      assert.deepEqual(input, { brief: "Case: recurring headache with brief blurred vision" });
      return completed("REVIEW", { review: "Clarify headache onset, pattern, and associated neurological symptoms." });
    },
    imaging: async ({ input }) => {
      imagingStarted();
      await new Promise((resolve) => { releaseImaging = resolve; });
      return completed("REVIEW", { review: "No imaging findings supplied; do not infer a result." });
    }
  }, async ({ input }) => {
    chiefInputs.push(input);
    chiefStarted();
    return completed("CONSULTATION", { summary: "Two specialist views synthesized; imaging opinion arrived after quorum." });
  });
  const { runtime: teamRuntime, store } = runtime(bindings);
  const runId = "classic-expert-quorum-2";
  await teamRuntime.createRun(plan, { runId, task: "expert consultation", input: { request: "recurring headache with brief blurred vision" } });
  const running = teamRuntime.executeRun(plan, runId);
  let result;
  try {
    await imagingStartedPromise;
    await chiefStartedPromise;
    assert.deepEqual(chiefInputs, [{ cardiology: "Cardiovascular red flags not established; confirm relevant history.", neurology: "Clarify headache onset, pattern, and associated neurological symptoms." }]);
  } finally {
    releaseImaging?.();
    result = await running;
  }

  assert.equal(result.status, "completed", JSON.stringify(result.events.map((event) => [event.type, event.data])));
  assert.deepEqual(result.result, { summary: "Two specialist views synthesized; imaging opinion arrived after quorum." });
  assert.equal(Object.values(result.invocations).filter((invocation) => invocation.agentId === "cardiology" || invocation.agentId === "neurology" || invocation.agentId === "imaging").length, 3);
  assert.equal(Object.values(result.invocations).filter((invocation) => invocation.agentId === "chief-reviewer").length, 1);

  const record = await store.load(runId);
  const round = record.scheduler.joinRounds["specialist-quorum"];
  assert.equal(round.status, "ready");
  assert.deepEqual(round.merged.data, chiefInputs[0]);
  assert.deepEqual(Object.keys(round.merged.data).sort(), ["cardiology", "neurology"]);
  assert.equal(round.audit.some((entry) => entry.type === "join.source.late_arrival" && entry.sourceId === "imaging-to-chief"), true);
  assert.equal(record.resultWritten, true);
  assert.deepEqual(record.result, { summary: "Two specialist views synthesized; imaging opinion arrived after quorum." });
});

test("classic expert consultation fails when one conditional review arrives and two specialists skip", async () => {
  const fixture = withConditionalExpertResponses(await loadFixture());
  const plan = compileTeamIr(fixture);
  let chiefCalls = 0;
  const bindings = expertBindings({
    cardiology: async () => completed("REVIEW", { review: "One available review.", reviewable: true }),
    neurology: async () => completed("REVIEW", { review: "No review submitted.", reviewable: false }),
    imaging: async () => completed("REVIEW", { review: "No review submitted.", reviewable: false })
  }, async () => {
    chiefCalls += 1;
    throw new Error("quorum target must not run with only one of three reviews");
  });
  const { runtime: teamRuntime, store } = runtime(bindings);
  const runId = "classic-expert-quorum-unreachable";
  await teamRuntime.createRun(plan, { runId, task: "expert consultation", input: { request: "recurring headache with brief blurred vision" } });
  const result = await teamRuntime.executeRun(plan, runId);

  assert.equal(result.status, "failed");
  assert.equal(result.events.some((event) => event.type === "run.failing" && event.data?.code === "JOIN_QUORUM_UNREACHABLE"), true);
  assert.equal(chiefCalls, 0);
  assert.notEqual(result.resultWritten, true);
  const round = (await store.load(runId)).scheduler.joinRounds["specialist-quorum"];
  assert.equal(round.status, "failed");
  assert.equal(Object.values(round.sourceStates).filter((status) => status === "arrived").length, 1);
  assert.equal(Object.values(round.sourceStates).filter((status) => status === "skipped").length, 2);
});
