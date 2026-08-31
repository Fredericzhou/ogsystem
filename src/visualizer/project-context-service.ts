import { dirname, resolve } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";

import { compileExecutionSnapshot } from "../runtime/compiler.js";
import { resolveProjectRoleRepoRoot, resolveProjectRoleRootDir } from "../runtime/bundled-repos.js";
import { loadFlowContractPlan } from "../runtime/flow-contract.js";
import { readJsonFile } from "../runtime/json-file.js";
import { loadModelCatalog } from "../runtime/model-catalog.js";
import { loadModelSelection, resolveModelSelectionForSystem } from "../runtime/model-selection.js";
import { parseSystemFromMermaidSource } from "../runtime/parse-mermaid.js";
import { resolveOgsPaths } from "../runtime/project-lifecycle.js";
import { loadLaws, loadProfiles, loadRolePackages, loadRuntimeConfig, loadTools, loadUserProfile } from "../runtime/runtime-loader.js";
import { resolveEffectiveLaw } from "../runtime/runtime-setup.js";
import type { CompilerDiagnostic } from "../runtime/compiler.js";
import type { ResolvedModelRuntimeConfig } from "../runtime/model-selection.js";
import type { LoadedRolePackage, SystemDefinition } from "../runtime/types.js";

export type ProjectContext = {
  systemPath: string;
  systemSource: string;
  system: SystemDefinition;
  runtimeConfig: unknown;
  modelSelection: unknown;
  modelCatalog: unknown;
  laws: unknown;
  effectiveLaw: ReturnType<typeof resolveEffectiveLaw>;
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

type CacheEntry = {
  token: string;
  value: Promise<ProjectContext>;
  cachedAtMs: number;
  lastAccessedAtMs: number;
};

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_SIZE = 16;

async function fileToken(path: string): Promise<string> {
  const fileStat = await stat(path).catch(() => undefined);
  // mtime is a cache hint only; ctime and size reduce false cache hits on coarse filesystems.
  return fileStat
    ? `${path}:${fileStat.mtimeMs}:${fileStat.ctimeMs}:${fileStat.size}`
    : `${path}:missing`;
}

async function directoryToken(rootDir: string): Promise<string> {
  const tokens = [await fileToken(rootDir)];
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const childPath = resolve(rootDir, entry.name);
    if (entry.isDirectory()) {
      tokens.push(await directoryToken(childPath));
    } else {
      tokens.push(await fileToken(childPath));
    }
  }
  return tokens.join("|");
}

async function rolePackageToken(roleDir: string): Promise<string> {
  const tokens = [await directoryToken(roleDir)];
  const manifest = await readJsonFile(resolve(roleDir, "role.json")).catch(() => undefined);
  if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
    for (const key of ["promptTemplate", "outputSchema"]) {
      const relativePath = (manifest as Record<string, unknown>)[key];
      if (typeof relativePath === "string" && relativePath.trim()) {
        tokens.push(await fileToken(resolve(roleDir, relativePath)));
      }
    }
  }
  return tokens.join("|");
}

function localSchemaRefPath(ref: string, currentPath: string): string | undefined {
  const trimmed = ref.trim();
  if (!trimmed || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return undefined;
  }
  const hashIndex = trimmed.indexOf("#");
  const refPath = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  return refPath ? resolve(dirname(currentPath), refPath) : currentPath;
}

function collectSchemaRefs(value: unknown, currentPath: string, refs: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSchemaRefs(entry, currentPath, refs);
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref" && typeof entry === "string") {
      const refPath = localSchemaRefPath(entry, currentPath);
      if (refPath) refs.add(refPath);
      continue;
    }
    collectSchemaRefs(entry, currentPath, refs);
  }
}

async function contractInputToken(contractPath: string): Promise<string> {
  const visited = new Set<string>();
  const tokens: string[] = [];
  const visitSchema = async (schemaPath: string): Promise<void> => {
    if (visited.has(schemaPath)) return;
    visited.add(schemaPath);
    tokens.push(await fileToken(schemaPath));
    const schema = await readJsonFile(schemaPath).catch(() => undefined);
    if (schema === undefined) return;
    const refs = new Set<string>();
    collectSchemaRefs(schema, schemaPath, refs);
    for (const refPath of [...refs].sort()) {
      await visitSchema(refPath);
    }
  };

  visited.add(contractPath);
  tokens.push(await fileToken(contractPath));
  const contractFile = await readJsonFile(contractPath).catch(() => undefined);
  if (contractFile && typeof contractFile === "object" && !Array.isArray(contractFile)) {
    const contracts = (contractFile as { contracts?: unknown }).contracts;
    if (Array.isArray(contracts)) {
      const schemaPaths = contracts
        .flatMap((contract) => {
          if (typeof contract !== "object" || contract === null || Array.isArray(contract)) return [];
          const schema = (contract as { schema?: unknown }).schema;
          return typeof schema === "string" ? [resolve(dirname(contractPath), schema)] : [];
        })
        .sort();
      for (const schemaPath of schemaPaths) {
        await visitSchema(schemaPath);
      }
    }
  }
  return tokens.join("|");
}

