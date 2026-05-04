import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

test("Windows PowerShell and CMD lifecycle smoke", { concurrency: false }, async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows lifecycle smoke requires win32 PowerShell and CMD.");
    return;
  }

  const scriptPath = path.resolve("scripts/windows-lifecycle-smoke.mjs");
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
  assert.match(result.stdout, /windows lifecycle smoke passed/);
});
