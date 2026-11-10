import type { RunConsoleLogger } from "./console-run-log.js";
import { getExecutionPlanNode } from "./execution-plan.js";
import {
  getFlowContractByTarget,
  getSplitFlowContractByTarget,
  validateContractAgainstSchema
} from "./flow-contract.js";
import { isRuntimeOnlyErrorEvent } from "./error-flow-utils.js";
import { evaluateJoinNodeReadiness, mergeJoinSourceStatus, selectRoutingTargets } from "./graph-mode-registry.js";
import {
  activateBranch,
  buildBranchId,
  buildJoinId,
  buildLoopScopeKey,
  buildRoleActivationScopeKey,
  completeBranch,
  getBranchResult,
  findRoleResult,
  getLoopBudgetBindings,
  getTargetLoopIteration,
  getLoopScopeForRole,
  storeRoleResult,
  waitForHumanReview,
  wouldExceedLoopBudget
} from "./graph-runtime-state.js";
import { buildReviewId, buildReviewRoundKey } from "./human-review.js";
import { evaluateCondition, SemanticRouteSelectionError, selectSemanticRoute } from "./condition-ast.js";
import { semanticIRDigest } from "./semantic-ir.js";
import {
  RUNTIME_EVENT_HUMAN_REVIEW_REJECTED,
  RUNTIME_EVENT_LOOP_EXHAUSTED
} from "../business-events.js";
import { sanitizeRoleInputContext } from "./role-input-projector.js";
import { buildAuditSummaryDelta } from "./run-summary.js";
import { getLoopBudgetTargetRoleIds, resolveLoopBudgetTerminateScope } from "./loop-budget.js";
import type { RuntimeIndexes } from "./runtime-indexes.js";
import { SYSTEM_END_ROLE_ID } from "./types.js";
import type {
  AuditRecord,
  BranchRecord,
  ExecutionPlan,
  ExecutionPlanNode,
  FlowContractPlan,
  GraphRoleMetricSummary,
  GraphRunStatus,
  GraphState,
  GraphStateUpdate,
  HandledFailureArtifactData,
  HumanReviewDecision,
  HumanReviewDecisionRecord,
  LoopBudgetReview,
  LoadedRolePackage,
  PendingHumanReview,
  RoleExecutionOutcomeRecord,
  RuntimeErrorEnvelope,
  StoredRoleResult
} from "./types.js";

type GraphUpdate = GraphStateUpdate;

type JoinTransitionEvent = {
  type: "join_quorum_reached" | "join_activated" | "join_late_arrival_ignored";
  at: string;
  roleId: string;
  joinId: string;
  lineageId: string;
  loopIteration: number;
  joinMode: string;
  joinMin?: number;
  joinSources: string[];
  requiredSourceCount: number;
  satisfiedSources: string[];
  arrivedFromRoleId: string;
  arrivedFromBranchId: string;
  activatedBranchId?: string;
  reason?: string;
};

type FailureHandledTransitionEvent = {
  type: "failure_handled";
  at: string;
  roleId: string;
  branchId: string;
  lineageId: string;
  loopIteration: number;
  errorCode: string;
  handledByEvent: string;
  handledTargetRoleId: string;
};

type HumanReviewTransitionEvent =
  | {
      type: "human_review_requested";
      at: string;
      roleId: string;
      branchId: string;
      lineageId: string;
      loopIteration: number;
      reviewId: string;
      round: number;
    }
  | {
      type: "human_review_approved";
      at: string;
      roleId: string;
      branchId: string;
      lineageId: string;
      loopIteration: number;
      reviewId: string;
      decidedAt: string;
    }
  | {
      type: "human_review_rework_requested";
      at: string;
      roleId: string;
      branchId: string;
      lineageId: string;
      loopIteration: number;
      reviewId: string;
      decidedAt: string;
      targetRoleId: string;
    }
  | {
      type: typeof RUNTIME_EVENT_HUMAN_REVIEW_REJECTED;
      at: string;
      roleId: string;
      branchId: string;
      lineageId: string;
      loopIteration: number;
      reviewId: string;
      decidedAt: string;
      targetRoleId: string;
    }
  | {
      type: "human_review_paused";
      at: string;
      roleId: string;
      branchId: string;
      lineageId: string;
      loopIteration: number;
      reviewId: string;
      decidedAt: string;
    }
  | {
      type: "human_review_terminated";
      at: string;
      roleId: string;
      branchId: string;
      lineageId: string;
      loopIteration: number;
      reviewId: string;
      decidedAt: string;
      scope: "branch" | "run";
    }
  | {
      type: "human_review_expired";
      at: string;
      roleId: string;
      branchId: string;
      lineageId: string;
      loopIteration: number;
      reviewId: string;
      decidedAt: string;
      expiredAt: string;
      timedOut: true;
      action: "pause" | "terminate";
      scope?: "branch" | "run";
    };

type LoopTransitionEvent = {
  type: "loop_exhausted" | "loop_budget_decision";
  eventId?: string;
  at: string;
  loopId: string;
  roleId: string;
  lineageId: string;
  loopIteration: number;
  maxRounds: number;
  onExhausted?: string;
  reviewId?: string;
  decision?: HumanReviewDecision;
  targetRoleId?: string;
  additionalBudget?: number;
};

type RouteDecisionTransitionEvent = {
  type: "route_decision";
  status: "selected" | "failed";
  at: string;
  roleId: string;
  branchId: string;
  lineageId: string;
  loopIteration: number;
  event: string;
  candidates: Array<{ flowId: string; priority: number; matched?: boolean }>;
  selectedFlowId?: string;
  targetRoleId?: string;
  errorCode?: string;
};

type RunTerminationTransitionEvent = {
  type: "run_terminated";
  eventId?: string;
  at: string;
  reason: string;
  reviewId?: string;
  branchId?: string;
};

export type RuntimeTransitionEvent =
  | JoinTransitionEvent
  | FailureHandledTransitionEvent
  | HumanReviewTransitionEvent
  | LoopTransitionEvent
  | RouteDecisionTransitionEvent
  | RunTerminationTransitionEvent;

export type TransitionPlan = {
  update: GraphUpdate;
  events: RuntimeTransitionEvent[];
  reviewRequests?: PendingHumanReview[];
};

export type TransitionPlannerInput = {
  runId?: string;
  state: GraphState;
  plan: ExecutionPlan;
  contractPlan?: FlowContractPlan;
  outcome: RoleExecutionOutcomeRecord;
  logger: RunConsoleLogger;
  errorFlowRoutingEnabled: boolean;
  indexes?: RuntimeIndexes;
};

export type ReviewDecisionTransitionInput = {
  runId?: string;
  state: GraphState;
  plan: ExecutionPlan;
  contractPlan?: FlowContractPlan;
  review: PendingHumanReview;
  decision: HumanReviewDecisionRecord;
  logger: RunConsoleLogger;
  indexes?: RuntimeIndexes;
  rolePackagesByRoleId: ReadonlyMap<string, LoadedRolePackage>;
};

function listPendingJoinSources(args: {
  node: ExecutionPlanNode;
  currentBranch: BranchRecord;
  state: GraphState;
  currentResult?: StoredRoleResult;
  indexes?: RuntimeIndexes;
}): string[] {
  return evaluateJoinNodeReadiness(args).missingSourceRoleIds;
}

function buildRoleMetricsDelta(audit: AuditRecord): Record<string, GraphRoleMetricSummary> {
  return {
    [audit.roleId]: {
      total: 1,
      ok: audit.status === "ok" ? 1 : 0,
      failed: audit.status === "failed" ? 1 : 0,
      noop: audit.status === "noop" ? 1 : 0,
      durationMsTotal: audit.durationMs
    }
  };
}

function buildFailureUpdate(args: {
  state: GraphState;
  plan: ExecutionPlan;
  roleId: string;
  branch: BranchRecord;
  error: string;
  errorEnvelope: RuntimeErrorEnvelope;
  audit: AuditRecord;
}): GraphUpdate {
  const joinScopes = args.state?.joinScopes
    ? Object.fromEntries(Object.entries(args.state.joinScopes).map(([key, scope]) => {
        if (scope.lineageId !== args.branch.lineageId || scope.loopIteration !== args.branch.loopIteration || !scope.expectedSourceRoleIds.includes(args.roleId)) return [key, scope];
        return [key, {
          ...scope,
          sourceStatusByRoleId: { ...(scope.sourceStatusByRoleId ?? {}), [args.roleId]: "failed" },
          missingSourceRoleIds: scope.expectedSourceRoleIds.filter((source) => source !== args.roleId && !scope.readySourceRoleIds.includes(source))
        }];
      }))
    : undefined;
  const joinSourceOutcomesByScope = buildJoinSourceOutcomeUpdates({
    state: args.state,
    plan: args.plan,
    roleId: args.roleId,
    lineageId: args.branch.lineageId,
    loopIteration: args.branch.loopIteration,
    candidateTargets: [],
    failure: true
  });
  const compensatesBudget = args.errorEnvelope.retryable &&
    (args.errorEnvelope.errorCategory === "execution" ||
      args.errorEnvelope.errorCategory === "io" ||
      args.errorEnvelope.errorCategory === "system");
  const budgetAuthorizationRollback = compensatesBudget
    ? Object.fromEntries((args.branch.consumedLoopBudgetKeys ?? []).map((key) => [key, 1]))
    : {};
  return {
    status: "failed",
    error: args.error,
    errorEnvelope: args.errorEnvelope,
    transitionCount: 1,
    recentAudits: [args.audit],
    auditSummary: buildAuditSummaryDelta(args.audit),
    roleMetricsByRoleId: buildRoleMetricsDelta(args.audit),
    ...(joinScopes ? { joinScopes } : {}),
    joinSourceOutcomesByScope,
    ...(Object.keys(budgetAuthorizationRollback).length
      ? { loopBudgetAuthorizationDeltasByScope: budgetAuthorizationRollback }
      : {}),
    branchRecords: {
      [args.branch.branchId]: completeBranch(args.branch)
    },
    loopIterations: {
      [args.roleId]: args.branch.loopIteration
    },
    finalRoleIds: [args.roleId],
    lastExecutedRoleId: args.roleId
  };
}

function resolveFailureEdge(args: {
  node: ExecutionPlanNode;
  errorCode: string;
}): { eventType: string; toRoleId: string } | undefined {
  const exactEvent = `ERROR.${args.errorCode}`;
  const exact = args.node.outgoing.find((flow) => flow.eventType === exactEvent);
  if (exact) {
    return {
      eventType: exact.eventType,
      toRoleId: exact.toRoleId
    };
  }
  const fallback = args.node.outgoing.find((flow) => flow.eventType === "ERROR");
  if (!fallback) {
    return undefined;
  }
  return {
    eventType: fallback.eventType,
    toRoleId: fallback.toRoleId
  };
}

function buildHandledFailureArtifact(args: {
  state: GraphState;
  roleId: string;
  branch: BranchRecord;
  handledByEvent: string;
  errorEnvelope: RuntimeErrorEnvelope;
  error?: string;
  failureInputContext?: string;
}): StoredRoleResult {
  const upstream = getBranchResult(args.state, args.branch.parentBranchId);
  const lastContextSource =
    args.failureInputContext ?? upstream?.content ?? args.state.userPrompt;
  const artifactData: HandledFailureArtifactData = {
    error_code: args.errorEnvelope.errorCode,
    error_category: args.errorEnvelope.errorCategory,
    error_message: args.errorEnvelope.message,
    retryable: args.errorEnvelope.retryable,
    stage: args.errorEnvelope.stage,
    failed_role: args.roleId,
    branch_id: args.branch.branchId,
    lineage_id: args.branch.lineageId,
    loop_iteration: args.branch.loopIteration,
    last_context: sanitizeRoleInputContext(lastContextSource)
  };
  return {
    // Keep this artifact available for direct context projection while preventing join-source
    // readiness from counting the failed source role as "completed".
    roleId: `${args.roleId}.__handled_failure`,
    event: args.handledByEvent,
    content: args.error ?? args.errorEnvelope.message,
    data: artifactData,
    branchId: args.branch.branchId,
    lineageId: args.branch.lineageId,
    loopIteration: args.branch.loopIteration
  };
}

function resolveNextSessionLineageId(args: {
  currentNode: ExecutionPlanNode;
  targetNode: ExecutionPlanNode;
  currentBranch: BranchRecord;
  targetRoleId: string;
  nextLoopIteration: number;
  nextBranchSequence: number;
  activatedTargetCount: number;
}): string {
  if (
    args.activatedTargetCount > 1 ||
    args.currentNode.routingMode === "parallel_split" ||
    args.targetNode.joinMode !== undefined
  ) {
    return buildBranchId(args.targetRoleId, args.nextLoopIteration, args.nextBranchSequence);
  }
  return args.currentBranch.sessionLineageId;
}

function findActivatedJoinBranch(args: {
  state: GraphState;
  roleId: string;
  lineageId: string;
  loopIteration: number;
}): BranchRecord | undefined {
  return Object.values(args.state.branchRecords).find(
    (branch) =>
      branch.roleId === args.roleId &&
      branch.lineageId === args.lineageId &&
      branch.loopIteration === args.loopIteration
  );
}

