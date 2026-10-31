import { authoringToGraphSnapshot } from "../studio-authoring-projection.js";
import {
  STUDIO_SYSTEM_END_ROLE_ID,
  STUDIO_SYSTEM_START_ROLE_ID,
  normalizeStudioGraphStoredRoleId,
  normalizeStudioGraphTargetRoleId,
  studioFlowKey,
  type StudioAuthoringDocument,
  type StudioAuthoringFlow,
  type StudioAuthoringRole,
  type StudioGraphSnapshot
} from "../studio-contracts.js";

type StudioAuthoringLeafCommand =
  | {
      type: "add-role";
      sourceRoleId?: string;
      repositoryRoleId?: string;
      roleId?: string;
      title?: string;
      bindingKind?: StudioAuthoringRole["bindingKind"];
      backend?: string;
      modelId?: string;
      modelSelectionSource?: StudioAuthoringRole["modelSelectionSource"];
      modelRef?: string;
      profileId?: string;
      profileDraft?: StudioExecutionProfileDraft;
      toolDraft?: StudioExecutionToolDraft;
      inputPorts?: Record<string, unknown>;
      outputPorts?: Record<string, unknown>;
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
      backend?: string;
      modelId?: string;
      modelSelectionSource?: StudioAuthoringRole["modelSelectionSource"];
      modelRef?: string;
      profileId?: string;
      contextMap?: Record<string, string>;
      roleSettings?: Pick<StudioAuthoringRole, "routingMode" | "routeOrder" | "joinMode" | "joinMin" | "loopMax" | "review">;
      profileDraft?: StudioExecutionProfileDraft;
      toolDraft?: StudioExecutionToolDraft;
    }
  | { type: "delete-role"; roleId: string }
  | {
      type: "update-system";
      system: Partial<StudioAuthoringDocument["system"]>;
    }
  | {
      type: "add-edge";
      sourceRoleId: string;
      targetRoleId: string;
      eventType?: string;
      outputPort?: string;
      inputPort?: string;
      label?: string;
      runtimeOnlyErrorFlow?: boolean;
      participatesInJoin?: boolean;
      condition?: StudioAuthoringFlow["condition"];
      priority?: number;
    }
  | {
      type: "update-edge";
      flowId?: string;
      originalSourceRoleId: string;
      originalTargetRoleId: string;
      originalEventType: string;
      originalOutputPort?: string;
      originalInputPort?: string;
      sourceRoleId: string;
      targetRoleId: string;
      eventType?: string;
      outputPort?: string;
      inputPort?: string;
      label?: string;
      runtimeOnlyErrorFlow?: boolean;
      participatesInJoin?: boolean;
      condition?: StudioAuthoringFlow["condition"];
      priority?: number;
    }
  | {
      type: "delete-edge";
      flowId?: string;
      sourceRoleId: string;
      targetRoleId: string;
      eventType: string;
      outputPort?: string;
      inputPort?: string;
    };

export type StudioAuthoringCommand =
  | StudioAuthoringLeafCommand
  | { type: "batch"; commands: StudioAuthoringCommand[] };

export type StudioAuthoringCommandResult = {
  authoring: StudioAuthoringDocument;
  canvas: StudioGraphSnapshot;
  selectedRoleId?: string;
  selectedFlowKey?: string;
  /** Stable flow id for consumers that persist Team IR Handoff ids. */
  selectedFlowId?: string;
  repositoryRoleId?: string;
  profileDrafts?: StudioExecutionProfileDraft[];
  toolDrafts?: StudioExecutionToolDraft[];
  blockedCode?:
    | "entry-role-delete"
    | "missing-role-id"
    | "invalid-role-id"
    | "duplicate-role-id"
    | "invalid-edge-endpoints"
    | "invalid-edge-ports"
    | "duplicate-edge"
    | "invalid-event-type";
};

export type StudioExecutionProfileDraft = {
  profileId: string;
  toolRef: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type StudioExecutionToolDraft = {
  toolRef: string;
  runner: "local_shell";
  command: string;
  argsTemplate: string[];
  stdinMode: "none" | "text";
};

/**
 * Maps an X6 port to the Team IR port it represents. Layout projection ports
 * are flow-scoped (`out-flow-*` / `in-flow-*`); generic `connect-*` ports are
 * intentionally not authoring targets.
 */
export function resolveStudioAuthoringPort(args: {
  portId?: string;
  direction: "output" | "input";
  roleId: string;
  authoring?: StudioAuthoringDocument | null;
}): string | undefined {
  const portId = String(args.portId ?? "");
  if (!portId || portId.startsWith("connect-")) return undefined;
  const role = args.authoring?.roles?.[args.roleId];
  const ports = args.direction === "output" ? role?.outputPorts : role?.inputPorts;
  const encodedPrefix = args.direction === "output" ? "out-port-" : "in-port-";
  if (portId.startsWith(encodedPrefix)) {
    const candidate = decodeStudioPortToken(portId.slice(encodedPrefix.length));
    return candidate && ports && Object.hasOwn(ports, candidate) ? candidate : undefined;
  }
  const flowPrefix = args.direction === "output" ? "out-flow-" : "in-flow-";
  if (!portId.startsWith(flowPrefix)) return undefined;
  const flowId = decodeStudioPortToken(portId.slice(flowPrefix.length));
  const flow = Object.values(args.authoring?.flows ?? {}).find((entry) => entry.flowId === flowId);
  if (!flow) return undefined;
  if (args.direction === "output" && flow.fromRoleId === args.roleId) {
    const candidate = flow.outputPort || flow.eventType;
    return candidate && ports && Object.hasOwn(ports, candidate) ? candidate : undefined;
  }
  if (args.direction === "input" && flow.toRoleId === args.roleId) {
    const candidate = flow.inputPort;
    return candidate && ports && Object.hasOwn(ports, candidate) ? candidate : undefined;
  }
  return undefined;
}

function decodeStudioPortToken(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return decoded || undefined;
  } catch {
    return undefined;
  }
}

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

