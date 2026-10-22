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
    assert.deepEqual(await store.read(), { defaultProvider: "codex", defaultModel: "default", timeoutSeconds: 120, retryCount: 1, runtimeApplied: false });
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
        sources: [{ backend: "codex", status: "ready", command: "codex", detail: "local" }],
        models: [
          { modelId: "model-a", backend: "codex", provider: "openai", runnable: true, ref: "codex/model-a" },
          { modelId: "opencode/model-b", backend: "opencode", provider: "opencode", runnable: true, ref: "opencode/model-b" }
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
  assert.equal((await useCases.listPlatformProviders()).providers[0].name, "Codex");
  assert.equal(calls, 1);
  const discoveredModel = (await useCases.listPlatformModels()).models[0];
  assert.equal(discoveredModel.id, "model-a");
  assert.equal(discoveredModel.backend, "codex", "the execution backend must survive the public catalog projection");
  assert.equal(discoveredModel.provider, "openai", "provider namespace is distinct from the execution backend");
  const openCodeModel = (await useCases.listPlatformModels()).models.find((item) => item.backend === "opencode");
  assert.equal(openCodeModel.selectionRef, "opencode/opencode/model-b", "Studio bindings keep adapter and provider/model identity separate");
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
      { ref: "codex/gpt-6-luna", backend: "codex", id: "gpt-6-luna", runnable: true },
      { ref: "codex/disabled", backend: "codex", id: "disabled", runnable: false }
    ] }) },
    probeModelAvailability: async (model) => (probed.push(model.ref), { status: "available", modelRef: model.ref })
  });

  assert.deepEqual(await useCases.probeModelAvailability("codex/gpt-6-luna"), { status: "available", modelRef: "codex/gpt-6-luna" });
  await assert.rejects(useCases.probeModelAvailability("codex/disabled"), /not currently discovered as runnable/);
  assert.deepEqual(probed, ["codex/gpt-6-luna"]);
});
