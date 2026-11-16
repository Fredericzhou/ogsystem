import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";

import {
  MODEL_CATALOG_STALE_AFTER_MS,
  ModelDiscoveryError,
  isModelCatalogStale,
  loadModelCatalog,
  mergeModelCatalogWithLiveSnapshot,
  refreshModelCatalog
} from "../dist/runtime/model-catalog.js";
import {
  resolveModelSelectionForSystem,
  validateModelSelection,
  withDefaultModelSelection
} from "../dist/runtime/model-selection.js";
import { assertPiOutputWithinLimit, discoverConfiguredPiModels, mapPiEffectiveTools, resolvePiModelId } from "../dist/runtime/pi-adapter.js";
import { discoverConfiguredKimiModels } from "../dist/runtime/kimi-adapter.js";
import { discoverConfiguredQwenModels } from "../dist/runtime/qwen-adapter.js";
import { BackendRegistry, opencodeBackendAdapter } from "../dist/runtime/model-backend-registry.js";

const fixturePath = path.resolve("tests/fixtures/opencode-models-verbose.txt");

function model(ref, capabilities = { textInput: true, textOutput: true, toolcall: true }) {
  return {
    backend: "opencode",
    runnable: true,
    modelId: ref,
    status: "active",
    capabilities,
    variants: []
  };
}

function catalog(models, generatedAt = new Date().toISOString()) {
  return {
    catalogVersion: "4",
    generatedAt,
    sources: [{ backend: "opencode", displayName: "OpenCode", iconKey: "opencode", transport: "http", sessionKind: "server-session", status: "runnable" }],
    models
  };
}

test("live Platform models override stale catalog entries without discarding unrelated local models", () => {
  const stored = catalog([
    model("opencode/refreshable"),
    model("opencode/local-only")
  ], "2026-01-01T00:00:00.000Z");
  const refreshed = mergeModelCatalogWithLiveSnapshot(stored, [
    { ...model("opencode/refreshable"), name: "Current model" }
  ], "2026-06-01T00:00:00.000Z");

  assert.equal(refreshed.generatedAt, "2026-06-01T00:00:00.000Z");
  assert.equal(refreshed.models.find((item) => item.modelId === "opencode/refreshable").name, "Current model");
  assert.equal(refreshed.models.some((item) => item.modelId === "opencode/local-only"), true);
  assert.equal(mergeModelCatalogWithLiveSnapshot(stored, []), stored);
});

function system(roleIds, modelBinding = {}) {
  return {
    systemId: "model.contract",
    systemVersion: "1.0.0",
    entryRoleIds: [roleIds[0]],
    roleIds,
    flows: [],
    lawBinding: { globalLawRef: "law.test" },
    executionBinding: {},
    modelBinding
  };
}

test("OpenCode discovery uses the injected command and normalizes the fixture", async () => {
  let invocation;
  const discovered = await refreshModelCatalog({
    workdir: process.cwd(),
    commandRunner: async (args) => {
      invocation = args;
      return { stdout: await readFile(fixturePath, "utf8"), exitCode: 0 };
    }
  });

  assert.deepEqual(invocation, {
    command: "opencode",
    args: ["models", "--verbose"],
    cwd: process.cwd()
  });
  assert.ok(discovered.models.some((entry) => entry.backend === "opencode" && entry.modelId === "opencode/gpt-5-nano"));
  assert.equal(discovered.models[0].capabilities.textOutput, true);
});

test("backend discovery keeps the model catalog independent from live model probes", async () => {
  const registry = new BackendRegistry();
  let probedModel;
  const discoveredModels = [model("provider/unavailable"), model("provider/configured")];
  registry.register({
    backendId: "test-backend",
    displayName: "Test Backend",
    iconKey: "test-backend",
    transport: "cli-stdio",
    sessionKind: "logical-session",
    processOwnership: "spawned_by_ogs",
    capabilities: { textInput: true, textOutput: true, toolcall: false, structuredOutput: false, sessionReuse: false, abort: false }
  }, {
    backendId: "test-backend",
    verifiedRunnable: true,
    async discover() { return { status: "runnable", models: discoveredModels }; },
    async probe({ modelId }) { probedModel = modelId; }
  });

  const result = await registry.discoverBackend("test-backend", {
    workdir: process.cwd(),
    preferredModelIds: ["provider/configured"]
  });

  assert.equal(probedModel, undefined);
  assert.equal(result.source.status, "runnable");
  assert.equal(result.models[0].status, "discovered");
  assert.deepEqual(result.models.map((entry) => entry.modelId), ["provider/unavailable", "provider/configured"]);
});

