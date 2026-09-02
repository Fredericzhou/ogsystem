import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { resolveCliCommand, runCliTool } from "../dist/runtime/tool-runner.js";

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
    commandBaseDir: process.cwd(),
    timeoutMs: 1000,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    dryRunOutput: {
      event: "TEST_EVENT"
    },
    dryRun: true
  });
  const parsed = JSON.parse(result.stdout);
  assert.strictEqual(parsed.event, "TEST_EVENT");
  assert.match(parsed.content, /^\[dry-run\] /);
  assert.match(parsed.content, /console\.log\('hello'\)/);
});

test("runCliTool captures large stdout payloads", async () => {
  const result = await runCliTool({
    tool: buildTool(["-e", "console.log('x'.repeat(8192))"]),
    vars: {},
    workdir: process.cwd(),
    commandBaseDir: process.cwd(),
    timeoutMs: 1000,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES
  });
  assert.ok(result.stdout.length >= 8000);
});

test("runCliTool resolves path-like args from commandBaseDir", async () => {
  const result = await runCliTool({
    tool: buildTool(["tests/fixtures/scripts/branch-tool.js", "PATH_A"]),
    vars: {},
    workdir: process.cwd(),
    commandBaseDir: process.cwd(),
    timeoutMs: 1000,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    dryRun: true
  });

  assert.ok(path.isAbsolute(result.args[0]));
  assert.match(result.args[0], /branch-tool\.js$/);
});

test("runCliTool rejects when output exceeds max bytes", async () => {
  await assert.rejects(
    () =>
      runCliTool({
        tool: buildTool(["-e", "console.log('x'.repeat(8192))"]),
        vars: {},
        workdir: process.cwd(),
        commandBaseDir: process.cwd(),
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
        commandBaseDir: process.cwd(),
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

test("runCliTool abort signal stops a running process", async () => {
  const controller = new AbortController();
  const execution = runCliTool({
    tool: buildTool(["-e", "setTimeout(() => {}, 1000)"]),
    vars: {},
    workdir: process.cwd(),
    commandBaseDir: process.cwd(),
    timeoutMs: 5000,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    signal: controller.signal
  });
  setTimeout(() => controller.abort(new Error("node timeout")), 20);

  await assert.rejects(execution, (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /node timeout/);
    return true;
  });
});

test("runCliTool rejects when process exits with non-zero code", async () => {
  await assert.rejects(
    () =>
      runCliTool({
        tool: buildTool(["-e", "process.stderr.write('boom'); process.exit(17)"]),
        vars: {},
        workdir: process.cwd(),
        commandBaseDir: process.cwd(),
        timeoutMs: 1000,
        maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /exited with code 17/i);
      assert.match(error.message, /boom/);
      return true;
    }
  );
});

test("resolveCliCommand keeps non-node commands unchanged", () => {
  assert.equal(resolveCliCommand("bash"), "bash");
});

test("resolveCliCommand prefers the current execPath when it is healthy", () => {
  const resolved = resolveCliCommand("node", {
    execPath: "/runtime/node",
    probeCommand: (candidate) => candidate === "/runtime/node",
    lookupVoltaNode: () => "/volta/node"
  });

  assert.equal(resolved, "/runtime/node");
});

test("resolveCliCommand falls back to Volta when execPath is unhealthy", () => {
  const resolved = resolveCliCommand("node", {
    execPath: "/broken/node",
    env: {
      PATH: "/broken/bin:/fallback/bin"
    },
    probeCommand: (candidate) => candidate === "/volta/node",
    lookupVoltaNode: () => "/volta/node"
  });

  assert.equal(resolved, "/volta/node");
});

test("resolveCliCommand falls back to plain node when no candidate passes health checks", () => {
  const resolved = resolveCliCommand("node", {
    execPath: "/broken/node",
    env: {
      PATH: "/broken/bin"
    },
    probeCommand: () => false,
    lookupVoltaNode: () => undefined
  });

  assert.equal(resolved, "node");
});
