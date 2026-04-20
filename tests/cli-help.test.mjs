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
  assert.match(rootHelp.stdout, /ogs help \[project\|run\|legacy\|visualizer\]/);
  assert.match(rootHelp.stdout, /project commands use the current directory/);
  assert.match(rootHelp.stdout, /Legacy entrypoint:/);
  assert.match(rootHelp.stdout, /ogs --system <file\.mmd> --prompt <text> \[options\]/);
  assert.match(rootHelp.stdout, /ogs visualizer \[--workdir <path>\] \[--host <host>\] \[--port <n\|0>\]/);

  const projectHelp = await runNodeCli(runtimeCliPath, ["help", "project"]);
  assert.strictEqual(projectHelp.code, 0);
  assert.match(
    projectHelp.stdout,
    /ogs project init \[--template <minimal\|software-dev\|consultation>\] \[--workdir <path>\]/
  );
  assert.match(projectHelp.stdout, /ogs project sync --system <file\.mmd> \[--workdir <path>\]/);
  assert.match(projectHelp.stdout, /templates are intentionally limited/);

  const runHelp = await runNodeCli(runtimeCliPath, ["run", "--help"]);
  assert.strictEqual(runHelp.code, 0);
  assert.match(runHelp.stdout, /ogs run start --system <file\.mmd> --prompt <text> \[options\]/);
  assert.match(runHelp.stdout, /--workdir <path>           Working directory \(default: cwd\)/);
  assert.match(runHelp.stdout, /--visualize                Start a temporary visualizer server for this run/);
  assert.match(runHelp.stdout, /--quiet-run                Disable stderr run progress logs/);

  const visualizerHelp = await runNodeCli(runtimeCliPath, ["visualizer", "--help"]);
  assert.strictEqual(visualizerHelp.code, 0);
  assert.match(visualizerHelp.stdout, /ogs visualizer \[--workdir <path>\] \[--host <host>\] \[--port <n\|0>\]/);
  assert.match(visualizerHelp.stdout, /read-only OGSystem run visualizer/);
});

test("nl2mmd help command highlights base entrypoint and defaults", async () => {
  const help = await runNodeCli(nl2mmdCliPath, ["--help"]);
  assert.strictEqual(help.code, 0);
  assert.match(help.stdout, /ogs-nl2mmd \[--message <text>\] \[--model <modelId>\]/);
  assert.match(help.stdout, /pnpm run run:nl2mmd -- \[--message <text>\] \[--model <modelId>\]/);
  assert.match(help.stdout, /Base command:/);
  assert.match(help.stdout, /workdir defaults to the current directory/);
  assert.match(help.stdout, /Interactive commands:/);
});
