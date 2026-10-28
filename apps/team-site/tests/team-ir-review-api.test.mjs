import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileTeamIr, MemoryTeamReviewStore, TeamReviewRuntime, teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
import { createTeamIrReviewUseCases } from "../application/team-ir-review-use-cases.mjs";
import { handleTeamIrReviewRoutes } from "../api/team-ir-review-routes.mjs";

const fixtureUrl = new URL("../../../examples/team-ir-v2/classic-software-team.json", import.meta.url);

async function setup({ reviewerId = "reviewer-1", authorized = true, loopRound } = {}) {
  const teamIR = JSON.parse(await readFile(fixtureUrl, "utf8"));
  teamIR.orchestration.reviews = [{
    id: "planner-review",
    at: { kind: "agentOutput", agentId: "planner", outputPort: "PLAN" },
    feedbackSchema: { type: "object", properties: { comments: { type: "string", minLength: 1 } }, required: ["comments"], additionalProperties: false },
    timeoutMs: 10000,
    onTimeout: "fail"
  }];
  const plan = compileTeamIr(teamIR);
  let token = 0;
  const runtime = new TeamReviewRuntime({
    store: new MemoryTeamReviewStore(),
    now: () => 100,
    makeRevisionToken: () => `revision-${++token}`,
    authorizeReviewer: async ({ reviewerId: candidate }) => authorized && candidate === reviewerId
  });
  const projectRuntime = {
    getReview: (runId, reviewId, lineage, round) => runtime.get({ runId, reviewId, lineage, loopRound: round }),
    decideReview: (input) => runtime.decide(input)
  };
  const runRecord = {
    runId: "run-1", status: "waiting_human_review",
    waitingReview: { reviewId: "planner-review", lineage: "run", ...(loopRound === undefined ? {} : { loopRound }) }
  };
  const task = {
    taskId: "task-1", currentRunId: "run-1", runIds: ["run-1"],
    teamIrSemanticDigest: teamIRSemanticDigest(teamIR), compiledPlanDigest: plan.compiledPlanDigest
  };
  const useCases = createTeamIrReviewUseCases({
    projectStore: { getProject: async () => ({ projectId: "project-1", taskRecords: [task] }) },
    resolveReviewContext: async () => ({ runtime: projectRuntime, plan, reviewerId, runRecord, lineage: "run", loopRound })
  });
  const pending = await runtime.openFromPlan({ plan, runId: "run-1", reviewId: "planner-review" });
  return { plan, runtime, useCases, pending, task };
}

test("owner scoped Team IR Review API reads pending state and validates reject feedback and revision", async () => {
  const { useCases, pending } = await setup();
  const context = await useCases.getProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review");
  assert.deepEqual(context, {
    projectId: "project-1", taskId: "task-1", runId: "run-1", reviewId: "planner-review",
    lineage: "run",
    revision: 0, revisionToken: pending.revisionToken, activatedAt: pending.activatedAt,
    deadlineAt: pending.deadlineAt, status: "pending"
  });
  await assert.rejects(useCases.decideProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", {
    decision: "reject", revisionToken: pending.revisionToken, idempotencyKey: "bad", feedback: {}
  }), (error) => error.code === "REVIEW_FEEDBACK_INVALID");
  assert.equal((await useCases.getProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review")).status, "pending");
  const decided = await useCases.decideProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", {
    decision: "reject", revisionToken: pending.revisionToken, idempotencyKey: "reject-1", feedback: { comments: "Revise tests." }
  });
  assert.equal(decided.status, "rejected");
  await assert.rejects(useCases.decideProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", {
    decision: "approve", revisionToken: pending.revisionToken, idempotencyKey: "stale"
  }), (error) => ["REVIEW_CONFLICT", "REVIEW_STALE_TOKEN"].includes(error.code));
});

test("Team IR Review API rejects wrong owner, changed plan, and unauthorized reviewer", async () => {
  const { useCases, task } = await setup();
  await assert.rejects(useCases.getProjectTaskTeamIrReview("project-1", "task-1", "other-run", "planner-review"), /TEAM_REVIEW_RUN_NOT_FOUND/);
  const wrongPlan = createTeamIrReviewUseCases({
    projectStore: { getProject: async () => ({ taskRecords: [task] }) },
    resolveReviewContext: async () => ({
      runtime: {}, plan: { compiledPlanDigest: "wrong", team: {} }, reviewerId: "reviewer-1",
      runRecord: { runId: "run-1", status: "waiting_human_review", waitingReview: { reviewId: "planner-review", lineage: "run" } },
      lineage: "run"
    })
  });
  await assert.rejects(wrongPlan.getProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review"), /TEAM_REVIEW_PLAN_MISMATCH/);
  const denied = await setup({ authorized: false });
  await assert.rejects(denied.useCases.decideProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", {
    decision: "approve", revisionToken: denied.pending.revisionToken, idempotencyKey: "denied"
  }), (error) => error.code === "REVIEW_UNAUTHORIZED");
});

