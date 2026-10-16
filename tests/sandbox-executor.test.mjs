import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDefaultExecutor } from "../dist/runtime/executor.js";
import { ToolExecutionError } from "../dist/runtime/tool-runner.js";
import { loadSideEffects } from "../dist/runtime/side-effect-store.js";

test("sandbox executor simulates CLI tools without creating real side effects", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-sandbox-executor-"));
  const sentinelPath = join(workdir, "sandbox-sentinel.txt");
  const executor = createDefaultExecutor({
    sandbox: true,
    runContext: {},
    targetDir: workdir,
    needsModelExecutor: false
  });

  try {
    await executor.start();
    const result = await executor.execute({
      roleId: "writer",
      prompt: "write the result",
      schema: { type: "object" },
      binding: {
        kind: "profile",
        profile: { profileId: "profile.writer", toolRef: "tool.writer" },
        tool: {
          toolRef: "tool.writer",
          runner: "local_shell",
          command: "node",
          argsTemplate: [
            "-e",
            "require('node:fs').writeFileSync('sandbox-sentinel.txt', 'should-not-exist')"
          ],
          stdinMode: "none"
        }
      },
      workdir,
      directory: workdir,
      timeoutMs: 1000,
      maxOutputBytes: 64 * 1024,
      dryRunOutputEvent: "SANDBOX_TOOL"
    });

    const output = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(output.event, "SANDBOX_TOOL");
    assert.match(output.content, /^\[dry-run\] /);
    await assert.rejects(() => stat(sentinelPath), { code: "ENOENT" });
  } finally {
    await executor.close();
    await rm(workdir, { recursive: true, force: true });
  }
});

test("sandbox executor classifies injected tool failures and reuses completed effects", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-sandbox-faults-"));
  const request = {
    roleId: "writer",
    sessionKey: "writer-1",
    prompt: "run",
    schema: { type: "object" },
    binding: {
      kind: "profile",
      profile: { profileId: "profile.writer", toolRef: "tool.writer" },
      tool: { toolRef: "tool.writer", runner: "local_shell", command: "node", argsTemplate: [], stdinMode: "none" }
    },
    workdir,
    directory: workdir,
    timeoutMs: 10,
    maxOutputBytes: 1024
  };
  const cases = [
    ["failed", Object.assign(new Error("non-zero"), { sideEffectStatus: "failed" })],
    ["timeout", new ToolExecutionError("timeout", "timed out")],
    ["interrupted", Object.assign(new Error("aborted"), { sideEffectStatus: "interrupted" })],
    ["unknown", Object.assign(new Error("external result unavailable"), { sideEffectStatus: "unknown" })],
    ["needs_review", Object.assign(new Error("manual reconciliation required"), { sideEffectStatus: "needs_review" })]
  ];
  try {
    for (const [expected, failure] of cases) {
      const runDir = join(workdir, ".ogs", "runs", expected);
      const executor = createDefaultExecutor({
        sandbox: true,
        runContext: { runId: expected, runDir },
        targetDir: workdir,
        needsModelExecutor: false,
        sandboxToolExecutor: async () => { throw failure; }
      });
      await assert.rejects(() => executor.execute(request), /./);
      assert.equal((await loadSideEffects(runDir))[0].status, expected);
      await executor.close();
    }

    let calls = 0;
    const runDir = join(workdir, ".ogs", "runs", "completed");
    const executor = createDefaultExecutor({
      sandbox: true,
      runContext: { runId: "completed", runDir },
      targetDir: workdir,
      needsModelExecutor: false,
      sandboxToolExecutor: async () => {
        calls += 1;
        return { exitCode: 0, stdout: "reused", stderr: "", args: [] };
      }
    });
    const first = await executor.execute(request);
    const second = await executor.execute(request);
    assert.equal(first.stdout, "reused");
    assert.equal(second.stdout, "reused");
    assert.equal(calls, 1);
    await executor.close();
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
