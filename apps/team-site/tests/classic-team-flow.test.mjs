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

test("classic teams separate direct use from template editing and keep the graph visible", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-classic-projects-"));
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot },
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
      const match = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) url = match[1];
      else await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    assert.ok(url, "site server did not start: " + output);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    await page.goto(url + "/cases/software-team", { waitUntil: "networkidle" });
    await page.locator("#detail-graph-stage").waitFor();
    await page.locator("[data-case-action=template]").click();
    await page.waitForURL(/\/studio\/team\/[a-z0-9-]+$/);
    await page.locator("#project-graph-stage").waitFor();
    assert.equal((await (await page.locator(".project-status").first()).innerText()).includes("草案"), true);

    await page.goto(url + "/cases/software-team", { waitUntil: "networkidle" });
    await page.locator("#detail-graph-stage").waitFor();
    await page.locator("[data-case-action=use]").click();
    await page.waitForURL(/\/studio\/project\/new\?team=[a-z0-9-]+$/);
    await page.locator("#collaboration-project-form").waitFor();
    const teamId = new URL(page.url()).searchParams.get("team");
    await page.locator("#collaboration-project-form input[name=name]").fill("Software delivery project");
    await page.locator(`#project-team-options input[value="${teamId}"]`).check();
    await page.locator("#collaboration-project-form button[type=submit]").click();
    await page.waitForURL(/\/studio\/project\/[a-z0-9-]+\/run$/);
    await page.locator("#collaboration-task-form").waitFor();
    assert.equal(await page.locator(".task-list-panel").count(), 1);

    const localizedResponse = await page.request.post(url + "/api/v1/cases/software-team/use", {
      data: { locale: "en" }
    });
    assert.equal(localizedResponse.ok(), true);
    const localizedProject = await localizedResponse.json();
    assert.equal(localizedProject.name, "Software delivery");
    const localizedGraphResponse = await page.request.get(url + "/api/v1/projects/" + encodeURIComponent(localizedProject.projectId) + "/team/design?locale=en");
    assert.equal(localizedGraphResponse.ok(), true);
    const localizedGraph = await localizedGraphResponse.json();
    assert.equal(localizedGraph.viewModel.nodes.find((node) => node.id === "delivery-coordinator")?.label, "Product lead");
  } finally {
    await browser?.close();
    server.kill();
    await once(server, "exit").catch(() => undefined);
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
