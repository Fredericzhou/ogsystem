import assert from "node:assert/strict";
import test from "node:test";
import { resolveTeamStudioModel } from "../capabilities/team-studio-model.mjs";

test("Team Studio returns backend and opaque model ID separately", () => {
  const discovery = {
    models: [
      { backend: "codex", modelId: "gpt-5.6-sol", runnable: true },
      { backend: "opencode", modelId: "gateway/model-a", runnable: true }
    ]
  };
  assert.deepEqual(resolveTeamStudioModel(discovery), { backend: "opencode", modelId: "gateway/model-a" });
  assert.deepEqual(resolveTeamStudioModel(discovery, { defaultBackend: "opencode", defaultModel: "gateway/model-a" }), {
    backend: "opencode",
    modelId: "gateway/model-a"
  });
});

test("Team Studio respects the configured backend and model ID", () => {
  const discovery = { models: [
    { backend: "opencode", modelId: "vendor/gpt-5", runnable: true },
    { backend: "codex", modelId: "gpt-6", runnable: true }
  ] };
  assert.deepEqual(resolveTeamStudioModel(discovery, { defaultBackend: "codex" }), {
    backend: "codex",
    modelId: "gpt-6"
  });
  assert.equal(resolveTeamStudioModel(discovery, { defaultBackend: "unknown" }).backend, "opencode");
});
