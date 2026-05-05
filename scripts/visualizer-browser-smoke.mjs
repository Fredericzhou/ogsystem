import { spawn } from "node:child_process";

const PNPM_BIN = process.env.PNPM_BIN || (process.platform === "win32" ? "pnpm.cmd" : "pnpm");

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

const playwrightResult = await runPnpm(["exec", "playwright", "test", "tests-e2e/visualizer-studio-graph.spec.ts"]);
process.stdout.write(playwrightResult.stdout);
process.stderr.write(playwrightResult.stderr);
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
