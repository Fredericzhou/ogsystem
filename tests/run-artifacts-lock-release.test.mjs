import test from "node:test";
import assert from "node:assert/strict";

import { releaseResumeLockAfterSetupFailure } from "../dist/runtime/run-artifacts.js";

function withCapturedStderr(run) {
  const originalWrite = process.stderr.write;
  const chunks = [];
  process.stderr.write = (chunk, ...args) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    if (typeof args.at(-1) === "function") {
      args.at(-1)();
    }
    return true;
  };

  return Promise.resolve()
    .then(() => run(chunks))
    .finally(() => {
      process.stderr.write = originalWrite;
    });
}

test("releaseResumeLockAfterSetupFailure is a no-op when release function is absent", async () => {
  await withCapturedStderr(async (chunks) => {
    await releaseResumeLockAfterSetupFailure({
      runDir: "/tmp/ogsystem/run-noop"
    });
    assert.equal(chunks.length, 0);
  });
});

test("releaseResumeLockAfterSetupFailure stays silent when release succeeds", async () => {
  let called = false;
  await withCapturedStderr(async (chunks) => {
    await releaseResumeLockAfterSetupFailure({
      runDir: "/tmp/ogsystem/run-success",
      releaseResumeLock: async () => {
        called = true;
      }
    });
    assert.equal(called, true);
    assert.equal(chunks.length, 0);
  });
});

test("releaseResumeLockAfterSetupFailure logs warning details when release throws Error", async () => {
  await withCapturedStderr(async (chunks) => {
    await releaseResumeLockAfterSetupFailure({
      runDir: "/tmp/ogsystem/run-error",
      releaseResumeLock: async () => {
        throw new Error("permission denied");
      }
    });

    assert.equal(chunks.length, 1);
    const warning = chunks[0];
    assert.match(warning, /\[warn\] failed to release resume lock after setup failure/);
    assert.match(warning, /runDir=\/tmp\/ogsystem\/run-error/);
    assert.match(warning, /error=permission denied/);
  });
});

test("releaseResumeLockAfterSetupFailure logs non-Error thrown values", async () => {
  await withCapturedStderr(async (chunks) => {
    await releaseResumeLockAfterSetupFailure({
      runDir: "/tmp/ogsystem/run-non-error",
      releaseResumeLock: async () => {
        throw "lock cleanup failed";
      }
    });

    assert.equal(chunks.length, 1);
    assert.match(chunks[0], /error=lock cleanup failed/);
  });
});
