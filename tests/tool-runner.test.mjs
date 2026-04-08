import test from "node:test";
import assert from "node:assert/strict";

import { runCliTool } from "../dist/runtime/tool-runner.js";

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

const baseTool = {
  toolRef: "tool.test",
  runner: "local_shell",
  command: "node",
  stdinMode: "none"
};

function buildTool(argsTemplate) {
  return {
    ...baseTool,
    argsTemplate
  };
}

test("dry run reports formatted content", async () => {
  const result = await runCliTool({
    tool: buildTool(["-e", "console.log('hello')"]),
    vars: {},
    workdir: process.cwd(),
    timeoutMs: 1000,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    dryRunOutput: {
      event: "TEST_EVENT"
    },
    dryRun: true
  });
  const parsed = JSON.parse(result.stdout);
  assert.strictEqual(parsed.event, "TEST_EVENT");
  assert.ok(parsed.content.startsWith("[dry-run] node"));
});

test("runCliTool captures large stdout payloads", async () => {
  const result = await runCliTool({
    tool: buildTool(["-e", "console.log('x'.repeat(8192))"]),
    vars: {},
    workdir: process.cwd(),
    timeoutMs: 1000,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES
  });
  assert.ok(result.stdout.length >= 8000);
});

test("runCliTool rejects when output exceeds max bytes", async () => {
  await assert.rejects(
    () =>
      runCliTool({
        tool: buildTool(["-e", "console.log('x'.repeat(8192))"]),
        vars: {},
        workdir: process.cwd(),
        timeoutMs: 1000,
        maxOutputBytes: 128
      }),
    (error) => {
      assert.ok(
        error instanceof Error && /exceeded 128 bytes/.test(error.message),
        "expected output limit error"
      );
      return true;
    }
  );
});

test("runCliTool rejects when process times out", async () => {
  await assert.rejects(
    () =>
      runCliTool({
        tool: buildTool(["-e", "setTimeout(() => {}, 1000)"]),
        vars: {},
        workdir: process.cwd(),
        timeoutMs: 10,
        maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES
      }),
    (error) => {
      assert.ok(
        error instanceof Error && /Command timeout/.test(error.message),
        "expected timeout error"
      );
      return true;
    }
  );
});
