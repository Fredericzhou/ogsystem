import test from "node:test";
import assert from "node:assert/strict";

import { createRunConsoleLogger } from "../dist/runtime/console-run-log.js";
import { createExecutionPlan } from "../dist/runtime/execution-plan.js";
import {
  createInitialGraphState,
  projectStateSnapshot
} from "../dist/runtime/graph-runtime-state.js";
import { buildReviewId, buildReviewRoundKey } from "../dist/runtime/human-review.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import {
  planHumanReviewDecisionTransition,
  planTransition
} from "../dist/runtime/transition-planner.js";

function applyGraphUpdate(state, update) {
  return {
    ...state,
    status: update.status ?? state.status,
    error: state.error || update.error || "",
    errorEnvelope: state.errorEnvelope ?? update.errorEnvelope,
    transitionCount: state.transitionCount + (update.transitionCount ?? 0),
    recentAudits: state.recentAudits.concat(update.recentAudits ?? []),
    auditSummary: {
      ...state.auditSummary,
      ...(update.auditSummary ?? {})
    },
    roleMetricsByRoleId: {
      ...state.roleMetricsByRoleId,
      ...(update.roleMetricsByRoleId ?? {})
    },
    roleResults: {
      ...state.roleResults,
      ...(update.roleResults ?? {})
    },
    pendingReviewsById: {
      ...state.pendingReviewsById,
      ...(update.pendingReviewsById ?? {})
    },
    reviewHistoryByBranchId: {
      ...state.reviewHistoryByBranchId,
      ...(update.reviewHistoryByBranchId ?? {})
    },
    reviewRoundByRoleLineageKey: {
      ...state.reviewRoundByRoleLineageKey,
      ...(update.reviewRoundByRoleLineageKey ?? {})
    },
    lastWaitingReviewId: update.lastWaitingReviewId ?? state.lastWaitingReviewId,
    branchRecords: {
      ...state.branchRecords,
      ...(update.branchRecords ?? {})
    },
    loopIterations: {
      ...state.loopIterations,
      ...(update.loopIterations ?? {})
    },
    selectedEventByBranchId: {
      ...state.selectedEventByBranchId,
      ...(update.selectedEventByBranchId ?? {})
    },
    finalOutput: update.finalOutput ?? state.finalOutput,
    finalRoleId: update.finalRoleId ?? state.finalRoleId,
    lastExecutedRoleId: update.lastExecutedRoleId ?? state.lastExecutedRoleId,
    nextBranchSequence: update.nextBranchSequence ?? state.nextBranchSequence,
    lastCheckpointSequence: Math.max(
      state.lastCheckpointSequence,
      update.lastCheckpointSequence ?? state.lastCheckpointSequence
    )
  };
}

test("transition planner parks reviewed outcomes as pending human review without releasing role results", () => {
  const system = parseSystemFromMermaidSource(`flowchart TD
%% system.id=test.runtime.human-review
%% system.version=1.0.0
%% law.global=law.test
%% entry.role=writer
%% exec.bind.writer=profile.writer
%% review.mode.writer=required
%% review.timeout.writer=180
%% review.timeout.action.writer=terminate
%% review.rework.max.writer=2
%% review.terminate.scope.writer=run
input -->|GO| writer[Role:writer]
writer[Role:writer] -->|DONE| output
`);
  const plan = createExecutionPlan(system);
  const state = createInitialGraphState({
    plan,
    prompt: "review me"
  });
  const branch = state.branchRecords["writer@1#1"];
  const logger = createRunConsoleLogger(false);

  const transition = planTransition({
    state,
    plan,
    logger,
    errorFlowRoutingEnabled: false,
    outcome: {
      version: 1,
      executionId: "exec-writer-1",
      roleId: "writer",
      branchId: branch.branchId,
      loopIteration: 1,
      sessionKey: "writer:writer@1#1",
      branch,
      committedAt: "2026-04-22T08:00:00.000Z",
      status: "ok",
      selectedEvent: "DONE",
      storedResult: {
        roleId: "writer",
        event: "DONE",
        content: "draft only",
        data: { version: 1 },
        branchId: branch.branchId,
        lineageId: branch.lineageId,
        loopIteration: 1
      },
      audit: {
        at: "2026-04-22T08:00:00.000Z",
        roleId: "writer",
        branchId: branch.branchId,
        loopIteration: 1,
        exitCode: 0,
        durationMs: 12,
        selectedEvent: "DONE",
        status: "ok"
      }
    }
  });

  const reviewId = buildReviewId(branch.branchId, 1);
  const reviewRoundKey = buildReviewRoundKey("writer", branch.lineageId);

  assert.deepStrictEqual(transition.update.roleResults ?? {}, {});
  assert.deepStrictEqual(transition.update.selectedEventByBranchId ?? {}, {});
  assert.equal(transition.update.lastWaitingReviewId, reviewId);
  assert.equal(transition.update.branchRecords?.[branch.branchId]?.status, "waiting_review");
  assert.equal(transition.update.reviewRoundByRoleLineageKey?.[reviewRoundKey], 1);
  assert.equal(transition.reviewRequests?.length, 1);
  assert.deepStrictEqual(transition.reviewRequests?.[0], transition.update.pendingReviewsById?.[reviewId]);
  assert.deepStrictEqual(transition.update.pendingReviewsById?.[reviewId], {
    reviewId,
    roleId: "writer",
    branchId: branch.branchId,
    lineageId: branch.lineageId,
    loopIteration: 1,
    executionId: "exec-writer-1",
    selectedEvent: "DONE",
    draftResult: {
      roleId: "writer",
      event: "DONE",
      content: "draft only",
      data: { version: 1 },
      branchId: branch.branchId,
      lineageId: branch.lineageId,
      loopIteration: 1
    },
    requestedAt: transition.reviewRequests?.[0].requestedAt,
    requestedByExecutionId: "exec-writer-1",
    status: "pending",
    round: 1,
    stateVersion: 0,
    spec: {
      mode: "required",
      timeoutSeconds: 180,
      timeoutAction: "terminate",
      reworkTargetRoleId: "writer",
      reworkMax: 2,
      terminateScope: "run"
    }
  });
  assert.deepStrictEqual(transition.events, [
    {
      type: "human_review_requested",
      at: transition.reviewRequests?.[0].requestedAt,
      roleId: "writer",
      branchId: branch.branchId,
      lineageId: branch.lineageId,
      loopIteration: 1,
      reviewId,
      round: 1
    }
  ]);

  const updatedState = applyGraphUpdate(state, transition.update);
  const snapshot = projectStateSnapshot({
    state: updatedState,
    plan
  });

  assert.equal(snapshot.pendingReviewCount, 1);
  assert.equal(snapshot.hasWaitingHumanReview, true);
  assert.deepStrictEqual(snapshot.activeBranches, []);
  assert.deepStrictEqual(updatedState.roleResults, {});
});

