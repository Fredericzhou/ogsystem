import type {
  BranchRecord,
  ExecutionPlanNode,
  GraphJoinMode,
  GraphRoutingMode,
  GraphState,
  StoredRoleResult
} from "./types.js";
import { findRoleResult } from "./graph-runtime-state.js";

export type JoinReadiness = {
  ready: boolean;
  completedSourceRoleIds: string[];
  missingSourceRoleIds: string[];
  requiredSourceCount: number;
};

type RoutingModeHandler = {
  selectTargets(args: {
    node: ExecutionPlanNode;
    selectedEvent?: string;
    mode: "ok" | "noop";
  }): string[];
};

type JoinModeHandler = {
  evaluate(args: {
    node: ExecutionPlanNode;
    currentBranch: BranchRecord;
    state: GraphState;
    currentResult?: StoredRoleResult;
  }): JoinReadiness;
};

const routingModeHandlers = new Map<GraphRoutingMode, RoutingModeHandler>();
const joinModeHandlers = new Map<GraphJoinMode, JoinModeHandler>();
// The registry is the single extension seam for graph semantics. Parser validation and runtime
// dispatch consult the same registry so a new mode fails closed until both phases support it.

export function registerRoutingModeHandler(
  mode: GraphRoutingMode,
  handler: RoutingModeHandler
): void {
  routingModeHandlers.set(mode, handler);
}

export function registerJoinModeHandler(mode: GraphJoinMode, handler: JoinModeHandler): void {
  joinModeHandlers.set(mode, handler);
}

export function hasRoutingModeHandler(value: string): value is GraphRoutingMode {
  return routingModeHandlers.has(value as GraphRoutingMode);
}

export function hasJoinModeHandler(value: string): value is GraphJoinMode {
  return joinModeHandlers.has(value as GraphJoinMode);
}

export function selectRoutingTargets(args: {
  node: ExecutionPlanNode;
  selectedEvent?: string;
  mode: "ok" | "noop";
}): string[] {
  if (args.mode === "noop") {
    return args.node.outgoing.map((flow) => flow.toRoleId).slice(0, 1);
  }

  if (args.node.routingMode) {
    const handler = routingModeHandlers.get(args.node.routingMode);
    if (!handler) {
      throw new Error(`Routing mode handler missing for "${args.node.routingMode}"`);
    }
    return handler.selectTargets(args);
  }

  return args.node.outgoing
    .filter((flow) => flow.eventType === args.selectedEvent)
    .map((flow) => flow.toRoleId);
}

export function isJoinNodeReady(args: {
  node: ExecutionPlanNode;
  currentBranch: BranchRecord;
  state: GraphState;
  currentResult?: StoredRoleResult;
}): boolean {
  return evaluateJoinNodeReadiness(args).ready;
}

export function evaluateJoinNodeReadiness(args: {
  node: ExecutionPlanNode;
  currentBranch: BranchRecord;
  state: GraphState;
  currentResult?: StoredRoleResult;
}): JoinReadiness {
  if (!args.node.joinMode) {
    return {
      ready: true,
      completedSourceRoleIds: [],
      missingSourceRoleIds: [],
      requiredSourceCount: 0
    };
  }
  const handler = joinModeHandlers.get(args.node.joinMode);
  if (!handler) {
    throw new Error(`Join mode handler missing for "${args.node.joinMode}"`);
  }
  return handler.evaluate(args);
}

export function listSupportedRoutingModes(): GraphRoutingMode[] {
  return Array.from(routingModeHandlers.keys());
}

export function listSupportedJoinModes(): GraphJoinMode[] {
  return Array.from(joinModeHandlers.keys());
}

registerRoutingModeHandler("parallel_split", {
  selectTargets(args) {
    return args.node.outgoing.map((flow) => flow.toRoleId);
  }
});

registerJoinModeHandler("all_of", {
  evaluate(args) {
    const declaredSources = Array.from(new Set(args.node.joinSources));
    const completedSourceRoleIds = declaredSources.filter((sourceRoleId) => {
      if (sourceRoleId === args.currentBranch.roleId) {
        return Boolean(args.currentResult);
      }
      return Boolean(
        findRoleResult({
          state: args.state,
          roleId: sourceRoleId,
          lineageId: args.currentBranch.lineageId,
          loopIteration: args.currentBranch.loopIteration
        })
      );
    });
    const requiredSourceCount = declaredSources.length;
    const missingSourceRoleIds = declaredSources.filter(
      (sourceRoleId) => !completedSourceRoleIds.includes(sourceRoleId)
    );
    return {
      ready: completedSourceRoleIds.length >= requiredSourceCount,
      completedSourceRoleIds,
      missingSourceRoleIds,
      requiredSourceCount
    };
  }
});

registerJoinModeHandler("quorum_of", {
  evaluate(args) {
    const declaredSources = Array.from(new Set(args.node.joinSources));
    const completedSourceRoleIds = declaredSources.filter((sourceRoleId) => {
      if (sourceRoleId === args.currentBranch.roleId) {
        return Boolean(args.currentResult);
      }
      return Boolean(
        findRoleResult({
          state: args.state,
          roleId: sourceRoleId,
          lineageId: args.currentBranch.lineageId,
          loopIteration: args.currentBranch.loopIteration
        })
      );
    });
    const requiredSourceCount = args.node.joinMin ?? declaredSources.length;
    const missingSourceRoleIds = declaredSources.filter(
      (sourceRoleId) => !completedSourceRoleIds.includes(sourceRoleId)
    );
    return {
      ready: completedSourceRoleIds.length >= requiredSourceCount,
      completedSourceRoleIds,
      missingSourceRoleIds,
      requiredSourceCount
    };
  }
});
