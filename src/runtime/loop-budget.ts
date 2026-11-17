import type { HumanReviewDecision, HumanReviewSpec, LoopBudgetReview } from "./types.js";

export type LoopBudgetDecision = Extract<HumanReviewDecision, "continue" | "rework" | "reject" | "terminate">;

/** Return the target list owned by a loop-budget control decision. */
export function getLoopBudgetTargetRoleIds(
  review: Pick<LoopBudgetReview, "targetRoleIds" | "reworkTargetRoleIds" | "rejectTargetRoleIds">,
  decision: Exclude<LoopBudgetDecision, "terminate">
): string[] {
  if (decision === "rework") return review.reworkTargetRoleIds;
  if (decision === "reject") return review.rejectTargetRoleIds;
  return review.targetRoleIds;
}

/**
 * Loop-budget reviews carry their control scope explicitly. The legacy spec
 * fallback keeps old request files readable while new transitions use the
 * control-plane field as the authority.
 */
export function resolveLoopBudgetTerminateScope(args: {
  requestedScope?: "branch" | "run";
  loopBudget?: Pick<LoopBudgetReview, "terminateScope">;
  legacySpec?: Pick<HumanReviewSpec, "terminateScope">;
}): "branch" | "run" | undefined {
  // The persisted loop budget or its legacy projection owns the scope. A caller
  // supplied scope is accepted only as an assertion by transition boundaries.
  const configuredScope = args.loopBudget?.terminateScope ?? args.legacySpec?.terminateScope;
  if (args.requestedScope !== undefined && configuredScope !== undefined && args.requestedScope !== configuredScope) {
    return undefined;
  }
  return configuredScope;
}

