import type { GraphViewModel, GraphViewModelEdge, GraphViewModelNode } from "../studio-contracts.js";
import { formatStudioRuntimeNodeBadges } from "./studio-graph-runtime.js";

export type StudioLayoutMode = "flow" | "compact" | "stacked";
export type StudioLayoutAdapterId = "stored" | "elk";
export type LayoutPoint = { x: number; y: number };
export type LayoutEdgeGeometry = {
  points: LayoutPoint[];
  sourcePoint: LayoutPoint;
  targetPoint: LayoutPoint;
};
export type LayoutSide = "left" | "right" | "top" | "bottom";
export type LayoutPortDirection = "in" | "out";
export type LayoutPortSpec = {
  id: string;
  direction: LayoutPortDirection;
  side: LayoutSide;
  offset: number;
};
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
  bundleIds?: {
    source?: string;
    target?: string;
  };
};
export type LayoutBundleKind = "fan-out" | "fan-in";
export type LayoutEdgeBundle = {
  id: string;
  kind: LayoutBundleKind;
  nodeId: string;
  side: LayoutSide;
  routeKind: LayoutRouteKind;
  channel: string;
  edgeIds: string[];
  junction: LayoutPoint;
  trunk: LayoutPoint[];
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
    | "UNSUPPORTED_CONSTRAINT"
    | "EDGE_CROSSING"
    | "EDGE_NODE_COLLISION"
    | "LABEL_COLLISION"
    | "LANE_CONFLICT"
    | "EXCESSIVE_BENDS";
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
  bundles: LayoutEdgeBundle[];
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
const NODE_EDGE_CLEARANCE = 8;
const LOOP_ROUTE_CLEARANCE = 16;
const LOOP_ROUTE_BEND_PENALTY = 24;
const BUNDLE_TRUNK_LENGTH = 36;

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

export function formatStudioNodeLabel(node: GraphViewModelNode): string {
  const semanticBadges = node.roleSeat
    ? [
        node.structure.modes?.length ? `mode:${node.structure.modes.join("/")}` : "",
        node.structure.loopScope ? `loop:${node.structure.loopScope.loopId}` : "",
        node.structure.review ? "review" : ""
      ].filter(Boolean)
    : [];
  const topology = node.topologyComponentId ? [node.topologyComponentId] : [];
  const badges = [...semanticBadges, ...formatStudioRuntimeNodeBadges(node), ...topology];
  const label = badges.length ? `${node.label}  [${badges.join(" ")}]` : node.label;
  return node.roleSeat ? `Role / Agent: ${label}` : label;
}

function projectedLabel(node: GraphViewModelNode): string {
  return formatStudioNodeLabel(node);
}

export function layoutNodeSize(node: GraphViewModelNode): { width: number; height: number } {
  const minimumWidth = node.kind === "boundary" ? node.layout.width : Math.max(180, node.layout.width);
  const minimumHeight = Math.max(node.kind === "boundary" ? 70 : 84, node.layout.height);
  const labelWidth = estimateTextWidth(formatStudioNodeLabel(node));
  const width = Math.max(minimumWidth, Math.min(320, Math.ceil(labelWidth + 30)));
  const lineWidth = Math.max(width - 18, 1);
  const lineCount = Math.max(1, Math.ceil(labelWidth / lineWidth));
  const height = Math.max(minimumHeight, Math.min(156, 24 + lineCount * 16));
  return { width, height };
}

function hasRectangleOverlap(left: LayoutProjectionNode, right: LayoutProjectionNode): boolean {
  return left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height;
}

type LayoutRect = { x: number; y: number; width: number; height: number };

function segmentIntersectsRect(start: LayoutPoint, end: LayoutPoint, rect: LayoutRect): boolean {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  if (start.x >= left && start.x <= right && start.y >= top && start.y <= bottom) return true;
  if (end.x >= left && end.x <= right && end.y >= top && end.y <= bottom) return true;
  let tMin = 0;
  let tMax = 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  for (const [p, q] of [
    [-dx, start.x - left],
    [dx, right - start.x],
    [-dy, start.y - top],
    [dy, bottom - start.y]
  ]) {
    if (Math.abs(p) < 0.0001) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) tMin = Math.max(tMin, ratio);
    else tMax = Math.min(tMax, ratio);
    if (tMin > tMax) return false;
  }
  return true;
}

function orientation(a: LayoutPoint, b: LayoutPoint, c: LayoutPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a: LayoutPoint, b: LayoutPoint, c: LayoutPoint, d: LayoutPoint): boolean {
  const epsilon = 0.0001;
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  return ((first > epsilon && second < -epsilon) || (first < -epsilon && second > epsilon)) &&
    ((third > epsilon && fourth < -epsilon) || (third < -epsilon && fourth > epsilon));
}

