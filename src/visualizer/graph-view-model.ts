/**
 * @fileoverview Canonical GraphViewModel factory shared by the edit-time X6 renderer and the
 * runtime read-only overlay. Layered into structure / layout / runtime / diagnostics so edit
 * and run consumers can opt in to the signals they need without duplicating projection logic.
 */
import { isRuntimeOnlyErrorEvent } from "../runtime/error-flow-utils.js";
import { SYSTEM_END_ROLE_ID } from "../runtime/types.js";
import type { GraphState, SystemDefinition } from "../runtime/types.js";
import type { SemanticIR, SemanticIRConditionAst } from "../runtime/semantic-ir.js";
import {
  buildGraphNodeStatus,
  countBranches,
  findLastErrorCode,
  findLastSelectedEvent,
  findLatestFailureForRole
} from "./graph-runtime-signals.js";
import { buildBridgeFlows, buildBridgeRoles, fallbackGridColumnCount } from "./studio-authoring-projection.js";
import { addTopologyFlowOrder, topologyComponentIds } from "./topology-order.js";
import {
  normalizeStudioGraphTargetRoleId,
  STUDIO_SYSTEM_END_ROLE_ID,
  type GraphViewModel,
  type GraphViewModelEdge,
  type GraphViewModelMode,
  type GraphViewModelNode,
  type GraphReadingState,
  type StudioAuthoringDocument,
  type StudioAuthoringRole,
  type StudioDiagnosticDto
} from "./studio-contracts.js";

type ValidationLike = {
  ok?: unknown;
  diagnostics?: unknown;
};

type DiagnosticRecord = Partial<StudioDiagnosticDto> & {
  code?: string;
  message?: string;
  severity?: string;
  roleId?: string;
  selector?: string;
  flowKey?: string;
};

function asDiagnostics(validation: ValidationLike | null | undefined): DiagnosticRecord[] {
  return Array.isArray(validation?.diagnostics)
    ? validation.diagnostics.filter((item): item is DiagnosticRecord => typeof item === "object" && item !== null)
    : [];
}

function findDiagnostic(
  diagnostics: DiagnosticRecord[],
  roleId: string,
  flowKeyValue?: string
): DiagnosticRecord | undefined {
  return diagnostics.find((diagnostic) =>
    diagnostic.roleId === roleId ||
    diagnostic.selector === roleId ||
    (flowKeyValue && diagnostic.flowKey === flowKeyValue)
  );
}

function findEdgeDiagnostic(
  diagnostics: DiagnosticRecord[],
  flowKeyValue: string
): DiagnosticRecord | undefined {
  return diagnostics.find((diagnostic) => diagnostic.flowKey === flowKeyValue);
}

const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 84;
const BOUNDARY_WIDTH = 170;
const BOUNDARY_HEIGHT = 70;

function fallbackLayout(index: number, nodeCount: number): { x: number; y: number; width: number; height: number } {
  const columns = fallbackGridColumnCount(nodeCount);
  return {
    x: 120 + (index % columns) * 260,
    y: 120 + Math.floor(index / columns) * 160,
    width: DEFAULT_NODE_WIDTH,
    height: DEFAULT_NODE_HEIGHT
  };
}

function toDiagnosticLayer(
  diagnostic: DiagnosticRecord | undefined
): GraphViewModelNode["diagnostic"] {
  if (!diagnostic) return undefined;
  const severity = diagnostic.severity === "error" ? "error" : "warning";
  return {
    severity,
    code: typeof diagnostic.code === "string" ? diagnostic.code : undefined,
    message: typeof diagnostic.message === "string" ? diagnostic.message : undefined
  };
}

function nodeStructure(role: StudioAuthoringRole, semanticIR?: SemanticIR): GraphViewModelNode["structure"] {
  const semanticSeat = semanticIR?.seats.find((seat) => seat.roleId === role.roleId);
  const loopScope = semanticIR?.loops.find((scope) => scope.members.includes(role.roleId));
  return {
    routingMode: role.routingMode,
    joinMode: role.joinMode,
    joinMin: role.joinMin,
    joinSources: role.joinSources?.slice(),
    loopMax: role.loopMax,
    review: role.review,
    contextFields: role.contextMap ? Object.keys(role.contextMap) : undefined,
    modes: semanticSeat ? Object.keys(semanticSeat.modes).sort() : undefined,
    loopScope: loopScope
      ? {
          loopId: loopScope.loopId,
          boundaryRoleId: loopScope.boundaryRoleId,
          maxRounds: loopScope.maxRounds,
          onExhausted: loopScope.onExhausted
        }
      : undefined
  };
}

