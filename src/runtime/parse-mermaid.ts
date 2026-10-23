/**
 * @fileoverview Parser and validator for OGSystem restricted Mermaid DSL.
 * File Set: runtime-core
 * Responsibilities:
 * - Tokenize/parse Mermaid source into graph tokens.
 * - Validate metadata, bindings, join/loop/context invariants, and compile SystemDefinition.
 * Boundaries:
 * - No runtime execution; compile-time checks only.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { isRuntimeOnlyErrorEvent } from "./error-flow-utils.js";
import { hasJoinModeHandler, hasRoutingModeHandler } from "./graph-mode-registry.js";
import { createRuntimeError, RuntimeError } from "./runtime-errors.js";
import {
  collectCycleComponents,
  summarizeContextSelector
} from "./static-semantics.js";
import { SYSTEM_END_ROLE_ID, SYSTEM_START_ROLE_ID } from "./types.js";
import type {
  Flow,
  GraphJoinMode,
  GraphMetadata,
  GraphRoutingMode,
  HumanReviewSpec,
  HandoffMode,
  RuntimeErrorStage,
  SystemDefinition
} from "./types.js";

/**
 * Parses a constrained Mermaid flowchart, validates runtime bindings, and compiles a
 * deterministic SystemDefinition that the runtime can trust without further DSL analysis.
 * Responsibilities: strict grammar, metadata resolution, join semantics, cycle budget checks.
 * Boundaries: rejects all unsupported selectors/edges and does not interpret execution data.
 * Trade-off: early validation ensures the runtime never runs ambiguous graphs, but it means
 * Mermaid surfaces must follow the exact documented DSL or be rejected outright.
 */

type ParsedNodeToken =
  | {
      kind: "role";
      nodeId: string;
      roleId: string;
    }
  | {
      kind: "special-role";
      roleId: typeof SYSTEM_START_ROLE_ID | typeof SYSTEM_END_ROLE_ID;
      special: "start" | "end";
    };

type TokenizedEdge = {
  lineNumber: number;
  line: string;
  from: ParsedNodeToken;
  to: ParsedNodeToken;
  eventType: string;
};

type TokenizedMermaid = {
  metadata: Array<{ lineNumber: number; key: string; value: string }>;
  edges: TokenizedEdge[];
};

type ParsedErrorEdgeEvent =
  | {
      kind: "none";
    }
  | {
      kind: "invalid";
      reason: string;
    }
  | {
      kind: "fallback";
    }
  | {
      kind: "typed";
      code: string;
    };

type ParsedSystemGraph = {
  metadata: Map<string, string>;
  metadataLineByKey: Map<string, number>;
  roleByNode: Map<string, string>;
  nodeByRole: Map<string, string>;
  flows: Flow[];
  startFlows: Flow[];
};

// Fail-fast guard: runtime aborts parsing/validation on the first invariant violation.
function failMermaid(args: {
  stage: "parse" | "validate";
  errorCode: string;
  message: string;
  lineNumber?: number;
}): never {
  throw createRuntimeError({
    errorCode: args.errorCode,
    errorCategory: "validation",
    message: args.message,
    retryable: false,
    stage: args.stage,
    line: args.lineNumber
  });
}

type ValidatedSystemGraph = ParsedSystemGraph & {
  systemId: string;
  systemVersion: string;
  globalLawRef: string;
  entryRoleIds: string[];
  startDispatch: { mode: "all" } | { mode: "random_n"; count: number };
  startEventType: string;
  endJoin: { mode: "all_of" | "quorum_of"; min?: number };
  terminalRoleOrder: string[];
  roleIds: string[];
  executionBinding: Record<string, string>;
  modelBinding: Record<string, string>;
  graph?: GraphMetadata;
};

type ParsedContextMapMetadataKey = {
  roleId: string;
  fieldName: string;
};

function isSupportedJoinMode(value: string): value is GraphJoinMode {
  return value === "quorum_of" || hasJoinModeHandler(value);
}

function isSupportedHandoffMode(value: string): value is HandoffMode {
  return value === "strict" || value === "transition";
}

function parseContextMapMetadataKey(
  key: string,
  lineNumber?: number
): ParsedContextMapMetadataKey {
  const raw = key.slice("context.map.".length);
  const separatorIndex = raw.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 1) {
    failMermaid({
      stage: "validate",
      errorCode: "MERMAID_INVALID_CONTEXT_MAP_KEY",
      message: `Invalid metadata key "${key}". Expected context.map.<roleId>.<fieldName>.`,
      lineNumber
    });
  }

  const roleId = raw.slice(0, separatorIndex);
  const fieldName = raw.slice(separatorIndex + 1);
  return { roleId, fieldName };
}

