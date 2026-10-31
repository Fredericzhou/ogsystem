import { SYSTEM_END_ROLE_ID, SYSTEM_START_ROLE_ID } from "../runtime/types.js";
import type {
  StudioAuthoringDocument,
  StudioAuthoringRole,
  StudioGraphSnapshot
} from "./studio-contracts.js";
import { STUDIO_SYSTEM_END_ROLE_ID, STUDIO_SYSTEM_START_ROLE_ID, studioFlowKey } from "./studio-contracts.js";

export type StudioBridgeRole = StudioAuthoringRole & {
  incomingFlowCount: number;
  outgoingFlowCount: number;
  allowedEvents: string[];
  badges: string[];
};

export type StudioBridgeFlow = StudioAuthoringDocument["flows"][string] & {
  flowKey: string;
  participatesInJoin: boolean;
};

function sortStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

export function fallbackGridColumnCount(nodeCount: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(1, nodeCount))));
}

export function buildBridgeRoles(authoring: StudioAuthoringDocument): StudioBridgeRole[] {
  const flows = Object.values(authoring.flows);
  return Object.values(authoring.roles)
    .sort((left, right) => left.roleId.localeCompare(right.roleId))
    .map((role) => {
      const incoming = flows.filter((flow) => flow.toRoleId === role.roleId);
      const outgoing = flows.filter((flow) => flow.fromRoleId === role.roleId);
      const badges = [
        flows.some((flow) => flow.fromRoleId === STUDIO_SYSTEM_START_ROLE_ID && flow.toRoleId === role.roleId) ? "entry" : "",
        role.bindingKind === "model" ? "M" : "",
        role.bindingKind === "exec" ? "E" : "",
        role.routingMode === "parallel_split" ? "P" : "",
        role.joinMode ? "J" : "",
        role.loopMax ? "L" : "",
        role.review ? "R" : ""
      ].filter(Boolean);
      return {
        ...role,
        incomingFlowCount: incoming.length,
        outgoingFlowCount: outgoing.length,
        allowedEvents: Array.from(new Set(outgoing.map((flow) => flow.eventType))).sort(sortStrings),
        badges
      };
    });
}

export function buildBridgeFlows(authoring: StudioAuthoringDocument): StudioBridgeFlow[] {
  const joinSourcesByTarget = new Map<string, Set<string>>();
  for (const role of Object.values(authoring.roles)) {
    if (role.joinSources?.length) {
      joinSourcesByTarget.set(role.roleId, new Set(role.joinSources));
    }
  }
  return Object.values(authoring.flows)
    .sort((left, right) => left.flowId.localeCompare(right.flowId))
    .map((flow) => ({
      ...flow,
      flowKey: studioFlowKey({
        fromRoleId: flow.fromRoleId === SYSTEM_START_ROLE_ID ? STUDIO_SYSTEM_START_ROLE_ID : flow.fromRoleId,
        eventType: flow.eventType,
        toRoleId: flow.toRoleId === SYSTEM_END_ROLE_ID ? STUDIO_SYSTEM_END_ROLE_ID : flow.toRoleId,
        outputPort: flow.outputPort,
        inputPort: flow.inputPort
      }),
      participatesInJoin: Object.hasOwn(flow, "participatesInJoin")
        ? Boolean(flow.participatesInJoin)
        : Boolean(joinSourcesByTarget.get(flow.toRoleId)?.has(flow.fromRoleId))
    }));
}

export function authoringToGraphSnapshot(authoring: StudioAuthoringDocument): StudioGraphSnapshot {
  const bridgeRoles = buildBridgeRoles(authoring);
  const bridgeFlows = buildBridgeFlows(authoring);
  const columns = fallbackGridColumnCount(bridgeRoles.length);
  return {
    version: 1,
    nodes: [
      {
        id: STUDIO_SYSTEM_START_ROLE_ID,
        roleId: STUDIO_SYSTEM_START_ROLE_ID,
        x: authoring.layout.nodes[STUDIO_SYSTEM_START_ROLE_ID]?.x ?? 32,
        y: authoring.layout.nodes[STUDIO_SYSTEM_START_ROLE_ID]?.y ?? 120,
        width: authoring.layout.nodes[STUDIO_SYSTEM_START_ROLE_ID]?.width ?? 112,
        height: authoring.layout.nodes[STUDIO_SYSTEM_START_ROLE_ID]?.height ?? 68,
        label: "开始",
        badges: [],
        bindingKind: "boundary" as const
      },
      ...bridgeRoles.map((role, index) => {
      const layout = authoring.layout.nodes[role.roleId] ?? {
        x: 120 + (index % columns) * 260,
        y: 120 + Math.floor(index / columns) * 160
      };
      return {
        id: role.roleId,
        roleId: role.roleId,
        x: layout.x,
        y: layout.y,
        width: layout.width ?? 180,
        height: layout.height ?? 84,
        label: role.title ?? role.roleId,
        badges: role.badges,
        bindingKind: role.bindingKind
      };
      }),
      {
        id: STUDIO_SYSTEM_END_ROLE_ID,
        roleId: STUDIO_SYSTEM_END_ROLE_ID,
        x: authoring.layout.nodes[STUDIO_SYSTEM_END_ROLE_ID]?.x ?? 640,
        y: authoring.layout.nodes[STUDIO_SYSTEM_END_ROLE_ID]?.y ?? 120,
        width: authoring.layout.nodes[STUDIO_SYSTEM_END_ROLE_ID]?.width ?? 112,
        height: authoring.layout.nodes[STUDIO_SYSTEM_END_ROLE_ID]?.height ?? 68,
        label: "结束",
        badges: [],
        bindingKind: "boundary" as const
      }
    ],
    edges: bridgeFlows.map((flow) => ({
      id: flow.flowId,
      source: flow.fromRoleId,
      target: flow.toRoleId,
      label: flow.label ?? flow.eventType,
      eventType: flow.eventType,
      ...(flow.outputPort ? { outputPort: flow.outputPort } : {}),
      ...(flow.inputPort ? { inputPort: flow.inputPort } : {}),
      runtimeOnlyErrorFlow: Boolean(flow.runtimeOnlyErrorFlow),
      participatesInJoin: flow.participatesInJoin,
      condition: flow.condition,
      priority: flow.priority
    })),
    viewport: authoring.layout.viewport
  };
}

/** Compatibility adapter for the existing bridge response and persisted client payloads. */
export const authoringToCanvasDocument = authoringToGraphSnapshot;
