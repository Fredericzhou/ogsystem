export function createTeamStudioUseCases({ visualizer, readPlatformSettings, getPlatformDiscovery, isDirectModelRef, resolveTeamStudioModelRef }) {
  if (!visualizer || typeof visualizer.chat !== "function") throw new TypeError("Team Studio requires a Visualizer client.");
  if (typeof readPlatformSettings !== "function" || typeof getPlatformDiscovery !== "function") {
    throw new TypeError("Team Studio requires platform settings and discovery operations.");
  }
  if (typeof isDirectModelRef !== "function" || typeof resolveTeamStudioModelRef !== "function") {
    throw new TypeError("Team Studio requires model reference policies.");
  }

  return Object.freeze({
    async chat(projectId, payload) {
      let modelRef = payload.modelRef;
      if (!isDirectModelRef(modelRef)) {
        const [settings, discovery] = await Promise.all([readPlatformSettings(), getPlatformDiscovery()]);
        modelRef = resolveTeamStudioModelRef(discovery, settings);
      }
      if (!modelRef) {
        throw new Error("TEAM_ASSISTANT_MODEL_UNAVAILABLE: configure an active OpenCode model in Platform settings and refresh discovery.");
      }
      return visualizer.chat({ projectId, payload: { ...payload, modelRef } });
    }
  });
}
