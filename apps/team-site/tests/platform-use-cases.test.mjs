import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatformUseCases } from "../application/platform-use-cases.mjs";
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

test("platform model probe only invokes the live probe for a discovered runnable model", async () => {
  const probed = [];
  const useCases = createPlatformUseCases({
    platformSettingsStore: { read: async () => ({}), write: async () => undefined },
    modelCatalog: { discover: async () => ({ models: [
      { backend: "codex", modelId: "gpt-6-luna", runnable: true },
      { backend: "codex", modelId: "disabled", runnable: false }
    ] }) },
    probeModelAvailability: async (model) => (probed.push(model), { status: "runnable", ...model })
  });

  assert.deepEqual(await useCases.probeModelAvailability({ backend: "codex", modelId: "gpt-6-luna" }), { status: "runnable", backend: "codex", modelId: "gpt-6-luna", runnable: true });
  await assert.rejects(useCases.probeModelAvailability({ backend: "codex", modelId: "disabled" }), /not currently discovered as runnable/);
  assert.deepEqual(probed, [{ backend: "codex", modelId: "gpt-6-luna", runnable: true }]);
});
