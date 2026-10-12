export const HUMAN_REVIEW_COMMENT_MAX_LENGTH = 2000;

export class HumanReviewCommentError extends Error {
  readonly code = "INVALID_HUMAN_REVIEW_COMMENT";

  constructor(message: string) {
    super(message);
    this.name = "HumanReviewCommentError";
  }
}

export function normalizeHumanReviewComment(value: unknown): string {
  const placeholderComments = [
    /^填写审阅依据(?:和接受的风险)?$/u,
    /^reviewed proposal and risks$/iu,
    /^recorded via visualizer(?:\s*\([^)]*\))?$/iu,
    /^(?:todo|tbd|placeholder|lgtm|looks good|approved|ok|n\/a)$/iu,
    /^(?:同意|已审阅|通过|没问题|批准|接受)$/u
  ];
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new HumanReviewCommentError("A review reason must be text.");
  }

  const comment = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!comment) {
    return "";
  }
  if (Array.from(comment).length > HUMAN_REVIEW_COMMENT_MAX_LENGTH) {
    throw new HumanReviewCommentError(
      `A review reason must be ${HUMAN_REVIEW_COMMENT_MAX_LENGTH} characters or fewer.`
    );
  }

  if (placeholderComments.some((pattern) => pattern.test(comment))) {
    throw new HumanReviewCommentError(
      "Replace the placeholder with a reason that explains this decision."
    );
  }

  return comment;
}
