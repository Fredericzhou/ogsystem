const { contextBridge, ipcRenderer } = require("electron");

const menuCommands = new Set([
  "menu-save-draft",
  "menu-run-debug",
  "menu-reset-view"
]);

contextBridge.exposeInMainWorld("electronAPI", {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron,
  onMenuCommand(callback) {
    if (typeof callback !== "function") return () => {};
    const listeners = [];
    for (const command of menuCommands) {
      const listener = () => callback(command);
      ipcRenderer.on(command, listener);
      listeners.push([command, listener]);
    }
    return () => {
      for (const [command, listener] of listeners) ipcRenderer.removeListener(command, listener);
    };
  }
});
