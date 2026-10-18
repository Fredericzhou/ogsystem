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
    const match = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) url = match[1];
    else await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  assert.ok(url, "site server did not start: " + output);
  return { server, url };
}

test("dirty forms guard route changes and beforeunload", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-interaction-dirty-"));
  const { server, url } = await startServer(projectsRoot);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${url}/studio/new`, { waitUntil: "networkidle" });
    await page.locator("#new-project-form textarea[name=intent]").fill("Unsaved intent");
    await page.locator('.detail-back[data-route="/studio"]').click();
    await page.locator(".confirm-dialog").waitFor();
    assert.match(page.url(), /\/studio\/new$/);
    await page.keyboard.press("Escape");
    await page.locator(".confirm-dialog").waitFor({ state: "detached" });
    assert.match(page.url(), /\/studio\/new$/);
    const unload = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return { prevented: event.defaultPrevented, returnValue: event.returnValue };
    });
    assert.equal(unload.prevented, true);
    assert.ok(unload.returnValue === "" || unload.returnValue === false);
    await page.locator('.detail-back[data-route="/studio"]').click();
    await page.locator(".confirm-dialog").getByRole("button", { name: "放弃并离开" }).click();
    await page.locator("#workspace-view .page-heading").waitFor();
    assert.match(page.url(), /\/studio$/);
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => undefined);
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("run drawer and task review dialog manage focus, Escape, and keyboard errors", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-interaction-modal-"));
  const { server, url } = await startServer(projectsRoot);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      const { openDrawer } = await import("/app/views/app.js");
      const trigger = document.createElement("button");
      trigger.id = "drawer-test-trigger";
      trigger.textContent = "open";
      document.body.append(trigger);
      trigger.focus();
      openDrawer(trigger);
    });
    await page.locator("#run-drawer.open").waitFor({ timeout: 30000 });
    assert.equal(await page.locator("#run-drawer .drawer-panel").evaluate((panel) => panel.contains(document.activeElement)), true);
    await page.keyboard.press("Tab");
    assert.equal(await page.locator("#run-drawer .drawer-panel").evaluate((panel) => panel.contains(document.activeElement)), true);
    await page.keyboard.press("Escape");
    await page.locator("#run-drawer.open").waitFor({ state: "detached" }).catch(async () => {
      await page.locator("#run-drawer.open").waitFor({ state: "hidden" });
    });
    assert.equal(await page.evaluate(() => document.activeElement?.id), "drawer-test-trigger");
    const team = await page.request.post(`${url}/api/v1/team-factory`, { data: { name: "Review UI Team", intent: "Review UI test", locale: "zh-CN" } }).then((response) => response.json());
    await page.request.post(`${url}/api/v1/team-versions/${encodeURIComponent(team.projectId)}/release`);
    const project = await page.request.post(`${url}/api/v1/projects`, { data: { name: "Review UI Project", workspaceKey: "review-ui", teamVersionIds: [team.projectId] } }).then((response) => response.json());
    const task = await page.request.post(`${url}/api/v1/projects/${project.projectId}/tasks`, { data: { input: "Review focus", teamVersionId: team.projectId, idempotencyKey: "review-focus" } }).then((response) => response.json());
    await page.request.post(`${url}/api/v1/projects/${project.projectId}/tasks/${task.taskId}/start`, { data: { mode: "dry-run" } });
    await page.request.post(`${url}/api/v1/projects/${project.projectId}/tasks/${task.taskId}/pause`, { data: {} });
    await page.goto(`${url}/studio/project/${project.projectId}/run`, { waitUntil: "networkidle" });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await page.locator("#collaboration-task-form textarea[name=input]").fill("Abort this task mutation");
    let taskMutationStarted;
    const taskMutationRequest = new Promise((resolveRequest) => { taskMutationStarted = resolveRequest; });
    let releaseTaskMutation;
    const delayedTaskMutation = new Promise((resolveResponse) => { releaseTaskMutation = resolveResponse; });
    await page.route(`**/api/v1/projects/${project.projectId}/tasks`, async (route) => {
      taskMutationStarted();
      await delayedTaskMutation;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ taskId: "aborted-task", status: "queued" }) });
    });
    await page.locator("#collaboration-task-form button[type=submit]").click();
    await taskMutationRequest;
    await page.locator('a[data-route="/projects"]').first().click();
    await page.locator(".confirm-dialog").getByRole("button", { name: "放弃并离开" }).click();
    await page.locator("#projects-view .page-heading").waitFor();
    releaseTaskMutation();
    await page.waitForTimeout(100);
    assert.deepEqual(pageErrors, [], "aborted task mutation must not create an unhandled rejection");

    await page.goto(`${url}/studio/project/${project.projectId}/run`, { waitUntil: "networkidle" });
    const reviewButton = page.locator('[data-task-action="review"]').first();
    await reviewButton.waitFor();
    await reviewButton.focus();
    await page.evaluate(async ({ projectId, taskId }) => {
      const { openTaskReview } = await import("/app/views/app.js");
      await openTaskReview(projectId, taskId);
    }, { projectId: project.projectId, taskId: task.taskId });
    await page.locator(".task-review-dialog[open]").waitFor();
    assert.equal(await page.locator(".task-review-dialog").evaluate((dialog) => dialog.contains(document.activeElement)), true);
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(".task-review-dialog").evaluate((dialog) => dialog.contains(document.activeElement)), true);
    await page.goBack();
    await page.locator("#projects-view .page-heading").waitFor();
    assert.equal(await page.locator(".task-review-dialog").count(), 0, "route changes must close review dialogs");
    assert.equal(await page.locator("body").evaluate((body) => body.classList.contains("modal-open")), false, "route changes must release modal scroll lock");

    await page.goto(`${url}/studio/project/${project.projectId}/run`, { waitUntil: "networkidle" });
    const reopenedReviewButton = page.locator('[data-task-action="review"]').first();
    await reopenedReviewButton.waitFor();
    await reopenedReviewButton.focus();
    await page.evaluate(async ({ projectId, taskId }) => {
      const { openTaskReview } = await import("/app/views/app.js");
      await openTaskReview(projectId, taskId);
    }, { projectId: project.projectId, taskId: task.taskId });
    await page.locator(".task-review-dialog[open]").waitFor();
    await page.locator(".task-review-dialog select").selectOption("approve");
    await page.locator(".task-review-dialog textarea").fill("error operation area");
    let reviewHit = false;
    await page.route(`**/api/v1/projects/${project.projectId}/tasks/${task.taskId}/review`, async (route) => { reviewHit = true; await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "review rejected" }) }); });
    await page.locator('.task-review-dialog button[value="submit"]').click();
    await page.locator("#task-review-status").waitFor();
    assert.equal(reviewHit, true);
    await page.waitForFunction(() => document.querySelector("#task-review-status")?.textContent === "review rejected");
    assert.equal(await page.locator("#task-review-status").innerText(), "review rejected");
    await page.keyboard.press("Escape");
    await page.locator(".task-review-dialog").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.taskAction), "review");
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => undefined);
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
