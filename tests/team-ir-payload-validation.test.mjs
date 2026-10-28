import assert from "node:assert/strict";
import test from "node:test";
import { assertValidTeamPayload, compileTeamIr, TeamPayloadValidationError, validateTeamPayload } from "../dist/team-ir/index.js";
import { validateTeamIrMappings } from "../dist/team-ir/mapping-validation.js";
import { TeamSchemaResolver } from "../dist/team-ir/schema-resolver.js";

function team() {
  return {
    schemaVersion: 2,
    team: { id: "payload-check", version: "1" },
    runInput: {
      dataSchema: { type: "object", properties: { prompt: { type: "string", minLength: 2 } }, required: ["prompt"], additionalProperties: false },
      preferencesSchema: { type: "object", properties: { concise: { type: "boolean" } }, additionalProperties: false },
      artifactSlots: {}
    },
    runResult: { dataSchema: { "$ref": "schemas/contracts.json#/$defs/result" }, artifactSlots: {} },
    executionPolicy: { resultMode: "required", activeExecutionBudgetMs: 5000 },
    agents: [{
      id: "worker", packageRef: "role:worker@1", bindingRef: "binding:worker",
      inputPorts: { draft: { dataSchema: { "$ref": "schemas/contracts.json#/$defs/input" } } },
      outputPorts: { DONE: { dataSchema: { type: "object", properties: { answer: { "$ref": "#/$defs/nonEmpty" } }, required: ["answer"], additionalProperties: false } } }
    }],
    handoffs: [
      { id: "start", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "draft" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, delivery: { deadlineMs: 1000 } },
      { id: "result", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { code: { "$literal": 0 } } } }
    ],
    orchestration: { routes: [], joins: [], loops: [], reviews: [{ id: "review", at: { kind: "agentOutput", agentId: "worker", outputPort: "DONE" }, feedbackSchema: { type: "object", properties: { decision: { enum: ["approve", "reject"] } }, required: ["decision"], additionalProperties: false }, timeoutMs: 1000, onTimeout: "fail" }] },
    bindings: [{ id: "binding:worker", kind: "model", modelRef: "models/default", attemptTimeoutMs: 500, retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } } }],
    $defs: { nonEmpty: { type: "string", minLength: 1 } }
  };
}

function compile(value = team()) {
  return compileTeamIr(value, { packageSchemas: {
    "schemas/contracts.json": {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $defs: {
        input: { type: "object", properties: { prompt: { type: "string", minLength: 2 } }, required: ["prompt"], additionalProperties: false },
        result: { type: "object", properties: { code: { type: "integer", minimum: 0 } }, required: ["code"], additionalProperties: false }
      }
    }
  } });
}

test("payload validator accepts declared Run, Agent, output, Result and Review payloads", () => {
  const plan = compile();
  const values = [
    [{ kind: "run-input", part: "input" }, { prompt: "ship" }],
    [{ kind: "run-input", part: "preferences" }, { concise: true }],
    [{ kind: "agent-input", agentId: "worker", portId: "draft" }, { prompt: "ship" }],
    [{ kind: "agent-output", agentId: "worker", portId: "DONE" }, { answer: "ready" }],
    [{ kind: "run-result" }, { code: 0 }],
    [{ kind: "review-feedback", reviewId: "review" }, { decision: "approve" }]
  ];
  for (const [target, value] of values) assert.deepEqual(validateTeamPayload(plan, target, value), []);
  assert.ok(plan.schemaSnapshot.some((resource) => resource.path === "schemas/contracts.json"));
});

test("payload validator reports stable runtime diagnostic codes and JSON Pointers", () => {
  const plan = compile();
  const invalid = [
    [{ kind: "run-input", part: "input" }, {}, "/runInput/dataSchema/prompt"],
    [{ kind: "run-input", part: "input" }, { prompt: null }, "/runInput/dataSchema/prompt"],
    [{ kind: "run-input", part: "input" }, null, "/runInput/dataSchema"],
    [{ kind: "agent-input", agentId: "worker", portId: "draft" }, { prompt: "x" }, "/agents/0/inputPorts/draft/dataSchema/prompt"],
    [{ kind: "agent-output", agentId: "worker", portId: "DONE" }, { answer: "" }, "/agents/0/outputPorts/DONE/dataSchema/answer"],
    [{ kind: "run-result" }, { code: -1 }, "/runResult/dataSchema/code"],
    [{ kind: "review-feedback", reviewId: "review" }, { decision: "later" }, "/orchestration/reviews/0/feedbackSchema/decision"]
  ];
  for (const [target, value, pointer] of invalid) {
    const diagnostics = validateTeamPayload(plan, target, value);
    assert.ok(diagnostics.length > 0);
    assert.ok(diagnostics.every((item) => item.code === "IR_RUNTIME_SCHEMA_INVALID"));
    assert.ok(diagnostics.some((item) => item.pointer === pointer), `${JSON.stringify(target)} should identify ${pointer}: ${JSON.stringify(diagnostics)}`);
  }
  assert.throws(() => assertValidTeamPayload(plan, invalid[1][0], invalid[1][1]), TeamPayloadValidationError);
});

test("invalid mapped Agent input can be rejected before the Binding invocation", () => {
  const plan = compile();
  let bindingCalls = 0;
  const input = { prompt: "x" };
  assert.throws(() => {
    assertValidTeamPayload(plan, { kind: "agent-input", agentId: "worker", portId: "draft" }, input);
    bindingCalls += 1;
  }, TeamPayloadValidationError);
  assert.equal(bindingCalls, 0);
});

test("complex oneOf, not, and if-then-else constraints warn at compile time and reject invalid payloads at runtime", () => {
  const value = team();
  value.agents[0].inputPorts.draft.dataSchema = {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        oneOf: [
          { minLength: 5 },
          { pattern: "^[A-Z]+$" }
        ],
        not: { const: "forbidden" },
        if: { pattern: "^[A-Z]+$" },
        then: { minLength: 3 },
        else: { minLength: 5 }
      }
    },
    required: ["prompt"],
    additionalProperties: false
  };
  value.handoffs[0].map.data.prompt = { "$ref": "$.run.input.prompt" };
  const plan = compile(value);
  const mappingDiagnostics = validateTeamIrMappings({ document: value, resolver: new TeamSchemaResolver({ teamDocument: value }) });
  assert.ok(mappingDiagnostics.some((item) => item.code === "IR_MAPPING_RUNTIME_CHECK_REQUIRED"
      && item.severity === "warning" && item.pointer === "/handoffs/0/map/data/prompt"),
    JSON.stringify(mappingDiagnostics));

  const target = { kind: "agent-input", agentId: "worker", portId: "draft" };
  assert.deepEqual(validateTeamPayload(plan, target, { prompt: "ships" }), []);
  for (const query of ["ABCDEF", "AB", "forbidden"]) {
    const diagnostics = validateTeamPayload(plan, target, { prompt: query });
    assert.ok(diagnostics.some((item) => item.code === "IR_RUNTIME_SCHEMA_INVALID" && item.pointer === "/agents/0/inputPorts/draft/dataSchema/prompt"),
      `${query} should fail its complex Schema at the payload field: ${JSON.stringify(diagnostics)}`);
  }
  assert.throws(() => assertValidTeamPayload(plan, target, { prompt: "ABCDEF" }), TeamPayloadValidationError);
});
