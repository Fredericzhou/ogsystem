import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";

import { validateRuntimeConfig } from "../dist/runtime/config.js";
import { runSystemWithAdapter } from "../dist/runtime/adapter.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import {
  RESUME_RUN_LOCK_FILE,
  appendBufferedText,
  chainBufferedFlush,
  flushBufferedRunArtifacts,
  initializeRunContext
} from "../dist/runtime/run-artifacts.js";

const systemSource = `flowchart TD
%% system.id=test.fault.injection
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=test-operator
%% model.bind.test-operator=balanced-gpt52

input -->|GO| operator[Role:test-operator]
operator[Role:test-operator] -->|DONE| output
`;

const cliPath = path.resolve("dist/runtime/cli.js");

function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [cliPath, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(options.env ?? {})
      }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("buffered append recovery replays content after a partial write failure", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-buffer-recovery-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  await writeFile(systemPath, systemSource, "utf8");

  const system = parseSystemFromMermaidSource(systemSource);
  const runtimeConfig = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: path.resolve("og-roles"),
      modelRepo: path.resolve("og-models"),
      runsDir: "ogsystem-history"
    },
    path.resolve(tempRoot, "runtime.json")
  );

  const runContext = await initializeRunContext({
    system,
    systemPath,
    prompt: "buffer fault",
    workdir: tempRoot,
    runtimeConfig
  });
  const failingPath = path.resolve(runContext.runDir, "fault", "delayed.log");

  await appendBufferedText({
    context: runContext,
    key: "fault-test",
    path: failingPath,
    content: "recovered line\n"
  });

  await assert.rejects(() => flushBufferedRunArtifacts(runContext), /ENOENT|no such file/i);

  await mkdir(path.dirname(failingPath), { recursive: true });
  await initializeRunContext({
    system,
    systemPath,
    prompt: "buffer fault",
    workdir: tempRoot,
    runtimeConfig,
    resumeRunDir: path.relative(tempRoot, runContext.runDir)
  });

  const content = await readFile(failingPath, "utf8");
  assert.strictEqual(content, "recovered line\n");

  const recoveryDir = path.resolve(runContext.runDir, ".buffer-recovery");
  const recoveryEntries = await readdir(recoveryDir);
  assert.deepStrictEqual(recoveryEntries, []);
});

test("overlapping flush calls serialize without losing pending batches", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-buffer-overlap-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  await writeFile(systemPath, systemSource, "utf8");

  const system = parseSystemFromMermaidSource(systemSource);
  const runtimeConfig = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: path.resolve("og-roles"),
      modelRepo: path.resolve("og-models"),
      runsDir: "ogsystem-history"
    },
    path.resolve(tempRoot, "runtime.json")
  );

  const runContext = await initializeRunContext({
    system,
    systemPath,
    prompt: "flush overlap",
    workdir: tempRoot,
    runtimeConfig
  });
  const targetPath = path.resolve(runContext.runDir, "audit", "overlap.log");

  await appendBufferedText({
    context: runContext,
    key: "overlap-a",
    path: targetPath,
    content: "alpha\n"
  });
  const flushA = flushBufferedRunArtifacts(runContext);

  await appendBufferedText({
    context: runContext,
    key: "overlap-b",
    path: targetPath,
    content: "beta\n"
  });
  const flushB = flushBufferedRunArtifacts(runContext);

  await appendBufferedText({
    context: runContext,
    key: "overlap-c",
    path: targetPath,
    content: "gamma\n"
  });
  const flushC = flushBufferedRunArtifacts(runContext);

  await Promise.all([flushA, flushB, flushC]);

  const lines = (await readFile(targetPath, "utf8"))
    .trim()
    .split("\n")
    .sort((left, right) => left.localeCompare(right));
  assert.deepStrictEqual(lines, ["alpha", "beta", "gamma"]);
});

test("buffered flush bookkeeping keeps newer queued flush active", async () => {
  let releaseFirst;
  let releaseSecond;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const secondGate = new Promise((resolve) => {
    releaseSecond = resolve;
  });
  const state = {
    pendingByKey: new Map()
  };

  const firstFlush = chainBufferedFlush(state, async () => {
    await firstGate;
  });
  const secondFlush = chainBufferedFlush(state, async () => {
    await secondGate;
  });

  assert.strictEqual(state.flushPromise, secondFlush);

  releaseFirst();
  await firstFlush;
  assert.strictEqual(state.flushPromise, secondFlush);

  releaseSecond();
  await Promise.all([firstFlush, secondFlush]);
  assert.strictEqual(state.flushPromise, undefined);
});