function validateContextSelector(args: {
  selector: string;
  targetRoleId: string;
  roleIds: string[];
  joinModeByRoleId: Record<string, GraphJoinMode>;
  joinSourcesByRoleId: Record<string, string[]>;
  joinMinByRoleId: Record<string, number>;
  metadataKey: string;
  lineNumber?: number;
}): void {
  const selector = args.selector;
  const selectorInfo = summarizeContextSelector(selector);
  const fail = (errorCode: string, message: string): never =>
    failMermaid({
      stage: "validate",
      errorCode,
      message,
      lineNumber: args.lineNumber
    });
  const isJoinNode = args.joinModeByRoleId[args.targetRoleId] !== undefined;

  if (selectorInfo.selectorKind === "global.task" || selectorInfo.selectorKind === "global.user_profile") {
    return;
  }

  if (selectorInfo.selectorKind === "global.user_profile.path") {
    if (!selectorInfo.validPath) {
      fail(
        "MERMAID_INVALID_SELECTOR",
        `${args.metadataKey} uses unsupported selector "${selector}".`
      );
    }
    return;
  }

  if (
    selectorInfo.selectorKind === "global.human_review.current" ||
    selectorInfo.selectorKind === "global.human_review.current.comment" ||
    selectorInfo.selectorKind === "global.human_review.current.round" ||
    selectorInfo.selectorKind === "global.human_review.current.previous_output"
  ) {
    return;
  }

  if (selectorInfo.selectorKind === "global.human_review.current.previous_output.path") {
    if (!selectorInfo.validPath) {
      fail(
        "MERMAID_INVALID_SELECTOR",
        `${args.metadataKey} uses unsupported selector "${selector}".`
      );
    }
    return;
  }

  if (selectorInfo.selectorKind === "direct") {
    if (isJoinNode) {
      fail(
        "MERMAID_JOIN_SELECTOR_NOT_ALLOWED",
        `${args.metadataKey} uses "${selector}" but join nodes do not allow direct.* selectors.`
      );
    }
    return;
  }

  if (selectorInfo.selectorKind === "direct.data.path") {
    if (isJoinNode) {
      fail(
        "MERMAID_JOIN_SELECTOR_NOT_ALLOWED",
        `${args.metadataKey} uses "${selector}" but join nodes do not allow direct.* selectors.`
      );
    }
    if (!selectorInfo.validPath) {
      fail(
        "MERMAID_INVALID_SELECTOR",
        `${args.metadataKey} uses unsupported selector "${selector}".`
      );
    }
    return;
  }

  if (selectorInfo.selectorKind === "source") {
    if (!isJoinNode) {
      fail(
        "MERMAID_JOIN_SELECTOR_REQUIRES_JOIN_MODE",
        `${args.metadataKey} uses join-only selector "${selector}" on non-join role "${args.targetRoleId}".`
      );
    }
    const sourceRoleId = selectorInfo.sourceRoleId ?? "";
    if (!args.roleIds.includes(sourceRoleId)) {
      fail(
        "MERMAID_UNDEFINED_ROLE_REF",
        `${args.metadataKey} references undefined role "${sourceRoleId}" in selector "${selector}".`
      );
    }
    const allowedJoinSources = args.joinSourcesByRoleId[args.targetRoleId] ?? [];
    if (!allowedJoinSources.includes(sourceRoleId)) {
      fail(
        "MERMAID_JOIN_SELECTOR_SOURCE_NOT_ALLOWED",
        `${args.metadataKey} references source("${sourceRoleId}") not declared in join.sources.${args.targetRoleId}.`
      );
    }
    if (args.joinModeByRoleId[args.targetRoleId] === "quorum_of") {
      const requiredSources = args.joinSourcesByRoleId[args.targetRoleId] ?? [];
      const joinMin = args.joinMinByRoleId[args.targetRoleId];
      if (joinMin !== undefined && joinMin < requiredSources.length) {
        fail(
          "MERMAID_JOIN_SELECTOR_SOURCE_NOT_ALLOWED",
          `${args.metadataKey} uses source("${sourceRoleId}") but join.mode.${args.targetRoleId}=quorum_of with join.min.${args.targetRoleId}=${joinMin} below join.sources size ${requiredSources.length}.`
        );
      }
    }
    return;
  }

  fail(
    "MERMAID_INVALID_SELECTOR",
    `${args.metadataKey} uses unsupported selector "${selector}".`
  );
}

/**
 * Parsing is intentionally strict. A narrow node grammar keeps Mermaid readable and lets the
 * runtime reject ambiguous surface syntax before semantic validation begins.
 */
function parseNodeToken(token: string, lineNumber?: number): ParsedNodeToken {
  const trimmed = token.trim();
  const normalized = trimmed.toLowerCase();
  if (trimmed === "start[开始]") {
    return {
      kind: "special-role",
      roleId: SYSTEM_START_ROLE_ID,
      special: "start"
    };
  }
  if (trimmed === "end[结束]") {
    return {
      kind: "special-role",
      roleId: SYSTEM_END_ROLE_ID,
      special: "end"
    };
  }
  if (normalized === "start" || normalized === "end") {
    failMermaid({
      stage: "parse",
      errorCode: "MERMAID_UNSUPPORTED_BOUNDARY_TOKEN",
      message: `Unsupported system node "${trimmed}". Use explicit start[开始] and end[结束] special roles.`,
      lineNumber
    });
  }
  const match = trimmed.match(/^([A-Za-z0-9._:-]+)\[Role:([A-Za-z][A-Za-z0-9._:-]*)\]$/);
  if (!match) {
    failMermaid({
      stage: "parse",
      errorCode: "MERMAID_INVALID_NODE_TOKEN",
      message: `Invalid node token "${token}". Expected nodeId[Role:roleId], start[开始], or end[结束].`,
      lineNumber
    });
  }
  return {
    kind: "role",
    nodeId: match[1],
    roleId: match[2]
  };
}

function parseMetadataLine(
  line: string,
  lineNumber: number
): { lineNumber: number; key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("%%")) {
    return null;
  }
  const raw = trimmed.slice(2).trim();
  const idx = raw.indexOf("=");
  if (idx < 0) {
    return null;
  }
  const key = raw.slice(0, idx).trim();
  const value = raw.slice(idx + 1).trim();
  if (!key || !value) {
    return null;
  }
  return { lineNumber, key, value };
}

function parseEdgeLine(line: string, lineNumber: number): TokenizedEdge | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("%%")) {
    return null;
  }
  const match = trimmed.match(/^(.+?)\s*-->\|(.+?)\|\s*(.+)$/);
  if (!match) {
    return null;
  }
  const eventType = match[2].trim();
  if (!eventType) {
    failMermaid({
      stage: "parse",
      errorCode: "MERMAID_EMPTY_EVENT_TYPE",
      message: `Empty event type in line: ${line}`,
      lineNumber
    });
  }
  return {
    lineNumber,
    line: trimmed,
    from: parseNodeToken(match[1], lineNumber),
    to: parseNodeToken(match[3], lineNumber),
    eventType
  };
}

function parseErrorEdgeEvent(eventType: string): ParsedErrorEdgeEvent {
  if (eventType === "ERROR") {
    return { kind: "fallback" };
  }
  if (eventType.startsWith("ERROR.")) {
    const code = eventType.slice("ERROR.".length);
    if (!code) {
      return {
        kind: "invalid",
        reason: 'typed error edge must use "ERROR.<errorCode>" with a non-empty <errorCode>'
      };
    }
    if (/\s/.test(code)) {
      return {
        kind: "invalid",
        reason: "typed error edge code must not contain whitespace"
      };
    }
    return {
      kind: "typed",
      code
    };
  }
  if (eventType.startsWith("ERROR")) {
    return {
      kind: "invalid",
      reason: 'reserved ERROR* events must be exactly "ERROR" or "ERROR.<errorCode>"'
    };
  }
  return { kind: "none" };
}

