/**
 * @fileoverview Project/run lifecycle utilities for `.ogs` workspace management.
 * File Set: runtime-adapter
 * Responsibilities:
 * - Initialize project skeleton and templates.
 * - Index/inspect/stop runs under the configured runs directory.
 * Boundaries:
 * - Does not execute graph runtime transitions.
 */
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import {
  DEFAULT_MODEL_REPO,
  DEFAULT_ROLE_REPO,
  resolveProjectModelRepoRoot,
  resolveProjectRoleRepoRoot,
  resolveTemplateModelRepoRoot,
  resolveTemplateRoleRepoRoot,
  resolveTemplateRoleRootDir
} from "./bundled-repos.js";
import { validateRuntimeConfig } from "./config.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file.js";
import { loadSystemFromMermaid, parseSystemFromMermaidSource } from "./parse-mermaid.js";
import { requestRunStop } from "./run-artifacts.js";
import { stringifyJson } from "./runtime-support.js";
import type { RunSummaryProjection } from "./run-summary-schema.js";
import type { SystemDefinition } from "./types.js";

export const OGS_DIR = ".ogs";
export const OGS_RUNS_DIR = ".ogs/runs";
export const OGS_RUNS_INDEX_FILE = ".ogs/runs-index.json";
const OGS_PROJECT_FILE = ".ogs/project.json";
const OGS_RUNTIME_FILE = ".ogs/runtime.json";
const OGS_PROVIDER_OPENCODE_FILE = ".ogs/providers/opencode.json";
const OGS_LAWS_FILE = ".ogs/laws.json";
const OGS_USER_PROFILE_FILE = ".ogs/user-profile.json";

export type IndexedRun = {
  runId: string;
  status: string;
  transitionCount: number;
  finalRoleId?: string;
  updatedAt: string;
  runDir: string;
};

export type RunsIndexFile = {
  version: 1;
  generatedAt: string;
  runs: IndexedRun[];
};

export type ProjectDependencySyncResult = {
  roleIds: string[];
  modelIds: string[];
  importedRoleIds: string[];
  importedModelIds: string[];
};

type ProjectTemplateId = "minimal" | "software-dev" | "consultation";

const PROJECT_TEMPLATES: Record<ProjectTemplateId, { systemMmd: string; lawsJson: string }> = {
  minimal: {
    systemMmd: [
      "flowchart TD",
      "%% system.id=template.minimal",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=demo-analyst",
      "%% model.bind.demo-analyst=general-balanced",
      "",
      "input -->|ENTER| analyst[Role:demo-analyst]",
      "analyst[Role:demo-analyst] -->|ANALYSIS_DONE| output",
      ""
    ].join("\n"),
    lawsJson: stringifyJson({
      laws: [
        {
          lawId: "law.minimal.base",
          constraints: {
            forbiddenToolRefs: [],
            maxTransitions: 8,
            allowNoopWithoutExecutionBinding: true
          }
        }
      ]
    })
  },
  "software-dev": {
    systemMmd: [
      "flowchart TD",
      "%% system.id=template.software-dev",
      "%% system.version=1.0.0",
      "%% law.global=law.software-dev.base",
      "%% entry.role=demo-intake",
      "%% role.mode.demo-intake=parallel_split",
      "%% join.mode.test-operator=all_of",
      "%% join.sources.test-operator=test-branch-a,test-branch-b",
      "%% model.bind.demo-intake=general-fast",
      "%% model.bind.test-branch-a=general-balanced",
      "%% model.bind.test-branch-b=general-balanced",
      "%% model.bind.test-operator=general-steady",
      "",
      "input -->|TASK_IN| intake[Role:demo-intake]",
      "intake[Role:demo-intake] -->|BRANCH_A| brancha[Role:test-branch-a]",
      "intake[Role:demo-intake] -->|BRANCH_B| branchb[Role:test-branch-b]",
      "brancha[Role:test-branch-a] -->|A_DONE| testop[Role:test-operator]",
      "branchb[Role:test-branch-b] -->|B_DONE| testop[Role:test-operator]",
      "testop[Role:test-operator] -->|RESULT_READY| output",
      ""
    ].join("\n"),
    lawsJson: stringifyJson({
      laws: [
        {
          lawId: "law.software-dev.base",
          constraints: {
            forbiddenToolRefs: [],
            maxTransitions: 24,
            allowNoopWithoutExecutionBinding: false
          }
        }
      ]
    })
  },
  consultation: {
    systemMmd: [
      "flowchart TD",
      "%% system.id=template.consultation",
      "%% system.version=1.0.0",
      "%% law.global=law.consultation.base",
      "%% entry.role=demo-intake",
      "%% model.bind.demo-intake=general-balanced",
      "%% model.bind.diagnosis-dispatch=general-steady",
      "%% model.bind.diagnosis-chief-review=general-steady",
      "",
      "input -->|CASE_IN| intake[Role:demo-intake]",
      "intake[Role:demo-intake] -->|INTAKE_DONE| dispatch[Role:diagnosis-dispatch]",
      "dispatch[Role:diagnosis-dispatch] -->|DISPATCH_DONE| chief[Role:diagnosis-chief-review]",
      "chief[Role:diagnosis-chief-review] -->|REPORT_READY| output",
      ""
    ].join("\n"),
    lawsJson: stringifyJson({
      laws: [
        {
          lawId: "law.consultation.base",
          constraints: {
            forbiddenToolRefs: [],
            maxTransitions: 12,
            allowNoopWithoutExecutionBinding: false
          }
        }
      ]
    })
  }
};

