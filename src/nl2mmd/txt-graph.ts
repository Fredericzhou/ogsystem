/**
 * @fileoverview Human-readable txt-graph renderer derived from Mermaid source.
 * File Set: nl2mmd-observability
 * Responsibilities:
 * - Parse role/boundary edges from Mermaid.
 * - Render compact role/binding/connection summary text.
 * Boundaries:
 * - Visualization only; does not validate runtime semantics.
 */
type ParsedNodeToken =
  | {
      kind: "boundary";
      value: "input" | "output";
    }
  | {
      kind: "role";
      roleId: string;
    };

type ParsedEdge = {
  from: ParsedNodeToken;
  to: ParsedNodeToken;
  eventType: string;
};

type ParsedTxtGraph = {
  metadata: Map<string, string>;
  edges: ParsedEdge[];
  roleIds: string[];
};

function parseNodeToken(token: string): ParsedNodeToken {
  const trimmed = token.trim();
  if (trimmed === "input" || trimmed === "output") {
    return {
      kind: "boundary",
      value: trimmed
    };
  }
  const match = trimmed.match(/^[A-Za-z0-9._:-]+\[Role:([A-Za-z0-9._:-]+)\]$/);
  if (!match) {
    throw new Error(`Cannot render txt graph for invalid node token "${trimmed}"`);
  }
  return {
    kind: "role",
    roleId: match[1]
  };
}

function parseMermaidForTxtGraph(source: string): ParsedTxtGraph {
  const metadata = new Map<string, string>();
  const edges: ParsedEdge[] = [];
  const roleIds = new Set<string>();

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("flowchart")) {
      continue;
    }
    if (line.startsWith("%%")) {
      const raw = line.slice(2).trim();
      const separator = raw.indexOf("=");
      if (separator > 0) {
        metadata.set(raw.slice(0, separator).trim(), raw.slice(separator + 1).trim());
      }
      continue;
    }

    const match = line.match(/^(.+?)\s*-->\|(.+?)\|\s*(.+)$/);
    if (!match) {
      continue;
    }
    const from = parseNodeToken(match[1]);
    const to = parseNodeToken(match[3]);
    if (from.kind === "role") {
      roleIds.add(from.roleId);
    }
    if (to.kind === "role") {
      roleIds.add(to.roleId);
    }
    edges.push({
      from,
      to,
      eventType: match[2].trim()
    });
  }

  return {
    metadata,
    edges,
    roleIds: Array.from(roleIds)
  };
}

function renderRoleBindingSummary(roleId: string, metadata: Map<string, string>): string {
  const parts: string[] = [];
  const modelId = metadata.get(`model.bind.${roleId}`);
  const execId = metadata.get(`exec.bind.${roleId}`);
  const roleMode = metadata.get(`role.mode.${roleId}`);
  const joinMode = metadata.get(`join.mode.${roleId}`);
  const joinSources = metadata.get(`join.sources.${roleId}`);
  const loopMax = metadata.get(`loop.max.${roleId}`);

  if (modelId) {
    parts.push(`model=${modelId}`);
  }
  if (execId) {
    parts.push(`exec=${execId}`);
  }
  if (roleMode) {
    parts.push(`mode=${roleMode}`);
  }
  if (joinMode) {
    parts.push(`join=${joinMode}`);
  }
  if (joinSources) {
    parts.push(`sources=${joinSources}`);
  }
  if (loopMax) {
    parts.push(`loop.max=${loopMax}`);
  }

  return parts.length > 0 ? ` [${parts.join(", ")}]` : "";
}

function renderToken(
  token: ParsedNodeToken,
  metadata: Map<string, string>
): string {
  if (token.kind === "boundary") {
    return `[${token.value}]`;
  }
  return `${token.roleId}${renderRoleBindingSummary(token.roleId, metadata)}`;
}

export function renderTxtGraphFromMermaidSource(source: string): string {
  const parsed = parseMermaidForTxtGraph(source);
  const lines = [
    `SYSTEM ${parsed.metadata.get("system.id") ?? "(unknown)"} v${parsed.metadata.get("system.version") ?? "(unknown)"}`,
    `LAW ${parsed.metadata.get("law.global") ?? "(unknown)"}`,
    `ENTRY ${parsed.metadata.get("entry.role") ?? "(infer-from-input)"}`,
    ""
  ];

  if (parsed.roleIds.length > 0) {
    lines.push("ROLES");
    for (const roleId of parsed.roleIds.sort()) {
      lines.push(`  ${roleId}${renderRoleBindingSummary(roleId, parsed.metadata)}`);
    }
    lines.push("");
  }

  lines.push("CONNECTIONS");
  const grouped = new Map<string, ParsedEdge[]>();
  for (const edge of parsed.edges) {
    const key = edge.from.kind === "boundary" ? edge.from.value : edge.from.roleId;
    const bucket = grouped.get(key) ?? [];
    bucket.push(edge);
    grouped.set(key, bucket);
  }

  for (const key of Array.from(grouped.keys()).sort()) {
    const header = key === "input" || key === "output" ? `[${key}]` : `[${key}]`;
    lines.push(header);
    for (const edge of grouped.get(key) ?? []) {
      lines.push(`  --${edge.eventType}--> ${renderToken(edge.to, parsed.metadata)}`);
    }
  }

  return lines.join("\n").trimEnd();
}
