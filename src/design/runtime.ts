import type { SystemDefinition, HumanReviewSpec, GraphMetadata } from "../runtime/types.js";
import type { SystemDesignDocument } from "./types.js";

/** Compile the canonical design document into the small graph contract consumed by the runtime. */
export function designToSystemDefinition(design: SystemDesignDocument): SystemDefinition {
  const executionBinding: Record<string, string> = {};
  const modelBinding: Record<string, string> = {};
  const rolePackageRefByRoleId: Record<string, string> = {};
  const routingModeByRoleId: GraphMetadata["routingModeByRoleId"] = {};
  const routeOrderByRoleId: Record<string, string[]> = {};
  const joinModeByRoleId: GraphMetadata["joinModeByRoleId"] = {};
  const joinSourcesByRoleId: GraphMetadata["joinSourcesByRoleId"] = {};
  const joinMinByRoleId: GraphMetadata["joinMinByRoleId"] = {};
  const contextMapByRoleId: GraphMetadata["contextMapByRoleId"] = {};
  const loopMaxByRoleId: GraphMetadata["loopMaxByRoleId"] = {};
  const reviewByRoleId: NonNullable<GraphMetadata["reviewByRoleId"]> = {};

  for (const [seatId, seat] of Object.entries(design.seats)) {
    rolePackageRefByRoleId[seatId] = seat.rolePackageRef;
    if (seat.binding.kind === "exec" && seat.binding.profileId) {
      executionBinding[seatId] = seat.binding.profileId;
    } else if (seat.binding.kind === "model" && seat.binding.modelRef) {
      modelBinding[seatId] = seat.binding.modelRef;
    }
    if (seat.routingMode) routingModeByRoleId[seatId] = seat.routingMode;
    if (seat.routeOrder?.length) routeOrderByRoleId[seatId] = [...seat.routeOrder];
    if (seat.join) {
      joinModeByRoleId[seatId] = seat.join.mode;
      joinSourcesByRoleId[seatId] = [...seat.join.sources];
      if (seat.join.min !== undefined) joinMinByRoleId[seatId] = seat.join.min;
    }
    if (seat.contextMap) contextMapByRoleId[seatId] = { ...seat.contextMap };
    if (seat.loop) loopMaxByRoleId[seatId] = seat.loop.maxRounds;
    if (seat.review) {
      const review: HumanReviewSpec = {
        mode: "required",
        timeoutSeconds: seat.review.timeoutSeconds,
        timeoutAction: seat.review.timeoutAction ?? "pause",
        reworkTargetRoleId: seat.review.reworkTargetSeatId ?? seatId,
        reworkMax: seat.review.reworkMax,
        terminateScope: seat.review.terminateScope ?? "branch"
      };
      reviewByRoleId[seatId] = review;
    }
  }

  const graph: GraphMetadata = {
    handoffMode: design.system.handoffMode,
    handoffContracts: design.system.handoffContracts,
    routeOrderByRoleId,
    routingModeByRoleId,
    joinModeByRoleId,
    joinSourcesByRoleId,
    joinMinByRoleId,
    contextMapByRoleId,
    loopMaxByRoleId,
    reviewByRoleId
  };

  return {
    systemId: design.system.systemId,
    systemVersion: design.system.systemVersion,
    entryRoleId: design.system.entrySeatId,
    entryEventType: design.system.entryEventType ?? "START",
    roleIds: Object.keys(design.seats),
    flows: design.transitions.map((transition) => ({
      fromRoleId: transition.fromSeatId,
      toRoleId: transition.toSeatId,
      eventType: transition.eventType
    })),
    lawBinding: { globalLawRef: design.system.lawGlobalRef },
    executionBinding,
    modelBinding,
    rolePackageRefByRoleId,
    graph
  };
}