function summarizeCondition(ast: SemanticIRConditionAst | undefined): string | undefined {
  if (!ast) return undefined;
  if (ast.op === "not") return "not(...)";
  if (ast.op === "all" || ast.op === "any") return `${ast.op}(...)`;
  return ast.op;
}

function deriveNodeRuntime(args: {
  system: SystemDefinition;
  state: GraphState;
  roleId: string;
}): GraphViewModelNode["runtime"] {
  const { system, state, roleId } = args;
  const branchRecords = state.branchRecords ?? {};
  const pendingReviewsById = state.pendingReviewsById ?? {};
  const activeBranchCount = countBranches(branchRecords, roleId, "active");
  const completedBranchCount = countBranches(branchRecords, roleId, "completed");
  const waitingReviewCount = countBranches(branchRecords, roleId, "waiting_review");
  const pendingReviewCount = Object.values(pendingReviewsById).filter(
    (review) => review.roleId === roleId && (review.status === "pending" || review.status === "paused")
  ).length;
  const lastErrorCode = findLastErrorCode({ state, roleId });
  const lastFailure = findLatestFailureForRole({ state, roleId });
  const expectedSources = system.graph?.joinSourcesByRoleId[roleId] ?? [];
  const persistedJoinScope = Object.values(state.joinScopes ?? {})
    .filter((scope) => scope.joinRoleId === roleId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  const readySources = Array.from(
    new Set(
      Object.values(branchRecords)
        .filter((branch) => branch.roleId === roleId && typeof branch.activatedByRoleId === "string")
        .map((branch) => branch.activatedByRoleId)
        .filter((value): value is string => typeof value === "string")
    )
  ).sort((left, right) => left.localeCompare(right));
  const resolvedExpectedSources = persistedJoinScope?.expectedSourceRoleIds ?? expectedSources;
  const resolvedReadySources = persistedJoinScope?.readySourceRoleIds ?? readySources;
  const missingSources = persistedJoinScope?.missingSourceRoleIds ?? resolvedExpectedSources.filter((sourceRoleId) => !resolvedReadySources.includes(sourceRoleId));
  const status = buildGraphNodeStatus({
    state,
    roleId,
    activeBranchCount,
    waitingReviewCount,
    completedBranchCount,
    lastErrorCode
  });
  return {
    status,
    activeBranchCount,
    completedBranchCount,
    waitingReviewCount,
    pendingReviewCount,
    loopIteration: state.loopIterations[roleId] ?? 0,
    lastErrorCode,
    lastSelectedEvent: findLastSelectedEvent({ state, roleId }),
    expectedSources: resolvedExpectedSources.slice(),
    readySources: resolvedReadySources,
    missingSources,
    joinWaitingSummary:
      resolvedExpectedSources.length > 0
        ? {
            expectedCount: resolvedExpectedSources.length,
            readyCount: resolvedReadySources.length,
            missingCount: missingSources.length
          }
        : null,
    lastFailure
  };
}

function deriveEdgeRuntime(args: {
  state: GraphState;
  fromRoleId: string;
  toRoleId: string;
  eventType: string;
}): GraphViewModelEdge["runtime"] {
  const branchRecords = args.state.branchRecords ?? {};
  const recentlyActivated = Object.values(branchRecords).some(
    (branch) =>
      branch.roleId === args.toRoleId &&
      branch.activatedByRoleId === args.fromRoleId &&
      branch.activatedByEvent === args.eventType
  );
  return { recentlyActivated };
}

export type BuildGraphViewModelArgs = {
  authoring: StudioAuthoringDocument | null | undefined;
  system?: SystemDefinition | null;
  state?: GraphState | null;
  semanticIR?: SemanticIR | null;
  validation?: ValidationLike | null;
  mode: GraphViewModelMode;
};

export function buildGraphViewModel(args: BuildGraphViewModelArgs): GraphViewModel {
  const { authoring, mode } = args;
  const diagnostics = asDiagnostics(args.validation);
  const runtimeReady = mode === "run" && Boolean(args.system && args.state);
  const editable = mode === "edit" && Boolean(authoring);

  const capabilities = {
    editable,
    canAddRole: editable,
    canAddEdge: editable,
    canDelete: editable
  };
  const validation = {
    ok: args.validation?.ok === true,
    diagnostics: diagnostics as GraphViewModel["validation"]["diagnostics"]
  };

  if (!authoring) {
    return {
      version: 1,
      mode,
      nodes: [],
      edges: [],
      viewport: undefined,
      capabilities,
      validation
    };
  }

  const bridgeRoles = buildBridgeRoles(authoring);
  const bridgeFlows = buildBridgeFlows(authoring);
  const entryRoleId = authoring.system.entryRoleId;

  const roleNodes: GraphViewModelNode[] = bridgeRoles.map((role, index) => {
    const layoutSource = authoring.layout.nodes[role.roleId];
    const fallback = fallbackLayout(index, bridgeRoles.length);
    const x = Number.isFinite(layoutSource?.x) ? Number(layoutSource!.x) : fallback.x;
    const y = Number.isFinite(layoutSource?.y) ? Number(layoutSource!.y) : fallback.y;
    const width = Number.isFinite(layoutSource?.width) ? Number(layoutSource!.width) : fallback.width;
    const height = Number.isFinite(layoutSource?.height) ? Number(layoutSource!.height) : fallback.height;
    const diagnostic = findDiagnostic(diagnostics, role.roleId);
    const runtime = runtimeReady
      ? deriveNodeRuntime({ system: args.system!, state: args.state!, roleId: role.roleId })
      : undefined;
    return {
      id: role.roleId,
      roleId: role.roleId,
      kind: "roleSeat",
      entityKind: "responsibility_seat",
      roleSeat: true,
      executionScope: "roleAggregate",
      label: role.title?.trim() || role.roleId,
      bindingKind: role.bindingKind,
      badges: role.badges.slice(),
      structure: nodeStructure(role, args.semanticIR ?? undefined),
      layout: { x, y, width, height },
      runtime,
      diagnostic: toDiagnosticLayer(diagnostic),
      editable: mode === "edit"
    };
  });

  const minX = roleNodes.length ? Math.min(...roleNodes.map((node) => node.layout.x)) : 120;
  const maxX = roleNodes.length
    ? Math.max(...roleNodes.map((node) => node.layout.x + node.layout.width))
    : 360;
  const baseY = roleNodes.length ? Math.min(...roleNodes.map((node) => node.layout.y)) : 120;
  const roleIds = new Set(roleNodes.map((node) => node.roleId));

  const inputBoundary: GraphViewModelNode = {
    id: "input",
    roleId: "input",
    kind: "boundary",
    entityKind: "boundary",
    roleSeat: false,
    executionScope: "boundary",
    label: "▶ Entry",
    bindingKind: "boundary",
    badges: ["START"],
    structure: {},
    layout: { x: minX - 260, y: baseY, width: BOUNDARY_WIDTH, height: BOUNDARY_HEIGHT },
    editable: false
  };
  const outputBoundary: GraphViewModelNode = {
    id: "output",
    roleId: STUDIO_SYSTEM_END_ROLE_ID,
    kind: "boundary",
    entityKind: "boundary",
    roleSeat: false,
    executionScope: "boundary",
    label: "■ End",
    bindingKind: "boundary",
    badges: ["END"],
    structure: {},
    layout: { x: maxX + 90, y: baseY, width: BOUNDARY_WIDTH, height: BOUNDARY_HEIGHT },
    editable: false
  };

  const nodes: GraphViewModelNode[] = [inputBoundary, ...roleNodes, outputBoundary];

  const edges: GraphViewModelEdge[] = [];
  if (entryRoleId && roleIds.has(entryRoleId)) {
    edges.push({
      id: "__boundary__:input:entry",
      source: "input",
      target: entryRoleId,
      label: authoring.system.entryEventType || "entry",
      eventType: authoring.system.entryEventType || "entry",
      runtimeOnlyErrorFlow: false,
      participatesInJoin: false,
      editable: false
    });
  }

  for (const flow of bridgeFlows) {
    const target = normalizeStudioGraphTargetRoleId(flow.toRoleId);
    const edgeKey = `${flow.fromRoleId}:${flow.eventType}:${target}`;
    const runtimeOnlyErrorFlow = Boolean(flow.runtimeOnlyErrorFlow ?? isRuntimeOnlyErrorEvent(flow.eventType));
    const diagnosticRecord = findEdgeDiagnostic(diagnostics, flow.flowKey);
    const diagnostic = runtimeOnlyErrorFlow && !diagnosticRecord
      ? { severity: "warning" as const }
      : toDiagnosticLayer(diagnosticRecord);
    const runtime = runtimeReady
      ? deriveEdgeRuntime({
          state: args.state!,
          fromRoleId: flow.fromRoleId,
          toRoleId: flow.toRoleId === STUDIO_SYSTEM_END_ROLE_ID || flow.toRoleId === SYSTEM_END_ROLE_ID
            ? flow.toRoleId
            : flow.toRoleId,
          eventType: flow.eventType
        })
      : undefined;
    edges.push({
      id: flow.flowId || edgeKey,
      source: flow.fromRoleId,
      target,
      label: flow.label?.trim() || flow.eventType,
      eventType: flow.eventType,
      runtimeOnlyErrorFlow,
      participatesInJoin: flow.participatesInJoin,
      ...(args.semanticIR
        ? (() => {
            const transition = args.semanticIR.transitions.find((candidate) => candidate.flowId === edgeKey);
            return transition
              ? {
                  conditionSummary: summarizeCondition(transition.condition),
                  priority: transition.priority,
                  channel: transition.channel
                }
              : {};
          })()
        : {}),
      runtime,
      diagnostic,
      editable: mode === "edit"
    });
  }

  const topologyComponentByNode = topologyComponentIds({ nodes, edges, entryRoleId: "input" });
  return {
    version: 1,
    mode,
    nodes: nodes.map((node) => ({
      ...node,
      topologyComponentId: topologyComponentByNode.get(node.id)
    })),
    edges: addTopologyFlowOrder({ nodes, edges, entryRoleId: entryRoleId ? "input" : undefined }),
    viewport: authoring.layout.viewport,
    capabilities,
    validation
  };
}

function reachableRoleIds(args: {
  roleId: string;
  edges: readonly GraphViewModelEdge[];
  direction: "upstream" | "downstream";
}): Set<string> {
  const related = new Set([args.roleId]);
  const pending = [args.roleId];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    for (const edge of args.edges) {
      const next = args.direction === "upstream"
        ? edge.target === current ? edge.source : undefined
        : edge.source === current ? edge.target : undefined;
      if (next && !related.has(next)) {
        related.add(next);
        pending.push(next);
      }
    }
  }
  return related;
}

