import { resolve } from "node:path";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { createRunConsoleLogger } from "./console-run-log.js";
import type { Executor } from "./executor.js";
import { getExecutionPlanNode } from "./execution-plan.js";
import { isJoinNodeReady, selectRoutingTargets } from "./graph-mode-registry.js";
import {
  activateBranch,
  buildBranchId,
  completeBranch,
  createInitialGraphState,
  findRoleResult,
  getActiveRoleIds,
  getTargetLoopIteration,
  listActiveBranches,
  projectStateSnapshot,
  storeRoleResult,
  wouldExceedLoopBudget
} from "./graph-runtime-state.js";
import { executeRoleNode } from "./role-executor.js";
import { createRuntimeError, normalizeRuntimeError } from "./runtime-errors.js";
import { summarizeRun } from "./run-summary.js";
import { projectStages } from "./stage-projector.js";
import { stringifyJson } from "./runtime-support.js";
import {
  cleanupHistoricalExecutionSnapshots,
  flushBufferedRunArtifacts,
  loadCommittedRoleExecutionOutcomes,
  loadPendingRuntimeCheckpoints,
  markRoleExecutionOutcomeReconciled,
  persistRuntimeCheckpoint,
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
  UserProfile
} from "./types.js";

type GraphUpdate = GraphStateUpdate;

const SCHEDULER_NODE_ID = "__scheduler__";
const DEFAULT_TRANSITION_BUDGET = 100;
const GRAPH_RECURSION_MARGIN = 20;
const TEST_CRASH_AFTER_EXECUTION_OUTCOME_ENV = "OGSYSTEM_TEST_CRASH_AFTER_EXECUTION_OUTCOME";

type RunnerInput = {
  plan: ExecutionPlan;
  effectiveLaw: EffectiveLawConstraints;
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
  logRun: boolean;
};

function listPendingJoinSources(args: {
  node: ExecutionPlanNode;
  currentBranch: BranchRecord;
  state: GraphState;
}): string[] {
  return args.node.joinSources.filter((sourceRoleId) => {
    if (sourceRoleId === args.currentBranch.roleId) {
      return false;
    }
    return !findRoleResult({
      state: args.state,
      roleId: sourceRoleId,
      lineageId: args.currentBranch.lineageId,
      loopIteration: args.currentBranch.loopIteration
    });
  });
}

