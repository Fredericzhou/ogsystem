import assert from "node:assert/strict";
import test from "node:test";

import {
  HUMAN_REVIEW_COMMENT_MAX_LENGTH,
  HumanReviewCommentError,
  normalizeHumanReviewComment
} from "../dist/runtime/human-review-comment.js";

test("human review comments require a useful bounded reason", () => {
  assert.equal(normalizeHumanReviewComment("  Evidence supports this choice.  "), "Evidence supports this choice.");
  assert.equal(normalizeHumanReviewComment("同意，证据与审核标准一致。"), "同意，证据与审核标准一致。");
  assert.equal(normalizeHumanReviewComment("Evidence supports this choice.\nRemaining risk is acceptable."), "Evidence supports this choice.\nRemaining risk is acceptable.");
  assert.throws(() => normalizeHumanReviewComment("  "), HumanReviewCommentError);
  assert.throws(() => normalizeHumanReviewComment("recorded via visualizer (approve)"), HumanReviewCommentError);
  assert.throws(() => normalizeHumanReviewComment("填写审阅依据和接受的风险"), HumanReviewCommentError);
  for (const placeholder of ["同意", "通过", "批准", "接受"]) {
    assert.throws(() => normalizeHumanReviewComment(placeholder), HumanReviewCommentError);
  }
  assert.throws(
    () => normalizeHumanReviewComment("x".repeat(HUMAN_REVIEW_COMMENT_MAX_LENGTH + 1)),
    HumanReviewCommentError
  );
});
