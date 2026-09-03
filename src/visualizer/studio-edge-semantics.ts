import type { GraphViewModelEdge } from "./studio-contracts.js";

/** Produces the semantic portion of the label rendered by the X6 graph edge. */
export function formatStudioEdgeLabel(edge: GraphViewModelEdge): string {
  const details = [
    edge.topologyOrder ? `#${edge.topologyOrder}` : "",
    edge.channel,
    edge.priority === undefined ? "" : `p${edge.priority}`,
    edge.conditionSummary ? `when:${edge.conditionSummary}` : ""
  ].filter(Boolean);
  return details.length ? `${edge.label}  [${details.join(" ")}]` : edge.label;
}
