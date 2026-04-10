import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { validateRuntimeConfig } from "../dist/runtime/config.js";
import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

test("adapter fails early on invalid profile config with file path and field path", async () => {
  await assert.rejects(
    () =>
      runSystemWithAdapter({
        systemPath: path.resolve("tests/fixtures/mermaid/branch-system.mmd"),
        profilesPath: path.resolve("tests/fixtures/profiles/invalid-profiles.json"),
        toolsPath: path.resolve("tests/fixtures/tools/branch-tools.json"),
        lawsPath: path.resolve("tests/fixtures/laws/law-branch.json"),
        prompt: "config test",
        workdir: process.cwd()
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /invalid-profiles\.json/);
      assert.match(error.message, /\$\[0\]\.toolPolicy/);
      return true;
    }
  );
});

test("runtime config rejects removed linkSharedIntoRoleDir field", () => {
  assert.throws(
    () =>
      validateRuntimeConfig(
        {
          executor: "opencode",
          roleRepo: "./og-roles",
          modelRepo: "./og-models",
          runsDir: ".ogsystems",
          workspace: {
            rolesDir: "roles",
            privateDirName: "private",
            linkSharedIntoRoleDir: false
          }
        },
        "runtime.json"
      ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /runtime\.json/);
      assert.match(error.message, /\.workspace\.linkSharedIntoRoleDir/);
      return true;
    }
  );
});

test("runtime config validates every supported runtime field", () => {
  const config = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      modelRepo: "./og-models",
      runsDir: ".ogsystems",
      sharedDir: "./shared-workspace",
      workspace: {
        rolesDir: "roles",
        privateDirName: "private"
      },
      opencode: {
        baseArgs: ["run", "--json"]
      }
    },
    "runtime.json"
  );

  assert.equal(config.executor, "opencode");
  assert.equal(config.sharedDir, "./shared-workspace");
  assert.deepStrictEqual(config.workspace, {
    rolesDir: "roles",
    privateDirName: "private"
  });
  assert.deepStrictEqual(config.opencode?.baseArgs, ["run", "--json"]);
});

test("runtime config accepts every supported field", () => {
  const config = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      modelRepo: "./og-models",
      runsDir: ".ogsystems",
      sharedDir: "./shared-workspace",
      workspace: {
        rolesDir: "roles",
        privateDirName: "private"
      },
      opencode: {
        baseArgs: ["run", "--json"]
      }
    },
    "runtime.json"
  );

  assert.equal(config.sharedDir, "./shared-workspace");
  assert.deepStrictEqual(config.opencode?.baseArgs, ["run", "--json"]);
  assert.deepStrictEqual(config.workspace, {
    rolesDir: "roles",
    privateDirName: "private"
  });
});
