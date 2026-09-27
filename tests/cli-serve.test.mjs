import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";

const cliPath = path.resolve("dist/runtime/cli.js");

test("ogs serve starts from ogs-dir defaults and exposes persisted Sessions", async (t) => {
  const ogsDir = await mkdtemp(path.join(os.tmpdir(), "ogs-serve-cli-root-"));
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "ogs-serve-cli-workspace-"));
  await writeFile(path.resolve(ogsDir, "system.mmd"), await readFile(path.resolve("examples/target-model-binding-system.mmd"), "utf8"), "utf8");
  const child = spawn(process.execPath, [cliPath, "serve", "--ogs-dir", ogsDir, "--workspace-dir", workspaceDir, "--port", "0"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  try {
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`serve did not start: ${stderr}`)), 10000);
      const onData = () => {
        const match = stdout.match(/OGS serve listening on (http:\/\/127\.0\.0\.1:\d+)/);
        if (!match) return;
        clearTimeout(timeout);
        child.stdout.off("data", onData);
        resolve(match[1]);
      };
      child.stdout.on("data", onData);
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`serve exited early (${code}): ${stderr}`)));
    });
    const health = await fetch(`${url}/healthz`);
    assert.equal(health.status, 200);
    const created = await fetch(`${url}/api/v1/sessions`, { method: "POST" });
    assert.equal(created.status, 201);
    const session = await created.json();
    const sessionFiles = await readdir(path.resolve(ogsDir, ".ogs", "sessions", session.sessionId));
    assert.ok(sessionFiles.includes("system.mmd"));
    assert.ok(sessionFiles.includes("session.json"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["EPERM", "EACCES"].includes(error.code)) {
      t.skip(`serve listener unavailable in sandbox: ${error.code}`);
      return;
    }
    throw error;
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("close", resolve));
  }
});
