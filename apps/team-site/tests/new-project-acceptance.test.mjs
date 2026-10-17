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

test("site creates a new project, adds material, and runs its dry run", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-browser-projects-"));
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
    assert.ok(url, "site server did not start: " + output);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(url + "/studio/new", { waitUntil: "networkidle" });
    await page.locator("#new-project-form").waitFor();
    assert.equal(await page.locator("[data-builder-choice]").count(), 3);
    await page.locator("#new-project-form input[name=name]").fill("Research Team");
    await page.locator("#new-project-form textarea[name=intent]").fill("Analyze the supplied product brief.");
    await page.locator("#new-project-form button[type=submit]").click();
    await page.waitForURL(/\/studio\/project\/[a-z0-9-]+$/);
    await page.locator("#team-assistant").waitFor();
    assert.equal(await page.locator("#team-assistant-input").count(), 1);
    await page.locator("#confirm-project-v2").click();
    await page.locator(".project-status.confirmed").waitFor();
    await page.locator('a[data-route*="/run"]').first().click();
    await page.waitForURL(/\/studio\/project\/[a-z0-9-]+\/run$/);
    await page.locator("#material-form-v2").waitFor();
    await page.locator("#material-form-v2 input[name=filename]").fill("brief.md");
    await page.locator("#material-form-v2 textarea[name=content]").fill("# Brief\nUse the supplied facts only.");
    await page.locator("#material-form-v2 button[type=submit]").click();
    await page.locator(".material-row").waitFor();
    await page.locator("#project-run-form-v2 textarea[name=prompt]").fill("Summarize the brief.");
    await page.locator("#project-run-form-v2 button[type=submit]").click();
    await page.locator(".run-result-card").waitFor({ timeout: 30000 });
    assert.match(await page.locator(".run-result-card").innerText(), /RunPlan/);
    assert.equal(await page.locator(".project-steps").count(), 1);
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => undefined);
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
