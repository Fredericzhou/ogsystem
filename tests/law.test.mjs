import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, symlink } from "node:fs/promises";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

const systemPath = path.resolve("tests/fixtures/mermaid/law-system.mmd");
const langgraphSystemPath = path.resolve("tests/fixtures/mermaid/law-langgraph-system.mmd");
const noopLanggraphSystemPath = path.resolve("tests/fixtures/mermaid/noop-langgraph-system.mmd");
const profilesPath = path.resolve("tests/fixtures/profiles/branch-profiles.json");
const toolsPath = path.resolve("tests/fixtures/tools/branch-tools.json");
const lawMissingPath = path.resolve("tests/fixtures/laws/law-branch.json");
const lawForbidPath = path.resolve("tests/fixtures/laws/law-forbid.json");
const lawNoNoopPath = path.resolve("tests/fixtures/laws/law-branch-no-noop.json");

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
  assert.equal(result.status, "failed");
  assert.equal(result.errorEnvelope?.errorCode, "ROLE_EXECUTION_FAILED");
  assert.equal(result.errorEnvelope?.errorCategory, "execution");
  assert.match(result.errorEnvelope?.message ?? "", /Tool is forbidden by effective law/);
  assert.equal(result.runSummary.failureCountsByErrorCode.ROLE_EXECUTION_FAILED, 1);
});

test("adapter langgraph fails when execution bindings use forbidden tool", async () => {
  const result = await runSystemWithAdapter({
    ...buildArgs(lawForbidPath),
    systemPath: langgraphSystemPath
  });
  assert.equal(result.status, "failed");
  assert.equal(result.errorEnvelope?.errorCode, "ROLE_EXECUTION_FAILED");
  assert.equal(result.errorEnvelope?.errorCategory, "execution");
  assert.match(result.errorEnvelope?.message ?? "", /Tool is forbidden by effective law/);
  assert.equal(result.runSummary.failureCountsByErrorCode.ROLE_EXECUTION_FAILED, 1);
});

test("adapter langgraph allows noop when law enables it", async () => {
  const result = await runSystemWithAdapter({
    ...buildArgs(lawMissingPath),
    systemPath: noopLanggraphSystemPath
  });
  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "test-operator");
});

test("adapter fails preflight when role has noop binding without law authorization", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-law-noop-"));
  await symlink(path.resolve("og-roles"), path.resolve(tempRoot, "og-roles"), "dir");
  await assert.rejects(
    () =>
      runSystemWithAdapter({
        ...buildArgs(lawNoNoopPath),
        systemPath: noopLanggraphSystemPath,
        workdir: tempRoot
      }),
    (error) => {
      assert.ok(error && typeof error === "object");
      assert.equal(error.envelope?.errorCode, "RUNTIME_SETUP_FAILED");
      assert.match(error.message, /Compiler static semantics check failed/);
      assert.match(error.message, /COMPILER_ROLE_BINDING_MISSING/);
      return true;
    }
  );
});
