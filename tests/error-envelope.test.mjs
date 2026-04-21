import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp } from "node:fs/promises";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";
import { createExecutionPlan } from "../dist/runtime/execution-plan.js";
import { runSystemWithGraphRunner } from "../dist/runtime/graph-runner.js";
import { loadSystemFromMermaid } from "../dist/runtime/parse-mermaid.js";
import { initializeRunContext } from "../dist/runtime/run-artifacts.js";
import { RuntimeError } from "../dist/runtime/runtime-errors.js";
import { validateRuntimeConfig } from "../dist/runtime/config.js";

test("runtime failures surface stable error envelopes in result and audit", async () => {
  const result = await runSystemWithAdapter({
    systemPath: path.resolve("tests/fixtures/mermaid/law-system.mmd"),
    profilesPath: path.resolve("tests/fixtures/profiles/branch-profiles.json"),
    toolsPath: path.resolve("tests/fixtures/tools/branch-tools.json"),
    lawsPath: path.resolve("tests/fixtures/laws/law-forbid.json"),
    prompt: "forbidden tool",
    workdir: process.cwd()
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errorEnvelope?.errorCode, "ROLE_EXECUTION_FAILED");
  assert.equal(result.errorEnvelope?.errorCategory, "execution");
  assert.equal(result.errorEnvelope?.stage, "execute");
  assert.equal(result.errorEnvelope?.retryable, false);
  assert.equal(result.auditTrail[0]?.errorEnvelope?.errorCode, "ROLE_EXECUTION_FAILED");
  assert.equal(result.runSummary.failureCountsByErrorCode.ROLE_EXECUTION_FAILED, 1);
});

test("graph state persistence failures stay classified as execute/io", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-error-envelope-"));
  const systemPath = path.resolve("tests/fixtures/mermaid/law-system.mmd");
  const system = await loadSystemFromMermaid(systemPath);
  const plan = createExecutionPlan(system);
  const runtimeConfig = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      runsDir: ".ogs/runs"
    },
    "runtime.json"
  );
  const runContext = await initializeRunContext({
    system,
    systemPath,
    prompt: "persist failure",
    workdir,
    runtimeConfig
  });
  await mkdir(runContext.statePath, { recursive: true });

  await assert.rejects(
    () =>
      runSystemWithGraphRunner({
        plan,
        effectiveLaw: {
          forbiddenToolRefs: [],
          allowNoopWithoutExecutionBinding: false
        },
        profilesById: new Map(),
        toolsByRef: new Map(),
        modelsById: new Map(),
        workdir,
        rolePackagesByRoleId: new Map(),
        runContext,
        executor: {
          async start() {},
          async execute() {
            throw new Error("execute should not run when initial state persistence fails");
          },
          async abortSession() {},
          getServerMetadata() {
            return {};
          },
          async close() {}
        },
        prompt: "persist failure",
        errorFlowRoutingEnabled: false,
        logRun: false
      }),
    (error) => {
      assert.ok(error instanceof RuntimeError);
      assert.equal(error.envelope.errorCode, "RUNTIME_STATE_PERSIST_FAILED");
      assert.equal(error.envelope.errorCategory, "io");
      assert.equal(error.envelope.stage, "execute");
      assert.notEqual(error.envelope.errorCode, "RUNTIME_SETUP_FAILED");
      return true;
    }
  );
});
