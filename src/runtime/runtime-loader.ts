import { homedir } from "node:os";
import { resolve } from "node:path";

import { DEFAULT_ROLE_REPO } from "./bundled-repos.js";
import {
  validateLawsConfig,
  validateProfilesConfig,
  validateRuntimeConfig,
  validateToolsConfig,
  validateUserProfileConfig
} from "./config.js";
import { readJsonFile } from "./json-file.js";
import { loadRolePackage } from "./role-repo.js";
import { pathExists } from "./run-artifacts.js";
import type {
  CliTool,
  ExecutionProfile,
  LawCatalog,
  LoadedRolePackage,
  RuntimeConfig,
  SystemDefinition,
  UserProfile
} from "./types.js";

export async function loadRuntimeConfig(
  path: string | undefined,
  workdir: string
): Promise<RuntimeConfig> {
  const defaultRuntimeRaw: Record<string, unknown> = {
    configVersion: "2",
    executor: "opencode",
    roleRepo: DEFAULT_ROLE_REPO,
    runsDir: ".ogs/runs",
    workspace: {
      rolesDir: "roles",
      privateDirName: "private",
      workspaceIsolation: "role"
    },
    redaction: {
      enabled: true
    },
    opencode: {
      baseArgs: ["run"]
    },
    runtime: {
      error_flows: {
        v1: false
      }
    }
  };

  const globalRuntimePath = resolve(homedir(), ".ogs", "runtime.json");
  const projectRuntimePath = resolve(workdir, ".ogs", "runtime.json");
  const overrideRuntimePath = path ? resolve(workdir, path) : undefined;

  let merged = { ...defaultRuntimeRaw };
  const loadedPaths: string[] = [];

  for (const candidate of [
    globalRuntimePath,
    projectRuntimePath,
    overrideRuntimePath
  ]) {
    if (!candidate || !(await pathExists(candidate))) {
      continue;
    }
    const overlay = await readJsonFile(candidate);
    if (typeof overlay !== "object" || overlay === null || Array.isArray(overlay)) {
      throw new Error(`Runtime config root must be a JSON object: ${candidate}`);
    }
    const overlayRecord = overlay as Record<string, unknown>;
    merged = {
      ...merged,
      ...overlayRecord,
      workspace: {
        ...(typeof merged.workspace === "object" &&
        merged.workspace &&
        !Array.isArray(merged.workspace)
          ? (merged.workspace as Record<string, unknown>)
          : {}),
        ...(typeof overlayRecord.workspace === "object" &&
        overlayRecord.workspace &&
        !Array.isArray(overlayRecord.workspace)
          ? (overlayRecord.workspace as Record<string, unknown>)
          : {})
      },
      retention: {
        ...(typeof merged.retention === "object" &&
        merged.retention &&
        !Array.isArray(merged.retention)
          ? (merged.retention as Record<string, unknown>)
          : {}),
        ...(typeof overlayRecord.retention === "object" &&
        overlayRecord.retention &&
        !Array.isArray(overlayRecord.retention)
          ? (overlayRecord.retention as Record<string, unknown>)
          : {})
      },
      opencode: {
        ...(typeof merged.opencode === "object" &&
        merged.opencode &&
        !Array.isArray(merged.opencode)
          ? (merged.opencode as Record<string, unknown>)
          : {}),
        ...(typeof overlayRecord.opencode === "object" &&
        overlayRecord.opencode &&
        !Array.isArray(overlayRecord.opencode)
          ? (overlayRecord.opencode as Record<string, unknown>)
          : {})
      },
      runtime: {
        ...(typeof merged.runtime === "object" &&
        merged.runtime &&
        !Array.isArray(merged.runtime)
          ? (merged.runtime as Record<string, unknown>)
          : {}),
        ...(typeof overlayRecord.runtime === "object" &&
        overlayRecord.runtime &&
        !Array.isArray(overlayRecord.runtime)
          ? (overlayRecord.runtime as Record<string, unknown>)
          : {})
      }
    };
    loadedPaths.push(candidate);
  }

  const validated = validateRuntimeConfig(
    merged,
    loadedPaths.at(-1) ?? projectRuntimePath
  );
  if (validated.runsDir.includes("ogsystem-history")) {
    throw new Error(
      `Unsupported runsDir in lifecycle mode: ${validated.runsDir}. Use ".ogs/runs".`
    );
  }
  return validated;
}

export async function loadUserProfile(
  path: string | undefined,
  workdir: string
): Promise<UserProfile | undefined> {
  const profilePath = path ?? resolve(workdir, ".ogs", "user-profile.json");
  if (!(await pathExists(profilePath))) {
    return undefined;
  }
  return validateUserProfileConfig(await readJsonFile(profilePath), profilePath);
}

function resolveOptionalProjectFile(args: {
  path?: string;
  workdir?: string;
  defaultBasename: string;
}): string | undefined {
  if (args.path) {
    return args.path;
  }
  if (!args.workdir) {
    return undefined;
  }
  return resolve(args.workdir, args.defaultBasename);
}

export async function loadProfiles(path?: string, workdir?: string): Promise<ExecutionProfile[]> {
  const profilePath = resolveOptionalProjectFile({
    path,
    workdir,
    defaultBasename: "profiles.json"
  });
  if (!profilePath || !(await pathExists(profilePath))) {
    return [];
  }
  return validateProfilesConfig(await readJsonFile(profilePath), profilePath);
}

export async function loadTools(path?: string, workdir?: string): Promise<CliTool[]> {
  const toolsPath = resolveOptionalProjectFile({
    path,
    workdir,
    defaultBasename: "tools.json"
  });
  if (!toolsPath || !(await pathExists(toolsPath))) {
    return [];
  }
  return validateToolsConfig(await readJsonFile(toolsPath), toolsPath).tools;
}

export async function loadLaws(
  path: string | undefined,
  workdir: string
): Promise<LawCatalog | undefined> {
  const lawPath = path ?? resolve(workdir, ".ogs", "laws.json");
  if (!(await pathExists(lawPath))) {
    return undefined;
  }
  return validateLawsConfig(await readJsonFile(lawPath), lawPath);
}

export async function loadRolePackages(args: {
  system: SystemDefinition;
  roleRootDir: string;
}): Promise<Map<string, LoadedRolePackage>> {
  const rolePackagesByRoleId = new Map<string, LoadedRolePackage>();

  for (const roleId of args.system.roleIds) {
    const rolePackage = await loadRolePackage({
      roleId,
      roleRootDir: args.roleRootDir
    });
    rolePackagesByRoleId.set(roleId, rolePackage);
  }

  return rolePackagesByRoleId;
}
