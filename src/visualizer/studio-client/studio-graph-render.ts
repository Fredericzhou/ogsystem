import type { Edge, Graph, Node } from "@antv/x6";

import type { GraphViewModel, GraphViewModelEdge, GraphViewModelNode } from "../studio-contracts.js";
import { formatStudioRuntimeNodeBadges } from "./studio-graph-runtime.js";

function diagnosticBadgeText(severity: GraphViewModelNode["diagnostic"] extends infer T
  ? T extends { severity: infer S }
    ? S
    : never
  : never): string {
  return severity === "error" ? "!" : "?";
}

function nodeStroke(node: GraphViewModelNode): string {
  if (node.diagnostic?.severity === "error") return "#f87171";
  if (node.diagnostic?.severity === "warning") return "#fbbf24";
  if (node.kind === "boundary") return "#64748b";
  if (node.structure?.review) return "#c084fc";
  if (node.structure?.joinMode) return "#a78bfa";
  if (node.structure?.loopMax && node.structure.loopMax > 1) return "#2dd4bf";
  return "#38bdf8";
}

function edgeStroke(edge: GraphViewModelEdge): string {
  if (edge.diagnostic?.severity === "error") return "#f87171";
  if (edge.diagnostic?.severity === "warning" || edge.runtimeOnlyErrorFlow) return "#fbbf24";
  if (edge.participatesInJoin) return "#a78bfa";
  return "#94a3b8";
}

function nodeLabel(node: GraphViewModelNode): string {
  const normalizedBadges = formatStudioRuntimeNodeBadges(node);
  const badges = normalizedBadges.length ? `  [${normalizedBadges.join(" ")}]` : "";
  return `${node.label}${badges}`;
}

type StudioEdgeTerminal = NonNullable<Edge.Metadata["source"]>;
type StudioEdgeSide = "left" | "right" | "top" | "bottom";
type StudioEdgeRouteKind = "self" | "backward" | "vertical" | "forward";
type StudioEdgeRouting = {
  source: StudioEdgeTerminal;
  target: StudioEdgeTerminal;
  router: NonNullable<Edge.Metadata["router"]>;
  connector: NonNullable<Edge.Metadata["connector"]>;
};
const STUDIO_EDGE_CONNECTOR: StudioEdgeRouting["connector"] = {
  name: "rounded",
  args: {
    radius: 10
  }
};
const STUDIO_EDGE_ORTH_ROUTER: StudioEdgeRouting["router"] = {
  name: "orth",
  args: {
    padding: 18
  }
};
const STUDIO_EDGE_BACKWARD_ROUTER: StudioEdgeRouting["router"] = {
  name: "manhattan",
  args: {
    step: 18,
    padding: 30,
    startDirections: ["left"],
    endDirections: ["right"],
    excludeTerminals: ["source", "target"]
  }
};
const STUDIO_EDGE_VERTICAL_ROUTER: StudioEdgeRouting["router"] = {
  name: "manhattan",
  args: {
    step: 18,
    padding: 26,
    startDirections: ["bottom"],
    endDirections: ["top"],
    excludeTerminals: ["source", "target"]
  }
};
const STUDIO_EDGE_FORWARD_ROUTER: StudioEdgeRouting["router"] = {
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
  return [
    edge.source,
    edge.target,
    edge.eventType,
    edge.id
  ].join(":");
}

function studioEdgeAnchorOffset(index: number, count: number, nodeSpan: number): number {
  if (count <= 1) {
    return 0;
  }
  const availableHalfSpan = Math.max(16, nodeSpan / 2 - 18);
  const spacing = Math.min(18, Math.max(10, (availableHalfSpan * 2) / Math.max(count - 1, 1)));
  return Math.round((index - (count - 1) / 2) * spacing);
}

function studioEdgeAnchorArgs(side: StudioEdgeSide, offset = 0): Record<string, number> {
  if (!offset) {
    return {};
  }
  return side === "top" || side === "bottom" ? { dx: offset } : { dy: offset };
}

