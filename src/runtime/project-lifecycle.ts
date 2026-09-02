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
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
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
import { ROLE_EXECUTION_OUTCOME_FILE } from "./run-artifacts.js";
import { filesystemRunStore } from "./run-store.js";
import { projectTargetConfig } from "./project-target.js";
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
const OGS_LAWS_FILE = ".ogs/laws.json";
const OGS_USER_PROFILE_FILE = ".ogs/user-profile.json";
const DEFAULT_DEBUG_TOOL_SCRIPT_FILE = "scripts/console-print.mjs";
const DEFAULT_DEBUG_PROFILE_ID = "profile.console.print";
const DEFAULT_DEBUG_TOOL_REF = "tool.console.print";
const MINIMAL_HELLO_ROLE_ID = "hello-ogsystem";
const MINIMAL_HELLO_EVENT = "HELLO_DONE";
const MINIMAL_HELLO_PROFILE_ID = "profile.hello.ogsystem";
const MINIMAL_HELLO_TOOL_REF = "tool.hello.ogsystem";
const MINIMAL_HELLO_TOOL_SCRIPT_FILE = "scripts/hello-ogsystem.mjs";
const ROLE_IO_SCAN_BATCH_SIZE = 16;

export type IndexedRun = {
  runId: string;
  status: string;
  transitionCount: number;
  durationMs?: number;
  wallClockDurationMs?: number;
  executionDurationMs?: number;
  stopReason?: string;
  stopOutcome?: string;
  stopOutcomeStatus?: string;
  lastErrorCode?: string;
  lastRoleId?: string;
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

export class RunRoleIoLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunRoleIoLookupError";
  }
}

export type ProjectTemplateId =
  | "empty"
  | "minimal"
  | "advanced-features"
  | "software-dev"
  | "consultation";

type ProjectModelSeedStrategy = "refresh" | "empty";

