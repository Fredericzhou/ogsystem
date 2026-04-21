import test from "node:test";
import assert from "node:assert/strict";

import {
  loadNl2MmdContext,
  normalizeNl2MmdMermaid,
  stabilizeNl2MmdMermaidForRuntime,
  validateNl2MmdCandidate
} from "../dist/nl2mmd/index.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";

test("normalizeNl2MmdMermaid converts standalone declarations and bare endpoints", () => {
  const source = `flowchart TD
%% system.id=ogsystem.debate.loop
%% system.version=1
%% law.global=law.console.base
%% entry.role=debate-moderator
%% handoff.mode=transition
%% handoff.contracts=contracts/handoff.json
%% role.mode.debate-moderator=parallel_split
%% route.order.debate-moderator=debate-minimalist,debate-alignmentist
%% route.order.debate-judge=debate-moderator,debate-summary
%% model.bind.debate-moderator=opencode/gpt-5-nano
%% model.bind.debate-minimalist=opencode/gpt-5-nano
%% model.bind.debate-alignmentist=opencode/gpt-5-nano
%% model.bind.debate-judge=opencode/gpt-5-nano
%% model.bind.debate-summary=opencode/gpt-5-nano
%% loop.max.debate-judge=3
%% join.mode.debate-judge=all_of
%% join.sources.debate-judge=debate-minimalist,debate-alignmentist
input -->|START| debate-moderator
debate-moderator[Role:debate-moderator]
debate-minimalist[Role:debate-minimalist]
debate-alignmentist[Role:debate-alignmentist]
debate-judge[Role:debate-judge]
debate-summary[Role:debate-summary]
debate-moderator -->|SEND_MINIMALIST| debate-minimalist
debate-moderator -->|SEND_ALIGNMENTIST| debate-alignmentist
debate-minimalist -->|MINIMALIST_DONE| debate-judge
debate-alignmentist -->|ALIGNMENTIST_DONE| debate-judge
debate-judge -->|REBUTTAL_NEEDED| debate-moderator
debate-judge -->|DECISION_READY| debate-summary
debate-summary -->|SUMMARY_READY| output
`;

  const normalized = normalizeNl2MmdMermaid(source);
  const normalizedLines = normalized.split("\n");
  assert.ok(normalized.includes("input -->|START| debate-moderator[Role:debate-moderator]"));
  assert.ok(normalized.includes("%% handoff.mode=transition"));
  assert.ok(normalized.includes("%% route.order.debate-moderator=debate-minimalist,debate-alignmentist"));
  assert.ok(!normalizedLines.includes("debate-moderator[Role:debate-moderator]"));
  assert.ok(
    normalized.includes(
      "debate-judge[Role:debate-judge] -->|DECISION_READY| debate-summary[Role:debate-summary]"
    )
  );

  const parsed = parseSystemFromMermaidSource(normalized);
  assert.equal(parsed.entryRoleId, "debate-moderator");
  assert.deepEqual(parsed.roleIds.sort(), [
    "debate-alignmentist",
    "debate-judge",
    "debate-minimalist",
    "debate-moderator",
    "debate-summary"
  ]);
});

test("normalizeNl2MmdMermaid strips markdown fences and boundary aliases", () => {
  const source = `\`\`\`mermaid
flowchart TD
%% system.id=test.normalize.alias
%% system.version=1
%% law.global=law.console.base
%% entry.role=analyst
start -->|ENTER| analyst
analyst[Role:analyst]
analyst -->|DONE| done
\`\`\`
`;

  const normalized = normalizeNl2MmdMermaid(source);
  assert.ok(!normalized.includes("```"));
  assert.ok(normalized.includes("input -->|ENTER| analyst[Role:analyst]"));
  assert.ok(normalized.includes("analyst[Role:analyst] -->|DONE| output"));

  const parsed = parseSystemFromMermaidSource(normalized);
  assert.equal(parsed.entryRoleId, "analyst");
  assert.deepEqual(parsed.roleIds, ["analyst"]);
});

