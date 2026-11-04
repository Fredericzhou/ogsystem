import { mkdir } from "node:fs/promises";
import { defaultBackendRegistry } from "../../../dist/runtime/model-backend-registry.js";
import { discoverLocalModelCatalog, isModelCatalogStale } from "../../../dist/runtime/model-catalog.js";

export function createModelCatalog({
  workdir,
  cacheMs = 30_000,
  discover = discoverLocalModelCatalog,
  isStale = isModelCatalogStale,
  now = Date.now
}) {
  if (!workdir) throw new TypeError("Model discovery workdir is required.");
  let cache;
  const backendCaches = new Map();
  const backendInflight = new Map();

  const normalize = (catalog) => ({
    generatedAt: catalog.generatedAt,
    stale: isStale(catalog),
    workdir,
    sources: (catalog.sources || []).map((source) => {
      const descriptor = defaultBackendRegistry.getDescriptor(source.backend);
      return {
        backend: source.backend,
        displayName: source.displayName || descriptor?.displayName || source.backend,
        iconKey: source.iconKey || descriptor?.iconKey || source.backend,
        transport: source.transport || descriptor?.transport || "cli-stdio",
        sessionKind: source.sessionKind || descriptor?.sessionKind || "logical-session",
        status: source.status || "unavailable",
        ...(source.detail ? { detail: source.detail } : {})
      };
    }),
    models: (catalog.models || []).map((model) => ({
      backend: model.backend,
      modelId: model.modelId,
      name: model.name || model.modelId,
      status: model.status || (model.runnable ? "discovered" : "unavailable"),
      // Kept for the runtime selection contract; status is the UI truth.
      runnable: Boolean(model.runnable),
      capabilities: model.capabilities || { textInput: true, textOutput: true, toolcall: true },
      variants: Array.isArray(model.variants) ? model.variants : []
    }))
  });

  async function discoverBackend(backend, forceRefresh = false) {
    if (!defaultBackendRegistry.has(backend)) {
      const error = new Error(`Backend "${backend}" is not registered.`);
      error.code = "BACKEND_NOT_FOUND";
      throw error;
    }
    const cached = backendCaches.get(backend);
    if (!forceRefresh && cached && now() - cached.at < cacheMs) return cached.value;
    if (!forceRefresh && backendInflight.has(backend)) return backendInflight.get(backend);
    const promise = (async () => {
      await mkdir(workdir, { recursive: true });
      const raw = await defaultBackendRegistry.discoverBackend(backend, { workdir });
      const value = normalize({ generatedAt: new Date().toISOString(), sources: [raw.source], models: raw.models });
      backendCaches.set(backend, { at: now(), value });
      return value;
    })();
    backendInflight.set(backend, promise);
    try { return await promise; }
    finally { if (backendInflight.get(backend) === promise) backendInflight.delete(backend); }
  }

  async function load() {
    await mkdir(workdir, { recursive: true });
    const catalog = await discover({ workdir });
    return normalize(catalog);
  }

  return Object.freeze({
    listBackends() {
      return defaultBackendRegistry.listDescriptors().map((descriptor) => ({
        backend: descriptor.backendId,
        displayName: descriptor.displayName,
        iconKey: descriptor.iconKey,
        transport: descriptor.transport,
        sessionKind: descriptor.sessionKind,
        status: "checking"
      }));
    },
    discoverBackend,
    async discover({ forceRefresh = false } = {}) {
      if (!forceRefresh && cache && now() - cache.at < cacheMs) return cache.value;
      const value = load();
      cache = { at: now(), value };
      try {
        return await value;
      } catch (error) {
        if (cache?.value === value) cache = undefined;
        throw error;
      }
    }
  });
}
