/**
 * Orchestrates runtime graph execution: it wires LangGraph nodes, translates role outcomes to state
 * updates, persists checkpoints, and enforces recovery semantics (replay, reconcile, stop requests).
 * Boundaries: the runner never touches role internals; it treats execution-plan metadata as the source
 * of truth and exposes only GraphState/GraphUpdate transformations. Trade-off: the runner keeps explicit
 * persistence calls (checkpoints, audit output) instead of hiding them behind helpers to keep
 * crash handling transparent.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  Annotation,
  END,
  GraphDrained,
  isGraphDrained,
  isNodeTimeoutError,
  RunControl,
  START,
  StateGraph
} from "@langchain/langgraph";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

import { createRunConsoleLogger } from "./console-run-log.js";
import type { Executor } from "./executor.js";
import { getExecutionPlanNode } from "./execution-plan.js";
import { countPendingHumanReviews } from "./human-review.js";
import {
  getFlowContractByTarget,
  getSplitFlowContractByTarget,
  validateContractAgainstSchema
} from "./flow-contract.js";
import {
  createInitialGraphState,
  getActiveRoleIds,
  listActiveBranches,
  projectStateSnapshot
} from "./graph-runtime-state.js";
import { applyGraphUpdateToIndexes, buildRuntimeIndexes } from "./runtime-indexes.js";
import type { RuntimeIndexes } from "./runtime-indexes.js";
import { executeRoleNode } from "./role-executor.js";
import {
  loadRoleExecutionCandidateRecord,
  persistCommittedExecutionResult,
  recordAudit,
  recordRoleResult,
  removeRoleExecutionCandidateRecord
} from "./role-execution-recorder.js";
import { reconcilePromptBudgetLedger } from "./prompt-budget.js";
import { isRuntimeOnlyErrorEvent } from "./error-flow-utils.js";
import type { CompiledExecutionSnapshot } from "./compiler.js";
import { createRuntimeError, normalizeRuntimeError } from "./runtime-errors.js";
import {
  buildAuditSummaryDelta,
  createEmptyAuditSummary,
  mergeAuditSummaries,
  summarizeRunFromAuditSummary
} from "./run-summary.js";
import { buildRunSummaryProjection } from "./run-summary-schema.js";
import { projectStages } from "./stage-projector.js";
import { applySemanticBusinessState } from "./semantic-state.js";
import { resolveJoinPolicy } from "./join-policy.js";
import type { GitCollaboration, GitMergeResult, GitMergeVerification, GitRoleCommit, GitRoleWorktree } from "./git-collaboration.js";
import { assertWorkspaceCheckpoint, assertWorkspaceEvent, assertWorkspaceRef, WORKSPACE_EVENT_TYPES, type WorkspaceCheckpoint, type WorkspaceEventEnvelope, type WorkspaceRef } from "./workspace-contracts.js";
import { acquireCanonicalWorkspaceLock } from "./workspace-lock.js";
import {
  RUNTIME_EVENT_HUMAN_REVIEW_DECISION_REJECTED,
  RUNTIME_EVENT_LOOP_EXHAUSTED
} from "../business-events.js";
import { semanticIRDigest } from "./semantic-ir.js";
import type { RuntimeExecutionServices } from "./engine-adapter.js";
import { rebuildTimelineProjection } from "./timeline-projector.js";
import { stringifyJson } from "./runtime-support.js";
import {
  appendEvent as appendFilesystemEvent,
  clearRunStopRequest,
  cleanupHistoricalExecutionSnapshots,
  createValidatedAuditAppender,
  eventIdsForContext,
  flushBufferedRunArtifacts,
  loadAuditTrailFromEvents,
  persistRunStopOutcome,
  readRunStopRequest,
  writeAtomicFile
} from "./run-artifacts.js";
import { filesystemCheckpointStore } from "./checkpoint-store.js";
import { filesystemReviewStore } from "./review-store.js";
import {
  findOrphanedJoinGroup,
  planHumanReviewDecisionTransition,
  planTransition
} from "./transition-planner.js";
import type { TransitionPlan } from "./transition-planner.js";
import { SYSTEM_END_ROLE_ID } from "./types.js";
import { SYSTEM_START_ROLE_ID } from "./types.js";
import type {
  AdapterRunResult,
  AuditRecord,
  BranchRecord,
  CliTool,
  EffectiveLawConstraints,
  ExecutionPlan,
  ExecutionPlanNode,
  ExecutionProfile,
  FlowContractPlan,
  GraphRunStatus,
  GraphState,
  LoadedRolePackage,
  RunContext,
  RuntimeCheckpointRecord,
  RuntimeErrorEnvelope,
  StoredRoleResult,
  GraphStateUpdate,
  RoleExecutionOutcomeRecord,
  UserProfile,
  GraphRoleMetricSummary
} from "./types.js";

const runtimeServicesByContext = new WeakMap<object, RuntimeExecutionServices>();

/** Routes every graph event through the adapter port when one is active. */
async function appendEvent(context: RunContext, payload: Record<string, unknown>): Promise<void> {
  const type = typeof payload.type === "string" ? payload.type : "runtime_event";
  if ((WORKSPACE_EVENT_TYPES as readonly string[]).includes(type)) {
    payload = {
      ...payload,
      eventId: typeof payload.eventId === "string" && payload.eventId ? payload.eventId : `${context.runId}:${type}:${randomUUID()}`,
      at: typeof payload.at === "string" && !Number.isNaN(Date.parse(payload.at)) ? payload.at : new Date().toISOString()
    };
    const { type: _type, eventId: _eventId, at: _at, ...eventPayload } = payload;
    assertWorkspaceEvent({
      ogsContractVersion: 2,
      schemaVersion: 1,
      eventId: payload.eventId,
      runId: context.runId,
      eventType: type,
      recordedAt: payload.at,
      payload: eventPayload
    });
  }
  const eventId = typeof payload.eventId === "string" && payload.eventId ? payload.eventId : undefined;
  const eventIds = eventId ? await eventIdsForContext(context) : undefined;
  const runtimeServices = runtimeServicesByContext.get(context);
  if (runtimeServices) {
    const append = createValidatedAuditAppender(context, runtimeServices.audit.append);
    await append({
      ...payload,
      type: typeof payload.type === "string" ? payload.type : "runtime_event"
    });
    if (eventIds && eventId) eventIds.add(eventId);
    return;
  }
  await appendFilesystemEvent(context, payload);
  if (eventIds && eventId) eventIds.add(eventId);
}

async function appendWorkspaceEvent(context: RunContext, event: WorkspaceEventEnvelope): Promise<void> {
  await appendEvent(context, {
    ...event.payload,
    type: event.eventType,
    eventId: event.eventId,
    at: event.recordedAt
  });
}

async function ensureResultCommitEvent(args: {
  context: RunContext;
  resultCommit: NonNullable<GraphState["resultCommit"]>;
  roleId?: string;
  stateVersion: number;
}): Promise<void> {
  const eventId = `result_committed:${args.resultCommit.resultId}`;
  const eventIds = await eventIdsForContext(args.context);
  if (eventIds.has(eventId)) return;
  await appendEvent(args.context, {
    type: "result_committed",
    eventId,
    at: args.resultCommit.committedAt ?? new Date().toISOString(),
    runId: args.context.runId,
    resultId: args.resultCommit.resultId,
    roleId: args.roleId,
    stateVersion: args.stateVersion
  });
}

async function ensureLoopBudgetReviewEvents(args: {
  context: RunContext;
  state: GraphState;
}): Promise<void> {
  const reviews = Object.values(args.state.pendingReviewsById).filter(
    (review) => review.kind === "loop_budget" && review.loopBudget
  );
  if (!reviews.length) return;
  const eventIds = await eventIdsForContext(args.context);
  for (const review of reviews) {
    const eventId = `loop_exhausted:${review.reviewId}`;
    if (eventIds.has(eventId)) continue;
    await appendEvent(args.context, {
      type: RUNTIME_EVENT_LOOP_EXHAUSTED,
      eventId,
      at: review.requestedAt,
      loopId: review.loopBudget?.loopId,
      roleId: review.roleId,
      branchId: review.branchId,
      lineageId: review.lineageId,
      loopIteration: review.loopIteration,
      maxRounds: review.loopBudget?.maxRounds,
      reviewId: review.reviewId
    });
  }
}

function runtimeEdgeId(
  fromRoleId: string,
  eventType: string,
  toRoleId: string,
  runtimeEdgeIdsByTransition?: Record<string, string>
): string {
  const key = JSON.stringify([fromRoleId, eventType, toRoleId]);
  return runtimeEdgeIdsByTransition?.[key] || `${fromRoleId}:${eventType}:${toRoleId}`;
}

function buildHandoffId(args: {
  runId: string;
  branchId: string;
  lineageId: string;
  sourceExecutionId: string;
  sourceAttempt: number;
  edgeId: string;
  loopIteration: number;
}): string {
  return JSON.stringify([
    args.runId,
    args.branchId,
    args.lineageId,
    args.sourceExecutionId,
    args.sourceAttempt,
    args.edgeId,
    args.loopIteration
  ]);
}

type GraphUpdate = GraphStateUpdate;

function semanticDigestForPlan(plan: ExecutionPlan): string {
  return plan.semanticIR ? semanticIRDigest(plan.semanticIR) : "none";
}

export { applySemanticBusinessState } from "./semantic-state.js";

const SCHEDULER_NODE_ID = "__scheduler__";
const DEFAULT_TRANSITION_BUDGET = 100;
const GRAPH_RECURSION_MARGIN = 20;
const RECENT_AUDIT_WINDOW = 5;
const GANTT_RENDER_LIMIT = 200;
const TEST_HOOKS_ENABLED_ENV = "OGSYSTEM_ENABLE_TEST_HOOKS";
const TEST_CRASH_AFTER_EXECUTION_OUTCOME_ENV = "OGSYSTEM_TEST_CRASH_AFTER_EXECUTION_OUTCOME";
const TEST_CRASH_AFTER_REVIEW_STATE_COMMIT_ENV = "OGSYSTEM_TEST_CRASH_AFTER_REVIEW_STATE_COMMIT";
const TEST_INTERRUPT_AFTER_PREPARED_WORKSPACE_ENV = "OGSYSTEM_TEST_INTERRUPT_AFTER_PREPARED_WORKSPACE";
const TEST_CRASH_AFTER_WORKSPACE_GIT_COMMIT_ENV = "OGSYSTEM_TEST_CRASH_AFTER_WORKSPACE_GIT_COMMIT";
const TEST_WORKSPACE_COMMIT_FILE_ENV = "OGSYSTEM_TEST_WORKSPACE_COMMIT_FILE";
const DEFAULT_ROLE_EXECUTION_TIMEOUT_MS = 600000;
const ROLE_NODE_TIMEOUT_GRACE_MS = 15000;

export type RunnerInput = {
  plan: ExecutionPlan;
  effectiveLaw: EffectiveLawConstraints;
  contractPlan?: FlowContractPlan;
  compilerSnapshot?: CompiledExecutionSnapshot;
  profilesById: Map<string, ExecutionProfile>;
  toolsByRef: Map<string, CliTool>;
  userProfile?: UserProfile;
  workdir: string;
  commandBaseDir?: string;
  rolePackagesByRoleId: Map<string, LoadedRolePackage>;
  runContext: RunContext;
  executor: Executor;
  prompt: string;
  initialState?: GraphState;
  cleanupExecutionHistory?: number;
  autoCleanupRetention?: {
    executionDirThreshold: number;
    keepLatest: number;
  };
  errorFlowRoutingEnabled: boolean;
  logRun: boolean;
  runControl?: RunControl;
  runtimeServices?: RuntimeExecutionServices;
  runtimeEdgeIdsByTransition?: Record<string, string>;
  /** Named deterministic dry-run scenario used for repeatable Studio UAT. */
  dryRunScenario?: "review-reject-once";
  /** Optional opt-in Git collaboration lifecycle for parallel code branches. */
  gitCollaboration?: {
    collaboration: GitCollaboration;
    baseCommit: string;
    publish?: (merge: GitMergeResult) => Promise<void>;
    onRoleCommit?: (branchId: string, commit: GitRoleCommit) => Promise<WorkspaceEventEnvelope | void> | WorkspaceEventEnvelope | void;
    onMerge?: (merge: GitMergeResult, phase: "join" | "final") => Promise<WorkspaceEventEnvelope | void> | WorkspaceEventEnvelope | void;
  };
};

/**
 * LangGraph times out a node attempt, while the executor timeout covers only the external
 * backend call. Keep a small persistence/serialization grace period around the same effective
 * role budget so a slow backend cannot leave the graph node unbounded.
 */
export function resolveRoleNodeTimeoutMs(
  node: ExecutionPlanNode,
  profilesById: Map<string, ExecutionProfile>
): number | undefined {
  if (node.binding.kind === "model") {
    return (node.binding.timeoutMs ?? DEFAULT_ROLE_EXECUTION_TIMEOUT_MS) + ROLE_NODE_TIMEOUT_GRACE_MS;
  }
  return DEFAULT_ROLE_EXECUTION_TIMEOUT_MS + ROLE_NODE_TIMEOUT_GRACE_MS;
}

function mergeStatus(current: GraphRunStatus, update: GraphRunStatus): GraphRunStatus {
  if (current === "failed" || update === "failed") {
    return "failed";
  }
  if (current === "terminated" || update === "terminated") {
    return "terminated";
  }
  // A resolved human review explicitly re-enters the scheduler. Without this
  // transition, the waiting_review marker wins forever and the resumed branch
  // is never dispatched. Any still-pending review is re-parked by the final
  // pending-review check after the graph drains.
  if (update === "running" && current === "waiting_review") {
    return "running";
  }
  if (current === "waiting_review" || update === "waiting_review") {
    return "waiting_review";
  }
  if (current === "stopped" || update === "stopped") {
    return "stopped";
  }
  if (current === "done" || update === "done") {
    return "done";
  }
  if (current === "stopping" || update === "stopping") {
    return "stopping";
  }
  return "running";
}

function liftWaitingHumanReviewStop(state: GraphState): GraphState {
  if (!((state.status === "stopped" && state.error === "waiting for human review") || state.status === "waiting_review")) {
    return state;
  }
  return {
    ...state,
    status: "running",
    error: "",
    errorEnvelope: undefined
  };
}

/**
 * LangGraph nodes emit incremental GraphUpdate objects, while OGSystem persists materialized
 * GraphState snapshots. Reducers bridge those two views and keep checkpoint-sized updates composable.
 */
