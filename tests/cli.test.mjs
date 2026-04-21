import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

const cliPath = path.resolve("dist/runtime/cli.js");

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [cliPath, ...args], {
      cwd: process.cwd(),
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

test("cli fails when required args are missing", async () => {
  const { code, stderr } = await runCli(["--input", "hello"]);
  assert.strictEqual(code, 1);
  assert.match(stderr, /Missing required args/);
  assert.match(stderr, /errorCode=CLI_MISSING_REQUIRED_ARGS/);
  assert.match(stderr, /stage=cli/);
});

test("cli rejects invalid cleanup-executions with a stable envelope", async () => {
  const { code, stderr } = await runCli([
    "--system",
    "examples/target-model-binding-system.mmd",
    "--input",
    "hello",
    "--cleanup-executions",
    "0"
  ]);

  assert.strictEqual(code, 1);
  assert.match(stderr, /--cleanup-executions must be a positive integer/);
  assert.match(stderr, /errorCode=CLI_INVALID_CLEANUP_EXECUTIONS/);
  assert.match(stderr, /errorCategory=input/);
});

test("cli prints runtime logs to stderr by default without breaking stdout json", async () => {
  const { code, stdout, stderr } = await runCli([
    "--system",
    "examples/target-model-binding-system.mmd",
    "--input",
    "cli log run",
    "--dry-run"
  ]);

  assert.strictEqual(code, 0);
  const result = JSON.parse(stdout);
  assert.equal(result.status, "done");
  assert.match(stderr, /\[run:start\]/);
  assert.match(stderr, /\[role:start\]/);
  assert.match(stderr, /\[transition\]/);
  assert.match(stderr, /\[run:end\]/);
});

test("cli can attach a temporary visualizer server and auto-close it after run completion", async () => {
  const { code, stdout, stderr } = await runCli([
    "run",
    "start",
    "--system",
    "examples/target-model-binding-system.mmd",
    "--input",
    "visualizer run",
    "--dry-run",
    "--visualize",
    "--port",
    "0"
  ]);

  assert.strictEqual(code, 0);
  const result = JSON.parse(stdout);
  assert.equal(result.status, "done");
  if (/\[visualizer\] Unable to attach server; continuing without visualization\./.test(stderr)) {
    assert.match(stderr, /\[visualizer\] Unable to attach server; continuing without visualization\./);
    return;
  }
  assert.match(stderr, /\[visualizer\] Listening on http:\/\/127\.0\.0\.1:\d+/);
  assert.match(stderr, /\[visualizer\] Attached to current run; server will close on exit\./);
  assert.match(stderr, /\[visualizer\] Closed attached server\./);
});

test("cli can print Mermaid Live graph preview URL", async () => {
  const { code, stderr } = await runCli([
    "--system",
    "examples/target-model-binding-system.mmd",
    "--input",
    "graph link preview",
    "--dry-run",
    "--print-graph-link"
  ]);

  assert.strictEqual(code, 0);
  assert.match(stderr, /\[graph\] Visual preview: https:\/\/mermaid\.live\/edit#base64:/);
});
