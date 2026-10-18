import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function startServer(projectsRoot) {
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot },
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

test("duplicate team and project creation keeps the user on the form with the entered values", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-product-duplicates-"));
  const { server, url } = await startServer(projectsRoot);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${url}/factory/new`, { waitUntil: "networkidle" });
    await page.locator("#new-project-form input[name=name]").fill("Duplicate Product Team");
    await page.locator("#new-project-form textarea[name=overview]").fill("Keep the original team and explain duplicate creation clearly.");
    await page.locator("#new-project-form button[type=submit]").click();
    await page.waitForURL(/\/studio\/team\/[a-z0-9-]+$/);
    const teamId = page.url().match(/\/studio\/team\/([^/]+)$/)?.[1];
    assert.ok(teamId);
    await page.goto(`${url}/factory/new`, { waitUntil: "networkidle" });
    await page.locator("#new-project-form input[name=name]").fill("Duplicate Product Team");
    await page.locator("#new-project-form textarea[name=overview]").fill("This input must remain after the duplicate is rejected.");
    await page.locator("#new-project-form button[type=submit]").click();
    await page.waitForFunction(() => document.querySelector("#new-project-status")?.textContent.includes("TEAM_NAME_EXISTS"));
    assert.match(page.url(), /\/factory\/new$/);
    assert.equal(await page.locator("#new-project-form input[name=name]").inputValue(), "Duplicate Product Team");
    assert.match(await page.locator("#new-project-form textarea[name=overview]").inputValue(), /remain after/);

    assert.equal((await page.request.post(`${url}/api/v1/team-versions/${encodeURIComponent(teamId)}/release`)).status(), 200);
    const createdProject = await page.request.post(`${url}/api/v1/projects`, {
      data: { name: "Duplicate Product Project", overview: "Original project.", teamVersionIds: [teamId] }
    });
    assert.equal(createdProject.status(), 201);
    await page.goto(`${url}/studio/project/new`, { waitUntil: "networkidle" });
    await page.locator("#collaboration-project-form input[name=name]").fill("Duplicate Product Project");
    await page.locator(`#project-team-options input[value="${teamId}"]`).check();
    await page.locator("#collaboration-project-form button[type=submit]").click();
    await page.waitForFunction(() => document.querySelector("#collaboration-project-status")?.textContent.includes("PROJECT_NAME_EXISTS"));
    assert.match(page.url(), /\/studio\/project\/new$/);
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
    const design = await page.request.get(`${url}/api/v1/projects/${team.projectId}/team/design`).then((response) => response.json());
    let mode = "failure";
    let latestChatPayload;
    await page.route(`**/api/v1/projects/${team.projectId}/team/chat`, async (route) => {
      latestChatPayload = JSON.parse(route.request().postData() || "{}");
      if (mode === "failure") {
        await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "TEAM_ASSISTANT_UNAVAILABLE: test upstream failure" }) });
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
    await page.goto(`${url}/studio/team/${team.projectId}`, { waitUntil: "networkidle" });
    await page.locator("#team-assistant").waitFor();
    await page.waitForFunction(() => document.querySelector("#team-assistant-status")?.textContent.includes("TEAM_ASSISTANT_UNAVAILABLE"));
    mode = "success";
    await page.locator("#team-assistant-input").fill("增加一个最终审核角色，确保结果有依据。");
    await page.locator("#team-assistant-send").click();
    await page.locator("#team-assistant-apply").waitFor();
    assert.match(await page.locator("#team-assistant-history").innerText(), /已理解目标/);
    assert.equal(typeof latestChatPayload.systemSource, "string");
    assert.equal(typeof latestChatPayload.authoring, "object");
    const saveResponse = page.waitForResponse((response) => response.url().includes(`/api/v1/projects/${team.projectId}/team/design`) && response.request().method() === "PUT");
    await page.locator("#team-assistant-apply").click();
    assert.equal((await saveResponse).status(), 200);
    await page.locator("#team-assistant").waitFor();
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(await page.evaluate(() => window.__productUnhandled), []);
  } finally {
    await closeServer(server, projectsRoot, browser);
  }
});
