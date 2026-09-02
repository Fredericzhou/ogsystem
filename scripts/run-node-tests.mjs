import { spawn } from "node:child_process";

const args = [
  "--test",
  // Several lifecycle tests intentionally exercise the shared system role installation.
  // Serial execution keeps those filesystem mutations isolated on every platform.
  "--test-concurrency=1",
  "tests/*.mjs"
];

const child = spawn(process.execPath, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("close", (code, signal) => {
  if (signal) {
    console.error(`node test runner exited with signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
