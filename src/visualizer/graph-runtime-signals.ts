import type { BranchRecord, GraphState } from "../runtime/types.js";

export function countBranches(
  branchRecords: Record<string, BranchRecord>,
  roleId: string,
  status: BranchRecord["status"]
): number {
  return Object.values(branchRecords).filter((branch) => branch.roleId === roleId && branch.status === status)
    .length;
}

export function findLastErrorCode(args: { state: GraphState; roleId: string }): string | undefined {
  for (let index = args.state.recentAudits.length - 1; index >= 0; index -= 1) {
    const audit = args.state.recentAudits[index];
    if (audit.roleId === args.roleId && audit.errorEnvelope?.errorCode) {
      return audit.errorEnvelope.errorCode;
    }
  }
  return args.state.lastExecutedRoleId === args.roleId ? args.state.errorEnvelope?.errorCode : undefined;
}

export function findLastSelectedEvent(args: { state: GraphState; roleId: string }): string | undefined {
  const selected = Object.entries(args.state.selectedEventByBranchId)
    .map(([branchId, event]) => ({
      branchId,
      event,
      branch: args.state.branchRecords[branchId]
    }))
    .filter((entry) => entry.branch?.roleId === args.roleId)
    .sort((left, right) => (left.branch?.branchSequence ?? 0) - (right.branch?.branchSequence ?? 0))
    .at(-1);
  return selected?.event;
}

export function findLatestFailureForRole(args: { state: GraphState; roleId: string }): Record<string, unknown> | undefined {
  for (let index = args.state.recentAudits.length - 1; index >= 0; index -= 1) {
    const audit = args.state.recentAudits[index];
    if (audit.roleId === args.roleId && (audit.status === "failed" || audit.errorEnvelope)) {
      return {
        errorCode: audit.errorEnvelope?.errorCode,
        errorCategory: audit.errorEnvelope?.errorCategory,
        message: audit.errorEnvelope?.message ?? audit.error,
        retryable: audit.errorEnvelope?.retryable,
        stage: audit.errorEnvelope?.stage,
        durationMs: audit.durationMs,
        branchId: audit.branchId
      };
    }
  }
  return undefined;
}

export function buildGraphNodeStatus(args: {
  state: GraphState;
  roleId: string;
  activeBranchCount: number;
  waitingReviewCount: number;
  completedBranchCount: number;
  lastErrorCode?: string;
}): string {
  if (args.state.status === "failed" && args.state.lastExecutedRoleId === args.roleId) {
    return "failed";
  }
  if (args.waitingReviewCount > 0) {
    return "waiting_review";
  }
  if (args.activeBranchCount > 0) {
    return "active";
  }
  if (args.state.finalRoleId === args.roleId && args.state.status === "done") {
    return "done";
  }
  if (args.completedBranchCount > 0) {
    return "completed";
  }
  if (args.lastErrorCode) {
    return "failed";
  }
  return "idle";
}
