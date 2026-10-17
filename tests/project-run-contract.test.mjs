import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createExecutionPlan } from "../dist/runtime/execution-plan.js";
import {
  initializeProjectRunArtifacts,
  loadProjectRunPlan
} from "../dist/runtime/project-run.js";
import { validateResumePlanFingerprint } from "../dist/runtime/run-artifacts.js";
import {
  applyRunControl,
  createProjectRunState,
  projectRunStateFromResult
} from "../dist/runtime/project-run-state.js";
import { updateProjectRunState, saveProjectRunState, loadProjectRunState } from "../dist/runtime/project-run-state.js";
import { evaluateProjectRunPlan, evaluateProjectRunResult } from "../dist/runtime/project-quality.js";
import { getSideEffectByKey, loadSideEffects, recordSideEffect } from "../dist/runtime/side-effect-store.js";
import { assertProjectAssetSnapshot, readProjectAssetManifestDigest, snapshotProjectAssets } from "../dist/runtime/project-run-snapshot.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";

function fingerprint(digest = "fp-1") {
  return {
    version: 7,
    algorithm: "sha256",
    digest,
    payload: {
      components: {
        system: { digest: "system-1", value: {} },
        design: { digest: "design-1", value: {} },
        effectiveLaw: { digest: "law-1", value: { maxTransitions: 8 } }
      }
    }
  };
}

function plan() {
  return createExecutionPlan(parseSystemFromMermaidSource(`flowchart TD
%% system.id=project.run.contract
%% system.version=1.0.0
%% law.global=law.test
%% entry.role=writer
input -->|START| writer[Role:writer]
writer[Role:writer] -->|DONE| output
`));
}

