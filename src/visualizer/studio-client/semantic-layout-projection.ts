import type { GraphViewModel, GraphViewModelEdge, GraphViewModelNode } from "../studio-contracts.js";

export type StudioLayoutMode = "flow" | "compact" | "stacked";
export type StudioLayoutAdapterId = "stored" | "dagre";
export type LayoutPoint = { x: number; y: number };
export type LayoutSide = "left" | "right" | "top" | "bottom";
export type LayoutRouteKind = "self" | "backward" | "vertical" | "forward";
export type LayoutRouter = {
  name: string;
  args: Record<string, unknown>;
};
export type LayoutConnector = {
  name: string;
  args: Record<string, unknown>;
};
export type LayoutTerminal = {
  cell: string;
  port?: string;
  side: LayoutSide;
  offset: number;
};
export type LayoutEdgeRouting = {
  kind: LayoutRouteKind;
  source: LayoutTerminal;
  target: LayoutTerminal;
  router: LayoutRouter;
  connector: LayoutConnector;
  routePoints: LayoutPoint[];
  lane: string;
};
export type LayoutProjectionNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type LayoutProjectionEdge = {
  id: string;
  source: string;
  target: string;
  routing: LayoutEdgeRouting;
  participatesInJoin: boolean;
  runtimeOnlyErrorFlow: boolean;
};
export type LayoutDiagnostic = {
  code:
    | "BACK_EDGE_PRESERVED"
    | "SELF_EDGE_PRESERVED"
    | "MULTI_EDGE_COLLAPSED_FOR_LAYOUT"
    | "MISSING_ENDPOINT"
    | "NODE_OVERLAP"
    | "LABEL_OVERFLOW"
    | "ROUTE_LOSS"
    | "UNSTABLE_ORDERING"
    | "UNSUPPORTED_CONSTRAINT";
  severity: "info" | "warning";
  message: string;
  nodeId?: string;
  relatedNodeId?: string;
  edgeId?: string;
};
export type LayoutProjection = {
  version: 1;
  adapter: StudioLayoutAdapterId;
  profile: StudioLayoutMode;
  nodes: LayoutProjectionNode[];
  edges: LayoutProjectionEdge[];
  diagnostics: LayoutDiagnostic[];
  layoutDigest: string;
};

const STUDIO_EDGE_CONNECTOR: LayoutConnector = {
  name: "rounded",
  args: { radius: 10 }
};
const STUDIO_EDGE_ORTH_ROUTER: LayoutRouter = {
  name: "orth",
  args: { padding: 18 }
};
const STUDIO_EDGE_BACKWARD_ROUTER: LayoutRouter = {
  name: "manhattan",
  args: {
    step: 18,
    padding: 30,
    startDirections: ["left"],
    endDirections: ["right"],
    excludeTerminals: ["source", "target"]
  }
};
const STUDIO_EDGE_VERTICAL_ROUTER: LayoutRouter = {
  name: "manhattan",
  args: {
    step: 18,
    padding: 26,
    excludeTerminals: ["source", "target"]
  }
};
const STUDIO_EDGE_FORWARD_ROUTER: LayoutRouter = {
  name: "manhattan",
  args: {
    step: 16,
    padding: 18,
    startDirections: ["right"],
    endDirections: ["left"],
    excludeTerminals: ["source", "target"]
  }
};

