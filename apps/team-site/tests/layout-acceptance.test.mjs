import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
import { seedReleasedClassicTeam } from "./classic-team-fixtures.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function assertRouteContentReachable(page, route) {
  const result = await page.evaluate(() => {
    const root = document.querySelector(".main-area > .page-content:not(.hidden)");
    if (!root) return { error: "active page content is missing" };
    const frameBody = root.querySelector(":scope > .page-frame .page-frame-body");
    const contentRoot = frameBody || root;
    const scrollRegions = [...new Set([
      ...root.querySelectorAll("[data-layout-scroll]"),
      ...root.querySelectorAll("#project-workspace-view .project-detail-sections > .project-panel")
    ])];
    for (const region of scrollRegions) region.scrollTop = region.scrollHeight;
    if (!scrollRegions.length) root.scrollTop = root.scrollHeight;
    const candidates = [...contentRoot.querySelectorAll("*")].filter((element) => {
      if (!element.textContent.trim() || element.children.length) return false;
      if (!element.getClientRects().length || element.closest('[aria-hidden="true"], [hidden]')) return false;
      return !["SCRIPT", "STYLE", "SVG"].includes(element.tagName);
    });
    const lastContent = candidates.sort((left, right) => right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom)[0];
    const rect = lastContent?.getBoundingClientRect();
    const clips = [];
    for (let current = lastContent?.parentElement; current; current = current.parentElement) {
      const overflowY = getComputedStyle(current).overflowY;
      if (["auto", "scroll", "hidden", "clip"].includes(overflowY)) {
        const bounds = current.getBoundingClientRect();
        clips.push({
          selector: current.id ? `#${current.id}` : current.className?.baseVal || current.className || current.tagName,
          overflowY,
          top: bounds.top,
          bottom: bounds.bottom,
          scrollTop: current.scrollTop,
          scrollHeight: current.scrollHeight,
          clientHeight: current.clientHeight
        });
      }
      if (current === root) break;
    }
    const viewportVisible = Boolean(rect && rect.bottom > 0 && rect.top < innerHeight);
    const clipped = clips.filter((clip) => rect && (rect.bottom < clip.top - 1 || rect.top > clip.bottom + 1));
    return {
      hasFrame: Boolean(frameBody),
      hasIndependentGraphViewport: Boolean(root.querySelector(".graph-scroll, .studio-graph-stage, .studio-graph-canvas")),
      markers: scrollRegions.map((element) => ({
        explicit: element.hasAttribute("data-layout-scroll") && !(element.matches("#project-workspace-view .page-frame-body") && innerWidth >= 1024) && !element.closest("#project-workspace-view .project-detail-sections"),
        selector: element.id ? `#${element.id}` : element.className?.baseVal || element.className || element.tagName,
        overflowY: getComputedStyle(element).overflowY,
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight
      })),
      lastText: lastContent?.textContent.trim().slice(0, 80),
      rect: rect && { top: rect.top, bottom: rect.bottom },
      viewportVisible,
      clipped
    };
  });
  assert.equal(result.error, undefined, `${route} must render its active page content`);
  assert.ok(result.lastText, `${route} must render a visible content endpoint: ${JSON.stringify(result)}`);
  assert.ok(result.viewportVisible && result.clipped.length === 0, `${route} must scroll its final content into view instead of clipping it: ${JSON.stringify(result)}`);
  if (result.hasFrame) assert.ok(result.markers.length || result.hasIndependentGraphViewport, `${route} must identify its page, panel, or graph scroll region: ${JSON.stringify(result)}`);
  for (const marker of result.markers) {
    if (marker.explicit) assert.notEqual(marker.overflowY, "hidden", `${route} marks a non-scrollable region as its scroll container: ${JSON.stringify(marker)}`);
    if (marker.scrollHeight > marker.clientHeight + 1) assert.ok(marker.scrollTop > 0, `${route} should reach the bottom of overflowing marked content: ${JSON.stringify(marker)}`);
  }
}

