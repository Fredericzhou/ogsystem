import { getExecutionPlanNode } from "./execution-plan.js";
import type { BranchRecord, ExecutionPlan, GraphState, StoredRoleResult } from "./types.js";

export function buildBranchId(roleId: string, loopIteration: number): string {
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

export function allJoinSourcesReady(args: {
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

export function findCurrentBranch(state: GraphState, roleId: string): BranchRecord | undefined {
  const branches = Object.values(state.branchRecords).filter(
    (branch) => branch.roleId === roleId && branch.status === "active"
  );
  branches.sort((left, right) => right.loopIteration - left.loopIteration);
  return branches[0];
}

export function getActiveRoleIds(state: GraphState): string[] {
  return Array.from(
    new Set(
      Object.values(state.branchRecords)
        .filter((branch) => branch.status === "active")
        .map((branch) => branch.roleId)
    )
  );
}

export function activateBranch(args: {
  roleId: string;
  loopIteration: number;
}): BranchRecord {
  return {
    branchId: buildBranchId(args.roleId, args.loopIteration),
    roleId: args.roleId,
    loopIteration: args.loopIteration,
    status: "active"
  };
}

export function completeBranch(args: {
  branchId: string;
  roleId: string;
  loopIteration: number;
}): BranchRecord {
  return {
    branchId: args.branchId,
    roleId: args.roleId,
    loopIteration: args.loopIteration,
    status: "completed"
  };
}

export function createInitialGraphState(args: {
  plan: ExecutionPlan;
  prompt: string;
}): GraphState {
  const branchId = buildBranchId(args.plan.entryRoleId, 1);
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
        status: "active"
      }
    },
    loopIterations: {
      [args.plan.entryRoleId]: 1
    },
    selectedEventByRoleId: {},
    finalOutput: "",
    finalRoleId: "",
    lastExecutedRoleId: ""
  };
}

export function createInitialState(plan: ExecutionPlan, prompt: string): GraphState {
  return createInitialGraphState({ plan, prompt });
}

export function storeRoleResult(
  roleId: string,
  result: StoredRoleResult | undefined
): Record<string, StoredRoleResult> {
  return result ? { [roleId]: result } : {};
}
