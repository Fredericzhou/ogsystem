const [roleId, envVarName, defaultEvent] = process.argv.slice(2);

if (!roleId || !envVarName || !defaultEvent) {
  console.error("usage: node scripts/emit-role-result.mjs <roleId> <envVarName> <defaultEvent>");
  process.exit(2);
}

async function readPromptFromStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function extractSection(prompt, heading) {
  const marker = `\n${heading}:\n`;
  const start = prompt.lastIndexOf(marker);
  if (start === -1) {
    return "";
  }
  const contentStart = start + marker.length;
  const nextHeading = prompt.slice(contentStart).match(/\n[A-Z][A-Za-z ]+:\n/);
  if (!nextHeading?.index) {
    return prompt.slice(contentStart).trim();
  }
  return prompt.slice(contentStart, contentStart + nextHeading.index).trim();
}

function parseInputSection(prompt) {
  const inputSection = extractSection(prompt, "Input");
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

function parseJsonObject(value) {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function extractTask(prompt) {
  return extractSection(prompt, "Task");
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function toStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
}

function inferHeadline(...values) {
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    const text = value.trim();
    if (text.toLowerCase().includes("hello world")) {
      return "hello world";
    }
    const zhMatch = text.match(/显示(.+?)(?:$|。|\.|，|,)/);
    if (zhMatch?.[1]?.trim()) {
      return zhMatch[1].trim();
    }
    const enMatch = text.match(/show\s+(.+?)(?:$|[.,])/i);
    if (enMatch?.[1]?.trim()) {
      return enMatch[1].trim();
    }
  }
  return "generated page";
}

function buildOfficeHoursPayload(args) {
  const headline = inferHeadline(args.task);
  return {
    content: `office-hours shaped a one-page delivery request for "${headline}"`,
    data: {
      intake: {
        workstream: "single-page-html",
        requestedHeadline: headline,
        deliveryArtifact: "shared/index.html",
        acceptanceChecks: [
          "headline is visible above the fold",
          "output stays in one html file",
          "artifact can be reviewed before deploy"
        ]
      }
    }
  };
}

function buildQaPayload(args) {
  const headline = inferHeadline(
    args.input.releaseCandidate?.headline,
    args.input.requestedHeadline,
    args.task
  );
  const releaseCandidate = {
    headline,
    artifactKind: "single-page-html",
    acceptanceChecks: [
      "render the requested headline",
      "ship as one shared html artifact",
      "keep the deploy payload compact for the next step"
    ],
    qaSummary: "ready for runtime-native ship review"
  };
  return {
    content: JSON.stringify({ releaseCandidate }, null, 2),
    data: {
      releaseCandidate
    }
  };
}

function buildShipPayload(args) {
  const upstreamPayload = parseJsonObject(firstNonEmptyString(args.input.previous_ship_output));
  const qaReleaseCandidate =
    typeof upstreamPayload.releaseCandidate === "object" && upstreamPayload.releaseCandidate !== null
      ? upstreamPayload.releaseCandidate
      : {};
  const headline = inferHeadline(
    qaReleaseCandidate.headline,
    args.input.previous_ship_output,
    args.task
  );
  const reviewerComment = firstNonEmptyString(args.input.human_review_comment);
  const reviewerRound =
    typeof args.input.human_review_round === "number" ? args.input.human_review_round : undefined;
  const acceptanceChecks = toStringArray(qaReleaseCandidate.acceptanceChecks);
  const releaseCandidate = {
    candidateId: reviewerRound ? `ship-rc-r${reviewerRound}` : "ship-rc-r1",
    headline,
    artifactKind: "single-page-html",
    acceptanceChecks:
      acceptanceChecks.length > 0
        ? acceptanceChecks
        : [
            "render the requested headline",
            "keep the final artifact readable without runtime prompt shell",
            "deploy into shared/index.html"
          ],
    reviewerComment: reviewerComment || undefined,
    previousDraftSummary: firstNonEmptyString(args.input.previous_ship_output) || undefined
  };

  return {
    content: JSON.stringify(
      {
        releaseCandidate,
        deploy: {
          headline,
          title: headline,
          summary: reviewerComment
            ? `reworked after review: ${reviewerComment}`
            : "approved for runtime-native human review",
          body: `A compact delivery page for "${headline}" generated by ogs-gstacklike.`,
          artifactPath: "shared/index.html"
        }
      },
      null,
      2
    ),
    data: {
      releaseCandidate,
      deploy: {
        headline,
        title: headline,
        summary: reviewerComment
          ? `reworked after review: ${reviewerComment}`
          : "approved for runtime-native human review",
        body: `A compact delivery page for "${headline}" generated by ogs-gstacklike.`,
        artifactPath: "shared/index.html"
      }
    }
  };
}

function buildRetroPayload(args) {
  const deployResult =
    typeof args.input.deploy_result === "object" && args.input.deploy_result !== null
      ? args.input.deploy_result
      : {};
  const headline = inferHeadline(deployResult.headline, args.task);
  return {
    content: `retro recorded the release outcome for "${headline}"`,
    data: {
      retrospective: {
        headline,
        artifactPath: firstNonEmptyString(deployResult.outputPath) || "shared/index.html",
        highlights: [
          "runtime review blocked deploy until approval landed",
          "shared artifact stayed at the run level",
          "post-ship learning can inspect one compact payload chain"
        ]
      }
    }
  };
}

function buildLearnPayload(args) {
  const retrospective =
    typeof args.input.retrospective === "object" && args.input.retrospective !== null
      ? args.input.retrospective
      : {};
  const headline = inferHeadline(retrospective.headline, args.task);
  return {
    content: `learn captured follow-up guidance for "${headline}"`,
    data: {
      lessons: {
        keep: [
          "runtime-native review on ship keeps operator approval explicit",
          "deploy payload should stay smaller than the ship draft artifact"
        ],
        automate: ["regression-check shared/index.html for prompt leakage"],
        watch: headline
      }
    }
  };
}

function buildDefaultPayload(args) {
  return {
    content: `${args.roleId} completed with event ${args.event}`,
    data: {
      roleId: args.roleId,
      actor: args.actor,
      envVar: envVarName
    }
  };
}

function buildRolePayload(args) {
  if (args.roleId === "office-hours") {
    return buildOfficeHoursPayload(args);
  }
  if (args.roleId === "qa") {
    return buildQaPayload(args);
  }
  if (args.roleId === "ship") {
    return buildShipPayload(args);
  }
  if (args.roleId === "retro") {
    return buildRetroPayload(args);
  }
  if (args.roleId === "learn") {
    return buildLearnPayload(args);
  }
  return buildDefaultPayload(args);
}

const prompt = await readPromptFromStdin();
const event = process.env[envVarName] ?? defaultEvent;
const actor = process.env.ROLE_ACTOR ?? process.env.USER ?? "operator";
const task = extractTask(prompt);
const input = parseInputSection(prompt);
const payload = buildRolePayload({
  roleId,
  event,
  actor,
  task,
  input
});

console.log(
  JSON.stringify({
    event,
    content: payload.content,
    data: {
      roleId,
      actor,
      ...payload.data
    }
  })
);