test("human review pause decision keeps the branch waiting and unreleased", () => {
  const system = parseSystemFromMermaidSource(`flowchart TD
%% system.id=test.runtime.human-review.pause
%% system.version=1.0.0
%% law.global=law.test
%% entry.role=writer
%% exec.bind.writer=profile.writer
%% review.mode.writer=required
input -->|GO| writer[Role:writer]
writer[Role:writer] -->|DONE| output
`);
  const plan = createExecutionPlan(system);
  const state = createInitialGraphState({ plan, prompt: "pause review" });
  const logger = createRunConsoleLogger(false);
  const branch = state.branchRecords["writer@1#1"];
  state.pendingReviewsById["review.writer@1#1.r1"] = {
    reviewId: "review.writer@1#1.r1",
    roleId: "writer",
    branchId: branch.branchId,
    lineageId: branch.lineageId,
    loopIteration: 1,
    executionId: "exec-writer-1",
    selectedEvent: "DONE",
    draftResult: {
      roleId: "writer",
      event: "DONE",
      content: "draft only",
      branchId: branch.branchId,
      lineageId: branch.lineageId,
      loopIteration: 1
    },
    requestedAt: "2026-04-22T08:00:00.000Z",
    requestedByExecutionId: "exec-writer-1",
    status: "pending",
    round: 1,
    spec: {
      mode: "required",
      timeoutAction: "pause",
      reworkTargetRoleId: "writer",
      terminateScope: "branch"
    }
  };
  state.branchRecords[branch.branchId] = {
    ...branch,
    status: "waiting_review"
  };

  const transition = planHumanReviewDecisionTransition({
    state,
    plan,
    review: state.pendingReviewsById["review.writer@1#1.r1"],
    decision: {
      reviewId: "review.writer@1#1.r1",
      committedAt: "2026-04-22T08:01:00.000Z",
      decidedAt: "2026-04-22T08:01:00.000Z",
      decision: "pause",
      comment: "hold"
    },
    logger
  });

  assert.equal(transition.update.status, undefined);
  assert.deepStrictEqual(transition.update.roleResults ?? {}, {});
  assert.equal(transition.update.pendingReviewsById["review.writer@1#1.r1"].status, "paused");
  assert.equal(transition.update.lastWaitingReviewId, "review.writer@1#1.r1");
  assert.equal(transition.events[0].type, "human_review_paused");
});

