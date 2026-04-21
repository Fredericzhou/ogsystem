import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";

import { buildRunPlanFingerprint, runSystemWithAdapter } from "../dist/runtime/adapter.js";
import { compileExecutionSnapshot } from "../dist/runtime/compiler.js";
import { loadModelCatalog } from "../dist/runtime/model-catalog.js";
import { loadModelSelection, resolveModelSelectionForSystem } from "../dist/runtime/model-selection.js";
import { resolveEffectiveLaw } from "../dist/runtime/adapter.js";
import { validateLawsConfig, validateRuntimeConfig } from "../dist/runtime/config.js";
import { createExecutionPlan } from "../dist/runtime/execution-plan.js";
import { createInitialGraphState } from "../dist/runtime/graph-runtime-state.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import { loadRolePackage } from "../dist/runtime/role-repo.js";
import {
  ROLE_EXECUTION_OUTCOME_FILE,
  RESUME_RUN_LOCK_FILE,
  initializeRunContext,
  pathExists,
  persistRuntimeCheckpoint
} from "../dist/runtime/run-artifacts.js";

async function seedModelSelectionFiles(tempRoot) {
  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await writeFile(
    path.resolve(tempRoot, ".ogs", "model-selection.json"),
    await readFile(path.resolve(".ogs", "model-selection.json"), "utf8"),
    "utf8"
  );
  await writeFile(
    path.resolve(tempRoot, ".ogs", "model-catalog.json"),
    await readFile(path.resolve(".ogs", "model-catalog.json"), "utf8"),
    "utf8"
  );
}

async function buildRuntimeFingerprint(system) {
  return buildRuntimeFingerprintWithPaths(system, {
    workdir: process.cwd(),
    roleRootDir: path.resolve("og-roles", "roles"),
    lawsPath: path.resolve(".ogs", "laws.json")
  });
}

async function buildRuntimeFingerprintWithPaths(system, args) {
  const rolePackagesByRoleId = new Map();
  for (const roleId of system.roleIds) {
    rolePackagesByRoleId.set(
      roleId,
      await loadRolePackage({
        roleId,
        roleRootDir: args.roleRootDir
      })
    );
  }

  const lawCatalog = validateLawsConfig(
    JSON.parse(await readFile(args.lawsPath, "utf8")),
    args.lawsPath
  );
  const selection = await loadModelSelection(path.resolve(args.workdir, ".ogs", "model-selection.json"));
  const catalog = await loadModelCatalog(path.resolve(args.workdir, ".ogs", "model-catalog.json"));
  const resolvedModelSelection = resolveModelSelectionForSystem({
    system,
    selection,
    catalog
  });
  const compilerSnapshot = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    effectiveLaw: resolveEffectiveLaw(system, lawCatalog),
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId
  }).snapshot;

  return buildRunPlanFingerprint({
    system,
    rolePackagesByRoleId,
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId,
    effectiveLaw: resolveEffectiveLaw(system, lawCatalog),
    compilerSnapshot
  });
}

async function prepareRuntimeFingerprintResumeFixture(args) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), args.tempPrefix));
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const runDir = path.resolve(tempRoot, ".ogs/runs", args.runName);
  const roleRootDir = path.resolve(tempRoot, "og-roles", "roles");
  const modelRootDir = path.resolve(tempRoot, "og-models");
  const lawsPath = path.resolve(tempRoot, "laws.json");

  const system = parseSystemFromMermaidSource(args.systemSource);
  await seedModelSelectionFiles(tempRoot);
  await mkdir(roleRootDir, { recursive: true });
  await mkdir(path.resolve(modelRootDir, "models"), { recursive: true });
  await mkdir(runDir, { recursive: true });

  for (const roleId of system.roleIds) {
    await cp(
      path.resolve("og-roles", "roles", roleId),
      path.resolve(roleRootDir, roleId),
      { recursive: true }
    );
  }

  for (const modelId of new Set(Object.values(system.modelBinding))) {
    await cp(
      path.resolve("og-models", "models", modelId),
      path.resolve(modelRootDir, "models", modelId),
      { recursive: true }
    );
  }

  await cp(path.resolve(".ogs", "laws.json"), lawsPath);
  await writeFile(systemPath, args.systemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        configVersion: "2",
        executor: "opencode",
        roleRepo: "./og-roles",
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );

  const plan = createExecutionPlan(system);
  const graphState = createInitialGraphState({
    plan,
    prompt: args.prompt
  });
  const fingerprint = await buildRuntimeFingerprintWithPaths(system, {
    workdir: tempRoot,
    roleRootDir,
    lawsPath
  });

  await writeFile(path.resolve(runDir, "state.json"), JSON.stringify({ graphState }, null, 2), "utf8");
  await writeFile(path.resolve(runDir, "sessions.json"), JSON.stringify([], null, 2), "utf8");
  await writeFile(
    path.resolve(runDir, "plan-fingerprint.json"),
    JSON.stringify(fingerprint, null, 2),
    "utf8"
  );

  return {
    tempRoot,
    systemPath,
    runtimePath,
    runDir,
    lawsPath,
    roleRootDir,
    modelRootDir
  };
}

