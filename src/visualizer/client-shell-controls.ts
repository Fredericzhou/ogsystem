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

export function renderConsoleTabsHtml(args: {
  consoleTab: string;
  operateTab: string;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  const { consoleTab, operateTab, t, escapeText } = args;
  const lifecycleTabs = [
    ["project", "console-panel-project", t("nav.lifecycle.project", undefined, "Project"), t("navHint.lifecycle.project", undefined, "Create, load, and inspect project context")],
    ["design", "console-panel-build", t("nav.lifecycle.design", undefined, "Design"), t("navHint.lifecycle.design", undefined, "Author the graph, configure runtime behavior, and prepare dry runs")],
    ["run", getOperatePanelId(operateTab), t("nav.lifecycle.run", undefined, "Run"), t("navHint.lifecycle.run", undefined, "Monitor runtime state, inspect diagnostics, and follow logs")],
    ["release", "console-panel-validate-release", t("nav.lifecycle.release", undefined, "Release"), t("navHint.lifecycle.release", undefined, "Review readiness, validation evidence, and export gates")]
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
  return lifecycleHtml;
}

export function getVisibleConsolePanelIds(args: {
  consoleTab: string;
  operateTab: string;
}): string[] {
  const { consoleTab, operateTab } = args;
  if (consoleTab === "project") {
    return ["project"];
  }
  if (consoleTab === "design") {
    return ["build"];
  }
  if (consoleTab === "release") {
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
  return consoleTab === "run";
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
          <button class="run-card ${run.runId === selectedRunId ? "active" : ""}" data-run-id="${escapeText(run.runId)}" aria-label="${escapeText(ariaLabel)}"${run.runId === selectedRunId ? ' aria-current="true"' : ""}>
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