function studioEdgePort(cellId: string, direction: "source" | "target", side: StudioEdgeSide): string | undefined {
  const isBoundary = cellId === "input" || cellId === "output";
  if (isBoundary) {
    return undefined;
  }
  if (direction === "source" && side === "right") {
    return "out";
  }
  if (direction === "target" && side === "left") {
    return "in";
  }
  return undefined;
}

function studioEdgeTerminal(
  cellId: string,
  direction: "source" | "target",
  side: StudioEdgeSide,
  offset = 0
): StudioEdgeTerminal {
  return {
    cell: cellId,
    port: studioEdgePort(cellId, direction, side),
    anchor: {
      name: side,
      args: studioEdgeAnchorArgs(side, offset)
    },
    connectionPoint: { name: "anchor" }
  };
}

function edgeCenter(node: GraphViewModelNode | undefined): { x: number; y: number } {
  return node
    ? {
        x: node.layout.x + node.layout.width / 2,
        y: node.layout.y + node.layout.height / 2
      }
    : { x: 0, y: 0 };
}

function resolveStudioEdgeRoute(
  edge: GraphViewModelEdge,
  nodeById: ReadonlyMap<string, GraphViewModelNode>
): {
  kind: StudioEdgeRouteKind;
  sourceSide: StudioEdgeSide;
  targetSide: StudioEdgeSide;
  verticalGap: number;
} {
  const sourceNode = nodeById.get(edge.source);
  const targetNode = nodeById.get(edge.target);
  if (edge.source === edge.target) {
    return {
      kind: "self",
      sourceSide: "right",
      targetSide: "top",
      verticalGap: 0
    };
  }
  const sourceCenter = edgeCenter(sourceNode);
  const targetCenter = edgeCenter(targetNode);
  const horizontalGap = targetCenter.x - sourceCenter.x;
  const absoluteHorizontalGap = Math.abs(horizontalGap);
  const verticalGap = Math.abs(targetCenter.y - sourceCenter.y);
  const isVerticalRoute = absoluteHorizontalGap < 80 || verticalGap > absoluteHorizontalGap * 1.15;
  if (isVerticalRoute) {
    const targetBelowSource = targetCenter.y >= sourceCenter.y;
    return {
      kind: "vertical",
      sourceSide: targetBelowSource ? "bottom" : "top",
      targetSide: targetBelowSource ? "top" : "bottom",
      verticalGap
    };
  }
  const isBackwardEdge = horizontalGap < -36;
  if (isBackwardEdge) {
    return {
      kind: "backward",
      sourceSide: "left",
      targetSide: "right",
      verticalGap
    };
  }
  return {
    kind: "forward",
    sourceSide: "right",
    targetSide: "left",
    verticalGap
  };
}

export function resolveStudioEdgeRouter(
  edge: GraphViewModelEdge,
  nodeById: ReadonlyMap<string, GraphViewModelNode>
): StudioEdgeRouting["router"] {
  const sourceNode = nodeById.get(edge.source);
  const targetNode = nodeById.get(edge.target);
  const route = resolveStudioEdgeRoute(edge, nodeById);
  if (route.kind === "self") {
    return {
      name: "loop",
      args: {
        width: 56,
        height: 94,
        angle: 320
      }
    };
  }
  if (route.kind === "backward") {
    return STUDIO_EDGE_BACKWARD_ROUTER;
  }
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
  const sourceCenterX = sourceNode ? sourceNode.layout.x + sourceNode.layout.width / 2 : 0;
  const sourceCenterY = sourceNode ? sourceNode.layout.y + sourceNode.layout.height / 2 : 0;
  const targetCenterX = targetNode ? targetNode.layout.x + targetNode.layout.width / 2 : 0;
  const targetCenterY = targetNode ? targetNode.layout.y + targetNode.layout.height / 2 : 0;
  const horizontalGap = targetCenterX - sourceCenterX;
  const verticalGap = Math.abs(targetCenterY - sourceCenterY);
  const isTightForwardHop = horizontalGap > 0 && horizontalGap < 120;
  const isTallHop = verticalGap > 120;
  if (isTightForwardHop && isTallHop) {
    return {
      ...STUDIO_EDGE_ORTH_ROUTER,
      args: {
        padding: 18
      }
    };
  }
  return {
    ...STUDIO_EDGE_FORWARD_ROUTER,
    args: {
      ...STUDIO_EDGE_FORWARD_ROUTER.args,
      padding: isTallHop ? 24 : 18
    }
  };
}

