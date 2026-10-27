import assert from "node:assert/strict";
import test from "node:test";
import { validateTeamIrMappings } from "../dist/team-ir/mapping-validation.js";
import { TeamSchemaResolver } from "../dist/team-ir/schema-resolver.js";

function baseTeam() {
  return {
    schemaVersion: 2,
    team: { id: "mapping-team", version: "1.0.0" },
    runInput: {
      dataSchema: { "$ref": "#/$defs/runInput" },
      preferencesSchema: { type: "object" },
      artifactSlots: {}
    },
    runResult: { dataSchema: { "$ref": "#/$defs/result" }, artifactSlots: {} },
    executionPolicy: { resultMode: "required", activeExecutionBudgetMs: 10000 },
    agents: [{
      id: "worker",
      packageRef: "role:worker@1",
      bindingRef: "binding:worker",
      inputPorts: { default: { dataSchema: { "$ref": "#/$defs/input" } } },
      outputPorts: { DONE: { dataSchema: { "$ref": "#/$defs/output" } } }
    }],
    handoffs: [
      {
        id: "start-worker",
        from: { kind: "run" },
        to: { kind: "agent", agentId: "worker", inputPort: "default" },
        map: { data: { query: { "$ref": "$.run.input.query" } } }
      },
      {
        id: "worker-result",
        from: { kind: "agent", agentId: "worker", outputPort: "DONE" },
        to: { kind: "result" },
        map: { data: { answer: { "$ref": "$.output.data.answer" } } }
      }
    ],
    orchestration: { routes: [], joins: [], loops: [], reviews: [] },
    bindings: [{ id: "binding:worker", kind: "model", modelRef: "models/example" }],
    $defs: {
      runInput: { type: "object", properties: { query: { type: "string" }, optionalNote: { type: "string" } }, required: ["query"], additionalProperties: false },
      input: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
      output: { type: "object", properties: { answer: { type: "string" }, count: { type: "integer" }, maybe: { type: "string" } }, required: ["answer", "count"], additionalProperties: false },
      result: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false }
    }
  };
}

function validate(team) {
  return validateTeamIrMappings({ document: team, resolver: new TeamSchemaResolver({ teamDocument: team }) });
}

function codes(team) {
  return validate(team).map((item) => item.code);
}

test("valid local schema references and required mappings pass", () => {
  assert.deepEqual(validate(baseTeam()), []);
});

test("source path lookup rejects unknown fields and disallowed reference roots", () => {
  const team = baseTeam();
  team.handoffs[0].map.data.query = { "$ref": "$.output.data.answer" };
  team.handoffs[1].map.data.answer = { "$ref": "$.output.data.notDeclared" };
  const diagnostics = validate(team);
  assert.ok(diagnostics.some((item) => item.code === "IR_MAPPING_REF_SCOPE_INVALID"));
  assert.ok(diagnostics.some((item) => item.code === "IR_MAPPING_SOURCE_MISSING"));
});

test("source optionality and simple type direction are checked against required targets", () => {
  const team = baseTeam();
  team.handoffs[0].map.data.query = { "$ref": "$.run.input.optionalNote" };
  team.handoffs[1].map.data.answer = { "$ref": "$.output.data.count" };
  const found = validate(team);
  assert.ok(found.some((item) => item.code === "IR_MAPPING_OPTIONAL_TO_REQUIRED"));
  assert.ok(found.some((item) => item.code === "IR_MAPPING_TYPE_INCOMPATIBLE"));
});

