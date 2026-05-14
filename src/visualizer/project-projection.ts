import { basename, dirname, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import { compileExecutionSnapshot } from "../runtime/compiler.js";
import { resolveProjectRoleRepoRoot, resolveProjectRoleRootDir, resolveTemplateRoleRootDir } from "../runtime/bundled-repos.js";
import { isRuntimeOnlyErrorEvent } from "../runtime/error-flow-utils.js";
import { buildFlowContractKeyForFlow, loadFlowContractPlan } from "../runtime/flow-contract.js";
import { readJsonFile, writeJsonFileAtomic } from "../runtime/json-file.js";
import { loadModelCatalog } from "../runtime/model-catalog.js";
import { isDirectModelRef, loadModelSelection, resolveModelSelectionForSystem } from "../runtime/model-selection.js";
import { RuntimeError } from "../runtime/runtime-errors.js";
import { parseSystemFromMermaidSource } from "../runtime/parse-mermaid.js";
import {
  ensureProjectSkeleton,
  importInstalledRolePackageIntoProject,
  isProjectTemplateId,
  rebuildRunsIndex,
  resolveOgsPaths,
  scaffoldProjectTemplate,
  syncProjectDependencies,
  syncProjectModels,
  loadPersistedRunsIndex,
  type ProjectTemplateId
} from "../runtime/project-lifecycle.js";
import { validateRolePackageManifest } from "../runtime/role-repo.js";
import { pathExists } from "../runtime/run-artifacts.js";
import { loadLaws, loadProfiles, loadRolePackages, loadRuntimeConfig, loadTools, loadUserProfile } from "../runtime/runtime-loader.js";
import { validateProfilesConfig, validateToolsConfig } from "../runtime/config.js";
import { resolveEffectiveLaw } from "../runtime/runtime-setup.js";
import { SYSTEM_END_ROLE_ID } from "../runtime/types.js";
import { importMermaidToAuthoring, saveStudioAuthoringDraft } from "./studio-authoring.js";
import {
  asPositiveInteger,
  asRecord,
  asString
} from "./json-guards.js";
import type { CompilerDiagnostic } from "../runtime/compiler.js";
import type { ModelCatalog, ModelSelectionConfig } from "../runtime/types.js";
import type { ResolvedModelRuntimeConfig } from "../runtime/model-selection.js";
import type { LoadedRolePackage, SystemDefinition } from "../runtime/types.js";

type JsonRecord = Record<string, unknown>;

type ProjectContext = {
  systemPath: string;
  systemSource: string;
  system: SystemDefinition;
  runtimeConfig: unknown;
  modelSelection: unknown;
  modelCatalog: unknown;
  laws: unknown;
  userProfile: unknown;
  profiles: unknown;
  tools: unknown;
  compilerSnapshot: ReturnType<typeof compileExecutionSnapshot>["snapshot"];
  resolvedModelWarnings: string[];
  resolvedModelsByRoleId: Map<string, ResolvedModelRuntimeConfig>;
  roleRepoRoot: string;
  roleRootDir: string;
  rolePackagesByRoleId: Map<string, LoadedRolePackage>;
  contractPlan: Awaited<ReturnType<typeof loadFlowContractPlan>> | undefined;
  projectMeta: unknown;
};

type ProjectProjectionCacheEntry = {
  token: string;
  value: Promise<ProjectContext>;
  cachedAtMs: number;
  lastAccessedAtMs: number;
};

type ProjectCreatePreferences = {
  authoringDefaults?: unknown;
  modelProfileStrategy?: unknown;
};

type ProjectCreateModelDefaults = {
  model?: string;
  variant?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

type ProjectCreateProfileDraft = {
  profileId: string;
  toolRef: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

type ProjectCreateTestHooks = {
  cleanupFailurePatterns?: string[];
  forceCreateFailure?: boolean;
};

const projectProjectionCache = new Map<string, ProjectProjectionCacheEntry>();
const PROJECT_PROJECTION_CACHE_TTL_MS = 10 * 60 * 1000;
const PROJECT_PROJECTION_CACHE_MAX_SIZE = 16;
const PROJECT_CONTROLLED_PATHS = [
  ".ogs",
  "og-roles",
  "system.mmd",
  "system.example.mmd",
  "profiles.json",
  "tools.json",
  ".ogs/project.json",
  ".ogs/runtime.json",
  ".ogs/model-catalog.json",
  ".ogs/model-selection.json",
  ".ogs/laws.json",
  ".ogs/user-profile.json",
  ".ogs/runs-index.json",
  ".ogs/providers/opencode.json",
  ".ogs/README.md",
  ".ogs/studio/system.authoring.json"
];
const ROLE_PACKAGE_FILE_NAMES = ["role.json", "agent.md", "prompt.md", "output.schema.json"] as const;
type RolePackageFileName = typeof ROLE_PACKAGE_FILE_NAMES[number];

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (depth >= 8) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => sanitizeJsonValue(entry, depth + 1))
      .filter((entry) => entry !== undefined);
    return entries;
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const entries = Object.entries(record)
    .map(([key, entry]) => [key, sanitizeJsonValue(entry, depth + 1)] as const)
    .filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries);
}

function sanitizeProjectCreatePreferences(args: {
  authoringDefaults?: unknown;
  modelProfileStrategy?: unknown;
}): ProjectCreatePreferences | undefined {
  const authoringDefaults = sanitizeJsonValue(args.authoringDefaults);
  const modelProfileStrategy = sanitizeJsonValue(args.modelProfileStrategy);
  if (authoringDefaults === undefined && modelProfileStrategy === undefined) {
    return undefined;
  }
  return {
    authoringDefaults,
    modelProfileStrategy
  };
}

