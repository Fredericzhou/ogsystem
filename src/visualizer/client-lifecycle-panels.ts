type Translator = (key: string, vars?: Record<string, unknown>, fallback?: string) => string;
import { roleColorForId } from "./role-color.js";

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
    ["overview", "operate-tabpanel-overview", t("operate.tab.flow", undefined, "Flow"), t("operate.tabHint.flow", undefined, "Step inputs, outputs, and handoffs")],
    ["operations", "operate-tabpanel-recovery operate-tabpanel-reviews console-panel-ops console-panel-logs console-panel-artifacts", t("operate.tab.operations", undefined, "Operations"), t("operate.tabHint.operations", undefined, "Reviews, recovery, logs, and artifacts")]
  ];
  return tabs.map(([id, panelId, label, hint]) =>
    '<button class="button subtle ' + (operateTab === id ? "active" : "") +
    '" id="operate-tab-' + escapeText(id) +
    '" data-operate-tab="' + escapeText(id) +
    '" role="tab" aria-controls="' + escapeText(panelId) +
    '" aria-selected="' + escapeText(String(operateTab === id)) +
    '" aria-pressed="' + escapeText(String(operateTab === id)) +
    '" tabindex="' + escapeText(operateTab === id ? "0" : "-1") +
    '" title="' + escapeText(hint) +
    '">' + escapeText(label) + '</button>'
  ).join("");
}

