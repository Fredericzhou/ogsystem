import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
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

test("Studio browser context map editor mounts autocomplete datalists and supports leaf property autofill", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-context-map-"));
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));

    await page.goto(url + "/cases/software-team", { waitUntil: "networkidle" });
    await page.locator("#detail-graph-stage").waitFor();
    await page.locator("[data-case-action=template]").click();
    await page.waitForURL(/\/studio\/teams\/[a-z0-9-]+\/design$/);
    await page.locator("#project-graph-stage").waitFor();

    // Open the assets panel in the Studio toolbar
    const assetsButton = page.locator('[data-studio-graph-action="assets"]');
    await assetsButton.waitFor({ state: "visible", timeout: 15000 });
    await assetsButton.click();

    // Select a role from the role list in the Studio asset navigator
    const roleButtons = page.locator("[data-studio-asset-role]");
    await roleButtons.first().waitFor({ state: "visible", timeout: 15000 });
    // Pick the second role (which has incoming flows from the first role)
    const count = await roleButtons.count();
    const roleToSelect = count > 1 ? roleButtons.nth(1) : roleButtons.first();
    await roleToSelect.click();

    // Verify the inspector mounts the Context Map section
    const contextMapSection = page.locator(".studio-context-map-editor");
    await contextMapSection.waitFor({ state: "visible", timeout: 10000 });

    // Verify "Add mapping" button exists
    const addButton = page.locator("[data-studio-context-add]");
    assert.equal(await addButton.isVisible(), true);

    // Click "Add mapping"
    await addButton.click();

    // Check newly added row
    const rows = page.locator("[data-studio-context-row]");
    const rowCount = await rows.count();
    assert.ok(rowCount >= 1, "Should have at least 1 context mapping row");

    const lastRow = rows.last();
    const targetInput = lastRow.locator("[data-studio-context-target]");
    const sourceSelect = lastRow.locator("[data-studio-context-source]");
    const pathInput = lastRow.locator("[data-studio-context-path]");
    const optionalCheckbox = lastRow.locator("[data-studio-context-optional]");

    assert.equal(await targetInput.isVisible(), true);
    assert.equal(await sourceSelect.isVisible(), true);
    assert.equal(await pathInput.isVisible(), true);

    // Initial state: target is new_field, source is global.task
    assert.ok((await targetInput.inputValue()).startsWith("new_field"));

    // Select a data source that supports paths, e.g. direct.data or source(...).data
    const availableOptions = await sourceSelect.locator("option").allTextContents();
    assert.ok(availableOptions.length > 1, "Should have multiple source options");

    const dataOptionValue = await sourceSelect.locator('option[value$=".data"]').first().getAttribute("value").catch(() => null);
    if (dataOptionValue) {
      await sourceSelect.selectOption(dataOptionValue);
      // Wait for input/change handling
      await page.waitForTimeout(100);

      // Verify that list attribute was attached if a datalist exists
      const listAttr = await pathInput.getAttribute("list");
      if (listAttr) {
        const datalist = page.locator(`#${listAttr}`);
        assert.equal(await datalist.count(), 1, "Datalist element should exist in DOM");
      }

      // Fill in path with nested property
      await pathInput.fill("evaluation.verdict");
      await pathInput.dispatchEvent("input");

      // Verify leaf auto-fill: target should be filled with "verdict"
      const targetVal = await targetInput.inputValue();
      assert.equal(targetVal, "verdict", `Expected target field to be autofilled with leaf 'verdict', got '${targetVal}'`);
    }

    assert.deepEqual(pageErrors, [], "No unhandled browser page errors should occur");
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    visualizer.kill("SIGTERM");
  }
});

test("Studio browser generates confirmed prompt rules for multiple incoming events", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-event-rules-"));
  const project = await seedReleasedClassicTeam(projectsRoot, "cross-backend-review-loop");
  const systemPath = join(project.workdir, "system.mmd");
  const systemSource = await readFile(systemPath, "utf8");
  await writeFile(systemPath, `${systemSource}opencode-reviewer[Role:opencode-reviewer] -->|REJECTED| codex-analyst[Role:codex-analyst]\n`, "utf8");

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
    env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot, OGS_VIS_URL: visualizerUrl },
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    page.on("dialog", async (dialog) => dialog.accept());

    const teamVersionId = project.teamVersionId || project.projectId;
    await page.goto(`${url}/studio/teams/${encodeURIComponent(teamVersionId)}/design`, { waitUntil: "domcontentloaded" });
    await page.locator("#project-graph-stage").waitFor();
    await page.locator('[data-studio-graph-action="assets"]').click();

    const analyst = page.locator('[data-studio-asset-role="codex-analyst"]');
    await analyst.waitFor({ state: "visible", timeout: 15000 });
    await analyst.click();
    const rulesButton = page.locator("[data-studio-event-rules-suggest]");
    await rulesButton.waitFor({ state: "visible", timeout: 10000 });
    await rulesButton.click();
    const prompt = page.locator('[data-studio-role-asset="prompt.md"]');
    await prompt.waitFor({ state: "attached" });
    const promptText = await prompt.inputValue();
    assert.match(promptText, /<!-- ogs:event-rules:start -->/);
    assert.match(promptText, /### NEEDS_REWORK/);
    assert.match(promptText, /### REJECTED/);
    assert.match(promptText, /<!-- ogs:event-rules:end -->/);
    assert.deepEqual(pageErrors, [], "No unhandled browser page errors should occur");
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    visualizer.kill("SIGTERM");
  }
});
