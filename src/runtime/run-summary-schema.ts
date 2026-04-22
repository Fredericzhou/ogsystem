import { countPendingHumanReviews, hasWaitingHumanReview } from "./human-review.js";
import { summarizeRunFromAuditSummary } from "./run-summary.js";
import type {
  ExecutionPlan,
  GraphState,
  GraphRunStatus,
  HumanReviewDecision,
  HumanReviewDecisionRecord,
  PendingHumanReview,
  RunContext
} from "./types.js";

export type RunSummaryProjection = {
  version: 1;
  runId: string;
  systemId: string;
  systemVersion: string;
  status: GraphRunStatus;
  transitionCount: number;
  durationMs: number;
  wallClockDurationMs: number;
  executionDurationMs: number;
  humanReviewWaitDurationMs: number;
  lastRoleId?: string;
  lastErrorCode?: string;
  finalRoleId?: string;
  executionDirCount: number;
  okCount: number;
  failedCount: number;
  noopCount: number;
  pendingReviewCount?: number;
  hasWaitingHumanReview?: boolean;
  latestPendingReviewId?: string;
  lastReviewId?: string;
  lastReviewDecision?: HumanReviewDecision;
  lastReviewDecidedAt?: string;
  reviewRoundCount: number;
  updatedAt: string;
};

function parseIsoTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function calculateWallClockDurationMs(args: {
  createdAt: string;
  updatedAt: string;
}): number {
  const startedAtMs = parseIsoTimestamp(args.createdAt);
  const updatedAtMs = parseIsoTimestamp(args.updatedAt);
  if (startedAtMs === undefined || updatedAtMs === undefined) {
    return 0;
  }
  return Math.max(0, updatedAtMs - startedAtMs);
}

function calculateExecutionDurationMs(state: GraphState): number {
  return Object.values(state.roleMetricsByRoleId).reduce(
    (total, metrics) => total + (metrics.durationMsTotal ?? 0),
    0
  );
}

function compareReviewChronology(left: PendingHumanReview, right: PendingHumanReview): number {
  const leftRequestedAt = parseIsoTimestamp(left.requestedAt) ?? Number.NEGATIVE_INFINITY;
  const rightRequestedAt = parseIsoTimestamp(right.requestedAt) ?? Number.NEGATIVE_INFINITY;
  if (leftRequestedAt !== rightRequestedAt) {
    return leftRequestedAt - rightRequestedAt;
  }
  if (left.round !== right.round) {
    return left.round - right.round;
  }
  return left.reviewId.localeCompare(right.reviewId);
}

function getLatestDecisionByReviewId(
  state: GraphState
): Map<string, HumanReviewDecisionRecord> {
  const latestDecisionByReviewId = new Map<string, HumanReviewDecisionRecord>();
  for (const decisions of Object.values(state.reviewHistoryByBranchId)) {
    for (const decision of decisions) {
      const current = latestDecisionByReviewId.get(decision.reviewId);
      const currentMs = parseIsoTimestamp(current?.decidedAt) ?? Number.NEGATIVE_INFINITY;
      const nextMs = parseIsoTimestamp(decision.decidedAt) ?? Number.NEGATIVE_INFINITY;
      if (!current || nextMs >= currentMs) {
        latestDecisionByReviewId.set(decision.reviewId, decision);
      }
    }
  }
  return latestDecisionByReviewId;
}

function calculateHumanReviewWaitDurationMs(args: {
  state: GraphState;
  updatedAt: string;
  latestDecisionByReviewId: Map<string, HumanReviewDecisionRecord>;
}): number {
  const updatedAtMs = parseIsoTimestamp(args.updatedAt);
  if (updatedAtMs === undefined) {
    return 0;
  }

  return Object.values(args.state.pendingReviewsById).reduce((total, review) => {
    const requestedAtMs = parseIsoTimestamp(review.requestedAt);
    if (requestedAtMs === undefined) {
      return total;
    }

    const latestDecision = args.latestDecisionByReviewId.get(review.reviewId);
    const resolvedAtMs =
      review.status === "resolved" || review.status === "expired"
        ? parseIsoTimestamp(latestDecision?.decidedAt)
        : updatedAtMs;
    if (resolvedAtMs === undefined) {
      return total;
    }
    return total + Math.max(0, resolvedAtMs - requestedAtMs);
  }, 0);
}

