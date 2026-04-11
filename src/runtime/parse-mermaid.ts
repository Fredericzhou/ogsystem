import { readFile } from "node:fs/promises";

import { hasJoinModeHandler, hasRoutingModeHandler } from "./graph-mode-registry.js";
import { createRuntimeError, RuntimeError } from "./runtime-errors.js";
import { SYSTEM_END_ROLE_ID } from "./types.js";
import type {
  Flow,
  GraphJoinMode,
  GraphMetadata,
  GraphRoutingMode,
  RuntimeErrorStage,
  SystemDefinition
} from "./types.js";

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

type ParsedSystemGraph = {
  metadata: Map<string, string>;
  metadataLineByKey: Map<string, number>;
  roleByNode: Map<string, string>;
  nodeByRole: Map<string, string>;
  flows: Flow[];
  inputEntryCandidates: Set<string>;
  hasOutputTransition: boolean;
};

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

/**
 * tokenizeMermaidSource performs the first pass of parsing.
 * It extracts metadata (starting with %%) and edges (role transitions).
 */
function tokenizeMermaidSource(source: string): TokenizedMermaid {
  const lines = source.split(/\r?\n/);
  const metadata: Array<{ lineNumber: number; key: string; value: string }> = [];
  const edges: TokenizedEdge[] = [];
  let flowchartFound = false;

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
      inputEntryCandidates.add(edge.to.roleId);
      continue;
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
  const loopMaxByRoleId: Record<string, number> = {};
  const exactMetadataKeys = new Set(["engine", "system.id", "system.version", "law.global", "entry.role"]);

  for (const [key, value] of graph.metadata.entries()) {
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
      if (!hasJoinModeHandler(value)) {
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
    if (joinModeByRoleId[roleId] === "all_of" && !joinSourcesByRoleId[roleId]?.length) {
      failMermaid({
        stage: "validate",
        errorCode: "MERMAID_MISSING_JOIN_SOURCES",
        message: `join.sources.${roleId} is required when join.mode.${roleId}=all_of`,
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
    if (joinModeByRoleId[roleId] === "all_of") {
      const declaredSources = Array.from(new Set(sources)).sort((left, right) =>
        left.localeCompare(right)
      );
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
          message: `join.sources.${roleId} must match exactly the incoming Mermaid role edges for join.mode.${roleId}=all_of (${details})`,
          lineNumber: metadataLine(`join.sources.${roleId}`)
        });
      }
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

  /**
   * Reliability: Fail-Fast Static Analysis.
   * Uses graph theory (Strongly Connected Components) to detect topological cycles 
   * that lack an explicit loop.max budget. This prevents runaway LLM API costs 
   * by rejecting unsafe graphs before execution begins.
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
    routingModeByRoleId,
    joinModeByRoleId,
    joinSourcesByRoleId,
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
 */
export function parseSystemFromMermaidSource(source: string): SystemDefinition {
  return compileSystemDefinition(
    validateParsedSystemGraph(parseTokenizedMermaid(tokenizeMermaidSource(source)))
  );
}

export async function loadSystemFromMermaid(path: string): Promise<SystemDefinition> {
  const source = await readFile(path, "utf8");
  return parseSystemFromMermaidSource(source);
}

export type SystemLintDiagnostic = {
  line?: number;
  errorCode: string;
  message: string;
  stage: RuntimeErrorStage;
};

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
