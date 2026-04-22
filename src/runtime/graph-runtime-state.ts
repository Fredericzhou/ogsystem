/**
 * Runtime state helpers for the OGSystem graph runner.
 * Responsible for deterministic branch/loop identity, snapshots, and helper queries that keep the
 * scheduler's view of the graph consistent without introducing any side effects.
 * Boundary: this module does not mutate IO or persist anything; mutation logic belongs to the runner.
 * Trade-off: the helpers stay minimal to keep recovery reasoning tight even if the runner gains new
 * persistence strategies later.
 */
import { getExecutionPlanNode } from "./execution-plan.js";
import { countPendingHumanReviews, hasWaitingHumanReview } from "./human-review.js";
import { createEmptyAuditSummary, summarizeRunFromAuditSummary } from "./run-summary.js";
import { buildRoleLineageLoopKey } from "./runtime-indexes.js";
import type { RuntimeIndexes } from "./runtime-indexes.js";
import type {
  BranchRecord,
  ExecutionPlan,
  GraphState,
  StoredRoleResult
} from "./types.js";

export function buildBranchId(
  roleId: string,
  loopIteration: number,
  branchSequence: number
): string {
  return `${roleId}@${loopIteration}#${branchSequence}`;
}

export function buildJoinId(roleId: string, loopIteration: number): string {
  return `${roleId}@${loopIteration}`;
}

export function getTargetLoopIteration(args: {
  targetRoleId: string;
  currentLoopIteration: number;
  state: GraphState;
  plan: ExecutionPlan;
}): number {
  const targetNode = getExecutionPlanNode(args.plan, args.targetRoleId);
  if (targetNode.loopMax !== undefined) {
    return (args.state.loopIterations[args.targetRoleId] ?? 0) + 1;
  }
  return args.currentLoopIteration;
}

export function wouldExceedLoopBudget(args: {
  targetRoleId: string;
  currentLoopIteration: number;
  state: GraphState;
  plan: ExecutionPlan;
}): boolean {
  const targetNode = getExecutionPlanNode(args.plan, args.targetRoleId);
  if (targetNode.loopMax === undefined) {
    return false;
  }
  // Failure window: the graph rejects any activation that would take the target node past its budget.
  return getTargetLoopIteration(args) > targetNode.loopMax;
}

export function projectStateSnapshot(args: {
  state: GraphState;
  plan: ExecutionPlan;
}): Record<string, unknown> {
  const summary = summarizeRunFromAuditSummary({
    auditSummary: args.state.auditSummary,
    transitionCount: args.state.transitionCount,
    terminalStatus: args.state.status,
    terminalErrorEnvelope: args.state.errorEnvelope
  });
  const branches = Object.values(args.state.branchRecords);
  const activeBranches = branches.filter((branch) => branch.status === "active");
  const completedBranches = branches.filter((branch) => branch.status === "completed");
  const pendingJoinRoleIds = activeBranches
    .map((branch) => branch.roleId)
    .filter((roleId) => getExecutionPlanNode(args.plan, roleId).joinMode !== undefined);
  // Snapshot is used for reporting and operator/debug inspection, so it mirrors the runtime
  // contract while still embedding the raw graphState for resume-aware consumers.

  return {
    status: args.state.status,
    currentRoleId: args.state.finalRoleId || args.state.lastExecutedRoleId || args.plan.entryRoleId,
    nextRoleId: activeBranches.length === 1 ? activeBranches[0].roleId : undefined,
    finalRoleId: args.state.finalRoleId || undefined,
    transitionCount: args.state.transitionCount,
    totalTransitions: summary.totalTransitions,
    okCount: summary.okCount,
    failedCount: summary.failedCount,
    noopCount: summary.noopCount,
    failureCountsByErrorCode: summary.failureCountsByErrorCode,
    lastOutput: args.state.finalOutput || undefined,
    error: args.state.error || undefined,
    errorEnvelope: args.state.errorEnvelope || undefined,
    pendingReviewCount: countPendingHumanReviews(args.state),
    hasWaitingHumanReview: hasWaitingHumanReview(args.state),
    activeBranches,
    completedBranches,
    pendingJoinRoleIds,
    loopIterations: args.state.loopIterations,
    roleResults: args.state.roleResults,
    pendingReviewsById: args.state.pendingReviewsById,
    reviewHistoryByBranchId: args.state.reviewHistoryByBranchId,
    humanReviewContextByBranchId: args.state.humanReviewContextByBranchId,
    reviewRoundByRoleLineageKey: args.state.reviewRoundByRoleLineageKey,
    lastWaitingReviewId: args.state.lastWaitingReviewId,
    selectedEventByBranchId: args.state.selectedEventByBranchId,
    nextBranchSequence: args.state.nextBranchSequence,
    lastCheckpointSequence: args.state.lastCheckpointSequence,
    graphState: args.state
  };
}