/**
 * tokenizeMermaidSource performs the first pass of parsing.
 * It extracts metadata (starting with %%) and edges (role transitions).
 */
function tokenizeMermaidSource(source: string): TokenizedMermaid {
  const lines = source.split(/\r?\n/);
  const metadata: Array<{ lineNumber: number; key: string; value: string }> = [];
  const edges: TokenizedEdge[] = [];
  let flowchartFound = false;

  // The very first non-empty line must declare the flowchart orientation so we avoid ambiguous graphs.
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (!flowchartFound) {
      const flowchartMatch = trimmed.match(/^flowchart\s+(TD|LR)$/);
      if (!flowchartMatch) {
        failMermaid({
          stage: "parse",
          errorCode: "MERMAID_INVALID_HEADER",
          message: `First non-empty line must be "flowchart TD" or "flowchart LR". Got: ${trimmed}`,
          lineNumber
        });
      }
      flowchartFound = true;
      continue;
    }

    const metadataItem = parseMetadataLine(line, lineNumber);
    if (metadataItem) {
      metadata.push(metadataItem);
      continue;
    }

    const edge = parseEdgeLine(line, lineNumber);
    if (!edge) {
      failMermaid({
        stage: "parse",
        errorCode: "MERMAID_INVALID_EXECUTABLE_LINE",
        message: `Invalid executable line: "${trimmed}". Allowed lines: metadata comments and event edges.`,
        lineNumber
      });
    }
    edges.push(edge);
  }

  if (!flowchartFound) {
    failMermaid({
      stage: "parse",
      errorCode: "MERMAID_MISSING_HEADER",
      message: 'Missing "flowchart TD|LR" header',
      lineNumber: 1
    });
  }

  return { metadata, edges };
}

function parseTokenizedMermaid(tokens: TokenizedMermaid): ParsedSystemGraph {
  const metadata = new Map<string, string>();
  const metadataLineByKey = new Map<string, number>();
  const roleByNode = new Map<string, string>();
  const nodeByRole = new Map<string, string>();
  const flows: Flow[] = [];
  const startFlows: Flow[] = [];
  const fallbackErrorLineByFromRole = new Map<string, number>();
  const typedErrorLineByFromRole = new Map<string, Map<string, number>>();

  for (const item of tokens.metadata) {
    const duplicateLine = metadataLineByKey.get(item.key);
    if (duplicateLine !== undefined) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_DUPLICATE_METADATA_KEY",
        message: `Duplicate metadata key "${item.key}" at line ${item.lineNumber}; first declared at line ${duplicateLine}`,
        lineNumber: item.lineNumber
      });
    }
    metadata.set(item.key, item.value);
    metadataLineByKey.set(item.key, item.lineNumber);
  }

  for (const edge of tokens.edges) {
    const parsedErrorEvent = parseErrorEdgeEvent(edge.eventType);
    if (parsedErrorEvent.kind === "invalid") {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_INVALID_ERROR_EDGE_EVENT",
        message: `Invalid error edge event "${edge.eventType}" at line ${edge.lineNumber}: ${parsedErrorEvent.reason}.`,
        lineNumber: edge.lineNumber
      });
    }

    for (const node of [edge.from, edge.to]) {
      if (node.kind !== "role") {
        continue;
      }

      const existingRole = roleByNode.get(node.nodeId);
      if (existingRole && existingRole !== node.roleId) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_DUPLICATE_NODE_ROLE",
          message: `Node "${node.nodeId}" maps to multiple role ids: "${existingRole}" vs "${node.roleId}"`,
          lineNumber: edge.lineNumber
        });
      }
      roleByNode.set(node.nodeId, node.roleId);

      const existingNode = nodeByRole.get(node.roleId);
      if (existingNode && existingNode !== node.nodeId) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_DUPLICATE_ROLE_NODE",
          message: `Role id "${node.roleId}" maps to multiple node ids: "${existingNode}" vs "${node.nodeId}"`,
          lineNumber: edge.lineNumber
        });
      }
      nodeByRole.set(node.roleId, node.nodeId);
    }

    if (edge.from.kind === "special-role") {
      if (edge.from.special !== "start" || edge.to.kind !== "role") {
        failMermaid({
          stage: "parse",
          errorCode: "MERMAID_INVALID_SPECIAL_ROLE_FLOW",
          message: `Special-role flow "${edge.line}" is invalid. Start can only connect to business roles.`,
          lineNumber: edge.lineNumber
        });
      }
      if (parsedErrorEvent.kind !== "none" || edge.eventType !== "START") {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_START_EVENT_INVALID",
          message: `All Start flows must use the shared structural event START.`,
          lineNumber: edge.lineNumber
        });
      }
      startFlows.push({ fromRoleId: SYSTEM_START_ROLE_ID, toRoleId: edge.to.roleId, eventType: "START" });
      continue;
    }

    if (parsedErrorEvent.kind === "fallback") {
      const duplicateLine = fallbackErrorLineByFromRole.get(edge.from.roleId);
      if (duplicateLine !== undefined) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_DUPLICATE_ERROR_FALLBACK_EDGE",
          message:
            `Role "${edge.from.roleId}" declares duplicate ERROR fallback edges ` +
            `(first declared at line ${duplicateLine}).`,
          lineNumber: edge.lineNumber
        });
      }
      fallbackErrorLineByFromRole.set(edge.from.roleId, edge.lineNumber);
    } else if (parsedErrorEvent.kind === "typed") {
      const seenCodes = typedErrorLineByFromRole.get(edge.from.roleId) ?? new Map<string, number>();
      const duplicateLine = seenCodes.get(parsedErrorEvent.code);
      if (duplicateLine !== undefined) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_DUPLICATE_ERROR_CODE_EDGE",
          message:
            `Role "${edge.from.roleId}" declares duplicate ERROR.${parsedErrorEvent.code} edges ` +
            `(first declared at line ${duplicateLine}).`,
          lineNumber: edge.lineNumber
        });
      }
      seenCodes.set(parsedErrorEvent.code, edge.lineNumber);
      typedErrorLineByFromRole.set(edge.from.roleId, seenCodes);
    }

    if (edge.to.kind === "special-role") {
      if (edge.to.special !== "end" || edge.from.kind !== "role") {
        failMermaid({
          stage: "parse",
          errorCode: "MERMAID_INVALID_SPECIAL_ROLE_FLOW",
          message: `Special-role flow "${edge.line}" is invalid. Only business roles can connect to End.`,
          lineNumber: edge.lineNumber
        });
      }
      flows.push({
        fromRoleId: edge.from.roleId,
        toRoleId: SYSTEM_END_ROLE_ID,
        eventType: edge.eventType
      });
      continue;
    }

    if (edge.from.kind !== "role" || edge.to.kind !== "role") {
      failMermaid({ stage: "parse", errorCode: "MERMAID_INVALID_SPECIAL_ROLE_FLOW", message: `Invalid special-role flow "${edge.line}".`, lineNumber: edge.lineNumber });
    }

    flows.push({
      fromRoleId: edge.from.roleId,
      toRoleId: edge.to.roleId,
      eventType: edge.eventType
    });
  }

  return {
    metadata,
    metadataLineByKey,
    roleByNode,
    nodeByRole,
    flows,
    startFlows
  };
}