export function findOrphanedJoinGroup(args: {
  state: GraphState;
  plan: ExecutionPlan;
  branchUpdates: Record<string, BranchRecord>;
}):
  | {
      roleId: string;
      lineageId: string;
      loopIteration: number;
      completedSourceRoleIds: string[];
      requiredSourceCount: number;
    }
  | undefined {
  const mergedBranches = {
    ...args.state.branchRecords,
    ...args.branchUpdates
  };
  const activeBranches = Object.values(mergedBranches).filter((branch) => branch.status === "active");

  for (const node of args.plan.nodesByRoleId.values()) {
    if (!node.joinMode) {
      continue;
    }

    const sourceRoleIds = Array.from(new Set(node.joinSources));
    const requiredSourceCount =
      node.joinMode === "quorum_of" ? node.joinMin ?? sourceRoleIds.length : sourceRoleIds.length;
    const completedByGroup = new Map<
      string,
      {
        lineageId: string;
        loopIteration: number;
        completedSourceRoleIds: Set<string>;
      }
    >();

    for (const branch of Object.values(mergedBranches)) {
      if (branch.status !== "completed" || !sourceRoleIds.includes(branch.roleId)) {
        continue;
      }
      if (branch.terminatedByHumanReview) {
        continue;
      }
      const groupKey = `${branch.lineageId}::${branch.loopIteration}`;
      const existing = completedByGroup.get(groupKey);
      if (existing) {
        existing.completedSourceRoleIds.add(branch.roleId);
        continue;
      }
      completedByGroup.set(groupKey, {
        lineageId: branch.lineageId,
        loopIteration: branch.loopIteration,
        completedSourceRoleIds: new Set([branch.roleId])
      });
    }

    for (const group of completedByGroup.values()) {
      if (
        group.completedSourceRoleIds.size === 0 ||
        group.completedSourceRoleIds.size >= requiredSourceCount
      ) {
        continue;
      }

      const hasJoinBranch = Object.values(mergedBranches).some(
        (branch) =>
          branch.roleId === node.roleId &&
          branch.lineageId === group.lineageId &&
          branch.loopIteration === group.loopIteration
      );
      if (hasJoinBranch) {
        continue;
      }

      const hasActiveSourceBranch = activeBranches.some(
        (branch) =>
          branch.lineageId === group.lineageId &&
          branch.loopIteration === group.loopIteration &&
          sourceRoleIds.includes(branch.roleId)
      );
      if (hasActiveSourceBranch) {
        continue;
      }

      return {
        roleId: node.roleId,
        lineageId: group.lineageId,
        loopIteration: group.loopIteration,
        completedSourceRoleIds: Array.from(group.completedSourceRoleIds),
        requiredSourceCount
      };
    }
  }

  return undefined;
}

function findOutgoingFlow(args: {
  node: ExecutionPlanNode;
  targetRoleId: string;
  selectedEvent?: string;
}): { eventType: string; toRoleId: string } | undefined {
  return args.node.outgoing.find(
    (item) =>
      item.toRoleId === args.targetRoleId &&
      (args.node.routingMode === "parallel_split"
        ? !isRuntimeOnlyErrorEvent(item.eventType)
        : item.eventType === args.selectedEvent)
  );
}

type FinalOutputsByRoleId = GraphState["finalOutputsByRoleId"];

function collectEndOutputs(args: {
  state: GraphState;
  plan: ExecutionPlan;
  branchUpdates: Record<string, BranchRecord>;
  currentBranch?: BranchRecord;
  currentResult?: StoredRoleResult;
  selectedEvent?: string;
}): FinalOutputsByRoleId {
  const branches = { ...args.state.branchRecords, ...args.branchUpdates };
  const results = { ...args.state.roleResults };
  if (args.currentBranch && args.currentResult) results[args.currentBranch.branchId] = args.currentResult;
  const ordered = Object.values(branches)
    .filter((branch) => branch.status === "completed" && args.plan.terminalRoleOrder.includes(branch.roleId))
    .filter((branch) => {
      const node = args.plan.nodesByRoleId.get(branch.roleId);
      if (!node) return false;
      const endFlows = node.outgoing.filter((flow) => flow.toRoleId === SYSTEM_END_ROLE_ID);
      if (!endFlows.length) return false;
      if (branch.branchId === args.currentBranch?.branchId && node.routingMode === "parallel_split") return true;
      const selectedEvent = branch.branchId === args.currentBranch?.branchId
        ? args.selectedEvent
        : args.state.selectedEventByBranchId[branch.branchId];
      return node.routingMode === "parallel_split"
        ? true
        : endFlows.some((flow) => flow.eventType === selectedEvent);
    })
    .map((branch) => ({ branch, result: results[branch.branchId] }))
    .sort((left, right) => {
      const leftRoleOrder = args.plan.terminalRoleOrder.indexOf(left.branch.roleId);
      const rightRoleOrder = args.plan.terminalRoleOrder.indexOf(right.branch.roleId);
      return leftRoleOrder - rightRoleOrder || left.branch.branchSequence - right.branch.branchSequence;
    });
  const outputs: FinalOutputsByRoleId = {};
  for (const { branch, result } of ordered) {
    const values = outputs[branch.roleId] ??= [];
    values.push({
      ...(result?.content !== undefined ? { content: result.content } : {}),
      ...(result?.data !== undefined ? { data: structuredClone(result.data) } : {})
    });
  }
  return outputs;
}

function reachableTerminalRoles(plan: ExecutionPlan, startRoleId: string): Set<string> {
  const visited = new Set<string>();
  const pending = [startRoleId];
  while (pending.length) {
    const roleId = pending.pop()!;
    if (visited.has(roleId)) continue;
    visited.add(roleId);
    const node = plan.nodesByRoleId.get(roleId);
    if (!node) continue;
    if (plan.terminalRoleOrder.includes(roleId)) continue;
    for (const flow of node.outgoing) {
      if (flow.toRoleId !== SYSTEM_END_ROLE_ID) pending.push(flow.toRoleId);
    }
  }
  return new Set([...visited].filter((roleId) => plan.terminalRoleOrder.includes(roleId)));
}

function resolveEndAggregation(args: {
  state: GraphState;
  plan: ExecutionPlan;
  branchUpdates: Record<string, BranchRecord>;
  outputs: FinalOutputsByRoleId;
}): { status: "waiting" | "done" | "failed"; branches: Record<string, BranchRecord>; error?: string } {
  const mode = args.plan.endJoin.mode;
  const required = mode === "all_of" ? args.plan.terminalRoleOrder.length : args.plan.endJoin.min ?? args.plan.terminalRoleOrder.length;
  const completedRoleIds = new Set(Object.keys(args.outputs));
  const branches = { ...args.state.branchRecords, ...args.branchUpdates };
  const active = Object.values(branches).filter((branch) => branch.status === "active");
  const possible = new Set(completedRoleIds);
  for (const branch of active) {
    for (const roleId of reachableTerminalRoles(args.plan, branch.roleId)) possible.add(roleId);
  }
  const reached = completedRoleIds.size >= required;
  if (mode === "quorum_of" && reached) {
    const cancelled: Record<string, BranchRecord> = { ...args.branchUpdates };
    for (const branch of active) cancelled[branch.branchId] = { ...branch, status: "cancelled" };
    return { status: "done", branches: cancelled };
  }
  if (active.length === 0 && reached) return { status: "done", branches: args.branchUpdates };
  if (possible.size < required) {
    const cancelled: Record<string, BranchRecord> = { ...args.branchUpdates };
    for (const branch of active) cancelled[branch.branchId] = { ...branch, status: "cancelled" };
    return {
      status: "failed",
      branches: cancelled,
      error: `End quorum is unreachable: ${completedRoleIds.size} terminal roles completed and at most ${possible.size} can complete; ${required} required.`
    };
  }
  return { status: "waiting", branches: args.branchUpdates };
}

function buildContractValidationFailureTransition(args: {
  roleId: string;
  branch: BranchRecord;
  audit: AuditRecord;
  selectedEvent?: string;
  storedResult?: StoredRoleResult;
  errorCode: string;
  message: string;
}): TransitionPlan {
  const errorEnvelope: RuntimeErrorEnvelope = {
    errorCode: args.errorCode,
    errorCategory: "validation",
    message: args.message,
    retryable: false,
    stage: "execute",
    roleId: args.roleId,
    branchId: args.branch.branchId
  };
  return {
    update: {
      status: "failed",
      error: args.message,
      errorEnvelope,
      transitionCount: 1,
      recentAudits: [args.audit],
      auditSummary: buildAuditSummaryDelta(args.audit),
      roleMetricsByRoleId: buildRoleMetricsDelta(args.audit),
      roleResults: storeRoleResult(args.branch.branchId, args.storedResult),
      branchRecords: {
        [args.branch.branchId]: completeBranch(args.branch)
      },
      loopIterations: {
        [args.roleId]: args.branch.loopIteration
      },
      selectedEventByBranchId: args.selectedEvent ? { [args.branch.branchId]: args.selectedEvent } : {},
      finalRoleIds: [args.roleId],
      lastExecutedRoleId: args.roleId
    },
    events: []
  };
}

function buildLoopBudgetReviewPendingTransition(args: {
  runId?: string;
  state: GraphState;
  plan: ExecutionPlan;
  roleId: string;
  branch: BranchRecord;
  audit: AuditRecord;
  executionId: string;
  selectedEvent?: string;
  result: StoredRoleResult;
  loopId: string;
  maxRounds: number;
  onExhausted?: string;
  targetRoleIds: string[];
  reworkTargetRoleIds?: string[];
  rejectTargetRoleIds?: string[];
}): TransitionPlan {
  const roundKey = buildReviewRoundKey(`loop-budget:${args.loopId}`, args.branch.lineageId);
  const round = (args.state.reviewRoundByRoleLineageKey[roundKey] ?? 0) + 1;
  const reviewId = `loop-budget.${args.branch.branchId}.${args.loopId}.r${round}`;
  const requestedAt = args.audit.at ?? new Date().toISOString();
  const loopBudget: LoopBudgetReview = {
    loopId: args.loopId,
    maxRounds: args.maxRounds,
    currentIteration: args.branch.loopIteration,
    triggerRoleId: args.roleId,
    terminateScope: "run",
    targetRoleIds: Array.from(new Set(args.targetRoleIds.filter((roleId) => roleId && roleId !== SYSTEM_END_ROLE_ID))),
    reworkTargetRoleIds: Array.from(new Set((args.reworkTargetRoleIds ?? []).filter(Boolean))),
    rejectTargetRoleIds: Array.from(new Set((args.rejectTargetRoleIds ?? []).filter(Boolean))),
    maxAdditionalRounds: Math.max(1, args.maxRounds)
  };
  const review: PendingHumanReview = {
    reviewId,
    roleId: args.roleId,
    branchId: args.branch.branchId,
    lineageId: args.branch.lineageId,
    loopIteration: args.branch.loopIteration,
    executionId: args.executionId,
    selectedEvent: args.selectedEvent,
    draftResult: args.result,
    requestedAt,
    requestedByExecutionId: args.executionId,
    status: "pending",
    round,
    // The synthetic spec keeps the existing review persistence contract. Loop controls are
    // authorized from loopBudget below, never from the triggering Role package.
    spec: {
      mode: "required",
      timeoutAction: "terminate",
      reworkTargetRoleId: loopBudget.reworkTargetRoleIds[0] ?? loopBudget.targetRoleIds[0] ?? args.roleId,
      terminateScope: "run"
    },
    kind: "loop_budget",
    loopBudget,
    stateVersion: args.state.stateVersion + 1,
    ...(args.plan.semanticIR ? { irDigest: semanticIRDigest(args.plan.semanticIR) } : {})
  };
  const branch = args.state.branchRecords[args.branch.branchId] ?? args.branch;
  return {
    update: {
      status: "waiting_review",
      transitionCount: 1,
      recentAudits: [args.audit],
      auditSummary: buildAuditSummaryDelta(args.audit),
      roleMetricsByRoleId: buildRoleMetricsDelta(args.audit),
      roleResults: { [args.branch.branchId]: args.result },
      selectedEventByBranchId: args.selectedEvent ? { [args.branch.branchId]: args.selectedEvent } : {},
      pendingReviewsById: { [reviewId]: review },
      reviewRoundByRoleLineageKey: { [roundKey]: round },
      lastWaitingReviewId: reviewId,
      branchRecords: { [args.branch.branchId]: waitForHumanReview(branch) },
      loopIterations: { [args.roleId]: args.branch.loopIteration },
      lastExecutedRoleId: args.roleId
    },
    events: [{
      type: RUNTIME_EVENT_LOOP_EXHAUSTED,
      eventId: `loop_exhausted:${reviewId}`,
      at: requestedAt,
      loopId: args.loopId,
      roleId: args.roleId,
      lineageId: args.branch.lineageId,
      loopIteration: args.branch.loopIteration,
      maxRounds: args.maxRounds,
      ...(args.onExhausted ? { onExhausted: args.onExhausted } : {}),
      reviewId
    }],
    reviewRequests: [review]
  };
}

function findExceededLoopBudget(args: {
  targetRoleId: string;
  currentLoopIteration: number;
  state: GraphState;
  plan: ExecutionPlan;
  lineageId?: string;
}) {
  return getLoopBudgetBindings(args).find(
    (binding) => binding.nextIteration > binding.maxRounds + binding.grant
  );
}

