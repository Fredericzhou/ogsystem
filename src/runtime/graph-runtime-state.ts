/**
 * Runtime state helpers for the OGSystem graph runner.
 * Responsible for deterministic branch/loop identity, snapshots, and helper queries that keep the
 * scheduler's view of the graph consistent without introducing any side effects.
 * Boundary: this module does not mutate IO or persist anything; mutation logic belongs to the runner.
 * Trade-off: the helpers stay minimal to keep recovery reasoning tight even if the runner gains new
 * persistence strategies later.
 */
import { createHash } from "node:crypto";
import { getExecutionPlanNode } from "./execution-plan.js";
import { countPendingHumanReviews, hasWaitingHumanReview } from "./human-review.js";
import { createEmptyAuditSummary, summarizeRunFromAuditSummary } from "./run-summary.js";
import { buildRoleLineageLoopKey } from "./runtime-indexes.js";
import { buildJoinDisplayId } from "./semantic-ir.js";
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

export function buildJoinId(roleId: string, loopIteration: number, lineageId: string): string {
  return buildJoinDisplayId({
    runId: "display-only",
    joinRoleId: roleId,
    lineageId,
    loopIteration
  });
}

export function buildLoopScopeKey(lineageId: string, loopId: string): string {
  return `${lineageId}::${loopId}`;
}

export function buildRoleActivationScopeKey(lineageId: string, roleId: string): string {
  return `${lineageId}::${roleId}`;
}

export function getLoopScopeForRole(plan: ExecutionPlan, roleId: string) {
  return plan.semanticIR?.loops.find((scope) => scope.members.includes(roleId));
}

export function getTargetLoopIteration(args: {
  targetRoleId: string;
  currentLoopIteration: number;
  state: GraphState;
  plan: ExecutionPlan;
  lineageId?: string;
}): number {
  const targetNode = getExecutionPlanNode(args.plan, args.targetRoleId);
  const scope = getLoopScopeForRole(args.plan, args.targetRoleId);
  if (scope && args.lineageId) {
    const scoped = args.state.loopCountersByScope?.[buildLoopScopeKey(args.lineageId, scope.loopId)];
    if (scoped !== undefined) {
      return args.targetRoleId === scope.boundaryRoleId ? scoped + 1 : scoped;
    }
    return args.targetRoleId === scope.boundaryRoleId ? 1 : 0;
  }
  if (targetNode.loopMax !== undefined) {
    return (args.state.loopIterations[args.targetRoleId] ?? 0) + 1;
  }
  return args.currentLoopIteration;
}

export type LoopBudgetBinding = {
  key?: string;
  loopId: string;
  maxRounds: number;
  nextIteration: number;
  kind: "scope" | "role";
  grant: number;
};

/**
 * Returns every budget that applies to a target activation.
 *
 * Semantic IR scopes and role-local `loop.max` declarations are independent
 * guards. A role can therefore be subject to both, and passing one guard must
 * never bypass the other.
 */
export function getLoopBudgetBindings(args: {
  targetRoleId: string;
  currentLoopIteration: number;
  state: GraphState;
  plan: ExecutionPlan;
  lineageId?: string;
}): LoopBudgetBinding[] {
  const targetNode = getExecutionPlanNode(args.plan, args.targetRoleId);
  const scope = getLoopScopeForRole(args.plan, args.targetRoleId);
  const bindings: LoopBudgetBinding[] = [];

  if (scope && args.lineageId) {
    const key = buildLoopScopeKey(args.lineageId, scope.loopId);
    bindings.push({
      key,
      loopId: scope.loopId,
      maxRounds: scope.maxRounds,
      nextIteration: getTargetLoopIteration(args),
      kind: "scope",
      grant: args.state.loopBudgetAuthorizationsByScope?.[key] ?? 0
    });
  }

  if (targetNode.loopMax !== undefined) {
    const key = args.lineageId
      ? buildLoopScopeKey(args.lineageId, `role:${args.targetRoleId}`)
      : undefined;
    bindings.push({
      key,
      loopId: `role:${args.targetRoleId}`,
      maxRounds: targetNode.loopMax,
      nextIteration: (args.state.loopIterations[args.targetRoleId] ?? 0) + 1,
      kind: "role",
      grant: key ? args.state.loopBudgetAuthorizationsByScope?.[key] ?? 0 : 0
    });
  }

  return bindings;
}

