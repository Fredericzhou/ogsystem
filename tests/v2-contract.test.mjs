import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertV2ContractRoot,
  findLegacyV1Paths
} from "../dist/runtime/contract-v2.js";
import { assertNoLegacyV1ExecutionAssets, loadV2ContractFile } from "../dist/runtime/contract-v2-loader.js";
import { snapshotProjectAssets } from "../dist/runtime/project-run-snapshot.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import { runSystemWithAdapter } from "../dist/runtime/adapter.js";
import { prepareRuntimeSetup } from "../dist/runtime/runtime-setup.js";
import { selectRoutingTargets } from "../dist/runtime/graph-mode-registry.js";

test("v2 contract roots require the explicit marker", () => {
  assert.doesNotThrow(() => assertV2ContractRoot({ ogsContractVersion: 2, schemaVersion: 1 }));
  assert.throws(
    () => assertV2ContractRoot({ contractVersion: 1, schemaVersion: 1 }),
    /ogsContractVersion must be 2/
  );
});

test("legacy v1 execution fields are discovered and rejected", () => {
  const value = {
    ogsContractVersion: 2,
    schemaVersion: 1,
    constraints: { allowedTools: ["workspace.run"] },
    execution: { mode: "noop" }
  };
  assert.deepEqual(findLegacyV1Paths(value), ["$.constraints", "$.constraints.allowedTools"]);
  assert.throws(() => assertV2ContractRoot(value), /legacy v1 fields/);
});

test("v2 never routes a noop execution state", () => {
  assert.throws(
    () => selectRoutingTargets({
      node: { roleId: "worker", outgoing: [{ toRoleId: "review", eventType: "READY" }] },
      mode: "noop"
    }),
    /V2_NOOP_ROUTING_UNSUPPORTED/
  );
});

test("v2 contract loader does not read unversioned or v1 files", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-v2-contract-"));
  const path = join(root, "legacy.json");
  await writeFile(path, JSON.stringify({ contractVersion: 1, schemaVersion: 1 }));
  await assert.rejects(loadV2ContractFile(path), /ogsContractVersion must be 2/);
});

test("v2 Human Review schema uses one action contract with CAS scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-v2-review-contract-"));
  const valid = join(root, "review.json");
  await writeFile(valid, JSON.stringify({
    ogsContractVersion: 2,
    schemaVersion: 1,
    reviewId: "review.branch-1.r1",
    runId: "run-1",
    round: 1,
    lineageId: "lineage-1",
    branchId: "branch-1",
    loopIteration: 0,
    stateVersion: 4,
    trigger: "exception",
    exceptionContext: { code: "loop_exhausted" },
    status: "resolved",
    decision: {
      action: "retry",
      actor: "operator",
      decidedAt: "2026-11-16T00:00:00.000Z",
      round: 1,
      lineageId: "lineage-1",
      branchId: "branch-1",
      loopIteration: 0,
      stateVersion: 4,
      targetRoleId: "worker"
    }
  }), "utf8");
  await assert.doesNotReject(loadV2ContractFile(valid));

  const invalid = join(root, "invalid-review.json");
  await writeFile(invalid, JSON.stringify({
    ogsContractVersion: 2,
    schemaVersion: 1,
    reviewId: "review.branch-1.r1",
    runId: "run-1",
    round: 1,
    lineageId: "lineage-1",
    branchId: "branch-1",
    loopIteration: 0,
    stateVersion: 4,
    trigger: "exception",
    status: "resolved",
    decision: {
      action: "retry",
      actor: "operator",
      decidedAt: "2026-11-16T00:00:00.000Z",
      round: 1,
      lineageId: "lineage-1",
      branchId: "branch-1",
      loopIteration: 0
    }
  }), "utf8");
  await assert.rejects(loadV2ContractFile(invalid), /stateVersion/);

  const explicit = join(root, "explicit-review.json");
  await writeFile(explicit, JSON.stringify({
    ogsContractVersion: 2,
    schemaVersion: 1,
    reviewId: "review.branch-1.r2",
    runId: "run-1",
    round: 2,
    lineageId: "lineage-1",
    branchId: "branch-1",
    loopIteration: 0,
    stateVersion: 5,
    trigger: "explicit",
    status: "resolved",
    decision: {
      action: "approve",
      actor: "operator",
      decidedAt: "2026-11-16T00:00:00.000Z",
      round: 2,
      lineageId: "lineage-1",
      branchId: "branch-1",
      loopIteration: 0,
      stateVersion: 5
    }
  }), "utf8");
  await assert.doesNotReject(loadV2ContractFile(explicit));

  const explicitExceptionAction = join(root, "explicit-exception-action.json");
  await writeFile(explicitExceptionAction, JSON.stringify({
    ogsContractVersion: 2,
    schemaVersion: 1,
    reviewId: "review.branch-1.r3",
    runId: "run-1",
    round: 3,
    lineageId: "lineage-1",
    branchId: "branch-1",
    loopIteration: 0,
    stateVersion: 6,
    trigger: "explicit",
    status: "resolved",
    decision: {
      action: "retry",
      actor: "operator",
      decidedAt: "2026-11-16T00:00:00.000Z",
      round: 3,
      lineageId: "lineage-1",
      branchId: "branch-1",
      loopIteration: 0,
      stateVersion: 6
    }
  }), "utf8");
  await assert.rejects(loadV2ContractFile(explicitExceptionAction), /must be equal to one of the allowed values/);

  const paused = join(root, "paused-review.json");
  await writeFile(paused, JSON.stringify({
    ogsContractVersion: 2,
    schemaVersion: 1,
    reviewId: "review.branch-1.r4",
    runId: "run-1",
    round: 4,
    lineageId: "lineage-1",
    branchId: "branch-1",
    loopIteration: 0,
    stateVersion: 7,
    trigger: "exception",
    exceptionContext: { code: "timeout" },
    status: "resolved",
    decision: {
      action: "pause",
      actor: "ogs-runtime-timeout",
      decidedAt: "2026-11-16T00:00:00.000Z",
      round: 4,
      lineageId: "lineage-1",
      branchId: "branch-1",
      loopIteration: 0,
      stateVersion: 7
    }
  }), "utf8");
  await assert.rejects(loadV2ContractFile(paused), /must be equal to one of the allowed values/);
});

