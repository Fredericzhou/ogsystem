import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileTeamIr, MemoryTeamReviewStore, TeamReviewRuntime, teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
import { createBasicControlPlaneIdentityProvider } from "../../../dist/runtime/identity.js";
import { createProjectTaskTeamIrReviewContextResolver, createTeamIrReviewUseCases } from "../application/team-ir-review-use-cases.mjs";
import { createTeamIrReviewPrincipalResolver, handleTeamIrReviewRoutes } from "../api/team-ir-review-routes.mjs";

const fixtureUrl = new URL("../../../examples/team-ir-v2/classic-software-team.json", import.meta.url);
const testPrincipal = { id: "reviewer-1", issuer: "test" };

async function setup({ reviewerId = "reviewer-1", authorized = true, loopRound, includeResume = true, resumeTeamIrRun } = {}) {
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
  const resumeCalls = [];
  const coreUseCases = createTeamIrReviewUseCases({
    projectStore: { getProject: async () => ({ projectId: "project-1", taskRecords: [task] }) },
    resolveReviewContext: async () => ({
      runtime: projectRuntime, plan, reviewerId, runRecord, lineage: "run", loopRound,
      ...(includeResume ? { resumeTeamIrRun: resumeTeamIrRun || (async (input) => {
        resumeCalls.push(input);
        return { state: { runId: input.runId, status: "running" }, teamRun: { privateCheckpoint: true }, store: { internal: true } };
      }) } : {})
    })
  });
  const useCases = {
    getProjectTaskTeamIrReview: (...args) => coreUseCases.getProjectTaskTeamIrReview(...args, testPrincipal),
    decideProjectTaskTeamIrReview: (...args) => coreUseCases.decideProjectTaskTeamIrReview(...args, testPrincipal)
  };
  const pending = await runtime.openFromPlan({ plan, runId: "run-1", reviewId: "planner-review" });
  return { plan, runtime, useCases, pending, task, runRecord, resumeCalls };
}

test("owner scoped Team IR Review API reads pending state and validates reject feedback and revision", async () => {
  const { useCases, pending, runtime, resumeCalls } = await setup();
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
    decision: "reject", revisionToken: pending.revisionToken, idempotencyKey: "reject-1", feedback: { comments: "Revise tests." }, reviewerId: "forged-reviewer"
  });
  assert.equal(decided.status, "rejected");
  assert.deepEqual(decided.resumedRun, { runId: "run-1", status: "running" });
  assert.equal(resumeCalls.length, 1);
  assert.equal((await runtime.get({ runId: "run-1", reviewId: "planner-review" })).status, "rejected",
    "the durable Review decision must be visible before same-Run resume dispatch");
  assert.equal((await runtime.get({ runId: "run-1", reviewId: "planner-review" })).reviewerId, testPrincipal.id);
  assert.equal(resumeCalls[0].dispatchId, "run-1:team-review:planner-review:run:run");
  await assert.rejects(useCases.decideProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", {
    decision: "approve", revisionToken: pending.revisionToken, idempotencyKey: "stale"
  }), (error) => ["REVIEW_CONFLICT", "REVIEW_STALE_TOKEN"].includes(error.code));
});

test("Team IR Review decision fails closed without resume dispatch and retries a committed decision with a stable dispatch ID", async () => {
  const unavailable = await setup({ includeResume: false });
  await assert.rejects(unavailable.useCases.decideProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", {
    decision: "approve", revisionToken: unavailable.pending.revisionToken, idempotencyKey: "approve-unavailable"
  }), /TEAM_REVIEW_RESUME_UNAVAILABLE/);
  assert.equal((await unavailable.runtime.get({ runId: "run-1", reviewId: "planner-review" })).status, "pending",
    "missing dispatch must be rejected before committing the Review decision");

  let attempts = 0;
  const resumable = await setup({ resumeTeamIrRun: async (input) => {
    attempts += 1;
    assert.equal((await input.runtime.getReview(input.runId, input.reviewId, input.lineage, input.loopRound)).status, "approved");
    if (attempts === 1) throw new Error("resume unavailable after decision commit");
    return { runId: input.runId, status: "running" };
  } });
  const request = { decision: "approve", revisionToken: resumable.pending.revisionToken, idempotencyKey: "approve-resume-retry" };
  await assert.rejects(resumable.useCases.decideProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", request), /resume unavailable/);
  const retried = await resumable.useCases.decideProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", request);
  assert.equal(retried.status, "approved");
  assert.equal(retried.resumedRun.status, "running");
  assert.equal(attempts, 2);
});

