import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
import { seedReleasedClassicTeam } from "./classic-team-fixtures.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function startServer(projectsRoot) {
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot },
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

async function closeServer(server, projectsRoot, browser) {
  await browser?.close();
  server.kill();
  await once(server, "exit").catch(() => undefined);
  await rm(projectsRoot, { recursive: true, force: true });
}

test("Team Site serves direct links for the Studio role repository and shared resource pages", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-resource-deeplinks-"));
  const { server, url } = await startServer(projectsRoot);
  try {
    for (const path of ["/studio/roles", "/platform/models", "/platform/data", "/platform/tools", "/platform/storage"]) {
      const response = await fetch(`${url}${path}`);
      assert.equal(response.status, 200, `${path} should load the SPA shell directly`);
      assert.match(response.headers.get("content-type") || "", /text\/html/);
    }
  } finally {
    await closeServer(server, projectsRoot);
  }
});

test("released Team global settings show stable identifiers as read-only values", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-global-readonly-"));
  const team = await seedReleasedClassicTeam(projectsRoot);
  const { server, url } = await startServer(projectsRoot);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${url}/studio/teams/${team.projectId}/design`, { waitUntil: "networkidle" });
    await page.locator('#project-graph-stage [data-studio-graph-action="assets"]').waitFor({ timeout: 10000 }).catch(async () => {
      assert.fail(`Studio graph toolbar did not mount: ${await page.locator("#project-design-status").innerText().catch(() => "no design status")} | ${await page.locator("#project-graph-stage").innerText().catch(() => "no stage")}`);
    });
    await page.locator('#project-graph-stage [data-studio-graph-action="assets"]').click();
    await page.locator("#studio-assets-global-tab").click();
    await page.locator("#studio-assets-global .studio-readonly-value").first().waitFor();
    assert.equal(await page.locator("#studio-assets-global [data-system-field]").count(), 0);
    assert.equal(await page.locator("#studio-assets-global textarea").count(), 0);
    assert.match(await page.locator("#studio-assets-global").innerText(), /系统标识/);
    assert.match(await page.locator("#studio-assets-global .studio-readonly-value").first().innerText(), /^[a-z][a-z0-9.-]+$/);
  } finally {
    await closeServer(server, projectsRoot, browser);
  }
});

test("duplicate team and project creation keeps the user on the form with the entered values", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-product-duplicates-"));
  await seedReleasedClassicTeam(projectsRoot);
  const { server, url } = await startServer(projectsRoot);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${url}/studio/new`, { waitUntil: "networkidle" });
    await page.locator("#new-project-form input[name=name]").fill("Duplicate Product Team");
    await page.locator("#new-project-form textarea[name=overview]").fill("Keep the original team and explain duplicate creation clearly.");
    await page.locator("#new-project-form button[type=submit]").click();
    await page.waitForURL(/\/teams\/[a-z0-9-]+\/design$/);
    const teamId = page.url().match(/\/teams\/([^/]+)\/design$/)?.[1];
    assert.ok(teamId);
    await page.goto(`${url}/studio/new`, { waitUntil: "networkidle" });
    await page.locator("#new-project-form input[name=name]").fill("Duplicate Product Team");
    await page.locator("#new-project-form textarea[name=overview]").fill("This input must remain after the duplicate is rejected.");
    await page.locator("#new-project-form button[type=submit]").click();
    await page.waitForFunction(() => document.querySelector("#new-project-status")?.textContent.includes("TEAM_NAME_EXISTS"));
    assert.match(page.url(), /\/studio\/new$/);
    assert.equal(await page.locator("#new-project-form input[name=name]").inputValue(), "Duplicate Product Team");
    assert.match(await page.locator("#new-project-form textarea[name=overview]").inputValue(), /remain after/);

    const releasedTeams = await page.request.get(`${url}/api/v1/team-repository?status=released`).then((response) => response.json());
    const mountableTeamId = releasedTeams.teams[0]?.teamVersionId;
    assert.ok(mountableTeamId, "built-in TeamVersions should be available for Project creation");
    const createdProject = await page.request.post(`${url}/api/v1/projects`, {
      data: { name: "Duplicate Product Project", overview: "Original project.", teamVersionIds: [mountableTeamId] }
    });
    assert.equal(createdProject.status(), 201);
    await page.goto(`${url}/projects/new`, { waitUntil: "networkidle" });
    await page.locator("#collaboration-project-form input[name=name]").fill("Duplicate Product Project");
    await page.locator(`#project-team-options input[value="${mountableTeamId}"]`).check();
    await page.locator("#collaboration-project-form button[type=submit]").click();
    await page.waitForFunction(() => document.querySelector("#collaboration-project-status")?.textContent.includes("PROJECT_NAME_EXISTS"));
    assert.match(page.url(), /\/projects\/new$/);
    assert.equal(await page.locator("#collaboration-project-form input[name=name]").inputValue(), "Duplicate Product Project");
  } finally {
    await closeServer(server, projectsRoot, browser);
  }
});

