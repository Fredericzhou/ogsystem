import type { Edge, Graph, Node } from "@antv/x6";

import type { StudioGraphProjection, StudioGraphProjectionEdge, StudioGraphProjectionNode } from "../studio-contracts.js";

function nodeStroke(node: StudioGraphProjectionNode): string {
  if (node.severity === "error") return "#f87171";
  if (node.severity === "warning") return "#fbbf24";
  if (node.kind === "boundary") return "#64748b";
  return "#38bdf8";
}

function edgeStroke(edge: StudioGraphProjectionEdge): string {
  if (edge.severity === "error") return "#f87171";
  if (edge.severity === "warning" || edge.runtimeOnlyErrorFlow) return "#fbbf24";
  if (edge.participatesInJoin) return "#a78bfa";
  return "#94a3b8";
}

function nodeLabel(node: StudioGraphProjectionNode): string {
  const badges = node.badges.length ? `  [${node.badges.join(" ")}]` : "";
  return `${node.label}${badges}`;
}

export function renderStudioGraphProjection(graph: Graph, projection: StudioGraphProjection): void {
  graph.batchUpdate("studio-projection", () => {
    const nextNodeIds = new Set(projection.nodes.map((node) => node.id));
    const nextEdgeIds = new Set(projection.edges.map((edge) => edge.id));

    for (const cell of graph.getCells()) {
      if (cell.isNode() && !nextNodeIds.has(cell.id)) {
        cell.remove();
      }
      if (cell.isEdge() && !nextEdgeIds.has(cell.id)) {
        cell.remove();
      }
    }

    for (const node of projection.nodes) {
      const existing = graph.getCellById(node.id);
      if (existing?.isNode()) {
        updateStudioNode(existing, node);
      } else {
        graph.addNode(studioNodeMetadata(node));
      }
    }

    for (const edge of projection.edges) {
      const existing = graph.getCellById(edge.id);
      if (existing?.isEdge()) {
        updateStudioEdge(existing, edge);
      } else {
        graph.addEdge(studioEdgeMetadata(edge));
      }
    }
  });
}

function studioNodeMetadata(node: StudioGraphProjectionNode): Node.Metadata {
  return {
    id: node.id,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    zIndex: 2,
    shape: "rect",
    data: { studioNode: node },
    attrs: studioNodeAttrs(node),
    ports: studioNodePorts(node)
  };
}

function studioNodeAttrs(node: StudioGraphProjectionNode): Node.Metadata["attrs"] {
  return {
    body: {
      rx: 8,
      ry: 8,
      fill: node.kind === "boundary" ? "rgba(15, 23, 42, 0.72)" : "rgba(15, 23, 42, 0.96)",
      stroke: nodeStroke(node),
      strokeWidth: node.kind === "boundary" ? 1 : 1.5,
      strokeDasharray: node.kind === "boundary" ? "6 4" : ""
    },
    label: {
      text: nodeLabel(node),
      fill: node.kind === "boundary" ? "#94a3b8" : "#e5eefb",
      fontSize: 12,
      fontWeight: 600,
      textWrap: {
        width: node.width - 18,
        height: node.height - 12,
        ellipsis: true
      }
    }
  };
}

function studioNodePorts(node: StudioGraphProjectionNode): Node.Metadata["ports"] {
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

function updateStudioNode(cell: Node, node: StudioGraphProjectionNode): void {
  cell.setData({ studioNode: node });
  cell.position(node.x, node.y);
  cell.resize(node.width, node.height);
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

function studioEdgeMetadata(edge: StudioGraphProjectionEdge): Edge.Metadata {
  return {
    id: edge.id,
    source: { cell: edge.source, port: edge.source === "input" ? undefined : "out" },
    target: { cell: edge.target, port: edge.target === "output" ? undefined : "in" },
    zIndex: 1,
    data: { studioEdge: edge },
    labels: studioEdgeLabels(edge),
    attrs: studioEdgeAttrs(edge),
    router: { name: "manhattan" },
    connector: { name: "rounded" }
  };
}

function studioEdgeLabels(edge: StudioGraphProjectionEdge): Edge.Metadata["labels"] {
  return [{
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
}

function studioEdgeAttrs(edge: StudioGraphProjectionEdge): Edge.Metadata["attrs"] {
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

function updateStudioEdge(cell: Edge, edge: StudioGraphProjectionEdge): void {
  cell.setData({ studioEdge: edge });
  cell.setSource({ cell: edge.source, port: edge.source === "input" ? undefined : "out" });
  cell.setTarget({ cell: edge.target, port: edge.target === "output" ? undefined : "in" });
  cell.setLabels(studioEdgeLabels(edge));
  cell.attr(studioEdgeAttrs(edge));
  cell.setRouter({ name: "manhattan" });
  cell.setConnector({ name: "rounded" });
}
