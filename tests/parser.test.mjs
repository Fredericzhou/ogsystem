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

test("parser accepts a minimal system", () => {
  const system = parseSystemFromMermaidSource(validSource);
  assert.strictEqual(system.entryRoleId, "intake");
  assert.ok(system.flows.length >= 1);
  assert.strictEqual(system.lawBinding.globalLawRef, "law.test");
  assert.strictEqual(system.executionBinding.intake, "profile.parser");
  assert.strictEqual(system.modelBinding.intake, "model.fast");
});

test("parser rejects missing metadata", () => {
  assert.throws(() => parseSystemFromMermaidSource(invalidSource), /Missing required metadata/);
});
