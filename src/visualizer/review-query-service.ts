/** Read-only review query boundary for the visualizer. */
import { inspectHumanReview, listHumanReviews } from "../runtime/project-lifecycle.js";

export { inspectHumanReview, listHumanReviews };

export const reviewQueryService = {
  list: listHumanReviews,
  inspect: inspectHumanReview
};
