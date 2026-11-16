import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeProjectReadinessInspector } from "../infrastructure/runtime-project-readiness.mjs";

test("Project Readiness uses the shared Platform catalog for the runtime snapshot", async () => {
  const calls = [];
  const inspector = createRuntimeProjectReadinessInspector({
    inspect: async (...args) => (calls.push(args), { canDryRun: true }),
    getRuntimeModelConfig: async () => ({
      modelCatalogModels: [{ backend: "codex", modelId: "gpt-6-luna" }],
      modelCatalogGeneratedAt: "2026-10-22T00:00:00.000Z"
    })
  });

  await inspector.inspect("C:/projects/version");
  assert.deepEqual(calls, [["C:/projects/version", {
    modelCatalogModels: [{ backend: "codex", modelId: "gpt-6-luna" }],
    modelCatalogGeneratedAt: "2026-10-22T00:00:00.000Z"
  }]]);
});

test("Project Readiness preserves the inspector contract when no shared catalog is available", async () => {
  const calls = [];
  const inspector = createRuntimeProjectReadinessInspector({
    inspect: async (...args) => (calls.push(args), { canDryRun: false })
  });

  await inspector.inspect("C:/projects/version");
  assert.deepEqual(calls, [["C:/projects/version"]]);
});
