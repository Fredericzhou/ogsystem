import { test, expect } from "@playwright/test";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
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
      "input -->|ENTER| analyst[Role:demo-analyst]",
      "analyst[Role:demo-analyst] -->|ANALYSIS_DONE| output",
      ""
    ].join("\n"),
    "utf8"
  );
}

async function seedCyclicProject(workdir: string): Promise<void> {
  await seedProject(workdir);
  await writeFile(
    path.resolve(workdir, "system.mmd"),
    [
      "flowchart TD",
      "%% system.id=viz.studio.graph",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=demo-analyst",
      "%% loop.max.demo-analyst=3",
      "input -->|ENTER| analyst[Role:demo-analyst]",
      "analyst[Role:demo-analyst] -->|ANALYSIS_DONE| intake[Role:demo-intake]",
      "intake[Role:demo-intake] -->|COMPLETE| analyst[Role:demo-analyst]",
      "intake[Role:demo-intake] -->|COMPLETE| output",
      ""
    ].join("\n"),
    "utf8"
  );
}

async function seedContractProject(workdir: string): Promise<void> {
  await seedProject(workdir);
  const contractsDir = path.resolve(workdir, ".ogs/contracts");
  await mkdir(contractsDir, { recursive: true });
  await writeFile(path.resolve(contractsDir, "handoff.contracts.json"), JSON.stringify({
    version: 1,
    contracts: [{
      id: "analyst.input.v1",
      kind: "role_input",
      match: { roleId: "demo-analyst" },
      schema: "analyst-input.schema.json",
      onViolation: "FAIL"
    }]
  }, null, 2), "utf8");
  await writeFile(path.resolve(contractsDir, "analyst-input.schema.json"), JSON.stringify({
    type: "object",
    properties: { request: { type: "string" } },
    required: ["request"],
    additionalProperties: false
  }, null, 2), "utf8");
  await writeFile(path.resolve(workdir, "system.mmd"), [
    "flowchart TD",
    "%% system.id=viz.studio.contracts",
    "%% system.version=1.0.0",
    "%% law.global=law.minimal.base",
    "%% entry.role=demo-analyst",
    "%% context.map.demo-analyst.request=global.task",
    "%% handoff.mode=transition",
    "%% handoff.contracts=.ogs/contracts/handoff.contracts.json",
    "input -->|ENTER| analyst[Role:demo-analyst]",
    "analyst[Role:demo-analyst] -->|ANALYSIS_DONE| intake[Role:demo-intake]",
    "intake[Role:demo-intake] -->|COMPLETE| output",
    ""
  ].join("\n"), "utf8");
}

