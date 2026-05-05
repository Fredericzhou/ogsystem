/**
 * @fileoverview NL2MMD catalog/context loader from local OGSystem project metadata.
 * File Set: nl2mmd-context
 * Responsibilities:
 * - Load runtime/law/role/model metadata into one prompt-ready context.
 * - Resolve role mentions and expose supported DSL dictionary.
 * Boundaries:
 * - Does not call LLMs or generate Mermaid drafts.
 */
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  DEFAULT_ROLE_REPO,
  resolveProjectRoleRootDir,
  resolveTemplateRoleRootDir
} from "../runtime/bundled-repos.js";
import {
  validateLawsConfig,
  validateRuntimeConfig
} from "../runtime/config.js";
import { readJsonFile } from "../runtime/json-file.js";
import { chooseDefaultModelFromCatalog, loadModelCatalog } from "../runtime/model-catalog.js";
import { isDirectModelRef, loadModelSelection } from "../runtime/model-selection.js";
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

function compact<T>(items: Array<T | undefined>): T[] {
  return items.filter((item): item is T => item !== undefined);
}

async function listDirectoryNamesIfExists(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

function dedupeByKey<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function getDefaultRuntimeConfig(path: string) {
  return validateRuntimeConfig(
    {
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
    exactMetadataKeys: [
      "engine",
      "system.id",
      "system.version",
      "law.global",
      "entry.role",
      "handoff.mode",
      "handoff.contracts"
    ],
    metadataPrefixes: [
      "talent.bind.",
      "exec.bind.",
      "model.bind.",
      "role.mode.",
      "join.mode.",
      "join.min.",
      "join.sources.",
      "context.map.",
      "loop.max.",
      "route.order.",
      "review.mode.",
      "review.timeout.",
      "review.timeout.action.",
      "review.rework.target.",
      "review.rework.max.",
      "review.terminate.scope."
    ],
    roleModes: ["parallel_split"],
    joinModes: ["all_of", "quorum_of"],
    mentionPrefix: "@",
    nodeTokenPattern: "nodeId[Role:roleId]",
    edgePattern: "fromToken -->|EVENT| toToken (tokens: input/output or nodeId[Role:roleId])"
  };
}

function splitModelRef(modelRef: string): { provider: string; model: string } {
  const separator = modelRef.indexOf("/");
  if (separator <= 0 || separator === modelRef.length - 1) {
    return {
      provider: "unknown",
      model: modelRef
    };
  }
  return {
    provider: modelRef.slice(0, separator),
    model: modelRef.slice(separator + 1)
  };
}

function gatherSelectionModelRefs(context: Nl2MmdContext["modelSelection"]): string[] {
  if (!context) {
    return [];
  }
  return [
    context.defaults?.model,
    ...Object.values(context.roles ?? {}).map((entry) => entry.model),
    ...Object.values(context.systems ?? {}).flatMap((systemEntry) => [
      systemEntry.defaults?.model,
      ...Object.values(systemEntry.roles ?? {}).map((roleEntry) => roleEntry.model)
    ])
  ].filter((value): value is string => isDirectModelRef(value));
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

  const roleRootDir = resolveProjectRoleRootDir(args.workdir, runtimeConfig.roleRepo);
  const templateRoleRootDir = resolveTemplateRoleRootDir();
  const modelCatalogPath = resolve(args.workdir, ".ogs", "model-catalog.json");
  const modelSelectionPath = resolve(args.workdir, ".ogs", "model-selection.json");
  const rawModelCatalog = await loadModelCatalog(modelCatalogPath);
  const modelSelection = await loadModelSelection(modelSelectionPath);

  const roleEntries = dedupeByKey(
    [
      ...(await listDirectoryNamesIfExists(roleRootDir)),
      ...(await listDirectoryNamesIfExists(templateRoleRootDir))
    ].filter((name) => !name.startsWith("_")),
    (name) => name
  );

  const roleCatalog = compact(
    await Promise.all(
      roleEntries.map(async (roleId) => {
        const rootsToTry = [roleRootDir, templateRoleRootDir];
        try {
          for (const candidateRoot of rootsToTry) {
            const manifestPath = resolve(candidateRoot, roleId, "role.json");
            try {
              const rolePackage = await loadRolePackage({ roleId, roleRootDir: candidateRoot });
              return {
                roleId,
                name: rolePackage.manifest.name,
                description: rolePackage.manifest.description,
                tags: rolePackage.manifest.tags ?? [],
                preferredModelTags: rolePackage.manifest.preferredModelTags ?? [],
                outputEvents: getOutputEvents(rolePackage.outputSchema)
              };
            } catch (error) {
              if (isMissingPathError(error, manifestPath)) {
                continue;
              }
              throw error;
            }
          }
          return undefined;
        } catch (error) {
          throw error;
        }
      })
    )
  );

  const modelCatalog = dedupeByKey(
    [
      ...(rawModelCatalog?.models.map((entry) => ({
        modelRef: entry.ref,
        provider: entry.provider,
        model: entry.model,
        name: entry.name,
        status: entry.status,
        reasoningEffort: undefined,
        variants: entry.variants,
        tags: [
          ...(entry.status ? [entry.status] : []),
          ...(entry.capabilities.toolcall ? ["toolcall"] : []),
          ...(entry.capabilities.textInput ? ["text-input"] : []),
          ...(entry.capabilities.textOutput ? ["text-output"] : [])
        ]
      })) ?? []),
      ...gatherSelectionModelRefs(modelSelection).map((modelRef) => {
        const { provider, model } = splitModelRef(modelRef);
        return {
          modelRef,
          provider,
          model,
          name: undefined,
          status: undefined,
          reasoningEffort: undefined,
          variants: [],
          tags: ["selection"]
        };
      })
    ],
    (item) => item.modelRef
  ).sort((left, right) => left.modelRef.localeCompare(right.modelRef));

  const defaultCatalogModel = rawModelCatalog ? chooseDefaultModelFromCatalog(rawModelCatalog) : undefined;
  const defaultModelRef =
    modelSelection?.defaults?.model ?? defaultCatalogModel?.ref ?? modelCatalog[0]?.modelRef;
  const defaultModelVariant = modelSelection?.defaults?.variant;
  const defaultTimeoutMs = modelSelection?.defaults?.timeoutMs ?? 120000;
  const defaultMaxOutputBytes = modelSelection?.defaults?.maxOutputBytes ?? 65536;

  let lawIds: string[] = [];
  const lawsPath = args.lawsPath ?? resolve(args.workdir, ".ogs", "laws.json");
  const lawsSource = await readJsonFileIfExists(lawsPath);
  if (lawsSource !== undefined) {
    const laws = validateLawsConfig(lawsSource, lawsPath);
    lawIds = laws.laws.map((item) => item.lawId).sort();
  }

  const context = {
    workdir: args.workdir,
    roleRootDir,
    templateRoleRootDir,
    roleCatalog,
    modelCatalog,
    rawModelCatalog,
    modelSelection,
    defaultModelRef,
    defaultModelVariant,
    defaultTimeoutMs,
    defaultMaxOutputBytes,
    lawIds,
    supportedDictionary: getSupportedNl2MmdDictionary()
  };
  logNl2MmdDebug("context.loaded", {
    workdir: args.workdir,
    runtimePath,
    runtimeConfigSource: runtimeConfigSource !== undefined ? "file" : "default",
    modelCatalogPath,
    modelCatalogLoaded: rawModelCatalog !== undefined,
    modelSelectionPath,
    modelSelectionLoaded: modelSelection !== undefined,
    defaultModelRef: defaultModelRef ?? "(none)",
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
