import test from "node:test";
import assert from "node:assert/strict";

import {
  parseRoleExecutionOutputWithRepair,
  repairUnknownEvent
} from "../dist/runtime/role-executor.js";

test("role output repair extracts a JSON object from wrapped stdout", () => {
  const result = parseRoleExecutionOutputWithRepair({
    rawOutput: [
      "model prelude",
      "```json",
      '{"event":"DECISION_READY","content":"done"}',
      "```"
    ].join("\n"),
    requireEvent: true
  });

  assert.deepStrictEqual(result.output, {
    event: "DECISION_READY",
    content: "done"
  });
  assert.deepStrictEqual(result.repair, {
    kind: "invalid_json",
    attempted: true,
    applied: true,
    strategy: "extract_json_object",
    detail: "Recovered JSON object from wrapped stdout"
  });
});

test("role output repair normalizes unknown event only when exactly one event is allowed", () => {
  const output = {
    event: "WRONG_EVENT",
    content: "done"
  };
  const repair = repairUnknownEvent({
    output,
    allowedEvents: ["DECISION_READY"]
  });

  assert.strictEqual(output.event, "DECISION_READY");
  assert.deepStrictEqual(repair, {
    kind: "unknown_event",
    attempted: true,
    applied: true,
    strategy: "single_allowed_event",
    detail: 'Normalized event to the only allowed transition "DECISION_READY"'
  });
});

test("role output repair does not guess when multiple events are allowed", () => {
  const output = {
    event: "WRONG_EVENT",
    content: "done"
  };
  const repair = repairUnknownEvent({
    output,
    allowedEvents: ["DECISION_READY", "REBUTTAL_NEEDED"]
  });

  assert.strictEqual(output.event, "WRONG_EVENT");
  assert.strictEqual(repair, undefined);
});
