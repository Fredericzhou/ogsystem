/**
 * @fileoverview OGSystem CLI entrypoint and command dispatch.
 * File Set: runtime-adapter
 * Responsibilities:
 * - Parse lifecycle arguments.
 * - Dispatch project/run commands and normalize CLI errors.
 * Boundaries:
 * - Delegates runtime execution and persistence to lower-level modules.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { runSystemWithAdapter } from "./adapter.js";
import {
  OGS_RUNS_DIR,
  createProjectFromTemplate,
  ensureProjectSkeleton,
  isProjectTemplateId,
  inspectHumanReview,
  scaffoldProjectTemplate,
  syncProjectDependencies,
  syncProjectModels,
  inspectRun,
  listHumanReviews,
  loadIndexedRuns,
  loadRunLogs,
  rebuildRunsIndex,
  requestStop,
  resolveRunDir,
  writeHumanReviewDecision
} from "./project-lifecycle.js";
import { streamRunLogs } from "./project-lifecycle.js";
import {
  RuntimeError,
  createRuntimeError,
  formatRuntimeErrorEnvelope,
  normalizeRuntimeError
} from "./runtime-errors.js";
import { runDoctorCli, usage as doctorUsage } from "./doctor.js";
import { runLintCli, usage as lintUsage } from "./lint.js";
import type { RunSummaryProjection } from "./run-summary-schema.js";
import { startVisualizationServer } from "../visualizer/server.js";
import { runNl2MmdCli, usage as nl2mmdUsage } from "../nl2mmd/cli.js";
import { ensureSystemHome, loadSystemEnvironment } from "./system-home.js";

await ensureSystemHome();
await loadSystemEnvironment();

const require = createRequire(import.meta.url);
const { version: CLI_VERSION } = require("../../package.json") as { version: string };

type HelpTopic = "doctor" | "lint" | "nl2mmd" | "project" | "run" | "vis" | "visualizer";
type ProjectSubcommand = "init" | "create" | "sync" | "sync-models";
type RunSubcommand = "start" | "resume" | "stop" | "list" | "status" | "inspect" | "logs" | "review";

function isVisualizerTopic(value: string | undefined): value is "vis" | "visualizer" {
  return value === "vis" || value === "visualizer";
}

function usageRoot(): string {
  return [
    "Usage:",
    "  ogs <command> [options]",
    "  ogs help <command> [subcommand]",
    "  ogs --version",
    "",
    "Commands:",
    "  doctor   Check environment, providers, and required tools",
    "  lint     Statically validate a Mermaid system file",
    "  nl2mmd   Generate Mermaid from natural language",
    "  project  Init, create, or sync project files",
    "  run      Start, inspect, review, or control runs",
    "  vis      Start the read-mostly visualizer",
    "",
    "Drill down:",
    "  ogs project <init|create|sync|sync-models>",
    "  ogs help run logs",
    "  ogs project create --help",
    "  ogs run start --help",
    "  ogs vis --help",
    "  ogs vis --workdir .",
    "",
    "Defaults:",
    "  commands use the current directory unless --workdir overrides it",
  ].join("\n");
}

function usageProject(subcommand?: ProjectSubcommand): string {
  if (subcommand === "init") {
    return [
      "Usage:",
      "  ogs project init [--template <empty|minimal|advanced-features|software-dev|consultation>] [--workdir <path>] [--target-dir <path>]",
      "",
      "Options:",
      "  --template <id>  Template to scaffold (default: minimal)",
      "  --workdir <path> Project root to initialize (default: cwd)",
      "  --target-dir <path> OpenCode coding project (default: workdir)",
      "  --help           Show help",
      "",
      "Examples:",
      "  ogs project init",
      "  ogs project init --template advanced-features",
      "  ogs project init --workdir ./demo-app"
    ].join("\n");
  }

  if (subcommand === "create") {
    return [
      "Usage:",
      "  ogs project create <name> [--template <empty|minimal|advanced-features|software-dev|consultation>] [--workdir <path>] [--target-dir <path>]",
      "",
      "Arguments:",
      "  <name>           New project directory name",
      "",
      "Options:",
      "  --template <id>  Template to scaffold (default: minimal)",
      "  --workdir <path> Parent directory for the new project (default: cwd)",
      "  --target-dir <path> OpenCode coding project (default: new project)",
      "  --help           Show help",
      "",
      "Examples:",
      "  ogs project create demo-app",
      "  ogs project create demo-app --template advanced-features",
      "  ogs project create demo-app --workdir ./sandbox"
    ].join("\n");
  }

  if (subcommand === "sync") {
    return [
      "Usage:",
      "  ogs project sync --system <file.mmd> [--workdir <path>]",
      "",
      "Options:",
      "  --system <file>  Mermaid system source to scan for role dependencies",
      "  --workdir <path> Project root (default: cwd)",
      "  --help           Show help",
      "",
      "Example:",
      "  ogs project sync --system system.mmd"
    ].join("\n");
  }

  if (subcommand === "sync-models") {
    return [
      "Usage:",
      "  ogs project sync-models [--workdir <path>]",
      "",
      "Options:",
      "  --workdir <path> Project root (default: cwd)",
      "  --help           Show help",
      "",
      "Behavior:",
      "  Refreshes .ogs/model-catalog.json and seeds .ogs/model-selection.json when missing.",
      "",
      "Example:",
      "  ogs project sync-models"
    ].join("\n");
  }

  return [
    "Usage:",
    "  ogs project init [options]",
    "  ogs project create <name> [options]",
    "  ogs project sync --system <file.mmd> [options]",
    "  ogs project sync-models [options]",
    "",
    "Project lifecycle:",
    "  init   scaffold the current directory as a runnable project",
    "  create scaffold a new project directory from a template",
    "  sync   import roles referenced by a Mermaid system into the local project role repo",
    "  sync-models   refresh .ogs/model-catalog.json and seed .ogs/model-selection.json when missing",
    "",
    "Drill down:",
    "  ogs project init --help",
    "  ogs project create --help",
    "  ogs project sync --help",
    "  ogs project sync-models --help"
  ].join("\n");
}

function usageRun(subcommand?: RunSubcommand): string {
  if (subcommand === "start") {
    return [
      "Usage:",
      "  ogs run start --system <file.mmd> --input <text> [options]",
      "",
      "Required:",
      "  --system <file>        Mermaid system source to execute",
      "  --input <text>         Initial user input",
      "",
      "Options:",
      "  --runtime <file>       Runtime config JSON override",
      "  --user-profile <file>  User profile JSON override",
      "  --laws <file>          Law catalog JSON override",
      "  --workdir <path>       Working directory (default: cwd)",
      "  --target-dir <path>    OpenCode coding project (default: workdir)",
      "  --cleanup-executions <n>",
      "                         Keep only latest n per-role execution snapshots",
      "  --quiet-run            Disable stderr run progress logs",
      "  --visualize            Start a temporary visualizer server for this run",
      "  --host <host>          Visualizer bind host when --visualize is enabled (default: 127.0.0.1)",
      "  --port <n|0>           Visualizer bind port when --visualize is enabled (default: 0 auto)",
      "  --print-graph-link     Print Mermaid Live graph preview URL to stderr",
      "  --trace-out <file>     Write final runtime result JSON",
      "  --dry-run              Do not execute external commands",
      "  --help                 Show help",
      "",
      "Examples:",
      "  ogs run start --system system.mmd --input \"smoke\" --dry-run",
      "  ogs run start --system system.mmd --input \"demo\" --visualize --port 0"
    ].join("\n");
  }

  if (subcommand === "resume") {
    return [
      "Usage:",
      "  ogs run resume <run-id> [options]",
      "",
      "Arguments:",
      "  <run-id>               Existing run identifier",
      "",
      "Options:",
      "  --system <file>        Override system source (default: run snapshot system.mmd)",
      "  --input <text>         Override request text (default: stored request.md)",
      "  --runtime <file>       Runtime config JSON override",
      "  --user-profile <file>  User profile JSON override",
      "  --laws <file>          Law catalog JSON override",
      "  --workdir <path>       Working directory (default: cwd)",
      "  --target-dir <path>    OpenCode coding project (default: saved run target)",
      "  --cleanup-executions <n>",
      "                         Keep only latest n per-role execution snapshots",
      "  --quiet-run            Disable stderr run progress logs",
      "  --visualize            Start a temporary visualizer server for this run",
      "  --host <host>          Visualizer bind host when --visualize is enabled (default: 127.0.0.1)",
      "  --port <n|0>           Visualizer bind port when --visualize is enabled (default: 0 auto)",
      "  --trace-out <file>     Write final runtime result JSON",
      "  --dry-run              Do not execute external commands",
      "  --help                 Show help",
      "",
      "Example:",
      "  ogs run resume <run-id> --dry-run"
    ].join("\n");
  }

  if (subcommand === "stop") {
    return [
      "Usage:",
      "  ogs run stop <run-id> [--reason <text>] [--workdir <path>]",
      "",
      "Arguments:",
      "  <run-id>        Existing run identifier",
      "",
      "Options:",
      "  --reason <text> Optional stop reason stored in control metadata",
      "  --workdir <path> Working directory (default: cwd)",
      "  --help          Show help"
    ].join("\n");
  }

  if (subcommand === "list") {
    return [
      "Usage:",
      "  ogs run list [--reindex] [--workdir <path>]",
      "",
      "Options:",
      "  --reindex       Rebuild .ogs/runs-index.json before listing",
      "  --workdir <path> Working directory (default: cwd)",
      "  --help          Show help"
    ].join("\n");
  }

  if (subcommand === "status") {
    return [
      "Usage:",
      "  ogs run status <run-id> [--workdir <path>]",
      "",
      "Arguments:",
      "  <run-id>        Existing run identifier",
      "",
      "Options:",
      "  --workdir <path> Working directory (default: cwd)",
      "  --help          Show help"
    ].join("\n");
  }

  if (subcommand === "inspect") {
    return [
      "Usage:",
      "  ogs run inspect <run-id> [--workdir <path>]",
      "",
      "Arguments:",
      "  <run-id>        Existing run identifier",
      "",
      "Options:",
      "  --workdir <path> Working directory (default: cwd)",
      "  --help          Show help"
    ].join("\n");
  }

  if (subcommand === "logs") {
    return [
      "Usage:",
      "  ogs run logs <run-id> [--engine|--role <roleId>] [--tail <n>] [--since <iso>] [--follow] [--json|--ndjson] [--workdir <path>]",
      "",
      "Arguments:",
      "  <run-id>        Existing run identifier",
      "",
      "Options:",
      "  --engine        Read engine logs (default when no role is selected)",
      "  --role <roleId> Read logs for one role",
      "  --tail <n>      Return only the latest n log records",
      "  --since <iso>   Return only records at or after the given ISO timestamp",
      "  --follow        Stream appended records until the run completes",
      "  --json          Emit one JSON array (not allowed with --follow)",
      "  --ndjson        Emit one JSON object per line",
      "  --workdir <path> Working directory (default: cwd)",
      "  --help          Show help",
      "",
      "Output modes:",
      "  default text    human-readable one-line summaries",
      "  --json          pretty JSON array for batch tooling",
      "  --ndjson        newline-delimited JSON for pipelines and follow mode",
      "",
      "Examples:",
      "  ogs run logs <run-id> --engine",
      "  ogs run logs <run-id> --engine --json",
      "  ogs run logs <run-id> --engine --follow --ndjson"
    ].join("\n");
  }

  if (subcommand === "review") {
    return [
      "Usage:",
      "  ogs run review list <run-id> [--workdir <path>]",
      "  ogs run review inspect <run-id> <review-id> [--workdir <path>]",
      "  ogs run review decide <run-id> <review-id> --decision <approve|rework|pause|terminate> [--comment <text>] [--actor <name>] [--scope <branch|run>] [--workdir <path>]",
      "",
      "Examples:",
      "  ogs run review list <run-id>",
      "  ogs run review inspect <run-id> <review-id>",
      "  ogs run review decide <run-id> <review-id> --decision approve",
      "  ogs run review decide <run-id> <review-id> --decision rework --comment \"missing evidence\""
    ].join("\n");
  }

  return [
    "Usage:",
    "  ogs run start --system <file.mmd> --input <text> [options]",
    "  ogs run resume <run-id> [options]",
    "  ogs run stop <run-id> [options]",
    "  ogs run list [options]",
    "  ogs run status <run-id> [options]",
    "  ogs run inspect <run-id> [options]",
    "  ogs run logs <run-id> [options]",
    "  ogs run review <list|inspect|decide> ...",
    "",
    "Drill down:",
    "  ogs run start --help",
    "  ogs run resume --help",
    "  ogs run logs --help",
    "  ogs run review --help"
  ].join("\n");
}

function usageVisualizer(): string {
  return [
    "Usage:",
    "  ogs vis [--workdir <path>] [--host <host>] [--port <n|0>]",
    "",
    "What it does:",
    "  Starts the lightweight read-mostly OGSystem visualizer.",
    "  Reads stay projection-first; writes are limited to lifecycle-backed review, stop, and reindex actions.",
    "  The process stays alive until you stop it.",
    "",
    "Defaults:",
    "  workdir: current directory",
    "  host: 127.0.0.1",
    "  port: 3337",
    "",
    "Examples:",
    "  ogs vis --workdir .",
    "  ogs vis --workdir . --port 3338",
    "  ogs run start --system system.mmd --input \"demo\" --visualize"
  ].join("\n");
}

function usage(topic?: HelpTopic, subcommand?: ProjectSubcommand | RunSubcommand): string {
  if (topic === "doctor") {
    return doctorUsage();
  }
  if (topic === "lint") {
    return lintUsage();
  }
  if (topic === "nl2mmd") {
    return nl2mmdUsage();
  }
  if (topic === "project") {
    return usageProject(subcommand as ProjectSubcommand | undefined);
  }
  if (topic === "run") {
    return usageRun(subcommand as RunSubcommand | undefined);
  }
  if (topic === "vis" || topic === "visualizer") {
    return usageVisualizer();
  }
  return usageRoot();
}

function createCliInputError(errorCode: string, message: string): RuntimeError {
  return createRuntimeError({
    errorCode,
    errorCategory: "input",
    message,
    retryable: false,
    stage: "cli"
  });
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildMermaidLiveEditUrl(source: string): string {
  const payload = JSON.stringify({
    code: source,
    mermaid: { theme: "default" }
  });
  return `https://mermaid.live/edit#base64:${toBase64Url(payload)}`;
}

async function resolveRunsDir(args: {
  runtimeConfigPath?: string;
  workdir: string;
}): Promise<string> {
  const runtimePath = resolve(args.workdir, args.runtimeConfigPath ?? ".ogs/runtime.json");
  try {
    const runtimeRaw = JSON.parse(await readFile(runtimePath, "utf8"));
    if (
      typeof runtimeRaw === "object" &&
      runtimeRaw !== null &&
      typeof (runtimeRaw as { runsDir?: unknown }).runsDir === "string" &&
      (runtimeRaw as { runsDir: string }).runsDir.trim()
    ) {
      return (runtimeRaw as { runsDir: string }).runsDir;
    }
  } catch {
    // Fallback to canonical runs root.
  }
  return OGS_RUNS_DIR;
}

type CliValueMap = Record<string, string | boolean | undefined>;

function appendModernResumeOptions(args: {
  tokens: string[];
  values: CliValueMap;
  includeSystemAndInput: boolean;
}): void {
  if (args.includeSystemAndInput && typeof args.values.system === "string") {
    args.tokens.push(`--system ${shellEscape(args.values.system)}`);
  }
  if (args.includeSystemAndInput && typeof args.values.input === "string") {
    args.tokens.push(`--input ${shellEscape(args.values.input)}`);
  }
  if (typeof args.values.runtime === "string") {
    args.tokens.push(`--runtime ${shellEscape(args.values.runtime)}`);
  }
  if (typeof args.values["user-profile"] === "string") {
    args.tokens.push(`--user-profile ${shellEscape(args.values["user-profile"])}`);
  }
  if (typeof args.values.laws === "string") {
    args.tokens.push(`--laws ${shellEscape(args.values.laws)}`);
  }
  if (typeof args.values["target-dir"] === "string") {
    args.tokens.push(`--target-dir ${shellEscape(args.values["target-dir"])}`);
  }
  if (typeof args.values["cleanup-executions"] === "string") {
    args.tokens.push(`--cleanup-executions ${shellEscape(args.values["cleanup-executions"])}`);
  }
  if (args.values["quiet-run"] === true) {
    args.tokens.push("--quiet-run");
  }
  if (args.values["dry-run"] === true) {
    args.tokens.push("--dry-run");
  }
  if (args.values.visualize === true) {
    args.tokens.push("--visualize");
  }
  if (typeof args.values.host === "string") {
    args.tokens.push(`--host ${shellEscape(args.values.host)}`);
  }
  if (typeof args.values.port === "string") {
    args.tokens.push(`--port ${shellEscape(args.values.port)}`);
  }
  if (typeof args.values["trace-out"] === "string") {
    args.tokens.push(`--trace-out ${shellEscape(args.values["trace-out"])}`);
  }
}

async function printModernResumeHint(args: {
  error: RuntimeError;
  values: CliValueMap;
  workdir: string;
  includeSystemAndInput: boolean;
}): Promise<void> {
  const runId = args.error.envelope.runId;
  if (!runId) {
    return;
  }

  const tokens: string[] = [
    "ogs",
    "run",
    "resume",
    shellEscape(runId),
    `--workdir ${shellEscape(args.workdir)}`
  ];
  appendModernResumeOptions({
    tokens,
    values: args.values,
    includeSystemAndInput: args.includeSystemAndInput
  });

  console.error(`[hint] run failed for runId=${runId}`);
  console.error("[hint] To resume this run, use:");
  console.error(`[hint] ${tokens.join(" ")}`);
}

async function maybePrintGraphLink(args: {
  enabled: boolean;
  systemPath: string;
}): Promise<void> {
  if (!args.enabled) {
    return;
  }
  try {
    const source = await readFile(args.systemPath, "utf8");
    const url = buildMermaidLiveEditUrl(source);
    console.error("[graph] System graph initialized.");
    console.error(`[graph] Visual preview: ${url}`);
  } catch (error) {
    console.error(
      `[graph] preview unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

type LifecycleOptionSpec = {
  type: "string" | "boolean";
  short?: string;
};

function parseLifecycleArgs(args: string[], options: Record<string, LifecycleOptionSpec>) {
  try {
    return parseArgs({
      args,
      options,
      allowPositionals: true
    });
  } catch (error) {
    throw createCliInputError(
      "CLI_INVALID_ARGS",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function resolveCliSystemPath(workdir: string, systemPath: string): string {
  return resolve(workdir, systemPath);
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBool(value: string | boolean | undefined): boolean {
  return value === true;
}

function parsePositiveIntegerOption(args: {
  optionName: string;
  value: string | undefined;
}): number | undefined {
  if (args.value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(args.value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createCliInputError(
      "CLI_INVALID_ARGS",
      `${args.optionName} must be a positive integer`
    );
  }
  return parsed;
}

function parsePortOption(args: {
  optionName: string;
  value: string | undefined;
  defaultValue: number;
  allowZero?: boolean;
}): number {
  if (args.value === undefined) {
    return args.defaultValue;
  }
  const parsed = Number.parseInt(args.value, 10);
  const minimum = args.allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > 65535) {
    throw createCliInputError(
      "CLI_INVALID_ARGS",
      `${args.optionName} must be an integer between ${minimum} and 65535`
    );
  }
  return parsed;
}

function parseCleanupExecutionValue(value: string | undefined): number | undefined {
  const cleanupExecutionHistory =
    value === undefined ? undefined : Number.parseInt(value, 10);
  if (
    cleanupExecutionHistory !== undefined &&
    (!Number.isInteger(cleanupExecutionHistory) || cleanupExecutionHistory <= 0)
  ) {
    throw createCliInputError(
      "CLI_INVALID_CLEANUP_EXECUTIONS",
      "--cleanup-executions must be a positive integer"
    );
  }
  return cleanupExecutionHistory;
}

function resolveLogRunOption(values: Record<string, string | boolean | undefined>): boolean {
  const quietRun = asBool(values["quiet-run"]);
  const logRun = asBool(values["log-run"]);
  if (quietRun && logRun) {
    throw createCliInputError(
      "CLI_INVALID_ARGS",
      "--log-run and --quiet-run cannot be used together"
    );
  }
  return !quietRun;
}

function resolveLogOutputMode(values: Record<string, string | boolean | undefined>): "text" | "json" | "ndjson" {
  const json = asBool(values.json);
  const ndjson = asBool(values.ndjson);
  const follow = asBool(values.follow);
  if (json && ndjson) {
    throw createCliInputError("CLI_INVALID_ARGS", "--json and --ndjson cannot be used together");
  }
  if (json && follow) {
    throw createCliInputError("CLI_INVALID_ARGS", "--json cannot be used with --follow; use --ndjson");
  }
  if (json) {
    return "json";
  }
  if (ndjson) {
    return "ndjson";
  }
  return "text";
}

function formatLogRecord(record: Record<string, unknown>): string {
  const at = typeof record.at === "string" ? record.at : undefined;
  const roleId = typeof record.roleId === "string" ? record.roleId : undefined;
  const type =
    typeof record.type === "string"
      ? record.type
      : typeof record.event === "string"
        ? record.event
        : "record";
  const summary =
    typeof record.message === "string"
      ? record.message
      : typeof record.detail === "string"
        ? record.detail
        : typeof record.content === "string"
          ? record.content
          : typeof record.status === "string"
            ? `status=${record.status}`
            : undefined;
  const prefix = [at, roleId ? `[${roleId}]` : undefined, type].filter(Boolean).join(" ");
  if (summary) {
    return `${prefix} ${summary}`;
  }
  return `${prefix} ${JSON.stringify(record)}`;
}

async function closeServer(server: { close(callback: () => void): void }): Promise<void> {
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
}

async function runAdapterCommand(args: {
  systemPath: string;
  prompt: string;
  runtimeConfigPath?: string;
  userProfilePath?: string;
  resumeRunDir?: string;
  lawsPath?: string;
  workdir: string;
  targetDir?: string;
  dryRun: boolean;
  cleanupExecutionHistory?: number;
  logRun: boolean;
  traceOut?: string;
  visualizer?: {
    enabled: boolean;
    host: string;
    port: number;
    autoClose: boolean;
  };
}): Promise<void> {
  let visualizer = null;
  if (args.visualizer?.enabled) {
    try {
      visualizer = await startVisualizationServer({
        workdir: args.workdir,
        host: args.visualizer.host,
        port: args.visualizer.port
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[visualizer] Unable to attach server; continuing without visualization. ${message}`);
    }
  }
  if (visualizer) {
    console.error(`[visualizer] Listening on ${visualizer.url}`);
    if (args.visualizer?.autoClose) {
      console.error("[visualizer] Attached to current run; server will close on exit.");
    }
  }

  try {
    await ensureProjectSkeleton({ workdir: args.workdir });
    const result = await runSystemWithAdapter({
      systemPath: args.systemPath,
      runtimeConfigPath: args.runtimeConfigPath,
      userProfilePath: args.userProfilePath,
      resumeRunDir: args.resumeRunDir,
      lawsPath: args.lawsPath,
      prompt: args.prompt,
      workdir: args.workdir,
      targetDir: args.targetDir,
      dryRun: args.dryRun,
      cleanupExecutionHistory: args.cleanupExecutionHistory,
      logRun: args.logRun
    });
    await rebuildRunsIndex(args.workdir);

    const output = JSON.stringify(result, null, 2);
    console.log(output);
    if (args.traceOut) {
      await writeFile(args.traceOut, output, "utf8");
    }
  } finally {
    if (visualizer && args.visualizer?.autoClose) {
      await closeServer(visualizer.server);
      console.error("[visualizer] Closed attached server.");
    }
  }
}

async function runProjectCommand(argv: string[]): Promise<void> {
  const subcommand = argv[0];
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    console.log(usage("project"));
    return;
  }

  if (subcommand === "init") {
    const { values } = parseLifecycleArgs(argv.slice(1), {
      template: { type: "string" },
      workdir: { type: "string" },
      "target-dir": { type: "string" },
      help: { type: "boolean", short: "h" }
    });
    if (asBool(values.help)) {
      console.log(usage("project", "init"));
      return;
    }
    const workdir = asString(values.workdir) ?? process.cwd();
    const template = asString(values.template) ?? "minimal";
    if (!isProjectTemplateId(template)) {
      throw createCliInputError(
        "CLI_PROJECT_INIT_INVALID_TEMPLATE",
        "--template must be one of: empty, minimal, advanced-features, software-dev, consultation"
      );
    }
    await ensureProjectSkeleton({
      workdir,
      targetDir: asString(values["target-dir"])
        ? resolve(workdir, asString(values["target-dir"]) as string)
        : undefined
    });
    const templateSpec = await scaffoldProjectTemplate({
      workdir,
      templateId: template
    });
    const modelSyncResult = await syncProjectModels({
      workdir,
      systemPath: "system.mmd",
      strategy: templateSpec.modelSeedStrategy
    });
    const syncResult = templateSpec.syncDependencies
      ? await syncProjectDependencies({
          workdir,
          systemPath: "system.mmd"
        })
      : {
          roleIds: [],
          modelIds: [],
          importedRoleIds: [],
          importedModelIds: []
        };
    const index = await rebuildRunsIndex(workdir);
    console.log(
      JSON.stringify(
        {
          status: "ok",
          command: "project init",
          template,
          workdir,
          runCount: index.runs.length,
          modelCatalogPath: modelSyncResult.catalogPath,
          modelSelectionPath: modelSyncResult.selectionPath,
          selectedModel: modelSyncResult.selectedModel,
          importedRoleIds: syncResult.importedRoleIds,
          importedModelIds: syncResult.importedModelIds
        },
        null,
        2
      )
    );
    return;
  }

  if (subcommand === "create") {
    const { values, positionals } = parseLifecycleArgs(argv.slice(1), {
      template: { type: "string" },
      workdir: { type: "string" },
      "target-dir": { type: "string" },
      help: { type: "boolean", short: "h" }
    });
    if (asBool(values.help)) {
      console.log(usage("project", "create"));
      return;
    }
    const projectName = positionals[0];
    if (!projectName) {
      throw createCliInputError("CLI_PROJECT_CREATE_MISSING_NAME", "Missing project name");
    }
    const template = asString(values.template) ?? "minimal";
    if (!isProjectTemplateId(template)) {
      throw createCliInputError(
        "CLI_PROJECT_CREATE_INVALID_TEMPLATE",
        "--template must be one of: empty, minimal, advanced-features, software-dev, consultation"
      );
    }
    const parentDir = asString(values.workdir) ?? process.cwd();
    const projectDir = await createProjectFromTemplate({
      parentDir,
      name: projectName,
      templateId: template,
      targetDir: asString(values["target-dir"])
    });
    console.log(
      JSON.stringify(
        {
          status: "ok",
          command: "project create",
          template,
          projectDir
        },
        null,
        2
      )
    );
    return;
  }

  if (subcommand === "sync") {
    const { values } = parseLifecycleArgs(argv.slice(1), {
      system: { type: "string" },
      workdir: { type: "string" },
      help: { type: "boolean", short: "h" }
    });
    if (asBool(values.help)) {
      console.log(usage("project", "sync"));
      return;
    }
    const systemPath = asString(values.system);
    if (!systemPath) {
      throw createCliInputError("CLI_PROJECT_SYNC_MISSING_SYSTEM", "project sync requires --system");
    }
    const workdir = asString(values.workdir) ?? process.cwd();
    const syncResult = await syncProjectDependencies({
      workdir,
      systemPath
    });
    console.log(
      JSON.stringify(
        {
          status: "ok",
          command: "project sync",
          workdir,
          systemPath,
          roleIds: syncResult.roleIds,
          modelIds: syncResult.modelIds,
          importedRoleIds: syncResult.importedRoleIds,
          importedModelIds: syncResult.importedModelIds
        },
        null,
        2
      )
    );
    return;
  }

  if (subcommand === "sync-models") {
    const { values } = parseLifecycleArgs(argv.slice(1), {
      workdir: { type: "string" },
      help: { type: "boolean", short: "h" }
    });
    if (asBool(values.help)) {
      console.log(usage("project", "sync-models"));
      return;
    }
    const workdir = asString(values.workdir) ?? process.cwd();
    const syncResult = await syncProjectModels({
      workdir
    });
    console.log(
      JSON.stringify(
        {
          status: "ok",
          command: "project sync-models",
          workdir,
          catalogPath: syncResult.catalogPath,
          selectionPath: syncResult.selectionPath,
          generatedSelection: syncResult.generatedSelection,
          selectedModel: syncResult.selectedModel
        },
        null,
        2
      )
    );
    return;
  }

  throw createCliInputError(
    "CLI_UNKNOWN_SUBCOMMAND",
    `Unknown project subcommand: ${subcommand}\n\n${usage("project")}`
  );
}

async function runStartCommand(argv: string[]): Promise<void> {
  const { values } = parseLifecycleArgs(argv, {
    system: { type: "string" },
    runtime: { type: "string" },
    "user-profile": { type: "string" },
    laws: { type: "string" },
    input: { type: "string" },
    workdir: { type: "string" },
    "target-dir": { type: "string" },
    "cleanup-executions": { type: "string" },
    "quiet-run": { type: "boolean" },
    visualize: { type: "boolean" },
    host: { type: "string" },
    port: { type: "string" },
    "print-graph-link": { type: "boolean" },
    "trace-out": { type: "string" },
    "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" }
  });
  if (asBool(values.help)) {
    console.log(usage("run", "start"));
    return;
  }
  const systemPath = asString(values.system);
  const prompt = asString(values.input);
  if (!systemPath || !prompt) {
    throw createCliInputError(
      "CLI_MISSING_REQUIRED_ARGS",
      "run start requires --system and --input"
    );
  }

  const workdir = asString(values.workdir) ?? process.cwd();
  const resolvedSystemPath = resolveCliSystemPath(workdir, systemPath);
  await maybePrintGraphLink({
    enabled: asBool(values["print-graph-link"]),
    systemPath: resolvedSystemPath
  });

  try {
    await runAdapterCommand({
      systemPath: resolvedSystemPath,
      prompt,
      runtimeConfigPath: asString(values.runtime),
      userProfilePath: asString(values["user-profile"]),
      lawsPath: asString(values.laws),
      workdir,
      targetDir: asString(values["target-dir"]),
      dryRun: asBool(values["dry-run"]),
      cleanupExecutionHistory: parseCleanupExecutionValue(asString(values["cleanup-executions"])),
      logRun: resolveLogRunOption(values),
      traceOut: asString(values["trace-out"]),
      visualizer: {
        enabled: asBool(values.visualize),
        host: asString(values.host) ?? "127.0.0.1",
        port: parsePortOption({
          optionName: "--port",
          value: asString(values.port),
          defaultValue: 0,
          allowZero: true
        }),
        autoClose: true
      }
    });
  } catch (error) {
    if (error instanceof RuntimeError) {
      await printModernResumeHint({
        error,
        values,
        workdir,
        includeSystemAndInput: false
      });
    }
    throw error;
  }
}

async function runResumeCommand(argv: string[]): Promise<void> {
  const { values, positionals } = parseLifecycleArgs(argv, {
    system: { type: "string" },
    runtime: { type: "string" },
    "user-profile": { type: "string" },
    laws: { type: "string" },
    input: { type: "string" },
    workdir: { type: "string" },
    "target-dir": { type: "string" },
    "cleanup-executions": { type: "string" },
    "quiet-run": { type: "boolean" },
    visualize: { type: "boolean" },
    host: { type: "string" },
    port: { type: "string" },
    "trace-out": { type: "string" },
    "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" }
  });
  if (asBool(values.help)) {
    console.log(usage("run", "resume"));
    return;
  }
  const runId = positionals[0];
  if (!runId) {
    throw createCliInputError("CLI_RUN_RESUME_MISSING_RUN_ID", "run resume requires <run-id>");
  }

  const workdir = asString(values.workdir) ?? process.cwd();
  const runDir = resolveRunDir(workdir, runId);
  const systemPath = asString(values.system) ?? resolve(runDir, "system.mmd");
  const resolvedSystemPath = resolveCliSystemPath(workdir, systemPath);
  const prompt =
    asString(values.input) ??
    (await readFile(resolve(runDir, "request.md"), "utf8")).replace(/\s+$/, "");

  try {
    await runAdapterCommand({
      systemPath: resolvedSystemPath,
      prompt,
      runtimeConfigPath: asString(values.runtime),
      userProfilePath: asString(values["user-profile"]),
      resumeRunDir: resolve(runDir),
      lawsPath: asString(values.laws),
      workdir,
      targetDir: asString(values["target-dir"]),
      dryRun: asBool(values["dry-run"]),
      cleanupExecutionHistory: parseCleanupExecutionValue(asString(values["cleanup-executions"])),
      logRun: resolveLogRunOption(values),
      traceOut: asString(values["trace-out"]),
      visualizer: {
        enabled: asBool(values.visualize),
        host: asString(values.host) ?? "127.0.0.1",
        port: parsePortOption({
          optionName: "--port",
          value: asString(values.port),
          defaultValue: 0,
          allowZero: true
        }),
        autoClose: true
      }
    });
  } catch (error) {
    if (error instanceof RuntimeError) {
      await printModernResumeHint({
        error,
        values,
        workdir,
        includeSystemAndInput: true
      });
    }
    throw error;
  }
}

async function runVisualizerCommand(argv: string[]): Promise<void> {
  const { values } = parseLifecycleArgs(argv, {
    workdir: { type: "string" },
    host: { type: "string" },
    port: { type: "string" },
    help: { type: "boolean", short: "h" }
  });
  if (asBool(values.help)) {
    console.log(usage("visualizer"));
    return;
  }

  const result = await startVisualizationServer({
    workdir: asString(values.workdir) ?? process.cwd(),
    host: asString(values.host) ?? "127.0.0.1",
    port: parsePortOption({
      optionName: "--port",
      value: asString(values.port),
      defaultValue: 3337,
      allowZero: true
    })
  });

  console.log(`OGSystem Visualizer listening on ${result.url}`);
}

async function runRunCommand(argv: string[]): Promise<void> {
  const subcommand = argv[0];
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    console.log(usage("run"));
    return;
  }

  if (subcommand === "start") {
    await runStartCommand(argv.slice(1));
    return;
  }
  if (subcommand === "resume") {
    await runResumeCommand(argv.slice(1));
    return;
  }
  if (subcommand === "stop") {
    const { values, positionals } = parseLifecycleArgs(argv.slice(1), {
      workdir: { type: "string" },
      reason: { type: "string" },
      help: { type: "boolean", short: "h" }
    });
    if (asBool(values.help)) {
      console.log(usage("run", "stop"));
      return;
    }
    const runId = positionals[0];
    if (!runId) {
      throw createCliInputError("CLI_RUN_STOP_MISSING_RUN_ID", "run stop requires <run-id>");
    }
    const workdir = asString(values.workdir) ?? process.cwd();
    const result = await requestStop(workdir, runId, asString(values.reason));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (subcommand === "list") {
    const { values } = parseLifecycleArgs(argv.slice(1), {
      workdir: { type: "string" },
      reindex: { type: "boolean" },
      help: { type: "boolean", short: "h" }
    });
    if (asBool(values.help)) {
      console.log(usage("run", "list"));
      return;
    }
    const workdir = asString(values.workdir) ?? process.cwd();
    const runs = asBool(values.reindex)
      ? (await rebuildRunsIndex(workdir)).runs
      : await loadIndexedRuns(workdir);
    console.log(JSON.stringify({ runs }, null, 2));
    return;
  }
  if (subcommand === "status") {
    const { values, positionals } = parseLifecycleArgs(argv.slice(1), {
      workdir: { type: "string" },
      help: { type: "boolean", short: "h" }
    });
    if (asBool(values.help)) {
      console.log(usage("run", "status"));
      return;
    }
    const runId = positionals[0];
    if (!runId) {
      throw createCliInputError("CLI_RUN_STATUS_MISSING_RUN_ID", "run status requires <run-id>");
    }
    const detail = await inspectRun(asString(values.workdir) ?? process.cwd(), runId);
    const summary =
      typeof detail.summary === "object" &&
      detail.summary !== null &&
      !Array.isArray(detail.summary)
        ? (detail.summary as RunSummaryProjection)
        : undefined;
    const state =
      typeof detail.state === "object" &&
      detail.state !== null &&
      !Array.isArray(detail.state)
        ? (detail.state as { status?: string; graphState?: { status?: string } })
        : undefined;
    console.log(
      JSON.stringify(
        {
          runId,
          runDir: detail.runDir,
          status: summary?.status ?? state?.status ?? state?.graphState?.status ?? "unknown",
          pendingReviewCount:
            typeof summary?.pendingReviewCount === "number"
              ? summary.pendingReviewCount
              : typeof detail.pendingReviewCount === "number"
                ? detail.pendingReviewCount
                : undefined,
          latestPendingReviewId:
            typeof summary?.latestPendingReviewId === "string"
              ? summary.latestPendingReviewId
              : typeof detail.latestPendingReviewId === "string"
                ? detail.latestPendingReviewId
                : undefined,
          hasWaitingHumanReview:
            typeof summary?.hasWaitingHumanReview === "boolean"
              ? summary.hasWaitingHumanReview
              : typeof detail.hasWaitingHumanReview === "boolean"
                ? detail.hasWaitingHumanReview
              : undefined,
          durationMs: summary?.durationMs ?? null,
          wallClockDurationMs: summary?.wallClockDurationMs ?? null,
          executionDurationMs: summary?.executionDurationMs ?? null,
          stopReason:
            typeof detail.stopReason === "string"
              ? detail.stopReason
              : summary?.stopReason ?? null,
          stopOutcomeStatus:
            typeof detail.stopOutcomeStatus === "string"
              ? detail.stopOutcomeStatus
              : summary?.stopOutcome ?? null,
          lastErrorCode: summary?.lastErrorCode ?? null,
          lastRoleId: summary?.lastRoleId ?? null,
          finalRoleId: summary?.finalRoleId ?? null,
          stopRequest: detail.stopRequest ?? null,
          stopOutcome: detail.stopOutcome ?? null,
          summary: detail.summary ?? null
        },
        null,
        2
      )
    );
    return;
  }
  if (subcommand === "inspect") {
    const { values, positionals } = parseLifecycleArgs(argv.slice(1), {
      workdir: { type: "string" },
      help: { type: "boolean", short: "h" }
    });
    if (asBool(values.help)) {
      console.log(usage("run", "inspect"));
      return;
    }
    const runId = positionals[0];
    if (!runId) {
      throw createCliInputError("CLI_RUN_INSPECT_MISSING_RUN_ID", "run inspect requires <run-id>");
    }
    const detail = await inspectRun(asString(values.workdir) ?? process.cwd(), runId);
    console.log(JSON.stringify(detail, null, 2));
    return;
  }
  if (subcommand === "review") {
    const nested = argv[1];
    const nestedArgv = argv.slice(2);
    if (!nested || nested === "--help" || nested === "-h") {
      console.log(usage("run", "review"));
      return;
    }
    if (nested === "list") {
      const { values, positionals } = parseLifecycleArgs(nestedArgv, {
        workdir: { type: "string" },
        help: { type: "boolean", short: "h" }
      });
      if (asBool(values.help)) {
        console.log(usage("run", "review"));
        return;
      }
      const runId = positionals[0];
      if (!runId) {
        throw createCliInputError("CLI_RUN_REVIEW_LIST_MISSING_RUN_ID", "run review list requires <run-id>");
      }
      const result = await listHumanReviews(asString(values.workdir) ?? process.cwd(), runId);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (nested === "inspect") {
      const { values, positionals } = parseLifecycleArgs(nestedArgv, {
        workdir: { type: "string" },
        help: { type: "boolean", short: "h" }
      });
      if (asBool(values.help)) {
        console.log(usage("run", "review"));
        return;
      }
      const runId = positionals[0];
      const reviewId = positionals[1];
      if (!runId || !reviewId) {
        throw createCliInputError(
          "CLI_RUN_REVIEW_INSPECT_MISSING_IDS",
          "run review inspect requires <run-id> <review-id>"
        );
      }
      const result = await inspectHumanReview(asString(values.workdir) ?? process.cwd(), runId, reviewId);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (nested === "decide") {
      const { values, positionals } = parseLifecycleArgs(nestedArgv, {
        workdir: { type: "string" },
        decision: { type: "string" },
        comment: { type: "string" },
        actor: { type: "string" },
        scope: { type: "string" },
        help: { type: "boolean", short: "h" }
      });
      if (asBool(values.help)) {
        console.log(usage("run", "review"));
        return;
      }
      const runId = positionals[0];
      const reviewId = positionals[1];
      const decision = asString(values.decision);
      if (!runId || !reviewId || !decision) {
        throw createCliInputError(
          "CLI_RUN_REVIEW_DECIDE_MISSING_ARGS",
          "run review decide requires <run-id> <review-id> --decision <approve|rework|pause|terminate>"
        );
      }
      if (!["approve", "rework", "pause", "terminate"].includes(decision)) {
        throw createCliInputError(
          "CLI_RUN_REVIEW_DECIDE_INVALID_DECISION",
          `invalid --decision value: ${decision}`
        );
      }
      const scope = asString(values.scope);
      if (scope !== undefined && scope !== "branch" && scope !== "run") {
        throw createCliInputError(
          "CLI_RUN_REVIEW_DECIDE_INVALID_SCOPE",
          `invalid --scope value: ${scope}`
        );
      }
      if (scope !== undefined && decision !== "terminate") {
        throw createCliInputError(
          "CLI_RUN_REVIEW_DECIDE_SCOPE_REQUIRES_TERMINATE",
          "--scope is only valid with --decision terminate"
        );
      }
      const result = await writeHumanReviewDecision({
        workdir: asString(values.workdir) ?? process.cwd(),
        runId,
        reviewId,
        decision: decision as "approve" | "rework" | "pause" | "terminate",
        comment: asString(values.comment),
        actor: asString(values.actor),
        scope: scope as "branch" | "run" | undefined
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    throw createCliInputError("CLI_RUN_REVIEW_UNKNOWN_SUBCOMMAND", `unknown run review subcommand: ${nested}`);
  }
  if (subcommand === "logs") {
    const { values, positionals } = parseLifecycleArgs(argv.slice(1), {
      workdir: { type: "string" },
      engine: { type: "boolean" },
      role: { type: "string" },
      tail: { type: "string" },
      since: { type: "string" },
      follow: { type: "boolean" },
      json: { type: "boolean" },
      ndjson: { type: "boolean" },
      help: { type: "boolean", short: "h" }
    });
    if (asBool(values.help)) {
      console.log(usage("run", "logs"));
      return;
    }
    const runId = positionals[0];
    if (!runId) {
      throw createCliInputError("CLI_RUN_LOGS_MISSING_RUN_ID", "run logs requires <run-id>");
    }
    const tail = parsePositiveIntegerOption({
      optionName: "--tail",
      value: asString(values.tail)
    });
    const workdir = asString(values.workdir) ?? process.cwd();
    const outputMode = resolveLogOutputMode(values);
    const records = await loadRunLogs({
      workdir,
      runId,
      roleId: asString(values.role),
      engine: asBool(values.engine),
      tail,
      since: asString(values.since)
    });
    if (asBool(values.follow)) {
      const printRecord = (record: Record<string, unknown>) => {
        if (outputMode === "ndjson") {
          console.log(JSON.stringify(record));
          return;
        }
        console.log(formatLogRecord(record));
      };
      for (const record of records) {
        printRecord(record);
      }
      await streamRunLogs({
        workdir,
        runId,
        roleId: asString(values.role),
        engine: asBool(values.engine),
        tail,
        since: asString(values.since),
        onRecord: async (record) => {
          printRecord(record);
        }
      });
      return;
    }
    if (outputMode === "json") {
      console.log(JSON.stringify(records, null, 2));
      return;
    }
    if (outputMode === "ndjson") {
      for (const record of records) {
        console.log(JSON.stringify(record));
      }
      return;
    }
    for (const record of records) {
      console.log(formatLogRecord(record));
    }
    return;
  }
  throw createCliInputError("CLI_UNKNOWN_SUBCOMMAND", `Unknown run subcommand: ${subcommand}\n\n${usage("run")}`);
}

function shouldKeepProcessAlive(argv: string[]): boolean {
  if (isVisualizerTopic(argv[0])) {
    return true;
  }
  return argv[0] === "run" && argv[1] === "logs" && argv.includes("--follow");
}

function flushAndExit(code: number): void {
  const exit = () => process.exit(code);
  process.stdout.write("", () => {
    process.stderr.write("", exit);
  });
}

function normalizeExitCode(value: number | string | null | undefined): number {
  return typeof value === "number" ? value : 0;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.log(usage());
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-V" || argv[0] === "version") {
    console.log(`ogs ${CLI_VERSION}`);
    return;
  }
  if (argv[0] === "--help" || argv[0] === "-h") {
    console.log(usage());
    return;
  }
  if (argv[0] === "help") {
    const topic = argv[1];
    const subcommand = argv[2];
    if (
      topic === "doctor" ||
      topic === "lint" ||
      topic === "nl2mmd" ||
      topic === "project" ||
      topic === "run" ||
      isVisualizerTopic(topic)
    ) {
      console.log(usage(topic, subcommand as ProjectSubcommand | RunSubcommand | undefined));
      return;
    }
    console.log(usage());
    return;
  }
  if (!argv[0].startsWith("-")) {
    const [command, ...rest] = argv;
    if (command === "doctor") {
      await runDoctorCli(rest);
      return;
    }
    if (command === "lint") {
      await runLintCli(rest);
      return;
    }
    if (command === "nl2mmd") {
      await runNl2MmdCli(rest);
      return;
    }
    if (command === "project") {
      await runProjectCommand(rest);
      return;
    }
    if (isVisualizerTopic(command)) {
      await runVisualizerCommand(rest);
      return;
    }
    if (command === "run") {
      await runRunCommand(rest);
      return;
    }
    throw createCliInputError("CLI_UNKNOWN_COMMAND", `Unknown command: ${command}\n\n${usage()}`);
  }

  throw createCliInputError("CLI_INVALID_ARGS", `Unknown option: ${argv[0]}\n\n${usage()}`);
}

const cliArgv = process.argv.slice(2);
const keepAlive = shouldKeepProcessAlive(cliArgv);

main()
  .then(() => {
    if (!keepAlive) {
      flushAndExit(normalizeExitCode(process.exitCode));
    }
  })
  .catch((error) => {
    const runtimeError =
      error instanceof RuntimeError
        ? error
        : createRuntimeError(
            normalizeRuntimeError(error, {
              errorCode: "CLI_COMMAND_FAILED",
              errorCategory: "system",
              retryable: false,
              stage: "cli"
            })
          );
    console.error(runtimeError.message);
    console.error(formatRuntimeErrorEnvelope(runtimeError.envelope));
    if (!keepAlive) {
      flushAndExit(1);
      return;
    }
    process.exitCode = 1;
  });