test("Team IR Review API fails closed when Project Task runtime recovery is unavailable", async () => {
  const { task } = await setup();
  const unavailable = createTeamIrReviewUseCases({
    projectStore: { getProject: async () => ({ taskRecords: [task] }) },
    resolveReviewContext: async () => undefined
  });
  await assert.rejects(unavailable.getProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review"), /TEAM_REVIEW_RUNTIME_UNAVAILABLE/);
});

test("Team IR Review API scopes the same reviewId to the persisted Maker-Checker round", async () => {
  const { plan, runtime, task } = await setup({ loopRound: 1 });
  const runRecord = {
    runId: "run-1", status: "waiting_human_review",
    waitingReview: { reviewId: "planner-review", lineage: "run", loopRound: 1 }
  };
  const projectRuntime = {
    getReview: (runId, reviewId, lineage, loopRound) => runtime.get({ runId, reviewId, lineage, loopRound }),
    decideReview: (input) => runtime.decide(input)
  };
  const context = { runtime: projectRuntime, plan, reviewerId: "reviewer-1", runRecord, lineage: "run", loopRound: 1 };
  const useCases = createTeamIrReviewUseCases({
    projectStore: { getProject: async () => ({ taskRecords: [task] }) },
    resolveReviewContext: async () => context
  });
  const first = await runtime.open({ runId: "run-1", reviewId: "planner-review", lineage: "run", loopRound: 1, timeoutMs: 10000 });
  const second = await runtime.open({ runId: "run-1", reviewId: "planner-review", lineage: "run", loopRound: 2, timeoutMs: 10000 });

  const firstPending = await useCases.getProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review");
  assert.equal(firstPending.revisionToken, first.revisionToken);
  assert.equal(firstPending.loopRound, 1);
  await useCases.decideProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", {
    decision: "reject", revisionToken: first.revisionToken, idempotencyKey: "round-1", feedback: { comments: "Revise round one." }
  });
  assert.equal((await runtime.get({ runId: "run-1", reviewId: "planner-review", lineage: "run", loopRound: 2 })).status, "pending");

  runRecord.waitingReview.loopRound = 2;
  context.loopRound = 2;
  const secondPending = await useCases.getProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review");
  assert.equal(secondPending.revisionToken, second.revisionToken);
  assert.equal(secondPending.loopRound, 2);
  await assert.rejects(useCases.decideProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", {
    decision: "approve", revisionToken: first.revisionToken, idempotencyKey: "stale-round"
  }), (error) => error.code === "REVIEW_STALE_TOKEN" || error.code === "REVIEW_CONFLICT");

  runRecord.waitingReview.loopRound = 3;
  await assert.rejects(useCases.getProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review"), /TEAM_REVIEW_CHECKPOINT_MISMATCH/);
});

test("Team IR Review route is separate from legacy review and forwards owner path and decision payload", async () => {
  const calls = [];
  const useCases = {
    async getProjectTaskTeamIrReview(...args) { calls.push(["get", ...args]); return { status: "pending" }; },
    async decideProjectTaskTeamIrReview(...args) { calls.push(["decide", ...args]); return { status: "approved" }; }
  };
  for (const [method, suffix, body, expectedStatus] of [
    ["GET", "", undefined, 200],
    ["POST", "", { decision: "approve", revisionToken: "rev-1", idempotencyKey: "req-1" }, 200]
  ]) {
    const response = { statusCode: 0, payload: null, writeHead(status) { this.statusCode = status; }, end(raw) { this.payload = JSON.parse(raw); } };
    const handled = await handleTeamIrReviewRoutes({
      request: { method }, response,
      url: new URL(`http://localhost/api/v1/projects/project-1/tasks/task-1/runs/run-1/team-ir-reviews/planner-review${suffix}`),
      readBody: async () => body,
      sendJson: (res, status, payload) => { res.writeHead(status); res.end(JSON.stringify(payload)); },
      errorStatus: () => 500,
      useCases
    });
    assert.equal(handled, true);
    assert.equal(response.statusCode, expectedStatus);
  }
  assert.deepEqual(calls, [
    ["get", "project-1", "task-1", "run-1", "planner-review"],
    ["decide", "project-1", "task-1", "run-1", "planner-review", { decision: "approve", revisionToken: "rev-1", idempotencyKey: "req-1" }]
  ]);
  assert.equal(await handleTeamIrReviewRoutes({ request: { method: "GET" }, url: new URL("http://localhost/api/v1/projects/project-1/tasks/task-1/review") }), false);
});