const GraphStateAnnotation = Annotation.Root({
  stateVersion: Annotation<number>({
    reducer: (current, update) => Math.max(current, update),
    default: () => 0
  }),
  lastEventId: Annotation<string | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined
  }),
  userPrompt: Annotation<string>,
  businessState: Annotation<Record<string, unknown>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  status: Annotation<GraphRunStatus>({
    reducer: mergeStatus,
    default: () => "running"
  }),
  error: Annotation<string>({
    reducer: (current, update) => current || update,
    default: () => ""
  }),
  errorEnvelope: Annotation<RuntimeErrorEnvelope | undefined>({
    reducer: (current, update) => current || update,
    default: () => undefined
  }),
  transitionCount: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0
  }),
  recentAudits: Annotation<AuditRecord[]>({
    reducer: (current, update) => current.concat(update).slice(-RECENT_AUDIT_WINDOW),
    default: () => []
  }),
  auditSummary: Annotation<GraphState["auditSummary"]>({
    reducer: (current, update) => mergeAuditSummaries(current, update),
    default: () => createEmptyAuditSummary()
  }),
  roleMetricsByRoleId: Annotation<Record<string, GraphRoleMetricSummary>>({
    reducer: (current, update) => mergeRoleMetrics(current, update),
    default: () => ({})
  }),
  roleResults: Annotation<Record<string, StoredRoleResult>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  pendingReviewsById: Annotation<GraphState["pendingReviewsById"]>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  reviewHistoryByBranchId: Annotation<GraphState["reviewHistoryByBranchId"]>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  humanReviewContextByBranchId: Annotation<GraphState["humanReviewContextByBranchId"]>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  reviewRoundByRoleLineageKey: Annotation<GraphState["reviewRoundByRoleLineageKey"]>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  lastWaitingReviewId: Annotation<string | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined
  }),
  branchRecords: Annotation<Record<string, BranchRecord>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  loopIterations: Annotation<Record<string, number>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  loopCountersByScope: Annotation<Record<string, number>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  loopBudgetAuthorizationsByScope: Annotation<Record<string, number>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  roleActivationsByScope: Annotation<Record<string, number>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  joinScopes: Annotation<NonNullable<GraphState["joinScopes"]>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  joinSourceOutcomesByScope: Annotation<NonNullable<GraphState["joinSourceOutcomesByScope"]>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  resultCommit: Annotation<GraphState["resultCommit"]>({
    reducer: (current, update) => update ?? current,
    default: () => undefined
  }),
  selectedEventByBranchId: Annotation<Record<string, string>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  selectedEntryRoleIds: Annotation<string[]>({
    reducer: (current, update) => update ?? current,
    default: () => []
  }),
  finalOutputsByRoleId: Annotation<GraphState["finalOutputsByRoleId"]>({
    reducer: (current, update) => update ?? current,
    default: () => ({})
  }),
  finalOutputRoleOrder: Annotation<string[]>({
    reducer: (current, update) => update ?? current,
    default: () => []
  }),
  finalRoleIds: Annotation<string[]>({
    reducer: (current, update) => update ?? current,
    default: () => []
  }),
  lastExecutedRoleId: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => ""
  }),
  nextBranchSequence: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 1
  }),
  lastCheckpointSequence: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0
  })
});

function mergeGraphUpdates(current: GraphUpdate, update: GraphUpdate): GraphUpdate {
  const mergedBudgetDeltas: Record<string, number> = {};
  for (const [key, value] of Object.entries(current.loopBudgetAuthorizationDeltasByScope ?? {})) {
    mergedBudgetDeltas[key] = (mergedBudgetDeltas[key] ?? 0) + value;
  }
  for (const [key, value] of Object.entries(update.loopBudgetAuthorizationDeltasByScope ?? {})) {
    mergedBudgetDeltas[key] = (mergedBudgetDeltas[key] ?? 0) + value;
  }
  return {
    stateVersion: Math.max(current.stateVersion ?? 0, update.stateVersion ?? 0),
    lastEventId: update.lastEventId ?? current.lastEventId,
    status:
      current.status && update.status
        ? mergeStatus(current.status, update.status)
        : (current.status ?? update.status),
    error: current.error || update.error,
    errorEnvelope: current.errorEnvelope ?? update.errorEnvelope,
    transitionCount: (current.transitionCount ?? 0) + (update.transitionCount ?? 0),
    recentAudits: [
      ...(current.recentAudits ?? []),
      ...(update.recentAudits ?? [])
    ].slice(-RECENT_AUDIT_WINDOW),
    auditSummary: mergeAuditSummaries(
      current.auditSummary ?? createEmptyAuditSummary(),
      update.auditSummary ?? createEmptyAuditSummary()
    ),
    roleMetricsByRoleId: mergeRoleMetrics(
      current.roleMetricsByRoleId ?? {},
      update.roleMetricsByRoleId ?? {}
    ),
    roleResults: { ...(current.roleResults ?? {}), ...(update.roleResults ?? {}) },
    pendingReviewsById: { ...(current.pendingReviewsById ?? {}), ...(update.pendingReviewsById ?? {}) },
    reviewHistoryByBranchId: {
      ...(current.reviewHistoryByBranchId ?? {}),
      ...(update.reviewHistoryByBranchId ?? {})
    },
    humanReviewContextByBranchId: {
      ...(current.humanReviewContextByBranchId ?? {}),
      ...(update.humanReviewContextByBranchId ?? {})
    },
    reviewRoundByRoleLineageKey: {
      ...(current.reviewRoundByRoleLineageKey ?? {}),
      ...(update.reviewRoundByRoleLineageKey ?? {})
    },
    lastWaitingReviewId: update.lastWaitingReviewId ?? current.lastWaitingReviewId,
    branchRecords: { ...(current.branchRecords ?? {}), ...(update.branchRecords ?? {}) },
    loopIterations: { ...(current.loopIterations ?? {}), ...(update.loopIterations ?? {}) },
    loopCountersByScope: { ...(current.loopCountersByScope ?? {}), ...(update.loopCountersByScope ?? {}) },
    loopBudgetAuthorizationsByScope: { ...(current.loopBudgetAuthorizationsByScope ?? {}), ...(update.loopBudgetAuthorizationsByScope ?? {}) },
    ...(Object.keys(mergedBudgetDeltas).length
      ? { loopBudgetAuthorizationDeltasByScope: mergedBudgetDeltas }
      : {}),
    roleActivationsByScope: { ...(current.roleActivationsByScope ?? {}), ...(update.roleActivationsByScope ?? {}) },
    joinScopes: { ...(current.joinScopes ?? {}), ...(update.joinScopes ?? {}) },
    joinSourceOutcomesByScope: { ...(current.joinSourceOutcomesByScope ?? {}), ...(update.joinSourceOutcomesByScope ?? {}) },
    resultCommit: update.resultCommit ?? current.resultCommit,
    selectedEventByBranchId: {
      ...(current.selectedEventByBranchId ?? {}),
      ...(update.selectedEventByBranchId ?? {})
    },
    selectedEntryRoleIds: update.selectedEntryRoleIds ?? current.selectedEntryRoleIds,
    finalOutputsByRoleId: update.finalOutputsByRoleId ?? current.finalOutputsByRoleId,
    finalOutputRoleOrder: update.finalOutputRoleOrder ?? current.finalOutputRoleOrder,
    finalRoleIds: update.finalRoleIds ?? current.finalRoleIds,
    lastExecutedRoleId: update.lastExecutedRoleId ?? current.lastExecutedRoleId,
    nextBranchSequence: update.nextBranchSequence ?? current.nextBranchSequence,
    lastCheckpointSequence: Math.max(
      current.lastCheckpointSequence ?? 0,
      update.lastCheckpointSequence ?? 0
    )
  };
}

export function applyGraphUpdate(state: GraphState, update: GraphUpdate): GraphState {
  const loopBudgetAuthorizationsByScope = {
    ...(state.loopBudgetAuthorizationsByScope ?? {}),
    ...(update.loopBudgetAuthorizationsByScope ?? {})
  };
  for (const [key, delta] of Object.entries(update.loopBudgetAuthorizationDeltasByScope ?? {})) {
    loopBudgetAuthorizationsByScope[key] = Math.max(0, (state.loopBudgetAuthorizationsByScope?.[key] ?? 0) + delta);
  }
  return {
    stateVersion: state.stateVersion + 1,
    lastEventId: update.lastEventId ?? state.lastEventId,
    userPrompt: state.userPrompt,
    businessState: { ...(state.businessState ?? {}), ...(update.businessState ?? {}) },
    status: update.status ? mergeStatus(state.status, update.status) : state.status,
    error: state.error || update.error || "",
    errorEnvelope: state.errorEnvelope ?? update.errorEnvelope,
    transitionCount: state.transitionCount + (update.transitionCount ?? 0),
    recentAudits: state.recentAudits.concat(update.recentAudits ?? []).slice(-RECENT_AUDIT_WINDOW),
    auditSummary: mergeAuditSummaries(
      state.auditSummary,
      update.auditSummary ?? createEmptyAuditSummary()
    ),
    roleMetricsByRoleId: mergeRoleMetrics(
      state.roleMetricsByRoleId,
      update.roleMetricsByRoleId ?? {}
    ),
    roleResults: { ...state.roleResults, ...(update.roleResults ?? {}) },
    pendingReviewsById: { ...state.pendingReviewsById, ...(update.pendingReviewsById ?? {}) },
    reviewHistoryByBranchId: {
      ...state.reviewHistoryByBranchId,
      ...(update.reviewHistoryByBranchId ?? {})
    },
    humanReviewContextByBranchId: {
      ...state.humanReviewContextByBranchId,
      ...(update.humanReviewContextByBranchId ?? {})
    },
    reviewRoundByRoleLineageKey: {
      ...state.reviewRoundByRoleLineageKey,
      ...(update.reviewRoundByRoleLineageKey ?? {})
    },
    lastWaitingReviewId: update.lastWaitingReviewId ?? state.lastWaitingReviewId,
    branchRecords: { ...state.branchRecords, ...(update.branchRecords ?? {}) },
    loopIterations: { ...state.loopIterations, ...(update.loopIterations ?? {}) },
    loopCountersByScope: { ...(state.loopCountersByScope ?? {}), ...(update.loopCountersByScope ?? {}) },
    loopBudgetAuthorizationsByScope,
    roleActivationsByScope: { ...(state.roleActivationsByScope ?? {}), ...(update.roleActivationsByScope ?? {}) },
    resultCommit: update.resultCommit ?? state.resultCommit,
    joinScopes: { ...(state.joinScopes ?? {}), ...(update.joinScopes ?? {}) },
    joinSourceOutcomesByScope: { ...(state.joinSourceOutcomesByScope ?? {}), ...(update.joinSourceOutcomesByScope ?? {}) },
    selectedEventByBranchId: {
      ...state.selectedEventByBranchId,
      ...(update.selectedEventByBranchId ?? {})
    },
    selectedEntryRoleIds: update.selectedEntryRoleIds ?? state.selectedEntryRoleIds,
    finalOutputsByRoleId: update.finalOutputsByRoleId ?? state.finalOutputsByRoleId,
    finalOutputRoleOrder: update.finalOutputRoleOrder ?? state.finalOutputRoleOrder,
    finalRoleIds: update.finalRoleIds ?? state.finalRoleIds,
    lastExecutedRoleId: update.lastExecutedRoleId ?? state.lastExecutedRoleId,
    nextBranchSequence: update.nextBranchSequence ?? state.nextBranchSequence,
    lastCheckpointSequence: Math.max(
      state.lastCheckpointSequence,
      update.lastCheckpointSequence ?? state.lastCheckpointSequence
    )
  };
}

async function persistProjectedState(args: {
  state: GraphState;
  plan: ExecutionPlan;
  runContext: RunContext;
}): Promise<void> {
  try {
    // LangGraph can omit empty annotation values from a streamed state. Keep the
    // durable GraphState contract complete so every stopped run remains resumable.
    const maxBranchSequence = Object.values(args.state.branchRecords ?? {}).reduce(
      (max, branch) => Math.max(max, Number.isInteger(branch.branchSequence) ? branch.branchSequence : 0),
      0
    );
    const persistedState: GraphState = {
      ...args.state,
      error: typeof args.state.error === "string" ? args.state.error : "",
      nextBranchSequence: Number.isInteger(args.state.nextBranchSequence)
        ? args.state.nextBranchSequence
        : maxBranchSequence + 1
    };
    const projectionUpdatedAt = new Date().toISOString();
    const stateWriteStartedAt = Date.now();
    await writeAtomicFile(args.runContext.statePath, stringifyJson(projectStateSnapshot({ ...args, state: persistedState })));
    const stateWriteMs = Date.now() - stateWriteStartedAt;
    await writeAtomicFile(
      args.runContext.metricsPath,
      stringifyJson(
        projectMetricsSnapshot({
          ...args,
          stateWriteMs
        })
      )
    );
    await flushBufferedRunArtifacts(args.runContext);

    try {
      await writeAtomicFile(
        args.runContext.summaryPath,
        stringifyJson(
          buildRunSummaryProjection({
            state: args.state,
            plan: args.plan,
            runContext: args.runContext,
            now: projectionUpdatedAt
          })
        )
      );
      await rebuildTimelineProjection({
        eventsPath: args.runContext.eventsPath,
        timelinePath: args.runContext.timelinePath
      });
    } catch (projectionError) {
      const message =
        projectionError instanceof Error ? projectionError.message : String(projectionError);
      process.stderr.write(`[runtime-projection] failed to refresh operator projections: ${message}\n`);
    }
  } catch (error) {
    throw createRuntimeError(
      normalizeRuntimeError(error, {
        errorCode: "RUNTIME_STATE_PERSIST_FAILED",
        errorCategory: "io",
        stage: "execute",
        retryable: false,
        runId: args.runContext.runId,
        roleId: args.state.lastExecutedRoleId || undefined
      })
    );
  }
}

function projectMetricsSnapshot(args: {
  state: GraphState;
  plan: ExecutionPlan;
  runContext: RunContext;
  stateWriteMs: number;
}): Record<string, unknown> {
  const summary = summarizeRunFromAuditSummary({
    auditSummary: args.state.auditSummary,
    transitionCount: args.state.transitionCount,
    terminalStatus: args.state.status,
    terminalErrorEnvelope: args.state.errorEnvelope
  });

  return {
    runId: args.runContext.runId,
    systemId: args.plan.systemId,
    systemVersion: args.plan.systemVersion,
    status: args.state.status,
    transitionCount: args.state.transitionCount,
    summary,
    failureCountsByErrorCode: summary.failureCountsByErrorCode,
    roleMetrics: args.state.roleMetricsByRoleId,
    rssBytes: process.memoryUsage().rss,
    stateWriteMs: args.stateWriteMs,
    executionDirCount: args.runContext.executionDirCount
  };
}

function mergeRoleMetrics(
  left: Record<string, GraphRoleMetricSummary>,
  right: Record<string, GraphRoleMetricSummary>
): Record<string, GraphRoleMetricSummary> {
  const merged: Record<string, GraphRoleMetricSummary> = { ...left };
  for (const [roleId, rightMetrics] of Object.entries(right)) {
    const leftMetrics = merged[roleId] ?? {
      total: 0,
      ok: 0,
      failed: 0,
      noop: 0,
      durationMsTotal: 0
    };
    merged[roleId] = {
      total: leftMetrics.total + rightMetrics.total,
      ok: leftMetrics.ok + rightMetrics.ok,
      failed: leftMetrics.failed + rightMetrics.failed,
      noop: leftMetrics.noop + rightMetrics.noop,
      durationMsTotal: leftMetrics.durationMsTotal + rightMetrics.durationMsTotal
    };
  }
  return merged;
}

export async function replayPendingRuntimeCheckpoints(args: {
  state: GraphState;
  runContext: RunContext;
  runtimeServices?: RuntimeExecutionServices;
}): Promise<{
  state: GraphState;
  checkpoints: RuntimeCheckpointRecord[];
}> {
  const checkpoints = args.runtimeServices
    ? (await args.runtimeServices.checkpointStore.list(args.runContext.runId))
        .filter((checkpoint) => checkpoint.checkpointSequence > args.state.lastCheckpointSequence)
        .sort((left, right) => left.checkpointSequence - right.checkpointSequence)
    : await filesystemCheckpointStore.loadPending({
        context: args.runContext,
        afterSequence: args.state.lastCheckpointSequence
      });
  let replayedState = args.state;
  for (const checkpoint of checkpoints) {
    // A versioned state commit may already contain this checkpoint even when its projected
    // `lastCheckpointSequence` was not flushed. Prefer the state frontier when the WAL record
    // declares a resulting version, and also recognize the last committed event id.
    if (
      (checkpoint.eventId && checkpoint.eventId === replayedState.lastEventId) ||
      (checkpoint.resultingStateVersion !== undefined && checkpoint.resultingStateVersion <= replayedState.stateVersion)
    ) {
      continue;
    }
    replayedState = applyGraphUpdate(replayedState, checkpoint.update);
  }
  if (replayedState.resultCommit?.status === "committed") {
    await ensureResultCommitEvent({
      context: args.runContext,
      resultCommit: replayedState.resultCommit,
      roleId: replayedState.lastExecutedRoleId,
      stateVersion: replayedState.stateVersion
    });
  }
  await ensureLoopBudgetReviewEvents({ context: args.runContext, state: replayedState });
  return {
    state: replayedState,
    checkpoints
  };
}

