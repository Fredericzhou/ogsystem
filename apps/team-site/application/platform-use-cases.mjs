export function createPlatformUseCases({ platformSettingsStore, modelCatalog, probeModelAvailability = async () => { throw new Error("Model availability probe is unavailable."); } }) {
  if (!platformSettingsStore || typeof platformSettingsStore.read !== "function" || typeof platformSettingsStore.write !== "function") {
    throw new TypeError("Platform use cases require a settings store.");
  }
  if (!modelCatalog || typeof modelCatalog.discover !== "function") {
    throw new TypeError("Platform use cases require a model catalog.");
  }

  return Object.freeze({
    getPlatformDiscovery: (forceRefresh = false) => modelCatalog.discover({ forceRefresh }),
    async probeModelAvailability(modelRef) {
      const discovery = await modelCatalog.discover();
      const model = discovery.models.find((item) => item.ref === modelRef && item.runnable);
      if (!model) throw new Error(`Model "${modelRef}" is not currently discovered as runnable. Refresh model discovery and try again.`);
      return probeModelAvailability(model);
    },
    async listPlatformProviders() {
      const discovery = await modelCatalog.discover();
      return { providers: discovery.sources.map(({ backend, name, status, command, detail }) => ({ id: backend, name, status, command, detail })) };
    },
    async listPlatformModels() {
      const discovery = await modelCatalog.discover();
      return { models: discovery.models };
    },
    readPlatformSettings: () => platformSettingsStore.read(),
    async updatePlatformSettings(payload) {
      const timeoutSeconds = Number(payload.timeoutSeconds);
      const retryCount = Number(payload.retryCount);
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 3600) {
        throw new Error("timeoutSeconds must be between 10 and 3600.");
      }
      if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount > 5) {
        throw new Error("retryCount must be between 0 and 5.");
      }
      const settings = {
        defaultProvider: String(payload.defaultProvider || "codex").trim(),
        defaultModel: String(payload.defaultModel || "default").trim(),
        timeoutSeconds,
        retryCount,
        updatedAt: new Date().toISOString(),
        runtimeApplied: false
      };
      await platformSettingsStore.write(settings);
      return settings;
    }
  });
}
