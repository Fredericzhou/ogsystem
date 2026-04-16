/**
 * @fileoverview Prompt/schema builders for NL2MMD model turns.
 * File Set: nl2mmd-prompt
 * Responsibilities:
 * - Build strict response schema for NL2MMD interaction loop.
 * - Render system/turn prompts with context, hints, and validation feedback.
 * Boundaries:
 * - Prompt construction only; no model execution.
 */
import { resolveRoleMentions } from "./catalog.js";
import { detectSemanticHints, searchModels, searchRoles } from "./semantic-map.js";
import type { Nl2MmdContext, Nl2MmdTurnInput } from "./types.js";

export function getNl2MmdTurnSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: [
      "mode",
      "summary",
      "questions",
      "assumptions",
      "referencedRoles",
      "unresolvedItems",
      "mermaid"
    ],
    properties: {
      mode: {
        type: "string",
        enum: ["ask", "draft", "final"]
      },
      summary: {
        type: "string"
      },
      questions: {
        type: "array",
        maxItems: 3,
        items: {
          type: "string"
        }
      },
      assumptions: {
        type: "array",
        items: {
          type: "string"
        }
      },
      referencedRoles: {
        type: "array",
        items: {
          type: "string"
        }
      },
      unresolvedItems: {
        type: "array",
        items: {
          type: "string"
        }
      },
      mermaid: {
        type: "string"
      }
    },
    additionalProperties: false
  };
}

export function buildNl2MmdSystemPrompt(context: Nl2MmdContext): string {
  const dictionary = context.supportedDictionary;
  const laws = context.lawIds.length > 0 ? context.lawIds.join(", ") : "(no local laws discovered)";

  return [
    "You are the OGSystem natural-language-to-Mermaid planner.",
    "Goal: convert user discussion into a runnable OGSystem system.mmd for the current graph runtime.",
    "",
    "Conversation policy:",
    "1. First analyze the user request and resolve any @roleId mentions against the role catalog.",
    "2. If key information is missing or ambiguous, set mode=ask and ask at most 3 concrete questions.",
    "3. When the request is specific enough, set mode=draft or mode=final and output one Mermaid graph string.",
    "4. Never exceed current OGSystem support. Do not invent unsupported syntax, metadata, or routing modes.",
    "5. Prefer existing role ids from the role repo. If the user mentions an unknown @roleId, keep it in unresolvedItems and ask for clarification.",
    "6. Keep the system prompt compact; use the turn prompt's ranked role/model suggestions instead of restating full catalogs.",
    "",
    "Authoring rules:",
    "- Mermaid header must be one of: " + dictionary.flowcharts.join(", "),
    "- Mermaid header must appear exactly once and be the first non-empty line",
    "- Boundary tokens are only: " + dictionary.boundaryTokens.join(", "),
    "- Node token pattern: " + dictionary.nodeTokenPattern,
    "- Edge pattern: " + dictionary.edgePattern,
    "- Every edge endpoint must be either input/output or an explicit role token nodeId[Role:roleId]",
    "- Never emit standalone node declaration lines like nodeId[Role:roleId]",
    "- join.mode.<roleId> and join.sources.<roleId> belong on the receiving merge role, and join.sources must match that role's incoming Mermaid edges exactly",
    "- Exact metadata keys allowed: " + dictionary.exactMetadataKeys.join(", "),
    "- Metadata prefixes allowed: " + dictionary.metadataPrefixes.join(", "),
    "- Flow-contract metadata are also supported: handoff.mode, handoff.contracts, and route.order.<fromRoleId>",
    "- role.mode values allowed: " + dictionary.roleModes.join(", "),
    "- join.mode values allowed: " + dictionary.joinModes.join(", "),
    "- loop.max must be a positive integer",
    "- engine is compatibility-only and may only be langgraph when explicitly needed",
    "- entry.role must exist in the graph",
    "- Every role with execution intent should use model.bind.<roleId> with a discovered model id unless the user explicitly requests legacy exec.bind compatibility",
    "- Event names must be uppercase snake case and must match outgoing role schema enums when using known roles",
    "",
    "Output policy:",
    "- mode=ask: mermaid must be an empty string",
    "- mode=draft or mode=final: mermaid must contain only Mermaid source, no markdown fences",
    "- summary must be concise and operator-oriented",
    "- assumptions should be explicit whenever you infer missing details",
    "- referencedRoles should list role ids you intentionally used",
    "- unresolvedItems should list open blockers or unsupported requests",
    "",
    `Available laws: ${laws}`,
    "",
    `Local role count: ${context.roleCatalog.length}`,
    `Local model count: ${context.modelCatalog.length}`
  ].join("\n");
}

export function buildNl2MmdTurnPrompt(args: {
  context: Nl2MmdContext;
  input: Nl2MmdTurnInput;
}): string {
  const mentions = resolveRoleMentions(args.input.message, args.context);
  const roleMatches = searchRoles(args.context, args.input.message, 5);
  const modelMatches = searchModels(args.context, args.input.message, 5);
  const semanticHints = detectSemanticHints(args.input.message);
  const mentionSummary =
    mentions.length > 0
      ? mentions
          .map((item) => `${item.mention}:${item.exists ? "resolved" : "missing"}`)
          .join(", ")
      : "(none)";
  const roleSummary =
    roleMatches.length > 0
      ? roleMatches
          .map((item) => `${item.item.roleId} (${item.reason})`)
          .join("\n")
      : "(none)";
  const modelSummary =
    modelMatches.length > 0
      ? modelMatches
          .map((item) => `${item.item.modelId} (${item.reason})`)
          .join("\n")
      : "(none)";
  const hintSummary =
    semanticHints.length > 0
      ? semanticHints.map((item) => `${item.label}: ${item.detail}`).join("\n")
      : "(none)";

  return [
    "User message:",
    args.input.message,
    "",
    `Resolved @role mentions: ${mentionSummary}`,
    "",
    "Suggested role matches:",
    roleSummary,
    "",
    "Suggested model matches:",
    modelSummary,
    "",
    "Detected semantic hints:",
    hintSummary,
    "",
    "Current draft Mermaid:",
    args.input.draftMermaid?.trim() || "(none)",
    "",
    "Validator errors:",
    args.input.validationErrors?.length ? args.input.validationErrors.join("\n") : "(none)",
    "",
    "Validator warnings:",
    args.input.validationWarnings?.length ? args.input.validationWarnings.join("\n") : "(none)",
    "",
    "Return only the JSON object required by the schema."
  ].join("\n");
}