function buildHumanReviewPendingTransition(args: {
  state: GraphState;
  plan: ExecutionPlan;
  roleId: string;
  branch: BranchRecord;
  audit: AuditRecord;
  result?: StoredRoleResult;
  selectedEvent?: string;
  executionId: string;
  spec: NonNullable<ExecutionPlanNode["review"]>;
}): TransitionPlan {
  if (!args.result) {
    return buildContractValidationFailureTransition({
      roleId: args.roleId,
      branch: args.branch,
      audit: args.audit,
      selectedEvent: args.selectedEvent,
      storedResult: args.result,
      errorCode: "GRAPH_REVIEW_REQUIRES_RESULT",
      message: `Role "${args.roleId}" cannot enter human review without a stored result`
    });
  }
  const roundKey = buildReviewRoundKey(args.roleId, args.branch.lineageId);
  const round = (args.state.reviewRoundByRoleLineageKey[roundKey] ?? 0) + 1;
  const reviewId = buildReviewId(args.branch.branchId, round);
  const review: PendingHumanReview = {
    reviewId,
    roleId: args.roleId,
    branchId: args.branch.branchId,
    lineageId: args.branch.lineageId,
    loopIteration: args.branch.loopIteration,
    executionId: args.executionId,
    selectedEvent: args.selectedEvent,
    draftResult: args.result,
    requestedAt: new Date().toISOString(),
    requestedByExecutionId: args.executionId,
    status: "pending",
    round,
    spec: args.spec,
    stateVersion: args.state.stateVersion,
    ...(args.plan.semanticIR ? { irDigest: semanticIRDigest(args.plan.semanticIR) } : {})
  };
  return {
    update: {
      transitionCount: 1,
      recentAudits: [args.audit],
      auditSummary: buildAuditSummaryDelta(args.audit),
      roleMetricsByRoleId: buildRoleMetricsDelta(args.audit),
      pendingReviewsById: {
        [review.reviewId]: review
      },
      reviewRoundByRoleLineageKey: {
        [roundKey]: round
      },
      lastWaitingReviewId: review.reviewId,
      branchRecords: {
        [args.branch.branchId]: waitForHumanReview(args.branch)
      },
      loopIterations: {
        [args.roleId]: args.branch.loopIteration
      },
      lastExecutedRoleId: args.roleId
    },
    events: [
      {
        type: "human_review_requested",
        at: review.requestedAt,
        roleId: args.roleId,
        branchId: args.branch.branchId,
        lineageId: args.branch.lineageId,
        loopIteration: args.branch.loopIteration,
        reviewId: review.reviewId,
        round
      }
    ],
    reviewRequests: [review]
  };
}

function buildReviewHistoryUpdate(args: {
  state: GraphState;
  review: PendingHumanReview;
  decision: HumanReviewDecisionRecord;
}): Record<string, HumanReviewDecisionRecord[]> {
  return {
    [args.review.branchId]: [
      ...(args.state.reviewHistoryByBranchId[args.review.branchId] ?? []),
      args.decision
    ]
  };
}

