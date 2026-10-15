import type { SystemDefinition } from "../runtime/types.js";
import { SYSTEM_END_ROLE_ID } from "../runtime/types.js";
import { createEmptySystemDesign, validateSystemDesign } from "./change-set.js";
import type { DesignBinding, SystemDesignDocument } from "./types.js";

function escapeRoleId(value: string): string {
  return value.replace(/"/g, '\\"');
}

export function systemDefinitionToDesign(system: SystemDefinition): SystemDesignDocument {
  const design = createEmptySystemDesign({
    systemId: system.systemId,
    systemVersion: system.systemVersion,
    entrySeatId: system.entryRoleId,
    entryEventType: system.entryEventType ?? "START",
    lawGlobalRef: system.lawBinding.globalLawRef
  });
  const graph = system.graph;
  for (const roleId of system.roleIds) {
    const bindingRef = system.executionBinding[roleId];
    const modelRef = system.modelBinding[roleId];
    let binding: DesignBinding = { kind: "noop" };
    if (modelRef) binding = { kind: "model", modelRef };
    else if (bindingRef) binding = { kind: "exec", profileId: bindingRef };
    const role = {
      seatId: roleId,
      rolePackageRef: system.rolePackageRefByRoleId?.[roleId] ?? roleId,
      binding,
      routingMode: graph?.routingModeByRoleId[roleId],
      routeOrder: graph?.routeOrderByRoleId?.[roleId],
      join: graph?.joinModeByRoleId[roleId]
        ? { mode: graph.joinModeByRoleId[roleId], sources: graph.joinSourcesByRoleId[roleId] ?? [], min: graph.joinMinByRoleId[roleId] }
        : undefined,
      loop: graph?.loopMaxByRoleId[roleId] ? { maxRounds: graph.loopMaxByRoleId[roleId] } : undefined,
      review: graph?.reviewByRoleId?.[roleId]
        ? {
            mode: "required" as const,
            timeoutSeconds: graph.reviewByRoleId[roleId].timeoutSeconds,
            timeoutAction: graph.reviewByRoleId[roleId].timeoutAction,
            reworkTargetSeatId: graph.reviewByRoleId[roleId].reworkTargetRoleId,
            reworkMax: graph.reviewByRoleId[roleId].reworkMax,
            terminateScope: graph.reviewByRoleId[roleId].terminateScope
          }
        : undefined,
      contextMap: graph?.contextMapByRoleId[roleId]
    };
    design.seats[roleId] = role;
    design.bindings[roleId] = binding;
  }
  design.transitions = system.flows.map((flow, index) => ({
    transitionId: `${index + 1}:${flow.fromRoleId}:${flow.eventType}:${flow.toRoleId}`,
    fromSeatId: flow.fromRoleId,
    toSeatId: flow.toRoleId,
    eventType: flow.eventType
  }));
  design.system.handoffMode = graph?.handoffMode;
  design.system.handoffContracts = graph?.handoffContracts;
  return design;
}

export function exportDesignToMermaid(design: SystemDesignDocument): string {
  const diagnostics = validateSystemDesign(design);
  if (!diagnostics.ok) throw new Error(`Cannot export invalid design: ${diagnostics.diagnostics.map((item) => item.message).join("; ")}`);
  const roleIds = Object.keys(design.seats).sort((left, right) => left.localeCompare(right));
  const nodeIdBySeatId = new Map(roleIds.map((seatId, index) => [seatId, `r${index + 1}`]));
  const lines = [
    "flowchart TD",
    `%% system.id=${design.system.systemId}`,
    `%% system.version=${design.system.systemVersion}`,
    `%% law.global=${design.system.lawGlobalRef}`,
    `%% entry.role=${design.system.entrySeatId}`
  ];
  if (design.system.handoffMode) lines.push(`%% handoff.mode=${design.system.handoffMode}`);
  if (design.system.handoffContracts) lines.push(`%% handoff.contracts=${design.system.handoffContracts}`);
  for (const seatId of roleIds) {
    const seat = design.seats[seatId];
    const nodeId = nodeIdBySeatId.get(seatId) ?? seatId;
    if (seat.binding.kind === "exec" && seat.binding.profileId) {
      const profileRef = seat.binding.profileId.startsWith("profile.") ? seat.binding.profileId : `profile.${seat.binding.profileId}`;
      lines.push(`%% exec.bind.${seatId}=${profileRef}`);
    }
    if (seat.routingMode) lines.push(`%% role.mode.${seatId}=${seat.routingMode}`);
    if (seat.routeOrder?.length) lines.push(`%% route.order.${seatId}=${seat.routeOrder.join(",")}`);
    if (seat.join) {
      lines.push(`%% join.mode.${seatId}=${seat.join.mode}`);
      lines.push(`%% join.sources.${seatId}=${seat.join.sources.join(",")}`);
      if (seat.join.min !== undefined) lines.push(`%% join.min.${seatId}=${seat.join.min}`);
    }
    if (seat.loop) lines.push(`%% loop.max.${seatId}=${seat.loop.maxRounds}`);
    if (seat.review) {
      lines.push(`%% review.mode.${seatId}=required`);
      if (seat.review.timeoutSeconds !== undefined) lines.push(`%% review.timeout.${seatId}=${seat.review.timeoutSeconds}`);
      if (seat.review.timeoutAction) lines.push(`%% review.timeout.action.${seatId}=${seat.review.timeoutAction}`);
      if (seat.review.reworkTargetSeatId) lines.push(`%% review.rework.target.${seatId}=${seat.review.reworkTargetSeatId}`);
      if (seat.review.reworkMax !== undefined) lines.push(`%% review.rework.max.${seatId}=${seat.review.reworkMax}`);
      if (seat.review.terminateScope) lines.push(`%% review.terminate.scope.${seatId}=${seat.review.terminateScope}`);
    }
    for (const [field, selector] of Object.entries(seat.contextMap ?? {}).sort(([a], [b]) => a.localeCompare(b))) lines.push(`%% context.map.${seatId}.${field}=${selector}`);
    void nodeId;
  }
  const entryNode = nodeIdBySeatId.get(design.system.entrySeatId) ?? design.system.entrySeatId;
  lines.push(`input -->|${design.system.entryEventType ?? "START"}| ${entryNode}[Role:${escapeRoleId(design.system.entrySeatId)}]`);
  for (const transition of design.transitions) {
    const fromNode = nodeIdBySeatId.get(transition.fromSeatId) ?? transition.fromSeatId;
    const from = `${fromNode}[Role:${escapeRoleId(transition.fromSeatId)}]`;
    if (transition.toSeatId === SYSTEM_END_ROLE_ID) lines.push(`${from} -->|${transition.eventType}| output`);
    else {
      const toNode = nodeIdBySeatId.get(transition.toSeatId) ?? transition.toSeatId;
      lines.push(`${from} -->|${transition.eventType}| ${toNode}[Role:${escapeRoleId(transition.toSeatId)}]`);
    }
  }
  return `${lines.join("\n")}\n`;
}
