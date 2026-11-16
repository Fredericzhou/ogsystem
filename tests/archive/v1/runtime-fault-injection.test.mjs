import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";

import { validateRuntimeConfig } from "../dist/runtime/config.js";
import { runSystemWithAdapter } from "../dist/runtime/adapter.js";
import { writeHumanReviewDecision } from "../dist/runtime/project-lifecycle.js";
import { latestRoleContract } from "../tests-support/role-fixture.mjs";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import {
  RESUME_RUN_LOCK_FILE,
  appendBufferedText,
  chainBufferedFlush,
  flushBufferedRunArtifacts,
  initializeRunContext,
  requestRunStop
} from "../dist/runtime/run-artifacts.js";

const systemSource = `flowchart TD
%% system.id=test.fault.injection
%% system.version=1.0.0
%% law.global=law.console.base

start[开始] -->|START| operator[Role:test-operator]
operator[Role:test-operator] -->|READY| end[结束]
`;

const cliPath = path.resolve("dist/runtime/cli.js");

async function writeDefaultModelSelection(workdir) {
  await mkdir(path.resolve(workdir, ".ogs"), { recursive: true });
  await writeFile(
    path.resolve(workdir, ".ogs", "model-selection.json"),
    JSON.stringify(
      {
        configVersion: "3",
        defaults: {
          backend: "opencode",
          modelId: "opencode/gpt-5-nano",
          timeoutMs: 120000,
          maxOutputBytes: 65536
        }
      },
      null,
      2
    ),
    "utf8"
  );
}

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

function runAdapterChild(args, options = {}) {
  const adapterPath = path.resolve("dist/runtime/adapter.js");
  const script = `import(${JSON.stringify(adapterPath)}).then(({ runSystemWithAdapter }) => runSystemWithAdapter(${JSON.stringify(args)})).then((result) => { process.stdout.write(JSON.stringify(result)); }, (error) => { process.stderr.write(String(error?.stack || error)); process.exit(1); });`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(options.env ?? {}) }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function writeRuntimeConfigFile(runtimePath, repoRoot, runtimeOverrides = undefined) {
  const runtimeConfig = {
    executor: "opencode",
    roleRepo: path.resolve(repoRoot, "og-roles"),
    runsDir: ".ogs/runs"
  };
  if (runtimeOverrides) {
    runtimeConfig.runtime = runtimeOverrides;
  }
  await writeFile(runtimePath, JSON.stringify(runtimeConfig, null, 2), "utf8");
}

async function writeRolePackage(args) {
  const roleDir = path.resolve(args.rolesRoot, args.roleId);
  await mkdir(roleDir, { recursive: true });
  await writeFile(
    path.resolve(roleDir, "role.json"),
    JSON.stringify(
      {
        roleId: args.roleId,
        roleVersion: "1.0.0",
        name: args.roleId,
        description: `${args.roleId} test role`,
        promptTemplate: "prompt.md",
        outputSchema: "output.schema.json",
        ...latestRoleContract({ events: args.allowedEvents, allowedTools: args.allowedTools })
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "prompt.md"),
    [
      "{{agent}}",
      "",
      "Allowed events:",
      "{{allowed_events}}",
      "",
      "User preferences:",
      "{{user_preferences}}",
      "",
      "Task:",
      "{{task}}",
      "",
      "Input:",
      "{{input}}"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "agent.md"),
    `# ${args.roleId}\n\n${args.roleId} test role\n`,
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "output.schema.json"),
    JSON.stringify(
      {
        type: "object",
        properties: {
          event: {
            type: "string",
            ...(args.allowedEvents.length ? { enum: args.allowedEvents } : {})
          },
          content: {
            type: "string"
          }
        },
        required: ["event"],
        additionalProperties: false
      },
      null,
      2
    ),
    "utf8"
  );
}

async function createCrashWindowFixture(args) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), args.tempPrefix));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  await writeFile(systemPath, args.systemSource, "utf8");
  await writeRuntimeConfigFile(runtimePath, args.repoRoot, args.runtimeOverrides);
  await writeDefaultModelSelection(tempRoot);
  return { tempRoot, systemPath, runtimePath };
}

