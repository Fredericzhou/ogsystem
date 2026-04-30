import { basename, dirname, relative, resolve, sep } from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import { compileExecutionSnapshot } from "../runtime/compiler.js";
import { resolveProjectRoleRepoRoot, resolveProjectRoleRootDir } from "../runtime/bundled-repos.js";
import { isRuntimeOnlyErrorEvent } from "../runtime/error-flow-utils.js";
import { buildFlowContractKeyForFlow, loadFlowContractPlan } from "../runtime/flow-contract.js";
import { readJsonFile, writeJsonFileAtomic } from "../runtime/json-file.js";
import { loadModelCatalog } from "../runtime/model-catalog.js";
import { loadModelSelection, resolveModelSelectionForSystem } from "../runtime/model-selection.js";
import { RuntimeError } from "../runtime/runtime-errors.js";
import { parseSystemFromMermaidSource } from "../runtime/parse-mermaid.js";
import { loadPersistedRunsIndex, resolveOgsPaths } from "../runtime/project-lifecycle.js";
import { pathExists } from "../runtime/run-artifacts.js";
import { loadLaws, loadProfiles, loadRolePackages, loadRuntimeConfig, loadTools, loadUserProfile } from "../runtime/runtime-loader.js";
import { validateProfilesConfig } from "../runtime/config.js";
import { resolveEffectiveLaw } from "../runtime/runtime-setup.js";
import { SYSTEM_END_ROLE_ID } from "../runtime/types.js";
import type { CompilerDiagnostic } from "../runtime/compiler.js";
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
};

const projectProjectionCache = new Map<string, ProjectProjectionCacheEntry>();

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function getMtimeToken(path: string): Promise<string> {
  const file = await readJsonFile(path).catch(() => undefined);
  if (file !== undefined) {
    return `${path}:${JSON.stringify(file)}`;
  }
  const text = await readFile(path, "utf8").catch(() => undefined);
  return `${path}:${text ?? "missing"}`;
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
  const token = await computeProjectProjectionCacheToken(workdir);
  const cached = projectProjectionCache.get(workdir);
  if (cached && cached.token === token) {
    return cached.value;
  }
  const value = assembleProjectContextFromSource({
    workdir,
    systemSource: await readFile(resolve(workdir, "system.mmd"), "utf8")
  });
  projectProjectionCache.set(workdir, {
    token,
    value
  });
  return value;
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

export function invalidateProjectProjectionCache(workdir: string): void {
  projectProjectionCache.delete(workdir);
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
  return {
    mode: "single-project-v1",
    project: {
      systemPath: "system.mmd",
      systemSource: await readFile(resolve(workdir, "system.mmd"), "utf8"),
      runtime: await readOptionalJson(ogsPaths.runtimePath),
      modelSelection: await readOptionalJson(ogsPaths.modelSelectionPath),
      modelCatalog: await readOptionalJson(ogsPaths.modelCatalogPath),
      laws: await readOptionalJson(ogsPaths.lawsPath),
      userProfile: await readOptionalJson(ogsPaths.userProfilePath),
      profiles: await readOptionalJson(resolve(workdir, "profiles.json")),
      tools: await readOptionalJson(resolve(workdir, "tools.json")),
      project: await readOptionalJson(ogsPaths.projectPath)
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
