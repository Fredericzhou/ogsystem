/**
 * @fileoverview OGSystem CLI entrypoint and command dispatch.
 * File Set: runtime-adapter
 * Responsibilities:
 * - Parse lifecycle and legacy adapter arguments.
 * - Dispatch project/run commands and normalize CLI errors.
 * Boundaries:
 * - Delegates runtime execution and persistence to lower-level modules.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { runSystemWithAdapter } from "./adapter.js";
import {
  OGS_RUNS_DIR,
  createProjectFromTemplate,
  ensureProjectSkeleton,
  inspectRun,
  loadIndexedRuns,
  loadRunLogs,
  rebuildRunsIndex,
  requestStop,
} from "./project-lifecycle.js";
import { streamRunLogs } from "./project-lifecycle.js";
import {
  RuntimeError,
  createRuntimeError,
  formatRuntimeErrorEnvelope,
  normalizeRuntimeError
} from "./runtime-errors.js";

function usageRoot(): string {
  return [
    "Usage:",
    "  ogs project init",
    "  ogs project create <name> --template <minimal|software-dev|consultation>",
    "  ogs run start --system <file.mmd> --prompt <text> [options]",
    "  ogs run resume <run-id> [options]",
    "  ogs run stop <run-id> [--reason <text>]",
    "  ogs run list [--reindex]",
    "  ogs run status <run-id>",
    "  ogs run inspect <run-id>",
    "  ogs run logs <run-id> [--engine|--role <roleId>] [--json] [--tail <n>] [--since <iso>] [--follow]",
    "  ogs run reindex",
    "",
    "Help:",
    "  ogs help [project|run|legacy]",
    "  ogs project --help",
    "  ogs run --help",
    "",
    "Defaults:",
    "  project commands use the current directory unless --workdir is provided",
    "  run commands use the current directory unless --workdir is provided",
    "  project create writes a new project folder under the current directory",
    "",
    "Legacy-compatible mode:",
    "  pnpm run run:adapter -- --system <file.mmd> --prompt <text> [options]"
  ].join("\n");
}

function usageProject(): string {
  return [
    "Usage:",
    "  ogs project init [--workdir <path>]",
    "  ogs project create <name> --template <minimal|software-dev|consultation> [--workdir <path>]",
    "",
    "Project lifecycle:",
    "  init   create .ogs/project.json, .ogs/runtime.json, .ogs/providers/opencode.json, and .ogs/runs-index.json",
    "  create scaffold a new project directory from a template",
    "",
    "Defaults:",
    "  current directory is the project root unless --workdir is set",
    "  create uses the current directory as the parent directory unless --workdir is set",
    "  templates are intentionally limited to keep project management consistent",
    "",
    "Templates:",
    "  minimal",
    "  software-dev",
    "  consultation",
    "",
    "Examples:",
    "  ogs project init",
    "  ogs project create demo-app --template minimal"
  ].join("\n");
}

function usageRun(): string {
  return [
    "Usage:",
    "  ogs run start --system <file.mmd> --prompt <text> [options]",
    "  ogs run resume <run-id> [options]",
    "  ogs run stop <run-id> [--reason <text>] [--workdir <path>]",
    "  ogs run list [--reindex] [--workdir <path>]",
    "  ogs run status <run-id> [--workdir <path>]",
    "  ogs run inspect <run-id> [--workdir <path>]",
    "  ogs run logs <run-id> [--engine|--role <roleId>] [--json] [--tail <n>] [--since <iso>] [--follow] [--workdir <path>]",
    "  ogs run reindex [--workdir <path>]",
    "",
    "Common Run Options:",
    "  --runtime <file>           Runtime config JSON override",
    "  --user-profile <file>      User profile JSON override",
    "  --laws <file>              Law catalog JSON override",
    "  --profiles <file>          Legacy execution profiles JSON (optional)",
    "  --tools <file>             Legacy CLI tools JSON (optional)",
    "  --workdir <path>           Working directory (default: cwd)",
    "  --cleanup-executions <n>   Keep only latest n per-role execution snapshots",
    "  --log-run                  Print role/transition runtime logs to stderr",
    "  --print-graph-link         Print Mermaid Live graph preview URL to stderr (run start only)",
    "  --trace-out <file>         Write final runtime result JSON",
    "  --dry-run                  Do not execute external commands",
    "  --help                     Show help"
  ].join("\n");
}

function usageLegacy(): string {
  return [
    "Usage:",
    "  pnpm run run:adapter -- --system <file.mmd> --prompt <text> [options]",
    "",
    "Legacy-compatible mode bridges the runtime directly.",
    "Prefer ogs project/run commands for normal project management."
  ].join("\n");
}

function usage(topic?: "project" | "run" | "legacy"): string {
  if (topic === "project") {
    return usageProject();
  }
  if (topic === "run") {
    return usageRun();
  }
  if (topic === "legacy") {
    return usageLegacy();
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

async function printResumeHint(args: {
  error: RuntimeError;
  values: Record<string, string | boolean | undefined>;
  workdir: string;
}): Promise<void> {
  const runId = args.error.envelope.runId;
  if (!runId) {
    return;
  }

  const systemPath = resolve(args.workdir, String(args.values.system ?? ""));
  const prompt = String(args.values.prompt ?? "");
  const runsDir = await resolveRunsDir({
    runtimeConfigPath: typeof args.values.runtime === "string" ? args.values.runtime : undefined,
    workdir: args.workdir
  });
  const resumeRun =
    typeof args.values["resume-run"] === "string" && args.values["resume-run"].trim()
      ? args.values["resume-run"]
      : `${runsDir}/${runId}`;

  const tokens: string[] = [
    "pnpm run run:adapter --",
    `--system ${shellEscape(systemPath)}`,
    `--prompt ${shellEscape(prompt)}`,
    `--workdir ${shellEscape(args.workdir)}`,
    `--resume-run ${shellEscape(resumeRun)}`
  ];
  if (typeof args.values.runtime === "string") {
    tokens.push(`--runtime ${shellEscape(args.values.runtime)}`);
  }
  if (typeof args.values["user-profile"] === "string") {
    tokens.push(`--user-profile ${shellEscape(args.values["user-profile"])}`);
  }
  if (typeof args.values.laws === "string") {
    tokens.push(`--laws ${shellEscape(args.values.laws)}`);
  }
  if (typeof args.values.profiles === "string") {
    tokens.push(`--profiles ${shellEscape(args.values.profiles)}`);
  }
  if (typeof args.values.tools === "string") {
    tokens.push(`--tools ${shellEscape(args.values.tools)}`);
  }
  if (args.values["dry-run"] === true) {
    tokens.push("--dry-run");
  }
  if (args.values["log-run"] === true) {
    tokens.push("--log-run");
  }

  console.error(`[hint] run failed for runId=${runId}`);
  console.error("[hint] To resume this run, use:");
  console.error(`[hint] ${tokens.join(" ")}`);
}

async function maybePrintGraphLink(args: {
  enabled: boolean;
  workdir: string;
  systemPath: string;
}): Promise<void> {
  if (!args.enabled) {
    return;
  }
  try {
    const source = await readFile(resolve(args.workdir, args.systemPath), "utf8");
    const url = buildMermaidLiveEditUrl(source);
    console.error("[graph] System graph initialized.");
    console.error(`[graph] Visual preview: ${url}`);
  } catch (error) {
    console.error(
      `[graph] preview unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function parseLegacyArgs(argv?: string[]) {
  try {
    return parseArgs({
      args: argv,
      options: {
        system: { type: "string" },
        runtime: { type: "string" },
        "user-profile": { type: "string" },
        "resume-run": { type: "string" },
        profiles: { type: "string" },
        tools: { type: "string" },
        laws: { type: "string" },
        prompt: { type: "string" },
        workdir: { type: "string" },
        "cleanup-executions": { type: "string" },
        "log-run": { type: "boolean" },
        "print-graph-link": { type: "boolean" },
        "trace-out": { type: "string" },
        "dry-run": { type: "boolean" },
        help: { type: "boolean", short: "h" }
      },
      allowPositionals: false
    });
  } catch (error) {
    throw createCliInputError(
      "CLI_INVALID_ARGS",
      error instanceof Error ? error.message : String(error)
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

async function runAdapterCommand(args: {
  systemPath: string;
  prompt: string;
  runtimeConfigPath?: string;
  userProfilePath?: string;
  resumeRunDir?: string;
  profilesPath?: string;
  toolsPath?: string;
  lawsPath?: string;
  workdir: string;
  dryRun: boolean;
  cleanupExecutionHistory?: number;
  logRun: boolean;
  traceOut?: string;
}): Promise<void> {
  await ensureProjectSkeleton({ workdir: args.workdir });
  const result = await runSystemWithAdapter({
    systemPath: args.systemPath,
    runtimeConfigPath: args.runtimeConfigPath,
    userProfilePath: args.userProfilePath,
    resumeRunDir: args.resumeRunDir,
    profilesPath: args.profilesPath,
    toolsPath: args.toolsPath,
    lawsPath: args.lawsPath,
    prompt: args.prompt,
    workdir: args.workdir,
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
}

async function runLegacyMode(argv?: string[]): Promise<void> {
  const { values } = parseLegacyArgs(argv);
  if (values.help) {
    console.log(usage());
    return;
  }
  if (!values.system || !values.prompt) {
    throw createCliInputError("CLI_MISSING_REQUIRED_ARGS", `Missing required args.\n\n${usage()}`);
  }

  const workdir = values.workdir ?? process.cwd();
  await maybePrintGraphLink({
    enabled: values["print-graph-link"] ?? false,
    workdir,
    systemPath: values.system
  });

  const cleanupExecutionHistory = parseCleanupExecutionValue(values["cleanup-executions"]);
  try {
    await runAdapterCommand({
      systemPath: values.system,
      prompt: values.prompt,
      runtimeConfigPath: values.runtime,
      userProfilePath: values["user-profile"],
      resumeRunDir: values["resume-run"],
      profilesPath: values.profiles,
      toolsPath: values.tools,
      lawsPath: values.laws,
      workdir,
      dryRun: values["dry-run"] ?? false,
      cleanupExecutionHistory,
      logRun: values["log-run"] ?? false,
      traceOut: values["trace-out"]
    });
  } catch (error) {
    if (error instanceof RuntimeError) {
      await printResumeHint({
        error,
        values,
        workdir
      });
    }
    throw error;
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
      workdir: { type: "string" },
      name: { type: "string" },
      help: { type: "boolean", short: "h" }
    });
    if (asBool(values.help)) {
      console.log(usage("project"));
      return;
    }
    const workdir = asString(values.workdir) ?? process.cwd();
    await ensureProjectSkeleton({
      workdir,
      projectName: asString(values.name)
    });
    const index = await rebuildRunsIndex(workdir);
    console.log(
      JSON.stringify(
        {
          status: "ok",
          command: "project init",
          workdir,
          runCount: index.runs.length
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
      help: { type: "boolean", short: "h" }
    });
    if (asBool(values.help)) {
      console.log(usage("project"));
      return;
    }
    const projectName = positionals[0];
    if (!projectName) {
      throw createCliInputError("CLI_PROJECT_CREATE_MISSING_NAME", "Missing project name");
    }
    const template = asString(values.template);
    if (
      template !== "minimal" &&
      template !== "software-dev" &&
      template !== "consultation"
    ) {
      throw createCliInputError(
        "CLI_PROJECT_CREATE_INVALID_TEMPLATE",
        "--template must be one of: minimal, software-dev, consultation"
      );
    }
    const parentDir = asString(values.workdir) ?? process.cwd();
    const projectDir = await createProjectFromTemplate({
      parentDir,
      name: projectName,
      templateId: template
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

  throw createCliInputError(
    "CLI_UNKNOWN_SUBCOMMAND",
    `Unknown project subcommand: ${subcommand}`
  );
}

async function runStartCommand(argv: string[]): Promise<void> {
  const { values } = parseLifecycleArgs(argv, {
    system: { type: "string" },
    runtime: { type: "string" },
    "user-profile": { type: "string" },
    profiles: { type: "string" },
    tools: { type: "string" },
    laws: { type: "string" },
    prompt: { type: "string" },
    workdir: { type: "string" },
    "cleanup-executions": { type: "string" },
    "log-run": { type: "boolean" },
    "print-graph-link": { type: "boolean" },
    "trace-out": { type: "string" },
    "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" }
  });
  if (asBool(values.help)) {
    console.log(usage("run"));
    return;
  }
  const systemPath = asString(values.system);
  const prompt = asString(values.prompt);
  if (!systemPath || !prompt) {
    throw createCliInputError(
      "CLI_MISSING_REQUIRED_ARGS",
      "run start requires --system and --prompt"
    );
  }

  const workdir = asString(values.workdir) ?? process.cwd();
  await maybePrintGraphLink({
    enabled: asBool(values["print-graph-link"]),
    workdir,
    systemPath
  });

  await runAdapterCommand({
    systemPath,
    prompt,
    runtimeConfigPath: asString(values.runtime),
    userProfilePath: asString(values["user-profile"]),
    profilesPath: asString(values.profiles),
    toolsPath: asString(values.tools),
    lawsPath: asString(values.laws),
    workdir,
    dryRun: asBool(values["dry-run"]),
    cleanupExecutionHistory: parseCleanupExecutionValue(asString(values["cleanup-executions"])),
    logRun: asBool(values["log-run"]),
    traceOut: asString(values["trace-out"])
  });
}

async function runResumeCommand(argv: string[]): Promise<void> {
  const { values, positionals } = parseLifecycleArgs(argv, {
    system: { type: "string" },
    runtime: { type: "string" },
    "user-profile": { type: "string" },
    profiles: { type: "string" },
    tools: { type: "string" },
    laws: { type: "string" },
    prompt: { type: "string" },
    workdir: { type: "string" },
    "cleanup-executions": { type: "string" },
    "log-run": { type: "boolean" },
    "trace-out": { type: "string" },
    "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" }
  });
  if (asBool(values.help)) {
    console.log(usage("run"));
    return;
  }
  const runId = positionals[0];
  if (!runId) {
    throw createCliInputError("CLI_RUN_RESUME_MISSING_RUN_ID", "run resume requires <run-id>");
  }

  const workdir = asString(values.workdir) ?? process.cwd();
  const detail = (await inspectRun(workdir, runId)) as { runDir: string };
  const runDir = detail.runDir;
  const systemPath = asString(values.system) ?? resolve(runDir, "system.mmd");
  const prompt =
    asString(values.prompt) ??
    (await readFile(resolve(runDir, "request.md"), "utf8")).replace(/\s+$/, "");

  await runAdapterCommand({
    systemPath,
    prompt,
    runtimeConfigPath: asString(values.runtime),
    userProfilePath: asString(values["user-profile"]),
    resumeRunDir: resolve(runDir),
    profilesPath: asString(values.profiles),
    toolsPath: asString(values.tools),
    lawsPath: asString(values.laws),
    workdir,
    dryRun: asBool(values["dry-run"]),
    cleanupExecutionHistory: parseCleanupExecutionValue(asString(values["cleanup-executions"])),
    logRun: asBool(values["log-run"]),
    traceOut: asString(values["trace-out"])
  });
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
      console.log(usage("run"));
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
      console.log(usage("run"));
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
      console.log(usage("run"));
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
        ? (detail.summary as {
            status?: string;
            durationMs?: number;
            lastRoleId?: string;
            lastErrorCode?: string;
            finalRoleId?: string;
          })
        : undefined;
    const state =
      typeof detail.state === "object" &&
      detail.state !== null &&
      !Array.isArray(detail.state)
        ? (detail.state as { status?: string; graphState?: { status?: string } })
        : undefined;
    const stopRequest =
      typeof detail.stopRequest === "object" &&
      detail.stopRequest !== null &&
      !Array.isArray(detail.stopRequest)
        ? (detail.stopRequest as { reason?: string })
        : undefined;
    const stopOutcome =
      typeof detail.stopOutcome === "object" &&
      detail.stopOutcome !== null &&
      !Array.isArray(detail.stopOutcome)
        ? (detail.stopOutcome as { reason?: string })
        : undefined;
    console.log(
      JSON.stringify(
        {
          runId,
          runDir: detail.runDir,
          status: summary?.status ?? state?.status ?? state?.graphState?.status ?? "unknown",
          durationMs: summary?.durationMs ?? 0,
          lastRoleId: summary?.lastRoleId ?? null,
          lastErrorCode: summary?.lastErrorCode ?? null,
          stopReason: stopOutcome?.reason ?? stopRequest?.reason ?? null,
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
      console.log(usage("run"));
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
  if (subcommand === "logs") {
    const { values, positionals } = parseLifecycleArgs(argv.slice(1), {
      workdir: { type: "string" },
      engine: { type: "boolean" },
      role: { type: "string" },
      tail: { type: "string" },
      since: { type: "string" },
      follow: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" }
    });
    if (asBool(values.help)) {
      console.log(usage("run"));
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
        if (asBool(values.json)) {
          console.log(JSON.stringify(record));
          return;
        }
        console.log(JSON.stringify(record));
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
    if (asBool(values.json)) {
      console.log(JSON.stringify(records, null, 2));
      return;
    }
    for (const record of records) {
      console.log(JSON.stringify(record));
    }
    return;
  }
  if (subcommand === "reindex") {
    const { values } = parseLifecycleArgs(argv.slice(1), {
      workdir: { type: "string" },
      help: { type: "boolean", short: "h" }
    });
    if (asBool(values.help)) {
      console.log(usage());
      return;
    }
    const index = await rebuildRunsIndex(asString(values.workdir) ?? process.cwd());
    console.log(JSON.stringify(index, null, 2));
    return;
  }

  throw createCliInputError("CLI_UNKNOWN_SUBCOMMAND", `Unknown run subcommand: ${subcommand}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.log(usage());
    return;
  }
  if (argv[0] === "--help" || argv[0] === "-h") {
    console.log(usage());
    return;
  }
  if (argv[0] === "help") {
    const topic = argv[1];
    if (topic === "project" || topic === "run" || topic === "legacy") {
      console.log(usage(topic));
      return;
    }
    console.log(usage());
    return;
  }
  if (!argv[0].startsWith("-")) {
    const [command, ...rest] = argv;
    if (command === "project") {
      await runProjectCommand(rest);
      return;
    }
    if (command === "run") {
      await runRunCommand(rest);
      return;
    }
  }

  await runLegacyMode(argv);
}

main().catch((error) => {
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
  process.exitCode = 1;
});
