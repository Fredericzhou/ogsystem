import assert from "node:assert/strict";
import test from "node:test";
import { compileTeamIr, TeamIrCompileError } from "../dist/team-ir/compiler.js";

function team() {
  return {
    schemaVersion: 2,
    team: { id: "demo", version: "1" },
    runInput: { dataSchema: { type: "object" }, preferencesSchema: { type: "object" }, artifactSlots: {} },
    runResult: { dataSchema: { type: "object" }, artifactSlots: {} },
    executionPolicy: { resultMode: "allow_empty", activeExecutionBudgetMs: 1000 },
    agents: [{ id: "worker", packageRef: "role:worker@1", bindingRef: "binding:worker", inputPorts: { default: { dataSchema: { type: "object" } } }, outputPorts: { DONE: { dataSchema: { type: "object" } } } }],
    handoffs: [{ id: "start", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: {}, delivery: { deadlineMs: 1000 } }],
    orchestration: { routes: [], joins: [], loops: [], reviews: [] },
    bindings: [{ id: "binding:worker", kind: "model", modelRef: "models/default", attemptTimeoutMs: 1000, retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } } }]
  };
}

test("compiler produces an immutable canonical Team snapshot and indexes", () => {
  const source = team();
  const plan = compileTeamIr(source, { packageDigests: { "role:worker@1": "pkg-digest" }, adapterVersions: { model: "1" } });
  source.team.version = "changed";
  assert.equal(plan.team.team.version, "1");
  assert.equal(plan.handoffsById.get("start").id, "start");
  assert.ok(plan.routesBySource instanceof Map);
  assert.match(plan.compiledPlanDigest, /^[a-f0-9]{64}$/);
  assert.throws(() => { plan.team.team.version = "mutated"; }, TypeError);
});

test("compiler digest binds executable package, adapter and compiler semantics", () => {
  const value = team();
  const base = compileTeamIr(value);
  assert.notEqual(base.compiledPlanDigest, compileTeamIr(value, { packageDigests: { "role:worker@1": "one" } }).compiledPlanDigest);
  assert.notEqual(base.compiledPlanDigest, compileTeamIr(value, { bindingDigests: { "binding:worker": "one" } }).compiledPlanDigest);
  assert.notEqual(base.compiledPlanDigest, compileTeamIr(value, { adapterVersions: { model: "2" } }).compiledPlanDigest);
  assert.notEqual(base.compiledPlanDigest, compileTeamIr(value, { compilerSemanticsVersion: "team-ir-v2/2" }).compiledPlanDigest);
  assert.notEqual(base.compiledPlanDigest, compileTeamIr(value, { schemaDigests: { "schemas/input.json": "one" } }).compiledPlanDigest);
  assert.equal(
    compileTeamIr(value, { packageDigests: { z: "2", a: "1" } }).compiledPlanDigest,
    compileTeamIr(value, { packageDigests: { a: "1", z: "2" } }).compiledPlanDigest
  );
});

test("compiler snapshots referenced package Schema resources into the digest", () => {
  const value = team();
  value.agents[0].inputPorts.default.dataSchema = { "$ref": "schemas/input.json#/$defs/input" };
  const first = compileTeamIr(value, { packageSchemas: {
    "schemas/input.json": { "$schema": "https://json-schema.org/draft/2020-12/schema", "$defs": { input: { type: "object", properties: { prompt: { type: "string" } } } } }
  } });
  const second = compileTeamIr(value, { packageSchemas: {
    "schemas/input.json": { "$schema": "https://json-schema.org/draft/2020-12/schema", "$defs": { input: { type: "object", properties: { prompt: { type: "number" } } } } }
  } });
  assert.notEqual(first.compiledPlanDigest, second.compiledPlanDigest);
  assert.ok(first.schemaSnapshot.some((resource) => resource.path === "schemas/input.json"));
});

test("compiler refuses invalid Team IR with stable diagnostics", () => {
  const value = team();
  value.handoffs[0].to.inputPort = "missing";
  assert.throws(() => compileTeamIr(value), (error) => {
    assert.ok(error instanceof TeamIrCompileError);
    assert.ok(error.diagnostics.some((item) => item.code === "IR_UNKNOWN_PORT"));
    return true;
  });
});
