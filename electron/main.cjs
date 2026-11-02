const path = require("node:path");
const { spawn } = require("node:child_process");

let electron = null;
try {
  electron = require("electron");
} catch {}

let mainWindow = null;
let serverProcess = null;

function createWindowOptions(preloadPath = path.join(__dirname, "preload.cjs")) {
  const isMac = process.platform === "darwin";
  return {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "OGSystem Studio",
    backgroundColor: "#f6f8f7",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
}

function buildMenuTemplate(appRef, mainWindowRef) {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [{
          label: appRef?.name || "OGSystem",
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" }
          ]
        }]
      : []),
    {
      label: "文件 (File)",
      submenu: [
        {
          label: "保存设计草案 (Save Draft)",
          accelerator: "CmdOrCtrl+S",
          click: () => {
            mainWindowRef?.webContents?.send?.("menu-save-draft");
          }
        },
        {
          label: "启动仿真调试 (Run Debug)",
          accelerator: "CmdOrCtrl+Enter",
          click: () => {
            mainWindowRef?.webContents?.send?.("menu-run-debug");
          }
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" }
      ]
    },
    {
      label: "视图 (View)",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom", accelerator: "CmdOrCtrl+0" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "窗口 (Window)",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" }, { role: "front" }]
          : [{ role: "close" }])
      ]
    }
  ];
  return template;
}

function startBackendServer(options = {}) {
  const appRoot = options.appRoot || path.resolve(__dirname, "..");
  const serverPath = options.serverPath || path.resolve(appRoot, "apps", "team-site", "server.mjs");
  const env = {
    ...process.env,
    PORT: "0",
    OGS_DESKTOP: "1",
    ...(options.env || {})
  };

  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [serverPath], {
      cwd: appRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    serverProcess = proc;

    let output = "";
    let started = false;

    const timeout = setTimeout(() => {
      if (!started) {
        stopBackendServer();
        reject(new Error("Timeout waiting for local server to start: " + output));
      }
    }, options.timeoutMs || 15000);

    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match && !started) {
        started = true;
        clearTimeout(timeout);
        resolve({ url: match[1], proc, output: () => output });
      }
    };

    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on("exit", (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Server exited early with code ${code}: ${output}`));
      }
    });
  });
}

function stopBackendServer() {
  if (serverProcess) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(serverProcess.pid), "/f", "/t"]);
      } else {
        serverProcess.kill("SIGTERM");
      }
    } catch {}
    serverProcess = null;
  }
}

async function main() {
  if (!electron || !electron.app) {
    console.error("This entry point requires Electron runtime. Run via 'npx electron electron/main.cjs'");
    process.exit(1);
  }

  const { app, BrowserWindow, Menu, shell } = electron;

  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  let serverUrl = "";
  try {
    const serverResult = await startBackendServer();
    serverUrl = serverResult.url;
  } catch (error) {
    console.error("Failed to start local backend server:", error);
    app.quit();
    return;
  }

  app.whenReady().then(async () => {
    const options = createWindowOptions();
    mainWindow = new BrowserWindow(options);

    const menu = Menu.buildFromTemplate(buildMenuTemplate(app, mainWindow));
    Menu.setApplicationMenu(menu);

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        shell.openExternal(url);
      }
      return { action: "deny" };
    });

    await mainWindow.loadURL(serverUrl);

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = new BrowserWindow(options);
        await mainWindow.loadURL(serverUrl);
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("will-quit", () => {
    stopBackendServer();
  });
}

if (require.main === module && electron && electron.app) {
  main();
}

module.exports = {
  createWindowOptions,
  buildMenuTemplate,
  startBackendServer,
  stopBackendServer
};
