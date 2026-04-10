import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import type { Executor } from "./executor.js";
import { getExecutionPlanNode } from "./execution-plan.js";
import { executeRoleNode } from "./role-executor.js";
import { projectStages } from "./stage-projector.js";
import { stringifyJson } from "./runtime-support.js";
import { SYSTEM_END_ROLE_ID } from "./types.js";
import type {
  AdapterRunResult,
  AuditRecord,
  BranchRecord,
  CliTool,
  EffectiveLawConstraints,
  ExecutionPlan,
  ExecutionProfile,
  GraphRunStatus,
  GraphState,
  LoadedModelPackage,
  LoadedRolePackage,
  RunContext,
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
};

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

function buildBranchId(roleId: string, loopIteration: number): string {
  return `${roleId}@${loopIteration}`;
}

function getTargetLoopIteration(args: {
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

function wouldExceedLoopBudget(args: {
  targetRoleId: string;
  currentLoopIteration: number;
  state: GraphState;
  plan: ExecutionPlan;
}): boolean {
  const targetNode = getExecutionPlanNode(args.plan, args.targetRoleId);
  if (targetNode.loopMax === undefined) {
    return false;
  }
  return getTargetLoopIteration(args) > targetNode.loopMax;
}

function allJoinSourcesReady(args: {
  joinRoleId: string;
  currentRoleId: string;
  loopIteration: number;
  state: GraphState;
  plan: ExecutionPlan;
  currentResult?: StoredRoleResult;
}): boolean {
  const joinNode = getExecutionPlanNode(args.plan, args.joinRoleId);
  for (const sourceRoleId of joinNode.joinSources) {
    if (sourceRoleId === args.currentRoleId) {
      continue;
    }
    const result = args.state.roleResults[sourceRoleId];
    if (!result || result.loopIteration !== args.loopIteration) {
      return false;
    }
  }
  return Boolean(args.currentResult || args.state.roleResults[args.currentRoleId]);
}

function projectStateSnapshot(args: {
  state: GraphState;
  plan: ExecutionPlan;
}): Record<string, unknown> {
  const branches = Object.values(args.state.branchRecords);
  const activeBranches = branches.filter((branch) => branch.status === "active");
  const completedBranches = branches.filter((branch) => branch.status === "completed");
  const pendingJoinRoleIds = activeBranches
    .map((branch) => branch.roleId)
    .filter((roleId) => getExecutionPlanNode(args.plan, roleId).joinMode === "all_of");

  return {
    status: args.state.status,
    currentRoleId: args.state.finalRoleId || args.state.lastExecutedRoleId || args.plan.entryRoleId,
    nextRoleId: activeBranches.length === 1 ? activeBranches[0].roleId : undefined,
    finalRoleId: args.state.finalRoleId || undefined,
    transitionCount: args.state.transitionCount,
    lastOutput: args.state.finalOutput || undefined,
    error: args.state.error || undefined,
    activeBranches,
    completedBranches,
    pendingJoinRoleIds,
    loopIterations: args.state.loopIterations,
    roleResults: args.state.roleResults,
    graphState: args.state
  };
}

async function persistProjectedState(args: {
  state: GraphState;
  plan: ExecutionPlan;
  runContext: RunContext;
}): Promise<void> {
  await writeFile(args.runContext.statePath, stringifyJson(projectStateSnapshot(args)), "utf8");
}

function createInitialState(plan: ExecutionPlan, prompt: string): GraphState {
  return {
    userPrompt: prompt,
    status: "running",
    error: "",
    transitionCount: 0,
    auditTrail: [],
    roleResults: {},
    branchRecords: {
      [buildBranchId(plan.entryRoleId, 1)]: {
        branchId: buildBranchId(plan.entryRoleId, 1),
        roleId: plan.entryRoleId,
        loopIteration: 1,
        status: "active"
      }
    },
    loopIterations: {
      [plan.entryRoleId]: 1
    },
    selectedEventByRoleId: {},
    finalOutput: "",
    finalRoleId: "",
    lastExecutedRoleId: ""
  };
}

function buildFailureUpdate(args: {
  roleId: string;
  branchId: string;
  loopIteration: number;
  error: string;
  audit: AuditRecord;
}): GraphUpdate {
  return {
    status: "failed",
    error: args.error,
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
}): GraphUpdate {
  const node = getExecutionPlanNode(args.plan, args.roleId);
  const branchUpdates: Record<string, BranchRecord> = {
    [args.branchId]: {
      branchId: args.branchId,
      roleId: args.roleId,
      loopIteration: args.loopIteration,
      status: "completed"
    }
  };
  const loopUpdates: Record<string, number> = {
    [args.roleId]: args.loopIteration
  };
  let finalStatus: GraphRunStatus = "running";
  let finalError = "";
  let finalOutput = "";
  let finalRoleId = "";

  const candidateTargets =
    args.mode === "noop"
      ? node.outgoing.map((flow) => flow.toRoleId).slice(0, 1)
      : node.routingMode === "parallel_split"
        ? node.outgoing.map((flow) => flow.toRoleId)
        : node.outgoing
            .filter((flow) => flow.eventType === args.selectedEvent)
            .map((flow) => flow.toRoleId);

  for (const targetRoleId of candidateTargets) {
    if (targetRoleId === SYSTEM_END_ROLE_ID) {
      finalStatus = "done";
      finalOutput = args.storedResult?.content ?? "";
      finalRoleId = args.roleId;
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
      if (
        allJoinSourcesReady({
          joinRoleId: targetRoleId,
          currentRoleId: args.roleId,
          loopIteration: args.loopIteration,
          state: args.state,
          plan: args.plan,
          currentResult: args.storedResult
        })
      ) {
        const nextBranchId = buildBranchId(targetRoleId, nextLoopIteration);
        branchUpdates[nextBranchId] = {
          branchId: nextBranchId,
          roleId: targetRoleId,
          loopIteration: nextLoopIteration,
          status: "active"
        };
      }
      continue;
    }

    const nextBranchId = buildBranchId(targetRoleId, nextLoopIteration);
    branchUpdates[nextBranchId] = {
      branchId: nextBranchId,
      roleId: targetRoleId,
      loopIteration: nextLoopIteration,
      status: "active"
    };
  }

  return {
    status: finalStatus,
    error: finalError,
    transitionCount: 1,
    auditTrail: [args.audit],
    roleResults: args.storedResult ? { [args.roleId]: args.storedResult } : {},
    branchRecords: branchUpdates,
    loopIterations: loopUpdates,
    selectedEventByRoleId: args.selectedEvent ? { [args.roleId]: args.selectedEvent } : {},
    finalOutput,
    finalRoleId,
    lastExecutedRoleId: args.roleId
  };
}

export async function runSystemWithGraphRunner(args: RunnerInput): Promise<AdapterRunResult> {
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
        workdir: args.workdir
      });

      if (result.status === "failed") {
        return buildFailureUpdate({
          roleId,
          branchId: result.branchId,
          loopIteration: result.loopIteration,
          error: result.error,
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
        mode: result.status
      });
    });
  }

  graphBuilder.addConditionalEdges(START, (state: GraphState) => {
    if (state.status !== "running") {
      return END;
    }
    const activeRoles = Object.values(state.branchRecords)
      .filter((branch) => branch.status === "active")
      .map((branch) => branch.roleId);
    if (activeRoles.length === 0) {
      return END;
    }
    return Array.from(new Set(activeRoles));
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
  let finalState = args.initialState ?? createInitialState(args.plan, args.prompt);
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
  const serverMetadata = args.executor.getServerMetadata();
  await writeFile(
    resolve(args.runContext.auditDir, "summary.md"),
    [
      "# Audit Summary",
      "",
      `- runId: ${args.runContext.runId}`,
      `- status: ${finalState.status}`,
      `- finalRoleId: ${finalState.finalRoleId}`,
      `- transitionCount: ${finalState.transitionCount}`,
      `- opencodeServerUrl: ${serverMetadata.url ?? ""}`,
      `- opencodeServerPid: ${serverMetadata.pid ?? ""}`,
      `- opencodeServerStartedAt: ${serverMetadata.startedAt ?? ""}`
    ].join("\n"),
    "utf8"
  );

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
      lastOutput: finalState.finalOutput || undefined,
      error: finalState.error || undefined
    },
    stages,
    auditTrail,
    error: finalState.error || undefined
  };
}
