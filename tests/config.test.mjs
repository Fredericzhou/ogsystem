import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

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
