import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
import { reserveBrowserSafePort } from "./browser-safe-port.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("Project Task registers, removes, and submits authorized input Artifact references", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-ir-task-artifacts-"));
  const port = await reserveBrowserSafePort();
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: String(port), OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  let browser;
  try {
    const startedAt = Date.now();
    let readyUrl;
    while (!readyUrl && Date.now() - startedAt < 10000) {
      readyUrl = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (!readyUrl) await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    assert.ok(readyUrl, `Team Site did not start: ${output}`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const requests = [];
    const project = {
      projectType: "collaboration",
      projectId: "project-artifacts",
      name: "Artifact Project",
      overview: "",
      mountedTeams: [{ teamId: "team-1", teamVersionId: "version-1", teamName: "Artifact Team", teamVersionNumber: 1, status: "released" }],
      taskCapacity: { capacity: 1, used: 0, available: 1, activeTasks: [] },
      taskRecords: [],
      materials: { materials: [] }
    };
    const artifactRegistration = [];
    const taskSubmissions = [];
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      let body = {};
      let status = 200;
      if (request.method() === "POST" && request.postData()) body = JSON.parse(request.postData());
      requests.push({ method: request.method(), path: url.pathname, body });
      if (request.method() === "GET" && url.pathname === "/api/v1/projects/project-artifacts") body = project;
      else if (request.method() === "GET" && url.pathname === "/api/v1/projects/project-artifacts/readiness") body = { canDryRun: true, blockers: [], warnings: [], teams: [] };
      else if (request.method() === "GET" && url.pathname === "/api/v1/projects/project-artifacts/deliverables") body = { deliverables: [] };
      else if (request.method() === "GET" && url.pathname === "/api/v1/projects/project-artifacts/artifacts/run-input-slots") {
        assert.equal(url.searchParams.get("teamVersionId"), "version-1");
        body = { slots: [
          { slotId: "brief", cardinality: "single", required: true },
          { slotId: "reference", cardinality: "single", required: false }
        ] };
      } else if (request.method() === "POST" && url.pathname === "/api/v1/projects/project-artifacts/artifacts/run-input") {
        artifactRegistration.push(body);
        body = { artifactId: "artifact-brief-1", mediaType: body.mediaType };
        status = 201;
      } else if (request.method() === "POST" && url.pathname === "/api/v1/projects/project-artifacts/tasks") {
        taskSubmissions.push(body);
        project.taskRecords = [{ taskId: "task-1", taskNumber: 1, teamId: "team-1", teamVersionId: "version-1", teamName: "Artifact Team", input: body.input, status: "queued", createdAt: "2026-10-30T00:00:00.000Z" }];
        body = { taskId: "task-1" };
        status = 201;
      }
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(`${readyUrl}/projects/project-artifacts`, { waitUntil: "networkidle" });
    await page.locator("[data-open-task-dialog]").click();
    const artifactSlot = page.locator("[data-task-artifact-slot]");
    await page.waitForFunction(() => [...document.querySelector("[data-task-artifact-slot]")?.options || []].some((option) => option.value === "brief"));
    assert.match(await artifactSlot.innerText(), /brief.*必填/);

    await page.locator('#collaboration-task-form textarea[name="input"]').fill("Review the attached brief.");
    await page.locator('#collaboration-task-form button[type="submit"]').click();
    await page.locator("#collaboration-task-status").getByText("brief").waitFor();
    assert.equal(taskSubmissions.length, 0, "required Artifact slots block task creation before registration");

    await page.locator("[data-task-artifact-file]").setInputFiles({
      name: "brief.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("The approved project brief.")
    });
    await page.locator("[data-task-add-artifact]").click();
    await page.locator("[data-task-artifact-status]").getByText("已登记").waitFor();
    assert.equal(artifactRegistration.length, 1);
    assert.equal(artifactRegistration[0].teamVersionId, "version-1");
    assert.equal(artifactRegistration[0].slotId, "brief");
    assert.equal(artifactRegistration[0].mediaType, "text/markdown");
    assert.equal(Buffer.from(artifactRegistration[0].contentBase64, "base64").toString(), "The approved project brief.");
    assert.match(await page.locator("[data-task-artifact-list]").innerText(), /brief.*brief\.md/);

    await page.locator('[data-remove-task-artifact="brief"]').click();
    assert.equal(await page.locator("[data-task-artifact-list] .material-row").count(), 0);
    await page.locator('#collaboration-task-form button[type="submit"]').click();
    await page.locator("#collaboration-task-status").getByText("brief").waitFor();
    assert.equal(taskSubmissions.length, 0, "removing the required Artifact returns the form to blocked state");

    await page.locator("[data-task-artifact-file]").setInputFiles({
      name: "brief.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("The approved project brief.")
    });
    await page.locator("[data-task-add-artifact]").click();
    await page.locator("[data-task-artifact-list] .material-row").waitFor();
    await page.locator('#collaboration-task-form button[type="submit"]').click();
    await page.locator('[data-task-record="task-1"]').waitFor();
    assert.equal(taskSubmissions.length, 1);
    assert.deepEqual(taskSubmissions[0].attachments, {
      brief: { artifactId: "artifact-brief-1", mediaType: "text/markdown" }
    });
    assert.deepEqual(pageErrors, []);
    assert.equal(requests.filter((item) => item.path.endsWith("/artifacts/run-input-slots")).length, 1);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
    await new Promise((resolveWait) => server.once("exit", resolveWait));
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
