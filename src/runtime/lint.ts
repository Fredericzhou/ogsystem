import { parseArgs } from "node:util";

import { loadSystemFromMermaid } from "./parse-mermaid.js";
import { RuntimeError } from "./runtime-errors.js";

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

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      system: { type: "string" },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: false
  });

  if (values.help) {
    console.log(usage());
    return;
  }

  if (!values.system) {
    throw new Error(`Missing required args.\n\n${usage()}`);
  }

  await loadSystemFromMermaid(values.system);
}

main().catch((error) => {
  if (error instanceof RuntimeError) {
    console.error(formatDiagnostic(error));
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
});
