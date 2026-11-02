import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function startServer(projectsRoot) {
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot, OGS_DEMO_BACKEND: "codex" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const startedAt = Date.now();
  let url;
  while (!url && Date.now() - startedAt < 10000) {
    url = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    if (!url) await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assert.ok(url, `site server did not start: ${output}`);
  return { server, url };
}

test("platform models view supports linked selection by service and toggling between service and available models", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-platform-models-browser-"));
  const { server, url } = await startServer(projectsRoot);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    // Route mock for discovery to test multi-backend and available models
    await page.route("**/api/v1/platform/discovery", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        stale: false,
        sources: [
          { backend: "codex", displayName: "Codex CLI", status: "runnable", detail: "Ready" },
          { backend: "ollama", displayName: "Ollama Local", status: "runnable", detail: "Ready" },
          { backend: "kimi-cli", displayName: "Kimi CLI", status: "not_installed", detail: "Missing" }
        ],
        models: [
          { backend: "codex", modelId: "gpt-5", name: "GPT-5", capabilities: { textInput: true, textOutput: true }, runnable: true },
          { backend: "codex", modelId: "gpt-5-mini", name: "GPT-5 Mini", capabilities: { textInput: true, textOutput: true }, runnable: true },
          { backend: "ollama", modelId: "llama3:8b", name: "Llama 3 8B", capabilities: { textInput: true, textOutput: true }, runnable: true },
          { backend: "kimi-cli", modelId: "moonshot-v1", name: "Moonshot v1", capabilities: { textInput: true }, runnable: false }
        ]
      })
    }));

    await page.goto(`${url}/platform/models`, { waitUntil: "networkidle" });
    assert.deepEqual(pageErrors, []);

    // 1. Initial state: filter mode is 'service' by default
    const serviceToggle = page.locator('.filter-toggle-btn[data-model-filter="service"]');
    const availableToggle = page.locator('.filter-toggle-btn[data-model-filter="available"]');
    await serviceToggle.waitFor();
    assert.ok(await serviceToggle.evaluate((el) => el.classList.contains("active")), "By Service is active by default");
    assert.ok(!await availableToggle.evaluate((el) => el.classList.contains("active")), "Available Only is inactive by default");

    // 2. Default selected backend is first runnable (codex)
    const codexRow = page.locator('.platform-source-row[data-backend="codex"]');
    await codexRow.waitFor();
    assert.ok(await codexRow.evaluate((el) => el.classList.contains("is-selected")), "Codex service is selected");

    // 3. Right side models are filtered to Codex (gpt-5 and gpt-5-mini, not llama3)
    const codexModelRows = page.locator('.platform-model-row[data-backend="codex"]');
    assert.equal(await codexModelRows.count(), 2, "Codex models shown");
    const ollamaModelRowsInitial = page.locator('.platform-model-row[data-backend="ollama"]');
    assert.equal(await ollamaModelRowsInitial.count(), 0, "Ollama models hidden in Codex service view");

    // 4. Click Ollama service row -> linked filtering
    const ollamaRow = page.locator('.platform-source-row[data-backend="ollama"]');
    await ollamaRow.click();
    assert.ok(await ollamaRow.evaluate((el) => el.classList.contains("is-selected")), "Ollama service is now selected");
    assert.ok(!await codexRow.evaluate((el) => el.classList.contains("is-selected")), "Codex is no longer selected");

    const ollamaModelRows = page.locator('.platform-model-row[data-backend="ollama"]');
    assert.equal(await ollamaModelRows.count(), 1, "Ollama model is shown");
    assert.equal(await codexModelRows.count(), 0, "Codex models are hidden");

    // 5. Click 'Available only' toggle -> shows all runnable models across all services
    await availableToggle.click();
    assert.ok(await availableToggle.evaluate((el) => el.classList.contains("active")), "Available Only is now active");
    assert.ok(!await serviceToggle.evaluate((el) => el.classList.contains("active")), "By Service is inactive");

    // Total runnable models: gpt-5, gpt-5-mini, llama3:8b = 3 (moonshot-v1 is uninstalled/not runnable)
    const allAvailableModels = page.locator(".platform-model-row");
    assert.equal(await allAvailableModels.count(), 3, "All 3 runnable models shown in available mode");

    // 6. Click service row again -> automatically switches back to 'By Service' mode for that backend
    await codexRow.click();
    assert.ok(await serviceToggle.evaluate((el) => el.classList.contains("active")), "Switched back to By Service");
    assert.ok(await codexRow.evaluate((el) => el.classList.contains("is-selected")), "Codex is selected again");
    assert.equal(await page.locator('.platform-model-row[data-backend="codex"]').count(), 2);
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => undefined);
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