function pathPoints(edge: LayoutProjectionEdge, nodeById: ReadonlyMap<string, LayoutProjectionNode>): LayoutPoint[] {
  const source = terminalPoint(edge.routing.source, nodeById.get(edge.source));
  const target = terminalPoint(edge.routing.target, nodeById.get(edge.target));
  return [source, ...edge.routing.routePoints, target]
    .filter((point): point is LayoutPoint => Boolean(point))
    .filter((point, index, points) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
}

function pathMidpoint(points: readonly LayoutPoint[]): LayoutPoint | undefined {
  if (points.length < 2) return undefined;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  if (total <= 0) return points[0];
  let traversed = 0;
  const target = total / 2;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (traversed + length >= target) {
      const ratio = length ? (target - traversed) / length : 0;
      return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
    }
    traversed += length;
  }
  return points.at(-1);
}

function labelRect(edge: LayoutProjectionEdge, points: readonly LayoutPoint[]): LayoutRect | undefined {
  const center = pathMidpoint(points);
  if (!center) return undefined;
  const width = Math.max(28, Math.min(190, estimateTextWidth(edge.id) + 18));
  return { x: center.x - width / 2, y: center.y - 10, width, height: 20 };
}

function sharesBundle(left: LayoutProjectionEdge, right: LayoutProjectionEdge): boolean {
  const leftIds = [left.routing.bundleIds?.source, left.routing.bundleIds?.target].filter(Boolean);
  const rightIds = new Set([right.routing.bundleIds?.source, right.routing.bundleIds?.target].filter(Boolean));
  return leftIds.some((id) => rightIds.has(id));
}

function nodeGeometryDiagnostics(
  nodes: readonly LayoutProjectionNode[],
  viewModel: GraphViewModel
): { diagnostics: LayoutDiagnostic[]; nodeById: Map<string, LayoutProjectionNode> } {
  const diagnostics: LayoutDiagnostic[] = [];
  const nodeById = new Map<string, LayoutProjectionNode>();
  const sourceNodeById = new Map(viewModel.nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
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
    if (!sourceNode) continue;
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
  return { diagnostics, nodeById };
}

function nodeOverlapDiagnostics(nodes: readonly LayoutProjectionNode[]): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
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
  return diagnostics;
}

function businessEdgeDiagnostics(
  viewModel: GraphViewModel,
  nodeById: ReadonlyMap<string, LayoutProjectionNode>
): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
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
  return diagnostics;
}

type RouteDiagnosticContext = {
  edges: LayoutProjectionEdge[];
  paths: Map<string, LayoutPoint[]>;
  labels: Map<string, LayoutRect>;
};

function routeDiagnosticContext(
  projectedEdges: readonly LayoutProjectionEdge[],
  nodeById: ReadonlyMap<string, LayoutProjectionNode>
): RouteDiagnosticContext {
  const edges = projectedEdges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target));
  const paths = new Map(edges.map((edge) => [edge.id, pathPoints(edge, nodeById)]));
  const labels = new Map<string, LayoutRect>();
  for (const edge of edges) {
    const rect = labelRect(edge, paths.get(edge.id) ?? []);
    if (rect) labels.set(edge.id, rect);
  }
  return { edges, paths, labels };
}

function routeShapeDiagnostics(
  nodes: readonly LayoutProjectionNode[],
  context: RouteDiagnosticContext
): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  for (const edge of context.edges) {
    const points = context.paths.get(edge.id) ?? [];
    for (const node of nodes) {
      if (node.id === edge.source || node.id === edge.target) continue;
      for (let index = 1; index < points.length; index += 1) {
        if (!segmentIntersectsRect(points[index - 1], points[index], node)) continue;
        diagnostics.push({
          code: "EDGE_NODE_COLLISION",
          severity: "warning",
          message: `Projected edge ${edge.id} crosses node ${node.id}.`,
          edgeId: edge.id,
          nodeId: node.id
        });
        break;
      }
    }
    if (points.length > 8) {
      diagnostics.push({
        code: "EXCESSIVE_BENDS",
        severity: "info",
        message: `Projected edge ${edge.id} has more than six bend points.`,
        edgeId: edge.id
      });
    }
  }
  return diagnostics;
}

function edgeCrossingDiagnostics(context: RouteDiagnosticContext): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  for (let leftIndex = 0; leftIndex < context.edges.length; leftIndex += 1) {
    const left = context.edges[leftIndex];
    const leftPath = context.paths.get(left.id) ?? [];
    for (let rightIndex = leftIndex + 1; rightIndex < context.edges.length; rightIndex += 1) {
      const right = context.edges[rightIndex];
      if (left.source === right.source || left.source === right.target || left.target === right.source || left.target === right.target) continue;
      if (sharesBundle(left, right)) continue;
      const rightPath = context.paths.get(right.id) ?? [];
      const crossed = leftPath.some((leftPoint, leftSegmentIndex) => {
        if (leftSegmentIndex === 0) return false;
        return rightPath.some((rightPoint, rightSegmentIndex) =>
          rightSegmentIndex > 0 && segmentsCross(leftPath[leftSegmentIndex - 1], leftPoint, rightPath[rightSegmentIndex - 1], rightPoint)
        );
      });
      if (crossed) {
        diagnostics.push({
          code: "EDGE_CROSSING",
          severity: "warning",
          message: `Projected edges ${left.id} and ${right.id} cross.`,
          edgeId: left.id,
          relatedNodeId: right.id
        });
      }
    }
  }
  return diagnostics;
}