test("literal mappings check nested object and array item types at the target pointer", () => {
  const team = baseTeam();
  team.$defs.runInput.properties.query = { type: "object", properties: { count: { type: "integer" } }, required: ["count"], additionalProperties: false };
  team.handoffs[0].map.data.query = { "$literal": { count: "one" } };
  team.$defs.input.properties.query = { type: "object", properties: { count: { type: "integer" } }, required: ["count"], additionalProperties: false };
  let found = validate(team);
  assert.ok(found.some((item) => item.code === "IR_MAPPING_TYPE_INCOMPATIBLE" && item.pointer === "/handoffs/0/map/data/query"));

  team.$defs.runInput.properties.query = { type: "array", items: { type: "integer" } };
  team.$defs.input.properties.query = { type: "array", items: { type: "integer" } };
  team.handoffs[0].map.data.query = { "$literal": [1, "two"] };
  found = validate(team);
  assert.ok(found.some((item) => item.code === "IR_MAPPING_TYPE_INCOMPATIBLE" && item.pointer === "/handoffs/0/map/data/query"));
});

test("array index references honor items, tuple positions, minItems and maxItems", () => {
  const team = baseTeam();
  team.$defs.runInput.properties.values = { type: "array", items: { type: "string" }, minItems: 1 };
  team.$defs.runInput.required = ["values"];
  team.$defs.input.properties.query = { type: "string" };
  team.handoffs[0].map.data.query = { "$ref": "$.run.input.values[0]" };
  assert.deepEqual(validate(team), []);

  team.$defs.runInput.properties.values = { type: "array", prefixItems: [{ type: "integer" }], items: false, minItems: 1, maxItems: 1 };
  let found = validate(team);
  assert.ok(found.some((item) => item.code === "IR_MAPPING_TYPE_INCOMPATIBLE" && item.pointer === "/handoffs/0/map/data/query"));

  team.$defs.runInput.properties.values = { type: "array", items: { type: "string" }, maxItems: 0 };
  found = validate(team);
  assert.ok(found.some((item) => item.code === "IR_MAPPING_SOURCE_MISSING" && item.pointer === "/handoffs/0/map/data/query"));
});

test("array construction checks tuple item positions and forbidden extra items", () => {
  const team = baseTeam();
  team.$defs.input.properties.query = {
    type: "array", prefixItems: [{ type: "integer" }, { type: "string" }], items: false, minItems: 2, maxItems: 2
  };
  team.handoffs[0].map.data.query = [{ "$literal": 1 }, { "$literal": "ok" }];
  assert.deepEqual(validate(team), []);

  team.handoffs[0].map.data.query = [{ "$literal": 1 }, { "$literal": 2 }, { "$literal": 3 }];
  const found = validate(team);
  assert.ok(found.some((item) => item.code === "IR_MAPPING_TYPE_INCOMPATIBLE" && item.pointer === "/handoffs/0/map/data/query"));
});

test("missing and unknown target fields are diagnosed", () => {
  const team = baseTeam();
  team.handoffs[0].map.data = { extra: { "$literal": "x" } };
  team.handoffs[1].map.data = {};
  const found = validate(team);
  assert.ok(found.some((item) => item.code === "IR_MAPPING_REQUIRED_FIELD_MISSING"));
  assert.ok(found.some((item) => item.code === "IR_MAPPING_TARGET_FIELD_UNKNOWN"));
});

test("references resolve package schemas relative to their containing schema resource", () => {
  const team = baseTeam();
  team.agents[0].outputPorts.DONE.dataSchema = { "$ref": "schemas/output.json#/$defs/result" };
  const resolver = new TeamSchemaResolver({
    teamDocument: team,
    packageSchemas: {
      "schemas/output.json": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$defs": { result: { type: "object", properties: { answer: { "$ref": "strings.json#/$defs/text" } }, required: ["answer"] } }
      },
      "schemas/strings.json": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$defs": { text: { type: "string" } }
      }
    }
  });
  assert.deepEqual(validateTeamIrMappings({ document: team, resolver }), []);
});

