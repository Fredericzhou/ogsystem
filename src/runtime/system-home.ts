import { createRequire } from "node:module";
import { homedir } from "node:os";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { installSystemHome } = require("../../scripts/install-system-home.cjs") as {
  installSystemHome: (options?: { updateMetadata?: boolean }) => Promise<boolean>;
};

export const SYSTEM_HOME_DIR = resolve(homedir(), ".ogsystem");
export const SYSTEM_ROLE_REPO_ROOT = SYSTEM_HOME_DIR;

export async function ensureSystemHome(): Promise<void> {
  await installSystemHome();
}
