import type { Graph } from "@antv/x6";

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
  graph.clearCells();
  for (const node of projection.nodes) {
    graph.addNode({
        id: node.id,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        shape: "rect",
        data: { studioNode: node },
        attrs: {
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
        },
        ports: {
          groups: {
            in: {
              position: "left",
              attrs: { circle: { r: 4, magnet: true, stroke: "#38bdf8", fill: "#050914" } }
            },
            out: {
              position: "right",
              attrs: { circle: { r: 4, magnet: true, stroke: "#38bdf8", fill: "#050914" } }
            }
          },
          items: node.kind === "role"
            ? [
                { id: "in", group: "in" },
                { id: "out", group: "out" }
              ]
            : []
        }
    });
  }
  for (const edge of projection.edges) {
    graph.addEdge({
        id: edge.id,
        source: { cell: edge.source, port: edge.source === "input" ? undefined : "out" },
        target: { cell: edge.target, port: edge.target === "output" ? undefined : "in" },
        data: { studioEdge: edge },
        labels: [{
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
        }],
        attrs: {
          line: {
            stroke: edgeStroke(edge),
            strokeWidth: edge.participatesInJoin ? 2.4 : 1.7,
            targetMarker: {
              name: "block",
              width: 8,
              height: 6
            }
          }
        },
        router: { name: "manhattan" },
        connector: { name: "rounded" }
    });
  }
}
