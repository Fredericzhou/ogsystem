import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { mergeModelCatalogWithLiveSnapshot } from "../../../dist/runtime/model-catalog.js";
import { resolveModelSelectionForSystem, withDefaultModelSelection } from "../../../dist/runtime/model-selection.js";
import { convertMarkdownRole } from "../../../tools/agent-source/markdown-role-adapter.mjs";
import { createRuntimeRoleSourceTrial } from "../infrastructure/runtime-role-source-trial.mjs";

const converted = convertMarkdownRole({
  sourceText: "---\nname: Trial role\n---\nDo the requested task.",
  sourceId: "agency-agents",
  gitUrl: "https://github.com/msitarzewski/agency-agents.git",
  commit: "a".repeat(40),
  sourcePath: "engineering/trial.md",
  adapterId: "agency-agents-markdown",
  adapterVersion: "1",
  roleId: "trial-role",
  outputEvents: ["ROLE_TRIAL_COMPLETE"],
  allowedTools: [],
  identityConfirmed: true
});

test("role trial runs a validated single-role package in an isolated sandbox", async () => {
  let captured;
  const trial = createRuntimeRoleSourceTrial({
    getDefaultModelSelection: async () => ({
      modelSelectionDefaults: { backend: "openai", modelId: "test-model" },
      modelCatalogModels: [{ backend: "openai", modelId: "test-model", runnable: true }]
    }),
    run: async (args) => {
      captured = args;
      const role = JSON.parse(await readFile(`${args.workdir}/team-roles/roles/trial-role/role.json`, "utf8"));
      const source = JSON.parse(await readFile(`${args.workdir}/team-roles/roles/trial-role/source.json`, "utf8"));
      assert.deepEqual(role.outputs.events, ["ROLE_TRIAL_COMPLETE"]);
      assert.deepEqual(role.constraints.allowedTools, []);
      assert.equal(source.commit, "a".repeat(40));
      assert.equal(source.verification.status, "verified");
      assert.deepEqual(source.verification.confirmedEvents, ["ROLE_TRIAL_COMPLETE"]);
      assert.deepEqual(args.systemDefinition.flows, [{ fromRoleId: "trial-role", toRoleId: "__system_end__", eventType: "ROLE_TRIAL_COMPLETE" }]);
      assert.equal(args.systemDefinition.startFlows[0].toRoleId, "trial-role");
      assert.equal(args.systemDefinition.systemId, "role.trial");
      assert.equal(await access(args.systemPath).then(() => true, () => false), false, "role trials must not generate Mermaid source");
      return { status: "completed", finalOutputsByRoleId: { "trial-role": { event: "ROLE_TRIAL_COMPLETE", content: "Done", data: { ok: true } } } };
    }
  });
  const result = await trial({ converted, task: "Summarize", input: { request: "hello" }, userPreferences: "Concise" });
  assert.equal(captured.runKind, "studio_simulation");
  assert.equal(captured.executionMode, "sandbox");
  assert.deepEqual(result.output, { event: "ROLE_TRIAL_COMPLETE", content: "Done", data: { ok: true } });
  assert.equal(result.status, "completed");
});

test("role trial fails closed when the platform has no runnable default model", async () => {
  const trial = createRuntimeRoleSourceTrial({ getDefaultModelSelection: async () => undefined, run: async () => assert.fail("Runtime must not run without a configured model") });
  await assert.rejects(trial({ converted, task: "Summarize", input: {} }), { message: "ROLE_TRIAL_MODEL_UNAVAILABLE" });
});

test("role trial fails closed when role source verification is unverified", async () => {
  const trial = createRuntimeRoleSourceTrial({
    getDefaultModelSelection: async () => ({
      modelSelectionDefaults: { backend: "openai", modelId: "test-model" },
      modelCatalogModels: [{ backend: "openai", modelId: "test-model", runnable: true }]
    }),
    run: async () => assert.fail("Runtime must not execute unverified role source")
  });
  const unverified = { ...converted, verification: { status: "unverified" } };
  await assert.rejects(trial({ converted: unverified, task: "Summarize", input: {} }), { message: "ROLE_TRIAL_SOURCE_UNVERIFIED" });
});

