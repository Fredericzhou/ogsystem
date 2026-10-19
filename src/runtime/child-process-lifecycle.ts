import { spawnSync, type ChildProcess } from "node:child_process";

export function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

export function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (exited: boolean) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref();
    child.once("exit", onExit);
  });
}

export async function terminateChildProcessTree(child: ChildProcess, graceMs = 1500): Promise<void> {
  if (hasExited(child)) return;
  if (process.platform === "win32" && child.pid) {
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    if (result.error) throw result.error;
  }
  if (!await waitForChildExit(child, 1500)) {
    child.kill("SIGTERM");
    if (!await waitForChildExit(child, graceMs)) child.kill("SIGKILL");
  }
  if (!await waitForChildExit(child, 5000)) throw new Error(`Process ${child.pid ?? "unknown"} did not exit after termination.`);
}
