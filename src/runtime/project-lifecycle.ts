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
import type { Dirent } from "node:fs";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import {
  DEFAULT_ROLE_REPO,
  resolveProjectRoleRepoRoot,
  resolveTemplateRoleRepoRoot,
  resolveTemplateRoleRootDir
} from "./bundled-repos.js";
import { validateRuntimeConfig } from "./config.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file.js";
import { chooseDefaultModelFromCatalog, refreshModelCatalog } from "./model-catalog.js";
import { loadSystemFromMermaid, parseSystemFromMermaidSource } from "./parse-mermaid.js";
import { requestRunStop } from "./run-artifacts.js";
import { stringifyJson } from "./runtime-support.js";
import type {
  HumanReviewDecision,
  HumanReviewDecisionRecord,
  ModelCatalog,
  ModelSelectionConfig
} from "./types.js";
import type { RunSummaryProjection } from "./run-summary-schema.js";
import type { SystemDefinition } from "./types.js";

export const OGS_DIR = ".ogs";
export const OGS_RUNS_DIR = ".ogs/runs";
export const OGS_RUNS_INDEX_FILE = ".ogs/runs-index.json";
const OGS_README_FILE = ".ogs/README.md";
const OGS_PROJECT_FILE = ".ogs/project.json";
const OGS_RUNTIME_FILE = ".ogs/runtime.json";
const OGS_MODEL_CATALOG_FILE = ".ogs/model-catalog.json";
const OGS_MODEL_SELECTION_FILE = ".ogs/model-selection.json";
const OGS_PROVIDER_OPENCODE_FILE = ".ogs/providers/opencode.json";
const OGS_LAWS_FILE = ".ogs/laws.json";
const OGS_USER_PROFILE_FILE = ".ogs/user-profile.json";

export type IndexedRun = {
  runId: string;
  status: string;
  transitionCount: number;
  finalRoleId?: string;
  pendingReviewCount?: number;
  hasWaitingHumanReview?: boolean;
  latestPendingReviewId?: string;
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

type ProjectTemplateId = "empty" | "minimal" | "software-dev" | "consultation";

type ProjectTemplateSpec = {
  systemMmd: string;
  lawsJson: string;
  exampleSystemMmd?: string;
  syncDependencies: boolean;
};

type IndexedRunStateSnapshot = {
  status: string;
  transitionCount?: number;
  finalRoleId?: string;
  graphState?: {
    status?: string;
    transitionCount?: number;
    finalRoleId?: string;
    pendingReviewsById?: Record<string, unknown>;
  };
};

const PROJECT_TEMPLATES: Record<ProjectTemplateId, ProjectTemplateSpec> = {
  empty: {
    systemMmd: [
      "flowchart TD",
      "%% Starter scaffold only. Replace this stub with a runnable Mermaid system.",
      "%% Then run: ogs project sync --system system.mmd",
      "%% And refresh local models with: ogs project sync-models",
      "%% Or copy system.example.mmd as your starting point.",
      "%%",
      "%% Suggested metadata:",
      "%% system.id=project.starter",
      "%% system.version=1.0.0",
      "%% law.global=law.project.base",
      "%% entry.role=demo-analyst",
      "%%",
      "%% input -->|ENTER| analyst[Role:demo-analyst]",
      "%% analyst[Role:demo-analyst] -->|ANALYSIS_DONE| output",
      ""
    ].join("\n"),
    lawsJson: stringifyJson({
      laws: [
        {
          lawId: "law.project.base",
          constraints: {
            forbiddenToolRefs: [],
            maxTransitions: 8,
            allowNoopWithoutExecutionBinding: true
          }
        }
      ]
    }),
    exampleSystemMmd: [
      "flowchart TD",
      "%% system.id=project.example.minimal",
      "%% system.version=1.0.0",
      "%% law.global=law.project.base",
      "%% entry.role=demo-analyst",
      "",
      "input -->|ENTER| analyst[Role:demo-analyst]",
      "analyst[Role:demo-analyst] -->|ANALYSIS_DONE| output",
      ""
    ].join("\n"),
    syncDependencies: false
  },
  minimal: {
    systemMmd: [
      "flowchart TD",
      "%% system.id=template.minimal",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=demo-analyst",
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
    }),
    syncDependencies: true
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
    }),
    syncDependencies: true
  },
  consultation: {
    systemMmd: [
      "flowchart TD",
      "%% system.id=template.consultation",
      "%% system.version=1.0.0",
      "%% law.global=law.consultation.base",
      "%% entry.role=demo-intake",
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
    }),
    syncDependencies: true
  }
};

