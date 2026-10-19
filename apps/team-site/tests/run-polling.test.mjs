import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
import { createRunPoller } from "../public/app/components/run-poll.js";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function jsonResponse(payload, ok = true) {
  return new Response(JSON.stringify(payload), { status: ok ? 200 : 422, headers: { "content-type": "application/json" } });
}

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for polling update.");
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
}

test("run polling updates state, stops at terminal status, and protects stale responses", async () => {
  const statuses = ["planning", "running", "completed"];
  let runCalls = 0;
  let eventCalls = 0;
  const updates = [];
  const requests = [];
  const stop = createRunPoller({
    projectId: "project-1",
    runId: "run-1",
    intervalMs: 5,
    request: async (url, options) => {
      requests.push({ url, signal: options.signal });
      if (url.endsWith("/events?limit=20")) {
        eventCalls += 1;
        return jsonResponse({ events: [{ cursor: eventCalls, record: { roleId: "planner", event: statuses[eventCalls - 1] } }] });
      }
      const status = statuses[Math.min(runCalls++, statuses.length - 1)];
      return jsonResponse({ runId: "run-1", state: { status, nodes: { planner: { status: status === "completed" ? "completed" : status } } } });
    },
    onUpdate: (snapshot) => updates.push(snapshot.run.state.status)
  });
  await waitFor(() => updates.at(-1) === "completed");
  const callCountAtTerminal = requests.length;
  await new Promise((resolveWait) => setTimeout(resolveWait, 30));
  assert.deepEqual(updates, ["planning", "running", "completed"]);
  assert.equal(requests.length, callCountAtTerminal, "terminal run should stop polling");
  assert.ok(requests.every((request) => request.signal instanceof AbortSignal));
  stop();

  let release;
  let staleRequestSignal;
  const stale = new Promise((resolveResponse) => { release = resolveResponse; });
  const staleUpdates = [];
  const staleStop = createRunPoller({
    projectId: "project-old",
    runId: "run-old",
    request: async (_url, options) => {
      staleRequestSignal = options.signal;
      return stale;
    },
    onUpdate: (snapshot) => staleUpdates.push(snapshot.run.state.status)
  });
  staleStop();
  release(jsonResponse({ runId: "run-old", state: { status: "completed" } }));
  await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  assert.deepEqual(staleUpdates, [], "stale response must not update the current page");
  assert.equal(staleRequestSignal.aborted, true, "stopping a poller aborts its active request");
});

test("platform settings clearly report runtimeApplied false after read and save", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-platform-settings-"));
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  let browser;
  try {
    const startedAt = Date.now();
    let url;
    while (!url && Date.now() - startedAt < 10000) {
      const match = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) url = match[1];
      else await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    assert.ok(url, "site server did not start: " + output);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${url}/platform`, { waitUntil: "networkidle" });
    await page.locator("#platform-runtime-status").waitFor();
    await waitFor(async () => (await page.locator("#platform-runtime-status").innerText()).includes("后续运行生效"));
    await page.locator("#platform-settings-form input[name=timeoutSeconds]").fill("180");
    await page.locator("#platform-settings-form button[type=submit]").click();
    await page.waitForFunction(() => document.querySelector("#platform-settings-status")?.textContent === "设置已保存");
    assert.match(await page.locator("#platform-runtime-status").innerText(), /已持久化.*后续运行生效/);
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => undefined);
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