type ProjectTemplateSpec = {
  systemMmd: string;
  lawsJson: string;
  exampleSystemMmd?: string;
  syncDependencies: boolean;
  modelSeedStrategy: ProjectModelSeedStrategy;
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
      "%% system.id=project.starter",
      "%% system.version=1.0.0",
      "%% law.global=law.project.base",
      "%% entry.role=demo-analyst",
      "",
      "input -->|ENTER| analyst[Role:demo-analyst]",
      "analyst[Role:demo-analyst] -->|ANALYSIS_DONE| output",
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
    syncDependencies: true,
    modelSeedStrategy: "empty"
  },
  minimal: {
    systemMmd: [
      "flowchart TD",
      "%% system.id=template.minimal",
      "%% system.version=1.0.0",
      "%% law.global=law.console.base",
      `%% entry.role=${MINIMAL_HELLO_ROLE_ID}`,
      `%% exec.bind.${MINIMAL_HELLO_ROLE_ID}=${MINIMAL_HELLO_PROFILE_ID}`,
      "",
      `input -->|START| hello[Role:${MINIMAL_HELLO_ROLE_ID}]`,
      `hello[Role:${MINIMAL_HELLO_ROLE_ID}] -->|${MINIMAL_HELLO_EVENT}| output`,
      ""
    ].join("\n"),
    lawsJson: stringifyJson({
      laws: [
        {
          lawId: "law.console.base",
          constraints: {
            forbiddenToolRefs: [],
            maxTransitions: 8,
            allowNoopWithoutExecutionBinding: false
          }
        }
      ]
    }),
    syncDependencies: true,
    modelSeedStrategy: "empty"
  },
  "advanced-features": {
    systemMmd: [
      "flowchart TD",
      "%% system.id=template.advanced.features",
      "%% system.version=1.0.0",
      "%% law.global=law.console.base",
      "%% entry.role=advanced-coordinator",
      "%% exec.bind.advanced-coordinator=profile.console.print",
      "%% exec.bind.advanced-worker-a=profile.console.print",
      "%% exec.bind.advanced-worker-b=profile.console.print",
      "%% exec.bind.advanced-reviewer=profile.console.print",
      "%% role.mode.advanced-coordinator=parallel_split",
      "%% loop.max.advanced-coordinator=2",
      "%% route.order.advanced-coordinator=advanced-worker-a,advanced-worker-b",
      "%% join.mode.advanced-reviewer=all_of",
      "%% join.sources.advanced-reviewer=advanced-worker-a,advanced-worker-b",
      "%% context.map.advanced-coordinator.review_comment=global.human_review.current.comment?",
      "%% context.map.advanced-coordinator.review_round=global.human_review.current.round?",
      "%% context.map.advanced-coordinator.previous_output=global.human_review.current.previous_output.content?",
      "%% context.map.advanced-reviewer.worker_a_output=source(advanced-worker-a).content",
      "%% context.map.advanced-reviewer.worker_b_output=source(advanced-worker-b).content",
      "%% context.map.advanced-reviewer.task=global.task",
      "%% review.mode.advanced-reviewer=required",
      "%% review.timeout.advanced-reviewer=86400",
      "%% review.timeout.action.advanced-reviewer=pause",
      "%% review.rework.target.advanced-reviewer=advanced-coordinator",
      "%% review.rework.max.advanced-reviewer=2",
      "%% review.terminate.scope.advanced-reviewer=branch",
      "",
      "input -->|START| coordinator[Role:advanced-coordinator]",
      "coordinator[Role:advanced-coordinator] -->|START_A| workera[Role:advanced-worker-a]",
      "coordinator[Role:advanced-coordinator] -->|START_B| workerb[Role:advanced-worker-b]",
      "workera[Role:advanced-worker-a] -->|A_DONE| reviewer[Role:advanced-reviewer]",
      "workerb[Role:advanced-worker-b] -->|B_DONE| reviewer[Role:advanced-reviewer]",
      "reviewer[Role:advanced-reviewer] -->|REVIEW_READY| output",
      "reviewer[Role:advanced-reviewer] -->|REWORK| coordinator[Role:advanced-coordinator]",
      ""
    ].join("\n"),
    lawsJson: stringifyJson({
      laws: [
        {
          lawId: "law.console.base",
          constraints: {
            forbiddenToolRefs: [],
            maxTransitions: 16,
            allowNoopWithoutExecutionBinding: false
          }
        }
      ]
    }),
    syncDependencies: true,
    modelSeedStrategy: "empty"
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
    syncDependencies: true,
    modelSeedStrategy: "refresh"
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
    syncDependencies: true,
    modelSeedStrategy: "refresh"
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

function createDefaultProfilesConfig(): Array<Record<string, unknown>> {
  return [
    {
      profileId: DEFAULT_DEBUG_PROFILE_ID,
      toolRef: DEFAULT_DEBUG_TOOL_REF,
      timeoutMs: 30000,
      maxOutputBytes: 65536
    }
  ];
}

function createDefaultToolsConfig(): Record<string, unknown> {
  return {
    tools: [
      {
        toolRef: DEFAULT_DEBUG_TOOL_REF,
        runner: "local_shell",
        command: "node",
        argsTemplate: [DEFAULT_DEBUG_TOOL_SCRIPT_FILE],
        stdinMode: "text"
      }
    ]
  };
}

function createDefaultConsolePrintToolScript(): string {
  return [
    '#!/usr/bin/env node',
    'import { env, stderr, stdin, stdout } from "node:process";',
    "",
    "async function readPrompt() {",
    "  const chunks = [];",
    '  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));',
    '  return Buffer.concat(chunks).toString("utf8").trim();',
    "}",
    "",
    "function allowedEvents() {",
    '  return String(env.OGSYSTEM_ALLOWED_EVENTS || "")',
    '    .split(",")',
    "    .map((value) => value.trim())",
    "    .filter(Boolean);",
    "}",
    "",
    "function chooseEvent(events) {",
    '  const explicit = (process.argv[2] || env.OGSYSTEM_DEBUG_EVENT || "").trim();',
    "  if (explicit && (!events.length || events.includes(explicit))) return explicit;",
    '  return events[0] || explicit || "DONE";',
    "}",
    "",
    "const prompt = await readPrompt();",
    "const events = allowedEvents();",
    "const event = chooseEvent(events);",
    'const roleId = env.OGSYSTEM_ROLE_ID || "unknown-role";',
    `const profileId = env.OGSYSTEM_PROFILE_ID || "${DEFAULT_DEBUG_PROFILE_ID}";`,
    `const toolRef = env.OGSYSTEM_TOOL_REF || "${DEFAULT_DEBUG_TOOL_REF}";`,
    'const content = prompt || `[console-print] ${roleId}`;',
    'stderr.write(`[console-print] role=${roleId} event=${event}\\n`);',
    "if (prompt) stderr.write(`${prompt}\\n`);",
    "stdout.write(JSON.stringify({",
    "  event,",
    "  content,",
    "  data: { roleId, profileId, toolRef, allowedEvents: events }",
    "}));",
    ""
  ].join("\n");
}

function createMinimalHelloToolScript(): string {
  return [
    '#!/usr/bin/env node',
    'import { env, stdout } from "node:process";',
    "",
    "const allowedEvents = String(env.OGSYSTEM_ALLOWED_EVENTS || \"\")",
    "  .split(\",\")",
    "  .map((value) => value.trim())",
    "  .filter(Boolean);",
    `const event = allowedEvents[0] || "${MINIMAL_HELLO_EVENT}";`,
    'stdout.write(JSON.stringify({ event, content: "Hello OGSystem world" }));',
    ""
  ].join("\n");
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
    "- Provider credentials and gateway URLs: user-level `~/.ogsystem/.env` (loaded for OpenCode).",
    "- `laws.json`: Project laws and transition constraints used by the runtime.",
    "- `user-profile.json`: Default user preference profile injected into runs.",
    "- `profiles.json`: Exec profiles that bind `exec.bind.*` roles to local tools.",
    "- `tools.json`: Local tool registry consumed by `profiles.json`.",
    "- `project.json`: Project identity and creation metadata. Usually generated once and then left alone.",
    "- `project.json.target`: Optional external coding project bound to OpenCode; omit it to use this project directory.",
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
    "- `project.json`, `model-catalog.json`, and `runs-index.json` are mostly generated artifacts. Manual edits may be overwritten by lifecycle commands."
  ].join("\n");
}