test("adapter resume reloads sessions.json and reuses the same model session", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-resume-session-"));
  await seedModelSelectionFiles(tempRoot);
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const runDir = path.resolve(tempRoot, ".ogs/runs", "existing-run");

  const systemSource = `flowchart TD
%% system.id=resume.session.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-minimalist
%% model.bind.debate-minimalist=balanced-gpt52

input -->|GO| minimalist[Role:debate-minimalist]
minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| output
`;

  await mkdir(runDir, { recursive: true });
  await seedModelSelectionFiles(tempRoot);
  await writeFile(systemPath, systemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        configVersion: "2",
        executor: "opencode",
        roleRepo: path.resolve("og-roles"),
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );

  const system = parseSystemFromMermaidSource(systemSource);
  const plan = createExecutionPlan(system);
  const fingerprint = await buildRuntimeFingerprint(system);
  const graphState = createInitialGraphState({
    plan,
    prompt: "resume session"
  });

  await writeFile(
    path.resolve(runDir, "state.json"),
    JSON.stringify({ graphState }, null, 2),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "sessions.json"),
    JSON.stringify(
      [
        {
          sessionKey: "debate-minimalist:debate-minimalist@1#1",
          roleId: "debate-minimalist",
          sessionLineageId: "debate-minimalist@1#1",
          branchId: "debate-minimalist@1#1",
          sessionId: "ses_existing",
          directory: path.resolve(runDir, "roles", "debate-minimalist"),
          createdAt: "2026-04-10T00:00:00.000Z",
          lastPromptAt: "2026-04-10T00:01:00.000Z",
          lastMessageId: "msg_old",
          promptCount: 2
        }
      ],
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.resolve(runDir, "plan-fingerprint.json"), JSON.stringify(fingerprint, null, 2), "utf8");
  await writeFile(path.resolve(runDir, "events.ndjson"), "corrupted historical log\n", "utf8");

  const result = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath: path.resolve(".ogs", "laws.json"),
    workdir: tempRoot,
    resumeRunDir: ".ogs/runs/existing-run",
    prompt: "resume session",
    dryRun: true
  });

  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "debate-minimalist");

  const sessions = JSON.parse(await readFile(path.resolve(runDir, "sessions.json"), "utf8"));
  assert.strictEqual(sessions.length, 1);
  assert.strictEqual(sessions[0].sessionId, "ses_existing");
  assert.strictEqual(sessions[0].promptCount, 3);

  const roleSession = JSON.parse(
    await readFile(path.resolve(runDir, "roles", "debate-minimalist", "latest-session.json"), "utf8")
  );
  assert.strictEqual(roleSession.sessionId, "ses_existing");
  assert.strictEqual(roleSession.promptCount, 3);

  const stateJson = JSON.parse(await readFile(path.resolve(runDir, "state.json"), "utf8"));
  assert.strictEqual(stateJson.graphState.finalRoleId, "debate-minimalist");
});

test("adapter resume rejects partial or corrupted state snapshots", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-resume-corrupt-"));
  await seedModelSelectionFiles(tempRoot);
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const runDir = path.resolve(tempRoot, ".ogs/runs", "broken-run");

  const systemSource = `flowchart TD
%% system.id=resume.corrupt.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-minimalist
%% model.bind.debate-minimalist=balanced-gpt52

input -->|GO| minimalist[Role:debate-minimalist]
minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| output
`;

  await mkdir(runDir, { recursive: true });
  await writeFile(systemPath, systemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: path.resolve("og-roles"),
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );
  const system = parseSystemFromMermaidSource(systemSource);
  const fingerprint = await buildRuntimeFingerprint(system);
  await writeFile(path.resolve(runDir, "state.json"), JSON.stringify({ graphState: { status: "running" } }), "utf8");
  await writeFile(path.resolve(runDir, "sessions.json"), JSON.stringify([], null, 2), "utf8");
  await writeFile(path.resolve(runDir, "plan-fingerprint.json"), JSON.stringify(fingerprint, null, 2), "utf8");

  await assert.rejects(
    () =>
      runSystemWithAdapter({
        systemPath,
        runtimeConfigPath: runtimePath,
        lawsPath: path.resolve(".ogs", "laws.json"),
        workdir: tempRoot,
        resumeRunDir: ".ogs/runs/broken-run",
        prompt: "resume corrupted",
        dryRun: true
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /partial or corrupted/);
      return true;
    }
  );
});

const handledFailureResumeSource = `flowchart TD
%% system.id=resume.handled.summary.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-minimalist
%% model.bind.debate-minimalist=balanced-gpt52

input -->|GO| minimalist[Role:debate-minimalist]
minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| output
`;

async function createHandledFailureResumeFixture(args) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), args.tempPrefix));
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  await seedModelSelectionFiles(tempRoot);
  await writeFile(systemPath, handledFailureResumeSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        configVersion: "2",
        executor: "opencode",
        roleRepo: path.resolve("og-roles"),
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );
  const initial = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath: path.resolve(".ogs", "laws.json"),
    workdir: tempRoot,
    prompt: args.prompt,
    dryRun: true
  });
  assert.strictEqual(initial.status, "done");

  const runIds = await readdir(path.resolve(tempRoot, ".ogs/runs"));
  assert.strictEqual(runIds.length, 1);
  const runDir = path.resolve(tempRoot, ".ogs/runs", runIds[0]);
  return {
    tempRoot,
    systemPath,
    runtimePath,
    runId: runIds[0],
    statePath: path.resolve(runDir, "state.json")
  };
}

