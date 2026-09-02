import type { RunConsoleLogger } from "./console-run-log.js";
import { getExecutionPlanNode } from "./execution-plan.js";
import {
  getFlowContractByTarget,
  getSplitFlowContractByTarget,
  validateContractAgainstSchema
} from "./flow-contract.js";
import { isRuntimeOnlyErrorEvent } from "./error-flow-utils.js";
import { evaluateJoinNodeReadiness, selectRoutingTargets } from "./graph-mode-registry.js";
import {
  activateBranch,
  buildBranchId,
  buildJoinId,
  buildLoopScopeKey,
  buildRoleActivationScopeKey,
  completeBranch,
  getBranchResult,
  getTargetLoopIteration,
  getLoopScopeForRole,
  storeRoleResult,
  waitForHumanReview,
  wouldExceedLoopBudget
} from "./graph-runtime-state.js";
import { buildReviewId, buildReviewRoundKey } from "./human-review.js";
import { selectSemanticRoute } from "./condition-ast.js";
import { semanticIRDigest } from "./semantic-ir.js";
import { sanitizeRoleInputContext } from "./role-input-projector.js";
import { buildAuditSummaryDelta } from "./run-summary.js";
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
    };

type LoopTransitionEvent = {
  type: "loop_exhausted";
  at: string;
  loopId: string;
  roleId: string;
  lineageId: string;
  loopIteration: number;
  maxRounds: number;
  onExhausted: string;
};

