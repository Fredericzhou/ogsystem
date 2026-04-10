import { resolve } from "node:path";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { createRunConsoleLogger } from "./console-run-log.js";
import type { Executor } from "./executor.js";
import { getExecutionPlanNode } from "./execution-plan.js";
import { isJoinNodeReady, selectRoutingTargets } from "./graph-mode-registry.js";
import {
  activateBranch,
  completeBranch,
  createInitialGraphState,
  getActiveRoleIds,
  getTargetLoopIteration,
  projectStateSnapshot,
  storeRoleResult,
  wouldExceedLoopBudget
} from "./graph-runtime-state.js";
import { executeRoleNode } from "./role-executor.js";
import { createRuntimeError, normalizeRuntimeError } from "./runtime-errors.js";
import { summarizeRun } from "./run-summary.js";
import { projectStages } from "./stage-projector.js";
import { stringifyJson } from "./runtime-support.js";
import { cleanupHistoricalExecutionSnapshots, writeAtomicFile } from "./run-artifacts.js";
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
  RuntimeErrorEnvelope,
  StoredRoleResult,
  UserProfile
} from "./types.js";

type GraphUpdate = Partial<GraphState>;

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
  currentRoleId: string;
  loopIteration: number;
  state: GraphState;
}): string[] {
  return args.node.joinSources.filter((sourceRoleId) => {
    if (sourceRoleId === args.currentRoleId) {
      return false;
    }
    const result = args.state.roleResults[sourceRoleId];
    return !result || result.loopIteration !== args.loopIteration;
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
  selectedEventByRoleId: Annotation<Record<string, string>>({
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
  })
});

async function persistProjectedState(args: {
  state: GraphState;
  plan: ExecutionPlan;
  runContext: RunContext;
}): Promise<void> {
  try {
    await writeAtomicFile(args.runContext.statePath, stringifyJson(projectStateSnapshot(args)));
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
  branchId: string;
  loopIteration: number;
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
      [args.branchId]: {
        branchId: args.branchId,
        roleId: args.roleId,
        loopIteration: args.loopIteration,
        status: "completed"
      }
    }
  };
}

function buildSuccessUpdate(args: {
  state: GraphState;
  plan: ExecutionPlan;
  roleId: string;
  branchId: string;
  loopIteration: number;
  audit: AuditRecord;
  selectedEvent?: string;
  storedResult?: StoredRoleResult;
  mode: "ok" | "noop";
  logger: ReturnType<typeof createRunConsoleLogger>;
}): GraphUpdate {
  const node = getExecutionPlanNode(args.plan, args.roleId);
  const branchUpdates: Record<string, BranchRecord> = {
    [args.branchId]: completeBranch({
      branchId: args.branchId,
      roleId: args.roleId,
      loopIteration: args.loopIteration
    })
  };
  const loopUpdates: Record<string, number> = {
    [args.roleId]: args.loopIteration
  };
  let finalStatus: GraphRunStatus = "running";
  let finalError = "";
  let finalOutput = "";
  let finalRoleId = "";
  let finalErrorEnvelope: RuntimeErrorEnvelope | undefined;

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
      finalStatus = "done";
      finalOutput = args.storedResult?.content ?? "";
      finalRoleId = args.roleId;
      args.logger.transition({
        fromRoleId: args.roleId,
        event: flow?.eventType ?? args.selectedEvent,
        toRoleId: "output",
        branchId: args.branchId
      });
      continue;
    }

    if (
      wouldExceedLoopBudget({
        targetRoleId,
        currentLoopIteration: args.loopIteration,
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
        branchId: args.branchId
      };
      finalRoleId = args.roleId;
      break;
    }

    const nextLoopIteration = getTargetLoopIteration({
      targetRoleId,
      currentLoopIteration: args.loopIteration,
      state: args.state,
      plan: args.plan
    });
    loopUpdates[targetRoleId] = nextLoopIteration;

    const targetNode = getExecutionPlanNode(args.plan, targetRoleId);
    if (targetNode.joinMode === "all_of") {
      if (isJoinNodeReady({
        node: targetNode,
        currentRoleId: args.roleId,
        loopIteration: args.loopIteration,
        state: args.state,
        currentResult: args.storedResult
      })) {
        const branch = activateBranch({
          roleId: targetRoleId,
          loopIteration: nextLoopIteration
        });
        branchUpdates[branch.branchId] = branch;
        args.logger.transition({
          fromRoleId: args.roleId,
          event: flow?.eventType ?? args.selectedEvent,
          toRoleId: targetRoleId,
          branchId: args.branchId
        });
      } else {
        args.logger.joinWait({
          roleId: targetRoleId,
          arrivedFrom: args.roleId,
          waitingFor: listPendingJoinSources({
            node: targetNode,
            currentRoleId: args.roleId,
            loopIteration: args.loopIteration,
            state: args.state
          })
        });
      }
      continue;
    }

    const branch = activateBranch({
      roleId: targetRoleId,
      loopIteration: nextLoopIteration
    });
    branchUpdates[branch.branchId] = branch;
    args.logger.transition({
      fromRoleId: args.roleId,
      event: flow?.eventType ?? args.selectedEvent,
      toRoleId: targetRoleId,
      branchId: args.branchId
    });
  }

  return {
    status: finalStatus,
    error: finalError,
    errorEnvelope: finalErrorEnvelope,
    transitionCount: 1,
    auditTrail: [args.audit],
    roleResults: storeRoleResult(args.roleId, args.storedResult),
    branchRecords: branchUpdates,
    loopIterations: loopUpdates,
    selectedEventByRoleId: args.selectedEvent ? { [args.roleId]: args.selectedEvent } : {},
    finalOutput,
    finalRoleId,
    lastExecutedRoleId: args.roleId
  };
}

