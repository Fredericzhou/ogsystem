import { SYSTEM_END_ROLE_ID } from "./types.js";
import type { ExecutionPlan, ExecutionPlanNode, SystemDefinition } from "./types.js";

function buildIncoming(system: SystemDefinition, roleId: string) {
  return system.flows.filter((flow) => flow.toRoleId === roleId);
}

function buildOutgoing(system: SystemDefinition, roleId: string) {
  return system.flows.filter((flow) => flow.fromRoleId === roleId);
}

function resolveBinding(system: SystemDefinition, roleId: string): ExecutionPlanNode["binding"] {
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

export function getExecutionPlanNode(plan: ExecutionPlan, roleId: string): ExecutionPlanNode {
  const node = plan.nodesByRoleId.get(roleId);
  if (!node) {
    throw new Error(`Execution plan is missing role "${roleId}"`);
  }
  return node;
}