function createDefaultRuntimeConfig(): Record<string, unknown> {
  return {
    configVersion: "2",
    executor: "opencode",
    roleRepo: DEFAULT_ROLE_REPO,
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

function createDefaultOpencodeProviderReference(): Record<string, unknown> {
  return {
    provider: "opencode",
    lifecycle: "single-serve-multi-session",
    configPath: "~/.config/opencode/opencode.json",
    note: [
      "Reference only.",
      "Copy recommendedProviderEntry.openai into ~/.config/opencode/opencode.json under provider.openai.",
      "Replace placeholder secrets locally and do not commit real API keys."
    ].join(" "),
    recommendedProviderEntry: {
      openai: {
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL: "https://your-openai-compatible-endpoint/v1",
          apiKey: "REPLACE_WITH_REAL_API_KEY",
          setCacheKey: true
        },
        models: {
          "gpt-5.4": {
            name: "GPT-5.4"
          }
        }
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

function createDefaultOgsReadme(): string {
  return [
    "# .ogs control plane",
    "",
    "These files are the local runtime control plane for the project.",
    "Keep JSON files as valid JSON with no comments or extra fields unless the schema already allows them.",
    "Use this README for operator notes and examples instead of adding inline comments to runtime-consumed files.",
    "",
    "## File guide",
    "",
    "- `runtime.json`: Main runtime config. Safe place to change workspace and execution defaults.",
    "- `model-selection.json`: Default model routing and per-system overrides.",
    "- `model-catalog.json`: Generated catalog from `ogs project sync-models`. Usually do not edit manually.",
    "- `providers/opencode.json`: Reference template for wiring OpenCode provider config on the local machine.",
    "- `laws.json`: Project laws and transition constraints used by the runtime.",
    "- `user-profile.json`: Default user preference profile injected into runs.",
    "- `project.json`: Project identity and creation metadata. Usually generated once and then left alone.",
    "- `runs-index.json`: Generated run index. Rebuilt by lifecycle commands.",
    "",
    "## Example: runtime.json",
    "",
    "```json",
    '{',
    '  "configVersion": "2",',
    '  "executor": "opencode",',
    '  "roleRepo": "og-roles",',
    '  "runsDir": ".ogs/runs",',
    '  "workspace": {',
    '    "rolesDir": "roles",',
    '    "privateDirName": "private",',
    '    "workspaceIsolation": "role"',
    "  }",
    "}",
    "```",
    "",
    "Common edits:",
    "- Change `runsDir` if run artifacts should live outside `.ogs/runs`.",
    "- Change `workspace.workspaceIsolation` when the execution sandbox policy changes.",
    "- Keep `roleRepo` pointed at the project role repository root.",
    "",
    "## Example: model-selection.json",
    "",
    "```json",
    '{',
    '  "configVersion": "1",',
    '  "defaults": {',
    '    "model": "opencode/gpt-5.4",',
    '    "variant": "medium",',
    '    "timeoutMs": 120000,',
    '    "maxOutputBytes": 65536',
    "  },",
    '  "systems": {',
    '    "template.minimal": {',
    '      "defaults": {',
    '        "model": "opencode/gpt-5.4",',
    '        "variant": "high"',
    "      }",
    "    }",
    "  }",
    "}",
    "```",
    "",
    "Use `ogs project sync-models` to refresh `model-catalog.json` first, then pick refs from that catalog.",
    "",
    "## Example: laws.json",
    "",
    "```json",
    '{',
    '  "laws": [',
    "    {",
    '      "lawId": "law.project.base",',
    '      "constraints": {',
    '        "forbiddenToolRefs": [],',
    '        "maxTransitions": 8,',
    '        "allowNoopWithoutExecutionBinding": true',
    "      }",
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "## Example: user-profile.json",
    "",
    "```json",
    '{',
    '  "userProfileId": "default.zh.concise",',
    '  "language": "zh-CN",',
    '  "style": "concise",',
    '  "riskPreference": "medium",',
    '  "outputLength": "short",',
    '  "domainBackground": ["software-architecture"]',
    "}",
    "```",
    "",
    "## Reference-only files",
    "",
    "- `providers/opencode.json` is a local wiring reference. Copy the recommended provider entry into the real OpenCode config and replace placeholder secrets locally.",
    "- `project.json`, `model-catalog.json`, and `runs-index.json` are mostly generated artifacts. Manual edits may be overwritten by lifecycle commands."
  ].join("\n");
}

function getProjectTemplate(templateId: ProjectTemplateId): ProjectTemplateSpec {
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

function asGraphStateRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const graphState = (value as { graphState?: unknown }).graphState;
  if (typeof graphState !== "object" || graphState === null || Array.isArray(graphState)) {
    return undefined;
  }
  return graphState as Record<string, unknown>;
}

function countPendingReviewsFromGraphState(graphState: Record<string, unknown> | undefined): number | undefined {
  const pendingReviewsById = graphState?.pendingReviewsById;
  if (
    typeof pendingReviewsById !== "object" ||
    pendingReviewsById === null ||
    Array.isArray(pendingReviewsById)
  ) {
    return undefined;
  }
  return Object.values(pendingReviewsById).filter(
    (review) =>
      typeof review === "object" &&
      review !== null &&
      ((review as { status?: unknown }).status === "pending" ||
        (review as { status?: unknown }).status === "paused")
  ).length;
}

function getPendingReviewsByIdFromGraphState(
  graphState: Record<string, unknown> | undefined
): Record<string, Record<string, unknown>> {
  const pendingReviewsById = graphState?.pendingReviewsById;
  if (
    typeof pendingReviewsById !== "object" ||
    pendingReviewsById === null ||
    Array.isArray(pendingReviewsById)
  ) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(pendingReviewsById).filter(
      ([, value]) => typeof value === "object" && value !== null && !Array.isArray(value)
    )
  ) as Record<string, Record<string, unknown>>;
}

function parseIsoTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function compareReviewSnapshots(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): number {
  const leftRequestedAt =
    parseIsoTimestamp(typeof left.requestedAt === "string" ? left.requestedAt : undefined) ??
    Number.NEGATIVE_INFINITY;
  const rightRequestedAt =
    parseIsoTimestamp(typeof right.requestedAt === "string" ? right.requestedAt : undefined) ??
    Number.NEGATIVE_INFINITY;
  if (leftRequestedAt !== rightRequestedAt) {
    return leftRequestedAt - rightRequestedAt;
  }
  const leftRound = typeof left.round === "number" ? left.round : Number.NEGATIVE_INFINITY;
  const rightRound = typeof right.round === "number" ? right.round : Number.NEGATIVE_INFINITY;
  if (leftRound !== rightRound) {
    return leftRound - rightRound;
  }
  return String(left.reviewId ?? "").localeCompare(String(right.reviewId ?? ""));
}

function getLatestPendingReviewIdFromGraphState(
  graphState: Record<string, unknown> | undefined
): string | undefined {
  const latest = Object.values(getPendingReviewsByIdFromGraphState(graphState))
    .filter((review) => review.status === "pending" || review.status === "paused")
    .sort(compareReviewSnapshots)
    .at(-1);
  return typeof latest?.reviewId === "string" ? latest.reviewId : undefined;
}

function deriveCurrentReviewStatus(args: {
  requestSnapshot?: unknown;
  decisionSnapshot?: unknown;
  currentState?: unknown;
}): string {
  const currentState =
    typeof args.currentState === "object" &&
    args.currentState !== null &&
    !Array.isArray(args.currentState)
      ? (args.currentState as { status?: unknown })
      : undefined;
  if (typeof currentState?.status === "string") {
    return currentState.status;
  }

  if (
    typeof args.decisionSnapshot === "object" &&
    args.decisionSnapshot !== null &&
    !Array.isArray(args.decisionSnapshot)
  ) {
    return "resolved";
  }

  const requestSnapshot =
    typeof args.requestSnapshot === "object" &&
    args.requestSnapshot !== null &&
    !Array.isArray(args.requestSnapshot)
      ? (args.requestSnapshot as { status?: unknown })
      : undefined;
  if (typeof requestSnapshot?.status === "string") {
    return requestSnapshot.status;
  }

  return "unknown";
}

function deriveEffectiveTerminateScope(args: {
  requestSnapshot?: unknown;
  currentState?: unknown;
}): "branch" | "run" | undefined {
  const currentState =
    typeof args.currentState === "object" &&
    args.currentState !== null &&
    !Array.isArray(args.currentState)
      ? (args.currentState as { spec?: { terminateScope?: unknown } })
      : undefined;
  if (currentState?.spec?.terminateScope === "branch" || currentState?.spec?.terminateScope === "run") {
    return currentState.spec.terminateScope;
  }

  const requestSnapshot =
    typeof args.requestSnapshot === "object" &&
    args.requestSnapshot !== null &&
    !Array.isArray(args.requestSnapshot)
      ? (args.requestSnapshot as { spec?: { terminateScope?: unknown } })
      : undefined;
  if (
    requestSnapshot?.spec?.terminateScope === "branch" ||
    requestSnapshot?.spec?.terminateScope === "run"
  ) {
    return requestSnapshot.spec.terminateScope;
  }

  return undefined;
}

function derivePendingReviewFields(args: {
  summary?: RunSummaryProjection;
  state?: unknown;
}): {
  pendingReviewCount?: number;
  hasWaitingHumanReview?: boolean;
  latestPendingReviewId?: string;
} {
  const graphState = asGraphStateRecord(args.state);
  const pendingReviewCount =
    args.summary?.pendingReviewCount ?? countPendingReviewsFromGraphState(graphState);
  return {
    pendingReviewCount,
    hasWaitingHumanReview:
      args.summary?.hasWaitingHumanReview ??
      (pendingReviewCount !== undefined ? pendingReviewCount > 0 : undefined),
    latestPendingReviewId:
      args.summary?.latestPendingReviewId ?? getLatestPendingReviewIdFromGraphState(graphState)
  };
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
}> {
  const runtimePath = resolveOgsPaths(workdir).runtimePath;
  try {
    const runtimeConfig = validateRuntimeConfig(await readJsonFile(runtimePath), runtimePath);
    return {
      roleRepo: runtimeConfig.roleRepo
    };
  } catch {
    return {
      roleRepo: DEFAULT_ROLE_REPO
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
  const templateRoleRepoRoot = resolveTemplateRoleRepoRoot();

  await copyIfMissing(
    resolve(templateRoleRepoRoot, "README.md"),
    resolve(projectRoleRepoRoot, "README.md")
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
  const importedRole = await copyIfMissing(
    resolve(templateRoleRootDir, args.roleId),
    resolve(projectRoleRootDir, args.roleId)
  );
  await ensureProjectRepoMetadataFiles(args.workdir);
  return importedRole;
}

export function resolveOgsPaths(workdir: string): {
  ogsDir: string;
  runsDir: string;
  readmePath: string;
  runsIndexPath: string;
  projectPath: string;
  runtimePath: string;
  modelCatalogPath: string;
  modelSelectionPath: string;
  providerPath: string;
  lawsPath: string;
  userProfilePath: string;
} {
  return {
    ogsDir: resolve(workdir, OGS_DIR),
    runsDir: resolve(workdir, OGS_RUNS_DIR),
    readmePath: resolve(workdir, OGS_README_FILE),
    runsIndexPath: resolve(workdir, OGS_RUNS_INDEX_FILE),
    projectPath: resolve(workdir, OGS_PROJECT_FILE),
    runtimePath: resolve(workdir, OGS_RUNTIME_FILE),
    modelCatalogPath: resolve(workdir, OGS_MODEL_CATALOG_FILE),
    modelSelectionPath: resolve(workdir, OGS_MODEL_SELECTION_FILE),
    providerPath: resolve(workdir, OGS_PROVIDER_OPENCODE_FILE),
    lawsPath: resolve(workdir, OGS_LAWS_FILE),
    userProfilePath: resolve(workdir, OGS_USER_PROFILE_FILE)
  };
}

function createDefaultModelSelection(args: {
  catalog: ModelCatalog;
  system?: SystemDefinition;
}): ModelSelectionConfig {
  const selected = chooseDefaultModelFromCatalog(args.catalog);
  if (!selected) {
    throw new Error(
      "No active text-output toolcall model was discovered from `opencode models --verbose`."
    );
  }

  return {
    configVersion: "1",
    defaults: {
      model: selected.ref,
      variant: selected.variants.includes("medium") ? "medium" : undefined,
      timeoutMs: 120000,
      maxOutputBytes: 65536
    },
    systems: args.system
      ? {
          [args.system.systemId]: {
            defaults: {
              model: selected.ref,
              variant: selected.variants.includes("medium") ? "medium" : undefined
            }
          }
        }
      : undefined
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
    `${stringifyJson(createDefaultOpencodeProviderReference())}\n`
  );
  await ensureFile(
    paths.runsIndexPath,
    `${stringifyJson({
      version: 1,
      generatedAt: new Date().toISOString(),
      runs: []
    })}\n`
  );
  await ensureFile(paths.readmePath, `${createDefaultOgsReadme()}\n`);
}

export async function scaffoldProjectTemplate(args: {
  workdir: string;
  templateId: ProjectTemplateId;
}): Promise<ProjectTemplateSpec> {
  const template = getProjectTemplate(args.templateId);
  const paths = resolveOgsPaths(args.workdir);
  await ensureFile(resolve(args.workdir, "system.mmd"), `${template.systemMmd}\n`);
  if (template.exampleSystemMmd) {
    await ensureFile(resolve(args.workdir, "system.example.mmd"), `${template.exampleSystemMmd}\n`);
  }
  await ensureFile(paths.lawsPath, `${template.lawsJson}\n`);
  await ensureFile(paths.userProfilePath, `${stringifyJson(createDefaultUserProfile())}\n`);
  return template;
}

export async function syncProjectDependencies(args: {
  workdir: string;
  systemPath?: string;
  systemSource?: string;
}): Promise<ProjectDependencySyncResult> {
  const system = await loadSystemDefinitionForSync(args);
  const { roleIds, modelIds } = getSystemDependencies(system);
  const importedRoleIds: string[] = [];

  for (const roleId of roleIds) {
    if (await importRolePackageIntoProject({ workdir: args.workdir, roleId })) {
      importedRoleIds.push(roleId);
    }
  }

  return {
    roleIds,
    modelIds,
    importedRoleIds,
    importedModelIds: []
  };
}

export async function syncProjectModels(args: {
  workdir: string;
  systemPath?: string;
  rewriteDefault?: boolean;
}): Promise<{
  catalogPath: string;
  selectionPath: string;
  generatedSelection: boolean;
  selectedModel?: string;
}> {
  const paths = resolveOgsPaths(args.workdir);
  const catalog = await refreshModelCatalog({
    workdir: args.workdir
  });
  await writeJsonFileAtomic(paths.modelCatalogPath, catalog);

  const hasSelection = await stat(paths.modelSelectionPath).then(() => true).catch(() => false);
  if (!hasSelection || args.rewriteDefault) {
    const system = args.systemPath
      ? await loadSystemFromMermaid(resolve(args.workdir, args.systemPath))
      : undefined;
    const selection = createDefaultModelSelection({
      catalog,
      system
    });
    await writeJsonFileAtomic(paths.modelSelectionPath, selection);
    return {
      catalogPath: paths.modelCatalogPath,
      selectionPath: paths.modelSelectionPath,
      generatedSelection: true,
      selectedModel: selection.defaults?.model
    };
  }

  const existingSelection = await readJsonFile(paths.modelSelectionPath);
  const selectedModel =
    typeof existingSelection === "object" &&
    existingSelection !== null &&
    !Array.isArray(existingSelection) &&
    typeof (existingSelection as { defaults?: { model?: unknown } }).defaults?.model === "string"
      ? (existingSelection as { defaults: { model: string } }).defaults.model
      : undefined;

  return {
    catalogPath: paths.modelCatalogPath,
    selectionPath: paths.modelSelectionPath,
    generatedSelection: false,
    selectedModel
  };
}

export async function loadIndexedRuns(workdir: string): Promise<IndexedRun[]> {
  const { runsDir } = resolveOgsPaths(workdir);
  let entries: Dirent[];
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
    const reviewFields = derivePendingReviewFields({
      summary,
      state: stateRaw
    });
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
    const indexedState = state as IndexedRunStateSnapshot | undefined;
    const runStat = await stat(runDir);
    runs.push({
      runId: entry.name,
      status: summary?.status ?? indexedState?.status ?? indexedState?.graphState?.status ?? "unknown",
      transitionCount:
        summary?.transitionCount ??
        indexedState?.transitionCount ??
        indexedState?.graphState?.transitionCount ??
        0,
      finalRoleId:
        summary?.finalRoleId ?? indexedState?.finalRoleId ?? indexedState?.graphState?.finalRoleId,
      pendingReviewCount: reviewFields.pendingReviewCount,
      hasWaitingHumanReview: reviewFields.hasWaitingHumanReview,
      latestPendingReviewId: reviewFields.latestPendingReviewId,
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
    throw new Error(`Unsupported run path: ${runId}`);
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
  const summaryProjection = asSummaryProjection(summary);
  const reviewFields = derivePendingReviewFields({
    summary: summaryProjection,
    state
  });
  return {
    runId,
    runDir,
    state,
    metrics,
    resolvedConfig,
    stopRequest,
    stopOutcome,
    summary: summaryProjection,
    pendingReviewCount: reviewFields.pendingReviewCount,
    hasWaitingHumanReview: reviewFields.hasWaitingHumanReview,
    latestPendingReviewId: reviewFields.latestPendingReviewId
  };
}

function resolveReviewsDir(runDir: string): string {
  return resolve(runDir, "control", "reviews");
}

async function loadReviewRecord(path: string): Promise<unknown | undefined> {
  return tryReadJson(path);
}

export async function listHumanReviews(workdir: string, runId: string): Promise<Record<string, unknown>> {
  const runDir = resolveRunDir(workdir, runId);
  const state = await tryReadJson(resolve(runDir, "state.json"));
  const reviewsDir = resolveReviewsDir(runDir);
  let entries: Dirent[];
  try {
    entries = await readdir(reviewsDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const reviewIds = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name.endsWith(".request.json")) {
      reviewIds.add(entry.name.slice(0, -".request.json".length));
    }
    if (entry.name.endsWith(".decision.json")) {
      reviewIds.add(entry.name.slice(0, -".decision.json".length));
    }
  }
  const pendingReviewsById = getPendingReviewsByIdFromGraphState(asGraphStateRecord(state));

  const reviews = await Promise.all(
    [...reviewIds].sort((left, right) => left.localeCompare(right)).map(async (reviewId) => {
      const [requestSnapshot, decisionSnapshot] = await Promise.all([
        loadReviewRecord(resolve(reviewsDir, `${reviewId}.request.json`)),
        loadReviewRecord(resolve(reviewsDir, `${reviewId}.decision.json`))
      ]);
      const currentState = pendingReviewsById[reviewId];
      return {
        reviewId,
        currentStatus: deriveCurrentReviewStatus({
          requestSnapshot,
          decisionSnapshot,
          currentState
        }),
        requestSnapshot,
        decisionSnapshot,
        currentState
      };
    })
  );
  return {
    runId,
    runDir,
    latestPendingReviewId: getLatestPendingReviewIdFromGraphState(asGraphStateRecord(state)),
    reviews
  };
}

export async function inspectHumanReview(
  workdir: string,
  runId: string,
  reviewId: string
): Promise<Record<string, unknown>> {
  const runDir = resolveRunDir(workdir, runId);
  const detail = await inspectRun(workdir, runId);
  const reviewsDir = resolveReviewsDir(runDir);
  const [requestSnapshot, decisionSnapshot] = await Promise.all([
    loadReviewRecord(resolve(reviewsDir, `${reviewId}.request.json`)),
    loadReviewRecord(resolve(reviewsDir, `${reviewId}.decision.json`))
  ]);
  const graphState =
    typeof detail.state === "object" &&
    detail.state !== null &&
    !Array.isArray(detail.state) &&
    typeof (detail.state as { graphState?: unknown }).graphState === "object" &&
    (detail.state as { graphState?: unknown }).graphState !== null
      ? ((detail.state as { graphState: Record<string, unknown> }).graphState ?? {})
      : {};
  const currentState =
    typeof graphState.pendingReviewsById === "object" &&
    graphState.pendingReviewsById !== null &&
    !Array.isArray(graphState.pendingReviewsById)
      ? (graphState.pendingReviewsById as Record<string, unknown>)[reviewId]
      : undefined;
  return {
    runId,
    runDir,
    reviewId,
    currentStatus: deriveCurrentReviewStatus({
      requestSnapshot,
      decisionSnapshot,
      currentState
    }),
    requestSnapshot,
    decisionSnapshot,
    currentState
  };
}

export async function writeHumanReviewDecision(args: {
  workdir: string;
  runId: string;
  reviewId: string;
  decision: HumanReviewDecision;
  comment?: string;
  actor?: string;
  scope?: "branch" | "run";
}): Promise<Record<string, unknown>> {
  const currentReview = await inspectHumanReview(args.workdir, args.runId, args.reviewId);
  const currentStatus =
    typeof currentReview.currentStatus === "string" ? currentReview.currentStatus : "unknown";
  if (
    currentReview.requestSnapshot === undefined &&
    currentReview.currentState === undefined &&
    currentReview.decisionSnapshot === undefined
  ) {
    throw new Error(`Review not found: ${args.reviewId}`);
  }
  if (currentStatus === "resolved" || currentStatus === "expired") {
    throw new Error(`Review "${args.reviewId}" is already ${currentStatus}; refusing to overwrite it.`);
  }
  if (currentStatus !== "pending" && currentStatus !== "paused") {
    throw new Error(`Review "${args.reviewId}" is not actionable; currentStatus=${currentStatus}.`);
  }
  if (args.scope !== undefined && args.decision !== "terminate") {
    throw new Error("--scope is only valid with --decision terminate");
  }
  const effectiveScope =
    args.decision === "terminate"
      ? args.scope ??
        deriveEffectiveTerminateScope({
          requestSnapshot: currentReview.requestSnapshot,
          currentState: currentReview.currentState
        })
      : undefined;
  if (args.decision === "terminate" && effectiveScope === undefined) {
    throw new Error(
      `Review "${args.reviewId}" does not expose a valid terminate scope; expected "branch" or "run".`
    );
  }

  const runDir = resolveRunDir(args.workdir, args.runId);
  const reviewsDir = resolveReviewsDir(runDir);
  await mkdir(reviewsDir, { recursive: true });
  const record: HumanReviewDecisionRecord = {
    reviewId: args.reviewId,
    committedAt: new Date().toISOString(),
    decidedAt: new Date().toISOString(),
    decision: args.decision,
    comment: args.comment,
    actor: args.actor,
    scope: effectiveScope
  };
  await writeJsonFileAtomic(resolve(reviewsDir, `${args.reviewId}.decision.json`), record);
  return {
    runId: args.runId,
    runDir,
    reviewId: args.reviewId,
    decision: record
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
  const template = await scaffoldProjectTemplate({
    workdir: projectDir,
    templateId: args.templateId
  });
  await syncProjectModels({
    workdir: projectDir,
    systemPath: "system.mmd"
  });
  if (template.syncDependencies) {
    await syncProjectDependencies({
      workdir: projectDir,
      systemPath: "system.mmd"
    });
  }
  await rebuildRunsIndex(projectDir);
  return projectDir;
}