test("role trial fails closed when role source verification is missing or malformed", async () => {
  const trial = createRuntimeRoleSourceTrial({
    getDefaultModelSelection: async () => ({
      modelSelectionDefaults: { backend: "openai", modelId: "test-model" },
      modelCatalogModels: [{ backend: "openai", modelId: "test-model", runnable: true }]
    }),
    run: async () => assert.fail("Runtime must not execute role source missing verification")
  });
  const missing = { ...converted, verification: undefined };
  await assert.rejects(trial({ converted: missing, task: "Summarize", input: {} }), { message: "ROLE_TRIAL_SOURCE_UNVERIFIED" });

  const nullVerification = { ...converted, verification: null };
  await assert.rejects(trial({ converted: nullVerification, task: "Summarize", input: {} }), { message: "ROLE_TRIAL_SOURCE_UNVERIFIED" });
});

test("role trial fails closed when role source verification status is rejected or invalid", async () => {
  const trial = createRuntimeRoleSourceTrial({
    getDefaultModelSelection: async () => ({
      modelSelectionDefaults: { backend: "openai", modelId: "test-model" },
      modelCatalogModels: [{ backend: "openai", modelId: "test-model", runnable: true }]
    }),
    run: async () => assert.fail("Runtime must not execute rejected role source")
  });
  const rejected = { ...converted, verification: { status: "rejected" } };
  await assert.rejects(trial({ converted: rejected, task: "Summarize", input: {} }), { message: "ROLE_TRIAL_SOURCE_UNVERIFIED" });

  const invalid = { ...converted, verification: { status: "invalid" } };
  await assert.rejects(trial({ converted: invalid, task: "Summarize", input: {} }), { message: "ROLE_TRIAL_SOURCE_UNVERIFIED" });
});

test("role trial fails closed when configured platform model is unverified", async () => {
  const trial = createRuntimeRoleSourceTrial({
    getDefaultModelSelection: async () => ({
      unverifiedConfiguredModel: { backend: "kimi", modelId: "kimi-k1.5" },
      modelCatalogModels: []
    }),
    run: async () => assert.fail("Runtime must not execute with unverified model")
  });
  await assert.rejects(trial({ converted, task: "Summarize", input: {} }), { message: "ROLE_TRIAL_MODEL_UNVERIFIED" });
});

test("verified platform default model selection integrates cleanly with the real runtime model resolver", () => {
  const trialSystem = {
    systemId: "role.trial",
    systemVersion: "1.0.0",
    entryRoleIds: ["trial-role"],
    roleIds: ["trial-role"],
    flows: [{ fromRoleId: "trial-role", toRoleId: "__system_end__", eventType: "ROLE_TRIAL_COMPLETE" }],
    lawBinding: { globalLawRef: "law.role-trial" },
    executionBinding: {},
    modelBinding: {}
  };

  // 1. Negative check: if unverified candidate (runnable: false) was passed to runtime, it fails with MODEL_UNAVAILABLE
  const unverifiedCatalog = mergeModelCatalogWithLiveSnapshot(undefined, [{
    backend: "kimi",
    modelId: "kimi-k1.5",
    name: "Kimi K1.5",
    status: "unverified",
    runnable: false,
    capabilities: { textInput: true, textOutput: true, toolcall: true },
    variants: []
  }]);
  const unverifiedSelection = withDefaultModelSelection(undefined, { backend: "kimi", modelId: "kimi-k1.5" });
  assert.throws(
    () => resolveModelSelectionForSystem({ system: trialSystem, selection: unverifiedSelection, catalog: unverifiedCatalog }),
    (error) => error?.envelope?.errorCode === "MODEL_UNAVAILABLE" && /absent from the current model catalog/.test(error.message)
  );

  // 2. Positive check: after probe promotes model to runnable: true, runtime resolves cleanly with zero warnings
  const verifiedCatalog = mergeModelCatalogWithLiveSnapshot(undefined, [{
    backend: "kimi",
    modelId: "kimi-k1.5",
    name: "Kimi K1.5",
    status: "verified",
    runnable: true,
    capabilities: { textInput: true, textOutput: true, toolcall: true },
    variants: []
  }]);
  const verifiedSelection = withDefaultModelSelection(undefined, { backend: "kimi", modelId: "kimi-k1.5" });
  const result = resolveModelSelectionForSystem({ system: trialSystem, selection: verifiedSelection, catalog: verifiedCatalog });
  assert.equal(result.resolvedByRoleId.get("trial-role")?.backend, "kimi");
  assert.equal(result.resolvedByRoleId.get("trial-role")?.modelId, "kimi-k1.5");
  assert.deepEqual(result.warnings, []);
});
