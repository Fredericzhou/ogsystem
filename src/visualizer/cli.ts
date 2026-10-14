/**
 * @fileoverview CLI entrypoint for the OGSystem visualization server.
 */
import { parseArgs } from "node:util";

import { createBasicControlPlaneIdentityProvider } from "../runtime/identity.js";
import { startVisualizationServer } from "./server.js";

function usage(): string {
  return [
    "Usage:",
    "  ogs vis [--ogs-dir <path>] [--host <host>] [--port <n|0>] [--tls-cert <path> --tls-key <path>]",
    "",
    "Source repository equivalent:",
    "  pnpm run run:visualizer -- [--ogs-dir <path>] [--host <host>] [--port <n|0>] [--tls-cert <path> --tls-key <path>]",
    "",
    "Defaults:",
    "  ogs-dir: current directory",
    "  host: 127.0.0.1",
    "  port: 3337",
    "",
    "Remote access:",
    "  Non-loopback hosts require TLS certificate/key and OGS_VIS_USERNAME / OGS_VIS_PASSWORD.",
    "  Credentials are read only from the environment; never pass passwords on the command line.",
    "  Keep the private key restricted to the service account and use a trusted certificate for deployment."
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
      "ogs-dir": { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      "tls-cert": { type: "string" },
      "tls-key": { type: "string" },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: false
  });

  if (values.help) {
    console.log(usage());
    return;
  }

  const workdir = asString(values["ogs-dir"]) ?? process.cwd();
  const host = asString(values.host) ?? "127.0.0.1";
  const port = parsePort(asString(values.port));
  const tlsCert = asString(values["tls-cert"]);
  const tlsKey = asString(values["tls-key"]);
  const username = process.env.OGS_VIS_USERNAME;
  const password = process.env.OGS_VIS_PASSWORD;
  if (Boolean(username) !== Boolean(password)) {
    throw new Error("VISUALIZER_BASIC_AUTH_CONFIG_INVALID: Set both OGS_VIS_USERNAME and OGS_VIS_PASSWORD.");
  }
  const identityProvider = username && password
    ? createBasicControlPlaneIdentityProvider({ username, password })
    : undefined;
  const result = await startVisualizationServer({
    workdir,
    host,
    port,
    tls: tlsCert || tlsKey ? { cert: tlsCert ?? "", key: tlsKey ?? "" } : undefined,
    identityProvider
  });

  console.log(`OGS Multi-Agent Graph Orchestration System listening on ${result.url}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
