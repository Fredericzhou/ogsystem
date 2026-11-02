import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("desktop readiness: window options match frameless specifications", () => {
  const { createWindowOptions } = require(path.join(root, "electron", "main.cjs"));
  const options = createWindowOptions();

  assert.equal(options.width, 1440);
  assert.equal(options.height, 900);
  assert.equal(options.minWidth, 1024);
  assert.equal(options.minHeight, 700);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.sandbox, true);

  if (process.platform === "darwin") {
    assert.equal(options.titleBarStyle, "hiddenInset");
    assert.deepEqual(options.trafficLightPosition, { x: 14, y: 14 });
  }
});

test("desktop readiness: menu template binds expected lifecycle accelerators", () => {
  const { buildMenuTemplate } = require(path.join(root, "electron", "main.cjs"));
  const template = buildMenuTemplate({ name: "OGSystem" }, null);

  const fileMenu = template.find((m) => m.label?.includes("文件") || m.label?.includes("File"));
  assert.ok(fileMenu, "File menu must exist");

  const saveItem = fileMenu.submenu.find((item) => item.accelerator === "CmdOrCtrl+S");
  assert.ok(saveItem, "Save Draft shortcut must be CmdOrCtrl+S");

  const runItem = fileMenu.submenu.find((item) => item.accelerator === "CmdOrCtrl+Enter");
  assert.ok(runItem, "Run Debug shortcut must be CmdOrCtrl+Enter");

  const viewMenu = template.find((m) => m.label?.includes("视图") || m.label?.includes("View"));
  assert.ok(viewMenu, "View menu must exist");

  const zoomReset = viewMenu.submenu.find((item) => item.role === "resetZoom" || item.accelerator === "CmdOrCtrl+0");
  assert.ok(zoomReset, "Reset Zoom must be registered");
});

test("desktop readiness: backend server lifecycle starts and reaps cleanly", async () => {
  const { startBackendServer, stopBackendServer } = require(path.join(root, "electron", "main.cjs"));
  try {
    const { url, proc } = await startBackendServer({
      appRoot: root,
      timeoutMs: 10000
    });

    assert.ok(url.startsWith("http://127.0.0.1:"), `Expected loopback server url, got ${url}`);
    assert.ok(typeof proc.pid === "number", "Server process PID should be valid number");

    // Probe health
    const res = await fetch(`${url}/api/v1/cases`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.cases), "Cases response should contain array");
  } finally {
    stopBackendServer();
  }
});