test("native CLI configuration discovery keeps Pi, Kimi, and Qwen model IDs backend-local", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ogsystem-native-cli-config-"));
  const previous = {
    pi: process.env.PI_MODELS_PATH,
    kimi: process.env.KIMI_CONFIG_PATH,
    qwen: process.env.QWEN_SETTINGS_PATH,
    kimiModel: process.env.OGS_KIMI_MODEL,
    qwenModel: process.env.OGS_QWEN_MODEL
  };
  try {
    const piPath = path.join(root, "pi-models.json");
    const kimiPath = path.join(root, "kimi-config.toml");
    const qwenPath = path.join(root, "qwen-settings.json");
    await writeFile(piPath, JSON.stringify({ providers: { "ogs-codex": { models: [{ id: "gpt-6-luna", name: "GPT-6 Luna" }] } } }), "utf8");
    await writeFile(kimiPath, 'default_model = "ogs-codex/gpt-6-luna"\n[models."ogs-codex/gpt-6-luna"]\nprovider = "ogs-codex"\n', "utf8");
    await writeFile(qwenPath, JSON.stringify({ modelProviders: { openai: [{ id: "gpt-6-luna", name: "GPT-6 Luna" }] }, model: { name: "gpt-6-luna" } }), "utf8");
    process.env.PI_MODELS_PATH = piPath;
    process.env.KIMI_CONFIG_PATH = kimiPath;
    process.env.QWEN_SETTINGS_PATH = qwenPath;
    process.env.OGS_KIMI_MODEL = "env-only/kimi-model";
    process.env.OGS_QWEN_MODEL = "env-only/qwen-model";
    assert.deepEqual((await discoverConfiguredPiModels()).map((model) => model.modelId), ["ogs-codex/gpt-6-luna"]);
    assert.equal(await resolvePiModelId("gpt-6-luna"), "ogs-codex/gpt-6-luna");
    assert.equal(await resolvePiModelId("openai/gpt-6-luna"), "openai/gpt-6-luna");
    assert.deepEqual((await discoverConfiguredKimiModels()).map((model) => model.modelId), ["ogs-codex/gpt-6-luna", "env-only/kimi-model"]);
    assert.deepEqual((await discoverConfiguredQwenModels()).map((model) => model.modelId), ["gpt-6-luna", "env-only/qwen-model"]);
  } finally {
    for (const [key, value] of Object.entries({ PI_MODELS_PATH: previous.pi, KIMI_CONFIG_PATH: previous.kimi, QWEN_SETTINGS_PATH: previous.qwen, OGS_KIMI_MODEL: previous.kimiModel, OGS_QWEN_MODEL: previous.qwenModel })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  }
});

test("Pi projects the frozen v2 tool set into native CLI tool names", () => {
  assert.deepEqual(mapPiEffectiveTools(["workspace.write", "workspace.run", "workspace.search", "workspace.list", "workspace.glob", "workspace.patch_text"]), [
    "bash",
    "edit",
    "find",
    "grep",
    "ls",
    "write"
  ]);
  assert.deepEqual(mapPiEffectiveTools([]), []);
  assert.equal(mapPiEffectiveTools(undefined), undefined);
});

test("Pi fails closed when assistant output exceeds the frozen byte quota", () => {
  assert.doesNotThrow(() => assertPiOutputWithinLimit("ok", 2));
  assert.throws(
    () => assertPiOutputWithinLimit("超出", 3),
    /V2_OUTPUT_QUOTA_EXCEEDED: Pi output exceeded maxOutputBytes \(3\)/
  );
});

