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
    const dialog = document.querySelector("[data-studio-selection-dialog]");
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
  })).toMatchObject({
    dialogRightOfRoot: true
  });
  await expect.poll(async () => page.evaluate(() => {
    const root = document.getElementById("studio-graph-root");
    const dialog = document.querySelector("[data-studio-selection-dialog]");
    if (!root || !dialog) {
      return null;
    }
    const rootBox = root.getBoundingClientRect();
    const dialogBox = dialog.getBoundingClientRect();
    return {
      topDelta: Math.abs(Math.round(rootBox.top - dialogBox.top)),
      bottomDelta: Math.abs(Math.round(rootBox.bottom - dialogBox.bottom))
    };
  })).toEqual({
    topDelta: 8,
    bottomDelta: 8
  });
}

async function expectBuildCanvasGapTight(page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const body = document.querySelector("#console-panel-build > article > .body");
    const card = document.querySelector("#console-panel-build > article");
    const shell = document.querySelector("#console-panel-build .studio-canvas-shell");
    if (!body || !card || !shell) {
      return null;
    }
    const bodyBox = body.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    const shellBox = shell.getBoundingClientRect();
    return {
      shellGap: Math.round(bodyBox.bottom - shellBox.bottom),
      cardGap: Math.round(cardBox.bottom - bodyBox.bottom)
    };
  }).then((gaps) => Boolean(gaps && gaps.shellGap <= 2 && gaps.cardGap <= 2))).toBe(true);
}

async function expectReadableGraphViewport(page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const roleNode = document.querySelector<HTMLElement>('#studio-graph-root [data-cell-id="demo-analyst"]');
    const minimapViewport = document.querySelector<HTMLElement>("[data-studio-graph-minimap-viewport]");
    if (!roleNode || !minimapViewport) {
      return null;
    }
    const roleBox = roleNode.getBoundingClientRect();
    const viewportWidth = Number.parseFloat(minimapViewport.style.width || "0");
    const viewportHeight = Number.parseFloat(minimapViewport.style.height || "0");
    return {
      roleWidth: Math.round(roleBox.width),
      roleHeight: Math.round(roleBox.height),
      viewportWidth: Math.round(viewportWidth),
      viewportHeight: Math.round(viewportHeight)
    };
  })).toMatchObject({
    roleWidth: expect.any(Number),
    roleHeight: expect.any(Number),
    viewportWidth: expect.any(Number),
    viewportHeight: expect.any(Number)
  });
  await expect.poll(async () => page.evaluate(() => {
    const roleNode = document.querySelector<HTMLElement>('#studio-graph-root [data-cell-id="demo-analyst"]');
    const minimapViewport = document.querySelector<HTMLElement>("[data-studio-graph-minimap-viewport]");
    if (!roleNode || !minimapViewport) {
      return null;
    }
    const roleBox = roleNode.getBoundingClientRect();
    return {
      roleReadable: roleBox.width >= 90 && roleBox.height >= 40,
      minimapViewportRendered: Number.parseFloat(minimapViewport.style.width || "0") > 0
        && Number.parseFloat(minimapViewport.style.height || "0") > 0
    };
  })).toEqual({
    roleReadable: true,
    minimapViewportRendered: true
  });
}

async function rememberBuildCanvasIdentity(page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__buildShellRef = document.querySelector("[data-studio-canvas-shell]");
    (window as any).__buildRootRef = document.getElementById("studio-graph-root");
  });
}

async function expectBuildCanvasIdentityStable(page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => ({
    sameShell: (window as any).__buildShellRef === document.querySelector("[data-studio-canvas-shell]"),
    sameRoot: (window as any).__buildRootRef === document.getElementById("studio-graph-root")
  }))).toEqual({
    sameShell: true,
    sameRoot: true
  });
}

test("Build workbench keeps view toggles in footer and aligns graph with docked inspector", async ({ page }) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-build-layout-"));
  await seedProject(workdir);
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  try {
    await page.goto(started.url);
    await page.waitForFunction(() => Boolean((window as any).OGSVisualizerClient?.mountStudioX6Bridge));

    await page.locator("#console-tab-design").click();
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
    await expect(page.locator('[data-studio-side-tab="structure"]')).toHaveAttribute("aria-pressed", "true");
    await expectReadableGraphViewport(page);
    await rememberBuildCanvasIdentity(page);
    await expectBuildCanvasGapTight(page);
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
    await expectBuildCanvasIdentityStable(page);
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
    const workbenchBody = page.locator("#workbench-body");
    await page.locator('[data-studio-side-tab="debug"]').click();
    await expect(debugPanel).toBeVisible();
    await expect(debugPanel.locator("#workbench-run-input")).toBeVisible();
    await expect(debugPanel).toContainText(/execution config|执行配置/);
    await expectDockedSelectionAligned(page);
    await expectBuildCanvasIdentityStable(page);

    await sourceViewButton.click();
    await expect(page.locator("#workbench-editor")).toBeVisible();
    await expect(page.locator("#workbench-editor")).toContainText("demo-analyst");

    await bridgeViewButton.click();
    await waitForStudioCell(page, "demo-analyst");
    await rememberBuildCanvasIdentity(page);
    await page.locator('#studio-graph-root [data-studio-graph-action="fullscreen"]').click();
    await expect(page.locator("[data-studio-canvas-shell]")).toHaveClass(/is-fullscreen/);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-studio-canvas-shell]")).not.toHaveClass(/is-fullscreen/);

    await page.locator('[data-studio-side-tab="debug"]').click();
    await expect(debugPanel.locator("#workbench-run-input")).toBeVisible();
    await expect(debugPanel.locator("#workbench-start-run")).toBeVisible();
    await debugPanel.locator("#workbench-run-input").fill("layout dry run");
    await debugPanel.locator("#workbench-start-run").click();
    const logsPanel = page.locator('[data-studio-selection-panel="logs"]');
    await expect(logsPanel.locator("#studio-logs-open-operate")).toBeVisible();
    await expect(page.locator("#console-panel-build")).toBeVisible();
    await expect(page.locator("#console-tab-design")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#console-tab-run")).toHaveAttribute("aria-pressed", "false");
    await expect(logsPanel).toBeVisible();
    await expect(logsPanel).toContainText(/Structured trace|结构化轨迹/);
    await expect(page.locator('[data-studio-side-tab="logs"]')).toHaveAttribute("aria-pressed", "true");
    await expectDockedSelectionAligned(page);
    await expectBuildCanvasIdentityStable(page);
    await page.reload();
    await expect(page.locator("#console-tab-design")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#console-tab-run")).toHaveAttribute("aria-pressed", "false");
    await waitForStudioCell(page, "demo-analyst");
    await expect(page.locator("[data-studio-bridge-filter]")).toBeVisible();
    await expect(page.locator('[data-studio-side-tab="structure"]')).toHaveAttribute("aria-pressed", "true");
  } finally {
    await page.close();
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});