test("Team Site shell keeps navigation accessible and resilient to storage restrictions", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-layout-"));
  const team = await seedReleasedClassicTeam(projectsRoot);
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
    assert.ok(url, `site server did not start: ${output}`);
    browser = await chromium.launch({ headless: true });

    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const desktopPage = await desktop.newPage();
    const teamVersionId = team.teamVersionId || team.projectId;
    await desktopPage.route("**/api/v1/teams/*/versions/*/simulations**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const timestamp = "2026-10-24T00:00:00.000Z";
      if (pathname.endsWith("/events")) return route.fulfill({ json: { events: [{ type: "simulation.completed", at: timestamp, status: "completed" }] } });
      if (pathname.endsWith("/layout-simulation")) return route.fulfill({ json: {
        simulation: { simulationId: "layout-simulation", teamId: team.teamId, teamVersionId, status: "completed", input: "Fixed detail layout fixture", createdAt: timestamp, roleDisplayNames: { reviewer: "审核员" } },
        state: { finalOutputsByRoleId: { reviewer: [{ content: "Fixture output" }] }, finalOutputRoleOrder: ["reviewer"], auditTrail: [{ roleId: "reviewer", status: "completed", stdoutPreview: "Fixture output", inputContext: { task: "Fixed detail layout fixture" }, at: timestamp }] }
      } });
      return route.fulfill({ json: { simulations: [{ simulationId: "layout-simulation", status: "completed", input: "Fixed detail layout fixture", createdAt: timestamp }] } });
    });
    const projectResponse = await desktopPage.request.post(`${url}/api/v1/projects`, {
      data: { name: "Layout acceptance project", overview: "Fixed fixture for layout validation", teamVersionIds: [teamVersionId] }
    });
    assert.equal(projectResponse.status(), 201);
    const project = await projectResponse.json();
    await desktopPage.route(`**/api/v1/projects/${project.projectId}`, async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.taskRecords = Array.from({ length: 32 }, (_, index) => ({ taskId: `layout-task-${index}`, taskNumber: index + 1, teamVersionId, teamName: "Fixture team", status: "queued", input: `Long running task fixture ${index + 1} with enough detail to make the project task panel independently scrollable.` }));
      return route.fulfill({ json: payload });
    });
    let projectList = Array.from({ length: 28 }, (_, index) => ({ projectId: `layout-project-${index}`, name: `Layout project ${index}`, overview: "Fixed layout fixture for list scrolling", mountedTeams: [], projectStatus: "draft", taskRecords: [] }));
    await desktopPage.route("**/api/v1/projects", (route) => route.fulfill({ json: { projects: projectList } }));
    await desktopPage.goto(`${url}/`, { waitUntil: "networkidle" });
    const landingMetrics = await desktopPage.locator("#landing-view").evaluate((landing) => ({ clientHeight: landing.clientHeight, scrollHeight: landing.scrollHeight }));
    assert.ok(landingMetrics.scrollHeight > landingMetrics.clientHeight, `homepage should have content below the fold: ${JSON.stringify(landingMetrics)}`);
    await desktopPage.mouse.move(900, 750);
    await desktopPage.mouse.wheel(0, 500);
    await desktopPage.waitForFunction(() => document.querySelector("#landing-view")?.scrollTop > 0);
    assert.ok(await desktopPage.locator("#landing-view").evaluate((landing) => landing.scrollTop > 0), "homepage should scroll inside its own viewport");
    await desktopPage.goto(`${url}/projects`, { waitUntil: "networkidle" });
    await desktopPage.locator("#projects-view .page-heading").waitFor();
    assert.equal(await desktopPage.locator("#primary-sidebar").evaluate((sidebar) => Math.round(sidebar.getBoundingClientRect().width)), 232);
    const listMetrics = await desktopPage.locator("#collaboration-project-grid").evaluate((list) => ({ clientHeight: list.clientHeight, scrollHeight: list.scrollHeight }));
    assert.ok(listMetrics.scrollHeight > listMetrics.clientHeight, `fixed project fixture should overflow its list region: ${JSON.stringify(listMetrics)}`);
    const headingTop = await desktopPage.locator("#projects-view .page-heading").evaluate((heading) => heading.getBoundingClientRect().top);
    const listScrollTop = await desktopPage.locator("#collaboration-project-grid").evaluate((list) => { list.scrollTop = list.scrollHeight; return list.scrollTop; });
    assert.ok(listScrollTop > 0, "list region should perform its own scrolling");
    assert.equal(await desktopPage.locator("#projects-view").evaluate((root) => root.scrollTop), 0, "template A outer page should not scroll");
    assert.equal(await desktopPage.locator("#projects-view .page-heading").evaluate((heading) => heading.getBoundingClientRect().top), headingTop, "page heading should remain fixed while the list scrolls");
    const desktopWidth = await desktopPage.evaluate(() => ({ page: document.querySelector("#projects-view").clientWidth, main: document.querySelector(".main-area").clientWidth }));
    assert.ok(desktopWidth.page >= desktopWidth.main * 0.95, `template A should use the page width without centering: ${JSON.stringify(desktopWidth)}`);
    projectList = [];
    await desktopPage.reload({ waitUntil: "networkidle" });
    const emptyStateWidth = await desktopPage.locator(".empty-projects").evaluate((emptyState) => ({ width: emptyState.getBoundingClientRect().width, gridWidth: emptyState.parentElement.getBoundingClientRect().width, gridColumn: getComputedStyle(emptyState).gridColumn }));
    assert.ok(emptyStateWidth.width >= emptyStateWidth.gridWidth - 1, `empty project state should use the full list width: ${JSON.stringify(emptyStateWidth)}`);
    projectList = Array.from({ length: 28 }, (_, index) => ({ projectId: `layout-project-${index}`, name: `Layout project ${index}`, overview: "Fixed layout fixture for list scrolling", mountedTeams: [], projectStatus: "draft", taskRecords: [] }));
    await desktopPage.locator("#sidebar-collapse").click();
    await desktopPage.waitForFunction(() => Math.round(document.querySelector("#primary-sidebar").getBoundingClientRect().width) === 56);
    assert.equal(await desktopPage.locator("#sidebar-collapse").getAttribute("aria-expanded"), "false");
    assert.equal(await desktopPage.evaluate(() => localStorage.getItem("ogs.team-site.nav-state")), "collapsed");
    await desktopPage.reload({ waitUntil: "networkidle" });
    await desktopPage.locator("#projects-view .page-heading").waitFor();
    assert.equal(await desktopPage.locator("#primary-sidebar").evaluate((sidebar) => Math.round(sidebar.getBoundingClientRect().width)), 56);
    await desktopPage.locator("#sidebar-collapse").click();
    await desktopPage.waitForFunction(() => Math.round(document.querySelector("#primary-sidebar").getBoundingClientRect().width) === 232);
    const restricted = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    await restricted.addInitScript(() => {
      const getItem = Storage.prototype.getItem;
      const setItem = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) {
        if (key === "ogs.team-site.nav-state") throw new DOMException("Storage is disabled", "SecurityError");
        return getItem.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (key === "ogs.team-site.nav-state") throw new DOMException("Storage is disabled", "SecurityError");
        return setItem.call(this, key, value);
      };
    });
    const restrictedPage = await restricted.newPage();
    await restrictedPage.goto(`${url}/projects`, { waitUntil: "networkidle" });
    await restrictedPage.locator("#projects-view .page-heading").waitFor();
    assert.equal(await restrictedPage.locator("#primary-sidebar").evaluate((sidebar) => Math.round(sidebar.getBoundingClientRect().width)), 56, "tablet default should render when nav storage reads fail");
    await restrictedPage.locator("#sidebar-collapse").click();
    await restrictedPage.waitForFunction(() => Math.round(document.querySelector("#primary-sidebar").getBoundingClientRect().width) === 232);
    await restrictedPage.reload({ waitUntil: "networkidle" });
    await restrictedPage.locator("#projects-view .page-heading").waitFor();
    assert.equal(await restrictedPage.locator("#primary-sidebar").evaluate((sidebar) => Math.round(sidebar.getBoundingClientRect().width)), 56, "storage failure should leave the viewport default intact after reload");
    await restricted.close();

    await desktopPage.setViewportSize({ width: 1920, height: 1080 });
    const wideWidth = await desktopPage.evaluate(() => ({ page: document.querySelector("#projects-view").clientWidth, main: document.querySelector(".main-area").clientWidth }));
    assert.ok(wideWidth.page >= wideWidth.main * 0.95, `wide template A should use the page width: ${JSON.stringify(wideWidth)}`);
    for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
      await desktopPage.setViewportSize({ width, height });
      for (const route of ["/projects", `/projects/${project.projectId}`, `/projects/${project.projectId}/teams`, "/teams", "/history", "/studio", "/studio/roles", "/examples", "/projects/new", "/studio/new", `/studio/teams/${teamVersionId}/info`, `/studio/teams/${teamVersionId}/design`, `/studio/teams/${teamVersionId}/run`, `/studio/teams/${teamVersionId}/release`, "/platform/models", "/cases/software-team"]) {
        await desktopPage.goto(`${url}${route}`, { waitUntil: "domcontentloaded" });
        await desktopPage.locator(".main-area > .page-content:not(.hidden)").waitFor();
        if (route !== "/teams" && !route.includes("/cases/")) await desktopPage.locator(".main-area > .page-content:not(.hidden) .page-frame").waitFor();
        await assertRouteContentReachable(desktopPage, route);
        if (route === `/projects/${project.projectId}` || route.startsWith(`/projects/${project.projectId}/runs/`)) {
          const tabs = desktopPage.locator("[data-project-workspace-tab]");
          assert.equal(await tabs.count(), 4, "project workbench exposes overview, materials, task/run, and team navigation");
          await desktopPage.locator('[data-project-workspace-tab="teams"]').click();
          await desktopPage.waitForFunction(() => document.querySelector('[data-project-workspace-tab="teams"]')?.getAttribute("aria-current") === "page");
          assert.ok(await desktopPage.locator("#project-team-heading").isVisible(), "the team tab resolves to the mounted-team section");
          if (width >= 1024) {
            const panelMetrics = await desktopPage.locator("#project-run-panel").evaluate((panel) => ({
              panelHeight: panel.clientHeight,
              panelScrollHeight: panel.scrollHeight,
              panelOverflow: getComputedStyle(panel).overflowY,
              frameBodyScrollTop: panel.closest(".page-frame-body").scrollTop,
              headingTop: document.querySelector("#project-workspace-view .page-frame-header").getBoundingClientRect().top
            }));
            assert.ok(panelMetrics.panelScrollHeight > panelMetrics.panelHeight, `task panel fixture should overflow: ${JSON.stringify(panelMetrics)}`);
            assert.equal(panelMetrics.panelOverflow, "auto", `task panel should own its scrolling: ${JSON.stringify(panelMetrics)}`);
            const beforeScroll = panelMetrics.headingTop;
            await desktopPage.locator("#project-run-panel").evaluate((panel) => { panel.scrollTop = panel.scrollHeight; });
            assert.ok(await desktopPage.locator("#project-run-panel").evaluate((panel) => panel.scrollTop > 0), "task panel should scroll independently");
            assert.equal(await desktopPage.locator("#project-workspace-view .page-frame-body").evaluate((body) => body.scrollTop), 0, "project page body should not scroll on desktop");
            assert.equal(await desktopPage.locator("#project-workspace-view .page-frame-header").evaluate((heading) => heading.getBoundingClientRect().top), beforeScroll, "project heading should remain fixed while task panel scrolls");
          }
        }
        const geometry = await desktopPage.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        assert.ok(geometry.document <= geometry.viewport + 1 && geometry.body <= geometry.viewport + 1, `${route} should not overflow at ${width}px: ${JSON.stringify(geometry)}`);
        if (!route.includes("/new")) {
          const vertical = await desktopPage.evaluate(() => ({ viewport: innerHeight, document: document.documentElement.scrollHeight, body: document.body.scrollHeight }));
          assert.ok(vertical.document <= vertical.viewport + 1 && vertical.body <= vertical.viewport + 1, `${route} should keep document scrolling inside the page: ${JSON.stringify(vertical)}`);
        }
        if (route.startsWith("/platform/")) {
          assert.equal(await desktopPage.locator(`#primary-sidebar .nav-item[href='${route}']`).evaluate((link) => link.classList.contains("active")), true, `${route} should match the active platform navigation item`);
        }
      }
    }
    await desktopPage.setViewportSize({ width: 1440, height: 900 });
    await desktopPage.goto(`${url}/studio/teams/${teamVersionId}/run/layout-simulation`, { waitUntil: "networkidle" });
    await desktopPage.locator(".studio-run-split").waitFor();
    assert.equal(await desktopPage.locator(".studio-run-history .studio-simulation-row[aria-current='page']").count(), 1);
    assert.ok(await desktopPage.locator(".studio-run-evidence .team-debug-transcript").isVisible());
    await desktopPage.setViewportSize({ width: 1440, height: 900 });
    await desktopPage.locator("#site-theme-toggle").click();
    const contrast = await desktopPage.evaluate(() => {
      const channels = (color) => color.match(/[\d.]+/g).slice(0, 3).map((value) => {
        const channel = Number(value) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      const luminance = (color) => channels(color).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const ratio = (foreground, background) => {
        const [a, b] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
        return (a + 0.05) / (b + 0.05);
      };
      const backgroundFor = (element) => {
        for (let current = element; current; current = current.parentElement) {
          const color = getComputedStyle(current).backgroundColor;
          const channels = color.match(/[\d.]+/g) || [];
          if (channels.length < 4 || Number(channels[3]) > 0) return color;
        }
        return getComputedStyle(root).backgroundColor;
      };
      const root = document.documentElement;
      const frame = document.querySelector(".main-area > .page-content:not(.hidden)");
      const heading = frame.querySelector(".page-frame-header h1");
      const subtitle = frame.querySelector(".page-frame-header p");
      const topbarText = document.querySelector(".breadcrumb strong");
      return {
        theme: root.dataset.visualizerTheme,
        shellBackground: getComputedStyle(document.querySelector(".topbar")).backgroundColor,
        sidebarBackground: getComputedStyle(document.querySelector(".sidebar")).backgroundColor,
        pageBackground: getComputedStyle(frame.querySelector(".page-frame")).backgroundColor,
        headingContrast: ratio(getComputedStyle(heading).color, backgroundFor(heading)),
        subtitleContrast: ratio(getComputedStyle(subtitle).color, backgroundFor(subtitle)),
        breadcrumbContrast: ratio(getComputedStyle(topbarText).color, backgroundFor(topbarText)),
        tokenCanvas: getComputedStyle(root).getPropertyValue("--canvas").trim()
      };
    });
    assert.equal(contrast.theme, "dark");
    assert.ok(contrast.headingContrast >= 4.5 && contrast.subtitleContrast >= 4.5 && contrast.breadcrumbContrast >= 4.5, `dark representative text contrast should meet WCAG AA: ${JSON.stringify(contrast)}`);
    const darkActiveNavigation = await desktopPage.locator("#primary-sidebar .nav-item.active").evaluate((item) => ({
      background: getComputedStyle(item).backgroundColor,
      color: getComputedStyle(item).color
    }));
    assert.deepEqual(darkActiveNavigation, { background: "rgba(56, 189, 248, 0.14)", color: "rgb(215, 243, 255)" }, "dark active navigation should use the shell theme colors");
    await desktopPage.locator("#site-theme-toggle").click();
    const lightActiveNavigation = await desktopPage.locator("#primary-sidebar .nav-item.active").evaluate((item) => {
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        background: getComputedStyle(item).backgroundColor,
        color: getComputedStyle(item).color,
        tokenBackground: rootStyle.getPropertyValue("--mint-soft").trim(),
        tokenColor: rootStyle.getPropertyValue("--mint-dark").trim()
      };
    });
    assert.equal(lightActiveNavigation.background, "rgb(231, 244, 239)", "light active navigation should use the soft mint surface");
    assert.equal(lightActiveNavigation.color, "rgb(14, 99, 77)", "light active navigation should use the active mint text token");
    assert.deepEqual(lightActiveNavigation, { ...lightActiveNavigation, tokenBackground: "#e7f4ef", tokenColor: "#0e634d" }, "light active navigation should match the resolved theme tokens");
    await desktop.close();

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`${url}/projects`, { waitUntil: "networkidle" });
    await mobilePage.locator("#projects-view .page-heading").waitFor();
    assert.equal(await mobilePage.locator("#app-shell").getAttribute("data-mobile-nav"), "closed");
    assert.equal(await mobilePage.locator("#sidebar-scrim").isVisible(), false);
    const shellGeometry = await mobilePage.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: innerWidth,
      documentHeight: document.documentElement.scrollHeight,
      bodyHeight: document.body.scrollHeight,
      viewportHeight: innerHeight
    }));
    assert.ok(shellGeometry.documentWidth <= shellGeometry.viewportWidth + 1, `mobile shell should not overflow horizontally: ${JSON.stringify(shellGeometry)}`);
    assert.ok(shellGeometry.documentHeight <= shellGeometry.viewportHeight + 1, `mobile shell should keep document scrolling inside the page viewport: ${JSON.stringify(shellGeometry)}`);
    await mobilePage.goto(`${url}/projects/${project.projectId}`, { waitUntil: "networkidle" });
    const mobileProjectLayout = await mobilePage.locator("#project-workspace-view .page-frame-body").evaluate((body) => ({ overflow: getComputedStyle(body).overflowY, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight }));
    assert.equal(mobileProjectLayout.overflow, "auto", `mobile project workspace should use continuous body scrolling: ${JSON.stringify(mobileProjectLayout)}`);
    assert.ok(mobileProjectLayout.scrollHeight > mobileProjectLayout.clientHeight, `mobile project fixture should exceed the viewport body: ${JSON.stringify(mobileProjectLayout)}`);

    const toggle = mobilePage.locator("#mobile-nav-toggle");
    await toggle.focus();
    await toggle.click();
    assert.equal(await mobilePage.locator("#app-shell").getAttribute("data-mobile-nav"), "open");
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.equal(await mobilePage.locator("#primary-sidebar").evaluate((sidebar) => getComputedStyle(sidebar).flexDirection), "column", "mobile navigation should use a vertical drawer layout");
    assert.equal(await mobilePage.locator('#primary-sidebar .nav-item[href="/studio"]').isVisible(), true, "drawer navigation links should remain visible");
    assert.equal(await mobilePage.locator("#primary-sidebar .workspace-switcher").isVisible(), true, "drawer should retain the workspace switcher");
    assert.equal(await mobilePage.locator("#primary-sidebar :focus").count(), 1, "opening the drawer should move focus inside it");
    await mobilePage.keyboard.press("Escape");
    assert.equal(await mobilePage.locator("#app-shell").getAttribute("data-mobile-nav"), "closed");
    assert.equal(await mobilePage.evaluate(() => document.activeElement.id), "mobile-nav-toggle", "Escape should restore focus to the drawer trigger");

    await toggle.click();
    await mobilePage.locator("#sidebar-scrim").click({ position: { x: 380, y: 400 } });
    assert.equal(await mobilePage.locator("#app-shell").getAttribute("data-mobile-nav"), "closed");
    assert.equal(await mobilePage.evaluate(() => document.activeElement.id), "mobile-nav-toggle", "scrim close should restore focus");

    await toggle.click();
    await mobilePage.locator('#primary-sidebar .nav-item[href="/studio"]').click();
    await mobilePage.waitForURL(/\/studio$/);
    await mobilePage.locator("#studio-view .repository-heading").waitFor();
    assert.equal(await mobilePage.locator("#app-shell").getAttribute("data-mobile-nav"), "closed", "route changes should close the mobile drawer");
    assert.equal(await mobilePage.evaluate(() => document.activeElement.id), "mobile-nav-toggle", "route change should restore focus");

    await mobilePage.locator("#topbar-more-toggle").click();
    assert.equal(await mobilePage.locator("#topbar-more-toggle").getAttribute("aria-expanded"), "true");
    assert.equal(await mobilePage.locator("#topbar-controls").isVisible(), true);
    await mobilePage.keyboard.press("Escape");
    assert.equal(await mobilePage.locator("#topbar-more-toggle").getAttribute("aria-expanded"), "false");
    for (const route of ["/projects", `/projects/${project.projectId}`, `/projects/${project.projectId}/teams`, "/teams", "/history", "/studio", "/studio/roles", "/examples", "/projects/new", "/studio/new", `/studio/teams/${teamVersionId}/info`, `/studio/teams/${teamVersionId}/design`, `/studio/teams/${teamVersionId}/run`, `/studio/teams/${teamVersionId}/release`, "/platform/models", "/cases/software-team"]) {
      await mobilePage.goto(`${url}${route}`, { waitUntil: "domcontentloaded" });
      await mobilePage.locator(".main-area > .page-content:not(.hidden)").waitFor();
      await assertRouteContentReachable(mobilePage, route);
      const undersized = await mobilePage.locator(".main-area > .page-content:not(.hidden)").evaluate((page) => [...page.querySelectorAll("button, a[href], input:not([type=checkbox]):not([type=radio]), select, textarea, [role=button]")]
        .filter((element) => !element.closest("[hidden]") && !element.closest("dialog:not([open])") && !element.hasAttribute("disabled") && !element.hasAttribute("data-touch-target-exempt"))
        .map((element) => ({ label: element.getAttribute("aria-label") || element.textContent.trim().slice(0, 36) || element.tagName, width: Math.round(element.getBoundingClientRect().width), height: Math.round(element.getBoundingClientRect().height) }))
        .filter((element) => element.width > 0 && element.height > 0)
        .filter((element) => element.width < 44 || element.height < 44));
      assert.deepEqual(undersized, [], `${route} should keep mobile interactive targets at least 44px: ${JSON.stringify(undersized)}`);
    }
    await mobile.close();
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => undefined);
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
