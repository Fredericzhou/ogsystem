import ELK from "elkjs/lib/elk.bundled.js";

import type { GraphViewModel, GraphViewModelEdge, GraphViewModelNode } from "../studio-contracts.js";
import {
  buildProjection,
  type LayoutDiagnostic,
  type LayoutEdgeGeometry,
  type LayoutPoint,
  type LayoutProjection,
  type LayoutProjectionNode,
  type StudioLayoutMode,
  layoutNodeSize
} from "./semantic-layout-projection.js";

type LayoutConfig = {
  direction: "RIGHT" | "DOWN";
  padding: number;
  nodeSpacing: number;
  layerSpacing: number;
};

type ElkPoint = { x: number; y: number };

type ElkEdgeSection = {
  startPoint?: ElkPoint;
  bendPoints?: ElkPoint[];
  endPoint?: ElkPoint;
};

type ElkNodeResult = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

type ElkEdgeResult = {
  id: string;
  sections?: ElkEdgeSection[];
};

type ElkGraph = {
  id: string;
  layoutOptions: Record<string, string>;
  children: Array<{ id: string; width: number; height: number; layoutOptions?: Record<string, string> }>;
  edges: Array<{ id: string; sources: string[]; targets: string[]; layoutOptions?: Record<string, string> }>;
};

function configFor(mode: StudioLayoutMode): LayoutConfig {
  if (mode === "stacked") return { direction: "DOWN", padding: 80, nodeSpacing: 76, layerSpacing: 144 };
  if (mode === "compact") return { direction: "RIGHT", padding: 68, nodeSpacing: 46, layerSpacing: 96 };
  return { direction: "RIGHT", padding: 88, nodeSpacing: 64, layerSpacing: 128 };
}

function edgeChannelRank(edge: GraphViewModelEdge): number {
  const channel = edge.channel ?? (edge.runtimeOnlyErrorFlow ? "error" : "normal");
  if (channel === "normal") return 0;
  if (channel === "join") return 1;
  if (channel === "feedback") return 2;
  if (channel === "error") return 3;
  return 4;
}

function edgePriority(edge: GraphViewModelEdge): number {
  const channel = edge.channel ?? (edge.runtimeOnlyErrorFlow ? "error" : "normal");
  if (channel === "normal") return 5;
  if (channel === "join") return 4;
  if (channel === "feedback") return 2;
  if (channel === "error") return 1;
  return 0;
}

function semanticTargetRank(source: GraphViewModelNode | undefined, target: GraphViewModelNode | undefined, targetId: string): number {
  const routeIndex = source?.structure.routeOrder?.indexOf(targetId) ?? -1;
  if (routeIndex >= 0) return routeIndex;
  const joinIndex = target?.structure.joinSources?.indexOf(source?.id ?? "") ?? -1;
  if (joinIndex >= 0) return joinIndex;
  return Number.MAX_SAFE_INTEGER;
}

function edgeOrder(
  edges: readonly GraphViewModelEdge[],
  nodeById: ReadonlyMap<string, GraphViewModelNode>
): GraphViewModelEdge[] {
  return edges.slice().sort((left, right) =>
    edgeChannelRank(left) - edgeChannelRank(right) ||
    left.source.localeCompare(right.source) ||
    semanticTargetRank(nodeById.get(left.source), nodeById.get(left.target), left.target) -
      semanticTargetRank(nodeById.get(right.source), nodeById.get(right.target), right.target) ||
    left.target.localeCompare(right.target) ||
    left.eventType.localeCompare(right.eventType) ||
    left.id.localeCompare(right.id)
  );
}

function nodeOrder(viewModel: GraphViewModel): GraphViewModelNode[] {
  const nodeById = new Map(viewModel.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, GraphViewModelEdge[]>();
  for (const edge of edgeOrder(viewModel.edges, nodeById)) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id) || !nodeById.has(id)) return;
    visited.add(id);
    order.push(id);
    for (const edge of outgoing.get(id) ?? []) visit(edge.target);
  };
  visit("input");
  for (const node of viewModel.nodes.slice().sort((left, right) => left.id.localeCompare(right.id))) visit(node.id);
  const indexById = new Map(order.map((id, index) => [id, index]));
  return viewModel.nodes.slice().sort((left, right) => compareNodeOrder(indexById, left, right));
}

