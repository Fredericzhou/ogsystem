import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeProjectRunExecutor } from "../infrastructure/runtime-project-run-executor.mjs";

test("flow previews do not wait for platform model discovery", async () => {
  const calls = [];
  let modelDiscoveryCalls = 0;
  const executor = createRuntimeProjectRunExecutor({
    execute: async (args) => { calls.push(args); return { state: { status: "completed" } }; },
    getDefaultModelSelection: async () => {
      modelDiscoveryCalls += 1;
      return { modelSelectionDefaults: { backend: "test", modelId: "model-1" } };
    }
  });
  const project = { workdir: "project-workdir", assetWorkdir: "team-workdir" };

  await executor.execute(project, { prompt: "preview", mode: "dry-run", runId: "run-1", runKind: "project_task" });

  assert.equal(modelDiscoveryCalls, 0);
  assert.equal(calls[0].dryRun, true);
  assert.equal(calls[0].modelSelectionDefaults, undefined);
  assert.equal(calls[0].assetSource, "team-workdir");
  assert.equal(calls[0].workdir, "project-workdir");
  assert.equal(calls[0].runEvidenceRoot, "project-workdir");
});

test("isolated runs still resolve the configured model selection", async () => {
  let modelDiscoveryCalls = 0;
  const executor = createRuntimeProjectRunExecutor({
    execute: async (args) => args,
    getDefaultModelSelection: async () => {
      modelDiscoveryCalls += 1;
      return { modelSelectionDefaults: { backend: "test", modelId: "model-1" } };
    }
  });

  const result = await executor.execute({ workdir: "project-workdir" }, {
    prompt: "sandbox",
    mode: "sandbox",
    runId: "run-2"
  });

  assert.equal(modelDiscoveryCalls, 1);
  assert.deepEqual(result.modelSelectionDefaults, { backend: "test", modelId: "model-1" });
});