function labelCollisionDiagnostics(
  nodes: readonly LayoutProjectionNode[],
  context: RouteDiagnosticContext
): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  for (const edge of context.edges) {
    const rect = context.labels.get(edge.id);
    if (!rect) continue;
    for (const node of nodes) {
      if (node.id === edge.source || node.id === edge.target || !hasRectangleOverlap(rect, node)) continue;
      diagnostics.push({
        code: "LABEL_COLLISION",
        severity: "warning",
        message: `Label for edge ${edge.id} overlaps node ${node.id}.`,
        edgeId: edge.id,
        nodeId: node.id
      });
    }
  }
  return diagnostics;
}

function laneDiagnostics(context: RouteDiagnosticContext): LayoutDiagnostic[] {
  const laneGroups = new Map<string, string[]>();
  for (const edge of context.edges) {
    const key = `${edge.source}:${edge.target}:${edge.routing.lane}`;
    laneGroups.set(key, [...(laneGroups.get(key) ?? []), edge.id]);
  }
  return [...laneGroups.entries()]
    .filter(([, edgeIds]) => edgeIds.length >= 2)
    .map(([key, edgeIds]) => ({
      code: "LANE_CONFLICT" as const,
      severity: "warning" as const,
      message: `Parallel edges share lane ${key}: ${edgeIds.join(", ")}.`,
      edgeId: edgeIds[0]
    }));
}

function semanticConstraintDiagnostics(adapter: StudioLayoutAdapterId, viewModel: GraphViewModel): LayoutDiagnostic[] {
  if (adapter !== "elk") return [];
  return viewModel.nodes
    .filter((node) => node.structure.joinMode || node.structure.routingMode === "parallel_split")
    .map((node) => ({
      code: "UNSUPPORTED_CONSTRAINT" as const,
      severity: "info" as const,
      message: `ELK positions ${node.id} but does not enforce its semantic branch or Join ordering constraint.`,
      nodeId: node.id
    }));
}

function qualityDiagnostics(
  adapter: StudioLayoutAdapterId,
  nodes: readonly LayoutProjectionNode[],
  viewModel: GraphViewModel,
  projectedEdges: readonly LayoutProjectionEdge[]
): LayoutDiagnostic[] {
  const nodeDiagnostics = nodeGeometryDiagnostics(nodes, viewModel);
  const routeContext = routeDiagnosticContext(projectedEdges, nodeDiagnostics.nodeById);
  return [
    ...nodeDiagnostics.diagnostics,
    ...nodeOverlapDiagnostics(nodes),
    ...businessEdgeDiagnostics(viewModel, nodeDiagnostics.nodeById),
    ...routeShapeDiagnostics(nodes, routeContext),
    ...edgeCrossingDiagnostics(routeContext),
    ...labelCollisionDiagnostics(nodes, routeContext),
    ...laneDiagnostics(routeContext),
    ...semanticConstraintDiagnostics(adapter, viewModel)
  ];
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
  const spacing = Math.min(24, Math.max(12, (availableHalfSpan * 2) / Math.max(count - 1, 1)));
  return Math.round((index - (count - 1) / 2) * spacing);
}

type RoutingDraft = {
  edge: GraphViewModelEdge;
  route: ReturnType<typeof resolveRoute>;
  source: LayoutTerminal;
  target: LayoutTerminal;
};

function edgeChannel(edge: GraphViewModelEdge): string {
  return edge.channel ?? (edge.runtimeOnlyErrorFlow ? "error" : "normal");
}

function endpointFamilyKey(draft: RoutingDraft, terminalName: "source" | "target"): string {
  const terminal = draft[terminalName];
  return `${terminalName}:${terminal.cell}:${terminal.side}:${draft.route.kind}:${edgeChannel(draft.edge)}`;
}

function parallelEdgeKey(draft: RoutingDraft, terminalName: "source" | "target"): string {
  const terminal = draft[terminalName];
  return `${endpointFamilyKey(draft, terminalName)}:${draft.edge.source}:${draft.edge.target}`;
}

