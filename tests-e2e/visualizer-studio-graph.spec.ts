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
  await expect(page.locator("#studio-graph-root")).toContainText(cellId, { timeout: 10000 });
}

test("Studio Bridge renders and edits through the real graph workspace", async ({ page }) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-studio-x6-"));
  await seedProject(workdir);
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  test.info().annotations.push({ type: "server", description: started.url });
  try {
    await page.goto(started.url);
    await page.waitForFunction(() => Boolean((window as any).OGSVisualizerClient?.mountStudioX6Bridge));
    await expect(page.locator("#console-panel-project")).toBeVisible();
    await expect(page.locator("#selected-title")).toContainText("Project Overview");
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
    await page.getByRole("button", { name: "Build" }).click();
    await expect(page.locator("#workbench-status")).toContainText("validation ok");
    await page.locator('[data-workbench-view="bridge"]').click();

    await expect(page.locator("body")).not.toHaveClass(/show-run-sidebar/);
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.locator("#sidebar-toggle")).toBeHidden();
    await expect.poll(async () => page.evaluate(() => {
      const app = document.querySelector(".app");
      const sidebar = document.getElementById("sidebar");
      const content = document.querySelector("main.content");
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
    await expect(page.getByText(/\bX6\b/)).toHaveCount(0);
    await expect(page.locator('#studio-graph-root .studio-graph-toolbar')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="reset-view"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="fullscreen"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="edit"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="chat-generate"]')).toBeVisible();
    await expect(page.locator("#studio-bridge-generate")).toHaveCount(0);
    await expect(page.locator("[data-studio-bridge-fullscreen]")).toHaveCount(0);
    await expect(page.locator("#studio-bridge-save")).toHaveCount(0);
    await expect(page.locator("#build-validate")).toBeVisible();
    await expect(page.locator("#build-generate-mermaid")).toHaveCount(0);
    await expect(page.locator("#build-save")).toBeVisible();
    await expect(page.locator("#build-dry-run")).toBeVisible();
    await page.locator('#studio-graph-root [data-studio-graph-action="fullscreen"]').click();
    await expect(page.locator("[data-studio-canvas-shell]")).toHaveClass(/is-fullscreen/);
    await waitForStudioCell(page, "demo-analyst");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-studio-canvas-shell]")).not.toHaveClass(/is-fullscreen/);
    await page.evaluate(() => {
      (window as any).__studioGraphRoot = document.getElementById("studio-graph-root");
    });
    await expect(page.getByRole("button", { name: "Build" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Validate & Release" })).toBeVisible();
    await expect(page.locator("#console-panel-build")).toBeVisible();
    await expect(page.locator("#build-project-summary")).toHaveCount(0);
    await expect(page.locator("#console-panel-build").getByRole("heading", { name: "Project Overview" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Project Readiness" })).toHaveCount(0);
    await expect(page.locator("#action-form-section")).toBeHidden();
    await page.getByRole("button", { name: "Validate & Release" }).click();
    await expect(page.locator("#release-gate")).toContainText("Release gate");
    await expect(page.locator("#release-gate")).toContainText("Quality signals");
    await expect(page.locator("#release-gate")).toContainText("Evidence and export scope");
    await page.getByRole("button", { name: "Build" }).click();
    await page.evaluate(() => {
      (window as any).__studioGraphRoot = document.getElementById("studio-graph-root");
    });

    await expect.poll(async () => page.evaluate(() => document.getElementById("studio-graph-root") === (window as any).__studioGraphRoot)).toBe(true);
    await expect(page.locator(".studio-inspector")).toContainText("demo-analyst");

    await expect(page.locator("#build-validate")).toBeVisible();
    await expect(page.locator(".toolbar-group").filter({ hasText: "validation ok" }).first()).toBeVisible();

    const addRoleButton = page.locator('#studio-graph-root [data-studio-graph-action="add-role"]');
    await expect(addRoleButton).toBeEnabled();
    await addRoleButton.click();
    const addRoleForm = page.locator('#studio-graph-root form[data-studio-command-form="add-role"]');
    await expect(addRoleForm).toBeVisible();
    await addRoleForm.locator('input[name="mode"][value="custom"]').check();
    await addRoleForm.locator('input[name="roleId"]').fill("new-role");
    await addRoleForm.locator('input[name="title"]').fill("需求分析");
    await addRoleForm.locator('button[type="submit"]').click();
    await expect.poll(async () => page.evaluate(() => document.getElementById("studio-graph-root") === (window as any).__studioGraphRoot)).toBe(true);
    await expect(page.locator('#studio-graph-root [data-cell-id="new-role"]').first()).toBeVisible();
    await expect(page.locator("#studio-graph-root")).toContainText("需求分析");
    await dragStudioPort(page, "new-role", "demo-analyst");
    const addEdgeForm = page.locator('#studio-graph-root form[data-studio-command-form="add-edge"]');
    await expect(addEdgeForm).toBeVisible();
    await addEdgeForm.locator('input[name="label"]').fill("需求已完成");
    await addEdgeForm.locator('input[name="eventType"]').fill("DONE");
    await addEdgeForm.locator('button[type="submit"]').click();
    await expect.poll(async () => page.evaluate(() => document.getElementById("studio-graph-root") === (window as any).__studioGraphRoot)).toBe(true);
    await expect(page.locator('[data-studio-flow-key="new-role:DONE:demo-analyst"]')).toBeVisible();
    await expect(page.locator("#studio-graph-root")).toContainText("需求已完成");
    await page.locator('[data-studio-flow-key="new-role:DONE:demo-analyst"]').click();
    const editEdgeForm = page.locator('#studio-graph-root form[data-studio-command-form="edit-edge"]');
    await expect(editEdgeForm).toBeVisible();
    await expect(editEdgeForm.locator('input[name="label"]')).toHaveValue("需求已完成");
    await expect(editEdgeForm.locator('input[name="eventType"]')).toHaveValue("DONE");
    await editEdgeForm.locator('input[name="eventType"]').fill("HANDOFF");
    await editEdgeForm.locator('button[type="submit"]').click();
    await expect(page.locator('[data-studio-flow-key="new-role:HANDOFF:demo-analyst"]')).toBeVisible();
    await expect(page.locator("#studio-graph-root")).toContainText("需求已完成");
    await page.locator("[data-studio-bridge-filter]").fill("需求已完成");
    await expect(page.locator('[data-studio-flow-key="new-role:HANDOFF:demo-analyst"]')).toBeVisible();
    await expect(page.locator('[data-studio-flow-key="demo-analyst:DONE:output"]')).toHaveCount(0);
    await page.locator("[data-studio-bridge-filter]").fill("");

    await page.locator('#studio-graph-root [data-studio-graph-action="undo"]').click();
    await expect(page.locator('[data-studio-flow-key="new-role:HANDOFF:demo-analyst"]')).toHaveCount(0);
    await expect(page.locator('[data-studio-flow-key="new-role:DONE:demo-analyst"]')).toBeVisible();

    await page.locator('#studio-graph-root [data-studio-graph-action="undo"]').click();
    await expect(page.locator('[data-studio-flow-key="new-role:DONE:demo-analyst"]')).toHaveCount(0);

    await page.locator('#studio-graph-root [data-studio-graph-action="redo"]').click();
    await expect(page.locator('[data-studio-flow-key="new-role:DONE:demo-analyst"]')).toBeVisible();

    await page.locator('#studio-graph-root [data-studio-graph-action="redo"]').click();
    await expect(page.locator('[data-studio-flow-key="new-role:HANDOFF:demo-analyst"]')).toBeVisible();

    await page.locator('#studio-graph-root [data-studio-graph-action="undo"]').click();
    await expect(page.locator('[data-studio-flow-key="new-role:DONE:demo-analyst"]')).toBeVisible();
    await page.locator('#studio-graph-root [data-studio-graph-action="undo"]').click();
    await expect(page.locator('[data-studio-flow-key="new-role:DONE:demo-analyst"]')).toHaveCount(0);
    await page.locator('#studio-graph-root [data-studio-graph-action="undo"]').click();
    await expect(page.locator('#studio-graph-root [data-cell-id="new-role"]')).toHaveCount(0);

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

    const roleNodeForDrag = page.locator('#studio-graph-root [data-cell-id="demo-analyst"]').first();
    const box = await roleNodeForDrag.boundingBox();
    expect(box).toBeTruthy();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 20);
      await page.mouse.up();
    }
    await expect(page.locator("#flash")).toContainText("Studio canvas layout updated");

    await page.locator('#studio-graph-root [data-studio-graph-action="fit"]').click();
    await waitForStudioCell(page, "demo-analyst");
    await page.locator('#studio-graph-root [data-studio-graph-action="reset-view"]').click();
    await waitForStudioCell(page, "demo-analyst");

    await page.locator('[data-workbench-view="bridge"]').click();
    await page.locator("#build-save").click();
    await expect(page.locator("#flash")).toContainText("Mermaid source saved");

    await page.locator('[data-workbench-view="bridge"]').click();
    await page.locator("#build-dry-run").click();
    await expect(page.locator("#action-form-section")).toBeVisible();
    await page.locator("#action-run-prompt").fill("browser smoke");
    await page.locator("#action-form-submit").click();
    await expect(page.locator("#selected-title")).toContainText(/\d{8}-/);
    await expect(page.locator("#console-panel-build")).toBeVisible();
    await expect(page.locator("#workbench-body")).toContainText("Open in Operate");
    await page.getByRole("button", { name: "Open in Operate" }).click();
    await expect(page.locator("body")).toHaveClass(/show-run-sidebar/);
    await expect(page.locator("#sidebar")).toBeVisible();
    await expect(page.locator("#sidebar-toggle")).toBeHidden();
    await expect(page.locator("#operate-tabs")).toContainText("Overview");
    await expect(page.locator("#console-panel-ops")).toBeVisible();
    await expect(page.locator("#console-panel-debug")).toBeVisible();
    await expect(page.locator("#console-panel-logs")).toBeHidden();
    await expect(page.locator("#console-panel-artifacts")).toBeHidden();
    await page.getByRole("button", { name: "Graph" }).click();
    await expect(page.locator("#run-graph-root")).toBeVisible();
    await expect(page.locator('#run-graph-root [data-studio-graph-action="add-role"]')).toBeHidden();
    await expect(page.locator('#run-graph-root [data-studio-graph-action="undo"]')).toBeHidden();
    await page.getByRole("button", { name: "Logs" }).click();
    await expect(page.locator("#console-panel-logs")).toBeVisible();
    await expect(page.locator("#load-logs")).toBeVisible();
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
    await expect(page.locator("#console-panel-project")).toBeVisible();
    await expect(page.locator("#selected-title")).toContainText("Project Overview");
    await expect(page.locator("#project-wizard-load")).toHaveCount(0);
    await expect(page.locator("#project-create-form")).toBeVisible();
    await expect(page.locator('#project-create-form input[name="workdir"]')).toHaveAttribute("readonly", "readonly");
    await expect(page.locator("#project-role-page-size")).toBeVisible();
    await page.locator('[data-project-menu-tab="open"]').click();
    await expect(page.locator("#project-open-form")).toBeVisible();
    await page.locator('[data-project-menu-tab="new"]').click();
    await expect(page.locator("#project-create-form")).toBeVisible();
    await expect(page.locator("#project-summary")).toContainText(/not initialized|Start a new OGSystem project/i);

    await page.locator('#console-tabs [data-console-tab="build"]').click();
    await expect(page.locator("#build-dry-run")).toHaveCount(0);
    await expect(page.locator("#studio-graph-root")).toHaveCount(0);
    await expect(page.locator("#workbench-body")).toContainText(/create or load/i);

    await page.locator('#console-tabs [data-console-tab="project"]').click();
    await page.locator('#project-create-form input[name="projectName"]').fill("Empty Visual");
    await page.locator('#project-create-form input[name="projectId"]').fill("viz.empty.visual");
    await page.locator('#project-create-form select[name="templateId"]').selectOption("empty");
    await page.locator('#project-create-form button[type="submit"]').click();

    await page.locator('#console-tabs [data-console-tab="build"]').click();
    await expect(page.locator("#studio-graph-root")).toBeVisible();
    await waitForStudioCell(page, "demo-analyst");
    await expect(page.locator("#workbench-body")).toContainText("Chat to MMD");
    await expect(page.locator("#build-save")).toBeVisible();
    await expect(page.locator("#build-dry-run")).toBeVisible();
    await expect(page.getByText(/\bX6\b/)).toHaveCount(0);
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});
