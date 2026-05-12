import { escapeHtml as escapeText } from "./html-escape.js";
import { studioRolePackageHasRequiredFileCoverage, type StudioRolePackageSummary } from "./studio-client/studio-graph-validation.js";

type JsonRecord = Record<string, unknown>;
type Translator = (key: string, vars?: Record<string, unknown>, fallback?: string) => string;
type DateFormatter = (value: unknown) => string;

export function formatJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

export function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

export function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as JsonRecord[]
    : [];
}

export function asRecordCollection(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return asRecordArray(value);
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  const objectValues = Object.values(record)
    .filter((item) => item && typeof item === "object" && !Array.isArray(item)) as JsonRecord[];
  return objectValues.length > 0 ? objectValues : [record];
}

export function compactText(value: unknown, maxLength = 180): string {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength
    ? normalized.slice(0, Math.max(0, maxLength - 1)) + "..."
    : normalized;
}

export function compactJsonPreview(value: unknown, maxLength = 180): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const raw = typeof value === "string" ? value : formatJson(value);
  return compactText(raw, maxLength);
}

export function renderDisclosureCard(args: {
  title: string;
  headline: string;
  meta?: string;
  hint?: string;
  bodyHtml?: string;
  open?: boolean;
  tone?: "notice" | "warning" | "critical";
}): string {
  const toneClass = args.tone ? ` ${args.tone}` : "";
  return [
    `<details class="event disclosure${toneClass}"${args.open ? " open" : ""}>`,
    '<summary class="disclosure-summary">',
    '<span class="disclosure-summary-copy">',
    `<span class="disclosure-kicker">${escapeText(args.title)}</span>`,
    `<strong>${escapeText(args.headline)}</strong>`,
    "</span>",
    `<span class="disclosure-meta">${escapeText(args.meta ?? "")}</span>`,
    "</summary>",
    args.hint ? `<div class="hint disclosure-hint">${escapeText(args.hint)}</div>` : "",
    args.bodyHtml ? `<div class="disclosure-body">${args.bodyHtml}</div>` : "",
    "</details>"
  ].join("");
}

export function renderPreDisclosure(args: {
  title: string;
  headline?: string;
  meta?: string;
  hint?: string;
  value: unknown;
  emptyTitle: string;
  emptyMeta?: string;
  emptyHint?: string;
  open?: boolean;
  tone?: "notice" | "warning" | "critical";
}): string {
  if (args.value === null || args.value === undefined || args.value === "") {
    return [
      '<div class="event">',
      `<div class="event-top"><span>${escapeText(args.title)}</span><span>${escapeText(args.emptyMeta ?? "")}</span></div>`,
      `<strong>${escapeText(args.emptyTitle)}</strong>`,
      args.emptyHint ? `<div class="hint">${escapeText(args.emptyHint)}</div>` : "",
      "</div>"
    ].join("");
  }
  const raw = typeof args.value === "string" ? args.value : formatJson(args.value);
  return renderDisclosureCard({
    title: args.title,
    headline: args.headline || compactText(raw, 220) || args.emptyTitle,
    meta: args.meta,
    hint: args.hint,
    bodyHtml: `<pre>${escapeText(raw)}</pre>`,
    open: args.open,
    tone: args.tone
  });
}

export function renderSummaryListSection(args: {
  title: string;
  items: string[];
  emptyLabel: string;
  summaryLabel?: string;
  hint?: string;
  open?: boolean;
  tone?: "notice" | "warning" | "critical";
}): string {
  const count = args.items.length;
  const toneClass = args.tone ? ` ${args.tone}` : "";
  return [
    `<details class="event disclosure summary-section${toneClass}"${args.open ? " open" : ""}>`,
    '<summary class="disclosure-summary">',
    '<span class="disclosure-summary-copy">',
    `<span class="disclosure-kicker">${escapeText(args.title)}</span>`,
    `<strong>${escapeText(args.summaryLabel ?? (count ? `${count}` : args.emptyLabel))}</strong>`,
    "</span>",
    `<span class="disclosure-meta">${escapeText(String(count))}</span>`,
    "</summary>",
    args.hint ? `<div class="hint disclosure-hint">${escapeText(args.hint)}</div>` : "",
    count
      ? `<div class="compact-list">${args.items.join("")}</div>`
      : `<div class="hint">${escapeText(args.emptyLabel)}</div>`,
    "</details>"
  ].join("");
}

export function displayUiToken(value: unknown, t: Translator): string {
  const text = String(value ?? "");
  if (!text || text === "n/a" || text === "undefined" || text === "null") {
    return t("common.notAvailable", undefined, "n/a");
  }
  const normalized = text.toLowerCase();
  if (normalized === "unknown") return t("common.unknown", undefined, "unknown");
  if (normalized === "none") return t("common.none", undefined, "none");
  if (normalized === "ok") return t("common.ok", undefined, "ok");
  if (normalized === "missing") return t("common.missing", undefined, "missing");
  if (normalized === "complete" || normalized === "completed") return t("common.complete", undefined, "complete");
  if (normalized === "fresh") return t("common.fresh", undefined, "fresh");
  if (normalized === "stale") return t("common.stale", undefined, "stale");
  if (normalized === "empty") return t("common.empty", undefined, "empty");
  if (normalized === "covered") return t("config.covered", undefined, "covered");
  if (normalized === "pending") return t("status.pending", undefined, "pending");
  if (normalized === "paused") return t("status.paused", undefined, "paused");
  if (normalized === "running") return t("status.running", undefined, "running");
  if (normalized === "stopped") return t("status.stopped", undefined, "stopped");
  if (normalized === "done") return t("status.done", undefined, "done");
  if (normalized === "failed") return t("status.failed", undefined, "failed");
  if (normalized === "waiting_review") return t("status.waitingReview", undefined, "waiting review");
  if (normalized === "applied") return t("status.applied", undefined, "applied");
  if (normalized === "warning" || normalized === "warn") return t("readiness.warning", undefined, "warning");
  if (normalized === "error") return t("state.field.error", undefined, "error");
  if (normalized === "runtime") return t("state.runtime", undefined, "runtime");
  if (normalized === "idle") return t("state.idle", undefined, "idle");
  if (normalized === "model") return t("token.model", undefined, "model");
  if (normalized === "profile") return t("token.profile", undefined, "profile");
  if (normalized === "role") return t("token.role", undefined, "role");
  if (normalized === "execution") return t("token.execution", undefined, "execution");
  if (normalized === "execute") return t("token.execute", undefined, "execution");
  if (normalized === "role_input") return t("token.roleInput", undefined, "role input");
  if (normalized === "flow") return t("token.flow", undefined, "flow");
  if (normalized === "audit") return t("token.audit", undefined, "audit");
  if (normalized === "parse") return t("token.parse", undefined, "parse");
  if (normalized === "event") return t("token.event", undefined, "event");
  return text;
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

export function normalizeStudioTargetRoleId(roleId: unknown): string {
  const value = String(roleId ?? "");
  return value === "__system_end__" ? "output" : value;
}

export function renderStudioGraphCanvas(args: {
  selectedRoleId: string;
  selectedFlowKey: string;
  fullscreen?: boolean;
  sideTab?: string;
  rootMode?: "bridge" | "source";
  rootClassName?: string;
  rootContentHtml?: string;
  selectionKindLabel?: string;
  selectionTitle?: string;
  selectionRolePackageHtml?: string;
  selectionStructureHtml?: string;
  selectionDebugHtml?: string;
  selectionResultsHtml?: string;
  selectionDocked?: boolean;
  selectionCollapsed?: boolean;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const selection = renderStudioBridgeSelectionLabel({
    selectedRoleId: args.selectedRoleId,
    selectedFlowKey: args.selectedFlowKey,
    t
  });
  return [
    '<div class="studio-canvas-shell' + (args.fullscreen ? " is-fullscreen" : "") + (args.selectionDocked ? " has-docked-selection" : "") + (args.selectionDocked && args.selectionCollapsed ? " has-collapsed-selection" : "") + '" data-studio-canvas-shell="1">',
    '<div class="studio-canvas-toolbar" data-studio-bridge-region="toolbar"><div><span class="hint" data-studio-graph-selection-label>' + escapeText(selection) + '</span></div></div>',
    '<aside class="studio-outline-pane"><section class="studio-selection-panel studio-selection-structure-panel studio-outline-panel" data-studio-selection-panel="structure">' + (args.selectionStructureHtml || "") + '</section></aside>',
    '<div id="studio-graph-root" class="studio-graph-root' + (args.rootClassName ? " " + escapeText(args.rootClassName) : "") + '" data-workbench-root-mode="' + escapeText(args.rootMode || "bridge") + '" data-selected-role-id="' + escapeText(args.selectedRoleId) + '" data-selected-flow-key="' + escapeText(args.selectedFlowKey) + '">' + (args.rootContentHtml || "") + '</div>',
    '<div class="studio-selection-overlay' + (args.selectionDocked ? " is-docked" : "") + (args.selectionCollapsed ? " is-collapsed" : "") + '" data-studio-selection-overlay><button type="button" class="studio-selection-backdrop" data-studio-selection-close="" aria-label="' + escapeText(t("action.close", undefined, "Close")) + '"></button><section class="studio-selection-dialog" data-studio-selection-dialog role="dialog" aria-modal="false" aria-label="' + escapeText(t("studio.sidePanel", undefined, "Right panel")) + '"><header class="studio-selection-header"><div class="studio-selection-title-wrap"><div class="hint" data-studio-selection-kind-label>' + escapeText(args.selectionKindLabel || "") + '</div><strong data-studio-selection-title>' + escapeText(args.selectionTitle || "") + '</strong></div><div class="studio-selection-actions"><button type="button" class="button subtle" data-studio-selection-pin="" title="' + escapeText(t("studio.graphWorkspace", undefined, "Graph workspace")) + '">dock</button><button type="button" class="button subtle" data-studio-selection-collapse="" title="' + escapeText(t("action.close", undefined, "Close")) + '">' + (args.selectionCollapsed ? ">" : "<") + '</button><button type="button" class="button subtle" data-studio-selection-close="">' + escapeText(t("action.close", undefined, "Close")) + '</button></div></header><div class="studio-selection-tabstrip segmented"><button type="button" class="button subtle' + ((args.sideTab || "selection") === "selection" ? " active" : "") + '" data-studio-side-tab="selection">' + escapeText(t("studio.authoringTab", undefined, "Authoring")) + '</button><button type="button" class="button subtle' + ((args.sideTab || "selection") === "debug" ? " active" : "") + '" data-studio-side-tab="debug">' + escapeText(t("build.mode.debug", undefined, "Debug")) + '</button><button type="button" class="button subtle' + ((args.sideTab || "selection") === "result" ? " active" : "") + '" data-studio-side-tab="result">' + escapeText(t("studio.resultsTab", undefined, "Results")) + '</button></div><div class="studio-selection-body"><section class="studio-selection-panel" data-studio-selection-panel="selection"><div class="studio-selection-command-host" data-studio-selection-command-host></div><div class="studio-selection-role-package" data-studio-selection-role-package>' + (args.selectionRolePackageHtml || "") + '</div></section><section class="studio-selection-panel studio-selection-debug-panel" data-studio-selection-panel="debug">' + (args.selectionDebugHtml || "") + '</section><section class="studio-selection-panel studio-selection-result-panel" data-studio-selection-panel="result">' + (args.selectionResultsHtml || "") + '</section></div></section></div>',
    "</div>"
  ].join("");
}

export function roleIdOf(role: JsonRecord): string {
  return String(role.roleId ?? "");
}

export function flowKeyOf(flow: JsonRecord): string {
  return String(flow.flowKey ?? (String(flow.fromRoleId ?? "") + ":" + String(flow.eventType ?? "") + ":" + normalizeStudioTargetRoleId(flow.toRoleId)));
}

export function flowDisplayLabel(flow: JsonRecord): string {
  const label = String(flow.label ?? "").trim();
  return label || String(flow.eventType ?? "");
}

export function sortStudioBridgeRolesTopologically(roles: JsonRecord[], flows: JsonRecord[]): JsonRecord[] {
  const roleById = new Map<string, JsonRecord>();
  const indexById = new Map<string, number>();
  roles.forEach((role, index) => {
    const roleId = roleIdOf(role);
    if (!roleId) return;
    roleById.set(roleId, role);
    indexById.set(roleId, index);
  });
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const roleId of roleById.keys()) {
    indegree.set(roleId, 0);
    outgoing.set(roleId, []);
  }
  for (const flow of flows) {
    const source = String(flow.fromRoleId ?? "");
    const target = normalizeStudioTargetRoleId(flow.toRoleId);
    if (!roleById.has(source) || !roleById.has(target) || source === target) continue;
    outgoing.get(source)?.push(target);
    indegree.set(target, (indegree.get(target) ?? 0) + 1);
  }
  const queue = Array.from(roleById.keys())
    .filter((roleId) => (indegree.get(roleId) ?? 0) === 0)
    .sort((left, right) => (indexById.get(left) ?? 0) - (indexById.get(right) ?? 0) || left.localeCompare(right));
  const ordered: JsonRecord[] = [];
  const visited = new Set<string>();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const roleId = queue[cursor] || "";
    if (!roleId || visited.has(roleId)) continue;
    visited.add(roleId);
    const role = roleById.get(roleId);
    if (role) ordered.push(role);
    const targets = (outgoing.get(roleId) ?? []).slice()
      .sort((left, right) => (indexById.get(left) ?? 0) - (indexById.get(right) ?? 0) || left.localeCompare(right));
    for (const target of targets) {
      indegree.set(target, (indegree.get(target) ?? 0) - 1);
      if ((indegree.get(target) ?? 0) === 0) {
        queue.push(target);
      }
    }
  }
  for (const role of roles) {
    const roleId = roleIdOf(role);
    if (roleId && !visited.has(roleId)) {
      ordered.push(role);
      visited.add(roleId);
    }
  }
  return ordered;
}

export function filterStudioBridgeItems(args: {
  roles: JsonRecord[];
  flows: JsonRecord[];
  filter: string;
  mode: string;
}): { roles: JsonRecord[]; flows: JsonRecord[] } {
  const filter = args.filter.trim().toLowerCase();
  const match = (value: unknown) => !filter || String(value ?? "").toLowerCase().includes(filter);
  const roleMatches = (role: JsonRecord) =>
    match(role.roleId) || match(role.title) || match(role.bindingKind) || match((Array.isArray(role.badges) ? role.badges.join(" ") : ""));
  const flowMatches = (flow: JsonRecord) =>
    match(flow.flowKey) || match(flow.fromRoleId) || match(flow.toRoleId) || match(flow.eventType) || match(flow.label);
  return {
    roles: args.mode === "flows" ? [] : args.roles.filter(roleMatches),
    flows: args.mode === "roles" ? [] : args.flows.filter(flowMatches)
  };
}

export function sortStudioBridgeFlowsByTopology(flows: JsonRecord[], orderedRoles: JsonRecord[]): JsonRecord[] {
  const rank = new Map<string, number>();
  orderedRoles.forEach((role, index) => rank.set(roleIdOf(role), index));
  return flows.slice().sort((left, right) => {
    const leftSourceRank = rank.get(String(left.fromRoleId ?? "")) ?? Number.MAX_SAFE_INTEGER;
    const rightSourceRank = rank.get(String(right.fromRoleId ?? "")) ?? Number.MAX_SAFE_INTEGER;
    const leftTargetRank = rank.get(normalizeStudioTargetRoleId(left.toRoleId)) ?? Number.MAX_SAFE_INTEGER;
    const rightTargetRank = rank.get(normalizeStudioTargetRoleId(right.toRoleId)) ?? Number.MAX_SAFE_INTEGER;
    return leftSourceRank - rightSourceRank ||
      leftTargetRank - rightTargetRank ||
      String(left.eventType ?? "").localeCompare(String(right.eventType ?? "")) ||
      flowKeyOf(left).localeCompare(flowKeyOf(right));
  });
}

