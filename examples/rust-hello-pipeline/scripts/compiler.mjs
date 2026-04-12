import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const sharedDir = process.env.OGSYSTEM_SHARED_DIR;
if (!sharedDir) {
  process.stderr.write("missing OGSYSTEM_SHARED_DIR\n");
  process.exit(1);
}

const projectDir = path.resolve(sharedDir, "rust-hello");
const manifestPath = path.resolve(projectDir, "Cargo.toml");
const result = spawnSync("cargo", ["build", "--release", "--manifest-path", manifestPath], {
  encoding: "utf8"
});

if (result.error) {
  process.stderr.write(`failed to spawn cargo: ${result.error.message}\n`);
  process.exit(1);
}
if (result.status !== 0) {
  process.stderr.write(result.stderr || `cargo build failed with code ${result.status}\n`);
  process.exit(result.status ?? 1);
}

const binaryName = process.platform === "win32" ? "hello_ogsystem.exe" : "hello_ogsystem";
const binaryPath = path.resolve(projectDir, "target", "release", binaryName);
try {
  await access(binaryPath);
} catch {
  process.stderr.write(`compiled binary not found: ${binaryPath}\n`);
  process.exit(1);
}

process.stdout.write(
  JSON.stringify({
    event: "COMPILE_DONE",
    content: `Rust project compiled: ${binaryPath}`,
    data: {
      binaryPath
    }
  })
);
