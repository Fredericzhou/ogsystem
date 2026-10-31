import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTeamIrPatch,
  applyTeamIrPatches,
  graphAuthoringToTeamIr,
  studioConditionToTeam,
  teamConditionToStudio,
  teamIrToGraphAuthoring
} from "../public/app/team-ir-graph-adapter.js";

function fixture() {
  return {
    schemaVersion: 2,
    team: { id: "team", version: "2.0.0" },
    runInput: { dataSchema: { type: "object", properties: { request: { type: "string" } } }, preferencesSchema: {}, artifactSlots: {} },
    runResult: { dataSchema: { type: "object", properties: { summary: { type: "string" } } }, artifactSlots: {} },
    agents: [{ id: "worker", packageRef: "role:worker@1", bindingRef: "binding:worker", inputPorts: { input: {} }, outputPorts: { done: {} }, hidden: { keep: true } }],
    bindings: [{ id: "binding:worker", kind: "model", modelRef: "codex-gateway/gpt-6-luna", metadata: { keep: true } }],
    handoffs: [{ id: "run-worker", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "input" }, map: { data: {} }, when: { priority: 0 } }],
    orchestration: { routes: [], joins: [{ id: "join-worker", agentId: "worker", inputPort: "input", mode: "all_of", handoffIds: ["run-worker"], scope: { kind: "run" }, timeoutMs: 1000, onTimeout: "fail" }], loops: [], reviews: [] },
    presentation: { nodes: { worker: { label: "执行者" } }, edges: { "run-worker": { label: "开始交接" } } },
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

test("graph projection uses port ids and presentation labels", () => {
  const projected = teamIrToGraphAuthoring(fixture());
  assert.equal(projected.roles.worker.title, "执行者");
  assert.equal(projected.roles.worker.packageRef, "role:worker@1");
  assert.equal(projected.roles.worker.bindingRef, "binding:worker");
  assert.equal(projected.roles.worker.joinMode, "all_of");
  assert.equal(projected.flows["run-worker"].inputPort, "input");
  assert.equal(projected.flows["run-worker"].label, "开始交接");
});

test("graph projection converts v2 conditions without changing their meaning", () => {
  const source = fixture();
  source.handoffs[0].when = {
    priority: 1,
    condition: {
      op: "notEquals",
      args: [{ $ref: "$.run.input.request" }, { $literal: "" }]
    }
  };
  const projected = teamIrToGraphAuthoring(source);
  assert.deepEqual(projected.flows["run-worker"].condition, {
    op: "not",
    args: [{ op: "equals", args: [{ kind: "path", root: "state", path: ["run", "input", "request"] }, { kind: "literal", value: "" }] }]
  });
  assert.deepEqual(studioConditionToTeam(projected.flows["run-worker"].condition), source.handoffs[0].when.condition);
  assert.deepEqual(teamConditionToStudio(source.handoffs[0].when.condition), projected.flows["run-worker"].condition);
});

test("graph projection expresses Join sources as source Agent ids", () => {
  const source = fixture();
  source.agents.push({ id: "reviewer", packageRef: "role:reviewer@1", bindingRef: "binding:worker", inputPorts: { input: {} }, outputPorts: { done: {} } });
  source.handoffs.push({ id: "worker-reviewer", from: { kind: "agent", agentId: "worker", outputPort: "done" }, to: { kind: "agent", agentId: "reviewer", inputPort: "input" }, map: { data: {} }, delivery: { deadlineMs: 1000 } });
  source.orchestration.joins.push({ id: "join-reviewer", agentId: "reviewer", inputPort: "input", mode: "all_of", handoffIds: ["worker-reviewer"], scope: { kind: "run" }, timeoutMs: 1000, onTimeout: "fail" });
  const projected = teamIrToGraphAuthoring(source);
  assert.deepEqual(projected.roles.reviewer.joinSources, ["worker"]);
});

test("graph projection preserves Join participation per port-aware handoff", () => {
  const source = fixture();
  source.agents.push({
    id: "reviewer",
    packageRef: "role:reviewer@1",
    bindingRef: "binding:worker",
    inputPorts: { input: {} },
    outputPorts: {}
  });
  source.agents[0].outputPorts = { accepted: {}, rejected: {} };
  source.handoffs.push(
    {
      id: "accepted-reviewer",
      from: { kind: "agent", agentId: "worker", outputPort: "accepted" },
      to: { kind: "agent", agentId: "reviewer", inputPort: "input" },
      map: { data: {} }
    },
    {
      id: "rejected-reviewer",
      from: { kind: "agent", agentId: "worker", outputPort: "rejected" },
      to: { kind: "agent", agentId: "reviewer", inputPort: "input" },
      map: { data: {} }
    }
  );
  source.orchestration.joins.push({
    id: "join-reviewer",
    agentId: "reviewer",
    inputPort: "input",
    mode: "all_of",
    handoffIds: ["accepted-reviewer"],
    scope: { kind: "run" },
    timeoutMs: 1000,
    onTimeout: "fail"
  });
  const projected = teamIrToGraphAuthoring(source);
  assert.equal(projected.flows["accepted-reviewer"].participatesInJoin, true);
  assert.equal(projected.flows["rejected-reviewer"].participatesInJoin, false);
});

test("handoff retarget removes delivery when the target becomes Result", () => {
  const source = fixture();
  source.handoffs[0].to = { kind: "agent", agentId: "worker", inputPort: "input" };
  source.handoffs[0].delivery = { deadlineMs: 1000 };
  const result = applyTeamIrPatch(source, { op: "handoff.retarget", id: "run-worker", to: { kind: "result" } });
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result.teamIR.handoffs[0], "delivery"), false);
});