function buildApprovedHumanReviewTransition(args: {
  runId?: string;
  state: GraphState;
  plan: ExecutionPlan;
  contractPlan?: FlowContractPlan;
  node: ExecutionPlanNode;
  review: PendingHumanReview;
  decision: HumanReviewDecisionRecord;
  logger: RunConsoleLogger;
  indexes?: RuntimeIndexes;
}): TransitionPlan {
  const candidateTargets = selectRoutingTargets({
    node: args.node,
    selectedEvent: args.review.selectedEvent,
    mode: "ok"
  });
  const eventByTargetRoleId = new Map<string, string | undefined>();
  const flowContractPayload: Record<string, unknown> = {};
  if (args.review.draftResult.event !== undefined) {
    flowContractPayload.event = args.review.draftResult.event;
  }
  if (args.review.draftResult.content !== undefined) {
    flowContractPayload.content = args.review.draftResult.content;
  }
  if (args.review.draftResult.data !== undefined) {
    flowContractPayload.data = args.review.draftResult.data;
  }
  const skippedTargets = new Set<string>();
  if (args.contractPlan?.handoffMode) {
    const contractValidationFailures: Array<{ errorCode: string; message: string }> = [];
    for (const targetRoleId of candidateTargets) {
      const flow = findOutgoingFlow({
        node: args.node,
        targetRoleId,
        selectedEvent: args.review.selectedEvent
      });
      eventByTargetRoleId.set(targetRoleId, flow?.eventType ?? args.review.selectedEvent);
      if (!flow || targetRoleId === SYSTEM_END_ROLE_ID || isRuntimeOnlyErrorEvent(flow.eventType)) {
        continue;
      }
      const contract =
        args.node.routingMode === "parallel_split"
          ? getSplitFlowContractByTarget({
              plan: args.contractPlan,
              fromRoleId: args.review.roleId,
              toRoleId: targetRoleId
            })
          : getFlowContractByTarget({
              plan: args.contractPlan,
              fromRoleId: args.review.roleId,
              toRoleId: targetRoleId,
              eventType: flow.eventType
            });
      if (!contract) {
        if (args.contractPlan.handoffMode === "strict") {
          contractValidationFailures.push({
            errorCode: "CONTRACT_MISSING",
            message: `Missing flow contract for ${args.review.roleId} -> ${targetRoleId} (${flow.eventType}) under handoff.mode=strict`
          });
        } else {
          skippedTargets.add(targetRoleId);
        }
      } else {
        const contractError = validateContractAgainstSchema({
          contract,
          data: flowContractPayload,
          subject: "flow"
        });
        if (contractError) {
          if (contract.definition.onViolation === "WARN" && args.contractPlan.handoffMode === "transition") {
            skippedTargets.add(targetRoleId);
          } else {
            contractValidationFailures.push({
              errorCode: "CONTRACT_VALIDATION_FAILED",
              message: contractError
            });
          }
        }
      }
    }
    if (contractValidationFailures.length > 0) {
      const failure = contractValidationFailures[0];
      return {
        update: {
          status: "failed",
          error: failure.message,
          errorEnvelope: {
            errorCode: failure.errorCode,
            errorCategory: "validation",
            message: failure.message,
            retryable: false,
            stage: "execute",
            roleId: args.review.roleId,
            branchId: args.review.branchId
          },
          finalRoleIds: [args.review.roleId],
          lastExecutedRoleId: args.review.roleId
        },
        events: []
      };
    }
  }

  for (const targetRoleId of candidateTargets) {
    if (!eventByTargetRoleId.has(targetRoleId)) {
      const flow = findOutgoingFlow({
        node: args.node,
        targetRoleId,
        selectedEvent: args.review.selectedEvent
      });
      eventByTargetRoleId.set(targetRoleId, flow?.eventType ?? args.review.selectedEvent);
    }
  }

  const branchUpdates: Record<string, BranchRecord> = {
    [args.review.branchId]: completeBranch({
      branchId: args.review.branchId,
      roleId: args.review.roleId,
      loopIteration: args.review.loopIteration,
      branchSequence: args.state.branchRecords[args.review.branchId]?.branchSequence ?? 0,
      lineageId: args.review.lineageId,
      sessionLineageId:
        args.state.branchRecords[args.review.branchId]?.sessionLineageId ?? args.review.branchId,
      parentBranchId: args.state.branchRecords[args.review.branchId]?.parentBranchId,
      activatedByRoleId: args.state.branchRecords[args.review.branchId]?.activatedByRoleId,
      activatedByEvent: args.state.branchRecords[args.review.branchId]?.activatedByEvent
    })
  };
  const loopUpdates: Record<string, number> = {
    [args.review.roleId]: args.review.loopIteration
  };
  const loopScopeUpdates: Record<string, number> = {};
  const roleActivationUpdates: Record<string, number> = {};
  const artifactAllowedByBranchId: Record<string, string[]> = {};
  const joinSourceOutcomeUpdates = buildJoinSourceOutcomeUpdates({
    state: args.state,
    plan: args.plan,
    roleId: args.review.roleId,
    lineageId: args.review.lineageId,
    loopIteration: args.review.loopIteration,
    candidateTargets
  });
  const joinEvents: RuntimeTransitionEvent[] = [];
  let nextBranchSequence = args.state.nextBranchSequence;
  let finalStatus: GraphRunStatus = "running";
  let finalError = "";
  let finalOutputsByRoleId: FinalOutputsByRoleId = {};
  let finalOutputRoleOrder: string[] = [];
  let finalRoleIds: string[] = [];
  let finalErrorEnvelope: RuntimeErrorEnvelope | undefined;
  let reachedSystemOutput = false;
  const currentBranch = args.state.branchRecords[args.review.branchId];
  if (!currentBranch) {
    return {
      update: {
        status: "failed",
        error: `Missing review branch "${args.review.branchId}"`,
        errorEnvelope: {
          errorCode: "GRAPH_REVIEW_BRANCH_MISSING",
          errorCategory: "state",
          message: `Missing review branch "${args.review.branchId}"`,
          retryable: false,
          stage: "execute",
          roleId: args.review.roleId,
          branchId: args.review.branchId
        },
        finalRoleIds: [args.review.roleId],
        lastExecutedRoleId: args.review.roleId
      },
      events: []
    };
  }

  // Approval is itself a routed transition. If its next Role would exhaust a loop,
  // park the approval at the same Runtime budget review used by normal execution.
  // Preflight all targets so a parallel route cannot partially activate before the
  // budget decision is created.
  const routedTargets = candidateTargets.filter((targetRoleId) => !skippedTargets.has(targetRoleId));
  const exhaustedTarget = routedTargets
    .map((targetRoleId) => ({
      targetRoleId,
      budget: targetRoleId === SYSTEM_END_ROLE_ID
        ? undefined
        : findExceededLoopBudget({
            targetRoleId,
            currentLoopIteration: args.review.loopIteration,
            state: args.state,
            plan: args.plan,
            lineageId: args.review.lineageId
          })
    }))
    .find((item) => item.budget);
  if (exhaustedTarget) {
    const exhaustedTargetRoleId = exhaustedTarget.targetRoleId;
    const exhaustedBudget = exhaustedTarget.budget!;
    const budgetReview = buildLoopBudgetReviewPendingTransition({
      runId: args.runId,
      state: args.state,
      plan: args.plan,
      roleId: args.review.roleId,
      branch: currentBranch,
      audit: {
        at: args.decision.decidedAt,
        roleId: args.review.roleId,
        branchId: args.review.branchId,
        lineageId: args.review.lineageId,
        loopIteration: args.review.loopIteration,
        exitCode: 0,
        durationMs: 0,
        status: "ok",
        selectedEvent: args.review.selectedEvent,
        executionId: args.review.executionId
      },
      executionId: args.review.executionId,
      selectedEvent: args.review.selectedEvent,
      result: args.review.draftResult,
      loopId: exhaustedBudget.loopId,
      maxRounds: exhaustedBudget.maxRounds,
      onExhausted: exhaustedBudget.kind === "scope"
        ? getLoopScopeForRole(args.plan, exhaustedTargetRoleId)?.onExhausted
        : undefined,
      targetRoleIds: routedTargets,
      reworkTargetRoleIds: selectRoutingTargets({ node: args.node, selectedEvent: "NEEDS_REWORK", mode: "ok" }),
      rejectTargetRoleIds: selectRoutingTargets({ node: args.node, selectedEvent: "REJECTED", mode: "ok" })
    });
    budgetReview.update.pendingReviewsById = {
      ...(budgetReview.update.pendingReviewsById ?? {}),
      [args.review.reviewId]: { ...args.review, status: "resolved" }
    };
    budgetReview.update.reviewHistoryByBranchId = buildReviewHistoryUpdate({
      state: args.state,
      review: args.review,
      decision: args.decision
    });
    budgetReview.events = [
      {
        type: "human_review_approved",
        at: args.decision.decidedAt,
        roleId: args.review.roleId,
        branchId: args.review.branchId,
        lineageId: args.review.lineageId,
        loopIteration: args.review.loopIteration,
        reviewId: args.review.reviewId,
        decidedAt: args.decision.decidedAt
      },
      ...budgetReview.events
    ];
    return budgetReview;
  }

  for (const targetRoleId of routedTargets) {
    const targetEvent = eventByTargetRoleId.get(targetRoleId) ?? args.review.selectedEvent;
    if (targetRoleId === SYSTEM_END_ROLE_ID) {
      reachedSystemOutput = true;
      args.logger.transition({
        fromRoleId: args.review.roleId,
        event: targetEvent,
        toRoleId: "output",
        branchId: args.review.branchId
      });
      continue;
    }
    if (
      wouldExceedLoopBudget({
        targetRoleId,
        currentLoopIteration: args.review.loopIteration,
        state: args.state,
        plan: args.plan,
        lineageId: args.review.lineageId
      })
    ) {
      finalStatus = "failed";
      finalError = `Loop budget exceeded for ${targetRoleId}`;
      finalErrorEnvelope = {
        errorCode: "GRAPH_LOOP_BUDGET_EXCEEDED",
        errorCategory: "state",
        message: finalError,
        retryable: false,
        stage: "execute",
        roleId: args.review.roleId,
        branchId: args.review.branchId
      };
      finalRoleIds = [args.review.roleId];
      break;
    }
    const nextLoopIteration = getTargetLoopIteration({
      targetRoleId,
      currentLoopIteration: args.review.loopIteration,
      state: args.state,
      plan: args.plan,
      lineageId: args.review.lineageId
    });
    loopUpdates[targetRoleId] = nextLoopIteration;
    const loopScope = getLoopScopeForRole(args.plan, targetRoleId);
    if (loopScope && targetRoleId === loopScope.boundaryRoleId) {
      loopScopeUpdates[buildLoopScopeKey(args.review.lineageId, loopScope.loopId)] = nextLoopIteration;
    }
    const targetNode = getExecutionPlanNode(args.plan, targetRoleId);
    if (targetNode.joinMode) {
      const readiness = evaluateJoinNodeReadiness({
        node: targetNode,
        currentBranch,
        state: {
          ...args.state,
          roleResults: {
            ...args.state.roleResults,
            [args.review.branchId]: args.review.draftResult
          }
        },
        currentResult: args.review.draftResult,
        indexes: args.indexes
      });
      const joinId = buildJoinId(targetRoleId, nextLoopIteration, args.review.lineageId);
      const existingJoinBranch = findActivatedJoinBranch({
        state: args.state,
        roleId: targetRoleId,
        lineageId: args.review.lineageId,
        loopIteration: nextLoopIteration
      });
      if (readiness.ready && existingJoinBranch) {
        joinEvents.push({
          type: "join_late_arrival_ignored",
          at: new Date().toISOString(),
          roleId: targetRoleId,
          joinId,
          lineageId: args.review.lineageId,
          loopIteration: nextLoopIteration,
          joinMode: targetNode.joinMode,
          joinMin: targetNode.joinMin,
          joinSources: targetNode.joinSources,
          requiredSourceCount: readiness.requiredSourceCount,
          satisfiedSources: readiness.completedSourceRoleIds,
          arrivedFromRoleId: args.review.roleId,
          arrivedFromBranchId: args.review.branchId,
          activatedBranchId: existingJoinBranch.branchId,
          reason: "already_activated"
        });
        continue;
      }
      if (!readiness.ready) {
        args.logger.joinWait({
          roleId: targetRoleId,
          arrivedFrom: args.review.roleId,
          waitingFor: listPendingJoinSources({
            node: targetNode,
            currentBranch,
            state: {
              ...args.state,
              roleResults: {
                ...args.state.roleResults,
                [args.review.branchId]: args.review.draftResult
              }
            },
            currentResult: args.review.draftResult,
            indexes: args.indexes
          })
        });
        continue;
      }
      const sessionLineageId = resolveNextSessionLineageId({
        currentNode: args.node,
        targetNode,
        currentBranch,
        targetRoleId,
        nextLoopIteration,
        nextBranchSequence,
        activatedTargetCount: candidateTargets.length
      });
      const branch = activateBranch({
        roleId: targetRoleId,
        loopIteration: nextLoopIteration,
        branchSequence: nextBranchSequence,
        lineageId: args.review.lineageId,
        sessionLineageId,
        parentBranchId: args.review.branchId,
        activatedByRoleId: args.review.roleId,
        activatedByEvent: targetEvent
      });
      nextBranchSequence += 1;
      branchUpdates[branch.branchId] = branch;
      artifactAllowedByBranchId[branch.branchId] = buildArtifactAllowedIdsForActivation({
        state: {
          ...args.state,
          roleResults: {
            ...args.state.roleResults,
            [args.review.branchId]: args.review.draftResult
          }
        },
        targetNode,
        targetLoopIteration: nextLoopIteration,
        currentRoleId: args.review.roleId,
        currentResult: args.review.draftResult,
        currentBranch,
        readiness,
        indexes: args.indexes
      });
      if (targetNode.joinMode === "quorum_of") {
        joinEvents.push({
          type: "join_quorum_reached",
          at: new Date().toISOString(),
          roleId: targetRoleId,
          joinId,
          lineageId: args.review.lineageId,
          loopIteration: nextLoopIteration,
          joinMode: targetNode.joinMode,
          joinMin: targetNode.joinMin,
          joinSources: targetNode.joinSources,
          requiredSourceCount: readiness.requiredSourceCount,
          satisfiedSources: readiness.completedSourceRoleIds,
          arrivedFromRoleId: args.review.roleId,
          arrivedFromBranchId: args.review.branchId,
          activatedBranchId: branch.branchId
        });
      }
      joinEvents.push({
        type: "join_activated",
        at: new Date().toISOString(),
        roleId: targetRoleId,
        joinId,
        lineageId: args.review.lineageId,
        loopIteration: nextLoopIteration,
        joinMode: targetNode.joinMode,
        joinMin: targetNode.joinMin,
        joinSources: targetNode.joinSources,
        requiredSourceCount: readiness.requiredSourceCount,
        satisfiedSources: readiness.completedSourceRoleIds,
        arrivedFromRoleId: args.review.roleId,
        arrivedFromBranchId: args.review.branchId,
        activatedBranchId: branch.branchId
      });
      args.logger.transition({
        fromRoleId: args.review.roleId,
        event: targetEvent,
        toRoleId: targetRoleId,
        branchId: args.review.branchId
      });
      continue;
    }
    const sessionLineageId = resolveNextSessionLineageId({
      currentNode: args.node,
      targetNode,
      currentBranch,
      targetRoleId,
      nextLoopIteration,
      nextBranchSequence,
      activatedTargetCount: candidateTargets.length
    });
    const branch = activateBranch({
      roleId: targetRoleId,
      loopIteration: nextLoopIteration,
      branchSequence: nextBranchSequence,
      lineageId: args.review.lineageId,
      sessionLineageId,
      parentBranchId: args.review.branchId,
      activatedByRoleId: args.review.roleId,
      activatedByEvent: targetEvent
    });
    nextBranchSequence += 1;
    branchUpdates[branch.branchId] = branch;
    artifactAllowedByBranchId[branch.branchId] = buildArtifactAllowedIdsForActivation({
      state: {
        ...args.state,
        roleResults: {
          ...args.state.roleResults,
          [args.review.branchId]: args.review.draftResult
        }
      },
      targetNode,
      targetLoopIteration: nextLoopIteration,
      currentRoleId: args.review.roleId,
      currentResult: args.review.draftResult,
      currentBranch,
      indexes: args.indexes
    });
    args.logger.transition({
      fromRoleId: args.review.roleId,
      event: targetEvent,
      toRoleId: targetRoleId,
      branchId: args.review.branchId
    });
  }

  if (reachedSystemOutput || (args.node.isTerminal && candidateTargets.length === 0)) {
    finalOutputsByRoleId = collectEndOutputs({
      state: args.state,
      plan: args.plan,
      branchUpdates,
      currentBranch,
      currentResult: args.review.draftResult,
      selectedEvent: args.review.selectedEvent
    });
    finalOutputRoleOrder = args.plan.terminalRoleOrder.filter((roleId) => finalOutputsByRoleId[roleId]);
    finalRoleIds = finalOutputRoleOrder;
    const aggregation = resolveEndAggregation({ state: args.state, plan: args.plan, branchUpdates, outputs: finalOutputsByRoleId });
    Object.assign(branchUpdates, aggregation.branches);
    if (aggregation.status === "failed") {
      finalStatus = "failed";
      finalError = aggregation.error ?? "End aggregation could not reach its required terminal sources.";
      finalErrorEnvelope = { errorCode: "GRAPH_END_QUORUM_UNREACHABLE", errorCategory: "state", message: finalError, retryable: false, stage: "execute", roleId: args.review.roleId, branchId: args.review.branchId };
    } else if (aggregation.status === "done") {
      const hasActiveBranches = Object.values({ ...args.state.branchRecords, ...branchUpdates }).some((branch) => branch.status === "active");
      if (!hasActiveBranches) {
      const orphanedJoinGroup = args.contractPlan?.handoffMode === "transition"
        ? findOrphanedJoinGroup({
            state: {
              ...args.state,
              roleResults: {
                ...args.state.roleResults,
                [args.review.branchId]: args.review.draftResult
              }
            },
            plan: args.plan,
            branchUpdates
          })
        : undefined;
      if (orphanedJoinGroup) {
        finalStatus = "failed";
        finalError = `Join "${orphanedJoinGroup.roleId}" became unreachable in lineage ${orphanedJoinGroup.lineageId}#${orphanedJoinGroup.loopIteration} after transition skip; completed sources ${orphanedJoinGroup.completedSourceRoleIds.join(", ")} cannot reach required ${orphanedJoinGroup.requiredSourceCount}`;
        finalErrorEnvelope = {
          errorCode: "GRAPH_JOIN_UNREACHABLE_AFTER_TRANSITION_SKIP",
          errorCategory: "state",
          message: finalError,
          retryable: false,
          stage: "execute",
          roleId: orphanedJoinGroup.roleId,
          branchId: args.review.branchId
        };
        finalRoleIds = [orphanedJoinGroup.roleId];
      } else {
        finalStatus = "done";
      }
      }
    }
  }

  return {
    update: {
      status: finalStatus,
      error: finalError,
      errorEnvelope: finalErrorEnvelope,
      transitionCount: 1,
      roleResults: {
        [args.review.branchId]: args.review.draftResult
      },
      branchRecords: branchUpdates,
      loopIterations: loopUpdates,
      loopCountersByScope: loopScopeUpdates,
      artifactAllowedByBranchId,
      selectedEventByBranchId: args.review.selectedEvent
        ? { [args.review.branchId]: args.review.selectedEvent }
        : {},
      pendingReviewsById: {
        [args.review.reviewId]: {
          ...args.review,
          status: "resolved"
        }
      },
      reviewHistoryByBranchId: buildReviewHistoryUpdate({
        state: args.state,
        review: args.review,
        decision: args.decision
      }),
      finalOutputsByRoleId,
      joinSourceOutcomesByScope: joinSourceOutcomeUpdates,
      ...(finalStatus === "done" && args.state.resultCommit?.status !== "committed" ? {
        resultCommit: {
          resultId: `result:${args.runId ?? "run"}`,
          status: "committed" as const,
          createdAt: args.decision.committedAt,
          committedAt: args.decision.decidedAt
        }
      } : {}),
      finalOutputRoleOrder,
      finalRoleIds,
      lastExecutedRoleId: args.review.roleId,
      nextBranchSequence
    },
    events: [
      {
        type: "human_review_approved",
        at: new Date().toISOString(),
        roleId: args.review.roleId,
        branchId: args.review.branchId,
        lineageId: args.review.lineageId,
        loopIteration: args.review.loopIteration,
        reviewId: args.review.reviewId,
        decidedAt: args.decision.decidedAt
      },
      ...joinEvents
    ]
  };
}

