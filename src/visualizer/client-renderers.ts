type JsonRecord = Record<string, unknown>;

function escapeText(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

export function statusTone(status: string | undefined): {
  fill: string;
  stroke: string;
  text: string;
} {
  switch (status) {
    case "active":
    case "waiting_review":
      return {
        fill: "rgba(56, 189, 248, 0.16)",
        stroke: "rgba(56, 189, 248, 0.52)",
        text: "#c8f4ff"
      };
    case "done":
    case "completed":
      return {
        fill: "rgba(52, 211, 153, 0.14)",
        stroke: "rgba(52, 211, 153, 0.44)",
        text: "#d8fff0"
      };
    case "failed":
      return {
        fill: "rgba(248, 113, 113, 0.14)",
        stroke: "rgba(248, 113, 113, 0.44)",
        text: "#ffe2e2"
      };
    default:
      return {
        fill: "rgba(148, 163, 184, 0.1)",
        stroke: "rgba(148, 163, 184, 0.3)",
        text: "#e5eefb"
      };
  }
}

export function bindingTone(bindingKind: string | undefined): string {
  switch (bindingKind) {
    case "model":
      return "model";
    case "profile":
      return "profile";
    default:
      return "noop";
  }
}

export function renderProjectSummaryPanel(args: {
  summary: JsonRecord | null | undefined;
  roles: Array<Record<string, unknown>>;
  warnings: string[];
  workbenchSavedPath: string;
  validationOk: boolean;
}): string {
  const summary = args.summary ?? {};
  const roleCards = args.roles.map((role) => {
    const roleId = escapeText(role.roleId);
    const binding = escapeText((role.binding as JsonRecord | undefined)?.bindingKind ?? "n/a");
    const flags = [
      role.review ? "review" : "",
      role.join ? "join" : "",
      role.loop ? "loop" : "",
      role.projection ? "projection" : ""
    ].filter(Boolean);
    return (
      '<div class="event">' +
      '<div class="event-top"><span><code>' + roleId + "</code></span><span>" + binding + "</span></div>" +
      "<strong>" + escapeText(flags.join(" · ") || "standard role") + "</strong>" +
      '<div class="hint">' + escapeText((role.summary as JsonRecord | undefined)?.label ?? "role package available") + "</div>" +
      "</div>"
    );
  });
  const warningCards = args.warnings.length > 0
    ? args.warnings.map((warning) =>
        '<div class="event"><div class="event-top"><span>model warning</span><span>attention</span></div><strong>' +
        escapeText(warning) +
        "</strong></div>"
      )
    : ['<div class="event"><div class="event-top"><span>model warning</span><span>ok</span></div><strong>none</strong></div>'];

  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>project</span><span>' + escapeText(summary.projectId ?? "n/a") + "</span></div><strong>" +
      escapeText(summary.projectName ?? "unknown") + '</strong><div class="hint">system ' + escapeText(summary.systemId ?? "n/a") +
      " · version " + escapeText(summary.systemVersion ?? "n/a") +
      " · entry " + escapeText(summary.entryRoleId ?? "n/a") + "</div></div>",
    '<div class="event"><div class="event-top"><span>structure</span><span>' + escapeText(summary.roleCount ?? 0) + " roles</span></div><strong>" +
      escapeText("flows " + String(summary.flowCount ?? 0) + " · workbench " + (args.validationOk ? "validated" : "needs attention")) +
      '</strong><div class="hint">system path ' + escapeText(args.workbenchSavedPath || "system.mmd") + "</div></div>",
    '<div class="event"><div class="event-top"><span>special roles</span><span>graph metadata</span></div><strong>' +
      escapeText("review " + ((summary.reviewedRoleIds as unknown[] | undefined)?.join(", ") || "none")) +
      '</strong><div class="hint">join ' + escapeText((summary.joinRoleIds as unknown[] | undefined)?.join(", ") || "none") +
      " · loop " + escapeText((summary.loopRoleIds as unknown[] | undefined)?.join(", ") || "none") +
      " · context " + escapeText((summary.contextMappedRoleIds as unknown[] | undefined)?.join(", ") || "none") + "</div></div>",
    ...warningCards,
    ...roleCards,
    "</div>"
  ].join("");
}