function deriveReviewProjectionFields(args: {
  state: GraphState;
  updatedAt: string;
}): Pick<
  RunSummaryProjection,
  | "humanReviewWaitDurationMs"
  | "latestPendingReviewId"
  | "lastReviewId"
  | "lastReviewDecision"
  | "lastReviewDecidedAt"
  | "reviewRoundCount"
> {
  const reviews = Object.values(args.state.pendingReviewsById).sort(compareReviewChronology);
  const latestDecisionByReviewId = getLatestDecisionByReviewId(args.state);
  const latestReview = reviews.at(-1);
  const latestPendingReview = reviews
    .filter((review) => review.status === "pending" || review.status === "paused")
    .at(-1);
  const latestReviewDecision = latestReview
    ? latestDecisionByReviewId.get(latestReview.reviewId)
    : undefined;

  return {
    humanReviewWaitDurationMs: calculateHumanReviewWaitDurationMs({
      state: args.state,
      updatedAt: args.updatedAt,
      latestDecisionByReviewId
    }),
    latestPendingReviewId: latestPendingReview?.reviewId,
    lastReviewId: latestReview?.reviewId,
    lastReviewDecision: latestReviewDecision?.decision,
    lastReviewDecidedAt: latestReviewDecision?.decidedAt,
    reviewRoundCount: reviews.length
  };
}

export function buildRunSummaryProjection(args: {
  state: GraphState;
  plan: ExecutionPlan;
  runContext: RunContext;
  now?: string;
}): RunSummaryProjection {
  const updatedAt = args.now ?? new Date().toISOString();
  const wallClockDurationMs = calculateWallClockDurationMs({
    createdAt: args.runContext.createdAt,
    updatedAt
  });
  const executionDurationMs = calculateExecutionDurationMs(args.state);
  const summary = summarizeRunFromAuditSummary({
    auditSummary: args.state.auditSummary,
    transitionCount: args.state.transitionCount,
    terminalStatus: args.state.status,
    terminalErrorEnvelope: args.state.errorEnvelope
  });
  const reviewFields = deriveReviewProjectionFields({
    state: args.state,
    updatedAt
  });

  return {
    version: 1,
    runId: args.runContext.runId,
    systemId: args.plan.systemId,
    systemVersion: args.plan.systemVersion,
    status: args.state.status,
    transitionCount: args.state.transitionCount,
    durationMs: wallClockDurationMs,
    wallClockDurationMs,
    executionDurationMs,
    humanReviewWaitDurationMs: reviewFields.humanReviewWaitDurationMs,
    lastRoleId: args.state.lastExecutedRoleId || undefined,
    lastErrorCode: args.state.errorEnvelope?.errorCode,
    finalRoleId: args.state.finalRoleId || undefined,
    executionDirCount: args.runContext.executionDirCount,
    okCount: summary.okCount,
    failedCount: summary.failedCount,
    noopCount: summary.noopCount,
    pendingReviewCount: countPendingHumanReviews(args.state),
    hasWaitingHumanReview: hasWaitingHumanReview(args.state),
    latestPendingReviewId: reviewFields.latestPendingReviewId,
    lastReviewId: reviewFields.lastReviewId,
    lastReviewDecision: reviewFields.lastReviewDecision,
    lastReviewDecidedAt: reviewFields.lastReviewDecidedAt,
    reviewRoundCount: reviewFields.reviewRoundCount,
    updatedAt
  };
}
