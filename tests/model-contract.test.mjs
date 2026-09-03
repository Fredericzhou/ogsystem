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
    catalogVersion: "1",
    generatedAt,
    source: { command: "opencode models --verbose" },
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
  const selection = { configVersion: "1", defaults: { model: "provider/pinned" } };
  await writeFile(path.join(workdir, ".ogs", "model-selection.json"), JSON.stringify(selection), "utf8");
  await syncProjectModels({
    workdir,
    commandRunner: async () => ({
      stdout: `provider/new\n${JSON.stringify({ capabilities: { toolcall: true, input: { text: true }, output: { text: true } }, status: "active" })}`,
      exitCode: 0
    })
  });
  const loadedSelection = await loadModelSelection(path.join(workdir, ".ogs", "model-selection.json"));
  assert.equal(loadedSelection.defaults.model, selection.defaults.model);
});

test("direct model.bind wins over project, system, and role selection layers", () => {
  const result = resolveModelSelectionForSystem({
    system: system(["direct", "mapped"], { direct: "provider/direct" }),
    selection: {
      configVersion: "1",
      defaults: { model: "provider/project" },
      roles: { mapped: { model: "provider/role" }, label: { model: "provider/wrong" } },
      systems: {
        "model.contract": {
          defaults: { model: "provider/system" },
          roles: { mapped: { model: "provider/system-role" } }
        }
      }
    },
    catalog: catalog([model("provider/direct"), model("provider/system-role")])
  });

  assert.equal(result.resolvedByRoleId.get("direct").modelRef, "provider/direct");
  assert.equal(result.resolvedByRoleId.get("direct").bindingSource, "system");
  assert.equal(result.resolvedByRoleId.get("mapped").modelRef, "provider/system-role");
  assert.equal(result.resolvedByRoleId.has("label"), false);
});

test("fresh discovery fails closed for unavailable and incapable pinned models", () => {
  assert.throws(
    () => resolveModelSelectionForSystem({
      system: system(["writer"], { writer: "provider/missing" }),
      catalog: catalog([model("provider/other")])
    }),
    (error) => error?.envelope?.errorCode === "MODEL_UNAVAILABLE" && error.envelope.roleId === "writer" && /provider\/missing/.test(error.message)
  );
  assert.throws(
    () => resolveModelSelectionForSystem({
      system: system(["writer"], { writer: "provider/textless" }),
      catalog: catalog([model("provider/textless", { textInput: true, textOutput: false, toolcall: true })])
    }),
    (error) => error?.envelope?.errorCode === "MODEL_CAPABILITY_MISMATCH" && error.envelope.roleId === "writer" && /textOutput/.test(error.message)
  );
});

test("a missing or stale catalog preserves a valid pinned offline selection", () => {
  const pinned = resolveModelSelectionForSystem({
    system: system(["writer"], { writer: "provider/offline" }),
    catalog: undefined
  });
  assert.equal(pinned.resolvedByRoleId.get("writer").modelRef, "provider/offline");
  assert.ok(pinned.warnings.some((warning) => /availability was not discovered/.test(warning)));

  const stale = resolveModelSelectionForSystem({
    system: system(["writer"], { writer: "provider/offline" }),
    catalog: catalog([model("provider/other")], new Date(Date.now() - MODEL_CATALOG_STALE_AFTER_MS - 1).toISOString())
  });
  assert.equal(stale.resolvedByRoleId.get("writer").modelRef, "provider/offline");
  assert.ok(stale.warnings.some((warning) => /stale/.test(warning)));
});

test("non-direct model binding fails with a role-specific mapping diagnostic", () => {
  assert.throws(
    () => resolveModelSelectionForSystem({
      system: system(["writer"], { writer: "role.writer" })
    }),
    (error) => error?.envelope?.errorCode === "MODEL_SELECTION_NOT_FOUND" && error.message.includes("writer")
  );
});
