type ReviewEntryLike = {
  reviewId?: string | null;
};

type ReviewsPayloadLike = {
  reviews?: ReviewEntryLike[] | null;
  latestPendingReviewId?: string | null;
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
  return String(reviewsPayload.latestPendingReviewId || reviews[0]?.reviewId || "");
}

export function fallbackLogRoleId(header: RunHeaderLike | null | undefined): string {
  return String(header?.lastExecutedRoleId || header?.finalRoleId || "");
}

export function resolveRunLiveState(header: RunHeaderLike | null | undefined): {
  mode: "online" | "idle";
  label: string;
} {
  const status = String(header?.status || "unknown");
  if (header?.hasWaitingHumanReview) {
    return { mode: "idle", label: "waiting_review" };
  }
  return {
    mode: status === "running" || status === "stopping" ? "online" : "idle",
    label: status
  };
}
