import test from "node:test";
import assert from "node:assert/strict";

import { formatHumanRunSummary, shouldEmitFullRunJson } from "../dist/runtime/cli-run-output.js";

test("run output defaults to a summary only on a terminal", () => {
  assert.equal(shouldEmitFullRunJson({ jsonRequested: false, stdoutIsTty: true }), false);
  assert.equal(shouldEmitFullRunJson({ jsonRequested: true, stdoutIsTty: true }), true);
  assert.equal(shouldEmitFullRunJson({ jsonRequested: false, stdoutIsTty: false }), true);
  assert.equal(shouldEmitFullRunJson({ jsonRequested: true, stdoutIsTty: false }), true);
});

test("human run summary uses persisted run identity and result counters", () => {
  const output = formatHumanRunSummary({
    runId: "run-1",
    runDir: ".ogs/runs/run-1",
    durationMs: 42,
    result: {
      status: "stopped",
      systemState: { pendingReviewCount: 1 },
      runSummary: {
        totalTransitions: 3,
        okCount: 2,
        failedCount: 0,
        noopCount: 1
      }
    }
  });
  assert.match(output, /Run ID:\s+run-1/);
  assert.match(output, /waiting for human review/);
  assert.match(output, /Transitions:\s+3 \(ok: 2, failed: 0, noop: 1\)/);
  assert.match(output, /42 ms/);
  assert.match(output, /\.ogs\/runs\/run-1\/audit\/summary\.md/);
});
