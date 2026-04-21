/**
 * @fileoverview Mermaid normalizer/stabilizer for NL2MMD model outputs.
 * File Set: nl2mmd-normalization
 * Responsibilities:
 * - Canonicalize boundary/node tokens, metadata ordering, and join metadata placement.
 * - Repair common generation drift while preserving runtime-supported syntax.
 * Boundaries:
 * - Does not parse final runtime execution plan.
 */
import type { Nl2MmdContext } from "./types.js";

const FLOWCHART_HEADER_REGEX = /^flowchart\s+(TD|LR)$/;
const ROLE_TOKEN_REGEX = /^([A-Za-z0-9._:-]+)\[Role:([A-Za-z0-9._:-]+)\]$/;
const BARE_NODE_TOKEN_REGEX = /^[A-Za-z0-9._:-]+$/;
const EDGE_REGEX = /^(.+?)\s*-->\|(.+?)\|\s*(.+)$/;
const METADATA_REGEX = /^%%\s*([A-Za-z0-9._:-]+)\s*=\s*(.+)$/;
const ROLE_METADATA_PREFIXES = [
  "talent.bind.",
  "exec.bind.",
  "model.bind.",
  "role.mode.",
  "join.mode.",
  "join.min.",
  "join.sources.",
  "loop.max.",
  "route.order."
];
const SUPPORTED_EXACT_METADATA_KEYS = new Set([
  "engine",
  "system.id",
  "system.version",
  "law.global",
  "entry.role",
  "handoff.mode",
  "handoff.contracts"
]);
const SUPPORTED_METADATA_PREFIXES = [
  "talent.bind.",
  "exec.bind.",
  "model.bind.",
  "role.mode.",
  "join.mode.",
  "join.min.",
  "join.sources.",
  "context.map.",
  "loop.max.",
  "route.order."
];

function parseRoleToken(token: string): { nodeId: string; roleId: string } | null {
  const match = token.trim().match(ROLE_TOKEN_REGEX);
  if (!match) {
    return null;
  }
  return {
    nodeId: match[1],
    roleId: match[2]
  };
}

function parseMetadata(line: string): { key: string; value: string } | null {
  const match = line.trim().match(METADATA_REGEX);
  if (!match) {
    return null;
  }
  return {
    key: match[1],
    value: match[2].trim()
  };
}

function normalizeBoundaryToken(token: string): string {
  const trimmed = token.trim();
  const normalized = trimmed.toLowerCase();
  if (normalized === "start") {
    return "input";
  }
  if (normalized === "end" || normalized === "done") {
    return "output";
  }
  if (normalized === "input") {
    return "input";
  }
  if (normalized === "output") {
    return "output";
  }
  return trimmed;
}

function collectKnownRoleIds(lines: string[]): Set<string> {
  const roleIds = new Set<string>();
  for (const line of lines) {
    const metadata = parseMetadata(line);
    if (!metadata) {
      continue;
    }

    if (metadata.key === "entry.role" && BARE_NODE_TOKEN_REGEX.test(metadata.value)) {
      roleIds.add(metadata.value);
      continue;
    }

    if (metadata.key.startsWith("context.map.")) {
      const rest = metadata.key.slice("context.map.".length);
      const dotIndex = rest.indexOf(".");
      if (dotIndex > 0) {
        roleIds.add(rest.slice(0, dotIndex));
      }
      continue;
    }

    for (const prefix of ROLE_METADATA_PREFIXES) {
      if (!metadata.key.startsWith(prefix)) {
        continue;
      }
      const suffix = metadata.key.slice(prefix.length);
      if (BARE_NODE_TOKEN_REGEX.test(suffix)) {
        roleIds.add(suffix);
      }
      if (prefix === "join.sources.") {
        for (const sourceRoleId of metadata.value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)) {
          if (BARE_NODE_TOKEN_REGEX.test(sourceRoleId)) {
            roleIds.add(sourceRoleId);
          }
        }
      }
      break;
    }
  }
  return roleIds;
}

function collectNodeRoleMap(lines: string[]): Map<string, string> {
  const nodeRoleMap = new Map<string, string>();
  const knownRoleIds = collectKnownRoleIds(lines);

  for (const line of lines) {
    const trimmed = line.trim();
    const standaloneRoleToken = parseRoleToken(trimmed);
    if (standaloneRoleToken) {
      nodeRoleMap.set(standaloneRoleToken.nodeId, standaloneRoleToken.roleId);
      continue;
    }

    const edgeMatch = trimmed.match(EDGE_REGEX);
    if (!edgeMatch) {
      continue;
    }

    for (const endpoint of [edgeMatch[1], edgeMatch[3]]) {
      const roleToken = parseRoleToken(endpoint);
      if (!roleToken) {
        continue;
      }
      nodeRoleMap.set(roleToken.nodeId, roleToken.roleId);
    }
  }

  for (const roleId of knownRoleIds) {
    if (!nodeRoleMap.has(roleId)) {
      nodeRoleMap.set(roleId, roleId);
    }
  }

  return nodeRoleMap;
}

