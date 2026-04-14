/**
 * @fileoverview CLI wrapper for Mermaid system linting.
 * File Set: runtime-adapter
 * Responsibilities:
 * - Parse lint command arguments.
 * - Run parse/validate pipeline and format diagnostics.
 * Boundaries:
 * - No runtime execution or artifact persistence.
 */
import { parseArgs } from "node:util";

import { loadSystemFromMermaid } from "./parse-mermaid.js";
import {
  RuntimeError,
  createRuntimeError,
  formatRuntimeErrorEnvelope,
  normalizeRuntimeError
} from "./runtime-errors.js";

function usage(): string {
  return [
    "Usage:",
    "  npm run lint:system -- --system <file.mmd>",
    "",
    "Options:",
    "  --system <file>        Mermaid system to validate",
    "  --help                 Show help"
  ].join("\n");
}

function formatDiagnostic(error: RuntimeError): string {
  const { envelope } = error;
  const line = envelope.line ?? 0;
  return `${line} ${envelope.errorCode} ${envelope.message}`;
}

function createLintInputError(errorCode: string, message: string): RuntimeError {
  return createRuntimeError({
    errorCode,
    errorCategory: "input",
    message,
    retryable: false,
    stage: "lint"
  });
}

function parseLintArgs() {
  try {
    return parseArgs({
      options: {
        system: { type: "string" },
        help: { type: "boolean", short: "h" }
      },
      allowPositionals: false
    });
  } catch (error) {
    throw createLintInputError(
      "LINT_INVALID_ARGS",
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function main(): Promise<void> {
  const { values } = parseLintArgs();

  if (values.help) {
    console.log(usage());
    return;
  }

  if (!values.system) {
    throw createLintInputError("LINT_MISSING_SYSTEM_ARG", `Missing required args.\n\n${usage()}`);
  }

  await loadSystemFromMermaid(values.system);
}

main().catch((error) => {
  const runtimeError =
    error instanceof RuntimeError
      ? error
      : createRuntimeError(
          normalizeRuntimeError(error, {
            errorCode: "LINT_COMMAND_FAILED",
            errorCategory: "system",
            retryable: false,
            stage: "lint"
          })
        );

  if (runtimeError.envelope.line !== undefined) {
    console.error(formatDiagnostic(runtimeError));
  } else {
    console.error(runtimeError.message);
  }
  console.error(formatRuntimeErrorEnvelope(runtimeError.envelope));
  process.exitCode = 1;
});
