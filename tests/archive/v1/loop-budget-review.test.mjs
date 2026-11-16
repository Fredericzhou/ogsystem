import assert from "node:assert/strict";
import test from "node:test";

import { createRunConsoleLogger } from "../dist/runtime/console-run-log.js";
import { createInitialGraphState } from "../dist/runtime/graph-runtime-state.js";
import { applyGraphUpdate } from "../dist/runtime/graph-runner.js";
import { createExecutionPlan } from "../dist/runtime/execution-plan.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import { planHumanReviewDecisionTransition, planTransition } from "../dist/runtime/transition-planner.js";

const logger = createRunConsoleLogger(false);

function fixture(maxRounds = 1, semanticLoop = true, roleLoop = !semanticLoop) {
  const system = parseSystemFromMermaidSource(`flowchart TD
%% system.id=test.loop-budget-review
%% system.version=1.0.0
%% law.global=law.test
%% loop.max.boundary=1
start[开始] -->|START| boundary[Role:boundary]
boundary[Role:boundary] -->|REBUTTAL| boundary[Role:boundary]
boundary[Role:boundary] -->|SUMMARY| summary[Role:summary]
boundary[Role:boundary] -->|NEEDS_REWORK| rework[Role:rework]
boundary[Role:boundary] -->|REJECTED| rejected[Role:rejected]
summary[Role:summary] -->|READY| end[结束]
rework[Role:rework] -->|READY| end[结束]
rejected[Role:rejected] -->|READY| end[结束]
`);
  const plan = createExecutionPlan(system);
  if (semanticLoop && !roleLoop) {
    plan.nodesByRoleId.get("boundary").loopMax = undefined;
  }
  plan.semanticIR = {
    stateSchema: { defaults: {} },
    transitions: [],
    capabilities: { maxRoleActivationsByRoleId: {} },
    loops: semanticLoop ? [{
      loopId: "debate",
      members: ["boundary"],
      boundaryRoleId: "boundary",
      counterField: "round",
      maxRounds,
      onExhausted: "waiting_review"
    }] : []
  };
  const state = createInitialGraphState({ plan, prompt: "loop budget" });
  const branch = state.branchRecords["boundary@1#1"];
  state.loopCountersByScope[`${branch.lineageId}::debate`] = maxRounds;
  const trigger = planTransition({
    runId: "run-loop-budget-review",
    state,
    plan,
    logger,
    errorFlowRoutingEnabled: false,
    outcome: {
      version: 1,
      executionId: "exec-boundary-1",
      roleId: "boundary",
      branchId: branch.branchId,
      loopIteration: 1,
      sessionKey: "boundary:boundary@1#1",
      branch,
      committedAt: "2026-09-02T00:00:00.000Z",
      status: "ok",
      selectedEvent: "REBUTTAL",
      storedResult: {
        roleId: "boundary",
        event: "REBUTTAL",
        content: "continue",
        data: {},
        branchId: branch.branchId,
        lineageId: branch.lineageId,
        loopIteration: 1
      },
      audit: {
        at: "2026-09-02T00:00:00.000Z",
        roleId: "boundary",
        branchId: branch.branchId,
        loopIteration: 1,
        exitCode: 0,
        durationMs: 1,
        selectedEvent: "REBUTTAL",
        status: "ok"
      }
    }
  });
  const review = Object.values(trigger.update.pendingReviewsById ?? {})[0];
  assert.equal(review?.kind, "loop_budget");
  return { plan, state, branch, trigger, review };
}