function calculateGraphRecursionLimit(maxTransitions?: number): number {
  // LangGraph counts scheduler hops and role-node executions toward recursion depth, so the
  // recursion ceiling must be higher than the user-facing transition budget.
  const transitionBudget = maxTransitions ?? DEFAULT_TRANSITION_BUDGET;
  return transitionBudget * 2 + GRAPH_RECURSION_MARGIN;
}

function maybeCrashAfterExecutionOutcome(): never | void {
  if (process.env[TEST_HOOKS_ENABLED_ENV] !== "1" || process.env[TEST_CRASH_AFTER_EXECUTION_OUTCOME_ENV] !== "1") {
    return;
  }
  process.stderr.write(
    `[test-failpoint] forced crash after execution outcome before checkpoint\n`
  );
  process.exit(91);
}

function maybeCrashAfterHumanReviewStateCommit(): never | void {
  if (process.env[TEST_HOOKS_ENABLED_ENV] !== "1" || process.env[TEST_CRASH_AFTER_REVIEW_STATE_COMMIT_ENV] !== "1") {
    return;
  }
  process.stderr.write(
    `[test-failpoint] forced crash after human review state commit before decision markers\n`
  );
  process.exit(92);
}

function maybeInterruptAfterPreparedWorkspace(): void {
  if (process.env[TEST_HOOKS_ENABLED_ENV] !== "1") return;
  const remaining = Number.parseInt(process.env[TEST_INTERRUPT_AFTER_PREPARED_WORKSPACE_ENV] ?? "", 10);
  if (!Number.isInteger(remaining) || remaining <= 0) return;
  process.env[TEST_INTERRUPT_AFTER_PREPARED_WORKSPACE_ENV] = String(remaining - 1);
  if (remaining > 1) return;
  process.stderr.write("[test-failpoint] forced process exit after prepared Workspace checkpoint\n");
  process.exit(93);
}

async function maybeWriteTestWorkspaceFile(worktreePath: string): Promise<void> {
  if (process.env[TEST_HOOKS_ENABLED_ENV] !== "1") return;
  const name = process.env[TEST_WORKSPACE_COMMIT_FILE_ENV];
  if (!name || name.startsWith("/") || name.split(/[\\/]/).includes("..")) return;
  await writeFile(resolve(worktreePath, name), "test-only workspace commit\n", "utf8");
}

function maybeCrashAfterWorkspaceGitCommit(): void {
  if (process.env[TEST_HOOKS_ENABLED_ENV] !== "1" || process.env[TEST_CRASH_AFTER_WORKSPACE_GIT_COMMIT_ENV] !== "1") return;
  process.stderr.write("[test-failpoint] forced process exit after Workspace Git commit before evidence append\n");
  process.exit(94);
}

function buildGraphUpdateFromOutcome(args: {
  runId?: string;
  state: GraphState;
  plan: ExecutionPlan;
  contractPlan?: FlowContractPlan;
  outcome: RoleExecutionOutcomeRecord;
  logger: ReturnType<typeof createRunConsoleLogger>;
  errorFlowRoutingEnabled: boolean;
  indexes?: RuntimeIndexes;
}): TransitionPlan {
  return planTransition({
    runId: args.runId,
    state: args.state,
    plan: args.plan,
    contractPlan: args.contractPlan,
    outcome: args.outcome,
    logger: args.logger,
    errorFlowRoutingEnabled: args.errorFlowRoutingEnabled,
    indexes: args.indexes
  });
}

async function reconcileCommittedRoleExecutionOutcomes(args: {
  state: GraphState;
  plan: ExecutionPlan;
  contractPlan?: FlowContractPlan;
  runContext: RunContext;
  errorFlowRoutingEnabled: boolean;
  compilerSnapshot?: CompiledExecutionSnapshot;
  runtimeServices?: RuntimeExecutionServices;
}): Promise<{
  state: GraphState;
  indexes: RuntimeIndexes;
}> {
  // Resume first trusts the existing checkpoint WAL, then heals only the crash window where
  // role execution committed durably but the checkpoint was never written or reconciled.
  const replay = await replayPendingRuntimeCheckpoints({
    state: args.state,
    runContext: args.runContext,
    runtimeServices: args.runtimeServices
  });
  let reconciledState = replay.state;
  let indexes = buildRuntimeIndexes(reconciledState);
  const pendingCheckpointByExecutionId = new Map(
    replay.checkpoints.map((checkpoint) => [checkpoint.executionId, checkpoint])
  );
  const outcomes = await filesystemCheckpointStore.loadCommittedOutcomes({
    context: args.runContext,
    unresolvedOnly: true
  });
  const logger = createRunConsoleLogger(false);

  // Recovery semantics: after replaying WAL checkpoints, reconcile any committed outcomes that
  // raced ahead of checkpoint writes so the state frontier reflects every durable execution.
  for (const outcome of outcomes) {
    const pendingCheckpoint = pendingCheckpointByExecutionId.get(outcome.executionId);
    if (pendingCheckpoint) {
      const roleDirs = args.runContext.roleDirsById.get(outcome.roleId);
      if (!roleDirs) {
        throw new Error(`Role run directory missing for "${outcome.roleId}"`);
      }
      await filesystemCheckpointStore.markOutcomeReconciled({
        executionDir: resolve(roleDirs.executionsDir, outcome.executionId),
        checkpointSequence: pendingCheckpoint.checkpointSequence
      });
      continue;
    }

    const transitionPlan = buildGraphUpdateFromOutcome({
      runId: args.runContext.runId,
      state: reconciledState,
      plan: args.plan,
      contractPlan: args.contractPlan,
      outcome,
      logger,
      errorFlowRoutingEnabled: args.errorFlowRoutingEnabled,
      indexes
    });
    for (const reviewRequest of transitionPlan.reviewRequests ?? []) {
      await filesystemReviewStore.persistRequest({
        context: args.runContext,
        review: reviewRequest
      });
    }
    const checkpoint = await filesystemCheckpointStore.persist({
      context: args.runContext,
      roleId: outcome.roleId,
      branchId: outcome.branchId,
      loopIteration: outcome.loopIteration,
      executionId: outcome.executionId,
      update: transitionPlan.update,
      expectedStateVersion: reconciledState.stateVersion,
      resultingStateVersion: reconciledState.stateVersion + 1,
      irDigest: semanticDigestForPlan(args.plan),
      eventId: `${args.runContext.runId}:${outcome.executionId}:${reconciledState.stateVersion + 1}`,
      idempotencyKey: `${args.runContext.runId}:${outcome.executionId}:${reconciledState.stateVersion + 1}`
    });
    await args.runtimeServices?.checkpointStore.append(checkpoint);
    const roleDirs = args.runContext.roleDirsById.get(outcome.roleId);
    if (!roleDirs) {
      throw new Error(`Role run directory missing for "${outcome.roleId}"`);
    }
    await filesystemCheckpointStore.markOutcomeReconciled({
      executionDir: resolve(roleDirs.executionsDir, outcome.executionId),
      checkpointSequence: checkpoint.checkpointSequence
    });
    for (const event of transitionPlan.events) {
      await appendEvent(args.runContext, event);
    }
    await ensureLoopBudgetReviewEvents({ context: args.runContext, state: reconciledState });
    if (transitionPlan.update.resultCommit?.status === "committed") {
      await ensureResultCommitEvent({ context: args.runContext, resultCommit: transitionPlan.update.resultCommit, roleId: outcome.roleId, stateVersion: reconciledState.stateVersion + 1 });
    }
    pendingCheckpointByExecutionId.set(outcome.executionId, checkpoint);
    const stateCommit = args.runtimeServices
      ? await args.runtimeServices.stateStore.commit({
          runId: args.runContext.runId,
          expectedStateVersion: reconciledState.stateVersion,
          eventId: checkpoint.eventId ?? `${args.runContext.runId}:${checkpoint.executionId}:${reconciledState.stateVersion + 1}`,
          idempotencyKey: checkpoint.idempotencyKey ?? `${args.runContext.runId}:${checkpoint.executionId}:${reconciledState.stateVersion + 1}`,
          checkpointSequence: checkpoint.checkpointSequence,
          update: { ...checkpoint.update, lastCheckpointSequence: checkpoint.checkpointSequence }
        })
      : undefined;
    const effectiveUpdate = stateCommit
      ? { ...checkpoint.update, stateVersion: stateCommit.snapshot.state.stateVersion, lastEventId: checkpoint.eventId }
      : checkpoint.update;
    reconciledState = stateCommit?.snapshot.state ?? applyGraphUpdate(reconciledState, effectiveUpdate);
    indexes = applyGraphUpdateToIndexes(indexes, effectiveUpdate);
  }

  return {
    state: reconciledState,
    indexes
  };
}

function hasAppliedHumanReviewDecision(args: {
  state: GraphState;
  reviewId: string;
  branchId: string;
  decidedAt: string;
}): boolean {
  return (args.state.reviewHistoryByBranchId[args.branchId] ?? []).some(
    (entry) => entry.reviewId === args.reviewId && entry.decidedAt === args.decidedAt
  );
}

function reviewDecisionRejectionCode(error: unknown): string {
  const match = error instanceof Error ? error.message.match(/^\[([A-Z0-9_]+)\]/) : undefined;
  return match?.[1] ?? "GRAPH_REVIEW_DECISION_REJECTED";
}

async function reconcileCommittedHumanReviewDecisions(args: {
  state: GraphState;
  plan: ExecutionPlan;
  contractPlan?: FlowContractPlan;
  rolePackagesByRoleId: Map<string, LoadedRolePackage>;
  runContext: RunContext;
  compilerSnapshot?: CompiledExecutionSnapshot;
  runtimeServices?: RuntimeExecutionServices;
}): Promise<{
  state: GraphState;
  indexes: RuntimeIndexes;
}> {
  let reconciledState = args.state;
  let indexes = buildRuntimeIndexes(reconciledState);
  const decisions = await filesystemReviewStore.loadDecisions({
    context: args.runContext,
    unresolvedOnly: true
  });
  const logger = createRunConsoleLogger(false);
  let touchedDecision = false;

  for (const decision of decisions) {
    if (!touchedDecision) {
      reconciledState = liftWaitingHumanReviewStop(reconciledState);
      indexes = buildRuntimeIndexes(reconciledState);
      touchedDecision = true;
    }
    const pendingReview = reconciledState.pendingReviewsById[decision.reviewId];
    const alreadyApplied =
      hasAppliedHumanReviewDecision({
        state: reconciledState,
        reviewId: decision.reviewId,
        branchId: pendingReview?.branchId ?? "",
        decidedAt: decision.decidedAt
      }) ||
      (pendingReview !== undefined && (pendingReview.status === "resolved" || pendingReview.status === "expired"));

    if (alreadyApplied) {
      const appliedDecision = await filesystemReviewStore.markApplied({
        context: args.runContext,
        reviewId: decision.reviewId,
        checkpointSequence: decision.checkpointSequence ?? reconciledState.lastCheckpointSequence,
        appliedAt: decision.appliedAt ?? new Date().toISOString(),
        reconciledAt: decision.reconciledAt ?? new Date().toISOString()
      });
      await filesystemReviewStore.markReconciled({
        context: args.runContext,
        reviewId: appliedDecision.reviewId,
        reconciledAt: appliedDecision.reconciledAt
      });
      continue;
    }

    if (!pendingReview) {
      const rejectionCode = "GRAPH_REVIEW_NOT_FOUND";
      await appendEvent(args.runContext, {
        type: RUNTIME_EVENT_HUMAN_REVIEW_DECISION_REJECTED,
        at: new Date().toISOString(),
        reviewId: decision.reviewId,
        reasonCode: rejectionCode,
        decidedAt: decision.decidedAt
      });
      await filesystemReviewStore.markApplied({
        context: args.runContext,
        reviewId: decision.reviewId,
        checkpointSequence: decision.checkpointSequence ?? reconciledState.lastCheckpointSequence,
        appliedAt: decision.appliedAt ?? new Date().toISOString()
      });
      await filesystemReviewStore.markReconciled({ context: args.runContext, reviewId: decision.reviewId });
      continue;
    }

    let transitionPlan: TransitionPlan;
    try {
      transitionPlan = planHumanReviewDecisionTransition({
        runId: args.runContext.runId,
        state: reconciledState,
        plan: args.plan,
        contractPlan: args.contractPlan,
        review: pendingReview,
        decision,
        logger,
        indexes,
        rolePackagesByRoleId: args.rolePackagesByRoleId
      });
    } catch (error) {
      const rejectionCode = reviewDecisionRejectionCode(error);
      await appendEvent(args.runContext, {
        type: RUNTIME_EVENT_HUMAN_REVIEW_DECISION_REJECTED,
        at: new Date().toISOString(),
        reviewId: decision.reviewId,
        roleId: pendingReview.roleId,
        branchId: pendingReview.branchId,
        lineageId: pendingReview.lineageId,
        round: pendingReview.round,
        reasonCode: rejectionCode,
        decidedAt: decision.decidedAt,
        message: error instanceof Error ? error.message : String(error)
      });
      await filesystemReviewStore.markApplied({
        context: args.runContext,
        reviewId: decision.reviewId,
        checkpointSequence: decision.checkpointSequence ?? reconciledState.lastCheckpointSequence,
        appliedAt: decision.appliedAt ?? new Date().toISOString()
      });
      await filesystemReviewStore.markReconciled({ context: args.runContext, reviewId: decision.reviewId });
      continue;
    }
    const checkpoint = await filesystemCheckpointStore.persist({
      context: args.runContext,
      roleId: pendingReview.roleId,
      branchId: pendingReview.branchId,
      loopIteration: pendingReview.loopIteration,
      executionId: pendingReview.executionId,
      update: transitionPlan.update,
      expectedStateVersion: reconciledState.stateVersion,
      resultingStateVersion: reconciledState.stateVersion + 1,
      irDigest: semanticDigestForPlan(args.plan),
      eventId: `${args.runContext.runId}:${pendingReview.executionId}:${reconciledState.stateVersion + 1}`,
      idempotencyKey: `${args.runContext.runId}:${pendingReview.executionId}:${reconciledState.stateVersion + 1}`
    });
    await args.runtimeServices?.checkpointStore.append(checkpoint);
    for (const [eventIndex, event] of transitionPlan.events.entries()) {
      const eventId = `human_review_decision:${decision.reviewId}:${decision.decidedAt}:${eventIndex}`;
      await appendEvent(args.runContext, {
        ...event,
        eventId
      });
    }
    // Review decision events are part of the durable control-plane audit. Flush them before the
    // state frontier is committed so a crash after state commit cannot leave a resolved decision
    // without its corresponding audit record.
    await flushBufferedRunArtifacts(args.runContext);
    if (transitionPlan.update.resultCommit?.status === "committed") {
      await ensureResultCommitEvent({ context: args.runContext, resultCommit: transitionPlan.update.resultCommit, roleId: pendingReview.roleId, stateVersion: reconciledState.stateVersion + 1 });
    }
    const stateCommit = args.runtimeServices
      ? await args.runtimeServices.stateStore.commit({
          runId: args.runContext.runId,
          expectedStateVersion: reconciledState.stateVersion,
          eventId: checkpoint.eventId ?? `${args.runContext.runId}:${checkpoint.executionId}:${reconciledState.stateVersion + 1}`,
          idempotencyKey: checkpoint.idempotencyKey ?? `${args.runContext.runId}:${checkpoint.executionId}:${reconciledState.stateVersion + 1}`,
          checkpointSequence: checkpoint.checkpointSequence,
          update: { ...checkpoint.update, lastCheckpointSequence: checkpoint.checkpointSequence }
        })
      : undefined;
    const effectiveUpdate = stateCommit
      ? { ...checkpoint.update, stateVersion: stateCommit.snapshot.state.stateVersion, lastEventId: checkpoint.eventId }
      : checkpoint.update;
    reconciledState = stateCommit?.snapshot.state ?? applyGraphUpdate(reconciledState, effectiveUpdate);
    indexes = applyGraphUpdateToIndexes(indexes, effectiveUpdate);
    // Commit the state frontier before marking the control-plane decision consumed. If the
    // process stops in this window, resume replays the checkpoint and then reconciles the
    // still-unmarked decision from the already-resolved review state.
    maybeCrashAfterHumanReviewStateCommit();
    await filesystemReviewStore.markApplied({
      context: args.runContext,
      reviewId: decision.reviewId,
      checkpointSequence: checkpoint.checkpointSequence,
      appliedAt: new Date().toISOString(),
      reconciledAt: new Date().toISOString()
    });
    await filesystemReviewStore.markReconciled({
      context: args.runContext,
      reviewId: decision.reviewId
    });
  }

  return {
    state: reconciledState,
    indexes
  };
}