test("OpenCode discovery reports stable actionable errors", async () => {
  await assert.rejects(
    () => refreshModelCatalog({ workdir: process.cwd(), commandRunner: async () => ({ stdout: "", exitCode: 0 }) }),
    (error) => error instanceof ModelDiscoveryError && error.code === "MODEL_DISCOVERY_EMPTY" && /sync-models/.test(error.message)
  );
  await assert.rejects(
    () => refreshModelCatalog({ workdir: process.cwd(), commandRunner: async () => ({ stdout: "{", exitCode: 0 }) }),
    (error) => error instanceof ModelDiscoveryError && error.code === "MODEL_DISCOVERY_MALFORMED" && /opencode models --verbose/.test(error.message)
  );
  await assert.rejects(
    () => refreshModelCatalog({ workdir: process.cwd(), commandRunner: async () => ({ stdout: "", stderr: "bad config", exitCode: 7 }) }),
    (error) => error instanceof ModelDiscoveryError && error.code === "MODEL_DISCOVERY_NONZERO_EXIT" && /bad config/.test(error.message)
  );
  await assert.rejects(
    () => refreshModelCatalog({ workdir: process.cwd(), commandRunner: async () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; } }),
    (error) => error instanceof ModelDiscoveryError && error.code === "MODEL_DISCOVERY_COMMAND_MISSING" && /PATH/.test(error.message)
  );
});

test("OpenCode discovery retries a transient truncated verbose response", async () => {
  const fixture = await readFile(fixturePath, "utf8");
  let attempts = 0;
  const result = await opencodeBackendAdapter.discover({
    workdir: process.cwd(),
    commandRunner: async () => ({
      stdout: attempts++ === 0 ? `${fixture}\nprovider/truncated` : fixture,
      exitCode: 0
    })
  });

  assert.equal(attempts, 2);
  assert.equal(result.status, "runnable");
  assert.ok(result.models.length > 0);
});

test("catalog freshness is explicit and preserves unrelated local model entries", async () => {
  const staleAt = new Date(Date.now() - MODEL_CATALOG_STALE_AFTER_MS - 1).toISOString();
  assert.equal(isModelCatalogStale(catalog([], staleAt)), true);
  assert.equal(isModelCatalogStale(catalog([], new Date().toISOString())), false);
  const stored = catalog([model("provider/local-only")]);
  const unchanged = mergeModelCatalogWithLiveSnapshot(stored, []);
  assert.deepEqual(unchanged.models.map((entry) => entry.modelId), ["provider/local-only"]);
});

test("catalog loading preserves backend-local model IDs for OpenCode models", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-model-ref-"));
  const catalogPath = path.join(workdir, "model-catalog.json");
  await writeFile(catalogPath, JSON.stringify(catalog([{
    ...model("google/gemini-3-flash-preview"),
    backend: "opencode",
    modelId: "google/gemini-3-flash-preview",
  }])), "utf8");
  const loaded = await loadModelCatalog(catalogPath);
  assert.equal(loaded?.models[0].modelId, "google/gemini-3-flash-preview");
});

test("per-role model selection overrides the project default", () => {
  const result = resolveModelSelectionForSystem({
    system: system(["defaulted", "mapped"]),
    selection: {
      configVersion: "3",
      defaults: { backend: "opencode", modelId: "provider/project" },
      roles: { mapped: { backend: "codex", modelId: "gpt-5.6-sol" }, label: { backend: "opencode", modelId: "provider/wrong" } }
    },
    catalog: catalog([model("provider/project"), { ...model("codex/gpt-5.6-sol"), backend: "codex", modelId: "gpt-5.6-sol" }])
  });

  assert.equal(result.resolvedByRoleId.get("defaulted").modelRef, "provider/project");
  assert.equal(result.resolvedByRoleId.get("mapped").backend, "codex");
  assert.equal(result.resolvedByRoleId.get("mapped").modelId, "gpt-5.6-sol");
  assert.equal(result.resolvedByRoleId.has("label"), false);
});

test("resume keeps auto as the requested value while carrying a frozen effective value", () => {
  const result = resolveModelSelectionForSystem({
    system: system(["writer"]),
    selection: {
      configVersion: "3",
      roles: { writer: { backend: "qwen", modelId: "gpt-6-luna", reasoningEffort: "auto" } }
    },
    catalog: catalog([{
      ...model("gpt-6-luna"),
      backend: "qwen",
      reasoning: { supported: true, kind: "effort", levels: ["low", "medium", "high"], default: "medium" }
    }]),
    frozenReasoningByRoleId: new Map([["writer", "high"]])
  });

  const resolved = result.resolvedByRoleId.get("writer");
  assert.equal(resolved.reasoningEffort, "auto");
  assert.equal(resolved.effectiveReasoningEffort, "medium");
  assert.equal(resolved.frozenReasoningEffort, "high");
});

