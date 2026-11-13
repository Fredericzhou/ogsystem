import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
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

test("Studio browser configures decision criteria and route condition descriptions", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-decision-criteria-"));
  await seedReleasedClassicTeam(projectsRoot, "cross-backend-review-loop");
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

    await page.goto(url + "/cases/cross-backend-review-loop", { waitUntil: "networkidle" });
    await page.locator("#detail-graph-stage").waitFor();
    await page.locator("[data-case-action=template]").click();
    await page.waitForURL(/\/studio\/teams\/[a-z0-9-]+\/design$/);
    await page.locator("#project-graph-stage").waitFor();
    await page.locator('[data-studio-graph-action="assets"]').click();

    const roleButtons = page.locator("[data-studio-asset-role]");
    await roleButtons.nth(1).click();
    await page.locator("[data-studio-decision-criteria]").waitFor({ state: "visible" });
    await page.locator("[data-studio-decision-add]").click();
    const criterion = page.locator("[data-studio-decision-row]").last();
    await criterion.locator('[data-studio-decision-field="id"]').fill("security");
    await criterion.locator('[data-studio-decision-field="description"]').fill("没有硬性安全问题");
    await criterion.locator('[data-studio-decision-field="failureAction"]').selectOption("reject");
    await criterion.locator('[data-studio-decision-field="evidenceHint"]').fill("artifacts/security.json");

    const roleJson = await page.locator('[data-studio-role-asset="role.json"]').inputValue();
    const outputSchema = await page.locator('[data-studio-role-asset="output.schema.json"]').inputValue();
    assert.match(roleJson, /"decisionCriteria"/);
    assert.match(roleJson, /"security"/);
    assert.match(outputSchema, /"criteria"/);
    assert.match(outputSchema, /"requiredChanges"/);

    const flowButtons = page.locator('[data-studio-asset-flow]');
    if (await flowButtons.count()) {
      await page.locator("[data-studio-assets-back]").click();
      await page.locator("#studio-assets-flows-tab").click();
      await flowButtons.first().click();
      await page.locator('[data-studio-flow-field="label"]').fill("所有必需条件通过后发布");
      assert.equal(await page.locator('[data-studio-flow-field="label"]').inputValue(), "所有必需条件通过后发布");
    }
    assert.deepEqual(pageErrors, [], "No unhandled browser page errors should occur");
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    visualizer.kill("SIGTERM");
  }
});
