import dagre from "dagre";
// Dagre does not expose the rank pass from its public entrypoint. This is the same rank pass
// used by dagre.layout(), captured before layout removes its internal rank fields.
// @ts-ignore dagre's internal CommonJS module has no published declaration.
import dagreRank from "dagre/lib/rank/index.js";

import type { GraphViewModel, GraphViewModelEdge, GraphViewModelNode } from "../studio-contracts.js";
import {
  buildProjection,
  type LayoutDiagnostic,
  type LayoutProjection,
  type LayoutProjectionNode,
  type StudioLayoutMode
} from "./semantic-layout-projection.js";

type LayoutConfig = {
  rankdir: "LR" | "TB";
  paddingX: number;
  paddingY: number;
  nodesep: number;
  ranksep: number;
  columnGap?: number;
  rowGap?: number;
};

function configFor(mode: StudioLayoutMode): LayoutConfig {
  if (mode === "stacked") return { rankdir: "TB", paddingX: 64, paddingY: 56, nodesep: 54, ranksep: 112 };
  if (mode === "compact") return { rankdir: "LR", paddingX: 56, paddingY: 56, nodesep: 28, ranksep: 72, columnGap: 84, rowGap: 24 };
  return { rankdir: "LR", paddingX: 72, paddingY: 72, nodesep: 42, ranksep: 92, columnGap: 108, rowGap: 34 };
}

function nodeOrder(nodes: readonly GraphViewModelNode[]): GraphViewModelNode[] {
  return nodes.slice().sort((left, right) => left.id.localeCompare(right.id));
}

function edgeOrder(edges: readonly GraphViewModelEdge[]): GraphViewModelEdge[] {
  return edges.slice().sort((left, right) => `${left.source}:${left.target}:${left.eventType}:${left.id}`.localeCompare(`${right.source}:${right.target}:${right.eventType}:${right.id}`));
}

function pathExists(adjacency: ReadonlyMap<string, ReadonlySet<string>>, source: string, target: string): boolean {
  if (source === target) return true;
  const visited = new Set<string>();
  const stack = [source];
  while (stack.length) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    if (current === target) return true;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) stack.push(next);
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
  if (!roleEntries.length) {
    if (input && output) {
      if (orientation === "horizontal") output.x = input.x + gap * 2;
      else output.y = input.y + gap * 2;
    }
    return next;
  }
  const minLeft = Math.min(...roleEntries.map((entry) => entry.x));
  const maxRight = Math.max(...roleEntries.map((entry) => entry.x + entry.width));
  const minTop = Math.min(...roleEntries.map((entry) => entry.y));
  const maxBottom = Math.max(...roleEntries.map((entry) => entry.y + entry.height));
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
  paddingX: number,
  paddingY: number
): LayoutProjectionNode[] {
  const minX = Math.min(...positions.map((entry) => entry.x));
  const minY = Math.min(...positions.map((entry) => entry.y));
  return positions.map((entry) => ({
    id: entry.id,
    x: entry.x + paddingX - minX,
    y: entry.y + paddingY - minY,
    width: entry.width,
    height: entry.height
  }));
}

