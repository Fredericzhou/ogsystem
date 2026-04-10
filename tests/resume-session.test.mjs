import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";

import { buildRunPlanFingerprint, runSystemWithAdapter } from "../dist/runtime/adapter.js";
import { resolveEffectiveLaw } from "../dist/runtime/adapter.js";
import { validateLawsConfig, validateRuntimeConfig } from "../dist/runtime/config.js";
import { createExecutionPlan } from "../dist/runtime/execution-plan.js";
import { createInitialGraphState } from "../dist/runtime/graph-runtime-state.js";
import { loadModelPackage } from "../dist/runtime/model-repo.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import { loadRolePackage } from "../dist/runtime/role-repo.js";
import {
  ROLE_EXECUTION_OUTCOME_FILE,
  initializeRunContext,
  persistRuntimeCheckpoint
} from "../dist/runtime/run-artifacts.js";

async function buildRuntimeFingerprint(system) {
  return buildRuntimeFingerprintWithPaths(system, {
    roleRootDir: path.resolve("og-roles", "roles"),
    modelRootDir: path.resolve("og-models"),
    lawsPath: path.resolve(".ogsystem", "laws.json")
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

  const modelsById = new Map();
  for (const modelId of new Set(Object.values(system.modelBinding))) {
    modelsById.set(
      modelId,
      await loadModelPackage({
        modelId,
        modelRootDir: args.modelRootDir
      })
    );
  }

  const lawCatalog = validateLawsConfig(
    JSON.parse(await readFile(args.lawsPath, "utf8")),
    args.lawsPath
  );

  return buildRunPlanFingerprint({
    system,
    rolePackagesByRoleId,
    modelsById,
    effectiveLaw: resolveEffectiveLaw(system, lawCatalog)
  });
}

async function prepareRuntimeFingerprintResumeFixture(args) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), args.tempPrefix));
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const runDir = path.resolve(tempRoot, "ogsystem-history", args.runName);
  const roleRootDir = path.resolve(tempRoot, "og-roles", "roles");
  const modelRootDir = path.resolve(tempRoot, "og-models");
  const lawsPath = path.resolve(tempRoot, "laws.json");

  const system = parseSystemFromMermaidSource(args.systemSource);
  await mkdir(roleRootDir, { recursive: true });
  await mkdir(path.resolve(modelRootDir, "models"), { recursive: true });
  await mkdir(runDir, { recursive: true });
  await cp(path.resolve("og-roles", "roles", "_shared"), path.resolve(roleRootDir, "_shared"), {
    recursive: true
  });

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

  await cp(path.resolve(".ogsystem", "laws.json"), lawsPath);
  await writeFile(systemPath, args.systemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        modelRepo: "./og-models",
        runsDir: "ogsystem-history"
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
    roleRootDir,
    modelRootDir,
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
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const runDir = path.resolve(tempRoot, "ogsystem-history", "existing-run");

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
  await writeFile(systemPath, systemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: path.resolve("og-roles"),
        modelRepo: path.resolve("og-models"),
        runsDir: "ogsystem-history"
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
    lawsPath: path.resolve(".ogsystem", "laws.json"),
    workdir: tempRoot,
    resumeRunDir: "ogsystem-history/existing-run",
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
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const runDir = path.resolve(tempRoot, "ogsystem-history", "broken-run");

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
        modelRepo: path.resolve("og-models"),
        runsDir: "ogsystem-history"
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
        lawsPath: path.resolve(".ogsystem", "laws.json"),
        workdir: tempRoot,
        resumeRunDir: "ogsystem-history/broken-run",
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

test("adapter resume rejects plan fingerprint mismatch", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-resume-fingerprint-mismatch-"));
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const runDir = path.resolve(tempRoot, "ogsystem-history", "mismatch-run");

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
        modelRepo: path.resolve("og-models"),
        runsDir: "ogsystem-history"
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
        lawsPath: path.resolve(".ogsystem", "laws.json"),
        workdir: tempRoot,
        resumeRunDir: "ogsystem-history/mismatch-run",
        prompt: "resume mismatch",
        dryRun: true
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /fingerprint mismatch/i);
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
        modelRepo: "./alt-models",
        runsDir: "ogsystem-history"
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
    resumeRunDir: "ogsystem-history/path-stable-run",
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
        resumeRunDir: "ogsystem-history/role-drift-run",
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

test("adapter resume rejects model manifest drift", async () => {
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

  await assert.rejects(
    () =>
      runSystemWithAdapter({
        systemPath: fixture.systemPath,
        runtimeConfigPath: fixture.runtimePath,
        lawsPath: fixture.lawsPath,
        workdir: fixture.tempRoot,
        resumeRunDir: "ogsystem-history/model-drift-run",
        prompt: "resume model drift",
        dryRun: true
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /fingerprint mismatch/i);
      assert.match(error.message, /modelPackages/);
      return true;
    }
  );
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
        resumeRunDir: "ogsystem-history/law-drift-run",
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
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const runDir = path.resolve(tempRoot, "ogsystem-history", "checkpoint-run");
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
        modelRepo: path.resolve("og-models"),
        runsDir: "ogsystem-history"
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
      modelRepo: path.resolve("og-models"),
      runsDir: "ogsystem-history"
    },
    runtimePath
  );
  const runContext = await initializeRunContext({
    system,
    systemPath,
    prompt: "resume checkpoint",
    workdir: tempRoot,
    runtimeConfig,
    resumeRunDir: "ogsystem-history/checkpoint-run"
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
      auditTrail: [
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

  const result = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath: path.resolve(".ogsystem", "laws.json"),
    workdir: tempRoot,
    resumeRunDir: "ogsystem-history/checkpoint-run",
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
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const runDir = path.resolve(tempRoot, "ogsystem-history", "outcome-run");
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
        modelRepo: path.resolve("og-models"),
        runsDir: "ogsystem-history"
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
    lawsPath: path.resolve(".ogsystem", "laws.json"),
    workdir: tempRoot,
    resumeRunDir: "ogsystem-history/outcome-run",
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
    lawsPath: path.resolve(".ogsystem", "laws.json"),
    workdir: tempRoot,
    resumeRunDir: "ogsystem-history/outcome-run",
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
