import test from "node:test";
import assert from "node:assert/strict";

import {
  HUMAN_REVIEW_COMMENT_MAX_LENGTH,
  HumanReviewCommentError,
  normalizeHumanReviewComment
} from "../dist/runtime/human-review-comment.js";

test("human review comments are optional and reject known placeholders", () => {
  for (const value of ["recorded via visualizer (approve)", "looks good", "TBD"]) {
    assert.throws(() => normalizeHumanReviewComment(value), HumanReviewCommentError);
  }
  assert.equal(normalizeHumanReviewComment(undefined), "");
  assert.equal(normalizeHumanReviewComment(""), "");
  assert.equal(normalizeHumanReviewComment("  \n  "), "");
});

test("human review comments are normalized and bounded", () => {
  assert.equal(normalizeHumanReviewComment("  Evidence supports this.\n Keep two rounds by default.  "), "Evidence supports this. Keep two rounds by default.");
  assert.throws(
    () => normalizeHumanReviewComment("x".repeat(HUMAN_REVIEW_COMMENT_MAX_LENGTH + 1)),
    /2000 characters or fewer/
  );
});
