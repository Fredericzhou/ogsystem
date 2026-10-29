import assert from "node:assert/strict";
import test from "node:test";
import { compileTeamIr, FileTeamReviewStore, MemoryTeamReviewStore, TeamReviewError, TeamReviewRuntime, readTeamReviewContext } from "../dist/team-ir/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function setup({ authorized = true } = {}) {
  const agents = ["planner", "lead"];
  const fixture = {
    schemaVersion: 2,
    team: { id: "review-runtime", version: "1.0.0" },
    runInput: { dataSchema: { type: "object" }, preferencesSchema: { type: "object" }, artifactSlots: {} },
    runResult: { dataSchema: { type: "object" }, artifactSlots: {} },
    executionPolicy: { resultMode: "allow_empty", activeExecutionBudgetMs: 10000 },
    agents: agents.map((id) => ({
      id,
      packageRef: `role:${id}@1`,
      bindingRef: `binding:${id}`,
      inputPorts: { default: { dataSchema: { type: "object" } } },
      outputPorts: { DONE: { dataSchema: { type: "object" } } }
    })),
    handoffs: agents.map((id) => ({
      id: `run-to-${id}`,
      from: { kind: "run" },
      to: { kind: "agent", agentId: id, inputPort: "default" },
      map: {},
      delivery: { deadlineMs: 3000 }
    })),
    orchestration: {
      routes: [{
        from: { kind: "run" }, mode: "parallel_fanout", onNoMatch: "fail",
        handoffIds: agents.map((id) => `run-to-${id}`)
      }],
      joins: [], loops: [], reviews: []
    },
    bindings: agents.map((id) => ({
      id: `binding:${id}`, kind: "model", modelRef: "models/review-runtime", attemptTimeoutMs: 1000,
      retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } }
    }))
  };
  fixture.orchestration.reviews = [
    { id: "planner-review", at: { kind: "agentOutput", agentId: "planner", outputPort: "DONE" }, feedbackSchema: { type: "object", properties: { comments: { type: "string", minLength: 1 } }, required: ["comments"], additionalProperties: false }, timeoutMs: 1000, onTimeout: "fail" },
    { id: "lead-review", at: { kind: "agentOutput", agentId: "lead", outputPort: "DONE" }, feedbackSchema: { type: "object", properties: { comments: { type: "string", minLength: 1 } }, required: ["comments"], additionalProperties: false }, timeoutMs: 2000, onTimeout: "fail" }
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

test("FileTeamReviewStore recovers decisions across instances and CAS admits one concurrent reviewer", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-review-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store1 = new FileTeamReviewStore(root);
  const first = new TeamReviewRuntime({ store: store1, now: () => 100, makeRevisionToken: () => "rev-1", authorizeReviewer: async () => true });
  const pending = await first.open({ runId: "file-run", reviewId: "planner-review", timeoutMs: 1000 });
  const store2 = new FileTeamReviewStore(root);
  const second = new TeamReviewRuntime({ store: store2, now: () => 101, makeRevisionToken: () => "rev-2", authorizeReviewer: async () => true });
  const request = { runId: "file-run", reviewId: "planner-review", revisionToken: pending.revisionToken, idempotencyKey: "approve-1", reviewerId: "reviewer-1", decision: "approve", plan: (await setup()).plan };
  const outcomes = await Promise.allSettled([first.decide(request), second.decide(request)]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 2, "same idempotent decision may be replayed");
  const reopened = new TeamReviewRuntime({ store: new FileTeamReviewStore(root), now: () => 102, authorizeReviewer: async () => true });
  const record = await reopened.get({ runId: "file-run", reviewId: "planner-review" });
  assert.equal(record.status, "approved");
  assert.equal(record.revision, 1);
  assert.equal(record.events.filter((item) => item.type === "review.approve").length, 1);

  const plan = (await setup()).plan;
  const casPending = await reopened.open({ runId: "cas-run", reviewId: "planner-review", timeoutMs: 1000 });
  const competing = new TeamReviewRuntime({ store: new FileTeamReviewStore(root), now: () => 103, authorizeReviewer: async () => true });
  const decisions = await Promise.allSettled([
    reopened.decide({ runId: "cas-run", reviewId: "planner-review", revisionToken: casPending.revisionToken, idempotencyKey: "cas-approve", reviewerId: "reviewer-1", decision: "approve", plan }),
    competing.decide({ runId: "cas-run", reviewId: "planner-review", revisionToken: casPending.revisionToken, idempotencyKey: "cas-reject", reviewerId: "reviewer-2", decision: "reject", feedback: { comments: "Revise." }, plan })
  ]);
  assert.equal(decisions.filter((item) => item.status === "fulfilled").length, 1);
  const casResult = await competing.get({ runId: "cas-run", reviewId: "planner-review" });
  assert.ok(["approved", "rejected"].includes(casResult.status));
  assert.equal(casResult.revision, 1);
});
