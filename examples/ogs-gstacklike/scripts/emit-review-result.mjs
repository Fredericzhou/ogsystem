async function readPromptFromStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function extractInputSection(prompt) {
  const marker = "\nInput:\n";
  const index = prompt.lastIndexOf(marker);
  if (index === -1) {
    return "";
  }
  return prompt.slice(index + marker.length).trim();
}

function parseProjectedContext(prompt) {
  const inputSection = extractInputSection(prompt);
  if (!inputSection) {
    return {};
  }
  try {
    const parsed = JSON.parse(inputSection);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function inferEvent(context) {
  const explicit = process.env.REVIEW_EVENT;
  if (explicit) {
    return explicit;
  }
  const comment = firstNonEmptyString(context.human_review_comment);
  if (comment) {
    return "CHANGES_REQUIRED";
  }
  return "APPROVED";
}

const prompt = await readPromptFromStdin();
const context = parseProjectedContext(prompt);
const event = inferEvent(context);
const comment = firstNonEmptyString(context.human_review_comment);
const previousShipOutput = firstNonEmptyString(context.previous_ship_output);
const forcedByEnv = Boolean(process.env.REVIEW_EVENT);

console.log(
  JSON.stringify({
    event,
    content:
      event === "CHANGES_REQUIRED"
        ? forcedByEnv
          ? "review requested changes after operator-directed rework"
          : `review requested changes from human feedback: ${comment || "missing comment"}`
        : "review approved the current work package",
    data: {
      roleId: "review",
      actor: process.env.ROLE_ACTOR ?? process.env.USER ?? "operator",
      hasHumanReviewContext: Boolean(comment),
      humanReviewRound:
        typeof context.human_review_round === "number" ? context.human_review_round : undefined,
      previousShipOutput: previousShipOutput || undefined
    }
  })
);
