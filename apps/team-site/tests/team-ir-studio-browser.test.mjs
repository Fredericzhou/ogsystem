import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
import { reserveBrowserSafePort } from "./browser-safe-port.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("Team IR v2 Studio uses the original graph shell with v2 semantic inspection", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-ir-studio-browser-"));
  const resolverPath = join(projectsRoot, "test-resolver.mjs");
  await writeFile(resolverPath, `
export async function resolveTeamIrReleaseClosure({ teamIR }) {
  return { complete: true, packageDigests: Object.fromEntries(teamIR.agents.map((agent) => [agent.packageRef, "${"a".repeat(64)}"])), bindingDigests: Object.fromEntries(teamIR.bindings.map((binding) => [binding.id, "${"b".repeat(64)}"])), adapterVersions: {} };
}
export async function resolveBindings() { return {}; }
`, "utf8");
  const port = await reserveBrowserSafePort();
  const server = spawn(process.execPath, ["server.mjs"], { cwd: appRoot, env: { ...process.env, PORT: String(port), OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot, OGS_TEAM_IR_V2_RESOLVER_MODULE: resolverPath }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
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
    assert.ok(url, `Team Site did not start: ${output}`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${url}/studio/new`, { waitUntil: "networkidle" });
    await page.locator('input[name="templateCaseId"]').first().waitFor({ timeout: 10000 });
    assert.equal(await page.locator('input[name="templateCaseId"]').count(), 9);
    await page.locator('input[name="templateCaseId"][value=""]').check();
    await page.locator("#new-project-form input[name=name]").fill("Graph browser draft");
    await page.locator("#new-project-form textarea[name=overview]").fill("Verify the original graph workbench with native Team IR v2 semantics.");
    await page.locator("#new-project-form button[type=submit]").click();
    await page.waitForURL(/\/studio\/teams\/[a-z0-9-]+\/ir$/);
    const teamVersionId = page.url().match(/\/studio\/teams\/([a-z0-9-]+)\/ir$/)?.[1];
    assert.ok(teamVersionId);
    await page.locator("#project-graph-stage svg").first().waitFor({ timeout: 10000 });
    assert.equal(await page.locator(".studio-design-workbench").count(), 1);
    assert.equal(await page.locator("#studio-asset-drawer").count(), 1);
    assert.equal(await page.locator("#team-ir-editor").count(), 0);
    assert.ok(await page.locator("#project-graph-stage [data-cell-id]").count() > 0);
    await page.getByText("worker", { exact: true }).first().click();
    await page.locator("[data-v2-role-package]").waitFor();
    assert.equal(await page.locator("[data-v2-role-package]").inputValue(), "role:worker@1");
    assert.equal(await page.locator("[data-v2-role-binding]").inputValue(), "binding:worker");
    assert.match(await page.locator("#studio-property-inspector").innerText(), /输入 Port|Input Ports/);
    const localLayoutKey = `ogs.team-ir-v2.layout.v1:${teamVersionId}:${teamVersionId}:worker`;
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ x: 321, y: 123 })), localLayoutKey);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#project-graph-stage svg").first().waitFor();
    assert.deepEqual(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), localLayoutKey), { x: 321, y: 123 });
    await page.locator('#project-graph-stage [data-cell-id="run-to-worker"]').click({ force: true });
    await page.locator("[data-v2-flow-map]").waitFor();
    const map = JSON.parse(await page.locator("[data-v2-flow-map]").inputValue());
    map.data.request = { $ref: "$.run.input.request" };
    await page.locator("[data-v2-flow-map]").fill(JSON.stringify(map, null, 2));
    await page.locator("[data-v2-apply-flow]").click();
    await page.locator("[data-v2-save-inspector]").click();
    await page.getByText(/草稿已保存|Draft saved|Saved and release-ready/).waitFor({ timeout: 10000 });
    const reopened = await page.request.get(`${url}/api/v1/team-versions/${teamVersionId}/ir`).then((response) => response.json());
    assert.deepEqual(reopened.teamIR.handoffs.find((handoff) => handoff.id === "run-to-worker").map.data.request, { $ref: "$.run.input.request" });
    await page.reload({ waitUntil: "networkidle" });
    assert.ok(await page.locator("#project-graph-stage svg").count() > 0);
    const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(layout.content <= layout.viewport + 1, `mobile page overflows horizontally: ${JSON.stringify(layout)}`);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
    await new Promise((resolveWait) => server.once("exit", resolveWait));
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
