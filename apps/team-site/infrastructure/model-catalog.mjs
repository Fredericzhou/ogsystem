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

  async function load() {
    await mkdir(workdir, { recursive: true });
    const catalog = await discover({ workdir });
    return {
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
      models: (catalog.models || []).map((model) => {
        const modelId = model.modelId;
        return {
          backend: model.backend,
          modelId,
          name: model.name || modelId,
          status: model.status || (model.runnable ? "active" : "unavailable"),
          runnable: Boolean(model.runnable),
          capabilities: model.capabilities || {
            textInput: true,
            textOutput: true,
            toolcall: true
          },
          variants: Array.isArray(model.variants) ? model.variants : []
        };
      })
    };
  }

  return Object.freeze({
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