test("Natural assistant failures are visible and successful previews can be applied without page errors", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-product-natural-"));
  const { server, url } = await startServer(projectsRoot);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      window.__productUnhandled = [];
      window.addEventListener("unhandledrejection", (event) => window.__productUnhandled.push(String(event.reason?.message || event.reason || "unhandled rejection")));
    });
    const team = await page.request.post(`${url}/api/v1/team-factory`, { data: { name: "Natural Product Team", overview: "Turn product feedback into reviewed priorities.", locale: "zh-CN" } }).then((response) => response.json());
    const design = await page.request.get(`${url}/api/v1/team-versions/${team.projectId}/design`).then((response) => response.json());
    let mode = "failure";
    let latestChatPayload;
    await page.route(`**/api/v1/team-versions/${team.projectId}/chat`, async (route) => {
      latestChatPayload = JSON.parse(route.request().postData() || "{}");
      if (mode === "failure") {
        await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "TEAM_ASSISTANT_MODEL_UNAVAILABLE: test model discovery failure" }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        mode: "draft",
        summary: "已理解目标，并生成团队调整预览。",
        authoringPatch: { authoring: design.authoring },
        questions: [],
        unresolvedItems: []
      }) });
    });
    await page.route("**/api/v1/platform/models", (route) => route.fulfill({ json: { models: [{ backend: "codex", id: "gpt-6-luna", ref: "codex/gpt-6-luna", name: "GPT 6 Luna", runnable: true }] } }));
    await page.goto(`${url}/studio/teams/${team.projectId}/design`, { waitUntil: "networkidle" });
    await page.locator("#team-assistant").waitFor({ state: "attached" });
    assert.equal(await page.locator("#team-assistant-input").count(), 0, "the assistant should load only after opening its dialog");
    await page.locator('#project-graph-stage [data-studio-graph-action="chat-generate"]').waitFor({ timeout: 10000 }).catch(async () => {
      throw new Error(`Studio graph toolbar did not mount: ${await page.locator("#project-design-status").innerText().catch(() => "no status")}; stage=${(await page.locator("#project-graph-stage").innerText().catch(() => "no stage")).slice(0, 500)}`);
    });
    let globalAssetsReads = 0;
    await page.route(`**/api/v1/team-versions/${team.projectId}/design/assets`, async (route) => {
      globalAssetsReads += 1;
      if (globalAssetsReads === 1) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary global configuration read failure" }) });
        return;
      }
      await route.fallback();
    });
    await page.locator('#project-graph-stage [data-studio-graph-action="assets"]').click();
    await page.locator("#studio-assets-global-tab").click();
    await page.locator("#studio-assets-global [data-system-settings-retry]").waitFor();
    assert.match(await page.locator("#studio-assets-global [role=alert]").innerText(), /Temporary global configuration read failure/);
    await page.locator("#studio-assets-global [data-system-settings-retry]").click();
    await page.locator('#studio-assets-global .studio-readonly-value').first().waitFor();
    assert.equal(await page.locator('#studio-assets-global [data-system-field="systemId"]').count(), 0);
    assert.equal(await page.locator('#studio-assets-global .studio-readonly-value').first().innerText(), design.authoring.system.systemId);
    assert.equal(await page.locator('#studio-assets-global [data-system-field="systemVersion"]').count(), 1, "draft version should remain editable");
    assert.equal(globalAssetsReads, 2, "retry should re-read global configuration assets exactly once");
    await page.unroute(`**/api/v1/team-versions/${team.projectId}/design/assets`);
    await page.locator("#studio-asset-drawer-close").click();
    await page.locator('#project-graph-stage [data-studio-graph-action="chat-generate"]').click();
    await page.locator("#team-build-dialog[open]").waitFor();
    await page.locator("#team-assistant-input").waitFor();
    await page.locator("#team-assistant-input").fill("增加一个最终审核角色，确保结果有依据。");
    await page.locator("#team-assistant-send").click();
    await page.locator("#team-assistant-status").getByText("部署环境尚未发现可运行的 OpenCode 模型。", { exact: false }).waitFor();
    await page.locator('#team-assistant-status a[href="/platform"]').waitFor();
    mode = "success";
    await page.locator("#team-assistant-input").fill("增加一个最终审核角色，确保结果有依据。");
    await page.locator("#team-assistant-send").click();
    await page.locator("#team-assistant-apply").waitFor();
    assert.match(await page.locator("#team-assistant-history").innerText(), /已理解目标/);
    assert.equal(typeof latestChatPayload.systemSource, "string");
    assert.equal(typeof latestChatPayload.authoring, "object");
    const saveResponse = page.waitForResponse((response) => response.url().includes(`/api/v1/team-versions/${team.projectId}/design`) && response.request().method() === "PUT");
    await page.locator("#team-assistant-apply").click();
    assert.equal((await saveResponse).status(), 200);
    await page.locator("#team-assistant").waitFor();
    await page.locator("[data-team-build-close]").click();
    await page.locator("#studio-simulation-run-open").click();
    await page.locator("#team-debug-dialog.is-open[aria-hidden='false']").waitFor();
    await page.locator("[data-team-debug-close]").click();
    await page.locator('#project-graph-stage [data-studio-graph-action="validate"]').click();
    await page.getByText("结构校验通过", { exact: true }).waitFor();
    const checkedDesign = await page.request.get(`${url}/api/v1/team-versions/${team.projectId}/design`).then((response) => response.json());
    assert.equal(checkedDesign.projectStatus, "draft", "validation must not publish or confirm the draft");
    const runRoot = join(projectsRoot, team.projectId, ".ogs", "runs");
    await page.locator('#project-graph-stage [data-studio-graph-action="debug-run"]').click();
    await page.locator("#team-debug-dialog.is-open[aria-hidden='false']").waitFor();
    const simulationPrompt = "Preview the software delivery handoffs.";
    await page.locator("#team-simulation-input").fill(simulationPrompt);
    await page.route("**/api/v1/platform/discovery", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [], sources: [] }) });
    });
    await page.locator("#team-simulation-run").click();
    const firstReadinessDialog = page.locator(".confirm-dialog");
    await firstReadinessDialog.waitFor();
    assert.match(await firstReadinessDialog.innerText(), /部分团队角色可能无法执行/);
    await firstReadinessDialog.locator('button[value="cancel"]').click();
    const simulationEndpoint = `/api/v1/teams/${team.teamId}/versions/${team.projectId}/simulations`;
    const simulationResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === simulationEndpoint);
    await page.locator("#team-simulation-run").click();
    await firstReadinessDialog.waitFor();
    await firstReadinessDialog.locator('button[value="confirm"]').click();
    const simulationResponse = await simulationResponsePromise;
    assert.equal(simulationResponse.status(), 202);
    const simulationResponseBody = await simulationResponse.json();
    assert.equal(simulationResponseBody.simulation.teamVersionId, team.projectId);
    assert.equal(simulationResponseBody.simulation.runKind, "studio_simulation");
    assert.equal(simulationResponseBody.simulation.mode, "dry-run");
    assert.ok(simulationResponseBody.simulation.simulationId);
    assert.equal(await page.locator("[data-studio-graph-quick-debug]").isHidden(), true);
    await page.locator("#team-simulation-result .team-simulation-result").waitFor();
    await page.getByRole("link", { name: "查看运行详情" }).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('#team-simulation-result a[href*="/run/"]').count(), 1);
    assert.ok((await page.locator("#team-simulation-result pre").last().innerText()).trim().length > 0);
    const simulationRuns = await readdir(runRoot, { withFileTypes: true }).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
    assert.deepEqual(simulationRuns, [], "Studio quick simulation must not create Run history");
    let simulationScenario = "no-output";
    let mockedSimulationEvidence;
    await page.route(`**${simulationEndpoint}`, async (route) => {
      const partial = simulationScenario === "partial";
      mockedSimulationEvidence = {
        simulation: {
          simulationId: `mock-${simulationScenario}`,
          runKind: "studio_simulation",
          teamId: team.teamId,
          teamVersionId: team.projectId,
          status: "completed",
          mode: "dry-run"
        },
        state: {
          status: "completed",
          finalOutputsByRoleId: partial ? { analyst: [{ content: "Partial team result" }] } : {},
          finalOutputRoleOrder: partial ? ["analyst"] : [],
          auditTrail: [
            { roleId: "demo-analyst", status: "noop" },
            ...(partial ? [{ roleId: "demo-reviewer", status: "ok" }] : [])
          ]
        },
        events: []
      };
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(mockedSimulationEvidence) });
    });
    await page.route(`**${simulationEndpoint}/**`, async (route) => {
      if (route.request().url().endsWith("/events") || route.request().url().includes("/events?")) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ events: [], cursor: 0, done: true }) });
      } else {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(mockedSimulationEvidence) });
      }
    });
    await page.locator("#team-simulation-run").click();
    const readinessDialog = page.locator(".confirm-dialog");
    await readinessDialog.waitFor();
    await readinessDialog.locator('button[value="confirm"]').click();
    await page.locator("#team-simulation-result .status-chip").getByText("未产出结果", { exact: true }).waitFor();
    assert.match(await page.locator("#team-simulation-result").innerText(), /demo-analyst[\s\S]*未执行：未配置模型或执行配置/);
    assert.match(await page.locator("#team-simulation-result pre").last().innerText(), /请为上方角色配置模型或执行配置后重试/);
    simulationScenario = "partial";
    await page.locator("#team-simulation-run").click();
    await readinessDialog.waitFor();
    await readinessDialog.locator('button[value="confirm"]').click();
    await page.locator("#team-simulation-result .status-chip").getByText("部分完成", { exact: true }).waitFor();
    assert.equal(await page.locator('#team-simulation-result a[href*="/run/"]').count(), 1);
    assert.match(await page.locator("#team-simulation-result pre").last().innerText(), /Partial team result/);
    assert.deepEqual(await readdir(runRoot, { withFileTypes: true }).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error)), [], "noop previews must remain outside Run history");
    await page.locator("[data-team-debug-close]").click();
    await page.locator("#studio-team-info-open").click();
    const overview = page.locator('#project-edit-form textarea[name="overview"]');
    await overview.fill(await overview.inputValue());
    await page.locator('#project-edit-form button[type="submit"]').click();
    await page.locator("#project-graph-stage").waitFor({ state: "visible" });
    await page.locator('#project-graph-stage [data-studio-graph-action="validate"]').waitFor({ state: "visible" });
    await page.locator("#confirm-project").click();
    await page.waitForURL(/\/studio\/teams\/[a-z0-9-]+\/release$/);
    assert.equal(await page.locator("#studio-release-button").isDisabled(), true, "static validation alone must not release a TeamVersion");
    const releaseResponse = await page.request.post(`${url}/api/v1/team-versions/${team.projectId}/release`);
    assert.equal(releaseResponse.status(), 400);
    assert.match((await releaseResponse.json()).error, /TEAM_RELEASE_BASELINE_REQUIRED/);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(await page.evaluate(() => window.__productUnhandled), []);
  } finally {
    await closeServer(server, projectsRoot, browser);
  }
});

