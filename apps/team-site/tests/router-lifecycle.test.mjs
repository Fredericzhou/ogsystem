import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("app.js remains the stable bootstrap entry", async () => {
  const entry = await readFile(join(appRoot, "public/app.js"), "utf8");
  assert.match(entry, /import \{ bootstrap \} from "\.\/app\/views\/app\.js"/);
  assert.match(entry, /bootstrap\(\);/);
});

test("router delegates navigation once and cancels stale page requests", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-router-"));
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
    const page = await browser.newPage();
    const abortedUrls = new Set();
    page.on("requestfailed", (request) => {
      if (request.url().includes("/api/v1/team-repository")) abortedUrls.add(request.url());
    });

    await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      window.__routerPushes = [];
      const originalPushState = history.pushState.bind(history);
      history.pushState = (state, title, nextUrl) => {
        window.__routerPushes.push(String(nextUrl));
        return originalPushState(state, title, nextUrl);
      };
    });
    await page.locator('a[data-route][href="/projects"]').first().click();
    await page.locator("#projects-view .page-heading").waitFor();
    assert.deepEqual(await page.evaluate(() => window.__routerPushes), ["/projects"]);

    await page.goBack();
    await page.locator("#workspace-view .page-heading").waitFor();
    assert.match(page.url(), /\/studio$/);
    await page.goForward();
    await page.locator("#projects-view .page-heading").waitFor();
    assert.match(page.url(), /\/projects$/);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#projects-view .page-heading").waitFor();
    assert.match(page.url(), /\/projects$/);

    let releaseDelayedResponse;
    let teamRepositoryRequestStarted;
    const teamRepositoryRequest = new Promise((resolveRequest) => { teamRepositoryRequestStarted = resolveRequest; });
    const delayedResponse = new Promise((resolveResponse) => { releaseDelayedResponse = resolveResponse; });
    await page.route("**/api/v1/team-repository", async (route) => {
      teamRepositoryRequestStarted();
      const response = await route.fetch();
      await delayedResponse;
      await route.fulfill({ response });
    });
    await page.locator('#app-shell a[data-route][href="/studio"]').click();
    await teamRepositoryRequest;
    await page.locator('a[data-route][href="/projects"]').first().click();
    await page.locator("#projects-view .page-heading").waitFor();
    releaseDelayedResponse();
    await page.waitForTimeout(100);
    assert.equal(await page.locator("#projects-view").isVisible(), true);
    assert.equal(await page.locator("#projects-view .project-library-toolbar").count(), 0);
    assert.ok([...abortedUrls].some((requestUrl) => requestUrl.includes("/api/v1/team-repository")), "navigation should abort the stale repository request");

    await page.evaluate(() => {
      history.pushState({}, "", "/not-a-real-route");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    assert.match(page.url(), /\/projects$/);
    await page.locator("#projects-view .page-heading").waitFor();
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => undefined);
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
