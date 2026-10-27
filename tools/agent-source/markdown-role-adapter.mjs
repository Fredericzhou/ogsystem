import { createHash } from "node:crypto";
import { basename } from "node:path";
import { parseDocument } from "yaml";

const MAX_SOURCE_BYTES = 1024 * 1024;
const TEAM_ROLE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ROLE_FILES = new Set(["agent.md", "prompt.md", "role.json", "output.schema.json", "source.json"]);

export const OG_PROMPT_TEMPLATE = [
  "{{agent}}",
  "",
  "Return one JSON object only.",
  "",
  "Allowed events:",
  "{{allowed_events}}",
  "",
  "User preferences:",
  "{{user_preferences}}",
  "",
  "Task:",
  "{{task}}",
  "",
  "Input:",
  "{{input}}",
  "",
  "Output requirements:",
  "- Choose the most appropriate event from allowed_events.",
  "- Use NEEDS_CLARIFICATION when the task or input is underspecified.",
  "- Use BLOCKED when you cannot proceed without an external dependency or missing access.",
  "- Put the main answer in content and optional structured details in data."
].join("\n");

export const OG_RUNTIME_PROMPT_VARIABLES = new Set([
  "agent",
  "allowed_events",
  "user_preferences",
  "task",
  "input"
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertStringMetadata(metadata, key, maxLength = 5000) {
  if (metadata[key] === undefined || metadata[key] === null) return undefined;
  if (typeof metadata[key] !== "string" || metadata[key].length > maxLength) {
    fail("AGENT_FRONTMATTER_FIELD_INVALID", `Front matter field '${key}' must be a string of at most ${maxLength} characters`);
  }
  return metadata[key];
}

function parseSafeYaml(yamlText) {
  const document = parseDocument(yamlText, {
    schema: "core",
    uniqueKeys: true,
    prettyErrors: false,
    strict: true
  });
  if (document.errors.length) {
    fail("AGENT_FRONTMATTER_INVALID", document.errors.map((error) => error.message).join("; "));
  }
  const value = document.toJS({ mapAsMap: false });
  if (!isPlainObject(value)) fail("AGENT_FRONTMATTER_INVALID", "Front matter must be a YAML mapping");

  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && !["string", "number", "boolean"].includes(typeof entry)) {
      fail("AGENT_FRONTMATTER_FIELD_INVALID", `Front matter field '${key}' must be a scalar`);
    }
  }
  return value;
}

/** Parse leading YAML front matter without changing any byte of the Markdown body. */
export function parseMarkdownRole(sourceText, options = {}) {
  if (typeof sourceText !== "string") fail("AGENT_SOURCE_INVALID", "Markdown source must be text");
  const sourceBytes = Buffer.byteLength(sourceText, "utf8");
  if (sourceBytes > (options.maxSourceBytes ?? MAX_SOURCE_BYTES)) {
    fail("AGENT_SOURCE_TOO_LARGE", `Markdown source exceeds ${options.maxSourceBytes ?? MAX_SOURCE_BYTES} bytes`);
  }

  const text = sourceText.startsWith("\uFEFF") ? sourceText.slice(1) : sourceText;
  const opening = /^(?:---)[ \t]*(?:\r?\n)/.exec(text);
  if (!opening) fail("AGENT_FRONTMATTER_MISSING", "Markdown must begin with YAML front matter");

  const bodyStart = opening[0].length;
  const closingPattern = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;
  closingPattern.lastIndex = bodyStart;
  const closing = closingPattern.exec(text);
  if (!closing) fail("AGENT_FRONTMATTER_UNTERMINATED", "YAML front matter has no closing delimiter");

  const yamlText = text.slice(bodyStart, closing.index);
  const body = text.slice(closing.index + closing[0].length);
  const metadata = parseSafeYaml(yamlText);
  const name = assertStringMetadata(metadata, "name", 160);
  if (!name?.trim()) fail("AGENT_FRONTMATTER_FIELD_INVALID", "Front matter field 'name' is required and must not be empty");
  const description = assertStringMetadata(metadata, "description", 2000);
  const color = assertStringMetadata(metadata, "color", 32);
  const emoji = assertStringMetadata(metadata, "emoji", 32);
  const vibe = assertStringMetadata(metadata, "vibe", 300);
  const language = assertStringMetadata(metadata, "language", 35) ?? "und";

  return {
    name: name.trim(),
    description: description?.trim() ?? "",
    category: options.category ?? "uncategorized",
    language: language.trim() || "und",
    body,
    metadata: { color, emoji, vibe },
    sourceMetadata: metadata,
    sourceDigest: sha256(sourceText)
  };
}

export function slugifyTeamRoleName(value, sourcePath = "") {
  const normalized = String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized) return normalized.slice(0, 64).replace(/-+$/g, "");
  const fileSlug = basename(sourcePath).replace(/\.[^.]*$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (fileSlug) return fileSlug.slice(0, 64).replace(/-+$/g, "");
  return `role-${sha256(sourcePath).slice(0, 10)}`;
}

