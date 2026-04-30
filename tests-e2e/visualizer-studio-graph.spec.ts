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
    JSON.stringify({ projectId: "viz.studio.graph", createdAt: "2026-04-30T00:00:00.000Z" }, null, 2),
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

test("Studio Bridge renders and edits through the real X6 graph island", async ({ page }) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-studio-x6-"));
  await seedProject(workdir);
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  test.info().annotations.push({ type: "server", description: started.url });
  try {
    await page.goto(started.url);
    await page.locator("#project-home").click();
    await page.locator("#workbench-open-bridge").click();

    await expect(page.locator("#studio-graph-root")).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-cell-id="demo-analyst"]').first()).toBeVisible();
    await expect(page.getByText("Project Readiness")).toBeVisible();
    await expect(page.getByText("Action Form")).toBeVisible();

    const roleNode = page.locator('#studio-graph-root [data-cell-id="demo-analyst"]').first();
    await roleNode.click({ force: true });
    await expect(page.locator(".studio-inspector")).toContainText("demo-analyst");

    const box = await roleNode.boundingBox();
    expect(box).toBeTruthy();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 20);
      await page.mouse.up();
    }
    await expect(page.locator("#studio-bridge-validate")).toBeVisible();
    await expect(page.locator(".toolbar-group").filter({ hasText: "validation ok" }).first()).toBeVisible();

    await page.locator('#studio-graph-root [data-studio-graph-action="add-role"]').click();
    await expect(page.locator("#flash")).toContainText("Studio graph draft updated");
    await expect(page.locator('#studio-graph-root [data-cell-id="new-role"]').first()).toBeVisible();
    await dragStudioPort(page, "new-role", "demo-analyst");
    await expect(page.locator("#flash")).toContainText("Studio graph draft updated");
    await expect(page.locator('[data-studio-flow-key="new-role:DONE:demo-analyst"]')).toBeVisible();

    await page.locator('#studio-graph-root [data-studio-graph-action="undo"]').click();
    await expect(page.locator("#flash")).toContainText("Studio graph draft updated");
    await expect(page.locator('[data-studio-flow-key="new-role:DONE:demo-analyst"]')).toHaveCount(0);

    await page.locator('#studio-graph-root [data-studio-graph-action="redo"]').click();
    await expect(page.locator("#flash")).toContainText("Studio graph draft updated");
    await expect(page.locator('[data-studio-flow-key="new-role:DONE:demo-analyst"]')).toBeVisible();

    await page.locator('#studio-graph-root [data-studio-graph-action="undo"]').click();
    await expect(page.locator('[data-studio-flow-key="new-role:DONE:demo-analyst"]')).toHaveCount(0);
    await page.locator('#studio-graph-root [data-studio-graph-action="undo"]').click();
    await expect(page.locator('#studio-graph-root [data-cell-id="new-role"]')).toHaveCount(0);

    await page.locator('#studio-graph-root [data-studio-graph-action="fit"]').click();
    await expect(page.locator('#studio-graph-root [data-cell-id="demo-analyst"]').first()).toBeVisible();

    await page.locator("#studio-bridge-generate").click();
    await expect(page.locator("#flash")).toContainText("Generated deterministic Mermaid");

    await page.locator("#workbench-open-bridge").click();
    await page.locator("#studio-bridge-save").click();
    await expect(page.locator("#flash")).toContainText("Mermaid source saved");

    await page.locator("#workbench-open-bridge").click();
    await page.locator("#studio-bridge-dry-run").click();
    await page.locator("#action-start-input").fill("browser smoke");
    await page.locator("#action-form-submit").click();
    await expect(page.locator("#selected-title")).toContainText(/\d{8}-/);
  } finally {
    await page.close();
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});