export function renderReviewDetailPanel(detail: Record<string, unknown> | null | undefined): string {
  if (!detail) {
    return '<div class="hint">No review selected.</div>';
  }
  const history = Array.isArray(detail.history) ? detail.history : [];
  const historyCards = history.length > 0
    ? history.map((entry) => {
        const record = (entry ?? {}) as JsonRecord;
        return (
          '<div class="event"><div class="event-top"><span>' +
          escapeText(record.decision ?? "history") +
          "</span><span>" +
          escapeText(record.decidedAt ?? record.committedAt ?? "n/a") +
          "</span></div><strong>" +
          escapeText(record.actor ?? "unknown actor") +
          '</strong><div class="hint">' +
          escapeText(record.comment ?? "no comment") +
          "</div></div>"
        );
      })
    : ['<div class="hint">No prior decision history.</div>'];
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>review</span><span>' + escapeText(detail.currentStatus ?? "unknown") + "</span></div><strong>" +
      escapeText(detail.reviewId ?? "n/a") +
      '</strong><div class="hint">' +
      escapeText((detail.roleId ?? "n/a") + " · " + (detail.branchId ?? "n/a")) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>decision</span><span>' + escapeText(detail.decisionPhase ?? "none") + "</span></div><strong>" +
      escapeText(detail.decision ?? "pending") +
      '</strong><div class="hint">' +
      escapeText((detail.actor ?? "n/a") + " · " + (detail.comment ?? "no comment")) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>timing</span><span>round ' + escapeText(detail.round ?? "n/a") + '</span></div><strong>' +
      escapeText("requested " + (detail.requestedAt ?? "n/a")) +
      '</strong><div class="hint">' +
      escapeText("decided " + (detail.decidedAt ?? "n/a") + " · applied " + (detail.appliedAt ?? "n/a")) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>selected event</span><span>' + escapeText(detail.scope ?? "n/a") + '</span></div><strong>' +
      escapeText(detail.selectedEvent ?? "n/a") +
      '</strong><div class="hint">' +
      escapeText("execution " + (detail.executionId ?? "n/a") + " · requestedBy " + (detail.requestedByExecutionId ?? "n/a")) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>history</span><span>' + escapeText(history.length) + '</span></div><strong>Decision trail</strong></div>',
    ...historyCards,
    '<div class="event"><div class="event-top"><span>context</span><span>snapshot</span></div><strong>Human review context</strong><pre>' +
      escapeText(formatJson(detail.humanReviewContext ?? null)) +
      "</pre></div>",
    "</div>"
  ].join("");
}

export function renderLogsPanel(args: {
  loaded: boolean;
  stale: boolean;
  selectedRoleId: string;
  engine: unknown[];
  role: unknown[];
}): string {
  if (!args.loaded) {
    return '<div class="hint">Logs load on demand. Use the control above when you need engine or role traces.</div>';
  }

  const renderLogEntries = (label: string, records: unknown[]): string => {
    if (!records.length) {
      return (
        '<div class="event"><div class="event-top"><span>' +
        escapeText(label) +
        '</span><span>0</span></div><strong>no records</strong></div>'
      );
    }
    return [
      '<div class="event"><div class="event-top"><span>' + escapeText(label) + '</span><span>' + escapeText(records.length) + '</span></div><strong>' +
        escapeText(label === "role log" ? (args.selectedRoleId || "latest role") : "engine stream") +
        '</strong><div class="hint">' + escapeText(args.stale ? "stale since last stream event" : "fresh") + "</div></div>",
      ...records.map((item) => {
        const record = (item ?? {}) as JsonRecord;
        const summary = typeof record.message === "string"
          ? record.message
          : typeof record.line === "string"
            ? record.line
            : formatJson(record);
        return (
          '<div class="event"><div class="event-top"><span>' +
          escapeText(record.level ?? label) +
          "</span><span>" +
          escapeText(record.at ?? record.timestamp ?? "n/a") +
          "</span></div><strong>" +
          escapeText(summary) +
          "</strong></div>"
        );
      })
    ].join("");
  };

  return [
    '<div class="structure-list">',
    renderLogEntries("engine log", args.engine),
    renderLogEntries("role log", args.role),
    "</div>"
  ].join("");
}