const RESERVED_ROLE_IDS = new Set(["start", "end", STUDIO_SYSTEM_START_ROLE_ID, STUDIO_SYSTEM_END_ROLE_ID]);
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

function normalizeFlowLabel(value: unknown, eventType: string): string | undefined {
  const label = String(value ?? "").trim();
  return label && label !== eventType ? label.slice(0, 120) : undefined;
}

function nextFlowId(authoring: StudioAuthoringDocument, flow: Omit<StudioAuthoringFlow, "flowId">): string {
  const source = flow.fromRoleId === STUDIO_SYSTEM_START_ROLE_ID ? "start" : flow.fromRoleId;
  const target = flow.toRoleId === STUDIO_SYSTEM_END_ROLE_ID ? "end" : flow.toRoleId;
  let base = `${Object.keys(authoring.flows).length + 1}:${source}:${flow.eventType}:${target}`;
  let candidate = base;
  let suffix = 2;
  while (authoring.flows[candidate]) {
    base = `${source}:${flow.eventType}:${target}`;
    candidate = `${base}#${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function canvasFlowKey(flow: Pick<StudioAuthoringFlow, "fromRoleId" | "toRoleId" | "eventType" | "outputPort" | "inputPort">): string {
  return studioFlowKey(flow);
}

function commandTargetRoleId(roleId: string): string {
  return normalizeStudioGraphTargetRoleId(roleId);
}

function roleCanvasNode(role: StudioAuthoringRole, x: number, y: number): StudioGraphSnapshot["nodes"][number] {
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
    backend?: string;
    modelId?: string;
    modelSelectionSource?: StudioAuthoringRole["modelSelectionSource"];
    modelRef?: string;
    profileId?: string;
    contextMap?: Record<string, string>;
    roleSettings?: Pick<StudioAuthoringRole, "routingMode" | "routeOrder" | "joinMode" | "joinMin" | "loopMax" | "review">;
  }
): StudioAuthoringRole {
  const bindingKind = normalizeBindingKind(args.bindingKind);
  const next: StudioAuthoringRole = {
    ...role,
    title: normalizeTitle(args.title, role.roleId),
    bindingKind
  };
  delete next.modelRef;
  delete next.backend;
  delete next.modelId;
  delete next.modelSelectionSource;
  delete next.profileId;
  if (bindingKind === "model") {
    const backend = String(args.backend ?? "").trim();
    const modelId = String(args.modelId ?? "").trim();
    if (backend && modelId) {
      next.backend = backend;
      next.modelId = modelId;
      next.modelSelectionSource = args.modelSelectionSource ?? "role";
      next.modelRef = `${backend}/${modelId}`;
    }
  }
  if (bindingKind === "exec") {
    const profileId = String(args.profileId ?? "").trim();
    if (profileId) next.profileId = profileId;
  }
  if (args.contextMap !== undefined) {
    if (Object.keys(args.contextMap).length > 0) {
      next.contextMap = Object.fromEntries(
        Object.entries(args.contextMap)
          .map(([fieldName, selector]) => [String(fieldName || "").trim(), String(selector || "").trim()])
          .filter(([fieldName, selector]) => Boolean(fieldName) && Boolean(selector))
          .sort(([left], [right]) => left.localeCompare(right))
      );
    } else {
      delete next.contextMap;
    }
  }
  if (args.roleSettings) {
    Object.assign(next, args.roleSettings);
  }
  return next;
}

function matchesFlow(
  flow: StudioAuthoringFlow,
  args: { flowId?: string; sourceRoleId: string; targetRoleId: string; eventType: string; outputPort?: string; inputPort?: string },
  flowId: string
): boolean {
  if (args.flowId && args.flowId === flowId) {
    return true;
  }
  return flow.fromRoleId === args.sourceRoleId &&
    flow.toRoleId === args.targetRoleId &&
    flow.eventType === args.eventType &&
    (args.outputPort === undefined || String(flow.outputPort ?? "") === args.outputPort) &&
    (args.inputPort === undefined || String(flow.inputPort ?? "") === args.inputPort);
}

function findMatchingFlowEntry(
  authoring: StudioAuthoringDocument,
  args: { flowId?: string; sourceRoleId: string; targetRoleId: string; eventType: string; outputPort?: string; inputPort?: string }
): [string, StudioAuthoringFlow] | null {
  const targetRoleId = normalizeStudioGraphStoredRoleId(normalizeRoleId(args.targetRoleId));
  const eventType = normalizeEventType(args.eventType);
  return Object.entries(authoring.flows).find(([flowId, flow]) =>
    matchesFlow(flow, {
      flowId: args.flowId,
      sourceRoleId: normalizeRoleId(args.sourceRoleId),
      targetRoleId,
      eventType,
      outputPort: args.outputPort,
      inputPort: args.inputPort
    }, flowId)
  ) ?? null;
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

function flowParticipatesInJoin(authoring: StudioAuthoringDocument, flow: StudioAuthoringFlow): boolean {
  if (Object.hasOwn(flow, "participatesInJoin")) return Boolean(flow.participatesInJoin);
  return flow.toRoleId !== STUDIO_SYSTEM_END_ROLE_ID &&
    Boolean(authoring.roles[flow.toRoleId]?.joinSources?.includes(flow.fromRoleId));
}

function roleCanRoundTripViaAddCommand(role: StudioAuthoringRole): boolean {
  return !role.routingMode &&
    !role.routeOrder?.length &&
    !role.joinMode &&
    role.joinMin == null &&
    !role.loopMax &&
    !role.review &&
    !(role.contextMap && Object.keys(role.contextMap).length);
}

function addRoleCommandFromRole(
  role: StudioAuthoringRole,
  layout?: StudioAuthoringDocument["layout"]["nodes"][string]
): StudioAuthoringLeafCommand | null {
  if (!roleCanRoundTripViaAddCommand(role)) {
    return null;
  }
  return {
    type: "add-role",
    roleId: role.roleId,
    title: role.title,
    bindingKind: role.bindingKind,
    modelRef: role.modelRef,
    profileId: role.profileId,
    inputPorts: role.inputPorts ? cloneJson(role.inputPorts) : undefined,
    outputPorts: role.outputPorts ? cloneJson(role.outputPorts) : undefined,
    x: layout?.x,
    y: layout?.y
  };
}

function addEdgeCommandFromFlow(
  authoring: StudioAuthoringDocument,
  flow: StudioAuthoringFlow
): StudioAuthoringLeafCommand {
  return {
    type: "add-edge",
    sourceRoleId: flow.fromRoleId,
    targetRoleId: commandTargetRoleId(flow.toRoleId),
    eventType: flow.eventType,
    outputPort: flow.outputPort,
    inputPort: flow.inputPort,
    label: flow.label,
    runtimeOnlyErrorFlow: flow.runtimeOnlyErrorFlow,
    participatesInJoin: flowParticipatesInJoin(authoring, flow)
  };
}

function hasInverseSideEffects(command: StudioAuthoringCommand): boolean {
  if (command.type === "add-role") {
    return Boolean(command.repositoryRoleId || command.profileDraft || command.toolDraft);
  }
  if (command.type === "update-role") {
    return Boolean(command.profileDraft || command.toolDraft);
  }
  return false;
}

export function applyStudioAuthoringCommand(args: {
  authoring: StudioAuthoringDocument;
  command: StudioAuthoringCommand;
}): StudioAuthoringCommandResult {
  const authoring = cloneJson(args.authoring);
  const canvas = cloneJson(authoringToGraphSnapshot(authoring));
  authoring.roles ||= {};
  authoring.flows ||= {};
  authoring.layout ||= { nodes: {} };
  authoring.layout.nodes ||= {};
  canvas.nodes ||= [];
  canvas.edges ||= [];

  const command = args.command;
  if (command.type === "batch") {
    let nextAuthoring = authoring;
    let nextCanvas = canvas;
    let selectedRoleId: string | undefined;
    let selectedFlowKey: string | undefined;
    let selectedFlowId: string | undefined;
    let repositoryRoleId: string | undefined;
    const profileDrafts: StudioExecutionProfileDraft[] = [];
    const toolDrafts: StudioExecutionToolDraft[] = [];
    for (const nestedCommand of command.commands) {
      const result = applyStudioAuthoringCommand({
        authoring: nextAuthoring,
        command: nestedCommand
      });
      if (result.blockedCode) {
        return { authoring, canvas, blockedCode: result.blockedCode };
      }
      nextAuthoring = result.authoring;
      nextCanvas = result.canvas;
      selectedRoleId = result.selectedRoleId ?? selectedRoleId;
      selectedFlowKey = result.selectedFlowKey ?? selectedFlowKey;
      selectedFlowId = result.selectedFlowId ?? selectedFlowId;
      repositoryRoleId = result.repositoryRoleId ?? repositoryRoleId;
      if (result.profileDrafts?.length) {
        profileDrafts.push(...result.profileDrafts);
      }
      if (result.toolDrafts?.length) {
        toolDrafts.push(...result.toolDrafts);
      }
    }
    return {
      authoring: nextAuthoring,
      canvas: nextCanvas,
      selectedRoleId,
      selectedFlowKey,
      selectedFlowId,
      repositoryRoleId,
      profileDrafts: profileDrafts.length ? profileDrafts : undefined,
      toolDrafts: toolDrafts.length ? toolDrafts : undefined
    };
  }

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
      const isFirstRole = Object.keys(authoring.roles).length === 0;
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
        const backend = String(command.backend ?? "").trim();
        const modelId = String(command.modelId ?? "").trim();
        if (backend && modelId) {
          role.backend = backend;
          role.modelId = modelId;
          role.modelSelectionSource = command.modelSelectionSource ?? "role";
          role.modelRef = `${backend}/${modelId}`;
        }
      }
      if (role.bindingKind === "exec") {
        const profileId = String(command.profileId ?? "").trim();
        if (profileId) role.profileId = profileId;
      }
      if (command.inputPorts !== undefined) role.inputPorts = cloneJson(command.inputPorts);
      if (command.outputPorts !== undefined) role.outputPorts = cloneJson(command.outputPorts);
      const x = Number.isFinite(command.x) ? Number(command.x) : 120 + canvas.nodes.length * 260;
      const y = Number.isFinite(command.y) ? Number(command.y) : 120;
      authoring.roles[roleId] = role;
      authoring.layout.nodes[roleId] = { x, y, width: 180, height: 84 };
      canvas.nodes.push(roleCanvasNode(role, x, y));
      if (isFirstRole) {
        const flow = { flowId: `start:START:${roleId}`, fromRoleId: STUDIO_SYSTEM_START_ROLE_ID, toRoleId: roleId, eventType: "START", label: "任务分发" };
        authoring.flows[flow.flowId] = flow;
        canvas.edges.push({ id: flow.flowId, source: flow.fromRoleId, target: flow.toRoleId, label: flow.label, eventType: flow.eventType, runtimeOnlyErrorFlow: false, participatesInJoin: false });
      }
      return {
        authoring,
        canvas,
        selectedRoleId: roleId,
        repositoryRoleId: command.repositoryRoleId,
        profileDrafts: command.profileDraft ? [command.profileDraft] : undefined,
        toolDrafts: command.toolDraft ? [command.toolDraft] : undefined
      };
    }

    const source = authoring.roles[command.roleId];
    const roleId = nextRoleId(authoring, `${command.roleId}-copy`);
    const role: StudioAuthoringRole = source
      ? { ...source, roleId, title: source.title ? `${source.title} copy` : undefined }
      : { roleId, title: roleId, bindingKind: "model" };
    const x = Number.isFinite(command.x) ? Number(command.x) : 120 + canvas.nodes.length * 260;
    const y = Number.isFinite(command.y) ? Number(command.y) : 120;
    authoring.roles[roleId] = role;
    authoring.layout.nodes[roleId] = { x, y, width: 180, height: 84 };
    canvas.nodes.push(roleCanvasNode(role, x, y));
    return { authoring, canvas, selectedRoleId: roleId };
  }

  if (command.type === "delete-role") {
    const roleId = command.roleId;
    if (!roleId) {
      return { authoring, canvas, blockedCode: "entry-role-delete" };
    }
    for (const candidate of Object.values(authoring.roles)) {
      if (Array.isArray(candidate.joinSources)) {
        candidate.joinSources = candidate.joinSources.filter((source) => source !== roleId);
        if (candidate.joinSources.length === 0) {
          delete candidate.joinSources;
        }
      }
      if (Array.isArray(candidate.routeOrder)) {
        candidate.routeOrder = candidate.routeOrder.filter((target) => target !== roleId);
        if (candidate.routeOrder.length === 0) {
          delete candidate.routeOrder;
        }
      }
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
    return { authoring, canvas, selectedRoleId: canvas.nodes.find((node) => node.roleId !== STUDIO_SYSTEM_START_ROLE_ID && node.roleId !== STUDIO_SYSTEM_END_ROLE_ID)?.roleId || "" };
  }

  if (command.type === "update-system") {
    authoring.system = { ...authoring.system, ...command.system };
    return { authoring, canvas, selectedRoleId: Object.values(authoring.flows).find((flow) => flow.fromRoleId === STUDIO_SYSTEM_START_ROLE_ID)?.toRoleId || STUDIO_SYSTEM_START_ROLE_ID };
  }

  if (command.type === "update-role") {
    const originalRoleId = normalizeRoleId(command.originalRoleId);
    const role = authoring.roles[originalRoleId];
    if (!originalRoleId || !role) {
      return { authoring, canvas, blockedCode: "missing-role-id" };
    }
    const nextRoleIdValue = normalizeRoleId(command.roleId || originalRoleId);
    if (!isValidRoleId(nextRoleIdValue)) {
      return { authoring, canvas, blockedCode: "invalid-role-id" };
    }
    if (nextRoleIdValue !== originalRoleId && authoring.roles[nextRoleIdValue]) {
      return { authoring, canvas, blockedCode: "duplicate-role-id" };
    }
    const updatedRole = applyRoleBinding({ ...role, roleId: nextRoleIdValue }, command);
    if (nextRoleIdValue !== originalRoleId) {
      delete authoring.roles[originalRoleId];
      authoring.roles[nextRoleIdValue] = updatedRole;
      if (authoring.layout.nodes[originalRoleId]) {
        authoring.layout.nodes[nextRoleIdValue] = authoring.layout.nodes[originalRoleId];
        delete authoring.layout.nodes[originalRoleId];
      }
      for (const flow of Object.values(authoring.flows)) {
        if (flow.fromRoleId === originalRoleId) flow.fromRoleId = nextRoleIdValue;
        if (flow.toRoleId === originalRoleId) flow.toRoleId = nextRoleIdValue;
      }
      for (const candidate of Object.values(authoring.roles)) {
        if (Array.isArray(candidate.joinSources)) {
          candidate.joinSources = candidate.joinSources.map((source) => source === originalRoleId ? nextRoleIdValue : source);
        }
        if (Array.isArray(candidate.routeOrder)) {
          candidate.routeOrder = candidate.routeOrder.map((target) => target === originalRoleId ? nextRoleIdValue : target);
        }
      }
      canvas.nodes = canvas.nodes.map((node) => node.roleId === originalRoleId
        ? { ...node, id: nextRoleIdValue, roleId: nextRoleIdValue, label: updatedRole.title || nextRoleIdValue, bindingKind: updatedRole.bindingKind }
        : node
      );
      canvas.edges = canvas.edges.map((edge) => ({
        ...edge,
        source: edge.source === originalRoleId ? nextRoleIdValue : edge.source,
        target: edge.target === originalRoleId ? nextRoleIdValue : edge.target
      }));
    } else {
      authoring.roles[originalRoleId] = updatedRole;
      canvas.nodes = canvas.nodes.map((node) => node.roleId === originalRoleId
        ? { ...node, label: updatedRole.title || originalRoleId, bindingKind: updatedRole.bindingKind }
        : node
      );
    }
    return {
      authoring,
      canvas,
      selectedRoleId: nextRoleIdValue,
      profileDrafts: command.profileDraft ? [command.profileDraft] : undefined,
      toolDrafts: command.toolDraft ? [command.toolDraft] : undefined
    };
  }

  if (command.type === "add-edge") {
    const sourceRoleId = normalizeRoleId(command.sourceRoleId);
    const targetRoleId = normalizeStudioGraphStoredRoleId(normalizeRoleId(command.targetRoleId));
    const sourceIsStart = sourceRoleId === STUDIO_SYSTEM_START_ROLE_ID;
    const targetIsEnd = targetRoleId === STUDIO_SYSTEM_END_ROLE_ID;
    if (
      !sourceRoleId ||
      sourceRoleId === targetRoleId ||
      (sourceRoleId === STUDIO_SYSTEM_END_ROLE_ID) ||
      (targetRoleId === STUDIO_SYSTEM_START_ROLE_ID) ||
      (sourceIsStart && targetIsEnd) ||
      (!sourceIsStart && !authoring.roles[sourceRoleId]) ||
      (!targetIsEnd && !authoring.roles[targetRoleId])
    ) {
      return { authoring, canvas, blockedCode: "invalid-edge-endpoints" };
    }
    const sourcePorts = sourceIsStart ? undefined : authoring.roles[sourceRoleId]?.outputPorts;
    const targetPorts = targetIsEnd ? undefined : authoring.roles[targetRoleId]?.inputPorts;
    const outputPort = sourceIsStart ? undefined : String(command.outputPort ?? "").trim() || undefined;
    const inputPort = targetIsEnd ? undefined : String(command.inputPort ?? "").trim() || undefined;
    if ((sourcePorts && (!outputPort || !Object.hasOwn(sourcePorts, outputPort)))
      || (targetPorts && (!inputPort || !Object.hasOwn(targetPorts, inputPort)))) {
      return { authoring, canvas, blockedCode: "invalid-edge-ports" };
    }
    let eventType = sourceIsStart ? "START" : normalizeEventType(command.eventType) || "DONE";
    if (!EVENT_TYPE_PATTERN.test(eventType)) {
      return { authoring, canvas, blockedCode: "invalid-event-type" };
    }
    if (!normalizeEventType(command.eventType)) {
      let suffix = 2;
      while (Object.values(authoring.flows).some((flow) =>
        flow.fromRoleId === sourceRoleId &&
        flow.toRoleId === targetRoleId &&
        flow.eventType === eventType &&
        String(flow.outputPort ?? "") === String(outputPort ?? "") &&
        String(flow.inputPort ?? "") === String(inputPort ?? "")
      )) {
        eventType = `DONE_${suffix}`;
        suffix += 1;
      }
    } else if (Object.values(authoring.flows).some((flow) =>
      flow.fromRoleId === sourceRoleId &&
      flow.toRoleId === targetRoleId &&
      flow.eventType === eventType &&
      String(flow.outputPort ?? "") === String(outputPort ?? "") &&
      String(flow.inputPort ?? "") === String(inputPort ?? "")
    )) {
      return { authoring, canvas, blockedCode: "duplicate-edge" };
    }
    const flowBody: Omit<StudioAuthoringFlow, "flowId"> = {
      fromRoleId: sourceRoleId,
      toRoleId: targetRoleId,
      eventType,
      ...(outputPort ? { outputPort } : {}),
      ...(inputPort ? { inputPort } : {}),
      label: sourceIsStart ? "任务分发" : targetIsEnd ? normalizeFlowLabel(command.label, eventType) ?? "结果到达" : normalizeFlowLabel(command.label, eventType),
      runtimeOnlyErrorFlow: sourceIsStart || targetIsEnd ? false : command.runtimeOnlyErrorFlow ?? eventType.startsWith("ERROR"),
      participatesInJoin: Boolean(command.participatesInJoin),
      ...(sourceIsStart || targetIsEnd ? {} : { condition: command.condition, priority: command.priority ?? 0 })
    };
    if (!flowBody.label) {
      delete flowBody.label;
    }
    const flowId = nextFlowId(authoring, flowBody);
    const flow = { flowId, ...flowBody };
    authoring.flows[flowId] = flow;
    canvas.edges.push({
      id: flowId,
      source: sourceRoleId,
      target: targetRoleId,
      label: flow.label ?? eventType,
      eventType,
      ...(flow.outputPort ? { outputPort: flow.outputPort } : {}),
      ...(flow.inputPort ? { inputPort: flow.inputPort } : {}),
      runtimeOnlyErrorFlow: Boolean(flow.runtimeOnlyErrorFlow),
      participatesInJoin: Boolean(command.participatesInJoin),
      condition: flow.condition,
      priority: flow.priority
    });
    if (command.participatesInJoin && targetRoleId !== STUDIO_SYSTEM_END_ROLE_ID) {
      syncJoinSource(authoring, targetRoleId, sourceRoleId, true);
    }
    return { authoring, canvas, selectedFlowKey: canvasFlowKey(flow), selectedFlowId: flow.flowId };
  }

  if (command.type === "update-edge") {
    const originalTargetValue = normalizeRoleId(command.originalTargetRoleId);
    const originalTargetRoleId = originalTargetValue === "output"
      ? STUDIO_SYSTEM_END_ROLE_ID
      : normalizeStudioGraphStoredRoleId(originalTargetValue);
    const originalEventType = normalizeEventType(command.originalEventType);
    const sourceRoleId = normalizeRoleId(command.sourceRoleId);
    const targetValue = normalizeRoleId(command.targetRoleId);
    const targetRoleId = targetValue === "output"
      ? STUDIO_SYSTEM_END_ROLE_ID
      : normalizeStudioGraphStoredRoleId(targetValue);
    const sourceIsStart = sourceRoleId === STUDIO_SYSTEM_START_ROLE_ID;
    const targetIsEnd = targetRoleId === STUDIO_SYSTEM_END_ROLE_ID;
    if (
      !sourceRoleId ||
      sourceRoleId === targetRoleId ||
      sourceRoleId === STUDIO_SYSTEM_END_ROLE_ID ||
      targetRoleId === STUDIO_SYSTEM_START_ROLE_ID ||
      (sourceIsStart && targetIsEnd) ||
      (!sourceIsStart && !authoring.roles[sourceRoleId]) ||
      (!targetIsEnd && !authoring.roles[targetRoleId])
    ) {
      return { authoring, canvas, blockedCode: "invalid-edge-endpoints" };
    }
    const sourcePorts = sourceIsStart ? undefined : authoring.roles[sourceRoleId]?.outputPorts;
    const targetPorts = targetIsEnd ? undefined : authoring.roles[targetRoleId]?.inputPorts;
    const outputPort = sourceIsStart ? undefined : String(command.outputPort ?? "").trim() || undefined;
    const inputPort = targetIsEnd ? undefined : String(command.inputPort ?? "").trim() || undefined;
    if ((sourcePorts && (!outputPort || !Object.hasOwn(sourcePorts, outputPort)))
      || (targetPorts && (!inputPort || !Object.hasOwn(targetPorts, inputPort)))) {
      return { authoring, canvas, blockedCode: "invalid-edge-ports" };
    }
    const eventType = sourceIsStart ? "START" : normalizeEventType(command.eventType || "DONE");
    if (!EVENT_TYPE_PATTERN.test(eventType)) {
      return { authoring, canvas, blockedCode: "invalid-event-type" };
    }
    const original = findMatchingFlowEntry(authoring, {
      flowId: command.flowId,
      sourceRoleId: command.originalSourceRoleId,
      targetRoleId: originalTargetRoleId,
      eventType: originalEventType,
      outputPort: command.originalOutputPort,
      inputPort: command.originalInputPort
    });
    if (!original) {
      return { authoring, canvas, blockedCode: "invalid-edge-endpoints" };
    }
    const [originalFlowId, originalFlow] = original;
    const duplicate = Object.entries(authoring.flows).some(([flowId, flow]) =>
      flowId !== originalFlowId &&
      flow.fromRoleId === sourceRoleId &&
      flow.toRoleId === targetRoleId &&
      flow.eventType === eventType &&
      String(flow.outputPort ?? "") === String(outputPort ?? "") &&
      String(flow.inputPort ?? "") === String(inputPort ?? "")
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
      ...(outputPort ? { outputPort } : {}),
      ...(inputPort ? { inputPort } : {}),
      label: sourceIsStart || targetIsEnd ? (Object.hasOwn(command, "label")
        ? normalizeFlowLabel(command.label, eventType) ?? "结果到达"
        : normalizeFlowLabel(originalFlow.label, eventType) ?? (sourceIsStart ? "任务分发" : "结果到达")) : Object.hasOwn(command, "label")
        ? normalizeFlowLabel(command.label, eventType)
        : normalizeFlowLabel(originalFlow.label, eventType),
      runtimeOnlyErrorFlow: sourceIsStart || targetIsEnd ? false : command.runtimeOnlyErrorFlow ?? eventType.startsWith("ERROR"),
      condition: sourceIsStart ? undefined : command.condition,
      priority: sourceIsStart ? undefined : command.priority ?? originalFlow.priority ?? 0,
      participatesInJoin: Boolean(command.participatesInJoin)
    };
    if (!flow.label) {
      delete flow.label;
    }
    delete authoring.flows[originalFlowId];
    authoring.flows[flow.flowId] = flow;
    if (originalTargetRoleId !== STUDIO_SYSTEM_END_ROLE_ID) {
      syncJoinSource(authoring, originalTargetRoleId, command.originalSourceRoleId, false);
    }
    if (targetRoleId !== STUDIO_SYSTEM_END_ROLE_ID) {
      syncJoinSource(authoring, targetRoleId, sourceRoleId, Boolean(command.participatesInJoin));
    }
    canvas.edges = canvas.edges.map((edge) => {
      const isMatch = (command.flowId && edge.id === command.flowId) ||
        (edge.source === command.originalSourceRoleId &&
          edge.target === originalTargetRoleId &&
          edge.eventType === originalEventType &&
          (command.originalOutputPort === undefined || String(edge.outputPort ?? "") === command.originalOutputPort) &&
          (command.originalInputPort === undefined || String(edge.inputPort ?? "") === command.originalInputPort));
      return isMatch
        ? {
            ...edge,
            id: flow.flowId,
            source: sourceRoleId,
            target: targetRoleId,
            label: flow.label ?? eventType,
            eventType,
            ...(flow.outputPort ? { outputPort: flow.outputPort } : {}),
            ...(flow.inputPort ? { inputPort: flow.inputPort } : {}),
            runtimeOnlyErrorFlow: Boolean(flow.runtimeOnlyErrorFlow),
            participatesInJoin: Boolean(command.participatesInJoin),
            condition: flow.condition,
            priority: flow.priority
          }
        : edge;
    });
    return { authoring, canvas, selectedFlowKey: canvasFlowKey(flow), selectedFlowId: flow.flowId };
  }

  if (command.type === "delete-edge") {
    const targetRoleId = normalizeStudioGraphStoredRoleId(command.targetRoleId);
    const removedFlows = Object.entries(authoring.flows).reduce<StudioAuthoringFlow[]>((list, [flowId, flow]) => {
      if (command.flowId && flowId === command.flowId) {
        list.push(flow);
        return list;
      }
      if (
        flow.fromRoleId === command.sourceRoleId &&
        flow.toRoleId === targetRoleId &&
        flow.eventType === command.eventType &&
        (command.outputPort === undefined || String(flow.outputPort ?? "") === command.outputPort) &&
        (command.inputPort === undefined || String(flow.inputPort ?? "") === command.inputPort)
      ) {
        list.push(flow);
      }
      return list;
    }, []);
    authoring.flows = Object.fromEntries(
      Object.entries(authoring.flows).filter(([flowId, flow]) => {
        if (command.flowId && flowId === command.flowId) {
          return false;
        }
        return !(
          flow.fromRoleId === command.sourceRoleId &&
          flow.toRoleId === targetRoleId &&
          flow.eventType === command.eventType &&
          (command.outputPort === undefined || String(flow.outputPort ?? "") === command.outputPort) &&
          (command.inputPort === undefined || String(flow.inputPort ?? "") === command.inputPort)
        );
      })
    );
    for (const flow of removedFlows) {
      if (flow.toRoleId !== STUDIO_SYSTEM_END_ROLE_ID) {
        syncJoinSource(authoring, flow.toRoleId, flow.fromRoleId, false);
      }
    }
    canvas.edges = canvas.edges.filter((edge) => {
      if (command.flowId && edge.id === command.flowId) {
        return false;
      }
      return !(
        edge.source === command.sourceRoleId &&
        edge.target === targetRoleId &&
        edge.eventType === command.eventType &&
        (command.outputPort === undefined || String(edge.outputPort ?? "") === command.outputPort) &&
        (command.inputPort === undefined || String(edge.inputPort ?? "") === command.inputPort)
      );
    });
    return { authoring, canvas };
  }

  return { authoring, canvas };
}

export function deriveInverseCommand(
  authoring: StudioAuthoringDocument,
  command: StudioAuthoringCommand
): StudioAuthoringCommand | null {
  if (command.type === "batch") {
    let working = cloneJson(authoring);
    const inverses: StudioAuthoringCommand[] = [];
    for (const nestedCommand of command.commands) {
      const inverse = deriveInverseCommand(working, nestedCommand);
      if (!inverse) {
        return null;
      }
      const result = applyStudioAuthoringCommand({
        authoring: working,
        command: nestedCommand
      });
      if (result.blockedCode) {
        return null;
      }
      working = result.authoring;
      inverses.unshift(inverse);
    }
    if (inverses.length === 0) {
      return { type: "batch", commands: [] };
    }
    return inverses.length === 1 ? inverses[0] : { type: "batch", commands: inverses };
  }

  if (hasInverseSideEffects(command)) {
    return null;
  }

  if (command.type === "add-role" || command.type === "duplicate-role") {
    const result = applyStudioAuthoringCommand({ authoring, command });
    if (result.blockedCode || !result.selectedRoleId) {
      return null;
    }
    return { type: "delete-role", roleId: result.selectedRoleId };
  }

  if (command.type === "update-role") {
    const originalRoleId = normalizeRoleId(command.originalRoleId);
    const role = authoring.roles[originalRoleId];
    if (!originalRoleId || !role) {
      return null;
    }
    const updatedRoleId = normalizeRoleId(command.roleId || command.originalRoleId);
    if (!updatedRoleId) {
      return null;
    }
    return {
      type: "update-role",
      originalRoleId: updatedRoleId,
      roleId: role.roleId,
      title: role.title,
      bindingKind: role.bindingKind,
      modelRef: role.modelRef,
      profileId: role.profileId,
      contextMap: role.contextMap ? { ...role.contextMap } : undefined
      ,roleSettings: {
        routingMode: role.routingMode,
        routeOrder: role.routeOrder ? [...role.routeOrder] : undefined,
        joinMode: role.joinMode,
        joinMin: role.joinMin,
        loopMax: role.loopMax,
        review: role.review ? { ...role.review } : undefined
      }
    };
  }

  if (command.type === "delete-role") {
    const roleId = normalizeRoleId(command.roleId);
    const role = authoring.roles[roleId];
    if (!role) {
      return null;
    }
    const addRole = addRoleCommandFromRole(role, authoring.layout.nodes[roleId]);
    if (!addRole) {
      return null;
    }
    const flowCommands = Object.values(authoring.flows)
      .filter((flow) => flow.fromRoleId === roleId || flow.toRoleId === roleId)
      .sort((left, right) => left.flowId.localeCompare(right.flowId))
      .map((flow) => addEdgeCommandFromFlow(authoring, flow));
    const commands = [addRole, ...flowCommands];
    return commands.length === 1 ? commands[0] : { type: "batch", commands };
  }

  if (command.type === "update-system") {
    return { type: "update-system", system: { ...authoring.system } };
  }

  if (command.type === "add-edge") {
    const result = applyStudioAuthoringCommand({ authoring, command });
    if (result.blockedCode) {
      return null;
    }
    const addedFlowEntry = Object.entries(result.authoring.flows).find(([flowId]) => !authoring.flows[flowId]);
    if (!addedFlowEntry) {
      return null;
    }
    const [flowId, flow] = addedFlowEntry;
    return {
      type: "delete-edge",
      flowId,
      sourceRoleId: flow.fromRoleId,
      targetRoleId: commandTargetRoleId(flow.toRoleId),
      eventType: flow.eventType,
      outputPort: flow.outputPort,
      inputPort: flow.inputPort
    };
  }

  if (command.type === "update-edge") {
    const original = findMatchingFlowEntry(authoring, {
      flowId: command.flowId,
      sourceRoleId: command.originalSourceRoleId,
      targetRoleId: command.originalTargetRoleId,
      eventType: command.originalEventType,
      outputPort: command.originalOutputPort,
      inputPort: command.originalInputPort
    });
    if (!original) {
      return null;
    }
    const [flowId, flow] = original;
    return {
      type: "update-edge",
      flowId: flow.flowId || flowId,
      originalSourceRoleId: normalizeRoleId(command.sourceRoleId),
      originalTargetRoleId: commandTargetRoleId(normalizeStudioGraphStoredRoleId(command.targetRoleId)),
      originalEventType: normalizeEventType(command.eventType || "DONE"),
      originalOutputPort: command.outputPort,
      originalInputPort: command.inputPort,
      sourceRoleId: flow.fromRoleId,
      targetRoleId: commandTargetRoleId(flow.toRoleId),
      eventType: flow.eventType,
      outputPort: flow.outputPort,
      inputPort: flow.inputPort,
      label: flow.label,
      runtimeOnlyErrorFlow: flow.runtimeOnlyErrorFlow,
      participatesInJoin: flowParticipatesInJoin(authoring, flow)
    };
  }

  if (command.type === "delete-edge") {
    const flowEntry = findMatchingFlowEntry(authoring, {
      flowId: command.flowId,
      sourceRoleId: command.sourceRoleId,
      targetRoleId: command.targetRoleId,
      eventType: command.eventType,
      outputPort: command.outputPort,
      inputPort: command.inputPort
    });
    if (!flowEntry) {
      return null;
    }
    return addEdgeCommandFromFlow(authoring, flowEntry[1]);
  }

  return null;
}
