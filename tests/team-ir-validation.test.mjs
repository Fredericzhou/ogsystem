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
  assert.ok(diagnostics.some((item) => item.code === "IR_DUPLICATE_ID" && item.pointer === "/bindings/1/id"));
  assert.ok(diagnostics.some((item) => item.code === "IR_UNKNOWN_BINDING" && item.pointer === "/agents/0/bindingRef"));
  assert.ok(diagnostics.some((item) => item.code === "IR_UNKNOWN_AGENT" && item.pointer === "/handoffs/0/from/agentId"));
  assert.ok(diagnostics.some((item) => item.code === "IR_UNKNOWN_PORT" && item.pointer === "/handoffs/0/to/inputPort"));
});

test("conditional or multiple source handoffs require one route listing exactly those edges", () => {
  const team = baseTeam();
  team.handoffs[1].when = { condition: { op: "equals", args: [{ "$literal": 1 }, { "$literal": 1 }] } };
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_ROUTE_REQUIRED" && item.pointer === "/handoffs/1/from"));

  team.orchestration.routes = [{
    from: { kind: "agent", agentId: "worker", outputPort: "DONE" },
    mode: "exclusive_priority",
    onNoMatch: "fail",
    handoffIds: ["worker-result"]
  }];
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_ROUTE_PRIORITY_REQUIRED" && item.pointer === "/orchestration/routes/0/handoffIds/0"));

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
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_ROUTE_FALLBACK_PRIORITY" && item.pointer === "/orchestration/routes/0/handoffIds"));
  team.handoffs[1].when.priority = 3;
  team.handoffs[2].when.priority = 3;
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_ROUTE_AMBIGUOUS" && item.pointer === "/handoffs/2/when/priority"));
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
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_ROUTE_PRIORITY_FORBIDDEN" && item.pointer === "/handoffs/1/when/priority"));

  team.orchestration.routes[0].handoffIds = ["start-worker"];
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_ROUTE_SOURCE_MISMATCH" && item.pointer === "/orchestration/routes/0/handoffIds/0"));
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

  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_JOIN_UNDECLARED_INBOUND" && item.pointer === "/handoffs/1/to"));
  team.orchestration.joins[0].inputPort = "missing";
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_UNKNOWN_PORT" && item.pointer === "/orchestration/joins/0/inputPort"));
});

test("Join accepts the exact inbound Handoff set and rejects omitted or unrelated IDs", () => {
  const team = baseTeam();
  team.agents.push({
    id: "reviewer",
    packageRef: "role:reviewer@1",
    bindingRef: "binding:worker",
    inputPorts: { collect: { dataSchema: { type: "object" } } },
    outputPorts: { DONE: { dataSchema: { type: "object" } } }
  });
  team.handoffs = [
    { id: "start-worker", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: {} },
    { id: "start-reviewer", from: { kind: "run" }, to: { kind: "agent", agentId: "reviewer", inputPort: "collect" }, map: {} },
    { id: "worker-to-review", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "agent", agentId: "reviewer", inputPort: "collect" }, map: {} },
    { id: "worker-result", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: {} }
  ];
  team.orchestration.routes = [
    { from: { kind: "run" }, mode: "parallel_fanout", onNoMatch: "fail", handoffIds: ["start-worker", "start-reviewer"] },
    { from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, mode: "parallel_fanout", onNoMatch: "fail", handoffIds: ["worker-to-review", "worker-result"] }
  ];
  team.orchestration.joins = [{
    id: "review-join",
    agentId: "reviewer",
    inputPort: "collect",
    mode: "all_of",
    handoffIds: ["start-reviewer", "worker-to-review"]
  }];

  assert.deepEqual(validateTeamIrReferences(team), []);

  team.orchestration.joins[0].handoffIds = ["worker-to-review"];
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_JOIN_UNDECLARED_INBOUND" && item.pointer === "/handoffs/1/to"));

  team.orchestration.joins[0].handoffIds = ["start-reviewer", "worker-to-review", "worker-result"];
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_JOIN_TARGET_MISMATCH" && item.pointer === "/orchestration/joins/0/handoffIds/2"));
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
  const diagnostics = validateTeamIrReferences(team);
  assert.ok(diagnostics.some((item) => item.code === "IR_UNKNOWN_AGENT" && item.pointer === "/orchestration/loops/0/members/1"));
  assert.ok(diagnostics.some((item) => item.code === "IR_LOOP_CONTINUE_INVALID" && item.pointer === "/orchestration/loops/0/continueHandoffIds"));
  assert.ok(diagnostics.some((item) => item.code === "IR_LOOP_BOUNDARY_HANDOFF_UNDECLARED" && item.pointer === "/handoffs/1"));
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
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_UNKNOWN_PORT" && item.pointer === "/orchestration/reviews/0/at/outputPort"));
  team.orchestration.reviews[0].at.agentId = "absent";
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_UNKNOWN_AGENT" && item.pointer === "/orchestration/reviews/0/at/agentId"));
});

