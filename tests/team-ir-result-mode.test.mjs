import assert from "node:assert/strict";
import test from "node:test";
import { compileTeamIr, MemoryTeamRunStore, TeamRuntime } from "../dist/team-ir/index.js";

function team(resultMode, { publish = false } = {}) {
  const resultCondition = publish
    ? { op: "equals", args: [{ "$ref": "$.output.data.answer" }, { "$literal": "publish" }] }
    : { op: "exists", args: [{ "$ref": "$.output.data.answer" }] };
  return {
    schemaVersion: 2,
    team: { id: `result-mode-${resultMode}`, version: "1.0.0" },
    runInput: {
      dataSchema: { type: "object", properties: { request: { type: "string" } }, required: ["request"], additionalProperties: false },
      preferencesSchema: { type: "object" },
      artifactSlots: {}
    },
    runResult: {
      dataSchema: { type: "object", properties: { answer: { type: "string", minLength: 3 } }, required: ["answer"], additionalProperties: false },
      artifactSlots: {}
    },
    executionPolicy: { resultMode, activeExecutionBudgetMs: 5000 },
    agents: [{
      id: "worker",
      packageRef: "role:worker@1",
      bindingRef: "binding:worker",
      inputPorts: { default: { dataSchema: { type: "object", properties: { request: { type: "string" } }, required: ["request"], additionalProperties: false } } },
      outputPorts: { DONE: { dataSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } } }
    }],
    handoffs: [
      { id: "entry", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: { data: { request: { "$ref": "$.run.input.request" } } }, delivery: { deadlineMs: 3000 } },
      {
        id: "result",
        from: { kind: "agent", agentId: "worker", outputPort: "DONE" },
        to: { kind: "result" },
        map: { data: { answer: { "$ref": "$.output.data.answer" } } },
        when: { priority: 1, condition: resultCondition }
      }
    ],
    orchestration: {
      routes: [{ from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "finish", handoffIds: ["result"] }],
      joins: [],
      loops: [],
      reviews: []
    },
    bindings: [{
      id: "binding:worker",
      kind: "model",
      modelRef: "codex/gpt-6-luna",
      attemptTimeoutMs: 1000,
      retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } }
    }]
  };
}

async function execute(document, answer) {
  const plan = compileTeamIr(document);
  const store = new MemoryTeamRunStore();
  const runtime = new TeamRuntime({
    store,
    clock: { now: Date.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    bindings: { "binding:worker": { async invoke() { return { kind: "completed", output: { event: "DONE", data: { answer } } }; } } }
  });
  await runtime.createRun(plan, { runId: "result-mode-run", task: "verify result policy", input: { request: "work" } });
  return runtime.executeRun(plan, "result-mode-run");
}

test("allow_empty completes when a valid Run finishes without writing a result", async () => {
  const result = await execute(team("allow_empty", { publish: true }), "draft");
  assert.equal(result.status, "completed");
  assert.equal(result.result, undefined);
  assert.equal(result.events.filter((item) => item.type === "run.result.written").length, 0);
  assert.equal(result.events.filter((item) => item.type === "run.completed").length, 1);
});

test("allow_empty still fails when a selected result violates the Run result Schema", async () => {
  const result = await execute(team("allow_empty"), "ok");
  assert.equal(result.status, "failed");
  assert.notEqual(result.resultWritten, true);
  assert.equal(result.events.find((item) => item.type === "run.failing")?.data?.code, "RUN_RESULT_SCHEMA_INVALID");
  assert.equal(result.events.some((item) => item.type === "run.completed"), false);
});

test("required result mode fails when route completion leaves the Run result unwritten", async () => {
  const result = await execute(team("required", { publish: true }), "draft");
  assert.equal(result.status, "failed");
  assert.notEqual(result.resultWritten, true);
  assert.equal(result.result, undefined);
  assert.equal(result.events.find((item) => item.type === "run.failing")?.data?.code, "RUN_RESULT_REQUIRED");
  assert.equal(result.events.some((item) => item.type === "run.completed"), false);
});
