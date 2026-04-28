import {
  bindingTone,
  renderArtifactsPanel,
  renderBindingExplainPanel,
  renderContractPanel,
  renderFailureDetailPanel,
  renderFailureSummaryPanel,
  renderLogsPanel,
  renderOpsSummaryPanel,
  renderProjectReadinessPanel,
  renderProjectSummaryPanel,
  renderResumeReadinessPanel,
  renderReviewQueuePanel,
  renderReviewDetailPanel,
  renderRolePackagePanel,
  renderRunStatePanel,
  renderStudioBridgePanel,
  renderSuggestedNextChecksPanel,
  renderRunTopologySvg,
  renderWorkbenchTopologySvg,
  statusTone
} from "./client-renderers.js";

type RouteState = {
  view: string;
  runId: string;
  reviewId: string;
  logRoleId: string;
  tail: string;
  since: string;
};

type StreamRefreshPlan = {
  detailGraph: boolean;
  reviews: boolean;
  reviewDetail: boolean;
  failure: boolean;
  resumeReadiness: boolean;
  markDiagnosticsStale: boolean;
};

export function readRouteStateFromSearch(search: string): RouteState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    view: params.get("view") || "",
    runId: params.get("runId") || "",
    reviewId: params.get("reviewId") || "",
    logRoleId: params.get("logRoleId") || "",
    tail: params.get("tail") || "",
    since: params.get("since") || ""
  };
}

export function buildRouteSearch(args: {
  projectHome: boolean;
  selectedRunId: string;
  selectedReviewId: string;
  selectedLogRoleId: string;
  logTail: string;
  logSince: string;
}): string {
  const params = new URLSearchParams();
  if (args.projectHome && !args.selectedRunId) {
    params.set("view", "project");
  }
  if (args.selectedRunId) {
    params.set("runId", args.selectedRunId);
  }
  if (args.selectedReviewId) {
    params.set("reviewId", args.selectedReviewId);
  }
  if (args.selectedLogRoleId) {
    params.set("logRoleId", args.selectedLogRoleId);
  }
  if (args.logTail) {
    params.set("tail", args.logTail);
  }
  if (args.logSince) {
    params.set("since", args.logSince);
  }
  return params.toString();
}

export function appendStreamEntry<T extends { cursor: number }>(
  entries: T[],
  entry: T,
  limit = 250
): T[] {
  if (entries.some((item) => item.cursor === entry.cursor)) {
    return entries.slice(-limit);
  }
  return entries.concat(entry).slice(-limit);
}

export function getStreamRefreshPlan(type: string | undefined): StreamRefreshPlan {
  const normalized = typeof type === "string" ? type : "";
  if (normalized.startsWith("human_review_")) {
    return {
      detailGraph: true,
      reviews: true,
      reviewDetail: true,
      failure: false,
      resumeReadiness: true,
      markDiagnosticsStale: true
    };
  }
  if (
    normalized === "audit" ||
    normalized === "runtime_error" ||
    normalized.startsWith("run_") ||
    normalized.startsWith("stop_") ||
    normalized.startsWith("resume_") ||
    normalized === "branch_activated" ||
    normalized === "join_ready"
  ) {
    return {
      detailGraph: true,
      reviews: false,
      reviewDetail: false,
      failure: true,
      resumeReadiness: true,
      markDiagnosticsStale: true
    };
  }
  return {
    detailGraph: false,
    reviews: false,
    reviewDetail: false,
    failure: false,
    resumeReadiness: false,
    markDiagnosticsStale: true
  };
}

export function formatReviewStatusLabel(status: string | undefined): string {
  switch (status) {
    case "pending_reconcile":
      return "pending reconcile";
    case "waiting_review":
      return "waiting review";
    default:
      return String(status || "unknown").replace(/_/g, " ");
  }
}