for (const resumeStateMutationCase of [
  {
    name: "adapter resume rejects non-integer handled failure summary counters",
    tempPrefix: "ogsystem-resume-handled-summary-",
    prompt: "resume handled summary",
    mutateGraphState(graphState) {
      graphState.auditSummary.handledFailureCount = 1.5;
    },
    expectedMessage: /handledFailureCount|RESUME_STATE_INVALID/
  },
  {
    name: "adapter resume rejects non-integer handled failure map values",
    tempPrefix: "ogsystem-resume-handled-map-values-",
    prompt: "resume handled map values",
    mutateGraphState(graphState) {
      graphState.auditSummary.handledFailureByEvent = { ERROR: 1.25 };
    },
    expectedMessage: /handledFailureByEvent|RESUME_STATE_INVALID/
  },
  {
    name: "adapter resume rejects non-integer unhandled failure summary counters",
    tempPrefix: "ogsystem-resume-unhandled-summary-",
    prompt: "resume unhandled summary",
    mutateGraphState(graphState) {
      graphState.auditSummary.unhandledFailureCount = 2.5;
    },
    expectedMessage: /unhandledFailureCount|RESUME_STATE_INVALID/
  },
  {
    name: "adapter resume rejects non-integer handled failure target-role map values",
    tempPrefix: "ogsystem-resume-handled-target-map-values-",
    prompt: "resume handled target map values",
    mutateGraphState(graphState) {
      graphState.auditSummary.handledFailureByTargetRole = { fallback: 3.25 };
    },
    expectedMessage: /handledFailureByTargetRole|RESUME_STATE_INVALID/
  },
  {
    name: "adapter resume rejects non-integer transition counter",
    tempPrefix: "ogsystem-resume-transition-count-",
    prompt: "resume transition count",
    mutateGraphState(graphState) {
      graphState.transitionCount = 1.5;
    },
    expectedMessage: /graphState\.transitionCount|RESUME_STATE_INVALID/
  },
  {
    name: "adapter resume rejects non-integer audit ok counter",
    tempPrefix: "ogsystem-resume-audit-ok-count-",
    prompt: "resume audit ok count",
    mutateGraphState(graphState) {
      graphState.auditSummary.okCount = 0.5;
    },
    expectedMessage: /graphState\.auditSummary\.okCount|RESUME_STATE_INVALID/
  },
  {
    name: "adapter resume rejects non-integer audit failed counter",
    tempPrefix: "ogsystem-resume-audit-failed-count-",
    prompt: "resume audit failed count",
    mutateGraphState(graphState) {
      graphState.auditSummary.failedCount = 1.5;
    },
    expectedMessage: /graphState\.auditSummary\.failedCount|RESUME_STATE_INVALID/
  },
  {
    name: "adapter resume rejects non-integer audit noop counter",
    tempPrefix: "ogsystem-resume-audit-noop-count-",
    prompt: "resume audit noop count",
    mutateGraphState(graphState) {
      graphState.auditSummary.noopCount = 1.5;
    },
    expectedMessage: /graphState\.auditSummary\.noopCount|RESUME_STATE_INVALID/
  },
  {
    name: "adapter resume rejects non-integer audit repair attempted counter",
    tempPrefix: "ogsystem-resume-audit-repair-attempted-count-",
    prompt: "resume audit repair attempted count",
    mutateGraphState(graphState) {
      graphState.auditSummary.repairAttemptedCount = 1.5;
    },
    expectedMessage: /graphState\.auditSummary\.repairAttemptedCount|RESUME_STATE_INVALID/
  },
  {
    name: "adapter resume rejects non-integer audit repair applied counter",
    tempPrefix: "ogsystem-resume-audit-repair-applied-count-",
    prompt: "resume audit repair applied count",
    mutateGraphState(graphState) {
      graphState.auditSummary.repairAppliedCount = 1.5;
    },
    expectedMessage: /graphState\.auditSummary\.repairAppliedCount|RESUME_STATE_INVALID/
  },
  {
    name: "adapter resume rejects non-integer branch sequence counter",
    tempPrefix: "ogsystem-resume-branch-sequence-",
    prompt: "resume branch sequence",
    mutateGraphState(graphState) {
      graphState.nextBranchSequence = 2.5;
    },
    expectedMessage: /graphState\.nextBranchSequence|RESUME_STATE_INVALID/
  },
  {
    name: "adapter resume rejects non-integer checkpoint sequence counter",
    tempPrefix: "ogsystem-resume-checkpoint-sequence-",
    prompt: "resume checkpoint sequence",
    mutateGraphState(graphState) {
      graphState.lastCheckpointSequence = 1.5;
    },
    expectedMessage: /graphState\.lastCheckpointSequence|RESUME_STATE_INVALID/
  }
]) {
  test(resumeStateMutationCase.name, async () => {
    const fixture = await createHandledFailureResumeFixture({
      tempPrefix: resumeStateMutationCase.tempPrefix,
      prompt: resumeStateMutationCase.prompt
    });
    const stateJson = JSON.parse(await readFile(fixture.statePath, "utf8"));
    resumeStateMutationCase.mutateGraphState(stateJson.graphState);
    await writeFile(fixture.statePath, JSON.stringify(stateJson, null, 2), "utf8");

    await assert.rejects(
      () =>
        runSystemWithAdapter({
          systemPath: fixture.systemPath,
          runtimeConfigPath: fixture.runtimePath,
          lawsPath: path.resolve(".ogs", "laws.json"),
          workdir: fixture.tempRoot,
          resumeRunDir: `.ogs/runs/${fixture.runId}`,
          prompt: resumeStateMutationCase.prompt,
          dryRun: true
        }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, resumeStateMutationCase.expectedMessage);
        return true;
      }
    );
  });
}

test("adapter resume rejects plan fingerprint mismatch", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-resume-fingerprint-mismatch-"));
  await seedModelSelectionFiles(tempRoot);
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const runDir = path.resolve(tempRoot, ".ogs/runs", "mismatch-run");

  const initialSystemSource = `flowchart TD
%% system.id=resume.fingerprint.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-minimalist
%% model.bind.debate-minimalist=balanced-gpt52

input -->|GO| minimalist[Role:debate-minimalist]
minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| output
`;
  const mutatedSystemSource = initialSystemSource.replace(
    "%% model.bind.debate-minimalist=balanced-gpt52",
    "%% model.bind.debate-minimalist=fast-gpt54"
  );

  await mkdir(runDir, { recursive: true });
  await writeFile(systemPath, mutatedSystemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: path.resolve("og-roles"),
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );

  const initialSystem = parseSystemFromMermaidSource(initialSystemSource);
  const plan = createExecutionPlan(initialSystem);
  const fingerprint = await buildRuntimeFingerprint(initialSystem);
  const graphState = createInitialGraphState({
    plan,
    prompt: "resume mismatch"
  });

  await writeFile(path.resolve(runDir, "state.json"), JSON.stringify({ graphState }, null, 2), "utf8");
  await writeFile(path.resolve(runDir, "sessions.json"), JSON.stringify([], null, 2), "utf8");
  await writeFile(path.resolve(runDir, "plan-fingerprint.json"), JSON.stringify(fingerprint, null, 2), "utf8");

  await assert.rejects(
    () =>
      runSystemWithAdapter({
        systemPath,
        runtimeConfigPath: runtimePath,
        lawsPath: path.resolve(".ogs", "laws.json"),
        workdir: tempRoot,
        resumeRunDir: ".ogs/runs/mismatch-run",
        prompt: "resume mismatch",
        dryRun: true
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /fingerprint mismatch/i);
      assert.match(error.message, /system/);
      return true;
    }
  );
});