/** Filters a reading projection without mutating semantic graph data or stored layout. */
export function projectGraphReadingViewModel(
  source: GraphViewModel,
  reading: GraphReadingState
): GraphViewModel {
  if (reading.mode === "all" && !reading.channel) return source;
  let edges = source.edges.slice();
  if (reading.channel) {
    edges = edges.filter((edge) => {
      const channel = edge.channel ?? (edge.runtimeOnlyErrorFlow ? "error" : "normal");
      return channel === reading.channel;
    });
  }
  if (reading.mode === "route" && reading.flowKey) {
    edges = edges.filter((edge) =>
      edge.id === reading.flowKey || `${edge.source}:${edge.eventType}:${edge.target}` === reading.flowKey
    );
  } else if ((reading.mode === "upstream" || reading.mode === "downstream") && reading.roleId) {
    const roles = new Set([reading.roleId]);
    const pending = [reading.roleId];
    while (pending.length) {
      const current = pending.pop();
      if (!current) continue;
      for (const edge of edges) {
        const next = reading.mode === "upstream"
          ? edge.target === current ? edge.source : undefined
          : edge.source === current ? edge.target : undefined;
        if (next && !roles.has(next)) {
          roles.add(next);
          pending.push(next);
        }
      }
    }
    edges = edges.filter((edge) => roles.has(edge.source) && roles.has(edge.target));
  }
  const edgeNodeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const nodes = reading.mode === "all" || !reading.roleId
    ? source.nodes.filter((node) => !reading.channel || edgeNodeIds.has(node.id))
    : source.nodes.filter((node) => node.id === "input" || node.id === "output" || edgeNodeIds.has(node.id) || node.id === reading.roleId);
  return { ...source, nodes, edges };
}
