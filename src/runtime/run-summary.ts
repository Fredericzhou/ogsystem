/**
 * Derives graph-level metrics by rolling up audit records.
 * Responsibilities: keep counters for outcome categories and ensure terminal failures
 * are reflected even when transition logs already emitted their own error events.
 * Boundaries: this module is pure calculation; it never touches storage or runtime state.
 * Trade-off: it copies failure counts when merging so consumers can safely mutate summaries without
 * impacting the originals.
 */
import type {
  AuditRecord,
  GraphAuditSummary,
  GraphRunStatus,
  RuntimeErrorEnvelope,
  RunSummarySnapshot
} from "./types.js";

/**
 * Produces the canonical zeroed-out counters so consumers can merge without mutating shared state.
 */
export function createEmptyAuditSummary(): GraphAuditSummary {
  return {
    okCount: 0,
    failedCount: 0,
    noopCount: 0,
    repairAttemptedCount: 0,
    repairAppliedCount: 0,
    failureCountsByErrorCode: {}
  };
}

/**
 * Converts a single audit entry into a delta that can be merged into the running totals.
 * Trade-off: only the first failure error code is captured here to keep summaries compact.
 */
export function buildAuditSummaryDelta(audit: AuditRecord): GraphAuditSummary {
  const summary = createEmptyAuditSummary();
  if (audit.status === "ok") {
    summary.okCount = 1;
  } else if (audit.status === "failed") {
    summary.failedCount = 1;
    const errorCode = audit.errorEnvelope?.errorCode ?? "UNCLASSIFIED_FAILURE";
    summary.failureCountsByErrorCode[errorCode] = 1;
  } else {
    summary.noopCount = 1;
  }

  if (audit.repair?.attempted) {
    summary.repairAttemptedCount = 1;
  }
  if (audit.repair?.applied) {
    summary.repairAppliedCount = 1;
  }

  return summary;
}

/**
 * Adds two summaries together by copying counts so neither input is mutated.
 * Invariant: failureCountsByErrorCode is merged defensively to ensure independent consumers can
 * track their own deltas without interfering with shared maps.
 */
export function mergeAuditSummaries(
  left: GraphAuditSummary,
  right: GraphAuditSummary
): GraphAuditSummary {
  const failureCountsByErrorCode: Record<string, number> = {
    ...left.failureCountsByErrorCode
  };
  for (const [errorCode, count] of Object.entries(right.failureCountsByErrorCode)) {
    failureCountsByErrorCode[errorCode] = (failureCountsByErrorCode[errorCode] ?? 0) + count;
  }

  return {
    okCount: left.okCount + right.okCount,
    failedCount: left.failedCount + right.failedCount,
    noopCount: left.noopCount + right.noopCount,
    repairAttemptedCount: left.repairAttemptedCount + right.repairAttemptedCount,
    repairAppliedCount: left.repairAppliedCount + right.repairAppliedCount,
    failureCountsByErrorCode
  };
}

/**
 * Produces the final snapshot while honoring the terminal status/error provided by the caller.
 * Invariant: failureCountsByErrorCode is copied before we touch it so the caller's aggregated
 * summary remains unaffected by the terminal reconciliation.
 */
export function summarizeRunFromAuditSummary(args: {
  auditSummary: GraphAuditSummary;
  transitionCount: number;
  terminalStatus?: GraphRunStatus;
  terminalErrorEnvelope?: RuntimeErrorEnvelope;
}): RunSummarySnapshot {
  let failedCount = args.auditSummary.failedCount;
  const failureCountsByErrorCode = { ...args.auditSummary.failureCountsByErrorCode };

  if (
    args.terminalStatus === "failed" &&
    args.terminalErrorEnvelope
  ) {
    // Recovery semantics: even if the running audit summary missed this failure, we still
    // bump the counts so the terminal error is visible to reporting layers.
    const errorCode = args.terminalErrorEnvelope.errorCode;
    if ((failureCountsByErrorCode[errorCode] ?? 0) === 0) {
      failedCount += 1;
      failureCountsByErrorCode[errorCode] = 1;
    }
  }

  return {
    totalTransitions: args.transitionCount,
    okCount: args.auditSummary.okCount,
    failedCount,
    noopCount: args.auditSummary.noopCount,
    failureCountsByErrorCode,
    repairStats: {
      attemptedCount: args.auditSummary.repairAttemptedCount,
      appliedCount: args.auditSummary.repairAppliedCount
    }
  };
}

/**
 * Walks the audit trail to produce a snapshot that can be emitted to observability layers.
 * Trade-off: this function replays each audit entry instead of incrementally streaming, which
 * keeps its behavior deterministic and easy to reason about for reporting.
 */
export function summarizeRun(args: {
  auditTrail: AuditRecord[];
  transitionCount: number;
  terminalStatus?: GraphRunStatus;
  terminalErrorEnvelope?: RuntimeErrorEnvelope;
}): RunSummarySnapshot {
  let auditSummary = createEmptyAuditSummary();
  for (const audit of args.auditTrail) {
    auditSummary = mergeAuditSummaries(auditSummary, buildAuditSummaryDelta(audit));
  }

  return summarizeRunFromAuditSummary({
    auditSummary,
    transitionCount: args.transitionCount,
    terminalStatus: args.terminalStatus,
    terminalErrorEnvelope: args.terminalErrorEnvelope
  });
}
