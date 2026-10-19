import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { hasExited, terminateChildProcessTree, waitForChildExit } from "../dist/runtime/child-process-lifecycle.js";

test("child process lifecycle waits for exit and reaps a timed-out process tree", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], {
    stdio: "ignore",
    windowsHide: true
  });
  assert.equal(await waitForChildExit(child, 10), false);
  await terminateChildProcessTree(child, 20);
  assert.equal(hasExited(child), true);
  assert.equal(await waitForChildExit(child, 10), true);
});
