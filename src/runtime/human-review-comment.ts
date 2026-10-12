export const HUMAN_REVIEW_COMMENT_MAX_LENGTH = 2000;

export class HumanReviewCommentError extends Error {
  readonly code = "INVALID_HUMAN_REVIEW_COMMENT";

  constructor(message: string) {
    super(message);
    this.name = "HumanReviewCommentError";
  }
}

export function normalizeHumanReviewComment(value: unknown): string {
  if (typeof value !== "string") {
    throw new HumanReviewCommentError("A review decision requires a reason.");
  }

  const comment = value.trim();
  if (!comment) {
    throw new HumanReviewCommentError("A review decision requires a reason.");
  }
  if (Array.from(comment).length > HUMAN_REVIEW_COMMENT_MAX_LENGTH) {
    throw new HumanReviewCommentError(
      `A review reason must be ${HUMAN_REVIEW_COMMENT_MAX_LENGTH} characters or fewer.`
    );
  }
  const validationText = comment.normalize("NFKC").replace(/\s+/gu, " ");
  if (/^(?:recorded via visualizer(?:\s*\([^)]*\))?|todo|tbd|placeholder|lgtm|looks good|approved|ok|n\/a|\u540c\u610f|\u901a\u8fc7|\u6279\u51c6|\u63a5\u53d7|\u586b\u5199.{0,120}(?:\u7406\u7531|\u4f9d\u636e).{0,120}|\u5728\u6b64\u586b\u5199.{0,120})$/iu.test(validationText)) {
    throw new HumanReviewCommentError(
      "Replace the instruction text with a decision-specific reason."
    );
  }

  return comment;
}
