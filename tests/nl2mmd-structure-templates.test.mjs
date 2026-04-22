import test from "node:test";
import assert from "node:assert/strict";

import {
  getNl2MmdStructureTemplate,
  inferNl2MmdStructureTemplate,
  listNl2MmdStructureTemplates,
  suggestNl2MmdStructureTemplates
} from "../dist/nl2mmd/index.js";

test("nl2mmd structure template registry exposes the expected semantic skeletons", () => {
  const templates = listNl2MmdStructureTemplates();
  assert.deepStrictEqual(templates.map((template) => template.id), [
    "linear_flow",
    "fanout_fanin",
    "quorum_consultation",
    "contract_gated_handoff",
    "error_compensation",
    "bounded_loop",
    "human_gate",
    "mixed_binding"
  ]);

  const quorum = getNl2MmdStructureTemplate("quorum_consultation");
  assert.ok(quorum);
  assert.ok(quorum.requiredMetadataKeys.includes("join.mode.<join-role>"));
  assert.ok(quorum.requiredSlots.some((slot) => slot.key === "threshold"));
  assert.ok(quorum.skeleton.some((line) => line.includes("join.min.<join-role>")));
});

test("nl2mmd structure template suggestions track current OGSystem semantics", () => {
  const quorum = inferNl2MmdStructureTemplate("请组织多学科会诊，至少两名专家形成共识后再输出");
  assert.equal(quorum.template.id, "quorum_consultation");

  const fanout = inferNl2MmdStructureTemplate("需要并行派发给多个专家，然后汇总到一个评审节点");
  assert.equal(fanout.template.id, "fanout_fanin");

  const loop = inferNl2MmdStructureTemplate("请设计一个循环重试直到成功的流程");
  assert.equal(loop.template.id, "bounded_loop");

  const errorFlow = inferNl2MmdStructureTemplate("失败后要走 ERROR 补偿分支并触发恢复");
  assert.equal(errorFlow.template.id, "error_compensation");

  const mixedBinding = inferNl2MmdStructureTemplate("一个角色走 model.bind，另一个角色走 exec.bind");
  assert.equal(mixedBinding.template.id, "mixed_binding");

  const suggestions = suggestNl2MmdStructureTemplates("多学科会诊，至少两名专家形成共识后再输出");
  assert.equal(suggestions[0].template.id, "quorum_consultation");
  assert.ok(suggestions[0].score > suggestions[1].score);
});
