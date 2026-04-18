import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

const runtimeCliPath = path.resolve("dist/runtime/cli.js");
const nl2mmdCliPath = path.resolve("dist/nl2mmd/cli.js");

function runNodeCli(cliPath, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [cliPath, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function runOgsBin(args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.resolve("node_modules/.bin/ogs"), args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("ogs help command surfaces layered guidance", async () => {
  const rootHelp = await runNodeCli(runtimeCliPath, ["help"]);
  assert.strictEqual(rootHelp.code, 0);
  assert.match(rootHelp.stdout, /ogs help \[project\|run\|visualizer\|legacy\]/);
  assert.match(rootHelp.stdout, /project commands use the current directory/);

  const projectHelp = await runNodeCli(runtimeCliPath, ["help", "project"]);
  assert.strictEqual(projectHelp.code, 0);
  assert.match(projectHelp.stdout, /ogs project init \[--workdir <path>\]/);
  assert.match(projectHelp.stdout, /templates are intentionally limited/);

  const runHelp = await runNodeCli(runtimeCliPath, ["run", "--help"]);
  assert.strictEqual(runHelp.code, 0);
  assert.match(runHelp.stdout, /ogs run start --system <file\.mmd> --prompt <text> \[options\]/);
  assert.match(runHelp.stdout, /--workdir <path>           Working directory \(default: cwd\)/);

  const visualizerHelp = await runNodeCli(runtimeCliPath, ["visualizer", "--help"]);
  assert.strictEqual(visualizerHelp.code, 0);
  assert.match(visualizerHelp.stdout, /ogs visualizer \[--workdir <path>\] \[--host <host>\] \[--port <n>\]/);
  assert.match(visualizerHelp.stdout, /workdir: current directory/);
});

test("ogs bin is wired through the local bin link", async () => {
  const help = await runOgsBin(["help"]);
  assert.strictEqual(help.code, 0);
  assert.match(help.stdout, /ogs help \[project\|run\|visualizer\|legacy\]/);
});

test("nl2mmd help command highlights base entrypoint and defaults", async () => {
  const help = await runNodeCli(nl2mmdCliPath, ["--help"]);
  assert.strictEqual(help.code, 0);
  assert.match(help.stdout, /pnpm run run:nl2mmd -- \[--message <text>\] \[--model <modelId>\]/);
  assert.match(help.stdout, /Base command:/);
  assert.match(help.stdout, /workdir defaults to the current directory/);
  assert.match(help.stdout, /Interactive commands:/);
});

test("ogs visualizer starts in the current directory and prints the address", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-ogs-visualizer-"));
  const child = spawn(path.resolve("node_modules/.bin/ogs"), ["visualizer", "--port", "0"], {
    cwd: workdir,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  let resolved = false;

  const result = await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (!resolved && stdout.includes("OGSystem Visualizer listening on ")) {
        resolved = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });

  assert.ok(resolved, `expected startup output, got stdout=${stdout} stderr=${stderr}`);
  assert.match(stdout, /OGSystem Visualizer listening on http:\/\/127\.0\.0\.1:\d+/);
  assert.strictEqual(result.code, 0);
  assert.strictEqual(stderr, "");
});