export function isProjectTemplateId(value: string | undefined): value is ProjectTemplateId {
  return (
    value === "empty" ||
    value === "minimal" ||
    value === "advanced-features" ||
    value === "software-dev" ||
    value === "consultation"
  );
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

async function tryReadText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function isMissingPathError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
}

function isInvalidJsonFileError(error: unknown): boolean {
  return error instanceof Error && /^Invalid JSON in /.test(error.message);
}

async function tryReadJsonIfPresent(path: string): Promise<unknown | undefined> {
  try {
    return await readJsonFile(path);
  } catch (error) {
    if (isMissingPathError(error) || isInvalidJsonFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function tryReadTextIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw error;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
  const record = value as Record<string, unknown>;
  const graphState = record.graphState;
  if (typeof graphState === "object" && graphState !== null && !Array.isArray(graphState)) {
    return graphState as Record<string, unknown>;
  }
  return record;
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

function getReviewHistoryByBranchIdFromGraphState(
  graphState: Record<string, unknown> | undefined
): Record<string, Record<string, unknown>[]> {
  const reviewHistoryByBranchId = graphState?.reviewHistoryByBranchId;
  if (
    typeof reviewHistoryByBranchId !== "object" ||
    reviewHistoryByBranchId === null ||
    Array.isArray(reviewHistoryByBranchId)
  ) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(reviewHistoryByBranchId).map(([branchId, value]) => [
      branchId,
      Array.isArray(value)
        ? value.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry))
        : []
    ])
  ) as Record<string, Record<string, unknown>[]>;
}

function getHumanReviewContextByBranchIdFromGraphState(
  graphState: Record<string, unknown> | undefined
): Record<string, Record<string, unknown>> {
  const humanReviewContextByBranchId = graphState?.humanReviewContextByBranchId;
  if (
    typeof humanReviewContextByBranchId !== "object" ||
    humanReviewContextByBranchId === null ||
    Array.isArray(humanReviewContextByBranchId)
  ) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(humanReviewContextByBranchId).filter(
      ([, value]) => typeof value === "object" && value !== null && !Array.isArray(value)
    )
  ) as Record<string, Record<string, unknown>>;
}

