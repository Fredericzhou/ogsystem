import { getExecutionPlanNode } from "./execution-plan.js";
import { summarizeRun } from "./run-summary.js";
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
  return getTargetLoopIteration(args) > targetNode.loopMax;
}

export function projectStateSnapshot(args: {
  state: GraphState;
  plan: ExecutionPlan;
}): Record<string, unknown> {
  const summary = summarizeRun({
    auditTrail: args.state.auditTrail,
    transitionCount: args.state.transitionCount,
    terminalStatus: args.state.status,
    terminalErrorEnvelope: args.state.errorEnvelope
  });
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
    totalTransitions: summary.totalTransitions,
    okCount: summary.okCount,
    failedCount: summary.failedCount,
    noopCount: summary.noopCount,
    failureCountsByErrorCode: summary.failureCountsByErrorCode,
    lastOutput: args.state.finalOutput || undefined,
    error: args.state.error || undefined,
    errorEnvelope: args.state.errorEnvelope || undefined,
    activeBranches,
    completedBranches,
    pendingJoinRoleIds,
    loopIterations: args.state.loopIterations,
    roleResults: args.state.roleResults,
    selectedEventByBranchId: args.state.selectedEventByBranchId,
    nextBranchSequence: args.state.nextBranchSequence,
    lastCheckpointSequence: args.state.lastCheckpointSequence,
    graphState: args.state
  };
}

export function findCurrentBranch(state: GraphState, roleId: string): BranchRecord | undefined {
  return listActiveBranches(state, roleId).at(-1);
}

export function listActiveBranches(state: GraphState, roleId: string): BranchRecord[] {
  return Object.values(state.branchRecords)
    .filter((branch) => branch.roleId === roleId && branch.status === "active")
    .sort((left, right) => left.branchSequence - right.branchSequence);
}

export function getActiveRoleIds(state: GraphState): string[] {
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

  return Array.from(firstBranchByRoleId.entries())
    .sort((left, right) => left[1] - right[1])
    .map(([roleId]) => roleId);
}

export function activateBranch(args: {
  roleId: string;
  loopIteration: number;
  branchSequence: number;
  lineageId: string;
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
    parentBranchId: args.parentBranchId,
    activatedByRoleId: args.activatedByRoleId,
    activatedByEvent: args.activatedByEvent,
    status: "completed"
  };
}

export function createInitialGraphState(args: {
  plan: ExecutionPlan;
  prompt: string;
}): GraphState {
  const branchId = buildBranchId(args.plan.entryRoleId, 1, 1);
  return {
    userPrompt: args.prompt,
    status: "running",
    error: "",
    transitionCount: 0,
    auditTrail: [],
    roleResults: {},
    branchRecords: {
      [branchId]: {
        branchId,
        roleId: args.plan.entryRoleId,
        loopIteration: 1,
        branchSequence: 1,
        lineageId: branchId,
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
}): StoredRoleResult | undefined {
  return Object.values(args.state.roleResults).find(
    (result) =>
      result.roleId === args.roleId &&
      result.lineageId === args.lineageId &&
      result.loopIteration === args.loopIteration
  );
}
