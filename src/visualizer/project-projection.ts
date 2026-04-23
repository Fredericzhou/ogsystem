import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";

import { compileExecutionSnapshot } from "../runtime/compiler.js";
import { loadFlowContractPlan } from "../runtime/flow-contract.js";
import { readJsonFile } from "../runtime/json-file.js";
import { loadModelCatalog } from "../runtime/model-catalog.js";
import { loadModelSelection, resolveModelSelectionForSystem } from "../runtime/model-selection.js";
import { parseSystemFromMermaidSource } from "../runtime/parse-mermaid.js";
import { loadPersistedRunsIndex, resolveOgsPaths } from "../runtime/project-lifecycle.js";
import { loadLaws, loadRolePackages, loadRuntimeConfig, loadUserProfile } from "../runtime/runtime-loader.js";
import { resolveEffectiveLaw } from "../runtime/runtime-setup.js";
import { resolveProjectRoleRepoRoot, resolveProjectRoleRootDir } from "../runtime/bundled-repos.js";
import type { SystemDefinition } from "../runtime/types.js";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function assembleProjectContext(workdir: string): Promise<{
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
}> {
  const ogsPaths = resolveOgsPaths(workdir);
  const systemPath = resolve(workdir, "system.mmd");
  const systemSource = await readFile(systemPath, "utf8");
  const system = parseSystemFromMermaidSource(systemSource);
  const runtimeConfig = await loadRuntimeConfig(undefined, workdir);
  const modelSelection = await loadModelSelection(ogsPaths.modelSelectionPath);
  const modelCatalog = await loadModelCatalog(ogsPaths.modelCatalogPath);
  const resolvedModelSelection = resolveModelSelectionForSystem({
    system,
    selection: modelSelection,
    catalog: modelCatalog
  });
  const laws = await loadLaws(undefined, workdir);
  const userProfile = await loadUserProfile(undefined, workdir);
  const effectiveLaw = resolveEffectiveLaw(system, laws);
  const roleRepoRoot = resolveProjectRoleRepoRoot(workdir, runtimeConfig.roleRepo);
  const contractPlan = system.graph?.handoffContracts
    ? await loadFlowContractPlan({
        system,
        contractPath: system.graph.handoffContracts
      })
    : undefined;
  const rolePackagesByRoleId = await loadRolePackages({
    system,
    roleRootDir: resolveProjectRoleRootDir(workdir, runtimeConfig.roleRepo)
  });
  const compilerResult = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    contractPlan,
    effectiveLaw,
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId
  });
  if (!compilerResult.ok) {
    throw new Error(
      `Compiler static semantics check failed for project visualization: ${compilerResult.diagnostics
        .map((diagnostic) => diagnostic.code)
        .join(", ")}`
    );
  }
  const projectMeta = await readJsonFile(ogsPaths.projectPath).catch(() => undefined);

  return {
    systemPath,
    systemSource,
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
