import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

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
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      window.__ogsUnhandledRejections = [];
      window.addEventListener("unhandledrejection", (event) => {
        window.__ogsUnhandledRejections.push(String(event.reason?.message || event.reason || "unhandled rejection"));
      });
    });

    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    assert.equal(await page.locator("#landing-view").isVisible(), true);
    await page.locator('#landing-view [data-site-theme-choice="dark"]').click();
    assert.equal(await page.locator('#landing-view [data-site-theme-choice="dark"]').getAttribute("aria-pressed"), "true");

    await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
    await page.locator(".project-library-toolbar").waitFor();
    assert.match(await page.locator("#workspace-view .page-heading").innerText(), /团队仓库/);
    assert.equal(await page.locator(".classic-team-section").count(), 1);
    assert.equal(await page.locator(".repository-classic-section .classic-team-card").count(), 3);
    assert.equal(await page.locator("#project-library-grid .project-asset-card").count(), 0);
    await page.goto(`${url}/factory`, { waitUntil: "networkidle" });
    assert.match(await page.locator("#factory-view .page-heading").innerText(), /OGS Studio/);
    const libraryActionHeights = await page.locator(".heading-actions > *").evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().height)));
    assert.equal(new Set(libraryActionHeights).size, 1, "library heading actions should share a height");
    const darkPrimaryContrast = await page.locator(".heading-actions .primary-button").evaluate((button) => {
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
    await page.goto(`${url}/factory/new`, { waitUntil: "networkidle" });
    assert.match(await page.locator("#new-project-view .page-heading").innerText(), /先说清团队要完成什么/);
    assert.equal(await page.locator(".new-team-steps").count(), 0);
    await page.locator("#new-project-form input[name=name]").fill("Product Research Team");
    await page.locator("#new-project-form textarea[name=overview]").fill("Analyze a product brief and return evidence-backed recommendations.");
    await page.locator("#new-project-form button[type=submit]").click();
    await page.waitForURL(/\/studio\/team\/[a-z0-9-]+$/);
    await page.locator("#project-graph-stage .x6-node").nth(2).waitFor();
    assert.equal(await page.locator("#project-graph-stage .x6-node").count(), 3);
    assert.equal(await page.locator(".project-status.draft").count(), 1);

    await page.locator("#confirm-project").click();
    await page.locator(".project-status.confirmed").waitFor();
    const teamId = page.url().match(/\/studio\/team\/([^/]+)$/)?.[1];
    await page.goto(`${url}/studio/project/new?team=${encodeURIComponent(teamId)}`, { waitUntil: "networkidle" });
    await page.locator("#collaboration-project-form").waitFor();
    await page.locator("#collaboration-project-form input[name=name]").fill("Product Research Project");
    await page.locator(`#project-team-options input[value="${teamId}"]`).check();
    await page.locator("#collaboration-project-form button[type=submit]").click();
    await page.waitForURL(/\/studio\/project\/[a-z0-9-]+\/run$/);
    const secondTeam = await page.request.post(`${url}/api/v1/team-factory`, { data: { name: "Product Review Team", overview: "Review the product research output.", locale: "zh-CN" } }).then((response) => response.json());
    await page.request.post(`${url}/api/v1/team-versions/${encodeURIComponent(secondTeam.projectId)}/release`);
    const projectId = page.url().match(/\/studio\/project\/([^/]+)\/run$/)?.[1];
    await page.goto(`${url}/studio/project/${projectId}/teams`, { waitUntil: "networkidle" });
    await page.locator("#project-team-management-form").waitFor();
    await page.locator(`#project-managed-team-options input[value="${secondTeam.projectId}"]`).check();
    await page.locator("#project-team-management-form button[type=submit]").click();
    await page.waitForURL(new RegExp(`/studio/project/${projectId}/run$`));
    assert.equal(await page.locator(".project-status.confirmed").innerText(), "2 个团队 · 0 个任务");
    await page.goto(`${url}/studio/project/${projectId}/teams`, { waitUntil: "networkidle" });
    await page.locator(`#project-managed-team-options input[value="${secondTeam.projectId}"]`).uncheck();
    await page.locator("#project-team-management-form button[type=submit]").click();
    await page.waitForURL(new RegExp(`/studio/project/${projectId}/run$`));
    assert.equal(await page.locator(".project-status.confirmed").innerText(), "1 个团队 · 0 个任务");
    await page.locator("#collaboration-task-form").waitFor();
    await page.locator("#collaboration-task-form textarea[name=input]").fill("Summarize the brief.");
    await page.locator("#collaboration-task-form button[type=submit]").click();
    await page.locator(".task-record-row").waitFor();
    assert.match(await page.locator(".task-record-row").innerText(), /Summarize the brief\./);
    assert.equal(await page.locator(".project-resources-panel").count(), 1);
    await page.locator('.task-record-row [data-task-action="start"]').click();
    await page.waitForFunction(() => {
      const status = document.querySelector(".task-record-row .status-chip");
      return status?.classList.contains("completed") || status?.classList.contains("failed");
    }, null, { timeout: 30000 });
    assert.equal(await page.locator(".task-record-row .status-chip").evaluate((status) => status.classList.contains("completed")), true);
    assert.equal(await page.locator(".task-record-row .status-chip").evaluate((status) => status.classList.contains("completed")), true);
    assert.ok(await page.locator(".task-record-row [data-run-id]").count() >= 1);
    const collaboration = await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json());
    const task = collaboration.taskRecords[0];
    const originalRunId = task.currentRunId;
    const originalRunDir = join(projectsRoot, task.runProjectId, ".ogs", "runs", originalRunId);
    const runStatePath = join(originalRunDir, "control", "state.json");
    const runState = JSON.parse(await readFile(runStatePath, "utf8"));
    await writeFile(runStatePath, `${JSON.stringify({ ...runState, status: "failed", error: "UAT retry fixture", finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
    const projectMetaPath = join(projectsRoot, projectId, ".site", "project.json");
    const projectMeta = JSON.parse(await readFile(projectMetaPath, "utf8"));
    projectMeta.taskRecords = projectMeta.taskRecords.map((record) => record.taskId === task.taskId
      ? { ...record, status: "failed", lastError: "UAT retry fixture" }
      : record);
    await writeFile(projectMetaPath, `${JSON.stringify(projectMeta, null, 2)}\n`, "utf8");
    await page.reload({ waitUntil: "networkidle" });
    const retryButton = page.locator('.task-record-row [data-task-action="retry"]');
    await retryButton.waitFor();
    const retryRequests = [];
    page.on("request", (request) => {
      if (request.url().includes("/retry")) retryRequests.push(request.url());
    });
    const retryResponsePromise = page.waitForResponse((response) => {
      const pathname = new URL(response.url()).pathname;
      return pathname.startsWith("/api/v1/projects/") && pathname.endsWith("/retry");
    }, { timeout: 5000 });
    await retryButton.click();
    let retryResponse;
    try {
      retryResponse = await retryResponsePromise;
    } catch (error) {
      throw new Error(`${error.message}; retry requests: ${retryRequests.join(", ") || "none"}; server: ${output}`);
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
    const exportLink = page.locator('a[href^="/api/v1/projects/"][href$="/team/export"]').first();
    await exportLink.waitFor();
    assert.equal(await exportLink.count(), 1);
    const originalProjectId = teamId;
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
    await mobile.goto(`${url}/studio/team/${encodeURIComponent(teamId)}`, { waitUntil: "networkidle" });
    await mobile.locator("#project-graph-stage .x6-node").nth(2).waitFor();
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    await mobile.goto(`${url}/factory/new`, { waitUntil: "networkidle" });
    await mobile.locator("#new-project-form").waitFor();
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    assert.ok(await mobile.locator(".new-team-builder .primary-button").evaluate((button) => button.getBoundingClientRect().width >= 300));
    await mobile.goto(`${url}/studio/project/${encodeURIComponent(projectId)}/run`, { waitUntil: "domcontentloaded" });
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
        buttons: actionButtons.map(rect),
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
