import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

const baseArgs = {
  systemPath: path.resolve("tests/fixtures/mermaid/branch-system.mmd"),
  profilesPath: path.resolve("tests/fixtures/profiles/branch-profiles.json"),
  toolsPath: path.resolve("tests/fixtures/tools/branch-tools.json"),
  lawsPath: path.resolve("tests/fixtures/laws/law-branch.json"),
  prompt: "branch routing",
  workdir: process.cwd()
};

test("branch node follows explicit event output", async () => {
  const result = await runSystemWithAdapter({ ...baseArgs, dryRun: false });
  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "test-branch-a");
  assert.strictEqual(result.auditTrail[0]?.selectedEvent, "PATH_A");
});