export function renderStudioBridgeSelectionLabel(args: {
  selectedRoleId: string;
  selectedFlowKey: string;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const selection = args.selectedRoleId
    ? t("studio.roleInspector", undefined, "Role details") + " " + args.selectedRoleId
    : args.selectedFlowKey
      ? t("studio.flowInspector", undefined, "Flow details") + " " + args.selectedFlowKey
      : t("studio.selectRole", undefined, "Select a role to inspect metadata.");
  return selection;
}

export function renderProjectSummaryPanel(args: {
  summary: JsonRecord | null | undefined;
  roles: Array<Record<string, unknown>>;
  warnings: string[];
  workbenchSavedPath: string;
  validationOk: boolean;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
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
      "<strong>" + escapeText(flags.join(" · ") || t("project.standardRole", undefined, "standard role")) + "</strong>" +
      '<div class="hint">' + escapeText((role.summary as JsonRecord | undefined)?.label ?? t("project.rolePackageAvailable", undefined, "role package available")) + "</div>" +
      "</div>"
    );
  });
  const warningCards = args.warnings.length > 0
    ? args.warnings.map((warning) =>
        '<div class="event"><div class="event-top"><span>' + escapeText(t("project.modelWarning", undefined, "model warning")) + '</span><span>' + escapeText(t("common.attention", undefined, "attention")) + '</span></div><strong>' +
        escapeText(warning) +
        "</strong></div>"
      )
    : ['<div class="event"><div class="event-top"><span>' + escapeText(t("project.modelWarning", undefined, "model warning")) + '</span><span>' + escapeText(t("common.ok", undefined, "ok")) + '</span></div><strong>' + escapeText(t("common.none", undefined, "none")) + '</strong></div>'];

  return [
    '<div class="structure-list project-overview-grid">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("project.project", undefined, "project")) + '</span><span>' + escapeText(summary.projectId ?? "n/a") + "</span></div><strong>" +
      escapeText(summary.projectName ?? t("common.unknown", undefined, "unknown")) + '</strong><div class="hint">' +
      escapeText(t("project.systemVersionEntry", {
        systemId: String(summary.systemId ?? "n/a"),
        version: String(summary.systemVersion ?? "n/a"),
        entryRoleId: String(summary.entryRoleId ?? "n/a")
      }, "system " + String(summary.systemId ?? "n/a") + " · version " + String(summary.systemVersion ?? "n/a") + " · entry " + String(summary.entryRoleId ?? "n/a"))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("project.structure", undefined, "structure")) + '</span><span>' + escapeText(summary.roleCount ?? 0) + " " + escapeText(t("common.roles", undefined, "roles")) + '</span></div><strong>' +
      escapeText(t("project.roleFlowWorkbench", {
        flowCount: String(summary.flowCount ?? 0),
        workbenchStatus: args.validationOk ? t("project.validated", undefined, "validated") : t("project.needsAttention", undefined, "needs attention")
      }, "flows " + String(summary.flowCount ?? 0) + " · workbench " + (args.validationOk ? "validated" : "needs attention"))) +
      '</strong><div class="hint">' + escapeText(t("project.systemPath", { path: args.workbenchSavedPath || "system.mmd" }, "system path " + (args.workbenchSavedPath || "system.mmd"))) + "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("project.specialRoles", undefined, "special roles")) + '</span><span>' + escapeText(t("project.graphMetadata", undefined, "graph metadata")) + '</span></div><strong>' +
      escapeText(t("common.review", undefined, "review") + " " + ((summary.reviewedRoleIds as unknown[] | undefined)?.join(", ") || t("common.none", undefined, "none"))) +
      '</strong><div class="hint">' + escapeText(t("common.join", undefined, "join") + " " + ((summary.joinRoleIds as unknown[] | undefined)?.join(", ") || t("common.none", undefined, "none"))) +
      " · " + escapeText(t("common.loop", undefined, "loop") + " " + ((summary.loopRoleIds as unknown[] | undefined)?.join(", ") || t("common.none", undefined, "none"))) +
      " · " + escapeText(t("common.context", undefined, "context") + " " + ((summary.contextMappedRoleIds as unknown[] | undefined)?.join(", ") || t("common.none", undefined, "none"))) + "</div></div>",
    ...warningCards,
    ...roleCards,
    "</div>"
  ].join("");
}

export function renderOpsSummaryPanel(args: {
  opsSummary: JsonRecord | null | undefined;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const summary = (args.opsSummary?.summary ?? {}) as JsonRecord;
  const failureGroups = (args.opsSummary?.failureGroups ?? {}) as JsonRecord;
  const reviewRework = (args.opsSummary?.reviewRework ?? {}) as JsonRecord;
  const resumeReadiness = (args.opsSummary?.resumeReadiness ?? {}) as JsonRecord;
  const recentFailures = Array.isArray(args.opsSummary?.recentFailures)
    ? args.opsSummary.recentFailures as JsonRecord[]
    : [];
  const topErrorCodes = Array.isArray(failureGroups.byErrorCode)
    ? failureGroups.byErrorCode as JsonRecord[]
    : [];
  const driftSources = Array.isArray(resumeReadiness.driftSources)
    ? resumeReadiness.driftSources as JsonRecord[]
    : [];
  const blockingByCategory = Array.isArray(resumeReadiness.blockingByCategory)
    ? resumeReadiness.blockingByCategory as JsonRecord[]
    : [];
  const cards = [
    '<div class="event"><div class="event-top"><span>' + escapeText(t("ops.recentFailures", undefined, "recent failures")) + '</span><span>' +
      escapeText(String(summary.recentFailureCount ?? 0)) +
      '</span></div><strong>' +
      escapeText(
        topErrorCodes.length
          ? topErrorCodes.slice(0, 3).map((item) => String(item.key) + " x" + String(item.count)).join(" · ")
          : t("ops.noRecentFailures", undefined, "no recent failures")
      ) +
      '</strong><div class="hint">' + escapeText(t("ops.failureGroupingHint", undefined, "grouped by role, errorCode, and errorCategory for operator triage")) + '</div></div>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("ops.reviewReworkPending", undefined, "review / rework pending")) + '</span><span>' +
      escapeText(String(summary.pendingReviewCount ?? 0)) +
      " " + escapeText(t("common.reviews", undefined, "reviews")) + '</span></div><strong>' +
      escapeText(t("ops.activeReworkBranches", { count: String(reviewRework.pendingReworkCount ?? 0) }, String(reviewRework.pendingReworkCount ?? 0) + " active rework branches")) +
      '</strong><div class="hint">' +
      escapeText(t("ops.pausedReviews", { count: String(reviewRework.pausedReviewCount ?? 0) }, "paused reviews " + String(reviewRework.pausedReviewCount ?? 0))) +
      '</div></div>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("ops.resumeBlocking", undefined, "resume blocking")) + '</span><span>' +
      escapeText(String(resumeReadiness.blockedRunCount ?? summary.resumeBlockedRunCount ?? 0)) +
      " " + escapeText(t("common.runs", undefined, "runs")) + '</span></div><strong>' +
      escapeText(
        blockingByCategory.length
          ? blockingByCategory.slice(0, 3).map((item) => String(item.key) + " x" + String(item.count)).join(" · ")
          : t("ops.noBlockingCategories", undefined, "no blocking categories")
      ) +
      '</strong><div class="hint">' +
      escapeText(t("ops.driftSources", {
        sources:
        driftSources.length
          ? driftSources.slice(0, 3).map((item) => String(item.key) + " x" + String(item.count)).join(" · ")
          : t("common.none", undefined, "none")
      }, "drift sources " + (driftSources.length ? driftSources.slice(0, 3).map((item) => String(item.key) + " x" + String(item.count)).join(" · ") : "none"))) +
      "</div></div>"
  ];
  const failureCards = recentFailures.length
    ? recentFailures.slice(0, 5).map((failure) =>
        '<div class="event"><div class="event-top"><span><code>' +
        escapeText(String(failure.roleId ?? t("common.unknown", undefined, "unknown"))) +
        '</code></span><span>' +
        escapeText(displayUiToken(failure.errorCategory ?? t("state.runtime", undefined, "runtime"), t)) +
        '</span></div><strong>' +
        escapeText(String(failure.errorCode ?? "ROLE_EXECUTION_FAILED")) +
        '</strong><div class="hint">' +
        escapeText(String(failure.runId ?? t("common.unknown", undefined, "unknown")) + " · " + String(failure.message ?? t("ops.noFailureMessage", undefined, "No message"))) +
        "</div></div>"
      )
    : ['<div class="event"><div class="event-top"><span>' + escapeText(t("ops.recentFailureList", undefined, "recent failure list")) + '</span><span>0</span></div><strong>' + escapeText(t("ops.noFailureEntries", undefined, "No failure entries in the sampled runs")) + '</strong></div>'];
  return ['<div class="structure-list">', ...cards, ...failureCards, "</div>"].join("");
}

export function renderProjectReadinessPanel(args: {
  readiness: JsonRecord | null | undefined;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const readiness = args.readiness ?? {};
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers as JsonRecord[] : [];
  const warnings = Array.isArray(readiness.warnings) ? readiness.warnings as JsonRecord[] : [];
  const missingBindings = Array.isArray(readiness.missingBindings) ? readiness.missingBindings as JsonRecord[] : [];
  const contractCoverage = (readiness.contractCoverage ?? {}) as JsonRecord;
  const roleRepoHealth = (readiness.roleRepoHealth ?? {}) as JsonRecord;
  const roles = Array.isArray(roleRepoHealth.roles) ? roleRepoHealth.roles as JsonRecord[] : [];
  const unhealthyRoles = roles.filter((role) => role.status !== "ok");
  const status = readiness.canDryRun ? (warnings.length ? "warning" : "ready") : "blocked";
  const issueCards = [...blockers, ...warnings].slice(0, 6).map((issue) =>
    '<div class="event"><div class="event-top"><span>' +
    escapeText(String(issue.code ?? "READINESS_ISSUE")) +
    '</span><span>' +
    escapeText(displayUiToken(issue.severity ?? "warning", t)) +
    '</span></div><strong>' +
    escapeText(String(issue.message ?? "No readiness message.")) +
    '</strong><div class="hint">' +
    escapeText(String(issue.roleId ?? issue.flowKey ?? issue.path ?? "")) +
    "</div></div>"
  );
  if (!readiness || Object.keys(readiness).length === 0) {
    return '<div class="hint">' + escapeText(t("readiness.dataUnavailable", undefined, "Project readiness data unavailable.")) + '</div>';
  }
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("readiness.dryRunReadiness", undefined, "dry-run readiness")) + '</span><span>' +
      escapeText(t("readiness." + status, undefined, status)) +
      '</span></div><strong>' +
      escapeText(readiness.canDryRun ? t("readiness.canDryRun", undefined, "Project can dry-run with current structural checks.") : t("readiness.hasBlockers", undefined, "Project has dry-run blockers.")) +
      '</strong><div class="hint">' +
      escapeText(t("readiness.blockersWarningsSystem", {
        blockers: blockers.length,
        warnings: warnings.length,
        systemId: String(readiness.systemId ?? "n/a")
      }, "blockers " + blockers.length + " · warnings " + warnings.length + " · system " + String(readiness.systemId ?? "n/a"))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("readiness.missingBindings", undefined, "missing bindings")) + '</span><span>' +
      escapeText(String(missingBindings.length)) +
      '</span></div><strong>' +
      escapeText(missingBindings.length ? missingBindings.map((item) => String(item.roleId)).join(", ") : t("readiness.none", undefined, "none")) +
      '</strong><div class="hint">' + escapeText(t("readiness.bindingChecks", undefined, "checks exec.bind, model.bind, and model-selection resolution")) + '</div></div>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("readiness.contractCoverage", undefined, "contract coverage")) + '</span><span>' +
      escapeText(t("readiness.missing", { count: String(contractCoverage.missingFlowCount ?? 0) }, String(contractCoverage.missingFlowCount ?? 0) + " missing")) +
      '</span></div><strong>' +
      escapeText(t("readiness.flowsCovered", {
        covered: String(contractCoverage.coveredFlowCount ?? 0),
        eligible: String(contractCoverage.eligibleFlowCount ?? 0)
      }, String(contractCoverage.coveredFlowCount ?? 0) + " / " + String(contractCoverage.eligibleFlowCount ?? 0) + " eligible flows covered")) +
      '</strong><div class="hint">' +
      escapeText(t("readiness.handoffMode", { mode: String(contractCoverage.handoffMode ?? "n/a") }, "handoff mode " + String(contractCoverage.handoffMode ?? "n/a"))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("readiness.roleRepoHealth", undefined, "role repo health")) + '</span><span>' +
      escapeText(t("readiness.unhealthy", { count: unhealthyRoles.length }, String(unhealthyRoles.length) + " unhealthy")) +
      '</span></div><strong>' +
      escapeText(unhealthyRoles.length ? unhealthyRoles.map((role) => String(role.roleId)).join(", ") : t("readiness.allFilesPresent", undefined, "all required files present")) +
      '</strong><div class="hint">' +
      escapeText(t("readiness.rolesInspected", { count: roles.length }, String(roles.length) + " role package(s) inspected")) +
      "</div></div>",
    ...issueCards,
    "</div>"
  ].join("");
}