function sharedEndpointOffset(
  draft: RoutingDraft,
  terminalName: "source" | "target",
  drafts: readonly RoutingDraft[],
  nodeById: ReadonlyMap<string, LayoutProjectionNode>
): number {
  const terminal = draft[terminalName];
  const endpointGroup = drafts
    .filter((candidate) => candidate[terminalName].cell === terminal.cell && candidate[terminalName].side === terminal.side)
    .sort((left, right) => edgeSortKey(left.edge).localeCompare(edgeSortKey(right.edge)));
  const familyKeys = [...new Set(endpointGroup.map((candidate) => endpointFamilyKey(candidate, terminalName)))].sort();
  const familyIndex = Math.max(0, familyKeys.indexOf(endpointFamilyKey(draft, terminalName)));
  const node = nodeById.get(terminal.cell);
  const nodeSpan = terminal.side === "top" || terminal.side === "bottom" ? node?.width : node?.height;
  const familyOffset = anchorOffset(familyIndex, familyKeys.length, nodeSpan ?? 0);

  // Fan-out and fan-in edges share a single directional stub. Multiple edges
  // with the same endpoints remain separated so their labels stay readable.
  const parallelGroup = endpointGroup.filter((candidate) => parallelEdgeKey(candidate, terminalName) === parallelEdgeKey(draft, terminalName));
  if (parallelGroup.length <= 1) return familyOffset;
  const parallelIndex = Math.max(0, parallelGroup.findIndex((candidate) => candidate.edge.id === draft.edge.id));
  return familyOffset + anchorOffset(parallelIndex, parallelGroup.length, Math.min(nodeSpan ?? 0, 84));
}