test("Join detects duplicate providers, missing required contributions and optional conditional sources", () => {
  const team = baseTeam();
  team.agents.push({
    id: "other",
    packageRef: "role:other@1",
    bindingRef: "binding:worker",
    inputPorts: { default: { dataSchema: { type: "object" } } },
    outputPorts: { DONE: { dataSchema: { "$ref": "#/$defs/output" } } }
  });
  team.agents[0].inputPorts = { collect: { dataSchema: { "$ref": "#/$defs/joinInput" } } };
  team.handoffs = [
    { id: "from-worker", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "agent", agentId: "worker", inputPort: "collect" }, map: { data: { first: { "$ref": "$.output.data.answer" } } }, when: { condition: { op: "exists", args: [{ "$ref": "$.output.data.maybe" }] } } },
    { id: "from-other", from: { kind: "agent", agentId: "other", outputPort: "DONE" }, to: { kind: "agent", agentId: "worker", inputPort: "collect" }, map: { data: { first: { "$ref": "$.output.data.answer" }, second: { "$ref": "$.output.data.answer" } } } },
    { id: "collect-result", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } } }
  ];
  team.orchestration.joins = [{
    id: "collect-join",
    agentId: "worker",
    inputPort: "collect",
    mode: "all_of",
    handoffIds: ["from-worker", "from-other"],
    baseMapping: { data: { common: { "$ref": "$.run.input.query" } } }
  }];
  team.$defs.joinInput = {
    type: "object",
    properties: { common: { type: "string" }, first: { type: "string" }, second: { type: "string" } },
    required: ["common", "first", "second", "missing"],
    additionalProperties: false
  };
  team.orchestration.routes = [{ from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, mode: "parallel_fanout", onNoMatch: "fail", handoffIds: ["from-worker"] }];

  const found = codes(team);
  assert.ok(found.includes("IR_JOIN_FIELD_CONFLICT"));
  assert.ok(found.includes("IR_JOIN_CONDITIONAL_REQUIRED_SOURCE"));
  assert.ok(found.includes("IR_JOIN_REQUIRED_FIELD_MISSING"));

  team.orchestration.joins[0].baseMapping.data.first = { "$ref": "$.output.data.answer" };
  const baseMappingDiagnostics = validate(team);
  assert.ok(baseMappingDiagnostics.some((item) => item.code === "IR_MAPPING_REF_SCOPE_INVALID"));
  assert.ok(baseMappingDiagnostics.some((item) => item.code === "IR_JOIN_FIELD_CONFLICT"));
});

test("Join single-source contribution is checked with baseMapping as one complete field union", () => {
  const team = baseTeam();
  team.agents[0].inputPorts = {
    default: { dataSchema: { "$ref": "#/$defs/input" } },
    collect: { dataSchema: { "$ref": "#/$defs/joinInput" } }
  };
  team.handoffs = [
    { id: "start-worker", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: { data: { query: { "$ref": "$.run.input.query" } } } },
    { id: "join-worker", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "agent", agentId: "worker", inputPort: "collect" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } } },
    { id: "collect-result", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } } }
  ];
  team.$defs.joinInput = {
    type: "object",
    properties: { common: { type: "string" }, answer: { type: "string" } },
    required: ["common", "answer"],
    additionalProperties: false
  };
  team.orchestration.joins = [{
    id: "single-source",
    agentId: "worker",
    inputPort: "collect",
    mode: "all_of",
    handoffIds: ["join-worker"],
    baseMapping: { data: { common: { "$ref": "$.run.input.query" } } }
  }];

  const found = validate(team);
  assert.deepEqual(found, []);
});

test("result Handoff requires each required field and typechecks its selected providers", () => {
  const team = baseTeam();
  team.$defs.result.properties.extra = { type: "integer" };
  team.$defs.result.required = ["answer", "extra"];
  team.handoffs[1].map.data = { answer: { "$ref": "$.output.data.answer" } };
  let found = validate(team);
  assert.ok(found.some((item) => item.code === "IR_MAPPING_REQUIRED_FIELD_MISSING" && item.pointer === "/handoffs/1/map/data/extra"));

  team.handoffs[1].map.data.extra = { "$literal": "wrong" };
  found = validate(team);
  assert.ok(found.some((item) => item.code === "IR_MAPPING_TYPE_INCOMPATIBLE" && item.pointer === "/handoffs/1/map/data/extra"));
});

