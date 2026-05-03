type Translator = (key: string, vars?: Record<string, unknown>, fallback?: string) => string;

export function renderWorkspaceEmptyStateHtml(args: {
  kind: string;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const { kind, t, escapeText } = args;
  const title = kind === "validate"
    ? t("workspace.validateUnavailableTitle", undefined, "Create or load a project before validating a release.")
    : kind === "operate"
      ? t("workspace.operateUnavailableTitle", undefined, "No project or runs are available yet.")
      : kind === "build"
        ? t("workspace.buildUnavailableTitle", undefined, "Create or load a project before building.")
        : t("workspace.projectUnavailableTitle", undefined, "This directory is not initialized as an OGSystem project.");
  const hint = t("workspace.createOrLoadHint", undefined, "Use Project to create a project in this directory or load an existing project.");
  return '<div class="event"><div class="event-top"><span>' + escapeText(t("common.empty", undefined, "empty")) +
    '</span><span>' + escapeText(t("nav.lifecycle.project", undefined, "Project")) + '</span></div><strong>' +
    escapeText(title) + '</strong><div class="hint">' + escapeText(hint) + '</div></div>';
}

export function renderOperateTabsHtml(args: {
  operateTab: string;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const { operateTab, t, escapeText } = args;
  const tabs = [
    ["overview", t("operate.tab.overview", undefined, "Overview"), t("operate.tabHint.overview", undefined, "Run status, summary, and timeline")],
    ["graph", t("operate.tab.graph", undefined, "Graph"), t("operate.tabHint.graph", undefined, "Readonly runtime graph and state")],
    ["recovery", t("operate.tab.recovery", undefined, "Recovery"), t("operate.tabHint.recovery", undefined, "Failure triage and resume readiness")],
    ["logs", t("operate.tab.logs", undefined, "Logs"), t("operate.tabHint.logs", undefined, "Load engine and role logs on demand")],
    ["reviews", t("operate.tab.reviews", undefined, "Reviews"), t("operate.tabHint.reviews", undefined, "Human review queue and decisions")],
    ["artifacts", t("operate.tab.artifacts", undefined, "Artifacts"), t("operate.tabHint.artifacts", undefined, "Run snapshots and exported evidence")]
  ];
  return tabs.map(([id, label, hint]) =>
    '<button class="button subtle ' + (operateTab === id ? "active" : "") +
    '" data-operate-tab="' + escapeText(id) +
    '" title="' + escapeText(hint) +
    '">' + escapeText(label) + '</button>'
  ).join("");
}

export function renderWorkbenchStructureHtml(args: {
  structure: Record<string, any> | null | undefined;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const { structure, t, escapeText } = args;
  if (!structure) {
    return '<div class="hint">' + escapeText(t("workbench.structurePending")) + '</div>';
  }
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("common.system")) + '</span><span>' + escapeText(structure.systemVersion || "n/a") + '</span></div><strong>' + escapeText(structure.systemId || t("common.unknown")) + '</strong><div class="hint">' + escapeText(t("common.entry")) + ' ' + escapeText(structure.entryRoleId || "n/a") + ' · ' + escapeText(t("common.roles")) + ' ' + escapeText(structure.roleCount || 0) + ' · ' + escapeText(t("studio.flows")) + ' ' + escapeText(structure.flowCount || 0) + '</div></div>',
    ...(structure.roles || []).map((role: Record<string, any>) =>
      '<div class="event"><div class="event-top"><span><code>' + escapeText(role.roleId) + '</code></span><span>' + escapeText(role.bindingKind) + '</span></div><strong>'
      + escapeText(role.reviewMode || role.joinMode || role.routingMode || t("project.standardRole"))
      + '</strong><div class="hint">'
      + escapeText([role.routingMode ? t("common.route") + " " + role.routingMode : "", role.joinMode ? t("common.join") + " " + role.joinMode : "", role.reviewMode ? t("common.review") + " " + role.reviewMode : ""].filter(Boolean).join(" · ") || t("project.noSpecialGraphMetadata"))
      + '</div></div>'
    ),
    ...(structure.flows || []).map((flow: Record<string, any>) =>
      '<div class="event"><div class="event-top"><span><code>' + escapeText(flow.fromRoleId) + '</code> -> <code>' + escapeText(flow.toRoleId) + '</code></span><span>' + escapeText(flow.eventType) + '</span></div><strong>' + escapeText(flow.label || flow.eventType) + '</strong></div>'
    ),
    '</div>'
  ].join("");
}

export function renderRunStatsHtml(args: {
  header: Record<string, any> | null | undefined;
  graphPayload: Record<string, any> | null | undefined;
  t: Translator;
  escapeText: (value: unknown) => string;
  displayUiToken: (value: unknown, t: Translator) => string;
}): string {
  const { header, graphPayload, t, escapeText, displayUiToken } = args;
  if (!header) {
    return "";
  }
  const cards = [
    [t("stats.status"), displayUiToken(header.status, t)],
    [t("stats.mode"), displayUiToken(graphPayload?.simulation?.mode || header.runMode || "runtime", t)],
    [t("stats.transitions"), header.transitionCount],
    [t("stats.activeBranches"), header.activeBranches],
    [t("stats.pendingReviews"), header.pendingReviewCount],
    [t("stats.recentAudits"), header.recentAudits]
  ];
  return cards
    .map(([label, value]) => `
      <div class="stat">
        <strong>${escapeText(value)}</strong>
        <span>${escapeText(label)}</span>
      </div>
    `)
    .join("");
}

export function renderTimelineHtml(args: {
  events: Array<Record<string, any>>;
  filters: Record<string, string>;
  t: Translator;
  escapeText: (value: unknown) => string;
  statusClass: (value: string) => string;
  displayUiToken: (value: unknown, t: Translator) => string;
  formatTime: (value: unknown) => string;
}): string {
  const { events, filters, t, escapeText, statusClass, displayUiToken, formatTime } = args;
  const activeFilters = [
    filters.roleId ? "role=" + filters.roleId : "",
    filters.type ? "type=" + filters.type : "",
    filters.status ? "status=" + filters.status : "",
    filters.branchId ? "branch=" + filters.branchId : "",
    filters.reviewId ? "review=" + filters.reviewId : "",
    filters.errorCode ? "error=" + filters.errorCode : ""
  ].filter(Boolean);
  if (!events.length) {
    return activeFilters.length
      ? '<div class="hint">' + escapeText(t("timeline.noEventsMatchFilters", { filters: activeFilters.join(" · ") })) + '</div>'
      : '<div class="hint">' + escapeText(t("timeline.noEventsCaptured")) + '</div>';
  }
  return [
    activeFilters.length
      ? '<div class="hint">' + escapeText(t("timeline.filteredBy", { filters: activeFilters.join(" · ") })) + "</div>"
      : "",
    ...events
      .slice()
      .reverse()
      .map((entry) => {
        const record = entry.record || {};
        const type = record.type || "event";
        const role = record.roleId ? `<code>${escapeText(record.roleId)}</code>` : "";
        const branch = record.branchId ? `<code>${escapeText(record.branchId)}</code>` : "";
        const review = record.reviewId ? `<code>${escapeText(record.reviewId)}</code>` : "";
        const event = record.event ? `<code>${escapeText(record.event)}</code>` : "";
        const status = record.status ? `<span class="status ${statusClass(record.status)}">${escapeText(displayUiToken(record.status, t))}</span>` : "";
        return `
          <div class="event">
            <div class="event-top">
              <span>#${escapeText(entry.cursor)} ${escapeText(displayUiToken(type, t))}</span>
              <span>${escapeText(formatTime(record.at))}</span>
            </div>
            <strong>${role} ${event} ${status}</strong>
            <div class="hint">${branch} ${review}</div>
          </div>
        `;
      })
  ].join("");
}
