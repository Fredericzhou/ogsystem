import assert from "node:assert/strict";
import test from "node:test";

import {
  BUSINESS_EVENT_TYPES,
  RUNTIME_AUDIT_EVENT_TYPES,
  isBusinessEvent,
  isRuntimeAuditEvent,
  validateSystemEventBoundaries
} from "../dist/business-events.js";

test("runtime review rejection records are registered separately from routable business events", () => {
  assert.deepEqual(RUNTIME_AUDIT_EVENT_TYPES, [
    "human_review_rejected",
    "human_review_decision_rejected"
  ]);
  assert.equal(isRuntimeAuditEvent("human_review_rejected"), true);
  assert.equal(isRuntimeAuditEvent("human_review_decision_rejected"), true);
  assert.equal(isBusinessEvent("human_review_rejected"), false);
  assert.equal(isBusinessEvent("human_review_decision_rejected"), false);
  assert.equal(validateSystemEventBoundaries({
    flows: [{ fromRoleId: "review", toRoleId: "end", eventType: "human_review_rejected" }]
  }).length, 1);
  assert.deepEqual(BUSINESS_EVENT_TYPES, [
    "READY",
    "APPROVAL_PROPOSED",
    "APPROVED",
    "REJECTED",
    "NEEDS_REWORK",
    "BLOCKED"
  ]);
});