test("quorum contributions that may arrive after threshold cannot fill required target fields", () => {
  const team = baseTeam();
  team.agents.push({
    id: "collector",
    packageRef: "role:collector@1",
    bindingRef: "binding:worker",
    inputPorts: { collect: { dataSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } } },
    outputPorts: { DONE: { dataSchema: { "$ref": "#/$defs/output" } } }
  });
  team.agents.push({
    id: "other",
    packageRef: "role:other@1",
    bindingRef: "binding:worker",
    inputPorts: { default: { dataSchema: { type: "object" } } },
    outputPorts: { DONE: { dataSchema: { "$ref": "#/$defs/output" } } }
  });
  team.handoffs = [
    { id: "worker-contributor", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "agent", agentId: "collector", inputPort: "collect" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } } },
    { id: "other-contributor", from: { kind: "agent", agentId: "other", outputPort: "DONE" }, to: { kind: "agent", agentId: "collector", inputPort: "collect" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } } },
    { id: "collector-result", from: { kind: "agent", agentId: "collector", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } } }
  ];
  team.orchestration.joins = [{ id: "quorum", agentId: "collector", inputPort: "collect", mode: "quorum_of", threshold: 1, handoffIds: ["worker-contributor", "other-contributor"] }];
  assert.ok(codes(team).includes("IR_QUORUM_FIELD_MUST_BE_OPTIONAL"));
});

test("Join required fields cannot rely on a source behind a conditional Run route", () => {
  const team = baseTeam();
  team.agents = [
    team.agents[0],
    {
      id: "relay",
      packageRef: "role:relay@1",
      bindingRef: "binding:worker",
      inputPorts: { default: { dataSchema: { type: "object" } } },
      outputPorts: { DONE: { dataSchema: { "$ref": "#/$defs/output" } } }
    },
    {
      id: "collector",
      packageRef: "role:collector@1",
      bindingRef: "binding:worker",
      inputPorts: { collect: { dataSchema: { "$ref": "#/$defs/joinInput" } } },
      outputPorts: { DONE: { dataSchema: { "$ref": "#/$defs/output" } } }
    }
  ];
  team.$defs.joinInput = {
    type: "object",
    properties: { workerAnswer: { type: "string" }, relayAnswer: { type: "string" } },
    required: ["workerAnswer", "relayAnswer"],
    additionalProperties: false
  };
  team.handoffs = [
    { id: "start-worker", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: { data: { query: { "$ref": "$.run.input.query" } } } },
    { id: "start-relay", from: { kind: "run" }, to: { kind: "agent", agentId: "relay", inputPort: "default" }, map: { data: {} }, when: { condition: { op: "exists", args: [{ "$ref": "$.run.input.optionalNote" }] } } },
    { id: "worker-join", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "agent", agentId: "collector", inputPort: "collect" }, map: { data: { workerAnswer: { "$ref": "$.output.data.answer" } } } },
    { id: "relay-join", from: { kind: "agent", agentId: "relay", outputPort: "DONE" }, to: { kind: "agent", agentId: "collector", inputPort: "collect" }, map: { data: { relayAnswer: { "$ref": "$.output.data.answer" } } } },
    { id: "collector-result", from: { kind: "agent", agentId: "collector", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } } }
  ];
  team.orchestration.routes = [{ from: { kind: "run" }, mode: "parallel_fanout", onNoMatch: "fail", handoffIds: ["start-worker", "start-relay"] }];
  team.orchestration.joins = [{ id: "collect", agentId: "collector", inputPort: "collect", mode: "all_of", handoffIds: ["worker-join", "relay-join"] }];

  assert.ok(codes(team).includes("IR_JOIN_CONDITIONAL_REQUIRED_SOURCE"));
});

