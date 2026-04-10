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
  const { code, stderr } = await runCli(["--prompt", "hello"]);
  assert.strictEqual(code, 1);
  assert.match(stderr, /Missing required args/);
});

test("cli log-run prints runtime logs to stderr without breaking stdout json", async () => {
  const { code, stdout, stderr } = await runCli([
    "--system",
    "examples/target-model-binding-system.mmd",
    "--prompt",
    "cli log run",
    "--dry-run",
    "--log-run"
  ]);

  assert.strictEqual(code, 0);
  const result = JSON.parse(stdout);
  assert.equal(result.status, "done");
  assert.match(stderr, /\[run:start\]/);
  assert.match(stderr, /\[role:start\]/);
  assert.match(stderr, /\[transition\]/);
  assert.match(stderr, /\[run:end\]/);
});