function normalizeModelDefaults(value: unknown): ProjectCreateModelDefaults | undefined {
  const record = asRecord(value);
  const defaults = asRecord(record?.modelDefaults ?? record?.defaults ?? record);
  if (!defaults) {
    return undefined;
  }
  const model = asString(defaults.model ?? defaults.modelRef);
  const variant = asString(defaults.variant);
  const timeoutMs = asPositiveInteger(defaults.timeoutMs);
  const maxOutputBytes = asPositiveInteger(defaults.maxOutputBytes);
  if (model && !isDirectModelRef(model)) {
    throw new Error("INVALID_PROJECT_MODEL_DEFAULT");
  }
  if (!model && !variant && !timeoutMs && !maxOutputBytes) {
    return undefined;
  }
  return {
    ...(model ? { model } : {}),
    ...(variant ? { variant } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(maxOutputBytes ? { maxOutputBytes } : {})
  };
}

function normalizeProfileDrafts(value: unknown): ProjectCreateProfileDraft[] {
  const record = asRecord(value);
  const profile = asRecord(record?.profile);
  const entries = Array.isArray(record?.profiles)
    ? record.profiles
    : profile
      ? [profile]
      : [];
  return entries
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((entry) => ({
      profileId: asString(entry.profileId)?.trim() ?? "",
      toolRef: asString(entry.toolRef)?.trim() ?? "",
      timeoutMs: asPositiveInteger(entry.timeoutMs),
      maxOutputBytes: asPositiveInteger(entry.maxOutputBytes)
    }))
    .filter((entry) => entry.profileId && entry.toolRef);
}

async function applyProjectCreateModelDefaults(args: {
  workdir: string;
  systemId: string;
  modelSelectionPath: string;
  strategy?: unknown;
}): Promise<ProjectCreateModelDefaults | undefined> {
  const modelDefaults = normalizeModelDefaults(args.strategy);
  if (!modelDefaults) {
    return undefined;
  }
  const existing = asRecord(await readJsonFile(args.modelSelectionPath).catch(() => undefined)) ?? {};
  const systems = asRecord(existing.systems) ?? {};
  const systemEntry = asRecord(systems[args.systemId]) ?? {};
  await writeJsonFileAtomic(args.modelSelectionPath, {
    ...existing,
    configVersion: "1",
    defaults: {
      ...(asRecord(existing.defaults) ?? {}),
      ...modelDefaults
    },
    systems: {
      ...systems,
      [args.systemId]: {
        ...systemEntry,
        defaults: {
          ...(asRecord(systemEntry.defaults) ?? {}),
          ...modelDefaults
        }
      }
    }
  });
  return modelDefaults;
}

async function applyProjectCreateProfiles(args: {
  workdir: string;
  strategy?: unknown;
}): Promise<ProjectCreateProfileDraft[]> {
  const incoming = normalizeProfileDrafts(args.strategy);
  if (!incoming.length) {
    return [];
  }
  const profilesPath = resolve(args.workdir, "profiles.json");
  const existing = await loadProfiles(undefined, args.workdir).catch(() => []);
  const byProfileId = new Map(existing.map((profile) => [profile.profileId, profile]));
  for (const profile of incoming) {
    byProfileId.set(profile.profileId, profile);
  }
  const profiles = Array.from(byProfileId.values()).sort((left, right) => left.profileId.localeCompare(right.profileId));
  await writeJsonFileAtomic(profilesPath, validateProfilesConfig(profiles, profilesPath));
  return incoming;
}

async function persistProjectCreatePreferences(args: {
  workdir: string;
  authoring: Record<string, unknown>;
  preferences?: ProjectCreatePreferences;
}): Promise<Record<string, unknown>> {
  if (!args.preferences) {
    return args.authoring;
  }
  const ogsPaths = resolveOgsPaths(args.workdir);
  const projectMeta = asRecord((await readJsonFile(ogsPaths.projectPath).catch(() => undefined)) ?? {});
  const existingVisualizer = asRecord(projectMeta?.visualizer) ?? {};
  await writeJsonFileAtomic(ogsPaths.projectPath, {
    ...(projectMeta ?? {}),
    visualizer: {
      ...existingVisualizer,
      projectCreate: args.preferences
    }
  });
  return {
    ...args.authoring,
    visualizer: {
      ...(asRecord(args.authoring.visualizer) ?? {}),
      projectCreate: args.preferences
    }
  };
}

async function hasProjectFiles(workdir: string): Promise<boolean> {
  const systemStat = await stat(resolve(workdir, "system.mmd")).catch(() => undefined);
  const projectStat = await stat(resolve(workdir, ".ogs", "project.json")).catch(() => undefined);
  return Boolean(systemStat?.isFile() && projectStat?.isFile());
}

async function directoryEntries(workdir: string): Promise<string[]> {
  return (await readdir(workdir).catch(() => [])).filter((entry) => entry !== ".DS_Store");
}

async function listControlledProjectConflicts(workdir: string): Promise<string[]> {
  const conflicts: string[] = [];
  for (const relativePath of PROJECT_CONTROLLED_PATHS) {
    if (await pathExists(resolve(workdir, relativePath))) {
      conflicts.push(relativePath);
    }
  }
  return conflicts;
}

export async function inspectProjectWorkspace(workdir: string): Promise<Record<string, unknown>> {
  const workdirStat = await stat(workdir).catch(() => undefined);
  const exists = Boolean(workdirStat);
  const isDirectory = Boolean(workdirStat?.isDirectory());
  const hasProject = isDirectory ? await hasProjectFiles(workdir) : false;
  const entries = isDirectory ? await directoryEntries(workdir) : [];
  const controlledPathConflicts =
    isDirectory && !hasProject && entries.length ? await listControlledProjectConflicts(workdir) : [];
  const projectValidation = hasProject
    ? await (async () => {
        try {
          return await validateProjectSystemSource({
            workdir,
            systemPath: resolve(workdir, "system.mmd"),
            systemSource: await readFile(resolve(workdir, "system.mmd"), "utf8")
          });
        } catch (error) {
          return {
            ok: false,
            diagnostics: buildParseDiagnostics(error),
            structure: null
          };
        }
      })()
    : null;
  const isProjectValid = projectValidation?.ok === true;
  const state = hasProject
    ? (isProjectValid ? "project" : "project-invalid")
    : entries.length === 0
      ? "empty"
      : controlledPathConflicts.length
        ? "non-project-conflict"
        : "non-project-ready";
  return {
    workdir,
    exists,
    isDirectory,
    hasProject,
    isProjectValid,
    state,
    entryCount: entries.length,
    controlledPathConflicts,
    projectValidation,
    canInitialize: state === "empty" || state === "non-project-ready"
  };
}

function normalizeProjectTemplateId(value: unknown): ProjectTemplateId {
  const templateId = asString(value) ?? "empty";
  if (!isProjectTemplateId(templateId)) {
    throw new Error("INVALID_PROJECT_TEMPLATE");
  }
  return templateId;
}

function assertProjectName(value: unknown): string | undefined {
  const projectName = asString(value)?.trim();
  if (!projectName) {
    return undefined;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(projectName)) {
    throw new Error("INVALID_PROJECT_NAME");
  }
  return projectName;
}

async function assertNoProjectFileConflicts(workdir: string): Promise<void> {
  const conflicts = await listControlledProjectConflicts(workdir);
  if (conflicts.length) {
    const error = new Error("PROJECT_FILE_CONFLICT") as Error & { code?: string; details?: unknown };
    error.code = "PROJECT_FILE_CONFLICT";
    error.details = { workdir, conflicts };
    throw error;
  }
}

function deriveProjectId(input: string): string {
  const normalized = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+/g, "-")
    .replace(/[._-]+$/, "");
  return normalized || "project";
}

