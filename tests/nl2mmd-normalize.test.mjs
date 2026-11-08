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
%% handoff.mode=transition
%% handoff.contracts=contracts/handoff.json
%% role.mode.debate-moderator=parallel_split
%% route.order.debate-moderator=debate-minimalist,debate-alignmentist
%% route.order.debate-judge=debate-moderator,debate-summary
%% loop.max.debate-judge=3
%% join.mode.debate-judge=all_of
%% join.sources.debate-judge=debate-minimalist,debate-alignmentist
start[开始] -->|START| debate-moderator
debate-moderator[Role:debate-moderator]
debate-minimalist[Role:debate-minimalist]
debate-alignmentist[Role:debate-alignmentist]
debate-judge[Role:debate-judge]
debate-summary[Role:debate-summary]
debate-moderator -->|READY| debate-minimalist
debate-moderator -->|READY| debate-alignmentist
debate-minimalist -->|READY| debate-judge
debate-alignmentist -->|READY| debate-judge
debate-judge -->|NEEDS_REWORK| debate-moderator
debate-judge -->|READY| debate-summary
debate-summary -->|READY| end[结束]
`;

  const normalized = normalizeNl2MmdMermaid(source);
  const normalizedLines = normalized.split("\n");
  assert.ok(normalized.includes("start[开始] -->|START| debate-moderator[Role:debate-moderator]"));
  assert.ok(normalized.includes("%% handoff.mode=transition"));
  assert.ok(normalized.includes("%% route.order.debate-moderator=debate-minimalist,debate-alignmentist"));
  assert.ok(!normalizedLines.includes("debate-moderator[Role:debate-moderator]"));
  assert.ok(
    normalized.includes(
      "debate-judge[Role:debate-judge] -->|READY| debate-summary[Role:debate-summary]"
    )
  );

  const parsed = parseSystemFromMermaidSource(normalized);
  assert.deepEqual(parsed.entryRoleIds, ["debate-moderator"]);
  assert.deepEqual(parsed.roleIds.sort(), [
    "debate-alignmentist",
    "debate-judge",
    "debate-minimalist",
    "debate-moderator",
    "debate-summary"
  ]);
});

test("normalizeNl2MmdMermaid strips markdown fences and canonicalizes explicit boundary names", () => {
  const source = `\`\`\`mermaid
flowchart TD
%% system.id=test.normalize.alias
%% system.version=1
%% law.global=law.console.base
start -->|ENTER| analyst
analyst[Role:analyst]
analyst -->|READY| end
\`\`\`
`;

  const normalized = normalizeNl2MmdMermaid(source);
  assert.ok(!normalized.includes("```"));
  assert.ok(normalized.includes("start[开始] -->|START| analyst[Role:analyst]"));
  assert.ok(normalized.includes("analyst[Role:analyst] -->|READY| end[结束]"));

  const parsed = parseSystemFromMermaidSource(normalized);
  assert.deepEqual(parsed.entryRoleIds, ["analyst"]);
  assert.deepEqual(parsed.roleIds, ["analyst"]);
});

test("normalizeNl2MmdMermaid does not translate removed input/output boundary aliases", () => {
  const normalized = normalizeNl2MmdMermaid(`flowchart TD
input -->|START| analyst[Role:analyst]
analyst[Role:analyst] -->|READY| output`);
  assert.match(normalized, /input -->\|START\|/);
  assert.match(normalized, /-->\|READY\| output/);
  assert.throws(() => parseSystemFromMermaidSource(normalized), /Invalid node token|Unsupported system node/);
});

test("stabilizeNl2MmdMermaidForRuntime fixes missing metadata and passes validation", async () => {
  const source = `flowchart TD
start[开始] -->|START| debate-moderator[Role:debate-moderator]
debate-moderator[Role:debate-moderator] -->|READY| debate-minimalist[Role:debate-minimalist]
debate-moderator[Role:debate-moderator] -->|READY| debate-alignmentist[Role:debate-alignmentist]
debate-minimalist[Role:debate-minimalist] -->|READY| debate-judge[Role:debate-judge]
debate-alignmentist[Role:debate-alignmentist] -->|READY| debate-judge[Role:debate-judge]
debate-judge[Role:debate-judge] -->|NEEDS_REWORK| debate-moderator[Role:debate-moderator]
debate-judge[Role:debate-judge] -->|READY| end[结束]
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
  assert.ok(stabilized.includes("start[开始] -->|START|"));
  assert.ok(!stabilized.includes("%% model.bind."));

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
%% role.mode.debate-moderator=parallel_split
%% join.mode.debate-moderator=all_of
%% join.sources.debate-moderator=debate-minimalist,debate-alignmentist
%% loop.max.debate-moderator=3
start[开始] -->|START| debate-moderator[Role:debate-moderator]
debate-moderator[Role:debate-moderator] -->|READY| debate-minimalist[Role:debate-minimalist]
debate-moderator[Role:debate-moderator] -->|READY| debate-alignmentist[Role:debate-alignmentist]
debate-minimalist[Role:debate-minimalist] -->|READY| debate-judge[Role:debate-judge]
debate-alignmentist[Role:debate-alignmentist] -->|READY| debate-judge[Role:debate-judge]
debate-judge[Role:debate-judge] -->|NEEDS_REWORK| debate-moderator[Role:debate-moderator]
debate-judge[Role:debate-judge] -->|READY| debate-summary[Role:debate-summary]
debate-summary[Role:debate-summary] -->|READY| end[结束]
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
