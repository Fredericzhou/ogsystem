import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function resolvePnpmBin() {
  if (process.env.PNPM_BIN) return process.env.PNPM_BIN;
  if (process.platform !== "win32") return "pnpm";

  // Windows can resolve a bare pnpm.cmd through a stale Corepack shim or a
  // parent workspace. Prefer the package-manager shim beside the active Node
  // executable, while retaining PATH lookup for Volta and custom installs.
  const colocatedPnpm = path.join(path.dirname(process.execPath), "pnpm.cmd");
  return existsSync(colocatedPnpm) ? colocatedPnpm : "pnpm.cmd";
}

const PNPM_BIN = resolvePnpmBin();

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const { env, ...spawnOptions } = options;
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ...(env ?? {})
        },
        shell: false,
        ...spawnOptions
      });
    } catch (error) {
      resolve({
        code: 1,
        signal: null,
        stdout,
        stderr: error instanceof Error ? error.message : String(error),
        error
      });
      return;
    }
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        code: 1,
        signal: null,
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`,
        error
      });
    });
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function quoteCmd(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

function runPnpm(args) {
  if (process.platform !== "win32") {
    return run(PNPM_BIN, args);
  }
  const commandLine = `call ${quoteCmd(PNPM_BIN)} ${args.map(quoteCmd).join(" ")}`;
  return run("cmd.exe", ["/d", "/s", "/c", commandLine], {
    windowsVerbatimArguments: true
  });
}

const buildResult = await runPnpm(["run", "build"]);
process.stdout.write(buildResult.stdout);
process.stderr.write(buildResult.stderr);
if (buildResult.code !== 0) {
  console.error("[visualizer-browser] Build failed before browser smoke.");
  process.exit(buildResult.code ?? 1);
}

let temporaryPlaywrightConfig;
const playwrightBaseArgs = ["exec", "playwright", "test"];
const playwrightSpecs = [
  "tests-e2e/visualizer-studio-graph.spec.ts",
  "tests-e2e/visualizer-build-layout.spec.ts"
];
let playwrightConfigArgs = [
  // Each case starts a real file-backed visualizer. Serial execution keeps
  // X6 layout paints and Windows port/process scheduling deterministic.
  "--workers=1"
];
const systemChromeCandidates = process.platform === "darwin"
  ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  : process.platform === "win32"
    ? [
        path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe")
      ]
    : [];
const systemChrome = process.env.OGSYSTEM_USE_SYSTEM_CHROME === "1"
  ? systemChromeCandidates.find((candidate) => existsSync(candidate))
  : undefined;
if (systemChrome) {
  temporaryPlaywrightConfig = path.join(
    await mkdtemp(path.join(os.tmpdir(), "ogsystem-playwright-config-")),
    "playwright.config.mjs"
  );
  const testPackage = path.resolve("node_modules/@playwright/test/index.mjs").replaceAll("\\", "\\\\");
  const testRoot = process.cwd().replaceAll("\\", "\\\\");
  await writeFile(
    temporaryPlaywrightConfig,
    [
      `import { defineConfig } from ${JSON.stringify(testPackage)};`,
      "export default defineConfig({",
      `  testDir: ${JSON.stringify(path.join(testRoot, "tests-e2e"))},`,
      "  use: {",
      "    browserName: \"chromium\",",
      `    launchOptions: { executablePath: ${JSON.stringify(systemChrome)} },`,
      "    headless: true",
      "  }",
      "});",
      ""
    ].join("\n"),
    "utf8"
  );
  playwrightConfigArgs = [...playwrightConfigArgs, `--config=${temporaryPlaywrightConfig}`];
}
if (process.env.OGSYSTEM_UPDATE_VISUALIZER_SNAPSHOTS === "1") {
  playwrightConfigArgs.push("--update-snapshots");
}

let playwrightResult = { code: 0, signal: null, stdout: "", stderr: "" };
for (const spec of playwrightSpecs) {
  const result = await runPnpm([...playwrightBaseArgs, spec, ...playwrightConfigArgs]);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.code !== 0) {
    playwrightResult = result;
    break;
  }
}
if (temporaryPlaywrightConfig) {
  await rm(path.dirname(temporaryPlaywrightConfig), { recursive: true, force: true });
}
if (playwrightResult.code === 0) {
  process.exit(0);
}

const failedToStartBrowser = /(?:Executable doesn't exist|Host system is missing dependencies|BrowserType\.launch|browserType\.launch|chromium|chrome|failed to launch|Target closed|SIGTRAP|ENOENT|spawn .*playwright)/i.test(
  `${playwrightResult.stdout}\n${playwrightResult.stderr}`
);
if (failedToStartBrowser) {
  console.error("[visualizer-browser] Browser environment failed before app assertions.");
} else {
  console.error("[visualizer-browser] Playwright app assertion failure.");
}
process.exit(playwrightResult.code ?? 1);
