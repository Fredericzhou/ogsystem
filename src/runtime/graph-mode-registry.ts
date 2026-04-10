import type {
  ExecutionPlanNode,
  GraphJoinMode,
  GraphRoutingMode,
  GraphState,
  StoredRoleResult
} from "./types.js";

type RoutingModeHandler = {
  selectTargets(args: {
    node: ExecutionPlanNode;
    selectedEvent?: string;
    mode: "ok" | "noop";
  }): string[];
};

type JoinModeHandler = {
  isReady(args: {
    node: ExecutionPlanNode;
    currentRoleId: string;
    loopIteration: number;
    state: GraphState;
    currentResult?: StoredRoleResult;
  }): boolean;
};

const routingModeHandlers = new Map<GraphRoutingMode, RoutingModeHandler>();
const joinModeHandlers = new Map<GraphJoinMode, JoinModeHandler>();

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
  currentRoleId: string;
  loopIteration: number;
  state: GraphState;
  currentResult?: StoredRoleResult;
}): boolean {
  if (!args.node.joinMode) {
    return true;
  }
  const handler = joinModeHandlers.get(args.node.joinMode);
  if (!handler) {
    throw new Error(`Join mode handler missing for "${args.node.joinMode}"`);
  }
  return handler.isReady(args);
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
  isReady(args) {
    for (const sourceRoleId of args.node.joinSources) {
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
});