async function writeRunSummary(args: {
  state: GraphState;
  runContext: RunContext;
  content: string;
}): Promise<void> {
  try {
    await writeAtomicFile(resolve(args.runContext.auditDir, "summary.md"), args.content);
  } catch (error) {
    throw createRuntimeError(
      normalizeRuntimeError(error, {
        errorCode: "RUNTIME_SUMMARY_WRITE_FAILED",
        errorCategory: "io",
        stage: "execute",
        retryable: false,
        runId: args.runContext.runId,
        roleId: args.state.lastExecutedRoleId || undefined
      })
    );
  }
}

function toGanttLabel(value: string): string {
  return value.replace(/[^a-zA-Z0-9._/@-]+/g, "_");
}

function buildGanttSection(auditTrail: AuditRecord[]): string[] {
  if (auditTrail.length === 0) {
    return [];
  }
  if (auditTrail.length > GANTT_RENDER_LIMIT) {
    return [
      "",
      "## Execution Timeline",
      "",
      `- skipped: transition count (${auditTrail.length}) exceeds render limit (${GANTT_RENDER_LIMIT}).`
    ];
  }

  const lines = [
    "",
    "## Execution Timeline",
    "",
    "```mermaid",
    "gantt",
    "  title Logical Transition Timeline",
    "  dateFormat  YYYY-MM-DDTHH:mm:ss.SSSZ",
    "  axisFormat  %H:%M:%S",
    "  section transitions"
  ];

  let stepIndex = 0;
  for (const audit of auditTrail) {
    const startedAt = new Date(audit.at);
    if (Number.isNaN(startedAt.getTime())) {
      continue;
    }
    const endedAt = new Date(startedAt.getTime() + Math.max(1, audit.durationMs));
    const eventLabel = audit.selectedEvent ? `/${toGanttLabel(audit.selectedEvent)}` : "";
    const taskLabel = `${toGanttLabel(audit.roleId)}${eventLabel}(${audit.status})`;
    lines.push(
      `  ${taskLabel} :t${stepIndex}, ${startedAt.toISOString()}, ${endedAt.toISOString()}`
    );
    stepIndex += 1;
  }

  if (stepIndex === 0) {
    return [];
  }
  lines.push("```");
  lines.push("");
  lines.push("- note: timeline is for troubleshooting sequence visibility, not backend compute parallelism.");
  return lines;
}

async function cleanupExecutionHistory(args: {
  state: GraphState;
  runContext: RunContext;
  keepLatest: number;
  failOnError: boolean;
  trigger: "manual" | "retention";
  triggerThreshold?: number;
}): Promise<void> {
  const startedAt = new Date();
  const executionDirCountBefore = args.runContext.executionDirCount;
  try {
    const result = await cleanupHistoricalExecutionSnapshots({
      context: args.runContext,
      keepLatest: args.keepLatest
    });
    const endedAt = new Date();
    await appendEvent(args.runContext, {
      type: "execution_history_cleanup",
      at: endedAt.toISOString(),
      status: "ok",
      trigger: args.trigger,
      triggerThreshold: args.triggerThreshold,
      keepLatest: args.keepLatest,
      durationMs: endedAt.getTime() - startedAt.getTime(),
      executionDirCountBefore: result.executionDirCountBefore,
      executionDirCountAfter: result.executionDirCountAfter,
      removedExecutionDirCount: result.removedExecutionDirCount
    });
  } catch (error) {
    const envelope = normalizeRuntimeError(error, {
      errorCode: "RUNTIME_EXECUTION_HISTORY_CLEANUP_FAILED",
      errorCategory: "io",
      stage: "execute",
      retryable: false,
      runId: args.runContext.runId,
      roleId: args.state.lastExecutedRoleId || undefined
    });
    const endedAt = new Date();
    await appendEvent(args.runContext, {
      type: "execution_history_cleanup",
      at: endedAt.toISOString(),
      status: "failed",
      trigger: args.trigger,
      triggerThreshold: args.triggerThreshold,
      keepLatest: args.keepLatest,
      durationMs: endedAt.getTime() - startedAt.getTime(),
      executionDirCountBefore,
      executionDirCountAfter: args.runContext.executionDirCount,
      errorCode: envelope.errorCode,
      message: envelope.message
    });
    await flushBufferedRunArtifacts(args.runContext);
    if (args.failOnError) {
      throw createRuntimeError(envelope);
    }
  } finally {
    await flushBufferedRunArtifacts(args.runContext);
  }
}

async function persistAfterCleanup(args: {
  state: GraphState;
  plan: ExecutionPlan;
  runContext: RunContext;
  keepLatest: number;
  failOnError: boolean;
  trigger: "manual" | "retention";
  triggerThreshold?: number;
}): Promise<void> {
  await cleanupExecutionHistory({
    state: args.state,
    runContext: args.runContext,
    keepLatest: args.keepLatest,
    failOnError: args.failOnError,
    trigger: args.trigger,
    triggerThreshold: args.triggerThreshold
  });
  await persistProjectedState({ state: args.state, plan: args.plan, runContext: args.runContext });
}

/**
 * The synthetic scheduler node keeps graph control flow centralized. Role nodes only execute
 * their active branches, emit state updates, and hand control back so scheduling decisions
 * stay in one place.
 */