function reviewState(fixtureValue) {
  const { state, trigger, review } = fixtureValue;
  return {
    ...state,
    stateVersion: state.stateVersion + 1,
    status: trigger.update.status,
    pendingReviewsById: { ...state.pendingReviewsById, ...trigger.update.pendingReviewsById },
    branchRecords: { ...state.branchRecords, ...trigger.update.branchRecords },
    reviewRoundByRoleLineageKey: { ...state.reviewRoundByRoleLineageKey, ...trigger.update.reviewRoundByRoleLineageKey },
    loopCountersByScope: { ...state.loopCountersByScope, ...trigger.update.loopCountersByScope },
    loopIterations: { ...state.loopIterations, ...trigger.update.loopIterations },
    roleResults: { ...state.roleResults, ...trigger.update.roleResults },
    lastWaitingReviewId: trigger.update.lastWaitingReviewId,
    lastExecutedRoleId: trigger.update.lastExecutedRoleId,
    review
  };
}

function decide(fixtureValue, decision) {
  const current = reviewState(fixtureValue);
  return planHumanReviewDecisionTransition({
    runId: "run-loop-budget-review",
    state: current,
    plan: fixtureValue.plan,
    review: current.review,
    decision: {
      reviewId: current.review.reviewId,
      round: current.review.round,
      lineageId: current.review.lineageId,
      branchId: current.review.branchId,
      loopIteration: current.review.loopIteration,
      stateVersion: current.stateVersion,
      committedAt: "2026-09-02T00:01:00.000Z",
      decidedAt: "2026-09-02T00:01:00.000Z",
      ...decision
    },
    logger,
    rolePackagesByRoleId: new Map()
  });
}

test("loop budget decision rejects unsupported actions, invalid targets, and bad grants", () => {
  for (const decision of ["approve", "pause"]) {
    assert.throws(
      () => decide(fixture(), { decision }),
      (error) => error instanceof Error && /GRAPH_LOOP_BUDGET_DECISION_INVALID/.test(error.message)
        && /requires (?:continue, rework, reject, or terminate|continue, rework, terminate, or reject)/.test(error.message)
    );
  }
  assert.throws(() => decide(fixture(), { decision: "unknown_action", targetRoleId: "boundary", additionalBudget: 1 }), /HUMAN_REVIEW_DECISION_INVALID/);
  assert.throws(() => decide(fixture(), { decision: "continue", targetRoleId: "summary", additionalBudget: 1 }), /GRAPH_LOOP_BUDGET_TARGET_INVALID/);
  assert.throws(() => decide(fixture(), { decision: "continue", targetRoleId: "boundary", additionalBudget: 0 }), /GRAPH_LOOP_BUDGET_AUTHORIZATION_INVALID/);
  assert.throws(() => decide(fixture(), { decision: "continue", targetRoleId: "boundary", additionalBudget: 1.5 }), /GRAPH_LOOP_BUDGET_AUTHORIZATION_INVALID/);
  assert.throws(() => decide(fixture(), { decision: "continue", targetRoleId: "boundary", additionalBudget: 2 }), /GRAPH_LOOP_BUDGET_AUTHORIZATION_INVALID/);
  assert.throws(() => decide(fixture(), { decision: "reject", targetRoleId: "rejected", additionalBudget: 1 }), /GRAPH_LOOP_BUDGET_AUTHORIZATION_INVALID/);
});

test("loop budget rework uses NEEDS_REWORK and preserves an unused grant", () => {
  const value = fixture();
  const transition = decide(value, { decision: "rework", targetRoleId: "rework", additionalBudget: 1 });
  const reworkBranch = Object.values(transition.update.branchRecords ?? {}).find((branch) => branch.roleId === "rework");
  assert.equal(reworkBranch?.activatedByEvent, "NEEDS_REWORK");
  assert.equal(transition.events.find((event) => event.type === "human_review_rework_requested")?.targetRoleId, "rework");
  assert.equal(transition.update.loopBudgetAuthorizationsByScope?.[`${value.branch.lineageId}::debate`], 1);
});

test("loop budget reject routes through REJECTED without granting budget", () => {
  const value = fixture();
  const transition = decide(value, { decision: "reject", targetRoleId: "rejected" });
  const rejectedBranch = Object.values(transition.update.branchRecords ?? {}).find((branch) => branch.roleId === "rejected");
  assert.equal(rejectedBranch?.activatedByEvent, "REJECTED");
  assert.equal(transition.events.find((event) => event.type === "human_review_rejected")?.targetRoleId, "rejected");
  assert.equal(transition.events.find((event) => event.type === "loop_budget_decision")?.decision, "reject");
});

