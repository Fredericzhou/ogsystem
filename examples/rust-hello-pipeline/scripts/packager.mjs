import { access, chmod, copyFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const sharedDir = process.env.OGSYSTEM_SHARED_DIR;
if (!sharedDir) {
  process.stderr.write("missing OGSYSTEM_SHARED_DIR\n");
  process.exit(1);
}

const projectDir = path.resolve(sharedDir, "rust-hello");
const binaryName = process.platform === "win32" ? "hello_ogsystem.exe" : "hello_ogsystem";
const binaryPath = path.resolve(projectDir, "target", "release", binaryName);

try {
  await access(binaryPath);
} catch {
  process.stderr.write(`binary not found for packaging: ${binaryPath}\n`);
  process.exit(1);
}

const packageDir = path.resolve(sharedDir, "package");
await mkdir(packageDir, { recursive: true });
const packagedBinaryPath = path.resolve(packageDir, binaryName);
await copyFile(binaryPath, packagedBinaryPath);
if (process.platform !== "win32") {
  await chmod(packagedBinaryPath, 0o755);
}

const runResult = spawnSync(packagedBinaryPath, [], { encoding: "utf8" });
if (runResult.error) {
  process.stderr.write(`failed to run packaged binary: ${runResult.error.message}\n`);
  process.exit(1);
}
if (runResult.status !== 0) {
  process.stderr.write(runResult.stderr || `packaged binary exited with ${runResult.status}\n`);
  process.exit(runResult.status ?? 1);
}

const stdout = (runResult.stdout ?? "").trim();
const expected = "hello from OGSystem rust pipeline";
if (stdout !== expected) {
  process.stderr.write(`unexpected binary output: "${stdout}" (expected "${expected}")\n`);
  process.exit(1);
}

process.stdout.write(
  JSON.stringify({
    event: "PACKAGE_DONE",
    content: stdout,
    data: {
      packagedBinaryPath
    }
  })
);