export async function runSystemWithGraphRunner(args: RunnerInput): Promise<AdapterRunResult> {
  const logger = createRunConsoleLogger(args.logRun);
  const graphBuilder = new StateGraph(GraphStateAnnotation) as StateGraph<
    typeof GraphStateAnnotation.spec,
    GraphState,
    GraphUpdate,
    string
  >;

  for (const roleId of args.plan.roleIds) {
    const node = getExecutionPlanNode(args.plan, roleId);
    graphBuilder.addNode(roleId, async (state: GraphState) => {
      const result = await executeRoleNode({
        roleId,
        node,
        plan: args.plan,
        state,
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

      if (result.status === "failed") {
        return buildFailureUpdate({
          roleId,
          branchId: result.branchId,
          loopIteration: result.loopIteration,
          error: result.error,
          errorEnvelope: result.failure,
          audit: result.audit
        });
      }

      return buildSuccessUpdate({
        state,
        plan: args.plan,
        roleId,
        branchId: result.branchId,
        loopIteration: result.loopIteration,
        audit: result.audit,
        selectedEvent: result.selectedEvent,
        storedResult: result.storedResult,
        mode: result.status,
        logger
      });
    });
  }

  graphBuilder.addConditionalEdges(START, (state: GraphState) => {
    if (state.status !== "running") {
      return END;
    }
    const activeRoles = getActiveRoleIds(state);
    if (activeRoles.length === 0) {
      return END;
    }
    return activeRoles;
  });

  for (const roleId of args.plan.roleIds) {
    const node = getExecutionPlanNode(args.plan, roleId);
    if (node.joinSources.length > 0) {
      graphBuilder.addEdge(node.joinSources, roleId);
    }

    if (node.routingMode === "parallel_split") {
      for (const flow of node.outgoing) {
        if (flow.toRoleId === SYSTEM_END_ROLE_ID) {
          graphBuilder.addEdge(roleId, END);
          continue;
        }
        if (getExecutionPlanNode(args.plan, flow.toRoleId).joinMode === "all_of") {
          continue;
        }
        graphBuilder.addEdge(roleId, flow.toRoleId);
      }
      continue;
    }

    if (node.outgoing.length === 0) {
      graphBuilder.addEdge(roleId, END);
      continue;
    }

    if (node.outgoing.length === 1) {
      const onlyFlow = node.outgoing[0];
      if (onlyFlow.toRoleId === SYSTEM_END_ROLE_ID) {
        graphBuilder.addEdge(roleId, END);
      } else if (getExecutionPlanNode(args.plan, onlyFlow.toRoleId).joinMode !== "all_of") {
        graphBuilder.addEdge(roleId, onlyFlow.toRoleId);
      }
      continue;
    }

    graphBuilder.addConditionalEdges(roleId, (state: GraphState) => {
      if (state.status !== "running") {
        return END;
      }
      const selectedEvent = state.selectedEventByRoleId[roleId];
      const selectedFlow = node.outgoing.find((flow) => flow.eventType === selectedEvent);
      if (!selectedFlow || selectedFlow.toRoleId === SYSTEM_END_ROLE_ID) {
        return END;
      }
      return selectedFlow.toRoleId;
    });
  }

  const graph = graphBuilder.compile();
  let finalState = args.initialState ?? createInitialGraphState({ plan: args.plan, prompt: args.prompt });
  logger.runStart({
    runId: args.runContext.runId,
    systemId: args.plan.systemId,
    entryRoleId: args.plan.entryRoleId,
    resume: Boolean(args.initialState)
  });
  await persistProjectedState({ state: finalState, plan: args.plan, runContext: args.runContext });

  const recursionLimit = (args.effectiveLaw.maxTransitions ?? 100) + 20;
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