function edgeSortKey(edge: GraphViewModelEdge): string {
  return [edge.source, edge.target, edge.eventType, edge.id].join(":");
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function numberToken(value: number): number | string {
  if (Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  return String(value);
}

function estimateTextWidth(value: string): number {
  return Array.from(value).reduce((width, character) => {
    if (/\s/u.test(character)) return width + 3.6;
    if (/[\u2e80-\u9fff\uff00-\uffef]/u.test(character)) return width + 12;
    return width + 7.2;
  }, 0);
}

function projectedLabel(node: GraphViewModelNode): string {
  const semanticBadges = node.roleSeat
    ? [
        node.structure.modes?.length ? `mode:${node.structure.modes.join("/")}` : "",
        node.structure.loopScope ? `loop:${node.structure.loopScope.loopId}` : "",
        node.structure.review ? "review" : ""
      ].filter(Boolean)
    : [];
  const badges = [...semanticBadges, ...node.badges.filter((badge) => badge.trim())];
  return badges.length ? `${node.label}  [${badges.join(" ")}]` : node.label;
}

function hasRectangleOverlap(left: LayoutProjectionNode, right: LayoutProjectionNode): boolean {
  return left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height;
}

function qualityDiagnostics(
  adapter: StudioLayoutAdapterId,
  nodes: readonly LayoutProjectionNode[],
  viewModel: GraphViewModel
): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  const nodeById = new Map<string, LayoutProjectionNode>();
  const sourceNodeById = new Map<string, GraphViewModelNode>();
  for (const node of viewModel.nodes) sourceNodeById.set(node.id, node);

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (nodeById.has(node.id)) {
      diagnostics.push({
        code: "UNSTABLE_ORDERING",
        severity: "warning",
        message: `Layout contains duplicate node id ${node.id}; ordering cannot be stable.`,
        nodeId: node.id
      });
    } else {
      nodeById.set(node.id, node);
    }
    const sourceNode = sourceNodeById.get(node.id);
    if (sourceNode) {
      const availableWidth = node.width - 18;
      const availableHeight = node.height - 12;
      const labelWidth = estimateTextWidth(projectedLabel(sourceNode));
      const estimatedLines = availableWidth > 0 ? Math.ceil(labelWidth / availableWidth) : Number.POSITIVE_INFINITY;
      if (availableWidth <= 0 || availableHeight <= 0 || estimatedLines * 16 > availableHeight) {
        diagnostics.push({
          code: "LABEL_OVERFLOW",
          severity: "warning",
          message: `Label for node ${node.id} exceeds the projected text area and may be clipped.`,
          nodeId: node.id
        });
      }
    }
  }

  const orderedNodes = nodes.slice().sort((left, right) => compareStable(left.id, right.id));
  for (let leftIndex = 0; leftIndex < orderedNodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < orderedNodes.length; rightIndex += 1) {
      const left = orderedNodes[leftIndex];
      const right = orderedNodes[rightIndex];
      if (!hasRectangleOverlap(left, right)) continue;
      diagnostics.push({
        code: "NODE_OVERLAP",
        severity: "warning",
        message: `Projected nodes ${left.id} and ${right.id} overlap.`,
        nodeId: left.id,
        relatedNodeId: right.id
      });
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of viewModel.edges) {
    if (edgeIds.has(edge.id)) {
      diagnostics.push({
        code: "UNSTABLE_ORDERING",
        severity: "warning",
        message: `Layout contains duplicate edge id ${edge.id}; ordering cannot be stable.`,
        edgeId: edge.id
      });
    }
    edgeIds.add(edge.id);
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      diagnostics.push({
        code: "ROUTE_LOSS",
        severity: "warning",
        message: `Business edge ${edge.id} has no complete projected route.`,
        edgeId: edge.id
      });
    }
  }

  if (adapter === "dagre") {
    for (const node of viewModel.nodes) {
      if (node.structure.joinMode || node.structure.routingMode === "parallel_split") {
        diagnostics.push({
          code: "UNSUPPORTED_CONSTRAINT",
          severity: "info",
          message: `Dagre positions ${node.id} but does not enforce its semantic branch or Join ordering constraint.`,
          nodeId: node.id
        });
      }
    }
  }
  return diagnostics;
}

function clonePosition(node: GraphViewModelNode): LayoutProjectionNode {
  return {
    id: node.id,
    x: node.layout.x,
    y: node.layout.y,
    width: node.layout.width,
    height: node.layout.height
  };
}

function edgeCenter(node: LayoutProjectionNode | undefined): LayoutPoint {
  return node
    ? { x: node.x + node.width / 2, y: node.y + node.height / 2 }
    : { x: 0, y: 0 };
}

