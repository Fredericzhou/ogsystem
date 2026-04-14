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
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { readJsonFile, writeJsonFileAtomic } from "./json-file.js";
import { requestRunStop } from "./run-artifacts.js";
import { stringifyJson } from "./runtime-support.js";

export const OGS_DIR = ".ogs";
export const OGS_RUNS_DIR = ".ogs/runs";
export const OGS_RUNS_INDEX_FILE = ".ogs/runs-index.json";
const OGS_PROJECT_FILE = ".ogs/project.json";
const OGS_RUNTIME_FILE = ".ogs/runtime.json";
const OGS_PROVIDER_OPENCODE_FILE = ".ogs/providers/opencode.json";

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
      "analyst -->|ANALYSIS_DONE| output",
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
      "intake -->|BRANCH_A| brancha[Role:test-branch-a]",
      "intake -->|BRANCH_B| branchb[Role:test-branch-b]",
      "brancha -->|A_DONE| testop[Role:test-operator]",
      "branchb -->|B_DONE| testop[Role:test-operator]",
      "testop -->|RESULT_READY| output",
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
      "intake -->|INTAKE_DONE| dispatch[Role:diagnosis-dispatch]",
      "dispatch -->|DISPATCH_DONE| chief[Role:diagnosis-chief-review]",
      "chief -->|REPORT_READY| output",
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
    roleRepo: "./og-roles",
    modelRepo: "./og-models",
    runsDir: OGS_RUNS_DIR,
    workspace: {
      rolesDir: "roles",
      privateDirName: "private"
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

async function ensureFile(path: string, value: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    await writeFile(path, value, "utf8");
  }
}

export function resolveOgsPaths(workdir: string): {
  ogsDir: string;
  runsDir: string;
  runsIndexPath: string;
  projectPath: string;
  runtimePath: string;
  providerPath: string;
} {
  return {
    ogsDir: resolve(workdir, OGS_DIR),
    runsDir: resolve(workdir, OGS_RUNS_DIR),
    runsIndexPath: resolve(workdir, OGS_RUNS_INDEX_FILE),
    projectPath: resolve(workdir, OGS_PROJECT_FILE),
    runtimePath: resolve(workdir, OGS_RUNTIME_FILE),
    providerPath: resolve(workdir, OGS_PROVIDER_OPENCODE_FILE)
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
    const stateRaw = await tryReadJson(resolve(runDir, "state.json"));
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
      status: state?.status ?? state?.graphState?.status ?? "unknown",
      transitionCount: state?.transitionCount ?? state?.graphState?.transitionCount ?? 0,
      finalRoleId: state?.finalRoleId ?? state?.graphState?.finalRoleId,
      updatedAt: runStat.mtime.toISOString(),
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
  const [state, metrics, resolvedConfig, stopRequest, stopOutcome] = await Promise.all([
    tryReadJson(resolve(runDir, "state.json")),
    tryReadJson(resolve(runDir, "metrics.json")),
    tryReadJson(resolve(runDir, "resolved-config.json")),
    tryReadJson(resolve(runDir, "control", "stop-request.json")),
    tryReadJson(resolve(runDir, "control", "stop-outcome.json"))
  ]);
  return {
    runId,
    runDir,
    state,
    metrics,
    resolvedConfig,
    stopRequest,
    stopOutcome
  };
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
    const content = await readFile(sourcePath, "utf8");
    return parseJsonLines(content);
  } catch {
    try {
      const content = await readFile(resolve(runDir, "events.ndjson"), "utf8");
      const records = parseJsonLines(content);
      if (args.roleId) {
        return records.filter((item) => item.type === "audit" && item.roleId === args.roleId);
      }
      return records.filter((item) => item.type !== "audit");
    } catch {
      return [];
    }
  }
}

export async function createProjectFromTemplate(args: {
  parentDir: string;
  name: string;
  templateId: ProjectTemplateId;
}): Promise<string> {
  const template = PROJECT_TEMPLATES[args.templateId];
  if (!template) {
    throw new Error(`Unsupported template: ${args.templateId}`);
  }

  const projectDir = resolve(args.parentDir, args.name);
  await mkdir(projectDir, { recursive: true });
  await ensureProjectSkeleton({
    workdir: projectDir,
    projectName: args.name
  });
  await writeFile(resolve(projectDir, "system.mmd"), `${template.systemMmd}\n`, "utf8");
  await writeFile(resolve(projectDir, ".ogs", "laws.json"), `${template.lawsJson}\n`, "utf8");
  await writeFile(
    resolve(projectDir, ".ogs", "user-profile.json"),
    `${stringifyJson({
      userProfileId: "default.zh.concise",
      language: "zh-CN",
      style: "concise",
      riskPreference: "medium",
      outputLength: "short"
    })}\n`,
    "utf8"
  );
  await rebuildRunsIndex(projectDir);
  return projectDir;
}