test("human review rework decision activates a rework branch with feedback context", () => {
  const system = parseSystemFromMermaidSource(`flowchart TD
%% system.id=test.runtime.human-review.rework
%% system.version=1.0.0
%% law.global=law.test
%% entry.role=writer
%% exec.bind.writer=profile.writer
%% review.mode.writer=required
%% review.rework.max.writer=2
input -->|GO| writer[Role:writer]
writer[Role:writer] -->|DONE| output
`);
  const plan = createExecutionPlan(system);
  const state = createInitialGraphState({ plan, prompt: "rework review" });
  const logger = createRunConsoleLogger(false);
  const branch = state.branchRecords["writer@1#1"];
  state.pendingReviewsById["review.writer@1#1.r1"] = {
    reviewId: "review.writer@1#1.r1",
    roleId: "writer",
    branchId: branch.branchId,
    lineageId: branch.lineageId,
    loopIteration: 1,
    executionId: "exec-writer-1",
    selectedEvent: "DONE",
    draftResult: {
      roleId: "writer",
      event: "DONE",
      content: "draft only",
      data: { version: 1 },
      branchId: branch.branchId,
      lineageId: branch.lineageId,
      loopIteration: 1
    },
    requestedAt: "2026-04-22T08:00:00.000Z",
    requestedByExecutionId: "exec-writer-1",
    status: "pending",
    round: 1,
    spec: {
      mode: "required",
      timeoutAction: "pause",
      reworkTargetRoleId: "writer",
      reworkMax: 2,
      terminateScope: "branch"
    }
  };
  state.branchRecords[branch.branchId] = {
    ...branch,
    status: "waiting_review"
  };

  const transition = planHumanReviewDecisionTransition({
    state,
    plan,
    review: state.pendingReviewsById["review.writer@1#1.r1"],
    decision: {
      reviewId: "review.writer@1#1.r1",
      committedAt: "2026-04-22T08:01:00.000Z",
      decidedAt: "2026-04-22T08:01:00.000Z",
      decision: "rework",
      comment: "please tighten the argument"
    },
    logger
  });

  assert.equal(transition.update.pendingReviewsById["review.writer@1#1.r1"].status, "resolved");
  assert.equal(transition.update.branchRecords["writer@1#1"].status, "completed");
  assert.equal(transition.update.nextBranchSequence, 3);
  assert.equal(transition.events[0].type, "human_review_rework_requested");
  const reworkBranchId = Object.keys(transition.update.branchRecords).find(
    (branchId) => branchId !== "writer@1#1"
  );
  assert.ok(reworkBranchId);
  assert.equal(transition.update.branchRecords[reworkBranchId].status, "active");
  assert.deepStrictEqual(transition.update.humanReviewContextByBranchId[reworkBranchId], {
    reviewId: "review.writer@1#1.r1",
    branchId: "writer@1#1",
    round: 1,
    comment: "please tighten the argument",
    previousOutput: {
      roleId: "writer",
      event: "DONE",
      content: "draft only",
      data: { version: 1 },
      branchId: "writer@1#1",
      lineageId: "writer@1#1",
      loopIteration: 1
    }
  });
});

test("human review terminate(run) maps to stopped", () => {
  const system = parseSystemFromMermaidSource(`flowchart TD
%% system.id=test.runtime.human-review.terminate
%% system.version=1.0.0
%% law.global=law.test
%% entry.role=writer
%% exec.bind.writer=profile.writer
%% review.mode.writer=required
%% review.terminate.scope.writer=run
input -->|GO| writer[Role:writer]
writer[Role:writer] -->|DONE| output
`);
  const plan = createExecutionPlan(system);
  const state = createInitialGraphState({ plan, prompt: "terminate review" });
  const logger = createRunConsoleLogger(false);
  const branch = state.branchRecords["writer@1#1"];
  state.pendingReviewsById["review.writer@1#1.r1"] = {
    reviewId: "review.writer@1#1.r1",
    roleId: "writer",
    branchId: branch.branchId,
    lineageId: branch.lineageId,
    loopIteration: 1,
    executionId: "exec-writer-1",
    selectedEvent: "DONE",
    draftResult: {
      roleId: "writer",
      event: "DONE",
      content: "draft only",
      branchId: branch.branchId,
      lineageId: branch.lineageId,
      loopIteration: 1
    },
    requestedAt: "2026-04-22T08:00:00.000Z",
    requestedByExecutionId: "exec-writer-1",
    status: "pending",
    round: 1,
    spec: {
      mode: "required",
      timeoutAction: "pause",
      reworkTargetRoleId: "writer",
      terminateScope: "run"
    }
  };
  state.branchRecords[branch.branchId] = {
    ...branch,
    status: "waiting_review"
  };

  const transition = planHumanReviewDecisionTransition({
    state,
    plan,
    review: state.pendingReviewsById["review.writer@1#1.r1"],
    decision: {
      reviewId: "review.writer@1#1.r1",
      committedAt: "2026-04-22T08:01:00.000Z",
      decidedAt: "2026-04-22T08:01:00.000Z",
      decision: "terminate",
      scope: "run"
    },
    logger
  });

  assert.equal(transition.update.status, "stopped");
  assert.equal(transition.update.error, "human_review_terminate_run");
  assert.equal(transition.update.pendingReviewsById["review.writer@1#1.r1"].status, "resolved");
  assert.equal(transition.update.branchRecords["writer@1#1"].status, "completed");
  assert.equal(transition.events[0].type, "human_review_terminated");
  assert.equal(transition.events[0].scope, "run");
});
