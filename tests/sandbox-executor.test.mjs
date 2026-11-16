import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultExecutor } from "../dist/runtime/executor.js";

test("v2 rejects profile and local_shell execution at the Runtime boundary", async () => {
  const executor = createDefaultExecutor({
    sandbox: true,
    runContext: {},
    targetDir: process.cwd(),
    needsModelExecutor: false
  });
  await assert.rejects(() => executor.execute({
    roleId: "legacy",
    prompt: "run",
    schema: { type: "object" },
    binding: {
      kind: "profile",
      profile: { profileId: "profile.legacy", toolRef: "tool.legacy" },
      tool: { toolRef: "tool.legacy", runner: "local_shell", command: "node", argsTemplate: [], stdinMode: "none" }
    },
    workdir: process.cwd(),
    directory: process.cwd(),
    timeoutMs: 1000,
    maxOutputBytes: 1024
  }), /V2_LEGACY_EXECUTION_BINDING/);
  await executor.close();
});