function getBranchRecordsFromGraphState(
  graphState: Record<string, unknown> | undefined
): Record<string, Record<string, unknown>> {
  const branchRecords = graphState?.branchRecords;
  if (
    typeof branchRecords !== "object" ||
    branchRecords === null ||
    Array.isArray(branchRecords)
  ) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(branchRecords).filter(
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

function deriveReviewDecisionPhase(decisionSnapshot: unknown):
  | "recorded"
  | "pending_reconcile"
  | "applied"
  | undefined {
  const decision =
    typeof decisionSnapshot === "object" &&
    decisionSnapshot !== null &&
    !Array.isArray(decisionSnapshot)
      ? (decisionSnapshot as {
          committedAt?: unknown;
          checkpointSequence?: unknown;
          appliedAt?: unknown;
          reconciledAt?: unknown;
          decision?: unknown;
          decidedAt?: unknown;
        })
      : undefined;
  if (!decision) {
    return undefined;
  }
  if (typeof decision.reconciledAt === "string") {
    return "applied";
  }
  if (typeof decision.appliedAt === "string" || typeof decision.checkpointSequence === "number") {
    return "pending_reconcile";
  }
  if (
    typeof decision.committedAt === "string" ||
    typeof decision.decidedAt === "string" ||
    typeof decision.decision === "string"
  ) {
    return "recorded";
  }
  return undefined;
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

function normalizeReviewProjection(args: {
  reviewId: string;
  requestSnapshot?: unknown;
  decisionSnapshot?: unknown;
  currentState?: unknown;
  branchRecord?: Record<string, unknown>;
  history?: Record<string, unknown>[];
  humanReviewContext?: Record<string, unknown>;
}): Record<string, unknown> {
  const requestSnapshot =
    typeof args.requestSnapshot === "object" &&
    args.requestSnapshot !== null &&
    !Array.isArray(args.requestSnapshot)
      ? (args.requestSnapshot as Record<string, unknown>)
      : undefined;
  const currentState =
    typeof args.currentState === "object" &&
    args.currentState !== null &&
    !Array.isArray(args.currentState)
      ? (args.currentState as Record<string, unknown>)
      : undefined;
  const decisionSnapshot =
    typeof args.decisionSnapshot === "object" &&
    args.decisionSnapshot !== null &&
    !Array.isArray(args.decisionSnapshot)
      ? (args.decisionSnapshot as Record<string, unknown>)
      : undefined;
  const source = currentState ?? requestSnapshot;

  return {
    reviewId: args.reviewId,
    currentStatus: deriveCurrentReviewStatus(args),
    decisionPhase: deriveReviewDecisionPhase(decisionSnapshot),
    roleId: asString(source?.roleId),
    branchId: asString(source?.branchId),
    lineageId: asString(source?.lineageId),
    loopIteration: asNumber(source?.loopIteration),
    executionId: asString(source?.executionId),
    requestedAt: asString(source?.requestedAt),
    requestedByExecutionId: asString(source?.requestedByExecutionId),
    round: asNumber(source?.round),
    selectedEvent: asString(source?.selectedEvent),
    draftResult:
      typeof source?.draftResult === "object" &&
      source?.draftResult !== null &&
      !Array.isArray(source?.draftResult)
        ? source.draftResult
        : undefined,
    spec:
      typeof source?.spec === "object" &&
      source?.spec !== null &&
      !Array.isArray(source?.spec)
        ? source.spec
        : undefined,
    decision: asString(decisionSnapshot?.decision),
    decidedAt: asString(decisionSnapshot?.decidedAt),
    committedAt: asString(decisionSnapshot?.committedAt),
    actor: asString(decisionSnapshot?.actor),
    comment: asString(decisionSnapshot?.comment),
    scope:
      (decisionSnapshot?.scope === "branch" || decisionSnapshot?.scope === "run"
        ? decisionSnapshot.scope
        : deriveEffectiveTerminateScope(args)) ?? undefined,
    checkpointSequence: asNumber(decisionSnapshot?.checkpointSequence),
    appliedAt: asString(decisionSnapshot?.appliedAt),
    reconciledAt: asString(decisionSnapshot?.reconciledAt),
    branchStatus: asString(args.branchRecord?.status),
    requestSnapshot: args.requestSnapshot,
    decisionSnapshot: args.decisionSnapshot,
    currentState: args.currentState,
    history: args.history ?? [],
    humanReviewContext: args.humanReviewContext
  };
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

function deriveStopFields(args: {
  summary?: RunSummaryProjection;
  stopRequest?: unknown;
  stopOutcome?: unknown;
}): {
  stopReason?: string;
  stopOutcome?: string;
} {
  const stopOutcomeRecord =
    typeof args.stopOutcome === "object" &&
    args.stopOutcome !== null &&
    !Array.isArray(args.stopOutcome)
      ? (args.stopOutcome as Record<string, unknown>)
      : undefined;
  const stopRequestRecord =
    typeof args.stopRequest === "object" &&
    args.stopRequest !== null &&
    !Array.isArray(args.stopRequest)
      ? (args.stopRequest as Record<string, unknown>)
      : undefined;
  return {
    stopReason:
      asString(stopOutcomeRecord?.reason) ??
      asString(stopRequestRecord?.reason) ??
      args.summary?.stopReason,
    stopOutcome: asString(stopOutcomeRecord?.status) ?? args.summary?.stopOutcome
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

function asObjectRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

type RoleIoExecutionCandidate = {
  executionDir: string;
  executionId: string;
  committedAt: string;
  outcome: Record<string, unknown>;
};

function compareRoleIoExecutionCandidates(
  left: RoleIoExecutionCandidate,
  right: RoleIoExecutionCandidate
): number {
  const leftCommittedAt = parseIsoTimestamp(left.committedAt) ?? 0;
  const rightCommittedAt = parseIsoTimestamp(right.committedAt) ?? 0;
  if (leftCommittedAt !== rightCommittedAt) {
    return leftCommittedAt - rightCommittedAt;
  }
  return left.executionId.localeCompare(right.executionId);
}

async function tryReadRoleIoJsonIfPresent(path: string): Promise<unknown | undefined> {
  try {
    return await readJsonFile(path);
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function loadRoleIoOutcome(executionDir: string): Promise<Record<string, unknown> | undefined> {
  const outcome =
    await tryReadRoleIoJsonIfPresent(resolve(executionDir, ROLE_EXECUTION_OUTCOME_FILE))
    ?? await tryReadRoleIoJsonIfPresent(resolve(executionDir, "outcome.json"));
  return asObjectRecord(outcome);
}

async function upsertProjectExecutionConfig(args: {
  workdir: string;
  profile: Record<string, unknown>;
  tool: Record<string, unknown>;
}): Promise<void> {
  const profilesPath = resolve(args.workdir, "profiles.json");
  const existingProfiles = await tryReadJson(profilesPath);
  const profiles = Array.isArray(existingProfiles)
    ? existingProfiles.filter((entry) => asObjectRecord(entry))
    : [];
  const nextProfiles = [
    ...profiles.filter(
      (entry) => asObjectRecord(entry)?.profileId !== args.profile.profileId
    ),
    args.profile
  ].sort((left, right) =>
    String(asObjectRecord(left)?.profileId ?? "").localeCompare(
      String(asObjectRecord(right)?.profileId ?? "")
    )
  );
  await writeJsonFileAtomic(profilesPath, nextProfiles);

  const toolsPath = resolve(args.workdir, "tools.json");
  const existingToolsValue = await tryReadJson(toolsPath);
  const existingToolsRecord = asObjectRecord(existingToolsValue);
  const existingTools = Array.isArray(existingToolsRecord?.tools)
    ? existingToolsRecord.tools.filter((entry) => asObjectRecord(entry))
    : [];
  const nextTools = [
    ...existingTools.filter(
      (entry) => asObjectRecord(entry)?.toolRef !== args.tool.toolRef
    ),
    args.tool
  ].sort((left, right) =>
    String(asObjectRecord(left)?.toolRef ?? "").localeCompare(
      String(asObjectRecord(right)?.toolRef ?? "")
    )
  );
  await writeJsonFileAtomic(toolsPath, { tools: nextTools });
}

async function ensureTemplateRuntimeAssets(args: {
  workdir: string;
  templateId: ProjectTemplateId;
}): Promise<void> {
  if (args.templateId !== "minimal") {
    return;
  }
  await upsertProjectExecutionConfig({
    workdir: args.workdir,
    profile: {
      profileId: MINIMAL_HELLO_PROFILE_ID,
      toolRef: MINIMAL_HELLO_TOOL_REF,
      timeoutMs: 30000,
      maxOutputBytes: 65536
    },
    tool: {
      toolRef: MINIMAL_HELLO_TOOL_REF,
      runner: "local_shell",
      command: "node",
      argsTemplate: [MINIMAL_HELLO_TOOL_SCRIPT_FILE],
      stdinMode: "none"
    }
  });
  await ensureFile(
    resolve(args.workdir, MINIMAL_HELLO_TOOL_SCRIPT_FILE),
    `${createMinimalHelloToolScript()}\n`
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

export async function importInstalledRolePackageIntoProject(args: {
  workdir: string;
  roleId: string;
}): Promise<boolean> {
  return importRolePackageIntoProject(args);
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
  projectId?: string;
  projectName?: string;
  targetDir?: string;
}): Promise<void> {
  const paths = resolveOgsPaths(args.workdir);
  await mkdir(paths.ogsDir, { recursive: true });
  await mkdir(paths.runsDir, { recursive: true });
  await mkdir(resolve(args.workdir, "scripts"), { recursive: true });
  if (args.targetDir) {
    const targetStat = await stat(args.targetDir).catch(() => undefined);
    if (!targetStat?.isDirectory()) {
      throw new Error(`OpenCode target directory does not exist or is not a directory: ${resolve(args.targetDir)}`);
    }
  }
  const defaultProjectRecord = {
    version: 1,
    projectId:
      args.projectId ??
      args.projectName ??
      (basename(args.workdir) || `project-${randomUUID().slice(0, 8)}`),
    projectName: args.projectName,
    createdAt: new Date().toISOString()
  } as Record<string, unknown>;
  if (args.targetDir) {
    const existingProject = await readJsonFile(paths.projectPath).catch(() => undefined);
    const existingProjectRecord =
      existingProject && typeof existingProject === "object" && !Array.isArray(existingProject)
        ? (existingProject as Record<string, unknown>)
        : defaultProjectRecord;
    await writeJsonFileAtomic(paths.projectPath, {
      ...existingProjectRecord,
      target: projectTargetConfig({
        workdir: args.workdir,
        targetDir: args.targetDir
      })
    });
  } else {
    await ensureFile(paths.projectPath, `${stringifyJson(defaultProjectRecord)}\n`);
  }
  await ensureFile(paths.runtimePath, `${stringifyJson(createDefaultRuntimeConfig())}\n`);
  await ensureFile(
    paths.runsIndexPath,
    `${stringifyJson({
      version: 1,
      generatedAt: new Date().toISOString(),
      runs: []
    })}\n`
  );
  await ensureFile(paths.readmePath, `${createDefaultOgsReadme()}\n`);
  await ensureFile(resolve(args.workdir, "profiles.json"), `${stringifyJson(createDefaultProfilesConfig())}\n`);
  await ensureFile(resolve(args.workdir, "tools.json"), `${stringifyJson(createDefaultToolsConfig())}\n`);
  await ensureFile(
    resolve(args.workdir, DEFAULT_DEBUG_TOOL_SCRIPT_FILE),
    `${createDefaultConsolePrintToolScript()}\n`
  );
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
  await ensureTemplateRuntimeAssets({
    workdir: args.workdir,
    templateId: args.templateId
  });
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
  strategy?: ProjectModelSeedStrategy;
}): Promise<{
  catalogPath: string;
  selectionPath: string;
  generatedSelection: boolean;
  selectedModel?: string;
}> {
  const paths = resolveOgsPaths(args.workdir);
  const strategy = args.strategy ?? "refresh";
  if (strategy === "empty") {
    const hasCatalog = await stat(paths.modelCatalogPath).then(() => true).catch(() => false);
    const hasSelection = await stat(paths.modelSelectionPath).then(() => true).catch(() => false);

    if (!hasCatalog || args.rewriteDefault) {
      await writeJsonFileAtomic(paths.modelCatalogPath, {
        catalogVersion: "1",
        generatedAt: new Date().toISOString(),
        source: {
          command: "ogs project scaffold --model-strategy empty"
        },
        models: []
      });
    }
    if (!hasSelection || args.rewriteDefault) {
      await writeJsonFileAtomic(paths.modelSelectionPath, {
        configVersion: "1"
      });
      return {
        catalogPath: paths.modelCatalogPath,
        selectionPath: paths.modelSelectionPath,
        generatedSelection: true
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
    const [summaryRaw, stateRaw, stopRequestRaw, stopOutcomeRaw] = await Promise.all([
      tryReadJson(resolve(runDir, "summary.json")),
      tryReadJson(resolve(runDir, "state.json")),
      tryReadJson(resolve(runDir, "control", "stop-request.json")),
      tryReadJson(resolve(runDir, "control", "stop-outcome.json"))
    ]);
    const summary = asSummaryProjection(summaryRaw);
    const reviewFields = derivePendingReviewFields({
      summary,
      state: stateRaw
    });
    const stopFields = deriveStopFields({
      summary,
      stopRequest: stopRequestRaw,
      stopOutcome: stopOutcomeRaw
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
      durationMs: summary?.durationMs,
      wallClockDurationMs: summary?.wallClockDurationMs,
      executionDurationMs: summary?.executionDurationMs,
      stopReason: stopFields.stopReason,
      stopOutcome: stopFields.stopOutcome,
      stopOutcomeStatus: stopFields.stopOutcome,
      lastErrorCode: summary?.lastErrorCode,
      lastRoleId: summary?.lastRoleId,
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

export async function loadPersistedRunsIndex(workdir: string): Promise<RunsIndexFile | undefined> {
  const indexPath = resolve(workdir, OGS_RUNS_INDEX_FILE);
  const raw = await readJsonFile(indexPath).catch(() => undefined);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.runs)) {
    return undefined;
  }
  const runs = record.runs.flatMap((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [];
    }
    const item = value as Record<string, unknown>;
    const runId = typeof item.runId === "string" ? item.runId : undefined;
    const status = typeof item.status === "string" ? item.status : undefined;
    const transitionCount =
      typeof item.transitionCount === "number" && Number.isFinite(item.transitionCount)
        ? item.transitionCount
        : undefined;
    const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : undefined;
    const runDir = typeof item.runDir === "string" ? item.runDir : undefined;
    if (!runId || !status || transitionCount === undefined || !updatedAt || !runDir) {
      return [];
    }
    return [
      {
        runId,
        status,
        transitionCount,
        durationMs:
          typeof item.durationMs === "number" && Number.isFinite(item.durationMs)
            ? item.durationMs
            : undefined,
        wallClockDurationMs:
          typeof item.wallClockDurationMs === "number" && Number.isFinite(item.wallClockDurationMs)
            ? item.wallClockDurationMs
            : undefined,
        executionDurationMs:
          typeof item.executionDurationMs === "number" && Number.isFinite(item.executionDurationMs)
            ? item.executionDurationMs
            : undefined,
        stopReason: typeof item.stopReason === "string" ? item.stopReason : undefined,
        stopOutcome: typeof item.stopOutcome === "string" ? item.stopOutcome : undefined,
        stopOutcomeStatus:
          typeof item.stopOutcomeStatus === "string"
            ? item.stopOutcomeStatus
            : typeof item.stopOutcome === "string"
              ? item.stopOutcome
              : undefined,
        lastErrorCode: typeof item.lastErrorCode === "string" ? item.lastErrorCode : undefined,
        lastRoleId: typeof item.lastRoleId === "string" ? item.lastRoleId : undefined,
        finalRoleId: typeof item.finalRoleId === "string" ? item.finalRoleId : undefined,
        pendingReviewCount:
          typeof item.pendingReviewCount === "number" && Number.isFinite(item.pendingReviewCount)
            ? item.pendingReviewCount
            : undefined,
        hasWaitingHumanReview:
          typeof item.hasWaitingHumanReview === "boolean" ? item.hasWaitingHumanReview : undefined,
        latestPendingReviewId:
          typeof item.latestPendingReviewId === "string" ? item.latestPendingReviewId : undefined,
        updatedAt,
        runDir
      } satisfies IndexedRun
    ];
  });
  return {
    version: 1,
    generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : "",
    runs
  };
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
  const stopFields = deriveStopFields({
    summary: summaryProjection,
    stopRequest,
    stopOutcome
  });
  return {
    runId,
    runDir,
    state,
    metrics,
    resolvedConfig,
    stopRequest,
    stopOutcome,
    stopReason: stopFields.stopReason,
    stopOutcomeStatus: stopFields.stopOutcome,
    summary: summaryProjection,
    pendingReviewCount: reviewFields.pendingReviewCount,
    hasWaitingHumanReview: reviewFields.hasWaitingHumanReview,
    latestPendingReviewId: reviewFields.latestPendingReviewId
  };
}

export async function inspectRunRoleIo(args: {
  workdir: string;
  runId: string;
  roleId: string;
  branchId?: string;
  loopIteration?: number;
}): Promise<Record<string, unknown> | undefined> {
  const runDir = resolveRunDir(args.workdir, args.runId);
  const roleId = args.roleId.trim();
  if (!roleId) {
    return undefined;
  }
  try {
    const executionsDir = resolve(runDir, "roles", roleId, "executions");
    let entries: Dirent[];
    try {
      entries = await readdir(executionsDir, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) {
        return undefined;
      }
      throw error;
    }

    const executionEntries = entries.filter((entry) => entry.isDirectory());

    let selected: RoleIoExecutionCandidate | undefined;
    for (let index = 0; index < executionEntries.length; index += ROLE_IO_SCAN_BATCH_SIZE) {
      const batch = executionEntries.slice(index, index + ROLE_IO_SCAN_BATCH_SIZE);
      const candidates = await Promise.all(
        batch.map(async (entry) => {
          const executionDir = resolve(executionsDir, entry.name);
          const outcome = await loadRoleIoOutcome(executionDir);
          if (!outcome) {
            return undefined;
          }
          if (asString(outcome.roleId) !== roleId) {
            return undefined;
          }
          if (args.branchId && asString(outcome.branchId) !== args.branchId) {
            return undefined;
          }
          if (args.loopIteration !== undefined && asNumber(outcome.loopIteration) !== args.loopIteration) {
            return undefined;
          }
          return {
            executionDir,
            executionId: asString(outcome.executionId) ?? entry.name,
            committedAt: asString(outcome.committedAt) ?? "",
            outcome
          } satisfies RoleIoExecutionCandidate;
        })
      );
      for (const candidate of candidates) {
        if (!candidate) {
          continue;
        }
        if (!selected || compareRoleIoExecutionCandidates(candidate, selected) > 0) {
          selected = candidate;
        }
      }
    }

    if (!selected) {
      return undefined;
    }

    const [audit, result, session, inboxMarkdown, outboxMarkdown] = await Promise.all([
      tryReadRoleIoJsonIfPresent(resolve(selected.executionDir, "audit.json")),
      tryReadRoleIoJsonIfPresent(resolve(selected.executionDir, "result.json")),
      tryReadRoleIoJsonIfPresent(resolve(selected.executionDir, "session.json")),
      tryReadTextIfPresent(resolve(selected.executionDir, "inbox.md")),
      tryReadTextIfPresent(resolve(selected.executionDir, "outbox.md"))
    ]);

    return {
      runId: args.runId,
      roleId,
      branchId: asString(selected.outcome.branchId) ?? args.branchId ?? "",
      loopIteration: asNumber(selected.outcome.loopIteration) ?? args.loopIteration ?? 0,
      executionId: selected.executionId,
      status: asString(selected.outcome.status) ?? "",
      selectedEvent: asString(selected.outcome.selectedEvent) ?? "",
      committedAt: selected.committedAt,
      audit,
      result,
      session,
      inboxMarkdown: inboxMarkdown ?? "",
      outboxMarkdown: outboxMarkdown ?? ""
    };
  } catch (error) {
    if (error instanceof RunRoleIoLookupError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new RunRoleIoLookupError(
      `Failed to inspect Role I/O for run ${args.runId}, role ${roleId}: ${message}`
    );
  }
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
  const graphState = asGraphStateRecord(state);
  const pendingReviewsById = getPendingReviewsByIdFromGraphState(graphState);
  const reviewHistoryByBranchId = getReviewHistoryByBranchIdFromGraphState(graphState);
  const humanReviewContextByBranchId = getHumanReviewContextByBranchIdFromGraphState(graphState);
  const branchRecordsById = getBranchRecordsFromGraphState(graphState);
  for (const reviewId of Object.keys(pendingReviewsById)) {
    reviewIds.add(reviewId);
  }

  const reviews = await Promise.all(
    [...reviewIds].sort((left, right) => left.localeCompare(right)).map(async (reviewId) => {
      const [requestSnapshot, decisionSnapshot] = await Promise.all([
        loadReviewRecord(resolve(reviewsDir, `${reviewId}.request.json`)),
        loadReviewRecord(resolve(reviewsDir, `${reviewId}.decision.json`))
      ]);
      const currentState = pendingReviewsById[reviewId];
      const source =
        typeof currentState === "object" && currentState !== null && !Array.isArray(currentState)
          ? currentState
          : typeof requestSnapshot === "object" && requestSnapshot !== null && !Array.isArray(requestSnapshot)
            ? (requestSnapshot as Record<string, unknown>)
            : undefined;
      const branchId = asString(source?.branchId);
      return normalizeReviewProjection({
        reviewId,
        requestSnapshot,
        decisionSnapshot,
        currentState,
        branchRecord: branchId ? branchRecordsById[branchId] : undefined,
        history: branchId ? reviewHistoryByBranchId[branchId] : undefined,
        humanReviewContext: branchId ? humanReviewContextByBranchId[branchId] : undefined
      });
    })
  );
  return {
    runId,
    runDir,
    latestPendingReviewId: getLatestPendingReviewIdFromGraphState(graphState),
    reviews: reviews.sort(compareReviewSnapshots)
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
  const graphState = asGraphStateRecord(detail.state) ?? {};
  const currentState =
    typeof graphState.pendingReviewsById === "object" &&
    graphState.pendingReviewsById !== null &&
    !Array.isArray(graphState.pendingReviewsById)
      ? (graphState.pendingReviewsById as Record<string, unknown>)[reviewId]
      : undefined;
  const source =
    typeof currentState === "object" && currentState !== null && !Array.isArray(currentState)
      ? (currentState as Record<string, unknown>)
      : typeof requestSnapshot === "object" && requestSnapshot !== null && !Array.isArray(requestSnapshot)
        ? (requestSnapshot as Record<string, unknown>)
        : undefined;
  const branchId = asString(source?.branchId);
  const historyByBranchId = getReviewHistoryByBranchIdFromGraphState(graphState);
  const humanReviewContextByBranchId = getHumanReviewContextByBranchIdFromGraphState(graphState);
  const branchRecordsById = getBranchRecordsFromGraphState(graphState);
  return {
    runId,
    runDir,
    ...normalizeReviewProjection({
      reviewId,
      requestSnapshot,
      decisionSnapshot,
      currentState,
      branchRecord: branchId ? branchRecordsById[branchId] : undefined,
      history: branchId ? historyByBranchId[branchId] : undefined,
      humanReviewContext: branchId ? humanReviewContextByBranchId[branchId] : undefined
    })
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

async function readLogRecordsFromPath(sourcePath: string, args?: {
  roleId?: string;
  since?: string;
  maxRecords?: number;
  include?: (record: Record<string, unknown>) => boolean;
}): Promise<Array<Record<string, unknown>>> {
  const records: Array<Record<string, unknown>> = [];
  const maxRecords = args?.maxRecords;
  const sinceTimestamp = args?.since ? normalizeIsoTimestamp(args.since) : undefined;
  const lines = createInterface({
    input: createReadStream(sourcePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    if (args?.roleId && record.roleId !== args.roleId) continue;
    if (sinceTimestamp !== undefined) {
      const at = typeof record.at === "string" ? normalizeIsoTimestamp(record.at) : undefined;
      if (at === undefined || at < sinceTimestamp) continue;
    }
    if (args?.include && !args.include(record)) continue;
    if (maxRecords === undefined) {
      records.push(record);
    } else {
      records.push(record);
      if (records.length > maxRecords) records.shift();
    }
  }
  return records;
}

async function loadFallbackEventLogs(args: {
  runDir: string;
  roleId?: string;
  maxRecords?: number;
}): Promise<Array<Record<string, unknown>>> {
  const records = await readLogRecordsFromPath(resolve(args.runDir, "events.ndjson"), {
    include: args.roleId
      ? (record) => record.type === "audit" && record.roleId === args.roleId
      : (record) => record.type !== "audit",
    maxRecords: args.maxRecords
  });
  return records;
}

export async function requestStop(workdir: string, runId: string, reason?: string): Promise<Record<string, unknown>> {
  const runDir = resolveRunDir(workdir, runId);
  const runStat = await stat(runDir).catch(() => undefined);
  if (!runStat?.isDirectory()) {
    throw new Error(`Run not found: ${runId}`);
  }
  const request = await filesystemRunStore.requestStop({
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
  maxRecords?: number;
}): Promise<Array<Record<string, unknown>>> {
  const runDir = resolveRunDir(args.workdir, args.runId);
  const runStat = await stat(runDir).catch(() => undefined);
  if (!runStat?.isDirectory()) {
    throw new Error(`Run not found: ${args.runId}`);
  }
  if (args.roleId && args.engine) {
    throw new Error("Choose either --engine or --role");
  }
  if (args.since && normalizeIsoTimestamp(args.since) === undefined) {
    throw new Error(`Invalid --since timestamp: ${args.since}`);
  }

  const sourcePath = args.roleId
    ? resolve(runDir, "logs", "roles", `${args.roleId}.ndjson`)
    : resolve(runDir, "logs", "engine.ndjson");
  const maxRecords = args.maxRecords === undefined
    ? undefined
    : Math.min(1000, Math.max(1, Math.floor(args.maxRecords)));
  try {
    return filterLogRecords(await readLogRecordsFromPath(sourcePath, {
      roleId: args.roleId,
      since: args.since,
      maxRecords
    }), args);
  } catch {
    try {
      return filterLogRecords(
        await loadFallbackEventLogs({
          runDir,
          roleId: args.roleId,
          maxRecords
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
  targetDir?: string;
}): Promise<string> {
  const projectDir = resolve(args.parentDir, args.name);
  await mkdir(projectDir, { recursive: true });
  await ensureProjectSkeleton({
    workdir: projectDir,
    projectName: args.name,
    targetDir: args.targetDir ? resolve(projectDir, args.targetDir) : undefined
  });
  const template = await scaffoldProjectTemplate({
    workdir: projectDir,
    templateId: args.templateId
  });
  await syncProjectModels({
    workdir: projectDir,
    systemPath: "system.mmd",
    strategy: template.modelSeedStrategy
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
