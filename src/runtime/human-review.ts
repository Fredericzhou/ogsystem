import type {
  GraphState,
  HumanReviewContext,
  HumanReviewDecisionRecord,
  PendingHumanReview
} from "./types.js";

export function buildReviewRoundKey(roleId: string, lineageId: string): string {
  return `${roleId}::${lineageId}`;
}

export function buildReviewId(branchId: string, round: number): string {
  return `review.${branchId}.r${round}`;
}

export function isPendingHumanReview(
  value: unknown
): value is PendingHumanReview {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as PendingHumanReview).reviewId === "string" &&
    typeof (value as PendingHumanReview).roleId === "string" &&
    typeof (value as PendingHumanReview).branchId === "string" &&
    typeof (value as PendingHumanReview).lineageId === "string" &&
    typeof (value as PendingHumanReview).loopIteration === "number" &&
    typeof (value as PendingHumanReview).executionId === "string" &&
    typeof (value as PendingHumanReview).requestedAt === "string" &&
    typeof (value as PendingHumanReview).requestedByExecutionId === "string" &&
    ((value as PendingHumanReview).status === "pending" ||
      (value as PendingHumanReview).status === "paused" ||
      (value as PendingHumanReview).status === "resolved" ||
      (value as PendingHumanReview).status === "expired") &&
    typeof (value as PendingHumanReview).round === "number" &&
    typeof (value as PendingHumanReview).spec === "object" &&
    (value as PendingHumanReview).spec !== null &&
    ((value as PendingHumanReview).stateVersion === undefined || Number.isInteger((value as PendingHumanReview).stateVersion)) &&
    ((value as PendingHumanReview).irDigest === undefined || typeof (value as PendingHumanReview).irDigest === "string")
  );
}

export function isHumanReviewDecisionRecord(
  value: unknown
): value is HumanReviewDecisionRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as HumanReviewDecisionRecord).reviewId === "string" &&
    typeof (value as HumanReviewDecisionRecord).committedAt === "string" &&
    typeof (value as HumanReviewDecisionRecord).decidedAt === "string" &&
    ((value as HumanReviewDecisionRecord).decision === "approve" ||
      (value as HumanReviewDecisionRecord).decision === "rework" ||
      (value as HumanReviewDecisionRecord).decision === "pause" ||
      (value as HumanReviewDecisionRecord).decision === "terminate")
  );
}

export function isHumanReviewContext(
  value: unknown
): value is HumanReviewContext {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as HumanReviewContext).reviewId === "string" &&
    typeof (value as HumanReviewContext).branchId === "string" &&
    typeof (value as HumanReviewContext).round === "number" &&
    typeof (value as HumanReviewContext).previousOutput === "object" &&
    (value as HumanReviewContext).previousOutput !== null
  );
}

export function isUnresolvedHumanReview(review: PendingHumanReview): boolean {
  return review.status === "pending" || review.status === "paused";
}

export function countPendingHumanReviews(state: GraphState): number {
  return Object.values(state.pendingReviewsById).filter(isUnresolvedHumanReview).length;
}

export function hasWaitingHumanReview(state: GraphState): boolean {
  return countPendingHumanReviews(state) > 0;
}
