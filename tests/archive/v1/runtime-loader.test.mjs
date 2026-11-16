import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  loadProfiles,
  loadRuntimeConfig,
  loadTools
} from "../dist/runtime/runtime-loader.js";

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-runtime-loader-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadProfiles auto-discovers profiles.json from workdir", async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      path.join(dir, "profiles.json"),
      JSON.stringify([
        {
          profileId: "profile.office-hours",
          toolRef: "tool.office-hours",
          timeoutMs: 1200
        }
      ]),
      "utf8"
    );

    const profiles = await loadProfiles(undefined, dir);

    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].profileId, "profile.office-hours");
    assert.equal(profiles[0].toolRef, "tool.office-hours");
    assert.equal(profiles[0].timeoutMs, 1200);
  });
});

test("loadTools auto-discovers tools.json from workdir", async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      path.join(dir, "tools.json"),
      JSON.stringify({
        tools: [
          {
            toolRef: "tool.office-hours",
            runner: "local_shell",
            command: "node",
            argsTemplate: ["scripts/emit-role-result.mjs"],
            stdinMode: "none"
          }
        ]
      }),
      "utf8"
    );

    const tools = await loadTools(undefined, dir);

    assert.equal(tools.length, 1);
    assert.equal(tools[0].toolRef, "tool.office-hours");
    assert.equal(tools[0].command, "node");
  });
});

test("loadRuntimeConfig overlays project .ogs/runtime.json over defaults", async () => {
  await withTempDir(async (dir) => {
    await mkdir(path.join(dir, ".ogs"), { recursive: true });
    await writeFile(
      path.join(dir, ".ogs", "runtime.json"),
      JSON.stringify({
        executor: "opencode",
        roleRepo: "./og-roles",
        workspace: {
          workspaceIsolation: "branch"
        },
        runtime: {
          error_flows: {
            v1: true
          }
        }
      }),
      "utf8"
    );

    const runtimeConfig = await loadRuntimeConfig(undefined, dir);

    assert.equal(runtimeConfig.roleRepo, "./og-roles");
    assert.equal(runtimeConfig.workspace.rolesDir, "roles");
    assert.equal(runtimeConfig.workspace.privateDirName, "private");
    assert.equal(runtimeConfig.workspace.workspaceIsolation, "branch");
    assert.equal(runtimeConfig.runtime.error_flows.v1, true);
  });
});