function studioEdgeOffset(
  index: number,
  count: number,
  node: GraphViewModelNode | undefined,
  side: StudioEdgeSide
): number {
  if (!node) {
    return 0;
  }
  const span = side === "top" || side === "bottom" ? node.layout.width : node.layout.height;
  return studioEdgeAnchorOffset(index, count, span);
}

function buildStudioEdgeRouting(viewModel: GraphViewModel): Map<string, StudioEdgeRouting> {
  const nodeById = new Map(viewModel.nodes.map((node) => [node.id, node]));
  const routeByEdgeId = new Map<string, ReturnType<typeof resolveStudioEdgeRoute>>();
  for (const edge of viewModel.edges) {
    routeByEdgeId.set(edge.id, resolveStudioEdgeRoute(edge, nodeById));
  }
  const outgoing = new Map<string, GraphViewModelEdge[]>();
  const incoming = new Map<string, GraphViewModelEdge[]>();
  for (const edge of viewModel.edges) {
    const route = routeByEdgeId.get(edge.id);
    if (!route) {
      continue;
    }
    const sourceKey = `${edge.source}:${route.sourceSide}`;
    const sourceEdges = outgoing.get(sourceKey) || [];
    sourceEdges.push(edge);
    outgoing.set(sourceKey, sourceEdges);
    const targetKey = `${edge.target}:${route.targetSide}`;
    const targetEdges = incoming.get(targetKey) || [];
    targetEdges.push(edge);
    incoming.set(targetKey, targetEdges);
  }
  for (const edges of outgoing.values()) {
    edges.sort((left, right) => edgeSortKey(left).localeCompare(edgeSortKey(right)));
  }
  for (const edges of incoming.values()) {
    edges.sort((left, right) => edgeSortKey(left).localeCompare(edgeSortKey(right)));
  }
  const routingByEdgeId = new Map<string, StudioEdgeRouting>();
  for (const edge of viewModel.edges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const route = routeByEdgeId.get(edge.id) || resolveStudioEdgeRoute(edge, nodeById);
    const sourceEdges = outgoing.get(`${edge.source}:${route.sourceSide}`) || [];
    const targetEdges = incoming.get(`${edge.target}:${route.targetSide}`) || [];
    const outgoingIndex = Math.max(0, sourceEdges.findIndex((candidate) => candidate.id === edge.id));
    const incomingIndex = Math.max(0, targetEdges.findIndex((candidate) => candidate.id === edge.id));
    const sourceOffset = studioEdgeOffset(outgoingIndex, sourceEdges.length, sourceNode, route.sourceSide);
    const targetOffset = studioEdgeOffset(incomingIndex, targetEdges.length, targetNode, route.targetSide);
    routingByEdgeId.set(edge.id, {
      source: studioEdgeTerminal(edge.source, "source", route.sourceSide, sourceOffset),
      target: studioEdgeTerminal(edge.target, "target", route.targetSide, targetOffset),
      router: resolveStudioEdgeRouter(edge, nodeById),
      connector: STUDIO_EDGE_CONNECTOR
    });
  }
  return routingByEdgeId;
}

