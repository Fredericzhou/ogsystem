import { accessSync, constants } from "node:fs";
import { delimiter, extname, join } from "node:path";

function candidatesFor(command: string): string[] {
  if (extname(command)) return [command];
  if (process.platform === "win32") {
    return (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
      .split(";").map((extension) => `${command}${extension.trim()}`).filter(Boolean);
  }
  return [command];
}

export function findExecutable(command: string): string | undefined {
  const candidates = candidatesFor(command);
  const hasPath = command.includes("/") || command.includes("\\");
  for (const candidate of candidates) {
    if (hasPath) {
      try { accessSync(candidate, constants.F_OK | constants.X_OK); return candidate; } catch { continue; }
    }
    for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
      const resolved = join(directory, candidate);
      try { accessSync(resolved, constants.F_OK | constants.X_OK); return resolved; } catch { /* continue PATH search */ }
    }
  }
  return undefined;
}

export function checkExecutable(command: string): { command: string; found: boolean; path?: string } {
  const path = findExecutable(command);
  return { command, found: Boolean(path), ...(path ? { path } : {}) };
}

export function resolveExecutableOrCommand(command: string): string {
  return findExecutable(command) ?? command;
}