function createDefaultRuntimeConfig(): Record<string, unknown> {
  return {
    configVersion: "1",
    executor: "opencode",
    roleRepo: DEFAULT_ROLE_REPO,
    modelRepo: DEFAULT_MODEL_REPO,
    runsDir: OGS_RUNS_DIR,
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
}

function createDefaultUserProfile(): Record<string, unknown> {
  return {
    userProfileId: "default.zh.concise",
    language: "zh-CN",
    style: "concise",
    riskPreference: "medium",
    outputLength: "short",
    domainBackground: ["software-architecture"]
  };
}

function getProjectTemplate(templateId: ProjectTemplateId): {
  systemMmd: string;
  lawsJson: string;
} {
  const template = PROJECT_TEMPLATES[templateId];
  if (!template) {
    throw new Error(`Unsupported template: ${templateId}`);
  }
  return template;
}

function parseJsonLines(content: string): Array<Record<string, unknown>> {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line);
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          return [];
        }
        return [value as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

async function tryReadJson(path: string): Promise<unknown | undefined> {
  try {
    return await readJsonFile(path);
  } catch {
    return undefined;
  }
}

function asSummaryProjection(value: unknown): RunSummaryProjection | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.runId !== "string" ||
    typeof record.status !== "string" ||
    typeof record.transitionCount !== "number" ||
    typeof record.updatedAt !== "string"
  ) {
    return undefined;
  }
  return record as RunSummaryProjection;
}

async function ensureFile(path: string, value: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    await writeFile(path, value, "utf8");
  }
}

async function loadProjectRepoConfig(workdir: string): Promise<{
  roleRepo: string;
  modelRepo: string;
}> {
  const runtimePath = resolveOgsPaths(workdir).runtimePath;
  try {
    const runtimeConfig = validateRuntimeConfig(await readJsonFile(runtimePath), runtimePath);
    return {
      roleRepo: runtimeConfig.roleRepo,
      modelRepo: runtimeConfig.modelRepo
    };
  } catch {
    return {
      roleRepo: DEFAULT_ROLE_REPO,
      modelRepo: DEFAULT_MODEL_REPO
    };
  }
}

async function copyIfMissing(sourcePath: string, targetPath: string): Promise<boolean> {
  const targetStat = await stat(targetPath).catch(() => undefined);
  if (targetStat) {
    return false;
  }
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: true });
  return true;
}

function getSystemDependencies(system: SystemDefinition): {
  roleIds: string[];
  modelIds: string[];
} {
  return {
    roleIds: [...system.roleIds].sort(),
    modelIds: Array.from(new Set(Object.values(system.modelBinding))).sort()
  };
}

async function loadSystemDefinitionForSync(args: {
  workdir: string;
  systemPath?: string;
  systemSource?: string;
}): Promise<SystemDefinition> {
  if (args.systemSource !== undefined) {
    return parseSystemFromMermaidSource(args.systemSource);
  }
  if (!args.systemPath) {
    throw new Error("Missing system source for dependency sync");
  }
  return loadSystemFromMermaid(resolve(args.workdir, args.systemPath));
}

async function ensureProjectRepoMetadataFiles(workdir: string): Promise<void> {
  const repoConfig = await loadProjectRepoConfig(workdir);
  const projectRoleRepoRoot = resolveProjectRoleRepoRoot(workdir, repoConfig.roleRepo);
  const projectModelRepoRoot = resolveProjectModelRepoRoot(workdir, repoConfig.modelRepo);
  const templateRoleRepoRoot = resolveTemplateRoleRepoRoot();
  const templateModelRepoRoot = resolveTemplateModelRepoRoot();

  await copyIfMissing(
    resolve(templateRoleRepoRoot, "README.md"),
    resolve(projectRoleRepoRoot, "README.md")
  );
  await copyIfMissing(
    resolve(templateModelRepoRoot, "README.md"),
    resolve(projectModelRepoRoot, "README.md")
  );
  await copyIfMissing(
    resolve(templateModelRepoRoot, "catalog"),
    resolve(projectModelRepoRoot, "catalog")
  );
}

