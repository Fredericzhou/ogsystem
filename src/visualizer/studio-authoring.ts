import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { isRuntimeOnlyErrorEvent } from "../runtime/error-flow-utils.js";
import { readJsonFile, writeJsonFileAtomic } from "../runtime/json-file.js";
import { parseSystemFromMermaidSource } from "../runtime/parse-mermaid.js";
import { SYSTEM_END_ROLE_ID } from "../runtime/types.js";
import type { Flow, HumanReviewSpec, SystemDefinition } from "../runtime/types.js";
import { validateProjectSystemSource } from "./project-projection.js";

export type StudioAuthoringDocument = {
  version: 1;
  project: {
    workdir: string;
    systemPath: string;
  };
  system: {
    systemId: string;
    systemVersion: string;
    entryRoleId: string;
    lawGlobalRef: string;
    handoffMode?: string;
    handoffContracts?: string;
  };
  roles: Record<string, StudioAuthoringRole>;
  flows: Record<string, StudioAuthoringFlow>;
  layout: {
    nodes: Record<string, { x: number; y: number; width?: number; height?: number }>;
    viewport?: { x: number; y: number; zoom: number };
  };
};

export type StudioAuthoringRole = {
  roleId: string;
  title?: string;
  bindingKind: "model" | "exec" | "noop";
  modelRef?: string;
  profileId?: string;
  routingMode?: "parallel_split";
  routeOrder?: string[];
  joinMode?: "all_of" | "quorum_of";
  joinMin?: number;
  joinSources?: string[];
  loopMax?: number;
  review?: HumanReviewSpec;
  contextMap?: Record<string, string>;
};

export type StudioAuthoringFlow = {
  flowId: string;
  fromRoleId: string;
  toRoleId: string;
  eventType: string;
  runtimeOnlyErrorFlow?: boolean;
};

export type StudioCanvasDocument = {
  version: 1;
  nodes: Array<{
    id: string;
    roleId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    badges: string[];
    bindingKind: StudioAuthoringRole["bindingKind"];
  }>;
  edges: Array<{
    id?: string;
    source: string;
    target: string;
    label: string;
    eventType: string;
    runtimeOnlyErrorFlow: boolean;
    participatesInJoin: boolean;
  }>;
  viewport?: { x: number; y: number; zoom: number };
};

type StudioBridgeRole = StudioAuthoringRole & {
  incomingFlowCount: number;
  outgoingFlowCount: number;
  allowedEvents: string[];
  badges: string[];
};

type StudioBridgeFlow = StudioAuthoringFlow & {
  flowKey: string;
  participatesInJoin: boolean;
};

export type StudioBridgeDraft = {
  workdir: string;
  systemPath: string;
  systemSource: string;
  validation: Awaited<ReturnType<typeof validateProjectSystemSource>>;
  authoring: StudioAuthoringDocument | null;
  extracted: {
    systemId: string;
    systemVersion: string;
    entryRoleId: string;
    lawGlobal: string;
    roles: StudioBridgeRole[];
    flows: StudioBridgeFlow[];
  } | null;
};

function sortStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function flowId(flow: Flow, index: number): string {
  const toRoleId = flow.toRoleId === SYSTEM_END_ROLE_ID ? "output" : flow.toRoleId;
  return `${index + 1}:${flow.fromRoleId}:${flow.eventType}:${toRoleId}`;
}

function flowKey(flow: Flow): string {
  const toRoleId = flow.toRoleId === SYSTEM_END_ROLE_ID ? "output" : flow.toRoleId;
  return `${flow.fromRoleId}:${flow.eventType}:${toRoleId}`;
}

function getBindingKind(system: SystemDefinition, roleId: string): StudioAuthoringRole["bindingKind"] {
  if (system.executionBinding[roleId]) {
    return "exec";
  }
  if (system.modelBinding[roleId]) {
    return "model";
  }
  return "noop";
}

