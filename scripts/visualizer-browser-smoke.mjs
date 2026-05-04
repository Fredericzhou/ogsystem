import { spawn } from "node:child_process";

const PNPM_BIN = process.env.PNPM_BIN || "/Users/maple/.volta/bin/pnpm";

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      shell: false,
      ...options
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

const buildResult = await run(PNPM_BIN, ["run", "build"]);
process.stdout.write(buildResult.stdout);
process.stderr.write(buildResult.stderr);
if (buildResult.code !== 0) {
  process.exit(buildResult.code ?? 1);
}

const playwrightResult = await run(PNPM_BIN, ["exec", "playwright", "test", "tests-e2e/visualizer-studio-graph.spec.ts"]);
process.stdout.write(playwrightResult.stdout);
process.stderr.write(playwrightResult.stderr);
if (playwrightResult.code === 0) {
  process.exit(0);
}

const failedToStartBrowser = /(?:SIGTRAP|BrowserType\.launch|playwright|chromium|failed to launch|Target closed)/i.test(
  `${playwrightResult.stdout}\n${playwrightResult.stderr}`
);
if (failedToStartBrowser) {
  console.error("[visualizer-browser] Browser environment failed before app assertions.");
} else {
  console.error("[visualizer-browser] Playwright app assertion failure.");
}
process.exit(playwrightResult.code ?? 1);
