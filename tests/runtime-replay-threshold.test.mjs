import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateRuntimeReplayThresholds,
  RUNTIME_REPLAY_THRESHOLDS
} from "../scripts/runtime-replay-threshold-check.mjs";

const baseline = {
  metrics: {
    stateLoadMs: 6.699,
    checkpointLoadMs: 5.008,
    resumeTotalMs: 1270.695,
    stateWriteMs: 9
  }
};

test("runtime replay baseline stays within report-only thresholds", () => {
  const result = evaluateRuntimeReplayThresholds(baseline);
  assert.equal(result.mode, "report-only");
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("runtime replay threshold reports a deliberately slow fixture", () => {
  const result = evaluateRuntimeReplayThresholds({
    metrics: {
      ...baseline.metrics,
      resumeTotalMs: RUNTIME_REPLAY_THRESHOLDS.resumeTotalMs + 1
    }
  });
  assert.equal(result.mode, "report-only");
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, [{
    metric: "resumeTotalMs",
    observed: 1801,
    threshold: RUNTIME_REPLAY_THRESHOLDS.resumeTotalMs
  }]);
});