function buildLoopBudgetDecisionTransition(args: ReviewDecisionTransitionInput): TransitionPlan {
  const loopBudget = args.review.loopBudget;
  if (!loopBudget) throw new Error(`[GRAPH_LOOP_BUDGET_BINDING_MISSING] Loop budget review ${args.review.reviewId} has no budget binding`);
  const decision = args.decision.decision;
  if (decision === "pause" || decision === "approve") {
    throw new Error(`[GRAPH_LOOP_BUDGET_DECISION_INVALID] Loop budget review ${args.review.reviewId} requires continue, rework, terminate, or reject`);
  }
  if (decision !== "continue" && decision !== "rework" && decision !== "reject" && decision !== "terminate") {
    throw new Error(`[HUMAN_REVIEW_DECISION_INVALID] Loop budget review ${args.review.reviewId} does not allow decision ${String(decision)}`);
  }
  if (decision === "terminate") {
    const terminateScope = resolveLoopBudgetTerminateScope({
      requestedScope: args.decision.scope,
      loopBudget,
      legacySpec: args.review.spec
    });
    const base = {
      ...args.review,
      status: "resolved" as const
    };
    const branchUpdates = {
      [args.review.branchId]: completeBranch({
        ...(args.state.branchRecords[args.review.branchId] ?? {
          branchId: args.review.branchId,
          roleId: args.review.roleId,
          loopIteration: args.review.loopIteration,
          branchSequence: 0,
          lineageId: args.review.lineageId,
          sessionLineageId: args.review.branchId
        })
      })
    };
    branchUpdates[args.review.branchId] = {
      ...branchUpdates[args.review.branchId],
      terminatedByHumanReview: true
    };
    const joinSourceOutcomeUpdates = buildJoinSourceOutcomeUpdates({
      state: args.state,
      plan: args.plan,
      roleId: args.review.roleId,
      lineageId: args.review.lineageId,
      loopIteration: args.review.loopIteration,
      candidateTargets: []
    });
    const joinScopeUpdates = mergeJoinScopeOutcomeUpdates({
      state: args.state,
      updates: joinSourceOutcomeUpdates
    });
    const hasActiveSibling = Object.values({ ...args.state.branchRecords, ...branchUpdates })
      .some((branch) => branch.status === "active");
    const terminateRun = terminateScope === "run" || !hasActiveSibling;
    return {
      update: {
        status: terminateRun ? (terminateScope === "run" ? "stopped" : "terminated") : "running",
        error: terminateRun ? "loop budget terminated by human review" : "",
        pendingReviewsById: { [args.review.reviewId]: base },
        reviewHistoryByBranchId: buildReviewHistoryUpdate({ state: args.state, review: args.review, decision: args.decision }),
        branchRecords: branchUpdates,
        joinScopes: joinScopeUpdates,
        joinSourceOutcomesByScope: joinSourceOutcomeUpdates,
        lastExecutedRoleId: args.review.roleId
      },
      events: [{
        type: "human_review_terminated",
        at: args.decision.decidedAt,
        roleId: args.review.roleId,
        branchId: args.review.branchId,
        lineageId: args.review.lineageId,
        loopIteration: args.review.loopIteration,
        reviewId: args.review.reviewId,
        decidedAt: args.decision.decidedAt,
        scope: terminateScope
      },
      ...(terminateRun && terminateScope === "branch" ? [{
        type: "run_terminated",
        eventId: `run_terminated:${args.review.reviewId}`,
        at: args.decision.decidedAt,
        reason: "loop_budget_branch_terminate",
        reviewId: args.review.reviewId,
        branchId: args.review.branchId
      } as RunTerminationTransitionEvent] : [])]
    };
  }
  const targetRoleId = args.decision.targetRoleId;
  const routedEvent = decision === "reject"
    ? "REJECTED"
    : decision === "rework"
      ? "NEEDS_REWORK"
      : args.review.selectedEvent;
  const allowedTargets = getLoopBudgetTargetRoleIds(loopBudget, decision);
  if (!targetRoleId || !allowedTargets.includes(targetRoleId)) {
    throw new Error(`[GRAPH_LOOP_BUDGET_TARGET_INVALID] Decision ${decision} must select a declared target for review ${args.review.reviewId}`);
  }
  const additionalBudget = args.decision.additionalBudget ?? 0;
  if (decision === "reject" && additionalBudget !== 0) {
    throw new Error(`[GRAPH_LOOP_BUDGET_AUTHORIZATION_INVALID] Reject decisions cannot grant additional rounds`);
  }
  if (decision !== "reject" && (!Number.isInteger(additionalBudget) || additionalBudget <= 0 || additionalBudget > loopBudget.maxAdditionalRounds)) {
    throw new Error(`[GRAPH_LOOP_BUDGET_AUTHORIZATION_INVALID] Decision ${decision} must grant 1..${loopBudget.maxAdditionalRounds} additional rounds`);
  }
  const authorizedState: GraphState = additionalBudget > 0
    ? {
        ...args.state,
        loopBudgetAuthorizationsByScope: {
          ...(args.state.loopBudgetAuthorizationsByScope ?? {}),
          [buildLoopScopeKey(args.review.lineageId, loopBudget.loopId)]:
            (args.state.loopBudgetAuthorizationsByScope?.[buildLoopScopeKey(args.review.lineageId, loopBudget.loopId)] ?? 0) + additionalBudget
        }
      }
    : args.state;
  const node = getExecutionPlanNode(args.plan, args.review.roleId);
  const transition = buildRoutedTransitionPlan({
    runId: args.runId,
    state: authorizedState,
    plan: args.plan,
    contractPlan: args.contractPlan,
    node,
    roleId: args.review.roleId,
    currentBranch: args.state.branchRecords[args.review.branchId] ?? {
      branchId: args.review.branchId,
      roleId: args.review.roleId,
      loopIteration: args.review.loopIteration,
      branchSequence: 0,
      lineageId: args.review.lineageId,
      sessionLineageId: args.review.branchId,
      status: "waiting_review"
    } as BranchRecord,
    audit: {
      at: args.decision.decidedAt,
      roleId: args.review.roleId,
      branchId: args.review.branchId,
      lineageId: args.review.lineageId,
      loopIteration: args.review.loopIteration,
      exitCode: 0,
      durationMs: 0,
      status: "ok",
      selectedEvent: routedEvent,
      executionId: args.review.executionId
    },
    currentResult: args.review.draftResult,
    selectedEvent: routedEvent,
    candidateTargets: [targetRoleId],
    eventByTargetRoleId: new Map([[targetRoleId, routedEvent]]),
    logger: args.logger,
    terminalOutput: args.review.draftResult.content ?? "",
    loopBudgetFailureMode: "fail_run",
    allowOrphanedJoinFailure: false,
    indexes: args.indexes
  });
  if (!transition) throw new Error(`[GRAPH_LOOP_BUDGET_TRANSITION_ABORTED] Could not activate ${targetRoleId}`);
  const authorizationKey = buildLoopScopeKey(args.review.lineageId, loopBudget.loopId);
  const authorizationDeltas = {
    ...(transition.update.loopBudgetAuthorizationDeltasByScope ?? {})
  };
  if (additionalBudget > 0) {
    authorizationDeltas[authorizationKey] = (authorizationDeltas[authorizationKey] ?? 0) + additionalBudget;
  }
  transition.update = {
    ...transition.update,
    loopBudgetAuthorizationsByScope: {
      ...(authorizedState.loopBudgetAuthorizationsByScope ?? {}),
      ...(transition.update.loopBudgetAuthorizationsByScope ?? {})
    },
    ...(Object.keys(authorizationDeltas).length
      ? { loopBudgetAuthorizationDeltasByScope: authorizationDeltas }
      : {}),
    pendingReviewsById: {
      ...(transition.update.pendingReviewsById ?? {}),
      [args.review.reviewId]: { ...args.review, status: "resolved" }
    },
    reviewHistoryByBranchId: buildReviewHistoryUpdate({ state: args.state, review: args.review, decision: args.decision }),
    // The routed transition decrements one authorized round when it activates the target.
  };
  transition.events = [
    ...transition.events,
    {
      type: "loop_budget_decision",
      eventId: `loop_budget_decision:${args.review.reviewId}:${args.decision.decidedAt}`,
      at: args.decision.decidedAt,
      loopId: loopBudget.loopId,
      roleId: args.review.roleId,
      lineageId: args.review.lineageId,
      loopIteration: args.review.loopIteration,
      maxRounds: loopBudget.maxRounds,
      reviewId: args.review.reviewId,
      decision,
      ...(targetRoleId ? { targetRoleId } : {}),
      ...(additionalBudget > 0 ? { additionalBudget } : {})
    },
    {
        type: decision === "reject"
        ? RUNTIME_EVENT_HUMAN_REVIEW_REJECTED
        : decision === "rework"
          ? "human_review_rework_requested"
          : "human_review_approved",
      at: args.decision.decidedAt,
      roleId: args.review.roleId,
      branchId: args.review.branchId,
      lineageId: args.review.lineageId,
      loopIteration: args.review.loopIteration,
      reviewId: args.review.reviewId,
      decidedAt: args.decision.decidedAt,
      ...(decision === "rework" || decision === "reject" ? { targetRoleId } : {})
    } as HumanReviewTransitionEvent
  ];
  return transition;
}

export function planHumanReviewDecisionTransition(args: ReviewDecisionTransitionInput): TransitionPlan {
  if (!Number.isInteger(args.decision.round) || !args.decision.lineageId || !args.decision.branchId || !Number.isInteger(args.decision.loopIteration) || !Number.isInteger(args.decision.stateVersion)) {
    throw new Error(`[GRAPH_REVIEW_BINDING_MISSING] Human review ${args.review.reviewId} decision must include round, lineageId, branchId, loopIteration, and stateVersion`);
  }
  if (args.decision.lineageId !== args.review.lineageId) {
    throw new Error(`[GRAPH_REVIEW_LINEAGE_MISMATCH] Human review ${args.review.reviewId} decision lineage does not match the pending review`);
  }
  if (args.decision.branchId !== args.review.branchId) {
    throw new Error(`[GRAPH_REVIEW_BRANCH_MISMATCH] Human review ${args.review.reviewId} decision branch does not match the pending review`);
  }
  if (args.decision.round !== args.review.round) {
    throw new Error(`[GRAPH_REVIEW_ROUND_MISMATCH] Human review ${args.review.reviewId} decision round does not match the pending review`);
  }
  if (args.decision.loopIteration !== args.review.loopIteration) {
    throw new Error(`[GRAPH_REVIEW_LOOP_MISMATCH] Human review ${args.review.reviewId} decision loop iteration does not match the pending review`);
  }
  if (args.decision.stateVersion !== args.state.stateVersion) {
    throw new Error(`[GRAPH_REVIEW_STATE_VERSION_STALE] Human review ${args.review.reviewId} decision state version ${args.decision.stateVersion} is stale for current version ${args.state.stateVersion}`);
  }
  if (args.review.stateVersion !== undefined && args.review.stateVersion !== args.state.stateVersion) {
    throw new Error(`[GRAPH_REVIEW_STATE_VERSION_STALE] Human review ${args.review.reviewId} is bound to state version ${args.review.stateVersion}, current version is ${args.state.stateVersion}`);
  }
  if (args.review.irDigest && args.plan.semanticIR && args.review.irDigest !== semanticIRDigest(args.plan.semanticIR)) {
    throw new Error(`Human review ${args.review.reviewId} Semantic IR digest mismatch`);
  }
  if (args.review.kind === "loop_budget") {
    return buildLoopBudgetDecisionTransition(args);
  }
  const node = getExecutionPlanNode(args.plan, args.review.roleId);
  const rolePackage = args.rolePackagesByRoleId.get(args.review.roleId);
  if (!rolePackage) throw new Error(`[IR_CONTRACT_INVALID] Role Contract is missing for review role ${args.review.roleId}`);
  if (!rolePackage.manifest.authority.controlActions.includes(args.decision.decision as "approve" | "rework" | "pause" | "terminate")) {
    throw new Error(`[IR_CONTRACT_INVALID] Role ${args.review.roleId} does not authorize human review action ${args.decision.decision}`);
  }
  if (args.decision.decision === "approve") {
    return buildApprovedHumanReviewTransition({
      runId: args.runId,
      state: args.state,
      plan: args.plan,
      contractPlan: args.contractPlan,
      node,
      review: args.review,
      decision: args.decision,
      logger: args.logger,
      indexes: args.indexes
    });
  }

  if (args.decision.decision === "pause") {
    return {
      update: {
        pendingReviewsById: {
          [args.review.reviewId]: {
            ...args.review,
            status: "paused",
            // The pause decision itself is a legitimate state transition. Bind a later decision
            // on this same review to the post-checkpoint version, not the pre-pause snapshot.
            stateVersion: args.state.stateVersion + 1
          }
        },
        reviewHistoryByBranchId: buildReviewHistoryUpdate({
          state: args.state,
          review: args.review,
          decision: args.decision
        }),
        lastWaitingReviewId: args.review.reviewId,
        lastExecutedRoleId: args.review.roleId
      },
      events: args.decision.timedOut
        ? [{
            type: "human_review_expired",
            at: args.decision.decidedAt,
            roleId: args.review.roleId,
            branchId: args.review.branchId,
            lineageId: args.review.lineageId,
            loopIteration: args.review.loopIteration,
            reviewId: args.review.reviewId,
            decidedAt: args.decision.decidedAt,
            expiredAt: args.decision.expiredAt ?? args.decision.decidedAt,
            timedOut: true,
            action: "pause"
          }]
        : [{
            type: "human_review_paused",
            at: args.decision.decidedAt,
            roleId: args.review.roleId,
            branchId: args.review.branchId,
            lineageId: args.review.lineageId,
            loopIteration: args.review.loopIteration,
            reviewId: args.review.reviewId,
            decidedAt: args.decision.decidedAt
          }]
    };
  }

  if (args.decision.decision === "terminate") {
    return {
      update: {
        status: args.decision.scope === "run" ? "stopped" : undefined,
        error: args.decision.scope === "run" ? "human_review_terminate_run" : "",
        pendingReviewsById: {
          [args.review.reviewId]: {
            ...args.review,
            status: args.decision.timedOut ? "expired" : "resolved"
          }
        },
        reviewHistoryByBranchId: buildReviewHistoryUpdate({
          state: args.state,
          review: args.review,
          decision: args.decision
        }),
        branchRecords: {
          [args.review.branchId]: completeBranch({
            branchId: args.review.branchId,
            roleId: args.review.roleId,
            loopIteration: args.review.loopIteration,
            branchSequence: args.state.branchRecords[args.review.branchId]?.branchSequence ?? 0,
            lineageId: args.review.lineageId,
            sessionLineageId:
              args.state.branchRecords[args.review.branchId]?.sessionLineageId ?? args.review.branchId,
            parentBranchId: args.state.branchRecords[args.review.branchId]?.parentBranchId,
            activatedByRoleId: args.state.branchRecords[args.review.branchId]?.activatedByRoleId,
            activatedByEvent: args.state.branchRecords[args.review.branchId]?.activatedByEvent
          })
        },
        lastExecutedRoleId: args.review.roleId
      },
      events: args.decision.timedOut
        ? [{
            type: "human_review_expired",
            at: args.decision.decidedAt,
            roleId: args.review.roleId,
            branchId: args.review.branchId,
            lineageId: args.review.lineageId,
            loopIteration: args.review.loopIteration,
            reviewId: args.review.reviewId,
            decidedAt: args.decision.decidedAt,
            expiredAt: args.decision.expiredAt ?? args.decision.decidedAt,
            timedOut: true,
            action: "terminate",
            scope: args.decision.scope ?? args.review.spec.terminateScope
          }]
        : [{
            type: "human_review_terminated",
            at: args.decision.decidedAt,
            roleId: args.review.roleId,
            branchId: args.review.branchId,
            lineageId: args.review.lineageId,
            loopIteration: args.review.loopIteration,
            reviewId: args.review.reviewId,
            decidedAt: args.decision.decidedAt,
            scope: args.decision.scope ?? args.review.spec.terminateScope
          }]
    };
  }

  const targetRoleId = args.review.spec.reworkTargetRoleId;
  const nextLoopIteration = getTargetLoopIteration({
    targetRoleId,
    currentLoopIteration: args.review.loopIteration,
    state: args.state,
    plan: args.plan,
    lineageId: args.review.lineageId
  });
  const targetNode = getExecutionPlanNode(args.plan, targetRoleId);
  const currentBranch = args.state.branchRecords[args.review.branchId];
  const sessionLineageId = currentBranch
    ? resolveNextSessionLineageId({
        currentNode: node,
        targetNode,
        currentBranch,
        targetRoleId,
        nextLoopIteration,
        nextBranchSequence: args.state.nextBranchSequence,
        activatedTargetCount: 1
      })
    : buildBranchId(targetRoleId, nextLoopIteration, args.state.nextBranchSequence);
  const reworkBranch = activateBranch({
    roleId: targetRoleId,
    loopIteration: nextLoopIteration,
    branchSequence: args.state.nextBranchSequence,
    lineageId: args.review.lineageId,
    sessionLineageId,
    parentBranchId: args.review.branchId,
    activatedByRoleId: args.review.roleId,
    activatedByEvent: "NEEDS_REWORK"
  });
  return {
    update: {
      transitionCount: 1,
      pendingReviewsById: {
        [args.review.reviewId]: {
          ...args.review,
          status: "resolved"
        }
      },
      reviewHistoryByBranchId: buildReviewHistoryUpdate({
        state: args.state,
        review: args.review,
        decision: args.decision
      }),
      humanReviewContextByBranchId: {
        [reworkBranch.branchId]: {
          reviewId: args.review.reviewId,
          branchId: args.review.branchId,
          round: args.review.round,
          comment: args.decision.comment,
          previousOutput: args.review.draftResult
        }
      },
      branchRecords: {
        [args.review.branchId]: completeBranch({
          branchId: args.review.branchId,
          roleId: args.review.roleId,
          loopIteration: args.review.loopIteration,
          branchSequence: args.state.branchRecords[args.review.branchId]?.branchSequence ?? 0,
          lineageId: args.review.lineageId,
          sessionLineageId:
            args.state.branchRecords[args.review.branchId]?.sessionLineageId ?? args.review.branchId,
          parentBranchId: args.state.branchRecords[args.review.branchId]?.parentBranchId,
          activatedByRoleId: args.state.branchRecords[args.review.branchId]?.activatedByRoleId,
          activatedByEvent: args.state.branchRecords[args.review.branchId]?.activatedByEvent
        }),
        [reworkBranch.branchId]: reworkBranch
      },
      loopIterations: {
        [targetRoleId]: nextLoopIteration
      },
      ...(getLoopScopeForRole(args.plan, targetRoleId)?.boundaryRoleId === targetRoleId
        ? {
            loopCountersByScope: {
              [buildLoopScopeKey(
                args.review.lineageId,
                getLoopScopeForRole(args.plan, targetRoleId)!.loopId
              )]: nextLoopIteration
            }
          }
        : {}),
      nextBranchSequence: args.state.nextBranchSequence + 1,
      lastExecutedRoleId: args.review.roleId
    },
    events: [
      {
        type: "human_review_rework_requested",
        at: args.decision.decidedAt,
        roleId: args.review.roleId,
        branchId: args.review.branchId,
        lineageId: args.review.lineageId,
        loopIteration: args.review.loopIteration,
        reviewId: args.review.reviewId,
        decidedAt: args.decision.decidedAt,
        targetRoleId
      }
    ]
  };
}

