import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  return resolve(resolvePackageRootDir(), DEFAULT_ROLE_REPO);
}

export function resolveTemplateRoleRootDir(): string {
  return resolve(resolveTemplateRoleRepoRoot(), "roles");
}