export function renderRunTopologySvg(graph: Record<string, unknown> | null | undefined): string {
  if (!graph) {
    return '<div class="hint">Graph projection unavailable.</div>';
  }
  const nodes = Array.isArray(graph.nodes) ? graph.nodes as JsonRecord[] : [];
  const edges = Array.isArray(graph.edges) ? graph.edges as JsonRecord[] : [];
  if (!nodes.length) {
    return '<div class="hint">No graph nodes available.</div>';
  }

  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of nodes) {
    const roleId = String(node.roleId ?? "");
    adjacency.set(roleId, []);
    indegree.set(roleId, 0);
  }
  for (const edge of edges) {
    const source = String(edge.sourceRoleId ?? "");
    const target = String(edge.targetRoleId ?? "");
    if (!adjacency.has(source) || !indegree.has(target)) {
      continue;
    }
    adjacency.get(source)?.push(target);
    indegree.set(target, (indegree.get(target) ?? 0) + 1);
  }

  const levels = new Map<string, number>();
  const queue: string[] = [];
  const entryRoleId = String(graph.entryRoleId ?? "");
  if (entryRoleId && indegree.has(entryRoleId)) {
    queue.push(entryRoleId);
  }
  for (const [roleId, degree] of indegree.entries()) {
    if (degree === 0 && roleId !== entryRoleId) {
      queue.push(roleId);
    }
  }
  const pendingIndegree = new Map(indegree);
  const visited = new Set<string>();
  while (queue.length > 0) {
    const roleId = queue.shift() ?? "";
    if (!roleId || visited.has(roleId)) {
      continue;
    }
    visited.add(roleId);
    const currentLevel = levels.get(roleId) ?? 0;
    for (const target of adjacency.get(roleId) ?? []) {
      levels.set(target, Math.max(levels.get(target) ?? 0, currentLevel + 1));
      pendingIndegree.set(target, (pendingIndegree.get(target) ?? 1) - 1);
      if ((pendingIndegree.get(target) ?? 0) <= 0) {
        queue.push(target);
      }
    }
  }
  let fallbackLevel = Math.max(0, ...levels.values(), 0);
  for (const node of nodes) {
    const roleId = String(node.roleId ?? "");
    if (!levels.has(roleId)) {
      fallbackLevel += 1;
      levels.set(roleId, fallbackLevel);
    }
  }

  const columns = new Map<number, JsonRecord[]>();
  for (const node of nodes) {
    const level = levels.get(String(node.roleId ?? "")) ?? 0;
    const bucket = columns.get(level) ?? [];
    bucket.push(node);
    columns.set(level, bucket);
  }

  const nodeWidth = 220;
  const nodeHeight = 112;
  const gapX = 140;
  const gapY = 44;
  const padding = 40;
  const positions = new Map<string, { x: number; y: number }>();
  const columnEntries = [...columns.entries()].sort((left, right) => left[0] - right[0]);
  const maxRows = Math.max(...columnEntries.map(([, columnNodes]) => columnNodes.length), 1);
  for (const [columnIndex, columnNodes] of columnEntries) {
    columnNodes.forEach((node, rowIndex) => {
      const roleId = String(node.roleId ?? "");
      const x = padding + (columnIndex * (nodeWidth + gapX));
      const topOffset = ((maxRows - columnNodes.length) * (nodeHeight + gapY)) / 2;
      const y = padding + topOffset + (rowIndex * (nodeHeight + gapY));
      positions.set(roleId, { x, y });
    });
  }

  const width = padding * 2 + (Math.max(columnEntries.length, 1) * nodeWidth) + (Math.max(columnEntries.length - 1, 0) * gapX);
  const height = padding * 2 + (maxRows * nodeHeight) + (Math.max(maxRows - 1, 0) * gapY);
  const edgeSvg = edges.map((edge) => {
    const source = positions.get(String(edge.sourceRoleId ?? ""));
    const target = positions.get(String(edge.targetRoleId ?? ""));
    if (!source || !target) {
      return "";
    }
    const x1 = source.x + nodeWidth;
    const y1 = source.y + (nodeHeight / 2);
    const x2 = target.x;
    const y2 = target.y + (nodeHeight / 2);
    const midX = (x1 + x2) / 2;
    const stroke = edge.isErrorFlow ? "rgba(248,113,113,0.64)" : edge.recentlyActivated ? "rgba(56,189,248,0.72)" : "rgba(148,163,184,0.34)";
    return (
      '<g>' +
      '<path d="M ' + x1 + " " + y1 + " C " + midX + " " + y1 + ", " + midX + " " + y2 + ", " + x2 + " " + y2 +
      '" fill="none" stroke="' + stroke + '" stroke-width="3" marker-end="url(#run-arrow)" />' +
      '<text x="' + midX + '" y="' + (Math.min(y1, y2) + Math.abs(y2 - y1) / 2 - 8) + '" text-anchor="middle" fill="#8fa1c3" font-size="11" font-family="IBM Plex Mono, monospace">' +
      escapeText(edge.event ?? "") +
      "</text></g>"
    );
  }).join("");

  const nodeSvg = nodes.map((node) => {
    const roleId = String(node.roleId ?? "");
    const position = positions.get(roleId);
    if (!position) {
      return "";
    }
    const tone = statusTone(String(node.status ?? ""));
    const binding = bindingTone(String(node.bindingKind ?? ""));
    const badge = binding === "model" ? "#38bdf8" : binding === "profile" ? "#34d399" : "#94a3b8";
    return (
      '<g>' +
      '<rect x="' + position.x + '" y="' + position.y + '" width="' + nodeWidth + '" height="' + nodeHeight + '" rx="22" ry="22" fill="' + tone.fill + '" stroke="' + tone.stroke + '" stroke-width="2" />' +
      '<circle cx="' + (position.x + 20) + '" cy="' + (position.y + 22) + '" r="7" fill="' + badge + '" />' +
      '<text x="' + (position.x + 34) + '" y="' + (position.y + 27) + '" fill="' + tone.text + '" font-size="15" font-family="IBM Plex Sans, sans-serif">' + escapeText(roleId) + '</text>' +
      '<text x="' + (position.x + 20) + '" y="' + (position.y + 54) + '" fill="#8fa1c3" font-size="12" font-family="IBM Plex Sans, sans-serif">' +
      escapeText(String(node.nodeType ?? "role") + " · " + String(node.status ?? "idle")) +
      '</text>' +
      '<text x="' + (position.x + 20) + '" y="' + (position.y + 76) + '" fill="#dce7f7" font-size="12" font-family="IBM Plex Sans, sans-serif">' +
      escapeText("active " + String(node.activeBranchCount ?? 0) + " · wait " + String(node.waitingReviewCount ?? 0) + " · pending " + String(node.pendingReviewCount ?? 0)) +
      '</text>' +
      '<text x="' + (position.x + 20) + '" y="' + (position.y + 96) + '" fill="#8fa1c3" font-size="11" font-family="IBM Plex Mono, monospace">' +
      escapeText(String(node.lastSelectedEvent ?? node.lastErrorCode ?? node.joinMode ?? "steady")) +
      "</text></g>"
    );
  }).join("");

  return (
    '<div class="preview">' +
    '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="Run topology graph">' +
    '<defs><marker id="run-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.58)"></path></marker></defs>' +
    edgeSvg +
    nodeSvg +
    "</svg></div>"
  );
}

