import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";

import { buildRunPlanFingerprint, runSystemWithAdapter } from "../dist/runtime/adapter.js";
import { validateRuntimeConfig } from "../dist/runtime/config.js";
import { createExecutionPlan } from "../dist/runtime/execution-plan.js";
import { createInitialGraphState } from "../dist/runtime/graph-runtime-state.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import {
  initializeRunContext,
  persistRuntimeCheckpoint
} from "../dist/runtime/run-artifacts.js";

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
  const fingerprint = buildRunPlanFingerprint(system);
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
          sessionKey: "debate-minimalist",
          roleId: "debate-minimalist",
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
    await readFile(path.resolve(runDir, "roles", "debate-minimalist", "session.json"), "utf8")
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
  const fingerprint = buildRunPlanFingerprint(system);
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
  const fingerprint = buildRunPlanFingerprint(initialSystem);
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
  const fingerprint = buildRunPlanFingerprint(system);
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
        sessionKey: "test-operator",
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
