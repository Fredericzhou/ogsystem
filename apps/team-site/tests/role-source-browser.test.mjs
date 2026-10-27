import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import { reserveBrowserSafePort } from "./browser-safe-port.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("role repository browses roles first and converts selections into Team draft packages", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "ogs-role-source-browser-"));
  const port = await reserveBrowserSafePort();
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: String(port), OGS_SITE_PROJECTS_DIR: dataRoot, OGS_PLATFORM_CONFIG_DIR: dataRoot },
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
    assert.ok(url, "site server did not start: " + output);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    const trialPayloads = [];
    const adminCalls = [];
    let configuredName = "Agency Agents";
    let sourceEnabled = true;
    let catalogHasUnverifiedSnapshot = true;
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/v1/platform/role-sources" && request.method() === "GET") {
        return route.fulfill({ json: { sources: [{
          sourceId: "agency-agents", name: configuredName, gitUrl: "https://github.com/msitarzewski/agency-agents.git", branch: "main", adapterId: "agency-agents-markdown", enabled: sourceEnabled,
          commit: "b37b5bb33b78f2c1d6567d98e25ca818e3259219", updatedAt: "2026-10-27T00:00:00.000Z",
          inventory: { readyRoles: 2, unsupportedCandidates: 1 }, syncStatus: { state: "succeeded", lastSuccessAt: "2026-10-27T00:00:00.000Z", lastSuccessfulCommit: "b37b5bb33b78f2c1d6567d98e25ca818e3259219" }
        }] } });
      }
      if (path === "/api/v1/platform/role-sources/agency-agents" && request.method() === "PUT") {
        const body = request.postDataJSON();
        adminCalls.push({ method: "PUT", body });
        configuredName = body.name;
        sourceEnabled = body.enabled;
        return route.fulfill({ json: { source: { sourceId: "agency-agents", name: configuredName, enabled: sourceEnabled } } });
      }
      if (path === "/api/v1/platform/role-sources/agency-agents/sync" && request.method() === "POST") {
        adminCalls.push({ method: "POST", path });
        return route.fulfill({ status: 202, json: { sourceId: "agency-agents", accepted: true, alreadyRunning: false } });
      }
      if (path === "/api/v1/studio/role-sources" && request.method() === "GET") {
        const source = {
          sourceId: "agency-agents",
          name: "Agency Agents",
          gitUrl: "https://github.com/msitarzewski/agency-agents.git",
          branch: "main",
          commit: "b37b5bb33b78f2c1d6567d98e25ca818e3259219",
          updatedAt: "2026-10-27T00:00:00.000Z",
          inventory: { completeness: "unverified", candidateMarkdownFiles: 2, readyRoles: 1, unsupportedCandidates: 1 },
          roles: [
            { roleId: "frontend-dev", name: "Frontend Developer", description: "Build accessible interfaces and reusable components.", category: "engineering", language: "en", path: "engineering/frontend-dev.md", commit: "b37b5bb33b78f2c1d6567d98e25ca818e3259219", updatedAt: "2026-10-27T00:00:00.000Z", icon: { type: "emoji", value: "🌱" }, display: { vibe: "Accessible UI" }, status: "ready", diagnostics: [] },
            { roleId: "researcher", name: "Researcher", description: "Explore a new discipline and summarize findings.", category: "new-discipline", language: "en", path: "new-discipline/researcher.md", commit: "b37b5bb33b78f2c1d6567d98e25ca818e3259219", updatedAt: "2026-10-27T00:00:00.000Z", icon: { type: "builtin", value: "role" }, status: "ready", diagnostics: [] }
          ]
        };
        if (!catalogHasUnverifiedSnapshot) {
          delete source.inventory;
          source.roles = [];
        }
        return route.fulfill({ json: { sources: [source] } });
      }
      if (path === "/api/v1/studio/role-sources/agency-agents/versions" && request.method() === "GET") {
        return route.fulfill({ json: { versions: [
          { commit: "b37b5bb33b78f2c1d6567d98e25ca818e3259219", updatedAt: "2026-10-27T00:00:00.000Z", roleCount: 1 },
          { commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", updatedAt: "2026-10-20T00:00:00.000Z", roleCount: 2 },
          { commit: "cccccccccccccccccccccccccccccccccccccccc", updatedAt: "2026-10-10T00:00:00.000Z", roleCount: 0 }
        ] } });
      }
      if (path === "/api/v1/studio/role-sources/agency-agents/roles/frontend-dev" && request.method() === "GET") {
        const commit = new URL(request.url()).searchParams.get("commit");
        if (commit === "cccccccccccccccccccccccccccccccccccccccc") return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
        const oldCommit = commit === "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        const selectedCommit = oldCommit ? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" : "b37b5bb33b78f2c1d6567d98e25ca818e3259219";
        return route.fulfill({ json: { role: { roleId: "frontend-dev", name: oldCommit ? "Frontend Developer (old)" : "Frontend Developer", description: "Build accessible interfaces and reusable components.", category: "engineering", language: "en", path: "engineering/frontend-dev.md", commit: selectedCommit, icon: { type: "emoji", value: "🌱" }, status: "ready", diagnostics: [] }, markdown: "# Instructions\n\n<script>window.__upstreamScriptRan = true</script>" } });
      }
      if (path === "/api/v1/team-factory" && request.method() === "GET") {
        return route.fulfill({ json: { teams: [{ teamVersionId: "team-draft-1", teamName: "Product Team", teamVersionNumber: 2 }] } });
      }
      if (path === "/api/v1/team-versions/team-draft-1/design" && request.method() === "GET") {
        return route.fulfill({ json: { authoring: {
          roles: { frontend: { title: "Frontend role" }, "__system_start__": { title: "Start" } },
          flows: {
            a: { fromRoleId: "frontend", eventType: "completed" },
            b: { fromRoleId: "frontend", eventType: "needs_review" },
            c: { fromRoleId: "frontend", eventType: "ERROR.failed" }
          }
        } } });
      }
      if (path === "/api/v1/team-versions/team-draft-1/design/assets" && request.method() === "GET") {
        return route.fulfill({ json: { executionConfig: { tools: { tools: [{ toolRef: "read-files" }] } } } });
      }
      if (path.endsWith("/roles/frontend-dev/trial") && request.method() === "POST") {
        trialPayloads.push(request.postDataJSON());
        return route.fulfill({ json: { result: { status: "completed", model: { backend: "openai", modelId: "test-model" }, durationMs: 24, output: { event: "ROLE_TRIAL_COMPLETE", content: "Trial result", data: { ok: true } } } } });
      }
      if (path === "/api/v1/studio/role-repository") return route.fulfill({ json: { templates: [] } });
      if (path === "/api/v1/team-repository") return route.fulfill({ json: { teams: [] } });
      return route.fulfill({ json: {} });
    });

    await page.goto(url + "/platform/role-sources", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "角色源配置" }).waitFor();
    assert.match(await page.locator(".role-source-admin-row").innerText(), /最近更新成功/);
    assert.match(await page.locator(".role-source-admin-row").innerText(), /2026/);
    assert.doesNotMatch(await page.locator(".role-source-admin-row").innerText(), /github\.com|main/);
    await page.getByRole("button", { name: "立即同步" }).click();
    await page.getByText("后台任务已启动。", { exact: true }).waitFor();
    assert.equal(adminCalls[0].method, "POST");
    await page.getByRole("button", { name: "编辑" }).click();
    await page.locator("input[name=name]").fill("Agency");
    await page.locator("input[name=enabled]").uncheck();
    await page.getByRole("button", { name: "保存修改" }).click();
    await page.waitForFunction(() => document.querySelector(".role-source-admin-title strong")?.textContent === "Agency");
    assert.deepEqual(adminCalls[1], { method: "PUT", body: { name: "Agency", enabled: false } });

    await page.goto(url + "/studio/roles", { waitUntil: "networkidle" });
    await page.locator(".role-source-item").first().waitFor();
    assert.equal(await page.locator(".role-source-dialog[open]").count(), 0, "role details should stay closed until a role is selected");
    assert.equal(await page.locator("aside.role-source-detail").count(), 0, "the catalog should not reserve a blank detail column");
    assert.equal(await page.locator(".page-frame-header .role-source-actions").count(), 1, "source status should live in the fixed page header");
    assert.equal(await page.locator(".page-frame-header .role-source-toolbar").count(), 1, "role filters should remain in the fixed page header");
    assert.equal(await page.locator(".role-source-list .role-source-actions").count(), 0, "source status should not take space above the role groups");
    const inventoryNote = page.locator(".role-source-inventory-note");
    await inventoryNote.waitFor();
    assert.equal(await inventoryNote.isVisible(), true, "incomplete source inventories should explain that the role list is not exhaustive");
    assert.equal(await inventoryNote.evaluate((note) => note.closest(".role-source-summary") !== null), true, "the inventory caveat should share the source summary row");
    assert.equal(await page.locator(".role-source-admin-form").count(), 0, "source configuration should stay out of the role browsing flow");
    assert.equal(await page.getByRole("button", { name: "更新角色" }).count(), 0, "the role repository should not start source updates");
    assert.deepEqual(await page.locator(".role-source-category h3").allTextContents(), ["engineering (1)", "new-discipline (1)"]);
    const desktopGridColumns = await page.locator(".role-source-category-grid").first().evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length);
    assert.ok(desktopGridColumns >= 2, `desktop role cards should use a multi-column grid, got ${desktopGridColumns}`);
    assert.match(await page.locator(".role-source-item-description").first().innerText(), /Build accessible interfaces/);
    assert.equal(await page.locator(".role-source-item").first().getAttribute("title"), "Build accessible interfaces and reusable components.");
    assert.match(await page.locator(".role-source-summary-meta").first().innerText(), /1 个可用角色/);
    await page.getByLabel("分类").selectOption("new-discipline");
    assert.deepEqual(await page.locator(".role-source-item").evaluateAll((nodes) => nodes.map((node) => node.dataset.roleId)), ["researcher"]);
    await page.getByLabel("分类").selectOption("");
    assert.equal(await page.locator(".role-source-icon[role=img]").first().getAttribute("aria-label"), "Frontend Developer");
    await page.locator(".role-source-item").first().click();
    await page.locator(".role-source-dialog[open]").waitFor();
    assert.ok(await page.locator(".role-source-dialog").evaluate((dialog) => dialog.scrollHeight <= dialog.clientHeight + 1), "role details and trial inputs should fit the initial viewport");
    assert.match(await page.locator("textarea[name=input]").inputValue(), /\"context\"/);
    assert.match(await page.locator(".role-source-trial-output-hint").textContent(), /event, content, data/);
    await page.locator(".role-source-preview").evaluate((details) => { details.open = true; });
    await page.locator(".role-source-version-control").evaluate((details) => { details.open = true; });
    const preview = page.locator(".role-source-preview pre");
    await preview.waitFor();
    assert.match(await preview.textContent(), /<script>window\.__upstreamScriptRan = true<\/script>/);
    assert.equal(await page.evaluate(() => window.__upstreamScriptRan), undefined);
    await page.getByLabel("来源版本").selectOption("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    await page.getByRole("heading", { name: "Frontend Developer (old)" }).waitFor();
    await page.locator(".role-source-version-control").evaluate((details) => { details.open = true; });
    await page.locator(".role-source-detail-facts").evaluate((details) => { details.open = true; });
    assert.match(await page.locator(".role-source-facts").innerText(), /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
    await page.getByLabel("来源版本").selectOption("cccccccccccccccccccccccccccccccccccccccc");
    await page.getByText("所选来源版本中不存在此角色。", { exact: true }).waitFor();
    await page.locator(".role-source-version-control").evaluate((details) => { details.open = true; });
    await page.getByLabel("来源版本").selectOption("b37b5bb33b78f2c1d6567d98e25ca818e3259219");
    await page.getByRole("heading", { name: "Frontend Developer" }).waitFor();

    const trial = page.locator(".role-source-trial");
    assert.equal(await page.locator(".role-source-copy").count(), 0, "role catalog details should not select or mutate a Team");
    await trial.locator("textarea[name=task]").fill("Summarize the request");
    await trial.locator("textarea[name=input]").fill('{"request":"Build an accessible menu"}');
    await trial.locator("textarea[name=userPreferences]").fill("Concise");
    await trial.getByRole("button", { name: "运行试用" }).click();
    await page.getByText(/完成 · openai\/test-model · 24 ms/).waitFor();
    assert.deepEqual(trialPayloads[0], { task: "Summarize the request", input: { request: "Build an accessible menu" }, userPreferences: "Concise" });
    assert.match(await trial.locator(".role-source-trial-output").textContent(), /ROLE_TRIAL_COMPLETE/);
    await page.setViewportSize({ width: 390, height: 844 });
    const catalogLayout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      catalog: document.querySelector(".role-source-catalog")?.getBoundingClientRect().toJSON(),
      wide: [...document.querySelectorAll("body *")].map((node) => ({ node, rect: node.getBoundingClientRect() })).filter(({ rect }) => rect.right > document.documentElement.clientWidth + 1).slice(0, 8).map(({ node, rect }) => ({ tag: node.tagName, className: node.className?.baseVal || node.className, width: rect.width, right: rect.right }))
    }));
    assert.ok(catalogLayout.document <= catalogLayout.viewport + 1, `role catalog should fit a narrow viewport: ${JSON.stringify(catalogLayout)}`);
    await page.setViewportSize({ width: 320, height: 740 });
    const narrowLayout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      list: document.querySelector(".role-source-list")?.getBoundingClientRect().width,
      description: document.querySelector(".role-source-item-description")?.getBoundingClientRect().width,
      copyButton: document.querySelector(".role-source-trial .primary-button")?.getBoundingClientRect().width,
      dialog: document.querySelector(".role-source-dialog")?.getBoundingClientRect().toJSON()
    }));
    assert.ok(narrowLayout.document <= narrowLayout.viewport + 1, `role repository should fit a 320px viewport: ${JSON.stringify(narrowLayout)}`);
    assert.ok(narrowLayout.list >= 260 && narrowLayout.description > 0 && narrowLayout.copyButton >= 220, `mobile role content and action should remain readable: ${JSON.stringify(narrowLayout)}`);
    assert.equal(await page.locator(".role-source-category-grid").first().evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length), 1, "mobile role cards should use one column");
    assert.ok(narrowLayout.dialog.left >= 0 && narrowLayout.dialog.right <= narrowLayout.viewport + 1, `role detail dialog should fit a 320px viewport: ${JSON.stringify(narrowLayout.dialog)}`);
    await page.getByRole("button", { name: "关闭角色详情" }).click();
    await page.locator(".role-source-dialog[open]").waitFor({ state: "hidden" });
    catalogHasUnverifiedSnapshot = false;
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator(".role-source-inventory-note").isVisible(), false, "the inventory caveat should stay hidden when no snapshot is available");
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
    await rm(dataRoot, { recursive: true, force: true });
  }
});