test("per-role model selection preserves the resolved fallback model", () => {
  const result = resolveModelSelectionForSystem({
    system: system(["worker"]),
    selection: {
      configVersion: "3",
      roles: { worker: { backend: "opencode", modelId: "provider/primary", fallback: { backend: "codex", modelId: "gpt-6-luna", modelRef: "gpt-6-luna" } } }
    }
  });
  assert.equal(result.resolvedByRoleId.get("worker").fallback.backend, "codex");
  assert.equal(result.resolvedByRoleId.get("worker").fallback.modelId, "gpt-6-luna");
  assert.equal(result.resolvedByRoleId.get("worker").fallback.modelRef, "gpt-6-luna");
});

test("model selection rejects fields outside the current schema", () => {
  assert.throws(() => validateModelSelection({
    configVersion: "3",
    roles: { worker: { backend: "codex", modelId: "gpt-6-luna", fallbackModelRef: "codex/gpt-6-luna" } }
  }, "model-selection.json"), /unsupported field/);
});

test("platform model defaults fill unbound roles without overriding project or role selections", () => {
  const selection = withDefaultModelSelection({
    configVersion: "3",
    roles: { pinned: { backend: "codex", modelId: "gpt-5.6-sol" } }
  }, { backend: "codex", modelId: "platform-default" });
  const result = resolveModelSelectionForSystem({
    system: system(["platform", "pinned"]),
    selection,
    catalog: catalog([
      { ...model("codex/platform-default"), backend: "codex", modelId: "platform-default" },
      { ...model("codex/gpt-5.6-sol"), backend: "codex", modelId: "gpt-5.6-sol" }
    ])
  });

  assert.equal(result.resolvedByRoleId.get("platform").modelId, "platform-default");
  assert.equal(result.resolvedByRoleId.get("pinned").modelId, "gpt-5.6-sol");
  const projectSelection = withDefaultModelSelection({
    configVersion: "3",
    defaults: { backend: "opencode", modelId: "provider/project" }
  }, { backend: "codex", modelId: "platform-default" });
  assert.equal(projectSelection?.defaults?.modelId, "provider/project");
});

test("fresh discovery fails closed for unavailable and incapable pinned models", () => {
  assert.throws(
    () => resolveModelSelectionForSystem({
      system: system(["writer"]),
      selection: { configVersion: "3", roles: { writer: { backend: "opencode", modelId: "provider/missing" } } },
      catalog: catalog([model("provider/other")])
    }),
    (error) => error?.envelope?.errorCode === "MODEL_UNAVAILABLE" && error.envelope.roleId === "writer" && /provider\/missing/.test(error.message)
  );
  assert.throws(
    () => resolveModelSelectionForSystem({
      system: system(["writer"]),
      selection: { configVersion: "3", roles: { writer: { backend: "opencode", modelId: "provider/textless" } } },
      catalog: catalog([model("provider/textless", { textInput: true, textOutput: false, toolcall: true })])
    }),
    (error) => error?.envelope?.errorCode === "MODEL_CAPABILITY_MISMATCH" && error.envelope.roleId === "writer" && /textOutput/.test(error.message)
  );
});

test("Harness normalization rejects Business Graph model bindings", () => {
  assert.throws(() => resolveModelSelectionForSystem({
    system: system(["writer"], { writer: "provider/offline" }),
    selection: { configVersion: "3", roles: { writer: { backend: "opencode", modelId: "provider/offline" } } },
    sourceLabel: "Harness Template"
  }), (error) => error?.envelope?.errorCode === "MODEL_BINDING_UNRESOLVED" && /Harness Template/.test(error.message));
  assert.throws(() => resolveModelSelectionForSystem({
    system: system(["writer"]),
    selection: { configVersion: "1", defaults: { model: "provider/old" } }
  }), /unsupported version/);
});

test("roles without a synthesized Harness remain unbound for readiness validation", () => {
  const result = resolveModelSelectionForSystem({
    system: system(["writer"])
  });

  assert.equal(result.resolvedByRoleId.has("writer"), false);
  assert.deepEqual(result.warnings, []);
});