async function contextToken(workdir: string, systemSource: string): Promise<string> {
  const paths = resolveOgsPaths(workdir);
  const system = parseSystemFromMermaidSource(systemSource);
  const runtimeConfig = await loadRuntimeConfig(undefined, workdir);
  const roleRootDir = resolveProjectRoleRootDir(workdir, runtimeConfig.roleRepo);
  const roleTokens = await Promise.all(
    system.roleIds
      .map((roleId) => resolve(roleRootDir, roleId))
      .sort()
      .map((roleDir) => rolePackageToken(roleDir))
  );
  const contractPath = system.graph?.handoffContracts
    ? resolve(dirname(resolve(workdir, "system.mmd")), system.graph.handoffContracts)
    : undefined;
  const contractToken = contractPath ? await contractInputToken(contractPath) : "no-contract";
  const baseToken = (await Promise.all([
    fileToken(resolve(workdir, "system.mmd")),
    fileToken(paths.runtimePath),
    fileToken(paths.modelSelectionPath),
    fileToken(paths.modelCatalogPath),
    fileToken(paths.lawsPath),
    fileToken(paths.userProfilePath),
    fileToken(resolve(workdir, "profiles.json")),
    fileToken(resolve(workdir, "tools.json")),
    fileToken(paths.projectPath),
    fileToken(roleRootDir),
    ...roleTokens
  ])).join("|");
  return `${baseToken}|${contractToken}`;
}

export async function assembleProjectContextFromSource(args: {
  workdir: string;
  systemPath?: string;
  systemSource: string;
}): Promise<ProjectContext> {
  const paths = resolveOgsPaths(args.workdir);
  const systemPath = args.systemPath ?? resolve(args.workdir, "system.mmd");
  const system = parseSystemFromMermaidSource(args.systemSource);
  const runtimeConfig = await loadRuntimeConfig(undefined, args.workdir);
  const modelSelection = await loadModelSelection(paths.modelSelectionPath);
  const modelCatalog = await loadModelCatalog(paths.modelCatalogPath);
  const resolvedModelSelection = resolveModelSelectionForSystem({ system, selection: modelSelection, catalog: modelCatalog });
  const laws = await loadLaws(undefined, args.workdir);
  const userProfile = await loadUserProfile(undefined, args.workdir);
  const profiles = await loadProfiles(undefined, args.workdir);
  const tools = await loadTools(undefined, args.workdir);
  const effectiveLaw = resolveEffectiveLaw(system, laws);
  const roleRepoRoot = resolveProjectRoleRepoRoot(args.workdir, runtimeConfig.roleRepo);
  const roleRootDir = resolveProjectRoleRootDir(args.workdir, runtimeConfig.roleRepo);
  const contractPlan = system.graph?.handoffContracts
    ? await loadFlowContractPlan({ system, contractPath: system.graph.handoffContracts })
    : undefined;
  const rolePackagesByRoleId = await loadRolePackages({ system, roleRootDir });
  const compilerResult = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    contractPlan,
    effectiveLaw,
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId
  });
  if (!compilerResult.ok) {
    const error = new Error(
      `Compiler static semantics check failed for project visualization: ${compilerResult.diagnostics.map((diagnostic) => diagnostic.code).join(", ")}`
    ) as Error & { diagnostics?: CompilerDiagnostic[] };
    error.diagnostics = compilerResult.diagnostics;
    throw error;
  }
  return {
    systemPath,
    systemSource: args.systemSource,
    system,
    runtimeConfig,
    modelSelection,
    modelCatalog,
    laws,
    effectiveLaw,
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
    projectMeta: await readJsonFile(paths.projectPath).catch(() => undefined)
  };
}

function prune(nowMs = Date.now()): void {
  for (const [workdir, entry] of cache) {
    if (nowMs - entry.cachedAtMs > CACHE_TTL_MS) cache.delete(workdir);
  }
  while (cache.size > CACHE_MAX_SIZE) {
    const oldest = [...cache.entries()].sort((left, right) => left[1].lastAccessedAtMs - right[1].lastAccessedAtMs)[0];
    if (!oldest) break;
    cache.delete(oldest[0]);
  }
}

export async function loadProjectContext(workdir: string): Promise<ProjectContext> {
  prune();
  const systemSource = await readFile(resolve(workdir, "system.mmd"), "utf8");
  const token = await contextToken(workdir, systemSource);
  const cached = cache.get(workdir);
  if (cached?.token === token) {
    cached.lastAccessedAtMs = Date.now();
    return cached.value;
  }
  const now = Date.now();
  const value = assembleProjectContextFromSource({
    workdir,
    systemSource
  });
  cache.set(workdir, { token, value, cachedAtMs: now, lastAccessedAtMs: now });
  prune();
  return value;
}

export function invalidateProjectContextCache(workdir: string): void {
  cache.delete(workdir);
}

export function getProjectContextCacheStats(): Record<string, unknown> {
  prune();
  return { size: cache.size, maxSize: CACHE_MAX_SIZE, ttlMs: CACHE_TTL_MS };
}
