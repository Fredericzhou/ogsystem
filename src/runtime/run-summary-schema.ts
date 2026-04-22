import { countPendingHumanReviews, hasWaitingHumanReview } from "./human-review.js";
import { summarizeRunFromAuditSummary } from "./run-summary.js";
import type { ExecutionPlan, GraphState, GraphRunStatus, RunContext } from "./types.js";

export type RunSummaryProjection = {
  version: 1;
  runId: string;
  systemId: string;
  systemVersion: string;
  status: GraphRunStatus;
  transitionCount: number;
  durationMs: number;
  lastRoleId?: string;
  lastErrorCode?: string;
  finalRoleId?: string;
  executionDirCount: number;
  okCount: number;
  failedCount: number;
  noopCount: number;
  pendingReviewCount?: number;
  hasWaitingHumanReview?: boolean;
  updatedAt: string;
};

export function buildRunSummaryProjection(args: {
  state: GraphState;
  plan: ExecutionPlan;
  runContext: RunContext;
  now?: string;
}): RunSummaryProjection {
  const updatedAt = args.now ?? new Date().toISOString();
  const startedAt = new Date(args.runContext.createdAt);
  const updatedAtDate = new Date(updatedAt);
  const durationMs =
    Number.isNaN(startedAt.getTime()) || Number.isNaN(updatedAtDate.getTime())
      ? 0
      : Math.max(0, updatedAtDate.getTime() - startedAt.getTime());
  const summary = summarizeRunFromAuditSummary({
    auditSummary: args.state.auditSummary,
    transitionCount: args.state.transitionCount,
    terminalStatus: args.state.status,
    terminalErrorEnvelope: args.state.errorEnvelope
  });

  return {
    version: 1,
    runId: args.runContext.runId,
    systemId: args.plan.systemId,
    systemVersion: args.plan.systemVersion,
    status: args.state.status,
    transitionCount: args.state.transitionCount,
    durationMs,
    lastRoleId: args.state.lastExecutedRoleId || undefined,
    lastErrorCode: args.state.errorEnvelope?.errorCode,
    finalRoleId: args.state.finalRoleId || undefined,
    executionDirCount: args.runContext.executionDirCount,
    okCount: summary.okCount,
    failedCount: summary.failedCount,
    noopCount: summary.noopCount,
    pendingReviewCount: countPendingHumanReviews(args.state),
    hasWaitingHumanReview: hasWaitingHumanReview(args.state),
    updatedAt
  };
}
