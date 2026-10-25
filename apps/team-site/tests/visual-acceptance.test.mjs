import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
import { seedReleasedClassicTeam } from "./classic-team-fixtures.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function confirmTaskReadinessIfRequired(page, action) {
  const responsePromise = page.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    return pathname.includes("/api/v1/projects/") && pathname.includes("/tasks/") && pathname.endsWith(`/${action}`);
  }, { timeout: 30000 });
  const dialog = page.locator(".confirm-dialog");
  const dialogPromise = dialog.waitFor({ state: "visible", timeout: 20000 }).then(() => true, () => false);
  const result = await Promise.race([
    responsePromise.then((response) => ({ response })),
    dialogPromise.then((visible) => visible ? { visible } : null)
  ]);
  if (result?.visible) await dialog.locator('button[value="confirm"]').click();
  if (!result?.visible && !result?.response) throw new Error(`Task ${action} produced neither a readiness prompt nor a request.`);
  return result.response || responsePromise;
}

test("site completes the product project flow with task records and repository export", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-browser-visual-"));
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
    assert.ok(url, `site server did not start: ${output}`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors = [];
    const configRequests = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/v1/config") configRequests.push(request.url());
    });
    await page.addInitScript(() => {
      window.__ogsUnhandledRejections = [];
      window.addEventListener("unhandledrejection", (event) => {
        window.__ogsUnhandledRejections.push(String(event.reason?.message || event.reason || "unhandled rejection"));
      });
    });

    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).pathname, "/", "the public landing page should remain an independent route");
    await page.locator("#landing-view").waitFor({ state: "visible" });
    assert.deepEqual(configRequests, [], "the product shell should not fetch a browser-visible Visualizer origin");
    await page.goto(`${url}/projects`, { waitUntil: "networkidle" });
    await page.locator("#projects-view .page-heading").waitFor();
    await page.locator("#site-theme-toggle").click();
    assert.equal(await page.locator("#site-theme-toggle").getAttribute("aria-pressed"), "true");
    assert.equal(await page.evaluate(() => localStorage.getItem("ogs.visualizer.theme")), "dark");

    await page.goto(`${url}/teams`, { waitUntil: "networkidle" });
    await page.locator(".project-library-toolbar").waitFor();
    assert.match(await page.locator("#workspace-view .page-heading").innerText(), /团队仓库/);
    assert.equal(await page.locator(".classic-team-section").count(), 1);
    assert.equal(await page.locator(".repository-classic-section .classic-team-card").count(), 3);
    assert.equal(await page.locator(".repository-classic-section [data-team-action='delete']").count(), 0, "classic built-in teams in the repository must not expose a delete action");
    assert.equal(await page.locator("#project-library-grid .project-asset-card").count(), 0);
    await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
    assert.equal(await page.locator("#site-theme-toggle").getAttribute("aria-pressed"), "true", "theme choice should persist across product routes");
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("#site-theme-toggle").getAttribute("aria-pressed"), "true", "theme choice should persist after a page reload");
    await page.locator("#site-theme-toggle").click();
    assert.equal(await page.locator("#site-theme-toggle").getAttribute("aria-pressed"), "false");
    await page.locator("#site-theme-toggle").click();
    assert.equal(await page.locator("#product-mode-toggle").getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator('.primary-nav a[href="/studio"]').isVisible(), true, "Studio is a peer product and remains discoverable in normal mode");
    assert.match(await page.locator("#studio-view .repository-heading").innerText(), /Studio/);
    assert.equal(await page.locator("#studio-view .team-version-card[data-team-builtin='true']").count(), 3, "Studio should list the three classic built-in teams as forkable versions");
    assert.equal(await page.locator("#studio-view .team-version-card[data-team-builtin='true'] [data-team-action='delete']").count(), 0, "built-in classic teams must not expose a delete action");
    const createTeamAction = page.locator("#studio-view .studio-repository-toolbar .primary-button");
    assert.equal(await createTeamAction.isVisible(), true, "Studio should keep its create action in the repository toolbar");
    assert.ok(await createTeamAction.evaluate((button) => button.getBoundingClientRect().height > 0), "Studio create action should have a rendered hit area");
    const darkPrimaryContrast = await createTeamAction.evaluate((button) => {
      const parse = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      const [background, foreground] = [getComputedStyle(button).backgroundColor, getComputedStyle(button).color].map(parse).map((rgb) => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722);
      return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
    });
    assert.ok(darkPrimaryContrast >= 4.5, `dark primary button contrast should meet WCAG AA, got ${darkPrimaryContrast}`);
    await page.goto(`${url}/examples`, { waitUntil: "networkidle" });
    const darkExampleCopyContrast = await page.locator(".library-card p").first().evaluate((copy) => {
      const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map((value) => {
        const channel = Number(value) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const [foreground, background] = [getComputedStyle(copy).color, getComputedStyle(copy.parentElement).backgroundColor].map(luminance);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    assert.ok(darkExampleCopyContrast >= 4.5, `dark example copy should meet WCAG AA, got ${darkExampleCopyContrast}`);
    await page.goto(`${url}/cases/software-team`, { waitUntil: "networkidle" });
    const darkDetailContrast = await page.locator(".detail-back").evaluate((link) => {
      const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const [foreground, background] = [getComputedStyle(link).color, getComputedStyle(document.body).backgroundColor].map(luminance);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    assert.ok(darkDetailContrast >= 4.5, `dark detail links should meet WCAG AA, got ${darkDetailContrast}`);
    await page.goto(`${url}/studio/new`, { waitUntil: "networkidle" });
    assert.match(await page.locator("#new-project-view .page-heading").innerText(), /先说清团队要完成什么/);
    assert.equal(await page.locator("#new-project-view .detail-back").getAttribute("href"), "/studio", "team creation returns to Studio");
    assert.equal(await page.locator(".new-team-steps").count(), 0);
    await page.locator("#new-project-form input[name=name]").fill("Product Research Team");
    await page.locator("#new-project-form textarea[name=overview]").fill("Analyze a product brief and return evidence-backed recommendations.");
    await page.locator("#new-project-form button[type=submit]").click();
    await page.waitForURL(/\/teams\/[a-z0-9-]+\/design$/);
    await page.locator("#project-graph-stage .x6-node").nth(2).waitFor();
    assert.equal(await page.locator("#project-graph-stage .x6-node").count(), 3);
    assert.equal(await page.locator(".project-status.draft").count(), 1);
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#project-graph-stage .x6-node").nth(2).waitFor();
    const desktopGraphLayout = await page.evaluate(() => {
      const stage = document.querySelector("#project-graph-stage");
      const scroll = stage?.parentElement;
      const box = stage?.getBoundingClientRect();
      const scrollBox = scroll?.getBoundingClientRect();
      const edges = [...(stage?.querySelectorAll(".x6-edge") || [])].map((edge) => edge.getBoundingClientRect());
      return {
        transform: stage ? getComputedStyle(stage).transform : "missing",
        stageWidth: box?.width || 0,
        canvasWidth: scroll?.clientWidth || 0,
        scrollVisible: Boolean(scrollBox && scrollBox.width > 0 && scrollBox.height > 0),
        visibleEdges: edges.filter((edge) => edge.width > 0 || edge.height > 0).length,
        edgesInsideCanvas: Boolean(box && edges.length && edges.every((edge) => edge.left >= box.left - 2 && edge.right <= box.right + 2 && edge.top >= box.top - 2 && edge.bottom <= box.bottom + 2)),
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth
      };
    });
    assert.equal(desktopGraphLayout.transform, "none", "the team graph should not be scaled at compact desktop widths");
    assert.ok(desktopGraphLayout.scrollVisible && desktopGraphLayout.stageWidth >= 700 && desktopGraphLayout.canvasWidth >= 700, `the team graph should retain a usable canvas: ${JSON.stringify(desktopGraphLayout)}`);
    assert.ok(desktopGraphLayout.visibleEdges > 0 && desktopGraphLayout.edgesInsideCanvas, `graph connectors should remain visible inside the canvas: ${JSON.stringify(desktopGraphLayout)}`);
    const compactDesktopNode = await page.locator("#project-graph-stage .x6-node").first().boundingBox();
    assert.ok(compactDesktopNode && compactDesktopNode.width >= 90 && compactDesktopNode.height >= 40, `graph nodes should remain readable at compact desktop widths: ${JSON.stringify(compactDesktopNode)}`);
    assert.ok(desktopGraphLayout.pageWidth <= desktopGraphLayout.viewportWidth + 1, "the graph must not widen the whole page");
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.locator("#confirm-project").click();
    await page.waitForURL(/\/studio\/teams\/[a-z0-9-]+\/release$/);
    assert.equal(await page.locator("#studio-release-button").isDisabled(), true, "a new TeamVersion needs a passing baseline Sandbox before release");
    const publishedTeam = await seedReleasedClassicTeam(projectsRoot, "software-team");
    const teamId = publishedTeam.projectId;
    await page.goto(`${url}/projects/new?team=${encodeURIComponent(teamId)}`, { waitUntil: "networkidle" });
    await page.locator("#collaboration-project-form").waitFor();
    await page.locator("#collaboration-project-form input[name=name]").fill("Product Research Project");
    await page.locator(`#project-team-options input[value="${teamId}"]`).check();
    await page.locator("#collaboration-project-form button[type=submit]").click();
    await page.waitForURL(/\/projects\/[a-z0-9-]+$/);
    const secondTeam = await seedReleasedClassicTeam(projectsRoot, "expert-consultation");
    const projectId = page.url().match(/\/projects\/([^/]+)$/)?.[1];
    await page.goto(`${url}/projects/${projectId}/teams`, { waitUntil: "networkidle" });
    await page.locator("#project-team-management-form").waitFor();
    await page.locator(`#project-managed-team-options input[value="${secondTeam.projectId}"]`).check();
    await page.locator("#project-team-management-form button[type=submit]").click();
    await page.waitForURL(new RegExp(`/projects/${projectId}$`));
    assert.equal(await page.locator(".project-status.confirmed").innerText(), "2 个团队版本 · 0 个任务");
    await page.goto(`${url}/projects/${projectId}/teams`, { waitUntil: "networkidle" });
    await page.locator(`#project-managed-team-options input[value="${teamId}"]`).check();
    await page.locator("#project-team-management-form button[type=submit]").click();
    await page.waitForURL(new RegExp(`/projects/${projectId}$`));
    assert.equal(await page.locator(".project-status.confirmed").innerText(), "2 个团队版本 · 0 个任务");
    await page.locator("#project-material-file-input").setInputFiles({
      name: "project-brief.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Fixed project material fixture.")
    });
    await page.locator("#project-resources-panel .material-row").filter({ hasText: "project-brief.txt" }).waitFor();
    await page.locator("[data-open-task-dialog]").click();
    await page.locator("#collaboration-task-form").waitFor();
    const taskDialogState = await page.locator("#collaboration-task-dialog").evaluate((dialog) => ({
      open: dialog.open,
      textarea: dialog.querySelector("textarea")?.getBoundingClientRect().toJSON()
    }));
    assert.equal(await page.locator("#collaboration-task-form textarea[name=input]").isVisible(), true, `task dialog input should be visible above the project workbench: ${JSON.stringify(taskDialogState)}`);
    await page.locator("#collaboration-task-form textarea[name=input]").fill("Summarize the brief.");
    await page.locator("#collaboration-task-form button[type=submit]").click();
    await page.locator(".task-record-row").waitFor();
    assert.match(await page.locator(".task-record-row").innerText(), /Summarize the brief\./);
    assert.equal(await page.locator(".project-resources-panel").count(), 1);
    const startResponsePromise = confirmTaskReadinessIfRequired(page, "start");
    await page.locator('.task-record-row [data-task-action="start"]').click();
    await startResponsePromise;
    await page.waitForFunction(() => {
      const status = document.querySelector(".task-record-row .status-chip");
      return status?.classList.contains("completed") || status?.classList.contains("failed");
    }, null, { timeout: 30000 });
    assert.equal(await page.locator(".task-record-row .status-chip").evaluate((status) => status.classList.contains("completed")), true);
    assert.ok(await page.locator(".task-record-row [data-run-id]").count() >= 1);
    await page.locator(".task-run-workspace-link a").waitFor();
    const runDiagnosticLink = await page.locator(".task-run-workspace-link a").getAttribute("href");
    assert.match(runDiagnosticLink || "", new RegExp(`^/projects/${projectId}/runs/`));
    assert.equal(await page.locator(".task-run-workspace-link a").getAttribute("target"), null, "run diagnostics should open inside the same product shell");
    await page.goto(`${url}${runDiagnosticLink}`, { waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).pathname, runDiagnosticLink, "the run detail route should focus the requested Run");
    const focusedRunId = runDiagnosticLink.split("/").at(-1);
    await page.locator(`.task-record-row .task-run-detail[data-run-id="${focusedRunId}"]`).waitFor();
    await page.goto(`${url}/projects/${projectId}`, { waitUntil: "networkidle" });
    const collaboration = await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json());
    const task = collaboration.taskRecords[0];
    const originalRunId = task.currentRunId;
    const originalRunDir = join(projectsRoot, projectId, ".ogs", "runs", originalRunId);
    const runStatePath = join(originalRunDir, "control", "state.json");
    const runState = JSON.parse(await readFile(runStatePath, "utf8"));
    await writeFile(runStatePath, `${JSON.stringify({ ...runState, status: "failed", error: "UAT retry fixture", finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
    const projectMetaPath = join(projectsRoot, projectId, ".site", "project.json");
    const projectMeta = JSON.parse(await readFile(projectMetaPath, "utf8"));
    projectMeta.taskRecords = projectMeta.taskRecords.map((record) => record.taskId === task.taskId
      ? { ...record, status: "failed", lastError: "UAT retry fixture" }
      : record);
    await writeFile(projectMetaPath, `${JSON.stringify(projectMeta, null, 2)}\n`, "utf8");
    const failedProject = await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json());
    const failedTask = failedProject.taskRecords.find((record) => record.taskId === task.taskId);
    assert.equal(failedTask.status, "failed", `retry fixture was not visible in the Project DTO: ${JSON.stringify({ runStatePath, failedTask })}`);
    assert.equal(failedTask.currentRunId, originalRunId, "failed Task DTO must retain its current Run");
    await page.reload({ waitUntil: "networkidle" });
    const reloadedProject = await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json());
    const reloadedTask = reloadedProject.taskRecords.find((record) => record.taskId === task.taskId);
    assert.equal(reloadedTask?.status, "failed", `Task status changed after reload: ${JSON.stringify(reloadedTask)}`);
    const taskRows = page.locator(".task-record-row");
    assert.ok(await taskRows.count(), `Project task row missing after reload: ${JSON.stringify(await page.evaluate(() => ({ url: location.href, title: document.title, body: document.body?.innerText, html: document.documentElement?.outerHTML.slice(0, 2000) })))}`);
    const retryButton = page.locator('.task-record-row [data-task-action="retry"]');
    assert.equal(await retryButton.count(), 1, `retry action missing after reload: ${await page.locator(".task-record-row").first().evaluate((row) => row.outerHTML)}`);
    await retryButton.waitFor();
    const retryResponsePromise = confirmTaskReadinessIfRequired(page, "retry");
    await retryButton.click();
    let retryResponse;
    try {
      retryResponse = await retryResponsePromise;
    } catch (error) {
      throw new Error(`${error.message}; server: ${output}`);
    }
    const retryPayload = await retryResponse.json();
    assert.equal(retryResponse.ok(), true, retryPayload.error || `retry returned ${retryResponse.status()}`);
    await page.waitForFunction(() => {
      const status = document.querySelector(".task-record-row .status-chip");
      return status?.classList.contains("completed") || status?.classList.contains("failed");
    }, null, { timeout: 30000 });
    const retriedProject = await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json());
    const retriedTask = retriedProject.taskRecords.find((record) => record.taskId === task.taskId);
    assert.equal(retriedProject.taskRecords.length, 1);
    assert.equal(retriedTask.runIds.length, 2);
    assert.equal(retriedTask.runIds[0], originalRunId);
    assert.notEqual(retriedTask.runIds[1], originalRunId);
    assert.equal(retriedTask.currentRunId, retriedTask.runIds[1]);
    await page.locator(".task-attempt-timeline li").nth(0).waitFor();
    assert.equal(await page.locator(".task-attempt-timeline li").count(), 2);
    assert.match(await page.locator(".task-attempt-timeline").innerText(), /历史尝试[\s\S]*当前尝试/);
    await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
    const originalProjectId = teamId;
    const exportLink = page.locator(`a[href="/api/v1/projects/${originalProjectId}/team/export"]`);
    await exportLink.waitFor();
    assert.equal(await exportLink.count(), 1);
    const exportResponse = await page.request.get(new URL(await exportLink.getAttribute("href"), url).toString());
    assert.equal(exportResponse.status(), 200);
    assert.match(exportResponse.headers()["content-disposition"], /\.ogs\.json/);
    const bundle = await exportResponse.json();
    const importResponse = await page.request.post(new URL("/api/v1/team-packages/import", url).toString(), { data: bundle });
    assert.equal(importResponse.status(), 409);
    assert.match((await importResponse.json()).error, /TEAM_NAME_EXISTS/);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(await page.evaluate(() => window.__ogsUnhandledRejections), []);

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(`${url}/studio/teams/${encodeURIComponent(teamId)}/design`, { waitUntil: "networkidle" });
    await mobile.locator("#project-graph-stage .x6-node").nth(2).waitFor();
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    const mobileGraphLayout = await mobile.evaluate(() => {
      const stage = document.querySelector("#project-graph-stage");
      const box = stage?.getBoundingClientRect();
      const parentBox = stage?.parentElement?.getBoundingClientRect();
      return { stageWidth: box?.width || 0, stageHeight: box?.height || 0, parentWidth: parentBox?.width || 0 };
    });
    assert.ok(mobileGraphLayout.stageWidth >= 280 && mobileGraphLayout.stageHeight >= 200, `the team graph should remain readable on mobile: ${JSON.stringify(mobileGraphLayout)}`);
    await mobile.locator("#topbar-more-toggle").click();
    assert.equal(await mobile.locator("#product-mode-toggle").isVisible(), true, "mobile preferences should be available from the more menu");
    await mobile.locator("#product-mode-toggle").click();
    await mobile.locator("#mobile-nav-toggle").click();
    await mobile.setViewportSize({ width: 320, height: 740 });
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "the product shell should fit a 320px viewport");
    const mobileNavigation = await mobile.locator(".primary-nav").evaluate((nav) => ({
      clientWidth: nav.clientWidth,
      scrollWidth: nav.scrollWidth,
      projectVisible: Boolean(nav.querySelector('[href="/projects"]')),
      professionalLinksVisible: [...nav.querySelectorAll("[data-pro-only]")].every((link) => getComputedStyle(link).display !== "none")
    }));
    assert.ok(mobileNavigation.projectVisible && mobileNavigation.professionalLinksVisible && mobileNavigation.clientWidth > 0, `mobile navigation should keep professional links reachable: ${JSON.stringify(mobileNavigation)}`);
    assert.ok(mobileNavigation.scrollWidth >= mobileNavigation.clientWidth, `mobile navigation should contain its links without widening the page: ${JSON.stringify(mobileNavigation)}`);
    await mobile.keyboard.press("Escape");
    await mobile.goto(`${url}/studio/teams/${encodeURIComponent(teamId)}/release`, { waitUntil: "networkidle" });
    await mobile.getByRole("heading", { name: "发布检查" }).waitFor();
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "the release gate should fit a 320px viewport");
    assert.ok(await mobile.locator("#studio-view .panel-intro").first().isVisible(), "the release gate should keep the validation boundary readable on mobile");
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(`${url}/studio/new`, { waitUntil: "networkidle" });
    await mobile.locator("#new-project-form").waitFor();
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    assert.ok(await mobile.locator(".new-team-builder .primary-button").evaluate((button) => button.getBoundingClientRect().width >= 300));
    await mobile.goto(`${url}/projects/${encodeURIComponent(projectId)}`, { waitUntil: "domcontentloaded" });
    await mobile.locator("#project-workspace-view").waitFor({ state: "visible", timeout: 5000 });
    const taskLayout = await mobile.waitForFunction(() => {
      const root = document.querySelector("#project-workspace-view");
      const row = root?.querySelector(".task-record-row");
      const main = row?.querySelector(".task-record-main");
      const actions = row?.querySelector(".task-record-actions");
      const mainRect = main?.getBoundingClientRect();
      const actionRect = actions?.getBoundingClientRect();
      if (!root || root.querySelector(".project-loading") || !row?.isConnected
        || !mainRect?.width || !mainRect.height || !actionRect?.width || !actionRect.height) return false;
      const rect = (element) => {
        const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      };
      const actionButtons = [...actions.querySelectorAll("button")];
      const timeline = row.querySelector(".task-attempt-timeline");
      return {
        main: rect(main),
        actions: rect(actions),
        buttons: actionButtons.map((button) => ({ ...rect(button), className: button.className, action: button.dataset.taskAction, minHeight: getComputedStyle(button).minHeight })),
        timeline: timeline ? rect(timeline) : null,
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth
      };
    }, null, { timeout: 10000 }).then((handle) => handle.jsonValue());
    assert.ok(taskLayout.documentWidth <= taskLayout.viewportWidth + 1, "project page should not overflow horizontally at 390px");
    assert.ok(taskLayout.actions.top >= taskLayout.main.bottom - 1, "mobile task actions should follow task content without overlap");
    assert.ok(taskLayout.buttons.length > 0, "mobile task actions should remain available");
    assert.ok(taskLayout.buttons.every((button) => button.left >= 0 && button.right <= taskLayout.viewportWidth + 1 && button.width >= 44 && button.height >= 44), `mobile task controls should stay inside the viewport and meet the 44px touch target: ${JSON.stringify(taskLayout)}`);
    assert.ok(taskLayout.timeline && taskLayout.timeline.left >= 0 && taskLayout.timeline.right <= taskLayout.viewportWidth + 1, "mobile attempt timeline should remain within the viewport");
  } finally {
    await browser?.close();
    if (server.exitCode === null && server.signalCode === null) {
      server.kill();
      await once(server, "exit").catch(() => undefined);
    }
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
