import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import os from "node:os";
import path, { dirname } from "node:path";

const repoRoot = process.cwd();
const opencodeModelsFixturePath = path.resolve(repoRoot, "tests/fixtures/opencode-models-verbose.txt");
const installPackageJson = JSON.parse(
  await readFile(path.resolve(repoRoot, "package.json"), "utf8")
);

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: {
        ...process.env,
        OGSYSTEM_OPENCODE_MODELS_STDOUT_FILE: opencodeModelsFixturePath,
        ...(options.env ?? {})
      },
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
  const executable = process.platform === "win32" ? `${command}.cmd` : command;
  if (command === "npm") {
    return {
      command: path.resolve(nodeBinDir, executable),
      argsPrefix: []
    };
  }
  if (command === "pnpm") {
    const pathCandidates = (process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((entry) => path.resolve(entry, executable));
    const extraCandidates = [
      path.resolve(homedir(), "Library", "pnpm", executable),
      path.resolve(homedir(), ".volta", "bin", executable)
    ];
    const directCandidate = [...pathCandidates, ...extraCandidates].find((candidate) => existsSync(candidate));
    if (directCandidate) {
      return {
        command: directCandidate,
        argsPrefix: []
      };
    }
    return {
      command: path.resolve(nodeBinDir, process.platform === "win32" ? "corepack.cmd" : "corepack"),
      argsPrefix: ["pnpm"]
    };
  }
  return {
    command,
    argsPrefix: []
  };
}

test("packed CLI installs and scaffolds a runnable project with imported local dependencies", async () => {
  const packDir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-pack-"));
  const installDir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-install-"));
  const appParent = await mkdtemp(path.join(os.tmpdir(), "ogsystem-app-parent-"));

  const packManager = resolveNodeManagedCommand("pnpm");
  const packResult = await runCommand(
    packManager.command,
    [...packManager.argsPrefix, "pack", "--pack-destination", packDir],
    { cwd: repoRoot }
  );
  assert.equal(packResult.code, 0, packResult.stderr);
  const packedFiles = await readdir(packDir);
  const tarballName = packedFiles.find((entry) => /^ogsystem-\d+\.\d+\.\d+\.tgz$/.test(entry));
  assert.ok(tarballName, `expected ogsystem tarball in ${packDir}`);
  const tarballPath = path.resolve(packDir, tarballName);

  const installNodeModulesDir = path.resolve(installDir, "node_modules");
  const installedPackageDir = path.resolve(installNodeModulesDir, "ogsystem");
  await mkdir(installedPackageDir, { recursive: true });
  const unpackResult = await runCommand("tar", [
    "-xzf",
    tarballPath,
    "-C",
    installedPackageDir,
    "--strip-components=1"
  ]);
  assert.equal(unpackResult.code, 0, unpackResult.stderr);

  // Mirror runtime dependencies into an installation-like node_modules layout without registry access.
  for (const dependencyName of Object.keys(installPackageJson.dependencies ?? {})) {
    if (dependencyName === "ogsystem") {
      continue;
    }
    const targetPath = path.resolve(installNodeModulesDir, dependencyName);
    const sourcePath = path.resolve(repoRoot, "node_modules", dependencyName);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await symlink(sourcePath, targetPath);
  }

  const ogsBinPath = path.resolve(installedPackageDir, "bin", "ogs.mjs");
  const ogsDoctorBinPath = path.resolve(installedPackageDir, "bin", "ogs-doctor.mjs");
  await stat(ogsBinPath);
  await stat(ogsDoctorBinPath);
  await stat(path.resolve(installedPackageDir, "scripts", "preinstall.cjs"));
  await assert.rejects(() => stat(path.resolve(installedPackageDir, "og-roles", "importers")), /ENOENT/);
  await assert.rejects(() => stat(path.resolve(installedPackageDir, "og-roles", "scripts")), /ENOENT/);
  await assert.rejects(
    () => stat(path.resolve(installedPackageDir, "og-roles", "sources.lock.json")),
    /ENOENT/
  );
  await assert.rejects(() => stat(path.resolve(installedPackageDir, "og-models")), /ENOENT/);
  await assert.rejects(() => stat(path.resolve(installedPackageDir, "agent-sources")), /ENOENT/);
  await assert.rejects(() => stat(path.resolve(installedPackageDir, "tools", "agent-source")), /ENOENT/);

  const helpResult = await runCommand("node", [ogsBinPath, "help"], { cwd: installDir });
  assert.equal(helpResult.code, 0, helpResult.stderr);
  assert.match(helpResult.stdout, /ogs project <init\|create\|sync\|sync-models>/);

  const doctorHelpResult = await runCommand("node", [ogsDoctorBinPath, "--help"], {
    cwd: installDir
  });
  assert.equal(doctorHelpResult.code, 0, doctorHelpResult.stderr);
  assert.match(doctorHelpResult.stdout, /--required <csv>/);

  const createResult = await runCommand(
    "node",
    [ogsBinPath, "project", "create", "demo-app", "--template", "minimal"],
    { cwd: appParent }
  );
  assert.equal(createResult.code, 0, createResult.stderr);
  const createPayload = JSON.parse(createResult.stdout);
  const projectDir = createPayload.projectDir;

  await stat(path.resolve(projectDir, "og-roles", "roles", "demo-analyst", "role.json"));
  await assert.rejects(() => stat(path.resolve(projectDir, "og-roles", "roles", "debate-judge")), /ENOENT/);
  const ogsReadmePath = path.resolve(projectDir, ".ogs", "README.md");
  await stat(path.resolve(projectDir, ".ogs", "model-catalog.json"));
  await stat(path.resolve(projectDir, ".ogs", "model-selection.json"));
  const ogsReadme = await readFile(ogsReadmePath, "utf8");
  await assert.rejects(() => stat(path.resolve(projectDir, "og-models")), /ENOENT/);
  assert.match(ogsReadme, /providers\/opencode\.json/);
  assert.match(ogsReadme, /Use this README for operator notes and examples/);

  const startResult = await runCommand(
    "node",
    [ogsBinPath, "run", "start", "--system", "system.mmd", "--input", "packaged smoke", "--dry-run"],
    { cwd: projectDir }
  );
  assert.equal(startResult.code, 0, startResult.stderr);
  const startPayload = JSON.parse(startResult.stdout);
  assert.equal(startPayload.status, "done");

  const runIds = await readdir(path.resolve(projectDir, ".ogs", "runs"));
  assert.ok(runIds.length > 0, "expected at least one generated run directory");
  const reproScript = await readFile(
    path.resolve(projectDir, ".ogs", "runs", runIds[0], "repro.sh"),
    "utf8"
  );
  assert.match(reproScript, /\bogs "\$\{ARGS\[@\]\}"/);
  assert.doesNotMatch(reproScript, /pnpm run run:adapter/);
});
