/** Human-review artifact persistence port. */
import {
  loadHumanReviewDecisions,
  loadHumanReviewRequests,
  markHumanReviewDecisionApplied,
  markHumanReviewDecisionReconciled,
  persistHumanReviewDecision,
  persistHumanReviewRequest
} from "./run-artifacts.js";

export type ReviewStore = {
  persistRequest: typeof persistHumanReviewRequest;
  loadRequests: typeof loadHumanReviewRequests;
  persistDecision: typeof persistHumanReviewDecision;
  loadDecisions: typeof loadHumanReviewDecisions;
  markApplied: typeof markHumanReviewDecisionApplied;
  markReconciled: typeof markHumanReviewDecisionReconciled;
};

export const filesystemReviewStore: ReviewStore = {
  persistRequest: persistHumanReviewRequest,
  loadRequests: loadHumanReviewRequests,
  persistDecision: persistHumanReviewDecision,
  loadDecisions: loadHumanReviewDecisions,
  markApplied: markHumanReviewDecisionApplied,
  markReconciled: markHumanReviewDecisionReconciled
};
