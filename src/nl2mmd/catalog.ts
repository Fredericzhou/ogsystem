import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  validateLawsConfig,
  validateRuntimeConfig
} from "../runtime/config.js";
import { readJsonFile } from "../runtime/json-file.js";
import { loadModelPackage } from "../runtime/model-repo.js";
import { loadRolePackage } from "../runtime/role-repo.js";
import { logNl2MmdDebug } from "./logger.js";
import type { Nl2MmdContext, Nl2MmdRoleMention, Nl2MmdSupportedDictionary } from "./types.js";

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isMissingPathError(error: unknown, path: string): boolean {
  return (
    isFileNotFoundError(error) &&
    typeof (error as { path?: unknown }).path === "string" &&
    (error as { path: string }).path === path
  );
}

async function readJsonFileIfExists(path: string): Promise<unknown | undefined> {
  try {
    return await readJsonFile(path);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

function getDefaultRuntimeConfig(path: string) {
  return validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      modelRepo: "./og-models",
      runsDir: ".ogs/runs",
      workspace: {
        rolesDir: "roles",
        privateDirName: "private"
      },
      opencode: {
        baseArgs: ["run"]
      }
    },
    path
  );
}

function getOutputEvents(schema: unknown): string[] {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return [];
  }
  const record = schema as {
    properties?: {
      event?: {
        enum?: unknown;
      };
    };
  };
  return Array.isArray(record.properties?.event?.enum)
    ? record.properties.event.enum.filter((item): item is string => typeof item === "string")
    : [];
}

export function getSupportedNl2MmdDictionary(): Nl2MmdSupportedDictionary {
  return {
    flowcharts: ["flowchart TD", "flowchart LR"],
    boundaryTokens: ["input", "output"],
    exactMetadataKeys: ["engine", "system.id", "system.version", "law.global", "entry.role"],
    metadataPrefixes: [
      "talent.bind.",
      "exec.bind.",
      "model.bind.",
      "role.mode.",
      "join.mode.",
      "join.sources.",
      "loop.max."
    ],
    roleModes: ["parallel_split"],
    joinModes: ["all_of"],
    mentionPrefix: "@",
    nodeTokenPattern: "nodeId[Role:roleId]",
    edgePattern: "from -->|EVENT| to"
  };
}

export async function loadNl2MmdContext(args: {
  workdir: string;
  runtimeConfigPath?: string;
  lawsPath?: string;
}): Promise<Nl2MmdContext> {
  const startedAt = Date.now();
  const runtimePath = args.runtimeConfigPath ?? resolve(args.workdir, ".ogs", "runtime.json");
  const runtimeConfigSource = await readJsonFileIfExists(runtimePath);
  const runtimeConfig =
    runtimeConfigSource !== undefined
      ? validateRuntimeConfig(runtimeConfigSource, runtimePath)
      : getDefaultRuntimeConfig(runtimePath);

  const roleRootDir = resolve(args.workdir, runtimeConfig.roleRepo, "roles");
  const modelRootDir = resolve(args.workdir, runtimeConfig.modelRepo);

  const roleEntries = (await readdir(roleRootDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("_"))
    .sort();

  const roleCatalog: Nl2MmdContext["roleCatalog"] = [];
  for (const roleId of roleEntries) {
    const manifestPath = resolve(roleRootDir, roleId, "role.json");
    let rolePackage;
    try {
      rolePackage = await loadRolePackage({ roleId, roleRootDir });
    } catch (error) {
      if (isMissingPathError(error, manifestPath)) {
        continue;
      }
      throw error;
    }
    roleCatalog.push({
      roleId,
      name: rolePackage.manifest.name,
      description: rolePackage.manifest.description,
      tags: rolePackage.manifest.tags ?? [],
      preferredModelTags: rolePackage.manifest.preferredModelTags ?? [],
      outputEvents: getOutputEvents(rolePackage.outputSchema)
    });
  }

  const modelEntries = (await readdir(resolve(modelRootDir, "models"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const modelCatalog: Nl2MmdContext["modelCatalog"] = [];
  for (const modelId of modelEntries) {
    const manifestPath = resolve(modelRootDir, "models", modelId, "model.json");
    let modelPackage;
    try {
      modelPackage = await loadModelPackage({ modelId, modelRootDir });
    } catch (error) {
      if (isMissingPathError(error, manifestPath)) {
        continue;
      }
      throw error;
    }
    modelCatalog.push({
      modelId,
      model: modelPackage.manifest.model,
      reasoningEffort:
        typeof modelPackage.manifest.args?.reasoningEffort === "string"
          ? modelPackage.manifest.args.reasoningEffort
          : undefined,
      tags: modelPackage.manifest.tags ?? []
    });
  }

  let lawIds: string[] = [];
  const lawsPath =
    args.lawsPath ??
    (await readJsonFileIfExists(resolve(args.workdir, ".ogs", "laws.json")) !== undefined
      ? resolve(args.workdir, ".ogs", "laws.json")
      : resolve(args.workdir, ".ogsystem", "laws.json"));
  const lawsSource = await readJsonFileIfExists(lawsPath);
  if (lawsSource !== undefined) {
    const laws = validateLawsConfig(lawsSource, lawsPath);
    lawIds = laws.laws.map((item) => item.lawId).sort();
  }

  const context = {
    workdir: args.workdir,
    roleRootDir,
    modelRootDir,
    roleCatalog,
    modelCatalog,
    lawIds,
    supportedDictionary: getSupportedNl2MmdDictionary()
  };
  logNl2MmdDebug("context.loaded", {
    workdir: args.workdir,
    runtimePath,
    runtimeConfigSource: runtimeConfigSource !== undefined ? "file" : "default",
    lawsPath,
    lawsLoaded: lawsSource !== undefined,
    roleCount: roleCatalog.length,
    modelCount: modelCatalog.length,
    durationMs: Date.now() - startedAt
  });
  return context;
}

export function extractRoleMentions(text: string): string[] {
  const matches = text.match(/@[A-Za-z0-9._:-]+/g) ?? [];
  return Array.from(new Set(matches.map((item) => item.slice(1))));
}

export function resolveRoleMentions(text: string, context: Nl2MmdContext): Nl2MmdRoleMention[] {
  const known = new Set(context.roleCatalog.map((item) => item.roleId));
  return extractRoleMentions(text).map((roleId) => ({
    mention: `@${roleId}`,
    roleId,
    exists: known.has(roleId)
  }));
}