function resolveRoute(edge: GraphViewModelEdge, nodeById: ReadonlyMap<string, LayoutProjectionNode>): {
  kind: LayoutRouteKind;
  sourceSide: LayoutSide;
  targetSide: LayoutSide;
  verticalGap: number;
} {
  if (edge.source === edge.target) {
    return { kind: "self", sourceSide: "right", targetSide: "top", verticalGap: 0 };
  }
  const sourceCenter = edgeCenter(nodeById.get(edge.source));
  const targetCenter = edgeCenter(nodeById.get(edge.target));
  const horizontalGap = targetCenter.x - sourceCenter.x;
  const absoluteHorizontalGap = Math.abs(horizontalGap);
  const verticalGap = Math.abs(targetCenter.y - sourceCenter.y);
  if (absoluteHorizontalGap < 80 || verticalGap > absoluteHorizontalGap * 1.15) {
    const targetBelowSource = targetCenter.y >= sourceCenter.y;
    return {
      kind: "vertical",
      sourceSide: targetBelowSource ? "bottom" : "top",
      targetSide: targetBelowSource ? "top" : "bottom",
      verticalGap
    };
  }
  if (horizontalGap < -36) {
    return { kind: "backward", sourceSide: "left", targetSide: "right", verticalGap };
  }
  return { kind: "forward", sourceSide: "right", targetSide: "left", verticalGap };
}

function anchorOffset(index: number, count: number, nodeSpan: number): number {
  if (count <= 1) return 0;
  const availableHalfSpan = Math.max(16, nodeSpan / 2 - 18);
  const spacing = Math.min(18, Math.max(10, (availableHalfSpan * 2) / Math.max(count - 1, 1)));
  return Math.round((index - (count - 1) / 2) * spacing);
}

function endpointOrder(
  edge: GraphViewModelEdge,
  route: ReturnType<typeof resolveRoute>,
  terminal: "source" | "target",
  nodeById: ReadonlyMap<string, LayoutProjectionNode>
): number {
  const referenceNode = nodeById.get(terminal === "source" ? edge.target : edge.source);
  const center = edgeCenter(referenceNode);
  const side = terminal === "source" ? route.sourceSide : route.targetSide;
  return side === "top" || side === "bottom" ? center.x : center.y;
}

function terminal(cell: string, direction: "source" | "target", side: LayoutSide, offset: number): LayoutTerminal {
  return {
    cell,
    port: cell === "input" || cell === "output" ? undefined : direction === "source" && side === "right" ? "out" : direction === "target" && side === "left" ? "in" : undefined,
    side,
    offset
  };
}

function routePoints(
  edge: GraphViewModelEdge,
  route: ReturnType<typeof resolveRoute>,
  nodeById: ReadonlyMap<string, LayoutProjectionNode>
): LayoutPoint[] {
  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  const sourceCenter = edgeCenter(source);
  const targetCenter = edgeCenter(target);
  if (route.kind === "self" && source) {
    return [
      { x: source.x + source.width + 30, y: source.y - 24 },
      { x: source.x + source.width + 30, y: source.y + source.height / 2 }
    ];
  }
  if (route.kind === "backward") {
    const laneX = Math.min(sourceCenter.x, targetCenter.x) - 30;
    return [{ x: laneX, y: sourceCenter.y }, { x: laneX, y: targetCenter.y }];
  }
  return [];
}

