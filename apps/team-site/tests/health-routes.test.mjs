import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

test("Team Site exposes liveness and readiness probes", { timeout: 30000 }, async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-health-"));
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  try {
    const startedAt = Date.now();
    let url;
    while (!url && Date.now() - startedAt < 15000) {
      url = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (!url) await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    assert.ok(url, `server did not become ready: ${output}`);
    const health = await fetch(`${url}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    const ready = await fetch(`${url}/readyz`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: "ready" });
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