/**
 * Semantic validation is where Mermaid stops being "parseable text" and becomes "safe to
 * execute": bindings must resolve, joins must match incoming edges, and cycles need budgets.
 */
function validateParsedSystemGraph(graph: ParsedSystemGraph): ValidatedSystemGraph {
  const metadataLine = (key: string): number | undefined => graph.metadataLineByKey.get(key);
  const systemId = graph.metadata.get("system.id");
  const systemVersion = graph.metadata.get("system.version");
  const globalLawRef = graph.metadata.get("law.global");
  const entryRoleIds = Array.from(new Set(graph.startFlows.map((flow) => flow.toRoleId)));
  let endJoinMode: "all_of" | "quorum_of" = "all_of";
  let endJoinMin: number | undefined;

  if (!systemId || !systemVersion || !globalLawRef) {
    failMermaid({
      stage: "validate",
      errorCode: "MERMAID_MISSING_REQUIRED_METADATA",
      message: "Missing required metadata: system.id / system.version / law.global"
    });
  }

  if (entryRoleIds.length === 0) {
    failMermaid({
      stage: "validate",
      errorCode: "MERMAID_MISSING_ENTRY_ROLE",
      message: "Missing entry role. Connect start[开始] to one or more roles."
    });
  }
  const startDispatchMode = graph.metadata.get("start.dispatch.mode") ?? "all";
  const startDispatchCountValue = graph.metadata.get("start.dispatch.count");
  let startDispatch: ValidatedSystemGraph["startDispatch"] = { mode: "all" };
  if (startDispatchMode === "random_n") {
    const count = Number(startDispatchCountValue);
    if (!Number.isInteger(count) || count < 1 || count > entryRoleIds.length) {
      failMermaid({ stage: "validate", errorCode: "MERMAID_INVALID_START_DISPATCH_COUNT", message: `start.dispatch.count must be within [1, ${entryRoleIds.length}] when start.dispatch.mode=random_n.`, lineNumber: metadataLine("start.dispatch.count") });
    }
    startDispatch = { mode: "random_n", count };
  } else if (startDispatchMode !== "all") {
    failMermaid({ stage: "validate", errorCode: "MERMAID_UNSUPPORTED_START_DISPATCH_MODE", message: `Unsupported start.dispatch.mode "${startDispatchMode}". Expected "all" or "random_n".`, lineNumber: metadataLine("start.dispatch.mode") });
  } else if (startDispatchCountValue !== undefined) {
    failMermaid({ stage: "validate", errorCode: "MERMAID_START_COUNT_REQUIRES_RANDOM", message: "start.dispatch.count is only valid when start.dispatch.mode=random_n.", lineNumber: metadataLine("start.dispatch.count") });
  }

  const executionBinding: Record<string, string> = {};
  const modelBinding: Record<string, string> = {};
  const routingModeByRoleId: Record<string, GraphRoutingMode> = {};
  const joinModeByRoleId: Record<string, GraphJoinMode> = {};
  const joinSourcesByRoleId: Record<string, string[]> = {};
  const joinMinByRoleId: Record<string, number> = {};
  const contextMapByRoleId: Record<string, Record<string, string>> = {};
  const loopMaxByRoleId: Record<string, number> = {};
  const routeOrderByRoleId: Record<string, string[]> = {};
  const reviewModeByRoleId: Record<string, HumanReviewSpec["mode"]> = {};
  const reviewTimeoutByRoleId: Record<string, number> = {};
  const reviewTimeoutActionByRoleId: Record<string, HumanReviewSpec["timeoutAction"]> = {};
  const reviewReworkTargetByRoleId: Record<string, string> = {};
  const reviewReworkMaxByRoleId: Record<string, number> = {};
  const reviewTerminateScopeByRoleId: Record<string, HumanReviewSpec["terminateScope"]> = {};
  let handoffMode: HandoffMode | undefined;
  let handoffContracts: string | undefined;
  const exactMetadataKeys = new Set(["system.id", "system.version", "law.global", "start.dispatch.mode", "start.dispatch.count", "end.join.mode", "end.join.min"]);

  const declaredEndJoinMode = graph.metadata.get("end.join.mode");
  if (declaredEndJoinMode !== undefined) {
    if (declaredEndJoinMode !== "all_of" && declaredEndJoinMode !== "quorum_of") {
      failMermaid({ stage: "validate", errorCode: "MERMAID_UNSUPPORTED_END_JOIN_MODE", message: `Unsupported end.join.mode "${declaredEndJoinMode}". Expected "all_of" or "quorum_of".`, lineNumber: metadataLine("end.join.mode") });
    }
    endJoinMode = declaredEndJoinMode;
  }
  const declaredEndJoinMin = graph.metadata.get("end.join.min");
  if (declaredEndJoinMin !== undefined) {
    const parsed = Number(declaredEndJoinMin);
    if (!Number.isInteger(parsed) || parsed < 1) {
      failMermaid({ stage: "validate", errorCode: "MERMAID_INVALID_END_JOIN_MIN", message: "end.join.min must be a positive integer.", lineNumber: metadataLine("end.join.min") });
    }
    endJoinMin = parsed;
  }
  if (endJoinMode === "quorum_of" && endJoinMin === undefined) {
    failMermaid({ stage: "validate", errorCode: "MERMAID_MISSING_END_JOIN_MIN", message: "end.join.min is required when end.join.mode=quorum_of.", lineNumber: metadataLine("end.join.mode") });
  }
  if (endJoinMode !== "quorum_of" && endJoinMin !== undefined) {
    failMermaid({ stage: "validate", errorCode: "MERMAID_END_JOIN_MIN_REQUIRES_QUORUM", message: "end.join.min requires end.join.mode=quorum_of.", lineNumber: metadataLine("end.join.min") });
  }

  for (const [key, value] of graph.metadata.entries()) {
    if (key === "handoff.mode") {
      if (!isSupportedHandoffMode(value)) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_UNSUPPORTED_HANDOFF_MODE",
          message: `Unsupported handoff.mode "${value}". Expected strict or transition.`,
          lineNumber: metadataLine(key)
        });
      }
      handoffMode = value;
      continue;
    }

    if (key === "handoff.contracts") {
      handoffContracts = value;
      continue;
    }

    if (exactMetadataKeys.has(key)) {
      continue;
    }

    if (key.startsWith("model.bind.")) {
      const roleId = key.slice("model.bind.".length);
      if (roleId) {
        modelBinding[roleId] = value;
      }
      continue;
    }

    if (key.startsWith("role.mode.")) {
      const roleId = key.slice("role.mode.".length);
      if (!hasRoutingModeHandler(value)) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_UNSUPPORTED_ROUTING_MODE",
          message: `Unsupported role.mode for ${roleId}: "${value}"`,
          lineNumber: metadataLine(key)
        });
      }
      if (roleId) {
        routingModeByRoleId[roleId] = value;
      }
      continue;
    }

    if (key.startsWith("join.mode.")) {
      const roleId = key.slice("join.mode.".length);
      if (!isSupportedJoinMode(value)) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_UNSUPPORTED_JOIN_MODE",
          message: `Unsupported join.mode for ${roleId}: "${value}"`,
          lineNumber: metadataLine(key)
        });
      }
      if (roleId) {
        joinModeByRoleId[roleId] = value;
      }
      continue;
    }

    if (key.startsWith("join.min.")) {
      const roleId = key.slice("join.min.".length);
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_INVALID_JOIN_MIN",
          message: `Invalid join.min for ${roleId}: "${value}"`,
          lineNumber: metadataLine(key)
        });
      }
      if (roleId) {
        joinMinByRoleId[roleId] = parsed;
      }
      continue;
    }

    if (key.startsWith("join.sources.")) {
      const roleId = key.slice("join.sources.".length);
      if (roleId) {
        joinSourcesByRoleId[roleId] = value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }
      continue;
    }

    if (key.startsWith("context.map.")) {
      const { roleId, fieldName } = parseContextMapMetadataKey(key, metadataLine(key));
      const roleMap = (contextMapByRoleId[roleId] ??= {});
      roleMap[fieldName] = value;
      continue;
    }

    if (key.startsWith("loop.max.")) {
      const roleId = key.slice("loop.max.".length);
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_INVALID_LOOP_MAX",
          message: `Invalid loop.max for ${roleId}: "${value}"`,
          lineNumber: metadataLine(key)
        });
      }
      if (roleId) {
        loopMaxByRoleId[roleId] = parsed;
      }
      continue;
    }

    if (key.startsWith("route.order.")) {
      const roleId = key.slice("route.order.".length);
      if (!roleId) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_INVALID_ROUTE_ORDER",
          message: `Invalid metadata key "${key}". Expected route.order.<fromRoleId>=<toRoleIdA>,<toRoleIdB>,...`,
          lineNumber: metadataLine(key)
        });
      }
      const orderedTargets = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (orderedTargets.length === 0) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_INVALID_ROUTE_ORDER",
          message: `Invalid route.order for ${roleId}: "${value}"`,
          lineNumber: metadataLine(key)
        });
      }
      routeOrderByRoleId[roleId] = orderedTargets;
      continue;
    }

    if (key.startsWith("review.mode.")) {
      const roleId = key.slice("review.mode.".length);
      if (value !== "required") {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_UNSUPPORTED_REVIEW_MODE",
          message: `Unsupported review.mode for ${roleId}: "${value}"`,
          lineNumber: metadataLine(key)
        });
      }
      if (roleId) {
        reviewModeByRoleId[roleId] = value;
      }
      continue;
    }

    if (key.startsWith("review.timeout.action.")) {
      const roleId = key.slice("review.timeout.action.".length);
      if (value !== "pause" && value !== "terminate") {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_INVALID_REVIEW_TIMEOUT_ACTION",
          message: `Unsupported review.timeout.action for ${roleId}: "${value}"`,
          lineNumber: metadataLine(key)
        });
      }
      if (roleId) {
        reviewTimeoutActionByRoleId[roleId] = value;
      }
      continue;
    }

    if (key.startsWith("review.timeout.")) {
      const roleId = key.slice("review.timeout.".length);
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_INVALID_REVIEW_TIMEOUT",
          message: `Invalid review.timeout for ${roleId}: "${value}"`,
          lineNumber: metadataLine(key)
        });
      }
      if (roleId) {
        reviewTimeoutByRoleId[roleId] = parsed;
      }
      continue;
    }

    if (key.startsWith("review.rework.target.")) {
      const roleId = key.slice("review.rework.target.".length);
      if (!roleId || !value.trim()) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_INVALID_REVIEW_REWORK_TARGET",
          message: `Invalid review.rework.target for ${roleId}: "${value}"`,
          lineNumber: metadataLine(key)
        });
      }
      reviewReworkTargetByRoleId[roleId] = value.trim();
      continue;
    }

    if (key.startsWith("review.rework.max.")) {
      const roleId = key.slice("review.rework.max.".length);
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_INVALID_REVIEW_REWORK_MAX",
          message: `Invalid review.rework.max for ${roleId}: "${value}"`,
          lineNumber: metadataLine(key)
        });
      }
      if (roleId) {
        reviewReworkMaxByRoleId[roleId] = parsed;
      }
      continue;
    }

    if (key.startsWith("review.terminate.scope.")) {
      const roleId = key.slice("review.terminate.scope.".length);
      if (value !== "branch" && value !== "run") {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_INVALID_REVIEW_TERMINATE_SCOPE",
          message: `Unsupported review.terminate.scope for ${roleId}: "${value}"`,
          lineNumber: metadataLine(key)
        });
      }
      if (roleId) {
        reviewTerminateScopeByRoleId[roleId] = value;
      }
      continue;
    }

    if (!key.startsWith("exec.bind.")) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_UNSUPPORTED_METADATA_KEY",
        message: `Unsupported metadata key "${key}"`,
        lineNumber: metadataLine(key)
      });
    }

    const roleId = key.slice("exec.bind.".length);
    if (roleId) {
      executionBinding[roleId] = value;
    }
  }

  if (handoffContracts && !handoffMode) {
    failMermaid({
      stage: "validate",
      errorCode: "MERMAID_MISSING_HANDOFF_MODE",
      message: "handoff.contracts requires handoff.mode to be declared",
      lineNumber: metadataLine("handoff.contracts")
    });
  }

  const roleIds = Array.from(graph.nodeByRole.keys());
  for (const entryRoleId of entryRoleIds) {
    if (!roleIds.includes(entryRoleId)) {
      failMermaid({ stage: "validate", errorCode: "MERMAID_ENTRY_ROLE_MISSING", message: `Start role target "${entryRoleId}" does not exist in role graph` });
    }
  }

  const reservedRoles = new Set(["start", "end"]);
  for (const roleId of roleIds) {
    if (reservedRoles.has(roleId.toLowerCase())) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_RESERVED_ROLE_ID",
        message: `Reserved business role id "${roleId}" is not allowed. Use the explicit Start and End structural roles.`
      });
    }
  }

  const terminalRoleOrder = Array.from(new Set(graph.flows
    .filter((flow) => flow.toRoleId === SYSTEM_END_ROLE_ID)
    .map((flow) => flow.fromRoleId)));
  if (endJoinMin !== undefined && endJoinMin > terminalRoleOrder.length) {
    failMermaid({ stage: "validate", errorCode: "MERMAID_END_JOIN_MIN_OUT_OF_RANGE", message: `end.join.min must be within [1, ${terminalRoleOrder.length}].`, lineNumber: metadataLine("end.join.min") });
  }
  if (terminalRoleOrder.length === 0) {
    failMermaid({
      stage: "validate",
      errorCode: "MERMAID_MISSING_TERMINAL",
      message: "Connect at least one business role to end[结束]."
    });
  }

  for (const roleId of Object.keys(executionBinding)) {
    if (!roleIds.includes(roleId)) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_UNDEFINED_ROLE_REF",
        message: `exec.bind.${roleId} references undefined role`,
        lineNumber: metadataLine(`exec.bind.${roleId}`)
      });
    }
  }

  for (const roleId of Object.keys(modelBinding)) {
    if (!roleIds.includes(roleId)) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_UNDEFINED_ROLE_REF",
        message: `model.bind.${roleId} references undefined role`,
        lineNumber: metadataLine(`model.bind.${roleId}`)
      });
    }
  }

  for (const roleId of roleIds) {
    const modelRef = modelBinding[roleId];
    const executionRef = executionBinding[roleId];
    if (!modelRef || !executionRef) {
      continue;
    }
    failMermaid({
      stage: "validate",
      errorCode: "MERMAID_ROLE_BINDING_CONFLICT",
      message:
        `Role "${roleId}" defines both model.bind.${roleId}=${modelRef} and ` +
        `exec.bind.${roleId}=${executionRef}. A role must use exactly one binding type.`,
      lineNumber: metadataLine(`model.bind.${roleId}`) ?? metadataLine(`exec.bind.${roleId}`)
    });
  }

  for (const roleId of Object.keys(routingModeByRoleId)) {
    if (!roleIds.includes(roleId)) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_UNDEFINED_ROLE_REF",
        message: `role.mode.${roleId} references undefined role`,
        lineNumber: metadataLine(`role.mode.${roleId}`)
      });
    }
  }

  for (const roleId of Object.keys(joinModeByRoleId)) {
    if (!roleIds.includes(roleId)) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_UNDEFINED_ROLE_REF",
        message: `join.mode.${roleId} references undefined role`,
        lineNumber: metadataLine(`join.mode.${roleId}`)
      });
    }
    if (!joinSourcesByRoleId[roleId]?.length) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_MISSING_JOIN_SOURCES",
        message: `join.sources.${roleId} is required when join.mode.${roleId}=${joinModeByRoleId[roleId]}`,
        lineNumber: metadataLine(`join.mode.${roleId}`)
      });
    }
    if (joinModeByRoleId[roleId] === "quorum_of" && joinMinByRoleId[roleId] === undefined) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_MISSING_JOIN_MIN",
        message: `join.min.${roleId} is required when join.mode.${roleId}=quorum_of`,
        lineNumber: metadataLine(`join.mode.${roleId}`)
      });
    }
  }

  for (const [roleId, sources] of Object.entries(joinSourcesByRoleId)) {
    if (!roleIds.includes(roleId)) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_UNDEFINED_ROLE_REF",
        message: `join.sources.${roleId} references undefined role`,
        lineNumber: metadataLine(`join.sources.${roleId}`)
      });
    }
    if (!joinModeByRoleId[roleId]) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_JOIN_SOURCES_REQUIRE_JOIN_MODE",
        message: `join.sources.${roleId} requires join.mode.${roleId}`,
        lineNumber: metadataLine(`join.sources.${roleId}`)
      });
    }
    const duplicateSourceRoleIds = sources.filter(
      (sourceRoleId, index) => sources.indexOf(sourceRoleId) !== index
    );
    if (duplicateSourceRoleIds.length > 0) {
      const duplicateSummary = Array.from(new Set(duplicateSourceRoleIds)).join(", ");
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_DUPLICATE_JOIN_SOURCE",
        message: `join.sources.${roleId} contains duplicate source role ids: ${duplicateSummary}`,
        lineNumber: metadataLine(`join.sources.${roleId}`)
      });
    }
    for (const sourceRoleId of sources) {
      if (!roleIds.includes(sourceRoleId)) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_UNDEFINED_ROLE_REF",
          message: `join.sources.${roleId} references undefined source role "${sourceRoleId}"`,
          lineNumber: metadataLine(`join.sources.${roleId}`)
        });
      }
      const hasIncomingFlow = graph.flows.some(
        (flow) => flow.fromRoleId === sourceRoleId && flow.toRoleId === roleId
      );
      if (!hasIncomingFlow) {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_JOIN_SOURCE_MISSING_EDGE",
          message: `join.sources.${roleId} includes "${sourceRoleId}" but no Mermaid edge exists from ${sourceRoleId} to ${roleId}`,
          lineNumber: metadataLine(`join.sources.${roleId}`)
        });
      }
    }
    const joinMode = joinModeByRoleId[roleId];
    // Join sources must exactly match incoming edges so branching execution remains reproducible.
    if (joinMode === "all_of" || joinMode === "quorum_of") {
      const declaredSources = [...sources].sort((left, right) => left.localeCompare(right));
      const incomingSources = Array.from(
        new Set(
          graph.flows
            .filter((flow) => flow.toRoleId === roleId && flow.fromRoleId !== SYSTEM_END_ROLE_ID)
            .map((flow) => flow.fromRoleId)
        )
      ).sort((left, right) => left.localeCompare(right));
      const missingSources = incomingSources.filter(
        (sourceRoleId) => !declaredSources.includes(sourceRoleId)
      );
      const extraSources = declaredSources.filter(
        (sourceRoleId) => !incomingSources.includes(sourceRoleId)
      );
      if (missingSources.length > 0 || extraSources.length > 0) {
        const details = [
          missingSources.length > 0 ? `missing incoming roles: ${missingSources.join(", ")}` : "",
          extraSources.length > 0 ? `extra declared roles: ${extraSources.join(", ")}` : ""
        ]
          .filter(Boolean)
          .join("; ");
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_JOIN_SOURCES_MISMATCH",
          message: `join.sources.${roleId} must match exactly the incoming Mermaid role edges for join.mode.${roleId}=${joinMode} (${details})`,
          lineNumber: metadataLine(`join.sources.${roleId}`)
        });
      }
    }
  }

  for (const [roleId, joinMin] of Object.entries(joinMinByRoleId)) {
    if (!roleIds.includes(roleId)) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_UNDEFINED_ROLE_REF",
        message: `join.min.${roleId} references undefined role`,
        lineNumber: metadataLine(`join.min.${roleId}`)
      });
    }
    const joinMode = joinModeByRoleId[roleId];
    if (joinMode !== "quorum_of") {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_JOIN_MIN_REQUIRES_QUORUM_MODE",
        message: `join.min.${roleId} requires join.mode.${roleId}=quorum_of`,
        lineNumber: metadataLine(`join.min.${roleId}`)
      });
    }
    const sourceCount = joinSourcesByRoleId[roleId]?.length ?? 0;
    if (joinMin < 1 || joinMin > sourceCount) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_INVALID_JOIN_MIN_RANGE",
        message: `join.min.${roleId} must be within [1, ${sourceCount}] for join.mode.${roleId}=quorum_of`,
        lineNumber: metadataLine(`join.min.${roleId}`)
      });
    }
  }

  for (const [roleId, contextMap] of Object.entries(contextMapByRoleId)) {
    if (!roleIds.includes(roleId)) {
      const firstField = Object.keys(contextMap)[0];
      const key = firstField ? `context.map.${roleId}.${firstField}` : `context.map.${roleId}`;
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_UNDEFINED_ROLE_REF",
        message: `context.map.${roleId} references undefined role`,
        lineNumber: metadataLine(key)
      });
    }

    for (const [fieldName, selector] of Object.entries(contextMap)) {
      validateContextSelector({
        selector,
        targetRoleId: roleId,
        roleIds,
        joinModeByRoleId,
        joinSourcesByRoleId,
        joinMinByRoleId,
        metadataKey: `context.map.${roleId}.${fieldName}`,
        lineNumber: metadataLine(`context.map.${roleId}.${fieldName}`)
      });
    }
  }

  for (const [roleId, loopMax] of Object.entries(loopMaxByRoleId)) {
    if (!roleIds.includes(roleId)) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_UNDEFINED_ROLE_REF",
        message: `loop.max.${roleId} references undefined role`,
        lineNumber: metadataLine(`loop.max.${roleId}`)
      });
    }
    const hasIncomingLoop = graph.flows.some((flow) => flow.toRoleId === roleId);
    if (!hasIncomingLoop || loopMax <= 0) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_INVALID_LOOP_MAX",
        message: `loop.max.${roleId} requires a positive budget on a reachable role`,
        lineNumber: metadataLine(`loop.max.${roleId}`)
      });
    }
  }

  for (const [roleId, orderedTargets] of Object.entries(routeOrderByRoleId)) {
    if (!roleIds.includes(roleId)) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_UNDEFINED_ROLE_REF",
        message: `route.order.${roleId} references undefined role`,
        lineNumber: metadataLine(`route.order.${roleId}`)
      });
    }

    const outgoingTargets = graph.flows
      .filter(
        (flow) =>
          flow.fromRoleId === roleId &&
          flow.toRoleId !== SYSTEM_END_ROLE_ID &&
          !isRuntimeOnlyErrorEvent(flow.eventType)
      )
      .map((flow) => flow.toRoleId);
    const outgoingTargetSet = new Set(outgoingTargets);
    const uniqueOrderedTargets = Array.from(new Set(orderedTargets));
    if (uniqueOrderedTargets.length !== orderedTargets.length) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_ROUTE_ORDER_MISMATCH",
        message: `route.order.${roleId} must not contain duplicate target roles`,
        lineNumber: metadataLine(`route.order.${roleId}`)
      });
    }
    const hasExactCoverage =
      outgoingTargetSet.size === uniqueOrderedTargets.length &&
      uniqueOrderedTargets.every((targetRoleId) => outgoingTargetSet.has(targetRoleId));

    if (!hasExactCoverage) {
      const details = outgoingTargets.length
        ? `expected [${outgoingTargets.join(", ")}]`
        : "expected at least one outgoing role edge";
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_ROUTE_ORDER_MISMATCH",
        message: `route.order.${roleId} must match the outgoing role edges (${details})`,
        lineNumber: metadataLine(`route.order.${roleId}`)
      });
    }
  }

  const reviewRoleIds = new Set<string>([
    ...Object.keys(reviewModeByRoleId),
    ...Object.keys(reviewTimeoutByRoleId),
    ...Object.keys(reviewTimeoutActionByRoleId),
    ...Object.keys(reviewReworkTargetByRoleId),
    ...Object.keys(reviewReworkMaxByRoleId),
    ...Object.keys(reviewTerminateScopeByRoleId)
  ]);
  const reviewByRoleId: Record<string, HumanReviewSpec> = {};
  for (const roleId of reviewRoleIds) {
    if (!graph.nodeByRole.has(roleId)) {
      const key =
        `review.mode.${roleId}` in Object.fromEntries(graph.metadata.entries())
          ? `review.mode.${roleId}`
          : `review.timeout.${roleId}`;
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_UNDEFINED_ROLE_REF",
        message: `review.* metadata references undefined role "${roleId}"`,
        lineNumber: metadataLine(key)
      });
    }
    if (!reviewModeByRoleId[roleId]) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_MISSING_REVIEW_MODE",
        message: `review.* metadata for "${roleId}" requires review.mode.${roleId}=required`,
        lineNumber:
          metadataLine(`review.timeout.${roleId}`) ??
          metadataLine(`review.timeout.action.${roleId}`) ??
          metadataLine(`review.rework.target.${roleId}`) ??
          metadataLine(`review.rework.max.${roleId}`) ??
          metadataLine(`review.terminate.scope.${roleId}`)
      });
    }
    const reworkTargetRoleId = reviewReworkTargetByRoleId[roleId] ?? roleId;
    if (!graph.nodeByRole.has(reworkTargetRoleId)) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_UNDEFINED_ROLE_REF",
        message: `review.rework.target.${roleId} references undefined role "${reworkTargetRoleId}"`,
        lineNumber: metadataLine(`review.rework.target.${roleId}`)
      });
    }
    reviewByRoleId[roleId] = {
      mode: "required",
      timeoutSeconds: reviewTimeoutByRoleId[roleId],
      timeoutAction: reviewTimeoutActionByRoleId[roleId] ?? "pause",
      reworkTargetRoleId,
      reworkMax: reviewReworkMaxByRoleId[roleId],
      terminateScope: reviewTerminateScopeByRoleId[roleId] ?? "branch"
    };
  }

  /**
   * Reliability: Fail-Fast Static Analysis.
   * Uses graph theory (Strongly Connected Components) to detect topological cycles
   * that lack an explicit loop.max budget. Rejecting them here keeps the runtime from
   * spinning forever and ensures recovery steps can assume any cycle always carries a budget.
   */
  const cycleComponents = collectCycleComponents({
    roleIds,
    flows: graph.flows,
    includeRuntimeOnlyErrorEvents: true
  });
  for (const cycleRoles of cycleComponents) {
    const hasLoopBudget = cycleRoles.some((roleId) => loopMaxByRoleId[roleId] !== undefined);
    if (hasLoopBudget) {
      continue;
    }
    const cycleRoleList = cycleRoles.slice().sort((left, right) => left.localeCompare(right));
    failMermaid({
      stage: "validate",
      errorCode: "MERMAID_CYCLE_REQUIRES_LOOP_MAX",
      message: `Detected cycle across roles [${cycleRoleList.join(", ")}]. Add loop.max.<role>=N to at least one role in this cycle.`
    });
  }

  const graphMetadata: GraphMetadata = {
    handoffMode,
    handoffContracts,
    routeOrderByRoleId,
    routingModeByRoleId,
    joinModeByRoleId,
    joinSourcesByRoleId,
    joinMinByRoleId,
    contextMapByRoleId,
    loopMaxByRoleId,
    reviewByRoleId
  };

  return {
    ...graph,
    systemId,
    systemVersion,
    globalLawRef,
    entryRoleIds,
    startDispatch,
    startEventType: "START",
    startFlows: graph.startFlows,
    endJoin: { mode: endJoinMode, ...(endJoinMin !== undefined ? { min: endJoinMin } : {}) },
    terminalRoleOrder,
    roleIds,
    executionBinding,
    modelBinding,
    graph: graphMetadata
  };
}

