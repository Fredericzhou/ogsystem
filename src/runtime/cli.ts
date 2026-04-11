import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { runSystemWithAdapter } from "./adapter.js";
import {
  RuntimeError,
  createRuntimeError,
  formatRuntimeErrorEnvelope,
  normalizeRuntimeError
} from "./runtime-errors.js";

function usage(): string {
  return [
    "Usage:",
    "  npm run run:adapter -- --system <file.mmd> --prompt <text>",
    "",
    "Options:",
    "  --runtime <file>        Runtime config JSON (optional, defaults to .ogsystem/runtime.json)",
    "  --user-profile <file>   User profile JSON (optional, defaults to .ogsystem/user-profile.json)",
    "  --laws <file>           Law catalog JSON (optional, defaults to .ogsystem/laws.json)",
    "  --resume-run <dir>      Reuse an existing ogsystem-history/<run-id> directory",
    "  --profiles <file>       Legacy execution profiles JSON (optional)",
    "  --tools <file>          Legacy CLI tools JSON (optional)",
    "  --workdir <path>        Working directory and shared workspace (default: cwd)",
    "  --cleanup-executions <n> Keep only the latest n per-role execution snapshots (optional)",
    "  --log-run               Print simple role/transition runtime logs to stderr",
    "  --print-graph-link      Print Mermaid Live graph preview URL to stderr",
    "  --trace-out <file>       Write final runtime result JSON",
    "  --dry-run                Do not execute external commands"
  ].join("\n");
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

function parseCliArgs() {
  try {
    return parseArgs({
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
  const runtimePath = resolve(args.workdir, args.runtimeConfigPath ?? ".ogsystem/runtime.json");
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
    // Fall back to default runsDir when runtime config is missing or malformed.
  }
  return "ogsystem-history";
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
    "npm run run:adapter --",
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

async function main(): Promise<void> {
  const { values } = parseCliArgs();

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

  const cleanupExecutionHistory =
    values["cleanup-executions"] === undefined
      ? undefined
      : Number.parseInt(values["cleanup-executions"], 10);
  if (
    cleanupExecutionHistory !== undefined &&
    (!Number.isInteger(cleanupExecutionHistory) || cleanupExecutionHistory <= 0)
  ) {
    throw createCliInputError(
      "CLI_INVALID_CLEANUP_EXECUTIONS",
      "--cleanup-executions must be a positive integer"
    );
  }

  let result;
  try {
    result = await runSystemWithAdapter({
      systemPath: values.system,
      runtimeConfigPath: values.runtime,
      userProfilePath: values["user-profile"],
      resumeRunDir: values["resume-run"],
      profilesPath: values.profiles,
      toolsPath: values.tools,
      lawsPath: values.laws,
      prompt: values.prompt,
      workdir,
      dryRun: values["dry-run"] ?? false,
      cleanupExecutionHistory,
      logRun: values["log-run"] ?? false
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

  const output = JSON.stringify(result, null, 2);
  console.log(output);
  if (values["trace-out"]) {
    await writeFile(values["trace-out"], output, "utf8");
  }
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
