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

test("Project Task start and retry use Team IR v2 readiness and block when it fails", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-ir-task-readiness-"));
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
      projectId: "project-1",
      name: "Readiness Project",
      overview: "",
      mountedTeams: [{ teamId: "team-1", teamVersionId: "version-1", teamName: "V2 Team", teamVersionNumber: 1, status: "released" }],
      taskCapacity: { capacity: 1, used: 0, available: 1, activeTasks: [] },
      taskRecords: [
        { taskId: "queued-task", taskNumber: 1, teamId: "team-1", teamVersionId: "version-1", teamName: "V2 Team", input: "Start this task", status: "queued", createdAt: "2026-10-29T00:00:00.000Z" },
        { taskId: "failed-task", taskNumber: 2, teamId: "team-1", teamVersionId: "version-1", teamName: "V2 Team", input: "Retry this task", status: "failed", currentRunId: "run-1", runIds: ["run-1"], createdAt: "2026-10-29T00:00:00.000Z" }
      ],
      materials: { materials: [] }
    };
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      requests.push({ method: request.method(), path: url.pathname });
      let body = {};
      if (request.method() === "GET" && url.pathname === "/api/v1/projects/project-1") body = project;
      else if (request.method() === "GET" && url.pathname === "/api/v1/projects/project-1/readiness") body = { canDryRun: false, blockers: [], warnings: [], teams: [] };
      else if (request.method() === "GET" && url.pathname === "/api/v1/projects/project-1/deliverables") body = { deliverables: [] };
      else if (request.method() === "GET" && url.pathname === "/api/v1/teams/team-1/versions/version-1/readiness") {
        body = { canDryRun: false, blockers: [{ code: "TEAM_IR_V2_RESOLVER_UNAVAILABLE", message: "Resolver unavailable for this TeamVersion." }] };
      } else if (url.pathname.includes("/team-versions/") && url.pathname.endsWith("/design")) {
        body = { error: "TEAM_IR_V2_REQUIRED" };
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify(body) });
        return;
      } else if (request.method() === "GET" && url.pathname.includes("/runs/")) body = { events: [] };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });

    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${readyUrl}/projects/project-1`, { waitUntil: "networkidle" });
    await page.locator('[data-task-record="queued-task"] [data-task-action="start"]').click();
    await page.locator('[data-task-record="queued-task"] .task-action-status').getByText("Resolver unavailable for this TeamVersion.").waitFor();
    await page.locator('[data-task-record="failed-task"] [data-task-action="retry"]').click();
    await page.locator('[data-task-record="failed-task"] .task-action-status').getByText("Resolver unavailable for this TeamVersion.").waitFor();

    assert.equal(requests.filter((item) => item.path.endsWith("/design")).length, 0, "Team Task actions must not read legacy design");
    assert.equal(requests.filter((item) => item.path === "/api/v1/teams/team-1/versions/version-1/readiness").length, 2);
    assert.equal(requests.filter((item) => /\/tasks\/(queued-task|failed-task)(?:\/retry)?$/.test(item.path) && item.method === "POST").length, 0,
      "blocked readiness must prevent both start and retry requests");
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
    await new Promise((resolveWait) => server.once("exit", resolveWait));
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
