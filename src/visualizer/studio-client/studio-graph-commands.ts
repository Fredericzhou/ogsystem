import {
  STUDIO_SYSTEM_END_ROLE_ID,
  normalizeStudioGraphStoredRoleId,
  type StudioAuthoringDocument,
  type StudioAuthoringFlow,
  type StudioAuthoringRole,
  type StudioCanvasDocument
} from "../studio-contracts.js";

export type StudioAuthoringCommand =
  | {
      type: "add-role";
      sourceRoleId?: string;
      roleId?: string;
      title?: string;
      bindingKind?: StudioAuthoringRole["bindingKind"];
      modelRef?: string;
      profileId?: string;
      x?: number;
      y?: number;
    }
  | { type: "duplicate-role"; roleId: string; x?: number; y?: number }
  | {
      type: "update-role";
      originalRoleId: string;
      roleId?: string;
      title?: string;
      bindingKind?: StudioAuthoringRole["bindingKind"];
      modelRef?: string;
      profileId?: string;
    }
  | { type: "delete-role"; roleId: string }
  | {
      type: "add-edge";
      sourceRoleId: string;
      targetRoleId: string;
      eventType?: string;
      runtimeOnlyErrorFlow?: boolean;
      participatesInJoin?: boolean;
    }
  | {
      type: "update-edge";
      flowId?: string;
      originalSourceRoleId: string;
      originalTargetRoleId: string;
      originalEventType: string;
      sourceRoleId: string;
      targetRoleId: string;
      eventType?: string;
      runtimeOnlyErrorFlow?: boolean;
      participatesInJoin?: boolean;
    }
  | { type: "delete-edge"; flowId?: string; sourceRoleId: string; targetRoleId: string; eventType: string };