async function seedComplexMappingProject(workdir: string): Promise<void> {
  await seedProject(workdir);
  await writeFile(path.resolve(workdir, "system.mmd"), [
    "flowchart TD",
    "%% system.id=viz.studio.mapping-uat",
    "%% system.version=1.0.0",
    "%% law.global=law.minimal.base",
    "%% entry.role=demo-intake",
    "%% join.mode.test-operator=all_of",
    "%% join.sources.test-operator=demo-analyst,demo-intake",
    "input -->|ENTER| intake[Role:demo-intake]",
    "intake[Role:demo-intake] -->|COMPLETE| analyst[Role:demo-analyst]",
    "intake[Role:demo-intake] -->|COMPLETE| reviewer[Role:test-operator]",
    "analyst[Role:demo-analyst] -->|ANALYSIS_DONE| reviewer[Role:test-operator]",
    "reviewer[Role:test-operator] -->|DONE| output",
    ""
  ].join("\n"), "utf8");
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
    await expect(page.locator("[data-studio-graph-layout]")).toHaveValue("flow");
    await waitForStudioCell(page, "demo-analyst");
    await expect.poll(async () => page.evaluate(() => {
      const left = document.querySelector('#studio-graph-root [data-cell-id="input"]')?.getBoundingClientRect();
      const role = document.querySelector('#studio-graph-root [data-cell-id="demo-analyst"]')?.getBoundingClientRect();
      const right = document.querySelector('#studio-graph-root [data-cell-id="output"]')?.getBoundingClientRect();
      return Boolean(left && role && right && left.right < role.left && role.right < right.left);
    })).toBe(true);
    await expect.poll(async () => page.evaluate(() => {
      const root = document.getElementById("studio-graph-root");
      const paths = Array.from(root?.querySelectorAll<SVGPathElement>('path[marker-end]') ?? []);
      const pointDistance = (point: DOMPoint, box: DOMRect) => {
        const distances = [];
        if (point.y >= box.top && point.y <= box.bottom) distances.push(Math.abs(point.x - box.left), Math.abs(point.x - box.right));
        if (point.x >= box.left && point.x <= box.right) distances.push(Math.abs(point.y - box.top), Math.abs(point.y - box.bottom));
        return Math.min(...distances, Number.POSITIVE_INFINITY);
      };
      const endpointDistance = (id: string) => {
        const box = root?.querySelector<HTMLElement>(`[data-cell-id="${id}"]`)?.getBoundingClientRect();
        if (!box) return Number.POSITIVE_INFINITY;
        return Math.min(...paths.flatMap((path) => {
          const matrix = path.getScreenCTM();
          if (!matrix) return [];
          return [0, path.getTotalLength()].map((distance) => {
            const point = path.getPointAtLength(distance);
            return pointDistance(new DOMPoint(point.x, point.y).matrixTransform(matrix), box);
          });
        }));
      };
      return { input: endpointDistance("input") <= 3, output: endpointDistance("output") <= 3 };
    })).toEqual({ input: true, output: true });
    await page.locator('[data-studio-side-tab="structure"]').click();
    await expect(page.locator(".studio-system-settings")).toBeVisible();
    await expect(page.locator(".studio-contract-editor")).toBeVisible();
    await page.locator(".studio-system-settings summary").click();
    await page.locator("[data-system-setting='entryEventType']").fill("BEGIN");
    await page.locator("[data-system-settings-save]").click();
    const authoringDraftPath = path.resolve(workdir, ".ogs/studio/system.authoring.json");
    await expect.poll(async () => readFile(authoringDraftPath, "utf8").then(JSON.parse).catch(() => null)).toMatchObject({
      system: { entryEventType: "BEGIN" }
    });
    const browseFilter = page.locator('[data-studio-bridge-filter="1"]');
    await browseFilter.fill("demo");
    const rolesSection = page.locator("[data-studio-role-list-section]");
    if (!(await rolesSection.evaluate((section: HTMLDetailsElement) => section.open))) {
      await rolesSection.locator("summary").click();
    }
    const analystRole = rolesSection.locator('[data-studio-role-id="demo-analyst"]');
    await expect(analystRole).toBeVisible();
    await analystRole.click();
    await expect(page.locator('[data-studio-selection-panel="structure"]')).toBeVisible();
    await expect(page.locator('[data-studio-selection-inline-editor] [data-role-config-editor="demo-analyst"]')).toBeVisible();
    await expect(page.locator("[data-flow-config-field='targetContextMap']")).toHaveCount(0);
    await page.locator("[data-context-map-add]").click();
    await page.locator("[data-context-map-target]").last().fill("request");
    await page.locator("[data-context-map-selector]").last().selectOption("global.task");
    await expect(page.locator("[data-context-map-optional]").last()).toBeDisabled();
    await page.locator("[data-context-map-add]").click();
    await page.locator("[data-context-map-target]").last().fill("reviewNote");
    await page.locator("[data-context-map-selector]").last().selectOption("global.human_review.current.comment");
    await expect(page.locator("[data-context-map-optional]").last()).toBeEnabled();
    await page.locator("[data-context-map-optional]").last().check();
    await expect(page.locator("[data-role-config-save='demo-analyst']")).toHaveAttribute("data-bound-role-config-save", "true");
    await page.locator("[data-role-config-save='demo-analyst']").click();
    await expect.poll(async () => readFile(authoringDraftPath, "utf8").then(JSON.parse).catch(() => null)).toMatchObject({
      roles: { "demo-analyst": { contextMap: {
        request: "global.task",
        reviewNote: "global.human_review.current.comment?"
      } } }
    });
    await expect(page.locator('[data-studio-selection-inline-editor] [data-studio-open-system-settings]')).toBeVisible();
    await expect(page.locator('[data-studio-side-tab="structure"]')).toHaveAttribute("aria-pressed", "true");
    await expectStudioCellPulse(page, "demo-analyst");
    await page.locator("[data-studio-selection-back]").click();
    await expect(page.locator('[data-studio-selection-panel="structure"]')).toBeVisible();
    await expect(page.locator('[data-studio-bridge-filter="1"]')).toHaveValue("demo");
    const firstFilteredFlow = page.locator('[data-studio-flow-key]').first();
    await firstFilteredFlow.click();
    await expect(page.locator('[data-studio-selection-panel="structure"]')).toBeVisible();
    await expect(page.locator('[data-studio-selection-inline-editor] .studio-system-settings')).toHaveCount(0);
    await expect(page.locator('[data-studio-selection-inline-editor] [data-studio-open-system-settings]')).toBeVisible();
    await expect(page.locator('[data-studio-selection-inline-editor] [data-flow-config-editor]')).toBeVisible();
    await page.locator('[data-studio-selection-inline-editor] [data-studio-open-system-settings]').click();
    await expect(page.locator(".studio-system-settings")).toBeVisible();
    await expect(page.locator(".studio-contract-editor")).toBeVisible();
    await expect(page.locator('[data-studio-side-tab="structure"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-studio-bridge-filter="1"]')).toHaveValue("demo");
    await page.locator('[data-studio-bridge-filter="1"]').fill("");
    const graphViewport = page.locator("#studio-graph-root .x6-graph-svg-viewport");
    const viewportBeforeWheel = await graphViewport.getAttribute("transform");
    const graphBox = await page.locator("#studio-graph-root [data-studio-graph-canvas]").boundingBox();
    expect(graphBox).toBeTruthy();
    if (graphBox) {
      await page.mouse.move(graphBox.x + graphBox.width / 2, graphBox.y + graphBox.height / 2);
      await page.mouse.wheel(0, -320);
      await expect.poll(() => graphViewport.getAttribute("transform")).not.toBe(viewportBeforeWheel);
    }
    await expectDockedSelectionAligned(page);
    await expect(page.getByText(/\bX6\b/)).toHaveCount(0);
    await expect(page.locator('#studio-graph-root .studio-graph-toolbar')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="reset-view"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="fullscreen"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="edit"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="chat-generate"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="validate"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="save"]')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="layout"]')).toHaveCount(0);
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="save"] svg')).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="save"]')).toHaveAttribute("title", /Save/);
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
    await debugPanel.locator("details").first().locator("summary").click();
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
    await expect(page.locator("[data-studio-selection-dialog]")).toContainText(/Configuration|配置/);
    await expect(page.locator('[data-studio-side-tab="structure"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-studio-bridge-filter]")).toBeVisible();
    await expect(page.locator("[data-studio-bridge-list-mode]")).toBeVisible();
    const roleListSection = page.locator("[data-studio-role-list-section]");
    const flowListSection = page.locator("[data-studio-flow-list-section]");
    await expect(roleListSection).not.toHaveAttribute("open", "");
    await expect(flowListSection).not.toHaveAttribute("open", "");
    const roleSummary = roleListSection.locator("summary");
    await expect(roleSummary).toBeVisible();
    await roleSummary.click();
    await expect(roleListSection).toHaveAttribute("open", "");
    await expect(roleListSection.locator("[data-studio-role-id]").first()).toBeVisible();
    await flowListSection.locator("summary").click();
    await expect(flowListSection).toHaveAttribute("open", "");
    await expect(flowListSection.locator("[data-studio-flow-key]").first()).toBeVisible();
    await expect(page.locator("[data-studio-selection-panel=\"structure\"]")).toContainText(/Roles · participants|角色 · 参与者/);
    await expect(page.locator("[data-studio-selection-panel=\"structure\"]")).toContainText(/Flows · handoffs|流转 · 任务交接/);
    const retrievalControlBoxes = await Promise.all([
      page.locator("[data-studio-bridge-filter]").boundingBox(),
      page.locator("[data-studio-bridge-list-mode]").boundingBox()
    ]);
    expect(retrievalControlBoxes[1].y).toBeGreaterThanOrEqual(retrievalControlBoxes[0].y + retrievalControlBoxes[0].height);
    await expect(page.locator('#studio-graph-root [data-studio-graph-action="validate"]')).toBeVisible();
    await expect(page.locator(".toolbar-group").filter({ hasText: "validation ok" }).first()).toBeVisible();

    const addRoleButton = page.locator('#studio-graph-root [data-studio-graph-action="add-role"]');
    await expect(addRoleButton).toBeEnabled();
    await addRoleButton.click();
    const addRoleForm = page.locator('form[data-studio-command-form="add-role"]');
    await expect(addRoleForm).toBeVisible();
    await expect(addRoleForm.locator('select[name="bindingKind"]')).toHaveValue("model");
    await addRoleForm.locator('input[name="mode"][value="custom"]').check();
    await addRoleForm.locator('input[name="roleId"]').fill("new-role");
    await addRoleForm.locator('input[name="title"]').fill("需求分析");
    await addRoleForm.locator('select[name="bindingKind"]').selectOption("noop");
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
    await debugPanel.locator("details").first().locator("summary").click();
    await expect(debugPanel.locator("#workbench-run-runtime-path")).toBeVisible();
    await expect(debugPanel.locator("#workbench-run-user-profile-path")).toBeVisible();
    await expect(debugPanel.locator("#workbench-run-laws-path")).toBeVisible();
    await debugPanel.locator("#workbench-run-input").fill("browser smoke");
    await debugPanel.locator("#workbench-run-runtime-path").fill(".ogs/runtime.json");
    await debugPanel.locator("#workbench-run-user-profile-path").fill(".ogs/user-profile.json");
    await debugPanel.locator("#workbench-run-laws-path").fill(".ogs/laws.json");
    await debugPanel.locator("#workbench-start-run").click();
    await expect(debugPanel).toBeVisible();
    await expect(debugPanel.locator("#workbench-run-input")).toBeVisible();
    await expect(debugPanel.locator("#workbench-start-run")).toBeVisible();
    await expect(page.locator("#console-panel-build")).toBeVisible();
    await expect(page.locator("#action-form-section")).toBeHidden();
    await expect(page.locator("#studio-graph-root")).toBeVisible();
    await expect(page.getByRole("tab", { name: designTabName })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: runTabName })).toHaveAttribute("aria-selected", "false");
    await expect(page.locator('[data-studio-side-tab="debug"]')).toHaveAttribute("aria-pressed", "true");
    await expect(debugPanel).toContainText(/Structured trace|结构化轨迹/);
    await debugPanel.locator("#studio-logs-load-raw").click();
    await expect(debugPanel).toContainText(/Raw engine and role streams/);
    await expectDockedSelectionAligned(page);
    await page.getByRole("tab", { name: runTabName }).click();
    await expect(page.locator("body")).toHaveClass(/show-run-sidebar/);
    await expect(page.locator("#sidebar")).toBeVisible();
    await expect(page.locator("#sidebar-toggle")).toBeHidden();
    await expect(page.locator("#operate-tabs")).not.toContainText("Graph");
    await expect(page.locator("#run-graph-disclosure")).toBeVisible();
    await page.locator("#run-graph-disclosure > summary").click();
    await expect(page.locator("#console-panel-ops")).toBeHidden();
    await expect(page.locator("#console-panel-debug")).toBeVisible();
    await expect(page.locator("#run-graph-root")).toBeVisible();
    await expect(page.locator("#run-graph-root [data-studio-graph-layout]")).toHaveValue("compact");
    await expect(page.locator(".run-graph-notes")).not.toHaveAttribute("open", "");
    await expect(page.locator("#state .state-group[data-state-group=execution] > details")).toHaveAttribute("open", "");
    await expect(page.locator("#state .run-role-matrix")).toBeHidden();
    await expect.poll(() => page.evaluate(() => {
      const shell = document.querySelector(".operate-graph-shell")?.getBoundingClientRect();
      const graph = document.querySelector(".operate-graph-main")?.getBoundingClientRect();
      const state = document.querySelector(".operate-graph-sidebar")?.getBoundingClientRect();
      return Boolean(shell && graph && state && graph.width >= shell.width - 2 && state.width >= shell.width - 2 && state.top >= graph.bottom - 1);
    })).toBe(true);
    await expect(page.locator("#run-flow .flow-step")).toBeVisible();
    const roleColorMatch = await page.evaluate(() => {
      const step = document.querySelector<HTMLElement>("#run-flow .flow-step");
      const node = document.querySelector<SVGElement>('#run-graph-root [data-cell-id="demo-analyst"] rect');
      return {
        flow: step?.style.getPropertyValue("--role-accent").toLowerCase() || "",
        graph: node?.getAttribute("stroke")?.toLowerCase() || ""
      };
    });
    expect(roleColorMatch.graph).toBe(roleColorMatch.flow);
    await page.locator('#run-flow [data-flow-role-focus="demo-analyst"]').click();
    await expect(page.locator('#run-flow [data-flow-role="demo-analyst"]')).toHaveClass(/is-role-focus/);
    await page.locator('#run-graph-root [data-cell-id="demo-analyst"]').click();
    await expect(page.locator('#run-flow [data-flow-role="demo-analyst"]')).toHaveClass(/is-role-focus/);
    await expect(page.locator("#console-panel-logs")).toBeHidden();
    await expect(page.locator("#console-panel-artifacts")).toBeHidden();
    await page.getByRole("tab", { name: designTabName }).click();
    await expect(page.locator("#console-panel-build")).toBeVisible();
    await expect(page.locator("#studio-graph-root")).toBeVisible();
    const layoutSelect = page.locator("#studio-graph-root [data-studio-graph-layout]");
    await layoutSelect.selectOption("stacked");
    await expect.poll(async () => page.evaluate(() => {
      const role = document.querySelector('#studio-graph-root [data-cell-id="demo-analyst"]')?.getBoundingClientRect();
      const right = document.querySelector('#studio-graph-root [data-cell-id="output"]')?.getBoundingClientRect();
      return Boolean(role && right && role.top < right.top);
    })).toBe(true);
    await page.getByRole("tab", { name: runTabName }).click();
    await page.getByRole("tab", { name: designTabName }).click();
    await expect(layoutSelect).toHaveValue("flow");
    await expect.poll(async () => page.evaluate(() => {
      const left = document.querySelector('#studio-graph-root [data-cell-id="input"]')?.getBoundingClientRect();
      const role = document.querySelector('#studio-graph-root [data-cell-id="demo-analyst"]')?.getBoundingClientRect();
      const right = document.querySelector('#studio-graph-root [data-cell-id="output"]')?.getBoundingClientRect();
      return Boolean(left && role && right && left.right < role.left && role.right < right.left);
    })).toBe(true);
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