test("resume accepts legacy fingerprints when every stored component is unchanged", async () => {
  const workdir = await mkdtemp(resolve(tmpdir(), "ogs-legacy-fingerprint-"));
  try {
    const runDir = resolve(workdir, ".ogs", "runs", "run-legacy");
    await mkdir(runDir, { recursive: true });
    const expected = fingerprint("current-digest");
    const stored = {
      ...expected,
      version: expected.version - 1,
      digest: "legacy-digest",
      payload: {
        components: {
          system: expected.payload.components.system,
          design: expected.payload.components.design,
          effectiveLaw: expected.payload.components.effectiveLaw
        }
      }
    };
    await writeFile(resolve(runDir, "plan-fingerprint.json"), JSON.stringify(stored), "utf8");
    await assert.doesNotReject(() => validateResumePlanFingerprint({ runDir, expectedFingerprint: expected }));

    await writeFile(resolve(runDir, "plan-fingerprint.json"), JSON.stringify({
      ...stored,
      payload: { components: { ...stored.payload.components, design: { digest: "changed-design", value: {} } } }
    }), "utf8");
    await assert.rejects(
      () => validateResumePlanFingerprint({ runDir, expectedFingerprint: expected }),
      /Resume plan fingerprint mismatch/
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("project run resume accepts a legacy fingerprint through artifact initialization", async () => {
  const workdir = await mkdtemp(resolve(tmpdir(), "ogs-legacy-project-resume-"));
  try {
    const runDir = resolve(workdir, ".ogs", "runs", "run-legacy-project");
    const expected = fingerprint("current-digest");
    const storedFingerprint = {
      ...expected,
      version: expected.version - 1,
      digest: "legacy-digest",
      payload: {
        components: {
          system: expected.payload.components.system,
          design: expected.payload.components.design,
          effectiveLaw: expected.payload.components.effectiveLaw
        }
      }
    };
    const created = await initializeProjectRunArtifacts({
      workdir,
      runDir,
      projectId: "project-legacy",
      prompt: "resume a legacy project run",
      plan: plan(),
      fingerprint: storedFingerprint,
      mode: "dry-run",
      projectDigest: "project-digest"
    });
    await writeFile(resolve(runDir, "plan-fingerprint.json"), JSON.stringify(storedFingerprint), "utf8");
    const resumed = await initializeProjectRunArtifacts({
      workdir,
      runDir,
      projectId: "project-legacy",
      prompt: "resume a legacy project run",
      plan: plan(),
      fingerprint: expected,
      mode: "dry-run",
      projectDigest: "project-digest"
    });
    assert.equal(resumed.runPlan.fingerprintDigest, storedFingerprint.digest);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("project run artifacts freeze the run plan and material content", async () => {
  const workdir = await mkdtemp(resolve(tmpdir(), "ogs-project-run-contract-"));
  try {
    const materialPath = resolve(workdir, "brief.md");
    await writeFile(materialPath, "initial material\n", "utf8");
    const runDir = resolve(workdir, ".ogs", "runs", "run-001");
    const created = await initializeProjectRunArtifacts({
      workdir,
      runDir,
      prompt: "write a brief",
      plan: plan(),
      fingerprint: fingerprint(),
      mode: "sandbox",
      materials: [{ materialId: "brief", sourcePath: materialPath, contentType: "text/markdown" }]
    });

    await writeFile(materialPath, "changed material\n", "utf8");
    const resumed = await initializeProjectRunArtifacts({
      workdir,
      runDir,
      prompt: "write a brief",
      plan: plan(),
      fingerprint: fingerprint(),
      mode: "sandbox",
      materials: [{ materialId: "brief", sourcePath: materialPath, contentType: "text/markdown" }]
    });

    assert.equal(resumed.runPlan.fingerprintDigest, created.runPlan.fingerprintDigest);
    assert.equal(resumed.materials[0].contentHash, created.materials[0].contentHash);
    assert.equal(
      await readFile(resolve(runDir, resumed.materials[0].snapshotPath), "utf8"),
      "initial material\n"
    );
    assert.equal((await loadProjectRunPlan(runDir)).executionPolicy.singleWorker, true);
    assert.equal((await readFile(resolve(runDir, "task.json"), "utf8")).includes("write a brief"), true);
    await writeFile(resolve(runDir, resumed.materials[0].snapshotPath), "tampered\n", "utf8");
    await assert.rejects(
      () => initializeProjectRunArtifacts({
        workdir,
        runDir,
        prompt: "write a brief",
        plan: plan(),
        fingerprint: fingerprint(),
        mode: "sandbox",
        materials: [{ materialId: "brief", sourcePath: materialPath, contentType: "text/markdown" }]
      }),
      /RUN_SNAPSHOT_INVALID/
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("side effect ledger preserves unknown state and blocks idempotency conflicts", async () => {
  const workdir = await mkdtemp(resolve(tmpdir(), "ogs-side-effect-contract-"));
  try {
    const runDir = resolve(workdir, ".ogs", "runs", "run-001");
    await recordSideEffect(runDir, {
      operationId: "op-1",
      idempotencyKey: "run-001:node-1:write-1",
      approvalId: null,
      status: "unknown"
    });
    assert.equal((await getSideEffectByKey(runDir, "run-001:node-1:write-1")).status, "unknown");
    await assert.rejects(
      () => recordSideEffect(runDir, {
        operationId: "op-2",
        idempotencyKey: "run-001:node-1:write-1",
        status: "requested"
      }),
      /SIDE_EFFECT_IDEMPOTENCY_CONFLICT/
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("side effect ledger keeps completed results and blocks uncertain terminal states", async () => {
  const workdir = await mkdtemp(resolve(tmpdir(), "ogs-side-effect-terminal-"));
  try {
    const runDir = resolve(workdir, ".ogs", "runs", "run-001");
    const completed = {
      operationId: "op-1",
      idempotencyKey: "run-001:node-1:write-1",
      approvalId: null,
      status: "completed",
      result: { exitCode: 0, stdout: "done", stderr: "", args: [] }
    };
    assert.deepEqual(await recordSideEffect(runDir, completed), completed);
    assert.deepEqual(
      await recordSideEffect(runDir, { ...completed, status: "requested", result: undefined }),
      completed
    );
    await recordSideEffect(runDir, {
      ...completed,
      operationId: "op-2",
      idempotencyKey: "run-001:node-1:write-2",
      status: "unknown",
      result: undefined
    });
    await assert.rejects(
      () => recordSideEffect(runDir, {
        ...completed,
        operationId: "op-2",
        idempotencyKey: "run-001:node-1:write-2",
        status: "requested",
        result: undefined
      }),
      /SIDE_EFFECT_TERMINAL_UNCERTAIN/
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("corrupt side-effect ledgers fail closed instead of becoming empty", async () => {
  const workdir = await mkdtemp(resolve(tmpdir(), "ogs-side-effect-corrupt-"));
  try {
    await mkdir(resolve(workdir, "control"), { recursive: true });
    await writeFile(resolve(workdir, "control", "side-effects.json"), "not-json", "utf8");
    await assert.rejects(() => loadSideEffects(workdir), /SIDE_EFFECT_LEDGER_CORRUPT/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("side-effect ledger validates every record before recovery", async () => {
  const workdir = await mkdtemp(resolve(tmpdir(), "ogs-side-effect-schema-"));
  try {
    await mkdir(resolve(workdir, "control"), { recursive: true });
    const invalidRecords = [
      { status: "completed" },
      { operationId: "op-1", idempotencyKey: "", status: "requested" },
      { operationId: "op-1", idempotencyKey: "key-1", status: "not-a-status" },
      { operationId: "op-1", idempotencyKey: "key-1", status: "requested", startedAt: 42 },
      { operationId: "op-1", idempotencyKey: "key-1", status: "requested", extra: true }
    ];
    for (const record of invalidRecords) {
      await writeFile(resolve(workdir, "control", "side-effects.json"), JSON.stringify([record]), "utf8");
      await assert.rejects(() => loadSideEffects(workdir), /SIDE_EFFECT_LEDGER_CORRUPT/);
    }
    await writeFile(resolve(workdir, "control", "side-effects.json"), JSON.stringify([
      { operationId: "op-1", idempotencyKey: "key-1", status: "requested" },
      { operationId: "op-2", idempotencyKey: "key-1", status: "failed" }
    ]), "utf8");
    await assert.rejects(() => loadSideEffects(workdir), /SIDE_EFFECT_LEDGER_CORRUPT/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("project run snapshot is complete and immutable", async () => {
  const workdir = await mkdtemp(resolve(tmpdir(), "ogs-project-run-snapshot-"));
  try {
    const runDir = resolve(workdir, ".ogs", "runs", "run-001");
    await mkdir(resolve(workdir, ".ogs", "systems"), { recursive: true });
    await mkdir(resolve(workdir, ".ogs", "subsystems"), { recursive: true });
    await mkdir(resolve(workdir, ".ogs", "contracts"), { recursive: true });
    await mkdir(resolve(workdir, "og-roles", "roles", "writer"), { recursive: true });
    await writeFile(resolve(workdir, "system.mmd"), "flowchart TD\ninput --> writer\n", "utf8");
    await writeFile(resolve(workdir, ".ogs", "runtime.json"), JSON.stringify({ roleRepo: "./og-roles" }), "utf8");
    await writeFile(resolve(workdir, ".ogs", "semantics.yaml"), "version: 1\nsystemId: snapshot\nsystemVersion: 1\n", "utf8");
    await writeFile(resolve(workdir, ".ogs", "models.json"), JSON.stringify({ version: 1, models: [] }), "utf8");
    await writeFile(resolve(workdir, ".ogs", "systems", "nested.mmd"), "%% system.id=nested\n%% system.version=1\n", "utf8");
    await writeFile(resolve(workdir, ".ogs", "subsystems", "child.json"), JSON.stringify({ version: 1 }), "utf8");
    await writeFile(resolve(workdir, ".ogs", "contracts", "handoff.json"), JSON.stringify({ version: 1 }), "utf8");
    await writeFile(resolve(workdir, "og-roles", "roles", "writer", "agent.md"), "original prompt", "utf8");
    const runtimeConfig = { roleRepo: "./og-roles" };
    await snapshotProjectAssets({ sourceWorkdir: workdir, runDir, runtimeConfig });
    const anchoredDigest = await readProjectAssetManifestDigest(runDir);
    await assertProjectAssetSnapshot(runDir, anchoredDigest);
    await writeFile(resolve(workdir, "og-roles", "roles", "writer", "agent.md"), "changed prompt", "utf8");
    await assertProjectAssetSnapshot(runDir, anchoredDigest);
    assert.equal(await readFile(resolve(runDir, "project-assets", "og-roles", "roles", "writer", "agent.md"), "utf8"), "original prompt");

    const manifestPath = resolve(runDir, "project-assets", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const semanticsPath = resolve(runDir, "project-assets", ".ogs", "semantics.yaml");
    const changedSemantics = Buffer.from("changed semantics\n", "utf8");
    await writeFile(semanticsPath, changedSemantics);
    const semanticsEntry = manifest.files.find((file) => file.path === ".ogs/semantics.yaml");
    semanticsEntry.sha256 = createHash("sha256").update(changedSemantics).digest("hex");
    semanticsEntry.size = changedSemantics.byteLength;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    await writeFile(resolve(runDir, "project-assets", ".ogs", "semantics.yaml"), "tampered", "utf8");
    await assert.rejects(() => assertProjectAssetSnapshot(runDir, anchoredDigest), /manifest digest mismatch/);

    await snapshotProjectAssets({ sourceWorkdir: workdir, runDir, runtimeConfig });
    const stableDigest = await readProjectAssetManifestDigest(runDir);
    const reorderedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ files: reorderedManifest.files, algorithm: reorderedManifest.algorithm, version: reorderedManifest.version }, null, 2), "utf8");
    assert.equal(await readProjectAssetManifestDigest(runDir), stableDigest);
    await assertProjectAssetSnapshot(runDir, stableDigest);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("project run plan anchors the executable asset manifest", async () => {
  const workdir = await mkdtemp(resolve(tmpdir(), "ogs-project-run-plan-anchor-"));
  try {
    await mkdir(resolve(workdir, ".ogs"), { recursive: true });
    await writeFile(resolve(workdir, "system.mmd"), "flowchart TD\ninput --> writer\n", "utf8");
    await writeFile(resolve(workdir, ".ogs", "runtime.json"), JSON.stringify({ roleRepo: "./og-roles" }), "utf8");
    const runDir = resolve(workdir, ".ogs", "runs", "run-001");
    await snapshotProjectAssets({ sourceWorkdir: workdir, runDir, runtimeConfig: { roleRepo: "./og-roles" } });
    const created = await initializeProjectRunArtifacts({
      workdir,
      runDir,
      projectId: "project-1",
      prompt: "run",
      plan: plan(),
      fingerprint: fingerprint(),
      mode: "sandbox",
      enforceSnapshotContract: true
    });
    assert.equal(created.runPlan.projectAssetManifestDigest, await readProjectAssetManifestDigest(runDir));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("project run snapshots reject source and restored symbolic links", async () => {
  const sourceWorkdir = await mkdtemp(resolve(tmpdir(), "ogs-project-run-symlink-source-"));
  const externalDir = await mkdtemp(resolve(tmpdir(), "ogs-project-run-symlink-external-"));
  try {
    await mkdir(resolve(sourceWorkdir, ".ogs"), { recursive: true });
    await writeFile(resolve(sourceWorkdir, "system.mmd"), "flowchart TD\ninput --> writer\n", "utf8");
    await writeFile(resolve(externalDir, "outside.json"), "outside\n", "utf8");
    await symlink(resolve(externalDir, "outside.json"), resolve(sourceWorkdir, ".ogs", "runtime.json"), "file");
    await assert.rejects(
      () => snapshotProjectAssets({ sourceWorkdir, runDir: resolve(sourceWorkdir, ".ogs", "runs", "run-1"), runtimeConfig: { roleRepo: "./og-roles" } }),
      /PROJECT_RUN_SNAPSHOT_INVALID|PROJECT_RUN_SNAPSHOT_EXTERNAL_DEPENDENCY/
    );
  } finally {
    await rm(sourceWorkdir, { recursive: true, force: true });
  }

  const workdir = await mkdtemp(resolve(tmpdir(), "ogs-project-run-symlink-restore-"));
  try {
    await mkdir(resolve(workdir, ".ogs"), { recursive: true });
    await writeFile(resolve(workdir, "system.mmd"), "flowchart TD\ninput --> writer\n", "utf8");
    await writeFile(resolve(workdir, ".ogs", "runtime.json"), JSON.stringify({ roleRepo: "./og-roles" }), "utf8");
    const runDir = resolve(workdir, ".ogs", "runs", "run-1");
    await snapshotProjectAssets({ sourceWorkdir: workdir, runDir, runtimeConfig: { roleRepo: "./og-roles" } });
    const restoredPath = resolve(runDir, "project-assets", "system.mmd");
    await rm(restoredPath);
    await symlink(resolve(externalDir, "outside.json"), restoredPath, "file");
    await assert.rejects(() => assertProjectAssetSnapshot(runDir), /PROJECT_RUN_SNAPSHOT_INVALID/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
    await rm(externalDir, { recursive: true, force: true });
  }
});

test("project run snapshots reject files that are not declared by the manifest", async () => {
  const workdir = await mkdtemp(resolve(tmpdir(), "ogs-project-run-unmanifested-"));
  try {
    const sourceDir = resolve(workdir, "assets");
    await mkdir(resolve(sourceDir, ".ogs"), { recursive: true });
    await writeFile(resolve(sourceDir, "system.mmd"), "flowchart TD\ninput --> output\n", "utf8");
    await writeFile(resolve(sourceDir, ".ogs", "runtime.json"), "{}\n", "utf8");
    const runDir = resolve(workdir, ".ogs", "runs", "run-extra-file");
    await snapshotProjectAssets({
      sourceWorkdir: sourceDir,
      runDir,
      runtimeConfig: { roleRepo: "og-roles" }
    });
    await writeFile(resolve(runDir, "project-assets", ".ogs", "model-catalog.json"), "{}\n", "utf8");
    await assert.rejects(
      () => assertProjectAssetSnapshot(runDir),
      /unmanifested: \.ogs\/model-catalog\.json/
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("run control state separates pause from node execution facts", () => {
  const runPlan = {
    version: 1,
    runId: "run-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    designDigest: "d",
    workspaceDigest: "w",
    taskDigest: "t",
    fingerprintDigest: "f",
    entryNodeId: "writer",
    backend: [],
    nodeGraph: [
      { nodeId: "writer", incoming: [], outgoing: [], reviewRequired: false }
    ],
    executionPolicy: { mode: "dry-run", dryRun: true, singleWorker: true, allowExternalSideEffects: false },
    reviewPolicy: { requiredNodeIds: [] }
  };
  const initial = createProjectRunState(runPlan);
  assert.equal(initial.nodes.writer.status, "ready");
  const paused = applyRunControl(initial, "pause");
  assert.equal(paused.status, "paused");
  assert.equal(paused.nodes.writer.status, "ready");
  const cancelRequested = applyRunControl(paused, "cancel");
  assert.equal(cancelRequested.status, "cancel_requested");
  assert.equal(cancelRequested.control.cancelRequested, true);
  const completed = projectRunStateFromResult(applyRunControl(paused, "resume"), {
    systemId: "system",
    systemVersion: "1",
    lawRef: "law",
    status: "done",
    systemState: {},
    runSummary: {},
    stages: [],
    auditTrail: [{ roleId: "writer", at: "2026-01-01T00:00:00.000Z", status: "ok", exitCode: 0, durationMs: 1 }]
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.nodes.writer.status, "completed");
  assert.equal(completed.attempts.length, 1);
});

test("concurrent project control updates merge under the project write lock", async () => {
  const workdir = await mkdtemp(resolve(tmpdir(), "ogs-project-control-cas-"));
  const runDir = resolve(workdir, ".ogs", "runs", "run-cas");
  const runPlan = {
    version: 1,
    runId: "run-cas",
    createdAt: "2026-01-01T00:00:00.000Z",
    designDigest: "d",
    workspaceDigest: "w",
    taskDigest: "t",
    fingerprintDigest: "f",
    entryNodeId: "writer",
    backend: [],
    nodeGraph: [{ nodeId: "writer", incoming: [], outgoing: [], reviewRequired: false }],
    executionPolicy: { mode: "dry-run", dryRun: true, singleWorker: true, allowExternalSideEffects: false },
    reviewPolicy: { requiredNodeIds: [] }
  };
  try {
    await saveProjectRunState(runDir, createProjectRunState(runPlan));
    await Promise.all([
      updateProjectRunState(runDir, (state) => applyRunControl(state, "pause")),
      updateProjectRunState(runDir, (state) => applyRunControl(state, "cancel"))
    ]);
    const finalState = await loadProjectRunState(runDir);
    assert.equal(finalState.control.cancelRequested, true);
    assert.equal(finalState.status, "cancel_requested");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("project quality checks are deterministic and do not rely on model self-evaluation", () => {
  const plan = {
    version: 1, runId: "run-quality", createdAt: "2026-01-01T00:00:00.000Z",
    designDigest: "d", workspaceDigest: "w", taskDigest: "t", fingerprintDigest: "f",
    entryNodeId: "writer", backend: [],
    nodeGraph: [{ nodeId: "writer", incoming: [], outgoing: [{ to: "output", event: "DONE" }], reviewRequired: false }],
    executionPolicy: { mode: "dry-run", dryRun: true, singleWorker: true, allowExternalSideEffects: false },
    reviewPolicy: { requiredNodeIds: [] }
  };
  assert.equal(evaluateProjectRunPlan(plan).passed, true);
  const state = createProjectRunState(plan);
  assert.equal(evaluateProjectRunResult({ plan, state }).passed, false);
  const done = projectRunStateFromResult(state, {
    systemId: "system", systemVersion: "1", lawRef: "law", status: "done", systemState: {}, runSummary: {}, stages: [],
    auditTrail: [{ roleId: "writer", at: "2026-01-01T00:00:00.000Z", status: "ok", exitCode: 0, durationMs: 1 }]
  });
  const report = evaluateProjectRunResult({ plan, state: done, sourceCitationRate: 1 });
  assert.equal(report.passed, true);
  assert.equal(report.metrics.sourceCitationRate, 1);
});
