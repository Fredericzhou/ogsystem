import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const cliPath = path.resolve("dist/runtime/cli.js");
const opencodeModelsFixturePath = path.resolve("tests/fixtures/opencode-models-verbose.txt");

function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [cliPath, ...args], {
      cwd: options.cwd ?? process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        OGSYSTEM_OPENCODE_MODELS_STDOUT_FILE: opencodeModelsFixturePath,
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

async function seedRuntimeProject(tempRoot) {
  const repoRoot = process.cwd();
  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await writeFile(
    path.resolve(tempRoot, ".ogs", "runtime.json"),
    JSON.stringify(
      {
        configVersion: "2",
        executor: "opencode",
        roleRepo: path.resolve(repoRoot, "og-roles"),
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(tempRoot, ".ogs", "model-selection.json"),
    JSON.stringify(
      {
        configVersion: "1",
        defaults: {
          model: "opencode/gpt-5-nano",
          timeoutMs: 120000,
          maxOutputBytes: 65536
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(tempRoot, ".ogs", "model-catalog.json"),
    await readFile(path.resolve(repoRoot, ".ogs", "model-catalog.json"), "utf8"),
    "utf8"
  );
  await writeFile(
    path.resolve(tempRoot, ".ogs", "user-profile.json"),
    await readFile(path.resolve(repoRoot, ".ogs", "user-profile.json"), "utf8"),
    "utf8"
  );
  await writeFile(
    path.resolve(tempRoot, ".ogs", "laws.json"),
    await readFile(path.resolve(repoRoot, ".ogs", "laws.json"), "utf8"),
    "utf8"
  );
}

test("lifecycle cli project init/create commands scaffold project control plane", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-cli-project-"));

  const initResult = await runCli(["project", "init"], { cwd: tempRoot });
  assert.strictEqual(initResult.code, 0);
  const initPayload = JSON.parse(initResult.stdout);
  assert.equal(initPayload.command, "project init");
  assert.equal(initPayload.template, "minimal");
  await stat(path.resolve(tempRoot, ".ogs", "runtime.json"));
  const initReadmePath = path.resolve(tempRoot, ".ogs", "README.md");
  await stat(path.resolve(tempRoot, ".ogs", "model-catalog.json"));
  await stat(path.resolve(tempRoot, ".ogs", "model-selection.json"));
  await stat(path.resolve(tempRoot, ".ogs", "project.json"));
  await stat(path.resolve(tempRoot, ".ogs", "laws.json"));
  await stat(path.resolve(tempRoot, ".ogs", "user-profile.json"));
  await stat(path.resolve(tempRoot, ".ogs", "runs-index.json"));
  await stat(path.resolve(tempRoot, "profiles.json"));
  await stat(path.resolve(tempRoot, "tools.json"));
  await stat(path.resolve(tempRoot, "scripts", "console-print.mjs"));
  await stat(path.resolve(tempRoot, "scripts", "hello-ogsystem.mjs"));
  const initReadme = await readFile(initReadmePath, "utf8");
  const initProfiles = JSON.parse(await readFile(path.resolve(tempRoot, "profiles.json"), "utf8"));
  const initTools = JSON.parse(await readFile(path.resolve(tempRoot, "tools.json"), "utf8"));
  const initConsoleTool = await readFile(path.resolve(tempRoot, "scripts", "console-print.mjs"), "utf8");
  const initHelloTool = await readFile(path.resolve(tempRoot, "scripts", "hello-ogsystem.mjs"), "utf8");
  await assert.rejects(() => stat(path.resolve(tempRoot, ".ogs", "providers")), /ENOENT/);
  await stat(path.resolve(tempRoot, "system.mmd"));
  await stat(path.resolve(tempRoot, "og-roles", "README.md"));
  await assert.rejects(() => stat(path.resolve(tempRoot, "og-roles", "roles", "_shared")), /ENOENT/);
  await stat(path.resolve(tempRoot, "og-roles", "roles", "hello-ogsystem", "role.json"));
  await assert.rejects(() => stat(path.resolve(tempRoot, "og-roles", "roles", "demo-analyst")), /ENOENT/);
  await assert.rejects(() => stat(path.resolve(tempRoot, "og-roles", "roles", "debate-judge")), /ENOENT/);
  await assert.rejects(() => stat(path.resolve(tempRoot, "og-models")), /ENOENT/);
  assert.match(initReadme, /runtime\.json/);
  assert.match(initReadme, /model-selection\.json/);
  assert.match(initReadme, /profiles\.json/);
  assert.match(initReadme, /tools\.json/);
  assert.match(initReadme, /valid JSON with no comments/);
  assert.ok(initProfiles.some((entry) => entry?.profileId === "profile.console.print"));
  assert.ok(initProfiles.some((entry) => entry?.profileId === "profile.hello.ogsystem"));
  assert.ok(initTools.tools.some((entry) => entry?.toolRef === "tool.console.print"));
  assert.ok(initTools.tools.some((entry) => entry?.toolRef === "tool.hello.ogsystem"));
  assert.match(initConsoleTool, /console-print/);
  assert.match(initConsoleTool, /OGSYSTEM_ALLOWED_EVENTS/);
  assert.match(initHelloTool, /Hello OGSystem world/);

  const createResult = await runCli(["project", "create", "demo-app"], { cwd: tempRoot });
  assert.strictEqual(createResult.code, 0);
  const createPayload = JSON.parse(createResult.stdout);
  assert.equal(createPayload.command, "project create");
  assert.equal(createPayload.template, "minimal");
  const createdDir = createPayload.projectDir;
  await stat(path.resolve(createdDir, ".ogs", "runtime.json"));
  const createdReadmePath = path.resolve(createdDir, ".ogs", "README.md");
  await stat(path.resolve(createdDir, ".ogs", "model-catalog.json"));
  await stat(path.resolve(createdDir, ".ogs", "model-selection.json"));
  await stat(path.resolve(createdDir, ".ogs", "laws.json"));
  await stat(path.resolve(createdDir, ".ogs", "user-profile.json"));
  await stat(path.resolve(createdDir, "profiles.json"));
  await stat(path.resolve(createdDir, "tools.json"));
  await stat(path.resolve(createdDir, "scripts", "console-print.mjs"));
  await stat(path.resolve(createdDir, "scripts", "hello-ogsystem.mjs"));
  const createdReadme = await readFile(createdReadmePath, "utf8");
  const createdProfiles = JSON.parse(await readFile(path.resolve(createdDir, "profiles.json"), "utf8"));
  const createdTools = JSON.parse(await readFile(path.resolve(createdDir, "tools.json"), "utf8"));
  await assert.rejects(() => stat(path.resolve(createdDir, ".ogs", "providers")), /ENOENT/);
  await stat(path.resolve(createdDir, "system.mmd"));
  await assert.rejects(() => stat(path.resolve(createdDir, "og-roles", "roles", "_shared")), /ENOENT/);
  await stat(path.resolve(createdDir, "og-roles", "roles", "hello-ogsystem", "role.json"));
  await assert.rejects(() => stat(path.resolve(createdDir, "og-roles", "roles", "demo-analyst")), /ENOENT/);
  await assert.rejects(() => stat(path.resolve(createdDir, "og-models")), /ENOENT/);
  assert.match(createdReadme, /model-catalog\.json/);
  assert.match(createdReadme, /workspaceIsolation/);
  assert.ok(createdProfiles.some((entry) => entry?.profileId === "profile.console.print"));
  assert.ok(createdProfiles.some((entry) => entry?.profileId === "profile.hello.ogsystem"));
  assert.ok(createdTools.tools.some((entry) => entry?.toolRef === "tool.console.print"));
  assert.ok(createdTools.tools.some((entry) => entry?.toolRef === "tool.hello.ogsystem"));

  const helloStart = await runCli(
    ["run", "start", "--system", "system.mmd", "--input", "cli lifecycle hello world"],
    { cwd: createdDir }
  );
  assert.strictEqual(helloStart.code, 0, helloStart.stderr);
  const helloStartPayload = JSON.parse(helloStart.stdout);
  assert.equal(helloStartPayload.status, "done");
  assert.equal(helloStartPayload.finalRoleId, "hello-ogsystem");
  assert.equal(helloStartPayload.finalOutput, "Hello OGSystem world");

  await writeFile(
    path.resolve(createdDir, "system.mmd"),
    [
      "flowchart TD",
      "%% system.id=template.linear",
      "%% system.version=1.0.0",
      "%% law.global=law.console.base",
      "%% entry.role=debate-minimalist",
      "%% exec.bind.debate-minimalist=profile.console.print",
      "%% exec.bind.debate-judge=profile.console.print",
      "",
      "input -->|DEBATE_REQUEST| minimalist[Role:debate-minimalist]",
      "minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| judge[Role:debate-judge]",
      "judge[Role:debate-judge] -->|DECISION_READY| output",
      ""
    ].join("\n"),
    "utf8"
  );
  const syncResult = await runCli(["project", "sync", "--system", "system.mmd"], {
    cwd: createdDir
  });
  assert.strictEqual(syncResult.code, 0, syncResult.stderr);
  const syncPayload = JSON.parse(syncResult.stdout);
  assert.equal(syncPayload.command, "project sync");
  assert.deepEqual(syncPayload.importedRoleIds.sort(), ["debate-judge", "debate-minimalist"]);
  assert.deepEqual(syncPayload.importedModelIds.sort(), []);
  await stat(path.resolve(createdDir, "og-roles", "roles", "debate-minimalist", "role.json"));
  await stat(path.resolve(createdDir, "og-roles", "roles", "debate-judge", "role.json"));
  await assert.rejects(() => stat(path.resolve(createdDir, "og-models")), /ENOENT/);

  const startResult = await runCli(
    ["run", "start", "--system", "system.mmd", "--input", "cli lifecycle template", "--dry-run"],
    { cwd: createdDir }
  );
  assert.strictEqual(startResult.code, 0, startResult.stderr);
  const startPayload = JSON.parse(startResult.stdout);
  assert.equal(startPayload.status, "done");
});

test("lifecycle cli advanced-features template runs a local review rework loop", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-cli-advanced-template-"));

  const createResult = await runCli(
    ["project", "create", "advanced-app", "--template", "advanced-features"],
    { cwd: tempRoot }
  );
  assert.strictEqual(createResult.code, 0, createResult.stderr);
  const createPayload = JSON.parse(createResult.stdout);
  const projectDir = createPayload.projectDir;

  await stat(path.resolve(projectDir, "og-roles", "roles", "advanced-coordinator", "role.json"));
  await stat(path.resolve(projectDir, "og-roles", "roles", "advanced-worker-a", "role.json"));
  await stat(path.resolve(projectDir, "og-roles", "roles", "advanced-worker-b", "role.json"));
  await stat(path.resolve(projectDir, "og-roles", "roles", "advanced-reviewer", "role.json"));
  const reviewerSchemaSource = await readFile(path.resolve(projectDir, "og-roles", "roles", "advanced-reviewer", "output.schema.json"), "utf8");
  const reviewerAgentSource = await readFile(path.resolve(projectDir, "og-roles", "roles", "advanced-reviewer", "agent.md"), "utf8");
  const systemSource = await readFile(path.resolve(projectDir, "system.mmd"), "utf8");
  assert.match(reviewerSchemaSource, /"enum": \["REVIEW_READY", "REWORK"\]/);
  assert.match(reviewerAgentSource, /REVIEW_READY/);
  assert.match(reviewerAgentSource, /REWORK/);
  assert.match(systemSource, /%% role\.mode\.advanced-coordinator=parallel_split/);
  assert.match(systemSource, /%% loop\.max\.advanced-coordinator=2/);
  assert.match(systemSource, /%% join\.mode\.advanced-reviewer=all_of/);
  assert.match(systemSource, /%% context\.map\.advanced-reviewer\.worker_a_output=source\(advanced-worker-a\)\.content/);
  assert.match(systemSource, /%% context\.map\.advanced-coordinator\.review_comment=global\.human_review\.current\.comment\?/);
  assert.match(systemSource, /%% review\.mode\.advanced-reviewer=required/);
  assert.match(systemSource, /%% review\.rework\.target\.advanced-reviewer=advanced-coordinator/);
  assert.match(systemSource, /reviewer\[Role:advanced-reviewer\] -->\|REWORK\| coordinator\[Role:advanced-coordinator\]/);

  const start = await runCli(
    ["run", "start", "--system", "system.mmd", "--input", "advanced template review loop"],
    { cwd: projectDir }
  );
  assert.strictEqual(start.code, 0, start.stderr);
  const startPayload = JSON.parse(start.stdout);
  assert.equal(startPayload.status, "stopped");

  const list = await runCli(["run", "list", "--workdir", projectDir]);
  assert.strictEqual(list.code, 0);
  const runId = JSON.parse(list.stdout).runs[0].runId;

  const reviewList = await runCli(["run", "review", "list", runId, "--workdir", projectDir]);
  assert.strictEqual(reviewList.code, 0, reviewList.stderr);
  const reviewListPayload = JSON.parse(reviewList.stdout);
  const firstReviewId = reviewListPayload.latestPendingReviewId;
  assert.equal(typeof firstReviewId, "string");

  const rework = await runCli([
    "run",
    "review",
    "decide",
    runId,
    firstReviewId,
    "--decision",
    "rework",
    "--comment",
    "run one more loop",
    "--workdir",
    projectDir
  ]);
  assert.strictEqual(rework.code, 0, rework.stderr);

  const resumeAfterRework = await runCli(["run", "resume", runId, "--workdir", projectDir]);
  assert.strictEqual(resumeAfterRework.code, 0, resumeAfterRework.stderr);
  const resumeAfterReworkPayload = JSON.parse(resumeAfterRework.stdout);
  assert.equal(resumeAfterReworkPayload.status, "stopped");

  const statusAfterRework = await runCli(["run", "status", runId, "--workdir", projectDir]);
  assert.strictEqual(statusAfterRework.code, 0);
  const statusAfterReworkPayload = JSON.parse(statusAfterRework.stdout);
  assert.equal(statusAfterReworkPayload.status, "stopped");
  assert.equal(statusAfterReworkPayload.pendingReviewCount, 1);
  assert.equal(typeof statusAfterReworkPayload.latestPendingReviewId, "string");
  assert.notEqual(statusAfterReworkPayload.latestPendingReviewId, firstReviewId);

  const approve = await runCli([
    "run",
    "review",
    "decide",
    runId,
    statusAfterReworkPayload.latestPendingReviewId,
    "--decision",
    "approve",
    "--comment",
    "looks good",
    "--workdir",
    projectDir
  ]);
  assert.strictEqual(approve.code, 0, approve.stderr);

  const resumeAfterApprove = await runCli(["run", "resume", runId, "--workdir", projectDir]);
  assert.strictEqual(resumeAfterApprove.code, 0, resumeAfterApprove.stderr);
  const resumeAfterApprovePayload = JSON.parse(resumeAfterApprove.stdout);
  assert.equal(resumeAfterApprovePayload.status, "done");

  const finalStatus = await runCli(["run", "status", runId, "--workdir", projectDir]);
  assert.strictEqual(finalStatus.code, 0);
  const finalStatusPayload = JSON.parse(finalStatus.stdout);
  assert.equal(finalStatusPayload.status, "done");
  assert.equal(finalStatusPayload.pendingReviewCount, 0);
  assert.equal(finalStatusPayload.hasWaitingHumanReview, false);
});

test("lifecycle cli run start resolves --system relative to --workdir", { concurrency: false }, async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-cli-run-workdir-"));
  await seedRuntimeProject(tempRoot);
  await writeFile(
    path.resolve(tempRoot, "system.mmd"),
    [
      "flowchart TD",
      "%% system.id=test.cli.run.workdir.relative-system",
      "%% system.version=1.0.0",
      "%% law.global=law.console.base",
      "%% entry.role=debate-minimalist",
      "",
      "input -->|DEBATE_REQUEST| minimalist[Role:debate-minimalist]",
      "minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| judge[Role:debate-judge]",
      "judge[Role:debate-judge] -->|DECISION_READY| output"
    ].join("\n"),
    "utf8"
  );

  const result = await runCli(
    [
      "run",
      "start",
      "--system",
      "system.mmd",
      "--input",
      "relative workdir system path",
      "--dry-run",
      "--print-graph-link",
      "--workdir",
      tempRoot
    ],
    { cwd: repoRoot }
  );

  assert.strictEqual(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "done");
  assert.match(result.stderr, /\[graph\] Visual preview: https:\/\/mermaid\.live\/edit#base64:/);
});

test("lifecycle cli run start/list/status/logs/resume/stop works end-to-end", { concurrency: false }, async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-cli-run-"));
  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await writeFile(
    path.resolve(tempRoot, ".ogs", "runtime.json"),
    JSON.stringify(
      {
        configVersion: "2",
        executor: "opencode",
        roleRepo: path.resolve(repoRoot, "og-roles"),
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(tempRoot, ".ogs", "model-selection.json"),
    JSON.stringify(
      {
        configVersion: "1",
        defaults: {
          model: "opencode/gpt-5-nano",
          timeoutMs: 120000,
          maxOutputBytes: 65536
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(tempRoot, ".ogs", "model-catalog.json"),
    await readFile(path.resolve(repoRoot, ".ogs", "model-catalog.json"), "utf8"),
    "utf8"
  );
  await writeFile(
    path.resolve(tempRoot, ".ogs", "user-profile.json"),
    await readFile(path.resolve(repoRoot, ".ogs", "user-profile.json"), "utf8"),
    "utf8"
  );
  await writeFile(
    path.resolve(tempRoot, ".ogs", "laws.json"),
    await readFile(path.resolve(repoRoot, ".ogs", "laws.json"), "utf8"),
    "utf8"
  );
  await writeFile(
    path.resolve(tempRoot, ".ogs", "user-profile.json"),
    await readFile(path.resolve(repoRoot, ".ogs", "user-profile.json"), "utf8"),
    "utf8"
  );
  await writeFile(
    path.resolve(tempRoot, ".ogs", "laws.json"),
    await readFile(path.resolve(repoRoot, ".ogs", "laws.json"), "utf8"),
    "utf8"
  );

  const start = await runCli([
    "run",
    "start",
    "--system",
    path.resolve(repoRoot, "examples", "target-model-binding-system.mmd"),
    "--input",
    "cli lifecycle smoke",
    "--dry-run",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(start.code, 0);
  const startPayload = JSON.parse(start.stdout);
  assert.equal(startPayload.status, "done");

  const list = await runCli(["run", "list", "--workdir", tempRoot]);
  assert.strictEqual(list.code, 0);
  const listPayload = JSON.parse(list.stdout);
  assert.equal(Array.isArray(listPayload.runs), true);
  assert.equal(listPayload.runs.length, 1);
  const runId = listPayload.runs[0].runId;
  assert.match(runId, /^\d{8}-\d{6}-[a-f0-9]{8}$/);
  assert.equal(typeof listPayload.runs[0].durationMs, "number");
  assert.equal(typeof listPayload.runs[0].wallClockDurationMs, "number");
  assert.equal(typeof listPayload.runs[0].executionDurationMs, "number");
  assert.equal(typeof listPayload.runs[0].lastRoleId, "string");
  assert.equal(typeof listPayload.runs[0].finalRoleId, "string");
  assert.equal(listPayload.runs[0].lastErrorCode, undefined);
  assert.equal(listPayload.runs[0].stopReason, undefined);
  const runDir = path.resolve(tempRoot, ".ogs", "runs", runId);
  const summaryPath = path.resolve(runDir, "summary.json");
  const timelinePath = path.resolve(runDir, "timeline.jsonl");
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  assert.equal(summary.runId, runId);
  assert.equal(summary.status, "done");
  assert.equal(typeof summary.transitionCount, "number");
  assert.equal(typeof summary.executionDirCount, "number");
  assert.equal(typeof summary.durationMs, "number");
  assert.equal(typeof summary.wallClockDurationMs, "number");
  assert.equal(typeof summary.executionDurationMs, "number");
  assert.equal(summary.lastRoleId, listPayload.runs[0].lastRoleId);
  assert.equal(summary.finalRoleId, listPayload.runs[0].finalRoleId);
  assert.equal(summary.lastErrorCode, undefined);
  assert.equal(summary.stopReason, undefined);
  assert.equal(summary.artifactIndexSummary.roleCount > 0, true);
  assert.ok(summary.artifactIndexSummary.resumeConsumedPaths.includes("state.json"));
  assert.equal(typeof summary.okCount, "number");
  assert.equal(typeof summary.failedCount, "number");
  assert.equal(typeof summary.noopCount, "number");
  const timeline = (await readFile(timelinePath, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  assert.ok(timeline.length > 0);

  const status = await runCli(["run", "status", runId, "--workdir", tempRoot]);
  assert.strictEqual(status.code, 0);
  const statusPayload = JSON.parse(status.stdout);
  assert.equal(statusPayload.status, "done");
  assert.equal(statusPayload.summary.status, "done");
  assert.equal(typeof statusPayload.durationMs, "number");
  assert.equal(typeof statusPayload.wallClockDurationMs, "number");
  assert.equal(typeof statusPayload.executionDurationMs, "number");
  assert.equal(statusPayload.lastRoleId, listPayload.runs[0].lastRoleId);
  assert.equal(statusPayload.finalRoleId, listPayload.runs[0].finalRoleId);
  assert.equal(statusPayload.lastErrorCode, null);
  assert.equal(statusPayload.stopReason, null);
  assert.equal(statusPayload.stopOutcomeStatus, null);

  const logs = await runCli(["run", "logs", runId, "--engine", "--json", "--workdir", tempRoot]);
  assert.strictEqual(logs.code, 0);
  const logsPayload = JSON.parse(logs.stdout);
  assert.equal(Array.isArray(logsPayload), true);
  const textLogs = await runCli(["run", "logs", runId, "--engine", "--workdir", tempRoot]);
  assert.strictEqual(textLogs.code, 0);
  if (textLogs.stdout.trim()) {
    assert.doesNotMatch(textLogs.stdout, /^\s*\[/);
  }
  const ndjsonLogs = await runCli(["run", "logs", runId, "--engine", "--ndjson", "--workdir", tempRoot]);
  assert.strictEqual(ndjsonLogs.code, 0);
  if (ndjsonLogs.stdout.trim()) {
    assert.match(ndjsonLogs.stdout, /\{.*\}\n?/);
  }
  const tailLogs = await runCli([
    "run",
    "logs",
    runId,
    "--engine",
    "--json",
    "--tail",
    "1",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(tailLogs.code, 0);
  const tailLogsPayload = JSON.parse(tailLogs.stdout);
  assert.equal(Array.isArray(tailLogsPayload), true);
  assert.ok(tailLogsPayload.length <= 1);
  const sinceLogs = await runCli([
    "run",
    "logs",
    runId,
    "--engine",
    "--json",
    "--since",
    summary.updatedAt,
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(sinceLogs.code, 0);
  const sinceLogsPayload = JSON.parse(sinceLogs.stdout);
  assert.equal(Array.isArray(sinceLogsPayload), true);
  const invalidSinceLogs = await runCli([
    "run",
    "logs",
    runId,
    "--engine",
    "--since",
    "not-a-date",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(invalidSinceLogs.code, 1);
  assert.match(invalidSinceLogs.stderr, /Invalid --since timestamp: not-a-date/);
  const followLogs = await runCli([
    "run",
    "logs",
    runId,
    "--engine",
    "--follow",
    "--tail",
    "1",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(followLogs.code, 0);
  const followJsonLogs = await runCli([
    "run",
    "logs",
    runId,
    "--engine",
    "--follow",
    "--json",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(followJsonLogs.code, 1);
  assert.match(followJsonLogs.stderr, /--json cannot be used with --follow/);

  const resume = await runCli(["run", "resume", runId, "--dry-run", "--workdir", tempRoot]);
  assert.strictEqual(resume.code, 0);
  const resumePayload = JSON.parse(resume.stdout);
  assert.equal(resumePayload.status, "done");

  const statePath = path.resolve(runDir, "state.json");
  const tamperedState = JSON.parse(await readFile(statePath, "utf8"));
  tamperedState.status = "failed";
  tamperedState.graphState.status = "failed";
  await writeFile(statePath, JSON.stringify(tamperedState, null, 2), "utf8");

  const statusAfterTamper = await runCli(["run", "status", runId, "--workdir", tempRoot]);
  assert.strictEqual(statusAfterTamper.code, 0);
  const statusAfterTamperPayload = JSON.parse(statusAfterTamper.stdout);
  assert.equal(statusAfterTamperPayload.status, "done");

  const listAfterTamper = await runCli(["run", "list", "--workdir", tempRoot]);
  assert.strictEqual(listAfterTamper.code, 0);
  const listAfterTamperPayload = JSON.parse(listAfterTamper.stdout);
  assert.equal(listAfterTamperPayload.runs[0].status, "done");

  const stop = await runCli(["run", "stop", runId, "--workdir", tempRoot]);
  assert.strictEqual(stop.code, 0);
  const stopPayload = JSON.parse(stop.stdout);
  assert.equal(stopPayload.runId, runId);
  const stopRequestPath = path.resolve(tempRoot, ".ogs", "runs", runId, "control", "stop-request.json");
  await stat(stopRequestPath);
});

test("lifecycle cli review commands expose pending human review state and can approve resume", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-cli-review-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");

  await seedRuntimeProject(tempRoot);
  await writeFile(
    systemPath,
    [
      "flowchart TD",
      "%% system.id=cli.review.demo",
      "%% system.version=1.0.0",
      "%% law.global=law.console.base",
      "%% entry.role=test-operator",
      "%% model.bind.test-operator=balanced-gpt52",
      "%% review.mode.test-operator=required",
      "",
      "input -->|GO| operator[Role:test-operator]",
      "operator[Role:test-operator] -->|DONE| output",
      ""
    ].join("\n"),
    "utf8"
  );

  const start = await runCli([
    "run",
    "start",
    "--system",
    systemPath,
    "--input",
    "cli review flow",
    "--dry-run",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(start.code, 0, start.stderr);
  const startPayload = JSON.parse(start.stdout);
  assert.equal(startPayload.status, "stopped");
  const list = await runCli(["run", "list", "--workdir", tempRoot]);
  assert.strictEqual(list.code, 0);
  const listPayload = JSON.parse(list.stdout);
  assert.equal(listPayload.runs.length, 1);
  const runId = listPayload.runs[0].runId;
  const status = await runCli(["run", "status", runId, "--workdir", tempRoot]);
  assert.strictEqual(status.code, 0);
  const statusPayload = JSON.parse(status.stdout);
  assert.equal(statusPayload.status, "stopped");
  assert.equal(statusPayload.pendingReviewCount, 1);
  assert.equal(statusPayload.latestPendingReviewId, "review.test-operator@1#1.r1");
  assert.equal(statusPayload.hasWaitingHumanReview, true);

  const inspect = await runCli(["run", "inspect", runId, "--workdir", tempRoot]);
  assert.strictEqual(inspect.code, 0);
  const inspectPayload = JSON.parse(inspect.stdout);
  assert.equal(inspectPayload.pendingReviewCount, 1);
  assert.equal(inspectPayload.hasWaitingHumanReview, true);

  const reviewList = await runCli(["run", "review", "list", runId, "--workdir", tempRoot]);
  assert.strictEqual(reviewList.code, 0);
  const reviewListPayload = JSON.parse(reviewList.stdout);
  assert.equal(reviewListPayload.reviews.length, 1);
  assert.equal(reviewListPayload.reviews[0].reviewId, "review.test-operator@1#1.r1");
  assert.equal(reviewListPayload.latestPendingReviewId, "review.test-operator@1#1.r1");
  assert.equal(reviewListPayload.reviews[0].currentStatus, "pending");
  assert.equal(reviewListPayload.reviews[0].requestSnapshot.status, "pending");

  const reviewInspect = await runCli([
    "run",
    "review",
    "inspect",
    runId,
    "review.test-operator@1#1.r1",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(reviewInspect.code, 0);
  const reviewInspectPayload = JSON.parse(reviewInspect.stdout);
  assert.equal(reviewInspectPayload.currentStatus, "pending");
  assert.equal(reviewInspectPayload.currentState.status, "pending");
  assert.equal(reviewInspectPayload.requestSnapshot.reviewId, "review.test-operator@1#1.r1");

  const decide = await runCli([
    "run",
    "review",
    "decide",
    runId,
    "review.test-operator@1#1.r1",
    "--decision",
    "approve",
    "--actor",
    "tester",
    "--comment",
    "approved",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(decide.code, 0);
  const decidePayload = JSON.parse(decide.stdout);
  assert.equal(decidePayload.decision.decision, "approve");

  const resume = await runCli(["run", "resume", runId, "--dry-run", "--workdir", tempRoot]);
  assert.strictEqual(resume.code, 0, resume.stderr);
  const resumePayload = JSON.parse(resume.stdout);
  assert.equal(resumePayload.status, "done");

  const statusAfterResume = await runCli(["run", "status", runId, "--workdir", tempRoot]);
  assert.strictEqual(statusAfterResume.code, 0);
  const statusAfterResumePayload = JSON.parse(statusAfterResume.stdout);
  assert.equal(statusAfterResumePayload.status, "done");
  assert.equal(statusAfterResumePayload.pendingReviewCount, 0);
  assert.equal(statusAfterResumePayload.latestPendingReviewId, undefined);
  assert.equal(statusAfterResumePayload.hasWaitingHumanReview, false);

  const reviewInspectAfterResume = await runCli([
    "run",
    "review",
    "inspect",
    runId,
    "review.test-operator@1#1.r1",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(reviewInspectAfterResume.code, 0);
  const reviewInspectAfterResumePayload = JSON.parse(reviewInspectAfterResume.stdout);
  assert.equal(reviewInspectAfterResumePayload.currentStatus, "resolved");
  assert.equal(reviewInspectAfterResumePayload.currentState.status, "resolved");
  assert.equal(reviewInspectAfterResumePayload.decisionSnapshot.decision, "approve");
});

test("lifecycle cli review commands preserve paused status and allow a later approve on the same review", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-cli-review-pause-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");

  await seedRuntimeProject(tempRoot);
  await writeFile(
    systemPath,
    [
      "flowchart TD",
      "%% system.id=cli.review.pause",
      "%% system.version=1.0.0",
      "%% law.global=law.console.base",
      "%% entry.role=test-operator",
      "%% model.bind.test-operator=balanced-gpt52",
      "%% review.mode.test-operator=required",
      "",
      "input -->|GO| operator[Role:test-operator]",
      "operator[Role:test-operator] -->|DONE| output",
      ""
    ].join("\n"),
    "utf8"
  );

  const start = await runCli([
    "run",
    "start",
    "--system",
    systemPath,
    "--input",
    "cli review pause flow",
    "--dry-run",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(start.code, 0, start.stderr);

  const list = await runCli(["run", "list", "--workdir", tempRoot]);
  assert.strictEqual(list.code, 0);
  const runId = JSON.parse(list.stdout).runs[0].runId;
  const reviewId = "review.test-operator@1#1.r1";

  const pause = await runCli([
    "run",
    "review",
    "decide",
    runId,
    reviewId,
    "--decision",
    "pause",
    "--comment",
    "hold",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(pause.code, 0, pause.stderr);

  const resumeAfterPause = await runCli(["run", "resume", runId, "--dry-run", "--workdir", tempRoot]);
  assert.strictEqual(resumeAfterPause.code, 0, resumeAfterPause.stderr);
  const pausedStatus = await runCli(["run", "status", runId, "--workdir", tempRoot]);
  assert.strictEqual(pausedStatus.code, 0);
  const pausedStatusPayload = JSON.parse(pausedStatus.stdout);
  assert.equal(pausedStatusPayload.status, "stopped");
  assert.equal(pausedStatusPayload.latestPendingReviewId, reviewId);

  const pausedInspect = await runCli([
    "run",
    "review",
    "inspect",
    runId,
    reviewId,
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(pausedInspect.code, 0);
  const pausedInspectPayload = JSON.parse(pausedInspect.stdout);
  assert.equal(pausedInspectPayload.currentStatus, "paused");
  assert.equal(pausedInspectPayload.currentState.status, "paused");
  assert.equal(pausedInspectPayload.decisionSnapshot.decision, "pause");

  const approve = await runCli([
    "run",
    "review",
    "decide",
    runId,
    reviewId,
    "--decision",
    "approve",
    "--comment",
    "approved after hold",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(approve.code, 0, approve.stderr);

  const resumeAfterApprove = await runCli(["run", "resume", runId, "--dry-run", "--workdir", tempRoot]);
  assert.strictEqual(resumeAfterApprove.code, 0, resumeAfterApprove.stderr);
  const finalStatus = await runCli(["run", "status", runId, "--workdir", tempRoot]);
  assert.strictEqual(finalStatus.code, 0);
  const finalStatusPayload = JSON.parse(finalStatus.stdout);
  assert.equal(finalStatusPayload.status, "done");
  assert.equal(finalStatusPayload.latestPendingReviewId, undefined);

  const resolvedInspect = await runCli([
    "run",
    "review",
    "inspect",
    runId,
    reviewId,
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(resolvedInspect.code, 0);
  const resolvedInspectPayload = JSON.parse(resolvedInspect.stdout);
  assert.equal(resolvedInspectPayload.currentStatus, "resolved");
  assert.equal(resolvedInspectPayload.currentState.status, "resolved");
  assert.equal(resolvedInspectPayload.decisionSnapshot.decision, "approve");
});

test("lifecycle cli review status normalization tracks rework rounds and rejects stale or invalid decisions", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-cli-review-rework-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");

  await seedRuntimeProject(tempRoot);
  await writeFile(
    systemPath,
    [
      "flowchart TD",
      "%% system.id=cli.review.rework",
      "%% system.version=1.0.0",
      "%% law.global=law.console.base",
      "%% entry.role=test-operator",
      "%% model.bind.test-operator=balanced-gpt52",
      "%% review.mode.test-operator=required",
      "%% review.rework.target.test-operator=test-operator",
      "",
      "input -->|GO| operator[Role:test-operator]",
      "operator[Role:test-operator] -->|DONE| output",
      ""
    ].join("\n"),
    "utf8"
  );

  const start = await runCli([
    "run",
    "start",
    "--system",
    systemPath,
    "--input",
    "cli review rework flow",
    "--dry-run",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(start.code, 0, start.stderr);

  const list = await runCli(["run", "list", "--workdir", tempRoot]);
  assert.strictEqual(list.code, 0);
  const runId = JSON.parse(list.stdout).runs[0].runId;
  const firstReviewId = "review.test-operator@1#1.r1";

  const rework = await runCli([
    "run",
    "review",
    "decide",
    runId,
    firstReviewId,
    "--decision",
    "rework",
    "--comment",
    "needs another pass",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(rework.code, 0, rework.stderr);

  const resume = await runCli(["run", "resume", runId, "--dry-run", "--workdir", tempRoot]);
  assert.strictEqual(resume.code, 0, resume.stderr);

  const statusAfterRework = await runCli(["run", "status", runId, "--workdir", tempRoot]);
  assert.strictEqual(statusAfterRework.code, 0);
  const statusAfterReworkPayload = JSON.parse(statusAfterRework.stdout);
  assert.equal(statusAfterReworkPayload.status, "stopped");
  assert.equal(typeof statusAfterReworkPayload.latestPendingReviewId, "string");
  assert.notEqual(statusAfterReworkPayload.latestPendingReviewId, firstReviewId);

  const firstReviewInspect = await runCli([
    "run",
    "review",
    "inspect",
    runId,
    firstReviewId,
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(firstReviewInspect.code, 0);
  const firstReviewInspectPayload = JSON.parse(firstReviewInspect.stdout);
  assert.equal(firstReviewInspectPayload.currentStatus, "resolved");
  assert.equal(firstReviewInspectPayload.requestSnapshot.status, "pending");
  assert.equal(firstReviewInspectPayload.currentState.status, "resolved");
  assert.equal(firstReviewInspectPayload.decisionSnapshot.decision, "rework");

  const staleDecision = await runCli([
    "run",
    "review",
    "decide",
    runId,
    firstReviewId,
    "--decision",
    "approve",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(staleDecision.code, 1);
  assert.match(staleDecision.stderr, /already resolved/);

  const missingReview = await runCli([
    "run",
    "review",
    "decide",
    runId,
    "review.missing",
    "--decision",
    "approve",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(missingReview.code, 1);
  assert.match(missingReview.stderr, /Review not found/);

  const invalidScope = await runCli([
    "run",
    "review",
    "decide",
    runId,
    statusAfterReworkPayload.latestPendingReviewId,
    "--decision",
    "approve",
    "--scope",
    "run",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(invalidScope.code, 1);
  assert.match(invalidScope.stderr, /only valid with --decision terminate/);

  const invalidTerminateScope = await runCli([
    "run",
    "review",
    "decide",
    runId,
    statusAfterReworkPayload.latestPendingReviewId,
    "--decision",
    "terminate",
    "--scope",
    "invalid",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(invalidTerminateScope.code, 1);
  assert.match(invalidTerminateScope.stderr, /invalid --scope value/);
});

test("lifecycle cli modern run failures print modern resume hints and reject removed hidden flags", { concurrency: false }, async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-cli-modern-failure-"));
  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await writeFile(
    path.resolve(tempRoot, ".ogs", "runtime.json"),
    JSON.stringify(
      {
        configVersion: "2",
        executor: "opencode",
        roleRepo: path.resolve(repoRoot, "og-roles"),
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(tempRoot, ".ogs", "model-selection.json"),
    await readFile(path.resolve(repoRoot, ".ogs", "model-selection.json"), "utf8"),
    "utf8"
  );
  await writeFile(
    path.resolve(tempRoot, ".ogs", "model-catalog.json"),
    await readFile(path.resolve(repoRoot, ".ogs", "model-catalog.json"), "utf8"),
    "utf8"
  );

  const modernInputError = await runCli([
    "run",
    "start",
    "--system",
    path.resolve(repoRoot, "examples", "target-model-binding-system.mmd"),
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(modernInputError.code, 1);
  assert.match(modernInputError.stderr, /run start requires --system and --input/);
  assert.doesNotMatch(modernInputError.stderr, /\[hint\]/);

  const hiddenProfiles = await runCli([
    "run",
    "start",
    "--system",
    path.resolve(repoRoot, "examples", "target-model-binding-system.mmd"),
    "--input",
    "reject hidden profiles",
    "--profiles",
    "profiles.json",
    "--dry-run",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(hiddenProfiles.code, 1);
  assert.match(hiddenProfiles.stderr, /--profiles/);
  assert.match(hiddenProfiles.stderr, /errorCode=CLI_INVALID_ARGS/);

  const hiddenLogRun = await runCli([
    "run",
    "start",
    "--system",
    path.resolve(repoRoot, "examples", "target-model-binding-system.mmd"),
    "--input",
    "reject hidden log run",
    "--log-run",
    "--dry-run",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(hiddenLogRun.code, 1);
  assert.match(hiddenLogRun.stderr, /--log-run/);
  assert.match(hiddenLogRun.stderr, /errorCode=CLI_INVALID_ARGS/);

  const failedStart = await runCli([
    "run",
    "start",
    "--system",
    path.resolve(repoRoot, "examples", "target-model-binding-system.mmd"),
    "--input",
    "modern resume hint",
    "--dry-run",
    "--workdir",
    tempRoot
  ], {
    env: {
      OGSYSTEM_TEST_FORCE_RUNTIME_ERROR_AFTER_SETUP: "1"
    }
  });
  assert.strictEqual(failedStart.code, 1);
  assert.match(failedStart.stderr, /Forced runtime error after setup for CLI regression coverage/);
  const failedStartRunId = failedStart.stderr.match(/runId=(\d{8}-\d{6}-[a-f0-9]{8})/)?.[1];
  assert.ok(failedStartRunId, failedStart.stderr);
  assert.match(failedStart.stderr, new RegExp(String.raw`\[hint\] ogs run resume '${failedStartRunId}'`));
  assert.match(failedStart.stderr, /--dry-run/);
  assert.doesNotMatch(failedStart.stderr, /--resume-run/);
  assert.doesNotMatch(failedStart.stderr, /--profiles/);
  assert.doesNotMatch(failedStart.stderr, /--tools/);
  assert.doesNotMatch(failedStart.stderr, /--visualizer-port/);

  const hiddenTools = await runCli([
    "run",
    "resume",
    failedStartRunId,
    "--tools",
    "tools.json",
    "--workdir",
    tempRoot
  ]);
  assert.strictEqual(hiddenTools.code, 1);
  assert.match(hiddenTools.stderr, /--tools/);
  assert.match(hiddenTools.stderr, /errorCode=CLI_INVALID_ARGS/);

  const failedResume = await runCli([
    "run",
    "resume",
    failedStartRunId,
    "--dry-run",
    "--workdir",
    tempRoot
  ], {
    env: {
      OGSYSTEM_TEST_FORCE_RUNTIME_ERROR_AFTER_SETUP: "1"
    }
  });
  assert.strictEqual(failedResume.code, 1);
  assert.match(failedResume.stderr, /Forced runtime error after setup for CLI regression coverage/);
  assert.match(failedResume.stderr, new RegExp(String.raw`\[hint\] ogs run resume '${failedStartRunId}'`));
  assert.match(failedResume.stderr, /--dry-run/);
  assert.doesNotMatch(failedResume.stderr, /--resume-run/);
  assert.doesNotMatch(failedResume.stderr, /--profiles/);
  assert.doesNotMatch(failedResume.stderr, /--tools/);
});