function buildJoinSourceOutcomeUpdates(args: {
  state: GraphState;
  plan: ExecutionPlan;
  roleId: string;
  lineageId: string;
  loopIteration: number;
  candidateTargets: string[];
  failure?: boolean;
}): NonNullable<GraphState["joinSourceOutcomesByScope"]> {
  const updates: NonNullable<GraphState["joinSourceOutcomesByScope"]> = {};
  for (const node of args.plan.nodesByRoleId.values()) {
    if (!node.joinMode || !node.joinSources.includes(args.roleId) || !node.incoming.some((flow) => flow.fromRoleId === args.roleId)) continue;
    const targetLoopIteration = getTargetLoopIteration({
      targetRoleId: node.roleId,
      currentLoopIteration: args.loopIteration,
      state: args.state,
      plan: args.plan,
      lineageId: args.lineageId
    });
    const key = JSON.stringify([node.roleId, args.lineageId, targetLoopIteration]);
    const previous = args.state.joinSourceOutcomesByScope?.[key] ?? {};
    const nextStatus = args.failure
      ? "failed"
      : args.candidateTargets.includes(node.roleId) ? "arrived" : "skipped";
    updates[key] = {
      ...previous,
      [args.roleId]: mergeJoinSourceStatus(previous[args.roleId], nextStatus)
    };
  }
  return updates;
}

function mergeJoinScopeOutcomeUpdates(args: {
  state: GraphState;
  updates: NonNullable<GraphState["joinSourceOutcomesByScope"]>;
}): NonNullable<GraphState["joinScopes"]> {
  const updates: NonNullable<GraphState["joinScopes"]> = {};
  for (const [scopeKey, outcomes] of Object.entries(args.updates)) {
    const scope = args.state.joinScopes?.[scopeKey];
    if (!scope || scope.status !== "waiting") continue;
    const sourceStatusByRoleId = { ...(scope.sourceStatusByRoleId ?? {}) };
    for (const [roleId, status] of Object.entries(outcomes)) {
      sourceStatusByRoleId[roleId] = mergeJoinSourceStatus(sourceStatusByRoleId[roleId], status);
    }
    const readySourceRoleIds = scope.expectedSourceRoleIds.filter((roleId) => sourceStatusByRoleId[roleId] === "arrived");
    updates[scopeKey] = {
      ...scope,
      sourceStatusByRoleId,
      readySourceRoleIds,
      missingSourceRoleIds: scope.expectedSourceRoleIds.filter((roleId) => sourceStatusByRoleId[roleId] !== "arrived")
    };
  }
  return updates;
}

function buildArtifactAllowedIdsForActivation(args: {
  state: GraphState;
  targetNode: ExecutionPlanNode;
  targetLoopIteration: number;
  currentRoleId: string;
  currentResult?: StoredRoleResult;
  currentBranch: BranchRecord;
  readiness?: { completedSourceRoleIds: string[] };
  indexes?: RuntimeIndexes;
}): string[] {
  // Freeze the invocation allow-set from the results that are actually present
  // at activation time. Indexes can lag a parallel branch merge by one
  // scheduler step, so use the persisted state as the authoritative fallback
  // and always include the current result explicitly. This preserves the
  // quorum boundary while preventing a valid source artifact from being lost
  // merely because its index was not refreshed yet.
  const results = args.targetNode.joinMode
    ? (args.readiness?.completedSourceRoleIds ?? []).map((sourceRoleId) => {
        if (sourceRoleId === args.currentRoleId && args.currentResult) return args.currentResult;
        const indexed = findRoleResult({
          state: args.state,
          roleId: sourceRoleId,
          lineageId: args.currentBranch.lineageId,
          loopIteration: args.targetLoopIteration,
          indexes: args.indexes
        });
        if (indexed) return indexed;
        return Object.values(args.state.roleResults ?? {}).find((result) =>
          result.roleId === sourceRoleId &&
          result.lineageId === args.currentBranch.lineageId &&
          result.loopIteration === args.targetLoopIteration
        );
      })
    : [args.currentResult];
  return Array.from(new Set(results.flatMap((result) => result?.artifactRef?.artifactId ? [result.artifactRef.artifactId] : [])));
}

