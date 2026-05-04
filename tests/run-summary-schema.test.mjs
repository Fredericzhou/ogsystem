import test from "node:test";
import assert from "node:assert/strict";

import { buildRunSummaryProjection } from "../dist/runtime/run-summary-schema.js";

function createBaseState(overrides = {}) {
  return {
    userPrompt: "summary test",
    status: "done",
    error: "",
    transitionCount: 2,
    recentAudits: [],
    auditSummary: {
      okCount: 2,
      failedCount: 0,
      noopCount: 0,
      handledFailureCount: 0,
      unhandledFailureCount: 0,
      handledFailureByEvent: {},
      handledFailureByTargetRole: {},
      repairAttemptedCount: 0,
      repairAppliedCount: 0,
      failureCountsByErrorCode: {}
    },
    roleMetricsByRoleId: {
      writer: { total: 1, ok: 1, failed: 0, noop: 0, durationMsTotal: 1200 },
      reviewer: { total: 1, ok: 1, failed: 0, noop: 0, durationMsTotal: 800 }
    },
    roleResults: {},
    pendingReviewsById: {},
    reviewHistoryByBranchId: {},
    humanReviewContextByBranchId: {},
    reviewRoundByRoleLineageKey: {},
    branchRecords: {},
    loopIterations: {},
    selectedEventByBranchId: {},
    finalOutput: "done",
    finalRoleId: "reviewer",
    lastExecutedRoleId: "reviewer",
    nextBranchSequence: 2,
    lastCheckpointSequence: 2,
    ...overrides
  };
}

function createArgs(state, now) {
  return {
    state,
    plan: {
      systemId: "summary.test",
      systemVersion: "1.0.0",
      roleIds: ["writer", "reviewer"]
    },
    runContext: {
      runId: "run-summary-test",
      createdAt: "2026-04-22T10:00:00.000Z",
      executionDirCount: 2
    },
    now
  };
}

test("run summary keeps wall clock and execution duration separate for runs without review", () => {
  const projection = buildRunSummaryProjection(
    createArgs(createBaseState(), "2026-04-22T10:10:00.000Z")
  );

  assert.equal(projection.durationMs, 600000);
  assert.equal(projection.wallClockDurationMs, 600000);
  assert.equal(projection.executionDurationMs, 2000);
  assert.equal(projection.humanReviewWaitDurationMs, 0);
  assert.equal(projection.lastRoleId, "reviewer");
  assert.equal(projection.lastErrorCode, undefined);
  assert.equal(projection.stopReason, undefined);
  assert.equal(projection.artifactIndexSummary.roleCount, 2);
  assert.equal(projection.artifactIndexSummary.executionDirCount, 2);
  assert.ok(projection.artifactIndexSummary.resumeConsumedPaths.includes("state.json"));
  assert.ok(projection.artifactIndexSummary.operatorProjectionPaths.includes("summary.json"));
  assert.equal(projection.reviewRoundCount, 0);
  assert.equal(projection.latestPendingReviewId, undefined);
});

test("run summary records terminal error and stop fields for stopped projections", () => {
  const projection = buildRunSummaryProjection(
    createArgs(
      createBaseState({
        status: "stopped",
        error: "operator stop",
        errorEnvelope: {
          errorCode: "RUN_STOP_REQUESTED",
          errorCategory: "state",
          message: "operator stop",
          retryable: false,
          stage: "execute"
        }
      }),
      "2026-04-22T10:10:00.000Z"
    )
  );

  assert.equal(projection.stopReason, "operator stop");
  assert.equal(projection.stopOutcome, "stopped");
  assert.equal(projection.lastErrorCode, "RUN_STOP_REQUESTED");
});

test("run summary records single-round review approval metrics", () => {
  const state = createBaseState({
    pendingReviewsById: {
      "review.writer@1#1.r1": {
        reviewId: "review.writer@1#1.r1",
        roleId: "writer",
        branchId: "writer@1#1",
        lineageId: "writer@1#1",
        loopIteration: 1,
        executionId: "exec-1",
        draftResult: {
          roleId: "writer",
          content: "draft",
          branchId: "writer@1#1",
          lineageId: "writer@1#1",
          loopIteration: 1
        },
        requestedAt: "2026-04-22T10:02:00.000Z",
        requestedByExecutionId: "exec-1",
        status: "resolved",
        round: 1,
        spec: {
          mode: "required",
          timeoutAction: "pause",
          reworkTargetRoleId: "writer",
          terminateScope: "branch"
        }
      }
    },
    reviewHistoryByBranchId: {
      "writer@1#1": [
        {
          reviewId: "review.writer@1#1.r1",
          committedAt: "2026-04-22T10:05:00.000Z",
          decidedAt: "2026-04-22T10:05:00.000Z",
          decision: "approve"
        }
      ]
    }
  });

  const projection = buildRunSummaryProjection(
    createArgs(state, "2026-04-22T10:07:00.000Z")
  );

  assert.equal(projection.humanReviewWaitDurationMs, 180000);
  assert.equal(projection.lastReviewId, "review.writer@1#1.r1");
  assert.equal(projection.lastReviewDecision, "approve");
  assert.equal(projection.lastReviewDecidedAt, "2026-04-22T10:05:00.000Z");
  assert.equal(projection.reviewRoundCount, 1);
});

