/**
 * Extension registry for routing/join semantics. Responsibilities: keep a single lookup
 * surface that both parser validation and runtime execution can consult so closed-world
 * modes behave predictably. Boundaries: the registry does not resolve flows itself;
 * handlers assume context from the runtime state and must enforce their own invariants.
 * Trade-off: new handlers add more complexity, so defaults cover the common split/join modes.
 */
import type {
  BranchRecord,
  ExecutionPlanNode,
  GraphJoinMode,
  GraphRoutingMode,
  GraphState,
  StoredRoleResult
} from "./types.js";
import { findRoleResult } from "./graph-runtime-state.js";
import type { RuntimeIndexes } from "./runtime-indexes.js";
import { isRuntimeOnlyErrorEvent } from "./error-flow-utils.js";

/**
 * Outcome returned by join-mode handlers so execution can decide if downstream roles may fire.
 * Invariant: `ready` must only become true once `completedSourceRoleIds` satisfies the required
 * count, otherwise the runtime must keep waiting.
 */
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
    indexes?: RuntimeIndexes;
  }): JoinReadiness;
};

const routingModeHandlers = new Map<GraphRoutingMode, RoutingModeHandler>();
const joinModeHandlers = new Map<GraphJoinMode, JoinModeHandler>();
// The registry is the single extension seam for graph semantics. Parser validation and runtime
// dispatch consult the same registry so a new mode fails closed until both phases support it.

/**
 * Registers a handler for the given routing mode.
 * Invariant: once registered, both parser and runtime will expect the handler to exist.
 */
export function registerRoutingModeHandler(
  mode: GraphRoutingMode,
  handler: RoutingModeHandler
): void {
  routingModeHandlers.set(mode, handler);
}

/**
 * Registers a handler for the given join mode.
 * Trade-off: custom handlers must be robust because missing registrations throw at runtime.
 */
export function registerJoinModeHandler(mode: GraphJoinMode, handler: JoinModeHandler): void {
  joinModeHandlers.set(mode, handler);
}

/**
 * Guards whether a routing mode has been registered so parsers can fail fast during validation.
 */
export function hasRoutingModeHandler(value: string): value is GraphRoutingMode {
  return routingModeHandlers.has(value as GraphRoutingMode);
}

/**
 * Guards whether a join mode has been registered before runtime execution consults it.
 */
export function hasJoinModeHandler(value: string): value is GraphJoinMode {
  return joinModeHandlers.has(value as GraphJoinMode);
}

/**
 * Selects the routing targets for the current node, honoring the registered mode or the default
 * event dispatch semantics.
 * Trade-off: when a handler throws because it is missing, it surfaces immediately so we keep the
 * runtime fail-closed.
 */
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

  // Invariant: when no handler is registered we only consider flows that match the selected event.
  return args.node.outgoing
    .filter((flow) => flow.eventType === args.selectedEvent)
    .map((flow) => flow.toRoleId);
}

/**
 * Convenience wrapper that only exposes the readiness flag, deferring to the full evaluator.
 */
export function isJoinNodeReady(args: {
  node: ExecutionPlanNode;
  currentBranch: BranchRecord;
  state: GraphState;
  currentResult?: StoredRoleResult;
  indexes?: RuntimeIndexes;
}): boolean {
  return evaluateJoinNodeReadiness(args).ready;
}

/**
 * Queries the registered join-mode handler to decide whether the branch can progress.
 * Trade-off: missing handlers abort early so we do not implicitly assume semantics we never enforced.
 */
export function evaluateJoinNodeReadiness(args: {
  node: ExecutionPlanNode;
  currentBranch: BranchRecord;
  state: GraphState;
  currentResult?: StoredRoleResult;
  indexes?: RuntimeIndexes;
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
    // Fail closed so missing join semantics cannot silently be bypassed.
    throw new Error(`Join mode handler missing for "${args.node.joinMode}"`);
  }
  return handler.evaluate(args);
}

/**
 * Enumerates routing modes so CLI tools can report available extensions.
 */
export function listSupportedRoutingModes(): GraphRoutingMode[] {
  return Array.from(routingModeHandlers.keys());
}

/**
 * Enumerates join modes so CLI tools can report available extensions.
 */
export function listSupportedJoinModes(): GraphJoinMode[] {
  return Array.from(joinModeHandlers.keys());
}

registerRoutingModeHandler("parallel_split", {
  selectTargets(args) {
    const targets = args.node.outgoing
      .filter((flow) => !isRuntimeOnlyErrorEvent(flow.eventType))
      .map((flow) => flow.toRoleId);
    return Array.from(new Set(targets));
  }
});

// `all_of` enforces that every declared source has a recorded result before readiness.
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
          loopIteration: args.currentBranch.loopIteration,
          indexes: args.indexes
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

// `quorum_of` tolerates missing sources as long as the minimum threshold is met.
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
          loopIteration: args.currentBranch.loopIteration,
          indexes: args.indexes
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