function layoutWithDagre(viewModel: GraphViewModel, mode: StudioLayoutMode): { nodes: LayoutProjectionNode[]; diagnostics: LayoutDiagnostic[] } {
  const config = configFor(mode);
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: config.rankdir,
    nodesep: config.nodesep,
    ranksep: config.ranksep,
    acyclicer: "greedy",
    ranker: "network-simplex",
    marginx: config.paddingX,
    marginy: config.paddingY
  });
  graph.setDefaultEdgeLabel(() => ({}));
  const nodeById = new Map(nodeOrder(viewModel.nodes).map((node) => [node.id, node]));
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodeOrder(viewModel.nodes)) {
    graph.setNode(node.id, { width: node.layout.width, height: node.layout.height });
    adjacency.set(node.id, new Set());
  }
  const diagnostics: LayoutDiagnostic[] = [];
  const layoutPairKeys = new Set<string>();
  for (const edge of edgeOrder(viewModel.edges)) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      diagnostics.push({ code: "MISSING_ENDPOINT", severity: "warning", message: `Layout edge ${edge.id} has a missing endpoint.`, edgeId: edge.id });
      continue;
    }
    const sourceLinks = adjacency.get(edge.source)!;
    const pairKey = `${edge.source}\u0000${edge.target}`;
    if (edge.source === edge.target || pathExists(adjacency, edge.target, edge.source)) {
      diagnostics.push({
        code: edge.source === edge.target ? "SELF_EDGE_PRESERVED" : "BACK_EDGE_PRESERVED",
        severity: "info",
        message: `Business edge ${edge.id} remains in the projection; Dagre receives only the acyclic layout subset.`,
        edgeId: edge.id
      });
      continue;
    }
    if (layoutPairKeys.has(pairKey)) {
      diagnostics.push({ code: "MULTI_EDGE_COLLAPSED_FOR_LAYOUT", severity: "info", message: `Parallel business edge ${edge.id} shares a Dagre topology edge; its route lane remains distinct.`, edgeId: edge.id });
      continue;
    }
    graph.setEdge(edge.source, edge.target);
    sourceLinks.add(edge.target);
    layoutPairKeys.add(pairKey);
  }
  dagreRank(graph);
  const rankById = new Map<string, number>(
    graph.nodes().map((id) => [id, Number(graph.node(id)?.rank)] as [string, number])
  );
  dagre.layout(graph);
  const dagreNodes = graph.nodes().sort((left, right) => left.localeCompare(right)).map((id) => {
    const node = graph.node(id) as { x: number; y: number; width: number; height: number };
    return { id, x: node.x, y: node.y, width: node.width, height: node.height };
  });
  if (mode === "stacked") {
    return {
      nodes: shiftToPadding(boundaryPositions(dagreNodes.map((node) => ({ ...node, x: node.x - node.width / 2, y: node.y - node.height / 2 })), nodeById, "vertical", 96), config.paddingX, config.paddingY),
      diagnostics
    };
  }

  // Use Dagre's captured semantic rank as the column key. Pixel coordinates are used only for
  // within-rank ordering.
  const columnsByRank = new Map<number, typeof dagreNodes[number][]>();
  for (const node of dagreNodes) {
    const rank = rankById.get(node.id) ?? 0;
    columnsByRank.set(rank, [...(columnsByRank.get(rank) ?? []), node]);
  }
  const columns = [...columnsByRank.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, column]) => column.sort((left, right) => left.y - right.y || left.id.localeCompare(right.id)));
  const placedCenters = new Map<string, number>();
  const positions: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
  let columnLeft = config.paddingX;
  for (const column of columns) {
    const columnWidth = Math.max(...column.map((node) => node.width));
    const ordered = column.map((node) => {
      const links = {
        incoming: Array.from(adjacency.entries()).filter(([, targets]) => targets.has(node.id)).map(([id]) => id),
        outgoing: Array.from(adjacency.get(node.id) ?? [])
      };
      const neighborCenters = links.incoming.map((id) => placedCenters.get(id)).filter((value): value is number => Number.isFinite(value)).concat(links.outgoing.map((id) => graph.node(id)?.y as number | undefined).filter((value): value is number => Number.isFinite(value)));
      const idealCenter = neighborCenters.length ? neighborCenters.slice().sort((left, right) => left - right)[Math.floor(neighborCenters.length / 2)] : node.y;
      return { ...node, idealCenter };
    }).sort((left, right) => left.idealCenter - right.idealCenter || left.y - right.y || left.id.localeCompare(right.id));
    let cursorTop = Number.NEGATIVE_INFINITY;
    const placements = ordered.map((node) => {
      const top = Math.max(node.idealCenter - node.height / 2, Number.isFinite(cursorTop) ? cursorTop + (config.rowGap ?? 34) : Number.NEGATIVE_INFINITY);
      cursorTop = top + node.height;
      return { ...node, top };
    });
    for (let index = placements.length - 2; index >= 0; index -= 1) {
      const next = placements[index + 1];
      placements[index].top = Math.min(placements[index].top, next.top - (config.rowGap ?? 34) - placements[index].height);
    }
    for (const node of placements) {
      positions.push({ id: node.id, x: columnLeft + (columnWidth - node.width) / 2, y: node.top, width: node.width, height: node.height });
      placedCenters.set(node.id, node.top + node.height / 2);
    }
    columnLeft += columnWidth + (config.columnGap ?? 108);
  }
  return { nodes: shiftToPadding(boundaryPositions(positions, nodeById, "horizontal", config.columnGap ?? 108), config.paddingX, config.paddingY), diagnostics };
}

export function createDagreLayoutProjection(viewModel: GraphViewModel, mode: StudioLayoutMode): LayoutProjection {
  const result = layoutWithDagre(viewModel, mode);
  return buildProjection("dagre", mode, result.nodes, viewModel, result.diagnostics);
}