export function renderFlowTraceHtml(args: {
  projection: Record<string, any> | null | undefined;
  graph: Record<string, any> | null | undefined;
  t: Translator;
  escapeText: (value: unknown) => string;
  statusClass: (value: string) => string;
  displayUiToken: (value: unknown, t: Translator) => string;
  formatTime: (value: unknown) => string;
  selectedRoleId?: string;
}): string {
  const { projection, graph, t, escapeText, statusClass, displayUiToken, formatTime } = args;
  const items = Array.isArray(projection?.items) ? projection.items : [];
  const edges = Array.isArray(graph?.graph?.edges) ? graph.graph.edges : [];
  const executions = items
    .filter((item: Record<string, any>) => item.roleId && item.kind === "role_message" && item.type === "audit")
    .sort((left: Record<string, any>, right: Record<string, any>) => (left.source?.cursor ?? 0) - (right.source?.cursor ?? 0));
  const contentOf = (item: Record<string, any>): string => {
    const text = String(item.content?.text ?? "");
    const match = text.match(/^event=[^|]+\|\s*content=([\s\S]*?)(?:\s*\|\s*data=|$)/);
    return match ? match[1].trim() : text;
  };
  const inputSources = (item: Record<string, any>, index: number): Array<{ roleId: string; event: string; text: string }> => {
    const incoming = edges.filter((edge: Record<string, any>) => edge.target === item.roleId);
    if (incoming.some((edge: Record<string, any>) => edge.source === "input") && index === 0) {
      return [{ roleId: "input", event: "", text: String(projection?.input?.text ?? "") }].filter((source) => source.text);
    }
    return incoming
      .filter((edge: Record<string, any>) => edge.source !== "input")
      .map((edge: Record<string, any>) => {
        const candidates = executions.slice(0, index).filter((candidate: Record<string, any>) =>
          candidate.roleId === edge.source && (!edge.eventType || candidate.event === edge.eventType)
        );
        const source = candidates.at(-1) ?? executions.slice(0, index).filter((candidate: Record<string, any>) => candidate.roleId === edge.source).at(-1);
        return source ? { roleId: source.roleId, event: source.event || edge.eventType || "", text: contentOf(source) } : null;
      })
      .filter((source: { roleId: string; event: string; text: string } | null): source is { roleId: string; event: string; text: string } => Boolean(source?.text));
  };
  if (!executions.length) {
    return '<div class="hint">' + escapeText(projection
      ? t("flow.noSteps", undefined, "No role execution details are available for this run.")
      : t("flow.unavailable", undefined, "Flow details are unavailable.")) + '</div>';
  }
  const steps = executions.map((item: Record<string, any>, index: number) => {
    const sources = inputSources(item, index);
    const targets = edges.filter((edge: Record<string, any>) => edge.source === item.roleId && (!item.event || edge.eventType === item.event));
    const inputHtml = sources.length
      ? sources.map((source) => '<div class="flow-message"><div class="flow-message-meta"><code>' + escapeText(source.roleId) + '</code>' + (source.event ? ' · <code>' + escapeText(source.event) + '</code>' : '') + '</div><p>' + escapeText(source.text) + '</p></div>').join("")
      : '<div class="hint">' + escapeText(t("flow.inputUnavailable", undefined, "Upstream input was not captured.")) + '</div>';
    const output = contentOf(item);
    const route = targets.map((edge: Record<string, any>) => '<code>' + escapeText(edge.eventType || item.event || "") + '</code> → <code>' + escapeText(edge.target) + '</code>').join(" · ");
    const branch = item.branchId ? '<code>' + escapeText(item.branchId) + '</code>' : "";
    const duration = Number.isFinite(item.durationMs) ? Math.round(item.durationMs) + " ms" : "";
    const loopIteration = Number(item.loopIteration);
    const inLoop = Number.isFinite(loopIteration) && loopIteration > 0;
    const roleColor = roleColorForId(String(item.roleId));
    const selected = args.selectedRoleId === item.roleId;
    return '<article class="flow-step' + (selected ? ' is-role-focus' : '') + (inLoop ? ' is-loop-step' : '') + '" data-flow-role="' + escapeText(item.roleId) + '"' + (inLoop ? ' data-loop-iteration="' + escapeText(loopIteration) + '"' : '') + ' style="--role-accent:' + roleColor.accent + ';--role-fill:' + roleColor.fill + '">' +
      '<header class="flow-step-head"><div><span class="flow-step-index">' + String(index + 1).padStart(2, "0") + '</span><button type="button" class="flow-role-select" data-flow-role-focus="' + escapeText(item.roleId) + '"><code>' + escapeText(item.roleId) + '</code></button></div><div class="flow-step-meta">' + (inLoop ? '<span class="flow-step-loop">' + escapeText(t("flow.loopRound", { count: String(loopIteration) }, "loop {count}")) + '</span>' : '') + '<span class="status ' + escapeText(statusClass(String(item.status || "unknown"))) + '">' + escapeText(displayUiToken(item.status || "unknown", t)) + '</span><span>' + escapeText(duration) + '</span></div></header>' +
      '<div class="flow-step-io"><section><h4>' + escapeText(t("flow.input", undefined, "Input")) + '</h4>' + inputHtml + '</section><section><h4>' + escapeText(t("flow.output", undefined, "Output")) + '</h4><div class="flow-message"><p>' + escapeText(output || t("flow.outputUnavailable", undefined, "Output was not captured.")) + '</p></div></section></div>' +
      '<details class="flow-step-detail" data-flow-role-io="' + escapeText(item.roleId) + '"' + (item.branchId ? ' data-flow-branch-id="' + escapeText(item.branchId) + '"' : '') + (inLoop ? ' data-flow-loop-iteration="' + escapeText(loopIteration) + '"' : '') + '><summary>' + escapeText(t("flow.fullIo", undefined, "Full captured input and output")) + '</summary><div class="flow-step-detail-body"><div class="hint">' + escapeText(t("flow.fullIoHint", undefined, "Load the complete captured Role I/O and structured result.")) + '</div></div></details>' +
      '<footer class="flow-step-route"><span>' + escapeText(t("flow.handoff", undefined, "Handoff")) + '</span><span>' + (route || '<code>' + escapeText(item.event || "") + '</code> → <code>' + escapeText(t("flow.terminal", undefined, "terminal")) + '</code>') + '</span><span>' + escapeText(branch) + '</span><time>' + escapeText(formatTime(item.at)) + '</time></footer>' +
      '</article>';
  }).join("");
  return '<div class="flow-trace">' + steps + '</div>';
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

export function renderConversationHtml(args: {
  projection: Record<string, any> | null | undefined;
  t: Translator;
  escapeText: (value: unknown) => string;
  statusClass: (value: string) => string;
  displayUiToken: (value: unknown, t: Translator) => string;
  formatTime: (value: unknown) => string;
}): string {
  const { projection, t, escapeText, statusClass, displayUiToken, formatTime } = args;
  const items = Array.isArray(projection?.items) ? projection.items : [];
  if (!items.length) {
    return '<div class="hint">' + escapeText(t("timeline.conversationEmpty", undefined, "No conversation items captured yet.")) + '</div>';
  }
  return items.slice().reverse().map((item: Record<string, any>) => {
    const source = item.source || {};
    const sourceLocator = source.file === "state.json"
      ? "state.json@" + String(source.snapshotVersion ?? "?")
      : String(source.file || "event") + "#" + String(source.cursor ?? "?");
    const route = item.route || {};
    const routeLabel = route.channel ? String(route.channel) + " -> " + String(route.presentationChannel || "") : "";
    const identity = [item.branchId, item.lineageId, item.loopIteration === undefined ? "" : "loop " + item.loopIteration]
      .filter(Boolean).join(" · ");
    const review = item.review ? "review " + String(item.review.reviewId) + " / " + String(item.review.reviewStatus) + (item.review.decision ? " / " + String(item.review.decision) : "") : "";
    const join = item.join ? "expected " + (item.join.expected || []).join(", ") + " · ready " + (item.join.ready || []).join(", ") + " · missing " + (item.join.missing || []).join(", ") : "";
    const meta = [identity, routeLabel, review, join, sourceLocator].filter(Boolean).join(" · ");
    const content = item.content?.text ? '<div class="hint conversation-content">' + escapeText(item.content.text) + (item.content.truncated ? "..." : "") + '</div>' : "";
    return '<div class="event conversation-item" data-conversation-item-id="' + escapeText(item.itemId) + '">' +
      '<div class="event-top"><span>' + escapeText(item.kind || "conversation") + '</span><span>' + escapeText(formatTime(item.at)) + '</span></div>' +
      '<strong>' + (item.roleId ? '<code>' + escapeText(item.roleId) + '</code> ' : "") +
      (item.event ? '<code>' + escapeText(item.event) + '</code> ' : "") +
      '<span class="status ' + escapeText(statusClass(String(item.status || "unknown"))) + '">' + escapeText(displayUiToken(item.status || "unknown", t)) + '</span></strong>' +
      (meta ? '<div class="hint">' + escapeText(meta) + '</div>' : "") + content + '</div>';
  }).join("");
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
    filters.errorCode ? "error=" + filters.errorCode : "",
    filters.channel ? "channel=" + filters.channel : ""
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