test("graph projection accepts case display labels without changing Team IR", () => {
  const source = fixture();
  delete source.presentation.nodes.worker;
  const projected = teamIrToGraphAuthoring(source, {}, { roleLabels: { worker: "案例角色" } });
  assert.equal(projected.roles.worker.title, "案例角色");
  assert.equal(projected.roles.worker.label, undefined);
  const roundTrip = graphAuthoringToTeamIr(source, projected);
  assert.equal(roundTrip.presentation.nodes.worker, undefined);
});

test("graph projection accepts case flow labels by endpoint", () => {
  const source = fixture();
  delete source.presentation.edges["run-worker"];
  const projected = teamIrToGraphAuthoring(source, {}, {
    edgeLabels: { "__system_start__:worker": "开始工作" }
  });
  assert.equal(projected.flows["run-worker"].label, "开始工作");
});

test("typed patches cover ports, rename references, orchestration, contracts, artifacts and presentation", () => {
  const source = fixture();
  const result = applyTeamIrPatches(source, [
    { op: "agent.rename", id: "worker", newId: "worker_v2" },
    { op: "agent.port.upsert", agentId: "worker_v2", direction: "output", portId: "audit", value: { dataSchema: { type: "object" } } },
    { op: "handoff.retarget", id: "run-worker", to: { kind: "agent", agentId: "worker_v2", inputPort: "input" } },
    { op: "join.upsert", id: "join-worker", value: { agentId: "worker_v2", inputPort: "input", mode: "all_of", handoffIds: ["run-worker"], scope: { kind: "run" }, timeoutMs: 2000, onTimeout: "fail" } },
    { op: "loop.upsert", id: "loop-1", value: { members: ["worker_v2"], boundaryAgentId: "worker_v2", entryHandoffIds: ["run-worker"], continueHandoffIds: ["run-worker"], exitHandoffIds: ["run-worker"], maxRounds: 2, maxAgentActivations: 4, onExhausted: "fail" } },
    { op: "review.upsert", id: "review-1", value: { at: { kind: "agentOutput", agentId: "worker_v2", outputPort: "audit" }, feedbackSchema: {}, timeoutMs: 1000, onTimeout: "fail" } },
    { op: "artifactSlot.upsert", target: { owner: "runInput" }, slotId: "brief", value: { required: true, acceptedMediaTypes: ["text/plain"], cardinality: "single" } },
    { op: "runInput.update", fields: { preferencesSchema: { type: "object" } } },
    { op: "executionPolicy.update", fields: { resultMode: "allow_empty", activeExecutionBudgetMs: 1000 } },
    { op: "presentation.nodeLabel", nodeId: "worker_v2", label: "执行者 v2" },
    { op: "presentation.edgeLabel", edgeId: "run-worker", label: "输入交接" }
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.teamIR.agents[0].id, "worker_v2");
  assert.ok(result.teamIR.agents[0].outputPorts.audit);
  assert.equal(result.teamIR.handoffs[0].to.agentId, "worker_v2");
  assert.equal(result.teamIR.orchestration.joins[0].agentId, "worker_v2");
  assert.equal(result.teamIR.orchestration.loops[0].members[0], "worker_v2");
  assert.equal(result.teamIR.orchestration.reviews[0].at.agentId, "worker_v2");
  assert.equal(result.teamIR.runInput.artifactSlots.brief.required, true);
  assert.equal(result.teamIR.executionPolicy.resultMode, "allow_empty");
  assert.equal(result.teamIR.presentation.nodes.worker_v2.label, "执行者 v2");
});

test("typed patches retain unknown fields and roll back the full batch", () => {
  const source = fixture();
  const result = applyTeamIrPatches(source, [
    { op: "agent.update", id: "worker", fields: { packageRef: "role:worker@2" } },
    { op: "agent.update", id: "worker", fields: { unsupported: true } }
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.teamIR, source);
  const renamed = applyTeamIrPatch(source, { op: "agent.rename", id: "worker", newId: "worker2" });
  assert.equal(renamed.ok, true);
  assert.deepEqual(renamed.teamIR.unknownContract, source.unknownContract);
});

test("port removal clears dependent handoffs and rejects unknown fields", () => {
  const source = fixture();
  source.handoffs.push({ id: "worker-result", from: { kind: "agent", agentId: "worker", outputPort: "done" }, to: { kind: "result" }, map: { data: {} } });
  const result = applyTeamIrPatch(source, { op: "agent.port.remove", agentId: "worker", direction: "output", portId: "done" });
  assert.equal(result.ok, false, "last output port cannot be removed");
  const added = applyTeamIrPatch(source, { op: "agent.port.upsert", agentId: "worker", direction: "output", portId: "audit", value: { dataSchema: {} } });
  assert.equal(added.ok, true);
  const removed = applyTeamIrPatch(added.teamIR, { op: "agent.port.remove", agentId: "worker", direction: "output", portId: "done" });
  assert.equal(removed.ok, true);
  assert.equal(removed.teamIR.handoffs.some((handoff) => handoff.id === "worker-result"), false);
  const invalid = applyTeamIrPatch(source, { op: "agent.create", id: "bad", value: { packageRef: "x", bindingRef: "y", inputPorts: {}, outputPorts: {}, extra: true } });
  assert.equal(invalid.ok, false);
});

test("agent removal preserves unrelated Loop members and removes only affected references", () => {
  const source = fixture();
  source.agents.push({ id: "reviewer", packageRef: "role:reviewer@1", bindingRef: "binding:worker", inputPorts: { input: {} }, outputPorts: { done: {} } });
  source.handoffs.push({ id: "reviewer-result", from: { kind: "agent", agentId: "reviewer", outputPort: "done" }, to: { kind: "result" }, map: { data: {} } });
  source.orchestration.loops.push({
    id: "shared-loop",
    members: ["worker", "reviewer"],
    boundaryAgentId: "reviewer",
    entryHandoffIds: ["reviewer-result"],
    continueHandoffIds: ["reviewer-result"],
    exitHandoffIds: ["reviewer-result"],
    maxRounds: 2,
    maxAgentActivations: 4,
    onExhausted: "fail"
  });
  const result = applyTeamIrPatch(source, { op: "agent.remove", id: "worker" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.teamIR.orchestration.loops[0].members, ["reviewer"]);
  assert.equal(result.teamIR.orchestration.loops[0].boundaryAgentId, "reviewer");
});

test("binding patches reject fields outside the bindingRef contract", () => {
  const source = fixture();
  const invalid = applyTeamIrPatch(source, { op: "agent.binding.update", id: "worker", fields: { bindingRef: "binding:next", unsupported: true } });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.teamIR, source);
  const valid = applyTeamIrPatch(source, { op: "agent.binding.update", id: "worker", bindingRef: "binding:next" });
  assert.equal(valid.ok, true);
  assert.equal(valid.teamIR.agents[0].bindingRef, "binding:next");
});