function compileSystemDefinition(graph: ValidatedSystemGraph): SystemDefinition {
  return {
    systemId: graph.systemId,
    systemVersion: graph.systemVersion,
    entryRoleIds: graph.entryRoleIds,
    startDispatch: graph.startDispatch,
    startEventType: graph.startEventType,
    startFlows: graph.startFlows,
    endJoin: graph.endJoin,
    roleIds: graph.roleIds,
    flows: graph.flows,
    lawBinding: { globalLawRef: graph.globalLawRef },
    executionBinding: graph.executionBinding,
    modelBinding: graph.modelBinding,
    rolePackageRefByRoleId: Object.fromEntries(graph.roleIds.map((roleId) => [roleId, roleId])),
    graph: graph.graph
  };
}

/**
 * After this point the runtime works only with SystemDefinition, not Mermaid source text. That
 * keeps execution and tests independent from the surface DSL representation.
 * Throws on parse/validation failures because they reflect non-recoverable DSL violations.
 */
export function parseSystemFromMermaidSource(source: string): SystemDefinition {
  return compileSystemDefinition(
    validateParsedSystemGraph(parseTokenizedMermaid(tokenizeMermaidSource(source)))
  );
}

/**
 * Loads and parses a Mermaid file, keeping filesystem IO separate from DSL validation.
 */