async function removeCreatedProjectFiles(workdir: string, testHooks?: ProjectCreateTestHooks): Promise<void> {
  const injectedFailurePatterns = Array.isArray(testHooks?.cleanupFailurePatterns)
    ? testHooks.cleanupFailurePatterns.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const failures: Array<{ path: string; message: string }> = [];
  for (const [targetPath, options] of [
    [resolve(workdir, "system.mmd"), { force: true }],
    [resolve(workdir, "system.example.mmd"), { force: true }],
    [resolve(workdir, "profiles.json"), { force: true }],
    [resolve(workdir, "tools.json"), { force: true }],
    [resolve(workdir, ".ogs"), { recursive: true, force: true }],
    [resolve(workdir, "og-roles"), { recursive: true, force: true }]
  ] as const) {
    try {
      if (injectedFailurePatterns.some((pattern) => targetPath.includes(pattern))) {
        throw new Error(`Injected cleanup failure for ${targetPath}`);
      }
      await rm(targetPath, options);
    } catch (error) {
      failures.push({
        path: targetPath,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (failures.length) {
    const error = new Error("PROJECT_CREATE_CLEANUP_FAILED") as Error & { code?: string; details?: unknown };
    error.code = "PROJECT_CREATE_CLEANUP_FAILED";
    error.details = { workdir, failures };
    throw error;
  }
}

function createFallbackModelCatalog(): ModelCatalog {
  return {
    catalogVersion: "1",
    generatedAt: new Date().toISOString(),
    source: {
      command: "visualizer project create fallback"
    },
    models: [
      {
        ref: "opencode/gpt-5.4",
        provider: "opencode",
        model: "gpt-5.4",
        name: "GPT-5.4",
        status: "active",
        capabilities: {
          textInput: true,
          textOutput: true,
          toolcall: true
        },
        variants: ["medium"]
      }
    ]
  };
}

function createFallbackModelSelection(systemId: string): ModelSelectionConfig {
  return {
    configVersion: "1",
    defaults: {
      model: "opencode/gpt-5.4",
      variant: "medium",
      timeoutMs: 120000,
      maxOutputBytes: 65536
    },
    systems: {
      [systemId]: {
        defaults: {
          model: "opencode/gpt-5.4",
          variant: "medium"
        }
      }
    }
  };
}

async function getMtimeToken(path: string): Promise<string> {
  const fileStat = await stat(path).catch(() => undefined);
  return fileStat ? `${path}:${fileStat.mtimeMs}:${fileStat.size}` : `${path}:missing`;
}

async function computeProjectProjectionCacheToken(workdir: string): Promise<string> {
  const ogsPaths = resolveOgsPaths(workdir);
  const tokens = await Promise.all([
    getMtimeToken(resolve(workdir, "system.mmd")),
    getMtimeToken(ogsPaths.runtimePath),
    getMtimeToken(ogsPaths.modelSelectionPath),
    getMtimeToken(ogsPaths.modelCatalogPath),
    getMtimeToken(ogsPaths.lawsPath),
    getMtimeToken(ogsPaths.userProfilePath),
    getMtimeToken(resolve(workdir, "profiles.json")),
    getMtimeToken(resolve(workdir, "tools.json")),
    getMtimeToken(ogsPaths.projectPath)
  ]);
  return tokens.join("|");
}

async function assembleProjectContextFromSource(args: {
  workdir: string;
  systemPath?: string;
  systemSource: string;
}): Promise<ProjectContext> {
  const ogsPaths = resolveOgsPaths(args.workdir);
  const systemPath = args.systemPath ?? resolve(args.workdir, "system.mmd");
  const system = parseSystemFromMermaidSource(args.systemSource);
  const runtimeConfig = await loadRuntimeConfig(undefined, args.workdir);
  const modelSelection = await loadModelSelection(ogsPaths.modelSelectionPath);
  const modelCatalog = await loadModelCatalog(ogsPaths.modelCatalogPath);
  const resolvedModelSelection = resolveModelSelectionForSystem({
    system,
    selection: modelSelection,
    catalog: modelCatalog
  });
  const laws = await loadLaws(undefined, args.workdir);
  const userProfile = await loadUserProfile(undefined, args.workdir);
  const profiles = await loadProfiles(undefined, args.workdir);
  const tools = await loadTools(undefined, args.workdir);
  const effectiveLaw = resolveEffectiveLaw(system, laws);
  const roleRepoRoot = resolveProjectRoleRepoRoot(args.workdir, runtimeConfig.roleRepo);
  const roleRootDir = resolveProjectRoleRootDir(args.workdir, runtimeConfig.roleRepo);
  const contractPlan = system.graph?.handoffContracts
    ? await loadFlowContractPlan({
        system,
        contractPath: system.graph.handoffContracts
      })
    : undefined;
  const rolePackagesByRoleId = await loadRolePackages({
    system,
    roleRootDir: resolveProjectRoleRootDir(args.workdir, runtimeConfig.roleRepo)
  });
  const compilerResult = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    contractPlan,
    effectiveLaw,
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId
  });
  if (!compilerResult.ok) {
    const error = new Error(
      `Compiler static semantics check failed for project visualization: ${compilerResult.diagnostics
        .map((diagnostic) => diagnostic.code)
        .join(", ")}`
    ) as Error & { diagnostics?: CompilerDiagnostic[] };
    error.diagnostics = compilerResult.diagnostics;
    throw error;
  }
  const projectMeta = await readJsonFile(ogsPaths.projectPath).catch(() => undefined);

  return {
    systemPath,
    systemSource: args.systemSource,
    system,
    runtimeConfig,
    modelSelection,
    modelCatalog,
    laws,
    userProfile,
    profiles,
    tools,
    compilerSnapshot: compilerResult.snapshot,
    resolvedModelWarnings: resolvedModelSelection.warnings,
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId,
    roleRepoRoot,
    roleRootDir,
    rolePackagesByRoleId,
    contractPlan,
    projectMeta
  };
}

async function assembleProjectContext(workdir: string): Promise<ProjectContext> {
  pruneProjectProjectionCache();
  const token = await computeProjectProjectionCacheToken(workdir);
  const cached = projectProjectionCache.get(workdir);
  if (cached && cached.token === token) {
    cached.lastAccessedAtMs = Date.now();
    return cached.value;
  }
  const nowMs = Date.now();
  const value = assembleProjectContextFromSource({
    workdir,
    systemSource: await readFile(resolve(workdir, "system.mmd"), "utf8")
  });
  projectProjectionCache.set(workdir, {
    token,
    value,
    cachedAtMs: nowMs,
    lastAccessedAtMs: nowMs
  });
  pruneProjectProjectionCache();
  return value;
}

function pruneProjectProjectionCache(nowMs = Date.now()): void {
  for (const [workdir, entry] of projectProjectionCache.entries()) {
    if (nowMs - entry.cachedAtMs > PROJECT_PROJECTION_CACHE_TTL_MS) {
      projectProjectionCache.delete(workdir);
    }
  }
  while (projectProjectionCache.size > PROJECT_PROJECTION_CACHE_MAX_SIZE) {
    let oldestWorkdir: string | undefined;
    let oldestAccessedAtMs = Number.POSITIVE_INFINITY;
    for (const [workdir, entry] of projectProjectionCache.entries()) {
      if (entry.lastAccessedAtMs < oldestAccessedAtMs) {
        oldestWorkdir = workdir;
        oldestAccessedAtMs = entry.lastAccessedAtMs;
      }
    }
    if (!oldestWorkdir) {
      break;
    }
    projectProjectionCache.delete(oldestWorkdir);
  }
}

function buildWorkbenchStructure(system: SystemDefinition): Record<string, unknown> {
  return {
    systemId: system.systemId,
    systemVersion: system.systemVersion,
    entryRoleId: system.entryRoleId,
    roleCount: system.roleIds.length,
    flowCount: system.flows.length,
    roles: system.roleIds.map((roleId) => ({
      roleId,
      bindingKind: system.executionBinding[roleId]
        ? "profile"
        : system.modelBinding[roleId]
          ? "model"
          : "noop",
      routingMode: system.graph?.routingModeByRoleId[roleId],
      joinMode: system.graph?.joinModeByRoleId[roleId],
      reviewMode: system.graph?.reviewByRoleId?.[roleId]?.mode
    })),
    flows: system.flows.map((flow) => ({
      fromRoleId: flow.fromRoleId,
      toRoleId: flow.toRoleId,
      eventType: flow.eventType
    }))
  };
}

function buildParseDiagnostics(error: unknown): Record<string, unknown>[] {
  if (error instanceof RuntimeError) {
    return [{
      code: error.envelope.errorCode,
      message: error.envelope.message,
      severity: "error",
      stage: "parse",
      line: error.envelope.line
    }];
  }
  if (error instanceof Error && "envelope" in error) {
    const envelope = asRecord((error as { envelope?: unknown }).envelope);
    if (envelope) {
      return [{
        code: asString(envelope.errorCode) ?? "PROJECT_SYSTEM_PARSE_FAILED",
        message: asString(envelope.message) ?? String(error),
        severity: "error",
        stage: "parse",
        line: typeof envelope.line === "number" ? envelope.line : undefined
      }];
    }
  }
  return [{
    code: "PROJECT_SYSTEM_PARSE_FAILED",
    message: error instanceof Error ? error.message : String(error),
    severity: "error",
    stage: "parse"
  }];
}

function buildCompileDiagnostics(error: Error & { diagnostics?: CompilerDiagnostic[] }): Record<string, unknown>[] {
  return (error.diagnostics ?? []).map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    severity: "error",
    stage: "compile",
    roleId: diagnostic.roleId,
    fieldName: diagnostic.fieldName,
    selector: diagnostic.selector
  }));
}

function assertEditableRoleId(roleId: string): string {
  const normalized = roleId.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(normalized)) {
    throw new Error("INVALID_ROLE_PACKAGE_ID");
  }
  return normalized;
}

function rolePackageFilePath(roleDir: string, fileName: RolePackageFileName): string {
  return resolve(roleDir, fileName);
}

async function readRolePackageEditorFile(roleDir: string, fileName: RolePackageFileName): Promise<Record<string, unknown>> {
  const filePath = rolePackageFilePath(roleDir, fileName);
  const exists = await pathExists(filePath);
  return {
    fileName,
    path: filePath,
    exists,
    content: exists ? await readFile(filePath, "utf8") : ""
  };
}

