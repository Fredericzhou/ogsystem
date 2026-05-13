import { test, expect } from "@playwright/test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { startVisualizationServer } from "../dist/visualizer/server.js";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function seedProject(workdir: string): Promise<void> {
  const repoRoot = process.cwd();
  await mkdir(path.resolve(workdir, ".ogs"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-roles"), path.resolve(workdir, "og-roles"), "dir");
  for (const file of [
    "runtime.json",
    "model-selection.json",
    "model-catalog.json",
    "laws.json",
    "user-profile.json"
  ]) {
    await symlink(path.resolve(repoRoot, ".ogs", file), path.resolve(workdir, ".ogs", file));
  }
  await writeFile(
    path.resolve(workdir, ".ogs", "project.json"),
    JSON.stringify({ projectId: "viz.studio.graph", createdAt: "2026-04-30T00:00:00.000Z" }, null, 2),
    "utf8"
  );
  await writeFile(
    path.resolve(workdir, "profiles.json"),
    JSON.stringify([{ profileId: "profile.review", toolRef: "tool.review" }], null, 2),
    "utf8"
  );
  await writeFile(
    path.resolve(workdir, "tools.json"),
    JSON.stringify({ tools: [{ toolRef: "tool.review", runner: "local_shell", command: "echo", argsTemplate: [], stdinMode: "none" }] }, null, 2),
    "utf8"
  );
  await writeFile(
    path.resolve(workdir, "system.mmd"),
    [
      "flowchart TD",
      "%% system.id=viz.studio.graph",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=demo-analyst",
      "%% model.bind.demo-analyst=opencode/gpt-5.4",
      "input -->|ENTER| analyst[Role:demo-analyst]",
      "analyst[Role:demo-analyst] -->|DONE| output",
      ""
    ].join("\n"),
    "utf8"
  );
}

async function dragStudioPort(page, sourceRoleId: string, targetRoleId: string): Promise<void> {
  const sourcePort = page.locator(
    `#studio-graph-root [data-cell-id="${sourceRoleId}"] [data-studio-port="out"]`
  ).first();
  const targetPort = page.locator(
    `#studio-graph-root [data-cell-id="${targetRoleId}"] [data-studio-port="in"]`
  ).first();
  await expect(sourcePort).toBeVisible();
  await expect(targetPort).toBeVisible();
  await sourcePort.scrollIntoViewIfNeeded();
  await targetPort.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const sourceBox = await sourcePort.boundingBox();
  const targetBox = await targetPort.boundingBox();
  expect(sourceBox).toBeTruthy();
  expect(targetBox).toBeTruthy();
  if (!sourceBox || !targetBox) return;
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function waitForStudioCell(page, cellId: string): Promise<void> {
  await expect(page.locator(`#studio-graph-root [data-cell-id="${cellId}"]`).first()).toBeVisible({ timeout: 10000 });
}

async function expectStudioCellPulse(page, cellId: string): Promise<void> {
  await expect.poll(async () => page.evaluate((targetCellId) => {
    const cell = document.querySelector(`[data-cell-id="${targetCellId}"]`);
    return cell?.classList.contains("is-selection-focus-pulse") ?? false;
  }, cellId), { timeout: 3000 }).toBe(true);
}

async function resolveLifecycleTabName(page, names: string[]): Promise<string> {
  for (const name of names) {
    if (await page.getByRole("tab", { name }).count()) {
      return name;
    }
  }
  throw new Error(`No lifecycle tab found for: ${names.join(", ")}`);
}

async function expectDockedSelectionAligned(page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const root = document.getElementById("studio-graph-root");
    const dialog = document.querySelector(".studio-selection-overlay .studio-selection-dialog");
    if (!root || !dialog) {
      return false;
    }
    const rootBox = root.getBoundingClientRect();
    const dialogBox = dialog.getBoundingClientRect();
    const topDelta = Math.abs(Math.round(rootBox.top - dialogBox.top));
    const bottomDelta = Math.abs(Math.round(rootBox.bottom - dialogBox.bottom));
    return topDelta <= 8 && bottomDelta <= 8 && dialogBox.left >= rootBox.right - 1;
  })).toBe(true);
}

