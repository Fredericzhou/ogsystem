import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  validateLawsConfig,
  validateProfilesConfig,
  validateRuntimeConfig,
  validateToolsConfig
} from "../dist/runtime/config.js";
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
          runsDir: ".ogs/runs",
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
      runsDir: ".ogs/runs",
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
    privateDirName: "private",
    workspaceIsolation: "role"
  });
  assert.deepStrictEqual(config.opencode?.baseArgs, ["run", "--json"]);
});

test("runtime config accepts every supported field", () => {
  const config = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      modelRepo: "./og-models",
      runsDir: ".ogs/runs",
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
    privateDirName: "private",
    workspaceIsolation: "role"
  });
});

test("runtime config defaults runsDir to .ogs/runs", () => {
  const config = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      modelRepo: "./og-models"
    },
    "runtime.json"
  );

  assert.equal(config.runsDir, ".ogs/runs");
});

test("runtime config accepts retention policy with defaults", () => {
  const config = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      modelRepo: "./og-models",
      retention: {}
    },
    "runtime.json"
  );

  assert.deepStrictEqual(config.retention, {
    enabled: false,
    executionDirThreshold: 2000,
    keepLatest: 100
  });
});

test("runtime config rejects invalid retention thresholds", () => {
  assert.throws(
    () =>
      validateRuntimeConfig(
        {
          executor: "opencode",
          roleRepo: "./og-roles",
          modelRepo: "./og-models",
          retention: {
            enabled: true,
            executionDirThreshold: 0,
            keepLatest: -1
          }
        },
        "runtime.json"
      ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /runtime\.json/);
      assert.match(error.message, /\.retention\.executionDirThreshold/);
      return true;
    }
  );
});

test("runtime config rejects invalid retention keepLatest", () => {
  assert.throws(
    () =>
      validateRuntimeConfig(
        {
          executor: "opencode",
          roleRepo: "./og-roles",
          modelRepo: "./og-models",
          retention: {
            enabled: true,
            executionDirThreshold: 10,
            keepLatest: 0
          }
        },
        "runtime.json"
      ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /runtime\.json/);
      assert.match(error.message, /\.retention\.keepLatest/);
      return true;
    }
  );
});

test("runtime config fails fast on unsupported config version", () => {
  assert.throws(
    () =>
      validateRuntimeConfig(
        {
          configVersion: "999",
          executor: "opencode",
          roleRepo: "./og-roles"
        },
        "runtime.json"
      ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /runtime\.json/);
      assert.match(error.message, /\.configVersion/);
      assert.match(error.message, /unsupported config version "999"/);
      return true;
    }
  );
});

test("runtime config defaults runtime.error_flows.v1 to false", () => {
  const config = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      modelRepo: "./og-models"
    },
    "runtime.json"
  );

  assert.equal(config.runtime.error_flows.v1, false);
});

test("runtime config accepts runtime.error_flows.v1 when set to true", () => {
  const config = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      modelRepo: "./og-models",
      runtime: {
        error_flows: {
          v1: true
        }
      }
    },
    "runtime.json"
  );

  assert.equal(config.runtime.error_flows.v1, true);
});

test("runtime config accepts redaction and branch workspace isolation", () => {
  const config = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      modelRepo: "./og-models",
      redaction: {
        enabled: true
      },
      workspace: {
        rolesDir: "roles",
        privateDirName: "private",
        workspaceIsolation: "branch"
      }
    },
    "runtime.json"
  );

  assert.equal(config.redaction?.enabled, true);
  assert.equal(config.workspace.workspaceIsolation, "branch");
});

test("runtime config rejects unknown runtime error_flows fields", () => {
  assert.throws(
    () =>
      validateRuntimeConfig(
        {
          executor: "opencode",
          roleRepo: "./og-roles",
          modelRepo: "./og-models",
          runtime: {
            error_flows: {
              v1: true,
              beta: true
            }
          }
        },
        "runtime.json"
      ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /runtime\.json/);
      assert.match(error.message, /\.runtime\.error_flows\.beta/);
      return true;
    }
  );
});

test("profiles config rejects duplicate profileId entries", () => {
  assert.throws(
    () =>
      validateProfilesConfig(
        [
          {
            profileId: "profile.same",
            toolRef: "tool.a"
          },
          {
            profileId: "profile.same",
            toolRef: "tool.b"
          }
        ],
        "profiles.json"
      ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /profiles\.json/);
      assert.match(error.message, /\$\[1\]\.profileId/);
      assert.match(error.message, /duplicate profileId "profile\.same"/);
      return true;
    }
  );
});

test("tools config rejects duplicate toolRef entries", () => {
  assert.throws(
    () =>
      validateToolsConfig(
        {
          tools: [
            {
              toolRef: "tool.same",
              runner: "local_shell",
              command: "echo",
              argsTemplate: [],
              stdinMode: "none"
            },
            {
              toolRef: "tool.same",
              runner: "local_shell",
              command: "cat",
              argsTemplate: [],
              stdinMode: "none"
            }
          ]
        },
        "tools.json"
      ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /tools\.json/);
      assert.match(error.message, /\$\.tools\[1\]\.toolRef/);
      assert.match(error.message, /duplicate toolRef "tool\.same"/);
      return true;
    }
  );
});

test("laws config rejects duplicate lawId entries", () => {
  assert.throws(
    () =>
      validateLawsConfig(
        {
          laws: [
            {
              lawId: "law.same"
            },
            {
              lawId: "law.same"
            }
          ]
        },
        "laws.json"
      ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /laws\.json/);
      assert.match(error.message, /\$\.laws\[1\]\.lawId/);
      assert.match(error.message, /duplicate lawId "law\.same"/);
      return true;
    }
  );
});