function rolePackageEditorFilesFromPayload(value: unknown): Partial<Record<RolePackageFileName, string>> {
  const record = asRecord(value);
  const files = asRecord(record?.files) ?? record;
  const result: Partial<Record<RolePackageFileName, string>> = {};
  for (const fileName of ROLE_PACKAGE_FILE_NAMES) {
    const entry = files?.[fileName];
    if (typeof entry === "string") {
      result[fileName] = entry;
      continue;
    }
    const nested = asRecord(entry);
    if (typeof nested?.content === "string") {
      result[fileName] = nested.content;
    }
  }
  return result;
}

function validateRolePackageEditorContents(args: {
  roleId: string;
  roleDir: string;
  files: Partial<Record<RolePackageFileName, string>>;
}): {
  manifest: ReturnType<typeof validateRolePackageManifest>;
  outputSchema: unknown;
} {
  const roleJsonContent = args.files["role.json"] ?? "";
  const outputSchemaContent = args.files["output.schema.json"] ?? "";
  let roleJson: unknown;
  let outputSchema: unknown;
  try {
    roleJson = JSON.parse(roleJsonContent);
  } catch (error) {
    throw new Error(`Invalid role.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    outputSchema = JSON.parse(outputSchemaContent);
  } catch (error) {
    throw new Error(`Invalid output.schema.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  const manifest = validateRolePackageManifest(roleJson, rolePackageFilePath(args.roleDir, "role.json"));
  if (manifest.roleId !== args.roleId) {
    throw new Error(`role.json roleId mismatch: expected "${args.roleId}"`);
  }
  if (manifest.promptTemplate !== "prompt.md" || manifest.outputSchema !== "output.schema.json") {
    throw new Error("role.json must keep promptTemplate=\"prompt.md\" and outputSchema=\"output.schema.json\" for visual editing.");
  }
  return { manifest, outputSchema };
}

async function loadRolePackageEditorContext(workdir: string): Promise<{
  roleRepoRoot: string;
  roleRootDir: string;
  systemRoleIds: string[];
}> {
  const runtimeConfig = await loadRuntimeConfig(undefined, workdir);
  const systemSource = await readFile(resolve(workdir, "system.mmd"), "utf8");
  const system = parseSystemFromMermaidSource(systemSource);
  const roleRepoRoot = resolveProjectRoleRepoRoot(workdir, runtimeConfig.roleRepo);
  const roleRootDir = resolveProjectRoleRootDir(workdir, runtimeConfig.roleRepo);
  const resolvedWorkdir = resolve(workdir);
  if (roleRootDir !== resolvedWorkdir && !roleRootDir.startsWith(`${resolvedWorkdir}${sep}`)) {
    throw new Error("ROLE_PACKAGE_REPO_OUTSIDE_WORKDIR");
  }
  return {
    roleRepoRoot,
    roleRootDir,
    systemRoleIds: system.roleIds
  };
}

export function invalidateProjectProjectionCache(workdir: string): void {
  projectProjectionCache.delete(workdir);
}

export function getProjectProjectionCacheStats(): Record<string, unknown> {
  pruneProjectProjectionCache();
  return {
    size: projectProjectionCache.size,
    maxSize: PROJECT_PROJECTION_CACHE_MAX_SIZE,
    ttlMs: PROJECT_PROJECTION_CACHE_TTL_MS
  };
}

export async function inspectProjectSystemWorkbench(args: {
  workdir: string;
  systemPath?: string;
  systemSource?: string;
}): Promise<Record<string, unknown>> {
  const systemPath = args.systemPath ?? resolve(args.workdir, "system.mmd");
  const systemSource = args.systemSource ?? (await readFile(systemPath, "utf8"));
  const validation = await validateProjectSystemSource({
    workdir: args.workdir,
    systemPath,
    systemSource
  });
  return {
    workdir: args.workdir,
    systemPath,
    systemSource,
    validation
  };
}

export async function validateProjectSystemSource(args: {
  workdir: string;
  systemPath?: string;
  systemSource: string;
}): Promise<Record<string, unknown>> {
  try {
    const context = await assembleProjectContextFromSource({
      workdir: args.workdir,
      systemPath: args.systemPath,
      systemSource: args.systemSource
    });
    return {
      ok: true,
      diagnostics: [],
      structure: buildWorkbenchStructure(context.system)
    };
  } catch (error) {
    if (error instanceof RuntimeError || (error instanceof Error && "envelope" in error)) {
      return {
        ok: false,
        diagnostics: buildParseDiagnostics(error),
        structure: null
      };
    }
    const compileError =
      error instanceof Error && Array.isArray((error as Error & { diagnostics?: unknown }).diagnostics)
        ? (error as Error & { diagnostics?: CompilerDiagnostic[] })
        : undefined;
    if (compileError) {
      return {
        ok: false,
        diagnostics: buildCompileDiagnostics(compileError),
        structure: null
      };
    }
    return {
      ok: false,
      diagnostics: buildParseDiagnostics(error),
      structure: null
    };
  }
}

function assertPathWithinWorkdir(workdir: string, targetPath: string): string {
  const resolvedWorkdir = resolve(workdir);
  const resolvedTarget = resolve(targetPath);
  if (
    resolvedTarget !== resolvedWorkdir &&
    !resolvedTarget.startsWith(`${resolvedWorkdir}${sep}`)
  ) {
    throw new Error(`Path must stay within project workdir: ${targetPath}`);
  }
  if (resolvedTarget.includes(`${sep}.ogs${sep}runs${sep}`) || resolvedTarget.endsWith(`${sep}.ogs${sep}runs`)) {
    throw new Error(`Path cannot target run artifacts: ${targetPath}`);
  }
  return resolvedTarget;
}

export async function saveProjectSystemSource(args: {
  workdir: string;
  systemSource: string;
  saveAsPath?: string;
}): Promise<Record<string, unknown>> {
  const savedPath = assertPathWithinWorkdir(
    args.workdir,
    args.saveAsPath ? resolve(args.workdir, args.saveAsPath) : resolve(args.workdir, "system.mmd")
  );
  const validation = await validateProjectSystemSource({
    workdir: args.workdir,
    systemPath: savedPath,
    systemSource: args.systemSource
  });
  if (validation.ok !== true) {
    return {
      workdir: args.workdir,
      savedPath,
      validation,
      followUpActions: [{
        action: "fix-validation-errors",
        label: "Resolve Mermaid parse or compile diagnostics before saving."
      }]
    };
  }
  await mkdir(dirname(savedPath), { recursive: true });
  await writeFile(savedPath, args.systemSource, "utf8");
  invalidateProjectProjectionCache(args.workdir);
  return {
    workdir: args.workdir,
    savedPath,
    validation,
    followUpActions: [
      {
        action: "project-cache-invalidated",
        label: "Project projections were invalidated for the active workdir."
      },
      {
        action: "refresh-project-summary",
        label: "Reload project and graph views to reflect the saved system."
      }
    ]
  };
}

async function readOptionalJson(path: string): Promise<unknown | null> {
  return (await readJsonFile(path).catch(() => null)) ?? null;
}

export async function exportProjectBundle(workdir: string): Promise<Record<string, unknown>> {
  const ogsPaths = resolveOgsPaths(workdir);
  const systemSource = await readFile(resolve(workdir, "system.mmd"), "utf8");
  const projectMeta = await readOptionalJson(ogsPaths.projectPath);
  const projectRecord = asRecord(projectMeta);
  const systemHash = createHash("sha256").update(systemSource).digest("hex");
  const generatedAt = new Date().toISOString();
  return {
    mode: "single-project-v1",
    releaseManifest: {
      manifestVersion: 1,
      packageMode: "single-project-v1",
      generatedAt,
      projectId: asString(projectRecord?.projectId),
      systemPath: "system.mmd",
      systemHash,
      artifactScope: [
        "system.mmd",
        ".ogs/runtime.json",
        ".ogs/model-selection.json",
        ".ogs/model-catalog.json",
        ".ogs/laws.json",
        ".ogs/user-profile.json",
        "profiles.json",
        "tools.json",
        ".ogs/project.json"
      ],
      requiredEnv: [],
      excludes: [".ogs/runs", "logs", "timeline", "checkpoints", "reviews"]
    },
    project: {
      systemPath: "system.mmd",
      systemSource,
      runtime: await readOptionalJson(ogsPaths.runtimePath),
      modelSelection: await readOptionalJson(ogsPaths.modelSelectionPath),
      modelCatalog: await readOptionalJson(ogsPaths.modelCatalogPath),
      laws: await readOptionalJson(ogsPaths.lawsPath),
      userProfile: await readOptionalJson(ogsPaths.userProfilePath),
      profiles: await readOptionalJson(resolve(workdir, "profiles.json")),
      tools: await readOptionalJson(resolve(workdir, "tools.json")),
      project: projectMeta
    }
  };
}

export async function loadProjectBundle(args: {
  workdir: string;
  bundle: unknown;
}): Promise<Record<string, unknown>> {
  const record = asRecord(args.bundle);
  const project = asRecord(record?.project);
  if (record?.mode !== "single-project-v1" || !project) {
    throw new Error("Unsupported project bundle format; expected mode=single-project-v1.");
  }
  const systemSource = asString(project.systemSource);
  if (!systemSource) {
    throw new Error("Project bundle is missing project.systemSource.");
  }
  const validation = await validateProjectSystemSource({
    workdir: args.workdir,
    systemPath: resolve(args.workdir, "system.mmd"),
    systemSource
  });
  if (validation.ok !== true) {
    return {
      workdir: args.workdir,
      mode: "single-project-v1",
      loadedFiles: [],
      validation,
      followUpActions: [{
        action: "fix-validation-errors",
        label: "Imported Mermaid system must validate before the project can be rebound."
      }]
    };
  }

  const ogsPaths = resolveOgsPaths(args.workdir);
  const writes: Array<[string, unknown, boolean]> = [
    [resolve(args.workdir, "system.mmd"), systemSource, false],
    [ogsPaths.runtimePath, project.runtime ?? null, true],
    [ogsPaths.modelSelectionPath, project.modelSelection ?? null, true],
    [ogsPaths.modelCatalogPath, project.modelCatalog ?? null, true],
    [ogsPaths.lawsPath, project.laws ?? null, true],
    [ogsPaths.userProfilePath, project.userProfile ?? null, true],
    [resolve(args.workdir, "profiles.json"), project.profiles ?? null, true],
    [resolve(args.workdir, "tools.json"), project.tools ?? null, true],
    [ogsPaths.projectPath, project.project ?? null, true]
  ];
  const loadedFiles: string[] = [];
  for (const [path, value, json] of writes) {
    if (value === null || value === undefined) {
      continue;
    }
    if (json) {
      await writeJsonFileAtomic(path, value);
    } else {
      await writeFile(path, String(value), "utf8");
    }
    loadedFiles.push(relative(args.workdir, path) || ".");
  }
  invalidateProjectProjectionCache(args.workdir);
  return {
    workdir: args.workdir,
    mode: "single-project-v1",
    loadedFiles,
    validation,
    followUpActions: [
      {
        action: "project-rebound",
        label: "Single-project binding was replaced in-place for the current workdir."
      },
      {
        action: "project-cache-invalidated",
        label: "Project projections were invalidated after load."
      }
    ]
  };
}

export async function createProjectVisualization(args: {
  currentWorkdir: string;
  projectName?: unknown;
  templateId?: unknown;
  conflictStrategy?: unknown;
  testHooks?: ProjectCreateTestHooks;
}): Promise<Record<string, unknown>> {
  const forceCreateFailure = args.testHooks?.forceCreateFailure === true;
  const targetWorkdir = resolve(args.currentWorkdir);
  const templateId = normalizeProjectTemplateId(args.templateId);
  const projectName = assertProjectName(args.projectName) ?? basename(targetWorkdir);
  const projectId = deriveProjectId(projectName);
  const conflictStrategy = asString(args.conflictStrategy) ?? "reject";
  const workspace = await inspectProjectWorkspace(targetWorkdir);
  if (workspace.isDirectory !== true) {
    const error = new Error("INVALID_PROJECT_WORKDIR") as Error & { code?: string; details?: unknown };
    error.code = "INVALID_PROJECT_WORKDIR";
    error.details = workspace;
    throw error;
  }
  if (workspace.hasProject === true) {
    const error = new Error("PROJECT_ALREADY_EXISTS") as Error & { code?: string; details?: unknown };
    error.code = "PROJECT_ALREADY_EXISTS";
    error.details = workspace;
    throw error;
  }
  if (workspace.state === "non-project-ready" && conflictStrategy !== "init-current") {
    const error = new Error("PROJECT_DIR_CONFLICT") as Error & { code?: string; details?: unknown };
    error.code = "PROJECT_DIR_CONFLICT";
    error.details = workspace;
    throw error;
  }
  if (workspace.state === "non-project-conflict") {
    await assertNoProjectFileConflicts(targetWorkdir);
  }

  try {
    await ensureProjectSkeleton({
      workdir: targetWorkdir,
      projectId,
      projectName
    });
    const templateSpec = await scaffoldProjectTemplate({
      workdir: targetWorkdir,
      templateId
    });
    const systemSource = await readFile(resolve(targetWorkdir, "system.mmd"), "utf8");
    const authoring = importMermaidToAuthoring({
      workdir: targetWorkdir,
      systemPath: "system.mmd",
      systemSource
    });
    const authoringRecord = authoring as Record<string, unknown>;
    const warnings: string[] = [];
    let modelSyncResult: {
      catalogPath: string;
      selectionPath: string;
      generatedSelection: boolean;
      selectedModel?: string;
    };
    try {
      modelSyncResult = await syncProjectModels({
        workdir: targetWorkdir,
        systemPath: "system.mmd",
        strategy: templateSpec.modelSeedStrategy
      });
    } catch (error) {
      const paths = resolveOgsPaths(targetWorkdir);
      warnings.push(
        "Model catalog discovery is unavailable. A fallback model selection was written; refresh models before release."
      );
      await writeJsonFileAtomic(paths.modelCatalogPath, createFallbackModelCatalog());
      await writeJsonFileAtomic(
        paths.modelSelectionPath,
        createFallbackModelSelection(authoring.system.systemId)
      );
      modelSyncResult = {
        catalogPath: paths.modelCatalogPath,
        selectionPath: paths.modelSelectionPath,
        generatedSelection: true,
        selectedModel: "opencode/gpt-5.4"
      };
    }
    const draft = await saveStudioAuthoringDraft({
      workdir: targetWorkdir,
      authoring: authoringRecord,
      validateSystemSource: validateProjectSystemSource
    });
    if (forceCreateFailure) {
      const forcedError = new Error("PROJECT_CREATE_FORCED_FAILURE") as Error & {
        code?: string;
        details?: unknown;
      };
      forcedError.code = "PROJECT_CREATE_FAILED";
      forcedError.details = { forcedBy: "projectCreateTestHooks.forceCreateFailure" };
      throw forcedError;
    }
    const syncResult = await syncProjectDependencies({
      workdir: targetWorkdir,
      systemPath: "system.mmd"
    });
    const index = await rebuildRunsIndex(targetWorkdir);
    invalidateProjectProjectionCache(targetWorkdir);
    return {
      workdir: targetWorkdir,
      projectId,
      projectName,
      templateId,
      mode: "single-project-v1",
      runCount: index.runs.length,
      modelCatalogPath: modelSyncResult.catalogPath,
      modelSelectionPath: modelSyncResult.selectionPath,
      selectedModel: modelSyncResult.selectedModel,
      importedRoleIds: syncResult.importedRoleIds,
      importedModelIds: syncResult.importedModelIds,
      warnings,
      draftPath: draft.draftPath,
      draftState: templateId === "empty" ? "draft-unbound-unpublishable" : "draft",
      validation: await validateProjectSystemSource({
        workdir: targetWorkdir,
        systemPath: resolve(targetWorkdir, "system.mmd"),
        systemSource
      })
    };
  } catch (error) {
    try {
      await removeCreatedProjectFiles(targetWorkdir, args.testHooks);
    } catch (cleanupError) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      const wrapped = new Error(`${originalMessage}; cleanup failed: ${cleanupMessage}`) as Error & {
        code?: string;
        details?: unknown;
      };
      wrapped.code =
        asString((error as { code?: unknown })?.code) ??
        (error instanceof Error && error.message ? error.message : undefined) ??
        "PROJECT_CREATE_FAILED";
      wrapped.details = {
        cause: (error as { details?: unknown })?.details,
        cleanup: (cleanupError as { details?: unknown })?.details
      };
      throw wrapped;
    }
    throw error;
  }
}

async function readRoleCatalogEntry(args: {
  roleRootDir: string;
  roleId: string;
  source: string;
  projectRoleRootDir?: string;
}): Promise<Record<string, unknown>> {
  const roleDir = resolve(args.roleRootDir, args.roleId);
  const roleJsonPath = resolve(roleDir, "role.json");
  const raw = await readJsonFile(roleJsonPath).catch(() => undefined);
  let manifest: ReturnType<typeof validateRolePackageManifest> | undefined;
  let health = "ok";
  let errorMessage: string | undefined;
  try {
    manifest = validateRolePackageManifest(raw, roleJsonPath);
  } catch (error) {
    health = "invalid";
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  const promptPath = manifest?.promptTemplate ? resolve(roleDir, manifest.promptTemplate) : undefined;
  const schemaPath = manifest?.outputSchema ? resolve(roleDir, manifest.outputSchema) : undefined;
  const catalogToken = createHash("sha256");
  for (const filePath of [
    roleJsonPath,
    promptPath,
    schemaPath,
    resolve(roleDir, "source.json")
  ].filter((value): value is string => Boolean(value))) {
    const fileStat = await stat(filePath).catch(() => undefined);
    catalogToken.update(filePath.slice(roleDir.length + 1));
    catalogToken.update("\0");
    catalogToken.update(fileStat ? String(fileStat.mtimeMs) : "missing");
    catalogToken.update("\0");
    catalogToken.update(fileStat ? String(fileStat.size) : "0");
    catalogToken.update("\0");
  }
  const projectRoleDir = args.projectRoleRootDir ? resolve(args.projectRoleRootDir, args.roleId) : undefined;
  const token = catalogToken.digest("hex");
  return {
    roleId: manifest?.roleId ?? args.roleId,
    name: manifest?.name ?? args.roleId,
    summary: manifest?.description ?? errorMessage,
    roleVersion: manifest?.roleVersion,
    tags: manifest?.tags ?? manifest?.preferredModelTags ?? [],
    source: args.source,
    catalogToken: token,
    digest: token,
    health,
    hasRoleJson: await pathExists(roleJsonPath),
    hasPrompt: promptPath ? await pathExists(promptPath) : false,
    hasOutputSchema: schemaPath ? await pathExists(schemaPath) : false,
    alreadyImported: projectRoleDir ? await pathExists(projectRoleDir) : undefined
  };
}

export async function listInstalledRoleCatalog(workdir: string): Promise<Record<string, unknown>> {
  const installedRoleRootDir = resolveTemplateRoleRootDir();
  const runtimeConfig = await loadRuntimeConfig(undefined, workdir).catch(() => undefined);
  const projectRoleRootDir = runtimeConfig
    ? resolveProjectRoleRootDir(workdir, runtimeConfig.roleRepo)
    : resolve(workdir, "og-roles", "roles");
  const entries = await readdir(installedRoleRootDir, { withFileTypes: true }).catch(() => []);
  const roles = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readRoleCatalogEntry({
        roleRootDir: installedRoleRootDir,
        roleId: entry.name,
        source: "installed",
        projectRoleRootDir
      }))
  );
  return {
    source: "installed",
    roles: roles.sort((left, right) => String(left.roleId).localeCompare(String(right.roleId)))
  };
}