test("loop budget terminate defaults to the review scope and resolves a branch-only review", () => {
  const value = fixture();
  value.review.loopBudget.terminateScope = "run";
  const runTermination = decide(value, { decision: "terminate" });
  assert.equal(runTermination.update.status, "stopped");
  assert.equal(runTermination.update.error, "loop budget terminated by human review");
  assert.equal(runTermination.events[0].scope, "run");

  const branchValue = fixture();
  branchValue.review.loopBudget.terminateScope = "branch";
  const branchTermination = decide(branchValue, { decision: "terminate" });
  assert.equal(branchTermination.update.status, "terminated");
  assert.equal(branchTermination.update.error, "loop budget terminated by human review");
  assert.equal(branchTermination.update.branchRecords?.[branchValue.branch.branchId]?.status, "completed");
  assert.equal(branchTermination.events[0].scope, "branch");
  assert.equal(branchTermination.events[1].type, "run_terminated");
});

test("loop budget terminate scope is owned by the control binding", () => {
  const value = fixture();
  value.review.loopBudget.terminateScope = "branch";
  value.review.spec.terminateScope = "run";
  const transition = decide(value, { decision: "terminate" });

  assert.equal(transition.events[0].scope, "branch");
  assert.equal(transition.update.status, "terminated");
});

test("loop budget authorization is consumed across rounds and re-enters review", () => {
  const first = fixture(2);
  const decision = decide(first, { decision: "continue", targetRoleId: "boundary", additionalBudget: 2 });
  const key = `${first.branch.lineageId}::debate`;
  assert.equal(decision.update.loopBudgetAuthorizationsByScope?.[key], 1);
  assert.equal(applyGraphUpdate(reviewState(first), decision.update).loopBudgetAuthorizationsByScope?.[key], 1);
  const nextBranch = Object.values(decision.update.branchRecords ?? {}).find((branch) => branch.roleId === "boundary" && branch.branchId !== first.branch.branchId);
  assert.ok(nextBranch);

  const secondState = {
    ...reviewState(first),
    stateVersion: reviewState(first).stateVersion + 1,
    status: decision.update.status,
    pendingReviewsById: { [first.review.reviewId]: { ...first.review, status: "resolved" }, ...decision.update.pendingReviewsById },
    branchRecords: { ...reviewState(first).branchRecords, ...decision.update.branchRecords },
    loopCountersByScope: { ...reviewState(first).loopCountersByScope, ...decision.update.loopCountersByScope },
    loopIterations: { ...reviewState(first).loopIterations, ...decision.update.loopIterations },
    loopBudgetAuthorizationsByScope: decision.update.loopBudgetAuthorizationsByScope,
    nextBranchSequence: decision.update.nextBranchSequence
  };
  secondState.loopCountersByScope[key] = 2;
  const second = planTransition({
    runId: "run-loop-budget-review",
    state: secondState,
    plan: first.plan,
    logger,
    errorFlowRoutingEnabled: false,
    outcome: {
      version: 1,
      executionId: "exec-boundary-2",
      roleId: "boundary",
      branchId: nextBranch.branchId,
      loopIteration: 3,
      sessionKey: `boundary:${nextBranch.branchId}`,
      branch: nextBranch,
      committedAt: "2026-09-02T00:02:00.000Z",
      status: "ok",
      selectedEvent: "REBUTTAL",
      storedResult: { roleId: "boundary", event: "REBUTTAL", content: "continue", data: {}, branchId: nextBranch.branchId, lineageId: nextBranch.lineageId, loopIteration: 3 },
      audit: { at: "2026-09-02T00:02:00.000Z", roleId: "boundary", branchId: nextBranch.branchId, loopIteration: 3, exitCode: 0, durationMs: 1, selectedEvent: "REBUTTAL", status: "ok" }
    }
  });
  assert.equal(second.update.loopBudgetAuthorizationsByScope?.[key], 0, JSON.stringify(second.update));
  assert.equal(second.update.status, "running");

  const thirdBranch = Object.values(second.update.branchRecords ?? {}).find((branch) => branch.roleId === "boundary" && branch.branchId !== nextBranch.branchId);
  assert.ok(thirdBranch);
  const thirdState = {
    ...secondState,
    stateVersion: secondState.stateVersion + 1,
    status: second.update.status,
    branchRecords: { ...secondState.branchRecords, ...second.update.branchRecords },
    loopCountersByScope: { ...secondState.loopCountersByScope, ...second.update.loopCountersByScope, [key]: 3 },
    loopIterations: { ...secondState.loopIterations, ...second.update.loopIterations },
    loopBudgetAuthorizationsByScope: second.update.loopBudgetAuthorizationsByScope,
    nextBranchSequence: second.update.nextBranchSequence
  };
  const third = planTransition({
    runId: "run-loop-budget-review",
    state: thirdState,
    plan: first.plan,
    logger,
    errorFlowRoutingEnabled: false,
    outcome: {
      version: 1,
      executionId: "exec-boundary-3",
      roleId: "boundary",
      branchId: thirdBranch.branchId,
      loopIteration: 3,
      sessionKey: `boundary:${thirdBranch.branchId}`,
      branch: thirdBranch,
      committedAt: "2026-09-02T00:03:00.000Z",
      status: "ok",
      selectedEvent: "REBUTTAL",
      storedResult: { roleId: "boundary", event: "REBUTTAL", content: "continue", data: {}, branchId: thirdBranch.branchId, lineageId: thirdBranch.lineageId, loopIteration: 3 },
      audit: { at: "2026-09-02T00:03:00.000Z", roleId: "boundary", branchId: thirdBranch.branchId, loopIteration: 3, exitCode: 0, durationMs: 1, selectedEvent: "REBUTTAL", status: "ok" }
    }
  });
  assert.equal(third.update.status, "waiting_review");
  const secondReview = Object.values(third.update.pendingReviewsById ?? {}).find((item) => item.kind === "loop_budget");
  assert.equal(secondReview?.round, 2);
});

