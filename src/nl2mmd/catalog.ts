import { access, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  validateLawsConfig,
  validateRuntimeConfig
} from "../runtime/config.js";
import { readJsonFile } from "../runtime/json-file.js";
import { loadModelPackage } from "../runtime/model-repo.js";
import { loadRolePackage } from "../runtime/role-repo.js";
import type { Nl2MmdContext, Nl2MmdRoleMention, Nl2MmdSupportedDictionary } from "./types.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function getDefaultRuntimeConfig(path: string) {
  return validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      modelRepo: "./og-models",
      runsDir: "ogsystem-history",
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
  const runtimePath = args.runtimeConfigPath ?? resolve(args.workdir, ".ogsystem", "runtime.json");
  const runtimeConfig = (await pathExists(runtimePath))
    ? validateRuntimeConfig(await readJsonFile(runtimePath), runtimePath)
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
    if (!(await pathExists(manifestPath))) {
      continue;
    }
    const rolePackage = await loadRolePackage({ roleId, roleRootDir });
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
    if (!(await pathExists(manifestPath))) {
      continue;
    }
    const modelPackage = await loadModelPackage({ modelId, modelRootDir });
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
  const lawsPath = args.lawsPath ?? resolve(args.workdir, ".ogsystem", "laws.json");
  if (await pathExists(lawsPath)) {
    const laws = validateLawsConfig(await readJsonFile(lawsPath), lawsPath);
    lawIds = laws.laws.map((item) => item.lawId).sort();
  }

  return {
    workdir: args.workdir,
    roleRootDir,
    modelRootDir,
    roleCatalog,
    modelCatalog,
    lawIds,
    supportedDictionary: getSupportedNl2MmdDictionary()
  };
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