export async function importInstalledRolesVisualization(args: {
  workdir: string;
  roleIds: unknown;
}): Promise<Record<string, unknown>> {
  const roleIds = Array.isArray(args.roleIds)
    ? args.roleIds.map((roleId) => asString(roleId)?.trim()).filter((roleId): roleId is string => Boolean(roleId))
    : [];
  if (!roleIds.length) {
    throw new Error("ROLE_IMPORT_SELECTION_REQUIRED");
  }
  const importedRoleIds: string[] = [];
  const skippedRoleIds: string[] = [];
  for (const roleId of Array.from(new Set(roleIds)).sort((left, right) => left.localeCompare(right))) {
    const imported = await importInstalledRolePackageIntoProject({ workdir: args.workdir, roleId });
    if (imported) {
      importedRoleIds.push(roleId);
    } else {
      skippedRoleIds.push(roleId);
    }
  }
  invalidateProjectProjectionCache(args.workdir);
  return {
    workdir: args.workdir,
    importedRoleIds,
    skippedRoleIds,
    roleCatalog: await listInstalledRoleCatalog(args.workdir)
  };
}

export async function inspectProjectVisualization(workdir: string): Promise<Record<string, unknown>> {
  const ogsPaths = resolveOgsPaths(workdir);
  const context = await assembleProjectContext(workdir);
  const persistedIndex = await loadPersistedRunsIndex(workdir);

  return {
    workdir,
    project: {
      projectName: basename(workdir),
      projectId: asString(asRecord(context.projectMeta)?.projectId),
      createdAt: asString(asRecord(context.projectMeta)?.createdAt),
      systemId: context.system.systemId,
      systemVersion: context.system.systemVersion,
      entryRoleId: context.system.entryRoleId,
      roleCount: context.system.roleIds.length,
      roleIds: context.system.roleIds,
      flowCount: context.system.flows.length,
      modelBindings: Object.entries(context.system.modelBinding).map(([roleId, modelRef]) => ({
        roleId,
        modelRef
      })),
      execBindings: Object.entries(context.system.executionBinding).map(([roleId, profileId]) => ({
        roleId,
        profileId
      })),
      reviewedRoleIds: Object.keys(context.system.graph?.reviewByRoleId ?? {}).sort(),
      joinRoleIds: Object.keys(context.system.graph?.joinModeByRoleId ?? {}).sort(),
      loopRoleIds: Object.keys(context.system.graph?.loopMaxByRoleId ?? {}).sort(),
      contextMappedRoleIds: Object.keys(context.system.graph?.contextMapByRoleId ?? {}).sort(),
      roleRepoRoot: context.roleRepoRoot,
      runsDir: asString(asRecord(context.runtimeConfig)?.runsDir) ?? resolve(workdir, ".ogs", "runs"),
      bindingSummaryByRoleId: context.compilerSnapshot.bindingSummaryByRoleId,
      joinSummaryByRoleId: context.compilerSnapshot.joinSummaryByRoleId,
      loopSummaryByRoleId: context.compilerSnapshot.loopSummaryByRoleId,
      projectionSummaryByRoleId: context.compilerSnapshot.projectionSummaryByRoleId,
      reviewSummaryByRoleId: context.compilerSnapshot.reviewSummaryByRoleId,
      flowSummaryByKey: context.compilerSnapshot.flowSummaryByKey,
      lawSummary: context.compilerSnapshot.lawSummary,
      compilerDigest: context.compilerSnapshot.digest,
      compilerDiagnostics: context.compilerSnapshot.diagnostics,
      modelSelectionWarnings: context.resolvedModelWarnings,
      artifactPaths: {
        systemPath: context.systemPath,
        runtimePath: ogsPaths.runtimePath,
        modelSelectionPath: ogsPaths.modelSelectionPath,
        modelCatalogPath: ogsPaths.modelCatalogPath,
        lawsPath: ogsPaths.lawsPath,
        userProfilePath: ogsPaths.userProfilePath,
        projectPath: ogsPaths.projectPath
      }
    },
    recentRuns: persistedIndex?.runs.slice(0, 10) ?? []
  };
}