function normalizeStringList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    fail("AGENT_CONFIRMATION_INVALID", `${label} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((item) => item.trim()))].sort();
}

function assertSafeSourcePath(sourcePath) {
  if (typeof sourcePath !== "string" || !sourcePath || sourcePath.startsWith("/") || sourcePath.includes("\\")) {
    fail("AGENT_SOURCE_PATH_INVALID", "Source path must be a relative POSIX path");
  }
  const segments = sourcePath.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || part.includes(":") || part.includes("\0"))) {
    fail("AGENT_SOURCE_PATH_INVALID", "Source path contains an unsafe segment");
  }
}

/** Convert a source Markdown file into an unverified Team Draft role package. */
export function convertMarkdownRole(args) {
  const { sourceText, sourceId, gitUrl, commit, sourcePath, adapterId, adapterVersion } = args ?? {};
  assertSafeSourcePath(sourcePath);
  if (typeof sourceId !== "string" || !sourceId) fail("AGENT_SOURCE_INVALID", "sourceId is required");
  if (typeof commit !== "string" || !/^[a-f0-9]{40}$/i.test(commit)) fail("AGENT_SOURCE_INVALID", "commit must be a full 40-character SHA");
  if (typeof gitUrl !== "string" || !/^https:\/\//.test(gitUrl)) fail("AGENT_SOURCE_INVALID", "gitUrl must use HTTPS");
  if (typeof adapterId !== "string" || !adapterId || typeof adapterVersion !== "string" || !adapterVersion) {
    fail("AGENT_SOURCE_INVALID", "adapterId and adapterVersion are required");
  }

  const parsed = parseMarkdownRole(sourceText, { category: args.category });
  const roleId = args.roleId ?? slugifyTeamRoleName(parsed.name, sourcePath);
  if (!TEAM_ROLE_ID.test(roleId)) fail("TEAM_ROLE_ID_INVALID", `Invalid Team role ID '${roleId}'`);

  const outputEvents = normalizeStringList(args.outputEvents, "outputEvents");
  const allowedTools = normalizeStringList(args.allowedTools, "allowedTools");
  const identityConfirmed = args.identityConfirmed === true;
  const verified = identityConfirmed && Array.isArray(args.outputEvents) && Array.isArray(args.allowedTools);
  const description = parsed.description || `${parsed.name} imported from ${sourceId}`;
  const prompt = OG_PROMPT_TEMPLATE;
  const promptVariables = [...prompt.matchAll(/\{\{([a-zA-Z0-9_.-]+)\}\}/g)].map((match) => match[1]);
  if (promptVariables.some((key) => !OG_RUNTIME_PROMPT_VARIABLES.has(key))) {
    fail("AGENT_PROMPT_TEMPLATE_INVALID", "Generated prompt uses a variable unsupported by the OGSystem runtime");
  }

  const role = {
    roleId,
    roleVersion: `source-${commit.slice(0, 12)}`,
    name: parsed.name,
    description,
    promptTemplate: "prompt.md",
    outputSchema: "output.schema.json",
    contractVersion: 1,
    purpose: "Perform the responsibilities described in the role instructions.",
    responsibility: { kind: "atomic", owns: [], contributes: [], doesNotOwn: [] },
    inputs: { preconditions: [] },
    outputs: { events: outputEvents, postconditions: [] },
    authority: { controlActions: [] },
    constraints: { writableStateFields: [], allowedTools },
    failure: { retryableErrorCodes: [], terminalErrorCodes: [] },
    audit: { requiredFields: [] },
    tags: ["imported", sourceId, parsed.category].filter(Boolean)
  };
  const outputSchema = {
    type: "object",
    properties: {
      event: outputEvents.length ? { type: "string", enum: outputEvents } : { type: "string" },
      content: { type: "string" },
      data: { type: "object", additionalProperties: true }
    },
    required: ["event"],
    additionalProperties: false
  };
  const source = {
    version: 1,
    sourceId,
    gitUrl: gitUrl.replace(/\.git$/, ""),
    commit: commit.toLowerCase(),
    path: sourcePath,
    adapterId,
    adapterVersion,
    language: parsed.language,
    sourceContentDigest: parsed.sourceDigest,
    importedAt: args.importedAt ?? new Date().toISOString()
  };
  const files = {
    "agent.md": parsed.body,
    "prompt.md": prompt,
    "role.json": `${JSON.stringify(role, null, 2)}\n`,
    "output.schema.json": `${JSON.stringify(outputSchema, null, 2)}\n`,
    "source.json": `${JSON.stringify(source, null, 2)}\n`
  };
  if (Object.keys(files).some((file) => !ROLE_FILES.has(file))) fail("AGENT_PACKAGE_INVALID", "Generated role package contains an unsupported file");

  return {
    roleId,
    files,
    role,
    source,
    display: {
      name: parsed.name,
      description: parsed.description,
      category: parsed.category,
      language: parsed.language,
      icon: parsed.metadata.emoji ? { kind: "text", value: parsed.metadata.emoji } : null,
      color: /^#[0-9a-f]{6}$/i.test(parsed.metadata.color ?? "") ? parsed.metadata.color : null,
      vibe: parsed.metadata.vibe
    },
    verification: {
      status: verified ? "ready-for-validation" : "unverified",
      missingConfirmations: [
        ...(!identityConfirmed ? ["roleIdentity"] : []),
        ...(!Array.isArray(args.outputEvents) ? ["outputEvents"] : []),
        ...(!Array.isArray(args.allowedTools) ? ["allowedTools"] : [])
      ]
    }
  };
}