test("stabilizeNl2MmdMermaidForRuntime fixes missing metadata and passes validation", async () => {
  const source = `flowchart TD
input -->|SEND_MINIMALIST| debate-moderator[Role:debate-moderator]
debate-moderator[Role:debate-moderator] -->|SEND_MINIMALIST| debate-minimalist[Role:debate-minimalist]
debate-moderator[Role:debate-moderator] -->|SEND_ALIGNMENTIST| debate-alignmentist[Role:debate-alignmentist]
debate-minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| debate-judge[Role:debate-judge]
debate-alignmentist[Role:debate-alignmentist] -->|ALIGNMENTIST_DONE| debate-judge[Role:debate-judge]
debate-judge[Role:debate-judge] -->|REBUTTAL_NEEDED| debate-moderator[Role:debate-moderator]
debate-judge[Role:debate-judge] -->|DECISION_READY| output
flowchart TD
`;
  const context = await loadNl2MmdContext({ workdir: process.cwd() });
  const stabilized = stabilizeNl2MmdMermaidForRuntime({
    mermaid: source,
    context
  });
  const flowchartHeaders = stabilized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line === "flowchart TD" || line === "flowchart LR");
  assert.equal(flowchartHeaders.length, 1);
  assert.ok(stabilized.includes("%% system.id=ogsystem.nl2mmd.autofix"));
  assert.ok(stabilized.includes("%% entry.role=debate-moderator"));
  assert.ok(stabilized.includes("%% model.bind.debate-judge="));

  const validation = await validateNl2MmdCandidate({
    mermaid: stabilized,
    context
  });
  assert.equal(validation.status, "ok", validation.errors.join("\n"));
});

test("stabilizeNl2MmdMermaidForRuntime relocates misplaced join metadata to the actual merge node", async () => {
  const source = `flowchart TD
%% system.id=ogsystem.nl2mmd.autofix
%% system.version=1
%% law.global=law.minimal.base
%% entry.role=debate-moderator
%% model.bind.debate-moderator=opencode/gpt-5-nano
%% model.bind.debate-minimalist=opencode/gpt-5-nano
%% model.bind.debate-alignmentist=opencode/gpt-5-nano
%% model.bind.debate-judge=opencode/gpt-5-nano
%% model.bind.debate-summary=opencode/gpt-5-nano
%% role.mode.debate-moderator=parallel_split
%% join.mode.debate-moderator=all_of
%% join.sources.debate-moderator=debate-minimalist,debate-alignmentist
%% loop.max.debate-moderator=3
input -->|START_DISCUSSION| debate-moderator[Role:debate-moderator]
debate-moderator[Role:debate-moderator] -->|SEND_MINIMALIST| debate-minimalist[Role:debate-minimalist]
debate-moderator[Role:debate-moderator] -->|SEND_ALIGNMENTIST| debate-alignmentist[Role:debate-alignmentist]
debate-minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| debate-judge[Role:debate-judge]
debate-alignmentist[Role:debate-alignmentist] -->|ALIGNMENTIST_DONE| debate-judge[Role:debate-judge]
debate-judge[Role:debate-judge] -->|REBUTTAL_NEEDED| debate-moderator[Role:debate-moderator]
debate-judge[Role:debate-judge] -->|DECISION_READY| debate-summary[Role:debate-summary]
debate-summary[Role:debate-summary] -->|SUMMARY_READY| output
`;
  const context = await loadNl2MmdContext({ workdir: process.cwd() });
  const stabilized = stabilizeNl2MmdMermaidForRuntime({
    mermaid: source,
    context
  });
  assert.ok(!stabilized.includes("%% join.mode.debate-moderator=all_of"));
  assert.ok(
    stabilized.includes("%% join.mode.debate-judge=all_of"),
    "expected join.mode to move to debate-judge"
  );
  assert.ok(stabilized.includes("%% join.sources.debate-judge=debate-minimalist,debate-alignmentist"));

  const validation = await validateNl2MmdCandidate({
    mermaid: stabilized,
    context
  });
  assert.equal(validation.status, "ok", validation.errors.join("\n"));
});