function canonicalizeEndpointToken(token: string, nodeRoleMap: Map<string, string>): string {
  const normalizedBoundary = normalizeBoundaryToken(token);
  if (normalizedBoundary === "input" || normalizedBoundary === "output") {
    return normalizedBoundary;
  }

  const roleToken = parseRoleToken(normalizedBoundary);
  if (roleToken) {
    return `${roleToken.nodeId}[Role:${roleToken.roleId}]`;
  }

  if (BARE_NODE_TOKEN_REGEX.test(normalizedBoundary)) {
    const roleId = nodeRoleMap.get(normalizedBoundary);
    if (roleId) {
      return `${normalizedBoundary}[Role:${roleId}]`;
    }
  }

  return normalizedBoundary;
}

function isMarkdownFence(line: string): boolean {
  return /^```/.test(line.trim());
}

function isSupportedMetadataKey(key: string): boolean {
  if (SUPPORTED_EXACT_METADATA_KEYS.has(key)) {
    return true;
  }
  return SUPPORTED_METADATA_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function chooseDefaultModelRef(context: Nl2MmdContext): string | undefined {
  return context.defaultModelRef ?? context.modelCatalog[0]?.modelRef;
}

type CanonicalizedEdge = {
  fromToken: string;
  toToken: string;
  eventType: string;
};

function buildIncomingSourcesByRole(edges: CanonicalizedEdge[]): Map<string, string[]> {
  const incoming = new Map<string, Set<string>>();
  for (const edge of edges) {
    const fromRole = parseRoleToken(edge.fromToken);
    const toRole = parseRoleToken(edge.toToken);
    if (!fromRole || !toRole) {
      continue;
    }
    const bucket = incoming.get(toRole.roleId) ?? new Set<string>();
    bucket.add(fromRole.roleId);
    incoming.set(toRole.roleId, bucket);
  }
  return new Map(
    Array.from(incoming.entries()).map(([roleId, sources]) => [
      roleId,
      Array.from(sources).sort((left, right) => left.localeCompare(right))
    ])
  );
}

function sameRoleSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((roleId, index) => roleId === right[index]);
}

function rewriteMetadataKeyTarget(key: string, fromRoleId: string, toRoleId: string): string {
  if (key.startsWith(`context.map.${fromRoleId}.`)) {
    return `context.map.${toRoleId}.${key.slice(`context.map.${fromRoleId}.`.length)}`;
  }
  for (const prefix of ["join.mode.", "join.sources.", "join.min."]) {
    if (key === `${prefix}${fromRoleId}`) {
      return `${prefix}${toRoleId}`;
    }
  }
  return key;
}

function repairMisplacedJoinMetadata(args: {
  metadata: Map<string, string>;
  metadataOrder: string[];
  edges: CanonicalizedEdge[];
}): void {
  // Recovery semantics for generation drift: if join metadata was attached to the wrong role
  // but uniquely matches another role's incoming sources, move metadata to that role.
  const incomingSourcesByRole = buildIncomingSourcesByRole(args.edges);
  const joinRoleIds = Array.from(args.metadata.keys())
    .filter((key) => key.startsWith("join.mode."))
    .map((key) => key.slice("join.mode.".length));

  for (const roleId of joinRoleIds) {
    const joinSourcesKey = `join.sources.${roleId}`;
    const joinSourcesValue = args.metadata.get(joinSourcesKey);
    if (!joinSourcesValue) {
      continue;
    }

    const declaredSources = Array.from(
      new Set(
        joinSourcesValue
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right));
    const currentIncomingSources = incomingSourcesByRole.get(roleId) ?? [];
    if (sameRoleSet(declaredSources, currentIncomingSources)) {
      continue;
    }

    const candidates = Array.from(incomingSourcesByRole.entries())
      .filter(([candidateRoleId, sources]) => candidateRoleId !== roleId && sameRoleSet(declaredSources, sources))
      .map(([candidateRoleId]) => candidateRoleId);
    if (candidates.length !== 1) {
      continue;
    }

    const targetRoleId = candidates[0];
    const keysToMove = Array.from(args.metadata.keys()).filter(
      (key) =>
        key === `join.mode.${roleId}` ||
        key === `join.sources.${roleId}` ||
        key === `join.min.${roleId}` ||
        key.startsWith(`context.map.${roleId}.`)
    );

    for (const key of keysToMove) {
      const nextKey = rewriteMetadataKeyTarget(key, roleId, targetRoleId);
      if (!args.metadata.has(nextKey)) {
        args.metadata.set(nextKey, args.metadata.get(key) as string);
        if (!args.metadataOrder.includes(nextKey)) {
          args.metadataOrder.push(nextKey);
        }
      }
      args.metadata.delete(key);
    }

    for (let index = args.metadataOrder.length - 1; index >= 0; index -= 1) {
      const key = args.metadataOrder[index];
      if (
        key === `join.mode.${roleId}` ||
        key === `join.sources.${roleId}` ||
        key === `join.min.${roleId}` ||
        key.startsWith(`context.map.${roleId}.`)
      ) {
        args.metadataOrder.splice(index, 1);
      }
    }
  }
}

function collectCyclicRoleComponents(edges: CanonicalizedEdge[]): string[][] {
  const adjacency = new Map<string, Set<string>>();
  const roleIds = new Set<string>();
  const selfLoops = new Set<string>();

  for (const edge of edges) {
    const fromRole = parseRoleToken(edge.fromToken);
    const toRole = parseRoleToken(edge.toToken);
    if (!fromRole || !toRole) {
      continue;
    }
    roleIds.add(fromRole.roleId);
    roleIds.add(toRole.roleId);
    const bucket = adjacency.get(fromRole.roleId) ?? new Set<string>();
    bucket.add(toRole.roleId);
    adjacency.set(fromRole.roleId, bucket);
    if (fromRole.roleId === toRole.roleId) {
      selfLoops.add(fromRole.roleId);
    }
  }

  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const strongConnect = (roleId: string): void => {
    indices.set(roleId, index);
    lowlink.set(roleId, index);
    index += 1;
    stack.push(roleId);
    onStack.add(roleId);

    const nextRoles = adjacency.get(roleId) ?? new Set<string>();
    for (const nextRoleId of nextRoles) {
      if (!indices.has(nextRoleId)) {
        strongConnect(nextRoleId);
        const nextLowlink = lowlink.get(nextRoleId);
        const currentLowlink = lowlink.get(roleId);
        if (nextLowlink !== undefined && currentLowlink !== undefined && nextLowlink < currentLowlink) {
          lowlink.set(roleId, nextLowlink);
        }
        continue;
      }
      if (!onStack.has(nextRoleId)) {
        continue;
      }
      const nextIndex = indices.get(nextRoleId);
      const currentLowlink = lowlink.get(roleId);
      if (nextIndex !== undefined && currentLowlink !== undefined && nextIndex < currentLowlink) {
        lowlink.set(roleId, nextIndex);
      }
    }

    if (lowlink.get(roleId) !== indices.get(roleId)) {
      return;
    }
    const component: string[] = [];
    while (stack.length > 0) {
      const node = stack.pop() as string;
      onStack.delete(node);
      component.push(node);
      if (node === roleId) {
        break;
      }
    }
    if (component.length > 1) {
      components.push(component);
      return;
    }
    if (component.length === 1 && selfLoops.has(component[0])) {
      components.push(component);
    }
  };

  for (const roleId of roleIds) {
    if (!indices.has(roleId)) {
      strongConnect(roleId);
    }
  }

  return components;
}

function pickLoopBudgetRole(component: string[]): string {
  const priorityRegex = /(moderator|coordinator|dispatch|controller|judge)/i;
  const preferred = component.find((roleId) => priorityRegex.test(roleId));
  if (preferred) {
    return preferred;
  }
  return component.slice().sort((left, right) => left.localeCompare(right))[0];
}

function canonicalizeWithRuntimeDefaults(args: {
  normalizedMermaid: string;
  context: Nl2MmdContext;
}): string {
  const lines = args.normalizedMermaid.split(/\r?\n/);
  const metadata = new Map<string, string>();
  const metadataOrder: string[] = [];
  const edges: CanonicalizedEdge[] = [];
  const roleIds = new Set<string>();
  const inputTargets: string[] = [];
  let header: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (FLOWCHART_HEADER_REGEX.test(trimmed)) {
      header ??= trimmed;
      continue;
    }

    const metadataItem = parseMetadata(trimmed);
    if (metadataItem) {
      if (!isSupportedMetadataKey(metadataItem.key)) {
        continue;
      }
      if (!metadata.has(metadataItem.key)) {
        metadataOrder.push(metadataItem.key);
      }
      metadata.set(metadataItem.key, metadataItem.value);
      continue;
    }

    const edgeMatch = trimmed.match(EDGE_REGEX);
    if (!edgeMatch) {
      continue;
    }
    const fromToken = edgeMatch[1].trim();
    const toToken = edgeMatch[3].trim();
    const eventType = edgeMatch[2].trim();
    edges.push({ fromToken, toToken, eventType });

    const fromRole = parseRoleToken(fromToken);
    const toRole = parseRoleToken(toToken);
    if (fromRole) {
      roleIds.add(fromRole.roleId);
    }
    if (toRole) {
      roleIds.add(toRole.roleId);
    }
    if (fromToken === "input" && toRole) {
      inputTargets.push(toRole.roleId);
    }
  }

  if (!header) {
    header = "flowchart TD";
  }
  if (!metadata.get("system.id")) {
    metadata.set("system.id", "ogsystem.nl2mmd.autofix");
    metadataOrder.push("system.id");
  }
  if (!metadata.get("system.version")) {
    metadata.set("system.version", "1");
    metadataOrder.push("system.version");
  }
  if (!metadata.get("law.global")) {
    metadata.set("law.global", args.context.lawIds[0] ?? "law.console.base");
    metadataOrder.push("law.global");
  }

  const entryRole = metadata.get("entry.role");
  const inferredEntry = inputTargets[0] ?? Array.from(roleIds)[0];
  if (!entryRole && inferredEntry) {
    metadata.set("entry.role", inferredEntry);
    metadataOrder.push("entry.role");
  } else if (entryRole && !roleIds.has(entryRole) && inferredEntry) {
    metadata.set("entry.role", inferredEntry);
  }

  repairMisplacedJoinMetadata({
    metadata,
    metadataOrder,
    edges
  });

  for (const roleId of roleIds) {
    const modelKey = `model.bind.${roleId}`;
    const execKey = `exec.bind.${roleId}`;
    if (metadata.has(modelKey) || metadata.has(execKey)) {
      continue;
    }
    const defaultModelRef = chooseDefaultModelRef(args.context);
    if (!defaultModelRef) {
      continue;
    }
    metadata.set(modelKey, defaultModelRef);
    metadataOrder.push(modelKey);
  }

  const cycleComponents = collectCyclicRoleComponents(edges);
  for (const component of cycleComponents) {
    const hasLoopBudget = component.some((roleId) => metadata.has(`loop.max.${roleId}`));
    if (hasLoopBudget) {
      continue;
    }
    // Fail-closed default: inject a conservative loop budget so generated cyclic graphs
    // remain parseable by runtime validators without silently creating unbounded loops.
    const loopBudgetRole = pickLoopBudgetRole(component);
    const loopKey = `loop.max.${loopBudgetRole}`;
    metadata.set(loopKey, "3");
    metadataOrder.push(loopKey);
  }

  const requiredOrder = ["engine", "system.id", "system.version", "law.global", "entry.role"];
  const emittedMetadataLines: string[] = [];
  const emittedKeys = new Set<string>();
  for (const key of requiredOrder) {
    const value = metadata.get(key);
    if (!value) {
      continue;
    }
    emittedMetadataLines.push(`%% ${key}=${value}`);
    emittedKeys.add(key);
  }
  for (const key of metadataOrder) {
    if (emittedKeys.has(key)) {
      continue;
    }
    const value = metadata.get(key);
    if (!value) {
      continue;
    }
    emittedMetadataLines.push(`%% ${key}=${value}`);
    emittedKeys.add(key);
  }

  const edgeLines = edges.map((edge) => `${edge.fromToken} -->|${edge.eventType}| ${edge.toToken}`);
  return [header, ...emittedMetadataLines, ...edgeLines].join("\n").trim();
}

/**
 * Normalize NL2MMD Mermaid output into the strict runtime subset.
 * This closes common model gaps (standalone node declarations and bare edge node ids).
 */
export function normalizeNl2MmdMermaid(mermaid: string): string {
  const lines = mermaid.split(/\r?\n/).filter((line) => !isMarkdownFence(line));
  const nodeRoleMap = collectNodeRoleMap(lines);
  const normalizedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      normalizedLines.push("");
      continue;
    }

    if (parseRoleToken(trimmed)) {
      continue;
    }

    const edgeMatch = trimmed.match(EDGE_REGEX);
    if (!edgeMatch) {
      normalizedLines.push(trimmed);
      continue;
    }

    const fromToken = canonicalizeEndpointToken(edgeMatch[1], nodeRoleMap);
    const toToken = canonicalizeEndpointToken(edgeMatch[3], nodeRoleMap);
    const eventType = edgeMatch[2].trim();
    normalizedLines.push(`${fromToken} -->|${eventType}| ${toToken}`);
  }

  return normalizedLines.join("\n").trim();
}

export function stabilizeNl2MmdMermaidForRuntime(args: {
  mermaid: string;
  context: Nl2MmdContext;
}): string {
  const normalized = normalizeNl2MmdMermaid(args.mermaid);
  return canonicalizeWithRuntimeDefaults({
    normalizedMermaid: normalized,
    context: args.context
  });
}
