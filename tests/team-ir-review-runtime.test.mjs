import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileTeamIr, MemoryTeamReviewStore, TeamReviewError, TeamReviewRuntime, readTeamReviewContext } from "../dist/team-ir/index.js";

async function setup({ authorized = true } = {}) {
  const fixture = JSON.parse(await readFile(new URL("../examples/team-ir-v2/classic-software-team.json", import.meta.url), "utf8"));
  fixture.orchestration.reviews = [
    { id: "planner-review", at: { kind: "agentOutput", agentId: "planner", outputPort: "PLAN" }, feedbackSchema: { type: "object", properties: { comments: { type: "string", minLength: 1 } }, required: ["comments"], additionalProperties: false }, timeoutMs: 1000, onTimeout: "fail" },
    { id: "lead-review", at: { kind: "agentOutput", agentId: "lead", outputPort: "DELIVERED" }, feedbackSchema: { type: "object", properties: { comments: { type: "string", minLength: 1 } }, required: ["comments"], additionalProperties: false }, timeoutMs: 2000, onTimeout: "fail" }
  ];
  const plan = compileTeamIr(fixture);
  let now = 100;
  let token = 0;
  const store = new MemoryTeamReviewStore();
  const runtime = new TeamReviewRuntime({
    store,
    now: () => now,
    makeRevisionToken: () => `token-${++token}`,
    authorizeReviewer: async ({ reviewerId }) => authorized && reviewerId === "reviewer-1"
  });
  return { plan, runtime, store, now: () => now, setNow: (value) => { now = value; } };
}

test("multiple review activations persist independent deadlines and decisions", async () => {
  const { plan, runtime } = await setup();
  const planner = await runtime.openFromPlan({ plan, runId: "run-1", reviewId: "planner-review" });
  const lead = await runtime.openFromPlan({ plan, runId: "run-1", reviewId: "lead-review" });
  assert.notEqual(planner.key, lead.key);
  assert.equal(planner.deadlineAt, 1100);
  assert.equal(lead.deadlineAt, 2100);
  assert.equal(planner.status, "pending");
  assert.equal(lead.status, "pending");
});

test("approve decision is authorized, schema checked, atomically persisted, and idempotent", async () => {
  const { plan, runtime } = await setup();
  const pending = await runtime.open({ runId: "run-2", reviewId: "planner-review", timeoutMs: 1000 });
  const input = {
    runId: "run-2", reviewId: "planner-review", revisionToken: pending.revisionToken,
    idempotencyKey: "request-1", reviewerId: "reviewer-1", decision: "approve",
    feedback: { comments: "Looks good." }, plan
  };
  const decided = await runtime.decide(input);
  assert.equal(decided.status, "approved");
  assert.equal(decided.revision, 1);
  assert.equal(decided.reviewerId, "reviewer-1");
  assert.deepEqual(readTeamReviewContext(decided), { decision: "approve", feedback: { comments: "Looks good." } });
  assert.deepEqual(await runtime.decide(input), decided);
  assert.equal(decided.events.filter((item) => item.type === "review.approve").length, 1);
});

test("reject requires valid feedback; invalid feedback does not consume the pending decision", async () => {
  const { plan, runtime } = await setup();
  const pending = await runtime.open({ runId: "run-3", reviewId: "planner-review", timeoutMs: 1000 });
  const base = { runId: "run-3", reviewId: "planner-review", revisionToken: pending.revisionToken, reviewerId: "reviewer-1", decision: "reject", plan };
  await assert.rejects(runtime.decide({ ...base, idempotencyKey: "bad", feedback: {} }), (error) => error.code === "REVIEW_FEEDBACK_INVALID");
  await assert.rejects(runtime.decide({ ...base, idempotencyKey: "missing" }), (error) => error.code === "REVIEW_FEEDBACK_REQUIRED");
  assert.equal((await runtime.get({ runId: "run-3", reviewId: "planner-review" })).status, "pending");
  const rejected = await runtime.decide({ ...base, idempotencyKey: "good", feedback: { comments: "Add tests." } });
  assert.equal(rejected.status, "rejected");
});

test("unauthorized reviewer cannot decide and stale revision token cannot overwrite a decision", async () => {
  const denied = await setup({ authorized: false });
  const pendingDenied = await denied.runtime.open({ runId: "run-4", reviewId: "planner-review", timeoutMs: 1000 });
  await assert.rejects(denied.runtime.decide({
    runId: "run-4", reviewId: "planner-review", revisionToken: pendingDenied.revisionToken,
    idempotencyKey: "denied", reviewerId: "intruder", decision: "approve", plan: denied.plan
  }), (error) => error.code === "REVIEW_UNAUTHORIZED");

  const setup2 = await setup();
  const pending = await setup2.runtime.open({ runId: "run-5", reviewId: "planner-review", timeoutMs: 1000 });
  const current = await setup2.store.load(pending.key);
  current.revisionToken = "newer-token";
  current.revision += 1;
  assert.equal(await setup2.store.compareAndSet(current.key, pending.revision, current), true);
  await assert.rejects(setup2.runtime.decide({
    runId: "run-5", reviewId: "planner-review", revisionToken: pending.revisionToken,
    idempotencyKey: "stale", reviewerId: "reviewer-1", decision: "approve", plan: setup2.plan
  }), (error) => error.code === "REVIEW_STALE_TOKEN");
});

test("review deadline persists fail-closed timeout and never defaults to approval", async () => {
  const { runtime, store, setNow } = await setup();
  const pending = await runtime.open({ runId: "run-6", reviewId: "planner-review", timeoutMs: 1000 });
  setNow(pending.deadlineAt);
  const timedOut = await runtime.get({ runId: "run-6", reviewId: "planner-review" });
  assert.equal(timedOut.status, "timed_out");
  assert.equal(timedOut.decision, undefined);
  assert.equal(timedOut.events.at(-1).type, "review.timeout");
  await assert.rejects(runtime.decide({
    runId: "run-6", reviewId: "planner-review", revisionToken: pending.revisionToken,
    idempotencyKey: "late", reviewerId: "reviewer-1", decision: "approve", plan: (await setup()).plan
  }), (error) => error.code === "REVIEW_TIMEOUT");
  assert.equal((await store.load(pending.key)).status, "timed_out");
});

test("review waiting state is independent from active execution budget and can be cancelled", async () => {
  const { runtime } = await setup();
  const pending = await runtime.open({ runId: "run-7", reviewId: "lead-review", lineage: "branch-2", loopRound: 3, timeoutMs: 1000 });
  const cancelled = await runtime.cancel({ runId: "run-7", reviewId: "lead-review", lineage: "branch-2", loopRound: 3 });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.deadlineAt, pending.deadlineAt);
  assert.equal("activeExecutionMs" in cancelled, false, "review control records do not mutate Run active execution accounting");
});
