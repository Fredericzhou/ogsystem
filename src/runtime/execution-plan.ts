/**
 * Translates a parsed system definition into a normalized execution plan so the runtime always sees a complete
 * graph and binding snapshot.
 * Boundaries: the plan is derived purely from system metadata and does not touch runtime state.
 * Trade-off: the runtime keeps the plan in memory rather than re-parsing Mermaid on every run.
 */
import { SYSTEM_END_ROLE_ID } from "./types.js";
import type { ExecutionPlan, ExecutionPlanNode, SystemDefinition } from "./types.js";

function buildIncoming(system: SystemDefinition, roleId: string) {
  return system.flows.filter((flow) => flow.toRoleId === roleId);
}

function buildOutgoing(system: SystemDefinition, roleId: string) {
  return system.flows.filter((flow) => flow.fromRoleId === roleId);
}

function resolveBinding(system: SystemDefinition, roleId: string): ExecutionPlanNode["binding"] {
  // Bindings prefer explicit model or profile contracts; absence results in a noop binding so the runtime can still reason about flow counts.
  const modelId = system.modelBinding[roleId];
  if (modelId) {
    return {
      kind: "model",
      modelId
    };
  }

  const profileId = system.executionBinding[roleId];
  if (profileId) {
    return {
      kind: "profile",
      profileId
    };
  }

  return {
    kind: "noop"
  };
}

/**
 * Builds the runtime execution plan and captures the graph/binding metadata used for fingerprinting and resume guards.
 * Every declared role produces a node to keep the runtime from silently dropping branches; terminals are marked
 * whenever a role has no outgoing flows or only routes to the system end marker.
 */
export function createExecutionPlan(system: SystemDefinition): ExecutionPlan {
  const nodesByRoleId = new Map<string, ExecutionPlanNode>();

  for (const roleId of system.roleIds) {
    const incoming = buildIncoming(system, roleId);
    const outgoing = buildOutgoing(system, roleId);

    nodesByRoleId.set(roleId, {
      roleId,
      incoming,
      outgoing,
      routingMode: system.graph?.routingModeByRoleId[roleId],
      joinMode: system.graph?.joinModeByRoleId[roleId],
      joinSources: system.graph?.joinSourcesByRoleId[roleId] ?? [],
      joinMin: system.graph?.joinMinByRoleId[roleId],
      contextMap: system.graph?.contextMapByRoleId[roleId],
      loopMax: system.graph?.loopMaxByRoleId[roleId],
      binding: resolveBinding(system, roleId),
      isTerminal:
        outgoing.length === 0 || outgoing.every((flow) => flow.toRoleId === SYSTEM_END_ROLE_ID)
    });
  }

  return {
    systemId: system.systemId,
    systemVersion: system.systemVersion,
    lawBinding: system.lawBinding,
    entryRoleId: system.entryRoleId,
    roleIds: system.roleIds,
    flows: system.flows,
    nodesByRoleId
  };
}

/**
 * Fetches the node for a role and fails early when the plan is incomplete so downstream logic never runs against undefined nodes.
 */
export function getExecutionPlanNode(plan: ExecutionPlan, roleId: string): ExecutionPlanNode {
  const node = plan.nodesByRoleId.get(roleId);
  if (!node) {
    throw new Error(`Execution plan is missing role "${roleId}"`);
  }
  return node;
}
