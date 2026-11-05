import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatformUseCases, resolvePlatformDefaultModelSelection } from "../application/platform-use-cases.mjs";
import { createFilePlatformSettings } from "../infrastructure/file-platform-settings.mjs";
import { createModelCatalog } from "../infrastructure/model-catalog.mjs";

test("platform settings adapter defaults, persists atomically, and reports malformed data", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-platform-settings-"));
  const path = join(root, ".site", "settings.json");
  try {
    const store = createFilePlatformSettings({ path });
    assert.deepEqual(await store.read(), { defaultProvider: "opencode", defaultModel: "gpt-6-luna", timeoutSeconds: 120, retryCount: 1, runtimeApplied: false });
    const value = { defaultProvider: "opencode", defaultModel: "model-a", timeoutSeconds: 60, retryCount: 2, runtimeApplied: false };
    await store.write(value);
    assert.equal(await readFile(path, "utf8"), `${JSON.stringify(value, null, 2)}\n`);
    assert.deepEqual(await store.read(), value);
    await (await import("node:fs/promises")).writeFile(path, "invalid", "utf8");
    await assert.rejects(store.read(), SyntaxError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("platform application validates updates and model catalog caches and refreshes discovery", async () => {
  let time = 1_000;
  let calls = 0;
  const catalog = createModelCatalog({
    workdir: join(tmpdir(), "unused-model-discovery"),
    cacheMs: 100,
    now: () => time,
    discover: async () => {
      calls += 1;
      return {
        generatedAt: `generation-${calls}`,
        sources: [{ backend: "codex", displayName: "Codex", iconKey: "codex", status: "runnable", detail: "local" }],
        models: [
          { modelId: "model-a", backend: "codex", runnable: true },
          { modelId: "vendor/model-b", backend: "opencode", runnable: true }
        ]
      };
    },
    isStale: () => false
  });
  const writes = [];
  const useCases = createPlatformUseCases({
    platformSettingsStore: { read: async () => ({}), write: async (settings) => writes.push(settings) },
    modelCatalog: catalog
  });
  assert.deepEqual(await useCases.getPlatformDiscovery(), await useCases.getPlatformDiscovery());
  assert.equal(calls, 1);
  assert.equal((await useCases.listPlatformProviders()).backends[0].displayName, "Codex");
  assert.equal(calls, 1);
  const discoveredModel = (await useCases.listPlatformModels()).models[0];
  assert.equal(discoveredModel.backend, "codex", "the execution backend must survive the public catalog projection");
  const openCodeModel = (await useCases.listPlatformModels()).models.find((item) => item.backend === "opencode");
  assert.equal(openCodeModel.modelId, "vendor/model-b", "backend-local model IDs are preserved unchanged");
  assert.equal(calls, 1);
  await useCases.getPlatformDiscovery(true);
  assert.equal(calls, 2);
  time += 101;
  await useCases.getPlatformDiscovery();
  assert.equal(calls, 3);

  await assert.rejects(useCases.updatePlatformSettings({ timeoutSeconds: 9, retryCount: 0 }), /timeoutSeconds/);
  assert.equal(writes.length, 0);
  const settings = await useCases.updatePlatformSettings({ defaultProvider: " opencode ", defaultModel: " model-b ", timeoutSeconds: "60", retryCount: "2" });
  assert.deepEqual({ ...settings, updatedAt: undefined }, {
    defaultProvider: "opencode", defaultModel: "model-b", timeoutSeconds: 60, retryCount: 2, updatedAt: undefined, runtimeApplied: false
  });
  assert.deepEqual(writes, [settings]);
});

test("platform model probe only invokes the live probe for a discovered model", async () => {
  const probed = [];
  const useCases = createPlatformUseCases({
    platformSettingsStore: { read: async () => ({}), write: async () => undefined },
    modelCatalog: { discover: async () => ({ models: [
      { backend: "codex", modelId: "gpt-6-luna", runnable: true, status: "verified" },
      { backend: "codex", modelId: "disabled", runnable: false, status: "unavailable" }
    ] }) },
    probeModelAvailability: async (model) => (probed.push(model), { status: "runnable", ...model })
  });

  assert.deepEqual(await useCases.probeModelAvailability({ backend: "codex", modelId: "gpt-6-luna" }), { status: "verified", backend: "codex", modelId: "gpt-6-luna", runnable: true });
  await assert.rejects(useCases.probeModelAvailability({ backend: "codex", modelId: "disabled" }), /not currently discovered in its backend configuration/);
  assert.deepEqual(probed, [{ backend: "codex", modelId: "gpt-6-luna", runnable: true, status: "verified" }]);
});

test("verified native models enter the shared runtime selection catalog", async () => {
  let verified = false;
  const model = { backend: "qwen", modelId: "configured-model", name: "Configured model", status: "unverified", runnable: false };
  const discovery = () => ({ models: [{ ...model, status: verified ? "verified" : "unverified", runnable: verified }] });
  const modelCatalog = {
    discover: async () => discovery(),
    listBackends: () => [{ backend: "qwen" }],
    discoverBackend: async () => ({ source: { backend: "qwen", status: "runnable" }, models: discovery().models }),
    recordModelVerification: () => { verified = true; }
  };
  const useCases = createPlatformUseCases({
    platformSettingsStore: {
      read: async () => ({ defaultProvider: "qwen", defaultModel: "configured-model" }),
      write: async () => undefined
    },
    modelCatalog,
    probeModelAvailability: async () => ({ status: "verified" })
  });

  assert.equal((await useCases.getDefaultModelSelection()).modelCatalogModels.length, 0);
  await useCases.probeModelAvailability({ backend: "qwen", modelId: "configured-model" });
  const selection = await useCases.getDefaultModelSelection();
  assert.deepEqual(selection.modelSelectionDefaults, { backend: "qwen", modelId: "configured-model" });
  assert.equal(selection.modelCatalogModels[0].runnable, true);
});

test("default model selection bounds slow backend discovery", async () => {
  const useCases = createPlatformUseCases({
    platformSettingsStore: {
      read: async () => ({ defaultProvider: "qwen", defaultModel: "default" }),
      write: async () => undefined
    },
    modelCatalog: {
      listBackends: () => [{ backend: "qwen" }],
      discoverBackend: () => new Promise(() => undefined),
      discover: async () => ({ models: [] })
    },
    backendDiscoveryTimeoutMs: 5
  });

  assert.equal(await useCases.getDefaultModelSelection(), undefined);
});

test("platform model verification survives discovery and expires without changing native config", async () => {
  let time = 1_000;
  const catalog = createModelCatalog({
    workdir: join(tmpdir(), "ogs-model-verification-overlay"),
    verificationTtlMs: 10,
    now: () => time,
    discover: async () => ({
      generatedAt: "native-config",
      sources: [{ backend: "qwen", status: "runnable" }],
      models: [{ backend: "qwen", modelId: "configured-model", runnable: false, status: "unverified" }]
    }),
    isStale: () => false
  });
  const useCases = createPlatformUseCases({
    platformSettingsStore: { read: async () => ({}), write: async () => undefined },
    modelCatalog: catalog,
    probeModelAvailability: async (model) => ({ backend: model.backend, modelId: model.modelId, status: "verified" })
  });

  assert.equal((await useCases.listPlatformModels()).models[0].runnable, false);
  await useCases.probeModelAvailability({ backend: "qwen", modelId: "configured-model" });
  assert.deepEqual((await useCases.listPlatformModels()).models[0], {
    backend: "qwen", modelId: "configured-model", name: "configured-model", status: "verified", runnable: true,
    capabilities: { textInput: true, textOutput: true, toolcall: true }, variants: []
  });
  time += 11;
  assert.equal((await useCases.listPlatformModels()).models[0].runnable, false);
  await useCases.probeModelAvailability({ backend: "qwen", modelId: "configured-model" });
  await useCases.getPlatformDiscovery(true);
  assert.equal((await useCases.listPlatformModels()).models[0].runnable, false);
});

test("backend outages never expose a cached model verification as runnable", async () => {
  let sourceStatus = "runnable";
  const catalog = createModelCatalog({
    workdir: join(tmpdir(), "ogs-model-verification-backend-status"),
    cacheMs: 0,
    discover: async () => ({
      generatedAt: "native-config",
      sources: [{ backend: "qwen", status: sourceStatus }],
      models: [{ backend: "qwen", modelId: "configured-model", runnable: false, status: "unverified" }]
    }),
    isStale: () => false
  });

  await catalog.discover();
  catalog.recordModelVerification({ backend: "qwen", modelId: "configured-model", status: "verified" });
  assert.equal((await catalog.discover()).models[0].runnable, true);

  sourceStatus = "service_unavailable";
  const discovery = await catalog.discover();
  assert.equal(discovery.models[0].runnable, false);
  assert.equal(discovery.models[0].status, "unverified");
});

test("slow UI discovery never masquerades as an empty model catalog", async () => {
  let pendingResolve;
  let pending = false;
  const snapshot = {
    generatedAt: "cached-generation",
    sources: [{ backend: "codex", status: "runnable" }],
    models: [{ backend: "codex", modelId: "gpt-6-luna", runnable: true }]
  };
  const catalog = {
    discover: async () => {
      if (!pending) return snapshot;
      return new Promise((resolve) => { pendingResolve = resolve; });
    }
  };
  const useCases = createPlatformUseCases({
    platformSettingsStore: { read: async () => ({}), write: async () => undefined },
    modelCatalog: catalog,
    uiDiscoveryTimeoutMs: 5
  });

  assert.deepEqual((await useCases.listPlatformModels()).models, snapshot.models);
  pending = true;
  const cached = await useCases.listPlatformModels();
  assert.deepEqual(cached.models, snapshot.models);
  assert.equal(cached.stale, true);
  assert.equal(cached.discoveryPending, true);

  pendingResolve(snapshot);
  pending = false;
  const refreshed = await useCases.listPlatformModels();
  assert.deepEqual(refreshed.models, snapshot.models);
});

test("first slow UI discovery returns an explicit error instead of an empty catalog", async () => {
  const useCases = createPlatformUseCases({
    platformSettingsStore: { read: async () => ({}), write: async () => undefined },
    modelCatalog: { discover: () => new Promise(() => undefined) },
    uiDiscoveryTimeoutMs: 5
  });
  await assert.rejects(useCases.listPlatformModels(), /Model discovery is still running/);
});

test("resolvePlatformDefaultModelSelection flags unverified configured models and excludes them from execution defaults", () => {
  const settings = { defaultProvider: "kimi", defaultModel: "kimi-k1.5" };
  const discoveries = [{
    sources: [{ backend: "kimi", status: "runnable" }],
    generatedAt: "2026-11-05T00:00:00.000Z",
    models: [
      { backend: "kimi", modelId: "kimi-k1.5", name: "Kimi K1.5", status: "unverified", runnable: false, capabilities: { textInput: true, textOutput: true, toolcall: true } }
    ]
  }];

  const selection = resolvePlatformDefaultModelSelection({ settings, discoveries });
  assert.ok(selection, "selection object should be returned");
  assert.deepEqual(selection.unverifiedConfiguredModel, { backend: "kimi", modelId: "kimi-k1.5" });
  assert.equal(selection.modelSelectionDefaults, undefined, "unverified model must not be selected as execution default");
  assert.equal(selection.modelCatalogModels.length, 0, "unverified model must not enter runnable execution catalog");
});

test("resolvePlatformDefaultModelSelection does not flag unverified models when backend is not runnable", () => {
  const settings = { defaultProvider: "kimi", defaultModel: "kimi-k1.5" };
  const discoveries = [{
    sources: [{ backend: "kimi", status: "not_installed" }],
    generatedAt: "2026-11-05T00:00:00.000Z",
    models: [
      { backend: "kimi", modelId: "kimi-k1.5", status: "unverified", runnable: false }
    ]
  }];

  const selection = resolvePlatformDefaultModelSelection({ settings, discoveries });
  assert.equal(selection, undefined, "no selection should be produced when backend is not runnable");
});

test("resolvePlatformDefaultModelSelection filters out unavailable, disabled, or deprecated models", () => {
  const settings = { defaultProvider: "pi", defaultModel: "default" };
  const discoveries = [{
    sources: [{ backend: "pi", status: "runnable" }],
    generatedAt: "2026-11-05T00:00:00.000Z",
    models: [
      { backend: "pi", modelId: "pi/deprecated-model", status: "deprecated", runnable: false },
      { backend: "pi", modelId: "pi/disabled-model", status: "disabled", runnable: false },
      { backend: "pi", modelId: "pi/unavailable-model", status: "unavailable", runnable: false },
      { backend: "pi", modelId: "pi/active-model", status: "unverified", runnable: false }
    ]
  }];

  const selection = resolvePlatformDefaultModelSelection({ settings, discoveries });
  assert.ok(selection);
  assert.deepEqual(selection.unverifiedConfiguredModel, { backend: "pi", modelId: "pi/active-model" });
  assert.equal(selection.modelSelectionDefaults, undefined);
  assert.equal(selection.modelCatalogModels.length, 0);
});
