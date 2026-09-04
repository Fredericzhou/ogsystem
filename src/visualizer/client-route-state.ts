import type { GraphReadingMode } from "./studio-contracts.js";

type GraphReadingChannel = "normal" | "error" | "loop" | "join" | "feedback";

export type GraphViewport = {
  x: number;
  y: number;
  zoom: number;
};

export function normalizeGraphViewport(value: Partial<Record<keyof GraphViewport, unknown>> | null | undefined): GraphViewport | undefined {
  if (!value) {
    return undefined;
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const zoom = Number(value.zoom);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(zoom) ||
    Math.abs(x) > 100000 ||
    Math.abs(y) > 100000 ||
    zoom < 0.25 ||
    zoom > 2.5
  ) {
    return undefined;
  }
  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    zoom: Math.round(zoom * 1000) / 1000
  };
}

export type RouteState = {
  view: string;
  lifecycle: string;
  runId: string;
  reviewId: string;
  logRoleId: string;
  tail: string;
  since: string;
  graphMode: GraphReadingMode;
  graphRoleId: string;
  graphFlowKey: string;
  graphChannel: GraphReadingChannel | "";
  graphViewport?: GraphViewport;
  conversationMode: boolean;
  timelineRoleId: string;
  timelineType: string;
  timelineStatus: string;
  timelineBranchId: string;
  timelineReviewId: string;
  timelineErrorCode: string;
  timelineChannel: "main" | "error" | "loop" | "join" | "feedback" | "";
};

export function readRouteStateFromSearch(search: string): RouteState {
  const bounded = (value: string | null): string => value && value.length <= 160 ? value : "";
  const mode = (value: string | null): GraphReadingMode => ["all", "upstream", "downstream", "route"].includes(value ?? "")
    ? value as GraphReadingMode
    : "all";
  const channel = (value: string | null): RouteState["graphChannel"] => ["normal", "error", "loop", "join", "feedback"].includes(value ?? "")
    ? value as RouteState["graphChannel"]
    : "";
  const timelineChannel = (value: string | null): RouteState["timelineChannel"] => ["main", "error", "loop", "join", "feedback"].includes(value ?? "")
    ? value as RouteState["timelineChannel"]
    : "";
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const graphViewport = normalizeGraphViewport({
    x: params.get("graphX"),
    y: params.get("graphY"),
    zoom: params.get("graphZoom")
  });
  return {
    view: params.get("view") || "",
    lifecycle: params.get("lifecycle") || "",
    runId: params.get("runId") || "",
    reviewId: params.get("reviewId") || "",
    logRoleId: params.get("logRoleId") || "",
    tail: params.get("tail") || "",
    since: bounded(params.get("since")),
    graphMode: mode(params.get("graphMode")),
    graphRoleId: bounded(params.get("graphRoleId")),
    graphFlowKey: bounded(params.get("graphFlowKey")),
    graphChannel: channel(params.get("graphChannel")),
    ...(graphViewport ? { graphViewport } : {}),
    conversationMode: params.get("timelineView") === "conversation",
    timelineRoleId: bounded(params.get("timelineRoleId")),
    timelineType: bounded(params.get("timelineType")),
    timelineStatus: bounded(params.get("timelineStatus")),
    timelineBranchId: bounded(params.get("timelineBranchId")),
    timelineReviewId: bounded(params.get("timelineReviewId")),
    timelineErrorCode: bounded(params.get("timelineErrorCode")),
    timelineChannel: timelineChannel(params.get("timelineChannel"))
  };
}

export function normalizeLifecycleView(
  lifecycle: string | undefined,
  legacyView: string | undefined
): string {
  switch (lifecycle) {
    case "project":
      return "project";
    case "design":
    case "build":
      return "design";
    case "run":
    case "legacy":
      return "run";
    case "release":
    case "validate-release":
      return "release";
    case "operate":
      return "run";
  }
  switch (legacyView) {
    case "project":
      return "project";
    case "design":
    case "build":
      return "design";
    case "run":
    case "legacy":
      return "run";
    case "release":
    case "validate-release":
      return "release";
    case "operate":
      return "run";
    default:
      return "project";
  }
}

