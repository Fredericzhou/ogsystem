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

async function startClassicTeamSite(prefix) {
  const projectsRoot = await mkdtemp(join(tmpdir(), prefix));
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
  let server;
  let browser;
  try {
    const visualizerUrl = await waitForServiceUrl(visualizer, visualizerOutput, /listening on (http:\/\/127\.0\.0\.1:\d+)/, "Studio server");
    server = spawn(process.execPath, ["server.mjs"], {
      cwd: appRoot,
      env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot, OGS_VIS_URL: visualizerUrl },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    server.stdout.on("data", (chunk) => { output += chunk.toString(); });
    server.stderr.on("data", (chunk) => { output += chunk.toString(); });
    const url = await waitForServiceUrl(server, { get value() { return output; } }, /ready at (http:\/\/127\.0\.0\.1:\d+)/, "Projects server");
    browser = await chromium.launch({ headless: true });
    return {
      projectsRoot,
      url,
      browser,
      output: () => output,
      async close() {
        await browser?.close();
        server?.kill();
        if (server && server.exitCode === null) await once(server, "exit").catch(() => undefined);
        visualizer.kill();
        if (visualizer.exitCode === null) await once(visualizer, "exit").catch(() => undefined);
        await rm(projectsRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    };
  } catch (error) {
    await browser?.close();
    server?.kill();
    if (server && server.exitCode === null) await once(server, "exit").catch(() => undefined);
    visualizer.kill();
    if (visualizer.exitCode === null) await once(visualizer, "exit").catch(() => undefined);
    await rm(projectsRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    throw error;
  }
}

async function createClassicProjectWithTask(page, url, name) {
  await page.goto(url + "/cases/software-team", { waitUntil: "networkidle" });
  await page.locator("[data-case-action=use]").click();
  await page.waitForURL(/\/projects\/new\?team=[a-z0-9-]+$/);
  const teamVersionId = new URL(page.url()).searchParams.get("team");
  const teamVersion = await page.request.get(`${url}/api/v1/projects/${teamVersionId}`).then((response) => response.json());
  await page.locator("#collaboration-project-form input[name=name]").fill(name);
  await page.locator(`#project-team-options input[value="${teamVersionId}"]`).check();
  await page.locator("#collaboration-project-form button[type=submit]").click();
  await page.waitForURL(/\/projects\/[a-z0-9-]+$/);
  const projectId = new URL(page.url()).pathname.match(/\/projects\/([a-z0-9-]+)$/)?.[1];
  await page.locator("[data-open-task-dialog]").click();
  await page.locator("#collaboration-task-form").waitFor();
  await page.locator("#collaboration-task-form textarea[name=input]").fill("Review the software delivery request.");
  await page.locator("#collaboration-task-form button[type=submit]").click();
  await page.locator(".task-record-row").first().waitFor();
  const task = (await page.request.get(`${url}/api/v1/projects/${projectId}`).then((response) => response.json())).taskRecords[0];
  return { projectId, teamVersionId, teamVersion, task };
}

test("classic software Team template opens its graph in the classic authoring view", async () => {
  const site = await startClassicTeamSite("ogs-site-classic-graph-");
  try {
    const page = await site.browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(site.url + "/cases/software-team", { waitUntil: "networkidle" });
    await page.locator("#detail-graph-stage").waitFor();
    await page.locator("[data-case-action=template]").click();
    await page.waitForURL(/\/studio\/teams\/[a-z0-9-]+\/design$/);
    await page.locator("#project-graph-stage").waitFor();
    assert.equal((await page.locator(".project-status").first().innerText()).includes("设计中"), true);
  } finally {
    await site.close();
  }
});

test("classic Team v2 Tasks fail closed without the Sandbox executor and create no Run evidence", async () => {
  const site = await startClassicTeamSite("ogs-site-classic-v2-task-");
  try {
    const page = await site.browser.newPage({ viewport: { width: 1280, height: 900 } });
    const { projectId, teamVersion, task } = await createClassicProjectWithTask(page, site.url, "Classic v2 fail-closed project");
    assert.match(teamVersion.teamIrSemanticDigest, /^[a-f0-9]{64}$/);
    assert.match(teamVersion.compiledPlanDigest, /^[a-f0-9]{64}$/);
    assert.equal(task.status, "queued");
    assert.equal(task.currentRunId, null);
    assert.deepEqual(task.runIds, []);

    const taskRow = page.locator(".task-record-row").first();
    await taskRow.locator("[data-task-mode]").selectOption("dry-run");
    const startResponsePromise = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/projects/${projectId}/tasks/${task.taskId}/start`);
    await taskRow.locator('[data-task-action="start"]').click();
    const runtimeWarning = page.locator(".confirm-dialog");
    if (await runtimeWarning.count()) await runtimeWarning.locator('button[value="confirm"]').click();
    const startResponse = await startResponsePromise;
    assert.equal(startResponse.status(), 400);
    assert.match((await startResponse.json()).error, /^TEAM_IR_V2_EXECUTOR_UNAVAILABLE:/);
    await page.waitForFunction(() => document.querySelector(".task-action-status")?.textContent.includes("TEAM_IR_V2_EXECUTOR_UNAVAILABLE"));

    const after = (await page.request.get(`${site.url}/api/v1/projects/${projectId}`).then((response) => response.json())).taskRecords[0];
    assert.equal(after.status, "queued");
    assert.equal(after.currentRunId, null);
    assert.deepEqual(after.runIds, []);
    const runRoot = join(site.projectsRoot, projectId, ".ogs", "runs");
    assert.deepEqual(await readdir(runRoot, { withFileTypes: true }).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error)), []);
  } finally {
    await site.close();
  }
});

test("legacy classic Team release is blocked with a v2 rebuild prompt and leaves the Project mount unchanged", async () => {
  const site = await startClassicTeamSite("ogs-site-classic-fork-");
  try {
    const page = await site.browser.newPage({ viewport: { width: 1280, height: 900 } });
    const { projectId, teamVersionId, task } = await createClassicProjectWithTask(page, site.url, "Classic Team fork project");
    assert.equal(task.teamVersionId, teamVersionId);
    const projectBefore = await page.request.get(`${site.url}/api/v1/projects/${projectId}`).then((response) => response.json());
    const teamBefore = await page.request.get(`${site.url}/api/v1/projects/${teamVersionId}`).then((response) => response.json());
    const repositoryBefore = await page.request.get(`${site.url}/api/v1/team-repository?includeUnreleased=true`).then((response) => response.json());
    await page.goto(`${site.url}/studio/teams/${teamVersionId}/release?collaborationProjectId=${projectId}&adjust=1&edit=1`, { waitUntil: "domcontentloaded" });
    await page.locator("#studio-view").getByText("需要重建 Team IR v2", { exact: true }).waitFor();
    assert.equal(await page.locator("#studio-release-button").count(), 0);
    assert.ok(await page.locator('#studio-view a[href*="/ir"]').count() > 0);
    const releaseResponse = await page.request.post(`${site.url}/api/v1/team-versions/${teamVersionId}/release`);
    assert.equal(releaseResponse.ok(), false);
    assert.match((await releaseResponse.json()).error, /TEAM_IR_V2_REQUIRED/);
    const repositoryAfter = await page.request.get(`${site.url}/api/v1/team-repository?includeUnreleased=true`).then((response) => response.json());
    assert.deepEqual((repositoryAfter.teams || []).map((version) => version.teamVersionId).sort(),
      (repositoryBefore.teams || []).map((version) => version.teamVersionId).sort());
    const teamAfter = await page.request.get(`${site.url}/api/v1/projects/${teamVersionId}`).then((response) => response.json());
    assert.equal(teamAfter.teamVersionStatus, teamBefore.teamVersionStatus);
    assert.equal(teamAfter.teamIrSemanticDigest, teamBefore.teamIrSemanticDigest);
    assert.equal(teamAfter.compiledPlanDigest, teamBefore.compiledPlanDigest);
    const project = await page.request.get(`${site.url}/api/v1/projects/${projectId}`).then((response) => response.json());
    assert.equal(project.mountedTeams.some((team) => team.teamVersionId === teamVersionId), true);
    assert.deepEqual(project.mountedTeams.map((team) => team.teamVersionId), projectBefore.mountedTeams.map((team) => team.teamVersionId));
    assert.equal(project.taskRecords[0].teamVersionId, teamVersionId);
  } finally {
    await site.close();
  }
});
