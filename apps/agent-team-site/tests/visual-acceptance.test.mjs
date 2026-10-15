import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("site uses the OGSystem graph, exports it, and runs its project", async () => {
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: "0" },
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
    assert.ok(url, `site server did not start: ${output}`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
    await page.locator(".studio-graph-island .x6-node").nth(6).waitFor();
    assert.equal(await page.locator(".topbar [data-site-theme-choice]").count(), 2);
    assert.equal(await page.locator('.topbar [data-site-theme-choice="light"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".studio-graph-island .x6-node").count(), 7);
    assert.match(await page.locator("#graph-stage").innerText(), /任务|成果/);
    assert.ok(await page.locator('.studio-graph-island .studio-role-marker-badge[visibility="visible"]').count() >= 5);
    assert.ok(await page.locator(".studio-graph-island .studio-edge-label-body").count() >= 5);
    assert.equal(await page.locator('[data-studio-graph-action="export-svg"]').getAttribute("aria-label"), "导出 SVG");

    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-studio-graph-action="export-svg"]').click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.svg$/);

    await page.locator('.topbar [data-site-theme-choice="dark"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.visualizerTheme === "dark"
      && getComputedStyle(document.querySelector("#graph-stage")).backgroundColor === "rgb(11, 18, 32)");
    assert.equal(await page.locator('.topbar [data-site-theme-choice="dark"]').getAttribute("aria-pressed"), "true");
    assert.ok(await page.locator('.studio-graph-island .x6-node[data-cell-id="backend-planner"] text').evaluateAll((nodes) => nodes.some((node) => node.getAttribute("fill") === "#e5eefb")));
    await page.locator('.topbar [data-site-theme-choice="light"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.visualizerTheme === "light"
      && getComputedStyle(document.querySelector("#graph-stage")).backgroundColor === "rgb(247, 250, 248)");

    await page.locator("#locale-toggle").click();
    await page.waitForFunction(() => document.querySelector("#graph-stage")?.textContent?.includes("Task"));
    assert.match(await page.locator("#graph-stage").textContent(), /Engineering\s+plan\s+shared/);
    await page.locator("#graph-stage").click();
    await page.keyboard.press("Control+p");
    await page.locator('.studio-graph-island [data-studio-graph-quick-open]').waitFor({ state: "visible" });
    await page.locator('.studio-graph-island [data-studio-graph-quick-open-input]').fill("Engineering");
    assert.match(await page.locator(".studio-graph-quick-open-results").innerText(), /Engineering/);

    await page.locator("#run-button").click();
    await page.locator(".run-summary").waitFor({ timeout: 30000 });
    assert.match(await page.locator("#run-content").innerText(), /Completed|done/i);
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    assert.equal(await page.locator('#landing-view [data-site-theme-choice="light"]').isVisible(), true);
    await page.locator('#landing-view [data-site-theme-choice="dark"]').click();
    assert.equal(await page.locator('#landing-view [data-site-theme-choice="dark"]').getAttribute("aria-pressed"), "true");
    await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
    await page.locator(".studio-graph-island .x6-node").nth(6).waitFor();
    assert.equal(await page.locator("html").getAttribute("data-visualizer-theme"), "dark");
    assert.equal(await page.locator('.topbar [data-site-theme-choice="dark"]').getAttribute("aria-pressed"), "true");
    assert.deepEqual(pageErrors, []);

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(`${url}/studio`, { waitUntil: "networkidle" });
    await mobile.locator(".studio-graph-island .x6-node").nth(6).waitFor();
    assert.equal(await mobile.locator('.topbar [data-site-theme-choice="dark"]').isVisible(), true);
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    assert.equal(await mobile.locator(".studio-graph-island .x6-node").count(), 7);
    await mobile.locator('.topbar [data-site-theme-choice="dark"]').click();
    await mobile.waitForFunction(() => document.documentElement.dataset.visualizerTheme === "dark"
      && getComputedStyle(document.querySelector("#graph-stage")).backgroundColor === "rgb(11, 18, 32)");
    const graphBounds = await mobile.locator(".studio-graph-canvas").boundingBox();
    const outputNodeBounds = await mobile.locator('.x6-node[data-cell-id="output"]').boundingBox();
    assert.ok(graphBounds && outputNodeBounds);
    assert.ok(outputNodeBounds.x >= graphBounds.x && outputNodeBounds.x + outputNodeBounds.width <= graphBounds.x + graphBounds.width + 1);
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => undefined);
  }
});