async function importRolePackageIntoProject(args: {
  workdir: string;
  roleId: string;
}): Promise<boolean> {
  const templateRoleRootDir = resolveTemplateRoleRootDir();
  const repoConfig = await loadProjectRepoConfig(args.workdir);
  const projectRoleRootDir = resolve(
    resolveProjectRoleRepoRoot(args.workdir, repoConfig.roleRepo),
    "roles"
  );
  const importedShared = await copyIfMissing(
    resolve(templateRoleRootDir, "_shared"),
    resolve(projectRoleRootDir, "_shared")
  );
  const importedRole = await copyIfMissing(
    resolve(templateRoleRootDir, args.roleId),
    resolve(projectRoleRootDir, args.roleId)
  );
  await ensureProjectRepoMetadataFiles(args.workdir);
  return importedShared || importedRole;
}

async function importModelPackageIntoProject(args: {
  workdir: string;
  modelId: string;
}): Promise<boolean> {
  const templateModelRepoRoot = resolveTemplateModelRepoRoot();
  const repoConfig = await loadProjectRepoConfig(args.workdir);
  const projectModelRepoRoot = resolveProjectModelRepoRoot(args.workdir, repoConfig.modelRepo);
  const importedModel = await copyIfMissing(
    resolve(templateModelRepoRoot, "models", args.modelId),
    resolve(projectModelRepoRoot, "models", args.modelId)
  );
  await ensureProjectRepoMetadataFiles(args.workdir);
  return importedModel;
}

export function resolveOgsPaths(workdir: string): {
  ogsDir: string;
  runsDir: string;
  runsIndexPath: string;
  projectPath: string;
  runtimePath: string;
  providerPath: string;
  lawsPath: string;
  userProfilePath: string;
} {
  return {
    ogsDir: resolve(workdir, OGS_DIR),
    runsDir: resolve(workdir, OGS_RUNS_DIR),
    runsIndexPath: resolve(workdir, OGS_RUNS_INDEX_FILE),
    projectPath: resolve(workdir, OGS_PROJECT_FILE),
    runtimePath: resolve(workdir, OGS_RUNTIME_FILE),
    providerPath: resolve(workdir, OGS_PROVIDER_OPENCODE_FILE),
    lawsPath: resolve(workdir, OGS_LAWS_FILE),
    userProfilePath: resolve(workdir, OGS_USER_PROFILE_FILE)
  };
}

export async function ensureProjectSkeleton(args: {
  workdir: string;
  projectName?: string;
}): Promise<void> {
  const paths = resolveOgsPaths(args.workdir);
  await mkdir(paths.ogsDir, { recursive: true });
  await mkdir(paths.runsDir, { recursive: true });
  await mkdir(resolve(paths.ogsDir, "providers"), { recursive: true });
  await ensureFile(
    paths.projectPath,
    `${stringifyJson({
      version: 1,
      projectId:
        args.projectName ??
        (basename(args.workdir) || `project-${randomUUID().slice(0, 8)}`),
      createdAt: new Date().toISOString()
    })}\n`
  );
  await ensureFile(paths.runtimePath, `${stringifyJson(createDefaultRuntimeConfig())}\n`);
  await ensureFile(
    paths.providerPath,
    `${stringifyJson({
      provider: "opencode",
      lifecycle: "single-serve-multi-session"
    })}\n`
  );
  await ensureFile(
    paths.runsIndexPath,
    `${stringifyJson({
      version: 1,
      generatedAt: new Date().toISOString(),
      runs: []
    })}\n`
  );
}

export async function scaffoldProjectTemplate(args: {
  workdir: string;
  templateId: ProjectTemplateId;
}): Promise<void> {
  const template = getProjectTemplate(args.templateId);
  const paths = resolveOgsPaths(args.workdir);
  await ensureFile(resolve(args.workdir, "system.mmd"), `${template.systemMmd}\n`);
  await ensureFile(paths.lawsPath, `${template.lawsJson}\n`);
  await ensureFile(paths.userProfilePath, `${stringifyJson(createDefaultUserProfile())}\n`);
}

