import assert from "node:assert/strict";
import test from "node:test";

import {
  BUSINESS_EVENT_TYPES,
  RUNTIME_AUDIT_EVENT_TYPES,
  RUNTIME_CONTRACT_EVENT_TYPES,
  isBusinessEvent,
  isRuntimeContractEvent,
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
    "APPROVED",
    "REJECTED",
    "NEEDS_REWORK",
    "BLOCKED"
  ]);
});

test("the V2 Runtime contract event registry covers the complete Workspace event set", () => {
  assert.equal(RUNTIME_CONTRACT_EVENT_TYPES.length, 30);
  for (const eventType of ["join_conflict", "workspace_integrated", "result_committed"]) {
    assert.equal(isRuntimeContractEvent(eventType), true);
  }
  assert.equal(isRuntimeContractEvent("READY"), false);
});