function portId(
  cell: string,
  direction: "source" | "target",
  side: LayoutSide,
  routeKind: LayoutRouteKind,
  channel: string
): string | undefined {
  if (cell === "input" || cell === "output") return undefined;
  const directionToken: LayoutPortDirection = direction === "source" ? "out" : "in";
  const channelToken = channel.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${directionToken}-${side}-${routeKind}-${channelToken}`;
}

function terminal(
  cell: string,
  direction: "source" | "target",
  side: LayoutSide,
  offset: number,
  routeKind: LayoutRouteKind = "forward",
  channel = "normal"
): LayoutTerminal {
  return {
    cell,
    port: portId(cell, direction, side, routeKind, channel),
    side,
    offset
  };
}

function terminalPoint(
  value: LayoutTerminal,
  node: LayoutProjectionNode | undefined
): LayoutPoint | undefined {
  if (!node) return undefined;
  if (value.side === "left") return { x: node.x, y: node.y + node.height / 2 + value.offset };
  if (value.side === "right") return { x: node.x + node.width, y: node.y + node.height / 2 + value.offset };
  if (value.side === "top") return { x: node.x + node.width / 2 + value.offset, y: node.y };
  return { x: node.x + node.width / 2 + value.offset, y: node.y + node.height };
}

function terminalClearancePoint(
  value: LayoutTerminal,
  node: LayoutProjectionNode | undefined
): LayoutPoint | undefined {
  const boundary = terminalPoint(value, node);
  return boundary ? outsidePoint(boundary, value.side, NODE_EDGE_CLEARANCE) : undefined;
}

function outsidePoint(point: LayoutPoint, side: LayoutSide, distance: number): LayoutPoint {
  if (side === "left") return { x: point.x - distance, y: point.y };
  if (side === "right") return { x: point.x + distance, y: point.y };
  if (side === "top") return { x: point.x, y: point.y - distance };
  return { x: point.x, y: point.y + distance };
}

function perpendicularPoint(point: LayoutPoint, side: LayoutSide, offset: number): LayoutPoint {
  if (side === "left" || side === "right") return { x: point.x, y: point.y + offset };
  return { x: point.x + offset, y: point.y };
}

function bundleBranchPoint(
  bundle: LayoutEdgeBundle,
  edgeId: string,
  nodeById: ReadonlyMap<string, LayoutProjectionNode>
): LayoutPoint {
  const index = Math.max(0, bundle.edgeIds.indexOf(edgeId));
  const node = nodeById.get(bundle.nodeId);
  const nodeSpan = bundle.side === "top" || bundle.side === "bottom" ? node?.width : node?.height;
  const offset = anchorOffset(index, bundle.edgeIds.length, nodeSpan ?? 0);
  return perpendicularPoint(bundle.junction, bundle.side, offset);
}

function orthogonalizeRoutePoints(points: LayoutPoint[]): void {
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    if (current.x === next.x || current.y === next.y) continue;
    // Keep the existing ELK/stored geometry and only add the missing elbow
    // introduced by attaching a bundle junction to an existing route.
    points.splice(index + 1, 0, { x: next.x, y: current.y });
    index += 1;
  }
}

function simplifyRoutePoints(points: LayoutPoint[]): void {
  for (let index = points.length - 1; index > 0; index -= 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous.x === current.x && previous.y === current.y) points.splice(index, 1);
  }
  for (let index = 1; index < points.length - 1;) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    if ((previous.x === current.x && current.x === next.x) || (previous.y === current.y && current.y === next.y)) {
      points.splice(index, 1);
      continue;
    }
    index += 1;
  }
}

function bundleId(kind: LayoutBundleKind, draft: RoutingDraft): string {
  const terminalValue = draft[kind === "fan-out" ? "source" : "target"];
  return ["__ogs-layout-bundle", kind, terminalValue.cell, terminalValue.side, draft.route.kind, edgeChannel(draft.edge)].join(":");
}

function createRoutingBundles(
  drafts: readonly RoutingDraft[],
  nodeById: ReadonlyMap<string, LayoutProjectionNode>
): {
  bundles: LayoutEdgeBundle[];
  bundleByEdgeId: Map<string, { source?: string; target?: string }>;
} {
  const bundles: LayoutEdgeBundle[] = [];
  const bundleByEdgeId = new Map<string, { source?: string; target?: string }>();
  for (const terminalName of ["source", "target"] as const) {
    const kind: LayoutBundleKind = terminalName === "source" ? "fan-out" : "fan-in";
    const groups = new Map<string, RoutingDraft[]>();
    for (const draft of drafts) {
      // Back edges and self edges own their lane geometry. Sharing their first
      // or last segment can turn a valid SCC route into a short self-loop.
      if (draft.route.kind === "self" || draft.route.kind === "backward") continue;
      const value = draft[terminalName];
      const key = `${value.cell}:${value.side}:${draft.route.kind}:${edgeChannel(draft.edge)}`;
      groups.set(key, [...(groups.get(key) ?? []), draft]);
    }
    for (const group of groups.values()) {
      const otherEndpointIds = new Set(group.map((draft) => terminalName === "source" ? draft.edge.target : draft.edge.source));
      if (group.length < 2 || otherEndpointIds.size < 2) continue;
      const first = group.slice().sort((left, right) => edgeSortKey(left.edge).localeCompare(edgeSortKey(right.edge)))[0];
      const value = first[terminalName];
      const boundary = terminalPoint(value, nodeById.get(value.cell));
      if (!boundary) continue;
      const clearancePoint = outsidePoint(boundary, value.side, NODE_EDGE_CLEARANCE);
      const junction = outsidePoint(boundary, value.side, BUNDLE_TRUNK_LENGTH);
      const bundle: LayoutEdgeBundle = {
        id: bundleId(kind, first),
        kind,
        nodeId: value.cell,
        side: value.side,
        routeKind: first.route.kind,
        channel: edgeChannel(first.edge),
        edgeIds: group.map((draft) => draft.edge.id).sort(compareStable),
        junction,
        trunk: terminalName === "source" ? [clearancePoint, junction] : [junction, clearancePoint]
      };
      bundles.push(bundle);
      for (const draft of group) {
        const existing = bundleByEdgeId.get(draft.edge.id) ?? {};
        existing[terminalName] = bundle.id;
        bundleByEdgeId.set(draft.edge.id, existing);
      }
    }
  }
  return {
    bundles: bundles.sort((left, right) => compareStable(left.id, right.id)),
    bundleByEdgeId
  };
}

function terminalFromPoint(
  cell: string,
  direction: "source" | "target",
  point: LayoutPoint | undefined,
  node: LayoutProjectionNode | undefined,
  fallback: LayoutTerminal,
  routeKind: LayoutRouteKind,
  channel: string
): LayoutTerminal {
  if (!point || !node) return fallback;
  const candidates: Array<{ side: LayoutSide; distance: number; offset: number }> = [
    { side: "left", distance: Math.abs(point.x - node.x), offset: point.y - (node.y + node.height / 2) },
    { side: "right", distance: Math.abs(point.x - (node.x + node.width)), offset: point.y - (node.y + node.height / 2) },
    { side: "top", distance: Math.abs(point.y - node.y), offset: point.x - (node.x + node.width / 2) },
    { side: "bottom", distance: Math.abs(point.y - (node.y + node.height)), offset: point.x - (node.x + node.width / 2) }
  ];
  candidates.sort((left, right) => left.distance - right.distance);
  const selected = candidates[0];
  return terminal(cell, direction, selected.side, Math.round(selected.offset), routeKind, channel);
}

function alignRouteEndpoint(
  points: LayoutPoint[],
  terminalValue: LayoutTerminal,
  node: LayoutProjectionNode | undefined,
  endpoint: "source" | "target"
): void {
  if (!points.length || !node) return;
  const point = points[endpoint === "source" ? 0 : points.length - 1];
  if (terminalValue.side === "top" || terminalValue.side === "bottom") {
    point.x = node.x + node.width / 2 + terminalValue.offset;
  } else {
    point.y = node.y + node.height / 2 + terminalValue.offset;
  }
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
    if (Math.abs(sourceCenter.y - targetCenter.y) < 1) {
      const detourY = sourceCenter.y - 36;
      return [
        { x: laneX, y: sourceCenter.y },
        { x: laneX, y: detourY },
        { x: target ? target.x + target.width : laneX, y: detourY }
      ];
    }
    return [{ x: laneX, y: sourceCenter.y }, { x: laneX, y: targetCenter.y }];
  }
  return [];
}

type RouteGraphState = {
  pointIndex: number;
  direction: "horizontal" | "vertical" | "start";
};

function expandedRouteObstacles(
  nodeById: ReadonlyMap<string, LayoutProjectionNode>,
  excludedNodeIds: ReadonlySet<string>
): LayoutRect[] {
  return [...nodeById.values()].filter((node) => !excludedNodeIds.has(node.id)).map((node) => ({
    x: node.x - LOOP_ROUTE_CLEARANCE,
    y: node.y - LOOP_ROUTE_CLEARANCE,
    width: node.width + LOOP_ROUTE_CLEARANCE * 2,
    height: node.height + LOOP_ROUTE_CLEARANCE * 2
  }));
}

function pointInsideRouteObstacle(point: LayoutPoint, obstacle: LayoutRect): boolean {
  return point.x > obstacle.x && point.x < obstacle.x + obstacle.width &&
    point.y > obstacle.y && point.y < obstacle.y + obstacle.height;
}

function routeSegmentBlocked(start: LayoutPoint, end: LayoutPoint, obstacles: readonly LayoutRect[]): boolean {
  if (start.x !== end.x && start.y !== end.y) return true;
  return obstacles.some((obstacle) => {
    if (start.y === end.y) {
      return start.y > obstacle.y && start.y < obstacle.y + obstacle.height &&
        Math.max(Math.min(start.x, end.x), obstacle.x) < Math.min(Math.max(start.x, end.x), obstacle.x + obstacle.width);
    }
    return start.x > obstacle.x && start.x < obstacle.x + obstacle.width &&
      Math.max(Math.min(start.y, end.y), obstacle.y) < Math.min(Math.max(start.y, end.y), obstacle.y + obstacle.height);
  });
}

function routeStateKey(state: RouteGraphState): string {
  return `${state.pointIndex}:${state.direction}`;
}

/** Finds an obstacle-aware orthogonal route for loop edges using deterministic visibility channels. */
function obstacleAwareLoopRoute(
  edge: GraphViewModelEdge,
  sourceTerminal: LayoutTerminal,
  targetTerminal: LayoutTerminal,
  nodeById: ReadonlyMap<string, LayoutProjectionNode>
): LayoutPoint[] {
  const source = terminalPoint(sourceTerminal, nodeById.get(edge.source));
  const target = terminalPoint(targetTerminal, nodeById.get(edge.target));
  if (!source || !target) return [];

  // Endpoint nodes are allowed to contain the implicit terminal-to-route
  // segment. Every other node remains an expanded obstacle with clearance.
  const excludedNodeIds = edge.source === edge.target
    ? new Set<string>()
    : new Set([edge.source, edge.target]);
  const obstacles = expandedRouteObstacles(nodeById, excludedNodeIds);
  const xs = new Set<number>([source.x, target.x]);
  const ys = new Set<number>([source.y, target.y]);
  for (const obstacle of obstacles) {
    xs.add(obstacle.x);
    xs.add(obstacle.x + obstacle.width);
    ys.add(obstacle.y);
    ys.add(obstacle.y + obstacle.height);
  }
  const xValues = [...xs].sort((left, right) => left - right);
  const yValues = [...ys].sort((left, right) => left - right);
  const sourceClearance = outsidePoint(source, sourceTerminal.side, LOOP_ROUTE_CLEARANCE);
  const targetClearance = outsidePoint(target, targetTerminal.side, LOOP_ROUTE_CLEARANCE);
  const endpointKeys = new Set([
    `${source.x}:${source.y}`,
    `${target.x}:${target.y}`,
    `${sourceClearance.x}:${sourceClearance.y}`,
    `${targetClearance.x}:${targetClearance.y}`
  ]);
  const points: LayoutPoint[] = [];
  for (const x of xValues) {
    for (const y of yValues) {
      const point = { x, y };
      if (!endpointKeys.has(`${x}:${y}`) && obstacles.some((obstacle) => pointInsideRouteObstacle(point, obstacle))) continue;
      points.push(point);
    }
  }
  const pointIndexByKey = new Map(points.map((point, index) => [`${point.x}:${point.y}`, index]));
  const sourceIndex = pointIndexByKey.get(`${source.x}:${source.y}`);
  const targetIndex = pointIndexByKey.get(`${target.x}:${target.y}`);
  if (sourceIndex === undefined || targetIndex === undefined) return [];

  const neighbors = new Map<number, Array<{ pointIndex: number; direction: "horizontal" | "vertical"; distance: number }>>();
  const connect = (leftIndex: number, rightIndex: number, allowBlocked = false): void => {
    const left = points[leftIndex];
    const right = points[rightIndex];
    if (!allowBlocked && routeSegmentBlocked(left, right, obstacles)) return;
    const direction = left.y === right.y ? "horizontal" : "vertical";
    const distance = Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
    neighbors.set(leftIndex, [...(neighbors.get(leftIndex) ?? []), { pointIndex: rightIndex, direction, distance }]);
    neighbors.set(rightIndex, [...(neighbors.get(rightIndex) ?? []), { pointIndex: leftIndex, direction, distance }]);
  };
  for (const x of xValues) {
    const column = points
      .map((point, index) => ({ point, index }))
      .filter(({ point }) => point.x === x)
      .sort((left, right) => left.point.y - right.point.y);
    for (let index = 1; index < column.length; index += 1) connect(column[index - 1].index, column[index].index);
  }
  for (const y of yValues) {
    const row = points
      .map((point, index) => ({ point, index }))
      .filter(({ point }) => point.y === y)
      .sort((left, right) => left.point.x - right.point.x);
    for (let index = 1; index < row.length; index += 1) connect(row[index - 1].index, row[index].index);
  }
  const sourceClearanceIndex = pointIndexByKey.get(`${sourceClearance.x}:${sourceClearance.y}`);
  const targetClearanceIndex = pointIndexByKey.get(`${targetClearance.x}:${targetClearance.y}`);
  if (sourceClearanceIndex !== undefined) connect(sourceIndex, sourceClearanceIndex, true);
  if (targetClearanceIndex !== undefined) connect(targetIndex, targetClearanceIndex, true);

  const startState: RouteGraphState = { pointIndex: sourceIndex, direction: "start" };
  const queue = [{ state: startState, cost: 0, order: 0 }];
  const distances = new Map<string, number>([[routeStateKey(startState), 0]]);
  const previous = new Map<string, string>();
  let sequence = 1;
  let finalState: RouteGraphState | undefined;
  while (queue.length) {
    queue.sort((left, right) => left.cost - right.cost || left.order - right.order);
    const current = queue.shift()!;
    const currentKey = routeStateKey(current.state);
    if (current.cost !== distances.get(currentKey)) continue;
    if (current.state.pointIndex === targetIndex) {
      finalState = current.state;
      break;
    }
    for (const neighbor of neighbors.get(current.state.pointIndex) ?? []) {
      const bend = current.state.direction !== "start" && current.state.direction !== neighbor.direction
        ? LOOP_ROUTE_BEND_PENALTY
        : 0;
      const nextState: RouteGraphState = { pointIndex: neighbor.pointIndex, direction: neighbor.direction };
      const nextKey = routeStateKey(nextState);
      const nextCost = current.cost + neighbor.distance + bend;
      if (nextCost >= (distances.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      distances.set(nextKey, nextCost);
      previous.set(nextKey, currentKey);
      queue.push({ state: nextState, cost: nextCost, order: sequence++ });
    }
  }
  if (!finalState) return [];

  const path: LayoutPoint[] = [];
  let cursor = routeStateKey(finalState);
  while (cursor) {
    const pointIndex = Number(cursor.split(":", 1)[0]);
    path.unshift(points[pointIndex]);
    const prior = previous.get(cursor);
    if (!prior) break;
    cursor = prior;
  }
  if (path.length < 2) return [];
  return path.slice(1, -1);
}

function requiresObstacleAwareRoute(edge: GraphViewModelEdge, route: ReturnType<typeof resolveRoute>): boolean {
  return route.kind === "self" || route.kind === "backward" || edgeChannel(edge) === "loop";
}

function projectedRoutePoints(
  edge: GraphViewModelEdge,
  route: ReturnType<typeof resolveRoute>,
  nodeById: ReadonlyMap<string, LayoutProjectionNode>,
  routePointsByEdgeId: ReadonlyMap<string, readonly LayoutPoint[]> | undefined
): LayoutPoint[] {
  return routePointsByEdgeId?.get(edge.id)?.map((point) => ({ ...point })) ?? routePoints(edge, route, nodeById);
}

function routerFor(
  edge: GraphViewModelEdge,
  route: ReturnType<typeof resolveRoute>,
  nodeById: ReadonlyMap<string, LayoutProjectionNode>,
  hasElkGeometry = false
): LayoutRouter {
  // ELK already returned the complete orthogonal path. Re-routing it in X6
  // can create short loops at terminals, especially for back edges in SCCs.
  if (hasElkGeometry) return { name: "normal", args: {} };
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
  nodeById: ReadonlyMap<string, LayoutProjectionNode>,
  routePointsByEdgeId?: ReadonlyMap<string, readonly LayoutPoint[]>,
  geometryByEdgeId?: ReadonlyMap<string, LayoutEdgeGeometry>
): { routing: Map<string, LayoutEdgeRouting>; bundles: LayoutEdgeBundle[] } {
  const routes = new Map(edges.map((edge) => [edge.id, resolveRoute(edge, nodeById)]));
  const drafts: RoutingDraft[] = [];
  for (const edge of edges) {
    const route = routes.get(edge.id)!;
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    drafts.push({
      edge,
      route,
      source: terminalFromPoint(
        edge.source,
        "source",
        geometryByEdgeId?.get(edge.id)?.sourcePoint,
        sourceNode,
        terminal(edge.source, "source", route.sourceSide, 0, route.kind, edgeChannel(edge)),
        route.kind,
        edgeChannel(edge)
      ),
      target: terminalFromPoint(
        edge.target,
        "target",
        geometryByEdgeId?.get(edge.id)?.targetPoint,
        targetNode,
        terminal(edge.target, "target", route.targetSide, 0, route.kind, edgeChannel(edge)),
        route.kind,
        edgeChannel(edge)
      )
    });
  }

  const effectiveDrafts = drafts.map((draft) => ({
    ...draft,
    source: { ...draft.source, offset: sharedEndpointOffset(draft, "source", drafts, nodeById) },
    target: { ...draft.target, offset: sharedEndpointOffset(draft, "target", drafts, nodeById) }
  }));
  const { bundles, bundleByEdgeId } = createRoutingBundles(effectiveDrafts, nodeById);
  const bundleById = new Map(bundles.map((bundle) => [bundle.id, bundle]));
  const result = new Map<string, LayoutEdgeRouting>();
  for (const draft of effectiveDrafts) {
    const { edge, route } = draft;
    const sourceTerminal = draft.source;
    const targetTerminal = draft.target;
    const sourceOffset = sourceTerminal.offset;
    const targetOffset = targetTerminal.offset;
    const routePoints = projectedRoutePoints(edge, route, nodeById, routePointsByEdgeId);
    alignRouteEndpoint(routePoints, sourceTerminal, nodeById.get(edge.source), "source");
    alignRouteEndpoint(routePoints, targetTerminal, nodeById.get(edge.target), "target");
    if (requiresObstacleAwareRoute(edge, route)) {
      const safeRoute = obstacleAwareLoopRoute(edge, sourceTerminal, targetTerminal, nodeById);
      if (safeRoute.length > 0) routePoints.splice(0, routePoints.length, ...safeRoute);
    }
    const edgeBundles = bundleByEdgeId.get(edge.id);
    if (edgeBundles?.source) {
      const bundle = bundleById.get(edgeBundles.source);
      if (bundle) {
        routePoints.unshift(bundle.junction);
        const branch = bundleBranchPoint(bundle, edge.id, nodeById);
        if (branch.x !== bundle.junction.x || branch.y !== bundle.junction.y) routePoints.splice(1, 0, branch);
      }
    }
    if (edgeBundles?.target) {
      const bundle = bundleById.get(edgeBundles.target);
      if (bundle) {
        const branch = bundleBranchPoint(bundle, edge.id, nodeById);
        if (branch.x !== bundle.junction.x || branch.y !== bundle.junction.y) routePoints.push(branch);
        routePoints.push(bundle.junction);
      }
    }
    const hasBundle = Boolean(edgeBundles?.source || edgeBundles?.target);
    if (hasBundle) {
      // X6 terminals are implicit route endpoints. Add a clearance waypoint
      // when only one side is bundled so the final segment cannot become
      // diagonal between a junction and the other node.
      if (edgeBundles?.source && !edgeBundles.target) {
        const point = terminalClearancePoint(targetTerminal, nodeById.get(edge.target));
        if (point) routePoints.push(point);
      }
      if (edgeBundles?.target && !edgeBundles.source) {
        const point = terminalClearancePoint(sourceTerminal, nodeById.get(edge.source));
        if (point) routePoints.unshift(point);
      }
      orthogonalizeRoutePoints(routePoints);
    }
    simplifyRoutePoints(routePoints);
    const hasFixedRoute = routePoints.length > 0;
    result.set(edge.id, {
      kind: route.kind,
      source: sourceTerminal,
      target: targetTerminal,
      router: hasFixedRoute ? { name: "normal", args: {} } : routerFor(edge, route, nodeById, geometryByEdgeId?.has(edge.id)),
      connector: STUDIO_EDGE_CONNECTOR,
      routePoints,
      lane: `${edgeChannel(edge)}:${route.kind}:${sourceOffset}:${targetOffset}`,
      ...(edgeBundles ? { bundleIds: edgeBundles } : {})
    });
  }
  return { routing: result, bundles };
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
  diagnostics: LayoutDiagnostic[] = [],
  routePointsByEdgeId?: ReadonlyMap<string, readonly LayoutPoint[]>,
  geometryByEdgeId?: ReadonlyMap<string, LayoutEdgeGeometry>
): LayoutProjection {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sortedEdges = viewModel.edges.slice().sort((left, right) => edgeSortKey(left).localeCompare(edgeSortKey(right)));
  const completeRouting = buildEdgeRouting(sortedEdges, nodeById, routePointsByEdgeId, geometryByEdgeId);
  const edges = sortedEdges.map((edge) => {
    const routing = completeRouting.routing.get(edge.id)!;
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
    bundles: completeRouting.bundles,
    diagnostics: [
      ...diagnostics,
      ...qualityDiagnostics(adapter, nodes, viewModel, edges)
    ]
  };
  return {
    ...projection,
    layoutDigest: createLayoutDigest(projection)
  };
}

type LayoutDigestInput = Pick<LayoutProjection, "version" | "adapter" | "profile" | "nodes" | "edges" | "bundles" | "diagnostics">;

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
      edge.routing.lane,
      edge.routing.bundleIds?.source ?? "",
      edge.routing.bundleIds?.target ?? ""
    ]),
    bundles: projection.bundles.slice().sort((left, right) => compareStable(left.id, right.id)).map((bundle) => [
      bundle.id,
      bundle.kind,
      bundle.nodeId,
      bundle.side,
      bundle.routeKind,
      bundle.channel,
      bundle.edgeIds.slice().sort(compareStable),
      [numberToken(bundle.junction.x), numberToken(bundle.junction.y)],
      bundle.trunk.map((point) => [numberToken(point.x), numberToken(point.y)])
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
