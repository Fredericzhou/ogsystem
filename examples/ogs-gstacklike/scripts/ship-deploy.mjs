import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeDeployPayload(input) {
  const deployPayload = (() => {
    if (typeof input.deploy_payload === "object" && input.deploy_payload !== null) {
      return input.deploy_payload;
    }
    if (typeof input.deploy === "object" && input.deploy !== null) {
      return input.deploy;
    }
    return {};
  })();
  const releaseCandidate =
    typeof input.release_candidate === "object" && input.release_candidate !== null
      ? input.release_candidate
      : typeof input.releaseCandidate === "object" && input.releaseCandidate !== null
        ? input.releaseCandidate
        : {};
  const headline = firstNonEmptyString(
    deployPayload.headline,
    releaseCandidate.headline
  ) || "generated page";

  return {
    headline,
    title: firstNonEmptyString(deployPayload.title, headline) || headline,
    summary:
      firstNonEmptyString(deployPayload.summary) ||
      "delivery artifact written by the ship-deploy step",
    body:
      firstNonEmptyString(deployPayload.body) ||
      `A compact html delivery page for "${headline}".`,
    artifactPath:
      firstNonEmptyString(deployPayload.artifactPath) || "shared/index.html"
  };
}

function buildHtmlDocument(payload) {
  const safeHeadline = escapeHtml(payload.headline);
  const safeTitle = escapeHtml(payload.title);
  const safeSummary = escapeHtml(payload.summary);
  const safeBody = escapeHtml(payload.body);
  const safeArtifactPath = escapeHtml(payload.artifactPath);

  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${safeTitle}</title>`,
    "  <style>",
    "    :root {",
    "      color-scheme: light;",
    "      --bg-top: #f7efe5;",
    "      --bg-bottom: #d9e7f2;",
    "      --ink: #1f1b17;",
    "      --muted: #645a51;",
    "      --surface: rgba(255, 250, 244, 0.86);",
    "      --border: rgba(54, 46, 39, 0.1);",
    "      --accent: #b35c2e;",
    "    }",
    "    * { box-sizing: border-box; }",
    "    body {",
    "      margin: 0;",
    "      min-height: 100vh;",
    "      display: grid;",
    "      place-items: center;",
    "      padding: 32px 20px;",
    "      background:",
    "        radial-gradient(circle at top left, rgba(255, 255, 255, 0.92), transparent 42%),",
    "        linear-gradient(145deg, var(--bg-top), var(--bg-bottom));",
    '      font-family: "Avenir Next", "Segoe UI", sans-serif;',
    "      color: var(--ink);",
    "    }",
    "    main {",
    "      width: min(760px, 100%);",
    "      padding: 40px 36px;",
    "      border: 1px solid var(--border);",
    "      border-radius: 28px;",
    "      background: var(--surface);",
    "      box-shadow: 0 24px 80px rgba(31, 27, 23, 0.12);",
    "      backdrop-filter: blur(14px);",
    "    }",
    "    .eyebrow {",
    "      display: inline-flex;",
    "      margin-bottom: 14px;",
    "      padding: 6px 12px;",
    "      border-radius: 999px;",
    "      background: rgba(179, 92, 46, 0.12);",
    "      color: var(--accent);",
    "      font-size: 12px;",
    "      letter-spacing: 0.12em;",
    "      text-transform: uppercase;",
    "    }",
    "    h1 {",
    "      margin: 0 0 16px;",
    "      font-size: clamp(42px, 8vw, 76px);",
    "      line-height: 0.94;",
    "    }",
    "    p {",
    "      margin: 0 0 14px;",
    "      font-size: 17px;",
    "      line-height: 1.7;",
    "      color: var(--muted);",
    "    }",
    "    .artifact {",
    "      display: inline-block;",
    "      margin-top: 10px;",
    "      padding: 10px 14px;",
    "      border-radius: 12px;",
    "      background: rgba(31, 27, 23, 0.06);",
    "      font-size: 14px;",
    "      color: var(--ink);",
    "    }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    '    <div class="eyebrow">OGS Delivery</div>',
    `    <h1>${safeHeadline}</h1>`,
    `    <p>${safeSummary}</p>`,
    `    <p>${safeBody}</p>`,
    `    <div class="artifact">${safeArtifactPath}</div>`,
    "  </main>",
    "</body>",
    "</html>",
    ""
  ].join("\n");
}

if (process.env.SHIP_DEPLOY_FAIL === "1") {
  console.error("deploy failed: simulated release verification failure");
  process.exit(23);
}

const prompt = await readPromptFromStdin();
const sharedDir = process.env.OGSYSTEM_SHARED_DIR;

if (!sharedDir) {
  console.error("missing OGSYSTEM_SHARED_DIR");
  process.exit(24);
}

const payload = normalizeDeployPayload(parseInputSection(prompt));
const outputPath = join(sharedDir, "index.html");

await mkdir(sharedDir, { recursive: true });
await writeFile(outputPath, buildHtmlDocument(payload), "utf8");

console.log(
  JSON.stringify({
    event: "SHIPPED",
    content: `ship-deploy published ${payload.headline} to ${outputPath}`,
    data: {
      roleId: "ship-deploy",
      actor: process.env.ROLE_ACTOR ?? process.env.USER ?? "operator",
      outputPath,
      headline: payload.headline,
      deploySummary: payload.summary
    }
  })
);