export async function inspectProjectSystemVisualization(workdir: string): Promise<Record<string, unknown>> {
  const context = await assembleProjectContext(workdir);
  return {
    workdir,
    systemSource: context.systemSource,
    system: context.system
  };
}

export async function inspectProjectConfigVisualization(workdir: string): Promise<Record<string, unknown>> {
  const ogsPaths = resolveOgsPaths(workdir);
  const context = await assembleProjectContext(workdir);
  return {
    workdir,
    paths: ogsPaths,
    runtime: context.runtimeConfig,
    modelSelection: context.modelSelection ?? null,
    modelCatalog: context.modelCatalog ?? null,
    laws: context.laws ?? null,
    userProfile: context.userProfile ?? null,
    profiles: context.profiles ?? [],
    tools: context.tools ?? [],
    project: context.projectMeta ?? null,
    roleRepoRoot: context.roleRepoRoot,
    compilerDigest: context.compilerSnapshot.digest,
    modelSelectionWarnings: context.resolvedModelWarnings
  };
}

export async function upsertProjectProfilesVisualization(args: {
  workdir: string;
  profiles: unknown;
}): Promise<Record<string, unknown>> {
  const profilesPath = resolve(args.workdir, "profiles.json");
  const incoming = validateProfilesConfig(args.profiles, profilesPath);
  const existing = await loadProfiles(undefined, args.workdir);
  const byProfileId = new Map(existing.map((profile) => [profile.profileId, profile]));
  for (const profile of incoming) {
    byProfileId.set(profile.profileId, profile);
  }
  const profiles = Array.from(byProfileId.values()).sort((left, right) => left.profileId.localeCompare(right.profileId));
  await writeJsonFileAtomic(profilesPath, profiles);
  invalidateProjectProjectionCache(args.workdir);
  return {
    workdir: args.workdir,
    profilesPath,
    profiles
  };
}

