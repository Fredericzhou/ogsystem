import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const preinstallScriptPath = path.resolve("scripts/preinstall.cjs");
const releaseValidationWorkflowPath = path.resolve(".github/workflows/release-package-validation.yml");

test("release package matrix verifies the exact tarball digest produced by the package job", async () => {
  const workflow = await readFile(releaseValidationWorkflowPath, "utf8");
  assert.match(workflow, /outputs:\n\s+sha256: \$\{\{ steps\.digest\.outputs\.sha256 \}\}/);
  assert.match(workflow, /EXPECTED_SHA256: \$\{\{ needs\.package\.outputs\.sha256 \}\}/);
  assert.match(workflow, /Candidate digest mismatch/);
  assert.match(workflow, /Verify candidate tarball digest[\s\S]*?Install, create project, and run from candidate tarball/);
});

function runPreinstall(cwd, userAgent) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [preinstallScriptPath], {
      cwd,
      env: {
        ...process.env,
        npm_config_user_agent: userAgent
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("preinstall allows npm installs outside repository-development checkouts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-preinstall-open-"));
  const result = await runPreinstall(tempRoot, "npm/10.9.0 node/v22.21.1 darwin arm64");
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
});

test("preinstall rejects npm installs in repository-development checkouts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-preinstall-guard-"));
  await writeFile(path.resolve(tempRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  const result = await runPreinstall(tempRoot, "npm/10.9.0 node/v22.21.1 darwin arm64");
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Use pnpm only for repository development/);
});

test("preinstall allows npm global installs from repository-development checkouts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-preinstall-global-"));
  await writeFile(path.resolve(tempRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  const result = await new Promise((resolve, reject) => {
    const child = spawn("node", [preinstallScriptPath], {
      cwd: tempRoot,
      env: {
        ...process.env,
        npm_config_user_agent: "npm/10.9.0 node/v22.21.1 darwin arm64",
        npm_config_global: "true"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
});

test("preinstall allows pnpm installs in repository-development checkouts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-preinstall-pnpm-"));
  await writeFile(path.resolve(tempRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  const result = await runPreinstall(tempRoot, "pnpm/10.14.0 npm/? node/v22.21.1 darwin arm64");
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
});