export function importSystemToAuthoring(args: {
  workdir: string;
  systemPath: string;
  system: SystemDefinition;
}): StudioAuthoringDocument {
  const roles: Record<string, StudioAuthoringRole> = {};
  const layoutNodes: StudioAuthoringDocument["layout"]["nodes"] = {};
  args.system.roleIds.forEach((roleId, index) => {
    const bindingKind = getBindingKind(args.system, roleId);
    roles[roleId] = {
      roleId,
      bindingKind,
      modelRef: args.system.modelBinding[roleId],
      profileId: args.system.executionBinding[roleId],
      routingMode: args.system.graph?.routingModeByRoleId[roleId],
      routeOrder: args.system.graph?.routeOrderByRoleId?.[roleId],
      joinMode: args.system.graph?.joinModeByRoleId[roleId],
      joinMin: args.system.graph?.joinMinByRoleId[roleId],
      joinSources: args.system.graph?.joinSourcesByRoleId[roleId],
      loopMax: args.system.graph?.loopMaxByRoleId[roleId],
      review: args.system.graph?.reviewByRoleId?.[roleId],
      contextMap: args.system.graph?.contextMapByRoleId[roleId]
    };
    layoutNodes[roleId] = {
      x: 120 + (index % 4) * 260,
      y: 120 + Math.floor(index / 4) * 160
    };
  });

  const flows: Record<string, StudioAuthoringFlow> = {};
  args.system.flows.forEach((flow, index) => {
    const id = flowId(flow, index);
    flows[id] = {
      flowId: id,
      fromRoleId: flow.fromRoleId,
      toRoleId: flow.toRoleId,
      eventType: flow.eventType,
      runtimeOnlyErrorFlow: isRuntimeOnlyErrorEvent(flow.eventType)
    };
  });

  return {
    version: 1,
    project: {
      workdir: args.workdir,
      systemPath: args.systemPath
    },
    system: {
      systemId: args.system.systemId,
      systemVersion: args.system.systemVersion,
      entryRoleId: args.system.entryRoleId,
      lawGlobalRef: args.system.lawBinding.globalLawRef,
      handoffMode: args.system.graph?.handoffMode,
      handoffContracts: args.system.graph?.handoffContracts
    },
    roles,
    flows,
    layout: {
      nodes: layoutNodes
    }
  };
}

