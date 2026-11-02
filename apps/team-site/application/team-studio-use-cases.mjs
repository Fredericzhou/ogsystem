export function createTeamStudioUseCases({ visualizer, readPlatformSettings, getPlatformDiscovery, resolveTeamStudioModel }) {
  if (!visualizer || typeof visualizer.chat !== "function") throw new TypeError("Team Studio requires a Visualizer client.");
  if (typeof readPlatformSettings !== "function" || typeof getPlatformDiscovery !== "function") {
    throw new TypeError("Team Studio requires platform settings and discovery operations.");
  }
  if (typeof resolveTeamStudioModel !== "function") {
    throw new TypeError("Team Studio requires a backend/model selection policy.");
  }

  return Object.freeze({
    async chat(projectId, payload) {
      let model = payload.backend && payload.modelId
        ? { backend: payload.backend, modelId: payload.modelId }
        : undefined;
      if (!model) {
        const [settings, discovery] = await Promise.all([readPlatformSettings(), getPlatformDiscovery()]);
        model = resolveTeamStudioModel(discovery, settings);
      }
      if (!model) {
        throw new Error("TEAM_ASSISTANT_MODEL_UNAVAILABLE: configure an active OpenCode model in Platform settings and refresh discovery.");
      }
      // The legacy NL2MMD transport still accepts OpenCode's provider/model wire
      // value. Keep it ephemeral at this boundary; persisted selection remains
      // backend + modelId.
      const transportPayload = model.backend === "opencode"
        ? { ...payload, ...model, modelRef: model.modelId }
        : { ...payload, ...model };
      return visualizer.chat({ projectId, payload: transportPayload });
    }
  });
}
