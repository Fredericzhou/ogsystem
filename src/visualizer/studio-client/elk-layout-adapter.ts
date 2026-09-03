import ELK from "elkjs/lib/elk.bundled.js";

import type { GraphViewModel, GraphViewModelEdge, GraphViewModelNode } from "../studio-contracts.js";
import {
  buildProjection,
  type LayoutDiagnostic,
  type LayoutEdgeGeometry,
  type LayoutPoint,
  type LayoutProjection,
  type LayoutProjectionNode,
  type StudioLayoutMode
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
  edges: Array<{ id: string; sources: string[]; targets: string[] }>;
};

function configFor(mode: StudioLayoutMode): LayoutConfig {
  if (mode === "stacked") return { direction: "DOWN", padding: 64, nodeSpacing: 54, layerSpacing: 112 };
  if (mode === "compact") return { direction: "RIGHT", padding: 56, nodeSpacing: 28, layerSpacing: 72 };
  return { direction: "RIGHT", padding: 72, nodeSpacing: 42, layerSpacing: 92 };
}

function nodeOrder(nodes: readonly GraphViewModelNode[]): GraphViewModelNode[] {
  return nodes.slice().sort((left, right) => left.id.localeCompare(right.id));
}

function edgeOrder(edges: readonly GraphViewModelEdge[]): GraphViewModelEdge[] {
  return edges.slice().sort((left, right) =>
    `${left.source}:${left.target}:${left.eventType}:${left.id}`.localeCompare(
      `${right.source}:${right.target}:${right.eventType}:${right.id}`
    )
  );
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

function createElkGraph(
  viewModel: GraphViewModel,
  mode: StudioLayoutMode
): { graph: ElkGraph; diagnostics: LayoutDiagnostic[] } {
  const config = configFor(mode);
  const orderedNodes = nodeOrder(viewModel.nodes);
  const nodeById = new Map(orderedNodes.map((node) => [node.id, node]));
  const diagnostics: LayoutDiagnostic[] = [];
  const layoutEdges: ElkGraph["edges"] = [];
  for (const edge of edgeOrder(viewModel.edges)) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      diagnostics.push({ code: "MISSING_ENDPOINT", severity: "warning", message: `Layout edge ${edge.id} has a missing endpoint.`, edgeId: edge.id });
      continue;
    }
    layoutEdges.push({ id: `layout-${edge.id}`, sources: [edge.source], targets: [edge.target] });
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
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP"
      },
      children: orderedNodes.map((node) => ({
        id: node.id,
        width: node.layout.width,
        height: node.layout.height,
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
  const positioned = nodeOrder(viewModel.nodes).map((sourceNode) => {
    const node = outputNodes.get(sourceNode.id);
    return {
      id: sourceNode.id,
      x: Number.isFinite(node?.x) ? Number(node?.x) : sourceNode.layout.x,
      y: Number.isFinite(node?.y) ? Number(node?.y) : sourceNode.layout.y,
      width: Number.isFinite(node?.width) ? Number(node?.width) : sourceNode.layout.width,
      height: Number.isFinite(node?.height) ? Number(node?.height) : sourceNode.layout.height
    };
  });
  const shifted = shiftToPadding(positioned, configFor(mode).padding);
  const shiftX = shifted.length ? shifted[0].x - positioned[0].x : 0;
  const shiftY = shifted.length ? shifted[0].y - positioned[0].y : 0;
  const routePointsByEdgeId = new Map<string, LayoutPoint[]>();
  const geometryByEdgeId = new Map<string, LayoutEdgeGeometry>();
  for (const edge of (result.edges ?? []) as ElkEdgeResult[]) {
    const section = edge.sections?.[0];
    if (!section) continue;
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
      .filter((point): point is ElkPoint => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .map((point) => ({ x: point.x + shiftX, y: point.y + shiftY }));
    if (points.length >= 2) {
      const edgeId = edge.id.slice("layout-".length);
      const geometry = { points, sourcePoint: points[0], targetPoint: points[points.length - 1] };
      geometryByEdgeId.set(edgeId, geometry);
      if (points.length > 2) routePointsByEdgeId.set(edgeId, points.slice(1, -1));
    }
  }
  return buildProjection("elk", mode, shifted, viewModel, diagnostics, routePointsByEdgeId, geometryByEdgeId);
}