test("Join required fields cannot rely on a source Agent with no guaranteed activation path", () => {
  const team = baseTeam();
  team.agents.push({
    id: "orphan",
    packageRef: "role:orphan@1",
    bindingRef: "binding:worker",
    inputPorts: { default: { dataSchema: { type: "object" } } },
    outputPorts: { DONE: { dataSchema: { "$ref": "#/$defs/output" } } }
  });
  team.agents[0].inputPorts.collect = { dataSchema: { "$ref": "#/$defs/joinInput" } };
  team.$defs.joinInput = {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false
  };
  team.handoffs = [
    { id: "start-worker", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: { data: { query: { "$ref": "$.run.input.query" } } } },
    { id: "orphan-join", from: { kind: "agent", agentId: "orphan", outputPort: "DONE" }, to: { kind: "agent", agentId: "worker", inputPort: "collect" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } } },
    { id: "worker-result", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } } }
  ];
  team.orchestration.joins = [{ id: "collect", agentId: "worker", inputPort: "collect", mode: "all_of", handoffIds: ["orphan-join"] }];

  assert.ok(codes(team).includes("IR_JOIN_CONDITIONAL_REQUIRED_SOURCE"));
});

function loopTeam() {
  const team = baseTeam();
  team.agents[0].id = "writer";
  team.agents[0].inputPorts = { draft: { dataSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } } };
  team.agents.push({
    id: "reviewer",
    packageRef: "role:reviewer@1",
    bindingRef: "binding:worker",
    inputPorts: { default: { dataSchema: { type: "object" } } },
    outputPorts: { REVIEWED: { dataSchema: { type: "object" } } }
  });
  team.handoffs = [
    { id: "loop-entry", from: { kind: "run" }, to: { kind: "agent", agentId: "writer", inputPort: "draft" }, map: { data: { query: { "$ref": "$.run.input.query" } } } },
    { id: "to-reviewer", from: { kind: "agent", agentId: "writer", outputPort: "DONE" }, to: { kind: "agent", agentId: "reviewer", inputPort: "default" }, map: {} },
    { id: "revise", from: { kind: "agent", agentId: "reviewer", outputPort: "REVIEWED" }, to: { kind: "agent", agentId: "writer", inputPort: "draft" }, map: { data: { query: { "$ref": "$.loop.previous.writer.output.data.answer" } } } },
    { id: "loop-finish", from: { kind: "agent", agentId: "writer", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } } }
  ];
  team.orchestration.loops = [{
    id: "revision-loop", members: ["writer", "reviewer"], boundaryAgentId: "writer",
    entryHandoffIds: ["loop-entry"], continueHandoffIds: ["revise"], exitHandoffIds: ["loop-finish"],
    maxRounds: 3, maxAgentActivations: 6, onExhausted: "fail"
  }];
  return team;
}

test("Loop previous reference passes when the anchor dominates the reader in the Loop DAG", () => {
  const team = loopTeam();
  assert.ok(!codes(team).includes("IR_LOOP_PREVIOUS_NOT_DOMINATED"));
});