function routerFor(
  edge: GraphViewModelEdge,
  route: ReturnType<typeof resolveRoute>,
  nodeById: ReadonlyMap<string, LayoutProjectionNode>
): LayoutRouter {
  if (route.kind === "vertical") {
    return {
      ...STUDIO_EDGE_VERTICAL_ROUTER,
      args: {
        ...STUDIO_EDGE_VERTICAL_ROUTER.args,
        startDirections: [route.sourceSide],
        endDirections: [route.targetSide]
      }
    };
  }
  if (edge.channel === "loop" || route.kind === "backward") return STUDIO_EDGE_BACKWARD_ROUTER;
  if (route.kind === "self") {
    return { name: "loop", args: { width: 56, height: 94, angle: 320 } };
  }
  const sourceCenter = edgeCenter(nodeById.get(edge.source));
  const targetCenter = edgeCenter(nodeById.get(edge.target));
  const horizontalGap = targetCenter.x - sourceCenter.x;
  const verticalGap = Math.abs(targetCenter.y - sourceCenter.y);
  const isTightForwardHop = horizontalGap > 0 && horizontalGap < 120;
  const isTallHop = verticalGap > 120;
  if (isTightForwardHop && isTallHop) return STUDIO_EDGE_ORTH_ROUTER;
  return {
    ...STUDIO_EDGE_FORWARD_ROUTER,
    args: { ...STUDIO_EDGE_FORWARD_ROUTER.args, padding: isTallHop ? 24 : 18 }
  };
}

function buildEdgeRouting(
  edges: readonly GraphViewModelEdge[],
  nodeById: ReadonlyMap<string, LayoutProjectionNode>
): Map<string, LayoutEdgeRouting> {
  const routes = new Map(edges.map((edge) => [edge.id, resolveRoute(edge, nodeById)]));
  const outgoing = new Map<string, GraphViewModelEdge[]>();
  const incoming = new Map<string, GraphViewModelEdge[]>();
  for (const edge of edges) {
    const route = routes.get(edge.id)!;
    const outgoingKey = `${edge.source}:${route.sourceSide}`;
    const incomingKey = `${edge.target}:${route.targetSide}`;
    outgoing.set(outgoingKey, [...(outgoing.get(outgoingKey) ?? []), edge]);
    incoming.set(incomingKey, [...(incoming.get(incomingKey) ?? []), edge]);
  }
  const sortEndpoints = (left: GraphViewModelEdge, right: GraphViewModelEdge, terminalName: "source" | "target") => {
    const leftRoute = routes.get(left.id)!;
    const rightRoute = routes.get(right.id)!;
    return endpointOrder(left, leftRoute, terminalName, nodeById) - endpointOrder(right, rightRoute, terminalName, nodeById) || edgeSortKey(left).localeCompare(edgeSortKey(right));
  };
  for (const list of outgoing.values()) list.sort((left, right) => sortEndpoints(left, right, "source"));
  for (const list of incoming.values()) list.sort((left, right) => sortEndpoints(left, right, "target"));

  const result = new Map<string, LayoutEdgeRouting>();
  for (const edge of edges) {
    const route = routes.get(edge.id)!;
    const sourceEdges = outgoing.get(`${edge.source}:${route.sourceSide}`) ?? [];
    const targetEdges = incoming.get(`${edge.target}:${route.targetSide}`) ?? [];
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const sourceSpan = route.sourceSide === "top" || route.sourceSide === "bottom" ? sourceNode?.width : sourceNode?.height;
    const targetSpan = route.targetSide === "top" || route.targetSide === "bottom" ? targetNode?.width : targetNode?.height;
    const sourceIndex = Math.max(0, sourceEdges.findIndex((candidate) => candidate.id === edge.id));
    const targetIndex = Math.max(0, targetEdges.findIndex((candidate) => candidate.id === edge.id));
    const sourceOffset = anchorOffset(sourceIndex, sourceEdges.length, sourceSpan ?? 0);
    const targetOffset = anchorOffset(targetIndex, targetEdges.length, targetSpan ?? 0);
    result.set(edge.id, {
      kind: route.kind,
      source: terminal(edge.source, "source", route.sourceSide, sourceOffset),
      target: terminal(edge.target, "target", route.targetSide, targetOffset),
      router: routerFor(edge, route, nodeById),
      connector: STUDIO_EDGE_CONNECTOR,
      routePoints: routePoints(edge, route, nodeById),
      lane: `${edge.channel ?? (edge.runtimeOnlyErrorFlow ? "error" : "normal")}:${route.kind}:${sourceOffset}:${targetOffset}`
    });
  }
  return result;
}

