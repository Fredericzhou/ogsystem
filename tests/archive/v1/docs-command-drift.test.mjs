import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

test("README and usage manual keep stable command anchors aligned", async () => {
  const scriptPath = path.resolve("scripts/docs-command-drift-check.mjs");
  const result = await new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath], {
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

  assert.equal(result.code, 0, result.stderr || result.stdout);
});