export function findCurrentBranch(
  state: GraphState,
  roleId: string,
  indexes?: RuntimeIndexes
): BranchRecord | undefined {
  return listActiveBranches(state, roleId, indexes).at(-1);
}

export function listActiveBranches(
  state: GraphState,
  roleId: string,
  indexes?: RuntimeIndexes
): BranchRecord[] {
  if (indexes) {
    return (indexes.activeBranchIdsByRoleId.get(roleId) ?? [])
      .map((branchId) => indexes.branchById.get(branchId))
      .filter((branch): branch is BranchRecord => branch !== undefined);
  }
  return Object.values(state.branchRecords)
    .filter((branch) => branch.roleId === roleId && branch.status === "active")
    .sort((left, right) => left.branchSequence - right.branchSequence);
}

export function getActiveRoleIds(state: GraphState, indexes?: RuntimeIndexes): string[] {
  if (indexes) {
    return Array.from(indexes.activeBranchIdsByRoleId.entries())
      .sort((left, right) => {
        const leftFirstBranchId = left[1][0];
        const rightFirstBranchId = right[1][0];
        const leftSequence = indexes.branchById.get(leftFirstBranchId ?? "")?.branchSequence ?? 0;
        const rightSequence = indexes.branchById.get(rightFirstBranchId ?? "")?.branchSequence ?? 0;
        return leftSequence - rightSequence;
      })
      .map(([roleId]) => roleId);
  }
  const firstBranchByRoleId = new Map<string, number>();
  for (const branch of Object.values(state.branchRecords)) {
    if (branch.status !== "active") {
      continue;
    }
    const current = firstBranchByRoleId.get(branch.roleId);
    if (current === undefined || branch.branchSequence < current) {
      firstBranchByRoleId.set(branch.roleId, branch.branchSequence);
    }
  }

  // Invariant: there is at most one active branch per role in the scheduler's selection queue; the
  // lowest branch sequence wins so that reruns or newer splits do not jump ahead unexpectedly.
  return Array.from(firstBranchByRoleId.entries())
    .sort((left, right) => left[1] - right[1])
    .map(([roleId]) => roleId);
}

export function activateBranch(args: {
  roleId: string;
  loopIteration: number;
  branchSequence: number;
  lineageId: string;
  sessionLineageId: string;
  parentBranchId?: string;
  activatedByRoleId?: string;
  activatedByEvent?: string;
}): BranchRecord {
  return {
    branchId: buildBranchId(args.roleId, args.loopIteration, args.branchSequence),
    roleId: args.roleId,
    loopIteration: args.loopIteration,
    branchSequence: args.branchSequence,
    lineageId: args.lineageId,
    sessionLineageId: args.sessionLineageId,
    parentBranchId: args.parentBranchId,
    activatedByRoleId: args.activatedByRoleId,
    activatedByEvent: args.activatedByEvent,
    status: "active"
  };
}