test("Run opens global operations with fixed run-view tabs", async ({ page }) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-run-empty-state-"));
  await seedProject(workdir);
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  try {
    await page.goto(started.url);
    await page.getByRole("tab", { name: await resolveLifecycleTabName(page, ["Operate", "Run"]) }).click();
    await expect(page.locator("#operate-tab-operations")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#console-panel-ops")).toBeVisible();
    await expect(page.locator("#ops-summary")).not.toContainText(/Loading/i);
    await expect(page.locator("#operate-tabs")).toHaveCSS("position", "sticky");
    await expect(page.locator("#console-panel-debug")).not.toHaveCSS("min-height", "100vh");
  } finally {
    await page.close();
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

test("Build opens a real-run form with dry-run disabled by default", async ({ page }) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-real-run-entry-"));
  await seedProject(workdir);
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  try {
    await page.goto(started.url);
    await page.getByRole("tab", { name: await resolveLifecycleTabName(page, ["Build", "Design"]) }).click();
    await page.locator('footer.status-bar.global-status [data-workbench-view="bridge"]').click();
    const debugPanel = page.locator('[data-studio-selection-panel="debug"]');
    await page.locator('[data-studio-side-tab="debug"]').click();
    await debugPanel.locator("#workbench-run-input").fill("bounded UAT prompt");
    await debugPanel.locator("#workbench-start-real-run").click();
    await expect(page.locator("#action-form-section")).toBeVisible();
    await expect(page.locator("#action-start-dry-run")).toHaveValue("false");
    await expect(page.locator("#action-run-prompt")).toHaveValue("bounded UAT prompt");
  } finally {
    await page.close();
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

test("unconfigured contracts initialize in place and open the contract editor", async ({ page }) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-contract-initialize-"));
  await seedProject(workdir);
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  try {
    await page.goto(started.url);
    await page.getByRole("tab", { name: await resolveLifecycleTabName(page, ["Build", "Design"]) }).click();
    await page.locator('footer.status-bar.global-status [data-workbench-view="bridge"]').click();
    const structurePanel = page.locator('[data-studio-selection-panel="structure"]');
    await structurePanel.locator(".studio-contract-editor summary").click();
    await expect(structurePanel.locator("[data-contract-default-path]")).toHaveText("contracts/handoff.contracts.json");
    await structurePanel.locator("[data-contract-initialize]").click();
    await expect(structurePanel.locator(".studio-contract-editor")).toHaveAttribute("open", "");
    await expect(structurePanel.locator("[data-contract-add]")).toBeVisible();
    await expect(structurePanel.locator("[data-contract-manifest-save]")).toBeVisible();
    await expect(structurePanel.locator(".studio-system-settings [data-system-setting='handoffMode']")).toHaveValue("transition");
  } finally {
    await page.close();
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

test("Design shows the latest dry-run trace and keeps it separate from Run selection", async ({ page }) => {
  test.setTimeout(60000);
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-design-debug-trace-"));
  await seedProject(workdir);
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  try {
    await page.goto(started.url);
    await page.getByRole("tab", { name: await resolveLifecycleTabName(page, ["Build", "Design"]) }).click();
    const debugPanel = page.locator('[data-studio-selection-panel="debug"]');
    await page.locator('[data-studio-side-tab="debug"]').click();
    await debugPanel.locator("#workbench-run-input").fill("design trace UAT");
    await debugPanel.locator("#workbench-start-run").click();

    await expect.poll(async () => page.evaluate(async () => {
      const response = await fetch("/api/v1/runs");
      const payload = await response.json();
      return payload.runs?.find((run) => run.isSimulation === true)?.runId || "";
    }), { timeout: 30000 }).not.toBe("");
    const runId = await page.evaluate(async () => {
      const response = await fetch("/api/v1/runs");
      const payload = await response.json();
      return payload.runs.find((run) => run.isSimulation === true).runId;
    });

    await expect(debugPanel).toContainText(runId, { timeout: 15000 });
    await expect(debugPanel.locator("[data-studio-debug-summary]")).toBeVisible();
    await expect(debugPanel.locator(".studio-debug-trace-list")).toBeVisible();
    await expect.poll(async () => debugPanel.locator(".studio-debug-trace-list").evaluate((element) =>
      element.scrollWidth <= element.clientWidth + 1
    )).toBe(true);
    await debugPanel.locator("#studio-logs-load-raw").click();
    await expect(debugPanel).toContainText(/Raw engine and role streams/);

    await page.getByRole("tab", { name: await resolveLifecycleTabName(page, ["Operate", "Run"]) }).click();
    await expect(page.locator("#sidebar")).toBeVisible();
    const runListItem = page.locator(`#sidebar [data-run-id="${runId}"]`);
    await expect(runListItem).toBeVisible();
    await runListItem.click();
    await expect(page.locator("#run-flow .flow-step")).toBeVisible();
    await expect(page.locator("#operate-tab-overview")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#run-flow")).toContainText("design trace UAT");
    await expect(page.locator("#run-flow .flow-step").first()).toHaveCSS("border-left-color", /\d+, \d+, \d+/);
    await expect(page.locator("body")).toHaveClass(/has-selected-run/);
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => {
        const flow = document.getElementById("run-flow");
        const firstStep = flow?.querySelector(".flow-step");
        const sections = firstStep ? [...firstStep.querySelectorAll(".flow-step-io > section")] : [];
        const boxes = sections.map((section) => section.getBoundingClientRect());
        const overlap = boxes.some((box, index) => boxes.slice(index + 1).some((other) =>
          box.right > other.left && box.left < other.right && box.bottom > other.top && box.top < other.bottom
        ));
        return Boolean(flow && firstStep && flow.scrollWidth <= flow.clientWidth + 1 && !overlap);
      })).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator("#run-graph-disclosure")).not.toHaveAttribute("open", "");
    await page.locator("#run-graph-disclosure > summary").click();
    await expect(page.locator("#run-graph-root")).toBeVisible();
    await page.locator("#operate-tab-operations").click();
    await expect(page.locator("#ops-summary .ops-attention-group")).toBeVisible();
    await expect(page.locator("#ops-summary details[open]")).toHaveCount(0);
    await expect(page.locator("#failure-summary")).toBeVisible();
    await expect(page.locator("#resume-readiness")).toBeVisible();
    await expect(page.locator("#reviews")).toBeVisible();
    await expect(page.locator("#failure-detail-disclosure")).not.toHaveAttribute("open", "");
    await expect(page.locator("#failure-next-checks-disclosure")).not.toHaveAttribute("open", "");
    await expect.poll(() => page.evaluate(() => {
      const summary = document.getElementById("console-panel-ops")?.getBoundingClientRect();
      const debug = document.getElementById("console-panel-debug")?.getBoundingClientRect();
      const evidence = document.querySelector(".operate-evidence-disclosure")?.getBoundingClientRect();
      return Boolean(debug && summary && evidence && summary.bottom <= debug.top + 1 && evidence.top >= debug.bottom - 1);
    })).toBe(true);
    await expect(page.locator(".operate-evidence-disclosure")).not.toHaveAttribute("open", "");
    await expect(page.locator("#console-panel-logs")).toBeHidden();
    await expect(page.locator("#console-panel-artifacts")).toBeHidden();
    await page.locator(".operate-evidence-disclosure > summary").click();
    await expect(page.locator("#console-panel-logs")).toBeVisible();
    await expect(page.locator("#console-panel-artifacts")).toBeVisible();
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.locator("#ops-summary .ops-summary-layout").evaluate((element) =>
        element.scrollWidth <= element.clientWidth + 1
      )).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("tab", { name: await resolveLifecycleTabName(page, ["Build", "Design"]) }).click();
    await page.locator('[data-studio-side-tab="debug"]').click();
    await expect(debugPanel).toContainText(runId);
    await expect(debugPanel.locator(".studio-debug-trace-list")).toBeVisible();
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
    await expect(page.locator('[data-studio-side-tab="structure"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-studio-bridge-filter]")).toBeVisible();
    await expect(page.locator("[data-studio-role-id]")).toHaveCount(1);
    await expect(page.getByText(/\bX6\b/)).toHaveCount(0);
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

test("SCC container drag moves every member node with the container", async ({ page }) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-studio-scc-drag-"));
  await seedCyclicProject(workdir);
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  try {
    await page.goto(started.url);
    await page.waitForFunction(() => Boolean((window as any).OGSVisualizerClient?.mountStudioX6Bridge));
    await page.locator("#console-tab-design").click();
    await page.locator('[data-workbench-view="bridge"]').click();
    await waitForStudioCell(page, "demo-analyst");
    await waitForStudioCell(page, "demo-intake");

    const group = page.locator('#studio-graph-root [data-cell-id^="__ogs-scc-"]').first();
    await expect(group).toBeVisible();
    await expect(page.locator('#studio-graph-root [data-cell-id="input"]')).toHaveCount(1);
    await expect(page.locator('#studio-graph-root [data-cell-id="output"]')).toHaveCount(1);
    await expect.poll(async () => page.locator("#studio-graph-root .x6-edge-label text").allTextContents())
      .toEqual(expect.arrayContaining(["#3L", "#4L"]));
    await expect(page.locator('#studio-graph-root .x6-edge.is-loop-back')).toHaveCount(2);
    await expect.poll(async () => page.evaluate(() => Array.from(
      document.querySelectorAll<SVGGElement>('#studio-graph-root .x6-edge.is-loop-back')
    ).map((edge) => {
      const path = edge.querySelector<SVGPathElement>('path[marker-end]');
      const connection = edge.querySelector<SVGPathElement>('path[marker-end]')
        || edge.querySelector<SVGPathElement>('.connection');
      const style = connection ? getComputedStyle(connection) : null;
      return {
        hasTargetMarker: Boolean(path?.getAttribute("marker-end")),
        dashed: Boolean(style && style.strokeDasharray !== "none"),
        strokeWidth: Number.parseFloat(style?.strokeWidth || "0")
      };
    }))).toEqual([
      { hasTargetMarker: true, dashed: true, strokeWidth: 2.6 },
      { hasTargetMarker: true, dashed: true, strokeWidth: 2.6 }
    ]);
    const loopMarkerReferenceOffsets = await page.evaluate(() => Array.from(
      document.querySelectorAll<SVGGElement>('#studio-graph-root .x6-edge.is-loop-back')
    ).map((edge) => {
      const path = edge.querySelector<SVGPathElement>('path[marker-end]');
      const markerId = path?.getAttribute("marker-end")?.match(/#([^)]*)/)?.[1];
      const marker = markerId ? document.getElementById(markerId) : null;
      return Number.parseFloat(marker?.getAttribute("refX") || "NaN");
    }));
    expect(loopMarkerReferenceOffsets).toEqual([-16 / 6, -16 / 6]);
    await expect.poll(async () => page.evaluate(() => Array.from(
      document.querySelectorAll<SVGGElement>('#studio-graph-root .x6-edge.is-loop-back')
    ).map((edge) => {
      const path = edge.querySelector<SVGPathElement>('path[marker-end]');
      const matrix = path?.getScreenCTM();
      if (!path || !matrix || path.getTotalLength() < 8) return false;
      const length = path.getTotalLength();
      const endpointPoint = path.getPointAtLength(length);
      const beforePoint = path.getPointAtLength(length - 6);
      const endpoint = new DOMPoint(endpointPoint.x, endpointPoint.y).matrixTransform(matrix);
      const before = new DOMPoint(beforePoint.x, beforePoint.y).matrixTransform(matrix);
      const nodes = Array.from(document.querySelectorAll<HTMLElement>("#studio-graph-root .x6-node:not([data-cell-id^='__ogs-scc-'])"));
      const distanceToRect = (point: DOMPoint, rect: DOMRect) => Math.hypot(
        Math.max(rect.left - point.x, 0, point.x - rect.right),
        Math.max(rect.top - point.y, 0, point.y - rect.bottom)
      );
      const target = nodes.map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .sort((left, right) => distanceToRect(endpoint, left.rect) - distanceToRect(endpoint, right.rect))[0];
      if (!target) return false;
      const rect = target.rect;
      const side = [
        { side: "left", value: Math.abs(endpoint.x - rect.left) },
        { side: "right", value: Math.abs(endpoint.x - rect.right) },
        { side: "top", value: Math.abs(endpoint.y - rect.top) },
        { side: "bottom", value: Math.abs(endpoint.y - rect.bottom) }
      ].sort((left, right) => left.value - right.value)[0].side;
      const dx = endpoint.x - before.x;
      const dy = endpoint.y - before.y;
      const normal = side === "left" || side === "right" ? Math.abs(dx) : Math.abs(dy);
      const tangent = side === "left" || side === "right" ? Math.abs(dy) : Math.abs(dx);
      const inwardX = rect.x + rect.width / 2 - endpoint.x;
      const inwardY = rect.y + rect.height / 2 - endpoint.y;
      return distanceToRect(endpoint, rect) <= 4 && normal > 0 && tangent / normal < 0.15 && dx * inwardX + dy * inwardY > 0;
    }))).toEqual([true, true]);

    const before = await page.evaluate(() => {
      const cellBox = (id: string) => {
        const cell = document.querySelector<HTMLElement>(id === "__ogs-scc-"
          ? '#studio-graph-root [data-cell-id^="__ogs-scc-"]'
          : `#studio-graph-root [data-cell-id="${id}"]`);
        const transform = cell?.getAttribute("transform") || "";
        const match = transform.match(/translate\(([-\d.]+)[ ,]([-\d.]+)\)/);
        return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
      };
      return {
        group: cellBox("__ogs-scc-"),
        analyst: cellBox("demo-analyst"),
        intake: cellBox("demo-intake")
      };
    });
    expect(before.group).toBeTruthy();
    expect(before.analyst).toBeTruthy();
    expect(before.intake).toBeTruthy();
    if (!before.group || !before.analyst || !before.intake) return;

    const groupBounds = await group.boundingBox();
    expect(groupBounds).toBeTruthy();
    if (!groupBounds) return;
    const dragStart = { x: groupBounds.x + 8, y: groupBounds.y + groupBounds.height / 2 };
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragStart.x + 72, dragStart.y + 36, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => page.evaluate((initial) => {
      const cellBox = (id: string) => {
        const cell = document.querySelector<HTMLElement>(id === "__ogs-scc-"
          ? '#studio-graph-root [data-cell-id^="__ogs-scc-"]'
          : `#studio-graph-root [data-cell-id="${id}"]`);
        const transform = cell?.getAttribute("transform") || "";
        const match = transform.match(/translate\(([-\d.]+)[ ,]([-\d.]+)\)/);
        return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
      };
      const after = {
        group: cellBox("__ogs-scc-"),
        analyst: cellBox("demo-analyst"),
        intake: cellBox("demo-intake")
      };
      if (!after.group || !after.analyst || !after.intake) return false;
      const groupDelta = { x: after.group.x - initial.group.x, y: after.group.y - initial.group.y };
      const analystDelta = { x: after.analyst.x - initial.analyst.x, y: after.analyst.y - initial.analyst.y };
      const intakeDelta = { x: after.intake.x - initial.intake.x, y: after.intake.y - initial.intake.y };
      return groupDelta.x > 45 && groupDelta.y > 15
        && Math.abs(groupDelta.x - analystDelta.x) <= 3
        && Math.abs(groupDelta.y - analystDelta.y) <= 3
        && Math.abs(groupDelta.x - intakeDelta.x) <= 3
        && Math.abs(groupDelta.y - intakeDelta.y) <= 3;
    }, before)).toBe(true);
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

test("Studio graph toolbar and context menus are localized in Chinese", async ({ page }) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-studio-zh-graph-"));
  await seedProject(workdir);
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  try {
    await page.goto(`${started.url}?lang=zh-CN`);
    await page.waitForFunction(() => Boolean((window as any).OGSVisualizerClient?.mountStudioX6Bridge));
    await page.locator("#console-tab-design").click();
    await page.locator('[data-workbench-view="bridge"]').click();
    await waitForStudioCell(page, "demo-analyst");

    const topologyOrder = page.locator('#studio-graph-root [data-studio-graph-action="topology-order"]');
    await expect(topologyOrder).toContainText("拓扑序号");
    await expect(topologyOrder).toHaveAttribute("title", /隐藏拓扑序号|显示拓扑序号/);

    await page.locator('#studio-graph-root [data-cell-id="demo-analyst"]').click({ button: "right" });
    const contextMenu = page.locator("#studio-graph-root [data-studio-graph-context-menu]");
    await expect(contextMenu).toBeVisible();
    await expect(contextMenu).toContainText("编辑");
    await expect(contextMenu).toContainText("删除");

    await page.locator('#studio-graph-root .x6-edge path[marker-end]').first().click({ button: "right", force: true });
    await expect(contextMenu).toContainText("插入角色");
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
            modelRef: "openai/gpt-5-nano"
          },
          "qa-reviewer": {
            roleId: "qa-reviewer",
            title: "QA Reviewer",
            bindingKind: "model",
            modelRef: "openai/gpt-5-nano"
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
    await expect(page.locator('#studio-graph-direct-root [data-studio-graph-action="topology-order"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#studio-graph-direct-root [data-cell-id=\"demo-analyst\"]")).toBeVisible();
    await expect(page.locator("#studio-graph-direct-root [data-studio-graph-minimap]")).toBeVisible();
    await expect(page.locator("#studio-graph-direct-root [data-minimap-role-id=\"demo-analyst\"]")).toBeVisible();
    const directGraph = page.locator("#studio-graph-direct-root");
    await expect.poll(async () => directGraph.evaluate((root) => {
      const topologyLabels = Array.from(root.querySelectorAll(".x6-edge-label text"))
        .map((element) => element.textContent?.trim() || "")
        .filter((text) => /^#/.test(text));
      const edgePath = root.querySelector('[data-cell-id="flow.demo-qa"] path[marker-end]');
      return {
        topologyLabels,
        hasTargetMarker: Boolean(edgePath?.getAttribute("marker-end"))
      };
    })).toEqual({
      topologyLabels: expect.arrayContaining([expect.stringMatching(/^#/)]),
      hasTargetMarker: true
    });

    await directGraph.locator('[data-studio-graph-action="topology-order"]').evaluate((button) => button.click());
    await expect(directGraph.locator('[data-studio-graph-action="topology-order"]')).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => directGraph.evaluate((root) => Array.from(root.querySelectorAll(".x6-edge-label text"))
      .some((element) => /^#/.test(element.textContent?.trim() || "")))).toBe(false);
    await directGraph.locator('[data-studio-graph-action="topology-order"]').evaluate((button) => button.click());
    await expect(directGraph.locator('[data-studio-graph-action="topology-order"]')).toHaveAttribute("aria-pressed", "true");

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

test("fan-out projection uses nearby ports without replacing business edges", async ({ page }) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-studio-bundle-"));
  await seedProject(workdir);
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  test.info().annotations.push({ type: "server", description: started.url });
  try {
    await page.goto(started.url);
    await page.waitForFunction(() => Boolean((window as any).OGSVisualizerClient?.mountStudioX6Bridge));
    await page.evaluate(() => {
      const root = document.createElement("div");
      root.id = "studio-graph-bundle-root";
      root.style.width = "960px";
      root.style.height = "560px";
      document.body.appendChild(root);
      const roles = ["source", "left", "right"];
      const authoring = {
        project: { workdir: "/tmp/bundle", systemPath: "system.mmd" },
        system: { systemId: "viz.bundle", systemVersion: "1.0.0", entryRoleId: "source", lawGlobal: "law.minimal.base" },
        roles: Object.fromEntries(roles.map((roleId) => [roleId, {
          roleId,
          title: roleId,
          bindingKind: "model",
          modelRef: "openai/gpt-5-nano"
        }])),
        flows: {
          "flow.source.left": { flowId: "flow.source.left", fromRoleId: "source", toRoleId: "left", eventType: "LEFT", label: "left" },
          "flow.source.right": { flowId: "flow.source.right", fromRoleId: "source", toRoleId: "right", eventType: "RIGHT", label: "right" }
        },
        layout: {
          nodes: {
            source: { x: 120, y: 210, width: 190, height: 90 },
            left: { x: 460, y: 120, width: 190, height: 90 },
            right: { x: 460, y: 330, width: 190, height: 90 }
          },
          viewport: { x: 0, y: 0, zoom: 1 }
        }
      };
      const canvas = {
        nodes: roles.map((roleId) => ({ id: roleId, roleId, x: authoring.layout.nodes[roleId].x, y: authoring.layout.nodes[roleId].y, width: 190, height: 90, label: roleId, bindingKind: "model", badges: [] })),
        edges: [
          { id: "flow.source.left", source: "source", target: "left", eventType: "LEFT", label: "left" },
          { id: "flow.source.right", source: "source", target: "right", eventType: "RIGHT", label: "right" }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      };
      (window as any).OGSVisualizerClient.mountStudioX6Bridge(root, {
        authoring,
        canvas,
        validation: { ok: true, diagnostics: [] },
        defaultAutoLayout: false
      });
    });
    const root = page.locator("#studio-graph-bundle-root");
    await expect(root.locator('[data-cell-id="flow.source.left"]')).toBeVisible();
    await expect(root.locator('[data-cell-id="flow.source.right"]')).toBeVisible();
    await expect(root.locator('[data-cell-id^="__ogs-layout-bundle:"]')).toHaveCount(0);
    await expect(root.locator('[data-cell-id^="__ogs-layout-junction:"]')).toHaveCount(0);
    await expect(root.locator('[data-cell-id="source"] [data-studio-port="out"]')).toHaveCount(2);
    await expect(root.locator('[data-cell-id="source"] [data-studio-port="out"]').first()).toHaveAttribute("r", "4");
    await expect.poll(async () => root.evaluate((element) => {
      return ["flow.source.left", "flow.source.right"].map((edgeId) => {
        const path = element.querySelector<SVGPathElement>(`[data-cell-id="${edgeId}"] path[marker-end]`);
        const targetId = edgeId === "flow.source.left" ? "left" : "right";
        const sourcePorts = element.querySelectorAll<SVGElement>('[data-cell-id="source"] [data-studio-port="out"]');
        const targetPorts = element.querySelectorAll<SVGElement>(`[data-cell-id="${targetId}"] [data-studio-port="in"]`);
        if (!path || sourcePorts.length === 0 || targetPorts.length === 0) {
          return { edgeId, hasTargetMarker: false, hasVisibleTerminalSegment: false, sourcePortAttached: false, targetPortAttached: false };
        }
        const length = path.getTotalLength();
        const matrix = path.getScreenCTM();
        if (!matrix) return { edgeId, hasTargetMarker: false, hasVisibleTerminalSegment: false, sourcePortAttached: false, targetPortAttached: false };
        const toScreen = (distance: number) => {
          const point = path.getPointAtLength(distance);
          return new DOMPoint(point.x, point.y).matrixTransform(matrix);
        };
        const start = toScreen(0);
        const end = toScreen(length);
        const afterStart = toScreen(Math.min(4, length));
        const beforeTarget = toScreen(Math.max(0, length - 4));
        const beforeEnd = toScreen(Math.max(0, length - 10));
        const distanceToPortRim = (ports: NodeListOf<SVGElement>, point: DOMPoint) => Math.min(...Array.from(ports, (port) => {
          const bounds = port.getBoundingClientRect();
          const radius = Math.min(bounds.width, bounds.height) / 2;
          const centerX = bounds.left + bounds.width / 2;
          const centerY = bounds.top + bounds.height / 2;
          return Math.abs(Math.hypot(point.x - centerX, point.y - centerY) - radius);
        }));
        const outwardDot = (ports: NodeListOf<SVGElement>, endpoint: DOMPoint, next: DOMPoint) => {
          const centers = Array.from(ports, (port) => {
            const bounds = port.getBoundingClientRect();
            return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
          });
          const center = centers.sort((left, right) =>
            Math.hypot(endpoint.x - left.x, endpoint.y - left.y) - Math.hypot(endpoint.x - right.x, endpoint.y - right.y)
          )[0];
          if (!center) return -1;
          const radialX = endpoint.x - center.x;
          const radialY = endpoint.y - center.y;
          const tangentX = next.x - endpoint.x;
          const tangentY = next.y - endpoint.y;
          const lengths = Math.hypot(radialX, radialY) * Math.hypot(tangentX, tangentY);
          return lengths ? (radialX * tangentX + radialY * tangentY) / lengths : -1;
        };
        return {
          edgeId,
          hasTargetMarker: Boolean(path.getAttribute("marker-end")),
          hasVisibleTerminalSegment: Math.hypot(end.x - beforeEnd.x, end.y - beforeEnd.y) >= 8,
          sourcePortAttached: distanceToPortRim(sourcePorts, start) <= 2,
          targetPortAttached: distanceToPortRim(targetPorts, end) <= 2,
          sourceLeavesPortNormally: outwardDot(sourcePorts, start, afterStart) > 0.95,
          targetEntersPortNormally: outwardDot(targetPorts, end, beforeTarget) > 0.95
        };
      });
    })).toEqual([
      { edgeId: "flow.source.left", hasTargetMarker: true, hasVisibleTerminalSegment: true, sourcePortAttached: true, targetPortAttached: true, sourceLeavesPortNormally: true, targetEntersPortNormally: true },
      { edgeId: "flow.source.right", hasTargetMarker: true, hasVisibleTerminalSegment: true, sourcePortAttached: true, targetPortAttached: true, sourceLeavesPortNormally: true, targetEntersPortNormally: true }
    ]);
    const markerReferenceOffsets = await root.evaluate((element) =>
      ["flow.source.left", "flow.source.right"].map((edgeId) => {
        const path = element.querySelector<SVGPathElement>(`[data-cell-id="${edgeId}"] path[marker-end]`);
        const markerId = path?.getAttribute("marker-end")?.match(/#([^)]*)/)?.[1];
        const marker = markerId ? document.getElementById(markerId) : null;
        return Number.parseFloat(marker?.getAttribute("refX") || "NaN");
      })
    );
    expect(markerReferenceOffsets).toEqual([-12 / 6, -12 / 6]);
    await expect.poll(async () => root.evaluate((element) =>
      Array.from(element.querySelectorAll("[data-cell-id]")).filter((cell) => {
        const id = cell.getAttribute("data-cell-id") || "";
        return id === "flow.source.left" || id === "flow.source.right";
      }).length
    )).toBe(2);
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

test("contract workspace supports keyboard editing and validation on a narrow viewport", async ({ page }) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-studio-contract-uat-"));
  await seedContractProject(workdir);
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(started.url);
    const designTabName = await resolveLifecycleTabName(page, ["Build", "Design"]);
    await page.getByRole("tab", { name: designTabName }).click();
    await page.locator('footer.status-bar.global-status [data-workbench-view="bridge"]').click();
    await expect(page.locator('[data-studio-side-tab="structure"]')).toHaveAttribute("aria-pressed", "true");
    const systemSettings = page.locator(".studio-system-settings");
    await expect(systemSettings).toBeVisible();
    await systemSettings.locator("summary").focus();
    await page.keyboard.press("Enter");
    const contractEditor = page.locator(".studio-contract-editor");
    await expect(contractEditor).toBeVisible();
    await expect(contractEditor).toContainText("0 / 1 eligible flows covered");
    await expect(contractEditor.locator("tbody tr").first()).toContainText("missing");
    await contractEditor.locator("summary").first().focus();
    await page.keyboard.press("Enter");
    await expect(contractEditor.locator("[data-contract-row]")).toHaveCount(1);
    const schemaDisclosure = contractEditor.locator("details").filter({ has: page.locator("[data-contract-file-content]") });
    await schemaDisclosure.locator("summary").focus();
    await page.keyboard.press("Enter");
    const schemaEditor = contractEditor.locator("[data-contract-file-editor]");
    const schemaInput = schemaEditor.locator("[data-contract-file-content]");
    await schemaInput.focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.type("{");
    await schemaEditor.locator("[data-contract-file-save]").focus();
    await page.keyboard.press("Enter");
    await expect(schemaEditor.locator("[data-contract-save-error]")).not.toBeEmpty();
    await expect(schemaInput).toHaveValue("{");
    const validSchema = JSON.stringify({
      type: "object",
      properties: { request: { type: "string" }, priority: { type: "integer" } },
      required: ["request"],
      additionalProperties: false
    }, null, 2);
    await schemaInput.fill(validSchema);
    await schemaEditor.locator("[data-contract-file-save]").focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => readFile(path.resolve(workdir, ".ogs/contracts/analyst-input.schema.json"), "utf8")
      .then((content) => content.trim()).catch(() => ""))
      .toBe(validSchema);
    await expect.poll(() => schemaInput.inputValue().then((content) => content.trim())).toBe(validSchema);
    await contractEditor.locator("summary").first().focus();
    await page.keyboard.press("Enter");
    await expect(contractEditor).toHaveAttribute("open", "");
    const contractId = contractEditor.locator('[data-contract-property="id"]');
    await contractId.fill("analyst.input.v2");
    await contractEditor.locator("[data-contract-manifest-save]").focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => readFile(path.resolve(workdir, ".ogs/contracts/handoff.contracts.json"), "utf8")
      .then(JSON.parse).then((manifest) => manifest.contracts[0].id).catch(() => ""))
      .toBe("analyst.input.v2");
    await expect(contractEditor).toContainText("0 / 1 eligible flows covered");
    if (!(await contractEditor.getAttribute("open"))) {
      await contractEditor.locator("summary").first().focus();
      await page.keyboard.press("Enter");
    }
    await contractEditor.locator("[data-contract-add]").focus();
    await page.keyboard.press("Enter");
    const flowContract = contractEditor.locator("[data-contract-row]").last();
    await expect(flowContract.locator('[data-contract-property="id"]')).toBeFocused();
    await flowContract.locator('[data-contract-property="id"]').fill("analyst-to-intake.v1");
    await flowContract.locator('[data-contract-property="fromRoleId"]').fill("demo-analyst");
    await flowContract.locator('[data-contract-property="eventType"]').fill("ANALYSIS_DONE");
    await flowContract.locator('[data-contract-property="toRoleId"]').fill("demo-intake");
    await flowContract.locator('[data-contract-property="schema"]').fill("analyst-input.schema.json");
    await contractEditor.locator("[data-contract-manifest-save]").focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => readFile(path.resolve(workdir, ".ogs/contracts/handoff.contracts.json"), "utf8")
      .then(JSON.parse).then((manifest) => manifest.contracts.map((entry: { id: string }) => entry.id)).catch(() => []))
      .toEqual(["analyst.input.v2", "analyst-to-intake.v1"]);
    await expect(contractEditor).toContainText("1 / 1 eligible flows covered");
    const workspaceWidth = await page.locator("#studio-graph-root").evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth
    }));
    expect(workspaceWidth.scroll).toBeLessThanOrEqual(workspaceWidth.client + 1);
    const contractWidth = await contractEditor.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth
    }));
    expect(contractWidth.scroll).toBeLessThanOrEqual(contractWidth.client + 1);
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

test("mapping UAT covers nested direct and Join sources plus quorum source gating", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-studio-mapping-uat-"));
  await seedComplexMappingProject(workdir);
  const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
  try {
    await page.goto(started.url);
    const designTabName = await resolveLifecycleTabName(page, ["Build", "Design"]);
    await page.getByRole("tab", { name: designTabName }).click();
    await page.locator('footer.status-bar.global-status [data-workbench-view="bridge"]').click();
    await expect(page.locator('[data-studio-side-tab="structure"]')).toHaveAttribute("aria-pressed", "true");
    const authoringDraftPath = path.resolve(workdir, ".ogs/studio/system.authoring.json");
    const rolesSection = page.locator("[data-studio-role-list-section]");
    if (!(await rolesSection.getAttribute("open"))) await rolesSection.locator("summary").click();
    await page.locator('[data-studio-role-id="demo-analyst"]').click();
    const analystEditor = page.locator('[data-role-config-editor="demo-analyst"]');
    await expect(analystEditor).toBeVisible();
    await analystEditor.locator("[data-context-map-add]").click();
    await analystEditor.locator("[data-context-map-target]").last().fill("issueId");
    await analystEditor.locator("[data-context-map-selector]").last().selectOption("direct.data");
    await analystEditor.locator("[data-context-map-path]").last().fill("issue.id");
    await expect(analystEditor.locator("[data-context-map-path]").last()).toHaveValue("issue.id");
    await analystEditor.locator("[data-context-map-path]").last().press("Tab");
    await expect(analystEditor.locator("[data-context-map-preview]")).toContainText("direct.data.issue.id");
    await expect(analystEditor.locator("[data-context-map-path]").last()).toHaveAttribute("data-bound-context-map-path-edit", "true");
    await expect(analystEditor.locator("[data-context-map-path]").last()).toHaveAttribute("aria-invalid", "false");
    await expect(analystEditor.locator("[data-context-map-optional]").last()).toBeDisabled();
    await analystEditor.locator("[data-role-config-save='demo-analyst']").click();
    await expect.poll(async () => readFile(authoringDraftPath, "utf8").then(JSON.parse).catch(() => null)).toMatchObject({
      roles: { "demo-analyst": { contextMap: { issueId: "direct.data.issue.id" } } }
    });
    const analystPath = analystEditor.locator("[data-context-map-path]").last();
    await analystPath.fill("issue..id");
    await expect(analystPath).toHaveAttribute("aria-invalid", "true");
    await analystEditor.locator("[data-role-config-save='demo-analyst']").click();
    await expect(analystEditor).toContainText("The composed Selector direct.data.issue..id is invalid.");
    await expect.poll(async () => readFile(authoringDraftPath, "utf8").then(JSON.parse).catch(() => null)).toMatchObject({
      roles: { "demo-analyst": { contextMap: { issueId: "direct.data.issue.id" } } }
    });
    await analystPath.fill(".issue.id.");
    await expect(analystPath).toHaveAttribute("aria-invalid", "true");
    await analystEditor.locator("[data-role-config-save='demo-analyst']").click();
    await expect(analystEditor).toContainText("The composed Selector direct.data..issue.id. is invalid.");
    await expect.poll(async () => readFile(authoringDraftPath, "utf8").then(JSON.parse).catch(() => null)).toMatchObject({
      roles: { "demo-analyst": { contextMap: { issueId: "direct.data.issue.id" } } }
    });
    await analystEditor.locator("[data-context-map-selector]").last().selectOption("direct.content");
    await analystPath.fill("issue.id");
    await expect(analystPath).toHaveAttribute("aria-invalid", "true");
    await analystEditor.locator("[data-role-config-save='demo-analyst']").click();
    await expect(analystEditor).toContainText("The composed Selector direct.content.issue.id is invalid.");
    await expect.poll(async () => readFile(authoringDraftPath, "utf8").then(JSON.parse).catch(() => null)).toMatchObject({
      roles: { "demo-analyst": { contextMap: { issueId: "direct.data.issue.id" } } }
    });
    await analystEditor.locator("[data-context-map-selector]").last().selectOption("direct.data");
    await analystPath.fill("issue.id");
    await analystEditor.locator("[data-role-config-save='demo-analyst']").click();
    await expect.poll(async () => readFile(authoringDraftPath, "utf8").then(JSON.parse).catch(() => null)).toMatchObject({
      roles: { "demo-analyst": { contextMap: { issueId: "direct.data.issue.id" } } }
    });
    await page.locator('[data-studio-selection-back]').click();
    if (!(await rolesSection.getAttribute("open"))) await rolesSection.locator("summary").click();
    await page.locator('[data-studio-role-id="test-operator"]').click();
    const reviewerEditor = page.locator('[data-role-config-editor="test-operator"]');
    await expect(reviewerEditor).toBeVisible();
    await expect(reviewerEditor.locator('[data-role-setting="joinMode"]')).toHaveValue("all_of");
    await reviewerEditor.locator("[data-context-map-add]").click();
    await reviewerEditor.locator("[data-context-map-target]").last().fill("reviewSummary");
    const joinSelector = reviewerEditor.locator("[data-context-map-selector]").last();
    await expect(joinSelector.locator('option[value="source(demo-analyst).data"]')).toHaveCount(1);
    await expect(joinSelector.locator('option[value="source(demo-intake).data"]')).toHaveCount(1);
    await expect(joinSelector.locator('option[value="direct.data"]')).toHaveCount(0);
    await joinSelector.selectOption("source(demo-intake).data");
    await expect(joinSelector).toHaveValue("source(demo-intake).data");
    await reviewerEditor.locator("[data-context-map-path]").last().fill("result.summary");
    expect(pageErrors).toEqual([]);
    await expect(reviewerEditor.locator("[data-context-map-path]").last()).toHaveAttribute("aria-invalid", "false");
    await expect(reviewerEditor.locator("[data-context-map-preview]")).toContainText("source(demo-intake).data.result.summary");
    await expect(reviewerEditor.locator("[data-context-map-optional]").last()).toBeDisabled();
    await reviewerEditor.locator("[data-role-config-save='test-operator']").click();
    await expect.poll(async () => readFile(authoringDraftPath, "utf8").then(JSON.parse).catch(() => null)).toMatchObject({
      roles: { "test-operator": { contextMap: { reviewSummary: "source(demo-intake).data.result.summary" } } }
    });
    const savedAuthoring = JSON.parse(await readFile(authoringDraftPath, "utf8"));
    const generateResponse = await page.request.post(new URL("/api/v1/project/studio/authoring/generate-mmd", started.url).toString(), {
      data: { authoring: savedAuthoring }
    });
    expect(generateResponse.status()).toBe(200);
    const generated = await generateResponse.json();
    expect(generated.validation?.ok).toBe(true);
    const generatedContextMapLines = generated.systemSource.split(/\r?\n/).filter((line: string) => line.startsWith("%% context.map."));
    const expectedContextMapLines = Object.entries(savedAuthoring.roles).flatMap(([roleId, role]: [string, { contextMap?: Record<string, string> }]) =>
      Object.entries(role.contextMap || {}).map(([field, selector]) => `%% context.map.${roleId}.${field}=${selector}`)
    ).sort();
    expect(generatedContextMapLines.sort()).toEqual(expectedContextMapLines);
    const importResponse = await page.request.post(new URL("/api/v1/project/studio/authoring/import-mmd", started.url).toString(), {
      data: { systemSource: generated.systemSource, systemPath: "system.mmd" }
    });
    expect(importResponse.status()).toBe(200);
    const imported = await importResponse.json();
    expect(Object.fromEntries(Object.entries(imported.authoring.roles).map(([roleId, role]: [string, { contextMap?: Record<string, string> }]) => [roleId, role.contextMap || {}]))).toEqual(
      Object.fromEntries(Object.entries(savedAuthoring.roles).map(([roleId, role]: [string, { contextMap?: Record<string, string> }]) => [roleId, role.contextMap || {}]))
    );
    await reviewerEditor.locator('[data-role-setting="joinMode"]').selectOption("quorum_of");
    await reviewerEditor.locator('[data-role-setting="joinMin"]').fill("1");
    await expect(reviewerEditor.locator("[data-context-map-selector]").last().locator('option[value="source(demo-intake).data"]')).toHaveAttribute("disabled", "");
    await expect(reviewerEditor.locator("[data-context-map-selector]").last().locator('option[value="source(demo-analyst).data"]')).toHaveCount(0);
    await expect(reviewerEditor.locator("[data-context-map-optional]").last()).toBeDisabled();
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

test("deployed visualizer UAT keeps flow layout, browse return, and wheel zoom working", async ({ page }) => {
  const baseUrl = process.env.OGS_VISUALIZER_BASE_URL;
  test.skip(!baseUrl, "Set OGS_VISUALIZER_BASE_URL to run against an installed release.");
  const pageErrors: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) {
      pageErrors.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "unknown";
    if (errorText !== "net::ERR_ABORTED" || !request.url().includes("/stream?")) {
      pageErrors.push(`Request failed ${request.url()}: ${errorText}`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      pageErrors.push(`${message.text()} (${location.url || "unknown source"}:${location.lineNumber})`);
    }
  });

  await page.goto(baseUrl!);
  await expect(page.locator("#console-panel-project")).toBeVisible();
  await page.locator('[data-console-tab="run"]').click();
  await expect(page.locator("#operate-tab-operations")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#console-panel-ops")).toBeVisible();
  await expect(page.locator("#operate-tabs")).toHaveCSS("position", "sticky");
  const recentRun = page.locator("#sidebar [data-run-id]").first();
  if (await recentRun.count()) {
    await recentRun.click();
    await expect(page.locator("#operate-tab-overview")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#run-flow .flow-step").first()).toBeVisible();
    await expect(page.locator("#run-flow .flow-step").first()).toHaveCSS("border-left-color", /\d+, \d+, \d+/);
    const loopStep = page.locator("#run-flow .flow-step.is-loop-step").first();
    if (await loopStep.count()) await expect(loopStep).toHaveCSS("margin-left", "14px");
    const reviewTab = page.locator("#operate-tab-reviews");
    const reviewEntry = page.locator("#reviews [data-review-id]").first();
    if (await reviewEntry.count()) {
      await reviewTab.click();
      await expect(reviewEntry).toContainText("Open review");
      await expect(page.locator("#review-detail .review-submission")).toBeVisible();
      await expect(page.locator("#review-actions [data-review-action]").first()).toBeVisible();
      expect(await page.locator("#review-detail").evaluate((detail) =>
        Boolean(detail.compareDocumentPosition(document.getElementById("review-actions")!) & Node.DOCUMENT_POSITION_FOLLOWING)
      )).toBe(true);
    }
  }
  const designTab = page.locator('[data-console-tab="design"]');
  if (await designTab.getAttribute("aria-selected") !== "true") {
    await designTab.click();
  }
  await expect(page.locator("#studio-graph-root")).toBeVisible();
  await expect(page.locator("#studio-graph-root [data-studio-graph-layout]")).toHaveValue("flow");
  const readPortAttachmentAudit = () => page.locator("#studio-graph-root").evaluate((root) => {
    const ports = Array.from(root.querySelectorAll<SVGElement>("[data-studio-port]"));
    const rimDistance = (point: DOMPoint) => Math.min(...ports.map((port) => {
      const bounds = port.getBoundingClientRect();
      const radius = Math.min(bounds.width, bounds.height) / 2;
      return Math.abs(Math.hypot(point.x - (bounds.left + bounds.width / 2), point.y - (bounds.top + bounds.height / 2)) - radius);
    }));
    const matchedEdges = Array.from(root.querySelectorAll<SVGPathElement>("[data-cell-id] path[marker-end]"))
      .flatMap((path) => {
        const matrix = path.getScreenCTM();
        if (!matrix || path.getTotalLength() <= 0) return [];
        const pointAt = (distance: number) => {
          const point = path.getPointAtLength(distance);
          return new DOMPoint(point.x, point.y).matrixTransform(matrix);
        };
        const length = path.getTotalLength();
        const start = pointAt(0);
        const end = pointAt(length);
        const beforeEnd = pointAt(Math.max(0, length - 1));
        const tangentX = end.x - beforeEnd.x;
        const tangentY = end.y - beforeEnd.y;
        const tangentLength = Math.hypot(tangentX, tangentY);
        const markerId = path.getAttribute("marker-end")?.match(/#([^\)]+)/)?.[1];
        const marker = markerId ? root.querySelector<SVGMarkerElement>(`#${CSS.escape(markerId)}`) : null;
        const markerOffset = marker ? Math.max(0, -Number(marker.getAttribute("refX") || 0)) * Math.hypot(tangentX, tangentY) : 0;
        const arrowTip = tangentLength > 0
          ? new DOMPoint(end.x + tangentX / tangentLength * markerOffset, end.y + tangentY / tangentLength * markerOffset)
          : end;
        const sourceDistance = rimDistance(start);
        const targetDistance = rimDistance(arrowTip);
        return sourceDistance < 24 && targetDistance < 24 ? [{ sourceDistance, targetDistance }] : [];
      });
    return {
      roleToRoleEdgeCount: matchedEdges.length,
      unattachedTerminalCount: matchedEdges.filter((edge) => edge.sourceDistance > 2 || edge.targetDistance > 2).length
    };
  });
  await expect.poll(async () => (await readPortAttachmentAudit()).roleToRoleEdgeCount).toBeGreaterThan(0);
  expect((await readPortAttachmentAudit()).unattachedTerminalCount).toBe(0);

  await page.locator('[data-studio-side-tab="structure"]').click();
  const rolesSection = page.locator("[data-studio-role-list-section]");
  if (!(await rolesSection.getAttribute("open"))) {
    await rolesSection.locator("summary").click();
  }
  const roleId = await rolesSection.locator("[data-studio-role-id]").first().getAttribute("data-studio-role-id");
  expect(roleId).toBeTruthy();
  await rolesSection.locator("[data-studio-role-id]").first().click();
  await expect(page.locator('[data-studio-selection-panel="structure"]')).toBeVisible();
  await expect(page.locator('[data-studio-selection-inline-editor] [data-role-config-editor]')).toBeVisible();
  await page.locator("[data-studio-selection-back]").click();
  await expect(page.locator('[data-studio-selection-panel="structure"]')).toBeVisible();

  const graphViewport = page.locator("#studio-graph-root .x6-graph-svg-viewport");
  const beforeWheel = await graphViewport.getAttribute("transform");
  const graphBox = await page.locator("#studio-graph-root [data-studio-graph-canvas]").boundingBox();
  expect(graphBox).toBeTruthy();
  if (graphBox) {
    await page.mouse.move(graphBox.x + graphBox.width / 2, graphBox.y + graphBox.height / 2);
    await page.mouse.wheel(0, -280);
    await expect.poll(() => graphViewport.getAttribute("transform")).not.toBe(beforeWheel);
  }
  await page.locator('[data-console-tab="release"]').click();
  await expect(page.locator("#release-gate")).toContainText(/release candidate ready/i);
  await expect(page.locator("#release-gate")).toContainText(/No blocking readiness issues\./i);
  expect(pageErrors).toEqual([]);
});