export type RuntimeTransitionEvent =
  | JoinTransitionEvent
  | FailureHandledTransitionEvent
  | HumanReviewTransitionEvent
  | LoopTransitionEvent;

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
  state: GraphState;
  plan: ExecutionPlan;
  contractPlan?: FlowContractPlan;
  review: PendingHumanReview;
  decision: HumanReviewDecisionRecord;
  logger: RunConsoleLogger;
  indexes?: RuntimeIndexes;
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
  roleId: string;
  branch: BranchRecord;
  error: string;
  errorEnvelope: RuntimeErrorEnvelope;
  audit: AuditRecord;
}): GraphUpdate {
  return {
    status: "failed",
    error: args.error,
    errorEnvelope: args.errorEnvelope,
    transitionCount: 1,
    recentAudits: [args.audit],
    auditSummary: buildAuditSummaryDelta(args.audit),
    roleMetricsByRoleId: buildRoleMetricsDelta(args.audit),
    branchRecords: {
      [args.branch.branchId]: completeBranch(args.branch)
    },
    loopIterations: {
      [args.roleId]: args.branch.loopIteration
    },
    finalRoleId: args.roleId,
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
      finalRoleId: args.roleId,
      lastExecutedRoleId: args.roleId
    },
    events: []
  };
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
          finalRoleId: args.review.roleId,
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
  const joinEvents: RuntimeTransitionEvent[] = [];
  let nextBranchSequence = args.state.nextBranchSequence;
  let finalStatus: GraphRunStatus = "running";
  let finalError = "";
  let finalOutput = "";
  let finalRoleId = "";
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
        finalRoleId: args.review.roleId,
        lastExecutedRoleId: args.review.roleId
      },
      events: []
    };
  }

  for (const targetRoleId of candidateTargets.filter((targetRoleId) => !skippedTargets.has(targetRoleId))) {
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
      finalRoleId = args.review.roleId;
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
    args.logger.transition({
      fromRoleId: args.review.roleId,
      event: targetEvent,
      toRoleId: targetRoleId,
      branchId: args.review.branchId
    });
  }

  if (reachedSystemOutput && finalStatus !== "failed") {
    const hasOtherActiveBranches = Object.values(args.state.branchRecords).some(
      (branch) => branch.status === "active" && branch.branchId !== args.review.branchId
    );
    const hasActivatedBranches = Object.values(branchUpdates).some(
      (branch) => branch.status === "active"
    );
    if (!hasOtherActiveBranches && !hasActivatedBranches) {
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
        finalRoleId = orphanedJoinGroup.roleId;
      } else {
        finalStatus = "done";
        finalOutput = args.review.draftResult.content ?? "";
        finalRoleId = args.review.roleId;
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
      finalOutput,
      finalRoleId,
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

export function planHumanReviewDecisionTransition(args: ReviewDecisionTransitionInput): TransitionPlan {
  if (args.review.stateVersion !== undefined && args.review.stateVersion !== args.state.stateVersion) {
    throw new Error(`Human review ${args.review.reviewId} is bound to state version ${args.review.stateVersion}, current version is ${args.state.stateVersion}`);
  }
  if (args.review.irDigest && args.plan.semanticIR && args.review.irDigest !== semanticIRDigest(args.plan.semanticIR)) {
    throw new Error(`Human review ${args.review.reviewId} Semantic IR digest mismatch`);
  }
  const node = getExecutionPlanNode(args.plan, args.review.roleId);
  if (args.decision.decision === "approve") {
    return buildApprovedHumanReviewTransition({
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
      events: [
        {
          type: "human_review_paused",
          at: new Date().toISOString(),
          roleId: args.review.roleId,
          branchId: args.review.branchId,
          lineageId: args.review.lineageId,
          loopIteration: args.review.loopIteration,
          reviewId: args.review.reviewId,
          decidedAt: args.decision.decidedAt
        }
      ]
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
            status: "resolved"
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
      events: [
        {
          type: "human_review_terminated",
          at: new Date().toISOString(),
          roleId: args.review.roleId,
          branchId: args.review.branchId,
          lineageId: args.review.lineageId,
          loopIteration: args.review.loopIteration,
          reviewId: args.review.reviewId,
          decidedAt: args.decision.decidedAt,
          scope: args.decision.scope ?? args.review.spec.terminateScope
        }
      ]
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
    activatedByEvent: "REWORK"
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
        at: new Date().toISOString(),
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
  const roleActivationUpdates: Record<string, number> = {};
  const joinEvents: RuntimeTransitionEvent[] = [];
  const joinScopeUpdates: NonNullable<GraphState["joinScopes"]> = {};
  let nextBranchSequence = args.state.nextBranchSequence;
  let finalStatus: GraphRunStatus = "running";
  let finalError = "";
  let finalOutput = "";
  let finalRoleId = "";
  let finalErrorEnvelope: RuntimeErrorEnvelope | undefined;
  let reachedSystemOutput = false;

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

    if (wouldExceedLoopBudget({
        targetRoleId,
        currentLoopIteration: args.currentBranch.loopIteration,
        state: args.state,
        plan: args.plan,
        lineageId: args.currentBranch.lineageId
      })) {
      if (args.loopBudgetFailureMode === "abort_routing") {
        return undefined;
      }
      const exhaustedScope = getLoopScopeForRole(args.plan, targetRoleId);
      const exhaustedTarget = exhaustedScope?.onExhausted;
      if (exhaustedScope && exhaustedTarget && exhaustedTarget !== targetRoleId) {
        joinEvents.push({
          type: "loop_exhausted",
          at: new Date().toISOString(),
          loopId: exhaustedScope.loopId,
          roleId: args.roleId,
          lineageId: args.currentBranch.lineageId,
          loopIteration: args.currentBranch.loopIteration,
          maxRounds: exhaustedScope.maxRounds,
          onExhausted: exhaustedTarget
        });
        targetRoleId = exhaustedTarget === "end" ? SYSTEM_END_ROLE_ID : exhaustedTarget;
      } else {
      finalStatus = "failed";
      finalError = `Loop budget exceeded for ${targetRoleId}`;
      finalErrorEnvelope = {
        errorCode: "GRAPH_LOOP_BUDGET_EXCEEDED",
        errorCategory: "state",
        message: finalError,
        retryable: false,
        stage: "execute",
        roleId: args.roleId,
        branchId: args.currentBranch.branchId
      };
      finalRoleId = args.roleId;
      break;
      }
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
    loopUpdates[targetRoleId] = nextLoopIteration;
    const loopScope = getLoopScopeForRole(args.plan, targetRoleId);
    if (loopScope && targetRoleId === loopScope.boundaryRoleId) {
      loopScopeUpdates[buildLoopScopeKey(args.currentBranch.lineageId, loopScope.loopId)] = nextLoopIteration;
    }
    const targetNode = getExecutionPlanNode(args.plan, targetRoleId);

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
          loopIteration: nextLoopIteration, expectedSourceRoleIds: targetNode.joinSources,
          readySourceRoleIds: readiness.completedSourceRoleIds, missingSourceRoleIds: readiness.missingSourceRoleIds,
          startedAt: existingScope?.startedAt ?? now, timeoutSeconds: joinSpec?.timeoutSeconds ?? 3600,
          status: "waiting", timeoutAction: joinSpec?.onTimeout
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
        finalRoleId = targetRoleId;
        break;
      }
      roleActivationUpdates[activationKey] = activationCount;

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
      branchUpdates[branch.branchId] = branch;
      const scopeKey = JSON.stringify([targetRoleId, args.currentBranch.lineageId, nextLoopIteration]);
      const existingScope = args.state.joinScopes?.[scopeKey];
      if (existingScope) {
        joinScopeUpdates[scopeKey] = {
          ...existingScope,
          readySourceRoleIds: readiness.completedSourceRoleIds,
          missingSourceRoleIds: readiness.missingSourceRoleIds,
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
      finalRoleId = targetRoleId;
      break;
    }
    roleActivationUpdates[activationKey] = activationCount;

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
    branchUpdates[branch.branchId] = branch;
    args.logger.transition({
      fromRoleId: args.roleId,
      event: targetEvent,
      toRoleId: targetRoleId,
      branchId: args.currentBranch.branchId
    });
  }

  if (reachedSystemOutput && finalStatus !== "failed") {
    const hasOtherActiveBranches = Object.values(args.state.branchRecords).some(
      (branch) => branch.status === "active" && branch.branchId !== args.currentBranch.branchId
    );
    const hasActivatedBranches = Object.values(branchUpdates).some(
      (branch) => branch.status === "active"
    );
    if (!hasOtherActiveBranches && !hasActivatedBranches) {
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
        finalRoleId = orphanedJoinGroup.roleId;
      } else {
        finalStatus = "done";
        finalOutput = args.terminalOutput;
        finalRoleId = args.roleId;
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
      roleActivationsByScope: roleActivationUpdates,
      joinScopes: joinScopeUpdates,
      selectedEventByBranchId: args.selectedEvent
        ? { [args.currentBranch.branchId]: args.selectedEvent }
        : {},
      finalOutput,
      finalRoleId,
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
  // Semantic IR conditions are evaluated after the role output is validated and before any
  // branch activation. This keeps route ambiguity and fail-closed behavior in OGS runtime.
  const selectedEvent = args.outcome.selectedEvent;
  if (args.plan.semanticIR && selectedEvent && node.routingMode !== "parallel_split") {
    const semanticTransitions = args.plan.semanticIR.transitions.filter(
      (transition) => transition.fromRoleId === args.outcome.roleId && transition.eventType === selectedEvent
    );
    if (semanticTransitions.some((transition) => transition.condition)) {
      const route = selectSemanticRoute({
        transitions: semanticTransitions,
        eventType: selectedEvent,
        context: {
          state: args.state.businessState ?? {},
          loop: { iteration: args.outcome.branch.loopIteration, lineageId: args.outcome.branch.lineageId },
          event: args.outcome.storedResult?.data ?? args.outcome.storedResult?.content,
          role: { roleId: args.outcome.roleId, mode: "default" }
        }
      });
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
      loopBudgetFailureMode: "fail_run",
      allowOrphanedJoinFailure: args.contractPlan?.handoffMode === "transition",
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