function buildRoutedTransitionPlan(args: {
  runId?: string;
  state: GraphState;
  plan: ExecutionPlan;
  contractPlan?: FlowContractPlan;
  node: ExecutionPlanNode;
  roleId: string;
  currentBranch: BranchRecord;
  audit: AuditRecord;
  currentResult?: StoredRoleResult;
  selectedEvent?: string;
  candidateTargets: string[];
  eventByTargetRoleId: Map<string, string | undefined>;
  logger: RunConsoleLogger;
  terminalOutput: string;
  extraEvents?: RuntimeTransitionEvent[];
  loopBudgetFailureMode: "fail_run" | "abort_routing";
  budgetAuthorizationRollbackKeys?: string[];
  allowOrphanedJoinFailure: boolean;
  indexes?: RuntimeIndexes;
}): TransitionPlan | undefined {
  const branchUpdates: Record<string, BranchRecord> = {
    [args.currentBranch.branchId]: completeBranch(args.currentBranch)
  };
  const loopUpdates: Record<string, number> = {
    [args.roleId]: args.currentBranch.loopIteration
  };
  const loopScopeUpdates: Record<string, number> = {};
  const loopBudgetAuthorizationUpdates: Record<string, number> = {};
  const loopBudgetAuthorizationDeltasByScope: Record<string, number> = {};
  const roleActivationUpdates: Record<string, number> = {};
  const joinEvents: RuntimeTransitionEvent[] = [];
  const joinScopeUpdates: NonNullable<GraphState["joinScopes"]> = {};
  const artifactAllowedByBranchId: Record<string, string[]> = {};
  const joinSourceOutcomeUpdates = buildJoinSourceOutcomeUpdates({
    state: args.state,
    plan: args.plan,
    roleId: args.roleId,
    lineageId: args.currentBranch.lineageId,
    loopIteration: args.currentBranch.loopIteration,
    candidateTargets: args.candidateTargets
  });
  Object.assign(joinScopeUpdates, mergeJoinScopeOutcomeUpdates({ state: args.state, updates: joinSourceOutcomeUpdates }));
  let nextBranchSequence = args.state.nextBranchSequence;
  let finalStatus: GraphRunStatus = "running";
  let finalError = "";
  let finalOutputsByRoleId: FinalOutputsByRoleId = {};
  let finalOutputRoleOrder: string[] = [];
  let finalRoleIds: string[] = [];
  let finalErrorEnvelope: RuntimeErrorEnvelope | undefined;
  let reachedSystemOutput = false;

  for (const key of args.budgetAuthorizationRollbackKeys ?? []) {
    loopBudgetAuthorizationDeltasByScope[key] = (loopBudgetAuthorizationDeltasByScope[key] ?? 0) + 1;
  }

  for (const candidateTargetRoleId of args.candidateTargets) {
    let targetRoleId = candidateTargetRoleId;
    const targetEvent = args.eventByTargetRoleId.get(targetRoleId) ?? args.selectedEvent;

    if (targetRoleId === SYSTEM_END_ROLE_ID) {
      reachedSystemOutput = true;
      args.logger.transition({
        fromRoleId: args.roleId,
        event: targetEvent,
        toRoleId: "output",
        branchId: args.currentBranch.branchId
      });
      continue;
    }

    const exceededBudget = findExceededLoopBudget({
      targetRoleId,
      currentLoopIteration: args.currentBranch.loopIteration,
      state: args.state,
      plan: args.plan,
      lineageId: args.currentBranch.lineageId
    });
    if (exceededBudget) {
      if (args.loopBudgetFailureMode === "abort_routing") {
        return undefined;
      }
      const rejectTargetRoleIds = selectRoutingTargets({
        node: args.node,
        selectedEvent: "REJECTED",
        mode: "ok"
      });
      const reworkTargetRoleIds = selectRoutingTargets({
        node: args.node,
        selectedEvent: "NEEDS_REWORK",
        mode: "ok"
      });
      return buildLoopBudgetReviewPendingTransition({
        runId: args.runId,
        state: args.state,
        plan: args.plan,
        roleId: args.roleId,
        branch: args.currentBranch,
        audit: args.audit,
        executionId: args.audit.executionId ?? `loop-exhausted:${args.currentBranch.branchId}`,
        selectedEvent: targetEvent,
        result: args.currentResult ?? {
          roleId: args.roleId,
          branchId: args.currentBranch.branchId,
          lineageId: args.currentBranch.lineageId,
          loopIteration: args.currentBranch.loopIteration,
          content: args.terminalOutput
        },
        loopId: exceededBudget.loopId,
        maxRounds: exceededBudget.maxRounds,
        onExhausted: exceededBudget.kind === "scope"
          ? getLoopScopeForRole(args.plan, targetRoleId)?.onExhausted
          : undefined,
        targetRoleIds: args.candidateTargets,
        reworkTargetRoleIds,
        rejectTargetRoleIds
      });
    }

    if (targetRoleId === SYSTEM_END_ROLE_ID) {
      reachedSystemOutput = true;
      args.logger.transition({
        fromRoleId: args.roleId,
        event: targetEvent,
        toRoleId: "output",
        branchId: args.currentBranch.branchId
      });
      continue;
    }

    const nextLoopIteration = getTargetLoopIteration({
      targetRoleId,
      currentLoopIteration: args.currentBranch.loopIteration,
      state: args.state,
      plan: args.plan,
      lineageId: args.currentBranch.lineageId
    });
    const targetNode = getExecutionPlanNode(args.plan, targetRoleId);
    const budgetBindings = getLoopBudgetBindings({
      targetRoleId,
      currentLoopIteration: args.currentBranch.loopIteration,
      state: args.state,
      plan: args.plan,
      lineageId: args.currentBranch.lineageId
    });
    const consumeLoopBudgetAuthorization = () => {
      const consumedKeys: string[] = [];
      for (const binding of budgetBindings) {
        if (!binding.key || binding.grant <= 0 || binding.nextIteration <= binding.maxRounds) continue;
        const remainingBudget = loopBudgetAuthorizationUpdates[binding.key]
          ?? args.state.loopBudgetAuthorizationsByScope?.[binding.key]
          ?? 0;
        if (remainingBudget <= 0) continue;
        loopBudgetAuthorizationUpdates[binding.key] = remainingBudget - 1;
        loopBudgetAuthorizationDeltasByScope[binding.key] =
          (loopBudgetAuthorizationDeltasByScope[binding.key] ?? 0) - 1;
        consumedKeys.push(binding.key);
      }
      return consumedKeys;
    };
    loopUpdates[targetRoleId] = nextLoopIteration;
    const loopScope = getLoopScopeForRole(args.plan, targetRoleId);
    if (loopScope && targetRoleId === loopScope.boundaryRoleId) {
      loopScopeUpdates[buildLoopScopeKey(args.currentBranch.lineageId, loopScope.loopId)] = nextLoopIteration;
    }
    if (targetNode.joinMode) {
      const readiness = evaluateJoinNodeReadiness({
        node: targetNode,
        currentBranch: args.currentBranch,
        state: args.state,
        currentResult: args.currentResult,
        indexes: args.indexes
      });
      const joinId = buildJoinId(targetRoleId, nextLoopIteration, args.currentBranch.lineageId);
      const existingJoinBranch = findActivatedJoinBranch({
        state: args.state,
        roleId: targetRoleId,
        lineageId: args.currentBranch.lineageId,
        loopIteration: nextLoopIteration
      });

      if (readiness.ready && existingJoinBranch) {
        joinEvents.push({
          type: "join_late_arrival_ignored",
          at: new Date().toISOString(),
          roleId: targetRoleId,
          joinId,
          lineageId: args.currentBranch.lineageId,
          loopIteration: nextLoopIteration,
          joinMode: targetNode.joinMode,
          joinMin: targetNode.joinMin,
          joinSources: targetNode.joinSources,
          requiredSourceCount: readiness.requiredSourceCount,
          satisfiedSources: readiness.completedSourceRoleIds,
          arrivedFromRoleId: args.roleId,
          arrivedFromBranchId: args.currentBranch.branchId,
          activatedBranchId: existingJoinBranch.branchId,
          reason: "already_activated"
        });
        continue;
      }

      if (!readiness.ready) {
        const scopeKey = JSON.stringify([targetRoleId, args.currentBranch.lineageId, nextLoopIteration]);
        const existingScope = args.state.joinScopes?.[scopeKey];
        const now = new Date().toISOString();
        const joinSpec = args.plan.semanticIR?.joins.find((item) => item.roleId === targetRoleId);
        joinScopeUpdates[scopeKey] = {
          joinId, runId: args.runId ?? "", joinRoleId: targetRoleId, lineageId: args.currentBranch.lineageId,
          loopIteration: nextLoopIteration, joinMode: targetNode.joinMode, joinMin: targetNode.joinMin,
          expectedSourceRoleIds: targetNode.joinSources,
          readySourceRoleIds: readiness.completedSourceRoleIds, missingSourceRoleIds: readiness.missingSourceRoleIds,
          sourceStatusByRoleId: readiness.sourceStatusByRoleId,
          startedAt: existingScope?.startedAt ?? now, timeoutSeconds: joinSpec?.timeoutSeconds ?? 3600,
          status: "waiting", timeoutAction: joinSpec?.onTimeout, failurePolicy: joinSpec?.failurePolicy
        };
        args.logger.joinWait({
          roleId: targetRoleId,
          arrivedFrom: args.roleId,
          waitingFor: listPendingJoinSources({
            node: targetNode,
            currentBranch: args.currentBranch,
            state: args.state,
            currentResult: args.currentResult,
            indexes: args.indexes
          })
        });
        continue;
      }

      const activationKey = buildRoleActivationScopeKey(args.currentBranch.lineageId, targetRoleId);
      const activationLimit = Math.min(
        args.plan.semanticIR?.capabilities.maxRoleActivationsByRoleId?.[targetRoleId] ?? Number.POSITIVE_INFINITY,
        loopScope?.maxRoleActivationsByRoleId?.[targetRoleId] ?? Number.POSITIVE_INFINITY
      );
      const activationCount = (args.state.roleActivationsByScope?.[activationKey] ?? 0) + 1;
      if (activationCount > activationLimit) {
        finalStatus = "failed";
        finalError = `Role activation budget exceeded for ${targetRoleId}: ${activationCount} > ${activationLimit}`;
        finalErrorEnvelope = {
          errorCode: "GRAPH_ROLE_ACTIVATION_BUDGET_EXCEEDED",
          errorCategory: "state",
          message: finalError,
          retryable: false,
          stage: "execute",
          roleId: targetRoleId,
          branchId: args.currentBranch.branchId
        };
        finalRoleIds = [targetRoleId];
        break;
      }
      roleActivationUpdates[activationKey] = activationCount;
      const consumedBudgetKeys = consumeLoopBudgetAuthorization();

      const sessionLineageId = resolveNextSessionLineageId({
        currentNode: args.node,
        targetNode,
        currentBranch: args.currentBranch,
        targetRoleId,
        nextLoopIteration,
        nextBranchSequence,
        activatedTargetCount: args.candidateTargets.length
      });
      const branch = activateBranch({
        roleId: targetRoleId,
        loopIteration: nextLoopIteration,
        branchSequence: nextBranchSequence,
        lineageId: args.currentBranch.lineageId,
        sessionLineageId,
        parentBranchId: args.currentBranch.branchId,
        activatedByRoleId: args.roleId,
        activatedByEvent: targetEvent
      });
      nextBranchSequence += 1;
      branchUpdates[branch.branchId] = consumedBudgetKeys.length
        ? { ...branch, consumedLoopBudgetKeys: consumedBudgetKeys }
        : branch;
      artifactAllowedByBranchId[branch.branchId] = buildArtifactAllowedIdsForActivation({
        state: args.state,
        targetNode,
        targetLoopIteration: nextLoopIteration,
        currentRoleId: args.roleId,
        currentResult: args.currentResult,
        currentBranch: args.currentBranch,
        readiness,
        indexes: args.indexes
      });
      const scopeKey = JSON.stringify([targetRoleId, args.currentBranch.lineageId, nextLoopIteration]);
      const existingScope = args.state.joinScopes?.[scopeKey];
      if (existingScope) {
        joinScopeUpdates[scopeKey] = {
          ...existingScope,
          readySourceRoleIds: readiness.completedSourceRoleIds,
          missingSourceRoleIds: readiness.missingSourceRoleIds,
          sourceStatusByRoleId: readiness.sourceStatusByRoleId,
          status: "activated",
          completedAt: new Date().toISOString()
        };
      }

      if (targetNode.joinMode === "quorum_of") {
        joinEvents.push({
          type: "join_quorum_reached",
          at: new Date().toISOString(),
          roleId: targetRoleId,
          joinId,
          lineageId: args.currentBranch.lineageId,
          loopIteration: nextLoopIteration,
          joinMode: targetNode.joinMode,
          joinMin: targetNode.joinMin,
          joinSources: targetNode.joinSources,
          requiredSourceCount: readiness.requiredSourceCount,
          satisfiedSources: readiness.completedSourceRoleIds,
          arrivedFromRoleId: args.roleId,
          arrivedFromBranchId: args.currentBranch.branchId,
          activatedBranchId: branch.branchId
        });
      }
      joinEvents.push({
        type: "join_activated",
        at: new Date().toISOString(),
        roleId: targetRoleId,
        joinId,
        lineageId: args.currentBranch.lineageId,
        loopIteration: nextLoopIteration,
        joinMode: targetNode.joinMode,
        joinMin: targetNode.joinMin,
        joinSources: targetNode.joinSources,
        requiredSourceCount: readiness.requiredSourceCount,
        satisfiedSources: readiness.completedSourceRoleIds,
        arrivedFromRoleId: args.roleId,
        arrivedFromBranchId: args.currentBranch.branchId,
        activatedBranchId: branch.branchId
      });
      args.logger.transition({
        fromRoleId: args.roleId,
        event: targetEvent,
        toRoleId: targetRoleId,
        branchId: args.currentBranch.branchId
      });
      continue;
    }

    const activationKey = buildRoleActivationScopeKey(args.currentBranch.lineageId, targetRoleId);
    const activationLimit = Math.min(
      args.plan.semanticIR?.capabilities.maxRoleActivationsByRoleId?.[targetRoleId] ?? Number.POSITIVE_INFINITY,
      loopScope?.maxRoleActivationsByRoleId?.[targetRoleId] ?? Number.POSITIVE_INFINITY
    );
    const activationCount = (args.state.roleActivationsByScope?.[activationKey] ?? 0) + 1;
    if (activationCount > activationLimit) {
      finalStatus = "failed";
      finalError = `Role activation budget exceeded for ${targetRoleId}: ${activationCount} > ${activationLimit}`;
      finalErrorEnvelope = {
        errorCode: "GRAPH_ROLE_ACTIVATION_BUDGET_EXCEEDED",
        errorCategory: "state",
        message: finalError,
        retryable: false,
        stage: "execute",
        roleId: targetRoleId,
        branchId: args.currentBranch.branchId
      };
      finalRoleIds = [targetRoleId];
      break;
    }
    roleActivationUpdates[activationKey] = activationCount;
    const consumedBudgetKeys = consumeLoopBudgetAuthorization();

    const sessionLineageId = resolveNextSessionLineageId({
      currentNode: args.node,
      targetNode,
      currentBranch: args.currentBranch,
      targetRoleId,
      nextLoopIteration,
      nextBranchSequence,
      activatedTargetCount: args.candidateTargets.length
    });
    const branch = activateBranch({
      roleId: targetRoleId,
      loopIteration: nextLoopIteration,
      branchSequence: nextBranchSequence,
      lineageId: args.currentBranch.lineageId,
      sessionLineageId,
      parentBranchId: args.currentBranch.branchId,
      activatedByRoleId: args.roleId,
      activatedByEvent: targetEvent
    });
    nextBranchSequence += 1;
    branchUpdates[branch.branchId] = consumedBudgetKeys.length
      ? { ...branch, consumedLoopBudgetKeys: consumedBudgetKeys }
      : branch;
    artifactAllowedByBranchId[branch.branchId] = buildArtifactAllowedIdsForActivation({
      state: args.state,
      targetNode,
      targetLoopIteration: nextLoopIteration,
      currentRoleId: args.roleId,
      currentResult: args.currentResult,
      currentBranch: args.currentBranch,
      indexes: args.indexes
    });
    args.logger.transition({
      fromRoleId: args.roleId,
      event: targetEvent,
      toRoleId: targetRoleId,
      branchId: args.currentBranch.branchId
    });
  }

  if ((reachedSystemOutput || (args.node.isTerminal && args.candidateTargets.length === 0)) && finalStatus !== "failed") {
    finalOutputsByRoleId = collectEndOutputs({
      state: args.state,
      plan: args.plan,
      branchUpdates,
      currentBranch: args.currentBranch,
      currentResult: args.currentResult,
      selectedEvent: args.selectedEvent
    });
    finalOutputRoleOrder = args.plan.terminalRoleOrder.filter((roleId) => finalOutputsByRoleId[roleId]);
    finalRoleIds = finalOutputRoleOrder;
    const aggregation = resolveEndAggregation({ state: args.state, plan: args.plan, branchUpdates, outputs: finalOutputsByRoleId });
    Object.assign(branchUpdates, aggregation.branches);
    if (aggregation.status === "failed") {
      finalStatus = "failed";
      finalError = aggregation.error ?? "End aggregation could not reach its required terminal sources.";
      finalErrorEnvelope = { errorCode: "GRAPH_END_QUORUM_UNREACHABLE", errorCategory: "state", message: finalError, retryable: false, stage: "execute", roleId: args.roleId, branchId: args.currentBranch.branchId };
    } else if (aggregation.status === "done") {
      const hasActiveBranches = Object.values({ ...args.state.branchRecords, ...branchUpdates }).some((branch) => branch.status === "active");
      if (!hasActiveBranches) {
      const orphanedJoinGroup = args.allowOrphanedJoinFailure
        ? findOrphanedJoinGroup({
            state: args.state,
            plan: args.plan,
            branchUpdates
          })
        : undefined;
      if (orphanedJoinGroup) {
        finalStatus = "failed";
        finalError = `Join "${orphanedJoinGroup.roleId}" became unreachable in lineage ${orphanedJoinGroup.lineageId}#${orphanedJoinGroup.loopIteration} after transition skip; completed sources ${orphanedJoinGroup.completedSourceRoleIds.join(", ")} cannot reach required ${orphanedJoinGroup.requiredSourceCount}`;
        finalErrorEnvelope = {
          errorCode: "GRAPH_JOIN_UNREACHABLE_AFTER_TRANSITION_SKIP",
          errorCategory: "state",
          message: finalError,
          retryable: false,
          stage: "execute",
          roleId: orphanedJoinGroup.roleId,
          branchId: args.currentBranch.branchId
        };
        finalRoleIds = [orphanedJoinGroup.roleId];
      } else {
        finalStatus = "done";
      }
      }
    }
  }

  return {
    update: {
      status: finalStatus,
      error: finalError,
      errorEnvelope: finalErrorEnvelope,
      transitionCount: 1,
      recentAudits: [args.audit],
      auditSummary: buildAuditSummaryDelta(args.audit),
      roleMetricsByRoleId: buildRoleMetricsDelta(args.audit),
      roleResults: storeRoleResult(args.currentBranch.branchId, args.currentResult),
      branchRecords: branchUpdates,
      loopIterations: loopUpdates,
      loopCountersByScope: loopScopeUpdates,
      loopBudgetAuthorizationsByScope: loopBudgetAuthorizationUpdates,
      ...(Object.keys(loopBudgetAuthorizationDeltasByScope).length
        ? { loopBudgetAuthorizationDeltasByScope }
        : {}),
      roleActivationsByScope: roleActivationUpdates,
      artifactAllowedByBranchId,
      joinScopes: joinScopeUpdates,
      joinSourceOutcomesByScope: joinSourceOutcomeUpdates,
      selectedEventByBranchId: args.selectedEvent
        ? { [args.currentBranch.branchId]: args.selectedEvent }
        : {},
      ...(finalOutputsByRoleId ? { finalOutputsByRoleId } : {}),
      ...(finalStatus === "done" && args.state.resultCommit?.status !== "committed" ? {
        resultCommit: {
          resultId: `result:${args.runId ?? "run"}`,
          status: "committed" as const,
          createdAt: new Date().toISOString(),
          committedAt: new Date().toISOString()
        }
      } : {}),
      ...(finalOutputRoleOrder.length || finalOutputsByRoleId ? { finalOutputRoleOrder } : {}),
      ...(finalRoleIds.length ? { finalRoleIds } : {}),
      lastExecutedRoleId: args.roleId,
      nextBranchSequence
    },
    events: (args.extraEvents ?? []).concat(joinEvents)
  };
}