test("run summary uses the latest decision for paused then later approved reviews", () => {
  const state = createBaseState({
    pendingReviewsById: {
      "review.writer@1#1.r1": {
        reviewId: "review.writer@1#1.r1",
        roleId: "writer",
        branchId: "writer@1#1",
        lineageId: "writer@1#1",
        loopIteration: 1,
        executionId: "exec-1",
        draftResult: {
          roleId: "writer",
          content: "draft",
          branchId: "writer@1#1",
          lineageId: "writer@1#1",
          loopIteration: 1
        },
        requestedAt: "2026-04-22T10:01:00.000Z",
        requestedByExecutionId: "exec-1",
        status: "resolved",
        round: 1,
        spec: {
          mode: "required",
          timeoutAction: "pause",
          reworkTargetRoleId: "writer",
          terminateScope: "branch"
        }
      }
    },
    reviewHistoryByBranchId: {
      "writer@1#1": [
        {
          reviewId: "review.writer@1#1.r1",
          committedAt: "2026-04-22T10:02:00.000Z",
          decidedAt: "2026-04-22T10:02:00.000Z",
          decision: "pause"
        },
        {
          reviewId: "review.writer@1#1.r1",
          committedAt: "2026-04-22T10:06:00.000Z",
          decidedAt: "2026-04-22T10:06:00.000Z",
          decision: "approve"
        }
      ]
    }
  });

  const projection = buildRunSummaryProjection(
    createArgs(state, "2026-04-22T10:07:00.000Z")
  );

  assert.equal(projection.humanReviewWaitDurationMs, 300000);
  assert.equal(projection.lastReviewDecision, "approve");
  assert.equal(projection.lastReviewDecidedAt, "2026-04-22T10:06:00.000Z");
});

test("run summary records multi-round review projections and tracks the latest unresolved review", () => {
  const state = createBaseState({
    status: "stopped",
    pendingReviewsById: {
      "review.writer@1#1.r1": {
        reviewId: "review.writer@1#1.r1",
        roleId: "writer",
        branchId: "writer@1#1",
        lineageId: "writer@1#1",
        loopIteration: 1,
        executionId: "exec-1",
        draftResult: {
          roleId: "writer",
          content: "draft v1",
          branchId: "writer@1#1",
          lineageId: "writer@1#1",
          loopIteration: 1
        },
        requestedAt: "2026-04-22T10:01:00.000Z",
        requestedByExecutionId: "exec-1",
        status: "resolved",
        round: 1,
        spec: {
          mode: "required",
          timeoutAction: "pause",
          reworkTargetRoleId: "writer",
          terminateScope: "branch"
        }
      },
      "review.writer@1#2.r2": {
        reviewId: "review.writer@1#2.r2",
        roleId: "writer",
        branchId: "writer@1#2",
        lineageId: "writer@1#1",
        loopIteration: 1,
        executionId: "exec-2",
        draftResult: {
          roleId: "writer",
          content: "draft v2",
          branchId: "writer@1#2",
          lineageId: "writer@1#1",
          loopIteration: 1
        },
        requestedAt: "2026-04-22T10:04:00.000Z",
        requestedByExecutionId: "exec-2",
        status: "pending",
        round: 2,
        spec: {
          mode: "required",
          timeoutAction: "pause",
          reworkTargetRoleId: "writer",
          terminateScope: "branch"
        }
      }
    },
    reviewHistoryByBranchId: {
      "writer@1#1": [
        {
          reviewId: "review.writer@1#1.r1",
          committedAt: "2026-04-22T10:03:00.000Z",
          decidedAt: "2026-04-22T10:03:00.000Z",
          decision: "rework"
        }
      ]
    }
  });

  const projection = buildRunSummaryProjection(
    createArgs(state, "2026-04-22T10:06:00.000Z")
  );

  assert.equal(projection.reviewRoundCount, 2);
  assert.equal(projection.lastReviewId, "review.writer@1#2.r2");
  assert.equal(projection.lastReviewDecision, undefined);
  assert.equal(projection.latestPendingReviewId, "review.writer@1#2.r2");
  assert.equal(projection.humanReviewWaitDurationMs, 240000);
});
