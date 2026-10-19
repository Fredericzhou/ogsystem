import assert from "node:assert/strict";
import test from "node:test";
import { cases } from "../cases.mjs";
import { buildCaseGraph, buildCaseSystem } from "../demo-runner.mjs";

for (const locale of ["zh-CN", "en"]) {
  for (const item of cases) {
    test(`${item.id} projects its OGSystem graph in ${locale}`, () => {
      const graph = buildCaseGraph(item.id, locale);
      assert.equal(graph.mode, "run");
      assert.equal(graph.nodes.length, item.roles.length + 2);
      assert.equal(graph.edges.length, item.flows.length);
      assert.equal(graph.nodes.find((node) => node.id === "input")?.label, locale === "zh-CN" ? "▶ 任务" : "▶ Task");
      assert.equal(graph.nodes.find((node) => node.id === "output")?.label, locale === "zh-CN" ? "■ 成果" : "■ Outcome");
      for (const role of item.roles) {
        const node = graph.nodes.find((candidate) => candidate.id === role.id);
        assert.equal(node?.label, role.label[locale]);
        assert.equal(node?.description, item.detail.roles[role.id][locale]);
        assert.deepEqual(node?.structure, {});
        assert.deepEqual(node?.badges, []);
      }
      for (const [, , eventType] of item.flows) {
        const edge = graph.edges.find((candidate) => candidate.eventType === eventType);
        assert.ok(edge?.label);
        assert.notEqual(edge.label, eventType);
      }
      assert.equal(graph.capabilities.editable, false);
    });
  }
}

test("structured debate permits one bounded rebuttal before the judge must decide", () => {
  const debate = cases.find((item) => item.id === "structured-debate");
  assert.equal(debate.loopBudgets.find((loop) => loop.roleId === "debate-host")?.max, 2);
  assert.match(debate.roles.find((role) => role.id === "neutral-judge").prompt, /at most one rebuttal/i);
  assert.match(debate.roles.find((role) => role.id === "neutral-judge").prompt, /always issue DECISION_READY/i);
  assert.match(buildCaseSystem(debate), /loop\.max\.debate-host=2/);
});