test("Studio professional inspector edits TeamVersion role and flow assets and persists them", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-studio-inspector-"));
  const { server, url } = await startServer(projectsRoot);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    let team;
    let submittedAuthoring;
    let submittedAssets;
    let submittedAssetAuthoring;
    const saveSequence = [];
    const designResponses = [];
    const studioRequests = [];
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.stack || error.message));
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.includes(`/api/v1/team-versions/${team?.projectId}`)) studioRequests.push({ method: request.method(), pathname });
      if (pathname.endsWith(`/api/v1/team-versions/${team.projectId}/design`) && request.method() === "PUT") {
        try { submittedAuthoring = JSON.parse(request.postData() || "{}").authoring; } catch { /* assertion below reports missing payload */ }
      }
      if (pathname.endsWith(`/api/v1/team-versions/${team.projectId}/design/assets`) && request.method() === "PUT") {
        try { const body = JSON.parse(request.postData() || "{}"); submittedAssets = body.assets; submittedAssetAuthoring = body.authoring; } catch { /* assertion below reports missing payload */ }
      }
    });
    page.on("response", async (response) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.endsWith(`/api/v1/team-versions/${team?.projectId}/design`) && response.request().method() === "PUT") saveSequence.push("design");
      if (pathname.endsWith(`/api/v1/team-versions/${team?.projectId}/design/assets`) && response.request().method() === "PUT") saveSequence.push("assets");
      if (!response.url().includes(`/api/v1/team-versions/${team?.projectId}/design`)) return;
      designResponses.push({ url: response.url(), method: response.request().method(), status: response.status(), body: await response.json().catch(() => ({})) });
    });
    team = await page.request.post(`${url}/api/v1/cases/software-team/template`, {
      data: { name: "Professional Inspector Team", overview: "Exercise role and flow configuration." }
    }).then((response) => response.json());
    const designResponse = await page.request.get(`${url}/api/v1/team-versions/${team.projectId}/design`);
    const design = await designResponse.json();
    const roleId = "backend-planner";
    const flow = Object.values(design.authoring.flows).find((item) => item.fromRoleId !== "__system_start__" && item.toRoleId !== "__system_end__");
    assert.ok(roleId, "fixture team should have an editable role");
    assert.ok(flow, "fixture team should have an editable flow");
    design.authoring.system.handoffMode = "transition";
    const configured = await page.request.put(`${url}/api/v1/team-versions/${team.projectId}/design`, {
      data: { authoring: design.authoring, expectedTeamVersionDigest: design.teamVersionDigest }
    });
    assert.equal(configured.status(), 200, await configured.text());

    let releaseGraphDesign;
    let graphDesignStarted;
    const graphDesignRequest = new Promise((resolve) => { graphDesignStarted = resolve; });
    const graphDesignGate = new Promise((resolve) => { releaseGraphDesign = resolve; });
    await page.route(`**/api/v1/team-versions/${team.projectId}/design*`, async (route) => {
      graphDesignStarted();
      await graphDesignGate;
      await route.continue();
    });
    const navigation = page.goto(`${url}/studio/teams/${team.projectId}/design`, { waitUntil: "networkidle" });
    await graphDesignRequest;
    await page.locator(".studio-graph-loading").waitFor();
    assert.equal(await page.locator("#project-graph-stage").getAttribute("aria-busy"), "true");
    releaseGraphDesign();
    await navigation;
    await page.unroute(`**/api/v1/team-versions/${team.projectId}/design*`);
    const inspector = page.locator("#studio-property-inspector");
    assert.equal(await page.locator("#studio-workbench-host").count(), 1, `Studio design shell missing at ${page.url()}: ${(await page.locator("#studio-view").innerText().catch(() => "no studio view")).slice(0, 600)}`);
    assert.equal(await page.locator("#studio-view .project-grid").count(), 0, "Studio design should not inherit the Project editor grid");
    const startNode = page.locator('#project-graph-stage .x6-node[data-cell-id="__system_start__"]');
    await startNode.click({ force: true });
    await page.waitForFunction(() => document.querySelector("#studio-property-inspector")?.innerText.includes("开始") || document.querySelector("#studio-property-inspector")?.innerText.includes("Start"), { timeout: 3000 }).catch(() => undefined);
    const startSelectionState = await page.evaluate(() => ({
      inspector: document.querySelector("#studio-property-inspector")?.innerText,
      drawerHidden: document.querySelector("#studio-asset-drawer")?.getAttribute("aria-hidden"),
      startSelected: document.querySelector('#project-graph-stage .x6-node[data-cell-id="__system_start__"]')?.className.baseVal,
      startNodeCount: document.querySelectorAll('#project-graph-stage .x6-node[data-cell-id="__system_start__"]').length
    }));
    assert.match(startSelectionState.inspector || "", /开始只能连接业务角色，不能直接连接结束/, JSON.stringify(startSelectionState));
    await page.locator("#studio-asset-drawer-close").click();
    await page.locator('#project-graph-stage [data-studio-graph-action="assets"]').click();
    await page.locator("#studio-assets-global-tab").click();
    await page.getByRole("heading", { name: "全局配置" }).waitFor({ timeout: 10000 }).catch(async () => {
      const panelState = await page.locator("#studio-assets-global").evaluate((panel) => ({ html: panel.outerHTML.slice(0, 800), hidden: panel.hidden, drawerHidden: panel.closest("#studio-asset-drawer")?.getAttribute("aria-hidden") })).catch(() => null);
      throw new Error(`Global settings panel did not render: ${JSON.stringify({ panelState, studioRequests, browserErrors })}`);
    });
    assert.match(page.url(), /\/studio\/teams\/[^/]+\/design$/);
    await page.locator('[data-system-field="systemVersion"]').fill("2.4.0");
    await page.locator('[data-system-field="lawGlobalRef"]').fill("law.site.software-team");
    await page.locator('[data-system-field="handoffMode"]').selectOption("transition");
    await page.locator("[data-system-save]").click();
    await page.waitForFunction(() => {
      const status = document.querySelector("[data-system-status]")?.textContent || "";
      return status && !status.includes("正在保存");
    }, { timeout: 10000 });
    assert.equal(await page.locator("[data-system-status]").innerText(), "全局配置已保存。");
    await page.goto(`${url}/studio/teams/${team.projectId}/design`, { waitUntil: "networkidle" });
    await page.locator('#project-graph-stage [data-studio-graph-action="assets"]').click();
    await page.locator(`#studio-assets-roles [data-studio-asset-role="${roleId}"]`).click();
    await inspector.waitFor();
    await page.locator('#project-graph-stage [data-studio-graph-action="assets"]').click();
    await page.locator(`#studio-assets-roles [data-studio-asset-role="${roleId}"]`).click();
    await inspector.locator('[data-studio-role-field="bindingKind"]').selectOption("model");
    await inspector.locator('[data-studio-role-field="modelRef"]').selectOption("codex/gpt-6-luna");
    await inspector.locator('[data-studio-role-field="routingMode"]').selectOption("parallel_split");
    await inspector.locator('[data-studio-role-field="loopMax"]').fill("3");
    await inspector.locator('[data-studio-role-field="contextMap"]').fill('{"brief":"global.task"}');
    assert.match(await inspector.locator('[data-studio-role-field="contextMap"]').inputValue(), /global\.task/);
    await inspector.locator('[data-studio-context-add]').click();
    await inspector.locator('[data-studio-context-target]').last().fill("audience");
    const contextSource = inspector.locator('[data-studio-context-source]').last();
    assert.equal(await contextSource.evaluate((element) => getComputedStyle(element).minHeight), "34px");
    assert.equal(await contextSource.evaluate((element) => getComputedStyle(element).borderRadius), "4px");
    assert.match(await contextSource.locator('option[value="global.task"]').first().innerText(), /本次任务/);
    await inspector.getByText("角色资产包", { exact: true }).click();
    await inspector.locator('[data-studio-role-asset="prompt.md"]').fill("Review source material and return cited findings.");
    const joinRoleId = "delivery-lead";
    await page.locator("#studio-asset-drawer-close").click();
    await page.locator(`#project-graph-stage .x6-node[data-cell-id="${joinRoleId}"]`).click();
    await inspector.locator('[data-studio-role-field="joinMode"]').selectOption("quorum_of");
    await inspector.locator('[data-studio-role-field="joinMin"]').fill("3");
    const reviewRoleId = "quality-planner";
    await page.locator("#studio-asset-drawer-close").click();
    await page.locator(`#project-graph-stage .x6-node[data-cell-id="${reviewRoleId}"]`).click();
    await inspector.locator('[data-studio-role-field="reviewEnabled"]').check();
    await inspector.locator('[data-studio-role-field="reviewTimeout"]').fill("180");
    await inspector.locator('[data-studio-role-field="reviewTimeoutAction"]').selectOption("terminate");
    await inspector.locator('[data-studio-role-field="reviewTarget"]').selectOption("backend-planner");
    await inspector.locator('[data-studio-role-field="reviewReworkMax"]').fill("2");
    await inspector.locator('[data-studio-role-field="reviewTerminateScope"]').selectOption("branch");
    await inspector.getByText("角色资产包", { exact: true }).click();
    const reviewRoleDefinition = JSON.parse(await inspector.locator('[data-studio-role-asset="role.json"]').inputValue());
    reviewRoleDefinition.authority ||= {};
    reviewRoleDefinition.authority.controlActions = [...new Set([...(reviewRoleDefinition.authority.controlActions || []), "approve", "rework", "terminate"])];
    await inspector.locator('[data-studio-role-asset="role.json"]').fill(JSON.stringify(reviewRoleDefinition));
    const orderRoleId = Object.keys(design.authoring.roles).find((id) => new Set(Object.values(design.authoring.flows).filter((item) => item.fromRoleId === id && item.toRoleId !== "__system_end__").map((item) => item.toRoleId)).size > 1);
    let expectedRouteOrder = [];
    if (orderRoleId) {
      await page.locator("#studio-asset-drawer-close").click();
      await page.locator(`#project-graph-stage .x6-node[data-cell-id="${orderRoleId}"]`).click();
      const routeOrderRows = inspector.locator("[data-studio-route-order-item]");
      assert.ok(await routeOrderRows.count() >= 2);
      assert.equal(await routeOrderRows.first().getAttribute("draggable"), "true");
      const originalFirst = await routeOrderRows.first().getAttribute("data-studio-route-order");
      await routeOrderRows.first().locator('[data-studio-route-order-move="down"]').click();
      assert.notEqual(await routeOrderRows.first().getAttribute("data-studio-route-order"), originalFirst);
      assert.deepEqual(await inspector.locator("[data-studio-route-order-position]").allTextContents(), Array.from({ length: await routeOrderRows.count() }, (_, index) => String(index + 1)));
      await routeOrderRows.last().dragTo(routeOrderRows.first());
      expectedRouteOrder = await routeOrderRows.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-studio-route-order")));
      assert.equal(expectedRouteOrder[0], await routeOrderRows.first().getAttribute("data-studio-route-order"));
    }
    const execRoleId = Object.keys(design.authoring.roles).find((id) => id !== roleId);
    assert.ok(execRoleId, "fixture team should include a second role for execution profile editing");
    await page.locator("#studio-asset-drawer-close").click();
    await page.locator(`#project-graph-stage .x6-node[data-cell-id="${execRoleId}"]`).click();
    await inspector.locator('[data-studio-role-field="bindingKind"]').selectOption("exec");
    await inspector.getByText("执行配置与本地工具", { exact: true }).click();
    await inspector.locator('[data-studio-profile-field="profileId"]').fill("review-cli-profile");
    await inspector.locator('[data-studio-profile-field="toolRef"]').fill("review-cli-tool");
    await inspector.locator('[data-studio-tool-field="command"]').fill("node");
    await inspector.locator('[data-studio-tool-field="argsTemplate"]').fill('["./tools/review.mjs","--json"]');
    await inspector.locator('[data-studio-tool-field="stdinMode"]').selectOption("none");
    await inspector.locator('[data-studio-profile-field="timeoutMs"]').fill("45000");
    await inspector.locator('[data-studio-profile-field="maxOutputBytes"]').fill("8192");
    const openCodeModel = await page.request.get(`${url}/api/v1/platform/models`)
      .then((response) => response.json())
      .then((payload) => payload.models.find((model) => model.backend === "opencode" && model.runnable));
    const openCodeRoleId = Object.keys(design.authoring.roles).find((id) => id !== roleId && id !== execRoleId);
    if (openCodeModel && openCodeRoleId) {
      const selectionRef = openCodeModel.selectionRef || `${openCodeModel.backend}/${openCodeModel.id}`;
      await page.locator("#studio-asset-drawer-close").click();
      await page.locator(`#project-graph-stage .x6-node[data-cell-id="${openCodeRoleId}"]`).click();
      await inspector.locator('[data-studio-role-field="bindingKind"]').selectOption("model");
      await inspector.locator('[data-studio-role-field="modelRef"]').selectOption(selectionRef);
      assert.equal(await inspector.locator('[data-studio-role-field="modelRef"]').inputValue(), selectionRef);
    }
    await page.locator("#studio-asset-drawer-close").click();
    await page.locator('#project-graph-stage [data-studio-graph-action="assets"]').click();
    await page.locator("#studio-assets-flows-tab").click();
    await page.locator("#studio-assets-flows input[type='search']").fill(design.authoring.roles[flow.fromRoleId].title);
    const flowAssetKey = `${flow.fromRoleId}:${flow.eventType}:${flow.toRoleId}`;
    await page.locator(`#studio-assets-flows [data-studio-asset-flow="${flowAssetKey}"]`).click();
    await inspector.locator('[data-studio-flow-field="label"]').fill("Review completed");
    await inspector.locator('[data-studio-flow-field="priority"]').fill("7");
    await inspector.getByText("流转契约", { exact: true }).click();
    await inspector.locator('[data-studio-contract-field="id"]').fill("review-handoff");
    await inspector.locator('[data-studio-contract-field="onViolation"]').selectOption("WARN");
    const schemaPath = `schemas/${String(flow.flowId).replace(/[^a-zA-Z0-9_.-]/g, "-")}.json`;
    const schemaEditor = inspector.locator(`[data-studio-contract-schema="${schemaPath}"]`);
    await schemaEditor.fill('{"type":"object","required":["decision"]}');
    assert.match(await schemaEditor.inputValue(), /decision/);
    assert.equal(await page.locator('#project-graph-stage [data-studio-graph-action="save"]').isDisabled(), false, await page.locator("#project-design-status").innerText());
    saveSequence.length = 0;
    await page.locator('#project-graph-stage [data-studio-graph-action="save"]').click();
    await page.waitForTimeout(1200);
    assert.deepEqual(saveSequence, ["assets", "design"], await page.locator("#project-design-status").innerText());
    assert.deepEqual(submittedAssets?.contractSchemas?.[schemaPath], '{"type":"object","required":["decision"]}', JSON.stringify(submittedAssets));
    assert.deepEqual(submittedAssets?.executionConfig?.profiles?.find((item) => item.profileId === "review-cli-profile"), { profileId: "review-cli-profile", toolRef: "review-cli-tool", timeoutMs: 45000, maxOutputBytes: 8192 });
    assert.deepEqual(submittedAssets?.executionConfig?.tools?.tools?.find((item) => item.toolRef === "review-cli-tool"), { toolRef: "review-cli-tool", runner: "local_shell", command: "node", argsTemplate: ["./tools/review.mjs", "--json"], stdinMode: "none" });
    const saveResponse = designResponses.find((item) => item.url.endsWith(`/api/v1/team-versions/${team.projectId}/design`) && item.method === "PUT" && item.status === 200);
    assert.ok(saveResponse, JSON.stringify(designResponses, null, 2));
    const assetSaveResponse = designResponses.filter((item) => item.url.endsWith(`/api/v1/team-versions/${team.projectId}/design/assets`) && item.method === "PUT").at(-1);
    assert.equal(assetSaveResponse?.status, 200, JSON.stringify(assetSaveResponse, null, 2));
    assert.deepEqual(assetSaveResponse?.body?.modelSelection?.roles?.[roleId], { backend: "codex", modelId: "gpt-6-luna" }, JSON.stringify({ assetSaveResponse, submittedRole: submittedAssetAuthoring?.roles?.[roleId] }, null, 2));
    assert.deepEqual(submittedAuthoring?.roles?.[roleId]?.contextMap, { brief: "global.task", audience: "global.task" }, JSON.stringify(submittedAuthoring));
    if (orderRoleId) assert.deepEqual(submittedAuthoring?.roles?.[orderRoleId]?.routeOrder, expectedRouteOrder);

    const persistedDesign = await page.request.get(`${url}/api/v1/team-versions/${team.projectId}/design`).then((response) => response.json());
    const persistedAssets = await page.request.get(`${url}/api/v1/team-versions/${team.projectId}/design/assets`).then((response) => response.json());
    assert.deepEqual(persistedDesign.authoring.roles[roleId].contextMap, { brief: "global.task", audience: "global.task" }, JSON.stringify({ authoring: persistedDesign.authoring, assets: persistedAssets }, null, 2));
    assert.equal(persistedDesign.authoring.roles[roleId].modelRef, "codex/gpt-6-luna");
    assert.equal(persistedDesign.authoring.roles[roleId].bindingKind, "model");
    assert.equal(persistedDesign.authoring.roles[roleId].backend, "codex");
    assert.equal(persistedDesign.authoring.roles[execRoleId].bindingKind, "exec");
    assert.equal(persistedDesign.authoring.roles[execRoleId].profileId, "review-cli-profile");
    assert.equal(persistedDesign.authoring.roles[roleId].routingMode, "parallel_split");
    assert.equal(persistedDesign.authoring.roles[roleId].loopMax, 3);
    assert.equal(persistedDesign.authoring.roles[joinRoleId].joinMode, "quorum_of");
    assert.equal(persistedDesign.authoring.roles[joinRoleId].joinMin, 3);
    assert.deepEqual(persistedDesign.authoring.roles[reviewRoleId].review, {
      mode: "required",
      timeoutAction: "terminate",
      terminateScope: "branch",
      timeoutSeconds: 180,
      reworkTargetRoleId: "backend-planner",
      reworkMax: 2
    });
    assert.equal(persistedDesign.authoring.system.systemId, "site.software-team");
    assert.equal(persistedDesign.authoring.system.systemVersion, "2.4.0");
    assert.equal(persistedDesign.authoring.system.lawGlobalRef, "law.site.software-team");
    assert.deepEqual(Object.values(persistedDesign.authoring.flows).filter((flow) => flow.fromRoleId === "__system_start__").map((flow) => flow.toRoleId), ["delivery-coordinator"]);
    assert.equal(persistedDesign.authoring.system.handoffMode, "transition");
    assert.equal(persistedDesign.authoring.flows[flow.flowId].label, "Review completed");
    assert.equal(persistedDesign.authoring.flows[flow.flowId].priority, 7);
    assert.equal(persistedAssets.roles[roleId]["prompt.md"], "Review source material and return cited findings.");
    assert.deepEqual(JSON.parse(persistedAssets.roles[reviewRoleId]["role.json"]).authority.controlActions, ["approve", "rework", "terminate"]);
    assert.deepEqual(persistedAssets.modelSelection.roles?.[roleId], { backend: "codex", modelId: "gpt-6-luna" }, JSON.stringify({ submittedAssetAuthoring, submittedAssets, persistedAssets }, null, 2));
    if (openCodeModel && openCodeRoleId) {
      const selectionRef = openCodeModel.selectionRef || `${openCodeModel.backend}/${openCodeModel.id}`;
      assert.equal(persistedDesign.authoring.roles[openCodeRoleId].modelRef, selectionRef);
      assert.equal(persistedDesign.authoring.roles[openCodeRoleId].backend, "opencode");
      assert.equal(persistedDesign.authoring.roles[openCodeRoleId].modelId, openCodeModel.id);
      assert.deepEqual(persistedAssets.modelSelection.roles?.[openCodeRoleId], { backend: "opencode", modelId: openCodeModel.id });
    }
    const manifest = JSON.parse(persistedAssets.contracts);
    assert.ok(manifest.contracts.some((item) => item.id === "review-handoff" && item.schema === schemaPath && item.onViolation === "WARN"));
    assert.deepEqual(JSON.parse(persistedAssets.contractSchemas[schemaPath]), { type: "object", required: ["decision"] });
    assert.equal(persistedAssets.executionConfig.profiles.find((item) => item.profileId === "review-cli-profile").timeoutMs, 45000);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(`#project-graph-stage .x6-node[data-cell-id="${roleId}"]`).click();
    assert.equal(await inspector.locator('[data-studio-role-asset="prompt.md"]').inputValue(), "Review source material and return cited findings.");
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 960 });
      const geometry = await page.evaluate(() => {
        const graph = document.querySelector("#project-graph-stage")?.getBoundingClientRect();
        return {
          graphWidth: graph?.width || 0,
          graphHeight: graph?.height || 0,
          documentWidth: document.documentElement.scrollWidth
        };
      });
      assert.ok(geometry.graphWidth > 250, `${width}px graph has enough workspace width: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.graphHeight > 400, `${width}px workbench height is constrained: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.documentWidth <= width + 2, `${width}px Studio page overflows horizontally: ${JSON.stringify(geometry)}`);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    assert.equal(await page.locator("#studio-inspector-toggle").count(), 0);
    assert.equal(await page.locator("#studio-assets-toggle").count(), 0);
    const assetsToggle = page.locator('#project-graph-stage [data-studio-graph-action="assets"]');
    await assetsToggle.click();
    assert.equal(await assetsToggle.getAttribute("aria-expanded"), "true");
    assert.ok(await page.locator("#studio-assets-roles [data-studio-asset-role]").count() > 0, "the Studio asset panel should list roles");
    assert.ok(await page.locator("#studio-assets-roles .studio-role-avatar").evaluateAll((avatars) => new Set(avatars.map((avatar) => avatar.style.getPropertyValue("--role-accent"))).size) > 1, "role avatars should retain distinct role colors");
    const dragHandle = page.locator(".studio-asset-drawer-head");
    const originalPanelBounds = await page.locator("#studio-asset-drawer").boundingBox();
    assert.ok(originalPanelBounds.width <= 382, `asset panel default width should stay compact: ${JSON.stringify(originalPanelBounds)}`);
    const handleBounds = await dragHandle.boundingBox();
    await page.mouse.move(handleBounds.x + 90, handleBounds.y + 20);
    await page.mouse.down();
    await page.mouse.move(handleBounds.x + 150, handleBounds.y + 70);
    await page.mouse.up();
    const movedPanelBounds = await page.locator("#studio-asset-drawer").boundingBox();
    assert.ok(movedPanelBounds.x > originalPanelBounds.x, "the asset panel can be moved by its header");
    const assetDragBackStart = await dragHandle.boundingBox();
    await page.mouse.move(assetDragBackStart.x + 100, assetDragBackStart.y + 20);
    await page.mouse.down();
    await page.mouse.move(assetDragBackStart.x + 20, assetDragBackStart.y + 20, { steps: 4 });
    await page.mouse.up();
    const assetResizeControl = page.locator("#studio-asset-drawer .studio-panel-resize-handle");
    await assetResizeControl.scrollIntoViewIfNeeded();
    const resizeWorkbenchBounds = await page.locator(".studio-design-workbench").boundingBox();
    const assetResizeHandle = await assetResizeControl.boundingBox();
    const assetPanelAtResizeStart = await page.locator("#studio-asset-drawer").boundingBox();
    await page.mouse.move(assetResizeHandle.x + assetResizeHandle.width / 2, assetResizeHandle.y + assetResizeHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(assetResizeHandle.x + assetResizeHandle.width / 2 + 36, assetResizeHandle.y + assetResizeHandle.height / 2 + 30, { steps: 4 });
    await page.mouse.up();
    const resizedAssetBounds = await page.locator("#studio-asset-drawer").boundingBox();
    assert.ok(resizedAssetBounds.width > movedPanelBounds.width + 20, `the asset panel can be resized wider: ${JSON.stringify({ movedPanelBounds, resizedAssetBounds, assetResizeHandle })}`);
    assert.ok(resizedAssetBounds.y + resizedAssetBounds.height <= resizeWorkbenchBounds.y + resizeWorkbenchBounds.height + 1, `resizing keeps the panel within its work area: ${JSON.stringify({ resizeWorkbenchBounds, resizedAssetBounds })}`);
    assert.ok(Math.abs(resizedAssetBounds.x - assetPanelAtResizeStart.x) < 1 && Math.abs(resizedAssetBounds.y - assetPanelAtResizeStart.y) < 3, `resizing keeps the panel top-left fixed: ${JSON.stringify({ assetPanelAtResizeStart, resizedAssetBounds })}`);
    const assetWorkbenchBounds = await page.locator(".studio-design-workbench").boundingBox();
    const assetDockStart = await page.locator("#studio-asset-drawer").boundingBox();
    const graphBeforeAssetDock = await page.locator(".project-graph-preview").boundingBox();
    const assetDockDrag = await dragHandle.boundingBox();
    const assetDockTargetLeft = assetWorkbenchBounds.x + assetWorkbenchBounds.width - assetDockStart.width - 4;
    await page.mouse.move(assetDockDrag.x + 100, assetDockDrag.y + 20);
    await page.mouse.down();
    await page.mouse.move(assetDockDrag.x + 100 + assetDockTargetLeft - assetDockStart.x, assetDockDrag.y + 20, { steps: 5 });
    await page.mouse.up();
    await page.locator(".studio-design-workbench.is-asset-docked").waitFor();
    const graphAfterAssetDock = await page.locator(".project-graph-preview").boundingBox();
    assert.ok(graphAfterAssetDock.width < graphBeforeAssetDock.width - 250, "docking team assets reserves a right sidebar on desktop");
    assert.ok(await page.locator("#studio-assets-roles [data-studio-asset-role]").count() > 0, "auto docking keeps the asset list laid out and visible");
    const dockedResizeHandle = await page.locator("#studio-asset-drawer .studio-panel-resize-handle").boundingBox();
    const dockedWidthBefore = (await page.locator("#studio-asset-drawer").boundingBox()).width;
    await page.mouse.move(dockedResizeHandle.x + dockedResizeHandle.width / 2, dockedResizeHandle.y + dockedResizeHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(dockedResizeHandle.x + dockedResizeHandle.width / 2 - 36, dockedResizeHandle.y + dockedResizeHandle.height / 2, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction((width) => document.querySelector("#studio-asset-drawer")?.getBoundingClientRect().width > width + 20, dockedWidthBefore, { timeout: 1500 }).catch(() => undefined);
    const dockedWidthAfter = (await page.locator("#studio-asset-drawer").boundingBox()).width;
    assert.ok(dockedWidthAfter > dockedWidthBefore + 20, `resizing a docked sidebar adjusts its grid column without shifting panel content: ${JSON.stringify({ dockedWidthBefore, dockedWidthAfter, dockWidth: await page.locator(".studio-design-workbench").evaluate((element) => getComputedStyle(element).getPropertyValue("--studio-panel-dock-width")) })}`);
    await page.locator("#studio-asset-drawer-close").click();
    await assetsToggle.click();
    await page.locator(".studio-design-workbench.is-asset-docked").waitFor();
    assert.equal(await page.locator("#studio-asset-drawer").getAttribute("aria-hidden"), "false", "team assets remembers its docked state after closing and reopening within the page session");
    const dockedPanelBounds = await page.locator("#studio-asset-drawer").boundingBox();
    const dockedHeaderBounds = await dragHandle.boundingBox();
    const graphCanvasBounds = await page.locator(".project-graph-preview").boundingBox();
    await page.mouse.move(dockedHeaderBounds.x + 90, dockedHeaderBounds.y + 20);
    await page.mouse.down();
    await page.mouse.move(graphCanvasBounds.x + graphCanvasBounds.width / 2, dockedHeaderBounds.y + 20, { steps: 6 });
    await page.mouse.up();
    await page.locator(".studio-design-workbench:not(.is-asset-docked)").waitFor();
    const restoredAssetBounds = await page.locator("#studio-asset-drawer").boundingBox();
    const restoredAssetWorkbench = await page.locator(".studio-design-workbench").boundingBox();
    assert.ok(restoredAssetBounds.x + restoredAssetBounds.width / 2 < restoredAssetWorkbench.x + restoredAssetWorkbench.width - dockedPanelBounds.width, `dragging a docked panel into the graph restores it as a floating window: ${JSON.stringify({ restoredAssetBounds, restoredAssetWorkbench, dockedPanelBounds })}`);
    await page.locator("#studio-assets-flows-tab").click();
    assert.ok(await page.locator("#studio-assets-flows [data-studio-asset-flow]").count() > 0, "the asset panel should list flows");
    assert.equal(await page.locator("#studio-assets-flows .studio-flow-contract-icon").count(), await page.locator("#studio-assets-flows [data-studio-asset-flow]").count(), "each flow should have a contract icon");
    const expectedFlowEndpoints = Object.values(design.authoring.flows).map((item) => {
      const from = item.fromRoleId === "__system_start__" ? "开始" : design.authoring.roles[item.fromRoleId]?.title;
      const to = item.toRoleId === "__system_end__" ? "结束" : design.authoring.roles[item.toRoleId]?.title;
      return `${from} → ${to}`;
    });
    assert.deepEqual(await page.locator("#studio-assets-flows [data-studio-asset-flow] small").allTextContents(), expectedFlowEndpoints);
    const globalSettingsTab = page.locator("#studio-assets-global-tab");
    assert.equal(await globalSettingsTab.getAttribute("role"), "tab");
    await globalSettingsTab.click();
    await page.getByRole("heading", { name: "全局配置" }).waitFor();
    assert.equal(await page.locator("[data-system-field='systemId']").count(), 0);
    assert.equal(await page.locator("#studio-assets-global .studio-readonly-value").first().innerText(), design.authoring.system.systemId);
    assert.equal(new URL(page.url()).pathname, `/studio/teams/${team.projectId}/design`);
    await page.goto(`${url}/studio/teams/${team.projectId}/design`, { waitUntil: "networkidle" });
    await page.locator('#project-graph-stage [data-studio-graph-action="assets"]').click();
    await page.locator("#studio-assets-roles-tab").click();
    await page.locator(`#studio-assets-roles [data-studio-asset-role="${roleId}"]`).click();
    assert.equal(await inspector.locator(".studio-inspector-heading h2").innerText(), design.authoring.roles[roleId].title, "selecting a role from the list should open its editor");
    await page.locator("[data-studio-assets-back]").click();
    assert.equal(await page.locator("#studio-assets-list-view").isVisible(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(`#project-graph-stage .x6-node[data-cell-id="${roleId}"]`).click();
    await page.locator("#studio-assets-property-view").waitFor({ state: "visible" });
    assert.equal(await page.locator("#studio-assets-property-view").isVisible(), true, "selecting a graph role should open its editor on narrow screens");
    const mobilePanel = await page.locator("#studio-asset-drawer").boundingBox();
    const mobileWorkbench = await page.locator(".studio-design-workbench").boundingBox();
    assert.ok(mobilePanel.x >= mobileWorkbench.x && mobilePanel.x + mobilePanel.width <= mobileWorkbench.x + mobileWorkbench.width, `mobile asset panel stays inside the workbench: ${JSON.stringify({ mobilePanel, mobileWorkbench })}`);
    assert.ok(mobilePanel.y >= mobileWorkbench.y && mobilePanel.y + mobilePanel.height <= mobileWorkbench.y + mobileWorkbench.height, `mobile asset panel stays inside the workbench: ${JSON.stringify({ mobilePanel, mobileWorkbench })}`);
    const mobileDragHandle = await page.locator(".studio-asset-drawer-head").boundingBox();
    const mobileDockPanel = await page.locator("#studio-asset-drawer").boundingBox();
    const mobileDockTargetLeft = mobileWorkbench.x + mobileWorkbench.width - mobileDockPanel.width - 4;
    await page.mouse.move(mobileDragHandle.x + 100, mobileDragHandle.y + 20);
    await page.mouse.down();
    await page.mouse.move(mobileDragHandle.x + 100 + mobileDockTargetLeft - mobileDockPanel.x, mobileDragHandle.y + 20, { steps: 5 });
    await page.mouse.up();
    await page.locator(".studio-design-workbench.is-asset-docked").waitFor();
    const mobileDockBounds = await page.locator("#studio-asset-drawer").boundingBox();
    assert.ok(mobileDockBounds.x + mobileDockBounds.width <= mobileWorkbench.x + mobileWorkbench.width, `mobile right dock stays in workbench: ${JSON.stringify({ mobileDockBounds, mobileWorkbench })}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "mobile right dock does not create horizontal page overflow");
    await page.setViewportSize({ width: 1440, height: 960 });
    assert.deepEqual(await page.evaluate(() => window.__productUnhandled || []), []);

    const assetsRoute = `**/api/v1/team-versions/${team.projectId}/design/assets`;
    await page.route(assetsRoute, async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "TEAM_ASSET_WRITE_FAILED" }) });
      } else {
        await route.continue();
      }
    });
    await inspector.getByText("角色资产包", { exact: true }).click();
    await inspector.locator('[data-studio-role-asset="prompt.md"]').fill("Updated prompt with a simulated asset-store failure.");
    await page.locator('#project-graph-stage [data-studio-graph-action="save"]').click();
    await assert.doesNotReject(() => page.getByText(/设计尚未保存；角色资产写入未完成/).waitFor());
    const unchangedDesign = await page.request.get(`${url}/api/v1/team-versions/${team.projectId}/design`).then((response) => response.json());
    const unchangedAssets = await page.request.get(`${url}/api/v1/team-versions/${team.projectId}/design/assets`).then((response) => response.json());
    assert.equal(unchangedDesign.authoring.roles[roleId].modelRef, "codex/gpt-6-luna");
    assert.equal(unchangedAssets.roles[roleId]["prompt.md"], "Review source material and return cited findings.");
    await page.unroute(assetsRoute);
    await page.locator('#project-graph-stage [data-studio-graph-action="save"]').click();
    await page.waitForTimeout(1200);
    const retriedAssets = await page.request.get(`${url}/api/v1/team-versions/${team.projectId}/design/assets`).then((response) => response.json());
    assert.equal(retriedAssets.roles[roleId]["prompt.md"], "Updated prompt with a simulated asset-store failure.");

    if (await assetsToggle.getAttribute("aria-expanded") !== "true") await assetsToggle.click();
    await page.locator(`#project-graph-stage .x6-node[data-cell-id="${roleId}"]`).click();
    await inspector.getByText("角色资产包", { exact: true }).click();
    await page.route(`**/api/v1/team-versions/${team.projectId}/design`, async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "TEAM_VERSION_DIGEST_CONFLICT" }) });
      } else {
        await route.continue();
      }
    });
    await inspector.locator('[data-studio-role-asset="prompt.md"]').fill("Assets persisted before a simulated design conflict.");
    await page.locator('#project-graph-stage [data-studio-graph-action="save"]').click();
    await assert.doesNotReject(() => page.getByText(/角色资产已保存，但设计保存未完成/).waitFor());
    const partialAssets = await page.request.get(`${url}/api/v1/team-versions/${team.projectId}/design/assets`).then((response) => response.json());
    assert.equal(partialAssets.roles[roleId]["prompt.md"], "Assets persisted before a simulated design conflict.");
  } finally {
    await closeServer(server, projectsRoot, browser);
  }
});

