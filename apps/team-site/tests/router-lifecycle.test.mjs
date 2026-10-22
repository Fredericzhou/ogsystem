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
    const abortedUrls = new Set();
    page.on("requestfailed", (request) => {
      if (request.url().includes("/api/v1/team-repository")) abortedUrls.add(request.url());
    });

    const rootResponse = await page.request.get(`${url}/`, { maxRedirects: 0 });
    assert.equal(rootResponse.status(), 302);
    assert.equal(rootResponse.headers().location, "/projects");
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    assert.match(page.url(), /\/projects$/);
    await page.locator("#projects-view .page-heading").waitFor();
    assert.equal(await page.locator('#projects-view a[href="/projects/new"]').count(), 1, "the empty state should not duplicate the page's create action");
    assert.equal(await page.locator('#projects-view .empty-projects a[href="/projects/new"]').count(), 0);

    assert.equal(await page.locator('.nav-item[data-view="projects"]').isVisible(), true, "Projects should remain available in normal mode");
    assert.equal(await page.locator('.nav-item[href="/teams"]').count(), 0, "the team repository should not duplicate Studio in primary navigation");
    assert.equal(await page.locator('.nav-item[data-view="studio"]').isVisible(), true, "Studio remains a peer product in normal mode");
    assert.equal(await page.locator('.nav-item[href="/studio/new"]').count(), 1, "team creation should have its own Studio navigation entry");
    await page.locator('button[data-product-mode="professional"]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem("ogs.product-mode")), "professional");
    await page.locator('.nav-item[data-view="studio"]').click();
    await page.locator("#studio-view .page-heading").waitFor();
    assert.match(page.url(), /\/studio$/);
    await page.evaluate(() => {
      window.__routerPushes = [];
      const originalPushState = history.pushState.bind(history);
      history.pushState = (state, title, nextUrl) => {
        window.__routerPushes.push(String(nextUrl));
        return originalPushState(state, title, nextUrl);
      };
    });
    await page.locator('#app-shell a[data-route][href="/projects"]').first().click();
    await page.locator("#projects-view .page-heading").waitFor();
    assert.deepEqual(await page.evaluate(() => window.__routerPushes), ["/projects"]);

    await page.goBack();
    await page.locator("#studio-view .page-heading").waitFor();
    assert.match(page.url(), /\/studio$/);
    await page.goForward();
    await page.locator("#projects-view .page-heading").waitFor();
    assert.match(page.url(), /\/projects$/);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#projects-view .page-heading").waitFor();
    assert.match(page.url(), /\/projects$/);
    assert.equal(await page.locator('button[data-product-mode="professional"]').getAttribute("aria-pressed"), "true", "professional mode should persist after reload");
    await page.locator('button[data-product-mode="normal"]').click();
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator('button[data-product-mode="normal"]').getAttribute("aria-pressed"), "true", "normal mode should persist after reload");

    let releaseDelayedResponse;
    let teamRepositoryRequestStarted;
    const teamRepositoryRequest = new Promise((resolveRequest) => { teamRepositoryRequestStarted = resolveRequest; });
    const delayedResponse = new Promise((resolveResponse) => { releaseDelayedResponse = resolveResponse; });
    await page.route("**/api/v1/team-repository**", async (route) => {
      teamRepositoryRequestStarted();
      const response = await route.fetch();
      await delayedResponse;
      await route.fulfill({ response });
    });
    await page.locator('button[data-product-mode="professional"]').click();
    await page.locator('.nav-item[data-view="studio"]').click();
    await page.locator("#studio-view .page-heading").waitFor();
    await teamRepositoryRequest;
    await page.locator('#app-shell a[data-route="/projects"]:visible').first().click();
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
    await page.evaluate(() => { window.__routerPushes = []; });
    await page.locator('#app-shell a[data-route="/projects"]').first().click();
    await page.locator("#projects-view .page-heading").waitFor();
    assert.deepEqual(await page.evaluate(() => window.__routerPushes), [], "canonical redirect must update router history state");

    const createdTeam = await page.request.post(`${url}/api/v1/team-factory`, {
      data: { name: "Studio Lifecycle Team", overview: "Verify graph loading and disposal across routes." }
    }).then((response) => response.json());
    const teamId = createdTeam.teamId || createdTeam.teamRootId || createdTeam.projectId;
    const teamVersionId = createdTeam.teamVersionId || createdTeam.projectId;
    const simulationId = "studio-browser-evidence";
    const simulation = { simulationId, teamId, teamVersionId, status: "completed", mode: "dry-run", input: "Inspect the generated plan", createdAt: "2026-10-20T10:00:00.000Z", outputSummary: "Plan reviewed" };
    await page.route("**/api/v1/teams/**/simulations**", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ simulation, state: { status: "completed", finalOutput: "Plan reviewed" }, events: [{ type: "simulation.completed", at: simulation.createdAt }] }) });
      } else if (requestUrl.pathname.endsWith("/events")) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ teamId, teamVersionId, simulationId, events: [{ type: "simulation.completed", at: simulation.createdAt }] }) });
      } else if (requestUrl.pathname.endsWith(simulationId)) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ simulation, state: { status: "completed", finalOutput: "Plan reviewed" }, events: [{ type: "simulation.completed", at: simulation.createdAt }] }) });
      } else {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ teamId, teamVersionId, simulations: [simulation] }) });
      }
    });
    const simulationResponse = await page.evaluate(async ({ teamId, teamVersionId }) => fetch(`/api/v1/teams/${teamId}/versions/${teamVersionId}/simulations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "Inspect the generated plan", locale: "en" }) }).then((response) => response.json()), { teamId, teamVersionId });
    assert.equal(simulationResponse.simulation.simulationId, simulationId);
    assert.equal(simulationResponse.simulation.status, "completed");
    await page.goto(`${url}/studio/teams/${teamVersionId}/release`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "发布检查" }).waitFor();
    assert.match(await page.locator("#studio-view .panel-intro").first().innerText(), /不验证外部网络或凭据/);
    assert.equal(await page.locator("#studio-release-button").count(), 1);
    await page.goto(`${url}/studio/teams/${teamVersionId}/run`, { waitUntil: "networkidle" });
    await page.locator(".studio-run-layout, #studio-view .run-error").waitFor();
    assert.equal(await page.locator(".studio-run-layout").count(), 1, `Studio run page failed: ${await page.locator("#studio-view").innerText()}`);
    assert.equal(await page.locator(".studio-simulation-row").count(), 1, `Simulation list should load: ${await page.locator("#studio-view").innerText()}`);
    assert.match(await page.locator(".studio-simulation-row").innerText(), /Inspect the generated plan/);
    assert.equal(await page.locator(".studio-simulation-row").count(), 1);
    await page.locator("#studio-simulation-form textarea[name=prompt]").waitFor();
    assert.equal(await page.locator('.studio-workspace-nav a[aria-current="page"]').getAttribute("href"), `/studio/teams/${teamVersionId}/run`);
    await page.locator(".studio-simulation-row").click();
    assert.equal(await page.locator('.studio-workspace-nav a[aria-current="page"]').getAttribute("href"), `/studio/teams/${teamVersionId}/run`);
    await page.getByText("只读证据").waitFor();
    await page.getByText("Plan reviewed").waitFor();
    assert.equal(await page.locator(".studio-event-list li").count(), 1);
    await page.goto(`${url}/studio/teams/${teamVersionId}/info`, { waitUntil: "networkidle" });
    await page.locator(".studio-info-layout").waitFor();
    await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
    await page.locator("#studio-grid .team-version-card").first().waitFor();
    assert.equal(await page.locator('#studio-view a[href="/studio/new"]').count(), 1, "the repository should link to the independent team creation flow");
    await page.locator(`#studio-grid .team-version-card a[href="/studio/teams/${createdTeam.projectId}/design"]`).click();
    await page.waitForURL(new RegExp(`/studio/teams/${createdTeam.projectId}/design$`));
    await page.locator("#studio-view #project-graph-stage").waitFor();
    assert.equal(await page.locator("#project-workspace-view #project-graph-stage").count(), 0, "Studio design must mount in its own top-level workspace");
    await page.locator('#project-graph-stage [data-studio-graph-action="add-role"]').waitFor();
    assert.equal(await page.locator('#project-graph-stage [data-studio-graph-action="add-edge"]').count(), 1, "Flow editing should be available in the team graph toolbar");
    assert.equal(await page.locator('#project-graph-stage [data-studio-graph-action="debug-run"]').count(), 1, "Studio simulation should be available in the team graph toolbar");
    assert.equal(await page.locator('#project-graph-stage [data-studio-graph-action="validate"]').count(), 1, "team validation should be available in the team graph toolbar");
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const graph = document.querySelector("#studio-view .project-graph-preview");
        const rect = graph?.getBoundingClientRect();
        return { documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, left: rect?.left, right: rect?.right };
      });
      assert.ok(layout.documentWidth <= layout.viewportWidth + 1, `Studio design should not overflow at ${width}px: ${JSON.stringify(layout)}`);
      assert.ok(layout.left >= -1 && layout.right <= width + 1, `Studio graph should remain in its workspace at ${width}px: ${JSON.stringify(layout)}`);
    }
    const studioPage = await browser.newPage();
    let releaseGraphBundle;
    let graphBundleRequestStarted;
    const graphBundleStarted = new Promise((resolveRequest) => { graphBundleRequestStarted = resolveRequest; });
    const graphBundleRelease = new Promise((resolveResponse) => { releaseGraphBundle = resolveResponse; });
    await studioPage.route("**/assets/ogs-studio-graph.js", async (route) => {
      graphBundleRequestStarted();
      await graphBundleRelease;
      await route.continue();
    });
    await studioPage.goto(`${url}/studio/teams/${createdTeam.projectId}/design`, { waitUntil: "domcontentloaded" });
    await graphBundleStarted;
    await studioPage.locator('.sidebar .nav-item[href="/projects"]:visible').click();
    await studioPage.locator("#projects-view .page-heading").waitFor();
    releaseGraphBundle();
    await studioPage.waitForTimeout(100);
    assert.equal(await studioPage.locator("#project-graph-stage [data-studio-graph-action]").count(), 0, "a graph that finishes loading after navigation must not mount into the detached team page");

    await studioPage.goto(`${url}/studio/teams/${createdTeam.projectId}/design`, { waitUntil: "networkidle" });
    await studioPage.locator('#project-graph-stage [data-studio-graph-action="validate"]').waitFor();
    await studioPage.locator('.sidebar .nav-item[href="/projects"]:visible').click();
    await studioPage.locator("#projects-view .page-heading").waitFor();
    assert.equal(await studioPage.locator(".project-graph-preview").count(), 0, "leaving team design must dispose the mounted graph and remove its region");
    await studioPage.close();
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => undefined);
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