export async function upsertProjectExecutionConfigVisualization(args: {
  workdir: string;
  profiles: unknown;
  tools: unknown;
}): Promise<Record<string, unknown>> {
  const profilesPath = resolve(args.workdir, "profiles.json");
  const toolsPath = resolve(args.workdir, "tools.json");
  const incomingProfiles = validateProfilesConfig(args.profiles, profilesPath);
  const incomingTools = validateToolsConfig({ tools: args.tools }, toolsPath).tools;
  const existingProfiles = await loadProfiles(undefined, args.workdir).catch(() => []);
  const existingTools = await loadTools(undefined, args.workdir).catch(() => []);
  const profilesById = new Map(existingProfiles.map((profile) => [profile.profileId, profile]));
  const toolsByRef = new Map(existingTools.map((tool) => [tool.toolRef, tool]));
  for (const profile of incomingProfiles) {
    profilesById.set(profile.profileId, profile);
  }
  for (const tool of incomingTools) {
    toolsByRef.set(tool.toolRef, tool);
  }
  const profiles = Array.from(profilesById.values()).sort((left, right) => left.profileId.localeCompare(right.profileId));
  const tools = Array.from(toolsByRef.values()).sort((left, right) => left.toolRef.localeCompare(right.toolRef));
  await writeJsonFileAtomic(profilesPath, validateProfilesConfig(profiles, profilesPath));
  await writeJsonFileAtomic(toolsPath, validateToolsConfig({ tools }, toolsPath));
  invalidateProjectProjectionCache(args.workdir);
  return {
    workdir: args.workdir,
    profilesPath,
    toolsPath,
    profiles,
    tools
  };
}

export async function listProjectRolesVisualization(workdir: string): Promise<Record<string, unknown>> {
  const context = await assembleProjectContext(workdir);
  const roles = Object.entries(context.compilerSnapshot.roleSummaryByRoleId)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([roleId, roleSummary]) => ({
      roleId,
      summary: roleSummary,
      binding: context.compilerSnapshot.bindingSummaryByRoleId[roleId] ?? null,
      join: context.compilerSnapshot.joinSummaryByRoleId[roleId] ?? null,
      loop: context.compilerSnapshot.loopSummaryByRoleId[roleId] ?? null,
      projection: context.compilerSnapshot.projectionSummaryByRoleId[roleId] ?? null,
      review: context.compilerSnapshot.reviewSummaryByRoleId[roleId] ?? null
    }));
  return {
    workdir,
    roleRepoRoot: context.roleRepoRoot,
    roles
  };
}

