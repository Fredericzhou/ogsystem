import { mkdir } from "node:fs/promises";
import { discoverLocalModelCatalog, isModelCatalogStale } from "../../../dist/runtime/model-catalog.js";

const providerNames = Object.freeze({ codex: "Codex", opencode: "OpenCode", claude: "Claude", antigravity: "Antigravity", openai: "OpenAI", code2: "Code2", multidebate: "Multi Debate" });
const providerLabel = (backend) => providerNames[backend] || backend;

export function createModelCatalog({ workdir, cacheMs = 30_000, discover = discoverLocalModelCatalog, isStale = isModelCatalogStale, now = Date.now }) {
  if (!workdir) throw new TypeError("Model discovery workdir is required.");
  let cache;

  async function load() {
    await mkdir(workdir, { recursive: true });
    const catalog = await discover({ workdir });
    return {
      generatedAt: catalog.generatedAt,
      stale: isStale(catalog),
      workdir,
      sources: catalog.sources.map((source) => ({ ...source, backend: source.backend, name: providerLabel(source.backend) })),
      models: catalog.models.map((model) => ({
        id: model.modelId,
        backend: model.backend,
        name: model.name || model.modelId,
        provider: model.provider || model.backend,
        providerName: providerLabel(model.provider || model.backend),
        status: model.status || (model.runnable ? "active" : "unavailable"),
        runnable: Boolean(model.runnable),
        capabilities: model.capabilities,
        ref: model.ref
      }))
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
