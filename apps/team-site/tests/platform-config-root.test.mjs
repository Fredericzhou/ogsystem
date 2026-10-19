import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function startServer(projectsRoot, platformConfigRoot) {
  let output = "";
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: platformConfigRoot },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
      const url = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (url) return { server, url };
      if (server.exitCode !== null) throw new Error(`Team Site server exited before readiness: ${output}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    throw new Error(`Team Site server did not become ready: ${output}`);
  } catch (error) {
    await stopServer(server);
    throw error;
  }
}

async function stopServer(server) {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  server.kill("SIGTERM");
  await once(server, "exit");
}

test("platform settings remain available when the Projects data root changes", { timeout: 45000 }, async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "ogs-platform-config-root-"));
  const configRoot = join(testRoot, "platform-config");
  const firstProjectsRoot = join(testRoot, "projects-before");
  const secondProjectsRoot = join(testRoot, "projects-after");
  let first;
  let second;

  try {
    first = await startServer(firstProjectsRoot, configRoot);
    const settings = { defaultProvider: "opencode", defaultModel: "persisted-model", timeoutSeconds: 90, retryCount: 2 };
    const writeResponse = await fetch(`${first.url}/api/v1/platform/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings)
    });
    assert.equal(writeResponse.status, 200);
    await stopServer(first.server);
    first = undefined;

    second = await startServer(secondProjectsRoot, configRoot);
    const readResponse = await fetch(`${second.url}/api/v1/platform/settings`);
    assert.equal(readResponse.status, 200);
    const payload = await readResponse.json();
    assert.equal(payload.settings.defaultProvider, settings.defaultProvider);
    assert.equal(payload.settings.defaultModel, settings.defaultModel);
    assert.equal(payload.settings.timeoutSeconds, settings.timeoutSeconds);
    assert.equal(payload.settings.retryCount, settings.retryCount);
  } finally {
    await stopServer(first?.server);
    await stopServer(second?.server);
    await rm(testRoot, { recursive: true, force: true });
  }
});
