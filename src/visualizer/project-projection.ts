import { basename, dirname, relative, resolve, sep } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { compileExecutionSnapshot } from "../runtime/compiler.js";
import { loadFlowContractPlan } from "../runtime/flow-contract.js";
import { readJsonFile, writeJsonFileAtomic } from "../runtime/json-file.js";
import { loadModelCatalog } from "../runtime/model-catalog.js";
import { loadModelSelection, resolveModelSelectionForSystem } from "../runtime/model-selection.js";
import { RuntimeError } from "../runtime/runtime-errors.js";
import { parseSystemFromMermaidSource } from "../runtime/parse-mermaid.js";
import { loadPersistedRunsIndex, resolveOgsPaths } from "../runtime/project-lifecycle.js";
import { loadLaws, loadRolePackages, loadRuntimeConfig, loadUserProfile } from "../runtime/runtime-loader.js";
import { resolveEffectiveLaw } from "../runtime/runtime-setup.js";
import { resolveProjectRoleRepoRoot, resolveProjectRoleRootDir } from "../runtime/bundled-repos.js";
import type { CompilerDiagnostic } from "../runtime/compiler.js";
import type { SystemDefinition } from "../runtime/types.js";

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
  compilerSnapshot: ReturnType<typeof compileExecutionSnapshot>["snapshot"];
  resolvedModelWarnings: string[];
  roleRepoRoot: string;
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
  const effectiveLaw = resolveEffectiveLaw(system, laws);
  const roleRepoRoot = resolveProjectRoleRepoRoot(args.workdir, runtimeConfig.roleRepo);
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
    compilerSnapshot: compilerResult.snapshot,
    resolvedModelWarnings: resolvedModelSelection.warnings,
    roleRepoRoot,
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
    project: context.projectMeta ?? null,
    roleRepoRoot: context.roleRepoRoot,
    compilerDigest: context.compilerSnapshot.digest,
    modelSelectionWarnings: context.resolvedModelWarnings
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