test("Studio saves all four package files for a newly created role in one authoring save", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-studio-new-role-assets-"));
  const { server, url } = await startServer(projectsRoot);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.stack || error.message));
    const team = await page.request.post(`${url}/api/v1/cases/software-team/template`, {
      data: { name: "New Role Asset Team", overview: "Save role and package together." }
    }).then((response) => response.json());
    await page.goto(`${url}/studio/teams/${team.projectId}/design`, { waitUntil: "networkidle" });
    const initialDesign = await page.request.get(`${url}/api/v1/team-versions/${team.projectId}/design`).then((response) => response.json());
    const incomingFlow = Object.values(initialDesign.authoring.flows).find((flow) =>
      flow.toRoleId !== "__system_end__" && flow.fromRoleId in initialDesign.authoring.roles && !flow.fromRoleId.startsWith("__boundary__")
    );
    assert.ok(incomingFlow, "fixture team should include a reachable role flow");
    const expectedFlowLabel = initialDesign.viewModel.edges.find((edge) => edge.id === incomingFlow.flowId)?.label;
    assert.ok(expectedFlowLabel && expectedFlowLabel !== incomingFlow.eventType, "the fixture flow should have a localized business label");
    const sourceRoleId = incomingFlow.fromRoleId;
    const relationshipEventType = incomingFlow.eventType;
    await page.locator('[data-studio-graph-action="validate"]').click();
    await page.getByText("结构校验通过", { exact: true }).waitFor();
    await page.locator('[data-studio-graph-action="add-role"]').click();
    const pendingRoleNode = page.locator('#project-graph-stage .x6-node[data-cell-id="__studio_pending_role__"]');
    await pendingRoleNode.waitFor({ state: "visible" });
    assert.equal(await page.locator('#project-graph-stage .x6-node[data-cell-id="new-auditor"]').count(), 0);
    await pendingRoleNode.click();
    const dialog = page.locator('[data-studio-command-form="add-role"]');
    await dialog.waitFor({ state: "visible" });
    await dialog.locator("[data-studio-command-close]").click();
    await pendingRoleNode.waitFor({ state: "detached" });
    const closeAssets = page.locator("#studio-asset-drawer-close");
    if (await closeAssets.isVisible()) await closeAssets.click();
    await page.locator('[data-studio-graph-action="add-role"]').click();
    await pendingRoleNode.waitFor({ state: "visible" });
    await pendingRoleNode.click();
    await dialog.waitFor({ state: "visible" });
    await dialog.locator('input[name="mode"][value="custom"]').check();
    await dialog.locator('input[name="roleId"]').fill("new-auditor");
    await dialog.locator('input[name="title"]').fill("New Auditor");
    await dialog.locator('select[name="bindingKind"]').selectOption("noop");
    await dialog.locator('button[type="submit"]').click();
    const inspector = page.locator("#studio-property-inspector");
    await page.waitForTimeout(300);
    const newRoleNode = page.locator('#project-graph-stage .x6-node[data-cell-id="new-auditor"]');
    assert.equal(await newRoleNode.count(), 1, JSON.stringify({ dialog: await dialog.innerText().catch(() => "closed"), status: await page.locator("#project-design-status").innerText().catch(() => ""), inspector: await inspector.innerText().catch(() => ""), nodes: await page.locator("#project-graph-stage .x6-node").evaluateAll((elements) => elements.map((element) => ({ id: element.getAttribute("data-cell-id"), text: element.textContent }))) }));
    await page.waitForTimeout(250);
    const renderedFlowLabels = await page.locator("#project-graph-stage .x6-edge-label text").allTextContents();
    assert.ok(renderedFlowLabels.some((label) => label.includes(expectedFlowLabel)), `rebuilding the graph after an authoring edit should preserve localized flow labels: ${JSON.stringify({ expectedFlowLabel, renderedFlowLabels })}`);
    const sourceCell = page.locator(`#project-graph-stage .x6-node[data-cell-id="${sourceRoleId}"]`);
    const sourcePort = sourceCell.locator('[data-studio-port="out"]').first();
    const newRoleInput = newRoleNode.locator('[data-studio-port="in"]').first();
    const initialEdgeCount = await page.locator("#project-graph-stage .x6-edge").count();
    await page.locator("#studio-asset-drawer-close").click();
    await page.locator('#project-graph-stage [data-studio-graph-action="assets"]').click();
    await page.locator(`#studio-assets-roles [data-studio-asset-role="${sourceRoleId}"]`).click();
    await page.locator("#studio-asset-drawer-close").click();
    const sourceBounds = await sourcePort.boundingBox();
    const targetBounds = await newRoleInput.boundingBox();
    await page.mouse.move(sourceBounds.x + sourceBounds.width / 2, sourceBounds.y + sourceBounds.height / 2);
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.mouse.move(targetBounds.x + targetBounds.width / 2, targetBounds.y + targetBounds.height / 2, { steps: 30 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    assert.equal(await page.locator('[data-studio-command-form="add-edge"]').count(), 0, "connecting ports should create a flow without opening a form");
    await page.waitForFunction((count) => document.querySelectorAll("#project-graph-stage .x6-edge").length === count + 1, initialEdgeCount);
    const flowLabel = inspector.locator('[data-studio-flow-field="label"]');
    await flowLabel.waitFor({ state: "visible" });
    assert.equal(await inspector.locator('[data-studio-flow-field="eventType"]').inputValue(), relationshipEventType);
    await flowLabel.fill("Audit complete");
    await page.locator('#project-graph-stage [data-studio-graph-action="assets"]').click();
    await page.locator('#studio-assets-roles [data-studio-asset-role="new-auditor"]').click();
    const loopMax = inspector.locator('[data-studio-role-field="loopMax"]');
    const previousLoopMax = await loopMax.inputValue();
    const nextLoopMax = previousLoopMax === "3" ? "4" : "3";
    await loopMax.fill(nextLoopMax);
    await page.locator('#project-graph-stage [data-studio-graph-action="undo"]').click();
    await assert.doesNotReject(() => page.waitForFunction(({ selector, expected }) => document.querySelector(selector)?.value === expected, { selector: '#studio-property-inspector [data-studio-role-field="loopMax"]', expected: previousLoopMax }));
    await page.locator('#project-graph-stage [data-studio-graph-action="redo"]').click();
    await assert.doesNotReject(() => page.waitForFunction(({ selector, expected }) => document.querySelector(selector)?.value === expected, { selector: '#studio-property-inspector [data-studio-role-field="loopMax"]', expected: nextLoopMax }));
    await inspector.getByText("角色资产包", { exact: true }).click();
    await inspector.locator('[data-studio-role-asset="prompt.md"]').fill("Audit the generated result and cite evidence.");
    await inspector.locator('[data-studio-role-asset="agent.md"]').fill("You are the new auditor. Verify the output and cite evidence.");
    await inspector.locator('[data-studio-role-asset="role.json"]').fill(JSON.stringify({
      roleId: "new-auditor",
      roleVersion: "1.0.0",
      name: "New Auditor",
      description: "Audits a generated result.",
      promptTemplate: "prompt.md",
      outputSchema: "output.schema.json",
      tags: ["audit"],
      contractVersion: 1,
      purpose: "Reviews a generated result for completion.",
      responsibility: { kind: "atomic", owns: [], contributes: [], doesNotOwn: [] },
      inputs: { preconditions: [] },
      outputs: { events: [], postconditions: [] },
      authority: { controlActions: [] },
      constraints: { writableStateFields: [], allowedTools: [] },
      failure: { retryableErrorCodes: [], terminalErrorCodes: [] },
      audit: { requiredFields: [] }
    }));
    await inspector.locator('[data-studio-role-asset="output.schema.json"]').fill('{"type":"object","required":["findings"]}');
    assert.equal(await page.locator('[data-studio-graph-action="save"]').isDisabled(), false, await page.locator("#project-design-status").innerText());
    const assetsSaved = page.waitForResponse((response) => response.url().endsWith(`/api/v1/team-versions/${team.projectId}/design/assets`) && response.request().method() === "PUT");
    const validation = page.waitForResponse((response) => response.url().endsWith(`/api/v1/team-versions/${team.projectId}/design/validate`) && response.request().method() === "POST");
    const designSaved = page.waitForResponse((response) => response.url().endsWith(`/api/v1/team-versions/${team.projectId}/design`) && response.request().method() === "PUT").catch(() => null);
    await page.locator("[data-studio-save-workspace]").click();
    assert.equal((await assetsSaved).status(), 200);
    const validationResponse = await validation;
    const validationPayload = await validationResponse.json();
    assert.equal(validationPayload.ok, true, `${await page.locator("#project-design-status").innerText()}; ${JSON.stringify(validationPayload.diagnostics || [])}`);
    assert.equal((await designSaved)?.status(), 200);
    const [designResponse, assetsResponse] = await Promise.all([
      page.request.get(`${url}/api/v1/team-versions/${team.projectId}/design`),
      page.request.get(`${url}/api/v1/team-versions/${team.projectId}/design/assets`)
    ]);
    const design = await designResponse.json();
    const assets = await assetsResponse.json();
    assert.equal(designResponse.status(), 200);
    assert.equal(assetsResponse.status(), 200);
    assert.ok(design.authoring.roles["new-auditor"], `${await page.locator("#project-design-status").innerText()}; ${JSON.stringify(design.authoring.roles)}`);
    assert.equal(design.authoring.roles["new-auditor"].loopMax, Number(nextLoopMax));
    assert.ok(Object.values(design.authoring.flows).some((flow) => flow.fromRoleId === sourceRoleId && flow.toRoleId === "new-auditor" && flow.eventType === relationshipEventType), "the new relationship should persist with the selected endpoints and event");
    assert.deepEqual(assets.roles["new-auditor"], {
      "agent.md": "You are the new auditor. Verify the output and cite evidence.",
      "prompt.md": "Audit the generated result and cite evidence.",
      "role.json": JSON.stringify({
        roleId: "new-auditor",
        roleVersion: "1.0.0",
        name: "New Auditor",
        description: "Audits a generated result.",
        promptTemplate: "prompt.md",
        outputSchema: "output.schema.json",
        tags: ["audit"],
        contractVersion: 1,
        purpose: "Reviews a generated result for completion.",
        responsibility: { kind: "atomic", owns: [], contributes: [], doesNotOwn: [] },
        inputs: { preconditions: [] },
        outputs: { events: [], postconditions: [] },
        authority: { controlActions: [] },
        constraints: { writableStateFields: [], allowedTools: [] },
        failure: { retryableErrorCodes: [], terminalErrorCodes: [] },
        audit: { requiredFields: [] }
      }),
      "output.schema.json": '{"type":"object","required":["findings"]}'
    });
    const addedFlowId = Object.values(design.authoring.flows).find((flow) => flow.fromRoleId === sourceRoleId && flow.toRoleId === "new-auditor")?.flowId;
    assert.ok(addedFlowId, "the created relationship should have a stable flow identifier");
    await page.locator('#project-graph-stage [data-studio-graph-action="assets"]').click();
    const assetsBack = page.locator("#studio-asset-drawer [data-studio-assets-back]");
    if (await assetsBack.isVisible()) await assetsBack.click();
    await page.locator("#studio-assets-flows-tab").click();
    await page.locator('#studio-assets-flows [data-studio-asset-flow]').filter({ hasText: "Audit complete" }).click();
    await inspector.locator("[data-studio-flow-delete]").click();
    await page.waitForFunction((flowId) => !Array.from(document.querySelectorAll("#project-graph-stage .x6-edge")).some((edge) => edge.getAttribute("data-cell-id") === flowId), addedFlowId, { timeout: 5000 }).catch(async () => {
      throw new Error(JSON.stringify({ browserErrors, edgeIds: await page.locator("#project-graph-stage .x6-edge").evaluateAll((edges) => edges.map((edge) => edge.getAttribute("data-cell-id"))), inspector: await inspector.innerText(), status: await page.locator("#project-design-status").innerText() }));
    });
  } finally {
    await closeServer(server, projectsRoot, browser);
  }
});
