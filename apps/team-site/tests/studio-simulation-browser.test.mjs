import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
import { createFileTeamCatalog } from "../infrastructure/file-team-catalog.mjs";
import { computeTeamPackageCoreDigest } from "../infrastructure/package-integrity.mjs";
import { projectVisualizerStore } from "../infrastructure/project-visualizer-store.mjs";
import { reserveBrowserSafePort } from "./browser-safe-port.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("Studio browser submits a draft Simulation and reads persisted history, detail, and events", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-studio-simulation-browser-"));
  const testSupportRoot = await mkdtemp(join(tmpdir(), "ogs-studio-simulation-runner-"));
  const port = await reserveBrowserSafePort();
  const mockRunnerPath = join(testSupportRoot, "runtime-team-simulation.mjs");
  const loaderPath = join(testSupportRoot, "mock-runtime-loader.mjs");
  await writeFile(mockRunnerPath, `export function createRuntimeTeamSimulation() {
  return Object.freeze({
    async simulate(_team, { prompt, onRuntimeEvent }) {
      await onRuntimeEvent?.({ type: "flow.activated", fromRoleId: "__system_start__", toRoleId: "reviewer", eventType: "START", branchId: "reviewer:1" });
      await onRuntimeEvent?.({ type: "role.started", roleId: "reviewer", branchId: "reviewer:1", executionId: "reviewer-execution-1" });
      await onRuntimeEvent?.({ type: "role.input_ready", roleId: "reviewer", branchId: "reviewer:1", executionId: "reviewer-execution-1", inputContext: JSON.stringify({ task: prompt }) });
      await new Promise((resolveWait) => setTimeout(resolveWait, 180));
      await onRuntimeEvent?.({ type: "audit", roleId: "reviewer", branchId: "reviewer:1", status: "ok", durationMs: 1, inputContext: JSON.stringify({ task: prompt }), stdoutPreview: "Mocked role output for " + prompt });
      await onRuntimeEvent?.({ type: "flow.activated", fromRoleId: "reviewer", toRoleId: "__system_end__", eventType: "DONE", branchId: "reviewer:1" });
      return {
        status: "completed",
        finalOutputsByRoleId: { analyst: [{ content: "Mocked UAT result for " + prompt }] },
        finalOutputRoleOrder: ["analyst"],
        auditTrail: [{ roleId: "reviewer", status: "completed", durationMs: 1 }]
      };
    }
  });
}
`, "utf8");
  await writeFile(loaderPath, `import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("/infrastructure/runtime-team-simulation.mjs")) {
      return { url: pathToFileURL(process.env.OGS_TEST_STUDIO_SIMULATION_RUNNER).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});
`, "utf8");
  const serverEnv = {
    ...process.env,
    PORT: String(port),
    OGS_SITE_PROJECTS_DIR: projectsRoot,
    OGS_PLATFORM_CONFIG_DIR: projectsRoot,
    OGS_TEST_STUDIO_SIMULATION_RUNNER: mockRunnerPath
  };
  const startServer = () => {
    const processHandle = spawn(process.execPath, ["--import", pathToFileURL(loaderPath).href, "server.mjs"], {
      cwd: appRoot,
      env: serverEnv,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    processHandle.stdout.on("data", (chunk) => { output += chunk.toString(); });
    processHandle.stderr.on("data", (chunk) => { output += chunk.toString(); });
    return { processHandle, get output() { return output; } };
  };
  const waitForServerUrl = async (server) => {
    const startedAt = Date.now();
    let url;
    while (!url && Date.now() - startedAt < 10000) {
      url = server.output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (!url) await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    assert.ok(url, `site server did not start: ${server.output}`);
    return url;
  };
  let server = startServer();
  let browser;
  try {
    let url = await waitForServerUrl(server);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const simulationRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/") && request.url().includes("/simulations")) {
        simulationRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    const scriptErrors = [];
    page.on("pageerror", (error) => scriptErrors.push(error.message));

    await page.goto(`${url}/studio/new`, { waitUntil: "networkidle" });
    await page.locator("#new-project-form input[name=name]").fill("Draft Simulation UAT");
    await page.locator("#new-project-form textarea[name=overview]").fill("Review a draft package without releasing it.");
    await page.locator("#new-project-form button[type=submit]").click();
    await page.waitForURL(/\/teams\/[a-z0-9-]+\/design$/);
    await page.locator("#project-graph-stage .x6-node").first().waitFor({ timeout: 10000 }).catch(async () => {
      assert.fail(`Studio graph did not mount at ${page.url()}: ${await page.locator("#project-design-status").innerText().catch(() => "no design status")} | ${await page.locator("#project-graph-stage").innerText().catch(() => "no stage")} | ${await page.locator("body").innerText().catch(() => "no body")} | ${scriptErrors.join("; ")}`);
    });
    const teamVersionId = page.url().match(/\/teams\/([a-z0-9-]+)\/design$/)?.[1];
    const team = await page.request.get(`${url}/api/v1/projects/${teamVersionId}`).then((response) => response.json());
    assert.equal(team.teamVersionStatus, "draft");
    assert.equal(team.teamCoreDigest, null);
    assert.equal(team.projectDigest, null);

    await page.locator('#project-graph-stage [data-studio-graph-action="chat-generate"]').click();
    await page.locator("#team-build-dialog[open]").waitFor();
    assert.equal(await page.locator("#team-debug-dialog.is-open").count(), 0);
    await page.locator("[data-team-build-close]").click();
    await page.locator('#project-graph-stage [data-studio-graph-action="assets"]').click();
    await page.locator("#studio-asset-drawer.is-open[aria-hidden='false']").waitFor();
    assert.equal(await page.locator("#studio-assets-roles-tab").count(), 1);
    await page.locator("#studio-asset-drawer-close").click();
    await page.locator("#studio-asset-drawer[aria-hidden='true']").waitFor();
    await page.locator('#project-graph-stage [data-studio-graph-action="layout"]').click();
    await page.locator("#project-design-status").getByText(/未保存/).waitFor();
    await page.locator('#project-graph-stage [data-studio-graph-action="debug-run"]').click();
    await page.locator("#team-debug-dialog.is-open[aria-hidden='false']").waitFor({ timeout: 5000 }).catch(async () => {
      assert.fail(`Debug panel did not open: panel=${await page.locator("#team-debug-dialog").getAttribute("class")} hidden=${await page.locator("#team-debug-dialog").getAttribute("aria-hidden")} button=${await page.locator('#project-graph-stage [data-studio-graph-action="debug-run"]').getAttribute("aria-expanded")} errors=${scriptErrors.join("; ")}`);
    });
    await page.locator("#team-debug-dialog").evaluate((panel) => panel.getBoundingClientRect().width > 0);
    assert.equal(await page.locator("#team-build-dialog[open]").count(), 0);
    assert.equal(await page.locator("#team-debug-dialog").evaluate((panel) => panel.tagName), "ASIDE");
    assert.equal(await page.locator("#team-debug-dialog .team-debug-panel-head strong").innerText(), "调试");
    assert.doesNotMatch(await page.locator("#team-debug-dialog").innerText(), /OGS Studio/);
    assert.equal(await page.locator("#team-simulation-materials").count(), 1);
    assert.match(await page.locator("#team-debug-dialog").innerText(), /请先点击图谱工具栏中的“保存”保存未提交的图谱修改/);
    assert.equal(await page.locator("#team-debug-dialog .team-debug-empty-state").count(), 0);
    const debugPanel = page.locator("#team-debug-dialog");
    const debugHead = page.locator("#team-debug-dialog .team-debug-panel-head");
    const beforeDrag = await debugPanel.boundingBox();
    assert.ok(beforeDrag.width <= 362, `debug panel default width should stay compact: ${JSON.stringify(beforeDrag)}`);
    const dragPoint = await debugHead.boundingBox();
    await page.mouse.move(dragPoint.x + 120, dragPoint.y + 20);
    await page.mouse.down();
    await page.mouse.move(dragPoint.x + 70, dragPoint.y - 20, { steps: 4 });
    await page.mouse.up();
    const afterDrag = await debugPanel.boundingBox();
    assert.ok(afterDrag.x < beforeDrag.x - 20, `debug panel should be movable inside the workbench (${JSON.stringify({ beforeDrag, afterDrag, dragPoint })})`);
    const debugResizeControl = page.locator("#team-debug-dialog .studio-panel-resize-handle");
    await debugResizeControl.scrollIntoViewIfNeeded();
    const resizeWorkbenchBounds = await page.locator(".studio-design-workbench").boundingBox();
    const debugResizeHandle = await debugResizeControl.boundingBox();
    const debugPanelAtResizeStart = await debugPanel.boundingBox();
    await page.mouse.move(debugResizeHandle.x + debugResizeHandle.width / 2, debugResizeHandle.y + debugResizeHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(debugResizeHandle.x + debugResizeHandle.width / 2 + 36, debugResizeHandle.y + debugResizeHandle.height / 2 + 30, { steps: 4 });
    await page.mouse.up();
    const resizedDebugBounds = await debugPanel.boundingBox();
    assert.ok(resizedDebugBounds.width > afterDrag.width + 20, `the debug panel can be resized wider: ${JSON.stringify({ afterDrag, resizedDebugBounds, debugResizeHandle })}`);
    assert.ok(resizedDebugBounds.y + resizedDebugBounds.height <= resizeWorkbenchBounds.y + resizeWorkbenchBounds.height + 1, `resizing keeps the debug panel in the work area: ${JSON.stringify({ resizeWorkbenchBounds, resizedDebugBounds })}`);
    assert.ok(Math.abs(resizedDebugBounds.x - debugPanelAtResizeStart.x) < 1 && Math.abs(resizedDebugBounds.y - debugPanelAtResizeStart.y) < 3, `resizing keeps the panel top-left fixed: ${JSON.stringify({ debugPanelAtResizeStart, resizedDebugBounds })}`);
    const debugWorkbench = page.locator(".studio-design-workbench");
    const debugWorkbenchBounds = await debugWorkbench.boundingBox();
    const graphBeforeDebugDock = await page.locator(".project-graph-preview").boundingBox();
    const debugDockDrag = await debugHead.boundingBox();
    const debugDockStart = await debugPanel.boundingBox();
    const debugDockTargetLeft = debugWorkbenchBounds.x + debugWorkbenchBounds.width - debugDockStart.width - 4;
    await page.mouse.move(debugDockDrag.x + 120, debugDockDrag.y + 20);
    await page.mouse.down();
    await page.mouse.move(debugDockDrag.x + 120 + debugDockTargetLeft - debugDockStart.x, debugDockDrag.y + 20, { steps: 5 });
    await page.mouse.up();
    const debugPanelAtDock = await debugPanel.boundingBox();
    await page.locator(".studio-design-workbench.is-debug-docked").waitFor();
    const graphAfterDebugDock = await page.locator(".project-graph-preview").boundingBox();
    assert.ok(graphAfterDebugDock.width < graphBeforeDebugDock.width - 250, "docking the debug panel reserves a right sidebar on desktop");
    assert.equal(await debugPanel.evaluate((panel) => getComputedStyle(panel).position), "relative");
    assert.ok(await debugPanel.locator("#team-simulation-input").isVisible(), "debug content remains visible after automatic docking");
    await page.locator("[data-team-debug-close]").click();
    await page.locator('#project-graph-stage [data-studio-graph-action="debug-run"]').click();
    await page.locator(".studio-design-workbench.is-debug-docked").waitFor();
    assert.equal(await debugPanel.getAttribute("aria-hidden"), "false", "debug remembers its docked state after closing and reopening within the page session");
    const sidebarHeader = await debugHead.boundingBox();
    const graphBounds = await page.locator(".project-graph-preview").boundingBox();
    await page.mouse.move(sidebarHeader.x + 120, sidebarHeader.y + 20);
    await page.mouse.down();
    await page.mouse.move(graphBounds.x + graphBounds.width / 2, sidebarHeader.y + 20, { steps: 6 });
    await page.mouse.up();
    await page.locator(".studio-design-workbench:not(.is-debug-docked)").waitFor();
    await page.waitForTimeout(200);
    const restoredDebugBounds = await debugPanel.boundingBox();
    const restoredDebugWorkbench = await debugWorkbench.boundingBox();
    assert.ok(restoredDebugBounds.x + restoredDebugBounds.width / 2 < restoredDebugWorkbench.x + restoredDebugWorkbench.width - debugPanelAtDock.width, `dragging the docked debug panel into the graph restores a floating panel: ${JSON.stringify({ debugPanelAtDock, restoredDebugBounds, restoredDebugWorkbench })}`);
    await page.locator('#project-graph-stage [data-studio-graph-action="zoom-in"]').click();
    assert.equal(await debugPanel.getAttribute("aria-hidden"), "false", "graph controls remain usable while the non-modal panel is open");
    await page.locator("#team-simulation-input").fill("This run must wait until the graph is saved.");
    await page.locator("#team-simulation-run").click();
    assert.equal(simulationRequests.length, 0, "unsaved graph changes must block simulation requests");
    assert.match(await page.locator("#team-debug-dialog").innerText(), /请先点击图谱工具栏中的“保存”保存未提交的图谱修改/);
    await page.locator("[data-team-debug-close]").click();
    const saveDesign = page.waitForResponse((response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${teamVersionId}/design`);
    await page.locator('#project-graph-stage [data-studio-graph-action="save"]').click();
    assert.equal((await saveDesign).status(), 200);
    await page.locator("#project-graph-stage .x6-node").first().waitFor();
    await page.locator('#project-graph-stage [data-studio-graph-action="debug-run"]').click();
    await page.locator("#team-debug-dialog.is-open[aria-hidden='false']").waitFor();
    assert.equal(await page.locator("#team-debug-dialog .team-debug-empty-state").count(), 1);
    assert.doesNotMatch(await page.locator("#team-debug-dialog").innerText(), /请先点击图谱工具栏中的“保存”保存未提交的图谱修改/);
    await page.locator("#team-simulation-input").fill("Review the draft package.");
    const submit = async () => {
      const responsePromise = page.waitForResponse((response) => response.request().method() === "POST"
        && new URL(response.url()).pathname === `/api/v1/teams/${team.teamId}/versions/${teamVersionId}/simulations`);
      await page.locator("#team-simulation-run").click();
      const confirmation = page.locator(".confirm-dialog");
      const hasConfirmation = await Promise.race([
        confirmation.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false),
        responsePromise.then(() => false).catch(() => false)
      ]);
      if (hasConfirmation) await confirmation.locator('button[value="confirm"]').click();
      return responsePromise;
    };
    await page.locator("#team-simulation-input").fill("x".repeat(1201));
    assert.equal((await submit()).status(), 400);
    await page.locator("#team-simulation-result .run-error").waitFor();
    const localizedError = await page.locator("#team-simulation-result .run-error").innerText();
    assert.match(localizedError, /请输入 1 到 1,200 个字符的调试任务/);
    assert.doesNotMatch(localizedError, /STUDIO_SIMULATION_INPUT_INVALID/);

    await page.locator("#team-simulation-input").fill("Review the draft package.");
    await page.locator("#team-simulation-materials").fill("Reference version: 3.");
    assert.equal((await submit()).status(), 202);
    await page.getByText("Mocked UAT result for Review the draft package.", { exact: false }).waitFor();
    assert.match(await page.locator("#team-simulation-result").innerText(), /补充资料：\s*Reference version: 3\./);
    assert.deepEqual(scriptErrors, []);
    assert.ok((await page.locator(".team-debug-transcript").innerText()).includes("Mocked role output"));
    assert.match(await page.locator(".team-debug-transcript").innerText(), /运行中/);
    const simulationPostCount = simulationRequests.filter((request) => request.startsWith("POST ")).length;
    assert.equal(simulationPostCount, 2);

    const simulationId = await page.locator("#team-simulation-result a[href*='/run/']").first().getAttribute("href").then((href) => href.match(/\/run\/([^/?]+)$/)?.[1]);
    assert.ok(simulationId);
    const expectedEvidenceDirectory = join(projectsRoot, ".studio", "simulations", teamVersionId, simulationId);
    const persistedMetadata = JSON.parse(await readFile(join(expectedEvidenceDirectory, "simulation.json"), "utf8"));
    assert.equal(persistedMetadata.status, "completed");
    assert.equal(persistedMetadata.mode, "dry-run");
    assert.match(persistedMetadata.teamCoreDigest, /^[a-f0-9]{64}$/);
    const authoritativeWorkdir = join(projectsRoot, teamVersionId);
    assert.equal(persistedMetadata.teamCoreDigest, computeTeamPackageCoreDigest(await projectVisualizerStore.exportTeamPackage(authoritativeWorkdir)));
    const projectRunFiles = await readdir(join(authoritativeWorkdir, ".ogs", "runs")).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    assert.deepEqual(projectRunFiles, []);

    server.processHandle.kill();
    await once(server.processHandle, "exit").catch(() => undefined);
    server = startServer();
    url = await waitForServerUrl(server);

    await page.goto(`${url}/studio/teams/${teamVersionId}/run`, { waitUntil: "networkidle" });
    const historyRow = page.locator(".studio-simulation-row");
    await page.locator(".studio-simulation-list, #studio-view .run-error").waitFor({ timeout: 10000 });
    assert.equal(await page.locator(".studio-simulation-list").count(), 1, `Studio run page failed: ${await page.locator("#studio-view").innerText()}`);
    assert.equal(await historyRow.count(), 1, `Studio Simulation history should survive restart: ${await page.locator("#studio-view").innerText()}`);
    assert.match(await historyRow.innerText(), /Review the draft package\./);
    await historyRow.click();
    await page.waitForURL(new RegExp(`/studio/teams/${teamVersionId}/run/${simulationId}$`));
    await page.getByRole("heading", { name: "调试运行" }).waitFor();
    assert.match(await page.locator(".project-grid").innerText(), /Review the draft package\.[\s\S]*Mocked UAT result/);
    const eventTimeline = page.locator(".studio-event-list");
    await eventTimeline.waitFor();
    assert.match(await eventTimeline.innerText(), /simulation\.started[\s\S]*role\.completed[\s\S]*simulation\.completed/);
    await page.reload({ waitUntil: "networkidle" });
    const reloadedHeading = page.locator("#studio-view .page-heading h1");
    await reloadedHeading.waitFor({ timeout: 10000 });
    assert.match(await reloadedHeading.innerText(), /调试/, `Simulation deep link failed at ${page.url()}`);
    await page.locator(".studio-event-list li").first().waitFor();
    assert.equal(await page.locator(".studio-run-split").count(), 1, "debug evidence should use the master-detail layout");
    assert.equal(await page.locator(".studio-run-history .studio-simulation-row[aria-current='page']").count(), 1, "the current run should remain selected in the history list");
    assert.equal(await page.locator("#studio-view > .page-frame .page-heading .status-chip.completed").count(), 1);
    assert.deepEqual(scriptErrors, []);
  } finally {
    await browser?.close();
    if (server.processHandle.exitCode === null && server.processHandle.signalCode === null) {
      server.processHandle.kill();
      await once(server.processHandle, "exit").catch(() => undefined);
    }
    await rm(projectsRoot, { recursive: true, force: true });
    await rm(testSupportRoot, { recursive: true, force: true });
  }
});
