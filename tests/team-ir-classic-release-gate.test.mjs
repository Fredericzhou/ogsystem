import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileTeamIr, MemoryTeamRunStore, TeamRuntime, validateTeamIr } from "../dist/team-ir/index.js";

async function loadFixture() {
  return JSON.parse(await readFile(new URL("../examples/team-ir-v2/classic-release-gate.json", import.meta.url), "utf8"));
}

function compileFixture(fixture) {
  const diagnostics = validateTeamIr(fixture);
  assert.deepEqual(diagnostics.filter((item) => item.severity === "error"), []);
  return compileTeamIr(fixture);
}

async function execute(fixture, decision, runId) {
  const plan = compileFixture(fixture);
  const store = new MemoryTeamRunStore();
  const runtime = new TeamRuntime({
    store,
    clock: { now: Date.now, sleep: () => new Promise(() => {}) },
    bindings: {
      "binding:release-gate": {
        async invoke() {
          return { kind: "completed", output: { event: "GATE_DECISION", data: { decision, summary: `${decision}: review complete` } } };
        }
      }
    }
  });
  await runtime.createRun(plan, { runId, task: "validate release gate", input: { request: "publish build 42" } });
  return runtime.executeRun(plan, runId);
}

test("classic release gate fixture has mutually exclusive PASS and REJECT Result exits", async () => {
  const fixture = await loadFixture();
  const plan = compileFixture(fixture);
  const route = plan.routesBySource.get("agent:release-gate:GATE_DECISION");

  assert.equal(fixture.schemaVersion, 2);
  assert.deepEqual(route.handoffIds, ["gate-pass-result", "gate-reject-result"]);
  assert.equal(route.mode, "exclusive_priority");
  assert.equal(route.onNoMatch, "finish");

  for (const [decision, runId] of [["PASS", "release-gate-pass"], ["REJECT", "release-gate-reject"]]) {
    const result = await execute(fixture, decision, runId);
    assert.equal(result.status, "completed");
    assert.equal(result.resultWritten, true);
    assert.deepEqual(result.result, { decision, summary: `${decision}: review complete` });
    assert.equal(result.events.filter((event) => event.type === "run.result.written").length, 1);
    const written = result.events.find((event) => event.type === "run.result.written");
    assert.equal(written.data.handoffId, decision === "PASS" ? "gate-pass-result" : "gate-reject-result");
  }
});

test("release gate onNoMatch honors required and allow_empty result policies", async () => {
  const required = await execute(await loadFixture(), "ABSTAIN", "release-gate-required-abstain");
  assert.equal(required.status, "failed");
  assert.equal(required.result, undefined);
  assert.equal(required.events.find((event) => event.type === "run.failing")?.data?.code, "RUN_RESULT_REQUIRED");

  const allowEmptyFixture = await loadFixture();
  allowEmptyFixture.executionPolicy.resultMode = "allow_empty";
  const optional = await execute(allowEmptyFixture, "ABSTAIN", "release-gate-allow-empty-abstain");
  assert.equal(optional.status, "completed");
  assert.equal(optional.resultWritten, undefined);
  assert.equal(optional.result, undefined);
  assert.equal(optional.events.some((event) => event.type === "run.result.written"), false);
});

test("classic release gate rejects concurrent PASS/REJECT Result writes", async () => {
  const fixture = await loadFixture();
  fixture.orchestration.routes.find((route) => route.from.kind === "agent").mode = "parallel_fanout";
  const diagnostics = validateTeamIr(fixture);
  assert.ok(diagnostics.some((item) => item.code === "IR_RESULT_CONFLICT"));
});