function boundaryRank(node: GraphViewModelNode): number {
  return node.id === "input" ? -2 : node.id === "output" ? 2 : 0;
}

function compareNodeOrder(indexById: ReadonlyMap<string, number>, left: GraphViewModelNode, right: GraphViewModelNode): number {
  return boundaryRank(left) - boundaryRank(right) ||
    (indexById.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (indexById.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
    left.id.localeCompare(right.id);
}

function shiftToPadding(
  positions: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  padding: number
): LayoutProjectionNode[] {
  if (!positions.length) return [];
  const minX = Math.min(...positions.map((entry) => entry.x));
  const minY = Math.min(...positions.map((entry) => entry.y));
  return positions.map((entry) => ({
    id: entry.id,
    x: entry.x + padding - minX,
    y: entry.y + padding - minY,
    width: entry.width,
    height: entry.height
  }));
}

function enforceExclusiveBoundaryLayers(
  positions: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  geometries: Map<string, LayoutEdgeGeometry>,
  edges: readonly GraphViewModelEdge[],
  mode: StudioLayoutMode
): void {
  const config = configFor(mode);
  const input = positions.find((node) => node.id === "input");
  const output = positions.find((node) => node.id === "output");
  const business = positions.filter((node) => node.id !== "input" && node.id !== "output");
  if (!input || !output || !business.length) return;
  const isVertical = config.direction === "DOWN";
  const axisStart = (node: typeof input): number => isVertical ? node.y : node.x;
  const axisEnd = (node: typeof input): number => isVertical ? node.y + node.height : node.x + node.width;
  const businessStart = Math.min(...business.map(axisStart));
  const businessEnd = Math.max(...business.map(axisEnd));
  const inputTarget = businessStart - config.layerSpacing - (isVertical ? input.height : input.width);
  const outputTarget = businessEnd + config.layerSpacing;
  const inputDelta = inputTarget - axisStart(input);
  const outputDelta = outputTarget - axisStart(output);
  if (Math.abs(inputDelta) > 0.5) {
    if (isVertical) input.y += inputDelta;
    else input.x += inputDelta;
  }
  if (Math.abs(outputDelta) > 0.5) {
    if (isVertical) output.y += outputDelta;
    else output.x += outputDelta;
  }
  const updateEndpoint = (point: LayoutPoint, node: typeof input): void => {
    if (isVertical) point.y = node.y + (point.y < node.y ? 0 : node.height);
    else point.x = node.x + (point.x < node.x ? 0 : node.width);
  };
  for (const edge of edges) {
    const geometry = geometries.get(edge.id);
    if (!geometry) continue;
    if (edge.source === "input") updateEndpoint(geometry.sourcePoint, input);
    if (edge.target === "output") updateEndpoint(geometry.targetPoint, output);
    geometry.points[0] = geometry.sourcePoint;
    geometry.points[geometry.points.length - 1] = geometry.targetPoint;
  }
}

function createElkGraph(
  viewModel: GraphViewModel,
  mode: StudioLayoutMode
): { graph: ElkGraph; diagnostics: LayoutDiagnostic[] } {
  const config = configFor(mode);
  const orderedNodes = nodeOrder(viewModel);
  const nodeById = new Map(orderedNodes.map((node) => [node.id, node]));
  const diagnostics: LayoutDiagnostic[] = [];
  const layoutEdges: ElkGraph["edges"] = [];
  for (const edge of edgeOrder(viewModel.edges, nodeById)) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      diagnostics.push({ code: "MISSING_ENDPOINT", severity: "warning", message: `Layout edge ${edge.id} has a missing endpoint.`, edgeId: edge.id });
      continue;
    }
    layoutEdges.push({
      id: `layout-${edge.id}`,
      sources: [edge.source],
      targets: [edge.target],
      layoutOptions: { "elk.priority": String(edgePriority(edge)) }
    });
  }
  return {
    graph: {
      id: "ogs-layout-root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": config.direction,
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.spacing.nodeNode": String(config.nodeSpacing),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(config.layerSpacing),
        "elk.padding": `[top=${config.padding},left=${config.padding},bottom=${config.padding},right=${config.padding}]`,
        "elk.layered.cycleBreaking.strategy": "GREEDY",
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
        "elk.layered.nodePlacement.favorStraightEdges": "true",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.spacing.edgeNodeBetweenLayers": "28",
        "elk.layered.spacing.edgeEdgeBetweenLayers": "20",
        "elk.layered.unnecessaryBendpoints": "false",
        "elk.layered.thoroughness": mode === "compact" ? "7" : "10",
        "elk.layered.priority.direction": "2",
        "elk.layered.priority.straightness": "2"
      },
      children: orderedNodes.map((node) => ({
        id: node.id,
        ...layoutNodeSize(node),
        ...(node.id === "input"
          ? { layoutOptions: { "elk.layered.layering.layerConstraint": "FIRST" } }
          : node.id === "output"
            ? { layoutOptions: { "elk.layered.layering.layerConstraint": "LAST" } }
            : {})
      })),
      edges: layoutEdges
    },
    diagnostics
  };
}

