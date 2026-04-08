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
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("cli fails when required args are missing", async () => {
  const { code, stderr } = await runCli(["--prompt", "hello"]);
  assert.strictEqual(code, 1);
  assert.match(stderr, /Missing required args/);
});
