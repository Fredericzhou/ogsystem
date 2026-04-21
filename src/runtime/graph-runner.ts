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
import {
  createInitialGraphState,
  getActiveRoleIds,
  listActiveBranches,
  projectStateSnapshot
} from "./graph-runtime-state.js";
import { applyGraphUpdateToIndexes, buildRuntimeIndexes } from "./runtime-indexes.js";
import type { RuntimeIndexes } from "./runtime-indexes.js";
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
import { buildRunSummaryProjection } from "./run-summary-schema.js";
import { projectStages } from "./stage-projector.js";
import { rebuildTimelineProjection } from "./timeline-projector.js";
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
import { findOrphanedJoinGroup, planTransition } from "./transition-planner.js";
import type { TransitionPlan } from "./transition-planner.js";
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

type GraphUpdate = GraphStateUpdate;

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
    const projectionUpdatedAt = new Date().toISOString();
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

function buildGraphUpdateFromOutcome(args: {
  state: GraphState;
  plan: ExecutionPlan;
  contractPlan?: FlowContractPlan;
  outcome: RoleExecutionOutcomeRecord;
  logger: ReturnType<typeof createRunConsoleLogger>;
  errorFlowRoutingEnabled: boolean;
  indexes?: RuntimeIndexes;
}): TransitionPlan {
  return planTransition({
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
}): Promise<{
  state: GraphState;
  indexes: RuntimeIndexes;
}> {
  // Resume first trusts the existing checkpoint WAL, then heals only the crash window where
  // role execution committed durably but the checkpoint was never written or reconciled.
  const replay = await replayPendingRuntimeCheckpoints({
    state: args.state,
    runContext: args.runContext
  });
  let reconciledState = replay.state;
  let indexes = buildRuntimeIndexes(reconciledState);
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
      errorFlowRoutingEnabled: args.errorFlowRoutingEnabled,
      indexes
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
    indexes = applyGraphUpdateToIndexes(indexes, checkpoint.update);
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

/**
 * The synthetic scheduler node keeps graph control flow centralized. Role nodes only execute
 * their active branches, emit state updates, and hand control back so scheduling decisions
 * stay in one place.
 */
export async function runSystemWithGraphRunner(args: RunnerInput): Promise<AdapterRunResult> {
  const logger = createRunConsoleLogger(args.logRun);
  let runtimeIndexes = buildRuntimeIndexes(
    args.initialState ?? createInitialGraphState({ plan: args.plan, prompt: args.prompt })
  );
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
      const activeBranches = listActiveBranches(state, roleId, runtimeIndexes);
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
          rolePackagesByRoleId: args.rolePackagesByRoleId,
          contractPlan: args.contractPlan,
          compilerSnapshot: args.compilerSnapshot,
          runContext: args.runContext,
          executor: args.executor,
          userProfile: args.userProfile,
          workdir: args.workdir,
          logger
        });

        const transitionPlan = planTransition({
          state: workingState,
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
        runtimeIndexes = applyGraphUpdateToIndexes(runtimeIndexes, checkpoint.update);
        combinedUpdate = mergeGraphUpdates(combinedUpdate, checkpoint.update);

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
    const activeRoles = getActiveRoleIds(state, runtimeIndexes);
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
    const reconciled = await reconcileCommittedRoleExecutionOutcomes({
      state: finalState,
      plan: args.plan,
      contractPlan: args.contractPlan,
      runContext: args.runContext,
      errorFlowRoutingEnabled: args.errorFlowRoutingEnabled
    });
    finalState = reconciled.state;
    runtimeIndexes = reconciled.indexes;
  } else {
    runtimeIndexes = buildRuntimeIndexes(finalState);
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