export function completeBranch(args: {
  branchId: string;
  roleId: string;
  loopIteration: number;
  branchSequence: number;
  lineageId: string;
  sessionLineageId: string;
  parentBranchId?: string;
  activatedByRoleId?: string;
  activatedByEvent?: string;
}): BranchRecord {
  return {
    branchId: args.branchId,
    roleId: args.roleId,
    loopIteration: args.loopIteration,
    branchSequence: args.branchSequence,
    lineageId: args.lineageId,
    sessionLineageId: args.sessionLineageId,
    parentBranchId: args.parentBranchId,
    activatedByRoleId: args.activatedByRoleId,
    activatedByEvent: args.activatedByEvent,
    status: "completed"
  };
}

export function waitForHumanReview(args: {
  branchId: string;
  roleId: string;
  loopIteration: number;
  branchSequence: number;
  lineageId: string;
  sessionLineageId: string;
  parentBranchId?: string;
  activatedByRoleId?: string;
  activatedByEvent?: string;
}): BranchRecord {
  return {
    branchId: args.branchId,
    roleId: args.roleId,
    loopIteration: args.loopIteration,
    branchSequence: args.branchSequence,
    lineageId: args.lineageId,
    sessionLineageId: args.sessionLineageId,
    parentBranchId: args.parentBranchId,
    activatedByRoleId: args.activatedByRoleId,
    activatedByEvent: args.activatedByEvent,
    status: "waiting_review"
  };
}

export function createInitialGraphState(args: {
  plan: ExecutionPlan;
  prompt: string;
}): GraphState {
  const branchId = buildBranchId(args.plan.entryRoleId, 1, 1);
  // The graph starts with a single active entry branch so branch ids and lineage ids are seeded
  // before any split, join, or loop logic runs.
  return {
    userPrompt: args.prompt,
    status: "running",
    error: "",
    transitionCount: 0,
    recentAudits: [],
    auditSummary: createEmptyAuditSummary(),
    roleMetricsByRoleId: {},
    roleResults: {},
    pendingReviewsById: {},
    reviewHistoryByBranchId: {},
    humanReviewContextByBranchId: {},
    reviewRoundByRoleLineageKey: {},
    lastWaitingReviewId: undefined,
    branchRecords: {
      [branchId]: {
        branchId,
        roleId: args.plan.entryRoleId,
        loopIteration: 1,
        branchSequence: 1,
        lineageId: branchId,
        sessionLineageId: branchId,
        status: "active"
      }
    },
    loopIterations: {
      [args.plan.entryRoleId]: 1
    },
    selectedEventByBranchId: {},
    finalOutput: "",
    finalRoleId: "",
    lastExecutedRoleId: "",
    nextBranchSequence: 2,
    lastCheckpointSequence: 0
  };
}

export function createInitialState(plan: ExecutionPlan, prompt: string): GraphState {
  return createInitialGraphState({ plan, prompt });
}

export function storeRoleResult(
  branchId: string,
  result: StoredRoleResult | undefined
): Record<string, StoredRoleResult> {
  // Recovery semantics: only persisted role outcomes (non-undefined) get merged into checkpoints.
  return result ? { [branchId]: result } : {};
}

export function getBranchResult(
  state: GraphState,
  branchId: string | undefined
): StoredRoleResult | undefined {
  if (!branchId) {
    return undefined;
  }
  return state.roleResults[branchId];
}

export function findRoleResult(args: {
  state: GraphState;
  roleId: string;
  lineageId: string;
  loopIteration: number;
  indexes?: RuntimeIndexes;
}): StoredRoleResult | undefined {
  if (args.indexes) {
    return args.indexes.resultByRoleLineageLoopKey.get(
      buildRoleLineageLoopKey({
        roleId: args.roleId,
        lineageId: args.lineageId,
        loopIteration: args.loopIteration
      })
    );
  }
  return Object.values(args.state.roleResults).find(
    (result) =>
      result.roleId === args.roleId &&
      result.lineageId === args.lineageId &&
      result.loopIteration === args.loopIteration
  );
}
