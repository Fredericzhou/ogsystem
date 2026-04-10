import { writeFile } from "node:fs/promises";
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

async function main(): Promise<void> {
  const { values } = parseCliArgs();

  if (values.help) {
    console.log(usage());
    return;
  }

  if (!values.system || !values.prompt) {
    throw createCliInputError("CLI_MISSING_REQUIRED_ARGS", `Missing required args.\n\n${usage()}`);
  }

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

  const result = await runSystemWithAdapter({
    systemPath: values.system,
    runtimeConfigPath: values.runtime,
    userProfilePath: values["user-profile"],
    resumeRunDir: values["resume-run"],
    profilesPath: values.profiles,
    toolsPath: values.tools,
    lawsPath: values.laws,
    prompt: values.prompt,
    workdir: values.workdir ?? process.cwd(),
    dryRun: values["dry-run"] ?? false,
    cleanupExecutionHistory,
    logRun: values["log-run"] ?? false
  });

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
