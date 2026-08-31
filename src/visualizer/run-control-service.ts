/** Mutation boundary for visualizer run controls. */
import {
  requestStop as requestStopInLifecycle,
  writeHumanReviewDecision as writeHumanReviewDecisionInLifecycle
} from "../runtime/project-lifecycle.js";

export const requestStop = requestStopInLifecycle;
export const writeHumanReviewDecision = writeHumanReviewDecisionInLifecycle;
