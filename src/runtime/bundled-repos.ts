import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SYSTEM_HOME_DIR, SYSTEM_ROLE_REPO_ROOT } from "./system-home.js";

export const DEFAULT_ROLE_REPO = "./og-roles";

export function resolvePackageRootDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function resolveProjectRoleRepoRoot(workdir: string, configuredPath: string): string {
  return resolve(workdir, configuredPath);
}

export function resolveProjectRoleRootDir(workdir: string, configuredPath: string): string {
  return resolve(resolveProjectRoleRepoRoot(workdir, configuredPath), "roles");
}

export function resolveTemplateRoleRepoRoot(): string {
  if (existsSync(resolve(SYSTEM_HOME_DIR, "roles"))) {
    return SYSTEM_ROLE_REPO_ROOT;
  }
  return resolve(resolvePackageRootDir(), DEFAULT_ROLE_REPO);
}

export function resolveTemplateRoleRootDir(): string {
  return resolve(resolveTemplateRoleRepoRoot(), "roles");
}
