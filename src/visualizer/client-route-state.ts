export type RouteState = {
  view: string;
  lifecycle: string;
  projectTab: string;
  runId: string;
  reviewId: string;
  logRoleId: string;
  tail: string;
  since: string;
};

export function readRouteStateFromSearch(search: string): RouteState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    view: params.get("view") || "",
    lifecycle: params.get("lifecycle") || "",
    projectTab: params.get("projectTab") || "",
    runId: params.get("runId") || "",
    reviewId: params.get("reviewId") || "",
    logRoleId: params.get("logRoleId") || "",
    tail: params.get("tail") || "",
    since: params.get("since") || ""
  };
}

export function normalizeLifecycleView(lifecycle: string | undefined, legacyView: string | undefined): string {
  switch (lifecycle) {
    case "project":
    case "build":
    case "validate-release":
    case "operate":
    case "legacy":
      return lifecycle;
  }
  switch (legacyView) {
    case "project":
    case "build":
    case "validate-release":
    case "operate":
    case "legacy":
      return legacyView;
    default:
      return "project";
  }
}

export function buildRouteSearch(args: {
  lifecycle?: string;
  projectTab?: string;
  projectHome: boolean;
  selectedRunId: string;
  selectedReviewId: string;
  selectedLogRoleId: string;
  logTail: string;
  logSince: string;
}): string {
  const params = new URLSearchParams();
  const lifecycle = args.lifecycle || "";
  if (lifecycle) {
    params.set("lifecycle", lifecycle);
  }
  if (args.projectHome && !args.selectedRunId) {
    params.set("view", "project");
  }
  if (lifecycle === "project" && args.projectTab && args.projectTab !== "overview") {
    params.set("projectTab", args.projectTab);
  }
  if (args.selectedRunId) {
    params.set("runId", args.selectedRunId);
  }
  if (args.selectedReviewId) {
    params.set("reviewId", args.selectedReviewId);
  }
  if (args.selectedLogRoleId) {
    params.set("logRoleId", args.selectedLogRoleId);
  }
  if (args.logTail) {
    params.set("tail", args.logTail);
  }
  if (args.logSince) {
    params.set("since", args.logSince);
  }
  return params.toString();
}
