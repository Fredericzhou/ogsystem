import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTeamIrPatch,
  applyTeamIrPatches,
  graphAuthoringToTeamIr,
  teamIrToGraphAuthoring
} from "../public/app/team-ir-graph-adapter.js";

function fixture() {
  return {
    schemaVersion: 2,
    team: { id: "team", version: "2.0.0" },
    runInput: { dataSchema: { type: "object", properties: { request: { type: "string" } } } },
    runResult: { dataSchema: { type: "object", properties: { summary: { type: "string" } } } },
    agents: [{ id: "worker", packageRef: "role:worker@1", bindingRef: "binding:worker", inputPorts: { input: {} }, outputPorts: { done: {} }, hidden: { keep: true } }],
    bindings: [{ id: "binding:worker", kind: "model", modelRef: "codex-gateway/gpt-6-luna", metadata: { keep: true } }],
    handoffs: [{ id: "run-worker", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "input" }, map: { data: {} }, when: { priority: 0 } }],
    orchestration: { routes: [], joins: [], loops: [], reviews: [] },
    unknownContract: { preserve: true }
  };
}

test("graph projection round-trips hidden Team IR fields", () => {
  const source = fixture();
  const projected = teamIrToGraphAuthoring(source);
  const roundTrip = graphAuthoringToTeamIr(source, projected);
  assert.deepEqual(roundTrip.unknownContract, source.unknownContract);
  assert.deepEqual(roundTrip.agents[0].hidden, source.agents[0].hidden);
  assert.deepEqual(roundTrip.bindings[0].metadata, source.bindings[0].metadata);
});

test("typed patch failure leaves the original draft unchanged", () => {
  const source = fixture();
  const result = applyTeamIrPatch(source, { op: "update", collection: "agents", id: "worker", fields: { unsupported: true } });
  assert.equal(result.ok, false);
  assert.deepEqual(result.teamIR, source);
});

test("typed patches support explicit agent and handoff changes", () => {
  const source = fixture();
  const result = applyTeamIrPatches(source, [
    { op: "add", collection: "agents", id: "reviewer", value: { inputPorts: {}, outputPorts: {}, packageRef: "role:reviewer@1", bindingRef: "binding:worker" } },
    { op: "update", collection: "handoffs", id: "run-worker", fields: { to: { kind: "agent", agentId: "reviewer", inputPort: "input" } } }
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.teamIR.agents.length, 2);
  assert.equal(result.teamIR.handoffs[0].to.agentId, "reviewer");
  assert.equal(source.handoffs[0].to.agentId, "worker");
});