test("forced crash after durable outcome resumes without duplicate execution", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-crash-window-e2e-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const firstTracePath = path.resolve(tempRoot, "first-trace.json");
  const secondTracePath = path.resolve(tempRoot, "second-trace.json");
  const thirdTracePath = path.resolve(tempRoot, "third-trace.json");

  await writeFile(systemPath, systemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: path.resolve(repoRoot, "og-roles"),
        modelRepo: path.resolve(repoRoot, "og-models"),
        runsDir: "ogsystem-history"
      },
      null,
      2
    ),
    "utf8"
  );

  const baseArgs = [
    "--system",
    systemPath,
    "--runtime",
    runtimePath,
    "--laws",
    path.resolve(repoRoot, ".ogsystem", "laws.json"),
    "--workdir",
    tempRoot,
    "--prompt",
    "crash window drill",
    "--dry-run"
  ];

  const crashed = await runCli([...baseArgs, "--trace-out", firstTracePath], {
    env: {
      OGSYSTEM_TEST_CRASH_AFTER_EXECUTION_OUTCOME: "1"
    }
  });

  assert.strictEqual(crashed.code, 91);
  assert.match(crashed.stderr, /forced crash after execution outcome/i);

  const runIds = await readdir(path.resolve(tempRoot, "ogsystem-history"));
  assert.strictEqual(runIds.length, 1);
  const runDir = path.resolve(tempRoot, "ogsystem-history", runIds[0]);
  const executionDirsAfterCrash = await readdir(
    path.resolve(runDir, "roles", "test-operator", "executions")
  );
  assert.deepStrictEqual(executionDirsAfterCrash.length, 1);
  const checkpointsAfterCrash = await readdir(path.resolve(runDir, "checkpoints"));
  assert.deepStrictEqual(checkpointsAfterCrash, []);

  const resumed = await runCli(
    [
      ...baseArgs,
      "--resume-run",
      `ogsystem-history/${runIds[0]}`,
      "--trace-out",
      secondTracePath
    ]
  );

  assert.strictEqual(resumed.code, 0);
  const resumedResult = JSON.parse(await readFile(secondTracePath, "utf8"));
  assert.strictEqual(resumedResult.status, "done");
  assert.strictEqual(resumedResult.finalRoleId, "test-operator");
  assert.strictEqual(resumedResult.auditTrail.length, 1);
  await assert.rejects(() => readFile(path.resolve(runDir, RESUME_RUN_LOCK_FILE), "utf8"));

  const executionDirsAfterResume = await readdir(
    path.resolve(runDir, "roles", "test-operator", "executions")
  );
  assert.deepStrictEqual(executionDirsAfterResume, executionDirsAfterCrash);
  const checkpointsAfterResume = await readdir(path.resolve(runDir, "checkpoints"));
  assert.strictEqual(checkpointsAfterResume.length, 1);

  const outcome = JSON.parse(
    await readFile(
      path.resolve(
        runDir,
        "roles",
        "test-operator",
        "executions",
        executionDirsAfterResume[0],
        "execution-outcome.json"
      ),
      "utf8"
    )
  );
  assert.strictEqual(outcome.checkpointSequence, 1);
  assert.ok(outcome.reconciledAt);

  const resumedAgain = await runCli(
    [
      ...baseArgs,
      "--resume-run",
      `ogsystem-history/${runIds[0]}`,
      "--trace-out",
      thirdTracePath
    ]
  );

  assert.strictEqual(resumedAgain.code, 0);
  const resumedAgainResult = JSON.parse(await readFile(thirdTracePath, "utf8"));
  assert.strictEqual(resumedAgainResult.auditTrail.length, 1);

  const executionDirsAfterSecondResume = await readdir(
    path.resolve(runDir, "roles", "test-operator", "executions")
  );
  assert.deepStrictEqual(executionDirsAfterSecondResume, executionDirsAfterResume);
});

test("resume rejects a concurrently held live lock on the same run directory", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-resume-lock-live-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");

  await writeFile(systemPath, systemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: path.resolve(repoRoot, "og-roles"),
        modelRepo: path.resolve(repoRoot, "og-models"),
        runsDir: "ogsystem-history"
      },
      null,
      2
    ),
    "utf8"
  );

  const initial = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath: path.resolve(repoRoot, ".ogsystem", "laws.json"),
    workdir: tempRoot,
    prompt: "resume lock live holder",
    dryRun: true
  });
  assert.strictEqual(initial.status, "done");

  const runId = (await readdir(path.resolve(tempRoot, "ogsystem-history")))[0];
  const runDir = path.resolve(tempRoot, "ogsystem-history", runId);
  const baseArgs = [
    "--system",
    systemPath,
    "--runtime",
    runtimePath,
    "--laws",
    path.resolve(repoRoot, ".ogsystem", "laws.json"),
    "--workdir",
    tempRoot,
    "--prompt",
    "resume lock live holder",
    "--dry-run",
    "--resume-run",
    `ogsystem-history/${runId}`
  ];

  const heldResumePromise = runCli(baseArgs, {
    env: {
      OGSYSTEM_TEST_HOLD_RESUME_LOCK_MS: "3000"
    }
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await readFile(path.resolve(runDir, RESUME_RUN_LOCK_FILE), "utf8");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  const competingResume = await runCli(baseArgs);
  assert.strictEqual(competingResume.code, 1);
  assert.match(competingResume.stderr, /errorCode=RESUME_RUN_LOCK_HELD/);
  assert.match(competingResume.stderr, /stage=resume/);

  const heldResume = await heldResumePromise;
  assert.strictEqual(heldResume.code, 0);
  await assert.rejects(() => readFile(path.resolve(runDir, RESUME_RUN_LOCK_FILE), "utf8"));
});
