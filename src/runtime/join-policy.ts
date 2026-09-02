export type JoinTimeoutAction = "fail" | "quorum_continue" | "pause" | "terminate";

export type JoinPolicyDecision = {
  action: "wait" | "activate" | "fail" | "pause" | "terminate";
  missingSourceRoleIds: string[];
  reason: string;
};

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
  sourceFailure?: boolean;
}): JoinPolicyDecision {
  if (!Number.isInteger(args.timeoutSeconds) || args.timeoutSeconds <= 0) throw new Error("timeoutSeconds must be positive");
  const ready = new Set(args.readySources.filter((source) => args.sources.includes(source)));
  const missingSourceRoleIds = args.sources.filter((source) => !ready.has(source));
  if (ready.size >= args.min) return { action: "activate", missingSourceRoleIds, reason: "minimum sources ready" };
  if (args.sourceFailure && args.failurePolicy && args.failurePolicy !== "wait") {
    return {
      action: "fail",
      missingSourceRoleIds,
      reason: args.failurePolicy === "quorum_continue"
        ? "source failure did not reach quorum"
        : "source failure policy"
    };
  }
  if (args.now - args.startedAt < args.timeoutSeconds * 1000) return { action: "wait", missingSourceRoleIds, reason: "waiting for declared sources" };
  if (args.onTimeout === "quorum_continue") {
    if (args.mode !== "quorum_of") throw new Error("quorum_continue requires quorum_of");
    return { action: "fail", missingSourceRoleIds, reason: "quorum timeout did not reach min" };
  }
  return { action: args.onTimeout, missingSourceRoleIds, reason: "join timeout" };
}
