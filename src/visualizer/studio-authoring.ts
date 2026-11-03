import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { resolveProjectRoleRootDir } from "../runtime/bundled-repos.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { validateConditionAst } from "../runtime/condition-ast.js";
import { loadOgsSpecification } from "../runtime/ogs-spec-loader.js";
import { compileSemanticIR } from "../runtime/semantic-ir-compiler.js";
import type { SemanticIRConditionAst } from "../runtime/semantic-ir.js";
import { isRuntimeOnlyErrorEvent } from "../runtime/error-flow-utils.js";
import { readJsonFile, writeJsonFileAtomic } from "../runtime/json-file.js";
import { parseSystemFromMermaidSource } from "../runtime/parse-mermaid.js";
import { loadRuntimeConfig } from "../runtime/runtime-loader.js";
import { loadModelCatalog } from "../runtime/model-catalog.js";
import { loadModelSelection, validateModelSelection } from "../runtime/model-selection.js";
import { SYSTEM_END_ROLE_ID, SYSTEM_START_ROLE_ID } from "../runtime/types.js";
import type { Flow, ModelCatalog, ModelCatalogEntry, ModelSelectionConfig, SystemDefinition } from "../runtime/types.js";
import {
  createEmptySystemDesign,
  loadSystemDesign,
  saveSystemDesign,
  type SystemDesignDocument
} from "../design/index.js";
import type {
  StudioAuthoringDocument,
  StudioAuthoringFlow,
  StudioAuthoringRole,
  StudioGraphSnapshot
} from "./studio-contracts.js";
import { STUDIO_SYSTEM_START_ROLE_ID } from "./studio-contracts.js";
import {
  authoringToCanvasDocument,
  buildBridgeFlows,
  buildBridgeRoles,
  fallbackGridColumnCount
} from "./studio-authoring-projection.js";
export type {
  StudioAuthoringDocument,
  StudioAuthoringFlow,
  StudioAuthoringRole
};
export { authoringToCanvasDocument, buildBridgeFlows, buildBridgeRoles };

export function authoringToDesign(
  authoring: StudioAuthoringDocument,
  existing?: SystemDesignDocument | null
): SystemDesignDocument {
  const base = existing ?? createEmptySystemDesign({
    systemId: authoring.system.systemId,
    systemVersion: authoring.system.systemVersion,
    startDispatch: authoring.system.startDispatch,
    lawGlobalRef: authoring.system.lawGlobalRef
  });
  const design: SystemDesignDocument = {
    ...base,
    revision: existing ? existing.revision + 1 : base.revision,
    system: {
      ...base.system,
      systemId: authoring.system.systemId,
      systemVersion: authoring.system.systemVersion,
      startDispatch: authoring.system.startDispatch,
      endJoin: authoring.system.endJoin,
      lawGlobalRef: authoring.system.lawGlobalRef,
      ...(authoring.system.handoffMode === "strict" || authoring.system.handoffMode === "transition"
        ? { handoffMode: authoring.system.handoffMode }
        : {}),
      ...(authoring.system.handoffContracts ? { handoffContracts: authoring.system.handoffContracts } : {})
    },
    seats: {},
    transitions: [],
    bindings: {},
    presentation: {
      ...base.presentation,
      nodes: { ...authoring.layout.nodes },
      viewport: authoring.layout.viewport
    }
  };
  for (const [roleId, role] of Object.entries(authoring.roles)) {
    const binding = role.bindingKind === "exec" && role.profileId
      ? { kind: "exec" as const, profileId: role.profileId }
      : role.bindingKind === "model" && (role.modelRef || (role.backend && role.modelId))
        ? {
            kind: "model" as const,
            modelRef: role.modelRef ?? `${role.backend}/${role.modelId}`,
            ...(role.fallback ? { fallback: role.fallback } : {})
          }
        : { kind: "noop" as const };
    const seat = {
      seatId: roleId,
      ...(role.title ? { title: role.title } : {}),
      rolePackageRef: existing?.seats[roleId]?.rolePackageRef ?? roleId,
      binding,
      ...(role.routingMode ? { routingMode: role.routingMode } : {}),
      ...(role.routeOrder?.length ? { routeOrder: [...role.routeOrder] } : {}),
      ...(role.joinMode ? { join: { mode: role.joinMode, sources: [...(role.joinSources ?? [])], min: role.joinMin } } : {}),
      ...(role.loopMax ? { loop: { maxRounds: role.loopMax } } : {}),
      ...(role.review?.mode === "required" ? {
        review: {
          mode: "required" as const,
          timeoutSeconds: role.review.timeoutSeconds,
          timeoutAction: role.review.timeoutAction === "terminate" ? "terminate" as const : "pause" as const,
          reworkTargetSeatId: role.review.reworkTargetRoleId,
          reworkMax: role.review.reworkMax,
          terminateScope: role.review.terminateScope === "run" ? "run" as const : "branch" as const
        }
      } : {}),
      ...(role.contextMap ? { contextMap: { ...role.contextMap } } : {})
    };
    design.seats[roleId] = seat;
    design.bindings[roleId] = binding;
  }
  for (const flow of Object.values(authoring.flows)) {
    design.transitions.push({
      transitionId: flow.flowId,
      fromSeatId: flow.fromRoleId,
      toSeatId: flow.toRoleId,
      eventType: flow.eventType,
      ...(flow.label ? { label: flow.label } : {}),
      ...(flow.condition ? { condition: flow.condition } : {}),
      ...(flow.priority !== undefined ? { priority: flow.priority } : {}),
      channel: flow.runtimeOnlyErrorFlow || flow.eventType.startsWith("ERROR") ? "error" : undefined
    });
  }
  return design;
}

function sortStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

export type StudioBridgeRole = StudioAuthoringRole & {
  incomingFlowCount: number;
  outgoingFlowCount: number;
  allowedEvents: string[];
  badges: string[];
};

export type StudioBridgeFlow = StudioAuthoringFlow & {
  flowKey: string;
  participatesInJoin: boolean;
};

export type StudioSystemValidation = {
  ok?: unknown;
  diagnostics?: unknown;
  [key: string]: unknown;
};

type ValidateStudioSystemSource = (args: {
  workdir: string;
  systemPath: string;
  systemSource: string;
  modelCatalogModels?: ModelCatalogEntry[];
  modelCatalogGeneratedAt?: string;
}) => Promise<StudioSystemValidation>;

export type StudioBridgeDraft = {
  workdir: string;
  systemPath: string;
  systemSource: string;
  validation: StudioSystemValidation;
  authoring: StudioAuthoringDocument | null;
  authoringDraftStatus: "missing" | "saved" | "stale" | "invalid";
  canvas: StudioGraphSnapshot | null;
  modelCatalog: ModelCatalog | null;
  extracted: {
    systemId: string;
    systemVersion: string;
    lawGlobal: string;
    roles: StudioBridgeRole[];
    flows: StudioBridgeFlow[];
  } | null;
};

type StudioBridgeValidationDiagnostic = {
  source: "studio-bridge";
  severity: "error";
  message: string;
  detail?: string;
};

function normalizeOptionalDisplayLabel(value: unknown): string | undefined {
  const label = typeof value === "string" ? value.trim() : "";
  return label ? label.slice(0, 120) : undefined;
}

function flowId(flow: Flow, index: number): string {
  const fromRoleId = flow.fromRoleId === SYSTEM_START_ROLE_ID ? "start" : flow.fromRoleId;
  const toRoleId = flow.toRoleId === SYSTEM_END_ROLE_ID ? "end" : flow.toRoleId;
  return `${index + 1}:${fromRoleId}:${flow.eventType}:${toRoleId}`;
}

function flowKey(flow: Flow): string {
  const fromRoleId = flow.fromRoleId === SYSTEM_START_ROLE_ID ? "start" : flow.fromRoleId;
  const toRoleId = flow.toRoleId === SYSTEM_END_ROLE_ID ? "end" : flow.toRoleId;
  return `${fromRoleId}:${flow.eventType}:${toRoleId}`;
}

type RoleDisplayNames = ReadonlyMap<string, string>;

type SemanticAuthoringLoops = NonNullable<StudioAuthoringDocument["system"]["loops"]>;