test("Team IR Review replays the same idempotency key after Run completion and returns only a public Run projection", async () => {
  const { useCases, pending, runRecord, resumeCalls } = await setup();
  const request = { decision: "approve", revisionToken: pending.revisionToken, idempotencyKey: "approve-lost-response" };
  const first = await useCases.decideProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", request);
  assert.deepEqual(first.resumedRun, { runId: "run-1", status: "running" });
  runRecord.status = "completed";
  runRecord.waitingReview = undefined;
  runRecord.events = [{ type: "run.review.approved", data: { reviewId: "planner-review" } }];
  const replay = await useCases.decideProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", request);
  assert.equal(replay.status, "approved");
  assert.deepEqual(replay.resumedRun, { runId: "run-1", status: "running" });
  assert.equal(resumeCalls.length, 2);
  assert.equal(resumeCalls[0].dispatchId, resumeCalls[1].dispatchId);
  assert.equal(Object.hasOwn(replay.resumedRun, "teamRun"), false);
  assert.equal(Object.hasOwn(replay.resumedRun, "store"), false);
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
  await assert.rejects(wrongPlan.getProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", testPrincipal), /TEAM_REVIEW_PLAN_MISMATCH/);
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
  await assert.rejects(unavailable.getProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", testPrincipal), /TEAM_REVIEW_RUNTIME_UNAVAILABLE/);
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
  const context = {
    runtime: projectRuntime, plan, reviewerId: "reviewer-1", runRecord, lineage: "run", loopRound: 1,
    resumeTeamIrRun: async () => ({ status: "running" })
  };
  const useCases = createTeamIrReviewUseCases({
    projectStore: { getProject: async () => ({ taskRecords: [task] }) },
    resolveReviewContext: async () => context
  });
  const first = await runtime.open({ runId: "run-1", reviewId: "planner-review", lineage: "run", loopRound: 1, timeoutMs: 10000 });
  const second = await runtime.open({ runId: "run-1", reviewId: "planner-review", lineage: "run", loopRound: 2, timeoutMs: 10000 });

  const firstPending = await useCases.getProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", testPrincipal);
  assert.equal(firstPending.revisionToken, first.revisionToken);
  assert.equal(firstPending.loopRound, 1);
  await useCases.decideProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", {
    decision: "reject", revisionToken: first.revisionToken, idempotencyKey: "round-1", feedback: { comments: "Revise round one." }
  }, testPrincipal);
  assert.equal((await runtime.get({ runId: "run-1", reviewId: "planner-review", lineage: "run", loopRound: 2 })).status, "pending");

  runRecord.waitingReview.loopRound = 2;
  context.loopRound = 2;
  const secondPending = await useCases.getProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", testPrincipal);
  assert.equal(secondPending.revisionToken, second.revisionToken);
  assert.equal(secondPending.loopRound, 2);
  await assert.rejects(useCases.decideProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", {
    decision: "approve", revisionToken: first.revisionToken, idempotencyKey: "stale-round"
  }, testPrincipal), (error) => error.code === "REVIEW_STALE_TOKEN" || error.code === "REVIEW_CONFLICT");

  runRecord.waitingReview.loopRound = 3;
  await assert.rejects(useCases.getProjectTaskTeamIrReview("project-1", "task-1", "run-1", "planner-review", testPrincipal), /TEAM_REVIEW_CHECKPOINT_MISMATCH/);
});

test("Team IR Review route authenticates a trusted principal and ignores body reviewer identity", async () => {
  const calls = [];
  const useCases = {
    async getProjectTaskTeamIrReview(...args) { calls.push(["get", ...args]); return { status: "pending" }; },
    async decideProjectTaskTeamIrReview(...args) { calls.push(["decide", ...args]); return { status: "approved" }; }
  };
  for (const [method, suffix, body, expectedStatus] of [
    ["GET", "", undefined, 200],
    ["POST", "", { decision: "approve", revisionToken: "rev-1", idempotencyKey: "req-1", reviewerId: "forged-reviewer" }, 200]
  ]) {
    const response = { statusCode: 0, payload: null, writeHead(status) { this.statusCode = status; }, end(raw) { this.payload = JSON.parse(raw); } };
    const handled = await handleTeamIrReviewRoutes({
      request: { method }, response,
      url: new URL(`http://localhost/api/v1/projects/project-1/tasks/task-1/runs/run-1/team-ir-reviews/planner-review${suffix}`),
      readBody: async () => body,
      sendJson: (res, status, payload) => { res.writeHead(status); res.end(JSON.stringify(payload)); },
      errorStatus: () => 500,
      useCases,
      resolvePrincipal: async () => testPrincipal
    });
    assert.equal(handled, true);
    assert.equal(response.statusCode, expectedStatus);
  }
  assert.deepEqual(calls, [
    ["get", "project-1", "task-1", "run-1", "planner-review", testPrincipal],
    ["decide", "project-1", "task-1", "run-1", "planner-review", { decision: "approve", revisionToken: "rev-1", idempotencyKey: "req-1", reviewerId: "forged-reviewer" }, testPrincipal]
  ]);
  const unauthenticatedResponse = { statusCode: 0, writeHead(status) { this.statusCode = status; }, end() {} };
  await handleTeamIrReviewRoutes({
    request: { method: "GET" }, response: unauthenticatedResponse,
    url: new URL("http://localhost/api/v1/projects/project-1/tasks/task-1/runs/run-1/team-ir-reviews/planner-review"),
    sendJson: (res, status) => res.writeHead(status), useCases
  });
  assert.equal(unauthenticatedResponse.statusCode, 401);
  assert.equal(await handleTeamIrReviewRoutes({ request: { method: "GET" }, url: new URL("http://localhost/api/v1/projects/project-1/tasks/task-1/review") }), false);
});