export function renderStudioGraphViewModel(graph: Graph, viewModel: GraphViewModel): void {
  const routingByEdgeId = buildStudioEdgeRouting(viewModel);
  graph.batchUpdate("studio-projection", () => {
    const nextNodeIds = new Set(viewModel.nodes.map((node) => node.id));
    const nextEdgeIds = new Set(viewModel.edges.map((edge) => edge.id));

    for (const cell of graph.getCells()) {
      if (cell.isNode() && !nextNodeIds.has(cell.id)) {
        cell.remove();
      }
      if (cell.isEdge() && !nextEdgeIds.has(cell.id)) {
        cell.remove();
      }
    }

    for (const node of viewModel.nodes) {
      const existing = graph.getCellById(node.id);
      if (existing?.isNode()) {
        updateStudioNode(existing, node);
      } else {
        graph.addNode(studioNodeMetadata(node));
      }
    }

    for (const edge of viewModel.edges) {
      const existing = graph.getCellById(edge.id);
      if (existing?.isEdge()) {
        updateStudioEdge(existing, edge, routingByEdgeId.get(edge.id));
      } else {
        graph.addEdge(studioEdgeMetadata(edge, routingByEdgeId.get(edge.id)));
      }
    }
  });
}

function studioNodeMetadata(node: GraphViewModelNode): Node.Metadata {
  return {
    id: node.id,
    x: node.layout.x,
    y: node.layout.y,
    width: node.layout.width,
    height: node.layout.height,
    zIndex: 2,
    shape: "rect",
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "text", selector: "label" },
      { tagName: "circle", selector: "diagnosticBadge" },
      { tagName: "text", selector: "diagnosticText" }
    ],
    data: { studioNode: node },
    attrs: studioNodeAttrs(node),
    ports: studioNodePorts(node)
  };
}

function nodeFill(node: GraphViewModelNode): string {
  if (node.kind === "boundary") return "rgba(15, 23, 42, 0.6)";
  if (node.structure?.review) return "rgba(88, 28, 135, 0.18)";
  if (node.structure?.joinMode) return "rgba(67, 56, 202, 0.14)";
  if (node.structure?.loopMax && node.structure.loopMax > 1) return "rgba(13, 148, 136, 0.12)";
  return "rgba(15, 23, 42, 0.96)";
}

function studioNodeAttrs(node: GraphViewModelNode): Node.Metadata["attrs"] {
  return {
    body: {
      rx: node.kind === "boundary" ? 20 : 8,
      ry: node.kind === "boundary" ? 20 : 8,
      fill: nodeFill(node),
      stroke: nodeStroke(node),
      strokeWidth: node.kind === "boundary" ? 1.2 : 1.5,
      strokeDasharray: node.kind === "boundary" ? "6 4" : ""
    },
    label: {
      text: nodeLabel(node),
      fill: node.kind === "boundary" ? "#94a3b8" : "#e5eefb",
      fontSize: 12,
      fontWeight: 600,
      textWrap: {
        width: node.layout.width - 18,
        height: node.layout.height - 12,
        ellipsis: true
      }
    },
    diagnosticBadge: {
      cx: node.layout.width - 14,
      cy: 14,
      r: 9,
      fill: node.diagnostic?.severity === "error" ? "#7f1d1d" : "#713f12",
      stroke: node.diagnostic?.severity === "error" ? "#f87171" : "#fbbf24",
      strokeWidth: 1.2,
      visibility: node.kind === "role" && node.diagnostic ? "visible" : "hidden"
    },
    diagnosticText: {
      x: node.layout.width - 14,
      y: 18,
      textAnchor: "middle",
      fontSize: 11,
      fontWeight: 700,
      fill: "#f8fafc",
      text: node.diagnostic ? diagnosticBadgeText(node.diagnostic.severity) : "",
      visibility: node.kind === "role" && node.diagnostic ? "visible" : "hidden"
    }
  };
}

function studioNodePorts(node: GraphViewModelNode): Node.Metadata["ports"] {
  return {
    groups: {
      in: {
        position: "left",
        attrs: { circle: { r: 4, magnet: true, stroke: "#38bdf8", fill: "#050914", "data-studio-port": "in" } }
      },
      out: {
        position: "right",
        attrs: { circle: { r: 4, magnet: true, stroke: "#38bdf8", fill: "#050914", "data-studio-port": "out" } }
      }
    },
    items: node.kind === "role"
      ? [
          { id: "in", group: "in" },
          { id: "out", group: "out" }
        ]
      : []
  };
}

