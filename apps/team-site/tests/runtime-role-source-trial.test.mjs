import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
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