test("loop budget terminate(branch) terminates the run when it is the only active branch", () => {
  const value = fixture();
  value.review.loopBudget.terminateScope = "branch";
  const transition = decide(value, { decision: "terminate", scope: "branch" });

  assert.equal(transition.update.status, "terminated");
  assert.equal(transition.update.error, "loop budget terminated by human review");
  assert.equal(transition.update.branchRecords?.[value.branch.branchId]?.status, "completed");
  assert.equal(transition.events[0].type, "human_review_terminated");
  assert.equal(transition.events[0].scope, "branch");
});

test("loop budget branch termination records skipped join source outcomes", () => {
  const value = fixture();
  const summary = value.plan.nodesByRoleId.get("summary");
  assert.ok(summary);
  summary.joinMode = "all_of";
  summary.joinSources = ["boundary", "other"];
  summary.incoming = [
    { fromRoleId: "boundary", toRoleId: "summary", eventType: "SUMMARY" },
    { fromRoleId: "other", toRoleId: "summary", eventType: "READY" }
  ];
  value.state.branchRecords["other@1#9"] = {
    branchId: "other@1#9",
    roleId: "other",
    loopIteration: 1,
    branchSequence: 9,
    lineageId: value.branch.lineageId,
    sessionLineageId: "other@1#9",
    status: "active"
  };
  const transition = decide(value, { decision: "terminate", scope: "branch" });
  const joinKey = JSON.stringify(["summary", value.branch.lineageId, 1]);
  assert.equal(transition.update.status, "running");
  assert.equal(transition.update.joinSourceOutcomesByScope?.[joinKey]?.boundary, "skipped");
});

