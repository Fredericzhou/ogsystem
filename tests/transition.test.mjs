import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

test("branch node follows explicit event output", async () => {
  const isolatedWorkdir = await mkdtemp(path.join(tmpdir(), "ogsystem-transition-test-"));
  const runtimeDir = path.resolve(isolatedWorkdir, ".ogs");
  await mkdir(runtimeDir, { recursive: true });
  const runtimeConfigPath = path.resolve(runtimeDir, "runtime.json");
  const toolsPath = path.resolve(isolatedWorkdir, "branch-tools.json");
  await writeFile(
    runtimeConfigPath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: path.resolve("og-roles"),
        runsDir: ".ogs/runs"
      },
      null,
      2
    )
  );
  await writeFile(
    toolsPath,
    JSON.stringify(
      {
        tools: [
          {
            toolRef: "tool.branch",
            runner: "local_shell",
            command: "node",
            argsTemplate: [path.resolve("tests/fixtures/scripts/branch-tool.js"), "PATH_A"],
            stdinMode: "none"
          }
        ]
      },
      null,
      2
    )
  );
  const result = await runSystemWithAdapter({
    systemPath: path.resolve("tests/fixtures/mermaid/branch-system.mmd"),
    profilesPath: path.resolve("tests/fixtures/profiles/branch-profiles.json"),
    toolsPath,
    lawsPath: path.resolve("tests/fixtures/laws/law-branch.json"),
    runtimeConfigPath,
    prompt: "branch routing",
    workdir: isolatedWorkdir,
    dryRun: false
  });
  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "test-branch-a");
  assert.strictEqual(result.auditTrail[0]?.selectedEvent, "PATH_A");
});
