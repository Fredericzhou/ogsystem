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

test("site completes the product project flow with graph preview and run analysis", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-browser-visual-"));
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot },
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

    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    assert.equal(await page.locator("#landing-view").isVisible(), true);
    await page.locator('#landing-view [data-site-theme-choice="dark"]').click();
    assert.equal(await page.locator('#landing-view [data-site-theme-choice="dark"]').getAttribute("aria-pressed"), "true");

    await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
    await page.locator(".project-library-toolbar").waitFor();
    assert.match(await page.locator("#workspace-view .page-heading").innerText(), /团队库/);
    assert.equal(await page.locator(".classic-team-section").count(), 1);
    assert.equal(await page.locator(".classic-team-card").count(), 3);
    assert.equal(await page.locator("#project-library-grid .project-asset-card").count(), 0);

    await page.goto(`${url}/studio/new`, { waitUntil: "networkidle" });
    assert.match(await page.locator("#new-project-view .page-heading").innerText(), /召唤团队/);
    await page.locator("#new-project-form input[name=name]").fill("Product Research Team");
    await page.locator("#new-project-form textarea[name=intent]").fill("Analyze a product brief and return evidence-backed recommendations.");
    await page.locator("#new-project-form button[type=submit]").click();
    await page.waitForURL(/\/studio\/project\/[a-z0-9-]+$/);
    await page.locator("#project-graph-stage .x6-node").nth(2).waitFor();
    assert.equal(await page.locator("#project-graph-stage .x6-node").count(), 3);
    assert.equal(await page.locator(".project-status.draft").count(), 1);

    await page.locator("#confirm-project-v2").click();
    await page.locator(".project-status.confirmed").waitFor();
    await page.locator('a[data-route*="/run"]').first().click();
    await page.waitForURL(/\/studio\/project\/[a-z0-9-]+\/run$/);
    await page.locator("#material-form-v2 input[name=filename]").fill("brief.md");
    await page.locator("#material-form-v2 textarea[name=content]").fill("# Brief\nUse the supplied facts only.");
    await page.locator("#material-form-v2 button[type=submit]").click();
    await page.locator(".material-row").waitFor();
    await page.locator("#project-run-form-v2 textarea[name=prompt]").fill("Summarize the brief.");
    await page.locator("#project-run-form-v2 button[type=submit]").click();
    await page.locator(".run-result-card").waitFor({ timeout: 30000 });
    assert.match(await page.locator(".run-result-card").innerText(), /RunPlan/);
    assert.match(await page.locator(".run-result-card").getAttribute("data-run-id"), /^\d{8}-\d{6}-[a-f0-9]+$/i);
    assert.equal(await page.locator('[data-project-run-action="resume"]').count(), 0);
    await page.locator(".run-analysis summary").click();
    assert.ok(await page.locator(".analysis-row").count() >= 1);

    const exportLink = page.locator('a[href^="/api/v1/projects/"][href$="/team/export"]').first();
    await exportLink.waitFor();
    assert.equal(await exportLink.count(), 1);
    const originalProjectId = page.url().match(/\/studio\/project\/([a-z0-9-]+)\/run$/)?.[1];
    const exportResponse = await page.request.get(new URL(await exportLink.getAttribute("href"), url).toString());
    assert.equal(exportResponse.status(), 200);
    assert.match(exportResponse.headers()["content-disposition"], /\.ogs\.json/);
    const bundle = await exportResponse.json();
    const importResponse = await page.request.post(new URL("/api/v1/team-packages/import", url).toString(), { data: bundle });
    assert.equal(importResponse.status(), 201);
    const imported = await importResponse.json();
    assert.notEqual(imported.projectId, originalProjectId);
    assert.equal(imported.projectStatus, "draft");
    await page.goto(`${url}/studio/project/${encodeURIComponent(imported.projectId)}`, { waitUntil: "networkidle" });
    await page.locator("#confirm-project-v2").click();
    await page.locator(".project-status.confirmed").waitFor();
    await page.locator('a[data-route*="/run"]').first().click();
    await page.waitForURL(/\/studio\/project\/[a-z0-9-]+\/run$/);
    await page.locator("#project-run-form-v2 textarea[name=prompt]").fill("Run the imported team with the same task.");
    await page.locator("#project-run-form-v2 button[type=submit]").click();
    await page.locator(".run-result-card").waitFor({ timeout: 30000 });
    assert.deepEqual(pageErrors, []);

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(page.url().replace(/\/run$/, ""), { waitUntil: "networkidle" });
    await mobile.locator("#project-graph-stage .x6-node").nth(2).waitFor();
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => undefined);
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
