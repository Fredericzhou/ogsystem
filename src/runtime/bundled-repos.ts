import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_ROLE_REPO = "./og-roles";
export const DEFAULT_MODEL_REPO = "./og-models";

export function resolvePackageRootDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

function resolveRepoRoot(args: {
  workdir: string;
  configuredPath: string;
  defaultRepoPath: string;
}): string {
  const configuredRoot = resolve(args.workdir, args.configuredPath);
  if (existsSync(configuredRoot)) {
    return configuredRoot;
  }

  if (args.configuredPath !== args.defaultRepoPath) {
    return configuredRoot;
  }

  const bundledRoot = resolve(resolvePackageRootDir(), args.defaultRepoPath);
  if (existsSync(bundledRoot)) {
    return bundledRoot;
  }

  return configuredRoot;
}

export function resolveRoleRepoRoot(workdir: string, configuredPath: string): string {
  return resolveRepoRoot({
    workdir,
    configuredPath,
    defaultRepoPath: DEFAULT_ROLE_REPO
  });
}

export function resolveRoleRootDir(workdir: string, configuredPath: string): string {
  return resolve(resolveRoleRepoRoot(workdir, configuredPath), "roles");
}

export function resolveModelRepoRoot(workdir: string, configuredPath: string): string {
  return resolveRepoRoot({
    workdir,
    configuredPath,
    defaultRepoPath: DEFAULT_MODEL_REPO
  });
}
