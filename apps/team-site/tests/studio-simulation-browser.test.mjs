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
      await onRuntimeEvent?.({ type: "flow.activated", fromRoleId: "__system_start__", toRoleId: "demo-analyst", eventType: "START", edgeId: "1:start:START:demo-analyst", handoffId: "entry-flow", branchId: "demo-analyst:1" });
      await onRuntimeEvent?.({ type: "role.started", roleId: "demo-analyst", branchId: "demo-analyst:1", executionId: "demo-analyst-execution-1" });
      await onRuntimeEvent?.({ type: "role_waiting", roleId: "demo-analyst", branchId: "demo-analyst:1", executionId: "demo-analyst-execution-1", stage: "model_provider", elapsedMs: 40 });
      await onRuntimeEvent?.({ type: "role_retry_scheduled", roleId: "demo-analyst", branchId: "demo-analyst:1", attempt: 2, maxAttempts: 3, errorCode: "MODEL_CHANNEL_UNAVAILABLE", backoffMs: 50 });
      await onRuntimeEvent?.({ type: "role.input_ready", roleId: "demo-analyst", branchId: "demo-analyst:1", executionId: "demo-analyst-execution-1", inputContext: JSON.stringify({ task: prompt }) });
      await onRuntimeEvent?.({ type: "join_quorum_reached", roleId: "demo-analyst", branchId: "demo-analyst:1", arrivedCount: 2, requiredCount: 2 });
      await onRuntimeEvent?.({ type: "human_review_requested", roleId: "demo-analyst", branchId: "demo-analyst:1", reviewId: "review-1" });
      await new Promise((resolveWait) => setTimeout(resolveWait, 180));
      await onRuntimeEvent?.({ type: "audit", roleId: "demo-analyst", branchId: "demo-analyst:1", status: "ok", at: "2026-10-24T09:08:07.000Z", durationMs: 1, inputContext: JSON.stringify({ task: prompt }), stdoutPreview: "Mocked role output for " + prompt });
      await onRuntimeEvent?.({ type: "role.completed", roleId: "demo-analyst", branchId: "demo-analyst:1", executionId: "demo-analyst-execution-1", attempt: 2 });
      await onRuntimeEvent?.({ type: "flow.activated", fromRoleId: "demo-analyst", toRoleId: "__system_end__", eventType: "ANALYSIS_DONE", edgeId: "2:demo-analyst:ANALYSIS_DONE:end", handoffId: "end-flow", branchId: "demo-analyst:1" });
      return {
        status: "completed",
        finalOutputsByRoleId: { analyst: [{ content: "Mocked UAT result for " + prompt }] },
        finalOutputRoleOrder: ["analyst"],
        auditSummary: { transitionCount: 2, totalRenderedPromptChars: 321, totalEstimatedInputTokens: 80, totalEstimatedOutputTokens: 24 },
        auditTrail: [{ roleId: "demo-analyst", status: "completed", durationMs: 1, projectedInputChars: 42, renderedPromptChars: 321, estimatedInputTokens: 80, estimatedOutputTokens: 24, externalDataIsolated: false, fallbackUsed: true, primaryModelId: "codex/primary", promptCalls: [{ callId: "demo-analyst-execution-1:primary", phase: "primary", modelId: "codex/primary", projectedInputChars: 42, renderedPromptChars: 200, estimatedInputTokens: 50, estimatedOutputTokens: 10 }, { callId: "demo-analyst-execution-1:fallback", phase: "fallback", modelId: "codex/fallback", projectedInputChars: 42, renderedPromptChars: 121, estimatedInputTokens: 30, estimatedOutputTokens: 14 }] }]
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
    await page.locator("#team-build-panel.is-open[aria-hidden='false']").waitFor();
    await page.locator('#project-graph-stage [data-studio-graph-action="assets"]').click();
    await page.locator("#studio-asset-drawer.is-open[aria-hidden='false']").waitFor();
    assert.equal(await page.locator("#studio-assets-roles-tab").count(), 1);
    assert.equal(await page.locator("#team-build-panel.is-open[aria-hidden='false']").count(), 1, "AI build and team configuration panels coexist on desktop");
    await page.locator('#project-graph-stage [data-studio-graph-action="debug-run"]').click();
    await page.locator("#team-debug-dialog.is-open[aria-hidden='false']").waitFor({ timeout: 5000 }).catch(async () => {
      assert.fail(`Debug panel did not open: panel=${await page.locator("#team-debug-dialog").getAttribute("class")} hidden=${await page.locator("#team-debug-dialog").getAttribute("aria-hidden")} button=${await page.locator('#project-graph-stage [data-studio-graph-action="debug-run"]').getAttribute("aria-expanded")} errors=${scriptErrors.join("; ")}`);
    });
    await page.locator("#team-debug-dialog").evaluate((panel) => panel.getBoundingClientRect().width > 0);
    assert.equal(await page.locator("#team-build-panel.is-open[aria-hidden='false']").count(), 1, "debug does not close AI build on desktop");
    assert.equal(await page.locator("#studio-asset-drawer.is-open[aria-hidden='false']").count(), 1, "debug does not close team configuration on desktop");
    assert.equal(await page.locator("#team-debug-dialog").evaluate((panel) => panel.tagName), "ASIDE");
    assert.equal(await page.locator("#team-debug-dialog .team-debug-panel-head strong").innerText(), "调试");
    assert.doesNotMatch(await page.locator("#team-debug-dialog").innerText(), /OGS Studio/);
    assert.equal(await page.locator("#team-simulation-materials").count(), 1);
    assert.match(await page.locator("#team-debug-dialog").innerText(), /调试任务/);
    assert.equal(await page.locator("#team-debug-dialog .team-debug-empty-state").count(), 0);
    assert.equal(await page.locator("#team-debug-dialog #team-simulation-result").count(), 1);
    const debugPanel = page.locator("#team-debug-dialog");
    const debugHead = page.locator("#team-debug-dialog .team-debug-panel-head");
    const maximizeDebugButton = debugPanel.locator("[data-panel-maximize]");
    await maximizeDebugButton.click();
    await page.locator("#team-debug-dialog.is-maximized").waitFor();
    assert.equal(await maximizeDebugButton.getAttribute("aria-pressed"), "true");
    const maximizedDebugBounds = await debugPanel.boundingBox();
    const workbenchForMaximize = await page.locator(".studio-design-workbench").boundingBox();
    assert.ok(maximizedDebugBounds.width >= workbenchForMaximize.width - 24, `maximized debug panel should fill the workbench: ${JSON.stringify({ maximizedDebugBounds, workbenchForMaximize })}`);
    await maximizeDebugButton.click();
    await page.locator("#team-debug-dialog:not(.is-maximized)").waitFor();
    assert.equal(await maximizeDebugButton.getAttribute("aria-pressed"), "false");
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

    // Mobile uses a full-width panel layer and switches between panels instead of allowing
    // overlapping drag targets to fight the graph's touch gestures.
    await page.setViewportSize({ width: 390, height: 800 });
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#project-graph-stage .x6-node").first().waitFor({ timeout: 10000 });
    await page.locator('#project-graph-stage [data-studio-graph-action="assets"]').click();
    await page.locator("#studio-asset-drawer").waitFor({ state: "attached" });
    assert.equal(await page.locator("#studio-asset-drawer.is-open").count(), 1, `mobile team configuration did not open: ${await page.locator("#studio-asset-drawer").evaluate((panel) => JSON.stringify({ className: panel.className, ariaHidden: panel.getAttribute("aria-hidden"), rect: panel.getBoundingClientRect().toJSON() }))}`);
    assert.equal(await page.locator("#studio-asset-drawer").getAttribute("aria-hidden"), "false");
    const mobileAssetBounds = await page.locator("#studio-asset-drawer").boundingBox();
    const mobileWorkbenchBounds = await page.locator(".studio-design-workbench").boundingBox();
    assert.ok(mobileAssetBounds.width >= mobileWorkbenchBounds.width - 24, `mobile team configuration should use a full-width layer: ${JSON.stringify({ mobileAssetBounds, mobileWorkbenchBounds })}`);
    assert.equal(await page.locator("#team-debug-dialog.is-open").count(), 0, "mobile panel switching hides debug");
    await page.locator("#studio-asset-drawer-close").click();
    await page.locator('#project-graph-stage [data-studio-graph-action="debug-run"]').click();
    await page.locator("#team-debug-dialog.is-open[aria-hidden='false']").waitFor();
    assert.equal(await page.locator("#studio-asset-drawer.is-open").count(), 0, "mobile panel switching hides team configuration");
    const mobileDebugBounds = await debugPanel.boundingBox();
    assert.ok(mobileDebugBounds.width >= mobileWorkbenchBounds.width - 24, `mobile debug should use a full-width layer: ${JSON.stringify({ mobileDebugBounds, mobileWorkbenchBounds })}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(100);
    await page.locator("#team-simulation-input").fill("Review the draft package.");
    await page.locator('input[name="studioSimulationMode"][value="dry-run"]').check();
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
    await page.locator("#team-simulation-input").fill("Review the draft package.");
    await page.locator("#team-simulation-materials").fill("Reference version: 3.");
    assert.equal((await submit()).status(), 202);
    await page.getByText("Mocked UAT result for Review the draft package.", { exact: false }).waitFor();
    assert.match(await page.locator("#team-simulation-result").innerText(), /补充资料：\s*Reference version: 3\./);
    assert.deepEqual(scriptErrors, []);
    const transcriptCard = page.locator(".team-debug-transcript > li").filter({ hasText: "Mocked role output" }).first();
    for (const summary of await page.locator(".team-debug-transcript details summary").all()) await summary.click();
    const transcriptText = await page.locator(".team-debug-transcript").innerText();
    assert.ok(transcriptText.includes("Mocked role output"));
    assert.match(transcriptText, /初始任务/);
    assert.match(transcriptText, /2026.*10.*24/);
    assert.match(transcriptText, /耗时 1 毫秒/);
    assert.match(transcriptText, /已完成/);
    assert.match(transcriptText, /工作中[\s\S]*模型服务/);
    assert.match(transcriptText, /将重试（第 2\/3 次）/);
    assert.match(transcriptText, /已满足汇聚条件/);
    assert.match(transcriptText, /已提交人工审核/);
    await page.locator("#project-graph-stage .studio-runtime-status-label").filter({ hasText: "已完成" }).first().waitFor();
    assert.ok(await page.locator('#project-graph-stage .x6-node[aria-label*="已完成"]').count() > 0, "runtime node state is exposed through an accessible name");
    assert.ok(await page.locator("#project-graph-stage .x6-node .studio-runtime-status-icon").count() > 0, "runtime state uses an inline SVG status icon");
    assert.equal(await page.locator("#project-graph-stage[data-runtime-signals='on']").count(), 1, "runtime flow enables the graph runtime overlay");
    assert.ok(await page.locator("#project-graph-stage .x6-edge path").count() > 0, "runtime graph contains rendered flow paths");

    const roleNode = page.locator("#project-graph-stage .x6-node").nth(1);
    await roleNode.click();
    await page.locator("#studio-asset-drawer.is-open[aria-hidden='false']").waitFor();
    await page.locator("#studio-assets-property-view:not([hidden])").waitFor();
    assert.equal(await debugPanel.getAttribute("aria-hidden"), "false", "clicking a runtime node keeps the debug panel open");
    const simulationPostCount = simulationRequests.filter((request) => request.startsWith("POST ")).length;
    assert.equal(simulationPostCount, 1);

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
    assert.equal(await historyRow.locator(".studio-history-action").count(), 2, "debug history rows should expose audit and workspace actions");
    await historyRow.click();
    await page.waitForURL(new RegExp(`/studio/teams/${teamVersionId}/run/${simulationId}$`));
    await page.getByRole("heading", { name: "调试运行" }).waitFor();
    assert.match(await page.locator(".project-grid").innerText(), /Review the draft package\.[\s\S]*Mocked UAT result/);
    assert.match(await page.locator(".studio-run-metrics").innerText(), /321[\s\S]*80[\s\S]*24/);
    assert.match(await page.locator(".studio-audit-badges").innerText(), /外部数据未分隔[\s\S]*备选模型: codex\/fallback \(主模型: codex\/primary\)[\s\S]*42[\s\S]*321/);
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
    await page.locator("#studio-run-graph-stage .x6-node").first().waitFor();
    assert.equal(await page.locator("#studio-run-graph-stage").count(), 1, "historical detail should mount a read-only runtime graph");
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