export async function syncProjectDependencies(args: {
  workdir: string;
  systemPath?: string;
  systemSource?: string;
}): Promise<ProjectDependencySyncResult> {
  const system = await loadSystemDefinitionForSync(args);
  const { roleIds, modelIds } = getSystemDependencies(system);
  const importedRoleIds: string[] = [];
  const importedModelIds: string[] = [];

  for (const roleId of roleIds) {
    if (await importRolePackageIntoProject({ workdir: args.workdir, roleId })) {
      importedRoleIds.push(roleId);
    }
  }

  for (const modelId of modelIds) {
    if (await importModelPackageIntoProject({ workdir: args.workdir, modelId })) {
      importedModelIds.push(modelId);
    }
  }

  return {
    roleIds,
    modelIds,
    importedRoleIds,
    importedModelIds
  };
}

export async function loadIndexedRuns(workdir: string): Promise<IndexedRun[]> {
  const { runsDir } = resolveOgsPaths(workdir);
  let entries;
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const runs: IndexedRun[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runDir = resolve(runsDir, entry.name);
    const [summaryRaw, stateRaw] = await Promise.all([
      tryReadJson(resolve(runDir, "summary.json")),
      tryReadJson(resolve(runDir, "state.json"))
    ]);
    const summary = asSummaryProjection(summaryRaw);
    // Compatibility read: tolerate both flattened status fields and nested graphState snapshots
    // so index rebuilding can survive schema transitions across runtime versions.
    const state =
      typeof stateRaw === "object" &&
      stateRaw !== null &&
      !Array.isArray(stateRaw) &&
      "status" in stateRaw &&
      typeof (stateRaw as { status?: unknown }).status === "string"
        ? (stateRaw as {
            status: string;
            transitionCount?: number;
            finalRoleId?: string;
            graphState?: { status?: string; transitionCount?: number; finalRoleId?: string };
          })
        : undefined;
    const runStat = await stat(runDir);
    runs.push({
      runId: entry.name,
      status: summary?.status ?? state?.status ?? state?.graphState?.status ?? "unknown",
      transitionCount:
        summary?.transitionCount ?? state?.transitionCount ?? state?.graphState?.transitionCount ?? 0,
      finalRoleId: summary?.finalRoleId ?? state?.finalRoleId ?? state?.graphState?.finalRoleId,
      updatedAt: summary?.updatedAt ?? runStat.mtime.toISOString(),
      runDir
    });
  }

  runs.sort((left, right) => right.runId.localeCompare(left.runId));
  return runs;
}

export async function rebuildRunsIndex(workdir: string): Promise<RunsIndexFile> {
  const runs = await loadIndexedRuns(workdir);
  const index: RunsIndexFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    runs
  };
  await writeJsonFileAtomic(resolve(workdir, OGS_RUNS_INDEX_FILE), index);
  return index;
}

export function resolveRunDir(workdir: string, runId: string): string {
  if (runId.includes("ogsystem-history")) {
    throw new Error(`Legacy run path is not supported: ${runId}`);
  }
  if (runId.includes("/") || runId.includes("\\")) {
    throw new Error(`run-id must be a bare id, got: ${runId}`);
  }
  return resolve(workdir, OGS_RUNS_DIR, runId);
}

export async function inspectRun(workdir: string, runId: string): Promise<Record<string, unknown>> {
  const runDir = resolveRunDir(workdir, runId);
  const runStat = await stat(runDir).catch(() => undefined);
  if (!runStat?.isDirectory()) {
    throw new Error(`Run not found: ${runId}`);
  }
  const [state, metrics, resolvedConfig, stopRequest, stopOutcome, summary] = await Promise.all([
    tryReadJson(resolve(runDir, "state.json")),
    tryReadJson(resolve(runDir, "metrics.json")),
    tryReadJson(resolve(runDir, "resolved-config.json")),
    tryReadJson(resolve(runDir, "control", "stop-request.json")),
    tryReadJson(resolve(runDir, "control", "stop-outcome.json")),
    tryReadJson(resolve(runDir, "summary.json"))
  ]);
  return {
    runId,
    runDir,
    state,
    metrics,
    resolvedConfig,
    stopRequest,
    stopOutcome,
    summary: asSummaryProjection(summary)
  };
}

function normalizeIsoTimestamp(value: string): number | undefined {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }
  return timestamp;
}

