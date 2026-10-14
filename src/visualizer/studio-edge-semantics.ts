import type { GraphViewModelEdge } from "./studio-contracts.js";

export const STUDIO_EDGE_SUMMARY_LABEL_MAX_WIDTH = 110;

export function estimateStudioEdgeSummaryLabelWidth(value: string): number {
  return Array.from(value).reduce((width, character) => {
    if (/\s/u.test(character)) return width + 3.5;
    if (/[\u2e80-\u9fff\uff00-\uffef]/u.test(character)) return width + 10;
    return width + 6;
  }, 0);
}

function formatStudioEdgeDetails(edge: GraphViewModelEdge, includeTopology: boolean): string[] {
  return [
    includeTopology && edge.topologyOrder ? `#${edge.topologyOrder}` : "",
    edge.channel,
    edge.priority === undefined ? "" : `p${edge.priority}`,
    edge.conditionSummary ? `when:${edge.conditionSummary}` : ""
  ].filter((value): value is string => Boolean(value));
}

/** Produces the semantic portion of the label rendered by the X6 graph edge. */
export function formatStudioEdgeLabel(edge: GraphViewModelEdge): string {
  const details = formatStudioEdgeDetails(edge, true);
  return details.length ? `${edge.label}  [${details.join(" ")}]` : edge.label;
}

/** Keeps the primary flow label compact when the topology overlay is enabled. */
export function formatStudioEdgeSummaryLabel(edge: GraphViewModelEdge): string {
  const details = formatStudioEdgeDetails(edge, false);
  return details.length ? `${edge.label}  [${details.join(" ")}]` : edge.label;
}

export function formatStudioEdgeTopologyLabel(edge: GraphViewModelEdge): string {
  return edge.topologyOrder ? `#${edge.topologyOrder}` : "";
}
