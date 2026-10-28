import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { compileTeamIr } from "../dist/team-ir/compiler.js";
import { validateTeamIr } from "../dist/team-ir/index.js";

async function loadFixture(name) {
  return JSON.parse(await readFile(new URL(`../examples/team-ir-v2/${name}.json`, import.meta.url), "utf8"));
}

function compileValid(fixture) {
  const diagnostics = validateTeamIr(fixture);
  assert.deepEqual(diagnostics.filter((item) => item.severity === "error"), []);
  return compileTeamIr(fixture);
}

test("classic expert consultation compiles a stable optional-field quorum contract", async () => {
  const fixture = await loadFixture("classic-expert-consultation");
  const plan = compileValid(fixture);
  const repeated = compileTeamIr(fixture);
  const join = plan.joinsByTarget.get("chief-reviewer:collect");

  assert.equal(join.mode, "quorum_of");
  assert.equal(join.threshold, 2);
  assert.deepEqual(join.handoffIds, ["cardiology-to-chief", "neurology-to-chief", "imaging-to-chief"]);
  assert.deepEqual(fixture.agents.find((agent) => agent.id === "chief-reviewer").inputPorts.collect.dataSchema.required ?? [], []);
  assert.equal(plan.routesBySource.get("agent:dispatcher:BRIEF").mode, "parallel_fanout");
  assert.match(plan.compiledPlanDigest, /^[a-f0-9]{64}$/);
  assert.equal(repeated.compiledPlanDigest, plan.compiledPlanDigest);
});

test("classic structured debate compiles an all-of bounded loop and exclusive decision routes", async () => {
  const fixture = await loadFixture("classic-structured-debate");
  const plan = compileValid(fixture);
  const repeated = compileTeamIr(fixture);
  const join = plan.joinsByTarget.get("neutral-judge:review");
  const loop = plan.loopsById.get("debate-rounds");
  const route = plan.routesBySource.get("agent:neutral-judge:JUDGMENT");

  assert.equal(join.mode, "all_of");
  assert.deepEqual(join.handoffIds, ["proponent-to-judge", "opponent-to-judge"]);
  assert.equal(loop.boundaryAgentId, "debate-host");
  assert.deepEqual(loop.entryHandoffIds, ["run-to-host"]);
  assert.deepEqual(loop.continueHandoffIds, ["judge-to-host"]);
  assert.deepEqual(loop.exitHandoffIds, ["judge-to-reporter"]);
  assert.equal(loop.maxRounds, 2);
  assert.deepEqual(route.handoffIds, ["judge-to-host", "judge-to-reporter"]);
  assert.deepEqual(fixture.handoffs.find((handoff) => handoff.id === "judge-to-reporter").when, { priority: 1 });
  assert.match(plan.compiledPlanDigest, /^[a-f0-9]{64}$/);
  assert.equal(repeated.compiledPlanDigest, plan.compiledPlanDigest);
});