function mergeStatus(current: GraphRunStatus, update: GraphRunStatus): GraphRunStatus {
  if (current === "failed" || update === "failed") {
    return "failed";
  }
  if (current === "done" || update === "done") {
    return "done";
  }
  return update;
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
  auditTrail: Annotation<AuditRecord[]>({
    reducer: (current, update) => current.concat(update),
    default: () => []
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
    auditTrail: [...(current.auditTrail ?? []), ...(update.auditTrail ?? [])],
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
    auditTrail: state.auditTrail.concat(update.auditTrail ?? []),
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
    await writeAtomicFile(args.runContext.statePath, stringifyJson(projectStateSnapshot(args)));
    await writeAtomicFile(
      args.runContext.metricsPath,
      stringifyJson(projectMetricsSnapshot(args))
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
}): Record<string, unknown> {
  const summary = summarizeRun({
    auditTrail: args.state.auditTrail,
    transitionCount: args.state.transitionCount,
    terminalStatus: args.state.status,
    terminalErrorEnvelope: args.state.errorEnvelope
  });
  const roleMetrics = args.state.auditTrail.reduce<Record<string, Record<string, number>>>(
    (accumulator, audit) => {
      const current = accumulator[audit.roleId] ?? {
        total: 0,
        ok: 0,
        failed: 0,
        noop: 0,
        durationMsTotal: 0
      };
      current.total += 1;
      current.durationMsTotal += audit.durationMs;
      if (audit.status === "ok") {
        current.ok += 1;
      } else if (audit.status === "failed") {
        current.failed += 1;
      } else {
        current.noop += 1;
      }
      accumulator[audit.roleId] = current;
      return accumulator;
    },
    {}
  );

  return {
    runId: args.runContext.runId,
    systemId: args.plan.systemId,
    systemVersion: args.plan.systemVersion,
    status: args.state.status,
    transitionCount: args.state.transitionCount,
    summary,
    failureCountsByErrorCode: summary.failureCountsByErrorCode,
    roleMetrics
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

function buildGraphUpdateFromOutcome(args: {
  state: GraphState;
  plan: ExecutionPlan;
  outcome: RoleExecutionOutcomeRecord;
  logger: ReturnType<typeof createRunConsoleLogger>;
}): GraphUpdate {
  if (args.outcome.status === "failed") {
    return buildFailureUpdate({
      roleId: args.outcome.roleId,
      branch: args.outcome.branch,
      error: args.outcome.error,
      errorEnvelope: args.outcome.failure,
      audit: args.outcome.audit
    });
  }

  return buildSuccessUpdate({
    state: args.state,
    plan: args.plan,
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
  runContext: RunContext;
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

    const update = buildGraphUpdateFromOutcome({
      state: reconciledState,
      plan: args.plan,
      outcome,
      logger
    });
    const checkpoint = await persistRuntimeCheckpoint({
      context: args.runContext,
      roleId: outcome.roleId,
      branchId: outcome.branchId,
      loopIteration: outcome.loopIteration,
      executionId: outcome.executionId,
      update
    });
    const roleDirs = args.runContext.roleDirsById.get(outcome.roleId);
    if (!roleDirs) {
      throw new Error(`Role run directory missing for "${outcome.roleId}"`);
    }
    await markRoleExecutionOutcomeReconciled({
      executionDir: resolve(roleDirs.executionsDir, outcome.executionId),
      checkpointSequence: checkpoint.checkpointSequence
    });
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
    auditTrail: [args.audit],
    finalRoleId: args.roleId,
    lastExecutedRoleId: args.roleId,
    branchRecords: {
      [args.branch.branchId]: completeBranch(args.branch)
    }
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
    args.targetNode.joinMode === "all_of"
  ) {
    return buildBranchId(args.targetRoleId, args.nextLoopIteration, args.nextBranchSequence);
  }
  return args.currentBranch.sessionLineageId;
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
function buildSuccessUpdate(args: {
  state: GraphState;
  plan: ExecutionPlan;
  roleId: string;
  currentBranch: BranchRecord;
  audit: AuditRecord;
  selectedEvent?: string;
  storedResult?: StoredRoleResult;
  mode: "ok" | "noop";
  logger: ReturnType<typeof createRunConsoleLogger>;
}): GraphUpdate {
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

  const candidateTargets = selectRoutingTargets({
    node,
    selectedEvent: args.selectedEvent,
    mode: args.mode
  });

  for (const targetRoleId of candidateTargets) {
    const flow = node.outgoing.find(
      (item) =>
        item.toRoleId === targetRoleId &&
        (node.routingMode === "parallel_split" || item.eventType === args.selectedEvent)
    );
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
    const sessionLineageId = resolveNextSessionLineageId({
      currentNode: node,
      targetNode,
      currentBranch: args.currentBranch,
      targetRoleId,
      nextLoopIteration,
      nextBranchSequence,
      activatedTargetCount: candidateTargets.length
    });
    if (targetNode.joinMode === "all_of") {
      if (isJoinNodeReady({
        node: targetNode,
        currentBranch: args.currentBranch,
        state: args.state,
        currentResult: args.storedResult
      })) {
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
      } else {
        args.logger.joinWait({
          roleId: targetRoleId,
          arrivedFrom: args.roleId,
          waitingFor: listPendingJoinSources({
            node: targetNode,
            currentBranch: args.currentBranch,
            state: args.state
          })
        });
      }
      continue;
    }

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
      finalStatus = "done";
      finalOutput = terminalOutput;
      finalRoleId = args.roleId;
    }
  }

  return {
    status: finalStatus,
    error: finalError,
    errorEnvelope: finalErrorEnvelope,
    transitionCount: 1,
    auditTrail: [args.audit],
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
          runContext: args.runContext,
          executor: args.executor,
          userProfile: args.userProfile,
          workdir: args.workdir,
          logger
        });

        const branchUpdate =
          result.status === "failed"
            ? buildFailureUpdate({
                roleId,
                branch,
                error: result.error,
                errorEnvelope: result.failure,
                audit: result.audit
              })
            : buildSuccessUpdate({
                state: workingState,
                plan: args.plan,
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
          update: branchUpdate
        });
        const roleDirs = args.runContext.roleDirsById.get(roleId);
        if (!roleDirs) {
          throw new Error(`Role run directory missing for "${roleId}"`);
        }
        await markRoleExecutionOutcomeReconciled({
          executionDir: resolve(roleDirs.executionsDir, result.executionId),
          checkpointSequence: checkpoint.checkpointSequence
        });

        workingState = applyGraphUpdate(workingState, checkpoint.update);
        combinedUpdate = mergeGraphUpdates(combinedUpdate, checkpoint.update);

        if (workingState.status !== "running") {
          break;
        }
      }

      return combinedUpdate;
    });
    graphBuilder.addEdge(roleId, SCHEDULER_NODE_ID);
  }

  graphBuilder.addEdge(START, SCHEDULER_NODE_ID);
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
      runContext: args.runContext
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
  const stream = await graph.stream(finalState, {
    streamMode: "values",
    recursionLimit
  });

  for await (const chunk of stream) {
    finalState = chunk;
    await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
  }

  if (finalState.status === "running") {
    finalState = {
      ...finalState,
      status: "done"
    };
    await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });
  }

  const auditTrail = finalState.auditTrail;
  const stages = projectStages({ auditTrail });
  const summary = summarizeRun({
    auditTrail,
    transitionCount: finalState.transitionCount
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
      `- noopCount: ${summary.noopCount}`,
      `- failureCountsByErrorCode: ${stringifyJson(summary.failureCountsByErrorCode)}`,
      `- repairStats.attemptedCount: ${summary.repairStats.attemptedCount}`,
      `- repairStats.appliedCount: ${summary.repairStats.appliedCount}`,
      `- opencodeServerUrl: ${serverMetadata.url ?? ""}`,
      `- opencodeServerPid: ${serverMetadata.pid ?? ""}`,
      `- opencodeServerStartedAt: ${serverMetadata.startedAt ?? ""}`
    ].join("\n")
  });

  if (args.cleanupExecutionHistory !== undefined) {
    await cleanupExecutionHistory({
      state: finalState,
      runContext: args.runContext,
      keepLatest: args.cleanupExecutionHistory
    });
  }

  logger.runEnd({
    status: finalState.status === "failed" ? "failed" : "done",
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
    status: finalState.status === "failed" ? "failed" : "done",
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
