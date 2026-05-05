type Translator = (key: string, vars?: Record<string, unknown>, fallback?: string) => string;

function getOperatePanelId(operateTab: string): string {
  switch (operateTab) {
    case "graph":
      return "operate-tabpanel-graph";
    case "recovery":
      return "operate-tabpanel-recovery";
    case "reviews":
      return "operate-tabpanel-reviews";
    case "logs":
      return "console-panel-logs";
    case "artifacts":
      return "console-panel-artifacts";
    default:
      return "operate-tabpanel-overview";
  }
}

function getLegacyPanelId(legacyConsoleTab: string): string {
  switch (legacyConsoleTab) {
    case "project":
      return "console-panel-project";
    case "ops":
      return "console-panel-ops";
    case "config":
      return "console-panel-config";
    case "logs":
      return "console-panel-logs";
    case "artifacts":
      return "console-panel-artifacts";
    default:
      return "console-panel-debug";
  }
}

export function renderConsoleTabsHtml(args: {
  consoleTab: string;
  legacyConsoleTab: string;
  operateTab: string;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const { consoleTab, legacyConsoleTab, operateTab, t, escapeText } = args;
  const lifecycleTabs = [
    ["project", "console-panel-project", t("nav.lifecycle.project", undefined, "Project"), t("navHint.lifecycle.project", undefined, "Inspect the current directory, initialize it, and review project health")],
    ["build", "console-panel-build", t("nav.lifecycle.build", undefined, "Build"), t("navHint.lifecycle.build", undefined, "Graph-first authoring, configuration, and dry-run setup")],
    ["validate-release", "console-panel-validate-release", t("nav.lifecycle.validateRelease", undefined, "Validate & Release"), t("navHint.lifecycle.validateRelease", undefined, "Validation gate, readiness, reports, and export")],
    ["operate", getOperatePanelId(operateTab), t("nav.lifecycle.operate", undefined, "Operate"), t("navHint.lifecycle.operate", undefined, "Run monitoring, diagnostics, logs, recovery, and audit")]
  ];
  if (consoleTab === "legacy") {
    lifecycleTabs.push(["legacy", getLegacyPanelId(legacyConsoleTab), t("nav.lifecycle.legacy", undefined, "Legacy fallback"), t("navHint.lifecycle.legacy", undefined, "Developer fallback access to the previous tab layout")]);
  }
  const legacyTabs = [
    ["debug", "console-panel-debug", t("nav.runDebug"), t("navHint.runDebug")],
    ["project", "console-panel-project", t("nav.project"), t("navHint.project")],
    ["ops", "console-panel-ops", t("nav.ops"), t("navHint.ops")],
    ["config", "console-panel-config", t("nav.config"), t("navHint.config")],
    ["logs", "console-panel-logs", t("nav.logs"), t("navHint.logs")],
    ["artifacts", "console-panel-artifacts", t("nav.artifacts"), t("navHint.artifacts")]
  ];
  const lifecycleHtml = '<div class="lifecycle-tabs" data-lifecycle-tabs role="tablist" aria-label="' +
    escapeText(t("nav.lifecycle.tablist", undefined, "Lifecycle views")) +
    '">' + lifecycleTabs.map(([id, panelId, label, hint]) =>
    '<button class="button subtle ' + (consoleTab === id ? "active" : "") +
    '" id="console-tab-' + escapeText(id) +
    '" data-console-tab="' + escapeText(id) +
    '" role="tab"' +
    '" aria-controls="' + escapeText(panelId) +
    '" aria-selected="' + escapeText(String(consoleTab === id)) +
    '" aria-pressed="' + escapeText(String(consoleTab === id)) +
    '" tabindex="' + escapeText(consoleTab === id ? "0" : "-1") +
    '" title="' + escapeText(hint) +
    '">' + escapeText(label) + '</button>'
  ).join("") + "</div>";
  const legacyHtml = consoleTab === "legacy"
    ? '<div class="legacy-tabs" data-legacy-tabs role="tablist" aria-label="' +
        escapeText(t("nav.legacy.tablist", undefined, "Legacy views")) +
        '">' + legacyTabs.map(([id, panelId, label, hint]) =>
        '<button class="button subtle ' + (legacyConsoleTab === id ? "active" : "") +
        '" id="legacy-console-tab-' + escapeText(id) +
        '" data-legacy-console-tab="' + escapeText(id) +
        '" role="tab"' +
        '" aria-controls="' + escapeText(panelId) +
        '" aria-selected="' + escapeText(String(legacyConsoleTab === id)) +
        '" aria-pressed="' + escapeText(String(legacyConsoleTab === id)) +
        '" tabindex="' + escapeText(legacyConsoleTab === id ? "0" : "-1") +
        '" title="' + escapeText(hint) +
        '">' + escapeText(label) + '</button>'
      ).join("") + '</div>'
    : "";
  return lifecycleHtml + legacyHtml;
}

export function getVisibleConsolePanelIds(args: {
  consoleTab: string;
  legacyConsoleTab: string;
  operateTab: string;
}): string[] {
  const { consoleTab, legacyConsoleTab, operateTab } = args;
  if (consoleTab === "legacy") {
    return [legacyConsoleTab || "debug"];
  }
  if (consoleTab === "project") {
    return ["project"];
  }
  if (consoleTab === "build") {
    return ["build"];
  }
  if (consoleTab === "validate-release") {
    return ["validate-release"];
  }
  switch (operateTab) {
    case "logs":
      return ["debug", "logs"];
    case "artifacts":
      return ["debug", "artifacts"];
    case "overview":
      return ["debug", "ops"];
    default:
      return ["debug"];
  }
}

export function shouldShowRunSidebar(consoleTab: string): boolean {
  return consoleTab === "operate" || consoleTab === "legacy";
}

export function renderRunListHtml(args: {
  runs: Array<Record<string, any>>;
  filter: string;
  selectedRunId: string;
  t: Translator;
  escapeText: (value: unknown) => string;
  formatTime: (value: unknown) => string;
  displayUiToken: (value: unknown, t: Translator) => string;
  statusClass: (status: string) => string;
}): string {
  const { runs, filter, selectedRunId, t, escapeText, formatTime, displayUiToken, statusClass } = args;
  const term = filter.trim().toLowerCase();
  const visibleRuns = runs.filter((run) => {
    if (!term) {
      return true;
    }
    return [run.runId, run.status, run.finalRoleId, run.lastExecutedRoleId]
      .filter(Boolean)
      .some((item) => String(item).toLowerCase().includes(term));
  });
  if (!visibleRuns.length) {
    return '<div class="hint">' + escapeText(t("run.noMatches")) + '</div>';
  }
  return visibleRuns
    .map((run) => {
      const runStatus = displayUiToken(run.status, t);
      const updatedAt = formatTime(run.updatedAt);
      const ariaLabel = [
        "Run",
        run.runId,
        "status",
        runStatus,
        t("run.transitions"),
        String(run.transitionCount),
        t("run.updated"),
        updatedAt
      ].join(" ");
      return `
          <button class="run-card ${run.runId === selectedRunId ? "active" : ""}" data-run-id="${escapeText(run.runId)}" aria-label="${escapeText(ariaLabel)}">
            <div class="run-title">
              <span class="truncate" title="${escapeText(run.runId)}">${escapeText(run.runId)}</span>
              <span class="status ${statusClass(run.status)}" data-status="${escapeText(run.status)}">${escapeText(runStatus)}</span>
            </div>
            <div class="meta">
              <span>${escapeText(t("run.transitions"))} ${escapeText(run.transitionCount)}</span>
              <span>${escapeText(t("run.updated"))} ${escapeText(updatedAt)}</span>
            </div>
          </button>
        `;
    })
    .join("");
}
