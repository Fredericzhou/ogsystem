import type {
  AuditRecord,
  GraphRunStatus,
  RuntimeErrorEnvelope,
  RunSummarySnapshot
} from "./types.js";

export function summarizeRun(args: {
  auditTrail: AuditRecord[];
  transitionCount: number;
  terminalStatus?: GraphRunStatus;
  terminalErrorEnvelope?: RuntimeErrorEnvelope;
}): RunSummarySnapshot {
  let okCount = 0;
  let failedCount = 0;
  let noopCount = 0;
  let attemptedCount = 0;
  let appliedCount = 0;
  const failureCountsByErrorCode: Record<string, number> = {};

  for (const audit of args.auditTrail) {
    if (audit.status === "ok") {
      okCount += 1;
    } else if (audit.status === "failed") {
      failedCount += 1;
      const errorCode = audit.errorEnvelope?.errorCode ?? "UNCLASSIFIED_FAILURE";
      failureCountsByErrorCode[errorCode] = (failureCountsByErrorCode[errorCode] ?? 0) + 1;
    } else {
      noopCount += 1;
    }

    if (audit.repair?.attempted) {
      attemptedCount += 1;
    }
    if (audit.repair?.applied) {
      appliedCount += 1;
    }
  }

  if (
    args.terminalStatus === "failed" &&
    args.terminalErrorEnvelope &&
    !args.auditTrail.some((audit) => audit.errorEnvelope?.errorCode === args.terminalErrorEnvelope?.errorCode)
  ) {
    failedCount += 1;
    const errorCode = args.terminalErrorEnvelope.errorCode;
    failureCountsByErrorCode[errorCode] = (failureCountsByErrorCode[errorCode] ?? 0) + 1;
  }

  return {
    totalTransitions: args.transitionCount,
    okCount,
    failedCount,
    noopCount,
    failureCountsByErrorCode,
    repairStats: {
      attemptedCount,
      appliedCount
    }
  };
}
