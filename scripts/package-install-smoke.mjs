import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import os from "node:os";
import path, { dirname } from "node:path";

const repoRoot = process.cwd();
const packageManager = process.argv[2];
const opencodeModelsFixturePath = path.resolve(repoRoot, "tests/fixtures/opencode-models-verbose.txt");

if (packageManager !== "npm" && packageManager !== "pnpm") {
  console.error("Usage: node scripts/package-install-smoke.mjs <npm|pnpm>");
  process.exit(1);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: useShell
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

function waitForProcessOutput(child, pattern, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${pattern}; stdout=${stdout}; stderr=${stderr}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const scan = () => {
      const match = `${stdout}\n${stderr}`.match(pattern);
      if (match) {
        cleanup();
        resolve({ match, stdout, stderr });
      }
    };
    const onStdout = (chunk) => {
      stdout += chunk.toString();
      scan();
    };
    const onStderr = (chunk) => {
      stderr += chunk.toString();
      scan();
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Process exited before ${pattern}; code=${code}; stdout=${stdout}; stderr=${stderr}`));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("exit", onExit);
    child.on("error", onError);
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
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

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), `ogsystem-install-smoke-${packageManager}-`));
  const packDir = path.resolve(tempRoot, "pack");
  const installDir = path.resolve(tempRoot, "install");
  const appParent = path.resolve(tempRoot, "apps");
  const cacheDir = path.resolve(tempRoot, "cache");
  await mkdir(packDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(appParent, { recursive: true });
  await mkdir(cacheDir, { recursive: true });

  const isolatedEnv = {
    ...process.env,
    HOME: tempRoot,
    XDG_CACHE_HOME: cacheDir,
    npm_config_cache: path.resolve(cacheDir, "npm"),
    OGSYSTEM_OPENCODE_MODELS_STDOUT_FILE: opencodeModelsFixturePath
  };
  const packManager = resolveNodeManagedCommand("pnpm");

  const packResult = await runCommand(
    packManager.command,
    [...packManager.argsPrefix, "pack", "--pack-destination", packDir],
    {
    cwd: repoRoot,
    env: isolatedEnv
    }
  );
  assert.equal(packResult.code, 0, packResult.stderr);

  const packedFiles = await readdir(packDir);
  const tarballName = packedFiles.find((entry) => /^ogsystem-\d+\.\d+\.\d+\.tgz$/.test(entry));
  assert.ok(tarballName, `expected ogsystem tarball in ${packDir}`);
  const tarballPath = path.resolve(packDir, tarballName);

  await writeFile(
    path.resolve(installDir, "package.json"),
    JSON.stringify(
      {
        name: "ogsystem-install-smoke",
        private: true
      },
      null,
      2
    ),
    "utf8"
  );

  const installManager = resolveNodeManagedCommand(packageManager);
  const installResult = await runCommand(
    installManager.command,
    [
      ...installManager.argsPrefix,
      ...(packageManager === "npm"
        ? ["install", tarballPath]
        : ["add", tarballPath])
    ],
    { cwd: installDir, env: isolatedEnv }
  );
  if (packageManager === "pnpm" && installResult.code !== 0 && /IGNORED_BUILDS/.test(installResult.stdout)) {
    const approveResult = await runCommand(
      installManager.command,
      [...installManager.argsPrefix, "approve-builds", "--all"],
      { cwd: installDir, env: isolatedEnv }
    );
    assert.equal(approveResult.code, 0, approveResult.stderr);
    const rebuildResult = await runCommand(
      installManager.command,
      [...installManager.argsPrefix, "rebuild", "ogsystem"],
      { cwd: installDir, env: isolatedEnv }
    );
    assert.equal(rebuildResult.code, 0, rebuildResult.stderr);
  } else {
    assert.equal(
      installResult.code,
      0,
      `package install failed via ${packageManager}\nstdout=${installResult.stdout}\nstderr=${installResult.stderr}`
    );
  }

  const installedPackageDir = path.resolve(installDir, "node_modules", "ogsystem");
  const ogsBinPath = path.resolve(installedPackageDir, "bin", "ogs.mjs");
  await stat(ogsBinPath);

  const helpResult = await runCommand("node", [ogsBinPath, "help"], {
    cwd: installDir,
    env: isolatedEnv
  });
  assert.equal(helpResult.code, 0, helpResult.stderr);
  assert.match(helpResult.stdout, /project\s+Init, create, or sync project files/);

  const systemHomeDir = path.resolve(tempRoot, ".ogsystem");
  await stat(path.resolve(systemHomeDir, "roles"));
  await stat(path.resolve(systemHomeDir, "roles", "hello-ogsystem", "role.json"));
  const systemEnvExample = await readFile(path.resolve(systemHomeDir, ".env.example"), "utf8");
  assert.match(systemEnvExample, /^SILICONFLOW_API_KEY=$/m);
  assert.match(systemEnvExample, /^OLLAMA_BASE_URL=$/m);
  const installMetadata = JSON.parse(await readFile(path.resolve(systemHomeDir, "install.json"), "utf8"));
  assert.equal(installMetadata.package, "ogsystem");
  assert.equal(installMetadata.rolesDir, "roles");

  const doctorHelpResult = await runCommand("node", [ogsBinPath, "doctor", "--help"], {
    cwd: installDir,
    env: isolatedEnv
  });
  assert.equal(doctorHelpResult.code, 0, doctorHelpResult.stderr);
  assert.match(doctorHelpResult.stdout, /--required <csv>/);

  const createResult = await runCommand(
    "node",
    [ogsBinPath, "project", "create", "demo-app", "--template", "minimal", "--workdir", appParent],
    { cwd: installDir, env: isolatedEnv }
  );
  assert.equal(createResult.code, 0, createResult.stderr);

  const createPayload = JSON.parse(createResult.stdout);
  const projectDir = createPayload.projectDir;
  await stat(path.resolve(projectDir, "og-roles", "roles", "hello-ogsystem", "role.json"));
  await stat(path.resolve(projectDir, "scripts", "hello-ogsystem.mjs"));
  await assert.rejects(() => stat(path.resolve(projectDir, "og-roles", "roles", "demo-analyst")), /ENOENT/);
  await assert.rejects(() => stat(path.resolve(projectDir, "og-roles", "roles", "debate-judge")), /ENOENT/);
  const ogsReadmePath = path.resolve(projectDir, ".ogs", "README.md");
  await stat(path.resolve(projectDir, ".ogs", "model-catalog.json"));
  await stat(path.resolve(projectDir, ".ogs", "model-selection.json"));
  await assert.rejects(() => stat(path.resolve(projectDir, ".ogs", "providers")), /ENOENT/);
  await assert.rejects(() => stat(path.resolve(projectDir, "og-models")), /ENOENT/);
  const ogsReadme = await readFile(ogsReadmePath, "utf8");
  assert.match(ogsReadme, /\.ogsystem\/\.env/);
  assert.doesNotMatch(ogsReadme, /providers\/opencode\.json/);
  assert.match(ogsReadme, /Use this README for operator notes and examples/);

  const startResult = await runCommand(
    "node",
    [ogsBinPath, "run", "start", "--system", "system.mmd", "--input", "install smoke"],
    { cwd: projectDir, env: isolatedEnv }
  );
  assert.equal(startResult.code, 0, startResult.stderr);

  const startPayload = JSON.parse(startResult.stdout);
  assert.equal(startPayload.status, "done");
  assert.equal(startPayload.finalRoleId, "hello-ogsystem");
  assert.equal(startPayload.finalOutput, "Hello OGSystem world");

  const visualizer = spawn("node", [ogsBinPath, "visualizer", "--workdir", projectDir, "--port", "0"], {
    cwd: projectDir,
    env: isolatedEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    const startup = await waitForProcessOutput(
      visualizer,
      /OGSystem Visualizer listening on (http:\/\/[^\s]+)/,
      15000
    );
    const url = startup.match[1];
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /OGSystem/);
    assert.match(html, /visualizer/i);
  } finally {
    await stopChild(visualizer);
  }

  console.log(`package install smoke passed via ${packageManager}`);
}

await main();
