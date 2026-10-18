import assert from "node:assert/strict";
import test from "node:test";
import { resolveTeamStudioModelRef } from "../capabilities/team-studio-model.mjs";

test("Team Studio chooses a canonical OpenCode provider/model reference", () => {
  const discovery = {
    models: [
      { id: "gpt-5.6-sol", provider: "codex", ref: "codex/gpt-5.6-sol", runnable: true },
      { id: "beam-free", backend: "opencode", provider: "opencode", ref: "opencode/beam-free", runnable: true },
      { id: "malformed", backend: "opencode", provider: "opencode", ref: "malformed", runnable: true }
    ]
  };
  assert.equal(resolveTeamStudioModelRef(discovery), "opencode/beam-free");
  assert.equal(resolveTeamStudioModelRef(discovery, { defaultProvider: "opencode", defaultModel: "beam-free" }), "opencode/beam-free");
  assert.equal(resolveTeamStudioModelRef({ models: [{ id: "gpt", provider: "codex", ref: "codex/gpt", runnable: true }] }), undefined);
});

test("Team Studio accepts OpenCode models from non-opencode provider namespaces", () => {
  const discovery = {
    models: [
      { id: "openai/gpt-5", backend: "opencode", provider: "openai", ref: "openai/gpt-5", runnable: true },
      { id: "codex/gpt-5.6-sol", backend: "codex", provider: "codex", ref: "codex/gpt-5.6-sol", runnable: true }
    ]
  };
  assert.equal(resolveTeamStudioModelRef(discovery), "openai/gpt-5");
  assert.equal(resolveTeamStudioModelRef(discovery, { defaultModel: "openai/gpt-5" }), "openai/gpt-5");
});
