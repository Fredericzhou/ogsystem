import { mkdir } from "node:fs/promises";
import { defaultBackendRegistry } from "../../../dist/runtime/model-backend-registry.js";
import { discoverLocalModelCatalog, isModelCatalogStale } from "../../../dist/runtime/model-catalog.js";

export function createModelCatalog({
  workdir,
  cacheMs = 30_000,
  verificationTtlMs = 5 * 60_000,
  discover = discoverLocalModelCatalog,
  isStale = isModelCatalogStale,
  now = Date.now
}) {
  if (!workdir) throw new TypeError("Model discovery workdir is required.");
  let cache;
  const backendCaches = new Map();
  const backendInflight = new Map();
  const modelVerification = new Map();
  const backendModelSignatures = new Map();

  const verificationKey = (backend, modelId) => JSON.stringify([backend, modelId]);
  const clearBackendVerification = (backend) => {
    for (const [key, value] of modelVerification) {
      if (value.backend === backend) modelVerification.delete(key);
    }
  };
  const applyVerification = (catalog) => {
    let changed = false;
    const sourceStatus = new Map((catalog.sources || []).map((source) => [source.backend, source.status]));
    const models = (catalog.models || []).map((model) => {
      const key = verificationKey(model.backend, model.modelId);
      const verification = modelVerification.get(key);
      if (!verification || verification.expiresAt <= now()) {
        if (verification) modelVerification.delete(key);
        return model;
      }
      if (sourceStatus.get(model.backend) && sourceStatus.get(model.backend) !== "runnable") return model;
      changed = true;
      return {
        ...model,
        status: verification.status === "verified" ? "verified" : "unavailable",
        runnable: verification.status === "verified",
        ...(verification.message ? { detail: verification.message } : {})
      };
    });
    return changed ? { ...catalog, models } : catalog;
  };
  const withVerification = (value) => value && typeof value.then === "function"
    ? value.then(applyVerification)
    : applyVerification(value);

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
      status: model.status || (model.runnable ? "discovered" : "unverified"),
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
    // A refresh bypasses the completed cache, but it must still join an
    // in-flight discovery. Starting another CLI/ACP process for every poll
    // can keep a slow backend permanently in the checking state.
    if (forceRefresh) clearBackendVerification(backend);
    if (backendInflight.has(backend)) return backendInflight.get(backend);
    if (!forceRefresh && cached && now() - cached.at < cacheMs) return withVerification(cached.value);
    const promise = (async () => {
      await mkdir(workdir, { recursive: true });
      const raw = await defaultBackendRegistry.discoverBackend(backend, { workdir });
      const base = normalize({ generatedAt: new Date().toISOString(), sources: [raw.source], models: raw.models });
      const signature = base.models.map((model) => model.modelId).sort().join("\u001f");
      if (backendModelSignatures.has(backend) && backendModelSignatures.get(backend) !== signature) clearBackendVerification(backend);
      backendModelSignatures.set(backend, signature);
      backendCaches.set(backend, { at: now(), value: base });
      return applyVerification(base);
    })();
    backendInflight.set(backend, promise);
    try { return await promise; }
    finally { if (backendInflight.get(backend) === promise) backendInflight.delete(backend); }
  }

  async function load() {
    await mkdir(workdir, { recursive: true });
    const catalog = await discover({ workdir });
    const base = normalize(catalog);
    const discoveredBackends = new Set(base.sources.map((source) => source.backend));
    for (const backend of backendModelSignatures.keys()) {
      if (!discoveredBackends.has(backend)) clearBackendVerification(backend);
    }
    for (const backend of discoveredBackends) {
      const signature = base.models.filter((model) => model.backend === backend).map((model) => model.modelId).sort().join("\u001f");
      if (backendModelSignatures.has(backend) && backendModelSignatures.get(backend) !== signature) clearBackendVerification(backend);
      backendModelSignatures.set(backend, signature);
    }
    return applyVerification(base);
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
    recordModelVerification(result) {
      const backend = String(result?.backend || "").trim();
      const modelId = String(result?.modelId || "").trim();
      if (!backend || !modelId) return;
      const status = result?.status === "verified" || result?.status === "runnable" ? "verified" : "unavailable";
      modelVerification.set(verificationKey(backend, modelId), {
        backend,
        status,
        ...(result?.message ? { message: String(result.message) } : {}),
        expiresAt: now() + verificationTtlMs
      });
    },
    async discover({ forceRefresh = false } = {}) {
      if (forceRefresh) modelVerification.clear();
      if (!forceRefresh && cache && now() - cache.at < cacheMs) return withVerification(cache.value);
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
