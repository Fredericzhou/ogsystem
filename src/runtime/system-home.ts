import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { installSystemHome } = require("../../scripts/install-system-home.cjs") as {
  installSystemHome: (options?: { updateMetadata?: boolean }) => Promise<boolean>;
};

export const SYSTEM_HOME_DIR = resolve(homedir(), ".ogsystem");
export const SYSTEM_ROLE_REPO_ROOT = SYSTEM_HOME_DIR;
export const SYSTEM_ENV_FILE = resolve(SYSTEM_HOME_DIR, ".env");

export async function ensureSystemHome(): Promise<void> {
  await installSystemHome();
}

function parseEnvValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export async function loadSystemEnvironment(): Promise<void> {
  let source: string;
  try {
    source = await readFile(SYSTEM_ENV_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const line of source.split(/\r?\n/)) {
    const normalized = line.trim().replace(/^export\s+/, "");
    if (!normalized || normalized.startsWith("#")) {
      continue;
    }
    const match = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }
    const [, name, rawValue] = match;
    if (process.env[name] === undefined) {
      process.env[name] = parseEnvValue(rawValue);
    }
  }
}
