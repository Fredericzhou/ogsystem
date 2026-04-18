/**
 * @fileoverview CLI entrypoint for the OGSystem visualization server.
 */
import { parseArgs } from "node:util";

import { startVisualizationServer } from "./server.js";
import { getVisualizerCliOptions, getVisualizerCliUsage } from "./command-graph.js";

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
    options: getVisualizerCliOptions(),
    allowPositionals: false
  });

  if (values.help) {
    console.log(getVisualizerCliUsage());
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
