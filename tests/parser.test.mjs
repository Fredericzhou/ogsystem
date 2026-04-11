import test from "node:test";
import assert from "node:assert/strict";

import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";

const validSource = `flowchart TD
%% system.id=test.parser
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=intake
%% exec.bind.intake=profile.parser
%% model.bind.intake=model.fast
input -->|ENTER| intake[Role:intake]
intake[Role:intake] -->|COMPLETE| output
`;

const invalidSource = `flowchart TD
%% system.id=test.parser
%% system.version=0.1.0
input -->|ENTER| intake[Role:intake]
`;

const graphSource = `flowchart TD
%% system.id=test.langgraph
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=dispatch
%% role.mode.dispatch=parallel_split
%% join.mode.review=all_of
%% join.sources.review=worker_a,worker_b
%% loop.max.dispatch=2
%% model.bind.dispatch=model.fast
%% model.bind.worker_a=model.fast
%% model.bind.worker_b=model.deep
%% model.bind.review=model.deep
input -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|A| worker_a[Role:worker_a]
dispatch[Role:dispatch] -->|B| worker_b[Role:worker_b]
worker_a[Role:worker_a] -->|DONE_A| review[Role:review]
worker_b[Role:worker_b] -->|DONE_B| review[Role:review]
review[Role:review] -->|RETRY| dispatch[Role:dispatch]
review[Role:review] -->|FINISH| output
`;

const cycleWithoutLoopBudgetSource = `flowchart TD
%% system.id=test.cycle.no-budget
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=a
%% exec.bind.a=profile.a
%% exec.bind.b=profile.b
input -->|START| a[Role:a]
a[Role:a] -->|NEXT| b[Role:b]
b[Role:b] -->|RETRY| a[Role:a]
b[Role:b] -->|DONE| output
`;

const cycleWithLoopBudgetSource = `flowchart TD
%% system.id=test.cycle.with-budget
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=a
%% loop.max.a=2
%% exec.bind.a=profile.a
%% exec.bind.b=profile.b
input -->|START| a[Role:a]
a[Role:a] -->|NEXT| b[Role:b]
b[Role:b] -->|RETRY| a[Role:a]
b[Role:b] -->|DONE| output
`;

const joinSourcesWithoutJoinModeSource = `flowchart TD
%% system.id=test.join.sources.without-mode
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=dispatch
%% exec.bind.dispatch=profile.dispatch
%% exec.bind.worker_a=profile.worker
%% exec.bind.worker_b=profile.worker
%% exec.bind.review=profile.review
%% join.sources.review=worker_a,worker_b
input -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|A| worker_a[Role:worker_a]
dispatch[Role:dispatch] -->|B| worker_b[Role:worker_b]
worker_a[Role:worker_a] -->|DONE_A| review[Role:review]
worker_b[Role:worker_b] -->|DONE_B| review[Role:review]
review[Role:review] -->|DONE| output
`;

const joinSourcesMismatchSource = `flowchart TD
%% system.id=test.join.sources.mismatch
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=dispatch
%% role.mode.dispatch=parallel_split
%% join.mode.review=all_of
%% join.sources.review=worker_a,worker_b
%% model.bind.dispatch=model.fast
%% model.bind.worker_a=model.fast
%% model.bind.worker_b=model.fast
%% model.bind.worker_c=model.fast
%% model.bind.review=model.fast
input -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|A| worker_a[Role:worker_a]
dispatch[Role:dispatch] -->|B| worker_b[Role:worker_b]
dispatch[Role:dispatch] -->|C| worker_c[Role:worker_c]
worker_a[Role:worker_a] -->|DONE_A| review[Role:review]
worker_b[Role:worker_b] -->|DONE_B| review[Role:review]
worker_c[Role:worker_c] -->|DONE_C| review[Role:review]
review[Role:review] -->|DONE| output
`;

test("parser accepts a minimal system", () => {
  const system = parseSystemFromMermaidSource(validSource);
  assert.strictEqual(system.entryRoleId, "intake");
  assert.ok(system.flows.length >= 1);
  assert.strictEqual(system.lawBinding.globalLawRef, "law.test");
  assert.strictEqual(system.executionBinding.intake, "profile.parser");
  assert.strictEqual(system.modelBinding.intake, "model.fast");
  assert.deepStrictEqual(system.graph?.routingModeByRoleId ?? {}, {});
});

test("parser rejects missing metadata", () => {
  assert.throws(() => parseSystemFromMermaidSource(invalidSource), /Missing required metadata/);
});

test("parser accepts graph metadata and compiles semantic hints without engine flag", () => {
  const system = parseSystemFromMermaidSource(graphSource);
  assert.strictEqual(system.graph?.routingModeByRoleId.dispatch, "parallel_split");
  assert.strictEqual(system.graph?.joinModeByRoleId.review, "all_of");
  assert.deepStrictEqual(system.graph?.joinSourcesByRoleId.review, ["worker_a", "worker_b"]);
  assert.strictEqual(system.graph?.loopMaxByRoleId.dispatch, 2);
});

test("parser rejects cyclic topology without explicit loop budget", () => {
  assert.throws(
    () => parseSystemFromMermaidSource(cycleWithoutLoopBudgetSource),
    /MERMAID_CYCLE_REQUIRES_LOOP_MAX|Add loop\.max/
  );
});

test("parser accepts cyclic topology when at least one role in the cycle has loop budget", () => {
  const system = parseSystemFromMermaidSource(cycleWithLoopBudgetSource);
  assert.strictEqual(system.graph?.loopMaxByRoleId.a, 2);
});

test("parser rejects join.sources without an explicit join.mode", () => {
  assert.throws(
    () => parseSystemFromMermaidSource(joinSourcesWithoutJoinModeSource),
    /MERMAID_JOIN_SOURCES_REQUIRE_JOIN_MODE|requires join\.mode/
  );
});

test("parser rejects all_of join when join.sources does not match incoming role edges", () => {
  assert.throws(
    () => parseSystemFromMermaidSource(joinSourcesMismatchSource),
    /MERMAID_JOIN_SOURCES_MISMATCH|join\.sources\.review must match exactly/
  );
});

test("parser rejects duplicate metadata keys instead of silently overriding", () => {
  const duplicateLawSource = `flowchart TD
%% system.id=test.duplicate.metadata
%% system.version=0.1.0
%% law.global=law.first
%% law.global=law.second
%% entry.role=intake
%% model.bind.intake=model.fast
input -->|GO| intake[Role:intake]
intake[Role:intake] -->|DONE| output
`;

  assert.throws(
    () => parseSystemFromMermaidSource(duplicateLawSource),
    /MERMAID_DUPLICATE_METADATA_KEY|Duplicate metadata key "law\.global"/
  );
});
