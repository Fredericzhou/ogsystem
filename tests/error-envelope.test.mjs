import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

test("runtime failures surface stable error envelopes in result and audit", async () => {
  const result = await runSystemWithAdapter({
    systemPath: path.resolve("tests/fixtures/mermaid/law-system.mmd"),
    profilesPath: path.resolve("tests/fixtures/profiles/branch-profiles.json"),
    toolsPath: path.resolve("tests/fixtures/tools/branch-tools.json"),
    lawsPath: path.resolve("tests/fixtures/laws/law-forbid.json"),
    prompt: "forbidden tool",
    workdir: process.cwd()
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errorEnvelope?.errorCode, "ROLE_EXECUTION_FAILED");
  assert.equal(result.errorEnvelope?.errorCategory, "execution");
  assert.equal(result.errorEnvelope?.stage, "execute");
  assert.equal(result.errorEnvelope?.retryable, false);
  assert.equal(result.auditTrail[0]?.errorEnvelope?.errorCode, "ROLE_EXECUTION_FAILED");
  assert.equal(result.runSummary.failureCountsByErrorCode.ROLE_EXECUTION_FAILED, 1);
});
