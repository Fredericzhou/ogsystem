import type { Edge, Graph, Node } from "@antv/x6";

import type { GraphViewModel, GraphViewModelEdge, GraphViewModelNode } from "../studio-contracts.js";
import { formatStudioEdgeLabel } from "../studio-edge-semantics.js";
import { formatStudioRuntimeNodeBadges } from "./studio-graph-runtime.js";
import type { LayoutEdgeRouting, LayoutProjection } from "./semantic-layout-projection.js";

export { formatStudioEdgeLabel } from "../studio-edge-semantics.js";

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
  const semantic = node.roleSeat
    ? [
        node.structure.modes?.length ? `mode:${node.structure.modes.join("/")}` : "",
        node.structure.loopScope ? `loop:${node.structure.loopScope.loopId}` : "",
        node.structure.review ? "review" : ""
      ].filter(Boolean)
    : [];
  const topology = node.topologyComponentId ? [node.topologyComponentId] : [];
  const badges = [...semantic, ...normalizedBadges, ...topology];
  return badges.length ? `${node.label}  [${badges.join(" ")}]` : node.label;
}

type StudioEdgeTerminal = NonNullable<Edge.Metadata["source"]>;
type StudioEdgeRouting = {
  source: StudioEdgeTerminal;
  target: StudioEdgeTerminal;
  router: NonNullable<Edge.Metadata["router"]>;
  connector: NonNullable<Edge.Metadata["connector"]>;
  vertices: NonNullable<Edge.Metadata["vertices"]>;
};
const STUDIO_EDGE_ORTH_ROUTER: StudioEdgeRouting["router"] = {
  name: "orth",
  args: { padding: 18 }
};
const STUDIO_EDGE_CONNECTOR: StudioEdgeRouting["connector"] = {
  name: "rounded",
  args: { radius: 10 }
};

function projectionRouting(routing: LayoutEdgeRouting): StudioEdgeRouting {
  const toTerminal = (value: LayoutEdgeRouting["source"]): StudioEdgeTerminal => ({
    cell: value.cell,
    port: value.port,
    anchor: {
      name: value.side,
      args: value.offset
        ? value.side === "top" || value.side === "bottom" ? { dx: value.offset } : { dy: value.offset }
        : {}
    },
    connectionPoint: { name: "anchor" }
  });
  return {
    source: toTerminal(routing.source),
    target: toTerminal(routing.target),
    router: routing.router as NonNullable<Edge.Metadata["router"]>,
    connector: routing.connector as NonNullable<Edge.Metadata["connector"]>,
    vertices: routing.routePoints
  };
}

export function renderStudioGraphViewModel(graph: Graph, viewModel: GraphViewModel, projection: LayoutProjection): void {
  const projectedNodes = viewModel.nodes.map((node) => {
    const layout = projection.nodes.find((candidate) => candidate.id === node.id);
    return layout ? { ...node, layout } : node;
  });
  const projectedViewModel = { ...viewModel, nodes: projectedNodes };
  const routingByEdgeId = new Map(projection.edges.map((edge) => [edge.id, projectionRouting(edge.routing)]));
  graph.batchUpdate("studio-projection", () => {
    const nextNodeIds = new Set(projectedViewModel.nodes.map((node) => node.id));
    const nextEdgeIds = new Set(viewModel.edges.map((edge) => edge.id));

    for (const cell of graph.getCells()) {
      if (cell.isNode() && !nextNodeIds.has(cell.id)) {
        cell.remove();
      }
      if (cell.isEdge() && !nextEdgeIds.has(cell.id)) {
        cell.remove();
      }
    }

    for (const node of projectedViewModel.nodes) {
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
      visibility: node.roleSeat && node.diagnostic ? "visible" : "hidden"
    },
    diagnosticText: {
      x: node.layout.width - 14,
      y: 18,
      textAnchor: "middle",
      fontSize: 11,
      fontWeight: 700,
      fill: "#f8fafc",
      text: node.diagnostic ? diagnosticBadgeText(node.diagnostic.severity) : "",
      visibility: node.roleSeat && node.diagnostic ? "visible" : "hidden"
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
    items: node.roleSeat
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
  const expectedPortIds = node.roleSeat ? ["in", "out"] : [];
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
    source: routing?.source ?? { cell: edge.source },
    target: routing?.target ?? { cell: edge.target },
    zIndex: 1,
    data: { studioEdge: edge },
    labels: studioEdgeLabels(edge),
    attrs: studioEdgeAttrs(edge),
    router: routing?.router,
    connector: routing?.connector ?? STUDIO_EDGE_CONNECTOR,
    vertices: routing?.vertices
  };
}

function studioEdgeLabels(edge: GraphViewModelEdge): Edge.Metadata["labels"] {
  const labels: NonNullable<Edge.Metadata["labels"]> = [{
    attrs: {
      label: {
        text: formatStudioEdgeLabel(edge),
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
  cell.setSource(routing?.source ?? { cell: edge.source });
  cell.setTarget(routing?.target ?? { cell: edge.target });
  cell.setLabels(studioEdgeLabels(edge));
  cell.attr(studioEdgeAttrs(edge));
  cell.setRouter(routing?.router ?? STUDIO_EDGE_ORTH_ROUTER);
  cell.setVertices(routing?.vertices ?? []);
  cell.setConnector(routing?.connector ?? STUDIO_EDGE_CONNECTOR);
}