export function wouldExceedLoopBudget(args: {
  targetRoleId: string;
  currentLoopIteration: number;
  state: GraphState;
  plan: ExecutionPlan;
  lineageId?: string;
}): boolean {
  return getLoopBudgetBindings(args).some(
    (binding) => binding.nextIteration > binding.maxRounds + binding.grant
  );
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
    currentRoleId: args.state.finalRoleIds.at(-1) || args.state.lastExecutedRoleId || args.plan.entryRoleIds[0],
    selectedEntryRoleIds: args.state.selectedEntryRoleIds,
    nextRoleId: activeBranches.length === 1 ? activeBranches[0].roleId : undefined,
    finalRoleIds: args.state.finalRoleIds.length ? args.state.finalRoleIds : undefined,
    transitionCount: args.state.transitionCount,
    totalTransitions: summary.totalTransitions,
    okCount: summary.okCount,
    failedCount: summary.failedCount,
    noopCount: summary.noopCount,
    failureCountsByErrorCode: summary.failureCountsByErrorCode,
    finalOutputsByRoleId: Object.keys(args.state.finalOutputsByRoleId).length ? args.state.finalOutputsByRoleId : undefined,
    finalOutputRoleOrder: args.state.finalOutputRoleOrder.length ? args.state.finalOutputRoleOrder : undefined,
    resultCommit: args.state.resultCommit,
    error: args.state.error || undefined,
    errorEnvelope: args.state.errorEnvelope || undefined,
    pendingReviewCount: countPendingHumanReviews(args.state),
    joinScopes: args.state.joinScopes,
    joinSourceOutcomesByScope: args.state.joinSourceOutcomesByScope,
    hasWaitingHumanReview: hasWaitingHumanReview(args.state),
    activeBranches,
    completedBranches,
    pendingJoinRoleIds,
    loopIterations: args.state.loopIterations,
    loopCountersByScope: args.state.loopCountersByScope,
    loopBudgetAuthorizationsByScope: args.state.loopBudgetAuthorizationsByScope,
    loopBudgetReviews: Object.values(args.state.pendingReviewsById).filter((review) => review.kind === "loop_budget"),
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
  runId?: string;
}): GraphState {
  const runId = args.runId || "local-run";
  const selectedEntryRoleIds = args.plan.startDispatch.mode === "all"
    ? [...args.plan.entryRoleIds]
    : [...args.plan.entryRoleIds]
      .sort((left, right) => {
        const leftHash = createHash("sha256").update(`${runId}\0${left}`).digest("hex");
        const rightHash = createHash("sha256").update(`${runId}\0${right}`).digest("hex");
        return leftHash.localeCompare(rightHash) || left.localeCompare(right);
      })
      .slice(0, args.plan.startDispatch.count)
      .sort((left, right) => args.plan.entryRoleIds.indexOf(left) - args.plan.entryRoleIds.indexOf(right));
  const branchRecords = Object.fromEntries(selectedEntryRoleIds.map((roleId, index) => {
    const branchSequence = index + 1;
    const branchId = buildBranchId(roleId, 1, branchSequence);
    return [branchId, { branchId, roleId, loopIteration: 1, branchSequence, lineageId: branchId, sessionLineageId: branchId, status: "active" as const }];
  }));
  const loopIterations = Object.fromEntries(selectedEntryRoleIds.map((roleId) => [roleId, 1]));
  const roleActivationsByScope = Object.fromEntries(Object.values(branchRecords).map((branch) => [buildRoleActivationScopeKey(branch.branchId, branch.roleId), 1]));
  return {
    stateVersion: 0,
    lastEventId: undefined,
    userPrompt: args.prompt,
    selectedEntryRoleIds,
    businessState: { ...(args.plan.semanticIR?.stateSchema.defaults ?? {}) },
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
    branchRecords,
    loopIterations,
    loopCountersByScope: {},
    roleActivationsByScope,
    artifactAllowedByBranchId: Object.fromEntries(Object.keys(branchRecords).map((branchId) => [branchId, []])),
    joinScopes: {},
    selectedEventByBranchId: {},
    finalOutputsByRoleId: {},
    finalOutputRoleOrder: [],
    finalRoleIds: [],
    lastExecutedRoleId: "",
    nextBranchSequence: selectedEntryRoleIds.length + 1,
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
