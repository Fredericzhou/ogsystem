import test from "node:test";
import assert from "node:assert/strict";

import { projectStages } from "../dist/runtime/stage-projector.js";

test("projectStages marks non-terminal successful records as RUNNING", () => {
  const stages = projectStages({
    auditTrail: [
      {
        at: "2026-04-11T00:00:00.000Z",
        roleId: "role-a",
        lawRef: "law.test",
        exitCode: 0,
        durationMs: 1,
        status: "ok",
        selectedEvent: "NEXT"
      },
      {
        at: "2026-04-11T00:00:01.000Z",
        roleId: "role-b",
        lawRef: "law.test",
        exitCode: 0,
        durationMs: 1,
        status: "ok",
        selectedEvent: "DONE"
      }
    ]
  });

  assert.equal(stages.length, 2);
  assert.equal(stages[0].phase, "RUNNING");
  assert.equal(stages[1].phase, "TERMINAL");
});

test("projectStages keeps failed records as FAILED", () => {
  const stages = projectStages({
    auditTrail: [
      {
        at: "2026-04-11T00:00:00.000Z",
        roleId: "role-a",
        lawRef: "law.test",
        exitCode: 1,
        durationMs: 1,
        status: "failed",
        error: "boom"
      }
    ]
  });

  assert.equal(stages.length, 1);
  assert.equal(stages[0].phase, "FAILED");
});