test("Loop previous reference rejects a bypass path, external initialization and conditional route", () => {
  const bypass = loopTeam();
  bypass.agents.push({
    id: "editor", packageRef: "role:editor@1", bindingRef: "binding:worker",
    inputPorts: { default: { dataSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
    outputPorts: { DONE: { dataSchema: { type: "object" } } }
  });
  bypass.orchestration.loops[0].members.push("editor");
  bypass.handoffs.push({
    id: "bypass-reader", from: { kind: "agent", agentId: "writer", outputPort: "DONE" },
    to: { kind: "agent", agentId: "editor", inputPort: "default" },
    map: { data: { query: { "$ref": "$.loop.previous.reviewer.output.data.note" } } }
  });
  bypass.agents[1].outputPorts.REVIEWED.dataSchema = { type: "object", properties: { note: { type: "string" } }, required: ["note"] };
  assert.ok(codes(bypass).includes("IR_LOOP_PREVIOUS_NOT_DOMINATED"));

  const external = loopTeam();
  external.orchestration.loops[0].members = ["reviewer"];
  external.orchestration.loops[0].boundaryAgentId = "reviewer";
  external.orchestration.loops[0].entryHandoffIds = ["loop-entry"];
  assert.ok(codes(external).includes("IR_LOOP_REF_OUT_OF_SCOPE"));

  const noInitializer = loopTeam();
  noInitializer.handoffs = noInitializer.handoffs.filter((item) => item.id !== "to-reviewer");
  assert.ok(codes(noInitializer).includes("IR_LOOP_PREVIOUS_NOT_DOMINATED"));

  const conditional = loopTeam();
  conditional.handoffs.find((item) => item.id === "to-reviewer").when = { condition: { op: "equals", args: ["x", "y"] } };
  assert.ok(codes(conditional).includes("IR_LOOP_PREVIOUS_NOT_DOMINATED"));
});

test("artifact mappings enforce required slots and media type compatibility", () => {
  const team = baseTeam();
  team.agents[0].outputPorts.DONE.artifactSlots = { report: { required: true, mediaTypes: ["text/plain"], cardinality: "single" } };
  team.runResult.artifactSlots = { report: { required: true, acceptedMediaTypes: ["application/json"], cardinality: "single" } };
  team.handoffs[1].map.artifacts = { report: { "$ref": "$.output.artifacts.report" } };
  assert.ok(codes(team).includes("IR_MAPPING_ARTIFACT_MEDIA_TYPE_INCOMPATIBLE"));

  team.runResult.artifactSlots.report.acceptedMediaTypes = ["text/plain"];
  assert.ok(!codes(team).includes("IR_MAPPING_ARTIFACT_MEDIA_TYPE_INCOMPATIBLE"));
  delete team.handoffs[1].map.artifacts;
  assert.ok(codes(team).includes("IR_MAPPING_REQUIRED_ARTIFACT_MISSING"));
});

test("route conditions resolve source paths and enforce route scope while exists permits optional properties", () => {
  const team = baseTeam();
  team.handoffs.push({
    id: "worker-fallback",
    from: { kind: "agent", agentId: "worker", outputPort: "DONE" },
    to: { kind: "result" },
    when: { priority: 0 },
    map: { data: { answer: { "$ref": "$.output.data.answer" } } }
  });
  team.handoffs[1].when = { priority: 1, condition: { op: "exists", args: [{ "$ref": "$.output.data.maybe" }] } };
  team.orchestration.routes = [{
    from: { kind: "agent", agentId: "worker", outputPort: "DONE" },
    mode: "exclusive_priority",
    onNoMatch: "fail",
    handoffIds: ["worker-result", "worker-fallback"]
  }];
  assert.ok(!codes(team).includes("IR_MAPPING_SOURCE_MISSING"));

  team.handoffs[1].when.condition = { op: "equals", args: [{ "$ref": "$.run.input.query" }, { "$literal": "x" }] };
  assert.ok(codes(team).includes("IR_MAPPING_REF_SCOPE_INVALID"));

  team.handoffs[1].when.condition = { op: "equals", args: [{ "$ref": "$.output.data.absent" }, { "$literal": "x" }] };
  assert.ok(codes(team).includes("IR_MAPPING_SOURCE_MISSING"));
});

test("complex target constraints retain a runtime validation warning", () => {
  const team = baseTeam();
  team.$defs.result.properties.answer = { type: "string", pattern: "^[A-Z]+$" };
  const found = validate(team);
  assert.ok(found.some((item) => item.code === "IR_MAPPING_RUNTIME_CHECK_REQUIRED" && item.severity === "warning"));
});