test("parallel loop targets consume one authorization each", () => {
  const system = parseSystemFromMermaidSource(`flowchart TD
%% system.id=test.parallel-loop-budget
%% system.version=1.0.0
%% law.global=law.test
%% role.mode.dispatch=parallel_split
start[开始] -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|READY| workerA[Role:worker_a]
dispatch[Role:dispatch] -->|READY| workerB[Role:worker_b]
workerA[Role:worker_a] -->|READY| end[结束]
workerB[Role:worker_b] -->|READY| end[结束]
`);
  const plan = createExecutionPlan(system);
  plan.semanticIR = {
    stateSchema: { defaults: {} },
    transitions: [],
    capabilities: { maxRoleActivationsByRoleId: {} },
    loops: [{
      loopId: "debate",
      members: ["dispatch", "worker_a", "worker_b"],
      boundaryRoleId: "dispatch",
      counterField: "round",
      maxRounds: 1,
      onExhausted: "waiting_review"
    }]
  };
  const state = createInitialGraphState({ plan, prompt: "parallel loop budget" });
  const branch = state.branchRecords["dispatch@1#1"];
  const budgetKey = `${branch.lineageId}::debate`;
  state.loopCountersByScope = state.loopCountersByScope ?? {};
  state.loopBudgetAuthorizationsByScope = state.loopBudgetAuthorizationsByScope ?? {};
  state.loopCountersByScope[budgetKey] = 2;
  state.loopBudgetAuthorizationsByScope[budgetKey] = 2;

  const transition = planTransition({
    runId: "run-parallel-loop-budget",
    state,
    plan,
    logger,
    errorFlowRoutingEnabled: false,
    outcome: {
      version: 1,
      executionId: "exec-dispatch-1",
      roleId: "dispatch",
      branchId: branch.branchId,
      loopIteration: 1,
      sessionKey: "dispatch:dispatch@1#1",
      branch,
      committedAt: "2026-09-02T00:00:00.000Z",
      status: "ok",
      selectedEvent: "READY",
      storedResult: {
        roleId: "dispatch",
        event: "READY",
        content: "fan out",
        data: {},
        branchId: branch.branchId,
        lineageId: branch.lineageId,
        loopIteration: 1
      },
      audit: {
        at: "2026-09-02T00:00:00.000Z",
        roleId: "dispatch",
        branchId: branch.branchId,
        loopIteration: 1,
        exitCode: 0,
        durationMs: 1,
        selectedEvent: "READY",
        status: "ok"
      }
    }
  });

  assert.equal(transition.update.loopBudgetAuthorizationsByScope?.[budgetKey], 0);
  assert.equal(Object.values(transition.update.branchRecords ?? {}).filter((item) => item.status === "active").length, 2);
});

test("parallel checkpoint merges consume budget deltas against the latest CAS state", () => {
  const value = fixture();
  const key = `${value.branch.lineageId}::debate`;
  const base = { ...value.state, loopBudgetAuthorizationsByScope: { [key]: 2 } };
  const decrement = {
    loopBudgetAuthorizationsByScope: { [key]: 1 },
    loopBudgetAuthorizationDeltasByScope: { [key]: -1 }
  };
  const afterFirst = applyGraphUpdate(base, decrement);
  const afterSecond = applyGraphUpdate(afterFirst, decrement);
  assert.equal(afterFirst.loopBudgetAuthorizationsByScope?.[key], 1);
  assert.equal(afterSecond.loopBudgetAuthorizationsByScope?.[key], 0);
});

test("role-level loopMax budget is consumed without a Semantic IR loop scope", () => {
  const value = fixture(1, false);
  const roleBudgetKey = `${value.branch.lineageId}::role:boundary`;
  const transition = decide(value, {
    decision: "continue",
    targetRoleId: "boundary",
    additionalBudget: 1
  });
  assert.equal(transition.update.loopBudgetAuthorizationsByScope?.[roleBudgetKey], 0);
});

