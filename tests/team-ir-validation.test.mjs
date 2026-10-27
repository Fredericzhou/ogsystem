import assert from "node:assert/strict";
import test from "node:test";
import { validateTeamIrReferences } from "../dist/team-ir/validate.js";

function baseTeam() {
  return {
    schemaVersion: 2,
    team: { id: "simple-team", version: "1.0.0" },
    runInput: { dataSchema: { type: "object" }, preferencesSchema: { type: "object" }, artifactSlots: {} },
    runResult: { dataSchema: { type: "object" }, artifactSlots: {} },
    executionPolicy: { resultMode: "required", activeExecutionBudgetMs: 10000 },
    agents: [{
      id: "worker",
      packageRef: "role:worker@1",
      bindingRef: "binding:worker",
      inputPorts: { default: { dataSchema: { type: "object" } } },
      outputPorts: { DONE: { dataSchema: { type: "object" } } }
    }],
    handoffs: [
      { id: "start-worker", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: {} },
      { id: "worker-result", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: {} }
    ],
    orchestration: { routes: [], joins: [], loops: [], reviews: [] },
    bindings: [{ id: "binding:worker", kind: "model", modelRef: "models/example" }]
  };
}

function codes(document) {
  return validateTeamIrReferences(document).map((item) => item.code);
}

test("cross-reference validation accepts a minimal Team and resolves Agent bindings and ports", () => {
  assert.deepEqual(validateTeamIrReferences(baseTeam()), []);
});

test("cross-reference validation reports duplicate semantic IDs and unknown references", () => {
  const team = baseTeam();
  team.bindings.push({ id: "worker", kind: "model", modelRef: "models/duplicate" });
  team.agents[0].bindingRef = "binding:missing";
  team.handoffs[0].from = { kind: "agent", agentId: "absent", outputPort: "x" };
  team.handoffs[0].to = { kind: "agent", agentId: "worker", inputPort: "absent" };

  const diagnostics = validateTeamIrReferences(team);
  assert.ok(diagnostics.some((item) => item.code === "IR_DUPLICATE_ID"));
  assert.ok(diagnostics.some((item) => item.code === "IR_UNKNOWN_BINDING"));
  assert.ok(diagnostics.some((item) => item.code === "IR_UNKNOWN_AGENT"));
  assert.ok(diagnostics.some((item) => item.code === "IR_UNKNOWN_PORT"));
});

test("conditional or multiple source handoffs require one route listing exactly those edges", () => {
  const team = baseTeam();
  team.handoffs[1].when = { condition: { op: "equals", args: [{ "$literal": 1 }, { "$literal": 1 }] } };
  assert.ok(codes(team).includes("IR_ROUTE_REQUIRED"));

  team.orchestration.routes = [{
    from: { kind: "agent", agentId: "worker", outputPort: "DONE" },
    mode: "exclusive_priority",
    onNoMatch: "fail",
    handoffIds: ["worker-result"]
  }];
  assert.ok(codes(team).includes("IR_ROUTE_PRIORITY_REQUIRED"));

  team.handoffs[1].when.priority = 5;
  assert.deepEqual(validateTeamIrReferences(team), []);
});

test("exclusive_priority requires unique priorities and a numerically last unconditional fallback", () => {
  const team = baseTeam();
  team.handoffs.push({
    id: "worker-fallback",
    from: { kind: "agent", agentId: "worker", outputPort: "DONE" },
    to: { kind: "result" },
    map: {},
    when: { priority: 3 }
  });
  team.handoffs[1].when = { priority: 2, condition: { op: "equals", args: [{ "$literal": true }, { "$literal": true }] } };
  team.orchestration.routes = [{
    from: { kind: "agent", agentId: "worker", outputPort: "DONE" },
    mode: "exclusive_priority",
    onNoMatch: "fail",
    handoffIds: ["worker-result", "worker-fallback"]
  }];

  assert.ok(!codes(team).includes("IR_ROUTE_FALLBACK_PRIORITY"));
  team.handoffs[1].when.priority = 4;
  team.handoffs[2].when.priority = 3;
  assert.ok(codes(team).includes("IR_ROUTE_FALLBACK_PRIORITY"));
  team.handoffs[1].when.priority = 3;
  team.handoffs[2].when.priority = 3;
  assert.ok(codes(team).includes("IR_ROUTE_AMBIGUOUS"));
});