type SemanticAuthoringConfig = {
  routes: Map<string, Pick<StudioAuthoringFlow, "condition" | "priority">>;
  loops?: SemanticAuthoringLoops;
};

function normalizeSemanticLoops(raw: unknown): SemanticAuthoringLoops | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const loops: SemanticAuthoringLoops = {};
  for (const [loopId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const loop = value as Record<string, unknown>;
    const members = Array.isArray(loop.members)
      ? loop.members.filter((member): member is string => typeof member === "string" && member.length > 0)
      : [];
    const maxRounds = loop.maxRounds ?? loop.max_rounds;
    loops[loopId] = {
      members,
      ...(Number.isInteger(maxRounds) ? { maxRounds } : {}),
      ...(loop.boundary !== undefined || loop.boundaryRoleId !== undefined
        ? { boundary: String(loop.boundary ?? loop.boundaryRoleId) }
        : {}),
      ...(loop.counter !== undefined || loop.counterField !== undefined
        ? { counter: String(loop.counter ?? loop.counterField) }
        : {}),
      ...(loop.maxRoleActivations !== undefined || loop.max_role_activations !== undefined || loop.maxRoleActivationsByRoleId !== undefined
        ? { maxRoleActivations: (loop.maxRoleActivations ?? loop.max_role_activations ?? loop.maxRoleActivationsByRoleId) as Record<string, number> }
        : {}),
      ...(loop.onExhausted !== undefined || loop.on_exhausted !== undefined
        ? { onExhausted: String(loop.onExhausted ?? loop.on_exhausted) }
        : {})
    } as SemanticAuthoringLoops[string];
  }
  return loops;
}

async function loadSemanticConfig(workdir: string): Promise<SemanticAuthoringConfig> {
  const routes = new Map<string, Pick<StudioAuthoringFlow, "condition" | "priority">>();
  for (const name of ["semantics.yaml", "semantics.yml", "semantics.json"]) {
    const path = resolve(workdir, ".ogs", name);
    let source: string;
    try { source = await readFile(path, "utf8"); } catch { continue; }
    const value = name.endsWith(".json") ? JSON.parse(source) : parseYaml(source);
    const root = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const raw = root.routes ?? root.transitions;
    const entries = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw as Record<string, unknown>) : [];
    for (const item of entries) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const route = item as Record<string, unknown>;
      if (route.when === undefined) continue;
      const from = String(route.from ?? route.fromRoleId ?? "");
      const event = String(route.event ?? route.eventType ?? "");
      const to = String(route.to ?? route.toRoleId ?? "");
      if (from && event && to) routes.set(`${from}:${event}:${to}`, {
        condition: route.when as SemanticIRConditionAst,
        priority: Number(route.priority ?? 0)
      });
    }
    return { routes, loops: normalizeSemanticLoops(root.loops) };
  }
  return { routes };
}

export async function loadStudioSemanticConfig(workdir: string): Promise<{
  routes: Map<string, Pick<StudioAuthoringFlow, "condition" | "priority">>;
  loops?: SemanticAuthoringLoops;
}> {
  return loadSemanticConfig(workdir);
}

function normalizedRoleDisplayName(value: unknown): string | undefined {
  const name = typeof value === "string" ? value.trim() : "";
  return name ? name.slice(0, 120) : undefined;
}

async function loadRoleDisplayNames(args: {
  workdir: string;
  system: SystemDefinition;
}): Promise<RoleDisplayNames> {
  const names = new Map<string, string>();
  const runtimeConfig = await loadRuntimeConfig(undefined, args.workdir).catch(() => undefined);
  const roleRootDir = resolveProjectRoleRootDir(args.workdir, runtimeConfig?.roleRepo ?? "./og-roles");
  await Promise.all(args.system.roleIds.map(async (roleId) => {
    const manifest = await readJsonFile(resolve(roleRootDir, roleId, "role.json")).catch(() => undefined);
    const name = normalizedRoleDisplayName(
      manifest && typeof manifest === "object" && !Array.isArray(manifest)
        ? (manifest as Record<string, unknown>).name
        : undefined
    );
    if (name) {
      names.set(roleId, name);
    }
  }));
  return names;
}

