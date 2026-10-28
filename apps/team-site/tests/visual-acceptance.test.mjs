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

test("default Team Studio creation produces a native v2 draft on desktop and mobile", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-v2-visual-"));
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
      url = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (!url) await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    assert.ok(url, `Team Site did not start: ${output}`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(`${url}/studio/new`, { waitUntil: "networkidle" });
    assert.match(await page.locator(".new-team-heading h1").innerText(), /Team IR v2/);
    assert.doesNotMatch(await page.locator("#new-project-view").innerText(), /assistant will turn|团队助手/);
    await page.locator("#new-project-form input[name=name]").fill("Visual v2 Team");
    await page.locator("#new-project-form textarea[name=overview]").fill("Produce a concise, evidence-backed recommendation.");
    await page.locator("#new-project-form button[type=submit]").click();
    await page.waitForURL(/\/studio\/teams\/[a-z0-9-]+\/ir$/);
    await page.locator("#team-ir-editor").waitFor();
    const teamId = page.url().match(/\/teams\/([a-z0-9-]+)\/ir$/)?.[1];
    const [team, stored] = await Promise.all([
      page.request.get(`${url}/api/v1/team-versions/${teamId}`).then((response) => response.json()),
      page.request.get(`${url}/api/v1/team-versions/${teamId}/ir`).then((response) => response.json())
    ]);
    assert.equal(team.source, "team-ir-v2");
    assert.equal(stored.teamIR.schemaVersion, 2);

    for (const width of [1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      assert.ok(dimensions.content <= dimensions.viewport + 1, `Team IR v2 editor overflows at ${width}px: ${JSON.stringify(dimensions)}`);
    }
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => undefined);
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