async function createLoopBudgetCrashFixture(repoRoot) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-loop-review-commit-crash-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const rolesRoot = path.resolve(tempRoot, "og-roles", "roles");
  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await writeFile(systemPath, `flowchart TD
%% system.id=test.loop-budget.review.crash
%% system.version=1.0.0
%% law.global=law.console.base
%% loop.max.opencode-reviewer=1
start[开始] -->|START| reviewer[Role:opencode-reviewer]
reviewer[Role:opencode-reviewer] -->|REJECTED| reviewer[Role:opencode-reviewer]
reviewer[Role:opencode-reviewer] -->|APPROVED| end[结束]
`, "utf8");
  await writeFile(runtimePath, JSON.stringify({
    executor: "opencode",
    roleRepo: path.resolve(tempRoot, "og-roles"),
    runsDir: ".ogs/runs"
  }, null, 2), "utf8");
  await writeDefaultModelSelection(tempRoot);
  await writeRolePackage({
    rolesRoot,
    roleId: "opencode-reviewer",
    allowedEvents: ["REJECTED", "APPROVED"]
  });
  return { tempRoot, systemPath, runtimePath, lawsPath: path.resolve(repoRoot, ".ogs", "laws.json") };
}

async function readSingleRunDirectory(tempRoot) {
  const runIds = await readdir(path.resolve(tempRoot, ".ogs/runs"));
  assert.strictEqual(runIds.length, 1);
  const runId = runIds[0];
  return {
    runId,
    runDir: path.resolve(tempRoot, ".ogs/runs", runId)
  };
}

function withResumeRun(baseArgs, runId) {
  return ["run", "resume", runId, ...baseArgs.slice(2)];
}

async function waitForSingleRunDirectory(tempRoot, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readSingleRunDirectory(tempRoot);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out waiting for run directory in ${tempRoot}`);
}

async function waitForRoleExecution(runDir, roleId, timeoutMs = 5000) {
  const executionsDir = path.resolve(runDir, "roles", roleId, "executions");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await readdir(executionsDir)).length > 0) {
        return;
      }
    } catch {
      // The run setup may not have created the role directory yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for execution of ${roleId} in ${runDir}`);
}

async function runCrashAfterOutcome(baseArgs, options = {}) {
  const crashed = await runCli(baseArgs, {
    env: {
      OGSYSTEM_ENABLE_TEST_HOOKS: "1",
      OGSYSTEM_TEST_CRASH_AFTER_EXECUTION_OUTCOME: "1",
      ...(options.env ?? {})
    }
  });
  assert.strictEqual(crashed.code, 91, crashed.stderr || crashed.stdout);
  if (options.stderrPattern) {
    assert.match(crashed.stderr, options.stderrPattern);
  }
  return crashed;
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
      runsDir: ".ogs/runs"
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
    resumeRunDir: path.basename(runContext.runDir)
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
      runsDir: ".ogs/runs"
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
  const { tempRoot, systemPath, runtimePath } = await createCrashWindowFixture({
    tempPrefix: "ogsystem-crash-window-e2e-",
    repoRoot,
    systemSource
  });
  const firstTracePath = path.resolve(tempRoot, "first-trace.json");
  const secondTracePath = path.resolve(tempRoot, "second-trace.json");
  const thirdTracePath = path.resolve(tempRoot, "third-trace.json");

  const baseArgs = [
    "run",
    "start",
    "--system",
    systemPath,
    "--runtime",
    runtimePath,
    "--laws",
    path.resolve(repoRoot, ".ogs", "laws.json"),
    "--ogs-dir",
    tempRoot,
    "--input",
    "crash window drill",
    "--dry-run"
  ];

  await runCrashAfterOutcome([...baseArgs, "--trace-out", firstTracePath], {
    stderrPattern: /forced crash after execution outcome/i
  });

  const { runId, runDir } = await readSingleRunDirectory(tempRoot);
  const executionDirsAfterCrash = await readdir(
    path.resolve(runDir, "roles", "test-operator", "executions")
  );
  assert.deepStrictEqual(executionDirsAfterCrash.length, 1);
  const checkpointsAfterCrash = await readdir(path.resolve(runDir, "checkpoints"));
  assert.deepStrictEqual(checkpointsAfterCrash, []);

  const resumed = await runCli([...withResumeRun(baseArgs, runId), "--trace-out", secondTracePath]);

  assert.strictEqual(resumed.code, 0);
  const resumedResult = JSON.parse(await readFile(secondTracePath, "utf8"));
  assert.strictEqual(resumedResult.status, "done", JSON.stringify(resumedResult, null, 2));
  assert.strictEqual(resumedResult.finalRoleIds?.at(-1), "test-operator");
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

  const resumedAgain = await runCli([...withResumeRun(baseArgs, runId), "--trace-out", thirdTracePath]);

  assert.strictEqual(resumedAgain.code, 0);
  const resumedAgainResult = JSON.parse(await readFile(thirdTracePath, "utf8"));
  assert.strictEqual(resumedAgainResult.auditTrail.length, 1);

  const executionDirsAfterSecondResume = await readdir(
    path.resolve(runDir, "roles", "test-operator", "executions")
  );
  assert.deepStrictEqual(executionDirsAfterSecondResume, executionDirsAfterResume);
});