export function buildClientAppScript(apiPrefix: string): string {
  return `
    const API_PREFIX = ${JSON.stringify(apiPrefix)};
    const readRouteStateFromSearch = ${readRouteStateFromSearch.toString()};
    const buildRouteSearch = ${buildRouteSearch.toString()};
    const appendStreamEntry = ${appendStreamEntry.toString()};
    const getStreamRefreshPlan = ${getStreamRefreshPlan.toString()};
    const formatReviewStatusLabel = ${formatReviewStatusLabel.toString()};
    const statusTone = ${statusTone.toString()};
    const bindingTone = ${bindingTone.toString()};
    const renderArtifactsPanel = ${renderArtifactsPanel.toString()};
    const renderBindingExplainPanel = ${renderBindingExplainPanel.toString()};
    const renderContractPanel = ${renderContractPanel.toString()};
    const renderFailureDetailPanel = ${renderFailureDetailPanel.toString()};
    const renderFailureSummaryPanel = ${renderFailureSummaryPanel.toString()};
    const renderProjectSummaryPanel = ${renderProjectSummaryPanel.toString()};
    const renderResumeReadinessPanel = ${renderResumeReadinessPanel.toString()};
    const renderReviewQueuePanel = ${renderReviewQueuePanel.toString()};
    const renderReviewDetailPanel = ${renderReviewDetailPanel.toString()};
    const renderRolePackagePanel = ${renderRolePackagePanel.toString()};
    const renderLogsPanel = ${renderLogsPanel.toString()};
    const renderOpsSummaryPanel = ${renderOpsSummaryPanel.toString()};
    const renderProjectReadinessPanel = ${renderProjectReadinessPanel.toString()};
    const renderStudioBridgePanel = ${renderStudioBridgePanel.toString()};
    const renderRunStatePanel = ${renderRunStatePanel.toString()};
    const renderSuggestedNextChecksPanel = ${renderSuggestedNextChecksPanel.toString()};
    const renderRunTopologySvg = ${renderRunTopologySvg.toString()};
    const renderWorkbenchTopologySvg = ${renderWorkbenchTopologySvg.toString()};
    const state = {
      project: null,
      opsSummary: null,
      projectReadiness: null,
      consoleTab: "debug",
      workbench: null,
      workbenchView: "render",
      workbenchSource: "",
      workbenchDiskSource: "",
      workbenchSavedPath: "system.mmd",
      workbenchHasDraft: false,
      workbenchValidationTimer: null,
      workbenchValidationRequestId: 0,
      workbenchValidating: false,
      studioBridge: null,
      studioBridgeLoaded: false,
      studioBridgeStale: false,
      studioBridgeSelectedRoleId: "",
      studioBridgeSelectedFlowKey: "",
      studioBridgeLastDryRunId: "",
      sidebarOpen: false,
      runs: [],
      filter: "",
      projectHome: false,
      selectedRunId: "",
      selectedReviewId: "",
      selectedLogRoleId: "",
      logTail: "",
      logSince: "",
      timelineRoleId: "",
      timelineBranchId: "",
      timelineType: "",
      timelineReviewId: "",
      timelineStatus: "",
      timelineErrorCode: "",
      eventCursor: 0,
      events: [],
      detail: null,
      graph: null,
      failure: null,
      failureLoaded: false,
      failureStale: false,
      reviews: null,
      reviewDetail: null,
      bindings: null,
      contracts: null,
      contractRuntimeStatus: null,
      rolePackages: null,
      resumeReadiness: null,
      resumeReadinessLoaded: false,
      resumeReadinessStale: false,
      resumeDiagnostics: null,
      resumeDiagnosticsLoaded: false,
      resumeDiagnosticsStale: false,
      engineLogs: [],
      roleLogs: [],
      logsLoaded: false,
      logsStale: false,
      stream: null,
      listTimer: null,
      flash: null,
      actionBusy: "",
      actionForm: null,
      streamRefreshPlan: {
        detailGraph: false,
        reviews: false,
        reviewDetail: false,
        failure: false,
        resumeReadiness: false,
        markDiagnosticsStale: false
      },
      streamRefreshTimer: null,
      streamRefreshInFlight: false
    };

    const runListEl = document.getElementById("run-list");
    const searchEl = document.getElementById("search");
    const flashEl = document.getElementById("flash");
    const selectedTitleEl = document.getElementById("selected-title");
    const selectedSubtitleEl = document.getElementById("selected-subtitle");
    const actionFormEl = document.getElementById("action-form");
    const consoleTabsEl = document.getElementById("console-tabs");
    const workdirEl = document.getElementById("workdir");
    const projectSummaryEl = document.getElementById("project-summary");
    const opsSummaryEl = document.getElementById("ops-summary");
    const projectReadinessEl = document.getElementById("project-readiness");
    const workbenchMetaEl = document.getElementById("workbench-meta");
    const workbenchStatusEl = document.getElementById("workbench-status");
    const workbenchActionsEl = document.getElementById("workbench-actions");
    const workbenchTabsEl = document.getElementById("workbench-tabs");
    const workbenchBodyEl = document.getElementById("workbench-body");
    const statsEl = document.getElementById("stats");
    const failureControlsEl = document.getElementById("failure-controls");
    const failureSummaryEl = document.getElementById("failure-summary");
    const failureDetailEl = document.getElementById("failure-detail");
    const failureNextChecksEl = document.getElementById("failure-next-checks");
    const timelineEl = document.getElementById("timeline");
    const timelineRoleEl = document.getElementById("timeline-role");
    const timelineTypeEl = document.getElementById("timeline-type");
    const timelineStatusEl = document.getElementById("timeline-status");
    const timelineBranchEl = document.getElementById("timeline-branch");
    const timelineReviewEl = document.getElementById("timeline-review");
    const timelineErrorEl = document.getElementById("timeline-error");
    const timelineApplyButton = document.getElementById("timeline-apply");
    const timelineClearButton = document.getElementById("timeline-clear");
    const graphViewEl = document.getElementById("graph-view");
    const stateEl = document.getElementById("state");
    const reviewsEl = document.getElementById("reviews");
    const reviewActionsEl = document.getElementById("review-actions");
    const reviewDetailEl = document.getElementById("review-detail");
    const bindingExplainEl = document.getElementById("binding-explain");
    const rolePackagesEl = document.getElementById("role-packages");
    const contractExplainEl = document.getElementById("contract-explain");
    const resumeReadinessEl = document.getElementById("resume-readiness");
    const resumeEl = document.getElementById("resume-diagnostics");
    const resumeControlsEl = document.getElementById("resume-controls");
    const logsControlsEl = document.getElementById("logs-controls");
    const logsFiltersEl = document.getElementById("logs-filters");
    const logsEl = document.getElementById("logs");
    const detailEl = document.getElementById("detail");
    const liveEl = document.getElementById("live");
    const logRoleEl = document.getElementById("log-role");
    const logTailEl = document.getElementById("log-tail");
    const logSinceEl = document.getElementById("log-since");
    const sidebarEl = document.getElementById("sidebar");
    const sidebarOverlayEl = document.getElementById("sidebar-overlay");
    const sidebarToggleButton = document.getElementById("sidebar-toggle");
    const projectHomeButton = document.getElementById("project-home");
    const projectLoadButton = document.getElementById("project-load");
    const projectExportButton = document.getElementById("project-export");
    const reindexButton = document.getElementById("reindex");
    const startRunButton = document.getElementById("start-run");
    const resumeRunButton = document.getElementById("resume-run");
    const stopRunButton = document.getElementById("stop-run");
    const refreshButton = document.getElementById("refresh");

    function escapeText(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function formatTime(value) {
      if (!value) return "n/a";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }

    function formatJson(value) {
      return JSON.stringify(value ?? null, null, 2);
    }

    function getCurrentWorkdir() {
      return state.project?.summary?.workdir || workdirEl?.textContent || "";
    }

    function relativeToWorkdir(path) {
      if (!path) {
        return "";
      }
      const workdir = getCurrentWorkdir();
      if (workdir && path.startsWith(workdir)) {
        return path.slice(workdir.length).replace(/^[/\\\\]/, "") || ".";
      }
      return path;
    }

    function draftStorageKey() {
      const workdir = getCurrentWorkdir();
      return "ogs.visualizer.workbench:" + workdir;
    }

    function loadDraftSource() {
      try {
        return window.localStorage.getItem(draftStorageKey()) || "";
      } catch {
        return "";
      }
    }

    function persistDraftSource(source) {
      try {
        if (!source) {
          window.localStorage.removeItem(draftStorageKey());
        } else {
          window.localStorage.setItem(draftStorageKey(), source);
        }
      } catch {
        // best effort only
      }
      state.workbenchHasDraft = Boolean(loadDraftSource());
    }

    function readApiError(payload, fallback) {
      if (payload && payload.error && payload.error.message) {
        return payload.error.message;
      }
      return fallback;
    }

    function statusClass(status) {
      return [
        "running",
        "stopping",
        "stopped",
        "done",
        "failed",
        "waiting_review",
        "active",
        "idle",
        "simulation",
        "completed",
        "recorded",
        "pending_reconcile",
        "applied",
        "pending",
        "paused"
      ].includes(status)
        ? status
        : "unknown";
    }

    async function requestJson(path, options) {
      const response = await fetch(path, {
        headers: { accept: "application/json" },
        cache: "no-store",
        ...(options || {})
      });
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text().catch(() => "");
      if (!response.ok) {
        throw new Error(readApiError(payload, \`\${response.status} \${response.statusText}\`));
      }
      return payload;
    }

    async function requestAction(path, body) {
      return requestJson(path, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify(body || {})
      });
    }

    function setLive(mode, label) {
      liveEl.className = "live" + (mode === "online" ? " online" : "");
      liveEl.textContent = label;
    }

    function writeRouteToLocation() {
      const query = buildRouteSearch({
        projectHome: state.projectHome,
        selectedRunId: state.selectedRunId,
        selectedReviewId: state.selectedReviewId,
        selectedLogRoleId: state.selectedLogRoleId,
        logTail: state.logTail,
        logSince: state.logSince
      });
      window.history.replaceState(null, "", query ? "?" + query : window.location.pathname);
    }

    function buildLogsQuery(runId, extra) {
      const params = new URLSearchParams();
      if (extra.engine) {
        params.set("engine", "true");
      }
      if (extra.roleId) {
        params.set("roleId", extra.roleId);
      }
      if (state.logTail) {
        params.set("tail", state.logTail);
      }
      if (state.logSince) {
        const normalized = state.logSince.includes(":") && state.logSince.length === 16
          ? new Date(state.logSince).toISOString()
          : state.logSince;
        params.set("since", normalized);
      }
      return API_PREFIX + "/runs/" + encodeURIComponent(runId) + "/logs?" + params.toString();
    }

    function buildTimelineQuery(runId, extra) {
      const params = new URLSearchParams();
      params.set("cursor", String(extra.cursor ?? 0));
      params.set("limit", String(extra.limit ?? 250));
      if (state.timelineRoleId) {
        params.set("roleId", state.timelineRoleId);
      }
      if (state.timelineBranchId) {
        params.set("branchId", state.timelineBranchId);
      }
      if (state.timelineType) {
        params.set("type", state.timelineType);
      }
      if (state.timelineReviewId) {
        params.set("reviewId", state.timelineReviewId);
      }
      if (state.timelineStatus) {
        params.set("status", state.timelineStatus);
      }
      if (state.timelineErrorCode) {
        params.set("errorCode", state.timelineErrorCode);
      }
      return API_PREFIX + "/runs/" + encodeURIComponent(runId) + "/events?" + params.toString();
    }

    function recordMatchesTimelineFilters(record) {
      if (!record) {
        return false;
      }
      if (state.timelineRoleId && record.roleId !== state.timelineRoleId) {
        return false;
      }
      if (state.timelineBranchId && record.branchId !== state.timelineBranchId) {
        return false;
      }
      if (state.timelineType && record.type !== state.timelineType) {
        return false;
      }
      if (state.timelineReviewId && record.reviewId !== state.timelineReviewId) {
        return false;
      }
      if (state.timelineStatus && record.status !== state.timelineStatus) {
        return false;
      }
      if (state.timelineErrorCode && record.errorCode !== state.timelineErrorCode) {
        return false;
      }
      return true;
    }

    function syncTimelineFilterInputs() {
      if (timelineRoleEl) timelineRoleEl.value = state.timelineRoleId;
      if (timelineTypeEl) timelineTypeEl.value = state.timelineType;
      if (timelineStatusEl) timelineStatusEl.value = state.timelineStatus;
      if (timelineBranchEl) timelineBranchEl.value = state.timelineBranchId;
      if (timelineReviewEl) timelineReviewEl.value = state.timelineReviewId;
      if (timelineErrorEl) timelineErrorEl.value = state.timelineErrorCode;
    }

    function readTimelineFiltersFromInputs() {
      state.timelineRoleId = timelineRoleEl?.value || "";
      state.timelineType = timelineTypeEl?.value.trim() || "";
      state.timelineStatus = timelineStatusEl?.value || "";
      state.timelineBranchId = timelineBranchEl?.value.trim() || "";
      state.timelineReviewId = timelineReviewEl?.value.trim() || "";
      state.timelineErrorCode = timelineErrorEl?.value.trim() || "";
    }

    function setFlash(kind, message) {
      state.flash = message ? { kind, message } : null;
      renderFlash();
    }

    function renderFlash() {
      if (!state.flash) {
        flashEl.className = "flash hidden";
        flashEl.textContent = "";
        return;
      }
      flashEl.className = "flash " + (state.flash.kind || "info");
      flashEl.textContent = state.flash.message;
    }

    function setActionBusy(actionId) {
      state.actionBusy = actionId;
      renderActionForm();
      renderLogs();
      renderActionState();
    }

    function canRequestStop() {
      const status = state.detail?.header?.status || "";
      if (!state.selectedRunId) {
        return false;
      }
      return !["done", "failed", "stopped"].includes(status);
    }

    function isRunActiveStatus(status) {
      return status === "running" || status === "stopping";
    }

    function shouldPollRunsList() {
      if (document.visibilityState === "hidden" || state.actionBusy || !state.selectedRunId) {
        return false;
      }
      return isRunActiveStatus(state.detail?.header?.status || "");
    }

    function renderActionState() {
      const disabled = Boolean(state.actionBusy);
      const stopDisabled = disabled || !canRequestStop();
      projectHomeButton.disabled = disabled;
      projectLoadButton.disabled = disabled;
      projectExportButton.disabled = disabled;
      reindexButton.disabled = disabled;
      startRunButton.disabled = disabled;
      resumeRunButton.disabled = disabled || !state.selectedRunId;
      stopRunButton.disabled = stopDisabled;
      refreshButton.disabled = disabled;
      if (timelineApplyButton) {
        timelineApplyButton.disabled = disabled || !state.selectedRunId;
      }
      if (timelineClearButton) {
        timelineClearButton.disabled = disabled || !state.selectedRunId;
      }
      for (const input of [
        timelineRoleEl,
        timelineTypeEl,
        timelineStatusEl,
        timelineBranchEl,
        timelineReviewEl,
        timelineErrorEl
      ]) {
        if (input) {
          input.disabled = disabled || !state.selectedRunId;
        }
      }
      if (sidebarToggleButton) {
        sidebarToggleButton.disabled = disabled;
      }
      for (const button of workbenchActionsEl.querySelectorAll("button")) {
        button.disabled = disabled || button.disabled;
      }
      for (const button of workbenchTabsEl.querySelectorAll("button")) {
        button.disabled = disabled;
      }
      if (consoleTabsEl) {
        for (const button of consoleTabsEl.querySelectorAll("[data-console-tab]")) {
          button.disabled = disabled;
        }
      }
      for (const button of reviewActionsEl.querySelectorAll("[data-review-action]")) {
        button.disabled = disabled;
      }
    }

    function setSidebarOpen(nextValue) {
      state.sidebarOpen = nextValue;
      document.body.classList.toggle("drawer-open", nextValue);
    }

    function renderConsoleTabs() {
      if (!consoleTabsEl) {
        return;
      }
      const tabs = [
        ["debug", "Run Debug", "failure, timeline, graph, review, resume"],
        ["project", "Project", "workbench, overview, readiness"],
        ["ops", "Ops", "failure and resume aggregates"],
        ["config", "Config", "bindings, role packages, contracts"],
        ["logs", "Logs", "engine and role log channels"],
        ["artifacts", "Artifacts", "raw run snapshots"]
      ];
      consoleTabsEl.innerHTML = tabs.map(([id, label, hint]) =>
        '<button class="button subtle ' + (state.consoleTab === id ? "active" : "") +
        '" data-console-tab="' + escapeText(id) +
        '" title="' + escapeText(hint) +
        '">' + escapeText(label) + '</button>'
      ).join("");
      for (const [id] of tabs) {
        const panel = document.getElementById("console-panel-" + id);
        if (panel) {
          panel.hidden = state.consoleTab !== id;
        }
      }
      for (const button of consoleTabsEl.querySelectorAll("[data-console-tab]")) {
        button.addEventListener("click", () => {
          state.consoleTab = button.getAttribute("data-console-tab") || "debug";
          renderConsoleTabs();
          renderActionState();
        });
      }
    }

    function renderWorkbenchPreviewSvg(structure) {
      return renderWorkbenchTopologySvg(structure);
    }

    function renderWorkbenchStructure(structure) {
      if (!structure) {
        return '<div class="hint">Structure view appears after a valid Mermaid parse and compile pass.</div>';
      }
      return [
        '<div class="structure-list">',
        '<div class="event"><div class="event-top"><span>system</span><span>' + escapeText(structure.systemVersion || "n/a") + '</span></div><strong>' + escapeText(structure.systemId || "unknown") + '</strong><div class="hint">entry ' + escapeText(structure.entryRoleId || "n/a") + ' · roles ' + escapeText(structure.roleCount || 0) + ' · flows ' + escapeText(structure.flowCount || 0) + '</div></div>',
        ...(structure.roles || []).map((role) =>
          '<div class="event"><div class="event-top"><span><code>' + escapeText(role.roleId) + '</code></span><span>' + escapeText(role.bindingKind) + '</span></div><strong>'
          + escapeText(role.reviewMode || role.joinMode || role.routingMode || "standard role")
          + '</strong><div class="hint">'
          + escapeText([role.routingMode ? "route " + role.routingMode : "", role.joinMode ? "join " + role.joinMode : "", role.reviewMode ? "review " + role.reviewMode : ""].filter(Boolean).join(" · ") || "no special graph metadata")
          + '</div></div>'
        ),
        ...(structure.flows || []).map((flow) =>
          '<div class="event"><div class="event-top"><span><code>' + escapeText(flow.fromRoleId) + '</code> -> <code>' + escapeText(flow.toRoleId) + '</code></span><span>flow</span></div><strong>' + escapeText(flow.eventType) + '</strong></div>'
        ),
        '</div>'
      ].join("");
    }

    function renderStudioBridge() {
      const bridge = state.studioBridge || {
        validation: state.workbench?.validation || null,
        extracted: state.workbench?.validation?.structure || null
      };
      workbenchBodyEl.innerHTML = renderStudioBridgePanel({
        bridge,
        readiness: state.projectReadiness,
        selectedRoleId: state.studioBridgeSelectedRoleId,
        selectedFlowKey: state.studioBridgeSelectedFlowKey,
        actionBusy: state.actionBusy
      });
      for (const button of workbenchBodyEl.querySelectorAll("[data-studio-role-id]")) {
        button.addEventListener("click", () => {
          state.studioBridgeSelectedRoleId = button.getAttribute("data-studio-role-id") || "";
          state.studioBridgeSelectedFlowKey = "";
          renderStudioBridge();
        });
      }
      for (const button of workbenchBodyEl.querySelectorAll("[data-studio-flow-key]")) {
        button.addEventListener("click", () => {
          state.studioBridgeSelectedFlowKey = button.getAttribute("data-studio-flow-key") || "";
          state.studioBridgeSelectedRoleId = "";
          renderStudioBridge();
        });
      }
      const validateButton = document.getElementById("studio-bridge-validate");
      if (validateButton) {
        validateButton.addEventListener("click", async () => {
          await runWorkbenchValidation(true);
          await refreshStudioBridge();
        });
      }
      const saveButton = document.getElementById("studio-bridge-save");
      if (saveButton) {
        saveButton.addEventListener("click", async () => {
          await saveWorkbench();
        });
      }
      const dryRunButton = document.getElementById("studio-bridge-dry-run");
      if (dryRunButton) {
        dryRunButton.addEventListener("click", () => {
          openActionForm("start", {
            systemPath: state.workbenchSavedPath || "system.mmd",
            input: "",
            dryRun: true,
            runtimePath: "",
            userProfilePath: "",
            lawsPath: ""
          });
        });
      }
      const saveDraftButton = document.getElementById("studio-bridge-save-draft");
      if (saveDraftButton) {
        saveDraftButton.addEventListener("click", async () => {
          await saveStudioAuthoringDraft();
        });
      }
      const generateButton = document.getElementById("studio-bridge-generate");
      if (generateButton) {
        generateButton.addEventListener("click", async () => {
          await generateMmdFromStudioBridge();
        });
      }
    }

    function renderWorkbench(options) {
      const validation = state.workbench?.validation || null;
      const diagnostics = validation?.diagnostics || [];
      const structure = validation?.structure || null;
      const dirty = state.workbenchSource !== state.workbenchDiskSource;
      const preserveEditor = Boolean(options?.preserveEditor);
      const existingEditor = document.getElementById("workbench-editor");
      state.workbenchHasDraft = Boolean(loadDraftSource());
      workbenchMetaEl.textContent = state.selectedRunId && state.detail?.systemSource
        ? "Editing the project system.mmd only. Selected run snapshots remain immutable and are shown in run detail."
        : "Load project source from disk, validate changes, and prepare start or resume actions.";
      const statusPills = [
        '<span class="pill' + (dirty ? " warn" : "") + '">' + escapeText(dirty ? "unsaved changes" : "disk in sync") + '</span>',
        '<span class="pill">' + escapeText(relativeToWorkdir(state.workbenchSavedPath || "system.mmd")) + '</span>',
        state.workbenchHasDraft ? '<span class="pill warn">draft cached</span>' : "",
        validation
          ? '<span class="pill' + (validation.ok ? "" : " warn") + '">' + escapeText(validation.ok ? "validation ok" : diagnostics.length + " diagnostics") + '</span>'
          : '<span class="pill">validation pending</span>',
        state.workbenchValidating ? '<span class="pill warn">validating…</span>' : ""
      ].filter(Boolean);
      workbenchStatusEl.innerHTML = statusPills.join("");
      workbenchTabsEl.innerHTML = [
        '<button class="button subtle ' + (state.workbenchView === "source" ? "active" : "") + '" data-workbench-view="source">Source</button>',
        '<button class="button subtle ' + (state.workbenchView === "render" ? "active" : "") + '" data-workbench-view="render">Rendered</button>',
        '<button class="button subtle ' + (state.workbenchView === "structure" ? "active" : "") + '" data-workbench-view="structure">Structure</button>',
        '<button class="button subtle ' + (state.workbenchView === "bridge" ? "active" : "") + '" data-workbench-view="bridge">Studio Bridge</button>'
      ].join("");
      workbenchActionsEl.innerHTML = [
        '<button class="button primary" id="workbench-open-bridge">Open Studio Bridge</button>',
        '<button class="button subtle" id="workbench-new-draft">New draft</button>',
        '<button class="button subtle" id="workbench-recover-draft"' + (state.workbenchHasDraft ? "" : " disabled") + '>Recover draft</button>',
        '<button class="button subtle" id="workbench-revert"' + (dirty ? "" : " disabled") + '>Revert to disk</button>',
        '<button class="button primary" id="workbench-save"' + (dirty ? "" : " disabled") + '>Save</button>',
        '<button class="button" id="workbench-save-as">Save as</button>'
      ].join("");
      if (state.workbenchView === "source" && preserveEditor && existingEditor) {
        if (existingEditor.value !== state.workbenchSource) {
          existingEditor.value = state.workbenchSource || "";
        }
      } else if (state.workbenchView === "source") {
        workbenchBodyEl.innerHTML = '<textarea id="workbench-editor" class="editor" spellcheck="false">' + escapeText(state.workbenchSource || "") + '</textarea>';
      } else if (state.workbenchView === "render") {
        workbenchBodyEl.innerHTML = [
          '<div class="preview">' + renderWorkbenchPreviewSvg(structure) + '</div>',
          diagnostics.length
            ? '<div class="structure-list">' + diagnostics.map((diagnostic) =>
                '<div class="event"><div class="event-top"><span>' + escapeText(diagnostic.code) + '</span><span>' + escapeText(diagnostic.line ? "line " + diagnostic.line : diagnostic.stage) + '</span></div><strong>' + escapeText(diagnostic.message) + '</strong></div>'
              ).join("") + '</div>'
            : '<div class="hint">Rendered preview keeps the last successful graph structure while validation stays clean.</div>'
        ].join("");
      } else if (state.workbenchView === "bridge") {
        renderStudioBridge();
      } else {
        workbenchBodyEl.innerHTML = renderWorkbenchStructure(structure);
      }
      const editor = document.getElementById("workbench-editor");
      if (editor && (!preserveEditor || editor !== existingEditor)) {
        editor.addEventListener("input", (event) => {
          state.workbenchSource = event.target.value || "";
          state.studioBridgeStale = true;
          persistDraftSource(state.workbenchSource !== state.workbenchDiskSource ? state.workbenchSource : "");
          renderWorkbench({ preserveEditor: true });
          scheduleWorkbenchValidation();
        });
      }
      for (const button of workbenchTabsEl.querySelectorAll("[data-workbench-view]")) {
        button.addEventListener("click", () => {
          state.workbenchView = button.getAttribute("data-workbench-view") || "render";
          renderWorkbench();
          if (state.workbenchView === "bridge" && (!state.studioBridgeLoaded || state.studioBridgeStale)) {
            void refreshStudioBridge().catch((error) => {
              setFlash("error", "Studio Bridge refresh failed: " + (error.message || error));
            });
          }
        });
      }
      const openBridgeButton = document.getElementById("workbench-open-bridge");
      if (openBridgeButton) {
        openBridgeButton.addEventListener("click", () => {
          state.workbenchView = "bridge";
          renderWorkbench();
          void refreshStudioBridge().catch((error) => {
            setFlash("error", "Studio Bridge refresh failed: " + (error.message || error));
          });
        });
      }
      const newDraftButton = document.getElementById("workbench-new-draft");
      if (newDraftButton) {
        newDraftButton.addEventListener("click", () => {
          state.workbenchSource = [
            "flowchart TD",
            "%% system.id=workspace.draft",
            "%% system.version=0.0.1",
            "%% law.global=law.minimal.base",
            "%% entry.role=author",
            "input -->|START| author[Role:author]",
            "author[Role:author] -->|DONE| output",
            ""
          ].join("\\n");
          state.workbenchView = "source";
          persistDraftSource(state.workbenchSource);
          renderWorkbench();
          scheduleWorkbenchValidation();
        });
      }
      const recoverDraftButton = document.getElementById("workbench-recover-draft");
      if (recoverDraftButton) {
        recoverDraftButton.addEventListener("click", () => {
          const draft = loadDraftSource();
          if (!draft) {
            return;
          }
          state.workbenchSource = draft;
          state.workbenchView = "source";
          renderWorkbench();
          scheduleWorkbenchValidation();
        });
      }
      const revertButton = document.getElementById("workbench-revert");
      if (revertButton) {
        revertButton.addEventListener("click", () => {
          state.workbenchSource = state.workbenchDiskSource;
          persistDraftSource("");
          renderWorkbench();
          scheduleWorkbenchValidation();
        });
      }
      const saveButton = document.getElementById("workbench-save");
      if (saveButton) {
        saveButton.addEventListener("click", async () => {
          await saveWorkbench();
        });
      }
      const saveAsButton = document.getElementById("workbench-save-as");
      if (saveAsButton) {
        saveAsButton.addEventListener("click", async () => {
          openActionForm("saveAs", {
            saveAsPath: state.workbenchSavedPath || "drafts/system-copy.mmd"
          });
        });
      }
      renderActionState();
    }

    function upsertRunFromHeader(header) {
      if (!header || !header.runId) {
        return;
      }
      const nextRun = {
        runId: header.runId,
        runDir: header.runDir,
        status: header.status,
        transitionCount: header.transitionCount,
        finalRoleId: header.finalRoleId,
        lastExecutedRoleId: header.lastExecutedRoleId,
        updatedAt: header.updatedAt,
        pendingReviewCount: header.pendingReviewCount,
        hasWaitingHumanReview: header.hasWaitingHumanReview
      };
      const index = state.runs.findIndex((item) => item.runId === header.runId);
      if (index === -1) {
        state.runs = [nextRun].concat(state.runs);
      } else {
        state.runs.splice(index, 1, Object.assign({}, state.runs[index], nextRun));
      }
    }

    function closeActionForm() {
      state.actionForm = null;
      renderActionForm();
    }

    function openActionForm(kind, fields) {
      state.actionForm = {
        kind,
        fields: Object.assign({}, fields || {})
      };
      renderActionForm();
    }

    function readActionFieldValue(fieldId) {
      const element = document.getElementById(fieldId);
      if (!element) {
        return "";
      }
      return typeof element.value === "string" ? element.value.trim() : "";
    }

    function renderActionForm() {
      if (!actionFormEl) {
        return;
      }
      const form = state.actionForm;
      if (!form) {
        actionFormEl.innerHTML = '<div class="hint">Select start, resume, stop, or review actions to edit structured inputs inline.</div>';
        return;
      }
      const disabled = state.actionBusy ? " disabled" : "";
      if (form.kind === "start") {
        actionFormEl.innerHTML = [
          '<div class="event"><div class="event-top"><span>start run</span><span>from workbench</span></div><strong>Prepare a new run request</strong><div class="hint">Use the validated Mermaid path plus minimal runtime overrides.</div></div>',
          '<div class="form-grid">',
          '<label class="field"><span>System path</span><input id="action-start-system-path" value="' + escapeText(form.fields.systemPath || "") + '"' + disabled + ' /></label>',
          '<label class="field"><span>Dry run</span><select id="action-start-dry-run"' + disabled + '><option value="true"' + (form.fields.dryRun ? " selected" : "") + '>yes</option><option value="false"' + (!form.fields.dryRun ? " selected" : "") + '>no</option></select></label>',
          '<label class="field full"><span>Run input</span><textarea id="action-start-input"' + disabled + '>' + escapeText(form.fields.input || "") + '</textarea></label>',
          '<label class="field"><span>Runtime config path</span><input id="action-start-runtime-path" value="' + escapeText(form.fields.runtimePath || "") + '"' + disabled + ' /></label>',
          '<label class="field"><span>User profile path</span><input id="action-start-user-profile-path" value="' + escapeText(form.fields.userProfilePath || "") + '"' + disabled + ' /></label>',
          '<label class="field full"><span>Laws path</span><input id="action-start-laws-path" value="' + escapeText(form.fields.lawsPath || "") + '"' + disabled + ' /></label>',
          '</div>',
          '<div class="actions"><button id="action-form-cancel" class="button subtle"' + disabled + '>Cancel</button><button id="action-form-submit" class="button primary"' + disabled + '>Start run</button></div>'
        ].join("");
      } else if (form.kind === "resume") {
        actionFormEl.innerHTML = [
          '<div class="event"><div class="event-top"><span>resume run</span><span>' + escapeText(state.selectedRunId || "n/a") + '</span></div><strong>Prepare a resume request</strong><div class="hint">All overrides are optional except the action itself.</div></div>',
          '<div class="form-grid">',
          '<label class="field"><span>System override</span><input id="action-resume-system-path" value="' + escapeText(form.fields.systemPath || "") + '"' + disabled + ' /></label>',
          '<label class="field"><span>Dry run</span><select id="action-resume-dry-run"' + disabled + '><option value="false"' + (!form.fields.dryRun ? " selected" : "") + '>no</option><option value="true"' + (form.fields.dryRun ? " selected" : "") + '>yes</option></select></label>',
          '<label class="field full"><span>Input override</span><textarea id="action-resume-input"' + disabled + '>' + escapeText(form.fields.input || "") + '</textarea></label>',
          '<label class="field"><span>Runtime config path</span><input id="action-resume-runtime-path" value="' + escapeText(form.fields.runtimePath || "") + '"' + disabled + ' /></label>',
          '<label class="field"><span>User profile path</span><input id="action-resume-user-profile-path" value="' + escapeText(form.fields.userProfilePath || "") + '"' + disabled + ' /></label>',
          '<label class="field full"><span>Laws path</span><input id="action-resume-laws-path" value="' + escapeText(form.fields.lawsPath || "") + '"' + disabled + ' /></label>',
          '</div>',
          '<div class="actions"><button id="action-form-cancel" class="button subtle"' + disabled + '>Cancel</button><button id="action-form-submit" class="button primary"' + disabled + '>Resume run</button></div>'
        ].join("");
      } else if (form.kind === "stop") {
        actionFormEl.innerHTML = [
          '<div class="event"><div class="event-top"><span>stop request</span><span>' + escapeText(state.selectedRunId || "n/a") + '</span></div><strong>Record a structured stop request</strong><div class="hint">The runtime will reconcile the request asynchronously when applicable.</div></div>',
          '<label class="field full"><span>Reason</span><textarea id="action-stop-reason"' + disabled + '>' + escapeText(form.fields.reason || "") + '</textarea></label>',
          '<div class="actions"><button id="action-form-cancel" class="button subtle"' + disabled + '>Cancel</button><button id="action-form-submit" class="button warn"' + disabled + '>Record stop request</button></div>'
        ].join("");
      } else if (form.kind === "review") {
        actionFormEl.innerHTML = [
          '<div class="event"><div class="event-top"><span>review decision</span><span>' + escapeText(form.fields.reviewId || state.selectedReviewId || "n/a") + '</span></div><strong>' + escapeText(form.fields.decision || "decision") + '</strong><div class="hint">Capture operator identity, rationale, and scope before writing a durable review action.</div></div>',
          '<div class="form-grid">',
          '<label class="field"><span>Actor</span><input id="action-review-actor" value="' + escapeText(form.fields.actor || "") + '"' + disabled + ' /></label>',
          '<label class="field"><span>Decision</span><input id="action-review-decision" value="' + escapeText(form.fields.decision || "") + '" disabled /></label>',
          '<label class="field full"><span>Comment</span><textarea id="action-review-comment"' + disabled + '>' + escapeText(form.fields.comment || "") + '</textarea></label>',
          (form.fields.decision === "terminate"
            ? '<label class="field"><span>Terminate scope</span><select id="action-review-scope"' + disabled + '><option value="branch"' + ((form.fields.scope || "branch") === "branch" ? " selected" : "") + '>branch</option><option value="run"' + (form.fields.scope === "run" ? " selected" : "") + '>run</option></select></label>'
            : ""),
          '</div>',
          '<div class="actions"><button id="action-form-cancel" class="button subtle"' + disabled + '>Cancel</button><button id="action-form-submit" class="button primary"' + disabled + '>Record review decision</button></div>'
        ].join("");
      } else if (form.kind === "saveAs") {
        actionFormEl.innerHTML = [
          '<div class="event"><div class="event-top"><span>save mermaid</span><span>save as</span></div><strong>Write a copy of the current workbench source</strong><div class="hint">Use a project-relative path so the new Mermaid file stays inside the workspace.</div></div>',
          '<label class="field full"><span>Relative path</span><input id="action-save-as-path" value="' + escapeText(form.fields.saveAsPath || "") + '"' + disabled + ' /></label>',
          '<div class="actions"><button id="action-form-cancel" class="button subtle"' + disabled + '>Cancel</button><button id="action-form-submit" class="button primary"' + disabled + '>Save copy</button></div>'
        ].join("");
      } else if (form.kind === "projectLoad") {
        actionFormEl.innerHTML = [
          '<div class="event"><div class="event-top"><span>project load</span><span>workspace</span></div><strong>Rebind the visualizer to another project directory</strong><div class="hint">This swaps project metadata, workbench source, and run list to the selected workdir.</div></div>',
          '<label class="field full"><span>Project workdir</span><input id="action-project-workdir" value="' + escapeText(form.fields.workdir || "") + '"' + disabled + ' /></label>',
          '<div class="actions"><button id="action-form-cancel" class="button subtle"' + disabled + '>Cancel</button><button id="action-form-submit" class="button primary"' + disabled + '>Load project</button></div>'
        ].join("");
      } else if (form.kind === "reindex") {
        actionFormEl.innerHTML = [
          '<div class="event"><div class="event-top"><span>runs index</span><span>maintenance</span></div><strong>Rebuild the persisted run list</strong><div class="hint">Use this after manual filesystem changes or if run headers look stale.</div></div>',
          '<div class="actions"><button id="action-form-cancel" class="button subtle"' + disabled + '>Cancel</button><button id="action-form-submit" class="button warn"' + disabled + '>Rebuild index</button></div>'
        ].join("");
      } else {
        actionFormEl.innerHTML = '<div class="hint">Unsupported action.</div>';
      }
      const cancelButton = document.getElementById("action-form-cancel");
      if (cancelButton) {
        cancelButton.addEventListener("click", () => {
          if (!state.actionBusy) {
            closeActionForm();
          }
        });
      }
      const submitButton = document.getElementById("action-form-submit");
      if (submitButton) {
        submitButton.addEventListener("click", async () => {
          if (!state.actionBusy) {
            await submitCurrentActionForm();
          }
        });
      }
    }

    function renderProject() {
      if (!state.project) {
        projectSummaryEl.textContent = "Project data unavailable.";
        if (opsSummaryEl) opsSummaryEl.innerHTML = '<div class="hint">Ops summary unavailable.</div>';
        if (projectReadinessEl) projectReadinessEl.innerHTML = '<div class="hint">Project readiness unavailable.</div>';
        bindingExplainEl.innerHTML = '<div class="hint">Project binding data unavailable.</div>';
        rolePackagesEl.innerHTML = '<div class="hint">Role package data unavailable.</div>';
        contractExplainEl.innerHTML = '<div class="hint">Contract data unavailable.</div>';
        return;
      }
      if (workdirEl) {
        workdirEl.textContent = state.project.summary?.workdir || workdirEl.textContent;
      }
      const summary = state.project.summary?.project ?? {};
      const roles = state.project.roles?.roles ?? [];
      projectSummaryEl.innerHTML = renderProjectSummaryPanel({
        summary,
        roles,
        warnings: state.project.config?.modelSelectionWarnings ?? [],
        workbenchSavedPath: state.workbenchSavedPath || "system.mmd",
        validationOk: Boolean(state.workbench?.validation?.ok)
      });
      if (opsSummaryEl) {
        opsSummaryEl.innerHTML = renderOpsSummaryPanel({
          opsSummary: state.opsSummary
        });
      }
      if (projectReadinessEl) {
        projectReadinessEl.innerHTML = renderProjectReadinessPanel({
          readiness: state.projectReadiness
        });
      }
      bindingExplainEl.innerHTML = renderBindingExplainPanel({
        bindings: state.bindings,
        stale: false
      });
      rolePackagesEl.innerHTML = renderRolePackagePanel({
        rolePackages: state.rolePackages
      });
      contractExplainEl.innerHTML = renderContractPanel({
        contracts: state.contracts,
        runtimeStatus: state.contractRuntimeStatus
      });
    }

    function bindPanelJumpButtons() {
      const jumpTargets = [
        ["failure-check-input", "failure-detail"],
        ["failure-check-binding", "binding-explain"],
        ["failure-check-role-package", "role-packages"],
        ["failure-check-contract", "contract-explain"],
        ["failure-check-resume", "resume-readiness"]
      ];
      for (const [buttonId, targetId] of jumpTargets) {
        const button = document.getElementById(buttonId);
        if (!button) {
          continue;
        }
        button.addEventListener("click", () => {
          const target = document.getElementById(targetId);
          if (target && typeof target.scrollIntoView === "function") {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      }
    }

    function renderRuns() {
      const term = state.filter.trim().toLowerCase();
      const runs = state.runs.filter((run) => {
        if (!term) return true;
        return [run.runId, run.status, run.finalRoleId, run.lastExecutedRoleId]
          .filter(Boolean)
          .some((item) => String(item).toLowerCase().includes(term));
      });
      if (!runs.length) {
        runListEl.innerHTML = '<div class="hint">No runs match the filter.</div>';
        return;
      }
      runListEl.innerHTML = runs
        .map((run) => \`
          <button class="run-card \${run.runId === state.selectedRunId ? "active" : ""}" data-run-id="\${escapeText(run.runId)}">
            <div class="run-title">
              <span class="truncate" title="\${escapeText(run.runId)}">\${escapeText(run.runId)}</span>
              <span class="status \${statusClass(run.status)}" title="\${escapeText(run.status)}">\${escapeText(run.status)}</span>
            </div>
            <div class="meta">
              <span>transitions \${escapeText(run.transitionCount)}</span>
              <span>updated \${escapeText(formatTime(run.updatedAt))}</span>
            </div>
          </button>
        \`)
        .join("");
      for (const button of runListEl.querySelectorAll("[data-run-id]")) {
        button.disabled = Boolean(state.actionBusy);
        button.addEventListener("click", () => selectRun(button.getAttribute("data-run-id")));
      }
    }

    function renderStats(header, graphPayload) {
      if (!header) {
        statsEl.innerHTML = "";
        return;
      }
      const cards = [
        ["status", header.status],
        ["mode", graphPayload?.simulation?.mode || header.runMode || "runtime"],
        ["transitions", header.transitionCount],
        ["active branches", header.activeBranches],
        ["pending reviews", header.pendingReviewCount],
        ["recent audits", header.recentAudits]
      ];
      statsEl.innerHTML = cards
        .map(([label, value]) => \`
          <div class="stat">
            <strong>\${escapeText(value)}</strong>
            <span>\${escapeText(label)}</span>
          </div>
        \`)
        .join("");
    }

    function renderTimeline(events) {
      const activeFilters = [
        state.timelineRoleId ? "role=" + state.timelineRoleId : "",
        state.timelineType ? "type=" + state.timelineType : "",
        state.timelineStatus ? "status=" + state.timelineStatus : "",
        state.timelineBranchId ? "branch=" + state.timelineBranchId : "",
        state.timelineReviewId ? "review=" + state.timelineReviewId : "",
        state.timelineErrorCode ? "error=" + state.timelineErrorCode : ""
      ].filter(Boolean);
      if (!events.length) {
        timelineEl.innerHTML = activeFilters.length
          ? '<div class="hint">No events match the active filters: ' + escapeText(activeFilters.join(" · ")) + ".</div>"
          : '<div class="hint">No events captured yet.</div>';
        return;
      }
      timelineEl.innerHTML = [
        activeFilters.length
          ? '<div class="hint">filtered by ' + escapeText(activeFilters.join(" · ")) + "</div>"
          : "",
        ...events
          .slice()
          .reverse()
          .map((entry) => {
            const record = entry.record || {};
            const type = record.type || "event";
            const role = record.roleId ? \`<code>\${escapeText(record.roleId)}</code>\` : "";
            const branch = record.branchId ? \`<code>\${escapeText(record.branchId)}</code>\` : "";
            const review = record.reviewId ? \`<code>\${escapeText(record.reviewId)}</code>\` : "";
            const event = record.event ? \`<code>\${escapeText(record.event)}</code>\` : "";
            const status = record.status ? \`<span class="status \${statusClass(record.status)}">\${escapeText(record.status)}</span>\` : "";
            return \`
              <div class="event">
                <div class="event-top">
                  <span>#\${escapeText(entry.cursor)} \${escapeText(type)}</span>
                  <span>\${escapeText(record.at || "")}</span>
                </div>
                <strong>\${role} \${event} \${status}</strong>
                <div class="hint">\${branch} \${review}</div>
              </div>
            \`;
          })
      ].join("");
    }

    function renderGraph() {
      if (!state.graph) {
        graphViewEl.innerHTML = '<div class="hint">No run selected.</div>';
        stateEl.innerHTML = '<div class="hint">No run selected.</div>';
        return;
      }
      const graph = state.graph.graph;
      if (!graph) {
        graphViewEl.innerHTML = '<div class="hint">Graph projection unavailable.</div>';
        stateEl.innerHTML = renderRunStatePanel({
          state: state.detail?.state ?? null,
          header: state.detail?.header ?? null,
          graph: null
        });
        return;
      }
      const nodes = graph.nodes || [];
      const edges = graph.edges || [];
      graphViewEl.innerHTML = [
        '<div class="event"><strong>' + escapeText(graph.systemId || "unknown") + '</strong><div class="hint">entry ' + escapeText(graph.entryRoleId || "n/a") + " · roles " + escapeText(graph.roleCount || 0) + " · flows " + escapeText(graph.flowCount || 0) + "</div></div>",
        renderRunTopologySvg(graph),
        '<div class="event"><div class="event-top"><span>runtime summary</span><span>' + escapeText(nodes.length) + " nodes · " + escapeText(edges.length) + '</span></div><strong>Topology layout with runtime state overlay</strong><div class="hint">Recent paths and error flows stay highlighted without hiding the rest of the graph.</div></div>'
      ].join("");
      stateEl.innerHTML = renderRunStatePanel({
        state: state.detail?.state ?? null,
        header: state.detail?.header ?? null,
        graph
      });
    }

    function describeReviewDecisionPhase(detail) {
      const phase = detail?.decisionPhase || "";
      if (phase === "recorded") {
        return "Decision recorded in the control plane; runtime apply has not been confirmed yet.";
      }
      if (phase === "pending_reconcile") {
        return "Decision has a checkpoint marker but reconcile is still pending.";
      }
      if (phase === "applied") {
        return "Decision applied and reconciled into runtime state.";
      }
      return "No durable decision recorded yet.";
    }

    function describeReviewStatus(detail) {
      const status = detail?.currentStatus || "unknown";
      if (status === "pending") {
        return "Awaiting human decision.";
      }
      if (status === "paused") {
        return "Review is paused and waiting for a follow-up decision.";
      }
      if (status === "expired") {
        return "Review request expired before a durable decision was applied.";
      }
      return "Review state unavailable.";
    }

    function formatReviewDetail(detail) {
      if (!detail) {
        return "No review selected.";
      }
      return [
        "reviewId: " + (detail.reviewId || "n/a"),
        "roleId: " + (detail.roleId || "n/a"),
        "branchId: " + (detail.branchId || "n/a"),
        "round: " + (detail.round ?? "n/a"),
        "status: " + formatReviewStatusLabel(detail.currentStatus),
        "statusSummary: " + describeReviewStatus(detail),
        "decisionPhase: " + formatReviewStatusLabel(detail.decisionPhase || "none"),
        "decisionPhaseSummary: " + describeReviewDecisionPhase(detail),
        "decision: " + (detail.decision || "n/a"),
        "actor: " + (detail.actor || "n/a"),
        "comment: " + (detail.comment || "n/a"),
        "requestedAt: " + (detail.requestedAt || "n/a"),
        "decidedAt: " + (detail.decidedAt || "n/a"),
        "committedAt: " + (detail.committedAt || "n/a"),
        "checkpointSequence: " + (detail.checkpointSequence ?? "n/a"),
        "appliedAt: " + (detail.appliedAt || "n/a"),
        "reconciledAt: " + (detail.reconciledAt || "n/a"),
        "",
        "history:",
        formatJson(detail.history || []),
        "",
        "humanReviewContext:",
        formatJson(detail.humanReviewContext ?? null)
      ].join("\\n");
    }

    function renderReviews() {
      if (!state.reviews?.reviews?.length) {
        reviewsEl.innerHTML = '<div class="hint">No reviews for this run.</div>';
        reviewActionsEl.innerHTML = "";
        reviewDetailEl.innerHTML = '<div class="hint">No review selected.</div>';
        renderActionState();
        return;
      }
      reviewsEl.innerHTML = renderReviewQueuePanel({
        reviews: state.reviews,
        selectedReviewId: state.selectedReviewId
      });
      for (const button of reviewsEl.querySelectorAll("[data-review-id]")) {
        button.disabled = Boolean(state.actionBusy);
        button.addEventListener("click", () => selectReview(state.selectedRunId, button.getAttribute("data-review-id")));
      }
      const detail = state.reviewDetail;
      reviewDetailEl.innerHTML = renderReviewDetailPanel(detail);
      const actionable = detail && (detail.currentStatus === "pending" || detail.currentStatus === "paused");
      reviewActionsEl.innerHTML = actionable
        ? [
          '<button class="button primary" data-review-action="approve">Approve review</button>',
          '<button class="button" data-review-action="rework">Request rework</button>',
          '<button class="button warn" data-review-action="pause">Pause review</button>',
          '<button class="button danger" data-review-action="terminate" data-review-scope="' + escapeText(detail.scope || "branch") + '">Terminate ' + escapeText(detail.scope || "branch") + '</button>'
          ].join("")
        : "";
      for (const button of reviewActionsEl.querySelectorAll("[data-review-action]")) {
        button.addEventListener("click", () =>
          openActionForm("review", {
            reviewId: state.selectedReviewId,
            decision: button.getAttribute("data-review-action"),
            scope: button.getAttribute("data-review-scope") || detail.scope || "branch",
            actor: detail.actor || "visualizer",
            comment: detail.comment || \`recorded via visualizer (\${button.getAttribute("data-review-action")})\`
          })
        );
      }
      renderActionState();
    }

    function renderFailure() {
      if (!state.selectedRunId) {
        failureControlsEl.innerHTML = "";
        failureSummaryEl.innerHTML = '<div class="hint">No run selected.</div>';
        failureDetailEl.innerHTML = '<div class="hint">No run selected.</div>';
        failureNextChecksEl.innerHTML = '<div class="hint">No run selected.</div>';
        return;
      }
      failureControlsEl.innerHTML = [
        '<button class="button subtle" id="refresh-failure"' + (state.actionBusy ? " disabled" : "") + '>Refresh failure</button>',
        state.failureLoaded && state.failureStale ? '<span class="hint">failure data stale</span>' : ""
      ].filter(Boolean).join("");
      const refreshFailureButton = document.getElementById("refresh-failure");
      if (refreshFailureButton) {
        refreshFailureButton.addEventListener("click", async () => {
          await loadFailure(state.selectedRunId, { force: true });
        });
      }
      failureSummaryEl.innerHTML = renderFailureSummaryPanel({
        failure: state.failure,
        loaded: state.failureLoaded,
        stale: state.failureStale
      });
      failureDetailEl.innerHTML = renderFailureDetailPanel({
        failure: state.failure,
        loaded: state.failureLoaded
      });
      failureNextChecksEl.innerHTML = renderSuggestedNextChecksPanel({
        failure: state.failure,
        loaded: state.failureLoaded
      });
      bindPanelJumpButtons();
    }

    function renderResumeDiagnostics() {
      const controls = [];
      if (!state.selectedRunId) {
        resumeControlsEl.innerHTML = "";
        resumeReadinessEl.innerHTML = '<div class="hint">No run selected.</div>';
        resumeEl.innerHTML = '<div class="hint">No run selected.</div>';
        return;
      }
      controls.push('<button class="button subtle" id="refresh-readiness"' + (state.actionBusy ? " disabled" : "") + '>Refresh readiness</button>');
      controls.push('<button class="button" id="load-diagnostics">' + (state.resumeDiagnosticsLoaded ? "Refresh diagnostics" : "Load diagnostics") + '</button>');
      if (state.resumeReadinessLoaded && state.resumeReadinessStale) {
        controls.push('<span class="hint">readiness stale</span>');
      }
      if (state.resumeDiagnosticsLoaded && state.resumeDiagnosticsStale) {
        controls.push('<span class="hint">diagnostics stale</span>');
      }
      resumeControlsEl.innerHTML = controls.join("");
      const refreshReadinessButton = document.getElementById("refresh-readiness");
      if (refreshReadinessButton) {
        refreshReadinessButton.addEventListener("click", async () => {
          await loadResumeReadiness(state.selectedRunId, { force: true });
        });
      }
      const loadDiagnosticsButton = document.getElementById("load-diagnostics");
      if (loadDiagnosticsButton) {
        loadDiagnosticsButton.disabled = Boolean(state.actionBusy);
        loadDiagnosticsButton.addEventListener("click", async () => {
          await loadResumeDiagnostics(state.selectedRunId, { force: true });
        });
      }
      resumeReadinessEl.innerHTML = renderResumeReadinessPanel({
        readiness: state.resumeReadiness,
        loaded: state.resumeReadinessLoaded,
        stale: state.resumeReadinessStale,
        diagnostics: state.resumeDiagnosticsLoaded ? state.resumeDiagnostics : null
      });
      if (!state.resumeDiagnosticsLoaded) {
        resumeEl.innerHTML = '<div class="hint">Resume diagnostics are loaded on demand.</div>';
        return;
      }
      if (!state.resumeDiagnostics) {
        resumeEl.innerHTML = '<div class="hint">Resume diagnostics unavailable.</div>';
        return;
      }
      const checks = state.resumeDiagnostics.checks || [];
      const recommendations = state.resumeDiagnostics.recommendations || [];
      resumeEl.innerHTML = [
        ...checks.map((check) =>
          '<div class="event">' +
            '<div class="event-top">' +
              "<span>" + escapeText(check.label) + "</span>" +
              '<span class="status ' + statusClass(check.ok ? "done" : check.severity === "warning" ? "waiting_review" : "failed") + '">' + escapeText(check.severity) + "</span>" +
            "</div>" +
            "<strong>" + escapeText(check.ok ? "ok" : "attention") + "</strong>" +
            '<div class="hint">' + escapeText(check.message || "") + "</div>" +
          "</div>"
        ),
        ...(recommendations.length > 0
          ? recommendations.map((recommendation) =>
              '<div class="event">' +
                '<div class="event-top"><span>next action</span><span>' + escapeText(recommendation.action) + "</span></div>" +
                "<strong>" + escapeText(recommendation.label) + "</strong>" +
              "</div>"
            )
          : ['<div class="hint">No additional recovery recommendations.</div>'])
      ].join("");
    }

    function renderLogs() {
      if (!state.selectedRunId) {
        logsControlsEl.innerHTML = "";
        logsFiltersEl.textContent = "No run selected.";
        logsEl.innerHTML = '<div class="hint">No run selected.</div>';
        return;
      }
      logsControlsEl.innerHTML = '<button id="load-logs" class="button subtle"' + (state.actionBusy ? " disabled" : "") + '>' + (state.logsLoaded ? "Refresh logs" : "Load logs") + '</button>';
      const loadLogsButton = document.getElementById("load-logs");
      if (loadLogsButton) {
        loadLogsButton.addEventListener("click", async () => {
          await loadSelectedLogs(state.selectedRunId, { force: true });
        });
      }
      logsFiltersEl.textContent = "role=" + (state.selectedLogRoleId || "latest") + " tail=" + (state.logTail || "all") + " since=" + (state.logSince || "n/a") + (state.logsStale ? " · stale" : "");
      logsEl.innerHTML = renderLogsPanel({
        loaded: state.logsLoaded,
        stale: state.logsStale,
        selectedRoleId: state.selectedLogRoleId || state.detail?.header?.lastExecutedRoleId || "",
        engine: state.engineLogs,
        role: state.roleLogs
      });
    }

    function renderDetail() {
      detailEl.innerHTML = renderArtifactsPanel({
        detail: state.detail,
        graph: state.graph,
        reviews: state.reviews,
        reviewDetail: state.reviewDetail,
        resumeDiagnostics: state.resumeDiagnosticsLoaded ? state.resumeDiagnostics : null
      });
    }

    function renderSelectedRun() {
      const detail = state.detail;
      const header = detail?.header || null;
      const graphPayload = state.graph;
      if (!detail || !header || state.projectHome) {
        selectedTitleEl.textContent = "Project Overview";
        selectedSubtitleEl.textContent = "Use query-state deep links or the run list to switch between project, run, and review details.";
      } else {
        const simulation = graphPayload?.simulation?.isSimulation ? "simulation" : "runtime";
        selectedTitleEl.textContent = graphPayload?.simulation?.isSimulation ? \`\${detail.runId} [simulation]\` : detail.runId;
        selectedSubtitleEl.textContent = state.selectedReviewId
          ? \`\${detail.runDir} · \${simulation} · review \${state.selectedReviewId}\`
          : \`\${detail.runDir} · \${simulation}\`;
      }
      renderWorkbench();
      renderActionForm();
      renderStats(header, graphPayload);
      renderFailure();
      renderTimeline(state.events);
      renderGraph();
      renderReviews();
      renderResumeDiagnostics();
      renderLogs();
      renderDetail();
      renderActionState();
    }

    function stopStream() {
      if (state.stream) {
        state.stream.close();
        state.stream = null;
      }
    }

    function populateLogRoleOptions(graphPayload, fallbackRoleId) {
      const roleIds = (graphPayload?.graph?.nodes || []).map((node) => node.roleId).filter(Boolean);
      const selected = state.selectedLogRoleId || fallbackRoleId || "";
      const options = ['<option value="">Latest role</option>']
        .concat(roleIds.map((roleId) => \`<option value="\${escapeText(roleId)}" \${roleId === selected ? "selected" : ""}>\${escapeText(roleId)}</option>\`));
      logRoleEl.innerHTML = options.join("");
      state.selectedLogRoleId = selected;
    }

    function populateTimelineRoleOptions(graphPayload) {
      const roleIds = (graphPayload?.graph?.nodes || []).map((node) => node.roleId).filter(Boolean);
      if (state.timelineRoleId && !roleIds.includes(state.timelineRoleId)) {
        state.timelineRoleId = "";
      }
      const options = ['<option value="">All roles</option>']
        .concat(roleIds.map((roleId) => \`<option value="\${escapeText(roleId)}" \${roleId === state.timelineRoleId ? "selected" : ""}>\${escapeText(roleId)}</option>\`));
      if (timelineRoleEl) {
        timelineRoleEl.innerHTML = options.join("");
      }
      syncTimelineFilterInputs();
    }

    async function reloadTimeline(runId) {
      if (!runId) {
        state.events = [];
        state.eventCursor = 0;
        renderTimeline(state.events);
        return;
      }
      const eventsPayload = await requestJson(buildTimelineQuery(runId, { cursor: 0, limit: 250 }));
      state.events = eventsPayload.events || [];
      state.eventCursor = eventsPayload.nextCursor || 0;
      renderTimeline(state.events);
      renderDetail();
    }

    async function refreshProjectDiagnostics() {
      const [summary, config, roles, opsSummary, readiness, bindings, contracts, rolePackages] = await Promise.all([
        requestJson(\`\${API_PREFIX}/project\`),
        requestJson(\`\${API_PREFIX}/project/config\`),
        requestJson(\`\${API_PREFIX}/project/roles\`),
        requestJson(\`\${API_PREFIX}/project/ops-summary\`),
        requestJson(\`\${API_PREFIX}/project/readiness\`),
        requestJson(\`\${API_PREFIX}/project/bindings\`),
        requestJson(\`\${API_PREFIX}/project/contracts\`),
        requestJson(\`\${API_PREFIX}/project/role-packages\`)
      ]);
      state.project = Object.assign({}, state.project || {}, { summary, config, roles });
      state.opsSummary = opsSummary;
      state.projectReadiness = readiness;
      state.bindings = bindings;
      state.contracts = contracts;
      state.rolePackages = rolePackages;
      renderProject();
    }

    async function refreshStudioBridge() {
      const payload = await requestAction(\`\${API_PREFIX}/project/studio/bridge\`, {
        systemSource: state.workbenchSource,
        systemPath: state.workbenchSavedPath || "system.mmd"
      });
      state.studioBridge = payload;
      state.studioBridgeLoaded = true;
      state.studioBridgeStale = false;
      const roles = payload.extracted?.roles || [];
      const flows = payload.extracted?.flows || [];
      if (!state.studioBridgeSelectedRoleId && roles[0]?.roleId) {
        state.studioBridgeSelectedRoleId = roles[0].roleId;
      }
      if (!state.studioBridgeSelectedFlowKey && flows[0]?.flowKey) {
        state.studioBridgeSelectedFlowKey = flows[0].flowKey;
      }
      state.workbench = {
        ...(state.workbench || {}),
        validation: payload.validation || state.workbench?.validation
      };
      renderWorkbench();
      renderProject();
    }

    async function saveStudioAuthoringDraft() {
      if (!state.studioBridge?.authoring) {
        await refreshStudioBridge();
      }
      if (!state.studioBridge?.authoring) {
        setFlash("error", "Studio Bridge cannot save a draft until Mermaid parses successfully.");
        return;
      }
      await runAction("studio:draft-save", async () => {
        const payload = await requestAction(\`\${API_PREFIX}/project/studio/authoring\`, {
          authoring: state.studioBridge.authoring
        });
        setFlash("success", "Studio draft saved to " + relativeToWorkdir(payload.draftPath || ".ogs/studio/system.authoring.json") + ".");
      });
    }

    async function generateMmdFromStudioBridge() {
      if (!state.studioBridge?.authoring) {
        await refreshStudioBridge();
      }
      if (!state.studioBridge?.authoring) {
        setFlash("error", "Studio Bridge cannot generate Mermaid until the source parses successfully.");
        return;
      }
      await runAction("studio:generate-mmd", async () => {
        const payload = await requestAction(\`\${API_PREFIX}/project/studio/authoring/generate-mmd\`, {
          authoring: state.studioBridge.authoring
        });
        state.workbenchSource = payload.systemSource || state.workbenchSource;
        state.workbenchView = "source";
        state.workbench = {
          ...(state.workbench || {}),
          validation: payload.validation || state.workbench?.validation
        };
        state.studioBridgeStale = true;
        persistDraftSource(state.workbenchSource !== state.workbenchDiskSource ? state.workbenchSource : "");
        renderWorkbench();
        setFlash("success", "Generated deterministic Mermaid into the Workbench source view.");
      });
    }

    async function runWorkbenchValidation(force) {
      const requestId = ++state.workbenchValidationRequestId;
      state.workbenchValidating = true;
      renderWorkbench({ preserveEditor: true });
      try {
        const payload = await requestAction(\`\${API_PREFIX}/project/system/validate\`, {
          systemSource: state.workbenchSource,
          systemPath: state.workbenchSavedPath
        });
        if (requestId !== state.workbenchValidationRequestId && !force) {
          return;
        }
        state.workbench = {
          ...(state.workbench || {}),
          validation: payload
        };
        state.studioBridgeStale = true;
      } finally {
        if (requestId === state.workbenchValidationRequestId) {
          state.workbenchValidating = false;
        }
        renderWorkbench({ preserveEditor: true });
        renderProject();
      }
    }

    function scheduleWorkbenchValidation() {
      clearTimeout(state.workbenchValidationTimer);
      state.workbenchValidationTimer = setTimeout(() => {
        void runWorkbenchValidation(false).catch((error) => {
          state.workbenchValidating = false;
          setFlash("error", "Workbench validation failed: " + (error.message || error));
          renderWorkbench({ preserveEditor: true });
        });
      }, 250);
    }

    async function loadWorkbench() {
      const payload = await requestJson(\`\${API_PREFIX}/project/system/workbench\`);
      state.workbench = payload;
      if (workdirEl && payload.workdir) {
        workdirEl.textContent = payload.workdir;
      }
      state.workbenchDiskSource = payload.systemSource || "";
      state.workbenchSavedPath = relativeToWorkdir(payload.systemPath || "system.mmd") || "system.mmd";
      const draft = loadDraftSource();
      state.workbenchSource = draft || state.workbenchDiskSource;
      state.workbenchHasDraft = Boolean(draft);
      renderWorkbench();
      if (draft) {
        await runWorkbenchValidation(true);
      }
    }

    async function saveWorkbench() {
      await runAction("workbench:save", async () => {
        const payload = await requestAction(
          \`\${API_PREFIX}/project/system/save\`,
          {
            systemSource: state.workbenchSource
          }
        );
        if (payload.validation?.ok !== true) {
          state.workbench = {
            ...(state.workbench || {}),
            validation: payload.validation
          };
          renderWorkbench();
          renderProject();
          setFlash("error", "Save blocked by Mermaid validation diagnostics.");
          return;
        }
        state.workbenchDiskSource = state.workbenchSource;
        state.workbenchSavedPath = relativeToWorkdir(payload.savedPath || state.workbenchSavedPath || "system.mmd") || "system.mmd";
        state.workbench = {
          ...(state.workbench || {}),
          validation: payload.validation
        };
        state.studioBridgeStale = true;
        persistDraftSource("");
        renderWorkbench();
        await refreshProjectDiagnostics();
        setFlash(
          "success",
          "Mermaid source saved to " + state.workbenchSavedPath + ". "
            + (payload.followUpActions?.map((item) => item.label).join(" ") || "Consider project sync, sync-models, or a new run for verification.")
        );
      });
    }

    async function saveWorkbenchAs(saveAsPath) {
      if (!saveAsPath) {
        setFlash("error", "A relative save path is required.");
        return;
      }
      await runAction("workbench:save-as", async () => {
        const payload = await requestAction(\`\${API_PREFIX}/project/system/save-as\`, {
          systemSource: state.workbenchSource,
          saveAsPath
        });
        if (payload.validation?.ok !== true) {
          state.workbench = {
            ...(state.workbench || {}),
            validation: payload.validation
          };
          renderWorkbench();
          renderProject();
          setFlash("error", "Save copy blocked by Mermaid validation diagnostics.");
          return;
        }
        state.workbenchDiskSource = state.workbenchSource;
        state.workbenchSavedPath = relativeToWorkdir(payload.savedPath || saveAsPath || "system.mmd") || "system.mmd";
        state.workbench = {
          ...(state.workbench || {}),
          validation: payload.validation
        };
        state.studioBridgeStale = true;
        persistDraftSource("");
        closeActionForm();
        renderWorkbench();
        await refreshProjectDiagnostics();
        setFlash(
          "success",
          "Mermaid source saved to " + state.workbenchSavedPath + ". "
            + (payload.followUpActions?.map((item) => item.label).join(" ") || "Consider project sync, sync-models, or a new run for verification.")
        );
      });
    }

    async function startRunFromWorkbench(args) {
      if (!args.input) {
        setFlash("error", "Run input is required.");
        return;
      }
      const readinessBlockers = state.projectReadiness?.blockers || [];
      if (args.dryRun && state.projectReadiness && state.projectReadiness.canDryRun === false) {
        setFlash("error", "Dry-run blocked by Project Readiness: " + (readinessBlockers[0]?.message || "resolve readiness blockers first."));
        state.consoleTab = "project";
        renderConsoleTabs();
        return;
      }
      await runAction("run:start", async () => {
        const payload = await requestAction(\`\${API_PREFIX}/runs/start\`, {
          systemPath: args.systemPath,
          input: args.input,
          dryRun: args.dryRun,
          runtimePath: args.runtimePath || undefined,
          userProfilePath: args.userProfilePath || undefined,
          lawsPath: args.lawsPath || undefined
        });
        closeActionForm();
        setFlash("success", "Start completed for " + payload.runId + " (" + payload.status + ").");
        if (args.dryRun && payload.runId) {
          state.studioBridgeLastDryRunId = payload.runId;
        }
        await loadProject();
        await loadRuns();
        if (payload.runId) {
          await selectRun(payload.runId);
        }
      });
    }

    async function resumeSelectedRun(args) {
      if (!state.selectedRunId) {
        return;
      }
      await runAction("run:resume", async () => {
        const payload = await requestAction(
          \`\${API_PREFIX}/runs/\${encodeURIComponent(state.selectedRunId)}/resume\`,
          {
            systemPath: args.systemPath || undefined,
            input: args.input || undefined,
            dryRun: args.dryRun,
            runtimePath: args.runtimePath || undefined,
            userProfilePath: args.userProfilePath || undefined,
            lawsPath: args.lawsPath || undefined
          }
        );
        closeActionForm();
        setFlash("success", "Resume finished for " + payload.runId + " (" + payload.status + ").");
        await loadProject();
        await loadRuns();
        await loadSelectedRunBoot(payload.runId, { keepStream: false });
      });
    }

    async function submitCurrentActionForm() {
      const form = state.actionForm;
      if (!form) {
        return;
      }
      if (form.kind === "start") {
        const payload = {
          systemPath: readActionFieldValue("action-start-system-path") || state.workbenchSavedPath || "system.mmd",
          input: readActionFieldValue("action-start-input"),
          dryRun: readActionFieldValue("action-start-dry-run") !== "false",
          runtimePath: readActionFieldValue("action-start-runtime-path"),
          userProfilePath: readActionFieldValue("action-start-user-profile-path"),
          lawsPath: readActionFieldValue("action-start-laws-path")
        };
        state.actionForm.fields = Object.assign({}, form.fields, payload);
        await startRunFromWorkbench(payload);
        return;
      }
      if (form.kind === "resume") {
        const payload = {
          systemPath: readActionFieldValue("action-resume-system-path"),
          input: readActionFieldValue("action-resume-input"),
          dryRun: readActionFieldValue("action-resume-dry-run") === "true",
          runtimePath: readActionFieldValue("action-resume-runtime-path"),
          userProfilePath: readActionFieldValue("action-resume-user-profile-path"),
          lawsPath: readActionFieldValue("action-resume-laws-path")
        };
        state.actionForm.fields = Object.assign({}, form.fields, payload);
        await resumeSelectedRun(payload);
        return;
      }
      if (form.kind === "stop") {
        const payload = {
          reason: readActionFieldValue("action-stop-reason") || "requested via visualizer"
        };
        state.actionForm.fields = Object.assign({}, form.fields, payload);
        await submitStopRequest(payload);
        return;
      }
      if (form.kind === "review") {
        const payload = {
          decision: form.fields.decision,
          scope: form.fields.decision === "terminate"
            ? readActionFieldValue("action-review-scope") || form.fields.scope || "branch"
            : undefined,
          actor: readActionFieldValue("action-review-actor") || "visualizer",
          comment: readActionFieldValue("action-review-comment") || \`recorded via visualizer (\${form.fields.decision})\`
        };
        state.actionForm.fields = Object.assign({}, form.fields, payload);
        await submitReviewDecision(payload);
        return;
      }
      if (form.kind === "saveAs") {
        const payload = {
          saveAsPath: readActionFieldValue("action-save-as-path")
        };
        state.actionForm.fields = Object.assign({}, form.fields, payload);
        await saveWorkbenchAs(payload.saveAsPath);
        return;
      }
      if (form.kind === "projectLoad") {
        const payload = {
          workdir: readActionFieldValue("action-project-workdir")
        };
        state.actionForm.fields = Object.assign({}, form.fields, payload);
        await rebindProject(payload.workdir);
        return;
      }
      if (form.kind === "reindex") {
        await reindexRuns();
      }
    }

    async function rebindProject(target) {
      if (!target) {
        setFlash("error", "Project workdir is required.");
        return;
      }
      await runAction("project:load", async () => {
        const payload = await requestAction(\`\${API_PREFIX}/project/load\`, { workdir: target });
        closeActionForm();
        setFlash("success", "Project rebound to " + payload.workdir + ".");
        setSidebarOpen(false);
        await loadProject();
        await loadRuns();
        selectProjectHome();
      });
    }

    async function reindexRuns() {
      await runAction("reindex", async () => {
        const payload = await requestAction(\`\${API_PREFIX}/runs/reindex\`);
        state.runs = payload.runs || [];
        closeActionForm();
        renderRuns();
        setFlash("success", "Runs index rebuilt.");
      });
    }

    async function exportProject() {
      await runAction("project:export", async () => {
        const payload = await requestAction(\`\${API_PREFIX}/project/export\`);
        const blob = new Blob([JSON.stringify(payload, null, 2) + "\\n"], { type: "application/json" });
        const anchor = document.createElement("a");
        anchor.href = URL.createObjectURL(blob);
        anchor.download = "ogs-project-export-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".json";
        anchor.click();
        URL.revokeObjectURL(anchor.href);
        setFlash("success", "Project export generated. It excludes .ogs/runs and runtime artifacts.");
      });
    }

    async function loadProject() {
      const [summary, system, config, roles, opsSummary, readiness, bindings, contracts, rolePackages] = await Promise.all([
        requestJson(\`\${API_PREFIX}/project\`),
        requestJson(\`\${API_PREFIX}/project/system\`),
        requestJson(\`\${API_PREFIX}/project/config\`),
        requestJson(\`\${API_PREFIX}/project/roles\`),
        requestJson(\`\${API_PREFIX}/project/ops-summary\`),
        requestJson(\`\${API_PREFIX}/project/readiness\`),
        requestJson(\`\${API_PREFIX}/project/bindings\`),
        requestJson(\`\${API_PREFIX}/project/contracts\`),
        requestJson(\`\${API_PREFIX}/project/role-packages\`)
      ]);
      state.project = { summary, system, config, roles };
      state.opsSummary = opsSummary;
      state.projectReadiness = readiness;
      state.bindings = bindings;
      state.contracts = contracts;
      state.rolePackages = rolePackages;
      await loadWorkbench();
      renderProject();
    }

    async function loadRuns() {
      const payload = await requestJson(\`\${API_PREFIX}/runs\`);
      state.runs = payload.runs || [];
      renderRuns();
      if (!state.projectHome && !state.selectedRunId && state.runs.length) {
        await selectRun(state.runs[0].runId);
      }
      if (!state.runs.length) {
        setLive("idle", "no runs");
      }
    }

    async function loadRoleLogs(runId, roleId) {
      if (!roleId) {
        state.roleLogs = [];
        return;
      }
      const roleLogsPayload = await requestJson(buildLogsQuery(runId, { roleId }));
      state.roleLogs = roleLogsPayload.records || [];
    }

    async function loadEngineLogs(runId) {
      const engineLogsPayload = await requestJson(buildLogsQuery(runId, { engine: true }));
      state.engineLogs = engineLogsPayload.records || [];
    }

    async function loadSelectedLogs(runId, options) {
      if (!runId) {
        return;
      }
      const load = async () => {
        const fallbackRoleId = state.detail?.header?.lastExecutedRoleId || state.detail?.header?.finalRoleId || "";
        await Promise.all([
          loadEngineLogs(runId),
          loadRoleLogs(runId, state.selectedLogRoleId || fallbackRoleId)
        ]);
        state.logsLoaded = true;
        state.logsStale = false;
        renderLogs();
      };
      if (options?.internal) {
        await load();
        return;
      }
      await runAction(options?.force ? "logs:refresh" : "logs:load", load);
    }

    async function refreshSelectedReviewDetail(runId, options) {
      if (!state.selectedReviewId) {
        state.reviewDetail = null;
        renderReviews();
        renderDetail();
        writeRouteToLocation();
        return;
      }
      try {
        state.reviewDetail = await requestJson(
          \`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/reviews/\${encodeURIComponent(state.selectedReviewId)}\`
        );
      } catch (error) {
        if (options?.allowMissing) {
          state.reviewDetail = null;
          state.selectedReviewId = "";
        } else {
          throw error;
        }
      }
      renderReviews();
      renderDetail();
      writeRouteToLocation();
    }

    async function refreshReviews(runId) {
      const reviewsPayload = await requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/reviews\`);
      state.reviews = reviewsPayload;
      const exists = (reviewsPayload.reviews || []).some((review) => review.reviewId === state.selectedReviewId);
      if (!state.selectedReviewId || !exists) {
        state.selectedReviewId = reviewsPayload.latestPendingReviewId || reviewsPayload.reviews?.[0]?.reviewId || "";
      }
      await refreshSelectedReviewDetail(runId, { allowMissing: true });
      renderSelectedRun();
      writeRouteToLocation();
    }

    async function refreshRunDetailAndGraph(runId) {
      const [detail, graphPayload, contractRuntimeStatus] = await Promise.all([
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}\`),
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/graph\`),
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/contracts\`).catch(() => null)
      ]);
      state.detail = detail;
      state.graph = graphPayload;
      state.contractRuntimeStatus = contractRuntimeStatus;
      upsertRunFromHeader(detail.header);
      const fallbackRoleId = detail.header?.lastExecutedRoleId || detail.header?.finalRoleId || "";
      populateLogRoleOptions(graphPayload, fallbackRoleId);
      populateTimelineRoleOptions(graphPayload);
      renderSelectedRun();
      renderRuns();
      renderProject();
      writeRouteToLocation();
      const status = detail.header?.status || "unknown";
      const hasWaitingHumanReview = Boolean(detail.header?.hasWaitingHumanReview);
      if (hasWaitingHumanReview) {
        setLive("idle", "waiting_review");
      } else {
        setLive(status === "running" || status === "stopping" ? "online" : "idle", status);
      }
    }

    async function loadFailure(runId, options) {
      if (!runId) {
        return;
      }
      if (state.actionBusy && !options?.internal) {
        return;
      }
      if (state.failureLoaded && !state.failureStale && !options?.force) {
        return;
      }
      try {
        state.failure = await requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/failure\`);
        state.failureLoaded = true;
        state.failureStale = false;
      } catch (error) {
        state.failure = null;
        state.failureLoaded = true;
        if (!options?.suppressFlash) {
          setFlash("error", "Failed to load failure triage: " + (error.message || error));
        }
      }
      renderFailure();
    }

    async function loadResumeReadiness(runId, options) {
      if (!runId) {
        return;
      }
      if (state.actionBusy && !options?.internal) {
        return;
      }
      if (state.resumeReadinessLoaded && !state.resumeReadinessStale && !options?.force) {
        return;
      }
      try {
        state.resumeReadiness = await requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/resume-readiness\`);
        state.resumeReadinessLoaded = true;
        state.resumeReadinessStale = false;
      } catch (error) {
        state.resumeReadiness = null;
        state.resumeReadinessLoaded = true;
        if (!options?.suppressFlash) {
          setFlash("error", "Failed to load resume readiness: " + (error.message || error));
        }
      }
      renderResumeDiagnostics();
      renderDetail();
    }

    async function loadResumeDiagnostics(runId, options) {
      if (!runId) {
        return;
      }
      if (state.actionBusy && !options?.internal) {
        return;
      }
      if (state.resumeDiagnosticsLoaded && !state.resumeDiagnosticsStale && !options?.force) {
        return;
      }
      try {
        const payload = await requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/resume-diagnostics\`);
        state.resumeDiagnostics = payload;
        state.resumeDiagnosticsLoaded = true;
        state.resumeDiagnosticsStale = false;
        renderResumeDiagnostics();
        renderDetail();
      } catch (error) {
        setFlash("error", "Failed to load resume diagnostics: " + (error.message || error));
      }
    }

    async function loadSelectedRunBoot(runId, options) {
      const [detail, eventsPayload, graphPayload, reviewsPayload, contractRuntimeStatus] = await Promise.all([
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}\`),
        requestJson(buildTimelineQuery(runId, { cursor: 0, limit: 250 })),
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/graph\`),
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/reviews\`),
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/contracts\`).catch(() => null)
      ]);

      state.detail = detail;
      state.events = eventsPayload.events || [];
      state.eventCursor = eventsPayload.nextCursor || 0;
      state.graph = graphPayload;
      state.reviews = reviewsPayload;
      state.contractRuntimeStatus = contractRuntimeStatus;
      state.failure = null;
      state.failureLoaded = false;
      state.failureStale = false;
      state.resumeReadiness = null;
      state.resumeReadinessLoaded = false;
      state.resumeReadinessStale = false;
      state.resumeDiagnostics = null;
      state.resumeDiagnosticsLoaded = false;
      state.resumeDiagnosticsStale = false;
      state.engineLogs = [];
      state.roleLogs = [];
      state.logsLoaded = false;
      state.logsStale = false;
      upsertRunFromHeader(detail.header);
      const fallbackRoleId = detail.header?.lastExecutedRoleId || detail.header?.finalRoleId || "";
      if (!state.selectedReviewId) {
        state.selectedReviewId = reviewsPayload.latestPendingReviewId || "";
      }
      await refreshSelectedReviewDetail(runId, { allowMissing: true });
      populateLogRoleOptions(graphPayload, fallbackRoleId);
      populateTimelineRoleOptions(graphPayload);
      renderSelectedRun();
      renderRuns();
      renderProject();
      writeRouteToLocation();

      if (!options || !options.keepStream) {
        stopStream();
        connectStream(runId, state.eventCursor);
      }
      await Promise.allSettled([
        loadFailure(runId, { force: true, internal: true, suppressFlash: true }),
        loadResumeReadiness(runId, { force: true, internal: true, suppressFlash: true })
      ]);
      const status = detail.header?.status || "unknown";
      const hasWaitingHumanReview = Boolean(detail.header?.hasWaitingHumanReview);
      if (hasWaitingHumanReview) {
        setLive("idle", "waiting_review");
      } else {
        setLive(status === "running" || status === "stopping" ? "online" : "idle", status);
      }
    }

    async function selectRun(runId) {
      if (!runId) return;
      state.projectHome = false;
      if (state.consoleTab === "project") {
        state.consoleTab = "debug";
        renderConsoleTabs();
      }
      state.selectedRunId = runId;
      state.selectedReviewId = "";
      closeActionForm();
      setSidebarOpen(false);
      renderRuns();
      await loadSelectedRunBoot(runId, { keepStream: false });
    }

    function selectProjectHome() {
      stopStream();
      state.projectHome = true;
      state.consoleTab = "project";
      state.selectedRunId = "";
      state.selectedReviewId = "";
      state.detail = null;
      state.graph = null;
      state.contractRuntimeStatus = null;
      state.failure = null;
      state.failureLoaded = false;
      state.failureStale = false;
      state.reviews = null;
      state.reviewDetail = null;
      state.resumeReadiness = null;
      state.resumeReadinessLoaded = false;
      state.resumeReadinessStale = false;
      state.resumeDiagnostics = null;
      state.resumeDiagnosticsLoaded = false;
      state.resumeDiagnosticsStale = false;
      state.events = [];
      state.engineLogs = [];
      state.roleLogs = [];
      state.logsLoaded = false;
      state.logsStale = false;
      closeActionForm();
      syncTimelineFilterInputs();
      renderSelectedRun();
      renderConsoleTabs();
      renderRuns();
      writeRouteToLocation();
      setLive("idle", "project");
    }

    async function selectReview(runId, reviewId) {
      if (!runId || !reviewId) {
        return;
      }
      if (state.selectedRunId !== runId) {
        state.selectedRunId = runId;
      }
      state.projectHome = false;
      state.selectedReviewId = reviewId;
      closeActionForm();
      await refreshSelectedReviewDetail(runId, { allowMissing: false });
      renderSelectedRun();
      writeRouteToLocation();
    }

    async function runAction(actionId, fn) {
      if (state.actionBusy) {
        return;
      }
      setActionBusy(actionId);
      try {
        await fn();
      } catch (error) {
        setFlash("error", error instanceof Error ? error.message : String(error));
      } finally {
        setActionBusy("");
      }
    }

    async function submitReviewDecision(args) {
      if (!state.selectedRunId || !state.selectedReviewId) {
        return;
      }
      await runAction("review:" + args.decision, async () => {
        const payload = await requestAction(
          \`\${API_PREFIX}/runs/\${encodeURIComponent(state.selectedRunId)}/reviews/\${encodeURIComponent(state.selectedReviewId)}/decide\`,
          {
            decision: args.decision,
            scope: args.decision === "terminate" ? args.scope : undefined,
            actor: args.actor,
            comment: args.comment
          }
        );
        state.resumeDiagnosticsStale = true;
        closeActionForm();
        setFlash(
          "success",
          'Review action recorded for ' + state.selectedReviewId + ': ' + (payload.semanticStatus || args.decision) + '. '
            + (payload.detail?.note || "")
        );
        await refreshRunDetailAndGraph(state.selectedRunId);
        await refreshReviews(state.selectedRunId);
        state.resumeReadinessStale = state.resumeReadinessLoaded || state.resumeReadinessStale;
        await loadResumeReadiness(state.selectedRunId, { force: true, internal: true });
      });
    }

    async function submitStopRequest(args) {
      if (!state.selectedRunId) {
        return;
      }
      await runAction("stop", async () => {
        const payload = await requestAction(
          \`\${API_PREFIX}/runs/\${encodeURIComponent(state.selectedRunId)}/stop\`,
          { reason: args.reason }
        );
        state.resumeDiagnosticsStale = true;
        closeActionForm();
        const detail = payload.detail || {};
        setFlash(
          "success",
          "Stop request recorded for " + state.selectedRunId
            + ". request=" + (detail.requestRecorded ? "yes" : "no")
            + " outcome=" + (detail.stopOutcomeApplied ? "applied" : "pending")
            + " status=" + (detail.runStatus || "unknown")
            + " converged=" + (detail.converged ? "yes" : "no")
        );
        await refreshRunDetailAndGraph(state.selectedRunId);
        await loadFailure(state.selectedRunId, { force: true, internal: true });
        await loadResumeReadiness(state.selectedRunId, { force: true, internal: true });
      });
    }

    function mergeStreamRefreshPlan(nextPlan) {
      state.streamRefreshPlan = {
        detailGraph: state.streamRefreshPlan.detailGraph || nextPlan.detailGraph,
        reviews: state.streamRefreshPlan.reviews || nextPlan.reviews,
        reviewDetail: state.streamRefreshPlan.reviewDetail || nextPlan.reviewDetail,
        failure: state.streamRefreshPlan.failure || nextPlan.failure,
        resumeReadiness: state.streamRefreshPlan.resumeReadiness || nextPlan.resumeReadiness,
        markDiagnosticsStale: state.streamRefreshPlan.markDiagnosticsStale || nextPlan.markDiagnosticsStale
      };
    }

    async function flushStreamRefresh() {
      if (state.streamRefreshInFlight || !state.selectedRunId) {
        return;
      }
      const plan = state.streamRefreshPlan;
      state.streamRefreshPlan = {
        detailGraph: false,
        reviews: false,
        reviewDetail: false,
        failure: false,
        resumeReadiness: false,
        markDiagnosticsStale: false
      };
      if (plan.failure) {
        state.failureStale = state.failureLoaded || state.failureStale;
      }
      if (plan.resumeReadiness) {
        state.resumeReadinessStale = state.resumeReadinessLoaded || state.resumeReadinessStale;
      }
      if (plan.markDiagnosticsStale) {
        state.resumeDiagnosticsStale = state.resumeDiagnosticsLoaded || state.resumeDiagnosticsStale;
        state.logsStale = state.logsLoaded || state.logsStale;
        renderFailure();
        renderResumeDiagnostics();
        renderLogs();
        renderDetail();
      }
      if (!plan.detailGraph && !plan.reviews && !plan.reviewDetail && !plan.failure && !plan.resumeReadiness) {
        return;
      }
      state.streamRefreshInFlight = true;
      try {
        await Promise.all([
          plan.detailGraph ? refreshRunDetailAndGraph(state.selectedRunId) : Promise.resolve(),
          plan.failure ? loadFailure(state.selectedRunId, { force: true, internal: true, suppressFlash: true }) : Promise.resolve(),
          plan.resumeReadiness ? loadResumeReadiness(state.selectedRunId, { force: true, internal: true, suppressFlash: true }) : Promise.resolve()
        ]);
        if (plan.reviews) {
          await refreshReviews(state.selectedRunId);
        } else if (plan.reviewDetail) {
          await refreshSelectedReviewDetail(state.selectedRunId, { allowMissing: true });
        }
      } catch (error) {
        setFlash("error", "Stream refresh failed: " + (error.message || error));
      } finally {
        state.streamRefreshInFlight = false;
      }
    }

    function scheduleStreamRefresh(plan) {
      mergeStreamRefreshPlan(plan);
      clearTimeout(state.streamRefreshTimer);
      state.streamRefreshTimer = setTimeout(() => {
        void flushStreamRefresh();
      }, 250);
    }

    function connectStream(runId, cursor) {
      stopStream();
      const stream = new EventSource(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/stream?cursor=\${cursor}\`);
      state.stream = stream;
      stream.onopen = () => setLive("online", "live");
      stream.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data);
          if (!payload || !payload.record || typeof payload.cursor !== "number") {
            return;
          }
          if (payload.cursor < state.eventCursor) {
            return;
          }
          state.eventCursor = payload.cursor + 1;
          if (recordMatchesTimelineFilters(payload.record)) {
            state.events = appendStreamEntry(state.events, payload, 250);
            renderTimeline(state.events);
          }
          scheduleStreamRefresh(getStreamRefreshPlan(payload.record.type));
        } catch {
          // Ignore malformed stream payloads.
        }
      };
      stream.onerror = () => {
        setLive("idle", "stream reconnecting");
      };
    }

    projectHomeButton.addEventListener("click", () => {
      selectProjectHome();
    });

    if (sidebarToggleButton) {
      sidebarToggleButton.addEventListener("click", () => {
        setSidebarOpen(!state.sidebarOpen);
      });
    }
    if (sidebarOverlayEl) {
      sidebarOverlayEl.addEventListener("click", () => {
        setSidebarOpen(false);
      });
    }

    projectLoadButton.addEventListener("click", async () => {
      openActionForm("projectLoad", {
        workdir: getCurrentWorkdir()
      });
    });

    projectExportButton.addEventListener("click", async () => {
      await exportProject();
    });

    reindexButton.addEventListener("click", async () => {
      openActionForm("reindex", {});
    });

    stopRunButton.addEventListener("click", async () => {
      if (!state.selectedRunId) {
        return;
      }
      openActionForm("stop", {
        reason: "requested via visualizer"
      });
    });

    startRunButton.addEventListener("click", async () => {
      openActionForm("start", {
        systemPath: state.workbenchSavedPath || "system.mmd",
        input: "",
        dryRun: true,
        runtimePath: "",
        userProfilePath: "",
        lawsPath: ""
      });
    });

    resumeRunButton.addEventListener("click", async () => {
      if (!state.selectedRunId) {
        return;
      }
      openActionForm("resume", {
        systemPath: state.workbenchSavedPath || "",
        input: "",
        dryRun: false,
        runtimePath: "",
        userProfilePath: "",
        lawsPath: ""
      });
    });

    refreshButton.addEventListener("click", async () => {
      await runAction("refresh", async () => {
        const reloadLogs = state.logsLoaded;
        await loadProject();
        await loadRuns();
        if (state.selectedRunId) {
          await loadSelectedRunBoot(state.selectedRunId, { keepStream: false });
          if (reloadLogs) {
            await loadSelectedLogs(state.selectedRunId, { force: true, internal: true });
          }
        } else {
          renderSelectedRun();
        }
        setFlash("success", "Visualizer refreshed.");
      });
    });

    timelineApplyButton.addEventListener("click", async () => {
      readTimelineFiltersFromInputs();
      if (state.selectedRunId) {
        await reloadTimeline(state.selectedRunId);
      } else {
        renderTimeline([]);
      }
      renderActionState();
    });

    timelineClearButton.addEventListener("click", async () => {
      state.timelineRoleId = "";
      state.timelineType = "";
      state.timelineStatus = "";
      state.timelineBranchId = "";
      state.timelineReviewId = "";
      state.timelineErrorCode = "";
      syncTimelineFilterInputs();
      if (state.selectedRunId) {
        await reloadTimeline(state.selectedRunId);
      } else {
        renderTimeline([]);
      }
      renderActionState();
    });

    logRoleEl.addEventListener("change", async (event) => {
      state.selectedLogRoleId = event.target.value || "";
      if (state.selectedRunId && state.logsLoaded) {
        await loadSelectedLogs(state.selectedRunId, { force: true });
      } else {
        renderLogs();
      }
      writeRouteToLocation();
    });

    logTailEl.addEventListener("change", async (event) => {
      state.logTail = event.target.value || "";
      if (state.selectedRunId && state.logsLoaded) {
        await loadSelectedLogs(state.selectedRunId, { force: true });
      } else {
        renderLogs();
      }
      writeRouteToLocation();
    });

    logSinceEl.addEventListener("change", async (event) => {
      state.logSince = event.target.value || "";
      if (state.selectedRunId && state.logsLoaded) {
        await loadSelectedLogs(state.selectedRunId, { force: true });
      } else {
        renderLogs();
      }
      writeRouteToLocation();
    });

    searchEl.addEventListener("input", (event) => {
      state.filter = event.target.value || "";
      renderRuns();
    });

    renderConsoleTabs();

    const initialRoute = readRouteStateFromSearch(window.location.search);
    state.projectHome = initialRoute.view === "project";
    if (state.projectHome) {
      state.consoleTab = "project";
      renderConsoleTabs();
    }
    state.selectedRunId = initialRoute.runId;
    state.selectedReviewId = initialRoute.reviewId;
    state.selectedLogRoleId = initialRoute.logRoleId;
    state.logTail = initialRoute.tail;
    state.logSince = initialRoute.since;
    logTailEl.value = state.logTail;
    logSinceEl.value = state.logSince;
    syncTimelineFilterInputs();

    Promise.all([loadProject(), loadRuns()])
      .then(async () => {
        if (state.selectedRunId) {
          await loadSelectedRunBoot(state.selectedRunId, { keepStream: false });
        } else {
          renderSelectedRun();
        }
      })
      .catch((error) => {
        runListEl.innerHTML = \`<div class="hint">Failed to load visualizer data: \${escapeText(error.message || error)}</div>\`;
        projectSummaryEl.textContent = \`Failed to load project: \${error.message || error}\`;
        setLive("idle", "offline");
      });

    state.listTimer = setInterval(() => {
      if (!shouldPollRunsList()) {
        return;
      }
      loadRuns().catch(() => {
        // keep the page usable even if a background refresh fails
      });
    }, 30000);
  `;
}
