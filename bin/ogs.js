#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceCli = resolve(repoRoot, "src/runtime/cli.ts");
const distCli = resolve(repoRoot, "dist/runtime/cli.js");
const tsxLoader = resolve(repoRoot, "node_modules/tsx/dist/loader.mjs");
const useSource = existsSync(sourceCli) && existsSync(tsxLoader);
const childArgs = useSource
  ? ["--import", pathToFileURL(tsxLoader).href, sourceCli, ...process.argv.slice(2)]
  : [distCli, ...process.argv.slice(2)];

const child = spawn(process.execPath, childArgs, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});

const shutdown = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
