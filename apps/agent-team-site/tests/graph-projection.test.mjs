import assert from "node:assert/strict";
import test from "node:test";
import { cases } from "../cases.mjs";
import { buildCaseGraph } from "../run-engine.mjs";

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