const elk = new ELK({ algorithms: ["layered"] });

export async function createElkLayoutProjection(viewModel: GraphViewModel, mode: StudioLayoutMode): Promise<LayoutProjection> {
  const { graph, diagnostics } = createElkGraph(viewModel, mode);
  const result = await elk.layout(graph);
  const outputNodes = new Map((result.children ?? []).map((node) => [node.id, node as ElkNodeResult]));
  const positioned = nodeOrder(viewModel).map((sourceNode) => {
    const sourceSize = layoutNodeSize(sourceNode);
    const node = outputNodes.get(sourceNode.id);
    return {
      id: sourceNode.id,
      x: Number.isFinite(node?.x) ? Number(node?.x) : sourceNode.layout.x,
      y: Number.isFinite(node?.y) ? Number(node?.y) : sourceNode.layout.y,
      width: Number.isFinite(node?.width) ? Number(node?.width) : sourceSize.width,
      height: Number.isFinite(node?.height) ? Number(node?.height) : sourceSize.height
    };
  });
  const routePointsByEdgeId = new Map<string, LayoutPoint[]>();
  const geometryByEdgeId = new Map<string, LayoutEdgeGeometry>();
  for (const edge of (result.edges ?? []) as ElkEdgeResult[]) {
    const section = edge.sections?.[0];
    if (!section) continue;
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
      .filter((point): point is ElkPoint => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .map((point) => ({ x: point.x, y: point.y }));
    if (points.length >= 2) {
      const edgeId = edge.id.slice("layout-".length);
      const geometry = { points, sourcePoint: points[0], targetPoint: points[points.length - 1] };
      geometryByEdgeId.set(edgeId, geometry);
      if (points.length > 2) routePointsByEdgeId.set(edgeId, points.slice(1, -1));
    }
  }
  enforceExclusiveBoundaryLayers(positioned, geometryByEdgeId, viewModel.edges, mode);
  const shifted = shiftToPadding(positioned, configFor(mode).padding);
  const shiftX = shifted.length ? shifted[0].x - positioned[0].x : 0;
  const shiftY = shifted.length ? shifted[0].y - positioned[0].y : 0;
  for (const geometry of geometryByEdgeId.values()) {
    geometry.points = geometry.points.map((point) => ({ x: point.x + shiftX, y: point.y + shiftY }));
    geometry.sourcePoint = geometry.points[0];
    geometry.targetPoint = geometry.points[geometry.points.length - 1];
  }
  for (const [edgeId, points] of routePointsByEdgeId) {
    routePointsByEdgeId.set(edgeId, points.map((point) => ({ x: point.x + shiftX, y: point.y + shiftY })));
  }
  return buildProjection("elk", mode, shifted, viewModel, diagnostics, routePointsByEdgeId, geometryByEdgeId);
}
