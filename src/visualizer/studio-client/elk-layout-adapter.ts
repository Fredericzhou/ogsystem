import ELK from "elkjs/lib/elk.bundled.js";

import type { GraphViewModel, GraphViewModelEdge, GraphViewModelNode } from "../studio-contracts.js";
import {
  buildProjection,
  type LayoutDiagnostic,
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

type ElkNodeResult = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

type ElkGraph = {
  id: string;
  layoutOptions: Record<string, string>;
  children: Array<{ id: string; width: number; height: number }>;
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

function pathExists(adjacency: ReadonlyMap<string, ReadonlySet<string>>, source: string, target: string): boolean {
  if (source === target) return true;
  const visited = new Set<string>();
  const pending = [source];
  while (pending.length) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === target) return true;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) pending.push(next);
  }
  return false;
}

function boundaryPositions(
  positions: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  nodes: ReadonlyMap<string, GraphViewModelNode>,
  orientation: "horizontal" | "vertical",
  gap: number
): Array<{ id: string; x: number; y: number; width: number; height: number }> {
  const next = positions.map((entry) => ({ ...entry }));
  const byId = new Map(next.map((entry) => [entry.id, entry]));
  const roleEntries = next.filter((entry) => nodes.get(entry.id)?.roleSeat === true);
  const input = byId.get("input");
  const output = byId.get("output");
  const placementEntries = roleEntries.length
    ? roleEntries
    : next.filter((entry) => entry.id !== "input" && entry.id !== "output");
  if (!placementEntries.length) {
    if (input && output) {
      if (orientation === "horizontal") {
        const left = Math.min(input.x, output.x);
        const centerY = (input.y + input.height / 2 + output.y + output.height / 2) / 2;
        input.x = left;
        input.y = centerY - input.height / 2;
        output.x = left + input.width + gap;
        output.y = centerY - output.height / 2;
      } else {
        const top = Math.min(input.y, output.y);
        const centerX = (input.x + input.width / 2 + output.x + output.width / 2) / 2;
        input.x = centerX - input.width / 2;
        input.y = top;
        output.x = centerX - output.width / 2;
        output.y = top + input.height + gap;
      }
    }
    return next;
  }
  const minLeft = Math.min(...placementEntries.map((entry) => entry.x));
  const maxRight = Math.max(...placementEntries.map((entry) => entry.x + entry.width));
  const minTop = Math.min(...placementEntries.map((entry) => entry.y));
  const maxBottom = Math.max(...placementEntries.map((entry) => entry.y + entry.height));
  const roleCenterX = (minLeft + maxRight) / 2;
  const roleCenterY = (minTop + maxBottom) / 2;
  if (orientation === "horizontal") {
    if (input) {
      input.x = minLeft - gap - input.width;
      input.y = roleCenterY - input.height / 2;
    }
    if (output) {
      output.x = maxRight + gap;
      output.y = roleCenterY - output.height / 2;
    }
  } else {
    if (input) {
      input.x = roleCenterX - input.width / 2;
      input.y = minTop - gap - input.height;
    }
    if (output) {
      output.x = roleCenterX - output.width / 2;
      output.y = maxBottom + gap;
    }
  }
  return next;
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
): { graph: ElkGraph; nodeById: Map<string, GraphViewModelNode>; diagnostics: LayoutDiagnostic[] } {
  const config = configFor(mode);
  const orderedNodes = nodeOrder(viewModel.nodes);
  const nodeById = new Map(orderedNodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, Set<string>>(orderedNodes.map((node) => [node.id, new Set()]));
  const diagnostics: LayoutDiagnostic[] = [];
  const layoutEdges: ElkGraph["edges"] = [];
  const pairKeys = new Set<string>();
  for (const edge of edgeOrder(viewModel.edges)) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      diagnostics.push({ code: "MISSING_ENDPOINT", severity: "warning", message: `Layout edge ${edge.id} has a missing endpoint.`, edgeId: edge.id });
      continue;
    }
    const pairKey = `${edge.source}\u0000${edge.target}`;
    if (edge.source === edge.target || pathExists(adjacency, edge.target, edge.source)) {
      diagnostics.push({
        code: edge.source === edge.target ? "SELF_EDGE_PRESERVED" : "BACK_EDGE_PRESERVED",
        severity: "info",
        message: `Business edge ${edge.id} remains in the projection; ELK receives only the acyclic layout subset.`,
        edgeId: edge.id
      });
      continue;
    }
    if (pairKeys.has(pairKey)) {
      diagnostics.push({ code: "MULTI_EDGE_COLLAPSED_FOR_LAYOUT", severity: "info", message: `Parallel business edge ${edge.id} shares an ELK topology edge; its route lane remains distinct.`, edgeId: edge.id });
      continue;
    }
    adjacency.get(edge.source)?.add(edge.target);
    pairKeys.add(pairKey);
    layoutEdges.push({ id: `layout-${edge.id}`, sources: [edge.source], targets: [edge.target] });
  }
  return {
    graph: {
      id: "ogs-layout-root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": config.direction,
        "elk.spacing.nodeNode": String(config.nodeSpacing),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(config.layerSpacing),
        "elk.padding": `[top=${config.padding},left=${config.padding},bottom=${config.padding},right=${config.padding}]`,
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP"
      },
      children: orderedNodes.map((node) => ({ id: node.id, width: node.layout.width, height: node.layout.height })),
      edges: layoutEdges
    },
    nodeById,
    diagnostics
  };
}

const elk = new ELK({ algorithms: ["layered"] });

export async function createElkLayoutProjection(viewModel: GraphViewModel, mode: StudioLayoutMode): Promise<LayoutProjection> {
  const { graph, nodeById, diagnostics } = createElkGraph(viewModel, mode);
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
  const bounded = boundaryPositions(positioned, nodeById, mode === "stacked" ? "vertical" : "horizontal", mode === "stacked" ? 96 : configFor(mode).layerSpacing);
  return buildProjection("elk", mode, shiftToPadding(bounded, configFor(mode).padding), viewModel, diagnostics);
}