export function planTransition(args: TransitionPlannerInput): TransitionPlan {
  const node = getExecutionPlanNode(args.plan, args.outcome.roleId);

  if (args.outcome.status === "failed") {
    if (args.errorFlowRoutingEnabled) {
      const matchedFailureEdge = resolveFailureEdge({
        node,
        errorCode: args.outcome.failure.errorCode
      });
      if (matchedFailureEdge) {
        const handledTargetRoleId =
          matchedFailureEdge.toRoleId === SYSTEM_END_ROLE_ID ? "output" : matchedFailureEdge.toRoleId;
        const handledAudit: AuditRecord = {
          ...args.outcome.audit,
          handledByEvent: matchedFailureEdge.eventType,
          handledTargetRoleId
        };
        const handledFailureArtifact = buildHandledFailureArtifact({
          state: args.state,
          roleId: args.outcome.roleId,
          branch: args.outcome.branch,
          handledByEvent: matchedFailureEdge.eventType,
          errorEnvelope: args.outcome.failure,
          error: args.outcome.audit.error,
          failureInputContext: args.outcome.audit.inputContext
        });
        const handledTransition = buildRoutedTransitionPlan({
          runId: args.runId,
          state: args.state,
          plan: args.plan,
          node,
          roleId: args.outcome.roleId,
          currentBranch: args.outcome.branch,
          audit: handledAudit,
          currentResult: handledFailureArtifact,
          selectedEvent: matchedFailureEdge.eventType,
          candidateTargets: [matchedFailureEdge.toRoleId],
          eventByTargetRoleId: new Map([[matchedFailureEdge.toRoleId, matchedFailureEdge.eventType]]),
          logger: args.logger,
          terminalOutput: args.outcome.audit.error ?? "",
          extraEvents: [
            {
              type: "failure_handled",
              at: new Date().toISOString(),
              roleId: args.outcome.roleId,
              branchId: args.outcome.branch.branchId,
              lineageId: args.outcome.branch.lineageId,
              loopIteration: args.outcome.branch.loopIteration,
              errorCode: args.outcome.failure.errorCode,
              handledByEvent: matchedFailureEdge.eventType,
              handledTargetRoleId
            }
          ],
          loopBudgetFailureMode: "abort_routing",
          ...(args.outcome.failure.retryable &&
            (args.outcome.failure.errorCategory === "execution" ||
              args.outcome.failure.errorCategory === "io" ||
              args.outcome.failure.errorCategory === "system")
            ? { budgetAuthorizationRollbackKeys: args.outcome.branch.consumedLoopBudgetKeys }
            : {}),
          allowOrphanedJoinFailure: false,
          indexes: args.indexes
        });
        if (handledTransition) {
          return handledTransition;
        }
      }
    }
    return {
      update: buildFailureUpdate({
        state: args.state,
        plan: args.plan,
        roleId: args.outcome.roleId,
        branch: args.outcome.branch,
        error: args.outcome.error,
        errorEnvelope: args.outcome.failure,
        audit: args.outcome.audit
      }),
      events: []
    };
  }

  if (node.review) {
    return buildHumanReviewPendingTransition({
      state: args.state,
      plan: args.plan,
      roleId: args.outcome.roleId,
      branch: args.outcome.branch,
      audit: args.outcome.audit,
      result: args.outcome.storedResult,
      selectedEvent: args.outcome.selectedEvent,
      executionId: args.outcome.executionId,
      spec: node.review
    });
  }

  let candidateTargets = selectRoutingTargets({
    node,
    selectedEvent: args.outcome.selectedEvent,
    mode: args.outcome.status
  });
  let routeDecisionEvent: RouteDecisionTransitionEvent | undefined;
  // Semantic IR conditions are evaluated after the role output is validated and before any
  // branch activation. This keeps route ambiguity and fail-closed behavior in OGS runtime.
  const selectedEvent = args.outcome.selectedEvent;
  if (args.plan.semanticIR && selectedEvent && node.routingMode !== "parallel_split") {
    const semanticTransitions = args.plan.semanticIR.transitions.filter(
      (transition) => transition.fromRoleId === args.outcome.roleId && transition.eventType === selectedEvent
    );
    if (semanticTransitions.some((transition) => transition.condition)) {
      const conditionContext = {
        state: args.state.businessState ?? {},
        loop: { iteration: args.outcome.branch.loopIteration, lineageId: args.outcome.branch.lineageId },
        event: args.outcome.storedResult?.data ?? args.outcome.storedResult?.content,
        role: { roleId: args.outcome.roleId, mode: "default" }
      };
      let route: ReturnType<typeof selectSemanticRoute>;
      try {
        route = selectSemanticRoute({ transitions: semanticTransitions, eventType: selectedEvent, context: conditionContext });
      } catch (error) {
        const errorCode = error instanceof SemanticRouteSelectionError
          ? error.code
          : "IR_ROUTE_CONDITION_TYPE_INVALID";
        const failedEvent: RouteDecisionTransitionEvent = {
          type: "route_decision",
          status: "failed",
          at: new Date().toISOString(),
          roleId: args.outcome.roleId,
          branchId: args.outcome.branch.branchId,
          lineageId: args.outcome.branch.lineageId,
          loopIteration: args.outcome.branch.loopIteration,
          event: selectedEvent,
          candidates: error instanceof SemanticRouteSelectionError ? error.candidates : [],
          errorCode
        };
        const failure = buildContractValidationFailureTransition({
          roleId: args.outcome.roleId,
          branch: args.outcome.branch,
          audit: args.outcome.audit,
          selectedEvent,
          storedResult: args.outcome.storedResult,
          errorCode,
          message: error instanceof Error ? error.message : String(error)
        });
        return { ...failure, events: [failedEvent] };
      }
      routeDecisionEvent = {
        type: "route_decision",
        status: "selected",
        at: new Date().toISOString(),
        roleId: args.outcome.roleId,
        branchId: args.outcome.branch.branchId,
        lineageId: args.outcome.branch.lineageId,
        loopIteration: args.outcome.branch.loopIteration,
        event: selectedEvent,
        candidates: semanticTransitions.map((transition) => ({
          flowId: transition.flowId,
          priority: transition.priority,
          matched: transition.condition ? evaluateCondition(transition.condition, conditionContext) : true
        })),
        selectedFlowId: route.flowId,
        targetRoleId: route.toRoleId
      };
      candidateTargets = [route.toRoleId];
    }
  }
  const eventByTargetRoleId = new Map<string, string | undefined>();
  const flowContractPayload: Record<string, unknown> = {};
  if (args.outcome.storedResult?.event !== undefined) {
    flowContractPayload.event = args.outcome.storedResult.event;
  }
  if (args.outcome.storedResult?.content !== undefined) {
    flowContractPayload.content = args.outcome.storedResult.content;
  }
  if (args.outcome.storedResult?.data !== undefined) {
    flowContractPayload.data = args.outcome.storedResult.data;
  }

  const skippedTargets = new Set<string>();
  if (args.contractPlan?.handoffMode) {
    const contractValidationFailures: Array<{ errorCode: string; message: string }> = [];

    for (const targetRoleId of candidateTargets) {
      const flow = findOutgoingFlow({
        node,
        targetRoleId,
        selectedEvent: args.outcome.selectedEvent
      });
      eventByTargetRoleId.set(targetRoleId, flow?.eventType ?? args.outcome.selectedEvent);
      if (!flow || targetRoleId === SYSTEM_END_ROLE_ID || isRuntimeOnlyErrorEvent(flow.eventType)) {
        continue;
      }
      const contract =
        node.routingMode === "parallel_split"
          ? getSplitFlowContractByTarget({
              plan: args.contractPlan,
              fromRoleId: args.outcome.roleId,
              toRoleId: targetRoleId
            })
          : getFlowContractByTarget({
              plan: args.contractPlan,
              fromRoleId: args.outcome.roleId,
              toRoleId: targetRoleId,
              eventType: flow.eventType
            });

      if (!contract) {
        if (args.contractPlan.handoffMode === "strict") {
          contractValidationFailures.push({
            errorCode: "CONTRACT_MISSING",
            message: `Missing flow contract for ${args.outcome.roleId} -> ${targetRoleId} (${flow.eventType}) under handoff.mode=strict`
          });
        } else {
          skippedTargets.add(targetRoleId);
        }
      } else {
        const contractError = validateContractAgainstSchema({
          contract,
          data: flowContractPayload,
          subject: "flow"
        });
        if (contractError) {
          if (contract.definition.onViolation === "WARN" && args.contractPlan.handoffMode === "transition") {
            skippedTargets.add(targetRoleId);
          } else {
            contractValidationFailures.push({
              errorCode: "CONTRACT_VALIDATION_FAILED",
              message: contractError
            });
          }
        }
      }
    }

    if (contractValidationFailures.length > 0) {
      const failure = contractValidationFailures[0];
      return buildContractValidationFailureTransition({
        roleId: args.outcome.roleId,
        branch: args.outcome.branch,
        audit: args.outcome.audit,
        selectedEvent: args.outcome.selectedEvent,
        storedResult: args.outcome.storedResult,
        errorCode: failure.errorCode,
        message: failure.message
      });
    }
  }

  for (const targetRoleId of candidateTargets) {
    if (!eventByTargetRoleId.has(targetRoleId)) {
      const flow = findOutgoingFlow({
        node,
        targetRoleId,
        selectedEvent: args.outcome.selectedEvent
      });
      eventByTargetRoleId.set(targetRoleId, flow?.eventType ?? args.outcome.selectedEvent);
    }
  }

  const hasSkippedJoinSource = Object.values(args.state.joinSourceOutcomesByScope ?? {})
    .some((outcomes) => Object.values(outcomes).some((status) => status === "skipped"));

  return (
    buildRoutedTransitionPlan({
      runId: args.runId,
      state: args.state,
      plan: args.plan,
      contractPlan: args.contractPlan,
      node,
      roleId: args.outcome.roleId,
      currentBranch: args.outcome.branch,
      audit: args.outcome.audit,
      currentResult: args.outcome.storedResult,
      selectedEvent: args.outcome.selectedEvent,
      candidateTargets: candidateTargets.filter((targetRoleId) => !skippedTargets.has(targetRoleId)),
      eventByTargetRoleId,
      logger: args.logger,
      terminalOutput: args.outcome.storedResult?.content ?? "",
      extraEvents: routeDecisionEvent ? [routeDecisionEvent] : undefined,
      loopBudgetFailureMode: "fail_run",
      // A branch termination records a skipped source before its siblings finish. Once the
      // graph drains, the same orphan check must apply even without transition-mode contracts.
      allowOrphanedJoinFailure: args.contractPlan?.handoffMode === "transition" || hasSkippedJoinSource,
      indexes: args.indexes
    }) ?? buildContractValidationFailureTransition({
      roleId: args.outcome.roleId,
      branch: args.outcome.branch,
      audit: args.outcome.audit,
      selectedEvent: args.outcome.selectedEvent,
      storedResult: args.outcome.storedResult,
      errorCode: "GRAPH_TRANSITION_PLANNER_ABORTED",
      message: `Transition planner aborted routing for role "${args.outcome.roleId}"`
    })
  );
}
