import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

const hasCargo = (() => {
  const result = spawnSync("cargo", ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
})();

test(
  "rust hello pipeline validates development/compile/package-run full flow",
  { skip: !hasCargo },
  async () => {
    const repoRoot = process.cwd();
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-rust-hello-"));
    const runsDir = path.resolve(tempRoot, "runs");
    const runtimePath = path.resolve(tempRoot, "runtime.json");

    await writeFile(
      runtimePath,
      JSON.stringify(
        {
          executor: "opencode",
          roleRepo: "./og-roles",
          runsDir
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await runSystemWithAdapter({
      systemPath: path.resolve(repoRoot, "examples", "rust-hello-pipeline", "system.mmd"),
      runtimeConfigPath: runtimePath,
      profilesPath: path.resolve(repoRoot, "examples", "rust-hello-pipeline", "profiles.json"),
      toolsPath: path.resolve(repoRoot, "examples", "rust-hello-pipeline", "tools.json"),
      lawsPath: path.resolve(repoRoot, ".ogs", "laws.json"),
      userProfilePath: path.resolve(repoRoot, ".ogs", "user-profile.json"),
      prompt: "validate rust hello pipeline",
      workdir: repoRoot
    });

    assert.equal(result.status, "done");
    assert.equal(result.finalOutput, "hello from OGSystem rust pipeline");

    const runIds = await readdir(runsDir);
    assert.equal(runIds.length, 1);
    const runDir = path.resolve(runsDir, runIds[0]);
    const binaryName = process.platform === "win32" ? "hello_ogsystem.exe" : "hello_ogsystem";

    await access(path.resolve(runDir, "shared", "rust-hello", "Cargo.toml"));
    await access(path.resolve(runDir, "shared", "rust-hello", "src", "main.rs"));
    await access(path.resolve(runDir, "shared", "rust-hello", "target", "release", binaryName));
    await access(path.resolve(runDir, "shared", "package", binaryName));
    await access(path.resolve(runDir, "events.ndjson"));
    await access(path.resolve(runDir, "logs", "roles", "rust-developer.ndjson"));
    await access(path.resolve(runDir, "logs", "roles", "rust-compiler.ndjson"));
    await access(path.resolve(runDir, "logs", "roles", "rust-packager.ndjson"));

    const state = JSON.parse(await readFile(path.resolve(runDir, "state.json"), "utf8"));
    assert.equal(state.status, "done");
    assert.equal(state.finalRoleId, "rust-packager");
  }
);
