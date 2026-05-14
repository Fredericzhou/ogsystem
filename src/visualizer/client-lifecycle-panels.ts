type Translator = (key: string, vars?: Record<string, unknown>, fallback?: string) => string;

export function renderLoadingSkeletonHtml(args: {
  label: string;
  rows?: number;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const { label, rows = 3, t, escapeText } = args;
  const safeRows = Math.max(1, Math.min(Number.isFinite(rows) ? Math.floor(rows) : 3, 6));
  return [
    '<div class="loading-skeleton" role="status" aria-live="polite" aria-busy="true">',
    '<span class="sr-only">' + escapeText(label || t("state.loading", undefined, "Loading")) + '</span>',
    ...Array.from({ length: safeRows }, (_item, index) =>
      '<div class="skeleton-line skeleton-line-' + String(index + 1) + '"></div>'
    ),
    '</div>'
  ].join("");
}

export function renderWorkspaceEmptyStateHtml(args: {
  kind: string;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const { kind, t, escapeText } = args;
  const title = kind === "validate"
    ? t("workspace.validateUnavailableTitle", undefined, "Initialize the current directory before validating a release.")
    : kind === "operate"
      ? t("workspace.operateUnavailableTitle", undefined, "No project or runs are available yet.")
      : kind === "build"
        ? t("workspace.buildUnavailableTitle", undefined, "Initialize the current directory before building.")
        : t("workspace.projectUnavailableTitle", undefined, "This directory is not initialized as an OGSystem project.");
  const hint = t("workspace.createOrLoadHint", undefined, "Use Project to initialize the current directory as an OGSystem project.");
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
    ["overview", "operate-tabpanel-overview", t("operate.tab.overview", undefined, "Overview"), t("operate.tabHint.overview", undefined, "Run status, summary, and timeline")],
    ["graph", "operate-tabpanel-graph", t("operate.tab.graph", undefined, "Graph"), t("operate.tabHint.graph", undefined, "Readonly runtime graph and state")],
    ["recovery", "operate-tabpanel-recovery", t("operate.tab.recovery", undefined, "Recovery"), t("operate.tabHint.recovery", undefined, "Failure triage and resume readiness")],
    ["logs", "console-panel-logs", t("operate.tab.logs", undefined, "Logs"), t("operate.tabHint.logs", undefined, "Load engine and role logs on demand")],
    ["reviews", "operate-tabpanel-reviews", t("operate.tab.reviews", undefined, "Reviews"), t("operate.tabHint.reviews", undefined, "Human review queue and decisions")],
    ["artifacts", "console-panel-artifacts", t("operate.tab.artifacts", undefined, "Artifacts"), t("operate.tabHint.artifacts", undefined, "Run snapshots and exported evidence")]
  ];
  return tabs.map(([id, panelId, label, hint]) =>
    '<button class="button subtle ' + (operateTab === id ? "active" : "") +
    '" id="operate-tab-' + escapeText(id) +
    '" data-operate-tab="' + escapeText(id) +
    '" role="tab"' +
    '" aria-controls="' + escapeText(panelId) +
    '" aria-selected="' + escapeText(String(operateTab === id)) +
    '" aria-pressed="' + escapeText(String(operateTab === id)) +
    '" tabindex="' + escapeText(operateTab === id ? "0" : "-1") +
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

export function renderWorkbenchStatusHtml(args: {
  dirty: boolean;
  entryRoleId: string;
  lastDryRunId: string;
  validation: Record<string, any> | null | undefined;
  diagnostics: Array<unknown>;
  hasDraft: boolean;
  validating: boolean;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const { dirty, entryRoleId, lastDryRunId, validation, diagnostics, hasDraft, validating, t, escapeText } = args;
  const renderPill = (label: string, options?: { code?: string; warn?: boolean; className?: string; title?: string }): string => {
    const className = ["pill", "pill-compact", options?.warn ? "warn" : "", options?.className || ""]
      .filter(Boolean)
      .join(" ");
    const title = options?.title ? ' title="' + escapeText(options.title) + '"' : "";
    return '<span class="' + className + '"' + title + '><span class="pill-label">' + escapeText(label) + '</span>' +
      (options?.code ? '<code>' + escapeText(options.code) + '</code>' : "") +
      '</span>';
  };
  const validationPill = validating
    ? renderPill(t("workbench.validating"), {
        warn: true,
        className: "workbench-status-progress"
      })
    : validation
      ? renderPill(validation.ok ? t("workbench.validationOk") : t("workbench.diagnostics", { count: diagnostics.length }), {
          warn: Boolean(!validation.ok),
          className: "workbench-status-validation"
        })
      : renderPill(t("workbench.validationPending"), {
          className: "workbench-status-validation"
        });
  return [
    renderPill(dirty ? t("workbench.unsavedChanges") : t("workbench.diskInSync"), {
      warn: dirty,
      className: "workbench-status-sync"
    }),
    renderPill(t("workbench.entryRole", undefined, "entry"), {
      code: entryRoleId || "n/a",
      className: "workbench-status-entry",
      title: t("workbench.entryRole", undefined, "entry") + " " + (entryRoleId || "n/a")
    }),
    validationPill,
    hasDraft ? renderPill(t("workbench.draftCached"), {
      warn: true,
      className: "workbench-status-draft"
    }) : "",
    lastDryRunId ? renderPill(t("build.lastDryRun", undefined, "Last dry run"), {
      code: lastDryRunId,
      className: "workbench-status-last-run",
      title: t("build.lastDryRun", undefined, "Last dry run") + " " + lastDryRunId
    }) : ""
  ].filter(Boolean).join("");
}

export function renderWorkbenchModeTabsHtml(args: {
  buildMode: string;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  void args;
  return "";
}

export function renderWorkbenchViewTabsHtml(args: {
  buildMode: string;
  workbenchView: string;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const { workbenchView, t, escapeText } = args;
  return [
    '<button type="button" class="button subtle ' + (workbenchView === "bridge" ? "active" : "") + '" data-workbench-view="bridge" aria-pressed="' + escapeText(String(workbenchView === "bridge")) + '">' + escapeText(t("workbench.graph", undefined, "Graph")) + '</button>',
    '<button type="button" class="button subtle ' + (workbenchView === "source" ? "active" : "") + '" data-workbench-view="source" aria-pressed="' + escapeText(String(workbenchView === "source")) + '">' + escapeText(t("workbench.source")) + '</button>'
  ].join("");
}

export function renderWorkbenchActionsHtml(args: {
  dirty: boolean;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const { dirty, t, escapeText } = args;
  return [
    '<button class="button" id="build-validate">' + escapeText(t("action.validate", undefined, "Validate")) + '</button>',
    '<button class="button primary" id="build-save"' + (dirty ? "" : " disabled") + '>' + escapeText(t("action.save", undefined, "Save")) + '</button>'
  ].join("");
}

export function renderWorkbenchSourceActionControlsHtml(args: {
  dirty: boolean;
  hasDraft: boolean;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const { dirty, hasDraft, t, escapeText } = args;
  return [
    renderWorkbenchActionsHtml({ dirty, t, escapeText }),
    '<button class="button subtle" id="workbench-new-draft">' + escapeText(t("action.newDraft")) + '</button>',
    hasDraft ? '<button class="button subtle" id="workbench-recover-draft">' + escapeText(t("action.recoverDraft")) + '</button>' : "",
    dirty ? '<button class="button subtle" id="workbench-revert">' + escapeText(t("action.revertToDisk")) + '</button>' : ""
  ].filter(Boolean).join("");
}

export function renderWorkbenchModeBodyHtml(args: {
  buildMode: string;
  workbenchView: string;
  dirty: boolean;
  workbenchSavedPath: string;
  lastDryRunId: string;
  hasDraft: boolean;
  workbenchSource: string;
  workbenchRunDraft?: Record<string, any> | null | undefined;
  workbenchRunDraftErrors?: Record<string, any> | null | undefined;
  actionBusy?: boolean;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const {
    workbenchView,
    dirty,
    hasDraft,
    workbenchSource,
    t,
    escapeText
  } = args;
  if (workbenchView === "source") {
    return [
      '<div class="studio-source-panel">',
      '<div class="workbench-source-actions">',
      '<div class="hint">' + escapeText(t("workbench.sourceActionsHint", undefined, "Draft actions only affect the current graph source until you save.")) + '</div>',
      '<div id="workbench-source-actions-controls" class="toolbar-group">',
      renderWorkbenchSourceActionControlsHtml({ dirty, hasDraft, t, escapeText }),
      '</div>',
      '</div>',
      '<textarea id="workbench-editor" class="editor" spellcheck="false" aria-label="' + escapeText(t("workbench.editorAriaLabel", undefined, "Graph source editor")) + '">' + escapeText(workbenchSource || "") + '</textarea>',
      '</div>'
    ].join("");
  }
  return "";
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

export function renderTimelineEventHtml(args: {
  entry: Record<string, any>;
  escapeText: (value: unknown) => string;
  statusClass: (value: string) => string;
  displayUiToken: (value: unknown, t: Translator) => string;
  formatTime: (value: unknown) => string;
  t: Translator;
}): string {
  const { entry, escapeText, statusClass, displayUiToken, formatTime, t } = args;
  const record = entry.record || {};
  const type = record.type || "event";
  const role = record.roleId ? `<code>${escapeText(record.roleId)}</code>` : "";
  const branch = record.branchId ? `<code>${escapeText(record.branchId)}</code>` : "";
  const review = record.reviewId ? `<code>${escapeText(record.reviewId)}</code>` : "";
  const event = record.event ? `<code>${escapeText(record.event)}</code>` : "";
  const status = record.status ? `<span class="status ${statusClass(record.status)}">${escapeText(displayUiToken(record.status, t))}</span>` : "";
  return `<div class="event"><div class="event-top"><span>#${escapeText(entry.cursor)} ${escapeText(displayUiToken(type, t))}</span><span>${escapeText(formatTime(record.at))}</span></div><strong>${role} ${event} ${status}</strong><div class="hint">${branch} ${review}</div></div>`;
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
