import { accessSync, constants } from "node:fs";
import { delimiter, extname, join } from "node:path";
import { parseArgs } from "node:util";

type CheckResult = {
  command: string;
  found: boolean;
  path?: string;
};

function usage(): string {
  return [
    "Usage:",
    "  npm run run:doctor -- [--required codex]",
    "",
    "Options:",
    "  --required <csv>   Required commands. Missing required commands return exit code 2.",
    "  --help             Show help"
  ].join("\n");
}

function fileAccessible(path: string): boolean {
  try {
    accessSync(path, constants.F_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCandidates(command: string): string[] {
  const hasExt = extname(command) !== "";
  if (hasExt) {
    return [command];
  }
  if (process.platform === "win32") {
    return (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
      .split(";")
      .map((ext) => ext.trim())
      .filter(Boolean)
      .map((ext) => `${command}${ext}`);
  }
  return [command];
}

function findExecutable(command: string): string | undefined {
  const candidates = resolveCandidates(command);
  for (const candidate of candidates) {
    if (fileAccessible(candidate)) {
      return candidate;
    }
  }

  const containsSeparator = command.includes("/") || command.includes("\\");
  if (containsSeparator) {
    return undefined;
  }

  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    for (const candidate of candidates) {
      const fullPath = join(entry, candidate);
      if (fileAccessible(fullPath)) {
        return fullPath;
      }
    }
  }

  return undefined;
}

function checkCommand(command: string): CheckResult {
  const path = findExecutable(command);
  return { command, found: Boolean(path), path: path || undefined };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      required: { type: "string" },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: false
  });

  if (values.help) {
    console.log(usage());
    return;
  }

  const candidates = ["codex"];
  const required = new Set(
    (values.required ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );

  const checks = candidates.map((command) => checkCommand(command));
  const missingRequired = checks
    .filter((item) => required.has(item.command) && !item.found)
    .map((item) => item.command);

  const output = {
    status: missingRequired.length > 0 ? "failed" : "ok",
    required: Array.from(required),
    missingRequired,
    checks
  };
  console.log(JSON.stringify(output, null, 2));
  if (missingRequired.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
