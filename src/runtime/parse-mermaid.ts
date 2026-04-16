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
import { SYSTEM_END_ROLE_ID } from "./types.js";
import type {
  Flow,
  GraphJoinMode,
  GraphMetadata,
  GraphRoutingMode,
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
      kind: "boundary";
      boundary: "input" | "output";
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
  inputEntryCandidates: Set<string>;
  hasOutputTransition: boolean;
};

// Ensures loops without explicit loop.max budgets are caught before execution.
function collectCyclicRoleComponents(args: {
  roleIds: string[];
  flows: Flow[];
}): string[][] {
  const roleSet = new Set(args.roleIds);
  const adjacency = new Map<string, string[]>(
    args.roleIds.map((roleId) => [roleId, [] as string[]])
  );
  for (const flow of args.flows) {
    if (flow.toRoleId === SYSTEM_END_ROLE_ID) {
      continue;
    }
    if (!roleSet.has(flow.fromRoleId) || !roleSet.has(flow.toRoleId)) {
      continue;
    }
    adjacency.get(flow.fromRoleId)?.push(flow.toRoleId);
  }

  const indexByRoleId = new Map<string, number>();
  const lowLinkByRoleId = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let cursor = 0;

  const strongConnect = (roleId: string): void => {
    indexByRoleId.set(roleId, cursor);
    lowLinkByRoleId.set(roleId, cursor);
    cursor += 1;
    stack.push(roleId);
    onStack.add(roleId);

    for (const neighborRoleId of adjacency.get(roleId) ?? []) {
      if (!indexByRoleId.has(neighborRoleId)) {
        strongConnect(neighborRoleId);
        const roleLowLink = lowLinkByRoleId.get(roleId) ?? 0;
        const neighborLowLink = lowLinkByRoleId.get(neighborRoleId) ?? 0;
        lowLinkByRoleId.set(roleId, Math.min(roleLowLink, neighborLowLink));
      } else if (onStack.has(neighborRoleId)) {
        const roleLowLink = lowLinkByRoleId.get(roleId) ?? 0;
        const neighborIndex = indexByRoleId.get(neighborRoleId) ?? 0;
        lowLinkByRoleId.set(roleId, Math.min(roleLowLink, neighborIndex));
      }
    }

    if ((lowLinkByRoleId.get(roleId) ?? -1) !== (indexByRoleId.get(roleId) ?? -2)) {
      return;
    }

    const component: string[] = [];
    while (stack.length > 0) {
      const popped = stack.pop();
      if (!popped) {
        break;
      }
      onStack.delete(popped);
      component.push(popped);
      if (popped === roleId) {
        break;
      }
    }

    if (component.length > 1) {
      components.push(component);
      return;
    }
    const [single] = component;
    if (!single) {
      return;
    }
    const hasSelfLoop = (adjacency.get(single) ?? []).includes(single);
    if (hasSelfLoop) {
      components.push(component);
    }
  };

  for (const roleId of args.roleIds) {
    if (!indexByRoleId.has(roleId)) {
      strongConnect(roleId);
    }
  }

  return components;
}

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
  entryRoleId: string;
  roleIds: string[];
  talentBinding: Record<string, string>;
  executionBinding: Record<string, string>;
  modelBinding: Record<string, string>;
  graph?: GraphMetadata;
};

type ParsedContextMapMetadataKey = {
  roleId: string;
  fieldName: string;
};

const SELECTOR_PATH_SEGMENT_REGEX = /^[A-Za-z0-9_]+$/;
const SOURCE_SELECTOR_ROLE_ID_REGEX = /^[A-Za-z0-9._:-]+$/;

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

