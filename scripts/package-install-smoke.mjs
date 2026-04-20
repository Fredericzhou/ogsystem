import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path, { dirname } from "node:path";

const repoRoot = process.cwd();
const packageManager = process.argv[2];

if (packageManager !== "npm" && packageManager !== "pnpm") {
  console.error("Usage: node scripts/package-install-smoke.mjs <npm|pnpm>");
  process.exit(1);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
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

function resolveNodeManagedCommand(command) {
  const nodeBinDir = dirname(process.execPath);
  if (command === "npm") {
    return path.resolve(nodeBinDir, process.platform === "win32" ? "npm.cmd" : "npm");
  }
  return command;
}

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), `ogsystem-install-smoke-${packageManager}-`));
  const packDir = path.resolve(tempRoot, "pack");
  const installDir = path.resolve(tempRoot, "install");
  const appParent = path.resolve(tempRoot, "apps");
  await mkdir(packDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(appParent, { recursive: true });

  const packResult = await runCommand("pnpm", ["pack", "--pack-destination", packDir], {
    cwd: repoRoot
  });
  assert.equal(packResult.code, 0, packResult.stderr);

  const packedFiles = await readdir(packDir);
  const tarballName = packedFiles.find((entry) => /^ogsystem-\d+\.\d+\.\d+\.tgz$/.test(entry));
  assert.ok(tarballName, `expected ogsystem tarball in ${packDir}`);
  const tarballPath = path.resolve(packDir, tarballName);

  await writeFile(
    path.resolve(installDir, "package.json"),
    JSON.stringify({ name: "ogsystem-install-smoke", private: true }, null, 2),
    "utf8"
  );

  const installResult = await runCommand(
    resolveNodeManagedCommand(packageManager),
    packageManager === "npm" ? ["install", tarballPath] : ["add", tarballPath],
    { cwd: installDir }
  );
  assert.equal(installResult.code, 0, installResult.stderr);

  const installedPackageDir = path.resolve(installDir, "node_modules", "ogsystem");
  const ogsBinPath = path.resolve(installedPackageDir, "bin", "ogs.mjs");
  const ogsDoctorBinPath = path.resolve(installedPackageDir, "bin", "ogs-doctor.mjs");
  await stat(ogsBinPath);
  await stat(ogsDoctorBinPath);

  const helpResult = await runCommand("node", [ogsBinPath, "help"], { cwd: installDir });
  assert.equal(helpResult.code, 0, helpResult.stderr);
  assert.match(helpResult.stdout, /ogs project create <name> --template/);

  const doctorHelpResult = await runCommand("node", [ogsDoctorBinPath, "--help"], {
    cwd: installDir
  });
  assert.equal(doctorHelpResult.code, 0, doctorHelpResult.stderr);
  assert.match(doctorHelpResult.stdout, /--required <csv>/);

  const createResult = await runCommand(
    "node",
    [ogsBinPath, "project", "create", "demo-app", "--template", "minimal", "--workdir", appParent],
    { cwd: installDir }
  );
  assert.equal(createResult.code, 0, createResult.stderr);

  const createPayload = JSON.parse(createResult.stdout);
  const projectDir = createPayload.projectDir;
  await assert.rejects(() => stat(path.resolve(projectDir, "og-roles")), /ENOENT/);
  await assert.rejects(() => stat(path.resolve(projectDir, "og-models")), /ENOENT/);

  const startResult = await runCommand(
    "node",
    [ogsBinPath, "run", "start", "--system", "system.mmd", "--prompt", "install smoke", "--dry-run"],
    { cwd: projectDir }
  );
  assert.equal(startResult.code, 0, startResult.stderr);

  const startPayload = JSON.parse(startResult.stdout);
  assert.equal(startPayload.status, "done");

  console.log(`package install smoke passed via ${packageManager}`);
}

await main();
