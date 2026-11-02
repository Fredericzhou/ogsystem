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
  assert.equal(resolveTeamStudioModelRef({ models: [{ id: "gpt", backend: "codex", provider: "codex", ref: "codex/gpt", runnable: true }] }), "codex/gpt");
});

test("Team Studio accepts OpenCode models from non-opencode provider namespaces", () => {
  const discovery = {
    models: [
      { id: "openai/gpt-5", backend: "opencode", provider: "openai", providerName: "OpenAI", ref: "openai/gpt-5", runnable: true },
      { id: "codex/gpt-5.6-sol", backend: "codex", provider: "codex", ref: "codex/gpt-5.6-sol", runnable: true }
    ]
  };
  assert.equal(resolveTeamStudioModelRef(discovery), "openai/gpt-5");
  assert.equal(resolveTeamStudioModelRef(discovery, { defaultModel: "openai/gpt-5" }), "openai/gpt-5");
});

test("Team Studio prefers the configured backend while accepting mixed backend catalogs", () => {
  const discovery = { models: [
    { id: "gpt", backend: "opencode", ref: "opencode/gpt", runnable: true },
    { id: "gpt-6", backend: "codex", ref: "codex/gpt-6", runnable: true }
  ] };
  assert.equal(resolveTeamStudioModelRef(discovery, { defaultProvider: "codex" }), "codex/gpt-6");
});