test("failed execution compensates a budget consumed during branch activation", () => {
  const value = fixture(1, false, true);
  const key = `${value.branch.lineageId}::role:boundary`;
  value.state.loopBudgetAuthorizationsByScope = { [key]: 0 };
  value.branch.consumedLoopBudgetKeys = [key];
  value.state.branchRecords[value.branch.branchId] = value.branch;

  const transition = planTransition({
    runId: "run-loop-budget-review",
    state: value.state,
    plan: value.plan,
    logger,
    errorFlowRoutingEnabled: false,
    outcome: {
      version: 1,
      executionId: "exec-boundary-failed",
      roleId: "boundary",
      branchId: value.branch.branchId,
      loopIteration: value.branch.loopIteration,
      sessionKey: "boundary:boundary@1#1",
      branch: value.branch,
      committedAt: "2026-09-02T00:04:00.000Z",
      status: "failed",
      error: "tool spawn failed",
      failure: {
        errorCode: "TOOL_EXECUTION_SPAWN",
        errorCategory: "execution",
        message: "tool spawn failed",
        retryable: true,
        stage: "execute",
        roleId: "boundary",
        branchId: value.branch.branchId
      },
      audit: {
        at: "2026-09-02T00:04:00.000Z",
        roleId: "boundary",
        branchId: value.branch.branchId,
        lineageId: value.branch.lineageId,
        loopIteration: value.branch.loopIteration,
        executionId: "exec-boundary-failed",
        exitCode: 1,
        durationMs: 1,
        status: "failed",
        error: "tool spawn failed"
      }
    }
  });

  assert.equal(transition.update.loopBudgetAuthorizationDeltasByScope?.[key], 1);

  const nonRetryable = planTransition({
    runId: "run-loop-budget-review",
    state: value.state,
    plan: value.plan,
    logger,
    errorFlowRoutingEnabled: false,
    outcome: {
      version: 1,
      executionId: "exec-boundary-invalid",
      roleId: "boundary",
      branchId: value.branch.branchId,
      loopIteration: value.branch.loopIteration,
      sessionKey: "boundary:boundary@1#1",
      branch: value.branch,
      committedAt: "2026-09-02T00:04:01.000Z",
      status: "failed",
      error: "invalid business output",
      failure: {
        errorCode: "ROLE_OUTPUT_INVALID",
        errorCategory: "validation",
        message: "invalid business output",
        retryable: false,
        stage: "validate",
        roleId: "boundary",
        branchId: value.branch.branchId
      },
      audit: {
        at: "2026-09-02T00:04:01.000Z",
        roleId: "boundary",
        branchId: value.branch.branchId,
        lineageId: value.branch.lineageId,
        loopIteration: value.branch.loopIteration,
        executionId: "exec-boundary-invalid",
        exitCode: 1,
        durationMs: 1,
        status: "failed",
        error: "invalid business output"
      }
    }
  });
  assert.equal(nonRetryable.update.loopBudgetAuthorizationDeltasByScope?.[key], undefined);
});

test("combined scope and role budgets fail closed independently", () => {
  const value = fixture(10, true, true);
  const key = `${value.branch.lineageId}::role:boundary`;
  const scopeKey = `${value.branch.lineageId}::debate`;
  value.state.loopCountersByScope[scopeKey] = 0;
  value.state.loopIterations.boundary = 1;
  const transition = planTransition({
    runId: "run-loop-budget-combined",
    state: value.state,
    plan: value.plan,
    logger,
    errorFlowRoutingEnabled: false,
    outcome: {
      version: 1,
      executionId: "exec-boundary-combined",
      roleId: "boundary",
      branchId: value.branch.branchId,
      loopIteration: 1,
      sessionKey: `boundary:${value.branch.branchId}`,
      branch: value.branch,
      committedAt: "2026-09-02T00:00:00.000Z",
      status: "ok",
      selectedEvent: "REBUTTAL",
      storedResult: { roleId: "boundary", event: "REBUTTAL", content: "continue", data: {}, branchId: value.branch.branchId, lineageId: value.branch.lineageId, loopIteration: 1 },
      audit: { at: "2026-09-02T00:00:00.000Z", roleId: "boundary", branchId: value.branch.branchId, loopIteration: 1, exitCode: 0, durationMs: 1, selectedEvent: "REBUTTAL", status: "ok" }
    }
  });
  const review = Object.values(transition.update.pendingReviewsById ?? {})[0];
  assert.equal(review?.loopBudget?.loopId, "role:boundary");
  assert.equal(review?.loopBudget?.maxRounds, 1);
  assert.equal(transition.update.status, "waiting_review");
  assert.equal(transition.update.loopBudgetAuthorizationsByScope?.[key], undefined);
});