test("parallel_fanout rejects priorities and routes reject handoffs from another source", () => {
  const team = baseTeam();
  team.handoffs[1].when = { priority: 1, condition: { op: "exists", args: [{ "$ref": "$.output.data.ready" }] } };
  team.orchestration.routes = [{
    from: { kind: "agent", agentId: "worker", outputPort: "DONE" },
    mode: "parallel_fanout",
    onNoMatch: "fail",
    handoffIds: ["worker-result"]
  }];
  assert.ok(codes(team).includes("IR_ROUTE_PRIORITY_FORBIDDEN"));

  team.orchestration.routes[0].handoffIds = ["start-worker"];
  assert.ok(codes(team).includes("IR_ROUTE_SOURCE_MISMATCH"));
});

test("Join requires exact incoming source and valid target ports", () => {
  const team = baseTeam();
  team.agents.push({
    id: "reviewer",
    packageRef: "role:reviewer@1",
    bindingRef: "binding:worker",
    inputPorts: { collect: { dataSchema: { type: "object" } } },
    outputPorts: { DONE: { dataSchema: { type: "object" } } }
  });
  team.handoffs[1].to = { kind: "agent", agentId: "reviewer", inputPort: "collect" };
  team.handoffs.push({ id: "review-result", from: { kind: "agent", agentId: "reviewer", outputPort: "DONE" }, to: { kind: "result" }, map: {} });
  team.orchestration.joins = [{ id: "review-join", agentId: "reviewer", inputPort: "collect", mode: "all_of", handoffIds: [] }];

  assert.ok(codes(team).includes("IR_JOIN_UNDECLARED_INBOUND"));
  team.orchestration.joins[0].inputPort = "missing";
  assert.ok(codes(team).includes("IR_UNKNOWN_PORT"));
});

test("Loop declarations validate members, disjoint boundary sets and edge direction", () => {
  const team = baseTeam();
  team.agents.push({
    id: "checker",
    packageRef: "role:checker@1",
    bindingRef: "binding:worker",
    inputPorts: { default: { dataSchema: { type: "object" } } },
    outputPorts: { DONE: { dataSchema: { type: "object" } } }
  });
  team.handoffs = [
    { id: "entry", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: {} },
    { id: "inside", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "agent", agentId: "checker", inputPort: "default" }, map: {} },
    { id: "continue", from: { kind: "agent", agentId: "checker", outputPort: "DONE" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: {} },
    { id: "exit", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: {} }
  ];
  team.orchestration.loops = [{
    id: "review-loop",
    members: ["worker", "checker"],
    boundaryAgentId: "worker",
    entryHandoffIds: ["entry"],
    continueHandoffIds: ["continue"],
    exitHandoffIds: ["exit"],
    maxRounds: 3,
    maxAgentActivations: 6,
    onExhausted: "fail"
  }];
  team.orchestration.routes = [{
    from: { kind: "agent", agentId: "worker", outputPort: "DONE" },
    mode: "parallel_fanout",
    onNoMatch: "fail",
    handoffIds: ["inside", "exit"]
  }];
  assert.deepEqual(validateTeamIrReferences(team), []);

  team.orchestration.loops[0].members = ["worker", "missing"];
  team.orchestration.loops[0].continueHandoffIds = ["exit"];
  assert.ok(codes(team).includes("IR_UNKNOWN_AGENT"));
  assert.ok(codes(team).includes("IR_LOOP_CONTINUE_INVALID"));
  assert.ok(codes(team).includes("IR_LOOP_BOUNDARY_HANDOFF_UNDECLARED"));
});

test("Review declarations resolve the Agent output endpoint", () => {
  const team = baseTeam();
  team.orchestration.reviews = [{
    id: "review-worker",
    at: { kind: "agentOutput", agentId: "worker", outputPort: "UNKNOWN" },
    feedbackSchema: { type: "object" },
    timeoutMs: 1000,
    onTimeout: "fail"
  }];
  assert.ok(codes(team).includes("IR_UNKNOWN_PORT"));
  team.orchestration.reviews[0].at.agentId = "absent";
  assert.ok(codes(team).includes("IR_UNKNOWN_AGENT"));
});

