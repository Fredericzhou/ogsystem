import { test, expect } from "@playwright/test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { startVisualizationServer } from "../dist/visualizer/server.js";

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
    JSON.stringify({ projectId: "viz.build.layout", createdAt: "2026-05-08T00:00:00.000Z" }, null, 2),
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
      "%% system.id=viz.build.layout",
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

async function waitForStudioCell(page, cellId: string): Promise<void> {
  await expect(page.locator("#studio-graph-root")).toContainText(cellId, { timeout: 10000 });
}

async function expectDockedSelectionAligned(page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const root = document.getElementById("studio-graph-root");
    const dialog = document.querySelector(".studio-selection-overlay.is-docked .studio-selection-dialog");
    if (!root || !dialog) {
      return null;
    }
    const rootBox = root.getBoundingClientRect();
    const dialogBox = dialog.getBoundingClientRect();
    return {
      topDelta: Math.abs(Math.round(rootBox.top - dialogBox.top)),
      bottomDelta: Math.abs(Math.round(rootBox.bottom - dialogBox.bottom)),
      dialogRightOfRoot: dialogBox.left >= rootBox.right - 2
    };
  })).toEqual({
    topDelta: 0,
    bottomDelta: 0,
    dialogRightOfRoot: true
  });
}

async function expectBuildCanvasGapTight(page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const body = document.querySelector("#console-panel-build > article > .body");
    const shell = document.querySelector("#console-panel-build .studio-canvas-shell");
    if (!body || !shell) {
      return null;
    }
    const bodyBox = body.getBoundingClientRect();
    const shellBox = shell.getBoundingClientRect();
    return Math.round(bodyBox.bottom - shellBox.bottom);
  })).toBeLessThanOrEqual(12);
}

test("Build workbench keeps view toggles in footer and aligns graph with docked inspector", async ({ page }) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-build-layout-"));
  await seedProject(workdir);
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  try {
    await page.goto(started.url);
    await page.waitForFunction(() => Boolean((window as any).OGSVisualizerClient?.mountStudioX6Bridge));

    await page.getByRole("tab", { name: "Build" }).click();
    await expect(page.locator("#console-panel-build")).toBeVisible();
    await expect(page.locator("#workbench-title")).toHaveText("Authoring");
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
    await expect(page.locator("#studio-graph-root")).toBeVisible();
    await waitForStudioCell(page, "demo-analyst");
    await expectBuildCanvasGapTight(page);
    await expect(page.locator("[data-studio-selection-dialog]")).toContainText("demo-analyst");
    await expect(page.locator('[data-studio-side-tab="debug"]')).toBeVisible();
    await expectDockedSelectionAligned(page);
    const roleNode = page.locator('#studio-graph-root [data-cell-id="demo-analyst"]').first();
    await expect(roleNode).toBeVisible();
    const beforeClickBox = await roleNode.boundingBox();
    expect(beforeClickBox).toBeTruthy();
    await roleNode.click();
    await expect.poll(async () => {
      const afterClickBox = await roleNode.boundingBox();
      if (!beforeClickBox || !afterClickBox) {
        return false;
      }
      const deltaX = Math.abs(afterClickBox.x - beforeClickBox.x);
      const deltaY = Math.abs(afterClickBox.y - beforeClickBox.y);
      return deltaX <= 4 && deltaY <= 4;
    }).toBe(true);
    await expect.poll(async () => page.evaluate(() => {
      const body = document.querySelector<HTMLElement>(".studio-selection-body");
      const activePanel = Array.from(document.querySelectorAll<HTMLElement>(".studio-selection-panel"))
        .find((panel) => !panel.hidden);
      if (!body || !activePanel) {
        return null;
      }
      body.scrollTop = 140;
      return {
        activePanel: activePanel.getAttribute("data-studio-selection-panel") || "",
        scrollable: body.scrollHeight > body.clientHeight + 8,
        scrolled: body.scrollTop > 0
      };
    })).toEqual({
      activePanel: "selection",
      scrollable: true,
      scrolled: true
    });

    const debugPanel = page.locator('[data-studio-selection-panel="debug"]');
    const structurePanel = page.locator('[data-studio-selection-panel="structure"]');
    const workbenchBody = page.locator("#workbench-body");
    await page.locator('[data-studio-side-tab="debug"]').click();
    await expect(debugPanel).toBeVisible();
    await expect(debugPanel.locator("#workbench-run-input")).toBeVisible();
    await expect(debugPanel).toContainText(/execution config|执行配置/);
    await expectDockedSelectionAligned(page);
    await page.locator('[data-studio-side-tab="structure"]').click();
    await expect(structurePanel).toBeVisible();

    await sourceViewButton.click();
    await expect(page.locator("#workbench-editor")).toBeVisible();
    await expect(page.locator("#workbench-editor")).toContainText("demo-analyst");

    await bridgeViewButton.click();
    await waitForStudioCell(page, "demo-analyst");
    await page.locator('#studio-graph-root [data-studio-graph-action="fullscreen"]').click();
    await expect(page.locator("[data-studio-canvas-shell]")).toHaveClass(/is-fullscreen/);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-studio-canvas-shell]")).not.toHaveClass(/is-fullscreen/);

    await page.locator('[data-studio-side-tab="debug"]').click();
    await expect(debugPanel.locator("#workbench-run-input")).toBeVisible();
    await expect(debugPanel.locator("#workbench-start-run")).toBeVisible();
    await debugPanel.locator("#workbench-run-input").fill("layout dry run");
    await debugPanel.locator("#workbench-start-run").click();
    const resultPanel = page.locator('[data-studio-selection-panel="result"]');
    await expect(resultPanel.locator("#studio-debug-open-operate")).toBeVisible();
    await expect(page.locator("#console-panel-build")).toBeVisible();
    await expect(resultPanel).toBeVisible();
    await expect(page.locator('[data-studio-side-tab="result"]')).toHaveAttribute("aria-pressed", "true");
    await expectDockedSelectionAligned(page);
  } finally {
    await page.close();
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});