function filterLogRecords(records: Array<Record<string, unknown>>, args: {
  roleId?: string;
  since?: string;
  tail?: number;
}): Array<Record<string, unknown>> {
  let filtered = records;

  if (args.roleId) {
    filtered = filtered.filter((item) => item.roleId === args.roleId);
  }

  if (args.since) {
    const sinceTimestamp = normalizeIsoTimestamp(args.since);
    if (sinceTimestamp === undefined) {
      throw new Error(`Invalid --since timestamp: ${args.since}`);
    }
    filtered = filtered.filter((item) => {
      const at = typeof item.at === "string" ? normalizeIsoTimestamp(item.at) : undefined;
      return at !== undefined && at >= sinceTimestamp;
    });
  }

  if (args.tail !== undefined) {
    filtered = filtered.slice(-args.tail);
  }

  return filtered;
}

async function readLogRecordsFromPath(sourcePath: string): Promise<Array<Record<string, unknown>>> {
  const content = await readFile(sourcePath, "utf8");
  return parseJsonLines(content);
}

async function loadFallbackEventLogs(args: {
  runDir: string;
  roleId?: string;
}): Promise<Array<Record<string, unknown>>> {
  const content = await readFile(resolve(args.runDir, "events.ndjson"), "utf8");
  const records = parseJsonLines(content);
  if (args.roleId) {
    return records.filter((item) => item.type === "audit" && item.roleId === args.roleId);
  }
  return records.filter((item) => item.type !== "audit");
}

export async function requestStop(workdir: string, runId: string, reason?: string): Promise<Record<string, unknown>> {
  const runDir = resolveRunDir(workdir, runId);
  const runStat = await stat(runDir).catch(() => undefined);
  if (!runStat?.isDirectory()) {
    throw new Error(`Run not found: ${runId}`);
  }
  const request = await requestRunStop({
    runDir,
    reason
  });
  return {
    runId,
    runDir,
    request
  };
}

export async function loadRunLogs(args: {
  workdir: string;
  runId: string;
  roleId?: string;
  engine?: boolean;
  tail?: number;
  since?: string;
}): Promise<Array<Record<string, unknown>>> {
  const runDir = resolveRunDir(args.workdir, args.runId);
  const runStat = await stat(runDir).catch(() => undefined);
  if (!runStat?.isDirectory()) {
    throw new Error(`Run not found: ${args.runId}`);
  }
  if (args.roleId && args.engine) {
    throw new Error("Choose either --engine or --role");
  }

  const sourcePath = args.roleId
    ? resolve(runDir, "logs", "roles", `${args.roleId}.ndjson`)
    : resolve(runDir, "logs", "engine.ndjson");
  try {
    return filterLogRecords(await readLogRecordsFromPath(sourcePath), args);
  } catch {
    try {
      return filterLogRecords(
        await loadFallbackEventLogs({
          runDir,
          roleId: args.roleId
        }),
        args
      );
    } catch {
      return [];
    }
  }
}

export async function streamRunLogs(args: {
  workdir: string;
  runId: string;
  roleId?: string;
  engine?: boolean;
  tail?: number;
  since?: string;
  pollIntervalMs?: number;
  onRecord: (record: Record<string, unknown>) => void | Promise<void>;
}): Promise<void> {
  const pollIntervalMs = args.pollIntervalMs ?? 250;
  let emittedCount = 0;

  while (true) {
    const records = await loadRunLogs(args);
    const nextRecords = records.slice(emittedCount);
    for (const record of nextRecords) {
      await args.onRecord(record);
    }
    emittedCount = records.length;

    const detail = await inspectRun(args.workdir, args.runId);
    const summary =
      typeof detail.summary === "object" &&
      detail.summary !== null &&
      !Array.isArray(detail.summary)
        ? (detail.summary as { status?: string })
        : undefined;
    const state =
      typeof detail.state === "object" &&
      detail.state !== null &&
      !Array.isArray(detail.state)
        ? (detail.state as { status?: string; graphState?: { status?: string } })
        : undefined;
    const status = summary?.status ?? state?.status ?? state?.graphState?.status;
    if (status && status !== "running" && status !== "stopping") {
      return;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollIntervalMs));
  }
}

export async function createProjectFromTemplate(args: {
  parentDir: string;
  name: string;
  templateId: ProjectTemplateId;
}): Promise<string> {
  const projectDir = resolve(args.parentDir, args.name);
  await mkdir(projectDir, { recursive: true });
  await ensureProjectSkeleton({
    workdir: projectDir,
    projectName: args.name
  });
  await scaffoldProjectTemplate({
    workdir: projectDir,
    templateId: args.templateId
  });
  await syncProjectDependencies({
    workdir: projectDir,
    systemPath: "system.mmd"
  });
  await rebuildRunsIndex(projectDir);
  return projectDir;
}