function listRoleAllowedEvents(system: SystemDefinition, roleId: string): string[] {
  return Array.from(
    new Set(
      system.flows
        .filter((flow) => flow.fromRoleId === roleId && !isRuntimeOnlyErrorEvent(flow.eventType))
        .map((flow) => flow.eventType)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function getBindingSourceLabel(args: {
  roleId: string;
  context: ProjectContext;
  resolvedModel?: ResolvedModelRuntimeConfig;
}): string {
  if (args.context.system.executionBinding[args.roleId]) {
    return "system.mmd:exec.bind";
  }
  if (args.resolvedModel?.bindingSource === "system") {
    return "system.mmd:model.bind";
  }
  if (args.resolvedModel?.bindingSource === "selection") {
    return ".ogs/model-selection.json";
  }
  return "none";
}

export async function inspectProjectBindingVisualization(workdir: string): Promise<Record<string, unknown>> {
  const context = await assembleProjectContext(workdir);
  const bindings = context.system.roleIds
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .map((roleId) => {
      const binding = context.compilerSnapshot.bindingSummaryByRoleId[roleId];
      const resolvedModel = context.resolvedModelsByRoleId.get(roleId);
      const bindingKind = binding?.kind ?? "noop";
      return {
        roleId,
        bindingKind,
        declaredBinding: context.system.executionBinding[roleId] ?? context.system.modelBinding[roleId],
        resolvedBinding:
          bindingKind === "profile"
            ? context.system.executionBinding[roleId]
            : resolvedModel?.modelRef ?? binding?.modelRef,
        variant: resolvedModel?.variant,
        timeoutMs: resolvedModel?.timeoutMs,
        maxOutputBytes: resolvedModel?.maxOutputBytes,
        source: getBindingSourceLabel({ roleId, context, resolvedModel })
      };
    });
  return {
    workdir,
    systemId: context.system.systemId,
    compilerDigest: context.compilerSnapshot.digest,
    warnings: context.resolvedModelWarnings,
    bindings
  };
}

export async function inspectProjectRolePackagesVisualization(workdir: string): Promise<Record<string, unknown>> {
  const context = await assembleProjectContext(workdir);
  const repositoryRoleIds = new Set(context.system.roleIds);
  const roleRepoEntries = await readdir(context.roleRootDir, { withFileTypes: true }).catch(() => []);
  for (const entry of roleRepoEntries) {
    if (entry.isDirectory()) {
      repositoryRoleIds.add(entry.name);
    }
  }
  const rolePackages = await Promise.all(
    [...repositoryRoleIds]
      .sort((left, right) => left.localeCompare(right))
      .map(async (roleId) => {
        const rolePackage = context.rolePackagesByRoleId.get(roleId);
        if (!rolePackage) {
          const inSystem = context.system.roleIds.includes(roleId);
          if (!inSystem) {
            const resolvedPath = resolve(context.roleRootDir, roleId);
            const manifestPath = resolve(resolvedPath, "role.json");
            const manifest = await readJsonFile(manifestPath).catch(() => undefined);
            const manifestRecord = asRecord(manifest);
            const promptTemplate = asString(manifestRecord?.promptTemplate);
            const outputSchema = asString(manifestRecord?.outputSchema);
            return {
              roleId,
              inSystem: false,
              roleVersion: asString(manifestRecord?.roleVersion),
              name: asString(manifestRecord?.name) ?? roleId,
              description: asString(manifestRecord?.description),
              preferredModelTags: Array.isArray(manifestRecord?.preferredModelTags)
            ? manifestRecord.preferredModelTags.filter((item): item is string => typeof item === "string")
            : [],
              status: manifestRecord?.roleId === roleId && promptTemplate && outputSchema ? "ok" : "invalid",
              resolvedPath,
              manifestPath,
              promptTemplatePath: promptTemplate ? resolve(resolvedPath, promptTemplate) : undefined,
              outputSchemaPath: outputSchema ? resolve(resolvedPath, outputSchema) : undefined,
              allowedEvents: [],
              files: {
                roleJson: await pathExists(manifestPath),
                promptTemplate: promptTemplate ? await pathExists(resolve(resolvedPath, promptTemplate)) : false,
                outputSchema: outputSchema ? await pathExists(resolve(resolvedPath, outputSchema)) : false,
                agent: await pathExists(resolve(resolvedPath, "agent.md")),
                source: await pathExists(resolve(resolvedPath, "source.json"))
              }
            };
          }
          return {
            roleId,
            inSystem,
            status: "missing",
            resolvedPath: resolve(context.roleRootDir, roleId),
            manifestPath: resolve(context.roleRootDir, roleId, "role.json"),
            allowedEvents: listRoleAllowedEvents(context.system, roleId),
            files: {
              roleJson: false,
              promptTemplate: false,
              outputSchema: false,
              agent: false,
              source: false
            }
          };
        }
        const manifestPath = resolve(rolePackage.resolvedPath, "role.json");
        const promptTemplatePath = resolve(rolePackage.resolvedPath, rolePackage.manifest.promptTemplate);
        const outputSchemaPath = rolePackage.outputSchemaPath;
        const agentPath = resolve(rolePackage.resolvedPath, "agent.md");
        const sourcePath = resolve(rolePackage.resolvedPath, "source.json");
        return {
          roleId,
          inSystem: context.system.roleIds.includes(roleId),
          roleVersion: rolePackage.manifest.roleVersion,
          name: rolePackage.manifest.name,
          description: rolePackage.manifest.description,
          preferredModelTags: rolePackage.manifest.preferredModelTags ?? [],
          status: "ok",
          resolvedPath: rolePackage.resolvedPath,
          manifestPath,
          promptTemplatePath,
          outputSchemaPath,
          allowedEvents: listRoleAllowedEvents(context.system, roleId),
          files: {
            roleJson: await pathExists(manifestPath),
            promptTemplate: await pathExists(promptTemplatePath),
            outputSchema: await pathExists(outputSchemaPath),
            agent: await pathExists(agentPath),
            source: await pathExists(sourcePath)
          }
        };
      })
  );
  return {
    workdir,
    systemId: context.system.systemId,
    roleRepoRoot: context.roleRepoRoot,
    rolePackages
  };
}

export async function inspectProjectRolePackageFilesVisualization(args: {
  workdir: string;
  roleId: string;
}): Promise<Record<string, unknown>> {
  const roleId = assertEditableRoleId(args.roleId);
  const context = await loadRolePackageEditorContext(args.workdir);
  const roleDir = resolve(context.roleRootDir, roleId);
  const files = await Promise.all(ROLE_PACKAGE_FILE_NAMES.map((fileName) => readRolePackageEditorFile(roleDir, fileName)));
  const fileMap = Object.fromEntries(files.map((file) => [file.fileName, file]));
  const roleJsonFile = fileMap["role.json"] as Record<string, unknown> | undefined;
  const outputSchemaFile = fileMap["output.schema.json"] as Record<string, unknown> | undefined;
  let status = "missing";
  let validation: Record<string, unknown> = { ok: false, diagnostics: [] };
  if (files.some((file) => file.exists === true)) {
    try {
      const payload = Object.fromEntries(files.map((file) => [file.fileName, String(file.content ?? "")]));
      const { manifest, outputSchema } = validateRolePackageEditorContents({
        roleId,
        roleDir,
        files: payload as Record<RolePackageFileName, string>
      });
      status = "ok";
      validation = {
        ok: true,
        manifest,
        outputSchema,
        diagnostics: []
      };
    } catch (error) {
      status = "invalid";
      validation = {
        ok: false,
        diagnostics: [{
          code: "ROLE_PACKAGE_INVALID",
          message: error instanceof Error ? error.message : String(error)
        }]
      };
    }
  }
  return {
    workdir: args.workdir,
    roleId,
    inSystem: context.systemRoleIds.includes(roleId),
    roleRepoRoot: context.roleRepoRoot,
    resolvedPath: roleDir,
    status,
    files: fileMap,
    paths: {
      manifestPath: roleJsonFile?.path,
      agentPath: fileMap["agent.md"]?.path,
      promptTemplatePath: fileMap["prompt.md"]?.path,
      outputSchemaPath: outputSchemaFile?.path
    },
    validation
  };
}

export async function saveProjectRolePackageFilesVisualization(args: {
  workdir: string;
  roleId: string;
  files: unknown;
}): Promise<Record<string, unknown>> {
  const roleId = assertEditableRoleId(args.roleId);
  const context = await loadRolePackageEditorContext(args.workdir);
  const roleDir = resolve(context.roleRootDir, roleId);
  const incomingFiles = rolePackageEditorFilesFromPayload(args.files);
  for (const fileName of ROLE_PACKAGE_FILE_NAMES) {
    if (typeof incomingFiles[fileName] !== "string") {
      throw new Error(`Missing ${fileName} content.`);
    }
  }
  validateRolePackageEditorContents({
    roleId,
    roleDir,
    files: incomingFiles
  });
  await mkdir(roleDir, { recursive: true });
  for (const fileName of ROLE_PACKAGE_FILE_NAMES) {
    await writeFile(rolePackageFilePath(roleDir, fileName), `${incomingFiles[fileName] ?? ""}`.replace(/\s*$/, "\n"), "utf8");
  }
  invalidateProjectProjectionCache(args.workdir);
  return inspectProjectRolePackageFilesVisualization({ workdir: args.workdir, roleId });
}

export async function inspectProjectContractVisualization(workdir: string): Promise<Record<string, unknown>> {
  const context = await assembleProjectContext(workdir);
  const eligibleFlows = context.system.flows.filter(
    (flow) => flow.toRoleId !== SYSTEM_END_ROLE_ID && !isRuntimeOnlyErrorEvent(flow.eventType)
  );
  const contractItems = eligibleFlows
    .map((flow) => {
      const flowKey = `${flow.fromRoleId}:${flow.eventType}:${flow.toRoleId}`;
      const contract = context.contractPlan?.flowContractsByKey.get(
        buildFlowContractKeyForFlow({
          fromRoleId: flow.fromRoleId,
          toRoleId: flow.toRoleId,
          eventType: flow.eventType
        })
      );
      return {
        flowKey,
        contractId: contract?.definition.id,
        kind: "flow" as const,
        schemaPath: contract?.schemaPath,
        lastStatus: contract ? "covered" : "missing",
        onViolation: contract?.definition.onViolation ?? "FAIL",
        fromRoleId: flow.fromRoleId,
        toRoleId: flow.toRoleId,
        eventType: flow.eventType
      };
    })
    .sort((left, right) => left.flowKey.localeCompare(right.flowKey));
  const roleInputItems = [...(context.contractPlan?.roleInputContractsByRoleId.entries() ?? [])]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([roleId, contract]) => ({
      flowKey: `role_input:${roleId}`,
      contractId: contract.definition.id,
      kind: "role_input" as const,
      schemaPath: contract.schemaPath,
      lastStatus: "covered",
      onViolation: contract.definition.onViolation ?? "FAIL",
      roleId
    }));
  const uncoveredEdges = contractItems
    .filter((item) => item.lastStatus === "missing")
    .map((item) => ({
      flowKey: item.flowKey,
      fromRoleId: item.fromRoleId,
      toRoleId: item.toRoleId,
      eventType: item.eventType,
      reason: "missing flow contract"
    }));
  return {
    workdir,
    systemId: context.system.systemId,
    handoffMode: context.system.graph?.handoffMode ?? null,
    contractPath: context.contractPlan?.contractPath ?? null,
    coverage: {
      eligibleFlowCount: eligibleFlows.length,
      coveredFlowCount: contractItems.filter((item) => item.lastStatus === "covered").length,
      missingFlowCount: contractItems.filter((item) => item.lastStatus === "missing").length,
      roleInputCount: roleInputItems.length
    },
    uncoveredEdges,
    contracts: [...contractItems, ...roleInputItems]
  };
}
