import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createExecutionPlan, getExecutionPlanNode } from "../dist/runtime/execution-plan.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";

test("execution plan normalizes graph orchestration semantics from mermaid metadata", async () => {
  const source = await readFile(
    path.resolve("examples/langgraph-debate-current/system.mmd"),
    "utf8"
  );
  const system = parseSystemFromMermaidSource(source);
  const plan = createExecutionPlan(system);

  const moderator = getExecutionPlanNode(plan, "debate-moderator");
  const judge = getExecutionPlanNode(plan, "debate-judge");
  const summary = getExecutionPlanNode(plan, "debate-summary");

  assert.strictEqual(plan.entryRoleId, "debate-moderator");
  assert.strictEqual(moderator.binding.kind, "model");
  assert.strictEqual(moderator.binding.modelId, "fast-gpt54");
  assert.strictEqual(moderator.routingMode, "parallel_split");
  assert.strictEqual(moderator.loopMax, 2);
  assert.strictEqual(judge.joinMode, "all_of");
  assert.deepStrictEqual(judge.joinSources, ["debate-minimalist", "debate-alignmentist"]);
  assert.strictEqual(summary.isTerminal, true);
});

test("execution plan keeps legacy exec.bind as compatibility binding inside the same plan", async () => {
  const source = await readFile(path.resolve("tests/fixtures/mermaid/branch-system.mmd"), "utf8");
  const system = parseSystemFromMermaidSource(source);
  const plan = createExecutionPlan(system);
  const decision = getExecutionPlanNode(plan, "test-decision");

  assert.strictEqual(decision.binding.kind, "profile");
  assert.strictEqual(decision.binding.profileId, "profile.branch");
  assert.strictEqual(decision.routingMode, undefined);
  assert.strictEqual(decision.joinMode, undefined);
});