export function importSystemToAuthoring(args: {
  workdir: string;
  systemPath: string;
  system: SystemDefinition;
  systemSource?: string;
  roleDisplayNames?: RoleDisplayNames;
  modelSelection?: ModelSelectionConfig;
  semanticRoutes?: Map<string, Pick<StudioAuthoringFlow, "condition" | "priority">>;
  semanticLoops?: SemanticAuthoringLoops;
}): StudioAuthoringDocument {
  const roles: Record<string, StudioAuthoringRole> = {};
  const layoutNodes: StudioAuthoringDocument["layout"]["nodes"] = {};
  args.system.roleIds.forEach((roleId, index) => {
    const selected = args.modelSelection?.roles?.[roleId] ?? args.modelSelection?.defaults;
    const bindingKind = args.system.executionBinding[roleId]
      ? "exec"
      : selected?.backend && selected.modelId ? "model" : "noop";
    roles[roleId] = {
      roleId,
      ...(args.roleDisplayNames?.get(roleId) ? { title: args.roleDisplayNames.get(roleId) } : {}),
      bindingKind,
      backend: selected?.backend,
      modelId: selected?.modelId,
      modelSelectionSource: args.modelSelection?.roles?.[roleId] ? "role" : selected?.backend ? "default" : undefined,
      modelRef: selected?.backend && selected.modelId ? `${selected.backend}/${selected.modelId}` : undefined,
      fallback: args.modelSelection?.roles?.[roleId]?.fallback,
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
      x: 120 + (index % fallbackGridColumnCount(args.system.roleIds.length)) * 260,
      y: 120 + Math.floor(index / fallbackGridColumnCount(args.system.roleIds.length)) * 160
    };
  });

  const flows: Record<string, StudioAuthoringFlow> = {};
  [...args.system.startFlows, ...args.system.flows].forEach((flow, index) => {
    const id = flowId(flow, index);
    flows[id] = {
      flowId: id,
      fromRoleId: flow.fromRoleId,
      toRoleId: flow.toRoleId,
      eventType: flow.eventType,
      ...(args.semanticRoutes?.get(flowKey(flow)) ?? {}),
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
      startDispatch: args.system.startDispatch,
      endJoin: args.system.endJoin,
      lawGlobalRef: args.system.lawBinding.globalLawRef,
      handoffMode: args.system.graph?.handoffMode,
      handoffContracts: args.system.graph?.handoffContracts,
      ...(args.semanticLoops !== undefined ? { loops: args.semanticLoops } : {})
    },
    roles,
    flows,
    layout: {
      nodes: layoutNodes
    }
  };
}

function withStudioBridgeImportFailure(
  validation: StudioSystemValidation,
  error: unknown
): StudioSystemValidation {
  const message = "Failed to extract Studio Bridge graph from the Mermaid source.";
  const detail = error instanceof Error ? error.message : String(error);
  const diagnostics = Array.isArray(validation.diagnostics) ? validation.diagnostics.slice() : [];
  diagnostics.push({
    source: "studio-bridge",
    severity: "error",
    message,
    ...(detail ? { detail } : {})
  } satisfies StudioBridgeValidationDiagnostic);
  return {
    ...validation,
    ok: false,
    diagnostics
  };
}

function deterministicCanvasEdgeId(edge: StudioGraphSnapshot["edges"][number], index: number): string {
  const source = edge.source === SYSTEM_START_ROLE_ID ? "start" : edge.source;
  const target = edge.target === SYSTEM_END_ROLE_ID ? "end" : edge.target;
  return `${index + 1}:${source}:${edge.eventType}:${target}`;
}

function normalizeCanvasEdgeId(args: {
  edge: StudioGraphSnapshot["edges"][number];
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

export function applyCanvasDocumentToAuthoring(args: {
  authoring: StudioAuthoringDocument;
  canvas: StudioGraphSnapshot;
}): StudioAuthoringDocument {
  const nodes: StudioAuthoringDocument["layout"]["nodes"] = { ...args.authoring.layout.nodes };
  for (const node of args.canvas.nodes) {
    if (!args.authoring.roles[node.roleId] && node.roleId !== SYSTEM_START_ROLE_ID && node.roleId !== SYSTEM_END_ROLE_ID) {
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
    const fromIsStart = edge.source === SYSTEM_START_ROLE_ID;
    const fromExists = fromIsStart || Boolean(args.authoring.roles[edge.source]);
    const toExists = edge.target === SYSTEM_END_ROLE_ID || Boolean(args.authoring.roles[edge.target]);
    if (!fromExists || !toExists || edge.source === SYSTEM_END_ROLE_ID || edge.target === SYSTEM_START_ROLE_ID || (fromIsStart && edge.target === SYSTEM_END_ROLE_ID)) {
      continue;
    }
    const flowId = normalizeCanvasEdgeId({ edge, index, usedFlowIds });
    const existing = typeof edge.id === "string" ? args.authoring.flows[edge.id] : undefined;
    const displayLabel = normalizeOptionalDisplayLabel(edge.label);
    flows[flowId] = {
      flowId,
      fromRoleId: edge.source,
      toRoleId: edge.target,
      eventType: fromIsStart ? "START" : edge.eventType,
      ...(displayLabel && displayLabel !== edge.eventType ? { label: displayLabel } : {}),
      runtimeOnlyErrorFlow: existing?.runtimeOnlyErrorFlow ?? isRuntimeOnlyErrorEvent(edge.eventType),
      condition: Object.hasOwn(edge, "condition") ? edge.condition : existing?.condition,
      priority: edge.priority ?? existing?.priority
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
  validateSystemSource: ValidateStudioSystemSource;
}): Promise<StudioBridgeDraft> {
  const systemPath = args.systemPath
    ? (isAbsolute(args.systemPath) ? args.systemPath : resolve(args.workdir, args.systemPath))
    : resolve(args.workdir, "system.mmd");
  const systemSource = args.systemSource ?? (await readFile(systemPath, "utf8"));
  const validation = await args.validateSystemSource({
    workdir: args.workdir,
    systemPath,
    systemSource
  });
  let authoring: StudioAuthoringDocument | null = null;
  const [modelSelection, modelCatalog] = await Promise.all([
    loadModelSelection(resolve(args.workdir, ".ogs", "model-selection.json")),
    loadModelCatalog(resolve(args.workdir, ".ogs", "model-catalog.json"))
  ]);
  let bridgeValidation = validation;
  try {
    const system = parseSystemFromMermaidSource(systemSource);
    const roleDisplayNames = await loadRoleDisplayNames({ workdir: args.workdir, system });
    const semanticConfig = await loadSemanticConfig(args.workdir);
    authoring = importSystemToAuthoring({
      workdir: args.workdir,
      systemPath,
      system,
      systemSource,
      roleDisplayNames,
      modelSelection,
      semanticRoutes: semanticConfig.routes,
      semanticLoops: semanticConfig.loops
    });
    const roleIds = new Set(system.roleIds);
    const invalidFlows = system.flows.filter((flow) =>
      !roleIds.has(flow.fromRoleId) ||
      (flow.toRoleId !== SYSTEM_END_ROLE_ID && !roleIds.has(flow.toRoleId))
    );
    if (invalidFlows.length) {
      const diagnostics = Array.isArray(bridgeValidation.diagnostics) ? bridgeValidation.diagnostics.slice() : [];
      diagnostics.push({
        source: "studio-bridge",
        severity: "error",
        message: "Every flow must hand off from Start or an existing role to an existing role or End.",
        detail: invalidFlows.map((flow) => `${flow.fromRoleId} -> ${flow.toRoleId}`).join(", ")
      } satisfies StudioBridgeValidationDiagnostic);
      bridgeValidation = { ...bridgeValidation, ok: false, diagnostics };
    }
  } catch (error) {
    authoring = null;
    bridgeValidation = withStudioBridgeImportFailure(validation, error);
  }
  let authoringDraftStatus: StudioBridgeDraft["authoringDraftStatus"] = "missing";
  if (authoring) {
    try {
      const savedDraft = await loadStudioAuthoringDraft(args.workdir);
      if (savedDraft.authoring !== null) {
        if (
          typeof savedDraft.authoring !== "object" ||
          Array.isArray(savedDraft.authoring) ||
          (savedDraft.authoring as { version?: unknown }).version !== 1
        ) {
          authoringDraftStatus = "invalid";
        } else {
          const savedAuthoring = savedDraft.authoring as StudioAuthoringDocument;
          const savedSource = serializeAuthoringToMermaid(savedAuthoring);
          const currentSource = serializeAuthoringToMermaid(authoring);
          const savedValidation = await args.validateSystemSource({
            workdir: args.workdir,
            systemPath,
            systemSource: savedSource
          });
          if (savedValidation.ok !== true) {
            authoringDraftStatus = "invalid";
          } else if (savedSource !== currentSource) {
            authoringDraftStatus = "stale";
          } else {
            authoringDraftStatus = "saved";
            authoring = {
              ...savedAuthoring,
              system: {
                ...savedAuthoring.system,
                ...(savedAuthoring.system.loops === undefined && authoring.system.loops !== undefined
                  ? { loops: authoring.system.loops }
                  : {})
              }
            };
          }
        }
      }
    } catch {
      authoringDraftStatus = "invalid";
    }
  }
  return {
    workdir: args.workdir,
    systemPath,
    systemSource,
    validation: bridgeValidation,
    authoring,
    authoringDraftStatus,
    canvas: authoring ? authoringToCanvasDocument(authoring) : null,
    modelCatalog: modelCatalog ?? null,
    extracted: authoring
      ? {
          systemId: authoring.system.systemId,
          systemVersion: authoring.system.systemVersion,
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
    serializeMetadataLine("start.dispatch.mode", authoring.system.startDispatch.mode === "random_n" ? "random_n" : undefined),
    serializeMetadataLine("start.dispatch.count", authoring.system.startDispatch.mode === "random_n" ? authoring.system.startDispatch.count : undefined),
    serializeMetadataLine("end.join.mode", authoring.system.endJoin?.mode === "quorum_of" ? "quorum_of" : undefined),
    serializeMetadataLine("end.join.min", authoring.system.endJoin?.min),
    serializeMetadataLine("handoff.mode", authoring.system.handoffMode),
    serializeMetadataLine("handoff.contracts", authoring.system.handoffContracts)
  ].filter((line): line is string => Boolean(line));

  for (const roleId of roleIds) {
    const role = authoring.roles[roleId];
    if (role.bindingKind === "exec") {
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
      if (flow.fromRoleId === STUDIO_SYSTEM_START_ROLE_ID) {
        const toNode = nodeIdByRoleId.get(flow.toRoleId) ?? flow.toRoleId;
        return `start[开始] -->|START| ${toNode}[Role:${escapeMermaidRoleId(flow.toRoleId)}]`;
      }
      const fromNode = nodeIdByRoleId.get(flow.fromRoleId) ?? flow.fromRoleId;
      const from = `${fromNode}[Role:${escapeMermaidRoleId(flow.fromRoleId)}]`;
      if (flow.toRoleId === SYSTEM_END_ROLE_ID) {
        return `${from} -->|${flow.eventType}| end[结束]`;
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
  modelSelection?: ModelSelectionConfig;
  roleDisplayNames?: RoleDisplayNames;
  semanticLoops?: SemanticAuthoringLoops;
}): StudioAuthoringDocument {
  return importSystemToAuthoring({
    workdir: args.workdir,
    systemPath: args.systemPath,
    system: parseSystemFromMermaidSource(args.systemSource),
    systemSource: args.systemSource,
    modelSelection: args.modelSelection,
    roleDisplayNames: args.roleDisplayNames,
    semanticLoops: args.semanticLoops
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
  let authoring: unknown | null = null;
  try {
    authoring = await readJsonFile(draftPath);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      authoring = null;
    } else {
      throw error;
    }
  }
  return {
    workdir,
    draftPath,
    authoring
  };
}

export async function saveStudioAuthoringDraft(args: {
  workdir: string;
  authoring: unknown;
  validateSystemSource?: ValidateStudioSystemSource;
  persistCanonicalDesign?: boolean;
}): Promise<{
  workdir: string;
  draftPath: string;
  authoring: unknown;
  generatedMermaid?: string;
  validation?: StudioSystemValidation;
  design?: SystemDesignDocument;
}> {
  const draftPath = authoringDraftPath(args.workdir);
  let generatedMermaid: string | undefined;
  let validation: StudioSystemValidation | undefined;
  let nextSelection: ModelSelectionConfig | undefined;
  let semanticCandidate: { path: string; source: string; stateSchemaPath?: string; stateSchemaSource?: string } | undefined;
  let design: SystemDesignDocument | undefined;
  if (
    typeof args.authoring === "object" &&
    args.authoring !== null &&
    !Array.isArray(args.authoring) &&
    (args.authoring as { version?: unknown }).version === 1
  ) {
    generatedMermaid = serializeAuthoringToMermaid(args.authoring as StudioAuthoringDocument);
    const authoring = args.authoring as StudioAuthoringDocument;
    const conditionedFlows = Object.values(authoring.flows).filter((flow) => flow.condition !== undefined);
    for (const flow of Object.values(authoring.flows)) {
      if (flow.priority !== undefined && (!Number.isInteger(flow.priority) || flow.priority < 0)) {
        throw new Error(`[IR_INVALID_CONDITION] flow ${flow.flowId} priority must be a non-negative integer`);
      }
      if (flow.condition && validateConditionAst(flow.condition).length) {
        throw new Error(`[IR_INVALID_CONDITION] flow ${flow.flowId}: ${validateConditionAst(flow.condition).join("; ")}`);
      }
    }
    {
      const candidates = ["semantics.yaml", "semantics.yml", "semantics.json"];
      let semanticsPath: string | undefined;
      let semanticsValue: Record<string, unknown> | undefined;
      let creatingSemanticSpec = false;
      const system = parseSystemFromMermaidSource(generatedMermaid);
      for (const name of candidates) {
        const path = resolve(args.workdir, ".ogs", name);
        try {
          const source = await readFile(path, "utf8");
          const parsed = name.endsWith(".json") ? JSON.parse(source) : parseYaml(source);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${name} must contain an object`);
          semanticsPath = path;
          semanticsValue = parsed as Record<string, unknown>;
          break;
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
        }
      }
      const hasLoopConfiguration = authoring.system.loops !== undefined;
      if (!semanticsPath || !semanticsValue) {
        if (conditionedFlows.length || hasLoopConfiguration) {
          creatingSemanticSpec = true;
          semanticsPath = resolve(args.workdir, ".ogs", "semantics.yaml");
          semanticsValue = {
            version: 1,
            system: { systemId: system.systemId, systemVersion: system.systemVersion },
            state: { schema: ".ogs/contracts/state.json" }
          };
        }
      }
      if (semanticsPath && semanticsValue) {
        if (hasLoopConfiguration) {
          semanticsValue.loops = authoring.system.loops;
        }
      const topology = new Set(system.flows.map((flow) => `${flow.fromRoleId}:${flow.eventType}:${flow.toRoleId}`));
      const rawRoutes = semanticsValue.routes ?? semanticsValue.transitions;
      const existingRoutes = Array.isArray(rawRoutes) ? rawRoutes : rawRoutes && typeof rawRoutes === "object" ? Object.values(rawRoutes as Record<string, unknown>) : [];
      const retainedRoutes = existingRoutes.filter((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return true;
        const route = item as Record<string, unknown>;
        const from = String(route.from ?? route.fromRoleId ?? "");
        const event = String(route.event ?? route.eventType ?? "");
        const to = String(route.to ?? route.toRoleId ?? "");
        return !topology.has(`${from}:${event}:${to}`);
      });
      semanticsValue.routes = [
        ...retainedRoutes,
        ...conditionedFlows.map((flow) => ({
          from: flow.fromRoleId,
          event: flow.eventType,
          to: flow.toRoleId,
          when: flow.condition,
          priority: flow.priority ?? 0
        }))
      ];
      const nextSemanticSource = semanticsPath.endsWith(".json")
        ? `${JSON.stringify(semanticsValue, null, 2)}\n`
        : stringifyYaml(semanticsValue);
      const snapshot: Awaited<ReturnType<typeof loadOgsSpecification>> = creatingSemanticSpec
        ? { specVersion: "1", systemId: system.systemId, systemVersion: system.systemVersion, sources: {}, digest: "studio-candidate" }
        : await loadOgsSpecification(args.workdir);
      const semanticSourceEntry = Object.entries(snapshot.sources).find(([path]) => path.endsWith("/" + semanticsPath!.split(/[\\/]/).at(-1)));
      if (!semanticSourceEntry) {
        snapshot.sources[semanticsPath.replaceAll("\\", "/")] = { digest: "studio-candidate", value: parseYaml(nextSemanticSource) };
      } else {
        snapshot.sources[semanticSourceEntry[0]] = { digest: "studio-candidate", value: parseYaml(nextSemanticSource) };
      }
      const stateSchemaPath = resolve(args.workdir, ".ogs", "contracts", "state.json");
      let stateSchemaSource: string | undefined;
      if (creatingSemanticSpec) {
        try {
          const existingStateSource = await readFile(stateSchemaPath, "utf8");
          snapshot.sources[stateSchemaPath.replaceAll("\\", "/")] = {
            digest: "studio-candidate",
            value: JSON.parse(existingStateSource)
          };
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
        }
      }
      if (!Object.keys(snapshot.sources).some((path) => path.endsWith("/.ogs/contracts/state.json") || path.endsWith("/contracts/state.json"))) {
        stateSchemaSource = `${JSON.stringify({ version: "1", type: "object", properties: {} }, null, 2)}\n`;
        snapshot.sources[stateSchemaPath.replaceAll("\\", "/")] = { digest: "studio-candidate", value: JSON.parse(stateSchemaSource) };
      }
      compileSemanticIR({ system, specification: snapshot, maxTransitionsPerRun: 100 });
      semanticCandidate = { path: semanticsPath, source: nextSemanticSource, ...(stateSchemaSource ? { stateSchemaPath, stateSchemaSource } : {}) };
      }
    }
    const selectionPath = resolve(args.workdir, ".ogs", "model-selection.json");
    const currentSelection = await loadModelSelection(selectionPath);
    const roles: NonNullable<ModelSelectionConfig["roles"]> = {};
    for (const [roleId, role] of Object.entries((args.authoring as StudioAuthoringDocument).roles)) {
      if (role.bindingKind !== "model") continue;
      if (!role.backend || !role.modelId) {
        throw new Error(`Role "${roleId}" needs both backend and modelId before it can run as an Agent.`);
      }
      if (role.modelSelectionSource === "default") continue;
      roles[roleId] = {
        backend: role.backend,
        modelId: role.modelId,
        ...(role.fallback ? { fallback: role.fallback } : {})
      };
    }
    nextSelection = validateModelSelection({
      configVersion: "3",
      defaults: currentSelection?.defaults,
      roles
    }, selectionPath);
    if (args.validateSystemSource) {
      validation = await args.validateSystemSource({
        workdir: args.workdir,
        systemPath: resolve(args.workdir, "system.mmd"),
        systemSource: generatedMermaid
      });
    }
    if (args.persistCanonicalDesign === true) {
      design = authoringToDesign(authoring, await loadSystemDesign(args.workdir));
    }
  }
  await mkdir(dirname(draftPath), { recursive: true });
  if (semanticCandidate) {
    if (semanticCandidate.stateSchemaPath && semanticCandidate.stateSchemaSource) {
      await mkdir(dirname(semanticCandidate.stateSchemaPath), { recursive: true });
      await writeJsonFileAtomic(semanticCandidate.stateSchemaPath, JSON.parse(semanticCandidate.stateSchemaSource));
    }
    const tempPath = `${semanticCandidate.path}.studio-tmp`;
    await writeFile(tempPath, semanticCandidate.source, "utf8");
    await rename(tempPath, semanticCandidate.path);
  }
  if (nextSelection) {
    await writeJsonFileAtomic(resolve(args.workdir, ".ogs", "model-selection.json"), nextSelection);
  }
  if (design) {
    await saveSystemDesign(args.workdir, design);
  }
  await writeJsonFileAtomic(draftPath, args.authoring);
  return {
    workdir: args.workdir,
    draftPath,
    authoring: args.authoring,
    generatedMermaid,
    validation,
    design
  };
}
