import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
import { exportTeamPackage } from "../../../dist/visualizer/project-projection.js";
import { teamCorePayload } from "../infrastructure/package-integrity.mjs";
import { seedReleasedClassicTeam } from "./classic-team-fixtures.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(appRoot, "../..");

async function waitForServiceUrl(processHandle, outputRef, pattern, label) {
  const startedAt = Date.now();
  let url;
  while (!url && Date.now() - startedAt < 45000) {
    url = outputRef.value.match(pattern)?.[1];
    if (processHandle.exitCode !== null) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  if (!url) {
    processHandle.kill("SIGTERM");
    assert.ok(url, `${label} did not start within 45 seconds: ${outputRef.value}`);
  }
  return url;
}

test("classic Teams keep the graph visible and TeamVersion forks require their own Sandbox release proof", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-classic-projects-"));
  await seedReleasedClassicTeam(projectsRoot);
  const visualizer = spawn(process.execPath, ["--import", "tsx", "src/visualizer/cli.ts", "--ogs-dir", projectsRoot, "--port", "0"], {
    cwd: repositoryRoot,
    env: { ...process.env, OGS_SITE_PROJECTS_DIR: projectsRoot },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const visualizerOutput = { value: "" };
  visualizer.stdout.on("data", (chunk) => { visualizerOutput.value += chunk.toString(); });
  visualizer.stderr.on("data", (chunk) => { visualizerOutput.value += chunk.toString(); });
  const visualizerUrl = await waitForServiceUrl(visualizer, visualizerOutput, /listening on (http:\/\/127\.0\.0\.1:\d+)/, "Studio server");
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot, OGS_VIS_URL: visualizerUrl, OGS_RUNTIME_TRACE: "1" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  let browser;
  try {
    const url = await waitForServiceUrl(server, { get value() { return output; } }, /ready at (http:\/\/127\.0\.0\.1:\d+)/, "Projects server");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    await page.addInitScript(() => {
      window.__classicTeamUnhandled = [];
      window.addEventListener("unhandledrejection", (event) => {
        window.__classicTeamUnhandled.push(String(event.reason?.message || event.reason || "unhandled rejection"));
      });
    });

    await page.goto(url + "/cases/software-team", { waitUntil: "networkidle" });
    await page.locator("#detail-graph-stage").waitFor();
    await page.locator("[data-case-action=template]").click();
    await page.waitForURL(/\/studio\/teams\/[a-z0-9-]+\/design$/);
    await page.locator("#project-graph-stage").waitFor();
    assert.equal((await (await page.locator(".project-status").first()).innerText()).includes("草案"), true);

    await page.goto(url + "/cases/software-team", { waitUntil: "networkidle" });
    await page.locator("#detail-graph-stage").waitFor();
    await page.locator("[data-case-action=use]").click();
    await page.waitForURL(/\/projects\/new\?team=[a-z0-9-]+$/);
    await page.locator("#collaboration-project-form").waitFor();
    const teamVersionId = new URL(page.url()).searchParams.get("team");
    const teamVersion = await page.request.get(`${url}/api/v1/projects/${teamVersionId}`).then((response) => response.json());
    const simulationPath = `/api/v1/teams/${teamVersion.teamId}/versions/${teamVersionId}/simulations`;
    const simulation = await page.request.post(`${url}${simulationPath}`, {
      data: { prompt: "Preview the software delivery workflow." }
    });
    assert.equal(simulation.status(), 201);
    const simulationResult = await simulation.json();
    assert.equal(simulationResult.simulation.teamId, teamVersion.teamId);
    assert.equal(simulationResult.simulation.teamVersionId, teamVersionId);
    assert.equal(simulationResult.simulation.runKind, "studio_simulation");
    assert.equal(simulationResult.simulation.status, "completed", JSON.stringify(simulationResult));
    assert.equal(simulationResult.state.mode, "dry-run");
    assert.equal(Object.hasOwn(simulationResult, "taskId"), false);
    assert.equal(Object.hasOwn(simulationResult, "runId"), false);
    const simulationId = simulationResult.simulation.simulationId;
    const listedSimulations = await page.request.get(`${url}${simulationPath}`).then((response) => response.json());
    assert.equal(listedSimulations.simulations.some((item) => item.simulationId === simulationId), true);
    const simulationEvidence = await page.request.get(`${url}${simulationPath}/${simulationId}`).then((response) => response.json());
    assert.equal(simulationEvidence.simulation.owner.kind, "studio_simulation");
    assert.equal(simulationEvidence.state.status, "completed");
    const simulationDir = join(projectsRoot, ".studio", "simulations", teamVersionId, simulationId);
    assert.equal(JSON.parse(await readFile(join(simulationDir, "simulation.json"), "utf8")).runKind, "studio_simulation");
    await assert.rejects(access(join(simulationDir, "run-owner.json")), { code: "ENOENT" });
    assert.deepEqual((await page.request.get(`${url}/api/v1/projects`).then((response) => response.json())).projects, []);
    const simulationRuns = await readdir(join(projectsRoot, teamVersionId, ".ogs", "runs"), { withFileTypes: true }).catch(() => []);
    assert.equal(simulationRuns.length, 0, "Studio Simulation must not persist a Run under the TeamVersion");
    await page.locator("#collaboration-project-form input[name=name]").fill("Software delivery project");
    await page.locator(`#project-team-options input[value="${teamVersionId}"]`).check();
    await page.locator("#collaboration-project-form button[type=submit]").click();
    await page.waitForURL(/\/projects\/[a-z0-9-]+$/);
    await page.locator("#collaboration-task-form").waitFor();
    assert.equal(await page.locator(".task-list-panel").count(), 1);
    assert.equal(await page.locator(".project-resources-panel").count(), 1);
    assert.equal(await page.locator(".team-link").innerText().then((text) => text.includes("软件研发")), true);

    const projectId = new URL(page.url()).pathname.match(/\/projects\/([a-z0-9-]+)$/)?.[1];
    assert.ok(projectId, "classic team use should open a collaboration project");
    await page.locator("#collaboration-task-form textarea[name=input]").fill(
      "为自由职业者记账工具规划首版，覆盖账目记录、月度汇总和上线前验收项。"
    );
    await page.locator("#collaboration-task-form button[type=submit]").click();
    const taskRow = page.locator(".task-record-row").first();
    await taskRow.waitFor();
    assert.match(await taskRow.innerText(), /自由职业者记账工具规划首版/);
    assert.match(await taskRow.innerText(), /软件研发/);
    assert.match(await taskRow.innerText(), /待执行/);

    const queuedProject = await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json());
    assert.equal(queuedProject.projectType, "collaboration");
    assert.equal(queuedProject.taskRecords.length, 1);
    const queuedTask = queuedProject.taskRecords[0];
    assert.equal(queuedTask.status, "queued");
    assert.equal(queuedTask.currentRunId, null);
    assert.deepEqual(queuedTask.runIds, []);
    assert.equal(queuedTask.teamVersionId.startsWith("case:"), false, "project Tasks must use the mounted TeamVersion identity");
    assert.equal(queuedProject.mountedTeams.some((team) => team.teamVersionId === queuedTask.teamVersionId), true);

    assert.deepEqual(await page.locator("[data-task-mode] option").allTextContents(), ["流程预览", "隔离运行"]);
    const modelCatalogPath = join(projectsRoot, queuedTask.teamVersionId, ".ogs", "model-catalog.json");
    const modelCatalog = await readFile(modelCatalogPath);
    await writeFile(modelCatalogPath, "{}\n", "utf8");
    await page.route("**/api/v1/platform/discovery", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [], sources: [] }) });
    });
    await taskRow.locator("[data-task-mode]").selectOption("sandbox");
    await taskRow.locator('[data-task-action="start"]').click();
    const firstRuntimeWarning = page.locator(".confirm-dialog");
    await firstRuntimeWarning.waitFor();
    await firstRuntimeWarning.locator('button[value="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".task-action-status")?.textContent.includes("未通过运行就绪检查"));
    const blockedTask = (await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json())).taskRecords[0];
    assert.equal(blockedTask.status, "queued");
    assert.equal(blockedTask.currentRunId, null);
    assert.deepEqual(blockedTask.runIds, []);
    await page.unroute("**/api/v1/platform/discovery");
    await writeFile(modelCatalogPath, modelCatalog);
    await taskRow.locator("[data-task-mode]").selectOption("dry-run");
    await taskRow.locator('[data-task-action="start"]').click();
    const secondRuntimeWarning = page.locator(".confirm-dialog");
    if (await secondRuntimeWarning.count()) await secondRuntimeWarning.locator('button[value="confirm"]').click();
    try {
      await page.waitForFunction(() => {
        const row = document.querySelector(".task-record-row");
        return row?.querySelector(".status-chip")?.classList.contains("completed")
          || row?.querySelector(".status-chip")?.classList.contains("failed");
      }, null, { timeout: 30000 });
    } catch (error) {
      const latestProject = await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json()).catch(() => undefined);
      const runId = latestProject?.taskRecords?.[0]?.currentRunId;
      const run = runId
        ? await page.request.get(`${url}/api/v1/projects/${projectId}/tasks/${queuedTask.taskId}/runs/${encodeURIComponent(runId)}`).then((response) => response.json()).catch(() => undefined)
        : undefined;
      const lockPath = join(projectsRoot, projectId, ".site", "project-write.lock");
      const lock = await readFile(lockPath, "utf8").then((value) => JSON.parse(value)).catch(() => undefined);
      throw new Error(`${error.message}; task=${JSON.stringify(latestProject?.taskRecords?.[0])}; run=${JSON.stringify(run?.state)}; lock=${JSON.stringify(lock)}; server=${output}`);
    }

    const completedProject = await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json());
    const completedTask = completedProject.taskRecords.find((item) => item.taskId === queuedTask.taskId);
    const projectLockPath = join(projectsRoot, projectId, ".site", "project-write.lock");
    const projectLock = await readFile(projectLockPath, "utf8").then((value) => JSON.parse(value)).catch(() => undefined);
    assert.equal(completedTask.status, "completed", `${completedTask.lastError || "classic team Task should complete"}${projectLock ? `; lock=${JSON.stringify(projectLock)}` : ""}`);
    assert.equal(completedTask.runIds.length, 1);
    assert.equal(completedTask.currentRunId, completedTask.runIds[0]);
    assert.match(completedTask.outputSummary, /^\[dry-run\]/, "preview runs must not be mistaken for business deliverables");

    const runResponse = await page.request.get(
      `${url}/api/v1/projects/${projectId}/tasks/${queuedTask.taskId}/runs/${encodeURIComponent(completedTask.currentRunId)}`
    );
    assert.equal(runResponse.status(), 200);
    const run = await runResponse.json();
    assert.equal(run.runKind, "project_task");
    assert.equal(run.owner.projectId, projectId);
    assert.equal(run.owner.teamVersionId, queuedTask.teamVersionId);
    assert.equal(Object.hasOwn(run, "projectId"), false);
    assert.equal(run.taskId, completedTask.taskId);
    assert.equal(run.runId, completedTask.currentRunId);
    assert.equal(run.attemptNumber, 1);
    assert.equal(run.isCurrent, true);
    assert.equal(run.state.status, "completed");
    assert.equal(run.plan.nodeGraph.length, 5);
    assert.equal(Object.keys(run.state.nodes).length >= 5, true, "the run should retain evidence for the classic team's roles");
    const expectedRoles = ["delivery-coordinator", "backend-planner", "experience-planner", "quality-planner", "delivery-lead"];
    assert.deepEqual(run.plan.nodeGraph.map((node) => node.nodeId).sort(), expectedRoles.slice().sort());
    assert.deepEqual(Object.keys(run.state.nodes).sort(), expectedRoles.slice().sort());
    assert.equal(Object.values(run.state.nodes).every((node) => node.status === "completed"), true);
    await page.waitForFunction(() => document.querySelector(".task-run-detail")?.dataset.runStatus === "completed");
    assert.equal(await taskRow.locator(".task-run-detail").getAttribute("data-run-status"), "completed");
    assert.equal(await taskRow.locator(".run-mode-chip").innerText(), "流程预览");
    const diagnosticHref = await taskRow.locator(".task-run-workspace-link a").getAttribute("href");
    assert.ok(diagnosticHref, "Task Run should expose its Run evidence link");
    const diagnosticUrl = new URL(diagnosticHref, page.url());
    assert.equal(diagnosticUrl.origin, new URL(page.url()).origin);
    assert.equal(diagnosticUrl.pathname, `/projects/${projectId}/runs/${completedTask.currentRunId}`);

    const diagnosticRunRoot = join(projectsRoot, projectId, ".ogs", "runs", completedTask.currentRunId);
    await assert.rejects(access(join(projectsRoot, queuedTask.teamVersionId, ".ogs", "runs", completedTask.currentRunId)), { code: "ENOENT" });
    const diagnosticRunStatePath = join(diagnosticRunRoot, "control", "state.json");
    const completedRunState = JSON.parse(await readFile(diagnosticRunStatePath, "utf8"));
    const completedProjectMeta = JSON.parse(await readFile(join(projectsRoot, projectId, ".site", "project.json"), "utf8"));
    await writeFile(diagnosticRunStatePath, `${JSON.stringify({ ...completedRunState, status: "running" }, null, 2)}\n`, "utf8");
    await writeFile(join(projectsRoot, projectId, ".site", "project.json"), `${JSON.stringify({
      ...completedProjectMeta,
      taskRecords: completedProjectMeta.taskRecords.map((record) => record.taskId === queuedTask.taskId
        ? { ...record, status: "running" }
        : record)
    }, null, 2)}\n`, "utf8");
    const diagnosticUrlPromise = page.waitForURL(new RegExp(`/projects/${projectId}/runs/${completedTask.currentRunId}$`));
    await taskRow.locator(".task-run-workspace-link a").click();
    await diagnosticUrlPromise;
    const diagnosticPage = page;
    const focusedRunEvidence = diagnosticPage.locator(`.task-run-detail[data-run-id="${completedTask.currentRunId}"]`);
    await focusedRunEvidence.waitFor();
    assert.equal(await focusedRunEvidence.evaluate((element) => element === document.activeElement), true, "same-origin Run diagnostics should focus the selected evidence");
    const diagnosticApiBefore = await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json());
    const diagnosticTaskBefore = diagnosticApiBefore.taskRecords.find((record) => record.taskId === queuedTask.taskId);
    assert.equal(diagnosticTaskBefore.status, "running");
    const diagnosticRunBefore = await page.request.get(`${url}/api/v1/projects/${projectId}/tasks/${queuedTask.taskId}/runs/${completedTask.currentRunId}`).then((response) => response.json());
    assert.equal(diagnosticRunBefore.state.status, "running");
    const diagnosticApiAfter = await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json());
    const diagnosticTaskAfter = diagnosticApiAfter.taskRecords.find((record) => record.taskId === queuedTask.taskId);
    const diagnosticRunAfter = await page.request.get(`${url}/api/v1/projects/${projectId}/tasks/${queuedTask.taskId}/runs/${completedTask.currentRunId}`).then((response) => response.json());
    assert.equal(diagnosticTaskAfter.status, "running");
    assert.equal(diagnosticTaskAfter.currentRunId, completedTask.currentRunId);
    assert.equal(diagnosticRunAfter.state.status, "running");
    await writeFile(diagnosticRunStatePath, `${JSON.stringify({ ...completedRunState, status: "completed" }, null, 2)}\n`, "utf8");
    await writeFile(join(projectsRoot, projectId, ".site", "project.json"), `${JSON.stringify({
      ...completedProjectMeta,
      taskRecords: completedProjectMeta.taskRecords.map((record) => record.taskId === queuedTask.taskId
        ? { ...record, status: "completed" }
        : record)
    }, null, 2)}\n`, "utf8");
    await diagnosticPage.waitForFunction((runId) => {
      const detail = [...document.querySelectorAll(".task-run-detail[data-run-id]")].find((item) => item.dataset.runId === runId);
      if (!detail || detail.dataset.runStatus !== "completed" || detail !== document.activeElement || detail.getAttribute("tabindex") !== "-1") return false;
      const outline = getComputedStyle(detail);
      return outline.outlineStyle !== "none" && Number.parseFloat(outline.outlineWidth) >= 2;
    }, completedTask.currentRunId, { timeout: 10000 });
    await diagnosticPage.goto(`${url}/projects/${projectId}`, { waitUntil: "networkidle" });
    await writeFile(diagnosticRunStatePath, `${JSON.stringify(completedRunState, null, 2)}\n`, "utf8");
    await writeFile(join(projectsRoot, projectId, ".site", "project.json"), `${JSON.stringify(completedProjectMeta, null, 2)}\n`, "utf8");

    assert.match(await taskRow.locator(".task-run-output").first().innerText(), /结果摘要/);
    assert.match(await taskRow.locator(".task-run-output").first().innerText(), /\[dry-run\]/);
    assert.equal(await page.request.get(`${url}/api/v1/projects/${projectId}/tasks/${queuedTask.taskId}/runs/${encodeURIComponent(completedTask.currentRunId)}`).then((response) => response.json()).then((payload) => Object.hasOwn(payload, "result")), false, "Run list/details must not inline full output");
    await taskRow.locator("[data-load-run-result]").click();
    await taskRow.locator(".task-run-output").nth(1).locator("pre").waitFor();
    assert.match(await taskRow.locator(".task-run-output").nth(1).innerText(), /完整结果/);
    const eventsResponse = await page.request.get(
      `${url}/api/v1/projects/${projectId}/tasks/${queuedTask.taskId}/runs/${encodeURIComponent(completedTask.currentRunId)}/events`
    );
    assert.equal(eventsResponse.status(), 200);
    const events = (await eventsResponse.json()).events;
    assert.equal(events.length > 0, true, "the Run should expose its event history");
    assert.equal(events.some((event) => expectedRoles.includes(event.record?.roleId || event.roleId)), true, "event history should identify role execution");
    assert.equal(await taskRow.locator(".task-run-events li").count() > 0, true, "the page should render run evidence");
    await page.reload({ waitUntil: "networkidle" });
    const restoredTask = (await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json())).taskRecords[0];
    assert.equal(restoredTask.taskId, completedTask.taskId);
    assert.equal(restoredTask.currentRunId, completedTask.currentRunId);
    assert.equal(restoredTask.status, "completed");
    assert.match(restoredTask.outputSummary, /^\[dry-run\]/);

    const firstRunId = completedTask.currentRunId;
    const firstRunRoot = join(projectsRoot, projectId, ".ogs", "runs", firstRunId);
    const firstRunStatePath = join(firstRunRoot, "control", "state.json");
    const firstRunState = JSON.parse(await readFile(firstRunStatePath, "utf8"));
    await writeFile(firstRunStatePath, `${JSON.stringify({ ...firstRunState, status: "failed", error: "Classic UAT prior attempt failed." }, null, 2)}\n`, "utf8");
    const projectMetaPath = join(projectsRoot, projectId, ".site", "project.json");
    const projectMeta = JSON.parse(await readFile(projectMetaPath, "utf8"));
    projectMeta.taskRecords = projectMeta.taskRecords.map((record) => record.taskId === queuedTask.taskId
      ? { ...record, status: "failed", lastError: "Classic UAT prior attempt failed." }
      : record);
    await writeFile(projectMetaPath, `${JSON.stringify(projectMeta, null, 2)}\n`, "utf8");
    await page.reload({ waitUntil: "networkidle" });
    const retryResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/v1/projects/${projectId}/tasks/${queuedTask.taskId}/retry`));
    await page.locator('.task-record-row [data-task-action="retry"]').click();
    const retryWarning = page.locator(".confirm-dialog");
    if (await retryWarning.count()) await retryWarning.locator('button[value="confirm"]').click();
    const retryResponse = await retryResponsePromise;
    const retryResponseBody = await retryResponse.json();
    assert.equal(retryResponse.ok(), true, retryResponseBody.error || "Task retry request failed");
    let retriedProject;
    let retriedTask;
    const retryDeadline = Date.now() + 30000;
    while (Date.now() < retryDeadline) {
      retriedProject = await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json());
      retriedTask = retriedProject.taskRecords.find((record) => record.taskId === queuedTask.taskId);
      const currentAttempt = retriedTask?.runAttempts?.find((attempt) => attempt.isCurrent);
      if (retriedTask?.runIds?.length === 2 && retriedTask.currentRunId !== firstRunId
        && ["completed", "failed"].includes(retriedTask.status) && currentAttempt?.status === retriedTask.status) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    assert.ok(retriedTask && ["completed", "failed"].includes(retriedTask.status), `Task retry did not reach a terminal state; attempts: ${JSON.stringify(retriedTask?.runAttempts)}; server output: ${output}`);
    assert.equal(retriedTask.status, "completed", `${retriedTask.lastError || "Task retry should complete"}; attempts: ${JSON.stringify(retriedTask.runAttempts)}; server output: ${output}`);
    assert.equal(retriedTask.runIds.length, 2);
    assert.equal(retriedTask.runIds[0], firstRunId);
    assert.notEqual(retriedTask.currentRunId, firstRunId);
    const firstAttempt = retriedTask.runAttempts.find((attempt) => attempt.runId === firstRunId);
    assert.equal(firstAttempt.status, "failed");
    assert.equal(firstAttempt.mode, "dry-run");
    assert.equal(firstAttempt.error, "Classic UAT prior attempt failed.");
    assert.match(firstAttempt.outputSummary, /^\[dry-run\]/);
    const attemptRequests = [];
    page.on("request", (request) => {
      if (request.url().includes(`/runs/${firstRunId}`)) attemptRequests.push(new URL(request.url()).pathname);
    });
    await page.locator(`[data-attempt-run-id="${firstRunId}"]`).click();
    await page.waitForFunction((runId) => {
      const detail = document.querySelector(".task-run-detail");
      return detail?.dataset.selectedRunId === runId && detail.dataset.runStatus === "failed";
    }, firstRunId);
    assert.equal(await page.locator(".task-run-status").innerText(), "运行失败");
    assert.equal(await page.locator(".run-mode-chip").innerText(), "流程预览");
    assert.match(await page.locator(".task-run-failure").innerText(), /Classic UAT prior attempt failed/);
    assert.match(await page.locator(".task-run-output").first().innerText(), /结果摘要\n\[dry-run\]/);
    assert.equal(await page.locator(".task-record-actions").isVisible(), false, "historical attempts must not expose Task controls");
    assert.ok(attemptRequests.some((path) => path.endsWith(`/runs/${firstRunId}`)));
    assert.ok(attemptRequests.some((path) => path.endsWith(`/runs/${firstRunId}/events`)));
    const firstRunResultResponse = await page.request.get(`${url}/api/v1/projects/${projectId}/tasks/${queuedTask.taskId}/runs/${firstRunId}/result`);
    assert.equal(firstRunResultResponse.status(), 200);
    const firstRunResult = await firstRunResultResponse.json();
    assert.equal(firstRunResult.available, true);
    assert.equal(firstRunResult.runId, firstRunId);
    await page.locator("[data-load-run-result]").click();
    await page.locator(".task-run-output").nth(1).locator("pre").waitFor();
    assert.match(await page.locator(".task-run-output").nth(1).innerText(), /完整结果/);
    await page.locator(`[data-attempt-run-id="${retriedTask.currentRunId}"]`).click();
    await page.waitForFunction((runId) => {
      const detail = document.querySelector(".task-run-detail");
      return detail?.dataset.selectedRunId === runId && detail.dataset.runStatus === "completed";
    }, retriedTask.currentRunId);
    assert.equal(await page.locator(".task-record-actions").isVisible(), true, "current attempt controls should remain available");
    const currentResultMarker = `unique-current-result:${retriedTask.currentRunId}`;
    const currentResultPath = `/api/v1/projects/${projectId}/tasks/${queuedTask.taskId}/runs/${retriedTask.currentRunId}/result`;
    await page.route(`**${currentResultPath}`, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true, runId: retriedTask.currentRunId, result: { finalOutput: currentResultMarker } })
    }));
    const currentResultResponse = page.waitForResponse((response) => response.url().endsWith(currentResultPath));
    await page.locator("[data-load-run-result]").click();
    assert.equal((await currentResultResponse).status(), 200);
    const currentFullOutput = page.locator(".task-run-output").filter({ hasText: "完整结果" });
    await page.waitForFunction((marker) => [...document.querySelectorAll(".task-run-output")].find((section) => section.textContent.includes("完整结果"))?.textContent.includes(marker), currentResultMarker);
    assert.match(await currentFullOutput.innerText(), new RegExp(currentResultMarker));
    await page.locator(`[data-attempt-run-id="${firstRunId}"]`).click();
    await page.waitForFunction((runId) => {
      const detail = document.querySelector(".task-run-detail");
      return detail?.dataset.selectedRunId === runId && detail.dataset.runStatus === "failed";
    }, firstRunId);
    const historicalFullOutput = page.locator(".task-run-output").filter({ hasText: "完整结果" });
    assert.equal(await historicalFullOutput.locator("pre").count(), 0, "switching attempts must clear the previous full result");
    assert.equal(await historicalFullOutput.locator("[data-load-run-result]").count(), 1);
    assert.doesNotMatch(await page.locator(".task-run-detail").innerText(), new RegExp(currentResultMarker));
    await page.unroute(`**${currentResultPath}`);
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 850 });
      await page.locator(`[data-attempt-run-id="${firstRunId}"]`).click();
      await page.waitForFunction((runId) => {
        const detail = document.querySelector(".task-run-detail");
        return detail?.dataset.selectedRunId === runId && detail.dataset.runStatus === "failed";
      }, firstRunId);
      assert.equal(await page.locator(".task-record-actions").isVisible(), false);
      await page.locator("[data-load-run-result]").click();
      await page.locator(".task-run-output").nth(1).locator("pre").waitFor();
      const historicalLayout = await page.evaluate(() => {
        const row = document.querySelector(".task-record-row").getBoundingClientRect();
        const detail = document.querySelector(".task-run-detail").getBoundingClientRect();
        const timeline = document.querySelector(".task-attempt-timeline").getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          rowRight: row.right,
          detailRight: detail.right,
          timelineRight: timeline.right
        };
      });
      assert.ok(historicalLayout.documentWidth <= historicalLayout.viewportWidth, `horizontal overflow at ${width}px: ${JSON.stringify(historicalLayout)}`);
      assert.ok(historicalLayout.detailRight <= historicalLayout.rowRight + 1, `Run detail escapes its task row at ${width}px: ${JSON.stringify(historicalLayout)}`);
      assert.ok(historicalLayout.timelineRight <= historicalLayout.rowRight + 1, `attempt timeline escapes its task row at ${width}px: ${JSON.stringify(historicalLayout)}`);
      assert.match(await page.locator(".task-run-output").nth(1).innerText(), /完整结果/);
      await page.locator(`[data-attempt-run-id="${retriedTask.currentRunId}"]`).click();
      await page.waitForFunction((runId) => {
        const detail = document.querySelector(".task-run-detail");
        return detail?.dataset.selectedRunId === runId && detail.dataset.runStatus === "completed";
      }, retriedTask.currentRunId);
      assert.equal(await page.locator(".task-record-actions").isVisible(), true, `current Task controls should be available at ${width}px`);
    }

    const teamAdjustmentButton = page.locator(`[data-team-adjust="${queuedTask.teamVersionId}"]`);
    const adjustmentPath = `/api/v1/projects/${projectId}/team-adjustments`;
    const adjustmentRequests = [];
    page.on("request", (request) => { if (request.url().includes(adjustmentPath)) adjustmentRequests.push(request.url()); });
    const adjustmentResponsePromise = page.waitForResponse((response) => response.url().includes(adjustmentPath), { timeout: 30000 })
      .catch(async (error) => {
        const buttonState = await teamAdjustmentButton.evaluate((button) => ({ disabled: button.disabled, connected: button.isConnected })).catch(() => null);
        const visibleStatus = await page.locator(".toast,.form-status[role=alert]").allTextContents().catch(() => []);
        throw new Error(`${error.message}; adjustmentRequests=${JSON.stringify(adjustmentRequests)}; button=${JSON.stringify(buttonState)}; status=${JSON.stringify(visibleStatus)}; server=${output}`);
      });
    await teamAdjustmentButton.click();
    const adjustmentResponse = await adjustmentResponsePromise;
    const adjustmentPayload = await adjustmentResponse.json();
    assert.equal(adjustmentResponse.ok(), true, adjustmentPayload.error || "Projects could not create a Studio draft");
    if (await page.locator(".confirm-dialog").count()) await page.locator(".confirm-dialog button[value=confirm]").click();
    await page.waitForFunction(() => /^\/studio\/teams\/[a-z0-9-]+\/design$/.test(location.pathname));
    const draftTeamVersionId = new URL(page.url()).pathname.match(/^\/studio\/teams\/([a-z0-9-]+)\/design$/)?.[1];
    assert.ok(draftTeamVersionId, `adjustment draft route must include a TeamVersion ID: ${page.url()}`);
    assert.notEqual(draftTeamVersionId, queuedTask.teamVersionId);
    const sourceTeamVersion = await page.request.get(`${url}/api/v1/projects/${queuedTask.teamVersionId}`).then((response) => response.json());
    const adjustmentDraft = await page.request.get(`${url}/api/v1/projects/${draftTeamVersionId}`).then((response) => response.json());
    assert.ok(adjustmentDraft.trustedClassicTopologyDigest,
      `classic topology baseline must be persisted on the draft: ${JSON.stringify({ source: sourceTeamVersion.teamCoreDigest, draft: adjustmentDraft.trustedClassicTopologyDigest, caseId: adjustmentDraft.caseId })}`);
    const adjustmentUrl = new URL(page.url());
    assert.equal(adjustmentUrl.searchParams.get("collaborationProjectId"), projectId);
    assert.equal(adjustmentUrl.searchParams.get("adjust"), "1");
    await page.locator("[data-team-studio-close]").click();
    assert.equal(await page.locator("#confirm-project").count(), 1, "Projects adjustment must open an unpublished Studio draft");
    let failFirstMount = true;
    await page.route(`**/api/v1/projects/${projectId}/teams`, async (route) => {
      if (route.request().method() === "PUT" && failFirstMount) {
        failFirstMount = false;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "PROJECT_MOUNT_TEMPORARILY_UNAVAILABLE" }) });
        return;
      }
      await route.continue();
    });
    await page.locator("#confirm-project").click();
    await page.waitForURL(new RegExp(`/studio/teams/${draftTeamVersionId}/release\\?`));
    const releasePath = `/api/v1/team-versions/${draftTeamVersionId}/release`;
    const releaseRequests = [];
    const releasePageTraffic = [];
    page.on("request", (request) => {
      if (request.url().includes(`/api/v1/projects/${draftTeamVersionId}`) || request.url().includes(releasePath)) {
        releaseRequests.push(request.url());
        releasePageTraffic.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    page.on("response", async (response) => {
      if (response.url().includes(`/api/v1/projects/${draftTeamVersionId}`) || response.url().includes(releasePath)) {
        releasePageTraffic.push(`${response.status()} ${new URL(response.url()).pathname}`);
        if (response.url().includes("/design/validate")) {
          releasePageTraffic.push(await response.text().catch((error) => `validation-body-error:${error.message}`));
        }
      }
    });
    try {
      await page.locator("#studio-release-button").waitFor({ timeout: 10000 });
    } catch (error) {
      const studioContent = await page.locator("#studio-view").innerText().catch(() => null);
      throw new Error(`${error.message}; url=${page.url()}; studio=${JSON.stringify(studioContent)}; releasePageTraffic=${JSON.stringify(releasePageTraffic)}; server=${output}`);
    }
    const releaseButtonState = await page.locator("#studio-release-button").evaluate((button) => ({ disabled: button.disabled, text: button.textContent }));
    const releaseReadiness = await page.request.get(`${url}/api/v1/team-versions/${draftTeamVersionId}/release-readiness`).then((response) => response.json());
    const parentReadiness = await page.request.get(`${url}/api/v1/team-versions/${adjustmentDraft.parentTeamVersionId}/release-readiness`).then((response) => response.json());
    const parentCore = teamCorePayload(await exportTeamPackage(join(projectsRoot, adjustmentDraft.parentTeamVersionId)));
    const draftCore = teamCorePayload(await exportTeamPackage(join(projectsRoot, draftTeamVersionId)));
    const changedCoreFields = Object.keys(parentCore).filter((key) => JSON.stringify(parentCore[key]) !== JSON.stringify(draftCore[key]));
    assert.deepEqual(changedCoreFields, [], "TeamVersion fork must not inherit stale template assets");
    assert.equal(sourceTeamVersion.teamCoreDigest, parentReadiness.teamCoreDigest);
    assert.equal(releaseReadiness.teamCoreDigest, parentReadiness.teamCoreDigest);
    assert.equal(releaseReadiness.ready, false, "the child TeamVersion must prove its own current assets");
    assert.match(releaseReadiness.reason, /TEAM_RELEASE_BASELINE_(?:EVIDENCE_)?REQUIRED/);
    assert.equal(releaseButtonState.disabled, true, `Release gate must block a child without its own Sandbox evidence: ${JSON.stringify({ releaseButtonState, releaseReadiness, parentReadiness, releasePageTraffic })}`);
    const releaseResponse = await page.request.post(`${url}${releasePath}`);
    assert.equal(releaseResponse.ok(), false, "the server must enforce the child TeamVersion gate");
    assert.match((await releaseResponse.json()).error, /TEAM_RELEASE_BASELINE_(?:EVIDENCE_)?REQUIRED/);
    const unchangedProject = await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json());
    assert.equal(unchangedProject.mountedTeams.some((team) => team.teamVersionId === sourceTeamVersion.teamVersionId), true);
    assert.equal(unchangedProject.mountedTeams.some((team) => team.teamVersionId === draftTeamVersionId), false);
    return;

    await page.locator("#team-mount-status").getByText("PROJECT_MOUNT_TEMPORARILY_UNAVAILABLE", { exact: false }).waitFor();
    assert.match(await page.locator("#team-mount-status").innerText(), /已发布.*尚未挂载/);
    assert.equal(await page.locator("#retry-team-mount").isVisible(), true);
    assert.equal(await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json()).then((project) => project.mountedTeams.some((team) => team.teamVersionId === draftTeamVersionId)), false);
    await page.locator("[data-team-studio-close]").click();
    await page.locator("#retry-team-mount").click();
    await page.waitForFunction(({ expectedProjectId, versionId }) => location.pathname === `/projects/${expectedProjectId}`,
      { expectedProjectId: projectId, versionId: draftTeamVersionId }, { timeout: 10000 });
    const retryMountedProject = await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json());
    assert.equal(retryMountedProject.mountedTeams.some((team) => team.teamVersionId === draftTeamVersionId), true);
    await page.goto(`${url}/projects/${projectId}/teams`, { waitUntil: "networkidle" });
    const draftMountOption = page.locator(`#project-managed-team-options input[value="${draftTeamVersionId}"]`);
    await draftMountOption.waitFor();
    assert.equal(await draftMountOption.isChecked(), true, "the successfully retried published version should appear mounted in Project settings");
    const adjustedProject = await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json());
    assert.equal(adjustedProject.taskRecords[0].taskId, queuedTask.taskId);
    assert.equal(adjustedProject.taskRecords[0].teamVersionId, queuedTask.teamVersionId,
      "existing Task must remain bound to its original TeamVersion");

    const recentRuns = await page.request.get(`${url}/api/v1/projects/runs/recent?limit=50`).then((response) => response.json()).then((payload) => payload.runs);
    const recentRun = recentRuns.find((item) => item.runId === completedTask.currentRunId);
    assert.ok(recentRun);
    assert.equal(recentRun.runKind, "project_task");
    assert.equal(recentRun.owner.projectId, projectId);
    assert.equal(recentRun.owner.teamVersionId, queuedTask.teamVersionId);
    assert.equal(Object.hasOwn(recentRun, "projectId"), false);
    await page.goto(`${url}/history`, { waitUntil: "networkidle" });
    const historyRow = page.locator(`.history-row:has(a[href$="/projects/${projectId}/runs/${completedTask.currentRunId}"])`).first();
    await historyRow.waitFor();
    assert.match(await historyRow.locator("a").first().getAttribute("href"), new RegExp(`/projects/${projectId}$`));
    const advancedUrl = new URL(await historyRow.locator("a").nth(1).getAttribute("href"), page.url());
    assert.equal(advancedUrl.origin, new URL(page.url()).origin);
    assert.equal(advancedUrl.pathname, `/projects/${projectId}/runs/${completedTask.currentRunId}`);
    await historyRow.locator("a").first().click();
    await page.waitForURL(`**/projects/${projectId}`);
    await page.waitForFunction(() => document.querySelector(".task-run-detail")?.dataset.runStatus === "completed");
    assert.equal(await page.locator(".run-mode-chip").innerText(), "流程预览");
    const fullResult = page.locator(".task-run-output").filter({ hasText: "完整结果" });
    assert.match(await fullResult.innerText(), /完整结果\s*读取完整结果/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const mobileLayout = await page.evaluate(() => {
      const workspace = document.querySelector("#project-workspace-view");
      const row = workspace?.querySelector(".task-record-row");
      const main = row?.querySelector(".task-record-main")?.getBoundingClientRect();
      const actions = row?.querySelector(".task-record-actions")?.getBoundingClientRect();
      const controlsInViewport = [...(workspace?.querySelectorAll("button, input, select, textarea, a") || [])]
        .filter((element) => element.getClientRects().length)
        .every((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= window.innerWidth + 1;
        });
      const mobileControls = [...(workspace?.querySelectorAll("button, input, select, textarea, a") || [])]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return element.getClientRects().length && getComputedStyle(element).visibility !== "hidden"
            && rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight
            && rect.left >= 0 && rect.right <= window.innerWidth;
        });
      const unreachableMobileControls = mobileControls.filter((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return !hit || (!element.contains(hit) && !hit.contains(element));
      });
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        controlsInViewport,
        mobileControlsReachable: mobileControls.length > 0 && unreachableMobileControls.length === 0,
        unreachableMobileControls: unreachableMobileControls.map((element) => element.outerHTML.slice(0, 120)),
        taskColumnsOverlap: Boolean(main && actions && main.left < actions.right && actions.left < main.right && main.top < actions.bottom && actions.top < main.bottom)
      };
    });
    assert.equal(mobileLayout.documentWidth, mobileLayout.viewportWidth, "project page should not overflow horizontally at 390px");
    assert.equal(mobileLayout.controlsInViewport, true, "project controls should remain within the mobile viewport");
    assert.equal(mobileLayout.mobileControlsReachable, true, `visible mobile controls should receive pointer hits: ${JSON.stringify(mobileLayout.unreachableMobileControls)}`);
    assert.equal(mobileLayout.taskColumnsOverlap, false, "task content and actions should not overlap on mobile");

    await page.setViewportSize({ width: 768, height: 900 });
    await page.waitForTimeout(100);
    const tabletLayout = await page.evaluate(() => {
      const workspace = document.querySelector("#project-workspace-view");
      const row = workspace?.querySelector(".task-record-row");
      const main = row?.querySelector(".task-record-main")?.getBoundingClientRect();
      const actions = row?.querySelector(".task-record-actions")?.getBoundingClientRect();
      const visibleControls = [...(workspace?.querySelectorAll("button, input, select, textarea, a") || [])]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return element.getClientRects().length && getComputedStyle(element).visibility !== "hidden"
            && rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight
            && rect.left >= 0 && rect.right <= window.innerWidth;
        });
      const unreachableControls = visibleControls.filter((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return rect.left < -1 || rect.right > window.innerWidth + 1
          || !hit || (!element.contains(hit) && !hit.contains(element));
      });
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        visibleControlCount: visibleControls.length,
        controlsReachable: visibleControls.length > 0 && unreachableControls.length === 0,
        unreachableControlNames: unreachableControls.map((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {
            name: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}[${element.getAttribute("data-task-action") || element.getAttribute("type") || ""}]`,
            rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
            hit: hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ""}.${String(hit.className || "").replaceAll(" ", ".")}` : null
          };
        }),
        taskColumnsOverlap: Boolean(main && actions && main.left < actions.right && actions.left < main.right && main.top < actions.bottom && actions.top < main.bottom)
      };
    });
    assert.equal(tabletLayout.documentWidth, tabletLayout.viewportWidth, "project page should not overflow horizontally at 768px");
    assert.ok(tabletLayout.visibleControlCount > 0, "tablet project page should expose interactive controls");
    assert.equal(tabletLayout.controlsReachable, true, `visible tablet controls should remain in the viewport and receive pointer hits: ${JSON.stringify(tabletLayout)}`);
    assert.equal(tabletLayout.taskColumnsOverlap, false, "task content and actions should not overlap at tablet width");
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(await page.evaluate(() => window.__classicTeamUnhandled), []);

    const localizedResponse = await page.request.post(url + "/api/v1/cases/software-team/use", {
      data: { locale: "en" }
    });
    assert.equal(localizedResponse.ok(), true);
    const localizedProject = await localizedResponse.json();
    assert.equal(localizedProject.projectId, queuedTask.teamVersionId, "locale must not create another built-in TeamVersion");
    const localizedGraphResponse = await page.request.get(url + "/api/v1/cases/software-team/graph?locale=en");
    assert.equal(localizedGraphResponse.ok(), true);
    const localizedGraph = await localizedGraphResponse.json();
    assert.equal(localizedGraph.nodes.find((node) => node.id === "delivery-coordinator")?.label, "Product lead");
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => undefined);
    visualizer.kill();
    await once(visualizer, "exit").catch(() => undefined);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        await rm(projectsRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        break;
      } catch (error) {
        if (!new Set(["EBUSY", "EPERM", "ENOTEMPTY"]).has(error?.code) || attempt === 11) throw error;
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      }
    }
  }
});
