import assert from "node:assert/strict";
import test from "node:test";
import { getTeamIrV2JsonSchema, parseTeamIr, validateTeamIrSchema } from "../dist/team-ir/schema.js";

function minimalTeam() {
  return {
    schemaVersion: 2,
    team: { id: "simple-team", version: "1.0.0" },
    runInput: { dataSchema: { type: "object" }, preferencesSchema: { type: "object" }, artifactSlots: {} },
    runResult: { dataSchema: { type: "object", required: ["answer"] }, artifactSlots: {} },
    executionPolicy: { resultMode: "required", activeExecutionBudgetMs: 10000 },
    agents: [{
      id: "worker",
      packageRef: "role:worker@1",
      bindingRef: "binding:worker",
      inputPorts: { default: { dataSchema: { type: "object" } } },
      outputPorts: { DONE: { dataSchema: { type: "object", required: ["answer"] } } }
    }],
    handoffs: [
      { id: "start-worker", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: { data: {} }, delivery: { deadlineMs: 10000 } },
      { id: "worker-result", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } } }
    ],
    orchestration: { routes: [], joins: [], loops: [], reviews: [] },
    bindings: [{
      id: "binding:worker", kind: "model", modelRef: "models/example", attemptTimeoutMs: 5000,
      retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } }
    }]
  };
}

test("Team IR v2 schema declares Draft 2020-12 and accepts a minimal document", () => {
  assert.equal(getTeamIrV2JsonSchema()["$schema"], "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(parseTeamIr(minimalTeam()).diagnostics, []);
});

test("schema parser returns stable pointers for missing root contracts and unknown fields", () => {
  const value = minimalTeam();
  delete value.runInput;
  value.legacy = true;
  const diagnostics = validateTeamIrSchema(value);
  assert.ok(diagnostics.some((item) => item.pointer === "/runInput" && item.code === "IR_SCHEMA_INVALID"));
  assert.ok(diagnostics.some((item) => item.pointer === "/legacy" && item.code === "IR_SCHEMA_INVALID"));
});

test("endpoint schema rejects implicit endpoints and malformed agent ports", () => {
  const value = minimalTeam();
  value.handoffs[0].to = { kind: "agent", agentId: "worker" };
  const diagnostics = validateTeamIrSchema(value);
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.some((item) => item.pointer.startsWith("/handoffs/0/to")));
});

test("schema supports only single-cardinality declared artifact slots", () => {
  const value = minimalTeam();
  value.runInput.artifactSlots = { brief: { required: true, acceptedMediaTypes: ["text/markdown"], cardinality: "single" } };
  assert.deepEqual(validateTeamIrSchema(value), []);
  value.runInput.artifactSlots.brief.cardinality = "many";
  assert.ok(validateTeamIrSchema(value).some((item) => item.pointer === "/runInput/artifactSlots/brief/cardinality"));
});

test("condition schema is closed and enforces operator argument arity", () => {
  const value = minimalTeam();
  value.handoffs[0].when = {
    priority: 10,
    condition: { op: "and", args: [
      { op: "exists", args: [{ "$ref": "$.run.input.request" }] },
      { op: "equals", args: [{ "$ref": "$.run.input.request" }, { "$literal": "yes" }] }
    ] }
  };
  assert.deepEqual(validateTeamIrSchema(value), []);
  value.handoffs[0].when.condition.args[0].extra = true;
  assert.ok(validateTeamIrSchema(value).some((item) => item.pointer.includes("/when/condition")));
});

test("agent handoffs and Join declarations require explicit bounded deadlines", () => {
  const value = minimalTeam();
  delete value.handoffs[0].delivery;
  let diagnostics = validateTeamIrSchema(value);
  assert.ok(diagnostics.some((item) => item.pointer === "/handoffs/0/delivery"));

  value.handoffs[0].delivery = { deadlineMs: 10000 };
  value.orchestration.joins = [{
    id: "worker-join", agentId: "worker", inputPort: "default", mode: "all_of", handoffIds: ["start-worker"],
    scope: { kind: "run" }, timeoutMs: 5000, onTimeout: "fail"
  }];
  assert.deepEqual(validateTeamIrSchema(value), []);
  delete value.orchestration.joins[0].scope;
  diagnostics = validateTeamIrSchema(value);
  assert.ok(diagnostics.some((item) => item.pointer === "/orchestration/joins/0/scope"));
});

test("Binding retry policy distinguishes initial attempt from configured retries", () => {
  const value = minimalTeam();
  value.bindings[0].retry = { maxAttempts: 2, retryOn: [], backoff: { mode: "none" } };
  assert.ok(validateTeamIrSchema(value).some((item) => item.pointer.startsWith("/bindings/0/retry/retryOn")));
  value.bindings[0].retry.retryOn = ["timeout"];
  assert.deepEqual(validateTeamIrSchema(value), []);
});
