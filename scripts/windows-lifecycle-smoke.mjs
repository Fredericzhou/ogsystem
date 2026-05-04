import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const cliPath = path.resolve(repoRoot, "bin", "ogs.mjs");
const fixturePath = path.resolve(repoRoot, "tests", "fixtures", "opencode-models-verbose.txt");

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: {
        ...process.env,
        OGSYSTEM_OPENCODE_MODELS_STDOUT_FILE: fixturePath,
        ...(options.env ?? {})
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
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

function quotePowerShell(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteCmd(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

function parseJsonOutput(output) {
  return JSON.parse(output.trim());
}

async function runPowerShellSmoke() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "ogsystem ps lifecycle "));
  const projectDir = path.resolve(parent, "project with spaces");
  const node = quotePowerShell(process.execPath);
  const cli = quotePowerShell(cliPath);
  const workdir = quotePowerShell(projectDir);
  const commands = [
    `& ${node} ${cli} project init --template minimal --workdir ${workdir}`,
    `$start = & ${node} ${cli} run start --system system.mmd --input 'windows powershell smoke' --dry-run --workdir ${workdir}`,
    `$startJson = $start | ConvertFrom-Json`,
    `if ($startJson.status -ne 'done') { throw 'run start did not finish as done' }`,
    `$list = & ${node} ${cli} run list --workdir ${workdir}`,
    `$listJson = $list | ConvertFrom-Json`,
    `if ($listJson.runs.Count -ne 1) { throw 'run list did not return one run' }`,
    `$status = & ${node} ${cli} run status $listJson.runs[0].runId --workdir ${workdir}`,
    `$statusJson = $status | ConvertFrom-Json`,
    `if ($statusJson.status -ne 'done') { throw 'run status did not return done' }`
  ].join("; ");
  const result = await runCommand("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    commands
  ]);
  assert.equal(result.code, 0, result.stderr || result.stdout);
}

async function runCmdSmoke() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "ogsystem cmd lifecycle "));
  const projectParent = path.resolve(parent, "parent with spaces");
  const projectDir = path.resolve(projectParent, "cmd app");
  const node = quoteCmd(process.execPath);
  const cli = quoteCmd(cliPath);
  const parentArg = quoteCmd(projectParent);
  const workdir = quoteCmd(projectDir);

  const create = await runCommand("cmd.exe", [
    "/d",
    "/s",
    "/c",
    `${node} ${cli} project create "cmd app" --template minimal --workdir ${parentArg}`
  ]);
  assert.equal(create.code, 0, create.stderr);

  const start = await runCommand("cmd.exe", [
    "/d",
    "/s",
    "/c",
    `${node} ${cli} run start --system system.mmd --input "windows cmd smoke" --dry-run --workdir ${workdir}`
  ]);
  assert.equal(start.code, 0, start.stderr);
  assert.equal(parseJsonOutput(start.stdout).status, "done");

  const list = await runCommand("cmd.exe", [
    "/d",
    "/s",
    "/c",
    `${node} ${cli} run list --workdir ${workdir}`
  ]);
  assert.equal(list.code, 0, list.stderr);
  const listPayload = parseJsonOutput(list.stdout);
  assert.equal(listPayload.runs.length, 1);

  const status = await runCommand("cmd.exe", [
    "/d",
    "/s",
    "/c",
    `${node} ${cli} run status ${listPayload.runs[0].runId} --workdir ${workdir}`
  ]);
  assert.equal(status.code, 0, status.stderr);
  assert.equal(parseJsonOutput(status.stdout).status, "done");
}

if (process.platform !== "win32") {
  console.log("windows lifecycle smoke skipped: requires win32");
} else {
  await runPowerShellSmoke();
  await runCmdSmoke();
  console.log("windows lifecycle smoke passed");
}