test("loop budget decision rejects stale and mismatched bindings", () => {
  const value = fixture();
  assert.throws(() => decide(value, { decision: "continue", targetRoleId: "boundary", additionalBudget: 1, lineageId: "wrong" }), /GRAPH_REVIEW_LINEAGE_MISMATCH/);
  const stale = fixture();
  assert.throws(() => decide(stale, { decision: "continue", targetRoleId: "boundary", additionalBudget: 1, stateVersion: 99 }), /GRAPH_REVIEW_STATE_VERSION_STALE/);
  const missing = fixture();
  const current = reviewState(missing);
  assert.throws(() => planHumanReviewDecisionTransition({
    state: current,
    plan: missing.plan,
    review: current.review,
    decision: { reviewId: current.review.reviewId, decision: "continue" },
    logger,
    rolePackagesByRoleId: new Map()
  }), /GRAPH_REVIEW_BINDING_MISSING/);
});

test("handled failure aborts routing and fails closed when target exceeds loop budget", () => {
  const system = parseSystemFromMermaidSource(`flowchart TD
%% system.id=test.error-loop-budget
%% system.version=1.0.0
%% law.global=law.test
%% loop.max.handler=1
start[开始] -->|START| worker[Role:worker]
worker[Role:worker] -->|ERROR| handler[Role:handler]
handler[Role:handler] -->|READY| end[结束]
`);
  const plan = createExecutionPlan(system);
  const state = createInitialGraphState({ plan, prompt: "error loop budget" });
  const branch = state.branchRecords["worker@1#1"];
  state.loopIterations.handler = 1; // handler already exhausted its loop budget (loopMax = 1)

  const transition = planTransition({
    runId: "run-error-loop-budget",
    state,
    plan,
    logger,
    errorFlowRoutingEnabled: true,
    outcome: {
      version: 1,
      executionId: "exec-worker-error",
      roleId: "worker",
      branchId: branch.branchId,
      loopIteration: 1,
      sessionKey: `worker:${branch.branchId}`,
      branch,
      committedAt: "2026-09-02T00:00:00.000Z",
      status: "failed",
      error: "unrecoverable worker failure",
      failure: {
        errorCode: "GENERIC_EXECUTION_FAILURE",
        errorCategory: "execution",
        message: "unrecoverable worker failure",
        retryable: false,
        stage: "execute",
        roleId: "worker",
        branchId: branch.branchId
      },
      audit: {
        at: "2026-09-02T00:00:00.000Z",
        roleId: "worker",
        branchId: branch.branchId,
        lineageId: branch.lineageId,
        loopIteration: 1,
        exitCode: 1,
        durationMs: 1,
        status: "failed",
        error: "unrecoverable worker failure"
      }
    }
  });

  // Because handler's loopMax is reached and loopBudgetFailureMode is "abort_routing",
  // it aborts the error flow rather than creating a loop budget review for worker.
  assert.equal(transition.update.status, "failed");
  assert.equal(transition.update.pendingReviewsById, undefined);
});

test("loop budget review requestedAt matches audit timestamp for deterministic WAL replay", () => {
  const value = fixture();
  assert.equal(value.review.requestedAt, "2026-09-02T00:00:00.000Z");
  assert.equal(value.trigger.events[0].at, "2026-09-02T00:00:00.000Z");
});

