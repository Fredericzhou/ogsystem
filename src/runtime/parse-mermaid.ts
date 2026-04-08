import { readFile } from "node:fs/promises";

import { SYSTEM_END_ROLE_ID } from "./types.js";
import type { Flow, SystemDefinition } from "./types.js";

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
  line: string;
  from: ParsedNodeToken;
  to: ParsedNodeToken;
  eventType: string;
};

type TokenizedMermaid = {
  metadata: Array<{ key: string; value: string }>;
  edges: TokenizedEdge[];
};

type ParsedSystemGraph = {
  metadata: Map<string, string>;
  roleByNode: Map<string, string>;
  nodeByRole: Map<string, string>;
  flows: Flow[];
  inputEntryCandidates: Set<string>;
  hasOutputTransition: boolean;
};

type ValidatedSystemGraph = ParsedSystemGraph & {
  systemId: string;
  systemVersion: string;
  globalLawRef: string;
  entryRoleId: string;
  roleIds: string[];
  talentBinding: Record<string, string>;
  executionBinding: Record<string, string>;
};

function parseNodeToken(token: string): ParsedNodeToken {
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
    throw new Error(
      `Unsupported boundary token "${trimmed}". Use input/output as the only System boundary tokens.`
    );
  }
  const match = trimmed.match(/^([A-Za-z0-9._:-]+)\[Role:([A-Za-z0-9._:-]+)\]$/);
  if (!match) {
    throw new Error(
      `Invalid node token "${token}". Expected strict format: nodeId[Role:roleId] or boundary token input/output`
    );
  }
  return {
    kind: "role",
    nodeId: match[1],
    roleId: match[2]
  };
}

function parseMetadataLine(line: string): { key: string; value: string } | null {
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
  return { key, value };
}

function parseEdgeLine(line: string): TokenizedEdge | null {
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
    throw new Error(`Empty event type in line: ${line}`);
  }
  return {
    line: trimmed,
    from: parseNodeToken(match[1]),
    to: parseNodeToken(match[3]),
    eventType
  };
}

function tokenizeMermaidSource(source: string): TokenizedMermaid {
  const lines = source.split(/\r?\n/);
  const metadata: Array<{ key: string; value: string }> = [];
  const edges: TokenizedEdge[] = [];
  let flowchartFound = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (!flowchartFound) {
      const flowchartMatch = trimmed.match(/^flowchart\s+(TD|LR)$/);
      if (!flowchartMatch) {
        throw new Error(
          `First non-empty line must be "flowchart TD" or "flowchart LR". Got: ${trimmed}`
        );
      }
      flowchartFound = true;
      continue;
    }

    const metadataItem = parseMetadataLine(line);
    if (metadataItem) {
      metadata.push(metadataItem);
      continue;
    }

    const edge = parseEdgeLine(line);
    if (!edge) {
      throw new Error(
        `Invalid executable line: "${trimmed}". Allowed lines: metadata comments and event edges.`
      );
    }
    edges.push(edge);
  }

  if (!flowchartFound) {
    throw new Error('Missing "flowchart TD|LR" header');
  }

  return { metadata, edges };
}