export function createStoredLayoutProjection(viewModel: GraphViewModel): LayoutProjection {
  const nodes = viewModel.nodes.map(clonePosition);
  return buildProjection("stored", "flow", nodes, viewModel);
}

export function buildProjection(
  adapter: StudioLayoutAdapterId,
  profile: StudioLayoutMode,
  nodes: LayoutProjectionNode[],
  viewModel: GraphViewModel,
  diagnostics: LayoutDiagnostic[] = []
): LayoutProjection {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sortedEdges = viewModel.edges.slice().sort((left, right) => edgeSortKey(left).localeCompare(edgeSortKey(right)));
  const completeRouting = buildEdgeRouting(sortedEdges, nodeById);
  const edges = sortedEdges.map((edge) => {
    const routing = completeRouting.get(edge.id)!;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      routing,
      participatesInJoin: edge.participatesInJoin,
      runtimeOnlyErrorFlow: edge.runtimeOnlyErrorFlow
    };
  });
  const projection = {
    version: 1 as const,
    adapter,
    profile,
    nodes: nodes.slice().sort((left, right) => left.id.localeCompare(right.id)),
    edges,
    diagnostics: [
      ...diagnostics,
      ...qualityDiagnostics(adapter, nodes, viewModel)
    ]
  };
  return {
    ...projection,
    layoutDigest: createLayoutDigest(projection)
  };
}

type LayoutDigestInput = Pick<LayoutProjection, "version" | "adapter" | "profile" | "nodes" | "edges" | "diagnostics">;

function digestPayload(projection: LayoutDigestInput): string {
  return JSON.stringify({
    version: projection.version,
    adapter: projection.adapter,
    profile: projection.profile,
    nodes: projection.nodes.slice().sort((left, right) => compareStable(left.id, right.id)).map((node) => [
      node.id,
      numberToken(node.x),
      numberToken(node.y),
      numberToken(node.width),
      numberToken(node.height)
    ]),
    edges: projection.edges.slice().sort((left, right) => compareStable(left.id, right.id)).map((edge) => [
      edge.id,
      edge.source,
      edge.target,
      edge.participatesInJoin,
      edge.runtimeOnlyErrorFlow,
      edge.routing.kind,
      [edge.routing.source.cell, edge.routing.source.port ?? "", edge.routing.source.side, numberToken(edge.routing.source.offset)],
      [edge.routing.target.cell, edge.routing.target.port ?? "", edge.routing.target.side, numberToken(edge.routing.target.offset)],
      edge.routing.router.name,
      edge.routing.router.args,
      edge.routing.connector.name,
      edge.routing.connector.args,
      edge.routing.routePoints.map((point) => [numberToken(point.x), numberToken(point.y)]),
      edge.routing.lane
    ]),
    diagnostics: projection.diagnostics.slice().sort((left, right) => compareStable(
      [left.code, left.nodeId ?? "", left.relatedNodeId ?? "", left.edgeId ?? "", left.severity, left.message].join("\u0000"),
      [right.code, right.nodeId ?? "", right.relatedNodeId ?? "", right.edgeId ?? "", right.severity, right.message].join("\u0000")
    )).map((diagnostic) => [
      diagnostic.code,
      diagnostic.severity,
      diagnostic.nodeId ?? "",
      diagnostic.relatedNodeId ?? "",
      diagnostic.edgeId ?? "",
      diagnostic.message
    ])
  });
}

export function createLayoutDigest(projection: LayoutDigestInput): string {
  const payload = digestPayload(projection);
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `layout-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function layoutDigest(projection: LayoutProjection): string {
  return createLayoutDigest(projection);
}

export function layoutProjectionNodeMap(projection: LayoutProjection): ReadonlyMap<string, LayoutProjectionNode> {
  return new Map(projection.nodes.map((node) => [node.id, node]));
}