export function renderReleaseGatePanel(args: {
  validation: JsonRecord | null | undefined;
  readiness: JsonRecord | null | undefined;
  contracts: JsonRecord | null | undefined;
  rolePackages: JsonRecord | null | undefined;
  bindings: JsonRecord | null | undefined;
  workbenchSavedPath: string;
  workbenchDirty: boolean;
  lastDryRunId?: string;
  exportReady: boolean;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const validationOk = args.validation?.ok === true;
  const diagnostics = Array.isArray(args.validation?.diagnostics) ? args.validation.diagnostics as JsonRecord[] : [];
  const blockers = Array.isArray(args.readiness?.blockers) ? args.readiness.blockers as JsonRecord[] : [];
  const warnings = Array.isArray(args.readiness?.warnings) ? args.readiness.warnings as JsonRecord[] : [];
  const contractCoverage = (args.readiness?.contractCoverage ?? {}) as JsonRecord;
  const missingContracts = Number(contractCoverage.missingCount ?? contractCoverage.missingFlowCount ?? 0);
  const bindingRoles = Array.isArray(args.bindings?.roles) ? args.bindings.roles as JsonRecord[] : [];
  const unresolvedBindings = bindingRoles.filter((binding) =>
    binding.resolved === false || (!binding.resolvedBinding && !binding.effectiveBinding)
  );
  const packageRoles = Array.isArray(args.rolePackages?.roles) ? args.rolePackages.roles as JsonRecord[] : [];
  const unhealthyRoles = packageRoles.filter((role) => {
    return !studioRolePackageHasRequiredFileCoverage(role as StudioRolePackageSummary);
  });
  const uncoveredEdges = Array.isArray(args.contracts?.uncoveredEdges) ? args.contracts?.uncoveredEdges as JsonRecord[] : [];
  const canExport = args.exportReady && !args.workbenchDirty;
  const warningNote = warnings.length
    ? t("release.warningNote", { count: String(warnings.length) }, String(warnings.length) + " warning(s) will be included in release notes")
    : t("release.noWarningNote", undefined, "No non-blocking warnings for release notes.");
  const toCompactItem = (title: string, meta: string, hint?: string): string =>
    '<div class="compact-list-item"><span class="compact-list-title">' + escapeText(title) + '</span><span class="compact-list-meta">' + escapeText(meta) + '</span>' + (hint ? '<div class="hint">' + escapeText(hint) + '</div>' : "") + '</div>';
  const diagnosticItems = diagnostics.slice(0, 8).map((diagnostic) =>
    toCompactItem(
      String(diagnostic.code ?? "DIAGNOSTIC"),
      String(diagnostic.stage ?? t("common.attention", undefined, "attention")),
      compactText(diagnostic.message ?? "", 140)
    )
  );
  const blockerItems = blockers.slice(0, 8).map((blocker) =>
    toCompactItem(
      compactText(blocker.message ?? blocker.code ?? t("common.unknown", undefined, "unknown"), 120),
      String(blocker.severity ?? t("common.blocked", undefined, "blocked")),
      compactText(blocker.detail ?? blocker.flowKey ?? blocker.roleId ?? "", 140)
    )
  );
  const warningItems = warnings.slice(0, 8).map((warning) =>
    toCompactItem(
      compactText(warning.message ?? warning.code ?? t("readiness.warning", undefined, "warning"), 120),
      String(warning.severity ?? t("readiness.warning", undefined, "warning")),
      compactText(warning.detail ?? warning.flowKey ?? warning.roleId ?? "", 140)
    )
  );
  const unresolvedBindingItems = unresolvedBindings.slice(0, 8).map((binding) =>
    toCompactItem(
      String(binding.roleId ?? t("common.notAvailable", undefined, "n/a")),
      String(binding.bindingKind ?? t("common.unknown", undefined, "unknown")),
      compactText(binding.message ?? binding.declaredBinding ?? binding.resolvedBinding ?? "", 140)
    )
  );
  const unhealthyRoleItems = unhealthyRoles.slice(0, 8).map((role) =>
    toCompactItem(
      String(role.roleId ?? t("common.notAvailable", undefined, "n/a")),
      t("readiness.unhealthy", { count: "1" }, "1 unhealthy"),
      compactText(String(role.outputSchemaPath ?? role.schemaPath ?? t("config.outputSchemaUnavailable", undefined, "output schema unavailable")), 140)
    )
  );
  const missingContractItems = uncoveredEdges.slice(0, 8).map((edge) =>
    toCompactItem(
      String(edge.flowKey ?? t("common.notAvailable", undefined, "n/a")),
      t("readiness.missing", { count: "1" }, "missing 1"),
      compactText(edge.contractId ?? edge.schemaPath ?? edge.message ?? "", 140)
    )
  );
  return [
    '<div class="release-checklist">',
    '<section class="release-group"><h4>' + escapeText(t("release.group.gate", undefined, "Release gate")) + '</h4><div class="run-graph-summary-grid">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("release.gate", undefined, "release gate")) + '</span><span class="status ' + escapeText(canExport ? "done" : "failed") + '">' +
      escapeText(canExport ? t("release.candidateReady", undefined, "release candidate ready") : t("release.candidateBlocked", undefined, "release candidate blocked")) +
      '</span></div><strong>' + escapeText(t("release.artifactContract", undefined, "Validated export candidate uses the single-project-v1 artifact contract.")) +
      '</strong><div class="hint">' + escapeText(t("release.sourceDigestHint", {
        path: args.workbenchSavedPath || "system.mmd"
      }, "source " + (args.workbenchSavedPath || "system.mmd") + " · digests are derived from generated and exported project content")) + '</div></div>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("release.validationReport", undefined, "validation report")) + '</span><span>' +
      escapeText(validationOk ? t("workbench.validationOk", undefined, "validation ok") : t("workbench.diagnostics", { count: String(diagnostics.length) }, String(diagnostics.length) + " diagnostics")) +
      '</span></div><strong>' + escapeText(validationOk ? t("release.systemMmdValid", undefined, "system.mmd validates successfully") : t("release.systemMmdBlocked", undefined, "system.mmd has blocking validation diagnostics")) +
      '</strong><div class="hint">' + escapeText(args.workbenchDirty ? t("release.unsavedChangesBlock", undefined, "Unsaved workbench changes must be saved before export.") : t("workbench.diskInSync", undefined, "disk in sync")) + '</div></div>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("section.projectReadiness", undefined, "Project Readiness")) + '</span><span>' +
      escapeText(blockers.length ? t("readiness.blocked", undefined, "blocked") : t("readiness.ready", undefined, "ready")) +
      '</span></div><strong>' + escapeText(blockers.length ? t("release.blockersRemain", { count: String(blockers.length) }, String(blockers.length) + " blocker(s) remain") : t("release.noBlockers", undefined, "No blocking readiness issues.")) +
      '</strong><div class="hint">' + escapeText(warningNote) + '</div></div>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("readiness.contractCoverage", undefined, "contract coverage")) + '</span><span>' +
      escapeText(missingContracts ? t("readiness.missing", { count: String(missingContracts) }, "missing " + String(missingContracts)) : t("common.complete", undefined, "complete")) +
      '</span></div><strong>' + escapeText(t("release.contractReport", undefined, "Contract and schema coverage report")) +
      '</strong><div class="hint">' + escapeText(t("release.bindingRolePackageSummary", { unresolved: String(unresolvedBindings.length), unhealthy: String(unhealthyRoles.length) }, "unresolved bindings " + String(unresolvedBindings.length) + " · unhealthy role packages " + String(unhealthyRoles.length))) + '</div></div>',
    '</div></section>',
    '<section class="release-group"><h4>' + escapeText(t("release.group.quality", undefined, "Quality signals")) + '</h4><div class="structure-list">',
    renderSummaryListSection({
      title: t("release.validationReport", undefined, "validation report"),
      items: diagnosticItems,
      emptyLabel: t("studio.noParseCompileDiagnostics", undefined, "No parse or compile diagnostics."),
      summaryLabel: validationOk ? t("workbench.validationOk", undefined, "validation ok") : t("workbench.diagnostics", { count: String(diagnostics.length) }, String(diagnostics.length) + " diagnostics"),
      hint: t("release.qualityDiagnosticsHint", undefined, "Review concrete parse, compile, and structure diagnostics before exporting."),
      open: diagnostics.length > 0,
      tone: diagnostics.length ? "warning" : "notice"
    }),
    renderSummaryListSection({
      title: t("release.blockersTitle", undefined, "readiness blockers"),
      items: blockerItems,
      emptyLabel: t("release.noBlockers", undefined, "No blocking readiness issues."),
      summaryLabel: blockers.length ? t("release.blockersRemain", { count: String(blockers.length) }, String(blockers.length) + " blocker(s) remain") : t("common.ready", undefined, "ready"),
      hint: t("release.resolveBlockers", undefined, "Resolve release blockers."),
      open: blockers.length > 0,
      tone: blockers.length ? "critical" : "notice"
    }),
    renderSummaryListSection({
      title: t("release.warningsTitle", undefined, "release warnings"),
      items: warningItems,
      emptyLabel: t("release.noWarningNote", undefined, "No non-blocking warnings for release notes."),
      summaryLabel: warningNote,
      hint: t("release.warningCarryHint", undefined, "Warnings remain visible here so release notes and follow-up work stay explicit."),
      open: warnings.length > 0,
      tone: warnings.length ? "warning" : undefined
    }),
    renderSummaryListSection({
      title: t("release.unresolvedBindingsTitle", undefined, "unresolved bindings"),
      items: unresolvedBindingItems,
      emptyLabel: t("readiness.allBindingsResolved", undefined, "All role bindings resolve."),
      summaryLabel: t("release.bindingRolePackageSummary", { unresolved: String(unresolvedBindings.length), unhealthy: String(unhealthyRoles.length) }, "unresolved bindings " + String(unresolvedBindings.length) + " · unhealthy role packages " + String(unhealthyRoles.length)),
      hint: t("release.bindingResolutionHint", undefined, "Bindings should resolve cleanly before this candidate is exported."),
      open: unresolvedBindingItems.length > 0,
      tone: unresolvedBindingItems.length ? "warning" : undefined
    }),
    renderSummaryListSection({
      title: t("release.unhealthyRolesTitle", undefined, "role package coverage"),
      items: unhealthyRoleItems,
      emptyLabel: t("readiness.allFilesPresent", undefined, "all required files present"),
      summaryLabel: t("readiness.rolesInspected", { count: String(packageRoles.length) }, String(packageRoles.length) + " role package(s) inspected"),
      hint: t("release.rolePackageCoverageHint", undefined, "Missing runtime files are surfaced here before release packaging."),
      open: unhealthyRoleItems.length > 0,
      tone: unhealthyRoleItems.length ? "warning" : undefined
    }),
    renderSummaryListSection({
      title: t("release.missingContractsTitle", undefined, "missing contracts"),
      items: missingContractItems,
      emptyLabel: t("common.complete", undefined, "complete"),
      summaryLabel: t("release.contractReport", undefined, "Contract and schema coverage report"),
      hint: t("release.contractCoverageHint", undefined, "Every deployable handoff should have visible contract and schema coverage."),
      open: missingContractItems.length > 0,
      tone: missingContractItems.length ? "warning" : undefined
    }),
    '</div></section>',
    '<section class="release-group"><h4>' + escapeText(t("release.group.evidence", undefined, "Evidence and export scope")) + '</h4><div class="structure-list">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("studio.dryRun", undefined, "Dry run")) + '</span><span>' +
      escapeText(args.lastDryRunId ? t("common.captured", undefined, "captured") : t("common.missing", undefined, "missing")) +
      '</span></div><strong>' + escapeText(args.lastDryRunId || t("release.noDryRunYet", undefined, "No dry-run has been launched from this Studio session yet.")) +
      '</strong><div class="hint">' + escapeText(t("release.dryRunHint", undefined, "Debug mode remains inside Build and does not change runtime execution semantics.")) + '</div></div>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("release.exportArtifact", undefined, "export artifact")) + '</span><span>single-project-v1</span></div><strong>' +
      escapeText(t("release.exportBoundary", undefined, "Export excludes .ogs/runs, logs, timeline, checkpoints, and review artifacts.")) +
      '</strong><div class="hint">' + escapeText(t("release.exportTraceability", undefined, "Traceability is anchored to source project metadata, system.mmd, role packages, bindings, and model/profile config.")) + '</div></div>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("release.gate", undefined, "release gate")) + '</span><span>' + escapeText(canExport ? t("common.ready", undefined, "ready") : t("common.blocked", undefined, "blocked")) + '</span></div><strong>' + escapeText(canExport ? t("release.exportReadyNow", undefined, "Export can proceed with the current saved source.") : t("release.exportBlockedNow", undefined, "Export is still blocked by unsaved source, diagnostics, or readiness issues.")) + '</strong><div class="hint">' + escapeText(t("release.exportDecisionHint", undefined, "This panel keeps the final export decision anchored to saved graph source and release evidence.")) + '</div></div>',
    '</div></section>',
    "</div>"
  ].join("");
}

export function renderStudioBridgeInspector(args: {
  bridge: JsonRecord | null | undefined;
  selectedRoleId: string;
  selectedFlowKey: string;
  rolePackageEditor?: JsonRecord | null | undefined;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const bridge = args.bridge ?? {};
  const extracted = (bridge.extracted ?? {}) as JsonRecord;
  const roles = Array.isArray(extracted.roles) ? extracted.roles as JsonRecord[] : [];
  const flows = Array.isArray(extracted.flows) ? extracted.flows as JsonRecord[] : [];
  const selectedRole = roles.find((role) => role.roleId === args.selectedRoleId) ?? roles[0];
  const selectedFlow = flows.find((flow) => flow.flowKey === args.selectedFlowKey) ?? flows[0];
  const roleInspector = selectedRole
    ? [
        '<div class="event"><div class="event-top"><span>' + escapeText(t("studio.roleInspector", undefined, "role inspector")) + '</span><span>' + escapeText(String(selectedRole.bindingKind ?? "noop")) + '</span></div><strong><code>' + escapeText(String(selectedRole.roleId ?? "")) + '</code></strong>',
        '<div class="hint">' + escapeText(t("studio.modelExecRoute", {
          modelRef: String(selectedRole.modelRef ?? "n/a"),
          profileId: String(selectedRole.profileId ?? "n/a"),
          routingMode: String(selectedRole.routingMode ?? t("studio.standard", undefined, "standard"))
        }, "model " + String(selectedRole.modelRef ?? "n/a") + " · exec " + String(selectedRole.profileId ?? "n/a") + " · route " + String(selectedRole.routingMode ?? "standard"))) + "</div></div>",
        '<div class="event"><div class="event-top"><span>' + escapeText(t("common.metadata", undefined, "metadata")) + '</span><span>' + escapeText(t("common.readOnly", undefined, "read only")) + '</span></div><strong>' +
          escapeText([
            selectedRole.joinMode ? t("common.join", undefined, "join") + " " + selectedRole.joinMode : "",
            selectedRole.loopMax ? t("common.loop", undefined, "loop") + " " + selectedRole.loopMax : "",
            selectedRole.review ? t("studio.reviewRequired", undefined, "review required") : "",
            selectedRole.contextMap ? t("studio.contextMap", undefined, "context map") : ""
          ].filter(Boolean).join(" · ") || t("project.noSpecialGraphMetadata", undefined, "no special metadata")) +
          '</strong><div class="hint">' + escapeText(t("studio.incomingOutgoing", {
            incoming: String(selectedRole.incomingFlowCount ?? 0),
            outgoing: String(selectedRole.outgoingFlowCount ?? 0)
          }, "incoming " + String(selectedRole.incomingFlowCount ?? 0) + " · outgoing " + String(selectedRole.outgoingFlowCount ?? 0))) + "</div></div>"
      ].join("")
    : '<div class="hint">' + escapeText(t("studio.selectRole", undefined, "Select a role to inspect metadata.")) + '</div>';
  const flowInspector = selectedFlow
    ? '<div class="event"><div class="event-top"><span>' + escapeText(t("studio.flowInspector", undefined, "flow inspector")) + '</span><span>' + escapeText(String(selectedFlow.eventType ?? "")) +
      '</span></div><strong><code>' + escapeText(String(selectedFlow.fromRoleId ?? "")) + '</code> -> <code>' +
      escapeText(String(selectedFlow.toRoleId ?? "")) + '</code></strong><div class="hint">' +
      escapeText(t("studio.flowDisplayIdentity", {
        label: flowDisplayLabel(selectedFlow),
        eventType: String(selectedFlow.eventType ?? "")
      }, "display " + flowDisplayLabel(selectedFlow) + " · event " + String(selectedFlow.eventType ?? ""))) +
      " · " + escapeText(selectedFlow.runtimeOnlyErrorFlow ? t("studio.runtimeOnlyErrorPath", undefined, "runtime-only error path") : t("studio.authoringDesignPath", undefined, "authoring design path")) +
      " · " + escapeText(selectedFlow.participatesInJoin ? t("studio.participatesInJoin", undefined, "participates in join.sources") : t("studio.notJoinSource", undefined, "not a join source")) + "</div></div>"
    : '<div class="hint">' + escapeText(t("studio.selectFlow", undefined, "Select a flow to inspect event metadata.")) + '</div>';
  const packageEditor = selectedRole
    ? renderStudioRolePackageEditor({
        roleId: String(selectedRole.roleId ?? ""),
        editor: args.rolePackageEditor,
        t
      })
    : "";
  return '<div class="event"><div class="event-top"><span>' + escapeText(t("common.system", undefined, "system")) + '</span><span>' + escapeText(String(extracted.systemVersion ?? "n/a")) +
      '</span></div><strong>' + escapeText(String(extracted.systemId ?? "unknown")) + '</strong><div class="hint">' + escapeText(t("common.entry", undefined, "entry")) + " " +
      escapeText(String(extracted.entryRoleId ?? "n/a")) + " · " + escapeText(t("common.law", undefined, "law")) + " " + escapeText(String(extracted.lawGlobal ?? "n/a")) + "</div></div>" +
      roleInspector + packageEditor + flowInspector;
}

export function renderStudioRolePackageEditor(args: {
  roleId: string;
  editor?: JsonRecord | null | undefined;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const editor = args.editor ?? {};
  const activeRoleId = String(editor.roleId ?? "");
  const matchesRole = activeRoleId === args.roleId;
  const data = matchesRole && typeof editor.data === "object" && editor.data !== null && !Array.isArray(editor.data)
    ? editor.data as JsonRecord
    : {};
  const draftFiles = matchesRole && typeof editor.draftFiles === "object" && editor.draftFiles !== null && !Array.isArray(editor.draftFiles)
    ? editor.draftFiles as JsonRecord
    : {};
  const loading = matchesRole && editor.loading === true;
  const saving = matchesRole && editor.saving === true;
  const dirty = matchesRole && editor.dirty === true;
  const loaded = matchesRole && editor.loaded === true;
  const error = matchesRole ? String(editor.error ?? "") : "";
  const files = (data.files ?? {}) as JsonRecord;
  const fileNames = ["role.json", "agent.md", "prompt.md", "output.schema.json"];
  const disabled = loading || saving ? " disabled" : "";
  const loadButtonLabel = loaded
    ? t("action.refresh", undefined, "Refresh")
    : t("action.load", undefined, "Load");
  const fileEditors = loaded
    ? fileNames.map((fileName) => {
        const file = ((files[fileName] ?? {}) || {}) as JsonRecord;
        const content = String(draftFiles[fileName] ?? file.content ?? "");
        const exists = file.exists === true;
        return [
          '<label class="field full studio-role-package-file"><span><code>' + escapeText(fileName) + '</code> · ' + escapeText(exists ? t("common.loaded", undefined, "loaded") : t("common.missing", undefined, "missing")) + '</span>',
          '<textarea data-role-package-file="' + escapeText(fileName) + '"' + disabled + '>' + escapeText(content) + '</textarea>',
          '<div class="hint">' + escapeText(String(file.path ?? t("common.notAvailable", undefined, "n/a"))) + '</div></label>'
        ].join("");
      }).join("")
    : '<div class="hint">' + escapeText(loading ? t("common.loading", undefined, "loading") : t("studio.rolePackageLoadHint", undefined, "Load this role package to inspect and edit its runtime files.")) + '</div>';
  return [
    '<div class="event studio-role-package-editor" data-role-package-editor="' + escapeText(args.roleId) + '">',
    '<div class="event-top"><span>' + escapeText(t("studio.rolePackage", undefined, "role package")) + '</span><span>' + escapeText(dirty ? t("common.changed", undefined, "changed") : loaded ? t("common.loaded", undefined, "loaded") : t("common.lazy", undefined, "lazy")) + '</span></div>',
    '<strong><code>' + escapeText(args.roleId) + '</code></strong>',
    error ? '<div class="hint severity-warning">' + escapeText(error) + '</div>' : '',
    data.resolvedPath ? '<div class="hint">' + escapeText(String(data.resolvedPath)) + '</div>' : '',
    '<div class="actions compact"><button class="button subtle" data-role-package-load="' + escapeText(args.roleId) + '"' + disabled + '>' + escapeText(loadButtonLabel) + '</button><button class="button primary" data-role-package-save="' + escapeText(args.roleId) + '"' + (disabled || !loaded || !dirty ? " disabled" : "") + '>' + escapeText(t("action.save", undefined, "Save")) + '</button><button class="button subtle" data-role-package-revert="' + escapeText(args.roleId) + '"' + (disabled || !loaded || !dirty ? " disabled" : "") + '>' + escapeText(t("action.revertToDisk", undefined, "Revert to disk")) + '</button></div>',
    '<div class="form-grid">' + fileEditors + '</div>',
    '</div>'
  ].join("");
}

export function renderStudioExecutionConfigEditor(args: {
  roleId: string;
  editor?: JsonRecord | null | undefined;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const editor = args.editor ?? {};
  const activeRoleId = String(editor.roleId ?? "");
  const matchesRole = activeRoleId === args.roleId;
  const data = matchesRole && typeof editor.data === "object" && editor.data !== null && !Array.isArray(editor.data)
    ? editor.data as JsonRecord
    : {};
  const draft = matchesRole && typeof editor.draft === "object" && editor.draft !== null && !Array.isArray(editor.draft)
    ? editor.draft as JsonRecord
    : {};
  const loading = matchesRole && editor.loading === true;
  const saving = matchesRole && editor.saving === true;
  const dirty = matchesRole && editor.dirty === true;
  const loaded = matchesRole && editor.loaded === true;
  const error = matchesRole ? String(editor.error ?? "") : "";
  const disabled = loading || saving ? " disabled" : "";
  const profileId = String(draft.profileId ?? data.profileId ?? "");
  const toolRef = String(draft.toolRef ?? data.toolRef ?? "");
  const command = String(draft.command ?? data.command ?? "");
  const argsTemplate = Array.isArray(draft.argsTemplate)
    ? draft.argsTemplate
    : Array.isArray(data.argsTemplate)
      ? data.argsTemplate
      : [];
  const stdinMode = String(draft.stdinMode ?? data.stdinMode ?? "text");
  const timeoutMs = String(draft.timeoutMs ?? data.timeoutMs ?? "");
  const maxOutputBytes = String(draft.maxOutputBytes ?? data.maxOutputBytes ?? "");
  const loadButtonLabel = loaded
    ? t("action.refresh", undefined, "Refresh")
    : t("action.load", undefined, "Load");
  return [
    '<div class="event studio-execution-config-editor" data-execution-config-editor="' + escapeText(args.roleId) + '">',
    '<div class="event-top"><span>' + escapeText(t("studio.executionConfig", undefined, "execution config")) + '</span><span>' + escapeText(dirty ? t("common.changed", undefined, "changed") : loaded ? t("common.loaded", undefined, "loaded") : t("common.lazy", undefined, "lazy")) + '</span></div>',
    '<strong><code>' + escapeText(args.roleId) + '</code></strong>',
    '<div class="hint">' + escapeText(t("studio.executionConfigHint", undefined, "Repository content is copied into this project. Business fields below are editable; ids stay system-managed.")) + '</div>',
    error ? '<div class="hint severity-warning">' + escapeText(error) + '</div>' : '',
    '<div class="actions compact"><button class="button subtle" data-execution-config-load="' + escapeText(args.roleId) + '"' + disabled + '>' + escapeText(loadButtonLabel) + '</button><button class="button primary" data-execution-config-save="' + escapeText(args.roleId) + '"' + (disabled || !loaded || !dirty ? " disabled" : "") + '>' + escapeText(t("action.save", undefined, "Save")) + '</button><button class="button subtle" data-execution-config-revert="' + escapeText(args.roleId) + '"' + (disabled || !loaded || !dirty ? " disabled" : "") + '>' + escapeText(t("action.revertToDisk", undefined, "Revert")) + '</button></div>',
    loaded
      ? '<div class="form-grid">' +
          '<label class="field"><span>' + escapeText(t("studio.executionConfigProfileId", undefined, "Profile id")) + '</span><input data-execution-config-field="profileId" value="' + escapeText(profileId) + '" readonly><div class="hint">' + escapeText(t("studio.executionConfigSystemManaged", undefined, "Required · system-managed · not business editable")) + '</div></label>' +
          '<label class="field"><span>' + escapeText(t("studio.executionConfigToolRef", undefined, "Tool ref")) + '</span><input data-execution-config-field="toolRef" value="' + escapeText(toolRef) + '" readonly><div class="hint">' + escapeText(t("studio.executionConfigSystemManaged", undefined, "Required · system-managed · not business editable")) + '</div></label>' +
          '<label class="field full"><span>' + escapeText(t("studio.executionConfigCommand", undefined, "Command")) + '</span><input data-execution-config-field="command" value="' + escapeText(command) + '"' + disabled + '><div class="hint">' + escapeText(t("studio.executionConfigCommandHint", undefined, "Required. Entry command for the local tool runner.")) + '</div></label>' +
          '<label class="field full"><span>' + escapeText(t("studio.executionConfigArgs", undefined, "Args template")) + '</span><textarea data-execution-config-field="argsTemplate"' + disabled + '>' + escapeText(JSON.stringify(argsTemplate, null, 2)) + '</textarea><div class="hint">' + escapeText(t("studio.executionConfigArgsHint", undefined, "Optional JSON array. Keep each item as a string argument.")) + '</div></label>' +
          '<label class="field"><span>' + escapeText(t("studio.executionConfigStdinMode", undefined, "Stdin mode")) + '</span><select data-execution-config-field="stdinMode"' + disabled + '><option value="text"' + (stdinMode === "text" ? " selected" : "") + '>text</option><option value="none"' + (stdinMode === "none" ? " selected" : "") + '>none</option></select><div class="hint">' + escapeText(t("studio.executionConfigOptionalMutable", undefined, "Optional tuning · editable")) + '</div></label>' +
          '<label class="field"><span>' + escapeText(t("studio.executionConfigTimeout", undefined, "Timeout ms")) + '</span><input data-execution-config-field="timeoutMs" inputmode="numeric" value="' + escapeText(timeoutMs) + '"' + disabled + '><div class="hint">' + escapeText(t("studio.executionConfigOptionalMutable", undefined, "Optional tuning · editable")) + '</div></label>' +
          '<label class="field"><span>' + escapeText(t("studio.executionConfigMaxOutput", undefined, "Max output bytes")) + '</span><input data-execution-config-field="maxOutputBytes" inputmode="numeric" value="' + escapeText(maxOutputBytes) + '"' + disabled + '><div class="hint">' + escapeText(t("studio.executionConfigOptionalMutable", undefined, "Optional tuning · editable")) + '</div></label>' +
        '</div>'
      : '<div class="hint">' + escapeText(loading ? t("common.loading", undefined, "loading") : t("studio.executionConfigLoadHint", undefined, "Load this execution config to inspect and edit its project-local settings.")) + '</div>',
    '</div>'
  ].join("");
}

export function renderStudioBridgePanel(args: {
  bridge: JsonRecord | null | undefined;
  readiness: JsonRecord | null | undefined;
  selectedRoleId: string;
  selectedFlowKey: string;
  workbenchView?: string;
  graphRootContentHtml?: string;
  filter?: string;
  listMode?: string;
  sideTab?: string;
  fullscreen?: boolean;
  rolePackageEditor?: JsonRecord | null | undefined;
  selectionDocked?: boolean;
  selectionCollapsed?: boolean;
  actionBusy: string;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const bridge = args.bridge ?? {};
  const extracted = (bridge.extracted ?? {}) as JsonRecord;
  const roles = Array.isArray(extracted.roles) ? extracted.roles as JsonRecord[] : [];
  const flows = Array.isArray(extracted.flows) ? extracted.flows as JsonRecord[] : [];
  const orderedRoles = sortStudioBridgeRolesTopologically(roles, flows);
  const orderedFlows = sortStudioBridgeFlowsByTopology(flows, orderedRoles);
  const listMode = args.listMode === "roles" || args.listMode === "flows" ? args.listMode : "all";
  const filtered = filterStudioBridgeItems({
    roles: orderedRoles,
    flows: orderedFlows,
    filter: args.filter || "",
    mode: listMode
  });
  const selectedRole = roles.find((role) => role.roleId === args.selectedRoleId) ?? roles[0];
  const selectedFlow = flows.find((flow) => flow.flowKey === args.selectedFlowKey) ?? flows[0];
  const busy = args.actionBusy ? " disabled" : "";
  if (!bridge || Object.keys(bridge).length === 0) {
    return '<div class="hint">' + escapeText(t("studio.dataUnavailable", undefined, "Graph workspace data unavailable.")) + '</div>';
  }
  const roleButtons = filtered.roles.length
    ? filtered.roles.map((role) => {
        const roleId = String(role.roleId ?? "");
        const active = selectedRole && selectedRole.roleId === roleId ? " active" : "";
        const badges = Array.isArray(role.badges) ? role.badges.join(" ") : "";
        return (
          '<button class="run-card' + active + '" data-studio-role-id="' + escapeText(roleId) + '"' + busy + ">" +
          '<div class="run-title"><span><code>' + escapeText(roleId) + '</code></span><span class="status ' +
          escapeText(bindingTone(String(role.bindingKind ?? "noop"))) + '">' + escapeText(String(role.bindingKind ?? "noop")) +
          '</span></div><div class="meta"><span>' + escapeText(badges || t("studio.standard", undefined, "standard")) + '</span><span>' +
          escapeText(t("studio.events", { count: String((role.allowedEvents as unknown[] | undefined)?.length ?? 0) }, "events " + String((role.allowedEvents as unknown[] | undefined)?.length ?? 0))) + "</span></div></button>"
        );
      })
    : ['<div class="hint">' + escapeText((args.filter || listMode !== "all") ? t("studio.noFilteredItems", undefined, "No matching graph items.") : t("studio.noRolesExtracted", undefined, "No roles extracted from the current Mermaid source.")) + '</div>'];
  const flowButtons = filtered.flows.length
    ? filtered.flows.map((flow) => {
        const key = String(flow.flowKey ?? "");
        const active = selectedFlow && selectedFlow.flowKey === key ? " active" : "";
        const displayLabel = flowDisplayLabel(flow);
        return (
          '<button class="run-card' + active + '" data-studio-flow-key="' + escapeText(key) + '"' + busy + ">" +
          '<div class="run-title"><span><code>' + escapeText(String(flow.fromRoleId ?? "")) + '</code> -> <code>' +
          escapeText(String(flow.toRoleId ?? "")) + '</code></span><span>' + escapeText(String(flow.eventType ?? "")) +
          '</span></div><strong>' + escapeText(displayLabel) + '</strong><div class="meta"><span>' + escapeText(flow.runtimeOnlyErrorFlow ? t("studio.runtimeErrorFlow", undefined, "runtime error flow") : t("studio.designFlow", undefined, "design flow")) +
          '</span><span>' + escapeText(flow.participatesInJoin ? t("studio.joinSource", undefined, "join source") : t("studio.standard", undefined, "standard")) + "</span></div></button>"
        );
      })
    : ['<div class="hint">' + escapeText((args.filter || listMode !== "all") ? t("studio.noFilteredItems", undefined, "No matching graph items.") : t("studio.noFlowsExtracted", undefined, "No flows extracted from the current Mermaid source.")) + '</div>'];
  const graphCanvas = renderStudioGraphCanvas({
    selectedRoleId: args.selectedRoleId,
    selectedFlowKey: args.selectedFlowKey,
    rootMode: args.workbenchView === "source" ? "source" : "bridge",
    rootClassName: args.workbenchView === "source" ? "studio-source-root" : "",
    rootContentHtml: args.workbenchView === "source" ? (args.graphRootContentHtml || "") : "",
    sideTab: args.sideTab || "selection",
    selectionKindLabel: selectedRole
      ? t("studio.roleInspector", undefined, "Role details")
      : selectedFlow
        ? t("studio.flowInspector", undefined, "Flow details")
        : "",
    selectionTitle: selectedRole
      ? String(selectedRole.roleId ?? "")
      : selectedFlow
        ? String(selectedFlow.flowKey ?? "")
        : "",
    selectionRolePackageHtml: selectedRole
      ? renderStudioRolePackageEditor({
          roleId: String(selectedRole.roleId ?? ""),
          editor: args.rolePackageEditor,
          t
        })
      : selectedFlow
        ? '<div class="event"><div class="event-top"><span>' + escapeText(t("studio.flowInspector", undefined, "Flow details")) + '</span><span>' +
          escapeText(String(selectedFlow.eventType ?? "")) + '</span></div><strong><code>' + escapeText(String(selectedFlow.fromRoleId ?? "")) + '</code> -> <code>' +
          escapeText(String(selectedFlow.toRoleId ?? "")) + '</code></strong><div class="hint">' +
          escapeText(t("studio.flowDisplayIdentity", {
            label: flowDisplayLabel(selectedFlow),
            eventType: String(selectedFlow.eventType ?? "")
          }, "display " + flowDisplayLabel(selectedFlow) + " · event " + String(selectedFlow.eventType ?? ""))) +
          "</div></div>"
        : "",
    selectionStructureHtml:
      '<div class="studio-bridge-index structure-list" data-studio-bridge-region="index"><div class="event studio-bridge-index-controls"><div class="event-top"><span>' +
      escapeText(t("studio.retrievalTab", undefined, "Browse")) + '</span><span>' + escapeText(t("studio.topologyOrder", undefined, "authoring order")) + '</span></div><div class="toolbar-row compact"><input data-studio-bridge-filter="1" value="' +
      escapeText(args.filter || "") + '" placeholder="' + escapeText(t("studio.filterGraphItems", undefined, "Filter roles or flows")) + '" aria-label="' + escapeText(t("studio.filterGraphItems", undefined, "Filter roles or flows")) + '"><select data-studio-bridge-list-mode="1" aria-label="' + escapeText(t("studio.retrievalTab", undefined, "Browse")) + '"><option value="all"' +
      (listMode === "all" ? " selected" : "") + ">" + escapeText(t("common.all", undefined, "all")) + '</option><option value="roles"' +
      (listMode === "roles" ? " selected" : "") + ">" + escapeText(t("studio.roles", undefined, "roles")) + '</option><option value="flows"' +
      (listMode === "flows" ? " selected" : "") + ">" + escapeText(t("studio.flows", undefined, "flows")) + '</option></select></div><div class="hint">' +
      escapeText(t("studio.topologyOrderHint", undefined, "Cycles are listed after the acyclic path so the authoring order stays stable.")) + '</div></div><div class="studio-index-grid"><div class="studio-navigator structure-list" data-studio-bridge-region="navigator"><div class="event"><div class="event-top"><span>' + escapeText(t("studio.roles", undefined, "roles")) + '</span><span>' + escapeText(String(filtered.roles.length)) +
      " / " + escapeText(String(roles.length)) + '</span></div><strong>' + escapeText(t("studio.structuredRoleDraft", undefined, "Role structure")) + '</strong><div class="hint">' + escapeText(t("studio.bridgeReadsWorkbench", undefined, "Derived from the current graph source.")) + '</div></div>' + roleButtons.join("") + '</div><div class="structure-list studio-flow-list" data-studio-bridge-region="flow-list"><div class="event"><div class="event-top"><span>' + escapeText(t("studio.flows", undefined, "flows")) + '</span><span>' + escapeText(String(filtered.flows.length)) +
      " / " + escapeText(String(flows.length)) + '</span></div><strong>' + escapeText(t("studio.structuredFlowDraft", undefined, "Flow structure")) + '</strong><div class="hint">' + escapeText(t("studio.eventsVisible", undefined, "Event types and join participation stay visible.")) + '</div></div>' + flowButtons.join("") + "</div></div></div>",
    selectionDocked: args.selectionDocked !== false,
    selectionCollapsed: args.selectionCollapsed === true,
    fullscreen: args.fullscreen,
    t
  });
  return [
    '<div class="structure-list studio-bridge">',
    '<div class="studio-bridge-layout">',
    '<div class="studio-graph-column" data-studio-bridge-region="graph">' + graphCanvas + "</div>",
    "</div>",
    "</div>"
  ].join("");
}

export function renderFailureSummaryPanel(args: {
  failure: Record<string, unknown> | null | undefined;
  loaded: boolean;
  stale: boolean;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  if (!args.loaded) {
    return '<div class="hint">' + escapeText(t("failure.loadsWithRun", undefined, "Failure triage loads with the selected run.")) + '</div>';
  }
  if (!args.failure) {
    return '<div class="hint">' + escapeText(t("failure.noRecentCaptured", undefined, "No recent failure captured for this run.")) + '</div>';
  }
  const summary = ((args.failure.summary ?? args.failure) || {}) as JsonRecord;
  const detail = ((args.failure.detail ?? {}) || {}) as JsonRecord;
  const errorCode = String(summary.errorCode ?? detail.errorCode ?? "none");
  const stage = String(summary.stage ?? detail.stage ?? t("common.notAvailable", undefined, "n/a"));
  const message = String(summary.message ?? detail.message ?? t("failure.noMessage", undefined, "No failure message recorded."));
  const roleId = String(summary.roleId ?? detail.roleId ?? t("common.notAvailable", undefined, "n/a"));
  const branchId = String(summary.branchId ?? detail.branchId ?? t("common.notAvailable", undefined, "n/a"));
  const retryable = Boolean(summary.retryable ?? detail.retryable);
  const durationMs = summary.durationMs ?? detail.durationMs ?? "n/a";
  const timeoutMs =
    detail.timeoutMs ??
    ((detail.selectedBinding as JsonRecord | undefined)?.timeoutMs ?? (summary.timeoutMs as unknown));
  const classifyError = (): string => {
    if (errorCode === "TOOL_EXECUTION_TIMEOUT") return t("failure.class.timeoutBudgetExhausted", undefined, "timeout budget exhausted");
    if (errorCode.includes("CONTRACT")) return t("failure.class.contractHandoffViolation", undefined, "contract handoff violation");
    if (errorCode.includes("SCHEMA")) return t("failure.class.schemaMismatch", undefined, "schema mismatch");
    if (errorCode.includes("PROVIDER") || errorCode.includes("MODEL")) return t("failure.class.providerModelFailure", undefined, "provider or model failure");
    if (errorCode === "ROLE_EXECUTION_FAILED") return t("failure.class.roleExecutionFailed", undefined, "role execution failed");
    return t("failure.class.runtimeFailure", undefined, "runtime failure");
  };
  const summaryCards = [
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.recentFailedRole", undefined, "recent failed role")) + '</span><span>' +
      escapeText(displayUiToken(stage, t)) +
      '</span></div><strong><code>' +
      escapeText(roleId) +
      '</code></strong><div class="hint">' +
      escapeText(branchId + " · " + classifyError()) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.errorCode", undefined, "error code")) + '</span><span>' +
      escapeText(retryable ? t("failure.retryable", undefined, "retryable") : t("failure.terminal", undefined, "terminal")) +
      '</span></div><strong>' +
      escapeText(errorCode) +
      '</strong><div class="hint">' +
      escapeText(message) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.budget", undefined, "budget")) + '</span><span>' +
      escapeText(args.stale ? t("common.stale", undefined, "stale") : t("common.fresh", undefined, "fresh")) +
      '</span></div><strong>' +
      escapeText(t("failure.durationMs", { durationMs: String(durationMs) }, "duration " + durationMs + " ms")) +
      '</strong><div class="hint">' +
      escapeText(timeoutMs ? t("failure.timeoutBudgetMs", { timeoutMs: String(timeoutMs) }, "timeout budget " + timeoutMs + " ms") : t("failure.timeoutBudgetUnavailable", undefined, "timeout budget unavailable")) +
      "</div></div>"
  ];
  return ['<div class="structure-list">', ...summaryCards, "</div>"].join("");
}

export function renderFailureDetailPanel(args: {
  failure: Record<string, unknown> | null | undefined;
  loaded: boolean;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  if (!args.loaded) {
    return '<div class="hint">' + escapeText(t("failure.detailNotLoaded", undefined, "Failure detail is not loaded yet.")) + '</div>';
  }
  if (!args.failure) {
    return '<div class="hint">' + escapeText(t("failure.noDetail", undefined, "No failure detail available.")) + '</div>';
  }
  const summary = ((args.failure.summary ?? args.failure) || {}) as JsonRecord;
  const detail = ((args.failure.detail ?? {}) || {}) as JsonRecord;
  const selectedBinding = ((detail.selectedBinding ?? summary.selectedBinding) || {}) as JsonRecord;
  const upstreamRoleIds = Array.isArray(detail.upstreamRoleIds) ? detail.upstreamRoleIds : [];
  const allowedEvents = Array.isArray(detail.allowedEvents) ? detail.allowedEvents : [];
  const contract = ((detail.contract ?? summary.contract) || {}) as JsonRecord;
  const schemaPath = detail.schemaPath ?? contract.schemaPath ?? "n/a";
  const rawOutput = detail.rawOutput ?? detail.rawModelOutput ?? summary.rawOutput ?? null;
  const inputPreview = compactJsonPreview(detail.inputContext, 220);
  const rawPreview = compactJsonPreview(rawOutput, 220);
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.projectedInput", undefined, "projected input")) + '</span><span>' +
      escapeText(Array.isArray(detail.inputContext) ? "array" : typeof detail.inputContext) +
      '</span></div><strong>' +
      escapeText(detail.correctionRequest ? t("failure.correctionRequestPresent", undefined, "correction request present") : t("failure.inputContextAvailable", undefined, "input context available")) +
      '</strong><div class="hint">' +
      escapeText(t("failure.schema", { schemaPath: displayUiToken(schemaPath, t) }, "schema " + schemaPath)) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.bindingResolution", undefined, "binding resolution")) + '</span><span>' +
      escapeText(displayUiToken(selectedBinding.bindingKind ?? selectedBinding.kind ?? "n/a", t)) +
      '</span></div><strong>' +
      escapeText(String(selectedBinding.resolvedBinding ?? selectedBinding.bindingRef ?? t("failure.bindingUnavailable", undefined, "binding unavailable"))) +
      '</strong><div class="hint">' +
      escapeText(t("failure.declaredTimeoutBudget", {
        declared: String(selectedBinding.declaredBinding ?? t("common.notAvailable", undefined, "n/a")),
        timeoutMs: String(selectedBinding.timeoutMs ?? detail.timeoutMs ?? t("common.notAvailable", undefined, "n/a")),
        maxOutputBytes: String(selectedBinding.maxOutputBytes ?? t("common.notAvailable", undefined, "n/a"))
      }, "declared " + String(selectedBinding.declaredBinding ?? "n/a") + " · timeout " + String(selectedBinding.timeoutMs ?? detail.timeoutMs ?? "n/a") + " ms · output budget " + String(selectedBinding.maxOutputBytes ?? "n/a"))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.contract", undefined, "contract")) + '</span><span>' +
      escapeText(displayUiToken(contract.kind ?? "n/a", t)) +
      '</span></div><strong>' +
      escapeText(String(contract.contractId ?? t("failure.contractUnavailable", undefined, "contract unavailable"))) +
      '</strong><div class="hint">' +
      escapeText(t("failure.flowSchema", {
        flowKey: displayUiToken(contract.flowKey ?? t("common.notAvailable", undefined, "n/a"), t),
        schemaPath: displayUiToken(contract.schemaPath ?? schemaPath, t)
      }, "flow " + String(contract.flowKey ?? "n/a") + " · schema " + String(contract.schemaPath ?? schemaPath))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.roleSchema", undefined, "role schema")) + '</span><span>' +
      escapeText(String(allowedEvents.length)) +
      '</span></div><strong>' +
      escapeText(allowedEvents.length ? allowedEvents.join(", ") : t("failure.allowedEventsUnavailable", undefined, "allowed events unavailable")) +
      '</strong><div class="hint">' +
      escapeText(t("failure.upstream", { roles: upstreamRoleIds.length ? upstreamRoleIds.join(", ") : t("common.none", undefined, "none") }, "upstream " + (upstreamRoleIds.length ? upstreamRoleIds.join(", ") : "none"))) +
      "</div></div>",
    renderPreDisclosure({
      title: t("failure.projectedInput", undefined, "projected input"),
      headline: inputPreview || t("failure.inputContextAvailable", undefined, "input context available"),
      meta: detail.inputContext ? t("common.snapshot", undefined, "snapshot") : t("common.missing", undefined, "missing"),
      hint: t("failure.schema", { schemaPath: displayUiToken(schemaPath, t) }, "schema " + schemaPath),
      value: detail.inputContext,
      emptyTitle: t("failure.inputContextAvailable", undefined, "input context available"),
      emptyMeta: t("common.missing", undefined, "missing"),
      emptyHint: t("failure.schema", { schemaPath: displayUiToken(schemaPath, t) }, "schema " + schemaPath),
      tone: "notice"
    }),
    renderPreDisclosure({
      title: t("failure.rawOutput", undefined, "raw output"),
      headline: rawPreview || t("failure.noRawOutputSnapshot", undefined, "No raw output snapshot captured"),
      meta: rawOutput ? t("common.captured", undefined, "captured") : t("common.missing", undefined, "missing"),
      hint: rawOutput ? t("failure.providerRawSnapshot", undefined, "Provider / role raw output snapshot") : t("failure.noRawOutputSnapshot", undefined, "No raw output snapshot captured"),
      value: rawOutput,
      emptyTitle: t("failure.noRawOutputSnapshot", undefined, "No raw output snapshot captured"),
      emptyMeta: t("common.missing", undefined, "missing"),
      emptyHint: t("failure.providerRawSnapshot", undefined, "Provider / role raw output snapshot"),
      tone: "critical"
    }),
    "</div>"
  ].join("");
}

export function renderSuggestedNextChecksPanel(args: {
  failure: Record<string, unknown> | null | undefined;
  loaded: boolean;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  if (!args.loaded) {
    return '<div class="hint">' + escapeText(t("failure.suggestedChecksAfterLoad", undefined, "Suggested checks appear after failure data loads.")) + '</div>';
  }
  if (!args.failure) {
    return '<div class="hint">' + escapeText(t("failure.noSpecificChecks", undefined, "No failure-specific next checks are needed right now.")) + '</div>';
  }
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.suggestedNextChecks", undefined, "suggested next checks")) + '</span><span>' + escapeText(t("failure.actions", undefined, "actions")) + '</span></div><strong>' + escapeText(t("failure.nextChecksSummary", undefined, "Move directly to the likely root-cause surfaces")) + '</strong><div class="hint">' + escapeText(t("failure.nextChecksHint", undefined, "These actions jump to the panel that explains the failing input, binding, schema, contract, or resume blockers.")) + '</div></div>',
    '<div class="actions">',
    '<button class="button subtle" id="failure-check-input">' + escapeText(t("failure.inspectProjectedInput", undefined, "Inspect projected input")) + '</button>',
    '<button class="button subtle" id="failure-check-binding">' + escapeText(t("failure.inspectBindingResolution", undefined, "Inspect binding resolution")) + '</button>',
    '<button class="button subtle" id="failure-check-role-package">' + escapeText(t("failure.inspectRoleSchema", undefined, "Inspect role schema")) + '</button>',
    '<button class="button subtle" id="failure-check-contract">' + escapeText(t("failure.inspectContract", undefined, "Inspect contract")) + '</button>',
    '<button class="button subtle" id="failure-check-resume">' + escapeText(t("failure.inspectResumeReadiness", undefined, "Inspect resume readiness")) + '</button>',
    "</div>",
    "</div>"
  ].join("");
}

export function renderBindingExplainPanel(args: {
  bindings: Record<string, unknown> | null | undefined;
  stale?: boolean;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const bindings = args.bindings ?? {};
  const roles = Array.isArray(bindings.roles)
    ? bindings.roles as JsonRecord[]
    : Array.isArray(bindings.bindings)
      ? bindings.bindings as JsonRecord[]
      : Array.isArray(bindings.entries)
        ? bindings.entries as JsonRecord[]
        : [];
  if (!roles.length) {
    return '<div class="hint">' + escapeText(t("config.bindingUnavailable", undefined, "Binding explain data unavailable.")) + '</div>';
  }
  return [
    '<div class="structure-list">',
    '<div class="toolbar-row"><div class="toolbar-group"><span class="pill">' + escapeText(t("config.roleCards", undefined, "role cards")) + '</span><span class="pill">' + escapeText(t("config.flowCards", undefined, "flow cards")) + '</span></div><div class="toolbar-group"><span class="pill">' + escapeText(t("config.all", undefined, "all")) + '</span><span class="pill warn">' + escapeText(t("common.missing", undefined, "missing")) + '</span><span class="pill">' + escapeText(t("readiness.warning", undefined, "warning")) + '</span></div></div>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("config.bindingExplain", undefined, "binding explain")) + '</span><span>' +
      escapeText(args.stale ? t("common.stale", undefined, "stale") : t("common.fresh", undefined, "fresh")) +
      '</span></div><strong>' +
      escapeText(t("config.rolesResolved", { count: roles.length }, roles.length + " roles resolved from system + model-selection")) +
      "</strong></div>",
    ...roles.map((role) =>
      '<div class="event"><div class="event-top"><span><code>' +
      escapeText(role.roleId ?? "n/a") +
      '</code></span><span>' +
      escapeText(role.bindingKind ?? "n/a") +
      "</span></div><strong>" +
      escapeText(
        String(role.declaredBinding ?? "undeclared")
          + " -> " + String(role.resolvedBinding ?? role.effectiveBinding ?? "unresolved")
      ) +
      '</strong><div class="hint">' +
      escapeText(t("config.effectiveTimeoutBudgetSource", {
        effective: String(role.effectiveBinding ?? role.resolvedBinding ?? "n/a"),
        timeoutMs: String(role.timeoutMs ?? "n/a"),
        maxOutputBytes: String(role.maxOutputBytes ?? "n/a"),
        source: String(role.source ?? t("common.unknown", undefined, "unknown"))
      }, "effective " + String(role.effectiveBinding ?? role.resolvedBinding ?? "n/a") + " · timeout " + String(role.timeoutMs ?? "n/a") + " ms · output budget " + String(role.maxOutputBytes ?? "n/a") + " · source " + String(role.source ?? "unknown"))) +
      "</div></div>"
    ),
    "</div>"
  ].join("");
}

export function renderRolePackagePanel(args: {
  rolePackages: Record<string, unknown> | null | undefined;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const rolePackages = args.rolePackages ?? {};
  const roles = Array.isArray(rolePackages.roles)
    ? rolePackages.roles as JsonRecord[]
    : Array.isArray(rolePackages.rolePackages)
      ? rolePackages.rolePackages as JsonRecord[]
      : Array.isArray(rolePackages.entries)
        ? rolePackages.entries as JsonRecord[]
        : [];
  if (!roles.length) {
    return '<div class="hint">' + escapeText(t("config.rolePackagesUnavailable", undefined, "Role package summaries unavailable.")) + '</div>';
  }
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("config.rolePackages", undefined, "role packages")) + '</span><span>' +
      escapeText(roles.length) +
      '</span></div><strong>' + escapeText(t("config.rolePackageHealth", undefined, "Role package health and schema coverage")) + '</strong></div>',
    ...roles.map((role) => {
      const files = ((role.files ?? role.health) || {}) as JsonRecord;
      const allowedEvents = Array.isArray(role.allowedEvents) ? role.allowedEvents : [];
      const presentFiles = Object.entries(files)
        .filter(([, present]) => Boolean(present))
        .map(([key]) => key);
      return (
        '<div class="event"><div class="event-top"><span><code>' +
        escapeText(role.roleId ?? "n/a") +
        '</code></span><span>' +
        escapeText(role.summary ?? role.label ?? t("config.package", undefined, "package")) +
        "</span></div><strong>" +
        escapeText(String(role.outputSchemaPath ?? role.schemaPath ?? t("config.outputSchemaUnavailable", undefined, "output schema unavailable"))) +
        '</strong><div class="hint">' +
        escapeText(t("config.allowedEventsFiles", {
          events: allowedEvents.length ? allowedEvents.join(", ") : t("common.unknown", undefined, "unknown"),
          files: presentFiles.length ? presentFiles.join(", ") : t("common.none", undefined, "none")
        }, "allowed events " + (allowedEvents.length ? allowedEvents.join(", ") : "unknown") + " · files " + (presentFiles.length ? presentFiles.join(", ") : "none"))) +
        "</div></div>"
      );
    }),
    "</div>"
  ].join("");
}

export function renderContractPanel(args: {
  contracts: Record<string, unknown> | null | undefined;
  runtimeStatus?: Record<string, unknown> | null | undefined;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const contracts = args.contracts ?? {};
  const runtimeStatus = args.runtimeStatus ?? null;
  const flows = Array.isArray(contracts.flows)
    ? contracts.flows as JsonRecord[]
    : Array.isArray(contracts.contracts)
      ? contracts.contracts as JsonRecord[]
      : Array.isArray(contracts.entries)
        ? contracts.entries as JsonRecord[]
        : [];
  const uncoveredEdges = Array.isArray(contracts.uncoveredEdges) ? contracts.uncoveredEdges : [];
  if (!flows.length && !uncoveredEdges.length && !runtimeStatus) {
    return '<div class="hint">' + escapeText(t("config.contractCoverageUnavailable", undefined, "Contract coverage data unavailable.")) + '</div>';
  }
  const runtimeCard = runtimeStatus
    ? '<div class="event"><div class="event-top"><span>' + escapeText(t("config.runContractStatus", undefined, "run contract status")) + '</span><span>' +
      escapeText(displayUiToken(runtimeStatus.status ?? t("common.unknown", undefined, "unknown"), t)) +
      '</span></div><strong>' +
      escapeText(String(runtimeStatus.reason ?? t("config.runtimeContractSignalUnavailable", undefined, "Runtime contract signal unavailable."))) +
      '</strong><div class="hint">' +
      escapeText(t("config.runRuntimeSignals", {
        runId: displayUiToken(runtimeStatus.runId ?? "n/a", t),
        runStatus: displayUiToken(runtimeStatus.runStatus ?? t("common.unknown", undefined, "unknown"), t),
        signalCount: String(runtimeStatus.signalCount ?? 0)
      }, "run " + String(runtimeStatus.runId ?? "n/a") + " · runtime " + String(runtimeStatus.runStatus ?? "unknown") + " · signals " + String(runtimeStatus.signalCount ?? 0))) +
      "</div>" +
      (runtimeStatus.attribution ? '<pre>' + escapeText(formatJson(runtimeStatus.attribution)) + "</pre>" : "") +
      "</div>"
    : "";
  return [
    '<div class="structure-list">',
    runtimeCard,
    '<div class="toolbar-row"><div class="toolbar-group"><span class="pill">' + escapeText(t("config.flowCards", undefined, "flow cards")) + '</span><span class="pill">' + escapeText(t("config.covered", undefined, "covered")) + '</span><span class="pill warn">' + escapeText(t("common.missing", undefined, "missing")) + '</span></div></div>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("readiness.contractCoverage", undefined, "contract coverage")) + '</span><span>' +
      escapeText(uncoveredEdges.length ? t("config.uncovered", { count: uncoveredEdges.length }, uncoveredEdges.length + " uncovered") : t("common.complete", undefined, "complete")) +
      '</span></div><strong>' + escapeText(t("config.strictHandoffCoverage", undefined, "Strict handoff coverage across flows and role inputs")) + '</strong></div>',
    ...flows.map((flow) =>
      '<div class="event"><div class="event-top"><span>' +
      escapeText(String(flow.flowKey ?? flow.edgeKey ?? t("common.flow", undefined, "flow"))) +
      "</span><span>" +
      escapeText(displayUiToken(flow.kind ?? "flow", t)) +
      "</span></div><strong>" +
      escapeText(String(flow.contractId ?? t("config.missingContract", undefined, "missing contract"))) +
      '</strong><div class="hint">' +
      escapeText(t("config.schemaStatus", {
        schemaPath: displayUiToken(flow.schemaPath ?? "n/a", t),
        status: displayUiToken(flow.lastStatus ?? flow.coverage ?? t("common.unknown", undefined, "unknown"), t)
      }, "schema " + String(flow.schemaPath ?? "n/a") + " · status " + String(flow.lastStatus ?? flow.coverage ?? "unknown"))) +
      "</div></div>"
    ),
    ...uncoveredEdges.map((edge) =>
      '<div class="event"><div class="event-top"><span>' + escapeText(t("config.missingContract", undefined, "missing contract")) + '</span><span>' + escapeText(t("config.coverageGap", undefined, "coverage gap")) + '</span></div><strong>' +
      escapeText(String(edge.flowKey ?? edge.edgeKey ?? t("config.uncoveredEdge", undefined, "uncovered edge"))) +
      '</strong><div class="hint">' +
      escapeText(String(edge.fromRoleId ?? "n/a") + " -> " + String(edge.toRoleId ?? "n/a")) +
      "</div></div>"
    ),
    "</div>"
  ].join("");
}

export function renderReviewDetailPanel(detail: Record<string, unknown> | null | undefined, t?: Translator, formatTime?: DateFormatter): string {
  const tr: Translator = typeof t === "function" ? t : (_key, _vars, fallback) => fallback ?? _key;
  const fmt: DateFormatter = typeof formatTime === "function" ? formatTime : (value) => String(value ?? tr("common.notAvailable", undefined, "n/a"));
  if (!detail) {
    return '<div class="hint">' + escapeText(tr("state.noReviewSelected", undefined, "No review selected.")) + '</div>';
  }
  const history = Array.isArray(detail.history) ? detail.history : [];
  const nextActionSummary =
    detail.currentStatus === "pending"
      ? tr("review.awaitingDecision", undefined, "Awaiting approve, rework, pause, or terminate.")
      : detail.decisionPhase === "recorded"
        ? tr("review.decisionRecorded", undefined, "Decision recorded; runtime reconcile should be inspected next.")
        : detail.decisionPhase === "pending_reconcile"
          ? tr("review.pendingReconcile", undefined, "Decision has checkpoint state but still blocks clean resume.")
          : tr("review.noImmediateAction", undefined, "No immediate action available.");
  const historyItems = history.map((entry) => {
    const record = (entry ?? {}) as JsonRecord;
    return '<div class="compact-list-item"><span class="compact-list-title">' +
      escapeText(String(record.decision ?? "history")) +
      '</span><span class="compact-list-meta">' +
      escapeText(fmt(record.decidedAt ?? record.committedAt)) +
      '</span><div class="hint">' +
      escapeText(String(record.actor ?? tr("common.unknown", undefined, "unknown")) + " · " + String(record.comment ?? tr("review.noComment", undefined, "no comment"))) +
      "</div></div>";
  });
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>' + escapeText(tr("review.review", undefined, "review")) + '</span><span>' + escapeText(detail.currentStatus ?? "unknown") + "</span></div><strong>" +
      escapeText(detail.reviewId ?? "n/a") +
      '</strong><div class="hint">' +
      escapeText((detail.roleId ?? "n/a") + " · " + (detail.branchId ?? "n/a")) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(tr("review.decision", undefined, "decision")) + '</span><span>' + escapeText(detail.decisionPhase ?? tr("common.none", undefined, "none")) + "</span></div><strong>" +
      escapeText(detail.decision ?? "pending") +
      '</strong><div class="hint">' +
      escapeText((detail.actor ?? "n/a") + " · " + (detail.comment ?? tr("review.noComment", undefined, "no comment"))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(tr("review.timing", undefined, "timing")) + '</span><span>' + escapeText(tr("review.round", { round: String(detail.round ?? "n/a") }, "round " + String(detail.round ?? "n/a"))) + '</span></div><strong>' +
      escapeText(tr("review.requestedAt", { at: fmt(detail.requestedAt) }, "requested " + fmt(detail.requestedAt))) +
      '</strong><div class="hint">' +
      escapeText(tr("review.decidedApplied", { decidedAt: fmt(detail.decidedAt), appliedAt: fmt(detail.appliedAt) }, "decided " + fmt(detail.decidedAt) + " · applied " + fmt(detail.appliedAt))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(tr("review.selectedEvent", undefined, "selected event")) + '</span><span>' + escapeText(detail.scope ?? "n/a") + '</span></div><strong>' +
      escapeText(detail.selectedEvent ?? "n/a") +
      '</strong><div class="hint">' +
      escapeText(tr("review.executionRequestedBy", {
        executionId: String(detail.executionId ?? "n/a"),
        requestedByExecutionId: String(detail.requestedByExecutionId ?? "n/a")
      }, "execution " + String(detail.executionId ?? "n/a") + " · requestedBy " + String(detail.requestedByExecutionId ?? "n/a"))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(tr("review.nextStep", undefined, "next step")) + '</span><span>' + escapeText(detail.branchStatus ?? "n/a") + '</span></div><strong>' +
      escapeText(nextActionSummary) +
      '</strong><div class="hint">' +
      escapeText(tr("review.selectedEventBranch", {
        event: String(detail.selectedEvent ?? "n/a"),
        branchId: String(detail.branchId ?? "n/a")
      }, "selected event " + String(detail.selectedEvent ?? "n/a") + " · branch " + String(detail.branchId ?? "n/a"))) +
      "</div></div>",
    renderSummaryListSection({
      title: tr("review.history", undefined, "history"),
      items: historyItems,
      emptyLabel: tr("review.noPriorDecisionHistory", undefined, "No prior decision history."),
      summaryLabel: tr("review.decisionTrail", undefined, "Decision trail"),
      hint: tr("review.round", { round: String(detail.round ?? "n/a") }, "round " + String(detail.round ?? "n/a")),
      open: history.length > 0 && history.length <= 2
    }),
    renderPreDisclosure({
      title: tr("review.requestSnapshot", undefined, "request snapshot"),
      headline: compactJsonPreview(detail.reviewRequestSnapshot ?? detail.requestSnapshot ?? detail.spec ?? null, 220) || tr("review.requestContext", undefined, "Review request context"),
      meta: tr("common.captured", undefined, "captured"),
      hint: tr("review.requestContext", undefined, "Review request context"),
      value: detail.reviewRequestSnapshot ?? detail.requestSnapshot ?? detail.spec ?? null,
      emptyTitle: tr("review.requestContext", undefined, "Review request context"),
      emptyMeta: tr("common.missing", undefined, "missing"),
      emptyHint: tr("review.requestContext", undefined, "Review request context")
    }),
    renderPreDisclosure({
      title: tr("review.decisionSnapshot", undefined, "decision snapshot"),
      headline: compactJsonPreview(detail.decisionSnapshot ?? {
        decision: detail.decision ?? null,
        actor: detail.actor ?? null,
        comment: detail.comment ?? null,
        decidedAt: detail.decidedAt ?? null,
        committedAt: detail.committedAt ?? null,
        checkpointSequence: detail.checkpointSequence ?? null,
        appliedAt: detail.appliedAt ?? null,
        reconciledAt: detail.reconciledAt ?? null
      }, 220) || tr("review.decisionDurabilitySnapshot", undefined, "Decision durability snapshot"),
      meta: tr("common.captured", undefined, "captured"),
      hint: tr("review.decisionDurabilitySnapshot", undefined, "Decision durability snapshot"),
      value: detail.decisionSnapshot ?? {
        decision: detail.decision ?? null,
        actor: detail.actor ?? null,
        comment: detail.comment ?? null,
        decidedAt: detail.decidedAt ?? null,
        committedAt: detail.committedAt ?? null,
        checkpointSequence: detail.checkpointSequence ?? null,
        appliedAt: detail.appliedAt ?? null,
        reconciledAt: detail.reconciledAt ?? null
      },
      emptyTitle: tr("review.decisionDurabilitySnapshot", undefined, "Decision durability snapshot"),
      emptyMeta: tr("common.missing", undefined, "missing"),
      emptyHint: tr("review.decisionDurabilitySnapshot", undefined, "Decision durability snapshot")
    }),
    renderPreDisclosure({
      title: tr("review.context", undefined, "context"),
      headline: compactJsonPreview(detail.humanReviewContext ?? null, 220) || tr("review.humanReviewContext", undefined, "Human review context"),
      meta: tr("common.snapshot", undefined, "snapshot"),
      hint: tr("review.humanReviewContext", undefined, "Human review context"),
      value: detail.humanReviewContext ?? null,
      emptyTitle: tr("review.humanReviewContext", undefined, "Human review context"),
      emptyMeta: tr("common.missing", undefined, "missing"),
      emptyHint: tr("review.humanReviewContext", undefined, "Human review context")
    }),
    "</div>"
  ].join("");
}

export function renderReviewQueuePanel(args: {
  reviews: Record<string, unknown> | null | undefined;
  selectedReviewId: string;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const reviewList = Array.isArray(args.reviews?.reviews) ? args.reviews?.reviews as JsonRecord[] : [];
  if (!reviewList.length) {
    return '<div class="hint">' + escapeText(t("review.noReviews", undefined, "No reviews for this run.")) + '</div>';
  }
  const statusCounts = reviewList.reduce<Record<string, number>>((counts, review) => {
    const key = String(review.currentStatus ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("review.queueSummary", undefined, "queue summary")) + '</span><span>' +
      escapeText(reviewList.length) +
      '</span></div><strong>' +
      escapeText(
        Object.entries(statusCounts)
          .map(([status, count]) => status.replace(/_/g, " ") + " " + count)
          .join(" · ")
      ) +
      "</strong></div>",
    ...reviewList.map((review) =>
      '<button class="run-card ' + (review.reviewId === args.selectedReviewId ? "active" : "") + '" data-review-id="' + escapeText(review.reviewId) + '">' +
      '<div class="run-title"><span class="truncate" title="' + escapeText(review.reviewId) + '"><code>' + escapeText(review.reviewId) + '</code></span>' +
      '<span class="status ' + escapeText(String(review.currentStatus ?? "unknown")) + '">' + escapeText(String(review.currentStatus ?? "unknown").replace(/_/g, " ")) + "</span></div>" +
      '<div class="meta">' +
      '<span>' + escapeText(String(review.roleId ?? "n/a")) + "</span>" +
      '<span>' + escapeText(t("review.round", { round: String(review.round ?? "n/a") }, "round " + String(review.round ?? "n/a"))) + "</span>" +
      '<span>' + escapeText(t("review.phase", { phase: String(review.decisionPhase ?? "none").replace(/_/g, " ") }, "phase " + String(review.decisionPhase ?? "none").replace(/_/g, " "))) + "</span>" +
      '<span>' + escapeText(String(review.actor ?? t("review.unassigned", undefined, "unassigned"))) + "</span>" +
      '<span>' + escapeText(String(review.reworkTarget ?? review.reworkRoleId ?? t("review.noReworkTarget", undefined, "no rework target"))) + "</span>" +
      "</div>" +
      (review.comment ? '<div class="hint">' + escapeText(String(review.comment)) + "</div>" : "") +
      "</button>"
    ),
    "</div>"
  ].join("");
}

export function renderResumeReadinessPanel(args: {
  readiness: Record<string, unknown> | null | undefined;
  loaded: boolean;
  stale: boolean;
  diagnostics: Record<string, unknown> | null | undefined;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  if (!args.loaded) {
    return '<div class="hint">' + escapeText(t("resume.loadsWithRun", undefined, "Resume readiness loads with the selected run.")) + '</div>';
  }
  if (!args.readiness) {
    return '<div class="hint">' + escapeText(t("resume.unavailable", undefined, "Resume readiness unavailable.")) + '</div>';
  }
  const blockers = Array.isArray(args.readiness.blockers)
    ? args.readiness.blockers as JsonRecord[]
    : Array.isArray(args.readiness.blockingIssues)
      ? args.readiness.blockingIssues as JsonRecord[]
      : Array.isArray(args.readiness.issues)
        ? args.readiness.issues as JsonRecord[]
        : [];
  const driftSources = Array.isArray(args.readiness.driftSources)
    ? args.readiness.driftSources as JsonRecord[]
    : Object.entries((args.readiness.driftBySource ?? {}) as JsonRecord).map(([source, value]) => ({
        source,
        detail: value,
        changed: Boolean(value),
        blocking: false,
        message: Array.isArray(value)
      ? value.length + " issue(s)"
          : typeof value === "object" && value !== null
            ? t("resume.detailsAvailable", undefined, "details available")
            : String(value)
      }));
  const checks = Array.isArray(args.diagnostics?.checks) ? args.diagnostics?.checks as JsonRecord[] : [];
  const canResume =
    typeof args.readiness.canResume === "boolean"
      ? args.readiness.canResume
      : args.readiness.status === "ready";
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("section.resumeReadiness", undefined, "Resume Readiness")) + '</span><span>' +
      escapeText(args.stale ? t("common.stale", undefined, "stale") : t("common.fresh", undefined, "fresh")) +
      '</span></div><strong>' +
      escapeText(canResume ? t("resume.canResume", undefined, "can resume") : t("resume.resumeBlocked", undefined, "resume blocked")) +
      '</strong><div class="hint">' +
      escapeText(t("resume.statusReason", {
        status: String(args.readiness.status ?? t("common.unknown", undefined, "unknown")),
        reason: String(args.readiness.reason ?? args.readiness.summary ?? "no summary")
      }, "status " + String(args.readiness.status ?? "unknown") + " · " + String(args.readiness.reason ?? args.readiness.summary ?? "no summary"))) +
      "</div></div>",
    ...(blockers.length
      ? blockers.map((blocker) =>
          '<div class="event"><div class="event-top"><span>' +
          escapeText(String(blocker.category ?? blocker.kind ?? blocker.code ?? blocker.id ?? "blocker")) +
          "</span><span>" +
          escapeText(String(blocker.blocking === false ? t("resume.nonBlocking", undefined, "non-blocking") : blocker.severity ?? t("resume.blocking", undefined, "blocking"))) +
          "</span></div><strong>" +
          escapeText(String(blocker.title ?? blocker.label ?? blocker.message ?? "resume blocker")) +
          '</strong><div class="hint">' +
          escapeText(String(blocker.source ?? "")) +
          (blocker.detail ? '<pre>' + escapeText(formatJson(blocker.detail)) + "</pre>" : "") +
          "</div></div>"
        )
      : ['<div class="event"><div class="event-top"><span>' + escapeText(t("resume.blockers", undefined, "blockers")) + '</span><span>0</span></div><strong>' + escapeText(t("resume.noBlockingIssues", undefined, "No blocking issues reported")) + '</strong></div>']),
    ...driftSources.map((drift) =>
      '<div class="event"><div class="event-top"><span>' + escapeText(t("resume.driftSource", undefined, "drift source")) + '</span><span>' +
      escapeText(String(drift.source ?? t("common.unknown", undefined, "unknown"))) +
      '</span></div><strong>' +
      escapeText(String(drift.message ?? (drift.changed ? t("common.changed", undefined, "changed") : t("common.unchanged", undefined, "unchanged")))) +
      '</strong><div class="hint">' +
      escapeText(String(drift.blocking ? t("resume.blocking", undefined, "blocking") : drift.changed ? t("common.changed", undefined, "changed") : t("common.stable", undefined, "stable"))) +
      '</div>' +
      (drift.detail ? '<pre>' + escapeText(formatJson(drift.detail)) + "</pre>" : "") +
      "</div>"
    ),
    ...(driftSources.length ? [] : [
      '<div class="event"><div class="event-top"><span>' + escapeText(t("resume.driftSource", undefined, "drift source")) + '</span><span>0</span></div><strong>' + escapeText(t("resume.noDriftSources", undefined, "No drift sources reported")) + '</strong></div>'
    ]),
    ...(checks.length
      ? checks.map((check) =>
          '<div class="event"><div class="event-top"><span>' + escapeText(t("resume.diagnosticCheck", undefined, "diagnostic check")) + '</span><span>' +
          escapeText(String(check.ok ? t("common.ok", undefined, "ok") : check.severity ?? "warn")) +
          '</span></div><strong>' +
          escapeText(String(check.label ?? check.id ?? "check")) +
          '</strong><div class="hint">' +
          escapeText(String(check.message ?? "")) +
          "</div></div>"
        )
      : ['<div class="hint">' + escapeText(t("resume.diagnosticsOnDemand", undefined, "Detailed resume diagnostics remain on-demand.")) + '</div>']),
    "</div>"
  ].join("");
}

export function renderLogsPanel(args: {
  loaded: boolean;
  stale: boolean;
  selectedRoleId: string;
  engine: unknown[];
  role: unknown[];
  t?: Translator;
  formatTime?: DateFormatter;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const formatTime: DateFormatter = typeof args.formatTime === "function" ? args.formatTime : (value) => String(value ?? t("common.notAvailable", undefined, "n/a"));
  if (!args.loaded) {
    return '<div class="hint">' + escapeText(t("logs.onDemandHint", undefined, "Logs load on demand. The default view combines engine and role traces without a role filter.")) + '</div>';
  }

  const timestampOf = (record: JsonRecord): string => String(record.at ?? record.timestamp ?? "");
  const combined = [
    ...args.engine.map((item) => ({ source: "engine", record: (item ?? {}) as JsonRecord })),
    ...args.role.map((item) => ({ source: String(((item ?? {}) as JsonRecord).roleId ?? args.selectedRoleId ?? "role"), record: (item ?? {}) as JsonRecord }))
  ].sort((left, right) => timestampOf(left.record).localeCompare(timestampOf(right.record)));

  const renderLogEntries = (label: string, records: unknown[]): string => {
    if (!records.length) {
      return (
        '<div class="event"><div class="event-top"><span>' +
        escapeText(label) +
        '</span><span>0</span></div><strong>' + escapeText(t("logs.noRecords", undefined, "no records")) + '</strong></div>'
      );
    }
    return [
      '<div class="event"><div class="event-top"><span>' + escapeText(label) + '</span><span>' + escapeText(records.length) + '</span></div><strong>' +
        escapeText(label === t("logs.roleLog", undefined, "role log") ? (args.selectedRoleId || t("logs.latestRole", undefined, "latest role")) : t("logs.engineStream", undefined, "engine stream")) +
        '</strong><div class="hint">' + escapeText(args.stale ? t("logs.stale", undefined, "stale since last stream event") : t("logs.fresh", undefined, "fresh")) + "</div></div>",
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
          escapeText(formatTime(record.at ?? record.timestamp)) +
          "</span></div><strong>" +
          escapeText(summary) +
          "</strong></div>"
        );
      })
    ].join("");
  };

  const renderCombinedEntries = (): string => {
    if (!combined.length) {
      return '<div class="event"><div class="event-top"><span>' + escapeText(t("logs.combinedStream", undefined, "combined log stream")) + '</span><span>0</span></div><strong>' + escapeText(t("logs.noRecords", undefined, "no records")) + '</strong></div>';
    }
    return [
      '<div class="event"><div class="event-top"><span>' + escapeText(t("logs.combinedStream", undefined, "combined log stream")) + '</span><span>' + escapeText(String(combined.length)) +
        '</span></div><strong>' + escapeText(args.selectedRoleId ? t("logs.enginePlusRole", { roleId: args.selectedRoleId }, "engine + " + args.selectedRoleId) : t("logs.engineAllRoles", undefined, "engine + all loaded roles")) +
        '</strong><div class="hint">' + escapeText(args.stale ? t("logs.stale", undefined, "stale since last stream event") : t("logs.fresh", undefined, "fresh")) + "</div></div>",
      ...combined.map((item) => {
        const record = item.record;
        const summary = typeof record.message === "string"
          ? record.message
          : typeof record.line === "string"
            ? record.line
            : formatJson(record);
        return (
          '<div class="event"><div class="event-top"><span>' +
          escapeText(item.source) +
          "</span><span>" +
          escapeText(formatTime(timestampOf(record))) +
          "</span></div><strong>" +
          escapeText(summary) +
          '</strong><div class="hint">' +
          escapeText(String(record.level ?? record.type ?? "log")) +
          "</div></div>"
        );
      })
    ].join("");
  };

  return [
    '<div class="structure-list">',
    renderCombinedEntries(),
    '<div class="log-stream-grid">',
    '<div class="structure-list">' + renderLogEntries(t("logs.engineLog", undefined, "engine log"), args.engine) + "</div>",
    '<div class="structure-list">' + renderLogEntries(args.selectedRoleId ? t("logs.roleLog", undefined, "role log") : t("logs.roleLogs", undefined, "role logs"), args.role) + "</div>",
    "</div>",
    "</div>"
  ].join("");
}

export function renderRunStatePanel(args: {
  state: unknown;
  header: JsonRecord | null | undefined;
  graph: JsonRecord | null | undefined;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const summarizeValue = (value: unknown): { label: string; detail?: string } => {
    if (Array.isArray(value)) {
      return {
        label: t("common.arrayItems", { count: value.length }, `array · ${value.length} item(s)`),
        detail: value.length ? formatJson(value) : undefined
      };
    }
    if (value && typeof value === "object") {
      const keys = Object.keys(value as JsonRecord);
      return {
        label: t("common.objectKeys", { count: keys.length }, `object · ${keys.length} key(s)`),
        detail: keys.length ? formatJson(value) : undefined
      };
    }
    if (typeof value === "boolean") {
      return { label: value ? "true" : "false" };
    }
    if (value === null || value === undefined || value === "") {
      return { label: t("common.empty", undefined, "empty") };
    }
    return { label: displayUiToken(value, t) };
  };
  const stateFieldLabel = (path: string): string => {
    const key = path.startsWith("state.") ? path.slice("state.".length) : path;
    return t("state.field." + key, undefined, key);
  };
  const statePathLabel = (path: string): string => {
    if (path === "state") {
      return t("artifacts.state", undefined, "State");
    }
    return t("artifacts.state", undefined, "State") + " / " + stateFieldLabel(path);
  };
  const renderValueCard = (path: string, value: unknown): string => {
    const summary = summarizeValue(value);
    const label = stateFieldLabel(path);
    const pathLabel = statePathLabel(path);
    const detailThreshold = Array.isArray(value) || (value && typeof value === "object");
    if (detailThreshold) {
      return renderDisclosureCard({
        title: label,
        headline: summary.label,
        meta: pathLabel,
        bodyHtml: summary.detail ? `<pre>${escapeText(summary.detail)}</pre>` : "",
        tone: /error|failure|audit/i.test(path) ? "warning" : undefined
      });
    }
    return (
      '<div class="event"><div class="event-top"><span>' +
      escapeText(label) +
      '</span><span data-field-path="' +
      escapeText(path) +
      '">' +
      escapeText(pathLabel) +
      "</span></div><strong>" +
      escapeText(summary.label) +
      "</strong>" +
      (summary.detail ? '<pre>' + escapeText(summary.detail) + "</pre>" : "") +
      "</div>"
    );
  };
  const renderStateGroup = (title: string, cards: string[], options?: {
    open?: boolean;
    tone?: "notice" | "warning" | "critical";
  }): string => {
    if (!cards.length) {
      return "";
    }
    return '<div class="state-group">' + renderDisclosureCard({
      title,
      headline: t("common.arrayItems", { count: cards.length }, `array · ${cards.length} item(s)`),
      meta: title,
      bodyHtml: '<div class="state-card-grid">' + cards.join("") + "</div>",
      open: options?.open,
      tone: options?.tone
    }) + "</div>";
  };
  const renderStructuredStateGroups = (value: unknown): string[] => {
    const record = value && typeof value === "object" && !Array.isArray(value)
      ? value as JsonRecord
      : undefined;
    if (!record) {
      return [renderValueCard("state", value)];
    }
    const keys = Object.keys(record);
    if (!keys.length) {
      return ['<div class="event"><div class="event-top"><span>' + escapeText(t("artifacts.state", undefined, "State")) + '</span><span>' + escapeText(t("common.empty", undefined, "empty")) + '</span></div><strong>' + escapeText(t("common.noFields", undefined, "no fields")) + '</strong></div>'];
    }
    const executionKeys = new Set(["status", "mode", "runMode", "transitionCount", "totalTransitions", "okCount", "failedCount", "noopCount", "lastExecutedRoleId", "finalRoleId", "currentRoleId", "nextRoleId"]);
    const branchReviewKeys = new Set(["activeBranches", "completedBranches", "branches", "branchStatuses", "pendingReviewCount", "reviews", "review", "humanReviews"]);
    const controlKeys = new Set(["stopRequest", "stopOutcome", "metrics", "artifacts", "errors", "error", "failure", "auditSummary"]);
    const executionCards: string[] = [];
    const branchReviewCards: string[] = [];
    const controlCards: string[] = [];
    const additionalCards: string[] = [];
    for (const key of keys) {
      const card = renderValueCard("state." + key, record[key]);
      if (executionKeys.has(key)) {
        executionCards.push(card);
      } else if (branchReviewKeys.has(key)) {
        branchReviewCards.push(card);
      } else if (controlKeys.has(key)) {
        controlCards.push(card);
      } else {
        additionalCards.push(card);
      }
    }
    return [
      renderStateGroup(t("state.executionState", undefined, "execution state"), executionCards, {
        open: true,
        tone: "notice"
      }),
      renderStateGroup(t("state.branchReviewState", undefined, "branch and review state"), branchReviewCards, {
        tone: branchReviewCards.length ? "warning" : undefined
      }),
      renderStateGroup(t("state.controlState", undefined, "control and artifact state"), controlCards, {
        tone: controlCards.length ? "critical" : undefined
      }),
      renderStateGroup(t("state.additionalState", undefined, "additional state"), additionalCards)
    ].filter(Boolean);
  };
  const renderRoleIoCell = (value: unknown, emptyLabel: string): string => {
    if (value === null || value === undefined || value === "") {
      return '<div class="hint">' + escapeText(emptyLabel) + '</div>';
    }
    const raw = typeof value === "string" ? value : formatJson(value);
    const summary = compactText(raw, 140) || emptyLabel;
    const detail = raw.length > 160 || raw.includes("\n");
    return '<div class="run-role-cell-summary">' + escapeText(summary) + '</div>' + (
      detail
        ? '<details><summary>' + escapeText(t("common.details", undefined, "details")) + '</summary><pre>' + escapeText(raw) + "</pre></details>"
        : ""
    );
  };
  const collectRoleIoRows = (): Array<{
    roleId: string;
    status: string;
    input?: unknown;
    output?: unknown;
    meta: string[];
  }> => {
    const rows = new Map<string, {
      roleId: string;
      status: string;
      input?: unknown;
      output?: unknown;
      meta: string[];
    }>();
    const ensureRow = (roleId: string) => {
      const normalizedRoleId = normalizeStudioTargetRoleId(roleId);
      if (!normalizedRoleId || normalizedRoleId === "input" || normalizedRoleId === "output") {
        return null;
      }
      let row = rows.get(normalizedRoleId);
      if (!row) {
        row = { roleId: normalizedRoleId, status: t("common.unknown", undefined, "unknown"), meta: [] };
        rows.set(normalizedRoleId, row);
      }
      return row;
    };
    const ingestRoleRecord = (recordValue: unknown, fallbackRoleId?: string, sourceLabel?: string) => {
      const record = asRecord(recordValue);
      const row = ensureRow(String(record?.roleId ?? record?.currentRoleId ?? record?.lastExecutedRoleId ?? fallbackRoleId ?? ""));
      if (!row) {
        return;
      }
      const status = record?.status ?? record?.currentStatus ?? record?.branchStatus ?? record?.decisionPhase ?? record?.reviewStatus;
      if (status) {
        row.status = String(status);
      }
      const inputValue = record?.input ?? record?.inputContext ?? record?.request ?? record?.payload ?? record?.prompt ?? record?.userInput;
      const outputValue = record?.output ?? record?.lastOutput ?? record?.rawOutput ?? record?.result ?? record?.response ?? record?.decisionSnapshot;
      if (row.input === undefined && inputValue !== undefined) {
        row.input = inputValue;
      }
      if (row.output === undefined && outputValue !== undefined) {
        row.output = outputValue;
      }
      const metaParts = [
        record?.branchId,
        record?.reviewId,
        record?.event,
        record?.summary,
        sourceLabel
      ].filter(Boolean).map((item) => compactText(item, 40)).filter(Boolean);
      for (const item of metaParts) {
        if (!row.meta.includes(item)) {
          row.meta.push(item);
        }
      }
    };
    const ingestRoleRecordMap = (collection: unknown, sourceLabel: string) => {
      if (Array.isArray(collection)) {
        for (const item of collection) {
          ingestRoleRecord(item, undefined, sourceLabel);
        }
        return;
      }
      const record = asRecord(collection);
      if (!record) {
        return;
      }
      for (const [key, value] of Object.entries(record)) {
        ingestRoleRecord(value, key, sourceLabel);
      }
    };
    const graphRecord = asRecord(args.graph);
    for (const node of asRecordArray(graphRecord?.nodes)) {
      ensureRow(String(node.roleId ?? node.id ?? ""));
    }
    ingestRoleRecordMap(stateRecord.roleResults, t("state.field.roleResults", undefined, "role results"));
    ingestRoleRecordMap(stateRecord.activeBranches, t("state.field.activeBranches", undefined, "active branches"));
    ingestRoleRecordMap(stateRecord.completedBranches, t("state.field.completedBranches", undefined, "completed branches"));
    ingestRoleRecordMap(stateRecord.branches, t("state.field.branches", undefined, "branches"));
    ingestRoleRecordMap(stateRecord.pendingReviewsById, t("state.field.pendingReviewsById", undefined, "pending reviews by id"));
    ingestRoleRecordMap(stateRecord.humanReviewContextByBranchId, t("state.field.humanReviewContextByBranchId", undefined, "human review context by branch"));
    const lastOutputRecord = asRecord(stateRecord.lastOutput);
    if (lastOutputRecord) {
      for (const [roleId, value] of Object.entries(lastOutputRecord)) {
        const row = ensureRow(roleId);
        if (row && row.output === undefined) {
          row.output = value;
          if (!row.meta.includes(t("state.field.lastOutput", undefined, "last output"))) {
            row.meta.push(t("state.field.lastOutput", undefined, "last output"));
          }
        }
      }
    } else if (stateRecord.lastOutput !== undefined) {
      const row = ensureRow(String(header.lastExecutedRoleId ?? stateRecord.currentRoleId ?? ""));
      if (row && row.output === undefined) {
        row.output = stateRecord.lastOutput;
      }
    }
    const lastRoleRow = ensureRow(String(header.lastExecutedRoleId ?? stateRecord.currentRoleId ?? ""));
    if (lastRoleRow && lastRoleRow.meta.length === 0) {
      lastRoleRow.meta.push(t("state.field.lastExecutedRoleId", undefined, "last executed role"));
    }
    return Array.from(rows.values()).sort((left, right) => left.roleId.localeCompare(right.roleId));
  };
  if (args.state === null || args.state === undefined) {
    return '<div class="hint">' + escapeText(t("state.runtimeStateUnavailable", undefined, "Runtime state unavailable.")) + '</div>';
  }
  const header = args.header ?? {};
  const graph = args.graph ?? {};
  const graphNodes = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
  const graphEdges = Array.isArray(graph.edges) ? graph.edges.length : 0;
  const stateRecord = asRecord(args.state) ?? {};
  const activeRoles = asRecordCollection(stateRecord.activeBranches)
    .map((branch) => compactText(branch.roleId ?? branch.currentRoleId ?? branch.branchId ?? "", 72))
    .filter(Boolean)
    .slice(0, 6)
    .map((label) => `<div class="compact-list-item"><span class="compact-list-title">${escapeText(label)}</span></div>`);
  const pendingReviews = asRecordCollection(stateRecord.pendingReviewsById ?? stateRecord.humanReviewContextByBranchId)
    .slice(0, 6)
    .map((review) => `<div class="compact-list-item"><span class="compact-list-title">${escapeText(String(review.reviewId ?? review.branchId ?? review.roleId ?? "review"))}</span><span class="compact-list-meta">${escapeText(displayUiToken(review.currentStatus ?? review.status ?? "pending", t))}</span></div>`);
  const auditSummaryRecord = asRecord(stateRecord.auditSummary);
  const auditSummaryIssues = auditSummaryRecord
    ? Object.entries(asRecord(auditSummaryRecord.failureCountsByErrorCode) ?? {})
      .filter(([, count]) => Number(count) > 0)
      .map(([errorCode, count]) => ({
        errorCode,
        summary: `count ${String(count)}`
      }))
    : [];
  const errors = asRecordCollection(stateRecord.errors ?? stateRecord.failure ?? stateRecord.errorEnvelope ?? stateRecord.error)
    .concat(auditSummaryIssues)
    .slice(0, 6)
    .map((entry) => `<div class="compact-list-item"><span class="compact-list-title">${escapeText(String(entry.errorCode ?? entry.code ?? entry.kind ?? "issue"))}</span><div class="hint">${escapeText(compactText(entry.message ?? entry.summary ?? entry.roleId ?? "", 120))}</div></div>`);
  const roleIoRows = collectRoleIoRows();
  const roleIoMatrixHtml = roleIoRows.length
    ? '<div class="run-role-matrix"><div class="run-role-matrix-head"><div class="run-role-cell">' + escapeText(t("state.roleColumn", undefined, "role")) + '</div><div class="run-role-cell">' + escapeText(t("state.statusColumn", undefined, "status")) + '</div><div class="run-role-cell">' + escapeText(t("state.inputColumn", undefined, "input")) + '</div><div class="run-role-cell">' + escapeText(t("state.outputColumn", undefined, "output")) + '</div></div>' +
      roleIoRows.map((row) => '<div class="run-role-matrix-row"><div class="run-role-cell"><strong><code>' + escapeText(row.roleId) + '</code></strong>' + (row.meta.length ? '<div class="hint">' + escapeText(row.meta.join(" · ")) + '</div>' : "") + '</div><div class="run-role-cell"><span class="status ' + escapeText(String(row.status || "unknown").toLowerCase().replace(/\s+/g, "_")) + '">' + escapeText(displayUiToken(row.status || "unknown", t)) + '</span></div><div class="run-role-cell">' + renderRoleIoCell(row.input, t("state.noInputSnapshot", undefined, "No input snapshot")) + '</div><div class="run-role-cell">' + renderRoleIoCell(row.output, t("state.noOutputSnapshot", undefined, "No output snapshot")) + '</div></div>').join("") +
      '</div>'
    : '<div class="hint">' + escapeText(t("state.noRoleSnapshots", undefined, "No per-role input or output snapshots captured for this run.")) + '</div>';
  return [
    '<div class="state-panel">',
    '<div class="state-card-grid state-card-grid-primary">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("state.runtime", undefined, "runtime")) + '</span><span>' + escapeText(displayUiToken(header.status ?? t("common.unknown", undefined, "unknown"), t)) + "</span></div><strong>" +
      escapeText(displayUiToken((args.state as JsonRecord | undefined)?.status ?? header.status ?? t("state.stateAvailable", undefined, "state available"), t)) +
      '</strong><div class="hint">' + escapeText(t("state.activePending", {
        activeBranches: String(header.activeBranches ?? 0),
        pendingReviews: String(header.pendingReviewCount ?? 0)
      }, "active branches " + String(header.activeBranches ?? 0) + " · pending reviews " + String(header.pendingReviewCount ?? 0))) + "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("state.graphSnapshot", undefined, "graph snapshot")) + '</span><span>' + escapeText(graphNodes) + " " + escapeText(t("common.nodes", undefined, "nodes")) + '</span></div><strong>' +
      escapeText(t("state.flowsCount", { count: graphEdges }, `flows ${graphEdges}`)) +
      '</strong><div class="hint">' + escapeText(t("state.lastFinalRole", {
        lastRoleId: String(header.lastExecutedRoleId ?? t("common.notAvailable", undefined, "n/a")),
        finalRoleId: String(header.finalRoleId ?? t("common.notAvailable", undefined, "n/a"))
      }, "last role " + String(header.lastExecutedRoleId ?? "n/a") + " · final role " + String(header.finalRoleId ?? "n/a"))) + "</div></div>",
    "</div>",
    '<div class="run-graph-summary-grid run-graph-summary-rail">',
    renderSummaryListSection({
      title: t("graph.summaryRail", undefined, "key signals"),
      items: activeRoles,
      emptyLabel: t("common.none", undefined, "none"),
      summaryLabel: t("state.activePending", {
        activeBranches: String(header.activeBranches ?? 0),
        pendingReviews: String(header.pendingReviewCount ?? 0)
      }, "active branches " + String(header.activeBranches ?? 0) + " · pending reviews " + String(header.pendingReviewCount ?? 0)),
      hint: t("graph.focusOnKeySignals", undefined, "Key signals stay visible here; payloads and audit details are folded by default."),
      open: true,
      tone: "notice"
    }),
    renderSummaryListSection({
      title: t("review.queueSummary", undefined, "queue summary"),
      items: pendingReviews,
      emptyLabel: t("review.noReviews", undefined, "No reviews for this run."),
      summaryLabel: t("status.waitingReview", undefined, "waiting review"),
      hint: t("review.awaitingDecision", undefined, "Awaiting approve, rework, pause, or terminate."),
      open: pendingReviews.length > 0,
      tone: "warning"
    }),
    renderSummaryListSection({
      title: t("state.field.errors", undefined, "errors"),
      items: errors,
      emptyLabel: t("failure.noRecentCaptured", undefined, "No recent failure captured for this run."),
      summaryLabel: t("failure.nextChecksSummary", undefined, "Move directly to the likely root-cause surfaces"),
      hint: t("failure.nextChecksHint", undefined, "These actions jump to the panel that explains the failing input, binding, schema, contract, or resume blockers."),
      open: errors.length > 0,
      tone: "critical"
    }),
    "</div>",
    renderDisclosureCard({
      title: t("state.roleIoMatrix", undefined, "role input / output"),
      headline: t("state.roleIoSummary", { count: String(roleIoRows.length) }, String(roleIoRows.length) + " role snapshot(s)"),
      meta: t("state.graphSnapshot", undefined, "graph snapshot"),
      hint: t("state.roleIoHint", undefined, "Each row keeps the most useful captured input and output signal for a role, with details folded inside the cell."),
      bodyHtml: roleIoMatrixHtml,
      open: true,
      tone: "notice"
    }),
    ...renderStructuredStateGroups(args.state),
    "</div>"
  ].join("");
}

export function renderArtifactsPanel(args: {
  detail: Record<string, unknown> | null | undefined;
  graph: Record<string, unknown> | null | undefined;
  reviews: Record<string, unknown> | null | undefined;
  reviewDetail: Record<string, unknown> | null | undefined;
  resumeDiagnostics: Record<string, unknown> | null | undefined;
  t?: Translator;
  formatTime?: DateFormatter;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const formatTime: DateFormatter = typeof args.formatTime === "function" ? args.formatTime : (value) => String(value ?? t("common.notAvailable", undefined, "n/a"));
  const summarizeValue = (value: unknown): { label: string; detail?: string } => {
    if (Array.isArray(value)) {
      return {
        label: t("common.arrayItems", { count: value.length }, `array · ${value.length} item(s)`),
        detail: value.length ? formatJson(value) : undefined
      };
    }
    if (value && typeof value === "object") {
      const keys = Object.keys(value as JsonRecord);
      return {
        label: t("common.objectKeys", { count: keys.length }, `object · ${keys.length} key(s)`),
        detail: keys.length ? formatJson(value) : undefined
      };
    }
    if (typeof value === "boolean") {
      return { label: value ? "true" : "false" };
    }
    if (value === null || value === undefined || value === "") {
      return { label: t("common.empty", undefined, "empty") };
    }
    return { label: displayUiToken(value, t) };
  };
  const renderStructuredValueCards = (title: string, value: unknown): string[] => {
    const titleLabel = (name: string): string => {
      if (name === "metrics") return t("artifacts.metrics", undefined, "Metrics");
      if (name === "state") return t("artifacts.state", undefined, "State");
      if (name === "stopRequest") return t("state.field.stopRequest", undefined, "stop request");
      if (name === "stopOutcome") return t("state.field.stopOutcome", undefined, "stop outcome");
      if (name === "summary") return t("artifacts.summary", undefined, "Summary");
      if (name === "resolvedConfig") return t("artifacts.resolvedConfig", undefined, "Resolved config");
      return name;
    };
    const fieldLabel = (key: string): string => t("state.field." + key, undefined, key);
    const fieldPathLabel = (titleName: string, key: string): string => titleLabel(titleName) + " / " + fieldLabel(key);
    const record = value && typeof value === "object" && !Array.isArray(value)
      ? value as JsonRecord
      : undefined;
    if (!record) {
      const summary = summarizeValue(value);
      if (summary.detail) {
        return [
          renderDisclosureCard({
            title: titleLabel(title),
            headline: summary.label,
            meta: titleLabel(title),
            bodyHtml: `<pre>${escapeText(summary.detail)}</pre>`
          })
        ];
      }
      return [
        '<div class="event"><div class="event-top"><span>' + escapeText(titleLabel(title)) + '</span><span data-field-path="' + escapeText(title) + '">' + escapeText(titleLabel(title)) + '</span></div><strong>' +
        escapeText(summary.label) +
        '</strong></div>'
      ];
    }
    const keys = Object.keys(record);
    if (!keys.length) {
      return [
        '<div class="event"><div class="event-top"><span>' + escapeText(titleLabel(title)) + '</span><span>' + escapeText(t("common.empty", undefined, "empty")) + '</span></div><strong>' + escapeText(t("common.noFields", undefined, "no fields")) + '</strong></div>'
      ];
    }
    return keys.map((key) => {
      const summary = summarizeValue(record[key]);
      if (summary.detail) {
        return renderDisclosureCard({
          title: fieldLabel(key),
          headline: summary.label,
          meta: fieldPathLabel(title, key),
          bodyHtml: `<pre>${escapeText(summary.detail)}</pre>`,
          tone: /audit|error|failure/i.test(key) ? "warning" : undefined
        });
      }
      return (
        '<div class="event"><div class="event-top"><span>' +
        escapeText(fieldLabel(key)) +
        '</span><span data-field-path="' +
        escapeText(`${title}.${key}`) +
        '">' +
        escapeText(fieldPathLabel(title, key)) +
        "</span></div><strong>" +
        escapeText(summary.label) +
        "</strong>" +
        (summary.detail ? '<pre>' + escapeText(summary.detail) + "</pre>" : "") +
        "</div>"
      );
    });
  };
  if (!args.detail) {
    return '<div class="hint">' + escapeText(t("state.noRunSelected", undefined, "No run selected.")) + '</div>';
  }
  const header = (args.detail.header ?? {}) as JsonRecord;
  const snapshotManifest = args.detail.snapshotManifest && typeof args.detail.snapshotManifest === "object" && !Array.isArray(args.detail.snapshotManifest)
    ? args.detail.snapshotManifest as JsonRecord
    : null;
  const snapshotSource = snapshotManifest?.source && typeof snapshotManifest.source === "object" && !Array.isArray(snapshotManifest.source)
    ? snapshotManifest.source as JsonRecord
    : null;
  const snapshotStatus = String(snapshotManifest?.status ?? "missing");
  const snapshotTitle = snapshotStatus === "ok"
    ? t("artifacts.snapshotOkTitle", undefined, "Run snapshot manifest is consistent")
    : snapshotStatus === "hash_mismatch"
      ? t("artifacts.snapshotHashMismatchTitle", undefined, "Snapshot hash differs from run artifact")
      : t("artifacts.snapshotMissingTitle", undefined, "Snapshot manifest unavailable");
  const snapshotHint = snapshotStatus === "ok"
    ? t("artifacts.snapshotOkHint", undefined, "Operate uses run artifact system.mmd as the historical source and the manifest as summary metadata.")
    : String(snapshotManifest?.warning ?? t("artifacts.snapshotMissingHint", undefined, "Run artifact system.mmd remains the historical source for this run."));
  const reviewList = Array.isArray(args.reviews?.reviews) ? args.reviews.reviews as unknown[] : [];
  const graph = (args.graph?.graph ?? args.graph ?? {}) as JsonRecord;
  const graphNodes = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
  const graphEdges = Array.isArray(graph.edges) ? graph.edges.length : 0;
  const runIdLabel = String(args.detail.runId ?? "n/a");
  const runDirLabel = String(args.detail.runDir ?? "n/a");
  const artifactSummaryItems = [
    '<div class="compact-list-item"><span class="compact-list-title">' + escapeText(runIdLabel) + '</span><span class="compact-list-meta">' + escapeText(String(header.status ?? t("common.unknown", undefined, "unknown"))) + "</span></div>",
    '<div class="compact-list-item"><span class="compact-list-title">' + escapeText(t("artifacts.graphCounts", {
      nodes: String(graphNodes),
      edges: String(graphEdges)
    }, "graph " + graphNodes + " " + t("common.nodes", undefined, "nodes") + " / " + graphEdges + " " + t("common.edges", undefined, "edges"))) + '</span></div>',
    '<div class="compact-list-item"><span class="compact-list-title">' + escapeText(t("artifacts.selectedReview", undefined, "selected review")) + '</span><span class="compact-list-meta">' + escapeText(String(args.reviewDetail?.reviewId ?? t("common.none", undefined, "none"))) + "</span></div>"
  ];
  const sections = [
    '<div class="artifact-tabs"><span class="pill">' + escapeText(t("artifacts.summary", undefined, "Summary")) + '</span><span class="pill">' + escapeText(t("artifacts.metrics", undefined, "Metrics")) + '</span><span class="pill">' + escapeText(t("artifacts.state", undefined, "State")) + '</span><span class="pill">' + escapeText(t("artifacts.audit", undefined, "Audit")) + '</span><span class="pill">' + escapeText(t("artifacts.timeline", undefined, "Timeline")) + '</span><span class="pill">' + escapeText(t("artifacts.raw", undefined, "Raw")) + '</span></div>',
    renderSummaryListSection({
      title: t("artifacts.summary", undefined, "Summary"),
      items: artifactSummaryItems,
      emptyLabel: t("state.noRunSelected", undefined, "No run selected."),
      summaryLabel: runIdLabel,
      hint: runDirLabel + " · " + t("run.updatedAt", { at: formatTime(header.updatedAt) }, "updated " + formatTime(header.updatedAt)),
      open: true,
      tone: "notice"
    }),
    '<div class="artifact-section"><div class="event"><div class="event-top"><span>' + escapeText(t("artifacts.summary", undefined, "Summary")) + '</span><span>' + escapeText(header.status ?? t("common.unknown", undefined, "unknown")) +
      "</span></div><strong>" + escapeText(runIdLabel) +
      '</strong><div class="hint">' + escapeText(runDirLabel + " · " + t("run.updatedAt", { at: formatTime(header.updatedAt) }, "updated " + formatTime(header.updatedAt))) + "</div></div>" +
      '<div class="event"><div class="event-top"><span>' + escapeText(t("artifacts.artifactMap", undefined, "artifact map")) + '</span><span>' + escapeText(reviewList.length) +
      " " + escapeText(t("common.reviews", undefined, "reviews")) + '</span></div><strong>' + escapeText(t("artifacts.graphCounts", {
        nodes: String(graphNodes),
        edges: String(graphEdges)
      }, "graph " + graphNodes + " " + t("common.nodes", undefined, "nodes") + " / " + graphEdges + " " + t("common.edges", undefined, "edges"))) +
      '</strong><div class="hint">' + escapeText(t("artifacts.resumeDiagnostics", undefined, "resume diagnostics")) + " " + escapeText(args.resumeDiagnostics ? t("common.loaded", undefined, "loaded") : t("common.lazy", undefined, "lazy")) + " · " + escapeText(t("artifacts.selectedReview", undefined, "selected review")) + " " +
      escapeText(args.reviewDetail?.reviewId ?? t("common.none", undefined, "none")) + "</div></div></div>",
    '<div class="artifact-section"><div class="event"><div class="event-top"><span>' + escapeText(t("artifacts.snapshotManifest", undefined, "snapshot manifest")) + '</span><span>' + escapeText(displayUiToken(snapshotStatus, t)) + '</span></div><strong>' +
      escapeText(snapshotTitle) + '</strong><div class="hint">' + escapeText(snapshotHint) + '</div></div>' +
      '<div class="event"><div class="event-top"><span>snapshotId</span><span>' + escapeText(snapshotManifest?.snapshotId ?? args.detail.runId ?? "n/a") + '</span></div><strong>' +
      escapeText(String(snapshotSource?.sourceHash ?? t("common.notAvailable", undefined, "n/a"))) +
      '</strong><div class="hint">' + escapeText("system.mmd · " + t("artifacts.historicalTruth", undefined, "run artifact is historical truth")) + "</div></div></div>",
    '<div class="artifact-section"><div class="event"><div class="event-top"><span>' + escapeText(t("artifacts.metrics", undefined, "Metrics")) + '</span><span>' + escapeText(t("common.snapshot", undefined, "snapshot")) + '</span></div><strong>' + escapeText(t("artifacts.runMetrics", undefined, "Run metrics")) + '</strong></div>' +
      renderStructuredValueCards("metrics", args.detail.metrics ?? null).join("") + "</div>",
    '<div class="artifact-section"><div class="event"><div class="event-top"><span>' + escapeText(t("artifacts.state", undefined, "State")) + '</span><span>' + escapeText(t("common.snapshot", undefined, "snapshot")) + '</span></div><strong>' + escapeText(t("artifacts.runtimeStateStopControls", undefined, "Runtime state and stop controls")) + '</strong></div>' +
      renderStructuredValueCards("state", args.detail.state ?? null).join("") +
      renderStructuredValueCards("stopRequest", args.detail.stopRequest ?? null).join("") +
      renderStructuredValueCards("stopOutcome", args.detail.stopOutcome ?? null).join("") + "</div>",
    '<div class="artifact-section artifact-section-collapsed"><div class="event"><div class="event-top"><span>' + escapeText(t("artifacts.raw", undefined, "Raw")) + '</span><span>' + escapeText(t("common.fallback", undefined, "fallback")) + '</span></div><strong>' + escapeText(t("artifacts.resolvedConfigSummary", undefined, "Resolved config and summary payloads")) + '</strong><div class="hint">' + escapeText(t("graph.overlayHint", undefined, "Recent paths and error flows stay highlighted without hiding the rest of the graph.")) + '</div></div>' +
      renderStructuredValueCards("summary", args.detail.summary ?? null).join("") +
      renderStructuredValueCards("resolvedConfig", args.detail.resolvedConfig ?? null).join("") + "</div>"
  ];
  return [
    '<div class="structure-list">',
    ...sections,
    "</div>"
  ].join("");
}

export function renderRunTopologySvg(graph: Record<string, unknown> | null | undefined, t?: Translator): string {
  const tr: Translator = typeof t === "function" ? t : (_key, _vars, fallback) => fallback ?? _key;
  const labelToken = (value: unknown): string => displayUiToken(value, tr);
  if (!graph) {
    return '<div class="hint">' + escapeText(tr("graph.projectionUnavailable", undefined, "Graph projection unavailable.")) + '</div>';
  }
  const nodes = Array.isArray(graph.nodes) ? graph.nodes as JsonRecord[] : [];
  const edges = Array.isArray(graph.edges) ? graph.edges as JsonRecord[] : [];
  if (!nodes.length) {
    return '<div class="hint">' + escapeText(tr("graph.noNodes", undefined, "No graph nodes available.")) + '</div>';
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
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const roleId = queue[queueIndex] ?? "";
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
  if (indegree.has("input")) {
    levels.set("input", 0);
  }
  if (indegree.has("output")) {
    levels.set("output", Math.max(1, ...levels.values(), 0) + 1);
  }
  if (indegree.has("__system_end__")) {
    levels.set("__system_end__", Math.max(1, ...levels.values(), 0) + 1);
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
    const sourceRoleId = String(edge.sourceRoleId ?? "");
    const targetRoleId = String(edge.targetRoleId ?? "");
    const event = String(edge.event ?? "");
    const edgeState = edge.isErrorFlow
      ? tr("graph.edgeErrorFlow", undefined, "error flow")
      : edge.recentlyActivated
        ? tr("graph.edgeRecentlyActivated", undefined, "recently activated flow")
        : tr("graph.edgeStandardFlow", undefined, "standard flow");
    const edgeDescription = sourceRoleId + " to " + targetRoleId + " on " + (event || tr("common.unknown", undefined, "unknown")) + ": " + edgeState;
    return (
      '<g>' +
      '<title>' + escapeText(edgeDescription) + '</title>' +
      '<desc>' + escapeText(edgeDescription) + '</desc>' +
      '<path d="M ' + x1 + " " + y1 + " C " + midX + " " + y1 + ", " + midX + " " + y2 + ", " + x2 + " " + y2 +
      '" fill="none" stroke="' + stroke + '" stroke-width="3" stroke-dasharray="' + (edge.isErrorFlow ? "8 5" : edge.recentlyActivated ? "2 6" : "none") + '" marker-end="url(#run-arrow)" />' +
      '<text x="' + midX + '" y="' + (Math.min(y1, y2) + Math.abs(y2 - y1) / 2 - 8) + '" text-anchor="middle" fill="#8fa1c3" font-size="11" font-family="IBM Plex Mono, monospace">' +
      escapeText((event || "") + (edge.isErrorFlow ? " !" : edge.recentlyActivated ? " *" : "")) +
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
    const nodeStatus = labelToken(node.status ?? "idle");
    const nodeType = labelToken(node.nodeType ?? "role");
    const activePending = tr("state.activePending", {
      activeBranches: String(node.activeBranchCount ?? 0),
      pendingReviews: String(node.pendingReviewCount ?? 0)
    }, "active branches " + String(node.activeBranchCount ?? 0) + " · pending reviews " + String(node.pendingReviewCount ?? 0));
    const nodeDetail = String(node.lastSelectedEvent ?? node.lastErrorCode ?? node.joinMode ?? "steady");
    const nodeDescription = roleId + ": " + nodeType + ", " + nodeStatus + ", " + activePending + ", " + nodeDetail;
    return (
      '<g>' +
      '<title>' + escapeText(nodeDescription) + '</title>' +
      '<desc>' + escapeText(nodeDescription) + '</desc>' +
      '<rect x="' + position.x + '" y="' + position.y + '" width="' + nodeWidth + '" height="' + nodeHeight + '" rx="22" ry="22" fill="' + tone.fill + '" stroke="' + tone.stroke + '" stroke-width="2" />' +
      '<circle cx="' + (position.x + 20) + '" cy="' + (position.y + 22) + '" r="7" fill="' + badge + '" />' +
      '<text x="' + (position.x + 34) + '" y="' + (position.y + 27) + '" fill="' + tone.text + '" font-size="15" font-family="IBM Plex Sans, sans-serif">' + escapeText(roleId) + '</text>' +
      '<text x="' + (position.x + 20) + '" y="' + (position.y + 54) + '" fill="#8fa1c3" font-size="12" font-family="IBM Plex Sans, sans-serif">' +
      escapeText(nodeType + " · " + nodeStatus) +
      '</text>' +
      '<text x="' + (position.x + 20) + '" y="' + (position.y + 76) + '" fill="#dce7f7" font-size="12" font-family="IBM Plex Sans, sans-serif">' +
      escapeText(activePending) +
      '</text>' +
      '<text x="' + (position.x + 20) + '" y="' + (position.y + 96) + '" fill="#8fa1c3" font-size="11" font-family="IBM Plex Mono, monospace">' +
      escapeText(nodeDetail) +
      "</text></g>"
    );
  }).join("");

  return (
    '<div class="preview">' +
    '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="Run topology graph">' +
    '<title>' + escapeText(tr("graph.runTopologyTitle", undefined, "Run topology graph")) + '</title>' +
    '<desc>' + escapeText(tr("graph.runTopologyDescription", {
      nodes: String(nodes.length),
      edges: String(edges.length)
    }, "Run topology graph with " + String(nodes.length) + " nodes and " + String(edges.length) + " edges.")) + '</desc>' +
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
  const terminalNodes: JsonRecord[] = [
    {
      roleId: "input",
      bindingKind: "terminal",
      nodeType: "boundary"
    },
    {
      roleId: "output",
      bindingKind: "terminal",
      nodeType: "boundary"
    }
  ];
  knownRoleIds.add("input");
  knownRoleIds.add("output");
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
  const previewFlows = flows.map((flow) => ({
    sourceRoleId: flow.fromRoleId,
    targetRoleId: flow.toRoleId,
    event: flow.eventType,
    isErrorFlow: false,
    recentlyActivated: false
  }));
  const hasInputEdge = previewFlows.some((flow) => String(flow.sourceRoleId ?? "") === "input");
  if (!hasInputEdge && structure.entryRoleId) {
    previewFlows.unshift({
      sourceRoleId: "input",
      targetRoleId: structure.entryRoleId,
      event: "START",
      isErrorFlow: false,
      recentlyActivated: false
    });
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
    edges: previewFlows
  }).replace("Run topology graph", "Graph workspace topology");
}