export async function loadSystemFromMermaid(path: string): Promise<SystemDefinition> {
  const source = await readFile(path, "utf8");
  const system = parseSystemFromMermaidSource(source);
  if (!system.graph?.handoffContracts) {
    return system;
  }

  return {
    ...system,
    graph: {
      ...system.graph,
      handoffContracts: resolve(dirname(path), system.graph.handoffContracts)
    }
  };
}

/**
 * Non-exception diagnostics emitted during lint runs; stages reference where validation stopped.
 */
export type SystemLintDiagnostic = {
  line?: number;
  errorCode: string;
  message: string;
  stage: RuntimeErrorStage;
};

/**
 * Runs parse/validation without throwing so callers can show diagnostics while keeping runtime untouched.
 */
export function lintSystemFromMermaidSource(source: string): SystemLintDiagnostic[] {
  try {
    parseSystemFromMermaidSource(source);
    return [];
  } catch (error) {
    if (error instanceof RuntimeError) {
      const envelope = error.envelope;
      return [
        {
          line: envelope.line,
          errorCode: envelope.errorCode,
          message: envelope.message,
          stage: envelope.stage
        }
      ];
    }

    return [
      {
        errorCode: "MERMAID_LINT_ERROR",
        message: error instanceof Error ? error.message : String(error),
        stage: "lint"
      }
    ];
  }
}
