import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

const runtimeCliPath = path.resolve("dist/runtime/cli.js");
const nl2mmdCliPath = path.resolve("dist/nl2mmd/cli.js");

function runNodeCli(cliPath, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [cliPath, ...args], {
      cwd,
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

test("ogs help command surfaces layered guidance", async () => {
  const rootHelp = await runNodeCli(runtimeCliPath, ["help"]);
  assert.strictEqual(rootHelp.code, 0);
  assert.match(rootHelp.stdout, /ogs help \[project\|run\|visualizer\]/);
  assert.match(rootHelp.stdout, /ogs help run logs/);
  assert.match(rootHelp.stdout, /ogs project create --help/);
  assert.match(rootHelp.stdout, /project commands use the current directory/);
  assert.match(rootHelp.stdout, /ogs visualizer \[--workdir <path>\] \[--host <host>\] \[--port <n\|0>\]/);

  const projectHelp = await runNodeCli(runtimeCliPath, ["help", "project"]);
  assert.strictEqual(projectHelp.code, 0);
  assert.match(projectHelp.stdout, /ogs project init \[options\]/);
  assert.match(projectHelp.stdout, /ogs project sync-models \[options\]/);
  assert.match(projectHelp.stdout, /ogs project init --help/);

  const projectInitHelp = await runNodeCli(runtimeCliPath, ["project", "init", "--help"]);
  assert.strictEqual(projectInitHelp.code, 0);
  assert.match(
    projectInitHelp.stdout,
    /ogs project init \[--template <empty\|minimal\|software-dev\|consultation>\] \[--workdir <path>\]/
  );
  assert.match(projectInitHelp.stdout, /Template to scaffold \(default: minimal\)/);

  const runHelp = await runNodeCli(runtimeCliPath, ["run", "--help"]);
  assert.strictEqual(runHelp.code, 0);
  assert.match(runHelp.stdout, /ogs run start --system <file\.mmd> --input <text> \[options\]/);
  assert.match(runHelp.stdout, /ogs run logs <run-id> \[options\]/);
  assert.match(runHelp.stdout, /ogs run logs --help/);

  const runStartHelp = await runNodeCli(runtimeCliPath, ["run", "start", "--help"]);
  assert.strictEqual(runStartHelp.code, 0);
  assert.match(runStartHelp.stdout, /--host <host>          Visualizer bind host/);
  assert.match(runStartHelp.stdout, /--port <n\|0>           Visualizer bind port/);
  assert.doesNotMatch(runStartHelp.stdout, /visualizer-port/);
  assert.doesNotMatch(runStartHelp.stdout, /--profiles/);
  assert.doesNotMatch(runStartHelp.stdout, /--tools/);
  assert.doesNotMatch(runStartHelp.stdout, /--log-run/);

  const runLogsHelp = await runNodeCli(runtimeCliPath, ["run", "logs", "--help"]);
  assert.strictEqual(runLogsHelp.code, 0);
  assert.match(runLogsHelp.stdout, /--json          Emit one JSON array/);
  assert.match(runLogsHelp.stdout, /--ndjson        Emit one JSON object per line/);
  assert.match(runLogsHelp.stdout, /default text    human-readable one-line summaries/);

  const runResumeHelp = await runNodeCli(runtimeCliPath, ["run", "resume", "--help"]);
  assert.strictEqual(runResumeHelp.code, 0);
  assert.doesNotMatch(runResumeHelp.stdout, /--profiles/);
  assert.doesNotMatch(runResumeHelp.stdout, /--tools/);
  assert.doesNotMatch(runResumeHelp.stdout, /--log-run/);

  const visualizerHelp = await runNodeCli(runtimeCliPath, ["visualizer", "--help"]);
  assert.strictEqual(visualizerHelp.code, 0);
  assert.match(visualizerHelp.stdout, /ogs visualizer \[--workdir <path>\] \[--host <host>\] \[--port <n\|0>\]/);
  assert.match(visualizerHelp.stdout, /read-only OGSystem run visualizer/);

  const version = await runNodeCli(runtimeCliPath, ["--version"]);
  assert.strictEqual(version.code, 0);
  assert.match(version.stdout, /^ogs \d+\.\d+\.\d+\s*$/);
});

test("nl2mmd help command highlights base entrypoint and defaults", async () => {
  const help = await runNodeCli(nl2mmdCliPath, ["--help"]);
  assert.strictEqual(help.code, 0);
  assert.match(help.stdout, /ogs-nl2mmd \[--message <text>\] \[--model <provider\/model>\]/);
  assert.match(
    help.stdout,
    /pnpm run run:nl2mmd -- \[--message <text>\] \[--model <provider\/model>\]/
  );
  assert.match(help.stdout, /Base command:/);
  assert.match(help.stdout, /workdir defaults to the current directory/);
  assert.match(help.stdout, /Interactive commands:/);
});
