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

export function studioEdgeGlyph(edge: GraphViewModelEdge): string {
  if (edge.source === "__system_start__" || edge.eventType === "START") return "▶";
  if (edge.target === "__system_end__") return "🏁";
  if (edge.runtimeOnlyErrorFlow || (typeof edge.eventType === "string" && (edge.eventType === "ERROR" || edge.eventType.startsWith("ERROR.")))) return "⚡";
  if (edge.eventType === "BLOCKED") return "⛔";
  if (edge.eventType === "NEEDS_REWORK") return "↺";
  if (edge.eventType === "REJECTED") return "✗";
  if (edge.eventType === "APPROVED") return "✓";
  if (edge.eventType === "READY") return "✓";
  if (edge.condition && typeof edge.condition === "object" && Object.keys(edge.condition).length > 0) return "◇";
  if (edge.conditionSummary) return "◇";
  return "";
}

export function studioEdgeSemanticColor(edge: GraphViewModelEdge, isDark: boolean): string {
  if (edge.diagnostic?.severity === "error") return isDark ? "#f87171" : "#dc2626";
  if (edge.diagnostic?.severity === "warning") return isDark ? "#fbbf24" : "#d97706";

  // 红 (错误/拒绝类): ERROR, REJECTED, BLOCKED
  if (edge.runtimeOnlyErrorFlow || (typeof edge.eventType === "string" && (edge.eventType === "ERROR" || edge.eventType.startsWith("ERROR.")))) {
    return isDark ? "#f87171" : "#dc2626";
  }
  if (edge.eventType === "REJECTED") return isDark ? "#fb7185" : "#e11d48";
  if (edge.eventType === "BLOCKED") return isDark ? "#fb7185" : "#ea580c";

  // 黄 (待办/分发类): START, NEEDS_REWORK
  if (edge.source === "__system_start__" || edge.eventType === "START") return isDark ? "#fbbf24" : "#d97706";
  if (edge.eventType === "NEEDS_REWORK") return isDark ? "#f59e0b" : "#b45309";

  // 绿 (成功/通过类): APPROVED, READY, __system_end__
  if (edge.eventType === "APPROVED") return isDark ? "#34d399" : "#059669";
  if (edge.eventType === "READY") return isDark ? "#34d399" : "#059669";
  if (edge.target === "__system_end__") return isDark ? "#34d399" : "#059669";

  if (edge.condition && typeof edge.condition === "object" && Object.keys(edge.condition).length > 0) return isDark ? "#38bdf8" : "#0284c7";
  if (edge.conditionSummary) return isDark ? "#38bdf8" : "#0284c7";
  if (edge.channel === "loop" || edge.channel === "feedback" || edge.topologyOrder?.endsWith("L")) return isDark ? "#38bdf8" : "#55798c";
  if (edge.participatesInJoin) return isDark ? "#34d399" : "#1b7662";
  return isDark ? "#94a3b8" : "#82998e";
}

export function studioEdgeSemanticBg(edge: GraphViewModelEdge, isDark: boolean): string {
  if (edge.runtimeOnlyErrorFlow || (typeof edge.eventType === "string" && (edge.eventType === "ERROR" || edge.eventType.startsWith("ERROR.")))) {
    return isDark ? "#2a1518" : "#fef2f2";
  }
  if (edge.eventType === "REJECTED" || edge.eventType === "BLOCKED") {
    return isDark ? "#2d161a" : "#fff1f2";
  }
  if (edge.source === "__system_start__" || edge.eventType === "START" || edge.eventType === "NEEDS_REWORK") {
    return isDark ? "#2b2210" : "#fffbeb";
  }
  if (edge.eventType === "APPROVED" || edge.eventType === "READY" || edge.target === "__system_end__") {
    return isDark ? "#0f261d" : "#f0fdf4";
  }
  return isDark ? "#101827" : "#ffffff";
}

export function formatStudioEdgeDisplayLabel(edge: GraphViewModelEdge, showTechnicalDetails = true): string {
  const glyph = studioEdgeGlyph(edge);
  const text = showTechnicalDetails ? formatStudioEdgeSummaryLabel(edge) : edge.label;
  return glyph ? `${glyph} ${text}` : text;
}