export type StudioAuthoringCommandResult = {
  authoring: StudioAuthoringDocument;
  canvas: StudioCanvasDocument;
  selectedRoleId?: string;
  selectedFlowKey?: string;
  blockedCode?:
    | "entry-role-delete"
    | "missing-role-id"
    | "invalid-role-id"
    | "duplicate-role-id"
    | "invalid-edge-endpoints"
    | "duplicate-edge"
    | "invalid-event-type";
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function nextRoleId(authoring: StudioAuthoringDocument, base = "new-role"): string {
  let index = 1;
  let roleId = base;
  while (authoring.roles[roleId]) {
    index += 1;
    roleId = `${base}-${index}`;
  }
  return roleId;
}

const RESERVED_ROLE_IDS = new Set(["input", "output", STUDIO_SYSTEM_END_ROLE_ID]);
const ROLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const EVENT_TYPE_PATTERN = /^[A-Z][A-Z0-9_:-]*$/;

function normalizeRoleId(value: unknown): string {
  return String(value ?? "").trim();
}

function isValidRoleId(value: string): boolean {
  return ROLE_ID_PATTERN.test(value) && !RESERVED_ROLE_IDS.has(value);
}

function normalizeTitle(value: unknown, fallback: string): string {
  const title = String(value ?? "").trim();
  return title ? title.slice(0, 80) : fallback;
}

function normalizeEventType(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function nextFlowId(authoring: StudioAuthoringDocument, flow: Omit<StudioAuthoringFlow, "flowId">): string {
  const target = flow.toRoleId === STUDIO_SYSTEM_END_ROLE_ID ? "output" : flow.toRoleId;
  let base = `${Object.keys(authoring.flows).length + 1}:${flow.fromRoleId}:${flow.eventType}:${target}`;
  let candidate = base;
  let suffix = 2;
  while (authoring.flows[candidate]) {
    base = `${flow.fromRoleId}:${flow.eventType}:${target}`;
    candidate = `${base}#${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function canvasFlowKey(flow: Pick<StudioAuthoringFlow, "fromRoleId" | "toRoleId" | "eventType">): string {
  return `${flow.fromRoleId}:${flow.eventType}:${flow.toRoleId === STUDIO_SYSTEM_END_ROLE_ID ? "output" : flow.toRoleId}`;
}

function roleCanvasNode(role: StudioAuthoringRole, x: number, y: number): StudioCanvasDocument["nodes"][number] {
  return {
    id: role.roleId,
    roleId: role.roleId,
    x,
    y,
    width: 180,
    height: 84,
    label: role.title || role.roleId,
    badges: [],
    bindingKind: role.bindingKind
  };
}

function normalizeBindingKind(value: unknown): StudioAuthoringRole["bindingKind"] {
  return value === "model" || value === "exec" ? value : "noop";
}

function applyRoleBinding(
  role: StudioAuthoringRole,
  args: {
    title?: string;
    bindingKind?: StudioAuthoringRole["bindingKind"];
    modelRef?: string;
    profileId?: string;
  }
): StudioAuthoringRole {
  const bindingKind = normalizeBindingKind(args.bindingKind);
  const next: StudioAuthoringRole = {
    ...role,
    title: normalizeTitle(args.title, role.roleId),
    bindingKind
  };
  delete next.modelRef;
  delete next.profileId;
  if (bindingKind === "model") {
    const modelRef = String(args.modelRef ?? "").trim();
    if (modelRef) next.modelRef = modelRef;
  }
  if (bindingKind === "exec") {
    const profileId = String(args.profileId ?? "").trim();
    if (profileId) next.profileId = profileId;
  }
  return next;
}

function matchesFlow(
  flow: StudioAuthoringFlow,
  args: { flowId?: string; sourceRoleId: string; targetRoleId: string; eventType: string },
  flowId: string
): boolean {
  if (args.flowId && args.flowId === flowId) {
    return true;
  }
  return flow.fromRoleId === args.sourceRoleId &&
    flow.toRoleId === args.targetRoleId &&
    flow.eventType === args.eventType;
}

function syncJoinSource(
  authoring: StudioAuthoringDocument,
  targetRoleId: string,
  sourceRoleId: string,
  participates: boolean
): void {
  const role = authoring.roles[targetRoleId];
  if (!role) return;
  const current = new Set(role.joinSources ?? []);
  if (participates) {
    current.add(sourceRoleId);
  } else {
    current.delete(sourceRoleId);
  }
  role.joinSources = Array.from(current);
  if (role.joinSources.length === 0) {
    delete role.joinSources;
  }
}

export function applyStudioAuthoringCommand(args: {
  authoring: StudioAuthoringDocument;
  canvas: StudioCanvasDocument;
  command: StudioAuthoringCommand;
}): StudioAuthoringCommandResult {
  const authoring = cloneJson(args.authoring);
  const canvas = cloneJson(args.canvas);
  authoring.roles ||= {};
  authoring.flows ||= {};
  authoring.layout ||= { nodes: {} };
  authoring.layout.nodes ||= {};
  canvas.nodes ||= [];
  canvas.edges ||= [];

  const command = args.command;

  if (command.type === "add-role" || command.type === "duplicate-role") {
    if (command.type === "add-role") {
      const explicitRoleId = normalizeRoleId(command.roleId);
      if (explicitRoleId) {
        if (!isValidRoleId(explicitRoleId)) {
          return { authoring, canvas, blockedCode: "invalid-role-id" };
        }
        if (authoring.roles[explicitRoleId]) {
          return { authoring, canvas, blockedCode: "duplicate-role-id" };
        }
      }
      const roleId = explicitRoleId || nextRoleId(authoring);
      const bindingKind = command.bindingKind === "model" || command.bindingKind === "exec"
        ? command.bindingKind
        : "noop";
      const role: StudioAuthoringRole = {
        roleId,
        title: normalizeTitle(command.title, roleId),
        bindingKind
      };
      if (role.bindingKind === "model") {
        const modelRef = String(command.modelRef ?? "").trim();
        if (modelRef) role.modelRef = modelRef;
      }
      if (role.bindingKind === "exec") {
        const profileId = String(command.profileId ?? "").trim();
        if (profileId) role.profileId = profileId;
      }
      const x = Number.isFinite(command.x) ? Number(command.x) : 120 + canvas.nodes.length * 260;
      const y = Number.isFinite(command.y) ? Number(command.y) : 120;
      authoring.roles[roleId] = role;
      authoring.layout.nodes[roleId] = { x, y, width: 180, height: 84 };
      canvas.nodes.push(roleCanvasNode(role, x, y));
      return { authoring, canvas, selectedRoleId: roleId };
    }

    const source = authoring.roles[command.roleId];
    const roleId = nextRoleId(authoring, `${command.roleId}-copy`);
    const role: StudioAuthoringRole = source
      ? { ...source, roleId, title: source.title ? `${source.title} copy` : undefined }
      : { roleId, title: roleId, bindingKind: "noop" };
    const x = Number.isFinite(command.x) ? Number(command.x) : 120 + canvas.nodes.length * 260;
    const y = Number.isFinite(command.y) ? Number(command.y) : 120;
    authoring.roles[roleId] = role;
    authoring.layout.nodes[roleId] = { x, y, width: 180, height: 84 };
    canvas.nodes.push(roleCanvasNode(role, x, y));
    return { authoring, canvas, selectedRoleId: roleId };
  }

  if (command.type === "delete-role") {
    const roleId = command.roleId;
    if (!roleId || roleId === authoring.system.entryRoleId) {
      return { authoring, canvas, blockedCode: "entry-role-delete" };
    }
    delete authoring.roles[roleId];
    delete authoring.layout.nodes[roleId];
    authoring.flows = Object.fromEntries(
      Object.entries(authoring.flows).filter(([, flow]) =>
        flow.fromRoleId !== roleId && flow.toRoleId !== roleId
      )
    );
    canvas.nodes = canvas.nodes.filter((node) => node.roleId !== roleId);
    canvas.edges = canvas.edges.filter((edge) => edge.source !== roleId && edge.target !== roleId);
    return { authoring, canvas, selectedRoleId: canvas.nodes[0]?.roleId || "" };
  }

  if (command.type === "update-role") {
    const originalRoleId = normalizeRoleId(command.originalRoleId);
    const role = authoring.roles[originalRoleId];
    if (!originalRoleId || !role) {
      return { authoring, canvas, blockedCode: "missing-role-id" };
    }
    const nextRoleId = normalizeRoleId(command.roleId || originalRoleId);
    if (!isValidRoleId(nextRoleId)) {
      return { authoring, canvas, blockedCode: "invalid-role-id" };
    }
    if (nextRoleId !== originalRoleId && authoring.roles[nextRoleId]) {
      return { authoring, canvas, blockedCode: "duplicate-role-id" };
    }
    const updatedRole = applyRoleBinding({ ...role, roleId: nextRoleId }, command);
    if (nextRoleId !== originalRoleId) {
      delete authoring.roles[originalRoleId];
      authoring.roles[nextRoleId] = updatedRole;
      if (authoring.system.entryRoleId === originalRoleId) {
        authoring.system.entryRoleId = nextRoleId;
      }
      if (authoring.layout.nodes[originalRoleId]) {
        authoring.layout.nodes[nextRoleId] = authoring.layout.nodes[originalRoleId];
        delete authoring.layout.nodes[originalRoleId];
      }
      for (const flow of Object.values(authoring.flows)) {
        if (flow.fromRoleId === originalRoleId) flow.fromRoleId = nextRoleId;
        if (flow.toRoleId === originalRoleId) flow.toRoleId = nextRoleId;
      }
      for (const candidate of Object.values(authoring.roles)) {
        if (Array.isArray(candidate.joinSources)) {
          candidate.joinSources = candidate.joinSources.map((source) => source === originalRoleId ? nextRoleId : source);
        }
        if (Array.isArray(candidate.routeOrder)) {
          candidate.routeOrder = candidate.routeOrder.map((target) => target === originalRoleId ? nextRoleId : target);
        }
      }
      canvas.nodes = canvas.nodes.map((node) => node.roleId === originalRoleId
        ? { ...node, id: nextRoleId, roleId: nextRoleId, label: updatedRole.title || nextRoleId, bindingKind: updatedRole.bindingKind }
        : node
      );
      canvas.edges = canvas.edges.map((edge) => ({
        ...edge,
        source: edge.source === originalRoleId ? nextRoleId : edge.source,
        target: edge.target === originalRoleId ? nextRoleId : edge.target
      }));
    } else {
      authoring.roles[originalRoleId] = updatedRole;
      canvas.nodes = canvas.nodes.map((node) => node.roleId === originalRoleId
        ? { ...node, label: updatedRole.title || originalRoleId, bindingKind: updatedRole.bindingKind }
        : node
      );
    }
    return { authoring, canvas, selectedRoleId: nextRoleId };
  }

  if (command.type === "add-edge") {
    const sourceRoleId = normalizeRoleId(command.sourceRoleId);
    const targetRoleId = normalizeStudioGraphStoredRoleId(normalizeRoleId(command.targetRoleId));
    if (
      !sourceRoleId ||
      sourceRoleId === targetRoleId ||
      !authoring.roles[sourceRoleId] ||
      (targetRoleId !== STUDIO_SYSTEM_END_ROLE_ID && !authoring.roles[targetRoleId])
    ) {
      return { authoring, canvas, blockedCode: "invalid-edge-endpoints" };
    }
    let eventType = normalizeEventType(command.eventType) || "DONE";
    if (!EVENT_TYPE_PATTERN.test(eventType)) {
      return { authoring, canvas, blockedCode: "invalid-event-type" };
    }
    if (!normalizeEventType(command.eventType)) {
      let suffix = 2;
      while (Object.values(authoring.flows).some((flow) =>
        flow.fromRoleId === sourceRoleId &&
        flow.toRoleId === targetRoleId &&
        flow.eventType === eventType
      )) {
        eventType = `DONE_${suffix}`;
        suffix += 1;
      }
    } else if (Object.values(authoring.flows).some((flow) =>
      flow.fromRoleId === sourceRoleId &&
      flow.toRoleId === targetRoleId &&
      flow.eventType === eventType
    )) {
      return { authoring, canvas, blockedCode: "duplicate-edge" };
    }
    const flowBody = {
      fromRoleId: sourceRoleId,
      toRoleId: targetRoleId,
      eventType,
      runtimeOnlyErrorFlow: command.runtimeOnlyErrorFlow ?? eventType.startsWith("ERROR")
    };
    const flowId = nextFlowId(authoring, flowBody);
    const flow = { flowId, ...flowBody };
    authoring.flows[flowId] = flow;
    canvas.edges.push({
      id: flowId,
      source: sourceRoleId,
      target: targetRoleId,
      label: eventType,
      eventType,
      runtimeOnlyErrorFlow: Boolean(flow.runtimeOnlyErrorFlow),
      participatesInJoin: Boolean(command.participatesInJoin)
    });
    if (command.participatesInJoin && targetRoleId !== STUDIO_SYSTEM_END_ROLE_ID) {
      syncJoinSource(authoring, targetRoleId, sourceRoleId, true);
    }
    return { authoring, canvas, selectedFlowKey: canvasFlowKey(flow) };
  }

  if (command.type === "update-edge") {
    const originalTargetRoleId = normalizeStudioGraphStoredRoleId(normalizeRoleId(command.originalTargetRoleId));
    const originalEventType = normalizeEventType(command.originalEventType);
    const sourceRoleId = normalizeRoleId(command.sourceRoleId);
    const targetRoleId = normalizeStudioGraphStoredRoleId(normalizeRoleId(command.targetRoleId));
    if (
      !sourceRoleId ||
      sourceRoleId === targetRoleId ||
      !authoring.roles[sourceRoleId] ||
      (targetRoleId !== STUDIO_SYSTEM_END_ROLE_ID && !authoring.roles[targetRoleId])
    ) {
      return { authoring, canvas, blockedCode: "invalid-edge-endpoints" };
    }
    const eventType = normalizeEventType(command.eventType || "DONE");
    if (!EVENT_TYPE_PATTERN.test(eventType)) {
      return { authoring, canvas, blockedCode: "invalid-event-type" };
    }
    const original = Object.entries(authoring.flows).find(([flowId, flow]) =>
      matchesFlow(flow, {
        flowId: command.flowId,
        sourceRoleId: command.originalSourceRoleId,
        targetRoleId: originalTargetRoleId,
        eventType: originalEventType
      }, flowId)
    );
    if (!original) {
      return { authoring, canvas, blockedCode: "invalid-edge-endpoints" };
    }
    const [originalFlowId, originalFlow] = original;
    const duplicate = Object.entries(authoring.flows).some(([flowId, flow]) =>
      flowId !== originalFlowId &&
      flow.fromRoleId === sourceRoleId &&
      flow.toRoleId === targetRoleId &&
      flow.eventType === eventType
    );
    if (duplicate) {
      return { authoring, canvas, blockedCode: "duplicate-edge" };
    }
    const flow: StudioAuthoringFlow = {
      ...originalFlow,
      flowId: originalFlow.flowId || originalFlowId,
      fromRoleId: sourceRoleId,
      toRoleId: targetRoleId,
      eventType,
      runtimeOnlyErrorFlow: command.runtimeOnlyErrorFlow ?? eventType.startsWith("ERROR")
    };
    delete authoring.flows[originalFlowId];
    authoring.flows[flow.flowId] = flow;
    if (originalTargetRoleId !== STUDIO_SYSTEM_END_ROLE_ID) {
      syncJoinSource(authoring, originalTargetRoleId, command.originalSourceRoleId, false);
    }
    if (targetRoleId !== STUDIO_SYSTEM_END_ROLE_ID) {
      syncJoinSource(authoring, targetRoleId, sourceRoleId, Boolean(command.participatesInJoin));
    }
    canvas.edges = canvas.edges.map((edge) => {
      const matches = (command.flowId && edge.id === command.flowId) ||
        (edge.source === command.originalSourceRoleId &&
          edge.target === originalTargetRoleId &&
          edge.eventType === originalEventType);
      return matches
        ? {
            ...edge,
            id: flow.flowId,
            source: sourceRoleId,
            target: targetRoleId,
            label: eventType,
            eventType,
            runtimeOnlyErrorFlow: Boolean(flow.runtimeOnlyErrorFlow),
            participatesInJoin: Boolean(command.participatesInJoin)
          }
        : edge;
    });
    return { authoring, canvas, selectedFlowKey: canvasFlowKey(flow) };
  }

  if (command.type === "delete-edge") {
    const targetRoleId = command.targetRoleId === "output" ? STUDIO_SYSTEM_END_ROLE_ID : command.targetRoleId;
    authoring.flows = Object.fromEntries(
      Object.entries(authoring.flows).filter(([flowId, flow]) => {
        if (command.flowId && flowId === command.flowId) {
          return false;
        }
        return !(
          flow.fromRoleId === command.sourceRoleId &&
          flow.toRoleId === targetRoleId &&
          flow.eventType === command.eventType
        );
      })
    );
    canvas.edges = canvas.edges.filter((edge) => {
      if (command.flowId && edge.id === command.flowId) {
        return false;
      }
      return !(
        edge.source === command.sourceRoleId &&
        edge.target === targetRoleId &&
        edge.eventType === command.eventType
      );
    });
    return { authoring, canvas };
  }

  return { authoring, canvas };
}
