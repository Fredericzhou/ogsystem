import test from "node:test";
import assert from "node:assert/strict";

import {
  MISSING_TEAM_VALUE,
  TeamReferenceError,
  evaluateTeamCondition,
  evaluateTeamValueExpr,
  parseTeamReference,
  resolveTeamReference
} from "../dist/team-ir/reference.js";

const context = {
  output: {
    event: "READY",
    data: { summary: null, items: [{ name: "one" }] },
    artifacts: { sources: { artifactId: "a1" } }
  },
  run: { task: "Do work", input: { requested: true }, preferences: {}, attachments: {} },
  review: { decision: "reject", feedback: { comments: "Revise" } },
  loop: { previous: { writer: { output: { data: { draft: "old" }, artifacts: { report: "a2" } } } } }
};

test("parses the supported root paths and array indexes", () => {
  assert.deepEqual(parseTeamReference("$.output.data.items[0].name"), {
    root: "output",
    path: ["data", "items", 0, "name"],
    source: "$.output.data.items[0].name"
  });
  assert.equal(resolveTeamReference("$.run.task", context).value, "Do work");
  assert.equal(resolveTeamReference("$.review.feedback.comments", context).value, "Revise");
  assert.equal(resolveTeamReference("$.loop.previous.writer.output.data.draft", context).value, "old");
  assert.equal(resolveTeamReference("$.loop.previous.writer.output.artifacts.report", context).value, "a2");
});

test("distinguishes explicit null from a missing reference", () => {
  assert.deepEqual(resolveTeamReference("$.output.data.summary", context), { present: true, value: null });
  assert.deepEqual(resolveTeamReference("$.output.data.absent", context), { present: false });
  assert.equal(evaluateTeamValueExpr({ value: { $ref: "$.output.data.absent" } }, context).value, undefined);
  const projected = evaluateTeamValueExpr({ summary: { $ref: "$.output.data.summary" }, absent: { $ref: "$.output.data.absent" } }, context);
  assert.deepEqual(projected, { summary: null });
});

test("validates root-specific reference shapes and rejects unsupported syntax", () => {
  for (const invalid of [
    "$.output",
    "$.output.summary",
    "$.output.artifacts",
    "$.run.input",
    "$.run.attachments.slot.more",
    "$.review.feedback",
    "$.loop.previous.writer.output",
    "$.unknown.value",
    "$.output.data.foo..bar",
    "$.output.data.items[-1]",
    "$.output.data.items[01]",
    "$.output.data.items[*]",
    "$.output.data['quoted']"
  ]) assert.throws(() => parseTeamReference(invalid), TeamReferenceError, invalid);
});

test("projects recursive objects and arrays, retaining literal objects with reserved keys", () => {
  assert.deepEqual(evaluateTeamValueExpr({
    event: { $ref: "$.output.event" },
    nested: [{ $ref: "$.output.data.items[0].name" }, { $literal: null }],
    opaque: { $literal: { $ref: "business data" } }
  }, context), {
    event: "READY",
    nested: ["one", null],
    opaque: { $ref: "business data" }
  });
  assert.equal(evaluateTeamValueExpr({ $ref: "$.output.data.absent" }, context), MISSING_TEAM_VALUE);
  assert.throws(() => evaluateTeamValueExpr([{ $ref: "$.output.data.absent" }], context), /cannot be missing/);
  assert.throws(() => evaluateTeamValueExpr({ $ref: "$.output.event", $literal: "x" }, context), /both \$ref and \$literal/);
  assert.throws(() => evaluateTeamValueExpr({ $ref: "$.output.event", other: true }, context), /Unexpected other/);
});

test("keeps __proto__ mapping keys as ordinary own data properties", () => {
  const expression = JSON.parse('{"__proto__":{"polluted":true},"constructor":"value"}');
  const projected = evaluateTeamValueExpr(expression, context);
  assert.equal(Object.getPrototypeOf(projected), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(projected, "__proto__"), true);
  assert.deepEqual(projected.__proto__, { polluted: true });
  assert.equal(projected.constructor, "value");
});

test("evaluates strict condition operators with JSON equality and short-circuit logic", () => {
  assert.equal(evaluateTeamCondition({ op: "equals", args: [{ $ref: "$.output.data.summary" }, { $literal: null }] }, context), true);
  assert.equal(evaluateTeamCondition({ op: "notEquals", args: [{ $ref: "$.output.data.summary" }, { $literal: "null" }] }, context), true);
  assert.equal(evaluateTeamCondition({ op: "exists", args: [{ $ref: "$.output.data.summary" }] }, context), true);
  assert.equal(evaluateTeamCondition({ op: "exists", args: [{ $ref: "$.output.data.missing" }] }, context), false);
  assert.equal(evaluateTeamCondition({ op: "and", args: [
    { op: "equals", args: [{ $ref: "$.output.event" }, { $literal: "READY" }] },
    { op: "not", args: [{ op: "equals", args: [{ $ref: "$.review.decision" }, { $literal: "approve" }] }] }
  ] }, context), true);
  assert.equal(evaluateTeamCondition({ op: "or", args: [
    { op: "equals", args: [{ $ref: "$.output.event" }, { $literal: "OTHER" }] },
    { op: "equals", args: [{ $ref: "$.output.data.items[0].name" }, { $literal: "one" }] }
  ] }, context), true);
});

test("conditions fail closed on missing ordinary refs, invalid operators and malformed nodes", () => {
  assert.throws(() => evaluateTeamCondition({ op: "equals", args: [{ $ref: "$.output.data.missing" }, { $literal: null }] }, context),
    (error) => error instanceof TeamReferenceError && error.code === "IR_ROUTE_CONDITION_INPUT_MISSING");
  assert.throws(() => evaluateTeamCondition({ op: "in", args: [{ $literal: "x" }, { $literal: ["x"] }] }, context), /Unsupported condition operator/);
  assert.throws(() => evaluateTeamCondition({ op: "not", args: [{ op: "exists", args: [{ $ref: "$.output.event" }] }], extra: true }, context), /Unexpected extra/);
  assert.throws(() => evaluateTeamCondition({ op: "exists", args: [{ $literal: true }] }, context), /exists requires one \$ref/);
});
