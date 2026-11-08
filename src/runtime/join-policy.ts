export type JoinTimeoutAction = "fail" | "quorum_continue" | "pause" | "terminate";

export type JoinPolicyDecision = {
  action: "wait" | "activate" | "fail" | "pause" | "terminate";
  missingSourceRoleIds: string[];
  reason: string;
};

export type JoinSourceStatus = "pending" | "arrived" | "skipped" | "failed";

export function resolveJoinPolicy(args: {
  mode: "all_of" | "quorum_of";
  sources: string[];
  readySources: string[];
  min: number;
  timeoutSeconds: number;
  startedAt: number;
  now: number;
  onTimeout: JoinTimeoutAction;
  failurePolicy?: "wait" | "fail" | "quorum_continue";
  sourceStatusByRoleId?: Record<string, JoinSourceStatus>;
  /** @deprecated Callers must provide sourceStatusByRoleId for failure decisions. */
  sourceFailure?: boolean;
}): JoinPolicyDecision {
  if (!Number.isInteger(args.timeoutSeconds) || args.timeoutSeconds <= 0) throw new Error("timeoutSeconds must be positive");
  const statuses = Object.fromEntries(args.sources.map((source) => [
    source,
    args.sourceStatusByRoleId?.[source] ?? (args.readySources.includes(source) ? "arrived" : "pending")
  ])) as Record<string, JoinSourceStatus>;
  const ready = new Set(args.sources.filter((source) => statuses[source] === "arrived"));
  const missingSourceRoleIds = args.sources.filter((source) => statuses[source] !== "arrived");
  if (ready.size >= args.min) return { action: "activate", missingSourceRoleIds, reason: "minimum sources ready" };
  const failed = args.sources.filter((source) => statuses[source] === "failed");
  const skipped = args.sources.filter((source) => statuses[source] === "skipped");
  const hasSourceFailure = failed.length > 0;
  if (hasSourceFailure && args.failurePolicy && args.failurePolicy !== "wait") {
    return {
      action: "fail",
      missingSourceRoleIds,
      reason: args.failurePolicy === "quorum_continue" ? "source failure did not reach quorum" : "required source failed"
    };
  }
  if (skipped.length > 0 && args.mode === "all_of") {
    return { action: "fail", missingSourceRoleIds, reason: "required source skipped" };
  }
  // A legacy caller may still pass sourceFailure. It is only honored when no
  // explicit statuses exist, so the runtime cannot turn an absent branch into failed.
  if (!args.sourceStatusByRoleId && args.sourceFailure && args.failurePolicy && args.failurePolicy !== "wait") {
    return { action: "fail", missingSourceRoleIds, reason: "required source failed" };
  }
  if (args.now - args.startedAt < args.timeoutSeconds * 1000) return { action: "wait", missingSourceRoleIds, reason: "waiting for declared sources" };
  if (args.onTimeout === "quorum_continue") {
    if (args.mode !== "quorum_of") throw new Error("quorum_continue requires quorum_of");
    return { action: "fail", missingSourceRoleIds, reason: "quorum timeout did not reach min" };
  }
  return { action: args.onTimeout, missingSourceRoleIds, reason: "join timeout" };
}
