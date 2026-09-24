import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";

import {
  MODEL_CATALOG_STALE_AFTER_MS,
  ModelDiscoveryError,
  isModelCatalogStale,
  refreshModelCatalog
} from "../dist/runtime/model-catalog.js";
import {
  loadModelSelection,
  resolveModelSelectionForSystem
} from "../dist/runtime/model-selection.js";
import { syncProjectModels } from "../dist/runtime/project-lifecycle.js";

const fixturePath = path.resolve("tests/fixtures/opencode-models-verbose.txt");

function model(ref, capabilities = { textInput: true, textOutput: true, toolcall: true }) {
  const separator = ref.indexOf("/");
  return {
    backend: "opencode",
    runnable: true,
    modelId: ref,
    ref,
    provider: ref.slice(0, separator),
    model: ref.slice(separator + 1),
    status: "active",
    capabilities,
    variants: []
  };
}

function catalog(models, generatedAt = new Date().toISOString()) {
  return {
    catalogVersion: "2",
    generatedAt,
    sources: [{ backend: "opencode", command: "opencode models --verbose", status: "available" }],
    models
  };
}

function system(roleIds, modelBinding = {}) {
  return {
    systemId: "model.contract",
    systemVersion: "1.0.0",
    entryRoleId: roleIds[0],
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
  assert.ok(discovered.models.some((entry) => entry.ref === "opencode/gpt-5-nano"));
  assert.equal(discovered.models[0].capabilities.textOutput, true);
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

test("catalog freshness is explicit and does not rewrite the pinned selection", async () => {
  const staleAt = new Date(Date.now() - MODEL_CATALOG_STALE_AFTER_MS - 1).toISOString();
  assert.equal(isModelCatalogStale(catalog([], staleAt)), true);
  assert.equal(isModelCatalogStale(catalog([], new Date().toISOString())), false);

  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-model-sync-"));
  await writeFile(path.join(workdir, ".marker"), "fixture", "utf8");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.join(workdir, ".ogs"), { recursive: true }));
  const selection = { configVersion: "2", defaults: { backend: "opencode", modelId: "provider/pinned" } };
  await writeFile(path.join(workdir, ".ogs", "model-selection.json"), JSON.stringify(selection), "utf8");
  await syncProjectModels({
    workdir,
    commandRunner: async () => ({
      stdout: `provider/new\n${JSON.stringify({ capabilities: { toolcall: true, input: { text: true }, output: { text: true } }, status: "active" })}`,
      exitCode: 0
    })
  });
  const loadedSelection = await loadModelSelection(path.join(workdir, ".ogs", "model-selection.json"));
  assert.equal(loadedSelection.defaults.modelId, selection.defaults.modelId);
});

test("per-role model selection overrides the project default", () => {
  const result = resolveModelSelectionForSystem({
    system: system(["defaulted", "mapped"]),
    selection: {
      configVersion: "2",
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

test("fresh discovery fails closed for unavailable and incapable pinned models", () => {
  assert.throws(
    () => resolveModelSelectionForSystem({
      system: system(["writer"]),
      selection: { configVersion: "2", roles: { writer: { backend: "opencode", modelId: "provider/missing" } } },
      catalog: catalog([model("provider/other")])
    }),
    (error) => error?.envelope?.errorCode === "MODEL_UNAVAILABLE" && error.envelope.roleId === "writer" && /provider\/missing/.test(error.message)
  );
  assert.throws(
    () => resolveModelSelectionForSystem({
      system: system(["writer"]),
      selection: { configVersion: "2", roles: { writer: { backend: "opencode", modelId: "provider/textless" } } },
      catalog: catalog([model("provider/textless", { textInput: true, textOutput: false, toolcall: true })])
    }),
    (error) => error?.envelope?.errorCode === "MODEL_CAPABILITY_MISMATCH" && error.envelope.roleId === "writer" && /textOutput/.test(error.message)
  );
});

test("system.mmd model bindings are rejected and selection is the only model source", () => {
  assert.throws(() => resolveModelSelectionForSystem({
    system: system(["writer"], { writer: "provider/offline" }),
    selection: { configVersion: "2", roles: { writer: { backend: "opencode", modelId: "provider/offline" } } }
  }), (error) => error?.envelope?.errorCode === "MODEL_BINDING_UNRESOLVED" && /model-selection/.test(error.message));
  assert.throws(() => resolveModelSelectionForSystem({
    system: system(["writer"]),
    selection: { configVersion: "1", defaults: { model: "provider/old" } }
  }), /unsupported version/);
});

test("roles without a configured backend and model remain unbound for law-level noop validation", () => {
  const result = resolveModelSelectionForSystem({
    system: system(["writer"])
  });

  assert.equal(result.resolvedByRoleId.has("writer"), false);
  assert.deepEqual(result.warnings, []);
});