test("v2 execution bindings reject legacy profiles and tools assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-v2-legacy-assets-"));
  await writeFile(join(root, "profiles.json"), "[]", "utf8");
  await assert.rejects(
    assertNoLegacyV1ExecutionAssets(root),
    /V2_LEGACY_EXECUTION_ASSET.*profiles\.json/
  );
});

test("v2 execution bindings reject the historical .ogs model-selection asset", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-v2-legacy-model-selection-"));
  await mkdir(join(root, ".ogs"), { recursive: true });
  await writeFile(join(root, ".ogs", "model-selection.json"), JSON.stringify({ configVersion: "3", roles: {} }), "utf8");
  await assert.rejects(
    assertNoLegacyV1ExecutionAssets(root),
    /V2_LEGACY_EXECUTION_ASSET.*model-selection\.json/
  );
});

test("v2 Mermaid input rejects legacy model.bind metadata", () => {
  assert.throws(
    () => parseSystemFromMermaidSource([
      "flowchart TD",
      "%% system.id=v2.legacy-binding",
      "%% system.version=2.0.0",
      "%% law.global=law.v2.test",
      "%% model.bind.worker=codex/gpt-6-luna",
      "start[开始] -->|START| worker[Role:worker]",
      "worker[Role:worker] -->|DONE| end[结束]"
    ].join("\n")),
    /MERMAID_LEGACY_MODEL_BINDING|v1 execution binding/
  );
});

test("v2 project snapshots retain execution bindings for recovery", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-v2-snapshot-source-"));
  const runDir = await mkdtemp(join(tmpdir(), "ogs-v2-snapshot-run-"));
  await mkdir(join(workdir, ".ogs"), { recursive: true });
  await mkdir(join(workdir, "og-roles", "roles"), { recursive: true });
  await writeFile(join(workdir, "system.mmd"), "flowchart TD\nA --> B\n", "utf8");
  await writeFile(join(workdir, ".ogs", "runtime.json"), JSON.stringify({ roleRepo: "./og-roles" }), "utf8");
  await writeFile(join(workdir, ".ogs", "execution-bindings.json"), JSON.stringify({
    ogsContractVersion: 2,
    schemaVersion: 1,
    harnessTemplates: {},
    roles: {}
  }), "utf8");
  const snapshot = await snapshotProjectAssets({
    sourceWorkdir: workdir,
    runDir,
    runtimeConfig: { roleRepo: "./og-roles", runsDir: ".ogs/runs" }
  });
  assert.match(await readFile(join(snapshot, ".ogs", "execution-bindings.json"), "utf8"), /ogsContractVersion/);
});

test("resume reuses the frozen Harness plan when the current binding is removed", async () => {
  const repoRoot = process.cwd();
  const workdir = await mkdtemp(join(tmpdir(), "ogs-v2-resume-frozen-binding-"));
  await mkdir(join(workdir, ".ogs"), { recursive: true });
  await symlink(join(repoRoot, "og-roles"), join(workdir, "og-roles"), "dir");
  for (const name of ["runtime.json", "execution-bindings.json", "model-catalog.json", "user-profile.json", "laws.json"]) {
    await symlink(join(repoRoot, ".ogs", name), join(workdir, ".ogs", name));
  }
  const systemPath = join(repoRoot, "examples/target-model-binding-system.mmd");
  await runSystemWithAdapter({ systemPath, prompt: "freeze binding", workdir, dryRun: true });
  const runId = (await readdir(join(workdir, ".ogs", "runs")))[0];
  assert.ok(runId);
  await unlink(join(workdir, ".ogs", "execution-bindings.json"));
  await unlink(join(workdir, ".ogs", "model-catalog.json"));
  const resumed = await prepareRuntimeSetup({
    systemPath,
    prompt: "freeze binding",
    workdir,
    resumeRunDir: runId,
    dryRun: true
  });
  const node = resumed.plan.nodesByRoleId.get("debate-minimalist");
  assert.equal(node?.binding.kind, "model");
  assert.deepEqual(node?.effectiveTools, []);
  const frozenConfig = JSON.parse(await readFile(join(workdir, ".ogs", "runs", runId, "resolved-config.json"), "utf8"));
  const frozenPlan = frozenConfig.effective.resolvedExecutionPlans["debate-minimalist"];
  assert.equal(node?.policyDigest, frozenPlan.policyDigest);
  assert.equal(Object.hasOwn(frozenPlan, "effectiveTools"), false, "resolved config must persist allowedTools + verifiedTools only");
});
