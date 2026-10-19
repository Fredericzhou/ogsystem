import assert from "node:assert/strict";
import test from "node:test";
import { createTeamStudioUseCases } from "../application/team-studio-use-cases.mjs";

test("Team Studio uses an explicitly selected model without unnecessary discovery", async () => {
  const calls = [];
  const useCases = createTeamStudioUseCases({
    visualizer: { chat: async (request) => (calls.push(request), { status: 200, body: { ok: true } }) },
    readPlatformSettings: async () => { throw new Error("settings should not be read"); },
    getPlatformDiscovery: async () => { throw new Error("discovery should not run"); },
    isDirectModelRef: (value) => value === "openai/model-a",
    resolveTeamStudioModelRef: () => undefined
  });
  const result = await useCases.chat("team-1", { modelRef: "openai/model-a", messages: [] });
  assert.deepEqual(result, { status: 200, body: { ok: true } });
  assert.deepEqual(calls, [{ projectId: "team-1", payload: { modelRef: "openai/model-a", messages: [] } }]);
});

test("Team Studio resolves the configured model and reports missing availability clearly", async () => {
  let discoveryCalls = 0;
  const useCases = createTeamStudioUseCases({
    visualizer: { chat: async () => ({ status: 200, body: {} }) },
    readPlatformSettings: async () => ({ defaultProvider: "opencode" }),
    getPlatformDiscovery: async () => (discoveryCalls += 1, { models: [] }),
    isDirectModelRef: () => false,
    resolveTeamStudioModelRef: (_discovery, settings) => settings.defaultProvider === "opencode" ? "opencode/model-b" : undefined
  });
  const result = await useCases.chat("team-2", { prompt: "Help" });
  assert.equal(result.status, 200);
  assert.equal(discoveryCalls, 1);
  const unavailable = createTeamStudioUseCases({
    visualizer: { chat: async () => ({}) },
    readPlatformSettings: async () => ({}),
    getPlatformDiscovery: async () => ({}),
    isDirectModelRef: () => false,
    resolveTeamStudioModelRef: () => undefined
  });
  await assert.rejects(() => unavailable.chat("team-2", {}), /TEAM_ASSISTANT_MODEL_UNAVAILABLE/);
});