export function buildRouteSearch(args: {
  lifecycle?: string;
  projectHome: boolean;
  selectedRunId: string;
  selectedReviewId: string;
  selectedLogRoleId: string;
  logTail: string;
  logSince: string;
  graphMode?: GraphReadingMode;
  graphRoleId?: string;
  graphFlowKey?: string;
  graphChannel?: GraphReadingChannel | "";
  graphViewport?: GraphViewport;
  conversationMode?: boolean;
  timelineRoleId?: string;
  timelineType?: string;
  timelineStatus?: string;
  timelineBranchId?: string;
  timelineReviewId?: string;
  timelineErrorCode?: string;
  timelineChannel?: RouteState["timelineChannel"];
}): string {
  const bounded = (value: string): string => value.length <= 160 ? value : "";
  const mode = (value: GraphReadingMode | undefined): GraphReadingMode => ["all", "upstream", "downstream", "route"].includes(value ?? "")
    ? value as GraphReadingMode
    : "all";
  const channel = (value: RouteState["graphChannel"] | undefined): RouteState["graphChannel"] => ["normal", "error", "loop", "join", "feedback"].includes(value ?? "")
    ? value as RouteState["graphChannel"]
    : "";
  const timelineChannel = (value: RouteState["timelineChannel"] | undefined): RouteState["timelineChannel"] => ["main", "error", "loop", "join", "feedback"].includes(value ?? "")
    ? value as RouteState["timelineChannel"]
    : "";
  const graphViewport = normalizeGraphViewport(args.graphViewport);
  const params = new URLSearchParams();
  let lifecycle = args.lifecycle || "";
  switch (lifecycle) {
    case "project":
    case "build":
      lifecycle = "design";
      break;
    case "validate-release":
      lifecycle = "release";
      break;
    case "operate":
    case "legacy":
      lifecycle = "run";
      break;
    default:
      break;
  }
  if (lifecycle) {
    params.set("lifecycle", lifecycle);
  }
  const includeRunSelection = lifecycle === "run";
  if (includeRunSelection && args.selectedRunId) {
    params.set("runId", args.selectedRunId);
  }
  if (includeRunSelection && args.selectedReviewId) {
    params.set("reviewId", args.selectedReviewId);
  }
  if (includeRunSelection && args.selectedLogRoleId) {
    params.set("logRoleId", args.selectedLogRoleId);
  }
  if (includeRunSelection && args.logTail) {
    params.set("tail", args.logTail);
  }
  if (includeRunSelection && args.logSince) {
    params.set("since", args.logSince);
  }
  if (includeRunSelection && args.conversationMode) {
    params.set("timelineView", "conversation");
  }
  const timelineFields: Array<[string, string | undefined]> = [
    ["timelineRoleId", args.timelineRoleId],
    ["timelineType", args.timelineType],
    ["timelineStatus", args.timelineStatus],
    ["timelineBranchId", args.timelineBranchId],
    ["timelineReviewId", args.timelineReviewId],
    ["timelineErrorCode", args.timelineErrorCode]
  ];
  if (includeRunSelection) {
    for (const [key, value] of timelineFields) {
      const boundedValue = bounded(value ?? "");
      if (boundedValue) params.set(key, boundedValue);
    }
    const timelineRouteChannel = timelineChannel(args.timelineChannel);
    if (timelineRouteChannel) params.set("timelineChannel", timelineRouteChannel);
  }
  const readingMode = mode(args.graphMode);
  if (readingMode !== "all") params.set("graphMode", readingMode);
  const roleId = bounded(args.graphRoleId ?? "");
  if (roleId) params.set("graphRoleId", roleId);
  const flowKey = bounded(args.graphFlowKey ?? "");
  if (flowKey) params.set("graphFlowKey", flowKey);
  const readingChannel = channel(args.graphChannel);
  if (readingChannel) params.set("graphChannel", readingChannel);
  const includeGraphViewport = lifecycle === "design" || lifecycle === "run";
  if (includeGraphViewport && graphViewport) {
    params.set("graphX", String(graphViewport.x));
    params.set("graphY", String(graphViewport.y));
    params.set("graphZoom", String(graphViewport.zoom));
  }
  return params.toString();
}
