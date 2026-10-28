import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { compileTeamIr } from "../dist/team-ir/compiler.js";
import { validateTeamIr } from "../dist/team-ir/index.js";

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

test("public validator composes schema and cross-reference diagnostics", () => {
  const value = team();
  value.handoffs[0].to.inputPort = "missing";
  const diagnostics = validateTeamIr(value);
  assert.ok(diagnostics.some((item) => item.code === "IR_UNKNOWN_PORT"));
});

test("public validator stops at schema errors before dereferencing malformed content", () => {
  const value = team();
  value.agents = "not-an-array";
  const diagnostics = validateTeamIr(value);
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every((item) => item.code === "IR_SCHEMA_INVALID"));
});

test("public validator maps a missing root-contract Schema reference to a stable diagnostic pointer", () => {
  const value = team();
  value.runInput.dataSchema = { "$ref": "schemas/missing.json#/$defs/request" };
  const diagnostics = validateTeamIr(value);
  assert.ok(diagnostics.some((item) => item.code === "IR_UNKNOWN_SCHEMA_REF"
    && item.pointer === "/runInput/dataSchema/$ref"), JSON.stringify(diagnostics));
});

test("public validator preserves nested Schema reference pointers for missing, out-of-scope and forbidden refs", () => {
  const cases = [
    ["schemas/missing.json#/$defs/request", "IR_UNKNOWN_SCHEMA_REF"],
    ["../outside.json#/$defs/request", "IR_SCHEMA_PATH_OUT_OF_SCOPE"],
    ["https://example.test/schema.json#/$defs/request", "IR_SCHEMA_REF_FORBIDDEN"]
  ];

  for (const [reference, code] of cases) {
    const value = team();
    value.runInput.dataSchema = {
      type: "object",
      properties: { payload: { "$ref": reference } }
    };
    const diagnostics = validateTeamIr(value);
    assert.ok(diagnostics.some((item) => item.code === code
      && item.pointer === "/runInput/dataSchema/properties/payload/$ref"),
    `${reference} should map ${code} to the nested $ref: ${JSON.stringify(diagnostics)}`);
  }
});

test("public validator maps resolver failures to pointers across every embedded Schema root", () => {
  const cases = [
    {
      pointer: "/runInput/preferencesSchema/properties/prefs/$ref",
      mutate(value, reference) {
        value.runInput.preferencesSchema = { type: "object", properties: { prefs: { "$ref": reference } } };
      }
    },
    {
      pointer: "/runResult/dataSchema/properties/result/$ref",
      mutate(value, reference) {
        value.runResult.dataSchema = { type: "object", properties: { result: { "$ref": reference } } };
      }
    },
    {
      pointer: "/agents/0/inputPorts/default/dataSchema/properties/request/$ref",
      mutate(value, reference) {
        value.agents[0].inputPorts.default.dataSchema = { type: "object", properties: { request: { "$ref": reference } } };
      }
    },
    {
      pointer: "/agents/0/outputPorts/DONE/dataSchema/properties/response/$ref",
      mutate(value, reference) {
        value.agents[0].outputPorts.DONE.dataSchema = { type: "object", properties: { response: { "$ref": reference } } };
      }
    },
    {
      pointer: "/orchestration/reviews/0/feedbackSchema/properties/comment/$ref",
      mutate(value, reference) {
        value.orchestration.reviews = [{
          id: "review",
          at: { kind: "agentOutput", agentId: "worker", outputPort: "DONE" },
          feedbackSchema: { type: "object", properties: { comment: { "$ref": reference } }, additionalProperties: false },
          timeoutMs: 1000,
          onTimeout: "fail"
        }];
      }
    },
    {
      pointer: "/runInput/dataSchema/properties/payload~1name~0draft/$ref",
      mutate(value, reference) {
        value.runInput.dataSchema = { type: "object", properties: { "payload/name~draft": { "$ref": reference } } };
      }
    }
  ];
  const references = [
    ["schemas/missing.json#/$defs/item", "IR_UNKNOWN_SCHEMA_REF"],
    ["#/$defs/~2invalid", "IR_UNKNOWN_SCHEMA_REF"]
  ];

  for (const { pointer, mutate } of cases) {
    for (const [reference, code] of references) {
      const value = team();
      mutate(value, reference);
      const diagnostics = validateTeamIr(value);
      assert.ok(diagnostics.some((item) => item.code === code && item.pointer === pointer),
        `${reference} should map ${code} to ${pointer}: ${JSON.stringify(diagnostics)}`);
    }
  }
});

test("public validator maps an unsupported external Schema dialect to each referencing field", () => {
  const value = team();
  value.runResult.dataSchema = { "$ref": "schemas/legacy.json" };
  const diagnostics = validateTeamIr(value, {
    packageSchemas: {
      "schemas/legacy.json": { $schema: "http://json-schema.org/draft-07/schema#", type: "object" }
    }
  });
  assert.ok(diagnostics.some((item) => item.code === "IR_SCHEMA_DIALECT_UNSUPPORTED"
    && item.pointer === "/runResult/dataSchema/$ref"), JSON.stringify(diagnostics));
});

test("classic software Team IR fixture compiles parallel required Join sources", async () => {
  const fixture = JSON.parse(await readFile(new URL("../examples/team-ir-v2/classic-software-team.json", import.meta.url), "utf8"));
  const diagnostics = validateTeamIr(fixture);
  assert.deepEqual(diagnostics.filter((item) => item.severity === "error"), []);
  assert.ok(diagnostics.some((item) => item.code === "IR_MAPPING_RUNTIME_CHECK_REQUIRED"));
  const plan = compileTeamIr(fixture);
  assert.equal(plan.routesBySource.get("agent:planner:PLAN").mode, "parallel_fanout");
  assert.deepEqual(plan.joinsByTarget.get("lead:collect").handoffIds, ["implementer-to-lead", "tester-to-lead"]);
});
