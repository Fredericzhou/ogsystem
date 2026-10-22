import assert from "node:assert/strict";
import test from "node:test";
import { createVisualizerProjectDesignStore } from "../infrastructure/visualizer-project-design-store.mjs";

test("Studio design persistence uses one shared model catalog snapshot for validation and save", async () => {
  const modelConfig = {
    modelCatalogModels: [{ backend: "codex", modelId: "gpt-6-luna", runnable: true }],
    modelCatalogGeneratedAt: "2026-10-22T00:00:00.000Z"
  };
  const calls = [];
  let validationInput;
  const store = createVisualizerProjectDesignStore({
    getRuntimeModelConfig: async () => modelConfig,
    serialize: () => "flowchart TD\n  analyst -->|done| reviewer",
    saveAuthoringDraft: async (input) => {
      calls.push(["draft", input]);
      await input.validateSystemSource({ workdir: input.workdir, systemPath: `${input.workdir}/system.mmd`, systemSource: "flowchart TD" });
      return { validation: { ok: true } };
    },
    save: async (input) => (calls.push(["source", input]), { validation: { ok: true } }),
    validate: async (input) => (validationInput = input, { ok: true })
  });

  const result = await store.saveAuthoring({ workdir: "/teams/team-v1", authoring: { version: 1 } });

  assert.equal(result.validation.ok, true);
  assert.deepEqual(calls.map(([kind]) => kind), ["draft", "source"]);
  for (const [, input] of calls) {
    assert.deepEqual(input.modelCatalogModels, modelConfig.modelCatalogModels);
    assert.equal(input.modelCatalogGeneratedAt, modelConfig.modelCatalogGeneratedAt);
  }
  assert.deepEqual(validationInput.modelCatalogModels, modelConfig.modelCatalogModels);
  assert.equal(validationInput.modelCatalogGeneratedAt, modelConfig.modelCatalogGeneratedAt);
});

test("Studio Mermaid saves use the shared model catalog snapshot", async () => {
  const modelConfig = { modelCatalogModels: [{ backend: "codex", modelId: "gpt-6-luna" }] };
  let saved;
  const store = createVisualizerProjectDesignStore({
    getRuntimeModelConfig: async () => modelConfig,
    save: async (input) => (saved = input, { validation: { ok: true } })
  });

  await store.saveSystemSource({ workdir: "/teams/team-v1", systemSource: "flowchart TD" });

  assert.deepEqual(saved.modelCatalogModels, modelConfig.modelCatalogModels);
});
