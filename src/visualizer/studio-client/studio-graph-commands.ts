import {
  STUDIO_SYSTEM_END_ROLE_ID,
  type StudioAuthoringDocument,
  type StudioAuthoringFlow,
  type StudioAuthoringRole,
  type StudioCanvasDocument
} from "../studio-contracts.js";

export type StudioAuthoringCommand =
  | { type: "add-role"; sourceRoleId?: string; x?: number; y?: number }
  | { type: "duplicate-role"; roleId: string; x?: number; y?: number }
  | { type: "delete-role"; roleId: string }
  | { type: "add-edge"; sourceRoleId: string; targetRoleId: string; eventType?: string }
  | { type: "delete-edge"; flowId?: string; sourceRoleId: string; targetRoleId: string; eventType: string };

export type StudioAuthoringCommandResult = {
  authoring: StudioAuthoringDocument;
  canvas: StudioCanvasDocument;
  selectedRoleId?: string;
  selectedFlowKey?: string;
  blockedCode?: "entry-role-delete" | "invalid-edge-endpoints";
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

  if (args.command.type === "add-role" || args.command.type === "duplicate-role") {
    const source = args.command.type === "duplicate-role" ? authoring.roles[args.command.roleId] : undefined;
    const roleId = nextRoleId(authoring, source ? `${args.command.roleId}-copy` : "new-role");
    const role: StudioAuthoringRole = source
      ? { ...source, roleId, title: source.title ? `${source.title} copy` : undefined }
      : { roleId, title: "New role", bindingKind: "noop" };
    const x = Number.isFinite(args.command.x) ? Number(args.command.x) : 120 + canvas.nodes.length * 260;
    const y = Number.isFinite(args.command.y) ? Number(args.command.y) : 120;
    authoring.roles[roleId] = role;
    authoring.layout.nodes[roleId] = { x, y, width: 180, height: 84 };
    canvas.nodes.push(roleCanvasNode(role, x, y));
    return { authoring, canvas, selectedRoleId: roleId };
  }

  if (args.command.type === "delete-role") {
    const roleId = args.command.roleId;
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

  if (args.command.type === "add-edge") {
    const sourceRoleId = args.command.sourceRoleId;
    const targetRoleId = args.command.targetRoleId === "output" ? STUDIO_SYSTEM_END_ROLE_ID : args.command.targetRoleId;
    if (!authoring.roles[sourceRoleId] || (targetRoleId !== STUDIO_SYSTEM_END_ROLE_ID && !authoring.roles[targetRoleId])) {
      return { authoring, canvas, blockedCode: "invalid-edge-endpoints" };
    }
    let eventType = args.command.eventType || "DONE";
    if (!args.command.eventType) {
      let suffix = 2;
      while (Object.values(authoring.flows).some((flow) =>
        flow.fromRoleId === sourceRoleId &&
        flow.toRoleId === targetRoleId &&
        flow.eventType === eventType
      )) {
        eventType = `DONE_${suffix}`;
        suffix += 1;
      }
    }
    const flowBody = {
      fromRoleId: sourceRoleId,
      toRoleId: targetRoleId,
      eventType,
      runtimeOnlyErrorFlow: eventType.startsWith("ERROR")
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
      participatesInJoin: false
    });
    return { authoring, canvas, selectedFlowKey: canvasFlowKey(flow) };
  }

  if (args.command.type === "delete-edge") {
    const targetRoleId = args.command.targetRoleId === "output" ? STUDIO_SYSTEM_END_ROLE_ID : args.command.targetRoleId;
    authoring.flows = Object.fromEntries(
      Object.entries(authoring.flows).filter(([flowId, flow]) => {
        if (args.command.flowId && flowId === args.command.flowId) {
          return false;
        }
        return !(
          flow.fromRoleId === args.command.sourceRoleId &&
          flow.toRoleId === targetRoleId &&
          flow.eventType === args.command.eventType
        );
      })
    );
    canvas.edges = canvas.edges.filter((edge) => {
      if (args.command.flowId && edge.id === args.command.flowId) {
        return false;
      }
      return !(
        edge.source === args.command.sourceRoleId &&
        edge.target === targetRoleId &&
        edge.eventType === args.command.eventType
      );
    });
    return { authoring, canvas };
  }

  return { authoring, canvas };
}