test("adapter resume accepts identical runtime content loaded from different paths", async () => {
  const systemSource = `flowchart TD
%% system.id=resume.path-stable.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-minimalist
%% model.bind.debate-minimalist=balanced-gpt52

input -->|GO| minimalist[Role:debate-minimalist]
minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| output
`;

  const fixture = await prepareRuntimeFingerprintResumeFixture({
    tempPrefix: "ogsystem-resume-path-stable-",
    runName: "path-stable-run",
    systemSource,
    prompt: "resume path stable"
  });
  const altModelRootDir = path.resolve(fixture.tempRoot, "alt-models");
  const altLawsPath = path.resolve(fixture.tempRoot, "alt-laws.json");
  const altRuntimePath = path.resolve(fixture.tempRoot, "alt-runtime.json");

  await cp(path.resolve(fixture.tempRoot, "og-roles"), path.resolve(fixture.tempRoot, "alt-roles"), {
    recursive: true
  });
  await cp(path.resolve(fixture.tempRoot, "og-models"), altModelRootDir, {
    recursive: true
  });
  await cp(fixture.lawsPath, altLawsPath);
  await writeFile(
    altRuntimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: "./alt-roles",
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );

  const resumed = await runSystemWithAdapter({
    systemPath: fixture.systemPath,
    runtimeConfigPath: altRuntimePath,
    lawsPath: altLawsPath,
    workdir: fixture.tempRoot,
    resumeRunDir: ".ogs/runs/path-stable-run",
    prompt: "resume path stable",
    dryRun: true
  });

  assert.strictEqual(resumed.status, "done");
  assert.strictEqual(resumed.finalRoleId, "debate-minimalist");
});

test("adapter resume rejects role package content drift", async () => {
  const systemSource = `flowchart TD
%% system.id=resume.role-drift.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-minimalist
%% model.bind.debate-minimalist=balanced-gpt52

input -->|GO| minimalist[Role:debate-minimalist]
minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| output
`;

  const fixture = await prepareRuntimeFingerprintResumeFixture({
    tempPrefix: "ogsystem-resume-role-drift-",
    runName: "role-drift-run",
    systemSource,
    prompt: "resume role drift"
  });
  const roleManifestPath = path.resolve(fixture.roleRootDir, "debate-minimalist", "role.json");
  const roleManifest = JSON.parse(await readFile(roleManifestPath, "utf8"));
  const promptTemplatePath = path.resolve(
    fixture.roleRootDir,
    "debate-minimalist",
    roleManifest.promptTemplate
  );
  const promptTemplate = await readFile(promptTemplatePath, "utf8");
  await writeFile(promptTemplatePath, `${promptTemplate}\n<!-- resume drift -->\n`, "utf8");

  await assert.rejects(
    () =>
      runSystemWithAdapter({
        systemPath: fixture.systemPath,
        runtimeConfigPath: fixture.runtimePath,
        lawsPath: fixture.lawsPath,
        workdir: fixture.tempRoot,
        resumeRunDir: ".ogs/runs/role-drift-run",
        prompt: "resume role drift",
        dryRun: true
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /fingerprint mismatch/i);
      assert.match(error.message, /rolePackages/);
      return true;
    }
  );
});

test("adapter resume ignores legacy model manifest drift once selection owns runtime models", async () => {
  const systemSource = `flowchart TD
%% system.id=resume.model-drift.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-minimalist
%% model.bind.debate-minimalist=balanced-gpt52

input -->|GO| minimalist[Role:debate-minimalist]
minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| output
`;

  const fixture = await prepareRuntimeFingerprintResumeFixture({
    tempPrefix: "ogsystem-resume-model-drift-",
    runName: "model-drift-run",
    systemSource,
    prompt: "resume model drift"
  });
  const modelManifestPath = path.resolve(
    fixture.modelRootDir,
    "models",
    "balanced-gpt52",
    "model.json"
  );
  const modelManifest = JSON.parse(await readFile(modelManifestPath, "utf8"));
  modelManifest.timeoutMs = (modelManifest.timeoutMs ?? 120000) + 1;
  await writeFile(modelManifestPath, JSON.stringify(modelManifest, null, 2), "utf8");

  const resumed = await runSystemWithAdapter({
    systemPath: fixture.systemPath,
    runtimeConfigPath: fixture.runtimePath,
    lawsPath: fixture.lawsPath,
    workdir: fixture.tempRoot,
    resumeRunDir: ".ogs/runs/model-drift-run",
    prompt: "resume model drift",
    dryRun: true
  });

  assert.strictEqual(resumed.status, "done");
  assert.strictEqual(resumed.finalRoleId, "debate-minimalist");
});