test("retry deadline parameters and Join loop scope are validated", () => {
  const team = baseTeam();
  team.bindings[0].retry = { maxAttempts: 2, retryOn: ["timeout"], backoff: { mode: "exponential", initialDelayMs: 1000, maxDelayMs: 500 } };
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_BINDING_RETRY_INVALID" && item.pointer === "/bindings/0/retry/backoff/maxDelayMs"));

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
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_JOIN_SCOPE_INVALID" && item.pointer === "/orchestration/joins/0/agentId"));
});

test("required-result policy and parallel result writes are checked statically", () => {
  const team = baseTeam();
  team.executionPolicy.resultMode = "required";
  team.handoffs = team.handoffs.filter((handoff) => handoff.to.kind !== "result");
  assert.ok(validateTeamIrReferences(team).some((item) => item.code === "IR_RESULT_REQUIRED_MISSING" && item.pointer === "/handoffs"));

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

test("routes report invalid, duplicate, missing and extra source candidates at stable pointers", () => {
  const invalid = baseTeam();
  invalid.orchestration.routes = [{ from: { kind: "result" }, mode: "parallel_fanout", onNoMatch: "fail", handoffIds: [] }];
  assert.ok(validateTeamIrReferences(invalid).some((item) => item.code === "IR_ROUTE_SOURCE_INVALID" && item.pointer === "/orchestration/routes/0/from"));

  const duplicate = baseTeam();
  duplicate.orchestration.routes = [
    { from: { kind: "run" }, mode: "parallel_fanout", onNoMatch: "fail", handoffIds: ["start-worker"] },
    { from: { kind: "run" }, mode: "parallel_fanout", onNoMatch: "fail", handoffIds: ["start-worker"] }
  ];
  assert.ok(validateTeamIrReferences(duplicate).some((item) => item.code === "IR_DUPLICATE_ROUTE" && item.pointer === "/orchestration/routes/1/from"));

  const unknown = baseTeam();
  unknown.orchestration.routes = [{ from: { kind: "run" }, mode: "parallel_fanout", onNoMatch: "fail", handoffIds: ["missing"] }];
  assert.ok(validateTeamIrReferences(unknown).some((item) => item.code === "IR_UNKNOWN_HANDOFF" && item.pointer === "/orchestration/routes/0/handoffIds/0"));

  const omitted = baseTeam();
  omitted.handoffs[1].when = { condition: { op: "exists", args: [{ $ref: "$.output.data.ready" }] } };
  omitted.orchestration.routes = [{ from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: [] }];
  assert.ok(validateTeamIrReferences(omitted).some((item) => item.code === "IR_ROUTE_HANDOFF_OMITTED" && item.pointer === "/orchestration/routes/0/handoffIds"));
  omitted.orchestration.routes[0].handoffIds = ["start-worker", "worker-result"];
  const extra = validateTeamIrReferences(omitted);
  assert.ok(extra.some((item) => item.code === "IR_ROUTE_HANDOFF_EXTRA" && item.pointer === "/orchestration/routes/0/handoffIds"));
  assert.ok(extra.some((item) => item.code === "IR_ROUTE_SOURCE_MISMATCH" && item.pointer === "/orchestration/routes/0/handoffIds/0"));

  const mismatch = baseTeam();
  mismatch.orchestration.routes = [{ from: { kind: "run" }, mode: "parallel_fanout", onNoMatch: "fail", handoffIds: ["start-worker", "worker-result"] }];
  assert.ok(validateTeamIrReferences(mismatch).some((item) => item.code === "IR_ROUTE_HANDOFF_MISMATCH" && item.pointer === "/orchestration/routes/0/handoffIds"));
});

test("route candidate diagnostics cover duplicate fallback and malformed conditions", () => {
  const team = baseTeam();
  team.handoffs.push({ id: "worker-also-result", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: {}, when: { priority: 2 } });
  team.handoffs[1].when = { priority: 1 };
  team.orchestration.routes = [{ from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["worker-result", "worker-also-result"] }];
  let diagnostics = validateTeamIrReferences(team);
  assert.ok(diagnostics.some((item) => item.code === "IR_ROUTE_FALLBACK_DUPLICATE" && item.pointer === "/orchestration/routes/0/handoffIds/1"));

  team.handoffs[1].when = { priority: 1, condition: "invalid" };
  diagnostics = validateTeamIrReferences(team);
  assert.ok(diagnostics.some((item) => item.code === "IR_ROUTE_CONDITION_INVALID" && item.pointer === "/handoffs/1/when/condition"));
  team.orchestration.routes[0].mode = "parallel_fanout";
  delete team.handoffs[1].when.condition;
  diagnostics = validateTeamIrReferences(team);
  assert.ok(diagnostics.some((item) => item.code === "IR_ROUTE_CONDITION_INVALID" && item.pointer === "/handoffs/1/when"));
});

test("Join target, scope and quorum errors point to their invalid declarations", () => {
  const team = baseTeam();
  team.agents.push({ id: "reviewer", packageRef: "role:reviewer@1", bindingRef: "binding:worker", inputPorts: { collect: { dataSchema: { type: "object" } } }, outputPorts: { DONE: { dataSchema: { type: "object" } } } });
  team.handoffs.push({ id: "to-reviewer", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "agent", agentId: "reviewer", inputPort: "collect" }, map: {} });
  team.orchestration.joins = [{ id: "join", agentId: "reviewer", inputPort: "collect", mode: "quorum_of", threshold: 3, handoffIds: ["worker-result", "missing"], scope: { kind: "loop", loopId: "missing-loop" } }];
  const diagnostics = validateTeamIrReferences(team);
  assert.ok(diagnostics.some((item) => item.code === "IR_JOIN_TARGET_MISMATCH" && item.pointer === "/orchestration/joins/0/handoffIds/0"));
  assert.ok(diagnostics.some((item) => item.code === "IR_UNKNOWN_HANDOFF" && item.pointer === "/orchestration/joins/0/handoffIds/1"));
  assert.ok(diagnostics.some((item) => item.code === "IR_UNKNOWN_LOOP" && item.pointer === "/orchestration/joins/0/scope/loopId"));
  assert.ok(diagnostics.some((item) => item.code === "IR_JOIN_THRESHOLD_INVALID" && item.pointer === "/orchestration/joins/0/threshold"));
});

test("Loop boundary declarations report duplicates, overlap and invalid edge directions", () => {
  const team = baseTeam();
  team.agents.push({ id: "checker", packageRef: "role:checker@1", bindingRef: "binding:worker", inputPorts: { default: { dataSchema: { type: "object" } } }, outputPorts: { DONE: { dataSchema: { type: "object" } } } });
  team.handoffs.push({ id: "inside", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "agent", agentId: "checker", inputPort: "default" }, map: {} });
  team.orchestration.loops = [{ id: "loop", members: ["worker", "worker"], boundaryAgentId: "checker", entryHandoffIds: ["worker-result", "worker-result"], continueHandoffIds: ["worker-result"], exitHandoffIds: ["start-worker", "missing"], maxRounds: 1, maxAgentActivations: 2, onExhausted: "fail" }];
  const diagnostics = validateTeamIrReferences(team);
  assert.ok(diagnostics.some((item) => item.code === "IR_LOOP_MEMBER_DUPLICATE" && item.pointer === "/orchestration/loops/0/members"));
  assert.ok(diagnostics.some((item) => item.code === "IR_LOOP_BOUNDARY_INVALID" && item.pointer === "/orchestration/loops/0/boundaryAgentId"));
  assert.ok(diagnostics.some((item) => item.code === "IR_LOOP_HANDOFF_DUPLICATE" && item.pointer === "/orchestration/loops/0/entryHandoffIds"));
  assert.ok(diagnostics.some((item) => item.code === "IR_LOOP_HANDOFF_SET_OVERLAP" && item.pointer === "/orchestration/loops/0"));
  assert.ok(diagnostics.some((item) => item.code === "IR_UNKNOWN_HANDOFF" && item.pointer === "/orchestration/loops/0/exitHandoffIds/1"));
  assert.ok(diagnostics.some((item) => item.code === "IR_LOOP_ENTRY_INVALID" && item.pointer === "/orchestration/loops/0/entryHandoffIds"));
  assert.ok(diagnostics.some((item) => item.code === "IR_LOOP_EXIT_INVALID" && item.pointer === "/orchestration/loops/0/exitHandoffIds"));
});
