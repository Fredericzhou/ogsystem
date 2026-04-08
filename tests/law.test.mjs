import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

const systemPath = path.resolve("tests/fixtures/mermaid/law-system.mmd");
const profilesPath = path.resolve("tests/fixtures/profiles/branch-profiles.json");
const toolsPath = path.resolve("tests/fixtures/tools/branch-tools.json");
const lawMissingPath = path.resolve("tests/fixtures/laws/law-branch.json");
const lawForbidPath = path.resolve("tests/fixtures/laws/law-forbid.json");

const buildArgs = (lawPath) => ({
  systemPath,
  profilesPath,
  toolsPath,
  lawsPath: lawPath,
  prompt: "law test",
  workdir: process.cwd(),
  dryRun: true
});

test("adapter rejects unknown global law", async () => {
  await assert.rejects(
    () => runSystemWithAdapter(buildArgs(lawMissingPath)),
    (error) => {
      assert.ok(
        error instanceof Error && /Global law not found/.test(error.message),
        "expected law catalog error"
      );
      return true;
    }
  );
});

test("adapter fails when execution bindings use forbidden tool", async () => {
  const result = await runSystemWithAdapter(buildArgs(lawForbidPath));
  assert.strictEqual(result.status, "failed");
  assert.match(result.error ?? "", /Tool is forbidden by effective law/);
});
