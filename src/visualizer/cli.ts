/**
 * @fileoverview CLI entrypoint for the OGSystem visualization server.
 */
import { parseArgs } from "node:util";

import { startVisualizationServer } from "./server.js";

function usage(): string {
  return [
    "Usage:",
    "  ogs visualizer [--workdir <path>] [--host <host>] [--port <n|0>]",
    "",
    "Source repository equivalent:",
    "  pnpm run run:visualizer -- [--workdir <path>] [--host <host>] [--port <n|0>]",
    "",
    "Defaults:",
    "  workdir: current directory",
    "  host: 127.0.0.1",
    "  port: 3337"
  ].join("\n");
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 3337;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      workdir: { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: false
  });

  if (values.help) {
    console.log(usage());
    return;
  }

  const workdir = asString(values.workdir) ?? process.cwd();
  const host = asString(values.host) ?? "127.0.0.1";
  const port = parsePort(asString(values.port));
  const result = await startVisualizationServer({
    workdir,
    host,
    port
  });

  console.log(`OGSystem Visualizer listening on ${result.url}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
