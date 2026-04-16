/**
 * Orchestrates runtime graph execution: it wires LangGraph nodes, translates role outcomes to state
 * updates, persists checkpoints, and enforces recovery semantics (replay, reconcile, stop requests).
 * Boundaries: the runner never touches role internals; it treats execution-plan metadata as the source
 * of truth and exposes only GraphState/GraphUpdate transformations. Trade-off: the runner keeps explicit
 * persistence calls (checkpoints, audit output) instead of hiding them behind helpers to keep
 * crash handling transparent.
 */
import { resolve } from "node:path";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { createRunConsoleLogger } from "./console-run-log.js";
import type { Executor } from "./executor.js";
import { getExecutionPlanNode } from "./execution-plan.js";
import {
  getFlowContractByTarget,
  getSplitFlowContractByTarget,
  validateContractAgainstSchema
} from "./flow-contract.js";
import { evaluateJoinNodeReadiness, selectRoutingTargets } from "./graph-mode-registry.js";
import {
  activateBranch,
  buildBranchId,
  buildJoinId,
  completeBranch,
  createInitialGraphState,
  getActiveRoleIds,
  getBranchResult,
  getTargetLoopIteration,
  listActiveBranches,
  projectStateSnapshot,
  storeRoleResult,
  wouldExceedLoopBudget
} from "./graph-runtime-state.js";
import { executeRoleNode } from "./role-executor.js";
import { isRuntimeOnlyErrorEvent } from "./error-flow-utils.js";
import type { CompiledExecutionSnapshot } from "./compiler.js";
import { createRuntimeError, normalizeRuntimeError } from "./runtime-errors.js";
import {
  buildAuditSummaryDelta,
  createEmptyAuditSummary,
  mergeAuditSummaries,
  summarizeRunFromAuditSummary
} from "./run-summary.js";
import { projectStages } from "./stage-projector.js";
import { stringifyJson } from "./runtime-support.js";
import {
  appendEvent,
  clearRunStopRequest,
  cleanupHistoricalExecutionSnapshots,
  flushBufferedRunArtifacts,
  loadAuditTrailFromEvents,
  loadCommittedRoleExecutionOutcomes,
  loadPendingRuntimeCheckpoints,
  markRoleExecutionOutcomeReconciled,
  persistRunStopOutcome,
  persistRuntimeCheckpoint,
  readRunStopRequest,
  writeAtomicFile
} from "./run-artifacts.js";
import { SYSTEM_END_ROLE_ID } from "./types.js";
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
  LoadedModelPackage,
  LoadedRolePackage,
  RunContext,
  RuntimeCheckpointRecord,
  RuntimeErrorEnvelope,
  StoredRoleResult,
  GraphStateUpdate,
  RoleExecutionOutcomeRecord,
  UserProfile,
  GraphRoleMetricSummary,
  HandledFailureArtifactData
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
type RuntimeTransitionEvent = JoinTransitionEvent | FailureHandledTransitionEvent;
type TransitionPlan = {
  update: GraphUpdate;
  events: RuntimeTransitionEvent[];
};

const SCHEDULER_NODE_ID = "__scheduler__";
const DEFAULT_TRANSITION_BUDGET = 100;
const GRAPH_RECURSION_MARGIN = 20;
const RECENT_AUDIT_WINDOW = 5;
const GANTT_RENDER_LIMIT = 200;
const TEST_CRASH_AFTER_EXECUTION_OUTCOME_ENV = "OGSYSTEM_TEST_CRASH_AFTER_EXECUTION_OUTCOME";

type RunnerInput = {
  plan: ExecutionPlan;
  effectiveLaw: EffectiveLawConstraints;
  contractPlan?: FlowContractPlan;
  compilerSnapshot?: CompiledExecutionSnapshot;
  profilesById: Map<string, ExecutionProfile>;
  toolsByRef: Map<string, CliTool>;
  modelsById: Map<string, LoadedModelPackage>;
  userProfile?: UserProfile;
  workdir: string;
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
};

function listPendingJoinSources(args: {
  node: ExecutionPlanNode;
  currentBranch: BranchRecord;
  state: GraphState;
  currentResult?: StoredRoleResult;
}): string[] {
  return evaluateJoinNodeReadiness(args).missingSourceRoleIds;
}