function isValidSelectorPath(path: string): boolean {
  if (!path) {
    return false;
  }
  return path.split(".").every((segment) => SELECTOR_PATH_SEGMENT_REGEX.test(segment));
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
  const fail = (errorCode: string, message: string): never =>
    failMermaid({
      stage: "validate",
      errorCode,
      message,
      lineNumber: args.lineNumber
    });
  const isJoinNode = args.joinModeByRoleId[args.targetRoleId] !== undefined;

  if (selector === "global.task" || selector === "global.user_profile") {
    return;
  }

  if (selector.startsWith("global.user_profile.")) {
    const path = selector.slice("global.user_profile.".length);
    if (!isValidSelectorPath(path)) {
      fail(
        "MERMAID_INVALID_SELECTOR",
        `${args.metadataKey} uses unsupported selector "${selector}".`
      );
    }
    return;
  }

  if (selector === "direct.content" || selector === "direct.event" || selector === "direct.data") {
    if (isJoinNode) {
      fail(
        "MERMAID_JOIN_SELECTOR_NOT_ALLOWED",
        `${args.metadataKey} uses "${selector}" but join nodes do not allow direct.* selectors.`
      );
    }
    return;
  }

  if (selector.startsWith("direct.data.")) {
    if (isJoinNode) {
      fail(
        "MERMAID_JOIN_SELECTOR_NOT_ALLOWED",
        `${args.metadataKey} uses "${selector}" but join nodes do not allow direct.* selectors.`
      );
    }
    const path = selector.slice("direct.data.".length);
    if (!isValidSelectorPath(path)) {
      fail(
        "MERMAID_INVALID_SELECTOR",
        `${args.metadataKey} uses unsupported selector "${selector}".`
      );
    }
    return;
  }

  const sourceMatch = selector.match(
    /^source\(([A-Za-z0-9._:-]+)\)\.(content|event|data|data\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)$/
  );
  if (sourceMatch) {
    if (!isJoinNode) {
      fail(
        "MERMAID_JOIN_SELECTOR_REQUIRES_JOIN_MODE",
        `${args.metadataKey} uses join-only selector "${selector}" on non-join role "${args.targetRoleId}".`
      );
    }
    const sourceRoleId = sourceMatch[1];
    if (!SOURCE_SELECTOR_ROLE_ID_REGEX.test(sourceRoleId)) {
      fail(
        "MERMAID_INVALID_SELECTOR",
        `${args.metadataKey} uses unsupported selector "${selector}".`
      );
    }
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
  if (trimmed === "input") {
    return {
      kind: "boundary",
      boundary: "input"
    };
  }
  if (trimmed === "output") {
    return {
      kind: "boundary",
      boundary: "output"
    };
  }
  if (normalized === "start" || normalized === "end" || normalized === "done") {
    failMermaid({
      stage: "parse",
      errorCode: "MERMAID_UNSUPPORTED_BOUNDARY_TOKEN",
      message: `Unsupported boundary token "${trimmed}". Use input/output as the only System boundary tokens.`,
      lineNumber
    });
  }
  const match = trimmed.match(/^([A-Za-z0-9._:-]+)\[Role:([A-Za-z0-9._:-]+)\]$/);
  if (!match) {
    failMermaid({
      stage: "parse",
      errorCode: "MERMAID_INVALID_NODE_TOKEN",
      message: `Invalid node token "${token}". Expected strict format: nodeId[Role:roleId] or boundary token input/output`,
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
  // Boundary edges are normalized into the same role-flow model the runtime uses, so later
  // validation and planning only need to reason about one graph shape.
  const metadata = new Map<string, string>();
  const metadataLineByKey = new Map<string, number>();
  const roleByNode = new Map<string, string>();
  const nodeByRole = new Map<string, string>();
  const flows: Flow[] = [];
  const inputEntryCandidates = new Set<string>();
  let hasOutputTransition = false;
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

    if (edge.from.kind === "boundary") {
      if (edge.from.boundary !== "input" || edge.to.kind !== "role") {
        failMermaid({
          stage: "parse",
          errorCode: "MERMAID_INVALID_BOUNDARY_EDGE",
          message: `Boundary edge "${edge.line}" is invalid. Only input -->|EVENT| Role is allowed.`,
          lineNumber: edge.lineNumber
        });
      }
      if (parsedErrorEvent.kind !== "none") {
        failMermaid({
          stage: "validate",
          errorCode: "MERMAID_INPUT_ERROR_EDGE_NOT_ALLOWED",
          message: `input boundary cannot declare ${edge.eventType} edges. ERROR* edges are role-only.`,
          lineNumber: edge.lineNumber
        });
      }
      inputEntryCandidates.add(edge.to.roleId);
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

    if (edge.to.kind === "boundary") {
      if (edge.to.boundary !== "output" || edge.from.kind !== "role") {
        failMermaid({
          stage: "parse",
          errorCode: "MERMAID_INVALID_BOUNDARY_EDGE",
          message: `Boundary edge "${edge.line}" is invalid. Only Role -->|EVENT| output is allowed.`,
          lineNumber: edge.lineNumber
        });
      }
      flows.push({
        fromRoleId: edge.from.roleId,
        toRoleId: SYSTEM_END_ROLE_ID,
        eventType: edge.eventType
      });
      hasOutputTransition = true;
      continue;
    }

    if (edge.from.kind !== "role" || edge.to.kind !== "role") {
      failMermaid({
        stage: "parse",
        errorCode: "MERMAID_UNSUPPORTED_EDGE_FORM",
        message: `Unsupported edge form: "${edge.line}"`,
        lineNumber: edge.lineNumber
      });
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
    inputEntryCandidates,
    hasOutputTransition
  };
}

/**
 * Semantic validation is where Mermaid stops being "parseable text" and becomes "safe to
 * execute": bindings must resolve, joins must match incoming edges, and cycles need budgets.
 */
function validateParsedSystemGraph(graph: ParsedSystemGraph): ValidatedSystemGraph {
  const metadataLine = (key: string): number | undefined => graph.metadataLineByKey.get(key);
  const engineValue = graph.metadata.get("engine");
  if (engineValue !== undefined && engineValue !== "langgraph") {
    failMermaid({
      stage: "validate",
      errorCode: "MERMAID_UNSUPPORTED_ENGINE",
      message: `Unsupported engine "${engineValue}". Expected "langgraph".`,
      lineNumber: metadataLine("engine")
    });
  }

  const systemId = graph.metadata.get("system.id");
  const systemVersion = graph.metadata.get("system.version");
  const globalLawRef = graph.metadata.get("law.global");
  let entryRoleId = graph.metadata.get("entry.role");

  if (!systemId || !systemVersion || !globalLawRef) {
    failMermaid({
      stage: "validate",
      errorCode: "MERMAID_MISSING_REQUIRED_METADATA",
      message: "Missing required metadata: system.id / system.version / law.global"
    });
  }

  // Enforcing a single input transition keeps runtime recovery deterministic.
  if (graph.inputEntryCandidates.size > 1) {
    failMermaid({
      stage: "validate",
      errorCode: "MERMAID_MULTIPLE_INPUT_TARGETS",
      message: "Multiple input boundary targets are not allowed"
    });
  }
  if (graph.inputEntryCandidates.size === 1) {
    const [inputEntryRoleId] = Array.from(graph.inputEntryCandidates);
    if (entryRoleId && entryRoleId !== inputEntryRoleId) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_ENTRY_ROLE_CONFLICT",
        message: `entry.role "${entryRoleId}" conflicts with input boundary target "${inputEntryRoleId}"`,
        lineNumber: metadataLine("entry.role")
      });
    }
    entryRoleId = inputEntryRoleId;
  }
  if (!entryRoleId) {
    failMermaid({
      stage: "validate",
      errorCode: "MERMAID_MISSING_ENTRY_ROLE",
      message:
        "Missing entry role. Provide entry.role metadata or input -->|EVENT| <Role> boundary edge."
    });
  }

  const talentBinding: Record<string, string> = {};
  const executionBinding: Record<string, string> = {};
  const modelBinding: Record<string, string> = {};
  const routingModeByRoleId: Record<string, GraphRoutingMode> = {};
  const joinModeByRoleId: Record<string, GraphJoinMode> = {};
  const joinSourcesByRoleId: Record<string, string[]> = {};
  const joinMinByRoleId: Record<string, number> = {};
  const contextMapByRoleId: Record<string, Record<string, string>> = {};
  const loopMaxByRoleId: Record<string, number> = {};
  const routeOrderByRoleId: Record<string, string[]> = {};
  let handoffMode: HandoffMode | undefined;
  let handoffContracts: string | undefined;
  const exactMetadataKeys = new Set(["engine", "system.id", "system.version", "law.global", "entry.role"]);

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

    if (key.startsWith("talent.bind.")) {
      const roleId = key.slice("talent.bind.".length);
      if (roleId) {
        talentBinding[roleId] = value;
      }
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
  if (!roleIds.includes(entryRoleId)) {
    failMermaid({
      stage: "validate",
      errorCode: "MERMAID_ENTRY_ROLE_MISSING",
      message: `entry.role "${entryRoleId}" does not exist in role graph`,
      lineNumber: metadataLine("entry.role")
    });
  }

  const reservedRoles = new Set(["input", "output", "start", "end", "done"]);
  for (const roleId of roleIds) {
    if (reservedRoles.has(roleId.toLowerCase())) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_RESERVED_ROLE_ID",
        message: `Reserved role id "${roleId}" is not allowed. Use entry.role for input and terminal roles without outgoing edges (or output boundary) for completion.`
      });
    }
  }

  const outDegree = new Map<string, number>();
  for (const roleId of roleIds) {
    outDegree.set(roleId, 0);
  }
  for (const flow of graph.flows) {
    if (flow.toRoleId === SYSTEM_END_ROLE_ID) {
      continue;
    }
    outDegree.set(flow.fromRoleId, (outDegree.get(flow.fromRoleId) ?? 0) + 1);
  }

  const terminalRoles = roleIds.filter((roleId) => (outDegree.get(roleId) ?? 0) === 0);
  if (terminalRoles.length === 0 && !graph.hasOutputTransition) {
    failMermaid({
      stage: "validate",
      errorCode: "MERMAID_MISSING_TERMINAL",
      message:
        "At least one terminal role (without outgoing role-edge) or Role -->|EVENT| output transition is required"
    });
  }

  for (const roleId of Object.keys(talentBinding)) {
    if (!roleIds.includes(roleId)) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_UNDEFINED_ROLE_REF",
        message: `talent.bind.${roleId} references undefined role`,
        lineNumber: metadataLine(`talent.bind.${roleId}`)
      });
    }
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

  /**
   * Reliability: Fail-Fast Static Analysis.
   * Uses graph theory (Strongly Connected Components) to detect topological cycles
   * that lack an explicit loop.max budget. Rejecting them here keeps the runtime from
   * spinning forever and ensures recovery steps can assume any cycle always carries a budget.
   */
  const cycleComponents = collectCyclicRoleComponents({
    roleIds,
    flows: graph.flows
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
    loopMaxByRoleId
  };

  return {
    ...graph,
    systemId,
    systemVersion,
    globalLawRef,
    entryRoleId,
    roleIds,
    talentBinding,
    executionBinding,
    modelBinding,
    graph: graphMetadata
  };
}

function compileSystemDefinition(graph: ValidatedSystemGraph): SystemDefinition {
  return {
    systemId: graph.systemId,
    systemVersion: graph.systemVersion,
    entryRoleId: graph.entryRoleId,
    roleIds: graph.roleIds,
    flows: graph.flows,
    lawBinding: { globalLawRef: graph.globalLawRef },
    talentBinding: graph.talentBinding,
    executionBinding: graph.executionBinding,
    modelBinding: graph.modelBinding,
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
