import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
import { seedReleasedClassicTeam } from "./classic-team-fixtures.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function startServer(projectsRoot) {
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot },
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
    await page.locator("#new-project-form textarea[name=overview]").fill("Unsaved intent");
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
    await page.locator("#studio-view .repository-heading").waitFor();
    assert.match(page.url(), /\/studio$/);
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => undefined);
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("Team IR v2 task review focuses the current Run checkpoint", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-interaction-modal-"));
  await seedReleasedClassicTeam(projectsRoot);
  const { server, url } = await startServer(projectsRoot);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${url}/teams`, { waitUntil: "networkidle" });
    const team = await page.request.post(`${url}/api/v1/cases/software-team/use`, { data: { locale: "zh-CN" } }).then((response) => response.json());
    const project = await page.request.post(`${url}/api/v1/projects`, { data: { name: "Review UI Project", workspaceKey: "review-ui", teamVersionIds: [team.projectId] } }).then((response) => response.json());
    const task = await page.request.post(`${url}/api/v1/projects/${project.projectId}/tasks`, { data: { input: "Review focus", teamVersionId: team.projectId, idempotencyKey: "review-focus" } }).then((response) => response.json());
    const cancelTask = await page.request.post(`${url}/api/v1/projects/${project.projectId}/tasks`, { data: { input: "Cancel focus", teamVersionId: team.projectId, idempotencyKey: "cancel-focus" } }).then((response) => response.json());
    const cancelResponse = await page.request.post(`${url}/api/v1/projects/${project.projectId}/tasks/${cancelTask.taskId}/cancel`, { data: {} });
    assert.equal(cancelResponse.status(), 200);
    assert.equal((await cancelResponse.json()).status, "cancelled");
    const projectMetaPath = join(projectsRoot, project.projectId, ".site", "project.json");
    const projectMeta = JSON.parse(await readFile(projectMetaPath, "utf8"));
    projectMeta.taskRecords = projectMeta.taskRecords.map((record) => record.taskId === task.taskId
      ? { ...record, status: "waiting_review", currentRunId: "run-review-context", runIds: ["run-review-context"] }
      : record);
    await writeFile(projectMetaPath, `${JSON.stringify(projectMeta, null, 2)}\n`, "utf8");
    let v2ReviewStatus = "pending";
    const v2ReviewRequests = [];
    let legacyReviewCalls = 0;
    await page.route(`**/api/v1/projects/${project.projectId}/tasks/${task.taskId}/runs/run-review-context`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        runKind: "project_task", runId: "run-review-context", owner: { teamIrSemanticDigest: "f".repeat(64) },
        state: { status: "waiting_human_review", waitingReview: { reviewId: "review-draft", lineage: "run" } },
        plan: { engine: "team-ir-v2", team: { orchestration: { reviews: [{ id: "review-draft" }] } } }
      }) });
    });
    await page.route(`**/api/v1/projects/${project.projectId}/tasks/${task.taskId}/runs/run-review-context/team-ir-reviews/review-draft`, async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          reviewId: "review-draft", status: v2ReviewStatus, revision: 4, revisionToken: "revision-token-4",
          activatedAt: "2026-10-29T00:00:00.000Z", deadlineAt: "2026-10-29T01:00:00.000Z"
        }) });
      }
      const payload = request.postDataJSON();
      v2ReviewRequests.push(payload);
      if (v2ReviewRequests.length === 1) {
        v2ReviewStatus = "rejected";
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "resume dispatch response was lost" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "rejected", decision: "reject", revision: 5 }) });
    });
    await page.route(`**/api/v1/projects/${project.projectId}/tasks/${task.taskId}/review`, async (route) => {
      legacyReviewCalls += 1;
      await route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ error: "legacy review endpoint must not be used" }) });
    });
    await page.goto(`${url}/projects/${project.projectId}`, { waitUntil: "networkidle" });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await page.locator("[data-open-task-dialog]").click();
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
    await page.keyboard.press("Escape");
    await page.locator("#collaboration-task-dialog[open]").waitFor({ state: "hidden" });
    await page.locator('.app-shell a[data-route="/projects"]:visible').first().click();
    await page.locator(".confirm-dialog").getByRole("button", { name: "放弃并离开" }).click();
    await page.locator("#projects-view .page-heading").waitFor();
    releaseTaskMutation();
    await page.waitForTimeout(100);
    assert.deepEqual(pageErrors, [], "aborted task mutation must not create an unhandled rejection");

    await page.goto(`${url}/projects/${project.projectId}`, { waitUntil: "networkidle" });
    const reviewButton = page.locator('[data-task-action="review"]').first();
    await reviewButton.waitFor();
    await reviewButton.click();
    const reviewPanel = page.locator("[data-team-ir-run-reviews]");
    await reviewPanel.waitFor();
    assert.equal(await reviewPanel.evaluate((panel) => panel.contains(document.activeElement)), true, "the current v2 Review panel receives focus");
    assert.equal(await reviewPanel.locator('form[data-review-id="review-draft"]').count(), 1, "the Run checkpoint's waitingReview is the displayed request");
    assert.equal(await page.locator(".task-review-dialog[open]").count(), 0, "v2 reviews do not open the legacy modal");
    assert.equal(await page.locator('[data-team-ir-review="0"] [name=decision]').inputValue(), "approve");
    await page.locator('[data-team-ir-review="0"] [name=decision]').selectOption("reject");
    await page.locator('[data-team-ir-review="0"] [name=feedback]').fill('{"comments":"Please revise the evidence."}');
    await page.locator('[data-team-ir-review="0"] button[type=submit]').click();
    await page.locator('[data-team-ir-review="0"] [data-review-status]').getByText(/resume dispatch response was lost/).waitFor();
    await page.locator('[data-team-ir-review="0"] button[type=submit]').click();
    await page.locator("[data-team-ir-run-reviews]").waitFor({ state: "detached" });
    assert.equal(legacyReviewCalls, 0, "the legacy Project Review API must never be called");
    assert.equal(v2ReviewRequests.length, 2);
    assert.deepEqual(v2ReviewRequests[0].decision, "reject");
    assert.deepEqual(v2ReviewRequests[0].feedback, { comments: "Please revise the evidence." });
    assert.equal(v2ReviewRequests[0].revisionToken, "revision-token-4");
    assert.match(v2ReviewRequests[0].idempotencyKey, /^[0-9a-f-]{36}$/i);
    assert.equal(v2ReviewRequests[1].idempotencyKey, v2ReviewRequests[0].idempotencyKey, "retry reuses the v2 idempotency key");
    assert.equal(Object.hasOwn(v2ReviewRequests[0], "reviewerId"), false);
    assert.equal(Object.hasOwn(v2ReviewRequests[0], "comment"), false);

    const lifecycleTasks = [];
    for (const action of ["cancel"]) {
      const response = await page.request.post(`${url}/api/v1/projects/${project.projectId}/tasks`, {
        data: { input: `UI lifecycle ${action}`, teamVersionId: team.projectId, idempotencyKey: `ui-lifecycle-${action}` }
      });
      const task = await response.json();
      assert.equal(response.status(), 201, task.error || "Task creation should succeed.");
      lifecycleTasks.push({ action, task });
    }
    await page.goto(`${url}/projects/${project.projectId}`, { waitUntil: "networkidle" });

    const queuedCancelId = lifecycleTasks.find((item) => item.action === "cancel").task.taskId;
    const queuedCancelRow = page.locator(`.task-record-row:has([data-task-id="${queuedCancelId}"])`);
    await queuedCancelRow.locator('[data-task-action="cancel"]').click();
    await page.waitForFunction((taskId) => {
      const row = [...document.querySelectorAll(".task-record-row")].find((item) => item.querySelector(`[data-task-id="${taskId}"]`));
      return row?.querySelector(".status-chip")?.classList.contains("cancelled");
    }, queuedCancelId);
    assert.equal((await page.request.get(`${url}/api/v1/projects/${project.projectId}`).then((result) => result.json())).taskRecords.find((item) => item.taskId === queuedCancelId).status, "cancelled");
    assert.equal(await queuedCancelRow.locator('[data-task-action="start"]').count(), 0, "cancelled Tasks must not offer start");
    assert.equal(await queuedCancelRow.locator('[data-task-action="cancel"]').count(), 0, "cancelled Tasks must not offer cancel");
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => undefined);
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