test("human review state commit survives a crash before decision markers and rejects a later duplicate decision", async () => {
  const repoRoot = process.cwd();
  const reviewSystemSource = `flowchart TD
%% system.id=test.review.commit.crash
%% system.version=1.0.0
%% law.global=law.console.base
%% review.mode.test-operator=required
start[开始] -->|START| operator[Role:test-operator]
operator[Role:test-operator] -->|READY| end[结束]
`;
  const { tempRoot, systemPath, runtimePath } = await createCrashWindowFixture({
    tempPrefix: "ogsystem-review-commit-crash-",
    repoRoot,
    systemSource: reviewSystemSource
  });
  const baseArgs = [
    "run",
    "start",
    "--system",
    systemPath,
    "--runtime",
    runtimePath,
    "--laws",
    path.resolve(repoRoot, ".ogs", "laws.json"),
    "--ogs-dir",
    tempRoot,
    "--input",
    "review commit crash drill",
    "--dry-run"
  ];

  const first = await runCli(baseArgs);
  assert.equal(first.code, 0, first.stderr);
  const { runId, runDir } = await readSingleRunDirectory(tempRoot);
  const reviewId = "review.test-operator@1#1.r1";

  const crashed = await runCli([
    "run", "review", "decide", runId, reviewId,
    "--decision", "approve", "--resume", "--dry-run",
    "--runtime", runtimePath,
    "--laws", path.resolve(repoRoot, ".ogs", "laws.json"),
    "--ogs-dir", tempRoot
  ], {
    env: {
      OGSYSTEM_ENABLE_TEST_HOOKS: "1",
      OGSYSTEM_TEST_CRASH_AFTER_REVIEW_STATE_COMMIT: "1"
    }
  });
  assert.equal(crashed.code, 92, crashed.stderr || crashed.stdout);
  assert.match(crashed.stderr, /after human review state commit before decision markers/i);

  const checkpointFiles = await readdir(path.resolve(runDir, "checkpoints"));
  assert.ok(checkpointFiles.length >= 2);
  const decisionPath = path.resolve(runDir, "control", "reviews", `${reviewId}.decision.json`);
  const decision = JSON.parse(await readFile(decisionPath, "utf8"));
  assert.equal(decision.appliedAt, undefined);
  assert.equal(decision.reconciledAt, undefined);

  // Simulate a competing control-plane write after the state checkpoint. Resume must use the
  // resolved review state as the idempotency boundary and must not apply this second decision.
  await writeFile(decisionPath, JSON.stringify({
    ...decision,
    decision: "terminate",
    scope: "run",
    decidedAt: "2099-01-01T00:00:00.000Z",
    committedAt: "2099-01-01T00:00:00.000Z"
  }, null, 2), "utf8");

  const resumed = await runCli(withResumeRun(baseArgs, runId));
  assert.equal(resumed.code, 0, resumed.stderr);
  const resumedResult = JSON.parse(resumed.stdout);
  assert.equal(resumedResult.status, "done", JSON.stringify(resumedResult, null, 2));

  const reconciledDecision = JSON.parse(await readFile(decisionPath, "utf8"));
  assert.equal(typeof reconciledDecision.appliedAt, "string");
  assert.equal(typeof reconciledDecision.reconciledAt, "string");
  const events = (await readFile(path.resolve(runDir, "events.ndjson"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.type === "human_review_approved").length, 1);
  assert.equal(events.filter((event) => event.type === "human_review_terminated").length, 0);
});

test("loop budget decision survives a crash before markers and rejects a later duplicate terminate", async () => {
  const repoRoot = process.cwd();
  const { tempRoot, systemPath, runtimePath, lawsPath } = await createLoopBudgetCrashFixture(repoRoot);
  const first = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath,
    prompt: "loop budget review crash drill",
    workdir: tempRoot,
    dryRun: true,
    dryRunScenario: "review-reject-once"
  });
  assert.equal(first.status, "stopped");
  const { runId, runDir } = await readSingleRunDirectory(tempRoot);
  const state = JSON.parse(await readFile(path.resolve(runDir, "state.json"), "utf8"));
  const reviewId = Object.values(state.graphState.pendingReviewsById ?? {})
    .find((review) => review.kind === "loop_budget")?.reviewId;
  assert.ok(reviewId, "expected loop budget review");

  await writeHumanReviewDecision({
    workdir: tempRoot,
    runId,
    reviewId,
    decision: "continue",
    targetRoleId: "opencode-reviewer",
    additionalBudget: 1,
    principal: { id: "local:loop-budget-crash", issuer: "ogs:local", displayName: "loop-budget-crash" },
    comment: "Continue exactly one additional bounded round."
  });
  const crashed = await runAdapterChild({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath,
    prompt: "loop budget review crash drill",
    workdir: tempRoot,
    resumeRunDir: runId,
    dryRun: true,
    dryRunScenario: "review-reject-once"
  }, {
    env: {
      OGSYSTEM_ENABLE_TEST_HOOKS: "1",
      OGSYSTEM_TEST_CRASH_AFTER_REVIEW_STATE_COMMIT: "1"
    }
  });
  assert.equal(crashed.code, 92, crashed.stderr || crashed.stdout);
  assert.match(crashed.stderr, /after human review state commit before decision markers/i);

  const decisionPath = path.resolve(runDir, "control", "reviews", `${reviewId}.decision.json`);
  const decision = JSON.parse(await readFile(decisionPath, "utf8"));
  assert.equal(decision.appliedAt, undefined);
  assert.equal(decision.reconciledAt, undefined);
  await writeFile(decisionPath, JSON.stringify({
    ...decision,
    decision: "terminate",
    scope: "run",
    decidedAt: "2099-01-01T00:00:00.000Z",
    committedAt: "2099-01-01T00:00:00.000Z"
  }, null, 2), "utf8");

  const resumed = await runAdapterChild({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath,
    prompt: "loop budget review crash drill",
    workdir: tempRoot,
    resumeRunDir: runId,
    dryRun: true,
    dryRunScenario: "review-reject-once"
  });
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).status, "done");
  const reconciledDecision = JSON.parse(await readFile(decisionPath, "utf8"));
  assert.equal(typeof reconciledDecision.appliedAt, "string");
  assert.equal(typeof reconciledDecision.reconciledAt, "string");
  const events = (await readFile(path.resolve(runDir, "events.ndjson"), "utf8"))
    .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.type === "loop_budget_decision").length, 1);
  assert.equal(events.filter((event) => event.type === "human_review_approved").length, 1);
  assert.equal(events.filter((event) => event.type === "human_review_terminated").length, 0);
  assert.equal(events.filter((event) => event.type === "run_terminated").length, 0);
});