function updateStudioNode(cell: Node, node: GraphViewModelNode): void {
  cell.setData({ studioNode: node });
  cell.position(node.layout.x, node.layout.y);
  cell.resize(node.layout.width, node.layout.height);
  cell.attr(studioNodeAttrs(node));
  const expectedPortIds = node.kind === "role" ? ["in", "out"] : [];
  const currentPortIds = cell.getPorts().map((port) => String(port.id ?? ""));
  const missingPorts = expectedPortIds.filter((id) => !cell.hasPort(id));
  if (missingPorts.length) {
    cell.addPorts(missingPorts.map((id) => ({ id, group: id })));
  }
  const stalePorts = currentPortIds.filter((id) => id && !expectedPortIds.includes(id));
  if (stalePorts.length) {
    cell.removePorts(stalePorts);
  }
}

function studioEdgeMetadata(edge: GraphViewModelEdge, routing?: StudioEdgeRouting): Edge.Metadata {
  return {
    id: edge.id,
    source: routing?.source ?? studioEdgeTerminal(edge.source, "source", "right"),
    target: routing?.target ?? studioEdgeTerminal(edge.target, "target", "left"),
    zIndex: 1,
    data: { studioEdge: edge },
    labels: studioEdgeLabels(edge),
    attrs: studioEdgeAttrs(edge),
    router: routing?.router ?? resolveStudioEdgeRouter(edge, new Map()),
    connector: routing?.connector ?? STUDIO_EDGE_CONNECTOR
  };
}

function studioEdgeLabels(edge: GraphViewModelEdge): Edge.Metadata["labels"] {
  const labels: NonNullable<Edge.Metadata["labels"]> = [{
    attrs: {
      label: {
        text: edge.label,
        fill: "#dbeafe",
        fontSize: 11
      },
      body: {
        fill: "rgba(15, 23, 42, 0.94)",
        stroke: edgeStroke(edge),
        strokeWidth: 1
      }
    }
  }];
  if (edge.diagnostic) {
    labels.push({
      position: {
        distance: 0.82,
        offset: -16
      },
      attrs: {
        label: {
          text: diagnosticBadgeText(edge.diagnostic.severity),
          fill: "#f8fafc",
          fontSize: 10,
          fontWeight: 700
        },
        body: {
          fill: edge.diagnostic.severity === "error" ? "#7f1d1d" : "#713f12",
          stroke: edge.diagnostic.severity === "error" ? "#f87171" : "#fbbf24",
          strokeWidth: 1
        }
      },
      markup: [
        { tagName: "rect", selector: "body" },
        { tagName: "text", selector: "label" }
      ]
    });
  }
  return labels;
}

function studioEdgeAttrs(edge: GraphViewModelEdge): Edge.Metadata["attrs"] {
  return {
    line: {
      stroke: edgeStroke(edge),
      strokeWidth: edge.participatesInJoin ? 2.4 : 1.7,
      targetMarker: {
        name: "block",
        width: 8,
        height: 6
      }
    }
  };
}

function updateStudioEdge(cell: Edge, edge: GraphViewModelEdge, routing?: StudioEdgeRouting): void {
  cell.setData({ studioEdge: edge });
  cell.setSource(routing?.source ?? studioEdgeTerminal(edge.source, "source", "right"));
  cell.setTarget(routing?.target ?? studioEdgeTerminal(edge.target, "target", "left"));
  cell.setLabels(studioEdgeLabels(edge));
  cell.attr(studioEdgeAttrs(edge));
  cell.setRouter(routing?.router ?? STUDIO_EDGE_ORTH_ROUTER);
  cell.setVertices([]);
  cell.setConnector(routing?.connector ?? STUDIO_EDGE_CONNECTOR);
}
