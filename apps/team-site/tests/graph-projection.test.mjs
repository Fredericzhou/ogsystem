import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cases } from "../cases.mjs";
import { buildCaseGraph, buildCaseSystem, materializeCaseTeam } from "../demo-runner.mjs";
import { createRuntimeTeamSimulation } from "../infrastructure/runtime-team-simulation.mjs";

for (const locale of ["zh-CN", "en"]) {
  for (const item of cases) {
    test(`${item.id} projects its OGSystem graph in ${locale}`, () => {
      const graph = buildCaseGraph(item.id, locale);
      assert.equal(graph.mode, "run");
      assert.equal(graph.nodes.length, item.roles.length + 2);
      assert.equal(graph.edges.length, item.flows.length);
      assert.match(buildCaseSystem(item), /start\[开始\] -->\|START\|/);
      assert.match(buildCaseSystem(item), /end\[结束\]/);
      assert.doesNotMatch(buildCaseSystem(item), /entry\.role|input\[Input\]|output\[Output\]|entryRole/);
      assert.equal(graph.nodes.find((node) => node.id === "__system_start__")?.label, locale === "zh-CN" ? "开始" : "Start");
      assert.equal(graph.nodes.find((node) => node.id === "__system_end__")?.label, locale === "zh-CN" ? "结束" : "End");
      const startFlow = graph.edges.find((edge) => edge.eventType === "START");
      assert.equal(startFlow?.label, locale === "zh-CN" ? "任务分发" : "Task dispatch");
      for (const role of item.roles) {
        const node = graph.nodes.find((candidate) => candidate.id === role.id);
        assert.equal(node?.label, role.label[locale]);
        assert.equal(node?.description, item.detail.roles[role.id][locale]);
        assert.deepEqual(node?.structure, {});
        assert.deepEqual(node?.badges, []);
      }
      for (const edge of graph.edges) {
        assert.ok(edge.label);
        assert.notEqual(edge.label, edge.eventType);
      }
      assert.equal(graph.capabilities.editable, false);
    });
  }
}

test("structured debate permits one bounded rebuttal before the judge must decide", () => {
  const debate = cases.find((item) => item.id === "structured-debate");
  assert.equal(debate.loopBudgets.find((loop) => loop.roleId === "debate-host")?.max, 2);
  assert.match(debate.roles.find((role) => role.id === "neutral-judge").prompt, /at most one rebuttal/i);
  assert.match(debate.roles.find((role) => role.id === "neutral-judge").prompt, /loop_iteration is greater than 1/i);
  assert.match(debate.roles.find((role) => role.id === "debate-reporter").prompt, /JSON object serialized as the content string/i);
  assert.match(debate.roles.find((role) => role.id === "debate-reporter").prompt, /propositionCase \(object with strongestPoint and reasoning strings\)/i);
  assert.match(buildCaseSystem(debate), /loop\.max\.debate-host=2/);
});

test("management consulting keeps its parallel quorum and structured brief contract", () => {
  const consulting = cases.find((item) => item.id === "management-consulting");
  assert.ok(consulting);
  assert.equal(consulting.roles.length, 9);
  assert.deepEqual(consulting.joins.find((join) => join.roleId === "synthesis-consultant"), {
    roleId: "synthesis-consultant",
    mode: "quorum_of",
    sources: ["market-analyst", "operations-analyst", "commercial-analyst", "risk-advisor"],
    min: 3
  });
  assert.ok(consulting.projections.some(([, , selector]) => selector === "source(market-analyst).content?"));
  assert.ok(consulting.projections.some(([, , selector]) => selector === "source(quality-reviewer).content"));
  assert.deepEqual(consulting.outputSchema.required, [
    "executiveSummary", "recommendations", "implementationPlan", "risks", "assumptions", "openQuestions"
  ]);
  const graph = buildCaseGraph("management-consulting", "en");
  assert.equal(graph.edges.filter((edge) => edge.eventType === "READY" && edge.source !== "__system_start__").length, 12);
  assert.equal(graph.edges.find((edge) => edge.eventType === "READY" && edge.target === "executive-brief")?.target, "executive-brief");
});

test("cross-backend review loop exposes a bounded rework path", () => {
  const loop = cases.find((item) => item.id === "cross-backend-review-loop");
  assert.ok(loop);
  assert.deepEqual(loop.loopBudgets, [{ roleId: "codex-analyst", max: 3 }]);
  assert.deepEqual(loop.flows, [
    ["__system_start__", "codex-analyst", "START"],
    ["codex-analyst", "opencode-reviewer", "READY"],
    ["opencode-reviewer", "codex-analyst", "NEEDS_REWORK"],
    ["opencode-reviewer", "__system_end__", "APPROVED"],
    ["opencode-reviewer", "__system_end__", "REJECTED"]
  ]);
  assert.match(buildCaseSystem(loop), /loop\.max\.codex-analyst=3/);
});

test("review-reject-once dry-run completes after one rework loop", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-review-loop-"));
  try {
    await materializeCaseTeam("cross-backend-review-loop", workdir);
    const result = await createRuntimeTeamSimulation().simulate(
      { workdir, source: "classic", teamVersionId: "cross-backend-review-loop" },
      { prompt: "Validate the review loop.", mode: "dry-run", simulationScenario: "review-reject-once" }
    );
    assert.equal(result.status, "completed");
    assert.deepEqual(result.auditTrail.map((item) => [item.roleId, item.loopIteration, item.selectedEvent]), [
      ["codex-analyst", 1, "READY"],
      ["opencode-reviewer", 1, "NEEDS_REWORK"],
      ["codex-analyst", 2, "READY"],
      ["opencode-reviewer", 2, "APPROVED"]
    ]);
    assert.deepEqual(result.finalOutputRoleOrder, ["opencode-reviewer"]);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
