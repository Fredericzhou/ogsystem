import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

test("adapter resolves prompts from assembly role refs", async () => {
  const result = await runSystemWithAdapter({
    systemPath: path.resolve("tests/fixtures/mermaid/assembly-system.mmd"),
    assemblyPath: path.resolve("tests/fixtures/assemblies/assembly-system.json"),
    profilesPath: path.resolve("tests/fixtures/profiles/branch-profiles.json"),
    toolsPath: path.resolve("tests/fixtures/tools/branch-tools.json"),
    lawsPath: path.resolve("examples/console-laws.json"),
    prompt: "unused raw prompt",
    workdir: process.cwd(),
    dryRun: true
  });

  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "minimalist");
  assert.strictEqual(result.auditTrail[0]?.selectedEvent, "MINIMALIST_DONE");
  assert.match(result.finalOutput ?? "", /node tests\/fixtures\/scripts\/branch-tool\.js PATH_A/);
});