function buildBridgeRoles(authoring: StudioAuthoringDocument): StudioBridgeRole[] {
  const flows = Object.values(authoring.flows);
  return Object.values(authoring.roles)
    .sort((left, right) => left.roleId.localeCompare(right.roleId))
    .map((role) => {
      const incoming = flows.filter((flow) => flow.toRoleId === role.roleId);
      const outgoing = flows.filter((flow) => flow.fromRoleId === role.roleId);
      const badges = [
        authoring.system.entryRoleId === role.roleId ? "entry" : "",
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

function buildBridgeFlows(authoring: StudioAuthoringDocument): StudioBridgeFlow[] {
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
      flowKey: `${flow.fromRoleId}:${flow.eventType}:${flow.toRoleId === SYSTEM_END_ROLE_ID ? "output" : flow.toRoleId}`,
      participatesInJoin: Boolean(joinSourcesByTarget.get(flow.toRoleId)?.has(flow.fromRoleId))
    }));
}

function deterministicCanvasEdgeId(edge: StudioCanvasDocument["edges"][number], index: number): string {
  const target = edge.target === SYSTEM_END_ROLE_ID ? "output" : edge.target;
  return `${index + 1}:${edge.source}:${edge.eventType}:${target}`;
}

function normalizeCanvasEdgeId(args: {
  edge: StudioCanvasDocument["edges"][number];
  index: number;
  usedFlowIds: Set<string>;
}): string {
  const preferred = typeof args.edge.id === "string" ? args.edge.id.trim() : "";
  const base = preferred && !args.usedFlowIds.has(preferred)
    ? preferred
    : deterministicCanvasEdgeId(args.edge, args.index);
  let candidate = base;
  let suffix = 2;
  while (args.usedFlowIds.has(candidate)) {
    candidate = `${base}#${suffix}`;
    suffix += 1;
  }
  args.usedFlowIds.add(candidate);
  return candidate;
}

export function authoringToCanvasDocument(authoring: StudioAuthoringDocument): StudioCanvasDocument {
  const bridgeRoles = buildBridgeRoles(authoring);
  const bridgeFlows = buildBridgeFlows(authoring);
  return {
    version: 1,
    nodes: bridgeRoles.map((role, index) => {
      const layout = authoring.layout.nodes[role.roleId] ?? {
        x: 120 + (index % 4) * 260,
        y: 120 + Math.floor(index / 4) * 160
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
    edges: bridgeFlows.map((flow) => ({
      id: flow.flowId,
      source: flow.fromRoleId,
      target: flow.toRoleId,
      label: flow.eventType,
      eventType: flow.eventType,
      runtimeOnlyErrorFlow: Boolean(flow.runtimeOnlyErrorFlow),
      participatesInJoin: flow.participatesInJoin
    })),
    viewport: authoring.layout.viewport
  };
}

export function applyCanvasDocumentToAuthoring(args: {
  authoring: StudioAuthoringDocument;
  canvas: StudioCanvasDocument;
}): StudioAuthoringDocument {
  const nodes: StudioAuthoringDocument["layout"]["nodes"] = { ...args.authoring.layout.nodes };
  for (const node of args.canvas.nodes) {
    if (!args.authoring.roles[node.roleId]) {
      continue;
    }
    nodes[node.roleId] = {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height
    };
  }
  const flows: StudioAuthoringDocument["flows"] = {};
  const usedFlowIds = new Set<string>();
  for (const [index, edge] of args.canvas.edges.entries()) {
    const fromExists = Boolean(args.authoring.roles[edge.source]);
    const toExists = edge.target === SYSTEM_END_ROLE_ID || Boolean(args.authoring.roles[edge.target]);
    if (!fromExists || !toExists) {
      continue;
    }
    const flowId = normalizeCanvasEdgeId({ edge, index, usedFlowIds });
    const existing = typeof edge.id === "string" ? args.authoring.flows[edge.id] : undefined;
    flows[flowId] = {
      flowId,
      fromRoleId: edge.source,
      toRoleId: edge.target,
      eventType: edge.eventType,
      runtimeOnlyErrorFlow: existing?.runtimeOnlyErrorFlow ?? isRuntimeOnlyErrorEvent(edge.eventType)
    };
  }
  return {
    ...args.authoring,
    flows,
    layout: {
      nodes,
      viewport: args.canvas.viewport
    }
  };
}

export async function inspectStudioBridgeDraft(args: {
  workdir: string;
  systemPath?: string;
  systemSource?: string;
}): Promise<StudioBridgeDraft> {
  const systemPath = args.systemPath ?? resolve(args.workdir, "system.mmd");
  const systemSource = args.systemSource ?? (await readFile(systemPath, "utf8"));
  const validation = await validateProjectSystemSource({
    workdir: args.workdir,
    systemPath,
    systemSource
  });
  let authoring: StudioAuthoringDocument | null = null;
  try {
    authoring = importSystemToAuthoring({
      workdir: args.workdir,
      systemPath,
      system: parseSystemFromMermaidSource(systemSource)
    });
  } catch {
    authoring = null;
  }
  return {
    workdir: args.workdir,
    systemPath,
    systemSource,
    validation,
    authoring,
    extracted: authoring
      ? {
          systemId: authoring.system.systemId,
          systemVersion: authoring.system.systemVersion,
          entryRoleId: authoring.system.entryRoleId,
          lawGlobal: authoring.system.lawGlobalRef,
          roles: buildBridgeRoles(authoring),
          flows: buildBridgeFlows(authoring)
        }
      : null
  };
}

function serializeMetadataLine(key: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return `%% ${key}=${String(value)}`;
}

function escapeMermaidRoleId(roleId: string): string {
  return roleId.replace(/"/g, '\\"');
}

export function serializeAuthoringToMermaid(authoring: StudioAuthoringDocument): string {
  const roleIds = Object.keys(authoring.roles).sort(sortStrings);
  const metadata: string[] = [
    "flowchart TD",
    serializeMetadataLine("system.id", authoring.system.systemId),
    serializeMetadataLine("system.version", authoring.system.systemVersion),
    serializeMetadataLine("law.global", authoring.system.lawGlobalRef),
    serializeMetadataLine("entry.role", authoring.system.entryRoleId),
    serializeMetadataLine("handoff.mode", authoring.system.handoffMode),
    serializeMetadataLine("handoff.contracts", authoring.system.handoffContracts)
  ].filter((line): line is string => Boolean(line));

  for (const roleId of roleIds) {
    const role = authoring.roles[roleId];
    if (role.bindingKind === "model") {
      const line = serializeMetadataLine(`model.bind.${roleId}`, role.modelRef);
      if (line) metadata.push(line);
    } else if (role.bindingKind === "exec") {
      const line = serializeMetadataLine(`exec.bind.${roleId}`, role.profileId);
      if (line) metadata.push(line);
    }
  }
  for (const roleId of roleIds) {
    const role = authoring.roles[roleId];
    const lines = [
      serializeMetadataLine(`role.mode.${roleId}`, role.routingMode),
      serializeMetadataLine(`route.order.${roleId}`, role.routeOrder?.join(",")),
      serializeMetadataLine(`join.mode.${roleId}`, role.joinMode),
      serializeMetadataLine(`join.sources.${roleId}`, role.joinSources?.join(",")),
      serializeMetadataLine(`join.min.${roleId}`, role.joinMin),
      serializeMetadataLine(`loop.max.${roleId}`, role.loopMax),
      serializeMetadataLine(`review.mode.${roleId}`, role.review?.mode),
      serializeMetadataLine(`review.timeout.${roleId}`, role.review?.timeoutSeconds),
      serializeMetadataLine(`review.timeout.action.${roleId}`, role.review?.timeoutAction),
      serializeMetadataLine(`review.rework.target.${roleId}`, role.review?.reworkTargetRoleId),
      serializeMetadataLine(`review.rework.max.${roleId}`, role.review?.reworkMax),
      serializeMetadataLine(`review.terminate.scope.${roleId}`, role.review?.terminateScope)
    ].filter((line): line is string => Boolean(line));
    metadata.push(...lines);
    for (const [fieldName, selector] of Object.entries(role.contextMap ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
      const line = serializeMetadataLine(`context.map.${roleId}.${fieldName}`, selector);
      if (line) metadata.push(line);
    }
  }

  const nodeIdByRoleId = new Map<string, string>();
  roleIds.forEach((roleId, index) => {
    nodeIdByRoleId.set(roleId, `r${index + 1}`);
  });
  const flowLines = Object.values(authoring.flows)
    .sort((left, right) =>
      left.fromRoleId.localeCompare(right.fromRoleId) ||
      left.toRoleId.localeCompare(right.toRoleId) ||
      left.eventType.localeCompare(right.eventType) ||
      left.flowId.localeCompare(right.flowId)
    )
    .map((flow) => {
      const fromNode = nodeIdByRoleId.get(flow.fromRoleId) ?? flow.fromRoleId;
      const from = `${fromNode}[Role:${escapeMermaidRoleId(flow.fromRoleId)}]`;
      if (flow.toRoleId === SYSTEM_END_ROLE_ID) {
        return `${from} -->|${flow.eventType}| output`;
      }
      const toNode = nodeIdByRoleId.get(flow.toRoleId) ?? flow.toRoleId;
      return `${from} -->|${flow.eventType}| ${toNode}[Role:${escapeMermaidRoleId(flow.toRoleId)}]`;
    });

  return [...metadata, ...flowLines, ""].join("\n");
}

export function importMermaidToAuthoring(args: {
  workdir: string;
  systemPath: string;
  systemSource: string;
}): StudioAuthoringDocument {
  return importSystemToAuthoring({
    workdir: args.workdir,
    systemPath: args.systemPath,
    system: parseSystemFromMermaidSource(args.systemSource)
  });
}

function authoringDraftPath(workdir: string): string {
  return resolve(workdir, ".ogs", "studio", "system.authoring.json");
}

export async function loadStudioAuthoringDraft(workdir: string): Promise<{
  workdir: string;
  draftPath: string;
  authoring: unknown | null;
}> {
  const draftPath = authoringDraftPath(workdir);
  return {
    workdir,
    draftPath,
    authoring: await readJsonFile(draftPath).catch(() => null)
  };
}

export async function saveStudioAuthoringDraft(args: {
  workdir: string;
  authoring: unknown;
}): Promise<{
  workdir: string;
  draftPath: string;
  authoring: unknown;
  generatedMermaid?: string;
  validation?: Awaited<ReturnType<typeof validateProjectSystemSource>>;
}> {
  const draftPath = authoringDraftPath(args.workdir);
  await mkdir(dirname(draftPath), { recursive: true });
  await writeJsonFileAtomic(draftPath, args.authoring);
  let generatedMermaid: string | undefined;
  let validation: Awaited<ReturnType<typeof validateProjectSystemSource>> | undefined;
  if (
    typeof args.authoring === "object" &&
    args.authoring !== null &&
    !Array.isArray(args.authoring) &&
    (args.authoring as { version?: unknown }).version === 1
  ) {
    generatedMermaid = serializeAuthoringToMermaid(args.authoring as StudioAuthoringDocument);
    validation = await validateProjectSystemSource({
      workdir: args.workdir,
      systemPath: resolve(args.workdir, "system.mmd"),
      systemSource: generatedMermaid
    });
  }
  return {
    workdir: args.workdir,
    draftPath,
    authoring: args.authoring,
    generatedMermaid,
    validation
  };
}