test("ERROR* handled failure survives crash window resume without duplicate routing events", async () => {
  const repoRoot = process.cwd();
  const { tempRoot, systemPath, runtimePath } = await createCrashWindowFixture({
    tempPrefix: "ogsystem-error-flow-crash-window-",
    repoRoot,
    systemSource: `flowchart TD
%% system.id=test.error.flow.crash.resume
%% system.version=1.0.0
%% law.global=law.error.flow.resume
%% end.join.mode=quorum_of
%% end.join.min=1
%% exec.bind.test-branch-a=profile.detector
%% exec.bind.error-handler-base=profile.handler
%% exec.bind.test-operator=profile.finalizer

start[开始] -->|START| source[Role:test-branch-a]
source[Role:test-branch-a] -->|ERROR.TOOL_EXECUTION_SPAWN| handler[Role:error-handler-base]
source[Role:test-branch-a] -->|ERROR| handler[Role:error-handler-base]
handler[Role:error-handler-base] -->|READY| finalizer[Role:test-operator]
handler[Role:error-handler-base] -->|BLOCKED| end[结束]
handler[Role:error-handler-base] -->|REJECTED| end[结束]
finalizer[Role:test-operator] -->|READY| end[结束]
`,
    runtimeOverrides: {
      error_flows: {
        v1: true
      }
    }
  });
  const rolesRoot = path.resolve(tempRoot, "og-roles", "roles");
  await mkdir(rolesRoot, { recursive: true });
  await writeRolePackage({ roleId: "test-branch-a", rolesRoot, allowedEvents: [], allowedTools: ["tool.detector"] });
  await writeRolePackage({
    roleId: "error-handler-base",
    rolesRoot,
    allowedEvents: ["REJECTED", "READY", "BLOCKED"],
    allowedTools: ["tool.handler"]
  });
  await writeRolePackage({ roleId: "test-operator", rolesRoot, allowedEvents: ["READY"], allowedTools: ["tool.finalizer"] });
  await writeFile(
    runtimePath,
    JSON.stringify({
      executor: "opencode",
      roleRepo: path.resolve(tempRoot, "og-roles"),
      runsDir: ".ogs/runs",
      runtime: { error_flows: { v1: true } }
    }, null, 2),
    "utf8"
  );
  const profilesPath = path.resolve(tempRoot, "profiles.json");
  const toolsPath = path.resolve(tempRoot, "tools.json");
  const lawsPath = path.resolve(tempRoot, "laws.json");
  const scriptsDir = path.resolve(tempRoot, "scripts");
  await mkdir(scriptsDir, { recursive: true });

  await writeFile(
    path.resolve(scriptsDir, "detector.mjs"),
    'process.stderr.write("error-flow crash drill failure\\n"); process.exit(1);\n',
    "utf8"
  );
  await writeFile(
    path.resolve(scriptsDir, "handler.mjs"),
    'console.log(JSON.stringify({ event: "READY", content: "handled in resume drill" }));\n',
    "utf8"
  );
  await writeFile(
    path.resolve(scriptsDir, "finalizer.mjs"),
    'console.log(JSON.stringify({ event: "READY", content: "resume drill completed" }));\n',
    "utf8"
  );

  await writeFile(
    profilesPath,
    JSON.stringify(
      [
        { profileId: "profile.detector", toolRef: "tool.detector" },
        { profileId: "profile.handler", toolRef: "tool.handler" },
        { profileId: "profile.finalizer", toolRef: "tool.finalizer" }
      ],
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    toolsPath,
    JSON.stringify(
      {
        tools: [
          {
            toolRef: "tool.detector",
            runner: "local_shell",
            command: "node",
            argsTemplate: [path.resolve(scriptsDir, "detector.mjs")],
            stdinMode: "none"
          },
          {
            toolRef: "tool.handler",
            runner: "local_shell",
            command: "node",
            argsTemplate: [path.resolve(scriptsDir, "handler.mjs")],
            stdinMode: "none"
          },
          {
            toolRef: "tool.finalizer",
            runner: "local_shell",
            command: "node",
            argsTemplate: [path.resolve(scriptsDir, "finalizer.mjs")],
            stdinMode: "none"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    lawsPath,
    JSON.stringify(
      {
        laws: [
          {
            lawId: "law.error.flow.resume",
            constraints: {
              forbiddenToolRefs: [],
              maxTransitions: 24,
              allowNoopWithoutExecutionBinding: false
            }
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const baseArgs = [
    "run",
    "start",
    "--system",
    systemPath,
    "--runtime",
    runtimePath,
    "--laws",
    lawsPath,
    "--ogs-dir",
    tempRoot,
    "--input",
    "error flow resume drill"
  ];

  await runCrashAfterOutcome(baseArgs);
  const { runId, runDir } = await readSingleRunDirectory(tempRoot);

  const sourceExecutionDirsAfterCrash = await readdir(
    path.resolve(runDir, "roles", "test-branch-a", "executions")
  );
  assert.strictEqual(sourceExecutionDirsAfterCrash.length, 1);
  assert.deepStrictEqual(await readdir(path.resolve(runDir, "checkpoints")), []);

  const resumeArgs = withResumeRun(baseArgs, runId);
  const resumed = await runCli(resumeArgs);
  assert.strictEqual(resumed.code, 0, resumed.stderr || resumed.stdout);
  const resumedResult = JSON.parse(resumed.stdout);
  assert.strictEqual(resumedResult.status, "done");
  assert.strictEqual(resumedResult.finalRoleIds?.at(-1), "test-operator");
  assert.strictEqual(resumedResult.runSummary.handledFailureCount, 1);
  assert.strictEqual(resumedResult.runSummary.unhandledFailureCount, 0);

  const eventsPath = path.resolve(runDir, "events.ndjson");
  const countFailureHandledEvents = async () =>
    (await readFile(eventsPath, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return undefined;
        }
      })
      .filter((event) => event?.type === "failure_handled").length;

  assert.strictEqual(await countFailureHandledEvents(), 1);

  const resumedAgain = await runCli(resumeArgs);
  assert.strictEqual(resumedAgain.code, 0);
  const resumedAgainResult = JSON.parse(resumedAgain.stdout);
  assert.strictEqual(resumedAgainResult.runSummary.handledFailureCount, 1);
  assert.strictEqual(resumedAgainResult.runSummary.unhandledFailureCount, 0);
  assert.strictEqual(await countFailureHandledEvents(), 1);

  const sourceExecutionDirsAfterSecondResume = await readdir(
    path.resolve(runDir, "roles", "test-branch-a", "executions")
  );
  assert.deepStrictEqual(sourceExecutionDirsAfterSecondResume, sourceExecutionDirsAfterCrash);
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
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeDefaultModelSelection(tempRoot);
  await writeFile(path.resolve(tempRoot, "profiles.json"), JSON.stringify([
    { profileId: "profile.console.print", toolRef: "tool.console.print", timeoutMs: 30000, maxOutputBytes: 65536 }
  ], null, 2), "utf8");
  await writeFile(path.resolve(tempRoot, "tools.json"), JSON.stringify({ tools: [
    { toolRef: "tool.console.print", runner: "local_shell", command: "node", argsTemplate: ["scripts/console-print.mjs"], stdinMode: "text" }
  ] }, null, 2), "utf8");

  const initial = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath: path.resolve(repoRoot, ".ogs", "laws.json"),
    workdir: tempRoot,
    prompt: "resume lock live holder",
    dryRun: true
  });
  assert.strictEqual(initial.status, "done");

  const runId = (await readdir(path.resolve(tempRoot, ".ogs/runs")))[0];
  const runDir = path.resolve(tempRoot, ".ogs/runs", runId);
  const baseArgs = [
    "run",
    "resume",
    runId,
    "--system",
    systemPath,
    "--runtime",
    runtimePath,
    "--laws",
    path.resolve(repoRoot, ".ogs", "laws.json"),
    "--ogs-dir",
    tempRoot,
    "--input",
    "resume lock live holder",
    "--dry-run"
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
  assert.match(competingResume.stderr, /\[hint\] To resume this run, use:/);

  const heldResume = await heldResumePromise;
  assert.strictEqual(heldResume.code, 0);
  await assert.rejects(() => readFile(path.resolve(runDir, RESUME_RUN_LOCK_FILE), "utf8"));
});

test("runner consumes stop request after current transition and lands in stopped state", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-stop-request-runtime-"));
  const rolesRoot = path.resolve(tempRoot, "og-roles", "roles");
  const scriptsDir = path.resolve(tempRoot, "scripts");
  const systemPath = path.resolve(tempRoot, "system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const profilesPath = path.resolve(tempRoot, "profiles.json");
  const toolsPath = path.resolve(tempRoot, "tools.json");
  const tracePath = path.resolve(tempRoot, "stop-trace.json");
  const secondRoleMarkerPath = path.resolve(tempRoot, "second-role-marker.txt");

  await mkdir(rolesRoot, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });
  await writeFile(
    runtimePath,
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
  await writeDefaultModelSelection(tempRoot);

  await writeRolePackage({
    rolesRoot,
    roleId: "slow_role",
    allowedEvents: ["READY"],
    allowedTools: ["tool.slow"]
  });
  await writeRolePackage({
    rolesRoot,
    roleId: "second_role",
    allowedEvents: ["READY"],
    allowedTools: ["tool.second"]
  });

  await writeFile(
    path.resolve(scriptsDir, "slow-role.mjs"),
    [
      "setTimeout(() => {",
      '  console.log(JSON.stringify({ event: "READY", content: "slow role done" }));',
      "}, 400);"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.resolve(scriptsDir, "second-role.mjs"),
    [
      'import { writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(secondRoleMarkerPath)}, "ran", "utf8");`,
      'console.log(JSON.stringify({ event: "READY", content: "second role ran" }));'
    ].join("\n"),
    "utf8"
  );

  await writeFile(
    profilesPath,
    JSON.stringify(
      [
        { profileId: "profile.slow", toolRef: "tool.slow" },
        { profileId: "profile.second", toolRef: "tool.second" }
      ],
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    toolsPath,
    JSON.stringify(
      {
        tools: [
          {
            toolRef: "tool.slow",
            runner: "local_shell",
            command: "node",
            argsTemplate: [path.resolve(scriptsDir, "slow-role.mjs")],
            stdinMode: "none"
          },
          {
            toolRef: "tool.second",
            runner: "local_shell",
            command: "node",
            argsTemplate: [path.resolve(scriptsDir, "second-role.mjs")],
            stdinMode: "none"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    systemPath,
    `flowchart TD
%% system.id=test.stop.request.runtime
%% system.version=1.0.0
%% law.global=law.console.base
%% exec.bind.slow_role=profile.slow
%% exec.bind.second_role=profile.second

start[开始] -->|START| slow_role[Role:slow_role]
slow_role[Role:slow_role] -->|READY| second_role[Role:second_role]
second_role[Role:second_role] -->|READY| end[结束]
`,
    "utf8"
  );

  const child = spawn(
    "node",
    [
      cliPath,
      "run",
      "start",
      "--system",
      systemPath,
      "--runtime",
      runtimePath,
      "--laws",
      path.resolve(repoRoot, ".ogs", "laws.json"),
      "--ogs-dir",
      tempRoot,
      "--input",
      "stop request runtime test",
      "--trace-out",
      tracePath
    ],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    }
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const { runDir } = await waitForSingleRunDirectory(tempRoot);
  await waitForRoleExecution(runDir, "slow_role");
  await requestRunStop({
    runDir,
    reason: "phase0 stop-consumption test"
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  assert.strictEqual(exitCode, 0, stderr || stdout);

  const tracedResult = JSON.parse(await readFile(tracePath, "utf8"));
  assert.strictEqual(tracedResult.status, "stopped");
  assert.strictEqual(tracedResult.finalRoleIds?.at(-1), undefined);

  const stateJson = JSON.parse(await readFile(path.resolve(runDir, "state.json"), "utf8"));
  assert.strictEqual(stateJson.status, "stopped");
  assert.strictEqual(stateJson.graphState.status, "stopped");
  assert.strictEqual(stateJson.graphState.lastExecutedRoleId, "slow_role");

  const eventsText = await readFile(path.resolve(runDir, "events.ndjson"), "utf8");
  assert.match(eventsText, /"type":"run_stopping"/);
  assert.match(eventsText, /"type":"run_stopped"/);

  const slowExecutions = await readdir(path.resolve(runDir, "roles", "slow_role", "executions"));
  const secondExecutions = await readdir(path.resolve(runDir, "roles", "second_role", "executions"));
  assert.strictEqual(slowExecutions.length, 1);
  assert.strictEqual(secondExecutions.length, 0);
  await assert.rejects(() => readFile(secondRoleMarkerPath, "utf8"));
});