test("Studio Bridge renders and edits through the real graph workspace", async ({ page }) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-studio-x6-"));
  await seedProject(workdir);
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  test.info().annotations.push({ type: "server", description: started.url });
  try {
    await page.goto(started.url);
    await page.waitForFunction(() => Boolean((window as any).OGSVisualizerClient?.mountStudioX6Bridge));
    const designTabName = await resolveLifecycleTabName(page, ["Build", "Design"]);
    const releaseTabName = await resolveLifecycleTabName(page, ["Validate & Release", "Release"]);
    const runTabName = await resolveLifecycleTabName(page, ["Operate", "Run"]);
    await expect(page.locator("#console-panel-project")).toBeVisible();
    await expect(page.locator("#console-panel-project > article > header").getByRole("heading", { name: "Project Overview" })).toBeVisible();
    await expect(page.locator("body")).not.toHaveClass(/show-run-sidebar/);
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.locator("#sidebar-toggle")).toBeHidden();
    await page.evaluate(() => {
      const client = (window as any).OGSVisualizerClient;
      const original = client.mountStudioX6Bridge;
      (window as any).__studioMountCalls = 0;
      client.mountStudioX6Bridge = function patchedMountStudioX6Bridge(root: HTMLElement, options: unknown) {
        (window as any).__studioMountCalls += 1;
        return original.call(this, root, options);
      };
    });
    await page.getByRole("tab", { name: designTabName }).click();
    await expect(page.locator("#workbench-status")).toContainText("validation ok");
    const globalStatusBar = page.locator("footer.status-bar.global-status");
    const workbenchViewSlot = globalStatusBar.locator("#global-status-context");
    const bridgeViewButton = workbenchViewSlot.locator('[data-workbench-view="bridge"]');
    const sourceViewButton = workbenchViewSlot.locator('[data-workbench-view="source"]');
    await expect(globalStatusBar).toBeVisible();
    await expect(workbenchViewSlot).toBeVisible();
    await expect(bridgeViewButton).toBeVisible();
    await expect(sourceViewButton).toBeVisible();
    await bridgeViewButton.click();

    await expect(page.locator("body")).not.toHaveClass(/show-run-sidebar/);
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.locator("#sidebar-toggle")).toBeHidden();
    await expect.poll(async () => page.evaluate(() => {
      const app = document.querySelector(".app");
      const sidebar = document.getElementById("sidebar");
      const content = document.querySelector(".shell.content");
      if (!app || !sidebar || !content) return null;
      return {
        appColumnCount: getComputedStyle(app).gridTemplateColumns.split(" ").filter(Boolean).length,
        sidebarDisplay: getComputedStyle(sidebar).display,
        contentLeft: Math.round(content.getBoundingClientRect().left)
      };
    })).toEqual({
      appColumnCount: 1,
      sidebarDisplay: "none",
      contentLeft: 0
    });
    await expect(page.locator("#studio-graph-root")).toBeVisible();
    await waitForStudioCell(page, "demo-analyst");
    await expectDockedSelectionAligned(page);
    await expect(page.getByText(/\bX6\b/)).toHaveCount(0);
    await expect(page.locator('#studio-graph-root .studio-graph-toolbar')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="reset-view"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="fullscreen"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="edit"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="chat-generate"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="validate"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="save"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-minimap]')).toBeVisible();
    await expect(page.locator("#studio-bridge-generate")).toHaveCount(0);
    await expect(page.locator("[data-studio-bridge-fullscreen]")).toHaveCount(0);
    await expect(page.locator("#studio-bridge-save")).toHaveCount(0);
    await expect(page.locator("#build-generate-mermaid")).toHaveCount(0);
    await expect(page.locator("#build-validate")).toHaveCount(0);
    await expect(page.locator("#build-save")).toHaveCount(0);
    await expect(page.locator("#build-dry-run")).toHaveCount(0);
    const debugPanel = page.locator('[data-studio-selection-panel="debug"]');
    await expect(page.locator('[data-studio-side-tab="debug"]')).toBeVisible();
    await page.locator('[data-studio-side-tab="debug"]').click();
    await expect(debugPanel).toBeVisible();
    await expect(debugPanel.locator("#workbench-run-input")).toBeVisible();
    await expect(debugPanel.locator("#workbench-run-runtime-path")).toBeHidden();
    await debugPanel.locator("summary").click();
    await expect(debugPanel.locator("#workbench-run-runtime-path")).toBeVisible();
    await expect(debugPanel.locator("#workbench-run-user-profile-path")).toBeVisible();
    await expect(debugPanel.locator("#workbench-run-laws-path")).toBeVisible();
    await expect(debugPanel).toContainText(/Select an exec role|请选择一个 exec 角色/);
    await expectDockedSelectionAligned(page);
    await sourceViewButton.click();
    await expect(page.locator("#workbench-editor")).toBeVisible();
    await expect(page.locator("#workbench-editor")).toContainText("demo-analyst");
    await bridgeViewButton.click();
    await waitForStudioCell(page, "demo-analyst");
    await page.locator('#studio-graph-root [data-studio-graph-action="fullscreen"]').click();
    await expect(page.locator("[data-studio-canvas-shell]")).toHaveClass(/is-fullscreen/);
    await waitForStudioCell(page, "demo-analyst");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-studio-canvas-shell]")).not.toHaveClass(/is-fullscreen/);
    await expect(page.getByRole("tab", { name: designTabName })).toBeVisible();
    await expect(page.getByRole("tab", { name: releaseTabName })).toBeVisible();
    await expect(page.locator("#console-panel-build")).toBeVisible();
    await expect(page.locator("#build-project-summary")).toHaveCount(0);
    await expect(page.locator("#console-panel-build").getByRole("heading", { name: "Project Overview" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Project Readiness" })).toHaveCount(0);
    await expect(page.locator("#action-form-section")).toBeHidden();
    await page.getByRole("tab", { name: releaseTabName }).click();
    await expect(page.locator("#release-gate")).toContainText("Release gate");
    await expect(page.locator("#release-gate")).toContainText("Quality signals");
    await expect(page.locator("#release-gate")).toContainText("Evidence and export scope");
    await page.getByRole("tab", { name: designTabName }).click();
    await expect(page.locator("#studio-graph-root")).toBeVisible();
    await expect(page.locator("[data-studio-selection-dialog]")).toContainText(/Browse|检索/);
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="validate"]')).toBeVisible();
    await expect(page.locator(".toolbar-group").filter({ hasText: "validation ok" }).first()).toBeVisible();

    const addRoleButton = page.locator('#studio-graph-root [data-studio-graph-action="add-role"]');
    await expect(addRoleButton).toBeEnabled();
    await addRoleButton.click();
    const addRoleForm = page.locator('form[data-studio-command-form="add-role"]');
    await expect(addRoleForm).toBeVisible();
    await addRoleForm.locator('input[name="mode"][value="custom"]').check();
    await addRoleForm.locator('input[name="roleId"]').fill("new-role");
    await addRoleForm.locator('input[name="title"]').fill("需求分析");
    await addRoleForm.locator('button[type="submit"]').click();
    await expect(page.locator("#studio-graph-root")).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-cell-id="new-role"]').first()).toBeVisible();
    await expect(page.locator("#studio-graph-root")).toContainText("需求分析");
    await page.locator('#studio-graph-root [data-studio-graph-action="add-edge"]').click();
    const addEdgeForm = page.locator('form[data-studio-command-form="add-edge"]');
    await expect(addEdgeForm).toBeVisible();
    await expect(addEdgeForm.locator('select[name="sourceRoleId"]')).toHaveValue("new-role");
    await expect(addEdgeForm.locator('select[name="targetRoleId"]')).toHaveValue("__system_end__");
    await addEdgeForm.locator('input[name="label"]').fill("需求已完成");
    await addEdgeForm.locator('input[name="eventType"]').fill("DONE");
    await addEdgeForm.locator('button[type="submit"]').click();
    await expect(page.locator("#studio-graph-root")).toBeVisible();
    await waitForStudioCell(page, "new-role");
    await expect(page.locator("#studio-graph-root")).toContainText("需求已完成");
    await page.locator('#studio-graph-root [data-studio-graph-action="undo"]').click();
    await expect(page.locator('#studio-graph-root [data-cell-id="new-role"]')).toBeVisible();

    await page.route("**/api/v1/project/studio/chat", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        await route.fallback();
        return;
      }
      const body = request.postDataJSON();
      const nextAuthoring = cloneJson(body.authoring);
      nextAuthoring.roles = {
        ...(nextAuthoring.roles || {}),
        "qa-reviewer": {
          roleId: "qa-reviewer",
          title: "QA Reviewer",
          bindingKind: "profile",
          profileRef: "profile.review"
        }
      };
      nextAuthoring.flows = {
        ...(nextAuthoring.flows || {}),
        "2:demo-analyst:REVIEW:qa-reviewer": {
          flowId: "2:demo-analyst:REVIEW:qa-reviewer",
          fromRoleId: "demo-analyst",
          toRoleId: "qa-reviewer",
          eventType: "REVIEW",
          label: "进入复核"
        }
      };
      nextAuthoring.layout = {
        ...(nextAuthoring.layout || {}),
        nodes: {
          ...(nextAuthoring.layout?.nodes || {}),
          "qa-reviewer": { x: 380, y: 120, width: 180, height: 84 }
        }
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          mode: "draft",
          sessionId: "studio-chat-browser",
          summary: "Generated review draft.",
          questions: [],
          assumptions: [],
          warnings: [],
          previewMermaid: [
            "flowchart TD",
            "%% system.id=viz.studio.graph",
            "%% system.version=1.0.0",
            "%% law.global=law.minimal.base",
            "%% entry.role=demo-analyst",
            "%% model.bind.demo-analyst=opencode/gpt-5.4",
            "input -->|ENTER| analyst[Role:demo-analyst]",
            "analyst[Role:demo-analyst] -->|REVIEW| reviewer[Role:qa-reviewer]",
            "reviewer[Role:qa-reviewer] -->|DONE| output",
            ""
          ].join("\n"),
          validation: { project: { ok: true, diagnostics: [] } },
          authoringPatch: {
            type: "replace-authoring",
            source: "nl2mmd",
            authoring: nextAuthoring,
            canvas: {
              version: 1,
              nodes: [
                { id: "demo-analyst", roleId: "demo-analyst", x: 120, y: 120, width: 180, height: 84 },
                { id: "qa-reviewer", roleId: "qa-reviewer", x: 380, y: 120, width: 180, height: 84 }
              ],
              edges: [
                {
                  id: "2:demo-analyst:REVIEW:qa-reviewer",
                  source: "demo-analyst",
                  target: "qa-reviewer",
                  label: "进入复核",
                  eventType: "REVIEW",
                  runtimeOnlyErrorFlow: false,
                  participatesInJoin: false
                }
              ]
            }
          },
          actions: [{ id: "apply-authoring-patch", enabled: true }],
          context: {
            selectedRoleId: body.selectedRoleId,
            selectedFlowKey: body.selectedFlowKey,
            referencedRoles: ["qa-reviewer"],
            unresolvedItems: []
          }
        })
      });
    });

    await page.locator('#studio-graph-root [data-studio-graph-action="chat-generate"]').click();
    await expect(page.locator(".studio-chat-panel.is-open")).toBeVisible();
    await page.locator("#studio-chat-input").fill("Add a QA reviewer after the analyst.");
    await page.locator("#studio-chat-send").click();
    await expect(page.locator(".studio-chat-preview")).toContainText("qa-reviewer");
    await expect(page.locator("#studio-chat-apply")).toBeEnabled();
    await page.locator("#studio-chat-apply").click();
    await expect(page.locator('#studio-graph-root [data-cell-id="qa-reviewer"]')).toBeVisible();
    await expect(page.locator("#studio-graph-root")).toContainText("进入复核");
    await expect.poll(async () => page.evaluate(() => {
      const root = document.getElementById("studio-graph-root");
      return Array.from(root?.querySelectorAll("[data-cell-id]") || []).map((element) =>
        element.getAttribute("data-cell-id")
      );
    })).toContain("2:demo-analyst:REVIEW:qa-reviewer");
    await page.locator('#studio-graph-root [data-studio-graph-action="undo"]').click();
    await expect(page.locator('#studio-graph-root [data-cell-id="qa-reviewer"]')).toHaveCount(0);
    await page.locator('#studio-graph-root [data-studio-graph-action="redo"]').click();
    await expect(page.locator('#studio-graph-root [data-cell-id="qa-reviewer"]')).toBeVisible();
    await page.locator('#studio-graph-root [data-studio-graph-action="undo"]').click();
    await expect(page.locator('#studio-graph-root [data-cell-id="qa-reviewer"]')).toHaveCount(0);

    await page.unroute("**/api/v1/project/studio/chat");
    await page.route("**/api/v1/project/studio/chat", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        await route.fallback();
        return;
      }
      await new Promise(() => undefined);
    });
    await page.locator('#studio-graph-root [data-studio-graph-action="chat-generate"]').click();
    await expect(page.locator(".studio-chat-panel.is-open")).toBeVisible();
    await page.locator("#studio-chat-input").fill("增加一个审核角色");
    await page.locator("#studio-chat-send").click();
    await expect(page.locator(".studio-chat-panel.is-open")).toContainText(/Generating authoring draft|正在生成/);
    await expect(page.locator("#studio-chat-close")).toBeEnabled();
    await page.locator("#studio-chat-close").click();
    await expect(page.locator(".studio-chat-panel.is-open")).toHaveCount(0);
    await page.unroute("**/api/v1/project/studio/chat");

    const roleNodeForDrag = page.locator('#studio-graph-root [data-cell-id="demo-analyst"]').first();
    const box = await roleNodeForDrag.boundingBox();
    expect(box).toBeTruthy();
    const dragStart = box ? { x: box.x, y: box.y } : null;
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 20);
      await page.mouse.up();
    }

    await page.locator('#studio-graph-root [data-studio-graph-action="fit"]').click();
    await waitForStudioCell(page, "demo-analyst");
    await page.locator('#studio-graph-root [data-studio-graph-action="reset-view"]').click();
    await waitForStudioCell(page, "demo-analyst");

    const workbenchBody = page.locator("#workbench-body");
    await page.locator('[data-workbench-view="bridge"]').click();
    await page.locator('[data-studio-side-tab="debug"]').click();
    await expect(debugPanel.locator("#workbench-run-input")).toBeVisible();
    await expect(debugPanel.locator("#workbench-run-runtime-path")).toBeHidden();
    await debugPanel.locator("summary").click();
    await expect(debugPanel.locator("#workbench-run-runtime-path")).toBeVisible();
    await expect(debugPanel.locator("#workbench-run-user-profile-path")).toBeVisible();
    await expect(debugPanel.locator("#workbench-run-laws-path")).toBeVisible();
    await debugPanel.locator("#workbench-run-input").fill("browser smoke");
    await debugPanel.locator("#workbench-run-runtime-path").fill(".ogs/runtime.json");
    await debugPanel.locator("#workbench-run-user-profile-path").fill(".ogs/user-profile.json");
    await debugPanel.locator("#workbench-run-laws-path").fill(".ogs/laws.json");
    await debugPanel.locator("#workbench-start-run").click();
    const resultPanel = page.locator('[data-studio-selection-panel="result"]');
    await expect(resultPanel.locator("#studio-debug-open-operate")).toBeVisible();
    await expect(page.locator("#console-panel-build")).toBeVisible();
    await expect(page.locator("#action-form-section")).toBeHidden();
    await expect(page.locator("#studio-graph-root")).toBeVisible();
    await expect(page.locator('[data-studio-side-tab="result"]')).toHaveAttribute("aria-pressed", "true");
    await expectDockedSelectionAligned(page);
    await page.getByRole("tab", { name: runTabName }).click();
    await expect(page.locator("body")).toHaveClass(/show-run-sidebar/);
    await expect(page.locator("#sidebar")).toBeVisible();
    await expect(page.locator("#sidebar-toggle")).toBeHidden();
    await expect(page.locator("#operate-tabs")).toContainText("Overview");
    await expect(page.locator("#console-panel-ops")).toBeVisible();
    await expect(page.locator("#console-panel-debug")).toBeVisible();
    await expect(page.locator("#console-panel-logs")).toBeHidden();
    await expect(page.locator("#console-panel-artifacts")).toBeHidden();
    await page.getByRole("tab", { name: designTabName }).click();
    await expect(page.locator("#console-panel-build")).toBeVisible();
    await expect(page.locator("#studio-graph-root")).toBeVisible();
    await expect(page.locator('[data-workbench-view="bridge"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="add-role"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="undo"]')).toBeVisible();
    await expectDockedSelectionAligned(page);

    const collapseButton = page.locator('[data-studio-selection-collapse]').first();
    await expect(collapseButton).toBeVisible();
    await collapseButton.click();
    await expect(page.locator(".studio-selection-overlay")).toHaveClass(/is-collapsed/);
    await expect(page.locator("[data-studio-canvas-shell]")).toHaveClass(/has-collapsed-selection/);
    await expect(page.locator("#studio-graph-root")).toBeVisible();
    await collapseButton.click();
    await expect(page.locator(".studio-selection-overlay")).not.toHaveClass(/is-collapsed/);
    await expect(page.locator("[data-studio-canvas-shell]")).not.toHaveClass(/has-collapsed-selection/);
  } finally {
    await page.close();
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

test("empty workspace creates a project visually before graph editing", async ({ page }) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-empty-visual-"));
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  test.info().annotations.push({ type: "server", description: started.url });
  try {
    await page.goto(started.url);
    const designTabName = await resolveLifecycleTabName(page, ["Build", "Design"]);
    await expect(page.locator("#console-panel-project")).toBeVisible();
    await expect(page.locator("#console-panel-project > article > header").getByRole("heading", { name: "Project Overview" })).toBeVisible();
    await expect(page.locator("#project-open-form")).toHaveCount(0);
    await expect(page.locator("#project-create-form")).toBeVisible();
    await expect(page.locator('#project-create-form input[name="workdir"]')).toHaveCount(0);
    await expect(page.locator("#project-wizard")).toContainText(/Current directory|workdir/i);
    await expect(page.locator("#project-wizard")).toContainText(/Initialize current directory|Start a new OGSystem project here/i);

    await page.getByRole("tab", { name: designTabName }).click();
    await expect(page.locator("#build-dry-run")).toHaveCount(0);
    await expect(page.locator("#studio-graph-root")).toHaveCount(0);
    await expect(page.locator("#workbench-body")).toContainText(/create or load|initialize the current directory|not initialized/i);

    await page.getByRole("tab", { name: "Project" }).click();
    await expect(page.locator("#project-create-form")).toBeVisible();
    await page.locator('#project-create-form input[name="projectName"]').fill("Empty Visual");
    await page.locator('#project-create-form select[name="templateId"]').selectOption("empty");
    await page.locator('#project-create-form button[type="submit"]').click();

    await expect(page.getByRole("tab", { name: designTabName })).toBeEnabled({ timeout: 15000 });
    await page.getByRole("tab", { name: designTabName }).click();
    await waitForStudioCell(page, "demo-analyst");
    await expect(page.locator("#workbench-body")).toContainText("Chat to MMD");
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="save"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="validate"]')).toBeVisible();
    await expect(page.getByText(/\bX6\b/)).toHaveCount(0);
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

test("Studio graph island exposes minimap, focus pulse, and quick open when mounted directly", async ({ page }) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-studio-k-direct-"));
  await seedProject(workdir);
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  const quickOpenShortcut = process.platform === "darwin" ? "Meta+P" : "Control+P";
  test.info().annotations.push({ type: "server", description: started.url });
  try {
    await page.goto(started.url);
    await page.waitForFunction(() => Boolean((window as any).OGSVisualizerClient?.mountStudioX6Bridge));
    await page.evaluate(() => {
      const root = document.createElement("div");
      root.id = "studio-graph-direct-root";
      root.style.width = "960px";
      root.style.height = "560px";
      root.style.margin = "24px";
      document.body.appendChild(root);
      const mount = (window as any).OGSVisualizerClient.mountStudioX6Bridge;
      const authoring = {
        project: {
          workdir: "/tmp/direct",
          systemPath: "system.mmd"
        },
        system: {
          systemId: "viz.direct.k",
          systemVersion: "1.0.0",
          entryRoleId: "demo-analyst",
          lawGlobal: "law.minimal.base"
        },
        roles: {
          "demo-analyst": {
            roleId: "demo-analyst",
            title: "Demo Analyst",
            bindingKind: "model",
            modelRef: "opencode/gpt-5.4"
          },
          "qa-reviewer": {
            roleId: "qa-reviewer",
            title: "QA Reviewer",
            bindingKind: "model",
            modelRef: "opencode/gpt-5.4"
          }
        },
        flows: {
          "flow.demo-qa": {
            flowId: "flow.demo-qa",
            fromRoleId: "demo-analyst",
            toRoleId: "qa-reviewer",
            eventType: "DONE",
            label: "handoff"
          }
        },
        layout: {
          nodes: {
            "demo-analyst": { x: 120, y: 140, width: 190, height: 90 },
            "qa-reviewer": { x: 420, y: 140, width: 190, height: 90 }
          },
          viewport: { x: 0, y: 0, zoom: 1 }
        }
      };
      const canvas = {
        nodes: [
          { id: "demo-analyst", roleId: "demo-analyst", x: 120, y: 140, width: 190, height: 90, label: "Demo Analyst", bindingKind: "model", badges: [] },
          { id: "qa-reviewer", roleId: "qa-reviewer", x: 420, y: 140, width: 190, height: 90, label: "QA Reviewer", bindingKind: "model", badges: [] }
        ],
        edges: [
          { id: "flow.demo-qa", source: "demo-analyst", target: "qa-reviewer", eventType: "DONE", label: "handoff" }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      };
      (window as any).__studioDirectOptions = { authoring, canvas };
      mount(root, {
        authoring,
        canvas,
        selectedRoleId: "demo-analyst",
        validation: { ok: true, diagnostics: [] },
        defaultAutoLayout: false
      });
    });
    await expect(page.locator("#studio-graph-direct-root .studio-graph-toolbar")).toBeVisible();
    await expect(page.locator("#studio-graph-direct-root [data-cell-id=\"demo-analyst\"]")).toBeVisible();
    await expect(page.locator("#studio-graph-direct-root [data-studio-graph-minimap]")).toBeVisible();
    await expect(page.locator("#studio-graph-direct-root [data-minimap-role-id=\"demo-analyst\"]")).toBeVisible();

    await page.evaluate(() => {
      const root = document.getElementById("studio-graph-direct-root");
      const mount = (window as any).OGSVisualizerClient.mountStudioX6Bridge;
      const { authoring, canvas } = (window as any).__studioDirectOptions;
      mount(root, {
        authoring,
        canvas,
        selectedRoleId: "qa-reviewer",
        editSelectionRequest: 1,
        validation: { ok: true, diagnostics: [] },
        defaultAutoLayout: false
      });
    });
    await expectStudioCellPulse(page, "qa-reviewer");

    await page.locator("#studio-graph-direct-root").click();
    await page.keyboard.press(quickOpenShortcut);
    await expect(page.locator('#studio-graph-direct-root [data-studio-graph-quick-open]')).toBeVisible();
    await page.locator('#studio-graph-direct-root [data-studio-graph-quick-open-input]').fill("demo-analyst");
    await page.keyboard.press("Enter");
    await expect(page.locator('#studio-graph-direct-root [data-studio-graph-quick-open]')).toBeHidden();
    await expectStudioCellPulse(page, "demo-analyst");
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});