export function renderWorkbenchTopologySvg(structure: Record<string, unknown> | null | undefined): string {
  if (!structure || !Array.isArray(structure.roles) || !structure.roles.length) {
    return '<div class="hint">Rendered view is available after Mermaid validation succeeds.</div>';
  }
  const roles = structure.roles as JsonRecord[];
  const flows = Array.isArray(structure.flows) ? structure.flows as JsonRecord[] : [];
  const knownRoleIds = new Set(roles.map((role) => String(role.roleId ?? "")));
  const terminalNodes: JsonRecord[] = [];
  for (const flow of flows) {
    for (const endpoint of [flow.fromRoleId, flow.toRoleId]) {
      const roleId = String(endpoint ?? "");
      if (!roleId || knownRoleIds.has(roleId)) {
        continue;
      }
      knownRoleIds.add(roleId);
      terminalNodes.push({
        roleId,
        bindingKind: "terminal",
        nodeType: "terminal"
      });
    }
  }
  return renderRunTopologySvg({
    entryRoleId: structure.entryRoleId,
    nodes: roles.concat(terminalNodes).map((role) => ({
      roleId: role.roleId,
      nodeType: role.nodeType ?? "role",
      status: "idle",
      bindingKind: role.bindingKind,
      activeBranchCount: 0,
      waitingReviewCount: 0,
      pendingReviewCount: 0,
      lastSelectedEvent: role.reviewMode || role.joinMode || role.routingMode || "structure"
    })),
    edges: flows.map((flow) => ({
          sourceRoleId: flow.fromRoleId,
          targetRoleId: flow.toRoleId,
          event: flow.eventType,
          isErrorFlow: false,
          recentlyActivated: false
        }))
  }).replace("Run topology graph", "Mermaid workbench topology");
}
