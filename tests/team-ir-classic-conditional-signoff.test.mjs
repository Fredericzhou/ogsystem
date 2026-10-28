import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyTeamJoinEvent, compileTeamIr, createTeamJoinRound, MemoryTeamRunStore, TeamRuntime, validateTeamIr } from "../dist/team-ir/index.js";

const fixtureUrl = new URL("../examples/team-ir-v2/classic-conditional-signoff.json", import.meta.url);

async function loadFixture() {
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
}

function compileFixture(fixture) {
  const diagnostics = validateTeamIr(fixture);
  assert.deepEqual(diagnostics.filter((diagnostic) => diagnostic.severity === "error"), []);
  return compileTeamIr(fixture);
}

async function run(fixture, track, runId) {
  const plan = compileFixture(fixture);
  const store = new MemoryTeamRunStore();
  const bindings = {
    "binding:primary-reviewer": { async invoke() { return { kind: "completed", output: { event: "REVIEW", data: { track, comment: `primary ${track}` } } }; } },
    "binding:compliance-reviewer": { async invoke() { return { kind: "completed", output: { event: "REVIEW", data: { track, comment: "compliance checked" } } }; } },
    "binding:signoff-chair": {
      async invoke(invocation) {
        return { kind: "completed", output: { event: "SIGNED_OFF", data: { summary: JSON.stringify(invocation.input) } } };
      }
    }
  };
  const runtime = new TeamRuntime({ store, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  await runtime.createRun(plan, { runId, task: "review a release", input: { request: "Approve the new service workflow." } });
  return runtime.executeRun(plan, runId);
}

test("conditional signoff fixture compiles with same-endpoint alternatives and a required source", async () => {
  const fixture = await loadFixture();
  const plan = compileFixture(fixture);
  const join = plan.joinsByTarget.get("signoff-chair:collect");
  const primaryRoute = plan.routesBySource.get("agent:primary-reviewer:REVIEW");

  assert.deepEqual(primaryRoute.handoffIds, ["primary-standard-signoff", "primary-clinical-signoff"]);
  assert.equal(join.mode, "all_of");
  assert.deepEqual(join.handoffIds, ["primary-standard-signoff", "primary-clinical-signoff", "compliance-signoff"]);
});

test("same-source candidate Handoffs are tracked by ID and optional Join omits the skipped contribution", async () => {
  for (const [track, selectedId, skippedId, runId] of [
    ["standard", "primary-standard-signoff", "primary-clinical-signoff", "conditional-signoff-standard"],
    ["clinical", "primary-clinical-signoff", "primary-standard-signoff", "conditional-signoff-clinical"]
  ]) {
    const result = await run(await loadFixture(), track, runId);
    assert.equal(result.status, "completed", JSON.stringify(result.events.filter((event) => event.type === "run.failing")));
    const round = result.scheduler.joinRounds["conditional-signoff"];
    assert.equal(round.sourceStates[selectedId], "arrived");
    assert.equal(round.sourceStates[skippedId], "skipped");
    assert.equal(round.sourceStates["compliance-signoff"], "arrived");
    assert.equal(round.merged.data.request, "Approve the new service workflow.");
    assert.equal(Object.hasOwn(round.merged.data, track === "standard" ? "clinicalComment" : "primaryComment"), false);
  }
});

test("required-source absence is rejected and zero-arrival conditional Join fails closed", async () => {
  const requiredSource = await loadFixture();
  requiredSource.agents.find((agent) => agent.id === "signoff-chair").inputPorts.collect.dataSchema.required.push("clinicalComment");
  const diagnostics = validateTeamIr(requiredSource);
  assert.ok(diagnostics.some((item) => item.code === "IR_JOIN_CONDITIONAL_REQUIRED_SOURCE"));

  const noneArrive = await loadFixture();
  noneArrive.agents.find((agent) => agent.id === "signoff-chair").inputPorts.collect.dataSchema.required = ["request"];
  noneArrive.handoffs.find((handoff) => handoff.id === "compliance-signoff").when = {
    condition: { op: "equals", args: [{ "$ref": "$.output.data.track" }, { "$literal": "standard" }] }, priority: 0
  };
  const result = await run(noneArrive, "skip", "conditional-signoff-no-arrivals");
  assert.equal(result.status, "failed");
  assert.equal(result.events.find((event) => event.type === "run.failing")?.data?.code, "JOIN_NO_ARRIVALS");
  assert.deepEqual(Object.values(result.scheduler.joinRounds["conditional-signoff"].sourceStates), ["skipped", "skipped", "skipped"]);
});

test("a required Join field cannot depend on a conditional candidate from a shared source endpoint", async () => {
  const fixture = await loadFixture();
  fixture.agents.find((agent) => agent.id === "signoff-chair").inputPorts.collect.dataSchema.required.push("primaryComment");
  const diagnostics = validateTeamIr(fixture);
  assert.ok(diagnostics.some((item) => item.code === "IR_JOIN_CONDITIONAL_REQUIRED_SOURCE"));
});

test("conditional signoff Join timeout keeps its deadline across recovery and ignores late sources", async () => {
  const fixture = await loadFixture();
  const compiledJoin = compileFixture(fixture).joinsByTarget.get("signoff-chair:collect");
  const roundConfig = {
    joinId: compiledJoin.id,
    runId: "conditional-signoff-timeout-recovery",
    lineage: "run",
    mode: compiledJoin.mode,
    handoffIds: compiledJoin.handoffIds,
    timeoutMs: compiledJoin.timeoutMs,
    requiredSourceIds: ["compliance-signoff"],
    requiredFields: fixture.agents.find((agent) => agent.id === compiledJoin.agentId)
      .inputPorts[compiledJoin.inputPort].dataSchema.required,
    baseMapping: { data: { request: "request" } }
  };
  let round = createTeamJoinRound(roundConfig);
  round = applyTeamJoinEvent(round, { type: "predecessor_activated", at: 100 });
  round = applyTeamJoinEvent(round, { type: "arrival", sourceId: "primary-standard-signoff", contribution: { data: { primaryComment: "reviewed" } }, at: 110 });
  round = applyTeamJoinEvent(round, { type: "skip", sourceId: "primary-clinical-signoff", at: 111 });

  const checkpoint = structuredClone(round);
  assert.equal(checkpoint.startedAt, 100);
  assert.equal(checkpoint.deadlineAt, 100 + compiledJoin.timeoutMs);
  assert.equal(checkpoint.sourceStates["primary-standard-signoff"], "arrived");
  assert.equal(checkpoint.sourceStates["primary-clinical-signoff"], "skipped");
  assert.equal(checkpoint.sourceStates["compliance-signoff"], "pending");

  const recovered = structuredClone(checkpoint);
  assert.equal(applyTeamJoinEvent(recovered, { type: "tick", at: checkpoint.deadlineAt - 1 }).status, "collecting");
  const timedOut = applyTeamJoinEvent(recovered, { type: "tick", at: checkpoint.deadlineAt });
  assert.equal(timedOut.status, "failed");
  assert.equal(timedOut.failure.code, "JOIN_TIMEOUT");
  assert.equal(timedOut.deadlineAt, checkpoint.deadlineAt);

  const afterLateArrival = applyTeamJoinEvent(timedOut, {
    type: "arrival", sourceId: "compliance-signoff", contribution: { data: { complianceComment: "late" } }, at: checkpoint.deadlineAt + 1
  });
  assert.deepEqual(afterLateArrival, timedOut);
  assert.equal(afterLateArrival.sourceStates["compliance-signoff"], "pending");
});