function parseTokenizedMermaid(tokens: TokenizedMermaid): ParsedSystemGraph {
  const metadata = new Map<string, string>();
  const roleByNode = new Map<string, string>();
  const nodeByRole = new Map<string, string>();
  const flows: Flow[] = [];
  const inputEntryCandidates = new Set<string>();
  let hasOutputTransition = false;

  for (const item of tokens.metadata) {
    metadata.set(item.key, item.value);
  }

  for (const edge of tokens.edges) {
    for (const node of [edge.from, edge.to]) {
      if (node.kind !== "role") {
        continue;
      }

      const existingRole = roleByNode.get(node.nodeId);
      if (existingRole && existingRole !== node.roleId) {
        throw new Error(
          `Node "${node.nodeId}" maps to multiple role ids: "${existingRole}" vs "${node.roleId}"`
        );
      }
      roleByNode.set(node.nodeId, node.roleId);

      const existingNode = nodeByRole.get(node.roleId);
      if (existingNode && existingNode !== node.nodeId) {
        throw new Error(
          `Role id "${node.roleId}" maps to multiple node ids: "${existingNode}" vs "${node.nodeId}"`
        );
      }
      nodeByRole.set(node.roleId, node.nodeId);
    }

    if (edge.from.kind === "boundary") {
      if (edge.from.boundary !== "input" || edge.to.kind !== "role") {
        throw new Error(
          `Boundary edge "${edge.line}" is invalid. Only input -->|EVENT| Role is allowed.`
        );
      }
      inputEntryCandidates.add(edge.to.roleId);
      continue;
    }

    if (edge.to.kind === "boundary") {
      if (edge.to.boundary !== "output" || edge.from.kind !== "role") {
        throw new Error(
          `Boundary edge "${edge.line}" is invalid. Only Role -->|EVENT| output is allowed.`
        );
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
      throw new Error(`Unsupported edge form: "${edge.line}"`);
    }

    flows.push({
      fromRoleId: edge.from.roleId,
      toRoleId: edge.to.roleId,
      eventType: edge.eventType
    });
  }

  return {
    metadata,
    roleByNode,
    nodeByRole,
    flows,
    inputEntryCandidates,
    hasOutputTransition
  };
}

function validateParsedSystemGraph(graph: ParsedSystemGraph): ValidatedSystemGraph {
  const systemId = graph.metadata.get("system.id");
  const systemVersion = graph.metadata.get("system.version");
  const globalLawRef = graph.metadata.get("law.global");
  let entryRoleId = graph.metadata.get("entry.role");

  if (!systemId || !systemVersion || !globalLawRef) {
    throw new Error("Missing required metadata: system.id / system.version / law.global");
  }

  if (graph.inputEntryCandidates.size > 1) {
    throw new Error("Multiple input boundary targets are not allowed");
  }
  if (graph.inputEntryCandidates.size === 1) {
    const [inputEntryRoleId] = Array.from(graph.inputEntryCandidates);
    if (entryRoleId && entryRoleId !== inputEntryRoleId) {
      throw new Error(
        `entry.role "${entryRoleId}" conflicts with input boundary target "${inputEntryRoleId}"`
      );
    }
    entryRoleId = inputEntryRoleId;
  }
  if (!entryRoleId) {
    throw new Error(
      "Missing entry role. Provide entry.role metadata or input -->|EVENT| <Role> boundary edge."
    );
  }

  const talentBinding: Record<string, string> = {};
  const executionBinding: Record<string, string> = {};
  const exactMetadataKeys = new Set(["system.id", "system.version", "law.global", "entry.role"]);

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

    if (!key.startsWith("exec.bind.")) {
      throw new Error(`Unsupported metadata key "${key}" for minimal kernel`);
    }

    const roleId = key.slice("exec.bind.".length);
    if (roleId) {
      executionBinding[roleId] = value;
    }
  }

  const roleIds = Array.from(graph.nodeByRole.keys());
  if (!roleIds.includes(entryRoleId)) {
    throw new Error(`entry.role "${entryRoleId}" does not exist in role graph`);
  }

  const reservedRoles = new Set(["input", "output", "start", "end", "done"]);
  for (const roleId of roleIds) {
    if (reservedRoles.has(roleId.toLowerCase())) {
      throw new Error(
        `Reserved role id "${roleId}" is not allowed. Use entry.role for input and terminal roles without outgoing edges (or output boundary) for completion.`
      );
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
    throw new Error(
      "At least one terminal role (without outgoing role-edge) or Role -->|EVENT| output transition is required"
    );
  }

  for (const roleId of Object.keys(talentBinding)) {
    if (!roleIds.includes(roleId)) {
      throw new Error(`talent.bind.${roleId} references undefined role`);
    }
  }

  for (const roleId of Object.keys(executionBinding)) {
    if (!roleIds.includes(roleId)) {
      throw new Error(`exec.bind.${roleId} references undefined role`);
    }
  }

  return {
    ...graph,
    systemId,
    systemVersion,
    globalLawRef,
    entryRoleId,
    roleIds,
    talentBinding,
    executionBinding
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
    executionBinding: graph.executionBinding
  };
}

export function parseSystemFromMermaidSource(source: string): SystemDefinition {
  return compileSystemDefinition(
    validateParsedSystemGraph(parseTokenizedMermaid(tokenizeMermaidSource(source)))
  );
}

export async function loadSystemFromMermaid(path: string): Promise<SystemDefinition> {
  const source = await readFile(path, "utf8");
  return parseSystemFromMermaidSource(source);
}
