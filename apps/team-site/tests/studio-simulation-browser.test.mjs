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
    async simulate(_team, { prompt }) {
      return {
        status: "completed",
        finalOutput: "Mocked UAT result for " + prompt,
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
    await page.locator("#project-graph-stage .x6-node").nth(2).waitFor();
    const teamVersionId = page.url().match(/\/teams\/([a-z0-9-]+)\/design$/)?.[1];
    const team = await page.request.get(`${url}/api/v1/projects/${teamVersionId}`).then((response) => response.json());
    assert.equal(team.teamVersionStatus, "draft");
    assert.equal(team.teamCoreDigest, null);
    assert.equal(team.projectDigest, null);

    await page.locator('#project-graph-stage [data-studio-graph-action="debug-run"]').click();
    await page.locator("#team-studio-tab-run").click();
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
    assert.match(localizedError, /请输入 1 到 1,200 个字符的模拟任务/);
    assert.doesNotMatch(localizedError, /STUDIO_SIMULATION_INPUT_INVALID/);

    await page.locator("#team-simulation-input").fill("Review the draft package.");
    assert.equal((await submit()).status(), 201);
    await page.getByText("Mocked UAT result for Review the draft package.").waitFor();
    assert.deepEqual(scriptErrors, []);
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
    await page.locator(".studio-run-layout, #studio-view .run-error").waitFor({ timeout: 10000 });
    assert.equal(await page.locator(".studio-run-layout").count(), 1, `Studio run page failed: ${await page.locator("#studio-view").innerText()}`);
    assert.equal(await historyRow.count(), 1, `Studio Simulation history should survive restart: ${await page.locator("#studio-view").innerText()}`);
    assert.match(await historyRow.innerText(), /Review the draft package\./);
    await historyRow.click();
    await page.waitForURL(new RegExp(`/studio/teams/${teamVersionId}/run/${simulationId}$`));
    await page.getByRole("heading", { name: "Studio 模拟" }).waitFor();
    assert.match(await page.locator(".project-grid").innerText(), /Review the draft package\.[\s\S]*Mocked UAT result/);
    const eventTimeline = page.locator(".studio-event-list");
    await eventTimeline.waitFor();
    assert.match(await eventTimeline.innerText(), /simulation\.started[\s\S]*role\.completed[\s\S]*simulation\.completed/);
    await page.reload({ waitUntil: "networkidle" });
    const reloadedHeading = page.locator("#studio-view .page-heading h1");
    await reloadedHeading.waitFor({ timeout: 10000 });
    assert.match(await reloadedHeading.innerText(), /Studio/, `Simulation deep link failed at ${page.url()}`);
    await page.locator(".studio-event-list li").first().waitFor();
    assert.equal(await page.locator("#studio-view .status-chip.completed").count(), 1);
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
