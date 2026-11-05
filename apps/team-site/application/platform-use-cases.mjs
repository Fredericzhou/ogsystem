export function createPlatformUseCases({
  platformSettingsStore,
  modelCatalog,
  uiDiscoveryTimeoutMs = 2500,
  backendDiscoveryTimeoutMs = 2500,
  probeModelAvailability = async () => {
    throw new Error("Model availability probe is unavailable.");
  }
}) {
  if (!platformSettingsStore || typeof platformSettingsStore.read !== "function" || typeof platformSettingsStore.write !== "function") {
    throw new TypeError("Platform use cases require a settings store.");
  }
  if (!modelCatalog || typeof modelCatalog.discover !== "function") {
    throw new TypeError("Platform use cases require a model catalog.");
  }

  let lastUiDiscovery;
  const discoverForUi = async () => {
    const discoveryPromise = modelCatalog.discover();
    // Keep the snapshot current even when the bounded UI request has already
    // returned. The next request can then use it while a slow CLI refreshes.
    void discoveryPromise.then((value) => { lastUiDiscovery = value; }, () => undefined);
    let timeoutId;
    try {
      const discovery = await Promise.race([
        discoveryPromise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("Model discovery is still running. Use Refresh to check again.")), uiDiscoveryTimeoutMs);
        })
      ]);
      lastUiDiscovery = discovery;
      return discovery;
    } catch (error) {
      if (lastUiDiscovery) {
        return {
          ...lastUiDiscovery,
          stale: true,
          discoveryPending: true,
          discoveryError: error instanceof Error ? error.message : String(error)
        };
      }
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const discoverBackendForUi = async (backend, forceRefresh = false) => {
    if (typeof modelCatalog.discoverBackend !== "function") {
      throw new Error("Per-backend model discovery is unavailable.");
    }
    const backendId = String(backend || "").trim();
    const promise = modelCatalog.discoverBackend(backendId, forceRefresh);
    let timeoutId;
    try {
      return await Promise.race([
        promise,
        new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve({
            source: { backend: backendId, status: "checking" },
            models: [],
            discoveryPending: true
          }), backendDiscoveryTimeoutMs);
        })
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  return Object.freeze({
    listPlatformBackends: () => modelCatalog.listBackends(),
    discoverPlatformBackend: discoverBackendForUi,
    getPlatformDiscovery: (forceRefresh = false) => modelCatalog.discover({ forceRefresh }),
    async probeModelAvailability(target) {
      const backend = typeof target === "object" && target !== null
        ? String(target.backend || "").trim()
        : "";
      const modelId = typeof target === "object" && target !== null
        ? String(target.modelId || "").trim()
        : "";
      if (!backend || !modelId) {
        throw new Error("Model availability probe requires both backend and modelId.");
      }
      const discovery = await modelCatalog.discover();
      const model = (discovery.models || []).find(
        (item) => item.backend === backend && item.modelId === modelId && !["unavailable", "disabled", "deprecated"].includes(String(item.status || "").toLowerCase())
      );
      if (!model) {
        throw new Error(
          `Model "${backend} · ${modelId}" is not currently discovered in its backend configuration. Refresh model discovery and try again.`
        );
      }
      const result = await probeModelAvailability(model);
      modelCatalog.recordModelVerification?.({ backend, modelId, ...result });
      return result;
    },
    async listPlatformProviders() {
      const discovery = await discoverForUi();
      return {
        backends: (discovery.sources || []).map(
          ({ backend, displayName, iconKey, transport, sessionKind, status, detail }) => ({
            backend,
            displayName: displayName || backend,
            iconKey: iconKey || backend,
            transport,
            sessionKind,
            status,
            ...(detail ? { detail } : {})
          })
        ),
        ...(discovery.discoveryPending ? { discoveryPending: true, discoveryError: discovery.discoveryError } : {})
      };
    },
    async listPlatformModels() {
      const discovery = await discoverForUi();
      return {
        models: discovery.models || [],
        ...(discovery.generatedAt ? { generatedAt: discovery.generatedAt } : {}),
        ...(discovery.stale ? { stale: true } : {}),
        ...(discovery.discoveryPending ? { discoveryPending: true, discoveryError: discovery.discoveryError } : {})
      };
    },
    readPlatformSettings: () => platformSettingsStore.read(),
    async getDefaultModelSelection() {
      const settings = await platformSettingsStore.read();
      const backendIds = [settings.defaultProvider, ...modelCatalog.listBackends()
        .map((backend) => backend.backend)
        .filter((backend) => backend && backend !== settings.defaultProvider)];
      const discoveries = await Promise.all(backendIds.map(async (backend) => {
        try { return await discoverBackendForUi(backend); }
        catch { return undefined; }
      }));
      return resolvePlatformDefaultModelSelection({ settings, discoveries });
    },
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

export function resolvePlatformDefaultModelSelection({ settings = {}, discoveries = [] } = {}) {
  const runnableModels = [];
  const unverifiedCandidates = [];

  for (const discovery of discoveries) {
    const isBackendRunnable = discovery?.sources?.some((source) => source.status === "runnable")
      || discovery?.source?.status === "runnable"
      || discovery?.status === "runnable";
    for (const model of discovery?.models || []) {
      const statusLower = String(model.status || "").toLowerCase();
      if (["unavailable", "disabled", "deprecated"].includes(statusLower)) {
        continue;
      }
      if (model.runnable) {
        runnableModels.push(model);
      } else if (isBackendRunnable && (statusLower === "unverified" || statusLower === "discovered" || !statusLower)) {
        unverifiedCandidates.push(model);
      }
    }
  }

  const generatedAt = discoveries.map((discovery) => discovery?.generatedAt).filter(Boolean).sort().at(-1);
  const configured = String(settings.defaultModel || "default");
  const matchesConfiguredModel = (model) => {
    const modelId = model.modelId || model.id;
    if (modelId === configured) return true;
    if (model.backend !== settings.defaultProvider || configured === "default") return false;
    return modelId?.endsWith(`/${configured}`);
  };

  const selectedRunnable = configured === "default"
    ? runnableModels.find((model) => model.backend === settings.defaultProvider)
    : runnableModels.find(matchesConfiguredModel);

  const matchedUnverified = configured === "default"
    ? unverifiedCandidates.find((model) => model.backend === settings.defaultProvider)
    : unverifiedCandidates.find(matchesConfiguredModel);

  const unverifiedConfiguredModel = !selectedRunnable && matchedUnverified
    ? { backend: matchedUnverified.backend, modelId: matchedUnverified.modelId || matchedUnverified.id }
    : undefined;

  const fallbackSelection = !selectedRunnable && !runnableModels.length && !unverifiedConfiguredModel && !discoveries.length && configured !== "default"
    ? { backend: settings.defaultProvider || "opencode", modelId: configured }
    : !selectedRunnable && !runnableModels.length && !unverifiedConfiguredModel && !discoveries.length
      ? { backend: settings.defaultProvider || "opencode", modelId: "gpt-6-luna" }
      : undefined;

  const effectiveSelection = selectedRunnable
    ? { backend: selectedRunnable.backend, modelId: selectedRunnable.modelId || selectedRunnable.id }
    : fallbackSelection;

  if (!effectiveSelection && !runnableModels.length && !unverifiedConfiguredModel) {
    return undefined;
  }

  return {
    ...(effectiveSelection ? { modelSelectionDefaults: effectiveSelection } : {}),
    ...(unverifiedConfiguredModel ? { unverifiedConfiguredModel } : {}),
    modelCatalogGeneratedAt: generatedAt,
    modelCatalogModels: runnableModels.map((model) => ({
      backend: model.backend,
      modelId: model.modelId || model.id,
      name: model.name,
      status: model.status || "active",
      runnable: true,
      capabilities: model.capabilities || { textInput: true, textOutput: true, toolcall: false },
      variants: Array.isArray(model.variants) ? model.variants : []
    }))
  };
}