export async function runSystemWithGraphRunner(args: RunnerInput): Promise<AdapterRunResult> {
  if (args.runtimeServices) {
    runtimeServicesByContext.set(args.runContext, args.runtimeServices);
  }
  const validatedAuditAppend = args.runtimeServices
    ? createValidatedAuditAppender(args.runContext, args.runtimeServices.audit.append)
    : undefined;
  if (args.gitCollaboration) {
    const probe = await args.gitCollaboration.collaboration.probe(args.workdir);
    if (!probe.supported) {
      const reason = probe.reason ?? "UNSUPPORTED_REPOSITORY";
      await appendEvent(args.runContext, {
        type: "git_collaboration_probe_failed",
        at: new Date().toISOString(),
        reason,
        repositoryRoot: probe.repositoryRoot,
        workspaceRelativePath: probe.workspaceRelativePath
      }).catch(() => undefined);
      throw new Error(`GIT_COLLABORATION_UNSUPPORTED: ${reason}`);
    }
  }
  const logger = createRunConsoleLogger(args.logRun);
  const runControl = args.runControl ?? new RunControl();
  const initialState = args.initialState ?? createInitialGraphState({ plan: args.plan, prompt: args.prompt, runId: args.runContext.runId });
  let runtimeIndexes = buildRuntimeIndexes(initialState);
  const gitRoleCommitsByBranchId = new Map<string, GitRoleCommit>();
  const gitRoleExecutionSucceededByBranchId = new Map<string, boolean>();
  const gitMergeResults: GitMergeResult[] = [];
  const sameStringArray = (left: unknown, right: string[]): boolean => Array.isArray(left)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
  const sameCandidateCommits = (left: unknown, right: string[]): boolean => {
    if (!sameStringArray(left, right)) return false;
    const leftValues = left as string[];
    return new Set(leftValues).size === leftValues.length && new Set(right).size === right.length;
  };
  if (args.gitCollaboration) {
    const persistedEvents = await readFile(args.runContext.eventsPath, "utf8").catch(() => "");
    for (const line of persistedEvents.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type !== "git_collaboration_role_commit" && event.type !== "git_collaboration_role_result") continue;
        const branchId = typeof event.branchId === "string" ? event.branchId : undefined;
        const roleId = typeof event.roleId === "string" ? event.roleId : undefined;
        const executionId = typeof event.executionId === "string" ? event.executionId : undefined;
        const branch = typeof event.branch === "string" ? event.branch : undefined;
        const path = typeof event.path === "string" ? event.path : undefined;
        const baseCommit = typeof event.baseCommit === "string" ? event.baseCommit : undefined;
        const resultCommit = typeof event.resultCommit === "string" ? event.resultCommit : undefined;
        const changedPaths = Array.isArray(event.changedPaths) && event.changedPaths.every((item) => typeof item === "string")
          ? event.changedPaths as string[]
          : undefined;
        const isContentCommit = event.type === "git_collaboration_role_commit";
        const workspaceRefs = Array.isArray(event.workspaceRefs)
          ? event.workspaceRefs.flatMap((item) => {
              try { assertWorkspaceRef(item); return [item as WorkspaceRef]; } catch { return []; }
            })
          : [];
        const lfsObjectIds = Array.isArray(event.lfsObjectIds) && event.lfsObjectIds.every((item) => typeof item === "string")
          ? event.lfsObjectIds as string[]
          : [];
        if (event.ogsContractVersion !== 2 || event.schemaVersion !== 1 || !branchId || !roleId || !executionId || !branch || !path || !baseCommit || !resultCommit || !changedPaths
          || (isContentCommit && (changedPaths.length === 0 || !event.provenance))
          || (!isContentCommit && (changedPaths.length !== 0 || resultCommit !== baseCommit))) continue;
        const commit: GitRoleCommit = {
          roleId,
          executionId,
          branch,
          path,
          baseCommit,
          resultCommit,
          changedPaths,
          workspaceRefs,
          lfsObjectIds,
          provenance: {
            ogsContractVersion: 2,
            schemaVersion: 1,
            version: 1,
            kind: "role-commit",
            runId: args.runContext.runId,
            roleId,
            executionId,
            baseCommit,
            resultCommit,
            changedPaths
          }
        };
        if (isContentCommit) await args.gitCollaboration.collaboration.registerRoleCommit(commit);
        gitRoleCommitsByBranchId.set(branchId, commit);
        gitRoleExecutionSucceededByBranchId.set(branchId, true);
      } catch {
        // Ignore unrelated or malformed historical lines; normal graph recovery handles them.
      }
    }
    for (const line of persistedEvents.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type !== "git_collaboration_merge") continue;
        const mergeId = typeof event.mergeId === "string" ? event.mergeId : undefined;
        const path = typeof event.path === "string" ? event.path : undefined;
        const branch = typeof event.branch === "string" ? event.branch : undefined;
        const baseCommit = typeof event.baseCommit === "string" ? event.baseCommit : undefined;
        const status = event.status === "merged" || event.status === "conflict" ? event.status : undefined;
        const candidateCommits = Array.isArray(event.candidateCommits) && event.candidateCommits.every((item) => typeof item === "string")
          ? event.candidateCommits as string[]
          : undefined;
        const conflictPaths = Array.isArray(event.conflictPaths) && event.conflictPaths.every((item) => typeof item === "string")
          ? event.conflictPaths as string[]
          : undefined;
        const mergeCommit = typeof event.mergeCommit === "string" ? event.mergeCommit : undefined;
        const provenance = event.provenance && typeof event.provenance === "object" ? event.provenance as Record<string, unknown> : undefined;
        const provenanceCandidateCommits = provenance?.candidateCommits;
        const provenanceConflictPaths = provenance?.conflictPaths;
        const provenanceMergeCommit = typeof provenance?.mergeCommit === "string" ? provenance.mergeCommit : undefined;
        if (!mergeId || !path || !branch || !baseCommit || !status || !candidateCommits || !conflictPaths
          || (status === "merged" && !mergeCommit)
          || provenance?.ogsContractVersion !== 2
          || provenance?.schemaVersion !== 1
          || provenance?.version !== 1
          || provenance.kind !== "merge"
          || provenance.runId !== args.runContext.runId
          || provenance.mergeId !== mergeId
          || provenance.baseCommit !== baseCommit
          || provenance.status !== status
          || !sameStringArray(provenanceCandidateCommits, candidateCommits)
          || !sameStringArray(provenanceConflictPaths, conflictPaths)
          || provenanceMergeCommit !== mergeCommit) continue;
        gitMergeResults.push({
          mergeId,
          path,
          branch,
          baseCommit,
          candidateCommits,
          status,
          ...(mergeCommit ? { mergeCommit } : {}),
          conflictPaths,
          provenance: {
            ogsContractVersion: 2,
            schemaVersion: 1,
            version: 1,
            kind: "merge",
            runId: args.runContext.runId,
            mergeId,
            baseCommit,
            candidateCommits,
            status,
            ...(mergeCommit ? { mergeCommit } : {}),
            conflictPaths
          }
        });
      } catch {
        // Ignore unrelated or malformed historical lines; normal graph recovery handles them.
      }
    }
  }
  const persistGitRoleCommit = async (branchId: string, commit: GitRoleCommit): Promise<WorkspaceRef[]> => {
    gitRoleCommitsByBranchId.set(branchId, commit);
    const hasContentCommit = commit.changedPaths.length > 0;
    await appendEvent(args.runContext, {
      type: hasContentCommit ? "git_collaboration_role_commit" : "git_collaboration_role_result",
      eventId: `${hasContentCommit ? "git-role-commit" : "git-role-result"}:${branchId}:${commit.executionId}`,
      at: new Date().toISOString(),
      branchId,
      roleId: commit.roleId,
      executionId: commit.executionId,
      branch: commit.branch,
      path: commit.path,
      baseCommit: commit.baseCommit,
      resultCommit: commit.resultCommit,
      changedPaths: commit.changedPaths,
      workspaceRefs: commit.workspaceRefs,
      lfsObjectIds: commit.lfsObjectIds,
      ...(hasContentCommit ? { provenance: commit.provenance } : {})
    });
    const checkpointDir = resolve(args.runContext.runDir, "workspace", "checkpoints");
    const worktreeId = `${commit.roleId}:${commit.executionId}`;
    const preparedNames = await readdir(checkpointDir).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    });
    let preparedCheckpoint: WorkspaceCheckpoint | undefined;
    for (const name of preparedNames.filter((item) => item.startsWith("prepared-") && item.endsWith(".json"))) {
      const candidate = JSON.parse(await readFile(resolve(checkpointDir, name), "utf8")) as WorkspaceCheckpoint;
      if (candidate.runId === args.runContext.runId && candidate.worktreeId === worktreeId && candidate.branch === commit.branch) {
        assertWorkspaceCheckpoint(candidate);
        preparedCheckpoint = candidate;
        break;
      }
    }
    const checkpoint: WorkspaceCheckpoint = {
      ...(preparedCheckpoint ?? {}),
      ogsContractVersion: 2,
      schemaVersion: 1,
      runId: args.runContext.runId,
      nodeId: commit.roleId,
      attempt: preparedCheckpoint?.attempt ?? 1,
      status: "completed",
      worktreeId,
      branch: commit.branch,
      baseCommit: commit.baseCommit,
      ...(hasContentCommit ? { roleCommit: commit.resultCommit } : {}),
      changedPaths: commit.changedPaths,
      branchId: preparedCheckpoint?.branchId ?? branchId,
      lineageId: preparedCheckpoint?.lineageId ?? branchId,
      round: preparedCheckpoint?.round ?? 1,
      loopIteration: preparedCheckpoint?.loopIteration ?? 1,
      stateVersion: preparedCheckpoint?.stateVersion ?? 0,
      decisionBackground: preparedCheckpoint?.decisionBackground ?? {},
      evidenceRefs: hasContentCommit ? [commit.resultCommit] : []
    };
    assertWorkspaceCheckpoint(checkpoint);
    await mkdir(checkpointDir, { recursive: true });
    await writeAtomicFile(resolve(checkpointDir, `${branchId}-${commit.executionId}.json`), stringifyJson(checkpoint));
    if (hasContentCommit) {
      const workspaceEvent = await args.gitCollaboration?.onRoleCommit?.(branchId, commit);
      if (workspaceEvent) {
        await appendWorkspaceEvent(args.runContext, workspaceEvent);
      } else {
        await appendEvent(args.runContext, {
          type: "result_committed",
          eventId: `result_committed:${args.runContext.runId}:${branchId}:${commit.resultCommit}`,
          at: new Date().toISOString(),
          nodeId: commit.roleId,
          roleId: commit.roleId,
          runId: args.runContext.runId,
          baseCommit: commit.baseCommit,
          resultCommit: commit.resultCommit,
          changedPaths: commit.changedPaths,
          lfsObjectIds: commit.lfsObjectIds,
          decisionBackground: checkpoint.decisionBackground,
          evidenceRefs: checkpoint.evidenceRefs
        });
      }
    } else {
      await appendEvent(args.runContext, {
        type: "result_committed",
        eventId: `result_committed:${args.runContext.runId}:${branchId}:${commit.executionId}`,
        at: new Date().toISOString(),
        resultId: `result:${args.runContext.runId}:${branchId}:${commit.executionId}`,
        roleId: commit.roleId,
        runId: args.runContext.runId,
        stateVersion: checkpoint.stateVersion + 1
      });
    }
    return commit.workspaceRefs;
  };
  const persistPreparedGitRoleCheckpoint = async (checkpointArgs: {
    roleId: string;
    branch: BranchRecord;
    attempt: number;
    execution: { executionId: string };
    worktree: GitRoleWorktree;
    stateVersion: number;
  }): Promise<void> => {
    const checkpoint: WorkspaceCheckpoint = {
      ogsContractVersion: 2,
      schemaVersion: 1,
      runId: args.runContext.runId,
      nodeId: checkpointArgs.roleId,
      attempt: checkpointArgs.attempt,
      status: "prepared",
      worktreeId: `${checkpointArgs.roleId}:${checkpointArgs.execution.executionId}`,
      branch: checkpointArgs.worktree.branch,
      baseCommit: checkpointArgs.worktree.baseCommit,
      changedPaths: [],
      branchId: checkpointArgs.branch.branchId,
      lineageId: checkpointArgs.branch.lineageId,
      round: 1,
      loopIteration: checkpointArgs.branch.loopIteration,
      stateVersion: checkpointArgs.stateVersion,
      decisionBackground: {},
      evidenceRefs: []
    };
    assertWorkspaceCheckpoint(checkpoint);
    const serialized = stringifyJson(checkpoint);
    const digest = createHash("sha256").update(serialized, "utf8").digest("hex").slice(0, 16);
    const checkpointPath = resolve(args.runContext.runDir, "workspace", "checkpoints", `prepared-${checkpointArgs.branch.branchId}-${checkpointArgs.execution.executionId}-${digest}.json`);
    await mkdir(resolve(checkpointPath, ".."), { recursive: true });
    const existing = await readFile(checkpointPath, "utf8").catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (existing !== undefined) {
      if (existing !== serialized) throw new Error("WORKSPACE_CHECKPOINT_INVALID: prepared checkpoint identity collision");
      return;
    }
    await writeAtomicFile(checkpointPath, serialized);
  };
  const prepareNewGitRoleWorktree = async (checkpointArgs: {
    roleId: string;
    branch: BranchRecord;
    attempt: number;
    execution: { executionId: string };
    baseCommit: string;
    stateVersion: number;
  }): Promise<GitRoleWorktree> => {
    const worktree = await args.gitCollaboration!.collaboration.addWorktree({
      roleId: checkpointArgs.roleId,
      executionId: checkpointArgs.execution.executionId,
      baseCommit: checkpointArgs.baseCommit
    });
    try {
      await persistPreparedGitRoleCheckpoint({ ...checkpointArgs, worktree });
      return worktree;
    } catch (error) {
      await args.gitCollaboration!.collaboration.removeWorktree(worktree.path, true).catch(() => undefined);
      throw error;
    }
  };
  if (args.gitCollaboration && args.initialState) {
    const checkpointDir = resolve(args.runContext.runDir, "workspace", "checkpoints");
    const checkpointNames = await readdir(checkpointDir).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    });
    const stalePrepared: Array<{ checkpoint: WorkspaceCheckpoint; executionId: string }> = [];
    for (const name of checkpointNames.filter((item) => item.startsWith("prepared-") && item.endsWith(".json"))) {
      const checkpoint = JSON.parse(await readFile(resolve(checkpointDir, name), "utf8")) as WorkspaceCheckpoint;
      assertWorkspaceCheckpoint(checkpoint);
      if (checkpoint.runId !== args.runContext.runId || checkpoint.status !== "prepared") continue;
      if (checkpoint.worktreeId !== `${checkpoint.nodeId}:${checkpoint.worktreeId.slice(checkpoint.nodeId.length + 1)}`) {
        throw new Error("WORKSPACE_CHECKPOINT_INVALID: prepared worktree identity mismatch");
      }
      const executionId = checkpoint.worktreeId.slice(checkpoint.nodeId.length + 1);
      if (!checkpoint.branch.startsWith(`ogs/${args.runContext.runId}/role/`)
        && !checkpoint.branch.startsWith(`ogs/${args.runContext.runId}/merge/`)) continue;
      const loggedCommit = Array.from(gitRoleCommitsByBranchId.values()).find((commit) =>
        commit.roleId === checkpoint.nodeId && commit.executionId === executionId
      );
      const recoveredCommit = loggedCommit ?? await args.gitCollaboration.collaboration.recoverPreparedRoleCommit({
          roleId: checkpoint.nodeId,
          executionId,
          branch: checkpoint.branch,
          baseCommit: checkpoint.baseCommit
        });
      if (recoveredCommit) {
        if (recoveredCommit.branch !== checkpoint.branch || recoveredCommit.baseCommit !== checkpoint.baseCommit) {
          throw new Error("WORKSPACE_PREPARED_COMMIT_IDENTITY_MISMATCH");
        }
        // Re-run the idempotent persistence boundary even when the generic Git
        // event was already logged. A crash can occur after that event and
        // before the checkpoint, coordinator provenance, or workspace event.
        // appendEvent and the checkpoint/coordinator stores deduplicate their
        // stable identities while restoring any missing side effects.
        await persistGitRoleCommit(checkpoint.branchId, recoveredCommit);
        const roleDirs = args.runContext.roleDirsById.get(checkpoint.nodeId);
        if (!roleDirs) throw new Error(`Role run directory missing for "${checkpoint.nodeId}"`);
        const executionDir = resolve(roleDirs.executionsDir, executionId);
        const candidate = await loadRoleExecutionCandidateRecord(executionDir);
        if (candidate) {
          if (candidate.execution.executionId !== executionId
            || candidate.execution.roleId !== checkpoint.nodeId
            || candidate.execution.branchId !== checkpoint.branchId
            || candidate.execution.executionDir !== executionDir
            || candidate.branch.roleId !== checkpoint.nodeId
            || candidate.branch.branchId !== checkpoint.branchId
            || candidate.branch.lineageId !== checkpoint.lineageId
            || candidate.branch.loopIteration !== checkpoint.loopIteration
            || candidate.audit.attempt !== checkpoint.attempt
            || candidate.audit.executionId !== executionId
            || candidate.audit.roleId !== checkpoint.nodeId
            || candidate.audit.branchId !== checkpoint.branchId
            || candidate.audit.status !== "ok"
            || candidate.output.event !== candidate.audit.selectedEvent) {
            throw new Error("WORKSPACE_EXECUTION_CANDIDATE_IDENTITY_MISMATCH");
          }
          const existingOutcome = await readFile(resolve(executionDir, "execution-outcome.json"), "utf8").catch((error: unknown) => {
            if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
            throw error;
          });
          if (existingOutcome === undefined) {
            const storedResult: StoredRoleResult = {
              roleId: candidate.execution.roleId,
              event: candidate.output.event,
              content: candidate.output.content,
              data: candidate.output.data,
              ...(recoveredCommit.workspaceRefs.length ? { workspaceRefs: recoveredCommit.workspaceRefs } : {}),
              branchId: candidate.branch.branchId,
              lineageId: candidate.branch.lineageId,
              loopIteration: candidate.branch.loopIteration,
              provenance: {
                runId: args.runContext.runId,
                executionId,
                producerRoleId: candidate.execution.roleId,
                branchId: candidate.branch.branchId,
                lineageId: candidate.branch.lineageId,
                loopIteration: candidate.branch.loopIteration
              }
            };
            const result = {
              status: "ok" as const,
              audit: candidate.audit,
              storedResult,
              selectedEvent: candidate.output.event,
              executionId,
              branchId: candidate.branch.branchId,
              loopIteration: candidate.branch.loopIteration
            };
            await recordRoleResult({
              roleId: checkpoint.nodeId,
              context: args.runContext,
              execution: candidate.execution,
              output: candidate.output,
              audit: candidate.audit
            });
            await persistCommittedExecutionResult({ execution: candidate.execution, branch: candidate.branch, result });
            await recordAudit({
              context: args.runContext,
              audit: candidate.audit,
              executionId,
              append: validatedAuditAppend
            });
          }
          await removeRoleExecutionCandidateRecord(executionDir);
        }
      } else {
        const roleDirs = args.runContext.roleDirsById.get(checkpoint.nodeId);
        if (roleDirs) await removeRoleExecutionCandidateRecord(resolve(roleDirs.executionsDir, executionId));
        stalePrepared.push({ checkpoint, executionId });
      }
    }
    if (stalePrepared.length) {
      const collaboration = args.gitCollaboration.collaboration;
      const probe = await collaboration.probe(args.workdir);
      if (!probe.head) throw new Error("GIT_COLLABORATION_CANONICAL_HEAD_UNAVAILABLE");
      const claim = await acquireCanonicalWorkspaceLock({
        workspaceDir: args.workdir,
        workspaceId: collaboration.workspaceId,
        owner: `resume-cleanup-${args.runContext.runId}`,
        expectedCanonicalHead: probe.head,
        currentCanonicalHead: probe.head
      });
      try {
        for (const { checkpoint, executionId } of stalePrepared) {
          await collaboration.discardPreparedWorktree({
            roleId: checkpoint.nodeId,
            executionId,
            branch: checkpoint.branch,
            baseCommit: checkpoint.baseCommit,
            workspaceDir: args.workdir,
            expectedCanonicalHead: probe.head,
            lock: claim.lock
          });
        }
      } finally {
        await claim.release();
      }
    }
  }
  const persistGitMerge = async (merge: GitMergeResult, phase: "join" | "final", verification?: { passed: boolean; reason?: string }): Promise<void> => {
    await appendEvent(args.runContext, {
      type: "git_collaboration_merge",
      eventId: `git-merge:${phase}:${merge.mergeId}`,
      at: new Date().toISOString(),
      phase,
      status: merge.status,
      mergeId: merge.mergeId,
      path: merge.path,
      branch: merge.branch,
      baseCommit: merge.baseCommit,
      candidateCommits: merge.candidateCommits,
      mergeCommit: merge.mergeCommit,
      conflictPaths: merge.conflictPaths,
      provenance: merge.provenance,
      ...(verification ? { verification } : {})
    });
    const workspaceEvent = await args.gitCollaboration?.onMerge?.(merge, phase);
    if (workspaceEvent) {
      await appendWorkspaceEvent(args.runContext, workspaceEvent);
    } else {
      const contractEventType = merge.status === "conflict" ? "join_conflict" : "workspace_integrated";
      await appendEvent(args.runContext, {
        type: contractEventType,
        eventId: `${contractEventType}:${merge.mergeId}`,
        at: new Date().toISOString(),
        phase,
        mergeId: merge.mergeId,
        baseCommit: merge.baseCommit,
        candidateCommits: merge.candidateCommits,
        ...(merge.status === "merged" ? { mergeCommit: merge.mergeCommit } : {}),
        conflictPaths: merge.conflictPaths,
        provenance: merge.provenance
      });
    }
  };
  const latestGitMerge = (predicate: (merge: GitMergeResult) => boolean): GitMergeResult | undefined => {
    for (let index = gitMergeResults.length - 1; index >= 0; index -= 1) {
      if (predicate(gitMergeResults[index])) return gitMergeResults[index];
    }
    return undefined;
  };
  const verifyGitMerge = async (merge: GitMergeResult): Promise<GitMergeVerification> => args.gitCollaboration!.collaboration.verifyMergeWorktree(
    merge.path,
    merge.baseCommit,
    {
      mergeId: merge.mergeId,
      branch: merge.branch,
      mergeCommit: merge.mergeCommit,
      candidateCommits: merge.candidateCommits
    }
  );
  const selectFinalGitCommits = async (state: GraphState): Promise<string[]> => {
    const entries = Array.from(gitRoleCommitsByBranchId.entries())
      .filter(([branchId]) => gitRoleExecutionSucceededByBranchId.get(branchId) === true)
      .map(([branchId, commit]) => ({ branchId, commit }))
      .sort((left, right) => {
        const leftSequence = state.branchRecords[left.branchId]?.branchSequence ?? Number.MAX_SAFE_INTEGER;
        const rightSequence = state.branchRecords[right.branchId]?.branchSequence ?? Number.MAX_SAFE_INTEGER;
        return leftSequence - rightSequence || left.branchId.localeCompare(right.branchId);
      });
    const entryByBranchId = new Map(entries.map((entry) => [entry.branchId, entry]));
    const branchHasCommittedDescendant = (branchId: string): boolean => entries.some((entry) => {
      if (entry.branchId === branchId) return false;
      const visited = new Set<string>();
      let current = state.branchRecords[entry.branchId];
      while (current?.parentBranchId && !visited.has(current.parentBranchId)) {
        if (current.parentBranchId === branchId) return true;
        visited.add(current.parentBranchId);
        current = state.branchRecords[current.parentBranchId];
      }
      return false;
    });
    const leaves = entries.filter((entry) => !branchHasCommittedDescendant(entry.branchId));
    const chainForLeaf = (leafBranchId: string): Array<{ branchId: string; commit: GitRoleCommit }> => {
      const chain: Array<{ branchId: string; commit: GitRoleCommit }> = [];
      const visited = new Set<string>();
      let currentBranchId: string | undefined = leafBranchId;
      while (currentBranchId && !visited.has(currentBranchId)) {
        visited.add(currentBranchId);
        const entry = entryByBranchId.get(currentBranchId);
        if (entry) chain.push(entry);
        currentBranchId = state.branchRecords[currentBranchId]?.parentBranchId;
      }
      return chain;
    };
    const leafChains = leaves.map((leaf) => ({ leaf, chain: chainForLeaf(leaf.branchId) }));
    const selected: string[] = [];
    for (const entry of entries) {
      let superseded = false;
      for (const { leaf, chain } of leafChains) {
        if (leaf.branchId === entry.branchId) continue;
        const entryIndex = chain.findIndex((ancestor) => ancestor.branchId === entry.branchId);
        const hasChangedDescendant = entryIndex > 0 && chain
          .slice(0, entryIndex)
          .some((descendant) => descendant.commit.changedPaths.length > 0);
        if (entryIndex >= 0 && hasChangedDescendant) {
          superseded = true;
          break;
        }
        for (const ancestor of chain) {
          if (ancestor.branchId === entry.branchId) continue;
          if (entry.commit.resultCommit !== ancestor.commit.resultCommit
            && await args.gitCollaboration!.collaboration.isCommitAncestor(entry.commit.resultCommit, ancestor.commit.resultCommit)) {
            superseded = true;
            break;
          }
        }
        if (superseded) break;
      }
      if (!superseded && !selected.includes(entry.commit.resultCommit)) selected.push(entry.commit.resultCommit);
    }
    const baseCommit = args.gitCollaboration!.baseCommit;
    const selectedWithoutBase = selected.filter((commit) => commit !== baseCommit);
    if (selectedWithoutBase.length > 0) return selectedWithoutBase;

    // A serial no-content-change child can point at the frozen base even when
    // its parent Role produced the only real Workspace commit. Preserve that
    // content commit instead of publishing the base-only candidate set.
    const substantiveEntries = entries.filter((entry) => entry.commit.resultCommit !== baseCommit
      && entry.commit.changedPaths.length > 0);
    const substantive = [] as string[];
    for (const entry of substantiveEntries) {
      let superseded = false;
      for (const other of substantiveEntries) {
        if (other.commit.resultCommit === entry.commit.resultCommit || other.commit.resultCommit === baseCommit) continue;
        if (await args.gitCollaboration!.collaboration.isCommitAncestor(entry.commit.resultCommit, other.commit.resultCommit)) {
          superseded = true;
          break;
        }
      }
      if (!superseded && !substantive.includes(entry.commit.resultCommit)) substantive.push(entry.commit.resultCommit);
    }
    return substantive.length > 0 ? substantive : selected;
  };
  if (initialState.stateVersion === 0) {
    for (const roleId of initialState.selectedEntryRoleIds) {
      const branch = Object.values(initialState.branchRecords).find((candidate) => candidate.roleId === roleId);
      const edgeId = runtimeEdgeId(SYSTEM_START_ROLE_ID, "START", roleId, args.runtimeEdgeIdsByTransition);
      await appendEvent(args.runContext, {
        type: "flow.activated",
        at: new Date().toISOString(),
        handoffId: buildHandoffId({
          runId: args.runContext.runId,
          branchId: branch?.branchId || roleId,
          lineageId: branch?.lineageId || branch?.branchId || roleId,
          sourceExecutionId: "start",
          sourceAttempt: 1,
          edgeId,
          loopIteration: branch?.loopIteration ?? 1
        }),
        edgeId,
        sourceExecutionId: "start",
        sourceAttempt: 1,
        fromRoleId: SYSTEM_START_ROLE_ID,
        toRoleId: roleId,
        eventType: "START",
        branchId: branch?.branchId,
        lineageId: branch?.lineageId || branch?.branchId || roleId,
        loopIteration: 1
      });
    }
  }
  const graphBuilder = new StateGraph(GraphStateAnnotation) as StateGraph<
    typeof GraphStateAnnotation.spec,
    GraphState,
    GraphUpdate,
    string
  >;

  graphBuilder.addNode(SCHEDULER_NODE_ID, async () => ({}));

  for (const roleId of args.plan.roleIds) {
    const node = getExecutionPlanNode(args.plan, roleId);
    const roleNodeTimeoutMs = resolveRoleNodeTimeoutMs(node, args.profilesById);
    graphBuilder.addNode(roleId, async (state: GraphState, config?: LangGraphRunnableConfig) => {
      const activeBranches = listActiveBranches(state, roleId, runtimeIndexes);
      if (activeBranches.length === 0) {
        return {};
      }

      let workingState = state;
      let combinedUpdate: GraphUpdate = {};

      // One branch per node attempt keeps LangGraph's timeout scoped to one role execution.
      const branch = activeBranches[0];
      let joinMerge: GitMergeResult | undefined;
      if (args.gitCollaboration?.collaboration && node.joinMode) {
        const sourceCommitEntries = node.joinSources.flatMap((sourceRoleId) => Object.values(workingState.branchRecords)
          .filter((candidate) => candidate.roleId === sourceRoleId
            && candidate.lineageId === branch.lineageId
            && candidate.loopIteration === branch.loopIteration)
          .map((candidate) => ({
            sourceRoleId,
            commit: gitRoleCommitsByBranchId.get(candidate.branchId)?.resultCommit
          }))
          .filter((entry): entry is { sourceRoleId: string; commit: string } => Boolean(entry.commit)));
        const sourceCommits = sourceCommitEntries.map((entry) => entry.commit);
        const uniqueCandidates = [...new Set(sourceCommits)];
        const resolvedSourceCount = new Set(sourceCommitEntries.map((entry) => entry.sourceRoleId)).size;
        const sourcesReadyForMerge = node.joinMode === "quorum_of"
          ? resolvedSourceCount >= Math.max(1, node.joinMin ?? 1)
          : resolvedSourceCount === node.joinSources.length;
        if (sourcesReadyForMerge && uniqueCandidates.length > 0) {
          const mergeId = `${roleId}-${branch.branchId}`.replace(/[^a-z0-9._-]/gi, "-").slice(0, 70);
          const persistedMerge = latestGitMerge((item) => item.mergeId === mergeId
            && item.baseCommit === args.gitCollaboration!.baseCommit
            && sameCandidateCommits(item.candidateCommits, uniqueCandidates));
          joinMerge = persistedMerge;
          if (joinMerge?.status === "merged") {
            try {
              const verification = await verifyGitMerge(joinMerge);
              if (!verification.passed) throw new Error(`GIT_COLLABORATION_MERGE_VERIFICATION_FAILED: ${verification.reason ?? "unknown"}`);
            } catch {
              joinMerge = undefined;
            }
          }
          if (joinMerge?.status === "conflict") joinMerge = undefined;
          if (!joinMerge) {
            joinMerge = await args.gitCollaboration.collaboration.mergeCommits({
              mergeId,
              baseCommit: args.gitCollaboration.baseCommit,
              candidateCommits: uniqueCandidates
            });
            gitMergeResults.push(joinMerge);
          }
          if (joinMerge.status === "conflict") {
            await persistGitMerge(joinMerge, "join", { passed: false, reason: "MERGE_CONFLICT" });
            throw new Error(`GIT_COLLABORATION_MERGE_CONFLICT: ${joinMerge.conflictPaths.join(", ")}`);
          }
          const verification = await verifyGitMerge(joinMerge);
          if (!verification.passed) throw new Error(`GIT_COLLABORATION_MERGE_VERIFICATION_FAILED: ${verification.reason ?? "unknown"}`);
          await persistGitMerge(joinMerge, "join", verification);
        }
      }
      const retryPolicy = args.plan.semanticIR?.retryByRoleId?.[roleId];
      if (args.gitCollaboration) {
        // A branch that reaches execution is required to succeed before promotion. This
        // prevents an empty commit map from making `every(Boolean)` vacuously true.
        gitRoleExecutionSucceededByBranchId.set(branch.branchId, false);
      }
      let result = await executeRoleNode({
          roleId, node, plan: args.plan, state: workingState, branch,
          attempt: 1,
          maxAttempts: retryPolicy?.maxAttempts ?? 1,
          effectiveLaw: args.effectiveLaw, profilesById: args.profilesById, toolsByRef: args.toolsByRef,
          rolePackagesByRoleId: args.rolePackagesByRoleId, contractPlan: args.contractPlan,
          compilerSnapshot: args.compilerSnapshot, runContext: args.runContext, executor: args.executor,
          userProfile: args.userProfile, workdir: args.workdir, commandBaseDir: args.commandBaseDir,
          logger, signal: config?.signal, auditAppend: validatedAuditAppend,
          dryRunScenario: args.dryRunScenario,
          ...(args.gitCollaboration && !joinMerge ? {
            prepareExecutionWorkspace: async (execution) => {
              const worktree = await prepareNewGitRoleWorktree({
                roleId,
                branch,
                attempt: 1,
                execution,
                baseCommit: args.gitCollaboration!.baseCommit,
                stateVersion: workingState.stateVersion
              });
              maybeInterruptAfterPreparedWorkspace();
              return {
                path: worktree.path,
                finalize: async () => {
                  await maybeWriteTestWorkspaceFile(worktree.path);
                  const commit = await args.gitCollaboration!.collaboration.commitWorktree(
                    worktree,
                    `OGS ${roleId} ${execution.executionId}`,
                    { allowNoChanges: true }
                  );
                  maybeCrashAfterWorkspaceGitCommit();
                  return persistGitRoleCommit(branch.branchId, commit);
                },
                discard: async () => args.gitCollaboration!.collaboration.removeWorktree(worktree.path, true)
              };
            }
          } : {}),
          ...(joinMerge ? {
            prepareExecutionWorkspace: async (execution) => {
              const mergeWorktree: GitRoleWorktree = {
                roleId,
                executionId: execution.executionId,
                branch: joinMerge!.branch,
                path: joinMerge!.path,
                baseCommit: joinMerge!.baseCommit
              };
              await persistPreparedGitRoleCheckpoint({ roleId, branch, attempt: 1, execution, worktree: mergeWorktree, stateVersion: workingState.stateVersion });
              return {
                path: joinMerge!.path,
                finalize: async () => {
                  const commit = await args.gitCollaboration!.collaboration.commitWorktree(
                    mergeWorktree,
                    `OGS merge ${roleId} ${execution.executionId}`,
                    { allowNoChanges: true }
                  );
                  return persistGitRoleCommit(branch.branchId, commit);
                },
                discard: async () => {
                  if (!joinMerge?.mergeCommit) return;
                  await args.gitCollaboration!.collaboration.resetWorktree(joinMerge.path, joinMerge.mergeCommit);
                }
              };
            }
          } : {})
        });
      const promptCallsByCallId = new Map((result.audit.promptCalls ?? []).map((call) => [call.callId, call]));
      const priorAttemptExecutionIds: string[] = [];
      for (let attempt = 2; result.status === "failed" && retryPolicy && result.failure.retryable && attempt <= retryPolicy.maxAttempts; attempt += 1) {
        if (config?.signal?.aborted || runControl.drainRequested || result.failure.errorCode === "RUN_CANCELLED") break;
        const delayMs = retryPolicy.backoff === "exponential" ? 25 * 2 ** (attempt - 2) : 25;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        await appendEvent(args.runContext, {
          type: "role_retry_scheduled",
          at: new Date().toISOString(),
          roleId,
          executionId: result.executionId,
          branchId: branch.branchId,
          lineageId: branch.lineageId,
          loopIteration: branch.loopIteration,
          attempt,
          maxAttempts: retryPolicy.maxAttempts,
          errorCode: result.failure.errorCode,
          backoffMs: delayMs
        });
        priorAttemptExecutionIds.push(result.executionId);
        result = await executeRoleNode({
          roleId, node, plan: args.plan, state: workingState, branch,
          attempt,
          maxAttempts: retryPolicy.maxAttempts,
          effectiveLaw: args.effectiveLaw, profilesById: args.profilesById, toolsByRef: args.toolsByRef,
          rolePackagesByRoleId: args.rolePackagesByRoleId, contractPlan: args.contractPlan,
          compilerSnapshot: args.compilerSnapshot, runContext: args.runContext, executor: args.executor,
          userProfile: args.userProfile, workdir: args.workdir, commandBaseDir: args.commandBaseDir,
          logger, signal: config?.signal, auditAppend: validatedAuditAppend,
          dryRunScenario: args.dryRunScenario,
          ...(joinMerge ? {
            prepareExecutionWorkspace: async (execution) => {
              const mergeWorktree: GitRoleWorktree = {
                roleId,
                executionId: execution.executionId,
                branch: joinMerge!.branch,
                path: joinMerge!.path,
                baseCommit: joinMerge!.baseCommit
              };
              await args.gitCollaboration!.collaboration.resetWorktree(joinMerge!.path, joinMerge!.mergeCommit!);
              await persistPreparedGitRoleCheckpoint({ roleId, branch, attempt, execution, worktree: mergeWorktree, stateVersion: workingState.stateVersion });
              return {
                path: joinMerge!.path,
                finalize: async () => {
                  const commit = await args.gitCollaboration!.collaboration.commitWorktree(
                    mergeWorktree,
                    `OGS merge ${roleId} ${execution.executionId}`,
                    { allowNoChanges: true }
                  );
                  return persistGitRoleCommit(branch.branchId, commit);
                },
                discard: async () => {
                  if (!joinMerge?.mergeCommit) return;
                  await args.gitCollaboration!.collaboration.resetWorktree(joinMerge.path, joinMerge.mergeCommit);
                }
              };
            }
          } : args.gitCollaboration ? {
            prepareExecutionWorkspace: async (execution) => {
              const worktree = await prepareNewGitRoleWorktree({ roleId, branch, attempt, execution, baseCommit: args.gitCollaboration!.baseCommit, stateVersion: workingState.stateVersion });
              return {
                path: worktree.path,
                finalize: async () => {
                  return persistGitRoleCommit(
                    branch.branchId,
                    await args.gitCollaboration!.collaboration.commitWorktree(
                      worktree,
                      `OGS ${roleId} ${execution.executionId}`,
                      { allowNoChanges: true }
                    )
                  );
                },
                discard: async () => args.gitCollaboration!.collaboration.removeWorktree(worktree.path, true)
              };
            }
          } : {})
        });
        for (const call of result.audit.promptCalls ?? []) promptCallsByCallId.set(call.callId, call);
      }
      if (promptCallsByCallId.size) {
        const promptCalls = Array.from(promptCallsByCallId.values());
        result.audit = {
          ...result.audit,
          promptCalls,
          projectedInputChars: promptCalls.reduce((sum, call) => sum + call.projectedInputChars, 0),
          renderedPromptChars: promptCalls.reduce((sum, call) => sum + call.renderedPromptChars, 0),
          outputChars: promptCalls.reduce((sum, call) => sum + call.outputChars, 0),
          estimatedInputTokens: promptCalls.reduce((sum, call) => sum + call.estimatedInputTokens, 0),
          estimatedOutputTokens: promptCalls.reduce((sum, call) => sum + call.estimatedOutputTokens, 0),
          fallbackUsed: promptCalls.some((call) => call.phase === "fallback"),
          primaryModelId: result.audit.primaryModelId ?? promptCalls.find((call) => call.phase === "primary")?.modelId
        };
      }
      if (args.gitCollaboration) {
        gitRoleExecutionSucceededByBranchId.set(branch.branchId, result.status !== "failed");
      }
      if (priorAttemptExecutionIds.length) {
        const roleDirs = args.runContext.roleDirsById.get(roleId);
        if (!roleDirs) throw new Error(`Role run directory missing for "${roleId}"`);
        if (promptCallsByCallId.size) {
          await filesystemCheckpointStore.updateOutcomeAudit({
            executionDir: resolve(roleDirs.executionsDir, result.executionId),
            audit: result.audit
          });
        }
        for (const executionId of priorAttemptExecutionIds) {
          await filesystemCheckpointStore.markOutcomeSuperseded({
            executionDir: resolve(roleDirs.executionsDir, executionId),
            supersededByExecutionId: result.executionId
          });
        }
      }

      const businessState = applySemanticBusinessState({
        state: workingState,
        plan: args.plan,
        roleId,
        data: result.status === "failed" ? undefined : result.storedResult?.data
      });
      // Routing observes the same reduced business state that this transition persists.
      const routingState = businessState
        ? { ...workingState, businessState }
        : workingState;
      const transitionPlan = planTransition({
        runId: args.runContext.runId,
        state: routingState,
        plan: args.plan,
        contractPlan: args.contractPlan,
        outcome: {
          version: 1,
          executionId: result.executionId,
          roleId,
          branchId: branch.branchId,
          loopIteration: branch.loopIteration,
          sessionKey: "",
          branch,
          committedAt: new Date().toISOString(),
          ...(result.status === "failed"
            ? {
                status: "failed" as const,
                error: result.error,
                failure: result.failure,
                audit: result.audit
              }
            : {
                status: result.status,
                selectedEvent: result.selectedEvent,
                storedResult: result.storedResult,
                audit: result.audit
              })
        },
        logger,
        errorFlowRoutingEnabled: args.errorFlowRoutingEnabled,
        indexes: runtimeIndexes
      });
      if (businessState) {
        transitionPlan.update = { ...transitionPlan.update, businessState };
      }
      // Review requests are created from the pre-transition snapshot. Bind them to the version
      // produced by this checkpoint so a subsequent resume validates against the durable state.
      if (transitionPlan.reviewRequests?.length && transitionPlan.update.pendingReviewsById) {
        const resultingStateVersion = workingState.stateVersion + 1;
        const pendingReviewsById = Object.fromEntries(
          Object.entries(transitionPlan.update.pendingReviewsById).map(([reviewId, review]) => [
            reviewId,
            { ...review, stateVersion: resultingStateVersion }
          ])
        );
        transitionPlan.update = { ...transitionPlan.update, pendingReviewsById };
        transitionPlan.reviewRequests = transitionPlan.reviewRequests.map((review) => ({
          ...review,
          stateVersion: resultingStateVersion
        }));
      }
      for (const reviewRequest of transitionPlan.reviewRequests ?? []) {
        await filesystemReviewStore.persistRequest({
          context: args.runContext,
          review: reviewRequest
        });
      }

      maybeCrashAfterExecutionOutcome();
      const eventId = `${args.runContext.runId}:${result.executionId}:${workingState.stateVersion + 1}`;
      const idempotencyKey = eventId;
      const checkpoint = await filesystemCheckpointStore.persist({
        context: args.runContext,
        roleId,
        branchId: branch.branchId,
        loopIteration: branch.loopIteration,
        executionId: result.executionId,
        update: transitionPlan.update,
        expectedStateVersion: workingState.stateVersion,
        resultingStateVersion: workingState.stateVersion + 1,
        irDigest: semanticDigestForPlan(args.plan),
        eventId,
        idempotencyKey
      });
      await args.runtimeServices?.checkpointStore.append(checkpoint);
      const roleDirs = args.runContext.roleDirsById.get(roleId);
      if (!roleDirs) {
        throw new Error(`Role run directory missing for "${roleId}"`);
      }
      await filesystemCheckpointStore.markOutcomeReconciled({
        executionDir: resolve(roleDirs.executionsDir, result.executionId),
        checkpointSequence: checkpoint.checkpointSequence
      });
      for (const event of transitionPlan.events) {
        await appendEvent(args.runContext, event);
      }
      await ensureLoopBudgetReviewEvents({ context: args.runContext, state: workingState });
      if (transitionPlan.update.resultCommit?.status === "committed") {
        await ensureResultCommitEvent({ context: args.runContext, resultCommit: transitionPlan.update.resultCommit, roleId, stateVersion: workingState.stateVersion + 1 });
      }

      const stateCommit = args.runtimeServices
        ? await args.runtimeServices.stateStore.commit({
            runId: args.runContext.runId,
            expectedStateVersion: workingState.stateVersion,
            eventId,
            idempotencyKey,
            checkpointSequence: checkpoint.checkpointSequence,
            update: { ...checkpoint.update, lastCheckpointSequence: checkpoint.checkpointSequence }
          })
        : undefined;
      const effectiveUpdate: GraphUpdate = stateCommit
        ? {
            ...checkpoint.update,
            stateVersion: stateCommit.snapshot.state.stateVersion,
            lastEventId: eventId
          }
        : checkpoint.update;
      workingState = stateCommit?.snapshot.state ?? applyGraphUpdate(workingState, effectiveUpdate);
      runtimeIndexes = applyGraphUpdateToIndexes(runtimeIndexes, effectiveUpdate);
      combinedUpdate = mergeGraphUpdates(combinedUpdate, effectiveUpdate);

      for (const activated of Object.values(effectiveUpdate.branchRecords ?? {})) {
        if (activated.status !== "active" || activated.activatedByRoleId !== roleId) continue;
        const edgeId = runtimeEdgeId(roleId, activated.activatedByEvent || "", activated.roleId, args.runtimeEdgeIdsByTransition);
        const sourceAttempt = result.audit.attempt ?? 1;
        await appendEvent(args.runContext, {
          type: "flow.activated",
          at: new Date().toISOString(),
          handoffId: buildHandoffId({
            runId: args.runContext.runId,
            branchId: activated.branchId,
            lineageId: activated.lineageId,
            sourceExecutionId: result.executionId,
            sourceAttempt,
            edgeId,
            loopIteration: activated.loopIteration
          }),
          edgeId,
          sourceExecutionId: result.executionId,
          sourceAttempt,
          executionId: result.executionId,
          attempt: sourceAttempt,
          fromRoleId: roleId,
          toRoleId: activated.roleId,
          eventType: activated.activatedByEvent,
          branchId: activated.branchId,
          lineageId: activated.lineageId,
          loopIteration: activated.loopIteration
        });
      }
      const reachedEnd = Object.hasOwn(transitionPlan.update.finalOutputsByRoleId ?? {}, roleId);
      if (reachedEnd) {
        for (const flow of node.outgoing) {
          const selectedEvent = result.status === "failed" ? undefined : result.selectedEvent;
          if (flow.toRoleId !== SYSTEM_END_ROLE_ID || (selectedEvent && flow.eventType !== selectedEvent)) continue;
          const edgeId = runtimeEdgeId(roleId, flow.eventType, SYSTEM_END_ROLE_ID, args.runtimeEdgeIdsByTransition);
          const sourceAttempt = result.audit.attempt ?? 1;
          await appendEvent(args.runContext, {
            type: "flow.activated",
            at: new Date().toISOString(),
            handoffId: buildHandoffId({
              runId: args.runContext.runId,
              branchId: branch.branchId,
              lineageId: branch.lineageId,
              sourceExecutionId: result.executionId,
              sourceAttempt,
              edgeId,
              loopIteration: branch.loopIteration
            }),
            edgeId,
            sourceExecutionId: result.executionId,
            sourceAttempt,
            executionId: result.executionId,
            attempt: sourceAttempt,
            fromRoleId: roleId,
            toRoleId: SYSTEM_END_ROLE_ID,
            eventType: flow.eventType,
            branchId: branch.branchId,
            lineageId: branch.lineageId,
            loopIteration: branch.loopIteration
          });
        }
      }

      if (workingState.status === "running") {
        // Trade-off: stop requests are honored as soon as we see them but still let the current
        // transition complete so auditing stays consistent.
        const stopRequest = await readRunStopRequest(args.runContext.runDir);
        if (stopRequest) {
          const stopUpdate: GraphUpdate = { status: "stopping" };
          workingState = applyGraphUpdate(workingState, stopUpdate);
          runtimeIndexes = applyGraphUpdateToIndexes(runtimeIndexes, stopUpdate);
          combinedUpdate = mergeGraphUpdates(combinedUpdate, stopUpdate);
          await appendEvent(args.runContext, {
            type: "run_stopping",
            at: new Date().toISOString(),
            requestedAt: stopRequest.requestedAt,
            requestedByPid: stopRequest.requestedByPid,
            reason: stopRequest.reason
          });
        }
      }

      return combinedUpdate;
    }, roleNodeTimeoutMs ? { timeout: roleNodeTimeoutMs } : undefined);
    graphBuilder.addEdge(roleId, SCHEDULER_NODE_ID);
  }

  graphBuilder.addEdge(START, SCHEDULER_NODE_ID);
  // Invariant: the scheduler can only move to END when no active roles remain so that every
  // transition is explicitly drained before termination.
  graphBuilder.addConditionalEdges(SCHEDULER_NODE_ID, (state: GraphState) => {
    if (state.status !== "running") {
      return END;
    }
    const activeRoles = getActiveRoleIds(state, runtimeIndexes);
    if (activeRoles.length === 0) {
      return END;
    }
    return activeRoles[0];
  });

  const graph = graphBuilder.compile();
  let finalState = args.initialState ?? createInitialGraphState({ plan: args.plan, prompt: args.prompt, runId: args.runContext.runId });
  if (args.initialState) {
    // Reliability: restore the exact state frontier by replaying checkpoint WAL first,
    // then reconciling any committed role outcomes that crashed before checkpoint emission.
    const reconciled = await reconcileCommittedRoleExecutionOutcomes({
      state: finalState,
      plan: args.plan,
      contractPlan: args.contractPlan,
      runContext: args.runContext,
      errorFlowRoutingEnabled: args.errorFlowRoutingEnabled,
      compilerSnapshot: args.compilerSnapshot,
      runtimeServices: args.runtimeServices
    });
    await reconcilePromptBudgetLedger({
      context: args.runContext,
      committedPromptCharsByCallId: reconciled.state.auditSummary.committedPromptCharsByCallId,
      legacyTotalRenderedPromptChars: reconciled.state.auditSummary.totalRenderedPromptChars,
      promptCalls: reconciled.state.recentAudits.flatMap((audit) => audit.promptCalls ?? [])
    });
    const reviewReconciled = await reconcileCommittedHumanReviewDecisions({
      state: reconciled.state,
      plan: args.plan,
      contractPlan: args.contractPlan,
      rolePackagesByRoleId: args.rolePackagesByRoleId,
      runContext: args.runContext
      , compilerSnapshot: args.compilerSnapshot,
      runtimeServices: args.runtimeServices
    });
    finalState = reviewReconciled.state;
    runtimeIndexes = reviewReconciled.indexes;
    const activeBranchIds = new Set(args.plan.roleIds.flatMap((roleId) =>
      listActiveBranches(finalState, roleId).map((branch) => branch.branchId)
    ));
    for (const [branchId, commit] of gitRoleCommitsByBranchId) {
      if (activeBranchIds.has(branchId)) {
        throw new Error(`WORKSPACE_COMMITTED_ROLE_OUTCOME_MISSING: ${commit.roleId} execution ${commit.executionId} has a Git commit but no durable Runtime outcome`);
      }
    }
  } else {
    runtimeIndexes = buildRuntimeIndexes(finalState);
  }
  logger.runStart({
    runId: args.runContext.runId,
    systemId: args.plan.systemId,
    entryRoleIds: args.plan.entryRoleIds,
    selectedEntryRoleIds: finalState.selectedEntryRoleIds,
    dispatch: args.plan.startDispatch,
    resume: Boolean(args.initialState)
  });
  if (!args.initialState) {
    await appendEvent(args.runContext, {
      type: "start_dispatch_selected",
      at: new Date().toISOString(),
      mode: args.plan.startDispatch.mode,
      count: args.plan.startDispatch.mode === "random_n" ? args.plan.startDispatch.count : finalState.selectedEntryRoleIds.length,
      candidates: args.plan.entryRoleIds,
      selectedEntryRoleIds: finalState.selectedEntryRoleIds
    });
  }
  await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });

  const semanticBudget = args.plan.semanticIR?.capabilities.maxTransitionsPerRun;
  const effectiveTransitionBudget = Math.min(
    args.effectiveLaw.maxTransitions ?? semanticBudget ?? DEFAULT_TRANSITION_BUDGET,
    semanticBudget ?? Number.POSITIVE_INFINITY
  );
  const recursionLimit = calculateGraphRecursionLimit(effectiveTransitionBudget);
  // Trade-off: we double the transition budget for the scheduler hops so recursion depth stays
  // bounded even when LangGraph counts scheduler nodes and role nodes separately.
  const stopRequestBeforeStart = await readRunStopRequest(args.runContext.runDir);
  if (stopRequestBeforeStart) {
    runControl.requestDrain(stopRequestBeforeStart.reason);
  }

  try {
    const stream = await graph.stream(finalState, {
      streamMode: "values",
      recursionLimit,
      control: runControl
    });

    for await (const chunk of stream) {
      finalState = chunk;
      await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
      if (finalState.status === "stopping" && !runControl.drainRequested) {
        runControl.requestDrain(finalState.error || "stop requested");
      }
    }
  } catch (error) {
    if (isGraphDrained(error) || error instanceof GraphDrained) {
      // The latest durable role checkpoint may have been written before LangGraph observed the
      // drain request. Replay it so the stop result never regresses the persisted frontier.
      const replay = await replayPendingRuntimeCheckpoints({
        state: finalState,
        runContext: args.runContext,
        runtimeServices: args.runtimeServices
      });
      finalState = replay.state.status === "running"
        ? { ...replay.state, status: "stopping" }
        : replay.state;
      await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
    } else if (isNodeTimeoutError(error)) {
      const roleId = args.plan.roleIds.includes(error.node) ? error.node : undefined;
      const message = `Role node "${error.node}" timed out after ${error.elapsed}ms`;
      finalState = {
        ...finalState,
        status: "failed",
        error: message,
        errorEnvelope: {
          errorCode: "ROLE_NODE_TIMEOUT",
          errorCategory: "execution",
          message,
          retryable: true,
          stage: "execute",
          runId: args.runContext.runId,
          roleId
        }
      };
      await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
    } else {
      throw error;
    }
  }

  const hasSkippedJoinSource = Object.values(finalState.joinSourceOutcomesByScope ?? {})
    .some((outcomes) => Object.values(outcomes).some((status) => status === "skipped"));
  if (
    finalState.status === "running" &&
    (args.contractPlan?.handoffMode === "transition" || hasSkippedJoinSource)
  ) {
    const orphanedJoinGroup = findOrphanedJoinGroup({
      state: finalState,
      plan: args.plan,
      branchUpdates: {}
    });
    if (orphanedJoinGroup) {
      finalState = {
        ...finalState,
        status: "failed",
        error: `Join "${orphanedJoinGroup.roleId}" became unreachable in lineage ${orphanedJoinGroup.lineageId}#${orphanedJoinGroup.loopIteration} after transition skip; completed sources ${orphanedJoinGroup.completedSourceRoleIds.join(", ")} cannot reach required ${orphanedJoinGroup.requiredSourceCount}`,
        errorEnvelope: {
          errorCode: "GRAPH_JOIN_UNREACHABLE_AFTER_TRANSITION_SKIP",
          errorCategory: "state",
          message: `Join "${orphanedJoinGroup.roleId}" became unreachable in lineage ${orphanedJoinGroup.lineageId}#${orphanedJoinGroup.loopIteration} after transition skip; completed sources ${orphanedJoinGroup.completedSourceRoleIds.join(", ")} cannot reach required ${orphanedJoinGroup.requiredSourceCount}`,
          retryable: false,
          stage: "execute",
          roleId: orphanedJoinGroup.roleId
        }
      };
      await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
    }
  }

  if (finalState.status === "running") {
    const waitingScopes = Object.entries(finalState.joinScopes ?? {}).filter(([, scope]) => scope.status === "waiting");
    if (waitingScopes.length > 0) {
      const now = Date.now();
      let timeoutFailure: { scopeKey: string; roleId: string; message: string; errorCode: string } | undefined;
      let paused = false;
      let terminated = false;
      const nextScopes = { ...(finalState.joinScopes ?? {}) };
      for (const [scopeKey, scope] of waitingScopes) {
        const spec = args.plan.semanticIR?.joins.find((item) => item.roleId === scope.joinRoleId);
        const joinMode = spec?.mode ?? scope.joinMode ?? "all_of";
        const joinMin = spec?.min ?? scope.joinMin ?? scope.expectedSourceRoleIds.length;
        const failurePolicy = spec?.failurePolicy ?? scope.failurePolicy ?? "wait";
        const timeoutAction = scope.timeoutAction ?? spec?.onTimeout ?? "fail";
        const sourceStatusByRoleId = scope.sourceStatusByRoleId ?? Object.fromEntries(
          scope.expectedSourceRoleIds.map((sourceRoleId) => [
            sourceRoleId,
            scope.readySourceRoleIds.includes(sourceRoleId) ? "arrived" : "pending"
          ])
        );
        const decision = resolveJoinPolicy({
          mode: joinMode,
          sources: scope.expectedSourceRoleIds,
          readySources: scope.readySourceRoleIds,
          min: joinMin,
          timeoutSeconds: scope.timeoutSeconds,
          startedAt: Date.parse(scope.startedAt),
          now,
          onTimeout: timeoutAction,
          failurePolicy,
          sourceStatusByRoleId
        });
        if (decision.action === "wait" || decision.action === "activate") continue;
        const sourceFailure = decision.reason.includes("source failed") || decision.reason.startsWith("source failure");
        const requiredSourceSkipped = decision.reason === "required source skipped";
        const resolutionAt = new Date(now).toISOString();
        nextScopes[scopeKey] = {
          ...scope,
          status: sourceFailure ? "failed" : "timed_out",
          sourceStatusByRoleId,
          completedAt: resolutionAt,
          resolutionReason: decision.reason,
          resolutionAction: decision.action
        };
        await appendEvent(args.runContext, {
          type: sourceFailure || requiredSourceSkipped ? "join_source_outcome_rejected" : "join_timed_out",
          status: sourceFailure ? "failed" : requiredSourceSkipped ? "skipped" : "timed_out",
          at: resolutionAt,
          roleId: scope.joinRoleId,
          joinId: scope.joinId,
          lineageId: scope.lineageId,
          loopIteration: scope.loopIteration,
          joinMode,
          joinMin,
          requiredSourceCount: joinMode === "quorum_of" ? joinMin : scope.expectedSourceRoleIds.length,
          joinSources: scope.expectedSourceRoleIds,
          satisfiedSources: scope.readySourceRoleIds,
          missingSources: decision.missingSourceRoleIds,
          failurePolicy,
          timeoutAction,
          action: decision.action,
          reason: decision.reason
        });
        const message = `Join "${scope.joinRoleId}" ${decision.reason}; missing sources: ${decision.missingSourceRoleIds.join(", ")}`;
        if (decision.action === "fail") timeoutFailure ??= {
          scopeKey,
          roleId: scope.joinRoleId,
          message,
          errorCode: sourceFailure
            ? "GRAPH_JOIN_REQUIRED_SOURCE_FAILED"
            : requiredSourceSkipped
              ? "GRAPH_JOIN_REQUIRED_SOURCE_SKIPPED"
              : "GRAPH_JOIN_TIMEOUT"
        };
        else if (decision.action === "terminate") terminated = true;
        else paused = true;
      }
      if (timeoutFailure) {
        finalState = {
          ...finalState, joinScopes: nextScopes, status: "failed", error: timeoutFailure.message,
          errorEnvelope: { errorCode: timeoutFailure.errorCode, errorCategory: "state", message: timeoutFailure.message, retryable: false, stage: "execute", roleId: timeoutFailure.roleId, runId: args.runContext.runId }
        };
      } else if (terminated) {
        finalState = { ...finalState, joinScopes: nextScopes, status: "terminated", error: "join timeout terminated" };
        await appendEvent(args.runContext, { type: "run_terminated", at: new Date(now).toISOString(), reason: "join_timeout_terminate", pendingJoinCount: waitingScopes.length });
      } else {
        finalState = { ...finalState, joinScopes: nextScopes, status: "stopped", error: paused ? "join timeout paused" : "waiting for join" };
        await appendEvent(args.runContext, { type: "run_waiting", at: new Date(now).toISOString(), waitKind: "business", reason: paused ? "join_timeout_pause" : "join", pendingJoinCount: waitingScopes.length });
      }
      await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
    }
  }

  if (finalState.status === "waiting_review") {
    const pendingReviewCount = countPendingHumanReviews(finalState);
    logger.runWaiting({ waitKind: "business", reason: "human_review", pendingReviewCount });
    await appendEvent(args.runContext, {
      type: "run_waiting",
      at: new Date().toISOString(),
      waitKind: "business",
      reason: "human_review",
      pendingReviewCount
    });
    await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
  }

  if (finalState.status === "running") {
    const pendingReviewCount = countPendingHumanReviews(finalState);
    finalState =
      pendingReviewCount > 0
        ? {
            ...finalState,
            status: "stopped",
            error: "waiting for human review"
          }
        : {
            ...finalState,
            status: "done"
          };
    if (finalState.status === "stopped" && finalState.error === "waiting for human review") {
      logger.runWaiting({
        waitKind: "business",
        reason: "human_review",
        pendingReviewCount
      });
      await appendEvent(args.runContext, {
        type: "run_waiting",
        at: new Date().toISOString(),
        waitKind: "business",
        reason: "human_review",
        pendingReviewCount
      });
    }
    await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
  }

  // Invariant: a status of "stopping" means we already received a stop request and must persist
  // the stop outcome before flagging the run as "stopped".
  if (finalState.status === "stopping") {
    const stopRequest = await readRunStopRequest(args.runContext.runDir);
    const stopReason = stopRequest?.reason ?? "stop requested";
    finalState = {
      ...finalState,
      status: "stopped",
      error: stopReason
    };
    await appendEvent(args.runContext, {
      type: "run_stopped",
      at: new Date().toISOString(),
      reason: stopReason
    });
    await persistRunStopOutcome({
      context: args.runContext,
      status: "stopped",
      reason: stopReason
    });
    await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
  } else {
    await clearRunStopRequest(args.runContext.runDir);
  }

  if (args.gitCollaboration && gitRoleCommitsByBranchId.size > 0) {
    const finalMergeId = `run-${args.runContext.runId}`;
    const branchCommits = await selectFinalGitCommits(finalState);
    const allGitRoleExecutionsSucceeded = [...gitRoleExecutionSucceededByBranchId.values()].every(Boolean);
    const existingMerge = latestGitMerge((item) => item.mergeId === finalMergeId
      && item.baseCommit === args.gitCollaboration!.baseCommit);
    const mergeAlreadyIncludesAllBranches = existingMerge?.status === "merged"
      && sameCandidateCommits(existingMerge.candidateCommits, branchCommits);
    let merge: GitMergeResult | undefined;
    let mergeVerification: { passed: boolean; reason?: string } | undefined;
    let mergeFailure: string | undefined;
    try {
      merge = mergeAlreadyIncludesAllBranches ? existingMerge : await args.gitCollaboration.collaboration.mergeCommits({
        mergeId: finalMergeId,
        baseCommit: args.gitCollaboration.baseCommit,
        candidateCommits: branchCommits
      });
      if (!mergeAlreadyIncludesAllBranches) gitMergeResults.push(merge);
      let verification: GitMergeVerification | undefined = merge.status === "merged"
        ? await verifyGitMerge(merge).catch(() => undefined)
        : undefined;
      if (!verification && merge.status === "merged") {
        merge = await args.gitCollaboration.collaboration.mergeCommits({
          mergeId: finalMergeId,
          baseCommit: args.gitCollaboration.baseCommit,
          candidateCommits: branchCommits
        });
        gitMergeResults.push(merge);
        verification = merge.status === "merged"
          ? await verifyGitMerge(merge)
          : undefined;
      }
      mergeVerification = merge.status === "conflict"
        ? { passed: false, reason: "MERGE_CONFLICT" }
        : verification;
      await persistGitMerge(merge, "final", mergeVerification);
    } catch (error) {
      mergeFailure = error instanceof Error ? error.message : String(error);
    }
    if (mergeFailure) {
      finalState = { ...finalState, status: "failed", error: `Git collaboration merge failed: ${mergeFailure}` };
      await appendEvent(args.runContext, {
        type: "git_collaboration_merge_failed",
        at: new Date().toISOString(),
        phase: "final",
        mergeId: finalMergeId,
        error: mergeFailure
      });
      await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
      await appendEvent(args.runContext, {
        type: "git_collaboration_publish_skipped",
        at: new Date().toISOString(),
        reason: "MERGE_FAILED",
        runStatus: finalState.status,
        mergeId: finalMergeId
      });
    } else if (merge && (merge.status !== "merged" || mergeVerification?.passed !== true)) {
      finalState = { ...finalState, status: "failed", error: `Git collaboration merge ${merge.status === "conflict" ? "conflict" : "verification failed"}.` };
      await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
    } else if (merge && finalState.status === "done" && allGitRoleExecutionsSucceeded && args.gitCollaboration.publish) {
      try {
        await args.gitCollaboration.publish(merge);
      } catch (error) {
        const publishFailure = error instanceof Error ? error.message : String(error);
        finalState = {
          ...finalState,
          status: "failed",
          error: `Git collaboration publish failed: ${publishFailure}`,
          errorEnvelope: {
            errorCode: "GIT_COLLABORATION_PUBLISH_FAILED",
            errorCategory: "io",
            message: `Git collaboration publish failed: ${publishFailure}`,
            retryable: false,
            stage: "execute",
            runId: args.runContext.runId
          }
        };
        await appendEvent(args.runContext, {
          type: "git_collaboration_publish_failed",
          at: new Date().toISOString(),
          phase: "final",
          mergeId: merge.mergeId,
          mergeCommit: merge.mergeCommit,
          error: publishFailure,
          possiblePartialPublish: true
        });
        await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
      }
    } else if (merge && (finalState.status !== "done" || !allGitRoleExecutionsSucceeded)) {
      await appendEvent(args.runContext, {
        type: "git_collaboration_publish_skipped",
        at: new Date().toISOString(),
        reason: finalState.status !== "done" ? "RUN_NOT_DONE" : "ROLE_EXECUTION_FAILED",
        runStatus: finalState.status,
        mergeId: merge.mergeId,
        mergeCommit: merge.mergeCommit
      });
    }
  }

  const auditTrailFromEvents = await loadAuditTrailFromEvents({
    context: args.runContext,
    allowedRoleIds: new Set(args.plan.roleIds)
  });
  const auditTrail = auditTrailFromEvents.length > 0
    ? auditTrailFromEvents
    : finalState.recentAudits;
  const stages = projectStages({ auditTrail });
  const summary = summarizeRunFromAuditSummary({
    auditSummary: finalState.auditSummary,
    transitionCount: finalState.transitionCount,
    terminalStatus: finalState.status,
    terminalErrorEnvelope: finalState.errorEnvelope
  });
  const serverMetadata = args.executor.getServerMetadata();
  await writeRunSummary({
    state: finalState,
    runContext: args.runContext,
    content: [
      "# Audit Summary",
      "",
      `- runId: ${args.runContext.runId}`,
      `- status: ${finalState.status}`,
      `- finalRoleIds: ${finalState.finalRoleIds.join(", ")}`,
      `- totalTransitions: ${summary.totalTransitions}`,
      `- okCount: ${summary.okCount}`,
      `- failedCount: ${summary.failedCount}`,
      `- handledFailureCount: ${summary.handledFailureCount}`,
      `- unhandledFailureCount: ${summary.unhandledFailureCount}`,
      `- handledFailureByEvent: ${stringifyJson(summary.handledFailureByEvent)}`,
      `- handledFailureByTargetRole: ${stringifyJson(summary.handledFailureByTargetRole)}`,
      `- noopCount: ${summary.noopCount}`,
      `- failureCountsByErrorCode: ${stringifyJson(summary.failureCountsByErrorCode)}`,
      `- repairStats.attemptedCount: ${summary.repairStats.attemptedCount}`,
      `- repairStats.appliedCount: ${summary.repairStats.appliedCount}`,
      `- opencodeServerUrl: ${serverMetadata.url ?? ""}`,
      `- opencodeServerPid: ${serverMetadata.pid ?? ""}`,
      `- opencodeServerStartedAt: ${serverMetadata.startedAt ?? ""}`,
      ...buildGanttSection(auditTrail)
    ].join("\n")
  });

  if (args.cleanupExecutionHistory !== undefined) {
    await persistAfterCleanup({
      state: finalState,
      plan: args.plan,
      runContext: args.runContext,
      keepLatest: args.cleanupExecutionHistory,
      failOnError: true,
      trigger: "manual"
    });
  } else if (
    args.autoCleanupRetention &&
    args.runContext.executionDirCount > args.autoCleanupRetention.executionDirThreshold
  ) {
    await persistAfterCleanup({
      state: finalState,
      plan: args.plan,
      runContext: args.runContext,
      keepLatest: args.autoCleanupRetention.keepLatest,
      failOnError: false,
      trigger: "retention",
      triggerThreshold: args.autoCleanupRetention.executionDirThreshold
    });
  }

  logger.runEnd({
    status:
      finalState.status === "failed"
        ? "failed"
        : finalState.status === "terminated"
          ? "terminated"
        : finalState.status === "stopped" || finalState.status === "waiting_review"
          ? "stopped"
          : "done",
    finalRoleIds: finalState.finalRoleIds.length ? finalState.finalRoleIds : undefined,
    totalTransitions: summary.totalTransitions,
    okCount: summary.okCount,
    failedCount: summary.failedCount,
    noopCount: summary.noopCount
  });

  return {
    systemId: args.plan.systemId,
    systemVersion: args.plan.systemVersion,
    lawRef: args.plan.lawBinding.globalLawRef,
    status:
      finalState.status === "failed"
        ? "failed"
        : finalState.status === "terminated"
          ? "terminated"
        : finalState.status === "stopped" || finalState.status === "waiting_review"
          ? "stopped"
          : "done",
    finalRoleIds: finalState.finalRoleIds.length ? finalState.finalRoleIds : undefined,
    finalOutputsByRoleId: Object.keys(finalState.finalOutputsByRoleId).length ? finalState.finalOutputsByRoleId : undefined,
    finalOutputRoleOrder: finalState.finalOutputRoleOrder.length ? finalState.finalOutputRoleOrder : undefined,
    systemState: {
      status: finalState.status,
      currentRoleId: finalState.finalRoleIds.at(-1) || finalState.lastExecutedRoleId || args.plan.entryRoleIds[0],
      nextRoleId: undefined,
      finalRoleIds: finalState.finalRoleIds.length ? finalState.finalRoleIds : undefined,
      transitionCount: finalState.transitionCount,
      totalTransitions: summary.totalTransitions,
      okCount: summary.okCount,
      failedCount: summary.failedCount,
      noopCount: summary.noopCount,
      failureCountsByErrorCode: summary.failureCountsByErrorCode,
      finalOutputsByRoleId: Object.keys(finalState.finalOutputsByRoleId).length ? finalState.finalOutputsByRoleId : undefined,
      finalOutputRoleOrder: finalState.finalOutputRoleOrder.length ? finalState.finalOutputRoleOrder : undefined,
      error: finalState.error || undefined,
      errorEnvelope: finalState.errorEnvelope || undefined,
      pendingReviewCount: Object.values(finalState.pendingReviewsById).filter(
        (review) => review.status === "pending" || review.status === "paused"
      ).length,
      hasWaitingHumanReview: Object.values(finalState.pendingReviewsById).some(
        (review) => review.status === "pending" || review.status === "paused"
      )
    },
    runSummary: summary,
    stages,
    auditTrail,
    error: finalState.error || undefined,
    errorEnvelope: finalState.errorEnvelope || undefined
  };
}
