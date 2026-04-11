import type {
  AuditRecord,
  GraphAuditSummary,
  GraphRunStatus,
  RuntimeErrorEnvelope,
  RunSummarySnapshot
} from "./types.js";

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
