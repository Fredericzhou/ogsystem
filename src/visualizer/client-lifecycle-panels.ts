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
  return [
    '<span class="pill' + (dirty ? " warn" : "") + '">' + escapeText(dirty ? t("workbench.unsavedChanges") : t("workbench.diskInSync")) + '</span>',
    '<span class="pill">' + escapeText(t("workbench.entryRole", undefined, "entry")) + ' <code>' + escapeText(entryRoleId || "n/a") + '</code></span>',
    lastDryRunId ? '<span class="pill">' + escapeText(t("build.lastDryRun", undefined, "Last dry run")) + ' <code>' + escapeText(lastDryRunId) + '</code></span>' : "",
    validation
      ? '<span class="pill' + (validation.ok ? "" : " warn") + '">' + escapeText(validation.ok ? t("workbench.validationOk") : t("workbench.diagnostics", { count: diagnostics.length })) + '</span>'
      : '<span class="pill">' + escapeText(t("workbench.validationPending")) + '</span>',
    hasDraft ? '<span class="pill warn">' + escapeText(t("workbench.draftCached")) + '</span>' : "",
    validating ? '<span class="pill warn">' + escapeText(t("workbench.validating")) + '</span>' : ""
  ].filter(Boolean).join("");
}

export function renderWorkbenchModeTabsHtml(args: {
  buildMode: string;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const { buildMode, t, escapeText } = args;
  return [
    '<button class="button subtle ' + (buildMode === "edit" ? "active" : "") + '" data-build-mode="edit">' + escapeText(t("build.mode.edit", undefined, "Edit")) + '</button>',
    '<button class="button subtle ' + (buildMode === "dry-run" ? "active" : "") + '" data-build-mode="dry-run">' + escapeText(t("build.mode.dryRun", undefined, "Dry Run")) + '</button>',
    '<button class="button subtle ' + (buildMode === "debug" ? "active" : "") + '" data-build-mode="debug">' + escapeText(t("build.mode.debug", undefined, "Debug")) + '</button>'
  ].join("");
}

export function renderWorkbenchViewTabsHtml(args: {
  buildMode: string;
  workbenchView: string;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const { buildMode, workbenchView, t, escapeText } = args;
  return buildMode === "edit"
    ? [
        '<button class="button subtle ' + (workbenchView === "bridge" ? "active" : "") + '" data-workbench-view="bridge">' + escapeText(t("workbench.graph", undefined, "Graph")) + '</button>',
        '<button class="button subtle ' + (workbenchView === "source" ? "active" : "") + '" data-workbench-view="source">' + escapeText(t("workbench.source")) + '</button>'
      ].join("")
    : "";
}

export function renderWorkbenchActionsHtml(args: {
  dirty: boolean;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const { dirty, t, escapeText } = args;
  return [
    '<button class="button" id="build-validate">' + escapeText(t("action.validate", undefined, "Validate")) + '</button>',
    '<button class="button primary" id="build-save"' + (dirty ? "" : " disabled") + '>' + escapeText(t("action.save", undefined, "Save")) + '</button>',
    '<button class="button primary" id="build-dry-run">' + escapeText(t("studio.dryRun", undefined, "Dry run")) + '</button>'
  ].join("");
}

export function renderWorkbenchModeBodyHtml(args: {
  buildMode: string;
  workbenchView: string;
  dirty: boolean;
  workbenchSavedPath: string;
  lastDryRunId: string;
  hasDraft: boolean;
  workbenchSource: string;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const { buildMode, workbenchView, dirty, workbenchSavedPath, lastDryRunId, hasDraft, workbenchSource, t, escapeText } = args;
  if (buildMode === "dry-run") {
    return [
      '<div class="structure-list">',
      '<div class="event"><div class="event-top"><span>' + escapeText(t("build.mode.dryRun", undefined, "Dry Run")) + '</span><span>' + escapeText(dirty ? t("workbench.unsavedChanges", undefined, "unsaved changes") : t("workbench.diskInSync", undefined, "disk in sync")) + '</span></div><strong>' + escapeText(t("build.dryRunPrepTitle", undefined, "Validate, generate Mermaid, save, then start a dry run.")) + '</strong><div class="hint">' + escapeText(t("build.dryRunPrepHint", {
        path: workbenchSavedPath || "system.mmd"
      }, "Dry run uses " + (workbenchSavedPath || "system.mmd") + " after the generated source is saved.")) + '</div></div>',
      lastDryRunId
        ? '<div class="event"><div class="event-top"><span>' + escapeText(t("build.lastDryRun", undefined, "Last dry run")) + '</span><span>' + escapeText(t("common.captured", undefined, "captured")) + '</span></div><strong>' + escapeText(lastDryRunId) + '</strong><div class="hint">' + escapeText(t("build.openDebugHint", undefined, "Open Debug mode here or jump to Operate for runtime controls.")) + '</div></div>'
        : '<div class="hint">' + escapeText(t("build.noDryRunYet", undefined, "No dry run has been launched from Build yet.")) + '</div>',
      '</div>'
    ].join("");
  }
  if (buildMode === "debug") {
    return [
      '<div class="structure-list">',
      '<div class="event"><div class="event-top"><span>' + escapeText(t("build.mode.debug", undefined, "Debug")) + '</span><span>' + escapeText(lastDryRunId || t("common.missing", undefined, "missing")) + '</span></div><strong>' + escapeText(lastDryRunId ? t("build.debugDryRunTitle", undefined, "Dry-run result captured in Build.") : t("build.noDryRunYet", undefined, "No dry run has been launched from Build yet.")) + '</strong><div class="hint">' + escapeText(t("build.debugDryRunHint", undefined, "Use Operate for resume, stop, logs, and recovery controls.")) + '</div></div>',
      lastDryRunId ? '<button class="button subtle" id="build-open-operate">' + escapeText(t("build.openOperate", undefined, "Open in Operate")) + '</button>' : "",
      '</div>'
    ].join("");
  }
  if (workbenchView === "source") {
    return [
      '<div class="workbench-source-actions">',
      '<div class="hint">' + escapeText(t("workbench.sourceActionsHint", undefined, "Draft actions only affect the current workbench source until you save.")) + '</div>',
      '<div class="toolbar-group">',
      '<button class="button subtle" id="workbench-new-draft">' + escapeText(t("action.newDraft")) + '</button>',
      hasDraft ? '<button class="button subtle" id="workbench-recover-draft">' + escapeText(t("action.recoverDraft")) + '</button>' : "",
      dirty ? '<button class="button subtle" id="workbench-revert">' + escapeText(t("action.revertToDisk")) + '</button>' : "",
      '</div>',
      '</div>',
      '<textarea id="workbench-editor" class="editor" spellcheck="false" aria-label="' + escapeText(t("workbench.editorAriaLabel", undefined, "Workbench source editor")) + '">' + escapeText(workbenchSource || "") + '</textarea>'
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