test("retry deadline parameters and Join loop scope are validated", () => {
  const team = baseTeam();
  team.bindings[0].retry = { maxAttempts: 2, retryOn: ["timeout"], backoff: { mode: "exponential", initialDelayMs: 1000, maxDelayMs: 500 } };
  assert.ok(codes(team).includes("IR_BINDING_RETRY_INVALID"));

  team.agents.push({
    id: "checker",
    packageRef: "role:checker@1",
    bindingRef: "binding:worker",
    inputPorts: { default: { dataSchema: { type: "object" } }, collect: { dataSchema: { type: "object" } } },
    outputPorts: { DONE: { dataSchema: { type: "object" } } }
  });
  team.handoffs = [
    { id: "entry", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: {} },
    { id: "inside", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "agent", agentId: "checker", inputPort: "collect" }, map: {} }
  ];
  team.orchestration.loops = [{ id: "loop", members: ["worker"], boundaryAgentId: "worker", entryHandoffIds: ["entry"], continueHandoffIds: ["entry"], exitHandoffIds: ["entry"], maxRounds: 1, maxAgentActivations: 1, onExhausted: "fail" }];
  team.orchestration.joins = [{ id: "join", agentId: "checker", inputPort: "collect", mode: "all_of", handoffIds: ["inside"], scope: { kind: "loop", loopId: "loop" } }];
  assert.ok(codes(team).includes("IR_JOIN_SCOPE_INVALID"));
});

test("required-result policy and parallel result writes are checked statically", () => {
  const team = baseTeam();
  team.executionPolicy.resultMode = "required";
  team.handoffs = team.handoffs.filter((handoff) => handoff.to.kind !== "result");
  assert.ok(codes(team).includes("IR_RESULT_REQUIRED_MISSING"));

  team.handoffs.push(
    { id: "result-a", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: {} },
    { id: "result-b", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: {} }
  );
  team.orchestration.routes = [{
    from: { kind: "agent", agentId: "worker", outputPort: "DONE" },
    mode: "parallel_fanout", onNoMatch: "fail", handoffIds: ["result-a", "result-b"]
  }];
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_RESULT_CONFLICT" && item.pointer === "/handoffs"));
});

test("result writes from distinct sources conflict while one exclusive route may select one result", () => {
  const team = baseTeam();
  team.agents.push({
    id: "other",
    packageRef: "role:other@1",
    bindingRef: "binding:worker",
    inputPorts: { default: { dataSchema: { type: "object" } } },
    outputPorts: { DONE: { dataSchema: { type: "object" } } }
  });
  team.handoffs.push(
    { id: "start-other", from: { kind: "run" }, to: { kind: "agent", agentId: "other", inputPort: "default" }, map: {} },
    { id: "other-result", from: { kind: "agent", agentId: "other", outputPort: "DONE" }, to: { kind: "result" }, map: {} }
  );
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_RESULT_CONFLICT" && item.pointer === "/handoffs"));

  team.handoffs = team.handoffs.filter((handoff) => handoff.id !== "other-result");
  team.handoffs.push({
    id: "worker-fallback",
    from: { kind: "agent", agentId: "worker", outputPort: "DONE" },
    to: { kind: "result" },
    map: {},
    when: { priority: 2 }
  });
  team.handoffs.find((handoff) => handoff.id === "worker-result").when = {
    priority: 1,
    condition: { op: "equals", args: [{ "$literal": true }, { "$literal": true }] }
  };
  team.orchestration.routes = [{
    from: { kind: "agent", agentId: "worker", outputPort: "DONE" },
    mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["worker-result", "worker-fallback"]
  }];
  const diagnostics = validateTeamIrReferences(team);
  assert.ok(!diagnostics.some((item) => item.code === "IR_RESULT_CONFLICT"));
  assert.ok(!diagnostics.some((item) => item.code === "IR_ROUTE_FALLBACK_PRIORITY"));
});