test("adapter resume rejects effective law drift", async () => {
  const systemSource = `flowchart TD
%% system.id=resume.law-drift.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-minimalist
%% model.bind.debate-minimalist=balanced-gpt52

input -->|GO| minimalist[Role:debate-minimalist]
minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| output
`;

  const fixture = await prepareRuntimeFingerprintResumeFixture({
    tempPrefix: "ogsystem-resume-law-drift-",
    runName: "law-drift-run",
    systemSource,
    prompt: "resume law drift"
  });
  const laws = JSON.parse(await readFile(fixture.lawsPath, "utf8"));
  const globalLaw = laws.laws.find((entry) => entry.lawId === "law.console.base");
  globalLaw.constraints.maxTransitions = 7;
  await writeFile(fixture.lawsPath, JSON.stringify(laws, null, 2), "utf8");

  await assert.rejects(
    () =>
      runSystemWithAdapter({
        systemPath: fixture.systemPath,
        runtimeConfigPath: fixture.runtimePath,
        lawsPath: fixture.lawsPath,
        workdir: fixture.tempRoot,
        resumeRunDir: ".ogs/runs/law-drift-run",
        prompt: "resume law drift",
        dryRun: true
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /fingerprint mismatch/i);
      assert.match(error.message, /effectiveLaw/);
      return true;
    }
  );
});

test("adapter resume replays pending checkpoints without re-executing the role", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-resume-checkpoint-replay-"));
  await seedModelSelectionFiles(tempRoot);
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const runDir = path.resolve(tempRoot, ".ogs/runs", "checkpoint-run");
  const roleExecutionDir = path.resolve(
    runDir,
    "roles",
    "test-operator",
    "executions",
    "0001-existing"
  );

  const systemSource = `flowchart TD
%% system.id=resume.checkpoint.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=test-operator
%% model.bind.test-operator=balanced-gpt52

input -->|GO| operator[Role:test-operator]
operator[Role:test-operator] -->|DONE| output
`;

  await mkdir(runDir, { recursive: true });
  await mkdir(roleExecutionDir, { recursive: true });
  await writeFile(systemPath, systemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: path.resolve("og-roles"),
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );

  const system = parseSystemFromMermaidSource(systemSource);
  const plan = createExecutionPlan(system);
  const fingerprint = await buildRuntimeFingerprint(system);
  const graphState = createInitialGraphState({
    plan,
    prompt: "resume checkpoint"
  });

  await writeFile(
    path.resolve(runDir, "state.json"),
    JSON.stringify({ graphState }, null, 2),
    "utf8"
  );
  await writeFile(path.resolve(runDir, "sessions.json"), JSON.stringify([], null, 2), "utf8");
  await writeFile(
    path.resolve(runDir, "plan-fingerprint.json"),
    JSON.stringify(fingerprint, null, 2),
    "utf8"
  );
  await writeFile(
    path.resolve(roleExecutionDir, "execution.json"),
    JSON.stringify(
      {
        executionId: "0001-existing",
        executionIndex: 1,
        executionDir: roleExecutionDir,
        roleId: "test-operator",
        sessionKey: "test-operator:test-operator@1#1",
        sessionLineageId: "test-operator@1#1",
        startedAt: "2026-04-10T00:00:00.000Z",
        branchId: "test-operator@1#1",
        loopIteration: 1
      },
      null,
      2
    ),
    "utf8"
  );

  const runtimeConfig = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: path.resolve("og-roles"),
      runsDir: ".ogs/runs"
    },
    runtimePath
  );
  const runContext = await initializeRunContext({
    system,
    systemPath,
    prompt: "resume checkpoint",
    workdir: tempRoot,
    runtimeConfig,
    resumeRunDir: ".ogs/runs/checkpoint-run"
  });

  await persistRuntimeCheckpoint({
    context: runContext,
    roleId: "test-operator",
    branchId: "test-operator@1#1",
    loopIteration: 1,
    executionId: "0001-existing",
    update: {
      status: "done",
      transitionCount: 1,
      recentAudits: [
        {
          at: "2026-04-10T00:00:01.000Z",
          roleId: "test-operator",
          branchId: "test-operator@1#1",
          loopIteration: 1,
          lawRef: "law.console.base",
          modelId: "balanced-gpt52",
          toolRef: "model.balanced-gpt52",
          command: "opencode-sdk",
          args: [],
          exitCode: 0,
          durationMs: 1,
          selectedEvent: "DONE",
          status: "ok"
        }
      ],
      auditSummary: {
        okCount: 1,
        failedCount: 0,
        noopCount: 0,
        repairAttemptedCount: 0,
        repairAppliedCount: 0,
        failureCountsByErrorCode: {}
      },
      roleMetricsByRoleId: {
        "test-operator": {
          total: 1,
          ok: 1,
          failed: 0,
          noop: 0,
          durationMsTotal: 1
        }
      },
      roleResults: {
        "test-operator@1#1": {
          roleId: "test-operator",
          event: "DONE",
          content: "replayed",
          branchId: "test-operator@1#1",
          lineageId: "test-operator@1#1",
          loopIteration: 1
        }
      },
      branchRecords: {
        "test-operator@1#1": {
          branchId: "test-operator@1#1",
          roleId: "test-operator",
          loopIteration: 1,
          branchSequence: 1,
          lineageId: "test-operator@1#1",
          sessionLineageId: "test-operator@1#1",
          status: "completed"
        }
      },
      loopIterations: {
        "test-operator": 1
      },
      selectedEventByBranchId: {
        "test-operator@1#1": "DONE"
      },
      finalOutput: "replayed",
      finalRoleId: "test-operator",
      lastExecutedRoleId: "test-operator",
      nextBranchSequence: 2
    }
  });
  await runContext.releaseResumeLock?.();

  const result = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath: path.resolve(".ogs", "laws.json"),
    workdir: tempRoot,
    resumeRunDir: ".ogs/runs/checkpoint-run",
    prompt: "resume checkpoint",
    dryRun: true
  });

  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "test-operator");
  assert.strictEqual(result.finalOutput, "replayed");

  const executionsAfterResume = await readdir(
    path.resolve(runDir, "roles", "test-operator", "executions")
  );
  assert.strictEqual(executionsAfterResume.length, 1);

  const stateJson = JSON.parse(await readFile(path.resolve(runDir, "state.json"), "utf8"));
  assert.strictEqual(stateJson.graphState.finalRoleId, "test-operator");
  assert.strictEqual(stateJson.graphState.lastCheckpointSequence, 1);
});