test("Team IR Review principal resolver trusts loopback locally, remote Basic auth, and fails closed otherwise", async () => {
  const local = createTeamIrReviewPrincipalResolver({ createLocalPrincipal: () => ({ id: "local:operator", issuer: "ogs:local" }) });
  assert.deepEqual(await local({ socket: { remoteAddress: "::ffff:127.0.0.1" } }), { id: "local:operator", issuer: "ogs:local" });
  assert.equal(await local({ socket: { remoteAddress: "203.0.113.9" } }), null);

  const remote = createTeamIrReviewPrincipalResolver({
    createLocalPrincipal: () => ({ id: "local:operator", issuer: "ogs:local" }),
    basicIdentityProvider: createBasicControlPlaneIdentityProvider({ username: "reviewer", password: "correct horse battery staple" })
  });
  assert.equal(await remote({ socket: { remoteAddress: "203.0.113.9" } }), null);
  const credential = `Basic ${Buffer.from("reviewer:correct horse battery staple").toString("base64")}`;
  assert.equal(await remote({
    socket: { remoteAddress: "203.0.113.9", encrypted: false },
    headers: { authorization: credential }
  }), null, "Basic credentials are not accepted over the Team Site's plain HTTP socket");
  assert.deepEqual(await remote({
    socket: { remoteAddress: "203.0.113.9", encrypted: true },
    headers: { authorization: credential }
  }), { id: "reviewer", issuer: "ogs:basic-auth", displayName: "reviewer" });

  const authorizedPrincipals = [];
  const routeUseCases = {
    async getProjectTaskTeamIrReview(_projectId, _taskId, _runId, _reviewId, principal) {
      authorizedPrincipals.push(principal);
      return { status: "pending" };
    }
  };
  for (const [request, expectedStatus] of [
    [{ method: "GET", socket: { remoteAddress: "127.0.0.1", encrypted: false } }, 200],
    [{ method: "GET", socket: { remoteAddress: "203.0.113.9", encrypted: false }, headers: { authorization: credential } }, 401],
    [{ method: "GET", socket: { remoteAddress: "203.0.113.9", encrypted: true }, headers: { authorization: credential } }, 200]
  ]) {
    const response = { statusCode: 0, writeHead(status) { this.statusCode = status; }, end() {} };
    await handleTeamIrReviewRoutes({
      request, response,
      url: new URL("http://site.test/api/v1/projects/project-1/tasks/task-1/runs/run-1/team-ir-reviews/planner-review"),
      sendJson: (res, status) => res.writeHead(status), useCases: routeUseCases, resolvePrincipal: remote
    });
    assert.equal(response.statusCode, expectedStatus);
  }
  assert.deepEqual(authorizedPrincipals, [
    { id: "local:operator", issuer: "ogs:local" },
    { id: "reviewer", issuer: "ogs:basic-auth", displayName: "reviewer" }
  ]);
});

test("Team IR Review composition forwards the frozen checkpoint to the same Task resume bridge", async () => {
  const calls = [];
  const contextResolver = createProjectTaskTeamIrReviewContextResolver({
    teamIrProjectRunExecutor: {
      async getReviewContext(input) {
        calls.push(["context", input]);
        return { lineage: "run", loopRound: 2, resumeTeamIrRun: async () => assert.fail("executor resume must not bypass Task projection") };
      }
    },
    getTaskExecutionUseCases: () => ({
      async resumeProjectTaskRun(...args) { calls.push(["resume", ...args]); return { state: { status: "waiting_review" } }; }
    })
  });
  const input = {
    project: { projectId: "project-1" },
    task: { taskId: "task-1" },
    runId: "run-1", reviewId: "maker-checker", principal: testPrincipal
  };
  const context = await contextResolver(input);
  const result = await context.resumeTeamIrRun({ dispatchId: "run-1:team-review:maker-checker:run:2" });
  assert.equal(result.state.status, "waiting_review");
  assert.deepEqual(calls, [
    ["context", input],
    ["resume", "project-1", "task-1", "run-1", {
      reviewId: "maker-checker", lineage: "run", loopRound: 2, dispatchId: "run-1:team-review:maker-checker:run:2"
    }]
  ]);
});

test("Team Site production composition injects the v2 executor, Task resume bridge, and authenticated Review route", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(source, /teamIrRunStore:\s*teamIrProjectRunExecutor/);
  assert.match(source, /getTaskExecutionUseCases:\s*\(\)\s*=>\s*taskExecutionUseCases/);
  assert.match(source, /resolvePrincipal:\s*resolveTeamIrReviewPrincipal/);
});
