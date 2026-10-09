type ReviewEntryLike = {
  reviewId?: string | null;
  currentStatus?: string | null;
  decisionPhase?: string | null;
  decision?: string | null;
};

type ReviewsPayloadLike = {
  reviews?: ReviewEntryLike[] | null;
  latestPendingReviewId?: string | null;
};

type RuntimeGraphLike = {
  nodes?: Array<{
    roleId?: string;
    roleSeat?: boolean;
    runtime?: Record<string, unknown>;
  }>;
};

type RunHeaderLike = {
  status?: string | null;
  hasWaitingHumanReview?: boolean | null;
  lastExecutedRoleId?: string | null;
  finalRoleId?: string | null;
};

export function selectReviewId(args: {
  currentReviewId?: string | null;
  reviewsPayload?: ReviewsPayloadLike | null;
}): string {
  const currentReviewId = String(args.currentReviewId || "");
  const reviewsPayload = args.reviewsPayload || {};
  const reviews = Array.isArray(reviewsPayload.reviews) ? reviewsPayload.reviews : [];
  const exists = reviews.some((review) => String(review?.reviewId || "") === currentReviewId);
  if (currentReviewId && exists) {
    return currentReviewId;
  }
  const actionableReview = reviews.find(isActionableHumanReview);
  if (actionableReview?.reviewId) {
    return String(actionableReview.reviewId);
  }
  return String(reviewsPayload.latestPendingReviewId || reviews[0]?.reviewId || "");
}

export function isActionableHumanReview(review: ReviewEntryLike | null | undefined): boolean {
  if (!review) return false;
  const status = String(review.currentStatus || "");
  const phase = String(review.decisionPhase || "");
  const decision = String(review.decision || "");
  const hasDurableDecision = ["recorded", "pending_reconcile", "applied"].includes(phase) || Boolean(decision);
  if (status === "paused" && decision === "pause" && phase === "applied") {
    return true;
  }
  return ["pending", "paused"].includes(status) && !hasDurableDecision;
}

export function getActionableHumanReviewIds(payload: ReviewsPayloadLike | null | undefined): string[] {
  const reviews = Array.isArray(payload?.reviews) ? payload.reviews : [];
  return reviews
    .filter(isActionableHumanReview)
    .map((review) => String(review?.reviewId || ""))
    .filter(Boolean);
}

export function alignGraphReviewStatuses<T extends RuntimeGraphLike>(
  graph: T,
  reviewsPayload: ReviewsPayloadLike
): T {
  if (!Array.isArray(reviewsPayload?.reviews) || !Array.isArray(graph?.nodes)) return graph;
  const reviewsByRole = new Map<string, ReviewEntryLike[]>();
  for (const review of reviewsPayload.reviews) {
    const roleId = String((review as ReviewEntryLike & { roleId?: string }).roleId || "");
    if (!roleId) continue;
    const roleReviews = reviewsByRole.get(roleId) ?? [];
    roleReviews.push(review);
    reviewsByRole.set(roleId, roleReviews);
  }
  graph.nodes = graph.nodes.map((node) => {
    const runtime = node?.runtime;
    if (!runtime || !node.roleSeat) return node;
    const roleReviews = reviewsByRole.get(String(node.roleId || "")) ?? [];
    const actionableCount = roleReviews.filter(isActionableHumanReview).length;
    const wasWaiting = runtime.status === "waiting_review" || Number(runtime.waitingReviewCount ?? 0) > 0;
    if (actionableCount > 0) {
      return {
        ...node,
        runtime: { ...runtime, status: "waiting_review", waitingReviewCount: actionableCount, pendingReviewCount: actionableCount }
      };
    }
    if (!wasWaiting) return node;
    const decisionPhase = [...roleReviews].reverse().find((review) =>
      ["recorded", "pending_reconcile", "applied"].includes(String(review.decisionPhase || ""))
    )?.decisionPhase;
    const status = decisionPhase === "pending_reconcile"
      ? "review_decision_applying"
      : decisionPhase === "recorded"
        ? "review_decision_recorded"
        : decisionPhase === "applied"
          ? "review_decision_applied"
          : Number(runtime.activeBranchCount ?? 0) > 0
            ? "active"
            : Number(runtime.completedBranchCount ?? 0) > 0
              ? "completed"
              : "idle";
    return {
      ...node,
      runtime: { ...runtime, status, waitingReviewCount: 0, pendingReviewCount: 0 }
    };
  });
  return graph;
}

export function fallbackLogRoleId(header: RunHeaderLike | null | undefined): string {
  return String(header?.lastExecutedRoleId || header?.finalRoleId || "");
}

export function resolveRunLiveState(
  header: RunHeaderLike | null | undefined,
  reviewDetail?: { decisionPhase?: string | null },
  reviewsPayload?: {
    reviews?: Array<{ currentStatus?: string | null; decisionPhase?: string | null }> | null;
  }
): {
  mode: "online" | "idle";
  label: string;
} {
  const status = String(header?.status || "unknown");
  const decisionPhase = String(reviewDetail?.decisionPhase || "");
  const reviewsLoaded = Array.isArray(reviewsPayload?.reviews);
  const reviews = reviewsLoaded ? reviewsPayload.reviews! : [];
  const hasUndecidedReview = reviews.some(isActionableHumanReview);
  if (hasUndecidedReview) {
    return { mode: "idle", label: "waiting_review" };
  }
  const hasDurableDecision = ["recorded", "pending_reconcile", "applied"].includes(decisionPhase);
  if (!reviewsLoaded && header?.hasWaitingHumanReview && !hasDurableDecision) {
    return { mode: "idle", label: "waiting_review" };
  }
  if (status === "running" || status === "stopping") {
    return { mode: "online", label: status };
  }
  const latestReviewPhase = [...reviews].reverse().find((review) =>
    ["recorded", "pending_reconcile", "applied"].includes(String(review.decisionPhase || ""))
  )?.decisionPhase;
  const resolvedDecisionPhase = latestReviewPhase || decisionPhase;
  if (resolvedDecisionPhase === "recorded") {
    return { mode: "idle", label: "review_decision_recorded" };
  }
  if (resolvedDecisionPhase === "pending_reconcile") {
    return { mode: "idle", label: "review_decision_applying" };
  }
  if (resolvedDecisionPhase === "applied") {
    return { mode: "idle", label: "review_decision_applied" };
  }
  return {
    mode: "idle",
    label: status
  };
}
