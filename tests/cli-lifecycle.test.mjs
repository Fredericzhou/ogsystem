import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const cliPath = path.resolve("dist/runtime/cli.js");

function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [cliPath, ...args], {
      cwd: options.cwd ?? process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
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

test("lifecycle cli project init/create commands scaffold project control plane", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-cli-project-"));

  const initResult = await runCli(["project", "init"], { cwd: tempRoot });
  assert.strictEqual(initResult.code, 0);
  const initPayload = JSON.parse(initResult.stdout);
  assert.equal(initPayload.command, "project init");
  assert.equal(initPayload.template, "minimal");
  await stat(path.resolve(tempRoot, ".ogs", "runtime.json"));
  await stat(path.resolve(tempRoot, ".ogs", "project.json"));
  await stat(path.resolve(tempRoot, ".ogs", "laws.json"));
  await stat(path.resolve(tempRoot, ".ogs", "user-profile.json"));
  await stat(path.resolve(tempRoot, ".ogs", "runs-index.json"));
  await stat(path.resolve(tempRoot, "system.mmd"));
  await stat(path.resolve(tempRoot, "og-roles", "README.md"));
  await stat(path.resolve(tempRoot, "og-roles", "roles", "_shared", "input.schema.json"));
  await stat(path.resolve(tempRoot, "og-roles", "roles", "demo-analyst", "role.json"));
  await assert.rejects(() => stat(path.resolve(tempRoot, "og-roles", "roles", "debate-judge")), /ENOENT/);
  await stat(path.resolve(tempRoot, "og-models", "README.md"));
  await stat(path.resolve(tempRoot, "og-models", "catalog", "opencode-models.json"));
  await stat(path.resolve(tempRoot, "og-models", "models", "general-balanced", "model.json"));
  await assert.rejects(() => stat(path.resolve(tempRoot, "og-models", "models", "general-fast")), /ENOENT/);

  const createResult = await runCli(
    ["project", "create", "demo-app", "--template", "minimal"],
    { cwd: tempRoot }
  );
  assert.strictEqual(createResult.code, 0);
  const createPayload = JSON.parse(createResult.stdout);
  assert.equal(createPayload.command, "project create");
  const createdDir = createPayload.projectDir;
  await stat(path.resolve(createdDir, ".ogs", "runtime.json"));
  await stat(path.resolve(createdDir, ".ogs", "laws.json"));
  await stat(path.resolve(createdDir, ".ogs", "user-profile.json"));
  await stat(path.resolve(createdDir, "system.mmd"));
  await stat(path.resolve(createdDir, "og-roles", "roles", "demo-analyst", "role.json"));
  await assert.rejects(() => stat(path.resolve(createdDir, "og-roles", "roles", "debate-judge")), /ENOENT/);
  await stat(path.resolve(createdDir, "og-models", "models", "general-balanced", "model.json"));
  await assert.rejects(() => stat(path.resolve(createdDir, "og-models", "models", "general-fast")), /ENOENT/);

  const startResult = await runCli(
    ["run", "start", "--system", "system.mmd", "--input", "cli lifecycle template", "--dry-run"],
    { cwd: createdDir }
  );
  assert.strictEqual(startResult.code, 0, startResult.stderr);
  const startPayload = JSON.parse(startResult.stdout);
  assert.equal(startPayload.status, "done");

  await writeFile(
    path.resolve(createdDir, "system.mmd"),
    [
      "flowchart TD",
      "%% system.id=template.software-dev",
      "%% system.version=1.0.0",
      "%% law.global=law.software-dev.base",
      "%% entry.role=demo-intake",
      "%% role.mode.demo-intake=parallel_split",
      "%% join.mode.test-operator=all_of",
      "%% join.sources.test-operator=test-branch-a,test-branch-b",
      "%% model.bind.demo-intake=general-fast",
      "%% model.bind.test-branch-a=general-balanced",
      "%% model.bind.test-branch-b=general-balanced",
      "%% model.bind.test-operator=general-steady",
      "",
      "input -->|TASK_IN| intake[Role:demo-intake]",
      "intake[Role:demo-intake] -->|BRANCH_A| brancha[Role:test-branch-a]",
      "intake[Role:demo-intake] -->|BRANCH_B| branchb[Role:test-branch-b]",
      "brancha[Role:test-branch-a] -->|A_DONE| testop[Role:test-operator]",
      "branchb[Role:test-branch-b] -->|B_DONE| testop[Role:test-operator]",
      "testop[Role:test-operator] -->|RESULT_READY| output",
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
  assert.deepEqual(syncPayload.importedRoleIds.sort(), ["demo-intake", "test-branch-a", "test-branch-b", "test-operator"]);
  assert.deepEqual(syncPayload.importedModelIds.sort(), ["general-fast", "general-steady"]);
  await stat(path.resolve(createdDir, "og-roles", "roles", "demo-intake", "role.json"));
  await stat(path.resolve(createdDir, "og-roles", "roles", "test-branch-a", "role.json"));
  await stat(path.resolve(createdDir, "og-models", "models", "general-fast", "model.json"));
  await stat(path.resolve(createdDir, "og-models", "models", "general-steady", "model.json"));
});

test("lifecycle cli run start/list/status/logs/resume/stop works end-to-end", { concurrency: false }, async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-cli-run-"));
  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await writeFile(
    path.resolve(tempRoot, ".ogs", "runtime.json"),
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: path.resolve(repoRoot, "og-roles"),
        modelRepo: path.resolve(repoRoot, "og-models"),
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
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
  const runDir = path.resolve(tempRoot, ".ogs", "runs", runId);
  const summaryPath = path.resolve(runDir, "summary.json");
  const timelinePath = path.resolve(runDir, "timeline.jsonl");
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  assert.equal(summary.runId, runId);
  assert.equal(summary.status, "done");
  assert.equal(typeof summary.transitionCount, "number");
  assert.equal(typeof summary.executionDirCount, "number");
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

  const logs = await runCli(["run", "logs", runId, "--engine", "--json", "--workdir", tempRoot]);
  assert.strictEqual(logs.code, 0);
  const logsPayload = JSON.parse(logs.stdout);
  assert.equal(Array.isArray(logsPayload), true);
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