test("adapter resume reconciles committed execution outcome without re-executing the role", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-resume-outcome-reconcile-"));
  await seedModelSelectionFiles(tempRoot);
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const runDir = path.resolve(tempRoot, ".ogs/runs", "outcome-run");
  const roleExecutionDir = path.resolve(
    runDir,
    "roles",
    "test-operator",
    "executions",
    "0001-existing"
  );

  const systemSource = `flowchart TD
%% system.id=resume.outcome.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=test-operator
%% model.bind.test-operator=balanced-gpt52

input -->|GO| operator[Role:test-operator]
operator[Role:test-operator] -->|DONE| output
`;

  await mkdir(roleExecutionDir, { recursive: true });
  await writeFile(systemPath, systemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: path.resolve("og-roles"),
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );

  const system = parseSystemFromMermaidSource(systemSource);
  const plan = createExecutionPlan(system);
  const fingerprint = await buildRuntimeFingerprint(system);
  const graphState = createInitialGraphState({
    plan,
    prompt: "resume outcome"
  });

  await writeFile(
    path.resolve(runDir, "state.json"),
    JSON.stringify({ graphState }, null, 2),
    "utf8"
  );
  await writeFile(path.resolve(runDir, "sessions.json"), JSON.stringify([], null, 2), "utf8");
  await writeFile(
    path.resolve(runDir, "plan-fingerprint.json"),
    JSON.stringify(fingerprint, null, 2),
    "utf8"
  );
  await writeFile(
    path.resolve(roleExecutionDir, "execution.json"),
    JSON.stringify(
      {
        executionId: "0001-existing",
        executionIndex: 1,
        executionDir: roleExecutionDir,
        roleId: "test-operator",
        sessionKey: "test-operator:test-operator@1#1",
        sessionLineageId: "test-operator@1#1",
        startedAt: "2026-04-10T00:00:00.000Z",
        branchId: "test-operator@1#1",
        loopIteration: 1
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(roleExecutionDir, ROLE_EXECUTION_OUTCOME_FILE),
    JSON.stringify(
      {
        version: 1,
        executionId: "0001-existing",
        roleId: "test-operator",
        branchId: "test-operator@1#1",
        loopIteration: 1,
        sessionKey: "test-operator:test-operator@1#1",
        branch: {
          branchId: "test-operator@1#1",
          roleId: "test-operator",
          loopIteration: 1,
          branchSequence: 1,
          lineageId: "test-operator@1#1",
          sessionLineageId: "test-operator@1#1",
          status: "active"
        },
        committedAt: "2026-04-10T00:00:01.000Z",
        status: "ok",
        selectedEvent: "DONE",
        storedResult: {
          roleId: "test-operator",
          event: "DONE",
          content: "reconciled",
          branchId: "test-operator@1#1",
          lineageId: "test-operator@1#1",
          loopIteration: 1
        },
        audit: {
          at: "2026-04-10T00:00:01.000Z",
          roleId: "test-operator",
          branchId: "test-operator@1#1",
          loopIteration: 1,
          lawRef: "law.console.base",
          modelId: "balanced-gpt52",
          toolRef: "model.balanced-gpt52",
          command: "opencode-sdk",
          args: [],
          exitCode: 0,
          durationMs: 1,
          selectedEvent: "DONE",
          status: "ok"
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const resumed = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath: path.resolve(".ogs", "laws.json"),
    workdir: tempRoot,
    resumeRunDir: ".ogs/runs/outcome-run",
    prompt: "resume outcome",
    dryRun: true
  });

  assert.strictEqual(resumed.status, "done");
  assert.strictEqual(resumed.finalRoleId, "test-operator");
  assert.strictEqual(resumed.finalOutput, "reconciled");
  assert.strictEqual(resumed.auditTrail.length, 1);

  const executionDirsAfterFirstResume = await readdir(
    path.resolve(runDir, "roles", "test-operator", "executions")
  );
  assert.deepStrictEqual(executionDirsAfterFirstResume, ["0001-existing"]);

  const checkpointsAfterFirstResume = await readdir(path.resolve(runDir, "checkpoints"));
  assert.strictEqual(checkpointsAfterFirstResume.length, 1);

  const reconciledOutcome = JSON.parse(
    await readFile(path.resolve(roleExecutionDir, ROLE_EXECUTION_OUTCOME_FILE), "utf8")
  );
  assert.strictEqual(reconciledOutcome.checkpointSequence, 1);
  assert.ok(reconciledOutcome.reconciledAt);

  const resumedAgain = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath: path.resolve(".ogs", "laws.json"),
    workdir: tempRoot,
    resumeRunDir: ".ogs/runs/outcome-run",
    prompt: "resume outcome",
    dryRun: true
  });

  assert.strictEqual(resumedAgain.status, "done");
  assert.strictEqual(resumedAgain.auditTrail.length, 1);

  const executionDirsAfterSecondResume = await readdir(
    path.resolve(runDir, "roles", "test-operator", "executions")
  );
  assert.deepStrictEqual(executionDirsAfterSecondResume, ["0001-existing"]);

  const checkpointsAfterSecondResume = await readdir(path.resolve(runDir, "checkpoints"));
  assert.strictEqual(checkpointsAfterSecondResume.length, 1);
});

test("adapter resume backfills outcome reconciliation metadata when checkpoint already exists", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-resume-outcome-backfill-"));
  await seedModelSelectionFiles(tempRoot);
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const runDir = path.resolve(tempRoot, ".ogs/runs", "outcome-backfill-run");
  const roleExecutionDir = path.resolve(
    runDir,
    "roles",
    "test-operator",
    "executions",
    "0001-existing"
  );

  const systemSource = `flowchart TD
%% system.id=resume.outcome.backfill.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=test-operator
%% model.bind.test-operator=balanced-gpt52

input -->|GO| operator[Role:test-operator]
operator[Role:test-operator] -->|DONE| output
`;

  await mkdir(roleExecutionDir, { recursive: true });
  await writeFile(systemPath, systemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: path.resolve("og-roles"),
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );

  const system = parseSystemFromMermaidSource(systemSource);
  const plan = createExecutionPlan(system);
  const fingerprint = await buildRuntimeFingerprint(system);
  const graphState = createInitialGraphState({
    plan,
    prompt: "resume outcome backfill"
  });

  await writeFile(
    path.resolve(runDir, "state.json"),
    JSON.stringify({ graphState }, null, 2),
    "utf8"
  );
  await writeFile(path.resolve(runDir, "sessions.json"), JSON.stringify([], null, 2), "utf8");
  await writeFile(
    path.resolve(runDir, "plan-fingerprint.json"),
    JSON.stringify(fingerprint, null, 2),
    "utf8"
  );
  await writeFile(
    path.resolve(roleExecutionDir, "execution.json"),
    JSON.stringify(
      {
        executionId: "0001-existing",
        executionIndex: 1,
        executionDir: roleExecutionDir,
        roleId: "test-operator",
        sessionKey: "test-operator:test-operator@1#1",
        sessionLineageId: "test-operator@1#1",
        startedAt: "2026-04-10T00:00:00.000Z",
        branchId: "test-operator@1#1",
        loopIteration: 1
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(roleExecutionDir, ROLE_EXECUTION_OUTCOME_FILE),
    JSON.stringify(
      {
        version: 1,
        executionId: "0001-existing",
        roleId: "test-operator",
        branchId: "test-operator@1#1",
        loopIteration: 1,
        sessionKey: "test-operator:test-operator@1#1",
        branch: {
          branchId: "test-operator@1#1",
          roleId: "test-operator",
          loopIteration: 1,
          branchSequence: 1,
          lineageId: "test-operator@1#1",
          sessionLineageId: "test-operator@1#1",
          status: "active"
        },
        committedAt: "2026-04-10T00:00:01.000Z",
        status: "ok",
        selectedEvent: "DONE",
        storedResult: {
          roleId: "test-operator",
          event: "DONE",
          content: "checkpoint already persisted",
          branchId: "test-operator@1#1",
          lineageId: "test-operator@1#1",
          loopIteration: 1
        },
        audit: {
          at: "2026-04-10T00:00:01.000Z",
          roleId: "test-operator",
          branchId: "test-operator@1#1",
          loopIteration: 1,
          lawRef: "law.console.base",
          modelId: "balanced-gpt52",
          toolRef: "model.balanced-gpt52",
          command: "opencode-sdk",
          args: [],
          exitCode: 0,
          durationMs: 1,
          selectedEvent: "DONE",
          status: "ok"
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const runtimeConfig = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: path.resolve("og-roles"),
      runsDir: ".ogs/runs"
    },
    runtimePath
  );
  const runContext = await initializeRunContext({
    system,
    systemPath,
    prompt: "resume outcome backfill",
    workdir: tempRoot,
    runtimeConfig,
    resumeRunDir: ".ogs/runs/outcome-backfill-run"
  });

  await persistRuntimeCheckpoint({
    context: runContext,
    roleId: "test-operator",
    branchId: "test-operator@1#1",
    loopIteration: 1,
    executionId: "0001-existing",
    update: {
      status: "done",
      transitionCount: 1,
      recentAudits: [
        {
          at: "2026-04-10T00:00:01.000Z",
          roleId: "test-operator",
          branchId: "test-operator@1#1",
          loopIteration: 1,
          lawRef: "law.console.base",
          modelId: "balanced-gpt52",
          toolRef: "model.balanced-gpt52",
          command: "opencode-sdk",
          args: [],
          exitCode: 0,
          durationMs: 1,
          selectedEvent: "DONE",
          status: "ok"
        }
      ],
      auditSummary: {
        okCount: 1,
        failedCount: 0,
        noopCount: 0,
        repairAttemptedCount: 0,
        repairAppliedCount: 0,
        failureCountsByErrorCode: {}
      },
      roleMetricsByRoleId: {
        "test-operator": {
          total: 1,
          ok: 1,
          failed: 0,
          noop: 0,
          durationMsTotal: 1
        }
      },
      roleResults: {
        "test-operator@1#1": {
          roleId: "test-operator",
          event: "DONE",
          content: "checkpoint already persisted",
          branchId: "test-operator@1#1",
          lineageId: "test-operator@1#1",
          loopIteration: 1
        }
      },
      branchRecords: {
        "test-operator@1#1": {
          branchId: "test-operator@1#1",
          roleId: "test-operator",
          loopIteration: 1,
          branchSequence: 1,
          lineageId: "test-operator@1#1",
          sessionLineageId: "test-operator@1#1",
          status: "completed"
        }
      },
      loopIterations: {
        "test-operator": 1
      },
      selectedEventByBranchId: {
        "test-operator@1#1": "DONE"
      },
      finalOutput: "checkpoint already persisted",
      finalRoleId: "test-operator",
      lastExecutedRoleId: "test-operator",
      nextBranchSequence: 2
    }
  });
  await runContext.releaseResumeLock?.();

  const resumed = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath: path.resolve(".ogs", "laws.json"),
    workdir: tempRoot,
    resumeRunDir: ".ogs/runs/outcome-backfill-run",
    prompt: "resume outcome backfill",
    dryRun: true
  });

  assert.strictEqual(resumed.status, "done");
  assert.strictEqual(resumed.finalRoleId, "test-operator");
  assert.strictEqual(resumed.finalOutput, "checkpoint already persisted");
  assert.strictEqual(resumed.auditTrail.length, 1);

  const executionDirsAfterResume = await readdir(
    path.resolve(runDir, "roles", "test-operator", "executions")
  );
  assert.deepStrictEqual(executionDirsAfterResume, ["0001-existing"]);

  const checkpointsAfterResume = await readdir(path.resolve(runDir, "checkpoints"));
  assert.strictEqual(checkpointsAfterResume.length, 1);

  const outcomeAfterResume = JSON.parse(
    await readFile(path.resolve(roleExecutionDir, ROLE_EXECUTION_OUTCOME_FILE), "utf8")
  );
  assert.strictEqual(outcomeAfterResume.checkpointSequence, 1);
  assert.ok(outcomeAfterResume.reconciledAt);
});

test("adapter resume rejects an active resume lock", async () => {
  const systemSource = `flowchart TD
%% system.id=resume.lock-active.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-minimalist
%% model.bind.debate-minimalist=balanced-gpt52

input -->|GO| minimalist[Role:debate-minimalist]
minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| output
`;

  const fixture = await prepareRuntimeFingerprintResumeFixture({
    tempPrefix: "ogsystem-resume-lock-active-",
    runName: "lock-active-run",
    systemSource,
    prompt: "resume lock active"
  });
  await writeFile(
    path.resolve(fixture.runDir, RESUME_RUN_LOCK_FILE),
    JSON.stringify(
      {
        pid: process.pid,
        hostname: os.hostname(),
        acquiredAt: "2026-04-11T00:00:00.000Z",
        command: "node dist/runtime/cli.js --resume-run"
      },
      null,
      2
    ),
    "utf8"
  );

  await assert.rejects(
    () =>
      runSystemWithAdapter({
        systemPath: fixture.systemPath,
        runtimeConfigPath: fixture.runtimePath,
        lawsPath: fixture.lawsPath,
        workdir: fixture.tempRoot,
        resumeRunDir: ".ogs/runs/lock-active-run",
        prompt: "resume lock active",
        dryRun: true
      }),
    (error) => {
      assert.ok(error && typeof error === "object");
      assert.equal(error.envelope?.errorCode, "RESUME_RUN_LOCK_HELD");
      assert.match(error.message, /already active/i);
      return true;
    }
  );
});

test("adapter resume replaces a stale lock and releases it on exit", async () => {
  const systemSource = `flowchart TD
%% system.id=resume.lock-stale.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-minimalist
%% model.bind.debate-minimalist=balanced-gpt52

input -->|GO| minimalist[Role:debate-minimalist]
minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| output
`;

  const fixture = await prepareRuntimeFingerprintResumeFixture({
    tempPrefix: "ogsystem-resume-lock-stale-",
    runName: "lock-stale-run",
    systemSource,
    prompt: "resume lock stale"
  });

  let stalePid = process.pid + 100000;
  while (true) {
    try {
      process.kill(stalePid, 0);
      stalePid += 1;
    } catch {
      break;
    }
  }

  const lockPath = path.resolve(fixture.runDir, RESUME_RUN_LOCK_FILE);
  await writeFile(
    lockPath,
    JSON.stringify(
      {
        pid: stalePid,
        hostname: os.hostname(),
        acquiredAt: "2026-04-11T00:00:00.000Z",
        command: "node dist/runtime/cli.js --resume-run"
      },
      null,
      2
    ),
    "utf8"
  );

  const resumed = await runSystemWithAdapter({
    systemPath: fixture.systemPath,
    runtimeConfigPath: fixture.runtimePath,
    lawsPath: fixture.lawsPath,
    workdir: fixture.tempRoot,
    resumeRunDir: ".ogs/runs/lock-stale-run",
    prompt: "resume lock stale",
    dryRun: true
  });

  assert.strictEqual(resumed.status, "done");
  assert.strictEqual(resumed.finalRoleId, "debate-minimalist");
  assert.strictEqual(await pathExists(lockPath), false);
});

test("adapter resume setup failure releases lock acquired during initialization", async () => {
  const systemSource = `flowchart TD
%% system.id=resume.lock-setup-failure.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-minimalist
%% model.bind.debate-minimalist=balanced-gpt52

input -->|GO| minimalist[Role:debate-minimalist]
minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| output
`;

  const fixture = await prepareRuntimeFingerprintResumeFixture({
    tempPrefix: "ogsystem-resume-lock-setup-failure-",
    runName: "lock-setup-failure-run",
    systemSource,
    prompt: "resume lock setup failure"
  });

  const blockedSharedPath = path.resolve(fixture.tempRoot, "shared-blocked");
  await writeFile(blockedSharedPath, "not-a-directory\n", "utf8");
  await writeFile(
    fixture.runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        runsDir: ".ogs/runs",
        sharedDir: "shared-blocked"
      },
      null,
      2
    ),
    "utf8"
  );

  await assert.rejects(
    () =>
      runSystemWithAdapter({
        systemPath: fixture.systemPath,
        runtimeConfigPath: fixture.runtimePath,
        lawsPath: fixture.lawsPath,
        workdir: fixture.tempRoot,
        resumeRunDir: ".ogs/runs/lock-setup-failure-run",
        prompt: "resume lock setup failure",
        dryRun: true
      }),
    (error) => {
      assert.ok(error && typeof error === "object");
      assert.equal(error.envelope?.errorCode, "RUNTIME_SETUP_FAILED");
      return true;
    }
  );

  const lockPath = path.resolve(fixture.runDir, RESUME_RUN_LOCK_FILE);
  assert.strictEqual(await pathExists(lockPath), false);

  await writeFile(
    fixture.runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );

  const resumed = await runSystemWithAdapter({
    systemPath: fixture.systemPath,
    runtimeConfigPath: fixture.runtimePath,
    lawsPath: fixture.lawsPath,
    workdir: fixture.tempRoot,
    resumeRunDir: ".ogs/runs/lock-setup-failure-run",
    prompt: "resume lock setup failure",
    dryRun: true
  });

  assert.strictEqual(resumed.status, "done");
  assert.strictEqual(await pathExists(lockPath), false);
});