function mergeStatus(current: GraphRunStatus, update: GraphRunStatus): GraphRunStatus {
  if (current === "failed" || update === "failed") {
    return "failed";
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

/**
 * LangGraph nodes emit incremental GraphUpdate objects, while OGSystem persists materialized
 * GraphState snapshots. Reducers bridge those two views and keep checkpoint-sized updates composable.
 */
const GraphStateAnnotation = Annotation.Root({
  userPrompt: Annotation<string>,
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
  branchRecords: Annotation<Record<string, BranchRecord>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  loopIterations: Annotation<Record<string, number>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  selectedEventByBranchId: Annotation<Record<string, string>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  finalOutput: Annotation<string>({
    reducer: (current, update) => update || current,
    default: () => ""
  }),
  finalRoleId: Annotation<string>({
    reducer: (current, update) => update || current,
    default: () => ""
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
  return {
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
    branchRecords: { ...(current.branchRecords ?? {}), ...(update.branchRecords ?? {}) },
    loopIterations: { ...(current.loopIterations ?? {}), ...(update.loopIterations ?? {}) },
    selectedEventByBranchId: {
      ...(current.selectedEventByBranchId ?? {}),
      ...(update.selectedEventByBranchId ?? {})
    },
    finalOutput: update.finalOutput || current.finalOutput,
    finalRoleId: update.finalRoleId || current.finalRoleId,
    lastExecutedRoleId: update.lastExecutedRoleId ?? current.lastExecutedRoleId,
    nextBranchSequence: update.nextBranchSequence ?? current.nextBranchSequence,
    lastCheckpointSequence: Math.max(
      current.lastCheckpointSequence ?? 0,
      update.lastCheckpointSequence ?? 0
    )
  };
}

function applyGraphUpdate(state: GraphState, update: GraphUpdate): GraphState {
  return {
    userPrompt: state.userPrompt,
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
    branchRecords: { ...state.branchRecords, ...(update.branchRecords ?? {}) },
    loopIterations: { ...state.loopIterations, ...(update.loopIterations ?? {}) },
    selectedEventByBranchId: {
      ...state.selectedEventByBranchId,
      ...(update.selectedEventByBranchId ?? {})
    },
    finalOutput: update.finalOutput || state.finalOutput,
    finalRoleId: update.finalRoleId || state.finalRoleId,
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
    const stateWriteStartedAt = Date.now();
    await writeAtomicFile(args.runContext.statePath, stringifyJson(projectStateSnapshot(args)));
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

async function replayPendingRuntimeCheckpoints(args: {
  state: GraphState;
  runContext: RunContext;
}): Promise<{
  state: GraphState;
  checkpoints: RuntimeCheckpointRecord[];
}> {
  const checkpoints = await loadPendingRuntimeCheckpoints({
    context: args.runContext,
    afterSequence: args.state.lastCheckpointSequence
  });
  let replayedState = args.state;
  for (const checkpoint of checkpoints) {
    replayedState = applyGraphUpdate(replayedState, checkpoint.update);
  }
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
  if (process.env[TEST_CRASH_AFTER_EXECUTION_OUTCOME_ENV] !== "1") {
    return;
  }
  process.stderr.write(
    `[test-failpoint] forced crash after execution outcome before checkpoint\n`
  );
  process.exit(91);
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

function buildGraphUpdateFromOutcome(args: {
  state: GraphState;
  plan: ExecutionPlan;
  contractPlan?: FlowContractPlan;
  outcome: RoleExecutionOutcomeRecord;
  logger: ReturnType<typeof createRunConsoleLogger>;
  errorFlowRoutingEnabled: boolean;
}): TransitionPlan {
  const node = getExecutionPlanNode(args.plan, args.outcome.roleId);
  if (args.outcome.status === "failed") {
    if (args.errorFlowRoutingEnabled) {
      const handledTransition = buildHandledFailureTransitionPlan({
        state: args.state,
        plan: args.plan,
        node,
        roleId: args.outcome.roleId,
        currentBranch: args.outcome.branch,
        audit: args.outcome.audit,
        errorEnvelope: args.outcome.failure,
        logger: args.logger
      });
      if (handledTransition) {
        return handledTransition;
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

  return buildSuccessTransitionPlan({
    state: args.state,
    plan: args.plan,
    contractPlan: args.contractPlan,
    roleId: args.outcome.roleId,
    currentBranch: args.outcome.branch,
    audit: args.outcome.audit,
    selectedEvent: args.outcome.selectedEvent,
    storedResult: args.outcome.storedResult,
    mode: args.outcome.status,
    logger: args.logger
  });
}

async function reconcileCommittedRoleExecutionOutcomes(args: {
  state: GraphState;
  plan: ExecutionPlan;
  contractPlan?: FlowContractPlan;
  runContext: RunContext;
  errorFlowRoutingEnabled: boolean;
}): Promise<GraphState> {
  // Resume first trusts the existing checkpoint WAL, then heals only the crash window where
  // role execution committed durably but the checkpoint was never written or reconciled.
  const replay = await replayPendingRuntimeCheckpoints({
    state: args.state,
    runContext: args.runContext
  });
  let reconciledState = replay.state;
  const pendingCheckpointByExecutionId = new Map(
    replay.checkpoints.map((checkpoint) => [checkpoint.executionId, checkpoint])
  );
  const outcomes = await loadCommittedRoleExecutionOutcomes({
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
      await markRoleExecutionOutcomeReconciled({
        executionDir: resolve(roleDirs.executionsDir, outcome.executionId),
        checkpointSequence: pendingCheckpoint.checkpointSequence
      });
      continue;
    }

    const transitionPlan = buildGraphUpdateFromOutcome({
      state: reconciledState,
      plan: args.plan,
      contractPlan: args.contractPlan,
      outcome,
      logger,
      errorFlowRoutingEnabled: args.errorFlowRoutingEnabled
    });
    const checkpoint = await persistRuntimeCheckpoint({
      context: args.runContext,
      roleId: outcome.roleId,
      branchId: outcome.branchId,
      loopIteration: outcome.loopIteration,
      executionId: outcome.executionId,
      update: transitionPlan.update
    });
    const roleDirs = args.runContext.roleDirsById.get(outcome.roleId);
    if (!roleDirs) {
      throw new Error(`Role run directory missing for "${outcome.roleId}"`);
    }
    await markRoleExecutionOutcomeReconciled({
      executionDir: resolve(roleDirs.executionsDir, outcome.executionId),
      checkpointSequence: checkpoint.checkpointSequence
    });
    for (const event of transitionPlan.events) {
      await appendEvent(args.runContext, event);
    }
    pendingCheckpointByExecutionId.set(outcome.executionId, checkpoint);
    reconciledState = applyGraphUpdate(reconciledState, checkpoint.update);
  }

  return reconciledState;
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
}): Promise<void> {
  try {
    await cleanupHistoricalExecutionSnapshots({
      context: args.runContext,
      keepLatest: args.keepLatest
    });
  } catch (error) {
    throw createRuntimeError(
      normalizeRuntimeError(error, {
        errorCode: "RUNTIME_EXECUTION_HISTORY_CLEANUP_FAILED",
        errorCategory: "io",
        stage: "execute",
        retryable: false,
        runId: args.runContext.runId,
        roleId: args.state.lastExecutedRoleId || undefined
      })
    );
  }
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
    finalRoleId: args.roleId,
    lastExecutedRoleId: args.roleId,
    branchRecords: {
      [args.branch.branchId]: completeBranch(args.branch)
    }
  };
}

const HANDLED_FAILURE_CONTEXT_MAX_CHARS = 800;

function sanitizeHandledFailureContext(value: string): string {
  const redacted = value.replace(
    /\b(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
    "$1=<redacted>"
  );
  if (redacted.length <= HANDLED_FAILURE_CONTEXT_MAX_CHARS) {
    return redacted;
  }
  return `${redacted.slice(0, HANDLED_FAILURE_CONTEXT_MAX_CHARS)}...`;
}

function getHandledFailureLastContext(args: {
  state: GraphState;
  branch: BranchRecord;
  failureInputContext?: string;
}): string {
  if (args.failureInputContext) {
    return sanitizeHandledFailureContext(args.failureInputContext);
  }
  if (!args.branch.parentBranchId) {
    return sanitizeHandledFailureContext(args.state.userPrompt);
  }
  const upstream = getBranchResult(args.state, args.branch.parentBranchId);
  return sanitizeHandledFailureContext(upstream?.content ?? args.state.userPrompt);
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
    last_context: getHandledFailureLastContext({
      state: args.state,
      branch: args.branch,
      failureInputContext: args.failureInputContext
    })
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

function buildHandledFailureTransitionPlan(args: {
  state: GraphState;
  plan: ExecutionPlan;
  node: ExecutionPlanNode;
  roleId: string;
  currentBranch: BranchRecord;
  audit: AuditRecord;
  errorEnvelope: RuntimeErrorEnvelope;
  logger: ReturnType<typeof createRunConsoleLogger>;
}): TransitionPlan | undefined {
  const matchedFailureEdge = resolveFailureEdge({
    node: args.node,
    errorCode: args.errorEnvelope.errorCode
  });
  if (!matchedFailureEdge) {
    return undefined;
  }

  const joinEvents: JoinTransitionEvent[] = [];
  const handledTargetRoleId =
    matchedFailureEdge.toRoleId === SYSTEM_END_ROLE_ID ? "output" : matchedFailureEdge.toRoleId;
  const events: RuntimeTransitionEvent[] = [
    {
      type: "failure_handled",
      at: new Date().toISOString(),
      roleId: args.roleId,
      branchId: args.currentBranch.branchId,
      lineageId: args.currentBranch.lineageId,
      loopIteration: args.currentBranch.loopIteration,
      errorCode: args.errorEnvelope.errorCode,
      handledByEvent: matchedFailureEdge.eventType,
      handledTargetRoleId
    }
  ];
  const handledAudit: AuditRecord = {
    ...args.audit,
    handledByEvent: matchedFailureEdge.eventType,
    handledTargetRoleId
  };
  const handledFailureArtifact = buildHandledFailureArtifact({
    state: args.state,
    roleId: args.roleId,
    branch: args.currentBranch,
    handledByEvent: matchedFailureEdge.eventType,
    errorEnvelope: args.errorEnvelope,
    error: args.audit.error,
    failureInputContext: args.audit.inputContext
  });
  const branchUpdates: Record<string, BranchRecord> = {
    [args.currentBranch.branchId]: completeBranch(args.currentBranch)
  };
  const loopUpdates: Record<string, number> = {
    [args.roleId]: args.currentBranch.loopIteration
  };
  let nextBranchSequence = args.state.nextBranchSequence;
  let finalStatus: GraphRunStatus = "running";
  let finalOutput = "";
  let finalRoleId = "";
  let reachedSystemOutput = false;

  if (matchedFailureEdge.toRoleId === SYSTEM_END_ROLE_ID) {
    reachedSystemOutput = true;
    finalOutput = args.audit.error ?? "";
    args.logger.transition({
      fromRoleId: args.roleId,
      event: matchedFailureEdge.eventType,
      toRoleId: "output",
      branchId: args.currentBranch.branchId
    });
  } else if (
    wouldExceedLoopBudget({
      targetRoleId: matchedFailureEdge.toRoleId,
      currentLoopIteration: args.currentBranch.loopIteration,
      state: args.state,
      plan: args.plan
    })
  ) {
    return undefined;
  } else {
    const nextLoopIteration = getTargetLoopIteration({
      targetRoleId: matchedFailureEdge.toRoleId,
      currentLoopIteration: args.currentBranch.loopIteration,
      state: args.state,
      plan: args.plan
    });
    loopUpdates[matchedFailureEdge.toRoleId] = nextLoopIteration;
    const targetNode = getExecutionPlanNode(args.plan, matchedFailureEdge.toRoleId);
    if (targetNode.joinMode) {
      const readiness = evaluateJoinNodeReadiness({
        node: targetNode,
        currentBranch: args.currentBranch,
        state: args.state
      });
      const joinId = buildJoinId(matchedFailureEdge.toRoleId, nextLoopIteration);
      const existingJoinBranch = findActivatedJoinBranch({
        state: args.state,
        roleId: matchedFailureEdge.toRoleId,
        lineageId: args.currentBranch.lineageId,
        loopIteration: nextLoopIteration
      });
      if (readiness.ready && existingJoinBranch) {
        joinEvents.push({
          type: "join_late_arrival_ignored",
          at: new Date().toISOString(),
          roleId: matchedFailureEdge.toRoleId,
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
      } else if (!readiness.ready) {
        args.logger.joinWait({
          roleId: matchedFailureEdge.toRoleId,
          arrivedFrom: args.roleId,
          waitingFor: listPendingJoinSources({
            node: targetNode,
            currentBranch: args.currentBranch,
            state: args.state
          })
        });
      } else {
        const sessionLineageId = resolveNextSessionLineageId({
          currentNode: args.node,
          targetNode,
          currentBranch: args.currentBranch,
          targetRoleId: matchedFailureEdge.toRoleId,
          nextLoopIteration,
          nextBranchSequence,
          activatedTargetCount: 1
        });
        const branch = activateBranch({
          roleId: matchedFailureEdge.toRoleId,
          loopIteration: nextLoopIteration,
          branchSequence: nextBranchSequence,
          lineageId: args.currentBranch.lineageId,
          sessionLineageId,
          parentBranchId: args.currentBranch.branchId,
          activatedByRoleId: args.roleId,
          activatedByEvent: matchedFailureEdge.eventType
        });
        nextBranchSequence += 1;
        branchUpdates[branch.branchId] = branch;
        if (targetNode.joinMode === "quorum_of") {
          joinEvents.push({
            type: "join_quorum_reached",
            at: new Date().toISOString(),
            roleId: matchedFailureEdge.toRoleId,
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
          roleId: matchedFailureEdge.toRoleId,
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
          event: matchedFailureEdge.eventType,
          toRoleId: matchedFailureEdge.toRoleId,
          branchId: args.currentBranch.branchId
        });
      }
    } else {
      const sessionLineageId = resolveNextSessionLineageId({
        currentNode: args.node,
        targetNode,
        currentBranch: args.currentBranch,
        targetRoleId: matchedFailureEdge.toRoleId,
        nextLoopIteration,
        nextBranchSequence,
        activatedTargetCount: 1
      });
      const branch = activateBranch({
        roleId: matchedFailureEdge.toRoleId,
        loopIteration: nextLoopIteration,
        branchSequence: nextBranchSequence,
        lineageId: args.currentBranch.lineageId,
        sessionLineageId,
        parentBranchId: args.currentBranch.branchId,
        activatedByRoleId: args.roleId,
        activatedByEvent: matchedFailureEdge.eventType
      });
      nextBranchSequence += 1;
      branchUpdates[branch.branchId] = branch;
      args.logger.transition({
        fromRoleId: args.roleId,
        event: matchedFailureEdge.eventType,
        toRoleId: matchedFailureEdge.toRoleId,
        branchId: args.currentBranch.branchId
      });
    }
  }

  if (reachedSystemOutput) {
    const hasOtherActiveBranches = Object.values(args.state.branchRecords).some(
      (branch) => branch.status === "active" && branch.branchId !== args.currentBranch.branchId
    );
    const hasActivatedBranches = Object.values(branchUpdates).some(
      (branch) => branch.status === "active"
    );
    if (!hasOtherActiveBranches && !hasActivatedBranches) {
      finalStatus = "done";
      finalOutput = args.audit.error ?? "";
      finalRoleId = args.roleId;
    }
  }

  return {
    update: {
      status: finalStatus,
      transitionCount: 1,
      recentAudits: [handledAudit],
      auditSummary: buildAuditSummaryDelta(handledAudit),
      roleMetricsByRoleId: buildRoleMetricsDelta(handledAudit),
      roleResults: storeRoleResult(args.currentBranch.branchId, handledFailureArtifact),
      branchRecords: branchUpdates,
      loopIterations: loopUpdates,
      selectedEventByBranchId: {
        [args.currentBranch.branchId]: matchedFailureEdge.eventType
      },
      finalOutput,
      finalRoleId,
      lastExecutedRoleId: args.roleId,
      nextBranchSequence
    },
    events: events.concat(joinEvents)
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
  // Session lineage models conversation-memory reuse rather than branch identity. Sequential
  // single-target flow inherits lineage; fan-out and join activation mint a new lineage so
  // sibling prompts cannot share the same model session by accident.
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

function findOrphanedJoinGroup(args: {
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

/**
 * buildSuccessUpdate calculates the next state of the graph after a role
 * successfully completes its execution. It handles:
 * 1. Marking the current branch as completed.
 * 2. Selecting target roles based on the routing mode (e.g., event-based or parallel).
 * 3. Checking loop budgets to prevent infinite cycles.
 * 4. Managing join nodes (waiting for all incoming paths if necessary).
 * 5. Activating new execution branches for the next roles.
 */
function buildSuccessTransitionPlan(args: {
  state: GraphState;
  plan: ExecutionPlan;
  contractPlan?: FlowContractPlan;
  roleId: string;
  currentBranch: BranchRecord;
  audit: AuditRecord;
  selectedEvent?: string;
  storedResult?: StoredRoleResult;
  mode: "ok" | "noop";
  logger: ReturnType<typeof createRunConsoleLogger>;
}): TransitionPlan {
  const node = getExecutionPlanNode(args.plan, args.roleId);
  const branchUpdates: Record<string, BranchRecord> = {
    [args.currentBranch.branchId]: completeBranch(args.currentBranch)
  };
  const loopUpdates: Record<string, number> = {
    [args.roleId]: args.currentBranch.loopIteration
  };
  let nextBranchSequence = args.state.nextBranchSequence;
  let finalStatus: GraphRunStatus = "running";
  let finalError = "";
  let finalOutput = "";
  let finalRoleId = "";
  let finalErrorEnvelope: RuntimeErrorEnvelope | undefined;
  let reachedSystemOutput = false;
  let terminalOutput = "";
  const joinEvents: JoinTransitionEvent[] = [];

  const candidateTargets = selectRoutingTargets({
    node,
    selectedEvent: args.selectedEvent,
    mode: args.mode
  });
  const flowContractPayload: Record<string, unknown> = {};
  if (args.storedResult?.event !== undefined) {
    flowContractPayload.event = args.storedResult.event;
  }
  if (args.storedResult?.content !== undefined) {
    flowContractPayload.content = args.storedResult.content;
  }
  if (args.storedResult?.data !== undefined) {
    flowContractPayload.data = args.storedResult.data;
  }

  const skippedTargets = new Set<string>();
  if (args.contractPlan?.handoffMode) {
    const contractValidationFailures: Array<{
      errorCode: string;
      message: string;
    }> = [];

    for (const targetRoleId of candidateTargets) {
      const flow = node.outgoing.find(
        (item) =>
          item.toRoleId === targetRoleId &&
          (node.routingMode === "parallel_split"
            ? !isRuntimeOnlyErrorEvent(item.eventType)
            : item.eventType === args.selectedEvent)
      );
      if (!flow || targetRoleId === SYSTEM_END_ROLE_ID || isRuntimeOnlyErrorEvent(flow.eventType)) {
        continue;
      }
      const contract =
        node.routingMode === "parallel_split"
          ? getSplitFlowContractByTarget({
              plan: args.contractPlan,
              fromRoleId: args.roleId,
              toRoleId: targetRoleId
            })
          : getFlowContractByTarget({
              plan: args.contractPlan,
              fromRoleId: args.roleId,
              toRoleId: targetRoleId,
              eventType: flow.eventType
            });

      if (!contract) {
        if (args.contractPlan.handoffMode === "strict") {
          contractValidationFailures.push({
            errorCode: "CONTRACT_MISSING",
            message: `Missing flow contract for ${args.roleId} -> ${targetRoleId} (${flow.eventType}) under handoff.mode=strict`
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
      const errorEnvelope: RuntimeErrorEnvelope = {
        errorCode: failure.errorCode,
        errorCategory: "validation",
        message: failure.message,
        retryable: false,
        stage: "execute",
        roleId: args.roleId,
        branchId: args.currentBranch.branchId
      };
      return {
        update: {
          status: "failed",
          error: failure.message,
          errorEnvelope,
          transitionCount: 1,
          recentAudits: [args.audit],
          auditSummary: buildAuditSummaryDelta(args.audit),
          roleMetricsByRoleId: buildRoleMetricsDelta(args.audit),
          roleResults: storeRoleResult(args.currentBranch.branchId, args.storedResult),
          branchRecords: branchUpdates,
          loopIterations: loopUpdates,
          selectedEventByBranchId: args.selectedEvent
            ? { [args.currentBranch.branchId]: args.selectedEvent }
            : {},
          finalRoleId: args.roleId,
          lastExecutedRoleId: args.roleId
        },
        events: []
      };
    }
  }

  for (const targetRoleId of candidateTargets) {
    const flow = node.outgoing.find(
      (item) =>
        item.toRoleId === targetRoleId &&
        (node.routingMode === "parallel_split"
          ? !isRuntimeOnlyErrorEvent(item.eventType)
          : item.eventType === args.selectedEvent)
    );
    if (args.contractPlan?.handoffMode && skippedTargets.has(targetRoleId)) {
      continue;
    }
    if (targetRoleId === SYSTEM_END_ROLE_ID) {
      reachedSystemOutput = true;
      terminalOutput = args.storedResult?.content ?? "";
      args.logger.transition({
        fromRoleId: args.roleId,
        event: flow?.eventType ?? args.selectedEvent,
        toRoleId: "output",
        branchId: args.currentBranch.branchId
      });
      continue;
    }

    if (
      wouldExceedLoopBudget({
        targetRoleId,
        currentLoopIteration: args.currentBranch.loopIteration,
        state: args.state,
        plan: args.plan
      })
    ) {
      // Failure window: exceeding the loop budget instantly terminates the run so we never cycle
      // indefinitely even if downstream logic keeps reactivating the same role.
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

    const nextLoopIteration = getTargetLoopIteration({
      targetRoleId,
      currentLoopIteration: args.currentBranch.loopIteration,
      state: args.state,
      plan: args.plan
    });
    loopUpdates[targetRoleId] = nextLoopIteration;

    const targetNode = getExecutionPlanNode(args.plan, targetRoleId);
    if (targetNode.joinMode) {
      // Invariant: join-mode nodes must hold off activation until the required sources replayed,
      // so we only activate a new branch after `readiness.ready` returns true and preserve the
      // pending list for diagnostics while the failure window is in-flight.
      const readiness = evaluateJoinNodeReadiness({
        node: targetNode,
        currentBranch: args.currentBranch,
        state: args.state,
        currentResult: args.storedResult
      });
      const joinId = buildJoinId(targetRoleId, nextLoopIteration);
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
        // Trade-off: logging wait events keeps recovery transparent, though we delay activation
        // until every required source materializes.
        args.logger.joinWait({
          roleId: targetRoleId,
          arrivedFrom: args.roleId,
          waitingFor: listPendingJoinSources({
            node: targetNode,
            currentBranch: args.currentBranch,
            state: args.state,
            currentResult: args.storedResult
          })
        });
        continue;
      }

      const sessionLineageId = resolveNextSessionLineageId({
        currentNode: node,
        targetNode,
        currentBranch: args.currentBranch,
        targetRoleId,
        nextLoopIteration,
        nextBranchSequence,
        activatedTargetCount: candidateTargets.length
      });
      const branch = activateBranch({
        roleId: targetRoleId,
        loopIteration: nextLoopIteration,
        branchSequence: nextBranchSequence,
        lineageId: args.currentBranch.lineageId,
        sessionLineageId,
        parentBranchId: args.currentBranch.branchId,
        activatedByRoleId: args.roleId,
        activatedByEvent: flow?.eventType ?? args.selectedEvent
      });
      nextBranchSequence += 1;
      branchUpdates[branch.branchId] = branch;
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
        event: flow?.eventType ?? args.selectedEvent,
        toRoleId: targetRoleId,
        branchId: args.currentBranch.branchId
      });
      continue;
    }

    const sessionLineageId = resolveNextSessionLineageId({
      currentNode: node,
      targetNode,
      currentBranch: args.currentBranch,
      targetRoleId,
      nextLoopIteration,
      nextBranchSequence,
      activatedTargetCount: candidateTargets.length
    });
    const branch = activateBranch({
      roleId: targetRoleId,
      loopIteration: nextLoopIteration,
      branchSequence: nextBranchSequence,
      lineageId: args.currentBranch.lineageId,
      sessionLineageId,
      parentBranchId: args.currentBranch.branchId,
      activatedByRoleId: args.roleId,
      activatedByEvent: flow?.eventType ?? args.selectedEvent
    });
    nextBranchSequence += 1;
    branchUpdates[branch.branchId] = branch;
    args.logger.transition({
      fromRoleId: args.roleId,
      event: flow?.eventType ?? args.selectedEvent,
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
      const orphanedJoinGroup =
        args.contractPlan?.handoffMode === "transition"
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
        finalOutput = terminalOutput;
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
      roleResults: storeRoleResult(args.currentBranch.branchId, args.storedResult),
      branchRecords: branchUpdates,
      loopIterations: loopUpdates,
      selectedEventByBranchId: args.selectedEvent
        ? { [args.currentBranch.branchId]: args.selectedEvent }
        : {},
      finalOutput,
      finalRoleId,
      lastExecutedRoleId: args.roleId,
      nextBranchSequence
    },
    events: joinEvents
  };
}

/**
 * The synthetic scheduler node keeps graph control flow centralized. Role nodes only execute
 * their active branches, emit state updates, and hand control back so scheduling decisions
 * stay in one place.
 */
export async function runSystemWithGraphRunner(args: RunnerInput): Promise<AdapterRunResult> {
  const logger = createRunConsoleLogger(args.logRun);
  const graphBuilder = new StateGraph(GraphStateAnnotation) as StateGraph<
    typeof GraphStateAnnotation.spec,
    GraphState,
    GraphUpdate,
    string
  >;

  graphBuilder.addNode(SCHEDULER_NODE_ID, async () => ({}));

  for (const roleId of args.plan.roleIds) {
    const node = getExecutionPlanNode(args.plan, roleId);
    graphBuilder.addNode(roleId, async (state: GraphState) => {
      const activeBranches = listActiveBranches(state, roleId);
      if (activeBranches.length === 0) {
        return {};
      }

      let workingState = state;
      let combinedUpdate: GraphUpdate = {};

      for (const branch of activeBranches) {
        const result = await executeRoleNode({
          roleId,
          node,
          plan: args.plan,
          state: workingState,
          branch,
          effectiveLaw: args.effectiveLaw,
          profilesById: args.profilesById,
          toolsByRef: args.toolsByRef,
          modelsById: args.modelsById,
          rolePackagesByRoleId: args.rolePackagesByRoleId,
          contractPlan: args.contractPlan,
          compilerSnapshot: args.compilerSnapshot,
          runContext: args.runContext,
          executor: args.executor,
          userProfile: args.userProfile,
          workdir: args.workdir,
          logger
        });

        const transitionPlan =
          result.status === "failed"
            ? (() => {
                if (args.errorFlowRoutingEnabled) {
                  const handledTransition = buildHandledFailureTransitionPlan({
                    state: workingState,
                    plan: args.plan,
                    node,
                    roleId,
                    currentBranch: branch,
                    audit: result.audit,
                    errorEnvelope: result.failure,
                    logger
                  });
                  if (handledTransition) {
                    return handledTransition;
                  }
                }
                return {
                  update: buildFailureUpdate({
                    roleId,
                    branch,
                    error: result.error,
                    errorEnvelope: result.failure,
                    audit: result.audit
                  }),
                  events: [] as RuntimeTransitionEvent[]
                };
              })()
            : buildSuccessTransitionPlan({
                state: workingState,
                plan: args.plan,
                contractPlan: args.contractPlan,
                roleId,
                currentBranch: branch,
                audit: result.audit,
                selectedEvent: result.selectedEvent,
                storedResult: result.storedResult,
                mode: result.status,
                logger
              });

        maybeCrashAfterExecutionOutcome();
        const checkpoint = await persistRuntimeCheckpoint({
          context: args.runContext,
          roleId,
          branchId: branch.branchId,
          loopIteration: branch.loopIteration,
          executionId: result.executionId,
          update: transitionPlan.update
        });
        const roleDirs = args.runContext.roleDirsById.get(roleId);
        if (!roleDirs) {
          throw new Error(`Role run directory missing for "${roleId}"`);
        }
        await markRoleExecutionOutcomeReconciled({
          executionDir: resolve(roleDirs.executionsDir, result.executionId),
          checkpointSequence: checkpoint.checkpointSequence
        });
        for (const event of transitionPlan.events) {
          await appendEvent(args.runContext, event);
        }

        workingState = applyGraphUpdate(workingState, checkpoint.update);
        combinedUpdate = mergeGraphUpdates(combinedUpdate, checkpoint.update);

        if (workingState.status === "running") {
          // Trade-off: stop requests are honored as soon as we see them but still let the current
          // transition complete so auditing stays consistent.
          const stopRequest = await readRunStopRequest(args.runContext.runDir);
          if (stopRequest) {
            const stopUpdate: GraphUpdate = { status: "stopping" };
            workingState = applyGraphUpdate(workingState, stopUpdate);
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

        if (workingState.status !== "running") {
          break;
        }
      }

      return combinedUpdate;
    });
    graphBuilder.addEdge(roleId, SCHEDULER_NODE_ID);
  }

  graphBuilder.addEdge(START, SCHEDULER_NODE_ID);
  // Invariant: the scheduler can only move to END when no active roles remain so that every
  // transition is explicitly drained before termination.
  graphBuilder.addConditionalEdges(SCHEDULER_NODE_ID, (state: GraphState) => {
    if (state.status !== "running") {
      return END;
    }
    const activeRoles = getActiveRoleIds(state);
    if (activeRoles.length === 0) {
      return END;
    }
    return activeRoles[0];
  });

  const graph = graphBuilder.compile();
  let finalState = args.initialState ?? createInitialGraphState({ plan: args.plan, prompt: args.prompt });
  if (args.initialState) {
    // Reliability: restore the exact state frontier by replaying checkpoint WAL first,
    // then reconciling any committed role outcomes that crashed before checkpoint emission.
    finalState = await reconcileCommittedRoleExecutionOutcomes({
      state: finalState,
      plan: args.plan,
      contractPlan: args.contractPlan,
      runContext: args.runContext,
      errorFlowRoutingEnabled: args.errorFlowRoutingEnabled
    });
  }
  logger.runStart({
    runId: args.runContext.runId,
    systemId: args.plan.systemId,
    entryRoleId: args.plan.entryRoleId,
    resume: Boolean(args.initialState)
  });
  await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });

  const recursionLimit = calculateGraphRecursionLimit(args.effectiveLaw.maxTransitions);
  // Trade-off: we double the transition budget for the scheduler hops so recursion depth stays
  // bounded even when LangGraph counts scheduler nodes and role nodes separately.
  const stream = await graph.stream(finalState, {
    streamMode: "values",
    recursionLimit
  });

  for await (const chunk of stream) {
    finalState = chunk;
    await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
  }

  if (finalState.status === "running" && args.contractPlan?.handoffMode === "transition") {
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
    finalState = {
      ...finalState,
      status: "done"
    };
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
      `- finalRoleId: ${finalState.finalRoleId}`,
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
    await cleanupExecutionHistory({
      state: finalState,
      runContext: args.runContext,
      keepLatest: args.cleanupExecutionHistory
    });
    await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
  } else if (
    args.autoCleanupRetention &&
    args.runContext.executionDirCount > args.autoCleanupRetention.executionDirThreshold
  ) {
    await cleanupExecutionHistory({
      state: finalState,
      runContext: args.runContext,
      keepLatest: args.autoCleanupRetention.keepLatest
    });
    await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
  }

  logger.runEnd({
    status:
      finalState.status === "failed"
        ? "failed"
        : finalState.status === "stopped"
          ? "stopped"
          : "done",
    finalRoleId: finalState.finalRoleId || undefined,
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
        : finalState.status === "stopped"
          ? "stopped"
          : "done",
    finalRoleId: finalState.finalRoleId || undefined,
    finalOutput: finalState.finalOutput || undefined,
    systemState: {
      status: finalState.status,
      currentRoleId: finalState.finalRoleId || finalState.lastExecutedRoleId || args.plan.entryRoleId,
      nextRoleId: undefined,
      finalRoleId: finalState.finalRoleId || undefined,
      transitionCount: finalState.transitionCount,
      totalTransitions: summary.totalTransitions,
      okCount: summary.okCount,
      failedCount: summary.failedCount,
      noopCount: summary.noopCount,
      failureCountsByErrorCode: summary.failureCountsByErrorCode,
      lastOutput: finalState.finalOutput || undefined,
      error: finalState.error || undefined,
      errorEnvelope: finalState.errorEnvelope || undefined
    },
    runSummary: summary,
    stages,
    auditTrail,
    error: finalState.error || undefined,
    errorEnvelope: finalState.errorEnvelope || undefined
  };
}
