import test from "node:test";
import assert from "node:assert/strict";

import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";

function graphSource(extra = []) {
  return [
    "flowchart TD",
    "%% system.id=v2.parser",
    "%% system.version=2.0.0",
    "%% law.global=law.test",
    ...extra,
    "start[开始] -->|START| writer[Role:writer]",
    "writer[Role:writer] -->|READY| reviewer[Role:reviewer]",
    "reviewer[Role:reviewer] -->|DONE| end[结束]"
  ].join("\n");
}

test("v2 parser rejects Mermaid model.bind and exec.bind metadata", () => {
  for (const binding of ["model.bind.writer=codex/gpt-6-luna", "exec.bind.writer=profile.writer"]) {
    assert.throws(
      () => parseSystemFromMermaidSource(graphSource([`%% ${binding}`])),
      /(?:MERMAID_LEGACY_MODEL_BINDING|MERMAID_LEGACY_EXEC_BINDING|v1 .*binding|legacy)/i
    );
  }
});

test("v2 parser accepts a plain business graph without execution metadata", () => {
  const system = parseSystemFromMermaidSource(graphSource());
  assert.deepEqual(system.roleIds, ["writer", "reviewer"]);
  assert.deepEqual(system.flows, [
    { fromRoleId: "writer", toRoleId: "reviewer", eventType: "READY" },
    { fromRoleId: "reviewer", toRoleId: "__system_end__", eventType: "DONE" }
  ]);
});

test("v2 parser preserves flow and context.map semantics", () => {
  const system = parseSystemFromMermaidSource(graphSource([
    "%% join.mode.reviewer=all_of",
    "%% join.sources.reviewer=writer",
    "%% context.map.reviewer.task=source(writer).content"
  ]));
  assert.equal(system.graph?.joinModeByRoleId.reviewer, "all_of");
  assert.deepEqual(system.graph?.joinSourcesByRoleId.reviewer, ["writer"]);
  assert.equal(system.graph?.contextMapByRoleId.reviewer?.task, "source(writer).content");
});
