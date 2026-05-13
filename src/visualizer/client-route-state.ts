export type RouteState = {
  view: string;
  lifecycle: string;
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
    runId: params.get("runId") || "",
    reviewId: params.get("reviewId") || "",
    logRoleId: params.get("logRoleId") || "",
    tail: params.get("tail") || "",
    since: params.get("since") || ""
  };
}

export function normalizeLifecycleView(
  lifecycle: string | undefined,
  legacyView: string | undefined
): string {
  switch (lifecycle) {
    case "design":
      return "design";
    case "run":
    case "legacy":
      return "run";
    case "release":
      return "release";
    case "project":
    case "build":
      return "design";
    case "validate-release":
      return "release";
    case "operate":
      return "run";
  }
  switch (legacyView) {
    case "design":
      return "design";
    case "run":
    case "legacy":
      return "run";
    case "release":
      return "release";
    case "project":
    case "build":
      return "design";
    case "validate-release":
      return "release";
    case "operate":
      return "run";
    default:
      return "design";
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
}): string {
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
