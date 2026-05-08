import {
  bindingTone,
  displayUiToken,
  normalizeStudioTargetRoleId,
  renderArtifactsPanel,
  renderBindingExplainPanel,
  renderContractPanel,
  renderFailureDetailPanel,
  renderFailureSummaryPanel,
  renderLogsPanel,
  renderOpsSummaryPanel,
  renderProjectReadinessPanel,
  renderReleaseGatePanel,
  renderProjectSummaryPanel,
  renderResumeReadinessPanel,
  renderReviewQueuePanel,
  renderReviewDetailPanel,
  renderRolePackagePanel,
  renderRunStatePanel,
  renderStudioGraphCanvas,
  renderStudioBridgePanel,
  renderStudioRolePackageEditor,
  renderStudioBridgeSelectionLabel,
  roleIdOf,
  flowKeyOf,
  flowDisplayLabel,
  sortStudioBridgeRolesTopologically,
  filterStudioBridgeItems,
  sortStudioBridgeFlowsByTopology,
  renderSuggestedNextChecksPanel,
  renderRunTopologySvg,
  renderWorkbenchTopologySvg,
  statusTone
} from "./client-renderers.js";
import {
  buildRouteSearch,
  normalizeLifecycleView,
  readRouteStateFromSearch,
  type RouteState
} from "./client-route-state.js";
import {
  renderOperateTabsHtml,
  renderLoadingSkeletonHtml,
  renderRunStatsHtml,
  renderTimelineHtml,
  renderWorkbenchActionsHtml,
  renderWorkbenchModeBodyHtml,
  renderWorkbenchModeTabsHtml,
  renderWorkbenchStatusHtml,
  renderWorkbenchStructureHtml,
  renderWorkbenchViewTabsHtml,
  renderWorkspaceEmptyStateHtml
} from "./client-lifecycle-panels.js";
import {
  getVisibleConsolePanelIds,
  renderConsoleTabsHtml,
  renderRunListHtml,
  shouldShowRunSidebar
} from "./client-shell-controls.js";
import {
  createInitialStreamRefreshPlan,
  createProjectStateSlice,
  createBuildStateSlice,
  createOperateStateSlice,
  createReviewStateSlice,
  createLogsStateSlice,
  createStreamingStateSlice,
  createInitialVisualizerState
} from "./client-lifecycle-state.js";
import { bindProjectWizardControls as attachProjectWizardControls } from "./client-project-menu-controls.js";
import {
  projectCreateErrorFromResponse as mapProjectCreateErrorFromResponse
} from "./client-project-workspace.js";
import {
  buildLogsQuery,
  fetchFailureData,
  fetchResumeDiagnosticsData,
  fetchResumeReadinessData,
  fetchSelectedLogs,
  shouldSkipDeferredPanelLoad
} from "./client-run-data-loaders.js";
import {
  fallbackLogRoleId,
  resolveRunLiveState,
  selectReviewId
} from "./client-run-selection.js";
import {
  asStudioChatList,
  renderStudioChatPanelHtml,
  studioChatCanApply,
  studioChatModeLabel
} from "./client-studio-chat-panel.js";
import {
  bindStudioBridgeControls as attachStudioBridgeControls,
  bindStudioChatControls as attachStudioChatControls
} from "./client-studio-bridge-controls.js";
import {
  buildReleaseReadinessDecision,
  listFromRecord,
  type ReleaseReadinessDecision
} from "./client-release-readiness.js";
import {
  appendIndexedStreamEntry,
  appendStreamEntry,
  createStreamCursorIndex,
  formatReviewStatusLabel,
  getStreamRefreshPlan,
  type StreamRefreshPlan
} from "./client-stream-state.js";
import { studioRolePackageHasRequiredFileCoverage } from "./studio-client/studio-graph-validation.js";
import { WORKBENCH_VALIDATION_DEBOUNCE_MS } from "./client-input-policy.js";
import { getDictionary, type Dictionary, type Locale } from "./i18n/index.js";

export {
  buildRouteSearch,
  normalizeLifecycleView,
  readRouteStateFromSearch
} from "./client-route-state.js";
export { buildReleaseReadinessDecision } from "./client-release-readiness.js";
export {
  getVisibleConsolePanelIds,
  renderConsoleTabsHtml,
  renderRunListHtml,
  shouldShowRunSidebar
} from "./client-shell-controls.js";
export {
  appendIndexedStreamEntry,
  appendStreamEntry,
  createStreamCursorIndex,
  formatReviewStatusLabel,
  getStreamRefreshPlan
} from "./client-stream-state.js";

export type ClientI18nOptions = {
  locale?: Locale;
  messages?: Dictionary;
  messagesByLocale?: Partial<Record<Locale, Dictionary>>;
};


export function buildClientAppScript(apiPrefix: string, i18n: ClientI18nOptions = {}): string {
  const locale = i18n.locale ?? "en";
  const messagesByLocale: Record<Locale, Dictionary> = {
    en: getDictionary("en"),
    "zh-CN": getDictionary("zh-CN"),
    ...(i18n.messagesByLocale ?? {})
  };
  messagesByLocale[locale] = i18n.messages ?? messagesByLocale[locale];
  return `
    const API_PREFIX = ${JSON.stringify(apiPrefix)};
    const INITIAL_LOCALE = ${JSON.stringify(locale)};
    const I18N_MESSAGES = ${JSON.stringify(messagesByLocale)};
    const I18N_STORAGE_KEY = "ogs.visualizer.lang";
    window.OGSVisualizerClient = window.OGSVisualizerClient || {};
    const readRouteStateFromSearch = ${readRouteStateFromSearch.toString()};
    const buildRouteSearch = ${buildRouteSearch.toString()};
    const listFromRecord = ${listFromRecord.toString()};
    const buildReleaseReadinessDecision = ${buildReleaseReadinessDecision.toString()};
    const createInitialStreamRefreshPlan = ${createInitialStreamRefreshPlan.toString()};
    const createProjectStateSlice = ${createProjectStateSlice.toString()};
    const createBuildStateSlice = ${createBuildStateSlice.toString()};
    const createOperateStateSlice = ${createOperateStateSlice.toString()};
    const createReviewStateSlice = ${createReviewStateSlice.toString()};
    const createLogsStateSlice = ${createLogsStateSlice.toString()};
    const createStreamingStateSlice = ${createStreamingStateSlice.toString()};
    const createInitialVisualizerState = ${createInitialVisualizerState.toString()};
    const attachProjectWizardControls = ${attachProjectWizardControls.toString()};
    const buildLogsQuery = ${buildLogsQuery.toString()};
    const fetchSelectedLogs = ${fetchSelectedLogs.toString()};
    const shouldSkipDeferredPanelLoad = ${shouldSkipDeferredPanelLoad.toString()};
    const fetchFailureData = ${fetchFailureData.toString()};
    const fetchResumeReadinessData = ${fetchResumeReadinessData.toString()};
    const fetchResumeDiagnosticsData = ${fetchResumeDiagnosticsData.toString()};
    const WORKBENCH_VALIDATION_DEBOUNCE_MS = ${JSON.stringify(WORKBENCH_VALIDATION_DEBOUNCE_MS)};
    const selectReviewId = ${selectReviewId.toString()};
    const fallbackLogRoleId = ${fallbackLogRoleId.toString()};
    const resolveRunLiveState = ${resolveRunLiveState.toString()};
    const renderWorkspaceEmptyStateHtml = ${renderWorkspaceEmptyStateHtml.toString()};
    const renderOperateTabsHtml = ${renderOperateTabsHtml.toString()};
    const renderConsoleTabsHtml = ${renderConsoleTabsHtml.toString()};
    const getVisibleConsolePanelIds = ${getVisibleConsolePanelIds.toString()};
    const shouldShowRunSidebar = ${shouldShowRunSidebar.toString()};
    const renderRunListHtml = ${renderRunListHtml.toString()};
    const renderLoadingSkeletonHtml = ${renderLoadingSkeletonHtml.toString()};
    const renderWorkbenchStructureHtml = ${renderWorkbenchStructureHtml.toString()};
    const renderWorkbenchStatusHtml = ${renderWorkbenchStatusHtml.toString()};
    const renderWorkbenchModeTabsHtml = ${renderWorkbenchModeTabsHtml.toString()};
    const renderWorkbenchViewTabsHtml = ${renderWorkbenchViewTabsHtml.toString()};
    const renderWorkbenchActionsHtml = ${renderWorkbenchActionsHtml.toString()};
    const renderWorkbenchModeBodyHtml = ${renderWorkbenchModeBodyHtml.toString()};
    const renderRunStatsHtml = ${renderRunStatsHtml.toString()};
    const renderTimelineHtml = ${renderTimelineHtml.toString()};
    const mapProjectCreateErrorFromResponse = ${mapProjectCreateErrorFromResponse.toString()};
    const asStudioChatList = ${asStudioChatList.toString()};
    const studioChatCanApply = ${studioChatCanApply.toString()};
    const studioChatModeLabel = ${studioChatModeLabel.toString()};
    const renderStudioChatPanelHtml = ${renderStudioChatPanelHtml.toString()};
    const attachStudioBridgeControls = ${attachStudioBridgeControls.toString()};
    const attachStudioChatControls = ${attachStudioChatControls.toString()};
    const appendIndexedStreamEntry = ${appendIndexedStreamEntry.toString()};
    const createStreamCursorIndex = ${createStreamCursorIndex.toString()};
    const getStreamRefreshPlan = ${getStreamRefreshPlan.toString()};
    const normalizeLifecycleView = ${normalizeLifecycleView.toString()};
    const formatReviewStatusLabel = ${formatReviewStatusLabel.toString()};
    const statusTone = ${statusTone.toString()};
    const bindingTone = ${bindingTone.toString()};
    const displayUiToken = ${displayUiToken.toString()};
    const normalizeStudioTargetRoleId = ${normalizeStudioTargetRoleId.toString()};
    const renderStudioGraphCanvas = ${renderStudioGraphCanvas.toString()};
    const renderStudioBridgeSelectionLabel = ${renderStudioBridgeSelectionLabel.toString()};
    const renderStudioRolePackageEditor = ${renderStudioRolePackageEditor.toString()};
    const roleIdOf = ${roleIdOf.toString()};
    const flowKeyOf = ${flowKeyOf.toString()};
    const flowDisplayLabel = ${flowDisplayLabel.toString()};
    const sortStudioBridgeRolesTopologically = ${sortStudioBridgeRolesTopologically.toString()};
    const filterStudioBridgeItems = ${filterStudioBridgeItems.toString()};
    const sortStudioBridgeFlowsByTopology = ${sortStudioBridgeFlowsByTopology.toString()};
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
    const renderReleaseGatePanel = ${renderReleaseGatePanel.toString()};
    const renderStudioBridgePanel = ${renderStudioBridgePanel.toString()};
    const renderRunStatePanel = ${renderRunStatePanel.toString()};
    const renderSuggestedNextChecksPanel = ${renderSuggestedNextChecksPanel.toString()};
    const renderRunTopologySvg = ${renderRunTopologySvg.toString()};
    const renderWorkbenchTopologySvg = ${renderWorkbenchTopologySvg.toString()};
    const studioRolePackageHasRequiredFileCoverage = ${studioRolePackageHasRequiredFileCoverage.toString()};
    function canonicalLocale(locale) {
      const normalized = String(locale || "").trim().replace(/_/g, "-").toLowerCase();
      if (!normalized || normalized === "*") {
        return "";
      }
      if (normalized === "en" || normalized.indexOf("en-") === 0) {
        return "en";
      }
      if (normalized === "zh" || normalized.indexOf("zh-") === 0) {
        return "zh-CN";
      }
      return I18N_MESSAGES[normalized] ? normalized : "";
    }
    function readLangSearchParam() {
      try {
        const params = new URLSearchParams(window.location.search || "");
        return params.get("lang") || "";
      } catch {
        return "";
      }
    }
    function readStoredLocale() {
      try {
        return canonicalLocale(window.localStorage.getItem(I18N_STORAGE_KEY));
      } catch {
        return "";
      }
    }
    function writeStoredLocale(locale) {
      try {
        window.localStorage.setItem(I18N_STORAGE_KEY, locale);
      } catch {
        // Ignore storage failures in private or restricted browser contexts.
      }
    }
    function navigateToLocale(locale) {
      const nextLocale = canonicalLocale(locale);
      if (!nextLocale) {
        return;
      }
      const params = new URLSearchParams(window.location.search || "");
      params.set("lang", nextLocale);
      window.location.href = (window.location.pathname || "/") + "?" + params.toString();
    }
    function resolveClientLocale() {
      const queryLocale = canonicalLocale(readLangSearchParam());
      if (queryLocale) {
        writeStoredLocale(queryLocale);
        return queryLocale;
      }
      const storedLocale = readStoredLocale();
      if (storedLocale) {
        const injectedLocale = canonicalLocale(INITIAL_LOCALE) || "en";
        if (storedLocale !== injectedLocale) {
          navigateToLocale(storedLocale);
        }
        return storedLocale;
      }
      return canonicalLocale(INITIAL_LOCALE) || "en";
    }
    function interpolateMessage(template, vars) {
      if (!vars) {
        return String(template ?? "");
      }
      return String(template ?? "").replace(/\\{([A-Za-z0-9_.-]+)\\}/g, (placeholder, name) => {
        return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name] ?? "") : placeholder;
      });
    }
    const resolvedLocale = resolveClientLocale();
    const state = createInitialVisualizerState(resolvedLocale);

    const runListEl = document.getElementById("run-list");
    const searchEl = document.getElementById("search");
    const flashEl = document.getElementById("flash");
    const actionFormEl = document.getElementById("action-form");
    const actionFormSectionEl = document.getElementById("action-form-section");
    let actionFormReturnFocusEl = null;
    const consoleTabsEl = document.getElementById("console-tabs");
    const workdirEl = document.getElementById("workdir");
    const projectWizardEl = document.getElementById("project-wizard");
    const opsSummaryEl = document.getElementById("ops-summary");
    const releaseGateEl = document.getElementById("release-gate");
    const workbenchMetaEl = document.getElementById("workbench-meta");
    const workbenchStatusEl = document.getElementById("workbench-status");
    const workbenchActionsEl = document.getElementById("workbench-actions");
    const workbenchTabsEl = document.getElementById("workbench-tabs");
    const workbenchViewTabsSlotEl = document.getElementById("workbench-view-tabs-slot");
    const workbenchBodyEl = document.getElementById("workbench-body");
    const operateTabsEl = document.getElementById("operate-tabs");
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
    const globalStatusContextEl = document.getElementById("global-status-context");
    const globalStatusDiagnosticsEl = document.getElementById("global-status-diagnostics");
    const logRoleEl = document.getElementById("log-role");
    const logPageSizeEl = document.getElementById("log-page-size");
    const logTailEl = document.getElementById("log-tail");
    const logSinceEl = document.getElementById("log-since");
    const sidebarEl = document.getElementById("sidebar");
    const sidebarOverlayEl = document.getElementById("sidebar-overlay");
    const sidebarToggleButton = document.getElementById("sidebar-toggle");
    const releaseExportButton = document.getElementById("release-export");
    const reindexButton = document.getElementById("reindex");
    const resumeRunButton = document.getElementById("resume-run");
    const stopRunButton = document.getElementById("stop-run");
    const refreshButton = document.getElementById("refresh");
    const localeSelectEl = document.getElementById("locale-select");
    const OPERATE_DEBUG_PANEL_IDS = ["overview", "graph", "recovery", "reviews"];

    function joinIdRefs(...ids) {
      return ids.filter(Boolean).join(" ").trim();
    }

    function getOperatePanelId(operateTab) {
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

    function getLegacyPanelId(legacyConsoleTab) {
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

    function setPanelState(panelId, visible, role, labelledBy) {
      const panel = document.getElementById(panelId);
      if (!panel) {
        return;
      }
      panel.hidden = !visible;
      panel.setAttribute("role", role);
      if (labelledBy) {
        panel.setAttribute("aria-labelledby", labelledBy);
      } else {
        panel.removeAttribute("aria-labelledby");
      }
    }

    function renderConsolePanels(visiblePanelIds) {
      const legacyConsoleTab = state.legacyConsoleTab || "debug";
      const legacyLabelIds = joinIdRefs("console-tab-legacy", "legacy-console-tab-" + legacyConsoleTab);
      const operateLabelIds = joinIdRefs("console-tab-operate", "operate-tab-" + state.operateTab);
      setPanelState(
        "console-panel-project",
        visiblePanelIds.has("project"),
        "tabpanel",
        state.consoleTab === "legacy" && legacyConsoleTab === "project"
          ? legacyLabelIds
          : "console-tab-project"
      );
      setPanelState("console-panel-build", visiblePanelIds.has("build"), "tabpanel", "console-tab-build");
      setPanelState(
        "console-panel-debug",
        visiblePanelIds.has("debug"),
        state.consoleTab === "legacy" && legacyConsoleTab === "debug" ? "tabpanel" : "presentation",
        state.consoleTab === "legacy" && legacyConsoleTab === "debug" ? legacyLabelIds : ""
      );
      setPanelState(
        "console-panel-ops",
        visiblePanelIds.has("ops"),
        state.consoleTab === "legacy" && legacyConsoleTab === "ops" ? "tabpanel" : "region",
        state.consoleTab === "legacy" && legacyConsoleTab === "ops" ? legacyLabelIds : operateLabelIds
      );
      setPanelState(
        "console-panel-config",
        visiblePanelIds.has("config"),
        "tabpanel",
        state.consoleTab === "legacy" && legacyConsoleTab === "config" ? legacyLabelIds : "legacy-console-tab-config"
      );
      setPanelState(
        "console-panel-logs",
        visiblePanelIds.has("logs"),
        "tabpanel",
        state.consoleTab === "legacy" && legacyConsoleTab === "logs" ? legacyLabelIds : operateLabelIds
      );
      setPanelState(
        "console-panel-artifacts",
        visiblePanelIds.has("artifacts"),
        "tabpanel",
        state.consoleTab === "legacy" && legacyConsoleTab === "artifacts" ? legacyLabelIds : operateLabelIds
      );
      setPanelState("console-panel-validate-release", visiblePanelIds.has("validate-release"), "tabpanel", "console-tab-validate-release");

      const showLegacyDebug = state.consoleTab === "legacy" && legacyConsoleTab === "debug";
      for (const tab of OPERATE_DEBUG_PANEL_IDS) {
        const panelId = "operate-tabpanel-" + tab;
        const panelRole = state.consoleTab === "operate" ? "tabpanel" : "group";
        const panelLabels = state.consoleTab === "operate"
          ? joinIdRefs("console-tab-operate", "operate-tab-" + tab)
          : showLegacyDebug
            ? legacyLabelIds
            : "";
        const panelVisible = state.consoleTab === "operate"
          ? state.operateTab === tab
          : showLegacyDebug;
        setPanelState(panelId, panelVisible, panelRole, panelLabels);
      }
    }

    function escapeText(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function t(key, vars, fallback) {
      const dict = I18N_MESSAGES[state.locale] || {};
      const fallbackDict = I18N_MESSAGES.en || {};
      return interpolateMessage(dict[key] ?? fallbackDict[key] ?? fallback ?? key, vars);
    }

    function setLocaleFromControl(locale) {
      const nextLocale = canonicalLocale(locale);
      if (!nextLocale) {
        return;
      }
      writeStoredLocale(nextLocale);
      navigateToLocale(nextLocale);
    }

    function applyStaticLocalizedContent() {
      const textTargets = [
        [sidebarToggleButton, "hero.runs"],
        [releaseExportButton, "action.exportProject"],
        [reindexButton, "action.reindex"],
        [resumeRunButton, "action.resumeSelected"],
        [stopRunButton, "action.requestStop"],
        [refreshButton, "action.refresh"],
        [timelineApplyButton, "action.applyFilters"],
        [timelineClearButton, "action.clearFilters"]
      ];
      for (const [element, key] of textTargets) {
        if (element) {
          element.textContent = t(key);
        }
      }
      if (searchEl) searchEl.placeholder = t("search.placeholder");
      if (timelineTypeEl) timelineTypeEl.placeholder = t("timeline.eventType");
      if (timelineBranchEl) timelineBranchEl.placeholder = t("timeline.branchId");
      if (timelineReviewEl) timelineReviewEl.placeholder = t("timeline.reviewId");
      if (timelineErrorEl) timelineErrorEl.placeholder = t("timeline.errorCode");
      if (logTailEl) logTailEl.placeholder = t("logs.tail");
      if (localeSelectEl) localeSelectEl.value = state.locale;
      if (searchEl) searchEl.setAttribute("aria-label", t("search.placeholder"));
      if (timelineTypeEl) timelineTypeEl.setAttribute("aria-label", t("timeline.eventType"));
      if (timelineBranchEl) timelineBranchEl.setAttribute("aria-label", t("timeline.branchId"));
      if (timelineReviewEl) timelineReviewEl.setAttribute("aria-label", t("timeline.reviewId"));
      if (timelineErrorEl) timelineErrorEl.setAttribute("aria-label", t("timeline.errorCode"));
      if (logTailEl) logTailEl.setAttribute("aria-label", t("logs.tail"));
    }

    function formatTime(value) {
      if (!value) return t("common.notAvailable", undefined, "n/a");
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return String(value);
      }
      try {
        return new Intl.DateTimeFormat(state.locale || INITIAL_LOCALE || "en", {
          dateStyle: "medium",
          timeStyle: "medium"
        }).format(date);
      } catch {
        return date.toLocaleString(state.locale || INITIAL_LOCALE || undefined);
      }
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

    function createApiError(payload, fallback) {
      const message = readApiError(payload, fallback);
      const error = new Error(message);
      if (payload && payload.error) {
        error.code = payload.error.code || "";
        error.details = payload.error.details;
        error.payload = payload;
      }
      return error;
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

    function createClientTimeoutError(path, timeoutMs) {
      const error = new Error(t("api.requestTimeout", {
        seconds: String(Math.ceil(timeoutMs / 1000))
      }, "Request timed out after {seconds}s. Check the server connection and retry."));
      error.code = "CLIENT_REQUEST_TIMEOUT";
      error.path = path;
      return error;
    }

    function isAbortError(error) {
      return error && (
        error.name === "AbortError" ||
        error.code === "CLIENT_REQUEST_ABORTED"
      );
    }

    async function requestJson(path, options) {
      const requestOptions = options || {};
      const timeoutMs = Number(requestOptions.timeoutMs || 0);
      let timeoutId = null;
      let timedOut = false;
      let controller = null;
      let signal = requestOptions.signal;
      if (timeoutMs > 0) {
        controller = new AbortController();
        signal = controller.signal;
        if (requestOptions.signal) {
          if (requestOptions.signal.aborted) {
            controller.abort(requestOptions.signal.reason);
          } else {
            requestOptions.signal.addEventListener("abort", () => {
              controller.abort(requestOptions.signal.reason);
            }, { once: true });
          }
        }
      }
      let response;
      try {
        const { timeoutMs: _timeoutMs, signal: _optionSignal, ...fetchOptions } = requestOptions;
        const fetchPromise = fetch(path, {
          headers: { accept: "application/json" },
          signal,
          ...fetchOptions,
          headers: {
            accept: "application/json",
            ...(fetchOptions.headers || {})
          },
          cache: fetchOptions.cache || "no-store"
        });
        response = timeoutMs > 0
          ? await Promise.race([
              fetchPromise,
              new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                  timedOut = true;
                  if (controller) {
                    controller.abort(createClientTimeoutError(path, timeoutMs));
                  }
                  reject(createClientTimeoutError(path, timeoutMs));
                }, timeoutMs);
              })
            ])
          : await fetchPromise;
      } catch (error) {
        if (timedOut) {
          throw createClientTimeoutError(path, timeoutMs);
        }
        throw error;
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      }
      if (signal?.aborted) {
        if (timedOut) {
          throw createClientTimeoutError(path, timeoutMs);
        }
        const reason = signal.reason;
        if (reason instanceof Error) {
          throw reason;
        }
        const error = new Error(t("studio.chat.cancelled", undefined, "Studio chat request cancelled."));
        error.code = "CLIENT_REQUEST_ABORTED";
        throw error;
      }
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text().catch(() => "");
      if (!response.ok) {
        throw createApiError(payload, \`\${response.status} \${response.statusText}\`);
      }
      return payload;
    }

    async function requestAction(path, body, options) {
      return requestJson(path, {
        ...(options || {}),
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(options?.headers || {})
        },
        body: JSON.stringify(body || {})
      });
    }

    function setLive(mode, label) {
      liveEl.className = "live" + (mode === "online" ? " online" : "");
      liveEl.textContent = displayUiToken(label, t);
    }

    function renderGlobalStatusBar() {
      if (globalStatusContextEl) {
        const contextTokens = [];
        if (state.consoleTab === "build") {
          contextTokens.push(t("section.mermaidWorkbench", undefined, "Mermaid Workbench"));
          contextTokens.push(t("build.mode." + state.buildMode, undefined, state.buildMode || "edit"));
          if (state.buildMode === "edit") {
            contextTokens.push(
              state.workbenchView === "source"
                ? t("workbench.source", undefined, "Source")
                : t("workbench.graph", undefined, "Graph")
            );
          }
        } else if (state.consoleTab === "operate") {
          contextTokens.push(t("nav.lifecycle.operate", undefined, "Operate"));
          contextTokens.push(state.selectedRunId || t("state.noRunSelected", undefined, "No run selected."));
        } else if (state.consoleTab === "validate-release") {
          contextTokens.push(t("section.validateRelease", undefined, "Validate & Release"));
          contextTokens.push(state.workbenchSavedPath || "system.mmd");
        } else {
          contextTokens.push(t("nav.lifecycle.project", undefined, "Project"));
          contextTokens.push((state.workspace?.workdir || getCurrentWorkdir() || "").split(/[\\/]/).filter(Boolean).pop() || t("state.idle", undefined, "idle"));
        }
        globalStatusContextEl.textContent = contextTokens.filter(Boolean).join(" / ");
      }
      if (globalStatusDiagnosticsEl) {
        const diagnostics = Array.isArray(state.workbench?.validation?.diagnostics) ? state.workbench.validation.diagnostics : [];
        const blockers = Array.isArray(state.projectReadiness?.blockers) ? state.projectReadiness.blockers : [];
        if (state.consoleTab === "build" && diagnostics.length) {
          const first = diagnostics[0] || {};
          globalStatusDiagnosticsEl.textContent = String(first.code || "DIAGNOSTIC") + ": " + String(first.message || "");
          globalStatusDiagnosticsEl.className = "global-status-diagnostics hint warn";
        } else if (state.consoleTab === "build") {
          globalStatusDiagnosticsEl.textContent = t("studio.noParseCompileDiagnostics", undefined, "No parse or compile diagnostics.");
          globalStatusDiagnosticsEl.className = "global-status-diagnostics hint";
        } else if (state.consoleTab === "validate-release" && blockers.length) {
          globalStatusDiagnosticsEl.textContent = String(blockers[0]?.message || t("release.resolveBlockers", undefined, "Resolve release blockers."));
          globalStatusDiagnosticsEl.className = "global-status-diagnostics hint warn";
        } else {
          globalStatusDiagnosticsEl.textContent = "";
          globalStatusDiagnosticsEl.className = "global-status-diagnostics hint";
        }
      }
    }

    function writeRouteToLocation() {
      const params = new URLSearchParams(buildRouteSearch({
        projectHome: state.projectHome,
        lifecycle: state.consoleTab,
        selectedRunId: state.selectedRunId,
        selectedReviewId: state.selectedReviewId,
        selectedLogRoleId: state.selectedLogRoleId,
        logTail: state.logTail,
        logSince: state.logSince
      }));
      if (state.locale && state.locale !== "en") {
        params.set("lang", state.locale);
      }
      const query = params.toString();
      window.history.replaceState(null, "", query ? "?" + query : window.location.pathname);
    }

    function isCurrentRunSelection(runId, requestId) {
      return Boolean(runId) && state.selectedRunId === runId && state.runSelectionRequestId === requestId;
    }

    function resetSelectedRunPanels() {
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
      state.eventCursor = 0;
      state.eventCursorIndex = createStreamCursorIndex(state.events);
      state.engineLogs = [];
      state.roleLogs = [];
      state.logsLoaded = false;
      state.logsStale = false;
    }

    function buildStudioCanvasFromBridge(bridge) {
      const existingCanvas = bridge?.canvas;
      if (
        existingCanvas &&
        typeof existingCanvas === "object" &&
        Array.isArray(existingCanvas.nodes) &&
        Array.isArray(existingCanvas.edges)
      ) {
        return cloneJson(existingCanvas);
      }
      const authoring = bridge?.authoring || null;
      const extracted = bridge?.extracted || {};
      const extractedRoles = Array.isArray(extracted.roles) ? extracted.roles : [];
      const extractedFlows = Array.isArray(extracted.flows) ? extracted.flows : [];
      const roles = extractedRoles.length ? extractedRoles : Object.values(authoring?.roles || {});
      const flows = extractedFlows.length ? extractedFlows : Object.values(authoring?.flows || {});
      const layoutNodes = authoring?.layout?.nodes || {};
      return {
        version: 1,
        nodes: roles.map((role, index) => {
          const roleId = role.roleId || "";
          const layout = layoutNodes[roleId] || {};
          return {
            id: roleId,
            roleId,
            x: Number.isFinite(layout.x) ? layout.x : 120 + (index * 260),
            y: Number.isFinite(layout.y) ? layout.y : 120,
            width: Number.isFinite(layout.width) ? layout.width : 180,
            height: Number.isFinite(layout.height) ? layout.height : 84,
            label: role.title || roleId,
            badges: role.badges || [],
            bindingKind: role.bindingKind || "noop"
          };
        }),
        edges: flows.map((flow) => ({
          id: flow.flowId,
          source: flow.fromRoleId,
          target: flow.toRoleId,
          label: flow.label || flow.eventType,
          eventType: flow.eventType,
          runtimeOnlyErrorFlow: Boolean(flow.runtimeOnlyErrorFlow),
          participatesInJoin: Boolean(flow.participatesInJoin)
        })),
        viewport: authoring?.layout?.viewport
      };
    }

    function studioAuthoringFlowDisplayKey(flow) {
      const target = String(flow?.toRoleId || "") === "output" ? "__system_end__" : String(flow?.toRoleId || "");
      return String(flow?.fromRoleId || "") + ":" + String(flow?.eventType || "") + ":" + target;
    }

    function withStudioAuthoringDisplayMetadata(bridge, authoring) {
      if (!bridge?.extracted || !authoring) {
        return bridge;
      }
      const roleTitleById = new Map(Object.values(authoring.roles || {}).map((role) => [String(role.roleId || ""), role.title]));
      const flowLabelByKey = new Map(Object.values(authoring.flows || {}).map((flow) => [studioAuthoringFlowDisplayKey(flow), flow.label]));
      return {
        ...bridge,
        extracted: {
          ...bridge.extracted,
          roles: (bridge.extracted.roles || []).map((role) => {
            const title = roleTitleById.get(String(role.roleId || ""));
            return title ? { ...role, title } : role;
          }),
          flows: (bridge.extracted.flows || []).map((flow) => {
            const label = flowLabelByKey.get(studioAuthoringFlowDisplayKey(flow));
            return label ? { ...flow, label } : flow;
          })
        }
      };
    }

    function buildStudioGraphLabels() {
      return {
        viewportGroup: t("studio.graph.viewportGroup", undefined, "Viewport"),
        editGroup: t("studio.graph.editGroup", undefined, "Edit graph"),
        zoomOut: t("studio.graph.zoomOut", undefined, "Zoom out"),
        zoomIn: t("studio.graph.zoomIn", undefined, "Zoom in"),
        resetView: t("studio.graph.resetView", undefined, "Actual size"),
        fullscreen: state.studioBridgeFullscreen
          ? t("action.exitFullscreen", undefined, "Exit fullscreen")
          : t("action.fullscreen", undefined, "Fullscreen"),
        fitView: t("studio.graph.fitView", undefined, "Fit view"),
        autoLayout: t("studio.graph.autoLayout", undefined, "Auto layout"),
        generate: t("studio.graph.generate", undefined, "Chat / Generate"),
        addRole: t("studio.graph.addRole", undefined, "Role"),
        addEdge: t("studio.graph.addEdge", undefined, "Edge"),
        editSelection: t("studio.graph.editSelection", undefined, "Edit selected"),
        deleteSelection: t("studio.graph.deleteSelection", undefined, "Delete"),
        undo: t("studio.graph.undo", undefined, "Undo"),
        redo: t("studio.graph.redo", undefined, "Redo"),
        ready: t("studio.graph.ready", undefined, "ready"),
        graphUnavailable: t("studio.graph.unavailable", undefined, "Graph unavailable"),
        graphReady: t("studio.graph.readyStatus", undefined, "Graph workspace ready"),
        fixMermaidBeforeGraphEditing: t("studio.graph.fixMermaid", undefined, "Fix Mermaid diagnostics before graph editing."),
        noRolesAvailable: t("studio.graph.noRoles", undefined, "No roles available."),
        selectRoleBeforeAddingEdge: t("studio.graph.selectRoleBeforeEdge", undefined, "Select a role before adding an edge."),
        invalidConnection: t("studio.graph.invalidConnection", undefined, "Invalid Studio connection."),
        entryRoleDeletionBlocked: t("studio.graph.entryRoleDeletionBlocked", undefined, "Entry role deletion is blocked."),
        invalidEdgeEndpoints: t("studio.graph.invalidEdgeEndpoints", undefined, "Invalid Studio edge endpoints."),
        duplicateRoleId: t("studio.graph.duplicateRoleId", undefined, "Role id already exists."),
        invalidRoleId: t("studio.graph.invalidRoleId", undefined, "Role id must start with a letter and use letters, digits, _ or -."),
        duplicateEdge: t("studio.graph.duplicateEdge", undefined, "This edge already exists."),
        invalidEventType: t("studio.graph.invalidEventType", undefined, "Event type must be uppercase."),
        deleteRoleConfirm: t("studio.graph.deleteRoleConfirm", undefined, "Delete role {roleId}?"),
        editBlocked: t("studio.graph.editBlocked", undefined, "Studio Bridge cannot edit until Mermaid parses successfully.")
      };
    }

    function buildStudioGraphCommandFormLabels() {
      return {
        roleDialogTitle: t("studio.form.roleDialogTitle", undefined, "Add role"),
        edgeDialogTitle: t("studio.form.edgeDialogTitle", undefined, "Add edge"),
        editRoleDialogTitle: t("studio.form.editRoleDialogTitle", undefined, "Edit role"),
        editEdgeDialogTitle: t("studio.form.editEdgeDialogTitle", undefined, "Edit flow"),
        repositoryRole: t("studio.form.repositoryRole", undefined, "Repository"),
        customRole: t("studio.form.customRole", undefined, "Custom"),
        rolePackage: t("studio.form.rolePackage", undefined, "Role package"),
        roleId: t("studio.form.roleId", undefined, "Role id"),
        title: t("studio.form.title", undefined, "Title"),
        bindingKind: t("studio.form.bindingKind", undefined, "Binding"),
        modelRef: t("studio.form.modelRef", undefined, "Model"),
        profileId: t("studio.form.profileId", undefined, "Execution profile"),
        existingProfile: t("studio.form.existingProfile", undefined, "Existing profile"),
        createProfile: t("studio.form.createProfile", undefined, "Create profile"),
        newProfileId: t("studio.form.newProfileId", undefined, "Generated profile id"),
        newProfileToolRef: t("studio.form.newProfileToolRef", undefined, "Tool"),
        newProfileTimeoutMs: t("studio.form.newProfileTimeoutMs", undefined, "Timeout ms"),
        newProfileMaxOutputBytes: t("studio.form.newProfileMaxOutputBytes", undefined, "Max output bytes"),
        sourceRole: t("studio.form.sourceRole", undefined, "Source role"),
        targetRole: t("studio.form.targetRole", undefined, "Target role"),
        eventType: t("studio.form.eventType", undefined, "Event type"),
        flowLabel: t("studio.form.flowLabel", undefined, "Display name"),
        runtimeOnlyErrorFlow: t("studio.form.runtimeOnlyErrorFlow", undefined, "Runtime error flow"),
        participatesInJoin: t("studio.form.participatesInJoin", undefined, "Join source"),
        cancel: t("action.cancel", undefined, "Cancel"),
        create: t("studio.form.create", undefined, "Create"),
        save: t("action.save", undefined, "Save"),
        noRepositoryRoles: t("studio.form.noRepositoryRoles", undefined, "No repository roles"),
        noModels: t("studio.form.noModels", undefined, "No models available"),
        noProfiles: t("studio.form.noProfiles", undefined, "No profiles available"),
        noTools: t("studio.form.noTools", undefined, "No tools available"),
        rolePackageSource: t("studio.form.rolePackageSource", undefined, "From this project's role repository."),
        outputTarget: t("studio.form.outputTarget", undefined, "output/end")
      };
    }

    function normalizeRunGraphBindingKind(value) {
      const normalized = String(value || "").toLowerCase();
      if (normalized === "model") return "model";
      if (normalized === "exec" || normalized === "execution" || normalized === "profile") return "exec";
      return "noop";
    }

    function runGraphFlowKey(edge) {
      const source = String(edge?.sourceRoleId || edge?.source || "");
      const event = String(edge?.event || edge?.eventType || "DONE");
      const target = normalizeStudioTargetRoleId(edge?.targetRoleId || edge?.target || "__system_end__");
      return source + ":" + event + ":" + target;
    }

    function buildRunStudioBridgeFromGraph(graph) {
      const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
      const edges = Array.isArray(graph?.edges) ? graph.edges : [];
      const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(nodes.length, 1))));
      const authoringRoles = {};
      const layoutNodes = {};
      const canvasNodes = nodes.map((node, index) => {
        const roleId = String(node?.roleId || "");
        const bindingKind = normalizeRunGraphBindingKind(node?.bindingKind);
        const x = 140 + (index % columns) * 260;
        const y = 120 + Math.floor(index / columns) * 150;
        const badges = [
          node?.status ? displayUiToken(node.status, t) : "",
          node?.nodeType && node.nodeType !== "role" ? displayUiToken(node.nodeType, t) : "",
          node?.lastErrorCode ? String(node.lastErrorCode) : ""
        ].filter(Boolean);
        authoringRoles[roleId] = {
          roleId,
          title: String(node?.title || node?.label || roleId),
          bindingKind,
          modelRef: node?.modelRef,
          profileId: node?.profileId,
          routingMode: node?.routingMode,
          joinMode: node?.joinMode,
          joinMin: node?.joinMin,
          joinSources: Array.isArray(node?.joinSources) ? node.joinSources : undefined,
          loopMax: node?.loopMax,
          review: node?.review,
          contextMap: Array.isArray(node?.contextFields) && node.contextFields.length
            ? Object.fromEntries(node.contextFields.map((key) => [String(key), String(key)]))
            : undefined
        };
        layoutNodes[roleId] = { x, y, width: 190, height: 90 };
        return {
          id: roleId,
          roleId,
          x,
          y,
          width: 190,
          height: 90,
          label: String(node?.title || node?.label || roleId),
          badges,
          bindingKind
        };
      }).filter((node) => node.roleId);
      const authoringFlows = {};
      const canvasEdges = edges.map((edge, index) => {
        const source = String(edge?.sourceRoleId || edge?.source || "");
        const target = String(edge?.targetRoleId || edge?.target || "__system_end__");
        const eventType = String(edge?.event || edge?.eventType || "DONE");
        const label = String(edge?.label || eventType);
        const flowId = String(edge?.flowId || "run-flow-" + index);
        authoringFlows[flowId] = {
          flowId,
          fromRoleId: source,
          toRoleId: target,
          eventType,
          ...(label && label !== eventType ? { label } : {}),
          runtimeOnlyErrorFlow: Boolean(edge?.isErrorFlow || edge?.runtimeOnlyErrorFlow)
        };
        return {
          id: flowId,
          source,
          target,
          label,
          eventType,
          runtimeOnlyErrorFlow: Boolean(edge?.isErrorFlow || edge?.runtimeOnlyErrorFlow),
          participatesInJoin: Boolean(edge?.participatesInJoin || edge?.recentlyActivated)
        };
      }).filter((edge) => edge.source && edge.target);
      return {
        authoring: {
          version: 1,
          project: {
            workdir: getCurrentWorkdir(),
            systemPath: state.detail?.header?.systemPath || state.workbenchSavedPath || "system.mmd"
          },
          system: {
            systemId: String(graph?.systemId || state.selectedRunId || "run"),
            systemVersion: String(graph?.systemVersion || "v1"),
            entryRoleId: String(graph?.entryRoleId || canvasNodes[0]?.roleId || ""),
            lawGlobalRef: ""
          },
          roles: authoringRoles,
          flows: authoringFlows,
          layout: { nodes: layoutNodes }
        },
        canvas: {
          version: 1,
          nodes: canvasNodes,
          edges: canvasEdges
        }
      };
    }

    function cloneJson(value) {
      return JSON.parse(JSON.stringify(value ?? null));
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

    function setFlash(kind, message, options) {
      if (state.flashTimer) {
        clearTimeout(state.flashTimer);
        state.flashTimer = null;
      }
      state.flash = message ? { kind, message, action: options?.action || "" } : null;
      renderFlash();
      if (message && !options?.action && (kind === "success" || kind === "info")) {
        state.flashTimer = setTimeout(() => {
          state.flashTimer = null;
          if (state.flash && state.flash.kind === kind && state.flash.message === message && !state.flash.action) {
            state.flash = null;
            renderFlash();
          }
        }, 3000);
      }
    }

    function getProjectWizardDefaults(workspace) {
      const workdir = workspace?.workdir || "";
      return {
        projectName: workdir ? String(workdir).split(/[\\/]/).filter(Boolean).pop() || "my-ogs-project" : "my-ogs-project",
        templateId: "empty",
        conflictStrategy: workspace?.state === "non-project-ready" ? "reject" : "init-current"
      };
    }

    function getWorkspaceStateLabel(workspace) {
      if (!workspace) {
        return t("projectWizard.workspaceUnknown", undefined, "unknown");
      }
      if (workspace.state === "project-invalid") {
        return t("projectWizard.workspaceInvalidProject", undefined, "invalid project");
      }
      if (workspace.hasProject) {
        return t("projectWizard.workspaceHasProject", undefined, "project exists");
      }
      if (workspace.state === "non-project-conflict") {
        return t("projectWizard.workspaceControlledConflict", undefined, "controlled path conflict");
      }
      if (workspace.state === "non-project-ready") {
        return t("projectWizard.workspaceReady", undefined, "needs confirmation");
      }
      if (workspace.state === "empty") {
        return t("projectWizard.workspaceEmpty", undefined, "empty");
      }
      return t("projectWizard.workspaceNoProject", undefined, "no project");
    }

    function ensureProjectWizardDraft(workspace) {
      if (!state.projectWizardDraft) {
        state.projectWizardDraft = getProjectWizardDefaults(workspace || state.workspace || {});
      }
      return state.projectWizardDraft;
    }

    function updateProjectWizardDraftFromForm(form) {
      if (!form) {
        return ensureProjectWizardDraft(state.workspace || {});
      }
      const formData = new FormData(form);
      const draft = ensureProjectWizardDraft(state.workspace || {});
      const formHas = (name) => typeof formData.has === "function" && formData.has(name);
      const readFormValue = (name, fallback) => formHas(name) ? String(formData.get(name) || "") : fallback;
      Object.assign(draft, {
        projectName: readFormValue("projectName", String(draft.projectName || "")),
        templateId: readFormValue("templateId", String(draft.templateId || "empty")),
        conflictStrategy: readFormValue("conflictStrategy", String(draft.conflictStrategy || "reject"))
      });
      return draft;
    }

    function projectCreateErrorFromResponse(error) {
      return mapProjectCreateErrorFromResponse(error, t);
    }

    function renderFlash() {
      if (!state.flash) {
        flashEl.className = "flash hidden";
        flashEl.textContent = "";
        return;
      }
      flashEl.className = "flash " + (state.flash.kind || "info");
      flashEl.innerHTML = escapeText(state.flash.message);
    }

    function setInnerHtmlIfChanged(element, html) {
      if (!element) {
        return false;
      }
      if (element.innerHTML === html) {
        return false;
      }
      element.innerHTML = html;
      return true;
    }

    function queryAll(selector, root) {
      if (root && typeof root.querySelectorAll === "function") {
        return Array.from(root.querySelectorAll(selector));
      }
      if (root && typeof root.querySelector === "function") {
        const direct = root.querySelector(selector);
        return direct ? [direct] : [];
      }
      if (typeof document.querySelectorAll === "function") {
        return Array.from(document.querySelectorAll(selector));
      }
      if (typeof document.querySelector === "function") {
        const single = document.querySelector(selector);
        return single ? [single] : [];
      }
      return [];
    }

    function resolveWorkbenchViewTabsSlot() {
      if (state.workbenchView === "bridge") {
        return findStudioBridgeElement('[data-workbench-view-tabs-slot="bridge"]') || workbenchViewTabsSlotEl;
      }
      return workbenchViewTabsSlotEl;
    }

    function renderWorkbenchViewTabs() {
      const html = renderWorkbenchViewTabsHtml({
        buildMode: state.buildMode,
        workbenchView: state.workbenchView,
        t,
        escapeText
      });
      const slots = queryAll("[data-workbench-view-tabs-slot]");
      for (const slot of slots) {
        if (slot !== resolveWorkbenchViewTabsSlot()) {
          setInnerHtmlIfChanged(slot, "");
        }
      }
      setInnerHtmlIfChanged(resolveWorkbenchViewTabsSlot(), html);
    }

    function bindOnce(element, eventName, marker, handler) {
      if (!element) {
        return;
      }
      const markerName = "data-bound-" + marker;
      if (typeof element.getAttribute === "function" && element.getAttribute(markerName) === "true") {
        return;
      }
      if (typeof element.setAttribute === "function") {
        element.setAttribute(markerName, "true");
      } else {
        element[markerName] = "true";
      }
      element.addEventListener(eventName, handler);
    }

    function loadingSkeleton(label, rows) {
      return renderLoadingSkeletonHtml({ label, rows, t, escapeText });
    }

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function setProjectCreateStage(stage) {
      state.projectCreateStage = stage || "";
      renderProject();
      if (state.consoleTab === "build" || state.workbenchView === "bridge") {
        renderWorkbench({
          preserveEditor: true,
          preserveStudioGraphRoot: state.workbenchView === "bridge"
        });
      }
    }

    function hasStudioBridgeGraphContent(bridge) {
      const roles = Array.isArray(bridge?.extracted?.roles) ? bridge.extracted.roles : [];
      const authoringRoles = bridge?.authoring?.roles && typeof bridge.authoring.roles === "object"
        ? Object.keys(bridge.authoring.roles)
        : [];
      return roles.length > 0 || authoringRoles.length > 0;
    }

    function projectCreateStageMessage(stage) {
      if (stage === "request") {
        return t("projectWizard.createStage.request", undefined, "Writing project files and template content.");
      }
      if (stage === "project") {
        return t("projectWizard.createStage.project", undefined, "Loading project summary and workspace data.");
      }
      if (stage === "workbench") {
        return t("projectWizard.createStage.workbench", undefined, "Preparing Mermaid workbench and source state.");
      }
      if (stage === "bridge") {
        return t("projectWizard.createStage.bridge", undefined, "Loading the graph workspace and checking that graph authoring is visible.");
      }
      return t("projectWizard.createInProgress", undefined, "Creating project...");
    }

    function projectCreateStageBadge(stage) {
      if (stage === "request") return "1 / 4";
      if (stage === "project") return "2 / 4";
      if (stage === "workbench") return "3 / 4";
      if (stage === "bridge") return "4 / 4";
      return "…";
    }

    function projectCreateStageDetail(stage) {
      const templateId = String(state.projectWizardDraft?.templateId || "empty");
      if (stage === "request") {
        return templateId === "minimal"
          ? t("projectWizard.createStageDetail.requestMinimal", undefined, "Scaffolding the minimal runnable template and writing system.mmd.")
          : t("projectWizard.createStageDetail.requestDefault", undefined, "Scaffolding project files for the selected template.")
      }
      if (stage === "project") {
        return t("projectWizard.createStageDetail.project", undefined, "Reading project metadata, controlled paths, and workspace readiness.");
      }
      if (stage === "workbench") {
        return t("projectWizard.createStageDetail.workbench", undefined, "Preparing Mermaid source, draft state, and Build editor context.");
      }
      if (stage === "bridge") {
        return t("projectWizard.createStageDetail.bridge", undefined, "Mounting graph authoring and verifying roles and flows are visible.");
      }
      return "";
    }

    function projectCreateStageStatus(step, currentStage) {
      const order = ["request", "project", "workbench", "bridge"];
      const stepIndex = order.indexOf(step);
      const currentIndex = order.indexOf(currentStage);
      if (stepIndex === -1 || currentIndex === -1) {
        return "pending";
      }
      if (stepIndex < currentIndex) {
        return "done";
      }
      if (stepIndex === currentIndex) {
        return "active";
      }
      return "pending";
    }

    function renderProjectCreateStageTimeline(currentStage) {
      const steps = ["request", "project", "workbench", "bridge"];
      return '<div class="project-create-stage-list">' + steps.map((step) => {
        const status = projectCreateStageStatus(step, currentStage);
        const badge = status === "done" ? "done" : projectCreateStageBadge(step);
        return '<div class="project-create-stage-item ' + escapeText(status) + '">' +
          '<div class="event-top"><span class="' + (status === "active" ? "severity-info" : "") + '">' + escapeText(projectCreateStageMessage(step)) + '</span><span class="' + (status === "done" ? "severity-info" : status === "active" ? "severity-warning" : "") + '">' + escapeText(badge) + '</span></div>' +
          '<div class="hint ' + (status === "active" ? "severity-info" : "") + '">' + escapeText(projectCreateStageDetail(step)) + '</div>' +
        '</div>';
      }).join("") + '</div>';
    }

    function setActionBusy(actionId) {
      state.actionBusy = actionId;
      renderActionForm();
      renderLogs();
      renderActionState();
      if (actionId === "project:create" || !actionId) {
        renderProject();
      }
      if (state.workbench) {
        renderWorkbench({
          preserveEditor: true,
          preserveStudioGraphRoot: state.workbenchView === "bridge"
        });
      }
      if (state.workbenchView === "bridge" && typeof patchStudioChatPanel === "function") {
        patchStudioChatPanel();
      }
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

    function workspaceEmptyStateHtml(kind) {
      const workspace = state.workspace || {};
      if (workspace.state === "project-invalid") {
        const diagnostics = Array.isArray(workspace.projectValidation?.diagnostics)
          ? workspace.projectValidation.diagnostics
          : [];
        const title = t("workspace.invalidProjectTitle", undefined, "This directory contains an invalid OGSystem project.");
        const hint = kind === "build"
          ? t("workspace.invalidProjectBuildHint", undefined, "Fix the project diagnostics before editing in Build.")
          : kind === "validate"
            ? t("workspace.invalidProjectValidateHint", undefined, "Fix the project diagnostics before running validation or release gates.")
            : t("workspace.invalidProjectOperateHint", undefined, "Fix the project diagnostics before using runtime views.");
        return [
          '<div class="event blocker"><div class="event-top"><span class="severity-critical">' + escapeText(t("common.attention", undefined, "attention")) + '</span><span class="severity-critical">' + escapeText(t("workspace.invalidProjectStatus", undefined, "invalid project")) + '</span></div><strong class="severity-critical">' + escapeText(title) + '</strong><div class="hint severity-warning">' + escapeText(hint) + '</div></div>',
          diagnostics.length
            ? diagnostics.slice(0, 5).map((diagnostic) => {
                const message = typeof diagnostic?.message === "string" ? diagnostic.message : t("common.unknown", undefined, "unknown");
                const code = typeof diagnostic?.code === "string" ? diagnostic.code : "error";
                return '<div class="event blocker"><div class="event-top"><span class="severity-critical">' + escapeText(code) + '</span><span class="severity-warning">' + escapeText(t("workspace.repairRequired", undefined, "repair required")) + '</span></div><strong class="severity-critical">' + escapeText(message) + '</strong></div>';
              }).join("")
            : ""
        ].join("");
      }
      return renderWorkspaceEmptyStateHtml({ kind, t, escapeText });
    }

    function renderActionState() {
      const disabled = Boolean(state.actionBusy);
      const noProject = !state.hasProject;
      const stopDisabled = disabled || !canRequestStop();
      if (releaseExportButton) releaseExportButton.disabled = disabled || noProject;
      reindexButton.disabled = disabled || noProject;
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
      for (const button of queryAll("[data-workbench-view-tabs-slot] .workbench-view-tabs button")) {
        button.disabled = disabled;
      }
      if (operateTabsEl) {
        for (const button of operateTabsEl.querySelectorAll("button")) {
          button.disabled = disabled;
        }
      }
      if (consoleTabsEl) {
        for (const button of consoleTabsEl.querySelectorAll("[data-console-tab]")) {
          button.disabled = disabled;
        }
      }
      if (logPageSizeEl) {
        logPageSizeEl.disabled = disabled || !state.selectedRunId;
      }
      for (const button of reviewActionsEl.querySelectorAll("[data-review-action]")) {
        button.disabled = disabled;
      }
      renderHeroActions();
      renderGlobalStatusBar();
    }

    function setSidebarOpen(nextValue) {
      const canOpen = state.consoleTab === "operate" || state.consoleTab === "legacy";
      state.sidebarOpen = Boolean(nextValue && canOpen);
      document.body.classList.toggle("drawer-open", state.sidebarOpen);
      if (sidebarToggleButton) {
        sidebarToggleButton.setAttribute("aria-expanded", state.sidebarOpen ? "true" : "false");
      }
    }

    function renderOperateTabs() {
      const showOperateWorkspace = state.consoleTab === "operate";
      document.body.classList.toggle("show-operate-workspace", showOperateWorkspace);
      for (const tab of ["overview", "graph", "recovery", "logs", "reviews", "artifacts"]) {
        document.body.classList.toggle("operate-tab-" + tab, showOperateWorkspace && state.operateTab === tab);
      }
      if (!operateTabsEl) {
        return;
      }
      operateTabsEl.setAttribute("role", "tablist");
      operateTabsEl.setAttribute("aria-label", t("operate.tablist", undefined, "Operate views"));
      if (!showOperateWorkspace) {
        setInnerHtmlIfChanged(operateTabsEl, "");
        return;
      }
      setInnerHtmlIfChanged(operateTabsEl, renderOperateTabsHtml({ operateTab: state.operateTab, t, escapeText }));
      for (const button of operateTabsEl.querySelectorAll("[data-operate-tab]")) {
        button.disabled = Boolean(state.actionBusy);
        bindOnce(button, "click", "operate-tab", () => {
          state.operateTab = button.getAttribute("data-operate-tab") || "overview";
          renderConsoleTabs();
          renderActionState();
        });
      }
    }

    function renderHeroActions() {
      const isOperate = state.consoleTab === "operate" || state.consoleTab === "legacy";
      if (resumeRunButton) {
        resumeRunButton.hidden = !isOperate;
        resumeRunButton.disabled = !state.selectedRunId;
      }
      if (stopRunButton) {
        stopRunButton.hidden = !isOperate;
        stopRunButton.disabled = !state.selectedRunId;
      }
    }

    function renderConsoleTabs() {
      if (!consoleTabsEl) {
        return;
      }
      setInnerHtmlIfChanged(consoleTabsEl, renderConsoleTabsHtml({
        consoleTab: state.consoleTab,
        legacyConsoleTab: state.legacyConsoleTab,
        operateTab: state.operateTab,
        t,
        escapeText
      }));
      const visiblePanelIds = new Set(getVisibleConsolePanelIds({
        consoleTab: state.consoleTab,
        legacyConsoleTab: state.legacyConsoleTab,
        operateTab: state.operateTab
      }));
      renderConsolePanels(visiblePanelIds);
      const showRunSidebar = shouldShowRunSidebar(state.consoleTab);
      document.body.classList.toggle("show-run-sidebar", showRunSidebar);
      if (!showRunSidebar) {
        setSidebarOpen(false);
      }
      if (sidebarToggleButton) {
        sidebarToggleButton.hidden = !showRunSidebar;
        sidebarToggleButton.setAttribute("aria-expanded", showRunSidebar && state.sidebarOpen ? "true" : "false");
      }
      renderOperateTabs();
      renderHeroActions();
      for (const button of consoleTabsEl.querySelectorAll("[data-console-tab]")) {
        bindOnce(button, "click", "console-tab", () => {
          state.consoleTab = button.getAttribute("data-console-tab") || "operate";
          state.projectHome = state.consoleTab === "project";
          if (state.consoleTab === "build" && state.hasProject) {
            state.workbenchView = "bridge";
            const refreshWorkdir = state.workspace?.workdir || "";
            void refreshStudioBridge().catch((error) => {
              if (refreshWorkdir !== (state.workspace?.workdir || "")) {
                return;
              }
              setFlash("error", t("flash.studioBridgeRefreshFailed", { message: error.message || error }, "Studio Bridge refresh failed: {message}"));
            });
          }
          renderConsoleTabs();
          renderSelectedRun();
          renderActionState();
          writeRouteToLocation();
        });
      }
      for (const button of consoleTabsEl.querySelectorAll("[data-legacy-console-tab]")) {
        bindOnce(button, "click", "legacy-console-tab", () => {
          state.legacyConsoleTab = button.getAttribute("data-legacy-console-tab") || "debug";
          renderConsoleTabs();
          renderActionState();
        });
      }
    }

    function renderWorkbenchPreviewSvg(structure) {
      return renderWorkbenchTopologySvg(structure);
    }

    function renderWorkbenchStructure(structure) {
      return renderWorkbenchStructureHtml({ structure, t, escapeText });
    }

    function studioBridgeRenderArgs() {
      const bridge = state.studioBridge || {
        validation: state.workbench?.validation || null,
        extracted: state.workbench?.validation?.structure || null
      };
      return {
        bridge,
        readiness: state.projectReadiness,
        selectedRoleId: state.studioBridgeSelectedRoleId,
        selectedFlowKey: state.studioBridgeSelectedFlowKey,
        filter: state.studioBridgeFilter,
        listMode: state.studioBridgeListMode,
        sideTab: state.studioWorkbenchSideTab,
        fullscreen: state.studioBridgeFullscreen,
        rolePackageEditor: state.studioRolePackageEditor,
        selectionDocked: state.studioSelectionDialogDocked !== false,
        selectionCollapsed: state.studioSelectionDialogCollapsed === true,
        actionBusy: state.actionBusy,
        t
      };
    }

    function renderStudioBridge(options) {
      if (state.studioSelectionDialogDocked !== false) {
        state.studioSelectionDialogOpen = true;
      }
      const args = studioBridgeRenderArgs();
      const html = renderStudioBridgePanel(args);
      const preservedRoot = options?.preserveGraphRoot ? document.getElementById("studio-graph-root") : null;
      if (options?.preserveGraphRoot && document.getElementById("studio-graph-root")) {
        patchStudioBridgePanel(html);
      } else {
        workbenchBodyEl.innerHTML = html;
      }
      renderWorkbenchViewTabs();
      const currentRoot = document.getElementById("studio-graph-root");
      if (preservedRoot && currentRoot && currentRoot !== preservedRoot && typeof currentRoot.replaceWith === "function") {
        currentRoot.replaceWith(preservedRoot);
      }
      updateStudioBridgeSelection(false);
      syncStudioBridgeFullscreenChrome();
      bindStudioBridgeControls();
      mountStudioGraphIsland();
      const currentChat = findStudioBridgeElement('[data-studio-bridge-region="chat"]');
      const chatTemplate = document.createElement("template");
      chatTemplate.innerHTML = renderStudioChatPanel();
      const nextChat = chatTemplate.content?.querySelector?.('[data-studio-bridge-region="chat"]');
      if (currentChat && nextChat) {
        currentChat.replaceWith(nextChat);
      } else if (!currentChat) {
        workbenchBodyEl.insertAdjacentHTML("beforeend", renderStudioChatPanel());
      }
      bindStudioChatControls();
    }

    function patchStudioBridgePanel(html) {
      const template = document.createElement("template");
      template.innerHTML = html;
      if (!template.content || typeof template.content.querySelector !== "function") {
        workbenchBodyEl.innerHTML = html;
        return;
      }
      for (const region of ["toolbar", "graph", "index", "navigator", "flow-list", "diagnostics"]) {
        const current = findStudioBridgeElement('[data-studio-bridge-region="' + region + '"]');
        const next = template.content.querySelector('[data-studio-bridge-region="' + region + '"]');
        if (current && next) {
          current.replaceWith(next);
        }
      }
      renderWorkbenchViewTabs();
      updateStudioBridgeSelection(false);
    }

    function bindStudioBridgeControls() {
      attachStudioBridgeControls({
        root: workbenchBodyEl,
        findElement: findStudioBridgeElement,
        onRoleSelect: (roleId) => {
          state.studioBridgeSelectedRoleId = roleId;
          state.studioBridgeSelectedFlowKey = "";
          state.studioSelectionDialogOpen = true;
          state.studioWorkbenchSideTab = "selection";
          state.studioBridgeEditSelectionRequest += 1;
          updateStudioBridgeSelection(true);
          void loadStudioRolePackageEditor(roleId);
        },
        onFlowSelect: (flowKey) => {
          state.studioBridgeSelectedFlowKey = flowKey;
          state.studioBridgeSelectedRoleId = "";
          state.studioSelectionDialogOpen = true;
          state.studioWorkbenchSideTab = "selection";
          state.studioBridgeEditSelectionRequest += 1;
          updateStudioBridgeSelection(true);
        },
        onFilterInput: (value) => {
          // Studio Bridge filtering stays local; remote refreshes remain explicit actions.
          state.studioBridgeFilter = value;
          renderStudioBridge({ preserveGraphRoot: true });
        },
        onListModeChange: (value) => {
          state.studioBridgeListMode = value === "roles" || value === "flows" ? value : "all";
          renderStudioBridge({ preserveGraphRoot: true });
        }
      });
      bindStudioSelectionDialogControls();
      bindStudioRolePackageEditorControls();
    }

    function updateStudioBridgeSelection(syncGraph) {
      updateStudioBridgeSelectionChrome();
      renderStudioSelectionDialog();
      if (syncGraph !== false) {
        mountStudioGraphIsland();
      }
    }

    function selectedStudioRoleId() {
      return state.studioBridgeSelectedRoleId || "";
    }

    function rolePackageEditorFileElements() {
      return Array.from(workbenchBodyEl.querySelectorAll("[data-role-package-file]") || []);
    }

    function readRolePackageEditorDraftFiles() {
      const files = {};
      for (const element of rolePackageEditorFileElements()) {
        const fileName = element.getAttribute("data-role-package-file") || "";
        if (fileName) {
          files[fileName] = typeof element.value === "string" ? element.value : "";
        }
      }
      return files;
    }

    function rolePackageEditorRoleIdForSelectionDialog() {
      const selectedRoleIdValue = state.studioBridgeSelectedRoleId || "";
      const editor = state.studioRolePackageEditor || {};
      if (editor.dirty && editor.roleId) {
        return String(editor.roleId || selectedRoleIdValue);
      }
      return selectedRoleIdValue;
    }

    function hasDirtyStudioRolePackageEditor() {
      return state.studioRolePackageEditor?.dirty === true;
    }

    function clearStudioSelectionDialogState() {
      state.studioSelectionDialogOpen = false;
      state.studioSelectionDialogCollapsed = false;
      state.studioSelectionCommandFormOpen = false;
      state.studioSelectionCommandKind = "";
      state.studioSelectionDismissCommandFormRequest += 1;
    }

    function closeStudioSelectionDialog(options) {
      if (!options?.force && hasDirtyStudioRolePackageEditor()) {
        const dirtyRoleId = String(state.studioRolePackageEditor?.roleId || state.studioBridgeSelectedRoleId || "");
        setFlash("info", t("studio.rolePackageDirtySwitchBlocked", { roleId: dirtyRoleId }, "Role package changes for {roleId} are unsaved. Save or revert before closing details."));
        return false;
      }
      if (options?.clearSelection !== false) {
        state.studioBridgeSelectedRoleId = "";
        state.studioBridgeSelectedFlowKey = "";
      }
      state.studioSelectionCommandFormOpen = false;
      state.studioSelectionCommandKind = "";
      state.studioSelectionDismissCommandFormRequest += 1;
      if (state.studioSelectionDialogDocked !== false) {
        state.studioWorkbenchSideTab = "structure";
        state.studioSelectionDialogOpen = true;
      } else {
        clearStudioSelectionDialogState();
      }
      updateStudioBridgeSelection(options?.syncGraph !== false);
      return true;
    }

    function renderStudioSelectionDialog() {
      const shell = findStudioBridgeElement("[data-studio-canvas-shell]");
      const overlay = findStudioBridgeElement("[data-studio-selection-overlay]");
      const dialog = findStudioBridgeElement("[data-studio-selection-dialog]");
      const kindLabel = findStudioBridgeElement("[data-studio-selection-kind-label]");
      const title = findStudioBridgeElement("[data-studio-selection-title]");
      const rolePackage = findStudioBridgeElement("[data-studio-selection-role-package]");
      const selectionPanel = findStudioBridgeElement('[data-studio-selection-panel="selection"]');
      const structurePanel = findStudioBridgeElement('[data-studio-selection-panel="structure"]');
      if (!shell || !overlay || !dialog || !kindLabel || !title || !rolePackage || !selectionPanel || !structurePanel) {
        return;
      }
      const selectedRoleIdValue = state.studioBridgeSelectedRoleId || "";
      const selectedFlowKeyValue = state.studioBridgeSelectedFlowKey || "";
      const selectionKind = selectedRoleIdValue
        ? "role"
        : selectedFlowKeyValue
          ? "flow"
          : "";
      const hasSelectionContent = Boolean(selectionKind || state.studioSelectionCommandFormOpen);
      const docked = state.studioSelectionDialogDocked !== false;
      const activeTab = state.studioWorkbenchSideTab === "selection" && hasSelectionContent
        ? "selection"
        : "structure";
      const shouldOpen = docked
        ? state.studioSelectionDialogOpen !== false
        : state.studioSelectionDialogOpen && (hasSelectionContent || activeTab === "structure");
      const collapsed = state.studioSelectionDialogCollapsed === true;
      overlay.hidden = !shouldOpen;
      overlay.classList.toggle("is-open", shouldOpen);
      overlay.classList.toggle("is-docked", docked);
      overlay.classList.toggle("is-collapsed", collapsed);
      shell.classList.toggle("has-docked-selection", shouldOpen && docked);
      shell.classList.toggle("has-collapsed-selection", shouldOpen && docked && collapsed);
      selectionPanel.hidden = activeTab !== "selection";
      structurePanel.hidden = activeTab !== "structure";
      for (const button of Array.from(dialog.querySelectorAll?.("[data-studio-side-tab]") || [])) {
        const tab = button.getAttribute("data-studio-side-tab") || "";
        const active = tab === activeTab;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.setAttribute("aria-selected", active ? "true" : "false");
      }
      if (!shouldOpen) {
        rolePackage.innerHTML = "";
        return;
      }

      if (activeTab === "structure") {
        kindLabel.textContent = t("studio.graphIndex", undefined, "graph index");
        title.textContent = t("studio.topologyOrder", undefined, "topology order");
      } else if (selectionKind === "role") {
        kindLabel.textContent = t("studio.roleInspector", undefined, "role inspector");
        title.textContent = selectedRoleIdValue;
      } else if (selectionKind === "flow") {
        kindLabel.textContent = t("studio.flowInspector", undefined, "flow inspector");
        title.textContent = selectedFlowKeyValue;
      } else if (state.studioSelectionCommandFormOpen) {
        kindLabel.textContent = t("studio.graphWorkspace", undefined, "Graph workspace");
        title.textContent = state.studioSelectionCommandKind || t("common.edit", undefined, "edit");
      } else {
        kindLabel.textContent = t("studio.graphWorkspace", undefined, "Graph workspace");
        title.textContent = t("studio.selectRole", undefined, "Select a role to inspect metadata.");
      }
      dialog.setAttribute("aria-label", title.textContent || kindLabel.textContent || t("studio.graphWorkspace", undefined, "Graph workspace"));
      const pinButton = overlay.querySelector?.("[data-studio-selection-pin]");
      if (pinButton) {
        pinButton.textContent = docked ? "undock" : "dock";
      }
      const collapseButton = overlay.querySelector?.("[data-studio-selection-collapse]");
      if (collapseButton) {
        collapseButton.textContent = collapsed ? ">" : "<";
      }

      if (activeTab === "selection" && selectionKind === "role") {
        const editorRoleId = rolePackageEditorRoleIdForSelectionDialog();
        const dirtyRoleId = String(state.studioRolePackageEditor?.roleId || "");
        const showDirtyRoleWarning = hasDirtyStudioRolePackageEditor() && dirtyRoleId && dirtyRoleId !== selectedRoleIdValue;
        rolePackage.innerHTML = [
          showDirtyRoleWarning
            ? '<div class="event"><div class="event-top"><span>' + escapeText(t("common.attention", undefined, "attention")) + '</span><span>' + escapeText(t("common.changed", undefined, "changed")) + '</span></div><strong>' +
              escapeText(t("studio.rolePackageDirtySwitchBlocked", { roleId: dirtyRoleId }, "Role package changes for {roleId} are unsaved. Save or revert before switching role packages.")) +
              '</strong></div>'
            : "",
          renderStudioRolePackageEditor({
            roleId: editorRoleId || selectedRoleIdValue,
            editor: state.studioRolePackageEditor,
            t
          })
        ].join("");
      } else if (activeTab === "selection" && selectionKind === "flow") {
        const bridge = state.studioBridge || {};
        const extracted = bridge.extracted || {};
        const flows = Array.isArray(extracted.flows) ? extracted.flows : [];
        const selectedFlow = flows.find((flow) => String(flow.flowKey || "") === selectedFlowKeyValue) || null;
        if (selectedFlow) {
          rolePackage.innerHTML = '<div class="event"><div class="event-top"><span>' +
            escapeText(t("studio.flowInspector", undefined, "flow inspector")) + '</span><span>' +
            escapeText(String(selectedFlow.eventType || "")) + '</span></div><strong><code>' +
            escapeText(String(selectedFlow.fromRoleId || "")) + '</code> -> <code>' +
            escapeText(String(selectedFlow.toRoleId || "")) + '</code></strong><div class="hint">' +
            escapeText(t("studio.flowDisplayIdentity", {
              label: flowDisplayLabel(selectedFlow),
              eventType: String(selectedFlow.eventType || "")
            }, "display " + flowDisplayLabel(selectedFlow) + " · event " + String(selectedFlow.eventType || ""))) +
            '</div></div>';
        } else {
          rolePackage.innerHTML = '<div class="hint">' + escapeText(t("studio.selectFlow", undefined, "Select a flow to inspect event metadata.")) + "</div>";
        }
      } else {
        rolePackage.innerHTML = "";
      }
      bindStudioRolePackageEditorControls();
    }

    function bindStudioSelectionDialogControls() {
      for (const button of Array.from(workbenchBodyEl.querySelectorAll("[data-studio-side-tab]") || [])) {
        bindOnce(button, "click", "studio-selection-tab", () => {
          const nextTab = button.getAttribute("data-studio-side-tab") || "structure";
          if (nextTab === "selection" && !state.studioBridgeSelectedRoleId && !state.studioBridgeSelectedFlowKey && !state.studioSelectionCommandFormOpen) {
            return;
          }
          state.studioWorkbenchSideTab = nextTab === "selection" ? "selection" : "structure";
          state.studioSelectionDialogOpen = true;
          renderStudioSelectionDialog();
        });
      }
      for (const button of Array.from(workbenchBodyEl.querySelectorAll("[data-studio-selection-close]") || [])) {
        bindOnce(button, "click", "studio-selection-close", () => {
          closeStudioSelectionDialog({ clearSelection: true, syncGraph: true });
        });
      }
      for (const button of Array.from(workbenchBodyEl.querySelectorAll("[data-studio-selection-pin]") || [])) {
        bindOnce(button, "click", "studio-selection-pin", () => {
          state.studioSelectionDialogDocked = !state.studioSelectionDialogDocked;
          renderStudioSelectionDialog();
        });
      }
      for (const button of Array.from(workbenchBodyEl.querySelectorAll("[data-studio-selection-collapse]") || [])) {
        bindOnce(button, "click", "studio-selection-collapse", () => {
          state.studioSelectionDialogCollapsed = !state.studioSelectionDialogCollapsed;
          renderStudioSelectionDialog();
        });
      }
    }

    async function refreshRolePackageDependentProjectState() {
      const [readiness, rolePackages, roleCatalog] = await Promise.all([
        requestJson(API_PREFIX + "/project/readiness").catch(() => state.projectReadiness),
        requestJson(API_PREFIX + "/project/role-packages").catch(() => state.rolePackages),
        requestJson(API_PREFIX + "/project/role-catalog").catch(() => state.studioRoleCatalog)
      ]);
      state.projectReadiness = readiness;
      state.rolePackages = rolePackages;
      state.studioRoleCatalog = roleCatalog || state.studioRoleCatalog;
      renderProject();
    }

    async function loadStudioRolePackageEditor(roleId, options) {
      const selectedRoleIdValue = roleId || selectedStudioRoleId();
      if (!selectedRoleIdValue) {
        return;
      }
      if (state.studioRolePackageEditor?.dirty && !options?.force) {
        if (selectedRoleIdValue !== state.studioRolePackageEditor?.roleId) {
          setFlash("info", t("studio.rolePackageDirtySwitchBlocked", {
            roleId: String(state.studioRolePackageEditor?.roleId || "")
          }, "Role package changes for {roleId} are unsaved. Save or revert before switching role packages."));
        }
        renderStudioSelectionDialog();
        return;
      }
      state.studioRolePackageEditor = {
        ...(state.studioRolePackageEditor || {}),
        roleId: selectedRoleIdValue,
        loading: true,
        saving: false,
        error: "",
        dirty: false,
        loaded: state.studioRolePackageEditor?.roleId === selectedRoleIdValue && state.studioRolePackageEditor?.loaded === true,
        data: state.studioRolePackageEditor?.roleId === selectedRoleIdValue ? state.studioRolePackageEditor?.data : null,
        draftFiles: state.studioRolePackageEditor?.roleId === selectedRoleIdValue ? state.studioRolePackageEditor?.draftFiles || {} : {}
      };
      renderStudioSelectionDialog();
      try {
        const payload = await requestJson(API_PREFIX + "/project/role-packages/" + encodeURIComponent(selectedRoleIdValue));
        if (state.studioRolePackageEditor?.roleId !== selectedRoleIdValue) {
          return;
        }
        const files = payload.files || {};
        const draftFiles = {};
        for (const fileName of ["role.json", "agent.md", "prompt.md", "output.schema.json"]) {
          draftFiles[fileName] = files[fileName]?.content || "";
        }
        state.studioRolePackageEditor = {
          roleId: selectedRoleIdValue,
          loading: false,
          saving: false,
          loaded: true,
          dirty: false,
          error: "",
          data: payload,
          draftFiles
        };
      } catch (error) {
        if (state.studioRolePackageEditor?.roleId !== selectedRoleIdValue) {
          return;
        }
        state.studioRolePackageEditor = {
          ...(state.studioRolePackageEditor || {}),
          roleId: selectedRoleIdValue,
          loading: false,
          saving: false,
          loaded: false,
          dirty: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
      renderStudioSelectionDialog();
    }

    function ensureStudioRolePackageEditor(roleId) {
      const roleIdValue = roleId || "";
      if (!roleIdValue) {
        return;
      }
      const editor = state.studioRolePackageEditor || {};
      if (editor.dirty || editor.loading || editor.saving) {
        return;
      }
      if (editor.roleId === roleIdValue && editor.loaded && !editor.error) {
        return;
      }
      void loadStudioRolePackageEditor(roleIdValue);
    }

    async function saveStudioRolePackageEditor(roleId) {
      const selectedRoleIdValue = roleId || state.studioRolePackageEditor?.roleId || selectedStudioRoleId();
      if (!selectedRoleIdValue) {
        return;
      }
      const draftFiles = readRolePackageEditorDraftFiles();
      state.studioRolePackageEditor = {
        ...(state.studioRolePackageEditor || {}),
        roleId: selectedRoleIdValue,
        saving: true,
        error: "",
        draftFiles
      };
      renderStudioSelectionDialog();
      try {
        const payload = await requestAction(API_PREFIX + "/project/role-packages/" + encodeURIComponent(selectedRoleIdValue), {
          files: draftFiles
        });
        const files = payload.files || {};
        const nextDraftFiles = {};
        for (const fileName of ["role.json", "agent.md", "prompt.md", "output.schema.json"]) {
          nextDraftFiles[fileName] = files[fileName]?.content || "";
        }
        state.studioRolePackageEditor = {
          roleId: selectedRoleIdValue,
          loading: false,
          saving: false,
          loaded: true,
          dirty: false,
          error: "",
          data: payload,
          draftFiles: nextDraftFiles
        };
        await refreshRolePackageDependentProjectState();
        await refreshStudioBridge({ preserveGraphRoot: true });
        setFlash("success", t("studio.rolePackageSaved", { roleId: selectedRoleIdValue }, "Role package saved: {roleId}."));
      } catch (error) {
        state.studioRolePackageEditor = {
          ...(state.studioRolePackageEditor || {}),
          roleId: selectedRoleIdValue,
          saving: false,
          dirty: true,
          error: error instanceof Error ? error.message : String(error),
          draftFiles
        };
      }
      renderStudioSelectionDialog();
    }

    function bindStudioRolePackageEditorControls() {
      for (const button of Array.from(workbenchBodyEl.querySelectorAll("[data-role-package-load]") || [])) {
        bindOnce(button, "click", "role-package-load", () => {
          void loadStudioRolePackageEditor(button.getAttribute("data-role-package-load") || selectedStudioRoleId(), { force: true });
        });
      }
      for (const button of Array.from(workbenchBodyEl.querySelectorAll("[data-role-package-save]") || [])) {
        bindOnce(button, "click", "role-package-save", () => {
          void saveStudioRolePackageEditor(button.getAttribute("data-role-package-save") || selectedStudioRoleId());
        });
      }
      for (const button of Array.from(workbenchBodyEl.querySelectorAll("[data-role-package-revert]") || [])) {
        bindOnce(button, "click", "role-package-revert", () => {
          void loadStudioRolePackageEditor(button.getAttribute("data-role-package-revert") || selectedStudioRoleId(), { force: true });
        });
      }
      for (const element of rolePackageEditorFileElements()) {
        bindOnce(element, "input", "role-package-file", () => {
          state.studioRolePackageEditor = {
            ...(state.studioRolePackageEditor || {}),
            roleId: state.studioRolePackageEditor?.roleId || selectedStudioRoleId(),
            dirty: true,
            error: "",
            draftFiles: readRolePackageEditorDraftFiles()
          };
          for (const button of Array.from(workbenchBodyEl.querySelectorAll("[data-role-package-save], [data-role-package-revert]") || [])) {
            if (typeof button.removeAttribute === "function") {
              button.removeAttribute("disabled");
            }
            button.disabled = false;
          }
          renderStudioSelectionDialog();
        });
      }
    }

    function resolveStudioGraphCanvas() {
      const fallbackCanvas = buildStudioCanvasFromBridge(state.studioBridge);
      const currentCanvas = state.studioCanvas;
      const currentNodes = Array.isArray(currentCanvas?.nodes) ? currentCanvas.nodes : [];
      const fallbackNodes = Array.isArray(fallbackCanvas?.nodes) ? fallbackCanvas.nodes : [];
      if (currentNodes.length > 0 || fallbackNodes.length === 0) {
        return currentCanvas || fallbackCanvas;
      }
      return fallbackCanvas;
    }

    function updateStudioBridgeSelectionChrome() {
      const selectedRoleId = state.studioBridgeSelectedRoleId || "";
      const selectedFlowKey = state.studioBridgeSelectedFlowKey || "";
      const label = findStudioBridgeElement("[data-studio-graph-selection-label]");
      if (label) {
        label.textContent = renderStudioBridgeSelectionLabel({ selectedRoleId, selectedFlowKey, t });
      }
      const root = document.getElementById("studio-graph-root");
      if (root) {
        root.dataset.selectedRoleId = selectedRoleId;
        root.dataset.selectedFlowKey = selectedFlowKey;
      }
      for (const button of workbenchBodyEl.querySelectorAll("[data-studio-role-id]")) {
        button.classList.toggle("active", (button.getAttribute("data-studio-role-id") || "") === selectedRoleId);
      }
      for (const button of workbenchBodyEl.querySelectorAll("[data-studio-flow-key]")) {
        button.classList.toggle("active", (button.getAttribute("data-studio-flow-key") || "") === selectedFlowKey);
      }
    }

    function syncStudioBridgeFullscreenChrome() {
      const shell = findStudioBridgeElement("[data-studio-canvas-shell]");
      if (shell) {
        shell.classList.toggle("is-fullscreen", Boolean(state.studioBridgeFullscreen));
      }
    }

    function findStudioBridgeElement(selector) {
      if (typeof workbenchBodyEl.querySelector === "function") {
        return workbenchBodyEl.querySelector(selector);
      }
      if (typeof workbenchBodyEl.querySelectorAll === "function") {
        return workbenchBodyEl.querySelectorAll(selector)[0] || null;
      }
      return null;
    }

    function renderStudioChatPanel() {
      return renderStudioChatPanelHtml({ state, t, escapeText });
    }

    function patchStudioChatPanel() {
      const current = findStudioBridgeElement('[data-studio-bridge-region="chat"]');
      if (!current) {
        return;
      }
      renderStudioBridge({ preserveGraphRoot: true });
    }

    function openStudioChatDialog() {
      state.studioChatDialogOpen = true;
      state.studioChatCollapsed = false;
      patchStudioChatPanel();
      const input = document.getElementById("studio-chat-input");
      if (input && typeof input.focus === "function") {
        input.focus();
      }
    }

    function closeStudioChatDialog() {
      if (state.studioChatAbortController) {
        const error = new Error(t("studio.chat.cancelled", undefined, "Studio chat request cancelled."));
        error.code = "CLIENT_REQUEST_ABORTED";
        state.studioChatAbortController.abort(error);
        state.studioChatAbortController = null;
      }
      state.studioChatDialogOpen = false;
      patchStudioChatPanel();
    }

    function bindStudioChatControls() {
      attachStudioChatControls({
        getElementById: (id) => document.getElementById(id),
        onToggle: () => {
          state.studioChatCollapsed = !state.studioChatCollapsed;
          patchStudioChatPanel();
        },
        onInput: (value) => {
          state.studioChatDraftMessage = value;
        },
        onSend: () => {
          void submitStudioChatMessage(state.studioChatDraftMessage || "");
        },
        onClose: () => {
          closeStudioChatDialog();
        },
        onRegenerate: () => {
          void submitStudioChatMessage(state.studioChatLastRequest || "", { regenerate: true });
        },
        onRefine: () => {
          const inputEl = document.getElementById("studio-chat-input");
          const refinePrompt = t("studio.chat.refinePrompt", undefined, "Refine the current preview: ");
          state.studioChatDraftMessage = refinePrompt;
          if (inputEl) {
            inputEl.value = refinePrompt;
            inputEl.focus();
          }
        },
        onApply: () => {
          void applyStudioChatResult();
        },
        onSaveDraft: () => {
          void saveStudioAuthoringDraft();
        }
      });
    }

    function canClearStudioGraphSelection() {
      if (hasDirtyStudioRolePackageEditor()) {
        const dirtyRoleId = String(state.studioRolePackageEditor?.roleId || state.studioBridgeSelectedRoleId || "");
        setFlash("info", t("studio.rolePackageDirtySwitchBlocked", { roleId: dirtyRoleId }, "Role package changes for {roleId} are unsaved. Save or revert before clearing selection."));
        return false;
      }
      state.studioSelectionCommandFormOpen = false;
      state.studioSelectionCommandKind = "";
      state.studioSelectionDismissCommandFormRequest += 1;
      state.studioWorkbenchSideTab = "structure";
      state.studioSelectionDialogOpen = state.studioSelectionDialogDocked !== false;
      return true;
    }

    if (typeof document.addEventListener === "function") {
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && state.actionForm && !state.actionBusy) {
          closeActionForm();
          return;
        }
        if (event.key === "Escape" && state.studioSelectionDialogOpen) {
          closeStudioSelectionDialog({ clearSelection: true, syncGraph: true });
          event.preventDefault();
          return;
        }
        if (event.key !== "Escape" || !state.studioBridgeFullscreen) {
          return;
        }
        state.studioBridgeFullscreen = false;
        if (state.workbenchView === "bridge") {
          renderStudioBridge({ preserveGraphRoot: true });
        }
      });
    }

    function mountStudioGraphIsland() {
      let root = document.getElementById("studio-graph-root");
      if (!root) {
        return;
      }
      if (state.studioGraphRootElement && state.studioGraphRootElement !== root && typeof root.replaceWith === "function") {
        root.replaceWith(state.studioGraphRootElement);
        root = state.studioGraphRootElement;
      } else if (!state.studioGraphRootElement) {
        state.studioGraphRootElement = root;
      }
      const visualizerClient = window.OGSVisualizerClient || {};
      const mount = visualizerClient.mountStudioX6Bridge;
      if (typeof mount !== "function") {
        root.innerHTML = '<div class="studio-graph-empty">' + escapeText(t("studio.graph.bundleLoading", undefined, "Studio graph bundle loading...")) + '</div>';
        return;
      }
      mount(root, {
        authoring: state.studioBridge?.authoring || null,
        canvas: resolveStudioGraphCanvas(),
        validation: state.studioBridge?.validation || state.workbench?.validation || null,
        selectedRoleId: state.studioBridgeSelectedRoleId,
        selectedFlowKey: state.studioBridgeSelectedFlowKey,
        editSelectionRequest: state.studioBridgeEditSelectionRequest,
        defaultAutoLayout: true,
        busy: Boolean(state.actionBusy),
        rolePackages: state.studioRoleCatalog || state.rolePackages,
        bindings: state.bindings,
        readiness: state.projectReadiness,
        projectConfig: state.project?.config,
        labels: buildStudioGraphLabels(),
        commandFormLabels: buildStudioGraphCommandFormLabels(),
        commandFormHost: findStudioBridgeElement("[data-studio-selection-command-host]"),
        dismissCommandFormRequest: state.studioSelectionDismissCommandFormRequest,
        historyEvent: state.studioGraphHistoryEvent,
        onSelectRole: (roleId) => {
          state.studioBridgeSelectedRoleId = roleId || "";
          state.studioBridgeSelectedFlowKey = "";
          state.studioSelectionDialogOpen = true;
          state.studioWorkbenchSideTab = "selection";
          updateStudioBridgeSelection(false);
          void loadStudioRolePackageEditor(roleId);
        },
        onSelectFlow: (flowKey) => {
          state.studioBridgeSelectedFlowKey = flowKey || "";
          state.studioBridgeSelectedRoleId = "";
          state.studioSelectionDialogOpen = true;
          state.studioWorkbenchSideTab = "selection";
          updateStudioBridgeSelection(false);
        },
        onBeforeClearSelection: () => canClearStudioGraphSelection(),
        onClearSelection: () => {
          state.studioBridgeSelectedRoleId = "";
          state.studioBridgeSelectedFlowKey = "";
          state.studioWorkbenchSideTab = "structure";
          state.studioSelectionDialogOpen = state.studioSelectionDialogDocked !== false;
          updateStudioBridgeSelection(false);
        },
        onCommandFormStateChange: (formState) => {
          state.studioSelectionCommandFormOpen = Boolean(formState?.open);
          state.studioSelectionCommandKind = String(formState?.kind || "");
          if (formState?.open) {
            state.studioSelectionDialogOpen = true;
            state.studioWorkbenchSideTab = "selection";
          } else if (!state.studioBridgeSelectedRoleId && !state.studioBridgeSelectedFlowKey) {
            state.studioWorkbenchSideTab = "structure";
            state.studioSelectionDialogOpen = state.studioSelectionDialogDocked !== false;
          }
          renderStudioSelectionDialog();
        },
        onApplyCanvas: async (canvas) => {
          await applyStudioGraphCanvasPatch(canvas);
        },
        onApplyCommand: async (result) => {
          await applyStudioGraphAuthoringCommand(result);
        },
        onChatGenerate: () => {
          openStudioChatDialog();
        },
        onToggleFullscreen: () => {
          state.studioBridgeFullscreen = !state.studioBridgeFullscreen;
          renderStudioBridge({ preserveGraphRoot: true });
          syncStudioBridgeFullscreenChrome();
        },
        onToast: (tone, message) => {
          setFlash(tone === "error" ? "error" : "success", message);
        }
      });
    }

    function mountRunGraphIsland(graph) {
      const root = document.getElementById("run-graph-root");
      if (!root) {
        return;
      }
      const visualizerClient = window.OGSVisualizerClient || {};
      const mount = visualizerClient.mountStudioX6Bridge;
      if (typeof mount !== "function") {
        root.innerHTML = '<div class="studio-graph-empty">' + escapeText(t("studio.graph.bundleLoading", undefined, "Studio graph bundle loading...")) + '</div>';
        return;
      }
      const bridge = buildRunStudioBridgeFromGraph(graph);
      mount(root, {
        authoring: bridge.authoring,
        canvas: bridge.canvas,
        validation: { ok: true, diagnostics: [] },
        selectedRoleId: state.runGraphSelectedRoleId,
        selectedFlowKey: state.runGraphSelectedFlowKey,
        busy: Boolean(state.actionBusy),
        readOnly: true,
        defaultAutoLayout: true,
        labels: buildStudioGraphLabels(),
        onSelectRole: (roleId) => {
          state.runGraphSelectedRoleId = roleId || "";
          state.runGraphSelectedFlowKey = "";
        },
        onSelectFlow: (flowKey) => {
          state.runGraphSelectedFlowKey = flowKey || "";
          state.runGraphSelectedRoleId = "";
        },
        onClearSelection: () => {
          state.runGraphSelectedRoleId = "";
          state.runGraphSelectedFlowKey = "";
        },
        onToast: (tone, message) => {
          setFlash(tone === "error" ? "error" : "success", message);
        }
      });
    }

    function renderWorkbench(options) {
      if (state.workbenchLoading) {
        workbenchMetaEl.textContent = t("state.loadingWorkbench", undefined, "Loading Build workbench");
        workbenchStatusEl.innerHTML = loadingSkeleton(t("state.loadingWorkbenchStatus", undefined, "Loading workbench status"), 1);
        workbenchTabsEl.innerHTML = "";
        renderWorkbenchViewTabs();
        workbenchActionsEl.innerHTML = "";
        workbenchBodyEl.innerHTML = loadingSkeleton(t("state.loadingWorkbench", undefined, "Loading Build workbench"), 5);
        return;
      }
      if (!state.hasProject) {
        const invalidProject = state.workspace?.state === "project-invalid";
        workbenchMetaEl.textContent = invalidProject
          ? t("workspace.invalidProjectBuildHint", undefined, "Fix the project diagnostics before editing in Build.")
          : t("workspace.buildUnavailableTitle", undefined, "Initialize the current directory before building.");
        workbenchStatusEl.innerHTML = '<span class="pill warn">' + escapeText(invalidProject
          ? t("workspace.invalidProjectStatus", undefined, "invalid project")
          : t("workspace.notInitialized", undefined, "not initialized")) + '</span>';
        workbenchTabsEl.innerHTML = "";
        renderWorkbenchViewTabs();
        workbenchActionsEl.innerHTML = "";
        workbenchBodyEl.innerHTML = '<div class="structure-list">' + workspaceEmptyStateHtml("build") + '</div>';
        return;
      }
      const validation = state.workbench?.validation || null;
      const diagnostics = validation?.diagnostics || [];
      const structure = validation?.structure || null;
      const dirty = state.workbenchSource !== state.workbenchDiskSource;
      const preserveEditor = Boolean(options?.preserveEditor);
      const existingEditor = document.getElementById("workbench-editor");
      const preservedStudioGraphRoot = options?.preserveStudioGraphRoot
        ? document.getElementById("studio-graph-root")
        : null;
      state.workbenchHasDraft = Boolean(loadDraftSource());
      workbenchMetaEl.textContent = state.selectedRunId && state.detail?.systemSource
        ? t("workbench.immutableRunMeta")
        : t("workbench.defaultMeta");
      const entryRoleId = structure?.entryRoleId || state.project?.summary?.project?.entryRoleId || "";
      const lastDryRunId = state.studioBridgeLastDryRunId || "";
      setInnerHtmlIfChanged(workbenchStatusEl, renderWorkbenchStatusHtml({
        dirty,
        entryRoleId,
        lastDryRunId,
        validation,
        diagnostics,
        hasDraft: state.workbenchHasDraft,
        validating: state.workbenchValidating,
        t,
        escapeText
      }));
      setInnerHtmlIfChanged(workbenchTabsEl, renderWorkbenchModeTabsHtml({
        buildMode: state.buildMode,
        t,
        escapeText
      }));
      renderWorkbenchViewTabs();
      setInnerHtmlIfChanged(workbenchActionsEl, renderWorkbenchActionsHtml({ dirty, t, escapeText }));
      if (state.buildMode === "dry-run" || state.buildMode === "debug") {
        workbenchBodyEl.innerHTML = renderWorkbenchModeBodyHtml({
          buildMode: state.buildMode,
          workbenchView: state.workbenchView,
          dirty,
          workbenchSavedPath: state.workbenchSavedPath,
          lastDryRunId,
          hasDraft: state.workbenchHasDraft,
          workbenchSource: state.workbenchSource,
          t,
          escapeText
        });
      } else
      if (state.workbenchView === "source" && preserveEditor && existingEditor) {
        if (existingEditor.value !== state.workbenchSource) {
          existingEditor.value = state.workbenchSource || "";
        }
      } else if (state.workbenchView === "source") {
        workbenchBodyEl.innerHTML = renderWorkbenchModeBodyHtml({
          buildMode: state.buildMode,
          workbenchView: state.workbenchView,
          dirty,
          workbenchSavedPath: state.workbenchSavedPath,
          lastDryRunId,
          hasDraft: state.workbenchHasDraft,
          workbenchSource: state.workbenchSource,
          t,
          escapeText
        });
      } else if (state.workbenchView === "bridge") {
        if (state.studioBridgeLoading && !state.studioBridgeLoaded && !state.studioBridge) {
          workbenchBodyEl.innerHTML = loadingSkeleton(t("state.loadingStudioBridge", undefined, "Loading graph workspace..."), 4);
        } else {
          renderStudioBridge({ preserveGraphRoot: Boolean(options?.preserveStudioGraphRoot) });
        }
      } else {
        state.workbenchView = "bridge";
        if (state.studioBridgeLoading && !state.studioBridgeLoaded && !state.studioBridge) {
          workbenchBodyEl.innerHTML = loadingSkeleton(t("state.loadingStudioBridge", undefined, "Loading graph workspace..."), 4);
        } else {
          renderStudioBridge({ preserveGraphRoot: Boolean(options?.preserveStudioGraphRoot) });
        }
      }
      if (preservedStudioGraphRoot) {
        const currentStudioGraphRoot = document.getElementById("studio-graph-root");
        if (
          currentStudioGraphRoot &&
          currentStudioGraphRoot !== preservedStudioGraphRoot &&
          typeof currentStudioGraphRoot.replaceWith === "function"
        ) {
          currentStudioGraphRoot.replaceWith(preservedStudioGraphRoot);
          updateStudioBridgeSelectionChrome();
          if (state.workbenchView === "bridge") {
            mountStudioGraphIsland();
          }
        }
      }
      const editor = document.getElementById("workbench-editor");
      if (editor && (!preserveEditor || editor !== existingEditor)) {
        editor.addEventListener("input", (event) => {
          // Keep keystrokes local until validation debounce settles.
          state.workbenchSource = event.target.value || "";
          state.studioBridgeStale = true;
          persistDraftSource(state.workbenchSource !== state.workbenchDiskSource ? state.workbenchSource : "");
          renderWorkbench({ preserveEditor: true });
          scheduleWorkbenchValidation();
        });
      }
      for (const button of queryAll("[data-workbench-view-tabs-slot] [data-workbench-view]")) {
        bindOnce(button, "click", "workbench-view", () => {
          state.workbenchView = button.getAttribute("data-workbench-view") || "bridge";
          state.buildMode = "edit";
          renderWorkbench();
          if (state.workbenchView === "bridge" && (!state.studioBridgeLoaded || state.studioBridgeStale)) {
            const refreshWorkdir = state.workspace?.workdir || "";
            void refreshStudioBridge().catch((error) => {
              if (!state.hasProject || refreshWorkdir !== (state.workspace?.workdir || "")) {
                return;
              }
              setFlash("error", t("flash.studioBridgeRefreshFailed", { message: error.message || error }, "Studio Bridge refresh failed: {message}"));
            });
          }
        });
      }
      for (const button of workbenchTabsEl.querySelectorAll("[data-build-mode]")) {
        bindOnce(button, "click", "build-mode", () => {
          state.buildMode = button.getAttribute("data-build-mode") || "edit";
          renderWorkbench();
        });
      }
      const newDraftButton = document.getElementById("workbench-new-draft");
      if (newDraftButton) {
        bindOnce(newDraftButton, "click", "new-draft", () => {
          state.workbenchSource = [
            "flowchart TD",
            "%% system.id=workspace.draft",
            "%% system.version=0.0.1",
            "%% law.global=law.minimal.base",
            "%% entry.role=demo-analyst",
            "input -->|START| analyst[Role:demo-analyst]",
            "analyst[Role:demo-analyst] -->|DONE| output",
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
        bindOnce(recoverDraftButton, "click", "recover-draft", () => {
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
        bindOnce(revertButton, "click", "revert", () => {
          state.workbenchSource = state.workbenchDiskSource;
          persistDraftSource("");
          renderWorkbench();
          scheduleWorkbenchValidation();
        });
      }
      const saveButton = document.getElementById("build-save");
      if (saveButton) {
        bindOnce(saveButton, "click", "save", async () => {
          await saveWorkbench();
        });
      }
      const validateButton = document.getElementById("build-validate");
      if (validateButton) {
        bindOnce(validateButton, "click", "validate", async () => {
          await runWorkbenchValidation(true);
          await refreshStudioBridge();
        });
      }
      const dryRunButton = document.getElementById("build-dry-run");
      if (dryRunButton) {
        bindOnce(dryRunButton, "click", "dry-run", async () => {
          await prepareDryRunFromBuild();
        });
      }
      const openOperateButton = document.getElementById("build-open-operate");
      if (openOperateButton) {
        bindOnce(openOperateButton, "click", "open-operate", async () => {
          state.consoleTab = "operate";
          renderConsoleTabs();
          if (state.studioBridgeLastDryRunId) {
            await selectRun(state.studioBridgeLastDryRunId);
          }
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
      if (actionFormReturnFocusEl && typeof actionFormReturnFocusEl.focus === "function") {
        actionFormReturnFocusEl.focus();
      }
      actionFormReturnFocusEl = null;
    }

    function openActionForm(kind, fields, options) {
      actionFormReturnFocusEl =
        options && options.returnFocusEl && typeof options.returnFocusEl.focus === "function"
          ? options.returnFocusEl
          : document.activeElement && typeof document.activeElement.focus === "function"
            ? document.activeElement
            : null;
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

    function focusActionField(fieldId) {
      const element = document.getElementById(fieldId);
      if (element && typeof element.focus === "function") {
        element.focus();
      }
    }

    function renderActionForm() {
      if (!actionFormEl) {
        return;
      }
      const form = state.actionForm;
      if (actionFormSectionEl) {
        actionFormSectionEl.hidden = !form;
      }
      if (!form) {
        actionFormEl.innerHTML = '<div class="hint">' + escapeText(t("form.emptyHint")) + '</div>';
        if (actionFormSectionEl) {
          actionFormSectionEl.setAttribute("aria-hidden", "true");
        }
        return;
      }
      if (actionFormSectionEl) {
        actionFormSectionEl.setAttribute("aria-hidden", "false");
      }
      const disabled = state.actionBusy ? " disabled" : "";
      if (form.kind === "start") {
        const inputError = form.errors?.input || "";
        actionFormEl.innerHTML = [
          '<div class="event"><div class="event-top"><span>' + escapeText(t("form.startRun")) + '</span><span>' + escapeText(t("form.fromWorkbench")) + '</span></div><strong>' + escapeText(t("form.prepareNewRunRequest")) + '</strong><div class="hint">' + escapeText(t("form.startRunHint")) + '</div></div>',
          '<div class="form-grid">',
          '<label class="field"><span>' + escapeText(t("form.systemPath")) + '</span><input id="action-start-system-path" value="' + escapeText(form.fields.systemPath || "") + '"' + disabled + ' /></label>',
          '<label class="field"><span>' + escapeText(t("form.dryRun")) + '</span><select id="action-start-dry-run"' + disabled + '><option value="true"' + (form.fields.dryRun ? " selected" : "") + '>' + escapeText(t("common.yes")) + '</option><option value="false"' + (!form.fields.dryRun ? " selected" : "") + '>' + escapeText(t("common.no")) + '</option></select></label>',
          '<label class="field full"><span>' + escapeText(t("form.runInput")) + '</span><textarea id="action-run-prompt"' + disabled + (inputError ? ' aria-invalid="true" aria-describedby="action-run-prompt-error"' : "") + '>' + escapeText(form.fields.input || "") + '</textarea><div id="action-run-prompt-error" class="field-error" aria-live="polite">' + escapeText(inputError) + '</div></label>',
          '<label class="field"><span>' + escapeText(t("form.runtimeConfigPath")) + '</span><input id="action-start-runtime-path" value="' + escapeText(form.fields.runtimePath || "") + '"' + disabled + ' /></label>',
          '<label class="field"><span>' + escapeText(t("form.userProfilePath")) + '</span><input id="action-start-user-profile-path" value="' + escapeText(form.fields.userProfilePath || "") + '"' + disabled + ' /></label>',
          '<label class="field full"><span>' + escapeText(t("form.lawsPath")) + '</span><input id="action-start-laws-path" value="' + escapeText(form.fields.lawsPath || "") + '"' + disabled + ' /></label>',
          '</div>',
          '<div class="actions"><button id="action-form-cancel" class="button subtle"' + disabled + '>' + escapeText(t("action.cancel")) + '</button><button id="action-form-submit" class="button primary"' + disabled + '>' + escapeText(t("action.startRun")) + '</button></div>'
        ].join("");
      } else if (form.kind === "resume") {
        actionFormEl.innerHTML = [
          '<div class="event"><div class="event-top"><span>' + escapeText(t("form.resumeRun")) + '</span><span>' + escapeText(state.selectedRunId || "n/a") + '</span></div><strong>' + escapeText(t("form.prepareResumeRequest")) + '</strong><div class="hint">' + escapeText(t("form.resumeRunHint")) + '</div></div>',
          '<div class="form-grid">',
          '<label class="field"><span>' + escapeText(t("form.systemOverride")) + '</span><input id="action-resume-system-path" value="' + escapeText(form.fields.systemPath || "") + '"' + disabled + ' /></label>',
          '<label class="field"><span>' + escapeText(t("form.dryRun")) + '</span><select id="action-resume-dry-run"' + disabled + '><option value="false"' + (!form.fields.dryRun ? " selected" : "") + '>' + escapeText(t("common.no")) + '</option><option value="true"' + (form.fields.dryRun ? " selected" : "") + '>' + escapeText(t("common.yes")) + '</option></select></label>',
          '<label class="field full"><span>' + escapeText(t("form.inputOverride")) + '</span><textarea id="action-resume-input"' + disabled + '>' + escapeText(form.fields.input || "") + '</textarea></label>',
          '<label class="field"><span>' + escapeText(t("form.runtimeConfigPath")) + '</span><input id="action-resume-runtime-path" value="' + escapeText(form.fields.runtimePath || "") + '"' + disabled + ' /></label>',
          '<label class="field"><span>' + escapeText(t("form.userProfilePath")) + '</span><input id="action-resume-user-profile-path" value="' + escapeText(form.fields.userProfilePath || "") + '"' + disabled + ' /></label>',
          '<label class="field full"><span>' + escapeText(t("form.lawsPath")) + '</span><input id="action-resume-laws-path" value="' + escapeText(form.fields.lawsPath || "") + '"' + disabled + ' /></label>',
          '</div>',
          '<div class="actions"><button id="action-form-cancel" class="button subtle"' + disabled + '>' + escapeText(t("action.cancel")) + '</button><button id="action-form-submit" class="button primary"' + disabled + '>' + escapeText(t("form.resumeRun")) + '</button></div>'
        ].join("");
      } else if (form.kind === "stop") {
        actionFormEl.innerHTML = [
          '<div class="event"><div class="event-top"><span>' + escapeText(t("form.stopRequest")) + '</span><span>' + escapeText(state.selectedRunId || "n/a") + '</span></div><strong>' + escapeText(t("form.recordStructuredStopRequest")) + '</strong><div class="hint">' + escapeText(t("form.stopRequestHint")) + '</div></div>',
          '<label class="field full"><span>' + escapeText(t("form.reason")) + '</span><textarea id="action-stop-reason"' + disabled + '>' + escapeText(form.fields.reason || "") + '</textarea></label>',
          '<div class="actions"><button id="action-form-cancel" class="button subtle"' + disabled + '>' + escapeText(t("action.cancel")) + '</button><button id="action-form-submit" class="button warn"' + disabled + '>' + escapeText(t("form.recordStopRequest")) + '</button></div>'
        ].join("");
      } else if (form.kind === "review") {
        actionFormEl.innerHTML = [
          '<div class="event"><div class="event-top"><span>' + escapeText(t("form.reviewDecision")) + '</span><span>' + escapeText(form.fields.reviewId || state.selectedReviewId || "n/a") + '</span></div><strong>' + escapeText(form.fields.decision || t("form.decision")) + '</strong><div class="hint">' + escapeText(t("form.reviewDecisionHint")) + '</div></div>',
          '<div class="form-grid">',
          '<label class="field"><span>' + escapeText(t("form.actor")) + '</span><input id="action-review-actor" value="' + escapeText(form.fields.actor || "") + '"' + disabled + ' /></label>',
          '<label class="field"><span>' + escapeText(t("form.decision")) + '</span><input id="action-review-decision" value="' + escapeText(form.fields.decision || "") + '" disabled /></label>',
          '<label class="field full"><span>' + escapeText(t("form.comment")) + '</span><textarea id="action-review-comment"' + disabled + '>' + escapeText(form.fields.comment || "") + '</textarea></label>',
          (form.fields.decision === "terminate"
            ? '<label class="field"><span>' + escapeText(t("form.terminateScope")) + '</span><select id="action-review-scope"' + disabled + '><option value="branch"' + ((form.fields.scope || "branch") === "branch" ? " selected" : "") + '>branch</option><option value="run"' + (form.fields.scope === "run" ? " selected" : "") + '>run</option></select></label>'
            : ""),
          '</div>',
          '<div class="actions"><button id="action-form-cancel" class="button subtle"' + disabled + '>' + escapeText(t("action.cancel")) + '</button><button id="action-form-submit" class="button primary"' + disabled + '>' + escapeText(t("form.recordReviewDecision")) + '</button></div>'
        ].join("");
      } else if (form.kind === "saveAs") {
        actionFormEl.innerHTML = [
          '<div class="event"><div class="event-top"><span>' + escapeText(t("form.saveMermaid")) + '</span><span>' + escapeText(t("form.saveAs")) + '</span></div><strong>' + escapeText(t("form.writeWorkbenchCopy")) + '</strong><div class="hint">' + escapeText(t("form.saveAsHint")) + '</div></div>',
          '<label class="field full"><span>' + escapeText(t("form.relativePath")) + '</span><input id="action-save-as-path" value="' + escapeText(form.fields.saveAsPath || "") + '"' + disabled + ' /></label>',
          '<div class="actions"><button id="action-form-cancel" class="button subtle"' + disabled + '>' + escapeText(t("action.cancel")) + '</button><button id="action-form-submit" class="button primary"' + disabled + '>' + escapeText(t("action.saveCopy")) + '</button></div>'
        ].join("");
      } else if (form.kind === "reindex") {
        actionFormEl.innerHTML = [
          '<div class="event"><div class="event-top"><span>' + escapeText(t("form.runsIndex")) + '</span><span>' + escapeText(t("form.maintenance")) + '</span></div><strong>' + escapeText(t("form.rebuildRunList")) + '</strong><div class="hint">' + escapeText(t("form.reindexHint")) + '</div></div>',
          '<div class="actions"><button id="action-form-cancel" class="button subtle"' + disabled + '>' + escapeText(t("action.cancel")) + '</button><button id="action-form-submit" class="button warn"' + disabled + '>' + escapeText(t("form.rebuildIndex")) + '</button></div>'
        ].join("");
      } else {
        actionFormEl.innerHTML = '<div class="hint">' + escapeText(t("form.unsupported")) + '</div>';
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
      const firstFocusableId =
        form.kind === "start"
          ? "action-start-system-path"
          : form.kind === "resume"
            ? "action-resume-system-path"
            : form.kind === "stop"
              ? "action-stop-reason"
              : form.kind === "review"
                ? "action-review-actor"
                : form.kind === "saveAs"
                  ? "action-save-as-path"
                  : "action-form-cancel";
      focusActionField(firstFocusableId);
    }

    function renderProject() {
      if (state.projectLoading) {
        if (opsSummaryEl) opsSummaryEl.innerHTML = loadingSkeleton(t("state.loadingOpsSummary", undefined, "Loading operations summary"), 3);
        if (releaseGateEl) releaseGateEl.innerHTML = loadingSkeleton(t("state.loadingReleaseGate", undefined, "Loading release gate"), 3);
        bindingExplainEl.innerHTML = loadingSkeleton(t("state.loadingProjectBindings", undefined, "Loading project bindings"), 2);
        rolePackagesEl.innerHTML = loadingSkeleton(t("state.loadingRolePackages", undefined, "Loading role packages"), 2);
        contractExplainEl.innerHTML = loadingSkeleton(t("state.loadingContracts", undefined, "Loading contracts"), 2);
        renderProjectWizard();
        return;
      }
      if (!state.hasProject) {
        const workspace = state.workspace || {};
        if (workdirEl && workspace.workdir) {
          workdirEl.textContent = workspace.workdir;
        }
        if (opsSummaryEl) opsSummaryEl.innerHTML = workspaceEmptyStateHtml("operate");
        if (releaseGateEl) releaseGateEl.innerHTML = workspaceEmptyStateHtml("validate");
        bindingExplainEl.innerHTML = '<div class="hint">' + escapeText(t("workspace.projectDataUnavailable", undefined, "Project configuration is unavailable until a project is initialized.")) + '</div>';
        rolePackagesEl.innerHTML = '<div class="hint">' + escapeText(t("workspace.roleCatalogHint", undefined, "Installed role packages can be imported after project creation.")) + '</div>';
        contractExplainEl.innerHTML = '<div class="hint">' + escapeText(t("workspace.projectDataUnavailable", undefined, "Project configuration is unavailable until a project is initialized.")) + '</div>';
        renderProjectWizard();
        return;
      }
      if (!state.project) {
        if (opsSummaryEl) opsSummaryEl.innerHTML = '<div class="hint">' + escapeText(t("state.opsSummaryUnavailable")) + '</div>';
        if (releaseGateEl) releaseGateEl.innerHTML = '<div class="hint">' + escapeText(t("release.dataUnavailable", undefined, "Release gate data unavailable.")) + '</div>';
        bindingExplainEl.innerHTML = '<div class="hint">' + escapeText(t("state.projectBindingDataUnavailable")) + '</div>';
        rolePackagesEl.innerHTML = '<div class="hint">' + escapeText(t("state.rolePackageDataUnavailable")) + '</div>';
        contractExplainEl.innerHTML = '<div class="hint">' + escapeText(t("state.contractDataUnavailable")) + '</div>';
        renderProjectWizard();
        return;
      }
      if (workdirEl) {
        workdirEl.textContent = state.project.summary?.workdir || workdirEl.textContent;
      }
      if (opsSummaryEl) {
        opsSummaryEl.innerHTML = renderOpsSummaryPanel({
          opsSummary: state.opsSummary,
          t
        });
      }
      renderProjectWizard();
      const releaseDecision = buildReleaseReadinessDecision({
        validation: state.workbench?.validation,
        readiness: state.projectReadiness,
        contracts: state.contracts,
        rolePackages: state.rolePackages,
        bindings: state.bindings,
        workbenchDirty: state.workbenchSource !== state.workbenchDiskSource
      });
      if (releaseGateEl) {
        releaseGateEl.innerHTML = renderReleaseGatePanel({
          validation: state.workbench?.validation,
          readiness: state.projectReadiness,
          contracts: state.contracts,
          rolePackages: state.rolePackages,
          bindings: state.bindings,
          workbenchSavedPath: state.workbenchSavedPath || "system.mmd",
          workbenchDirty: state.workbenchSource !== state.workbenchDiskSource,
          lastDryRunId: state.studioBridgeLastDryRunId,
          exportReady: releaseDecision.canExport,
          t
        });
      }
      bindingExplainEl.innerHTML = renderBindingExplainPanel({
        bindings: state.bindings,
        stale: false,
        t
      });
      rolePackagesEl.innerHTML = renderRolePackagePanel({
        rolePackages: state.rolePackages,
        t
      });
      contractExplainEl.innerHTML = renderContractPanel({
        contracts: state.contracts,
        runtimeStatus: state.contractRuntimeStatus,
        t
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
      setInnerHtmlIfChanged(runListEl, renderRunListHtml({
        runs: state.runs,
        filter: state.filter,
        selectedRunId: state.selectedRunId,
        t,
        escapeText,
        formatTime,
        displayUiToken,
        statusClass
      }));
      for (const button of runListEl.querySelectorAll("[data-run-id]")) {
        button.disabled = Boolean(state.actionBusy);
        bindOnce(button, "click", "run-card", () => selectRun(button.getAttribute("data-run-id")));
      }
    }

    function renderProjectWizard() {
      if (!projectWizardEl) {
        return;
      }
      const workspace = state.workspace || {};
      const draft = ensureProjectWizardDraft(workspace);
      const workspaceState = getWorkspaceStateLabel(workspace);
      const conflictList = Array.isArray(workspace.controlledPathConflicts) ? workspace.controlledPathConflicts : [];
      const canInitialize = workspace.canInitialize === true;
      const hasProject = workspace.state === "project";
      const invalidProject = workspace.state === "project-invalid";
      const recentRuns = Array.isArray(state.runs) ? state.runs.slice(0, 3) : [];
      const summary = state.project?.summary?.project || {};
      const projectName = summary.projectName || state.project?.summary?.name || draft.projectName || "n/a";
      const templateOptions = [
        ["empty", t("projectWizard.template.empty", undefined, "Blank draft")],
        ["minimal", t("projectWizard.template.minimal", undefined, "Minimal runnable")],
        ["software-dev", "software-dev"],
        ["consultation", "consultation"]
      ];
      const errorHtml = state.projectCreateError
        ? '<div class="event warn"><div class="event-top"><span>' + escapeText(t("common.attention", undefined, "attention")) + '</span><span>' + escapeText(state.projectCreateError.code || "error") + '</span></div><strong>' + escapeText(state.projectCreateError.message || t("projectWizard.createFailed", undefined, "Project creation failed.")) + '</strong></div>'
        : "";
      const createProgressHtml = state.projectCreateStage
        ? '<div class="event notice"><div class="event-top"><span class="severity-info">' + escapeText(t("projectWizard.createInProgress", undefined, "Creating project...")) + '</span><span class="severity-info">' + escapeText(projectCreateStageBadge(state.projectCreateStage)) + '</span></div><strong class="severity-info">' + escapeText(projectCreateStageMessage(state.projectCreateStage)) + '</strong><div class="hint severity-info">' + escapeText(projectCreateStageDetail(state.projectCreateStage)) + '</div><div class="hint severity-info">' + escapeText(t("projectWizard.createStageHint", undefined, "The minimal template may take a bit longer while the workspace is initialized.")) + '</div>' + renderProjectCreateStageTimeline(state.projectCreateStage) + loadingSkeleton(t("projectWizard.createInProgress", undefined, "Creating project..."), 3) + '</div>'
        : "";

      let mainHtml = "";
      let sideHtml = "";
      if (hasProject) {
        const readinessBlockers = Array.isArray(state.projectReadiness?.blockers) ? state.projectReadiness.blockers : [];
        const validationOk = state.workbench?.validation?.ok === true;
        mainHtml = [
          '<article class="card project-home-card">',
          '<header><h3>' + escapeText(t("section.projectOverview", undefined, "Project Overview")) + '</h3></header>',
          '<div class="body structure-list">',
          '<div class="event"><div class="event-top"><span>' + escapeText(t("project.currentDirectory", undefined, "Current directory")) + '</span><span>' + escapeText(workspaceState) + '</span></div><strong><code>' + escapeText(workspace.workdir || getCurrentWorkdir() || "n/a") + '</code></strong><div class="hint">' + escapeText(t("project.currentDirectoryHint", undefined, "Visualizer now operates only on the current directory shown here.")) + '</div></div>',
          '<div class="event"><div class="event-top"><span>' + escapeText(t("project.currentProject", undefined, "Current project")) + '</span><span>' + escapeText(validationOk ? t("project.validated", undefined, "validated") : t("project.needsAttention", undefined, "needs attention")) + '</span></div><strong>' + escapeText(projectName) + '</strong><div class="hint">' + escapeText(t("project.readyProjectHint", undefined, "Use Build for structure and bindings, Validate & Release for gates, and Operate for runtime inspection.")) + '</div></div>',
          '</div>',
          '</article>',
          '<div class="project-home-grid">',
          '<article class="card project-home-card"><header><h3>' + escapeText(t("section.projectSummary", undefined, "Project Summary")) + '</h3></header><div class="body"><div class="structure-list">' + renderProjectSummaryPanel({ summary: state.project?.summary?.project || {}, roles: state.project?.roles?.roles || [], warnings: state.project?.config?.modelSelectionWarnings || [], workbenchSavedPath: state.workbenchSavedPath || "system.mmd", validationOk, t }) + '</div></div></article>',
          '<article class="card project-home-card"><header><h3>' + escapeText(t("section.projectReadiness", undefined, "Project Readiness")) + '</h3></header><div class="body"><div class="structure-list">' + renderProjectReadinessPanel({ readiness: state.projectReadiness, t }) + '</div></div></article>',
          '<article class="card project-home-card"><header><h3>' + escapeText(t("section.opsSummary", undefined, "Operations Summary")) + '</h3></header><div class="body"><div class="structure-list">' + renderOpsSummaryPanel({ opsSummary: state.opsSummary, t }) + '</div></div></article>',
          '<article class="card project-home-card"><header><h3>' + escapeText(t("project.recentRuns", undefined, "Recent runs")) + '</h3></header><div class="body structure-list">' +
            (recentRuns.length
              ? recentRuns.map((run) => '<div class="event"><div class="event-top"><span><code>' + escapeText(run.runId || "n/a") + '</code></span><span>' + escapeText(displayUiToken(run.status || "unknown", t)) + '</span></div><strong>' + escapeText(run.lastExecutedRoleId || run.finalRoleId || t("common.notAvailable", undefined, "n/a")) + '</strong></div>').join("")
              : '<div class="hint">' + escapeText(t("project.noRunsYet", undefined, "No runs recorded yet.")) + '</div>') +
          '</div></article>',
          '</div>'
        ].join("");
        sideHtml = [
          '<article class="card project-home-card"><header><h3>' + escapeText(t("project.quickActions", undefined, "Quick actions")) + '</h3></header><div class="body structure-list">',
          '<button class="button primary" type="button" data-project-action="build">' + escapeText(t("project.enterBuild", undefined, "Enter Build")) + '</button>',
          '<button class="button subtle" type="button" data-project-action="validate-release">' + escapeText(t("project.enterValidateRelease", undefined, "Validate & Release")) + '</button>',
          '<button class="button subtle" type="button" data-project-action="operate">' + escapeText(t("project.enterOperate", undefined, "Operate")) + '</button>',
          (readinessBlockers.length
            ? '<div class="event warn"><div class="event-top"><span>' + escapeText(t("common.attention", undefined, "attention")) + '</span><span>' + escapeText(String(readinessBlockers.length)) + '</span></div><strong>' + escapeText(readinessBlockers[0]?.message || t("release.resolveBlockers", undefined, "Resolve release blockers.")) + '</strong></div>'
            : '<div class="event"><div class="event-top"><span>' + escapeText(t("common.ready", undefined, "ready")) + '</span><span>' + escapeText(t("release.title", undefined, "release")) + '</span></div><strong>' + escapeText(t("project.readyForNextStep", undefined, "Project summary is ready for the next workflow step.")) + '</strong></div>') +
          '</div></article>'
        ].join("");
      } else if (invalidProject) {
        const diagnostics = Array.isArray(workspace.projectValidation?.diagnostics) ? workspace.projectValidation.diagnostics : [];
        mainHtml = [
          '<article class="card project-home-card">',
          '<header><h3>' + escapeText(t("project.currentDirectory", undefined, "Current directory")) + '</h3></header>',
          '<div class="body structure-list">',
          '<div class="event warn"><div class="event-top"><span>' + escapeText(t("app.workdir", undefined, "Workdir")) + '</span><span>' + escapeText(workspaceState) + '</span></div><strong><code>' + escapeText(workspace.workdir || getCurrentWorkdir() || "n/a") + '</code></strong><div class="hint">' + escapeText(t("project.currentDirectoryOnlyHint", undefined, "Visualizer only initializes and inspects the current directory. Directory switching is no longer available in the UI.")) + '</div></div>',
          '<div class="event blocker"><div class="event-top"><span class="severity-critical">' + escapeText(t("common.attention", undefined, "attention")) + '</span><span class="severity-critical">' + escapeText(t("workspace.invalidProjectStatus", undefined, "invalid project")) + '</span></div><strong class="severity-critical">' + escapeText(t("projectWizard.invalidProjectTitle", undefined, "Current directory contains an invalid OGSystem project.")) + '</strong><div class="hint severity-warning">' + escapeText(t("projectWizard.invalidProjectHint", undefined, "Fix the existing project structure or Mermaid diagnostics before the visualizer enables editing.")) + '</div></div>',
          (diagnostics.length
            ? diagnostics.slice(0, 5).map((diagnostic) => '<div class="event blocker"><div class="event-top"><span class="severity-critical">' + escapeText(String(diagnostic?.code || "error")) + '</span><span class="severity-warning">' + escapeText(String(diagnostic?.stage || t("workspace.repairRequired", undefined, "repair required"))) + '</span></div><strong class="severity-critical">' + escapeText(String(diagnostic?.message || t("common.unknown", undefined, "unknown"))) + '</strong></div>').join("")
            : ""),
          '</div>',
          '</article>'
        ].join("");
        sideHtml = [
          '<article class="card project-home-card"><header><h3>' + escapeText(t("projectWizard.initializeCurrentDirectory", undefined, "Initialize current directory")) + '</h3></header><div class="body structure-list">',
          errorHtml,
          '<div class="event blocker"><div class="event-top"><span class="severity-critical">' + escapeText(t("common.blocked", undefined, "blocked")) + '</span><span class="severity-critical">' + escapeText(t("common.attention", undefined, "attention")) + '</span></div><strong class="severity-critical">' + escapeText(t("projectWizard.invalidProjectBlockedTitle", undefined, "Editing is disabled until this project is repaired.")) + '</strong><div class="hint severity-warning">' + escapeText(t("projectWizard.invalidProjectBlockedHint", undefined, "The directory already looks like an OGSystem project, but it does not pass validation. Repair the files instead of reinitializing or editing here.")) + '</div></div>',
          '</div></article>'
        ].join("");
      } else {
        const stateTitle = workspace.state === "non-project-conflict"
          ? t("projectWizard.controlledConflictTitle", undefined, "OGSystem-controlled paths already exist.")
          : workspace.state === "non-project-ready"
            ? t("projectWizard.nonEmptyDirectoryTitle", undefined, "Directory has files and needs confirmation.")
            : t("projectWizard.emptyDirectoryTitle", undefined, "Start a new OGSystem project here.");
        const stateHint = workspace.state === "non-project-conflict"
          ? t("projectWizard.controlledConflictHint", undefined, "This directory already contains OGSystem-controlled paths, so initialization is blocked.")
          : workspace.state === "non-project-ready"
            ? t("projectWizard.nonEmptyDirectoryHint", undefined, "This directory has ordinary files. Confirm current-directory initialization only if this should become the project root.")
            : t("projectWizard.emptyDirectoryHint", undefined, "No files are written until you confirm project creation.");
        mainHtml = [
          '<article class="card project-home-card">',
          '<header><h3>' + escapeText(t("project.currentDirectory", undefined, "Current directory")) + '</h3></header>',
          '<div class="body structure-list">',
          '<div class="event"><div class="event-top"><span>' + escapeText(t("app.workdir", undefined, "Workdir")) + '</span><span>' + escapeText(workspaceState) + '</span></div><strong><code>' + escapeText(workspace.workdir || getCurrentWorkdir() || "n/a") + '</code></strong><div class="hint">' + escapeText(t("project.currentDirectoryOnlyHint", undefined, "Visualizer only initializes and inspects the current directory. Directory switching is no longer available in the UI.")) + '</div></div>',
          '<div class="event' + (canInitialize ? ' notice' : ' warning') + '"><div class="event-top"><span class="' + escapeText(canInitialize ? "severity-info" : "severity-warning") + '">' + escapeText(t("section.projectWizard", undefined, "Project Setup")) + '</span><span class="' + escapeText(canInitialize ? "severity-info" : "severity-warning") + '">' + escapeText(canInitialize ? t("common.ready", undefined, "ready") : t("common.attention", undefined, "attention")) + '</span></div><strong class="' + escapeText(canInitialize ? "severity-info" : "severity-warning") + '">' + escapeText(stateTitle) + '</strong><div class="hint ' + escapeText(canInitialize ? "severity-info" : "severity-warning") + '">' + escapeText(stateHint) + '</div></div>',
          (conflictList.length ? '<div class="event warning"><div class="event-top"><span class="severity-warning">' + escapeText(t("project.conflicts", undefined, "Conflicts")) + '</span><span class="severity-warning">' + escapeText(String(conflictList.length)) + '</span></div><strong class="severity-warning">' + escapeText(conflictList.join(", ")) + '</strong></div>' : ''),
          '</div>',
          '</article>'
        ].join("");
        if (canInitialize) {
          sideHtml = [
            '<article class="card project-home-card">',
            '<header><h3>' + escapeText(t("projectWizard.initializeCurrentDirectory", undefined, "Initialize current directory")) + '</h3></header>',
            '<div class="body structure-list">',
            createProgressHtml,
            errorHtml,
            '<form id="project-create-form" class="structure-list">',
            '<label><span>' + escapeText(t("projectWizard.projectName", undefined, "Project name")) + '</span><input name="projectName" value="' + escapeText(draft.projectName || "") + '"></label>',
            '<label><span>' + escapeText(t("projectWizard.template", undefined, "Template")) + '</span><select name="templateId">' +
              templateOptions.map(([value, label]) => '<option value="' + escapeText(value) + '"' + (draft.templateId === value ? " selected" : "") + '>' + escapeText(label) + '</option>').join("") +
            '</select></label>',
            workspace.state === "non-project-ready"
              ? '<label><span>' + escapeText(t("projectWizard.conflictStrategy", undefined, "Conflict strategy")) + '</span><select name="conflictStrategy"><option value="reject"' + (draft.conflictStrategy !== "init-current" ? " selected" : "") + '>' + escapeText(t("projectWizard.reviewBeforeInit", undefined, "Do not initialize yet")) + '</option><option value="init-current"' + (draft.conflictStrategy === "init-current" ? " selected" : "") + '>' + escapeText(t("projectWizard.initCurrentDirectory", undefined, "Initialize current directory")) + '</option></select><span class="hint">' + escapeText(t("projectWizard.conflictStrategyHint", undefined, "Reject keeps the existing files untouched; initialize current directory only when this path is intentionally the project root.")) + '</span></label>'
              : '<input type="hidden" name="conflictStrategy" value="init-current">',
            '<div class="toolbar-group"><button class="button primary" type="submit">' + escapeText(t("projectWizard.createProject", undefined, "Create project")) + '</button></div>',
            '</form>',
            '</div>',
            '</article>'
          ].join("");
        } else {
          sideHtml = [
            '<article class="card project-home-card"><header><h3>' + escapeText(t("projectWizard.initializeCurrentDirectory", undefined, "Initialize current directory")) + '</h3></header><div class="body structure-list">',
            createProgressHtml,
            errorHtml,
            '<div class="event blocker"><div class="event-top"><span class="severity-critical">' + escapeText(t("common.blocked", undefined, "blocked")) + '</span><span class="severity-critical">' + escapeText(t("common.attention", undefined, "attention")) + '</span></div><strong class="severity-critical">' + escapeText(t("projectWizard.initBlockedTitle", undefined, "Initialization is blocked for this directory.")) + '</strong><div class="hint severity-warning">' + escapeText(t("projectWizard.initBlockedHint", undefined, "Remove or reconcile the OGSystem-controlled paths before initializing this directory.")) + '</div></div>',
            '</div></article>'
          ].join("");
        }
      }

      projectWizardEl.innerHTML = '<div class="project-home-layout"><div class="project-home-main">' + mainHtml + '</div><aside class="project-side-panel">' + sideHtml + '</aside></div>';
      attachProjectWizardControls({
        root: projectWizardEl,
        getElementById: (id) => document.getElementById(id),
        onCreateSubmit: (form) => {
          void createProjectFromWizard(new FormData(form));
        },
        onDraftFormChange: (form) => {
          updateProjectWizardDraftFromForm(form);
        },
        onAction: (action) => {
          if (action === "build" || action === "validate-release" || action === "operate") {
            state.consoleTab = action;
            state.projectHome = false;
            if (action === "build" && state.hasProject) {
              state.workbenchView = "bridge";
              const refreshWorkdir = state.workspace?.workdir || "";
              void refreshStudioBridge().catch((error) => {
                if (refreshWorkdir !== (state.workspace?.workdir || "")) {
                  return;
                }
                setFlash("error", t("flash.studioBridgeRefreshFailed", { message: error.message || error }, "Studio Bridge refresh failed: {message}"));
              });
            }
            renderConsoleTabs();
            renderSelectedRun();
            renderActionState();
            writeRouteToLocation();
          }
        }
      });
    }

    function renderStats(header, graphPayload) {
      if (state.runDetailLoading) {
        statsEl.innerHTML = loadingSkeleton(t("state.loadingRunDetail", undefined, "Loading run detail"), 2);
        return;
      }
      statsEl.innerHTML = renderRunStatsHtml({ header, graphPayload, t, escapeText, displayUiToken });
    }

    function renderTimeline(events) {
      timelineEl.innerHTML = renderTimelineHtml({
        events,
        filters: {
          roleId: state.timelineRoleId,
          type: state.timelineType,
          status: state.timelineStatus,
          branchId: state.timelineBranchId,
          reviewId: state.timelineReviewId,
          errorCode: state.timelineErrorCode
        },
        t,
        escapeText,
        statusClass,
        displayUiToken,
        formatTime
      });
    }

    function renderGraph() {
      if (state.runDetailLoading) {
        graphViewEl.innerHTML = loadingSkeleton(t("state.loadingRunGraph", undefined, "Loading run graph"), 4);
        stateEl.innerHTML = loadingSkeleton(t("state.loadingRunState", undefined, "Loading run state"), 3);
        return;
      }
      if (!state.hasProject) {
        graphViewEl.innerHTML = workspaceEmptyStateHtml("operate");
        stateEl.innerHTML = '<div class="hint">' + escapeText(t("workspace.createOrLoadHint", undefined, "Use Project to create a project in this directory or load an existing project.")) + '</div>';
        return;
      }
      if (!state.graph) {
        graphViewEl.innerHTML = '<div class="hint">' + escapeText(t("state.noRunSelected")) + '</div>';
        stateEl.innerHTML = '<div class="hint">' + escapeText(t("state.noRunSelected")) + '</div>';
        return;
      }
      const graph = state.graph.graph;
      if (!graph) {
        graphViewEl.innerHTML = '<div class="hint">' + escapeText(t("graph.projectionUnavailable")) + '</div>';
        stateEl.innerHTML = renderRunStatePanel({
          state: state.detail?.state ?? null,
          header: state.detail?.header ?? null,
          graph: null,
          t
        });
        return;
      }
      const nodes = graph.nodes || [];
      const edges = graph.edges || [];
      graphViewEl.innerHTML = [
        '<div class="event"><strong>' + escapeText(graph.systemId || t("common.unknown")) + '</strong><div class="hint">' + escapeText(t("graph.entryRolesFlows", {
          entryRoleId: graph.entryRoleId || t("common.notAvailable"),
          roleCount: graph.roleCount || 0,
          flowCount: graph.flowCount || 0
        })) + "</div></div>",
        '<div id="run-graph-root" class="studio-graph-root run-graph-root" data-selected-role-id="' + escapeText(state.runGraphSelectedRoleId) + '" data-selected-flow-key="' + escapeText(state.runGraphSelectedFlowKey) + '"></div>',
        '<div class="run-graph-summary-grid">',
        '<div class="event"><div class="event-top"><span>' + escapeText(t("graph.runtimeSummary")) + '</span><span>' + escapeText(nodes.length) + " " + escapeText(t("common.nodes")) + " · " + escapeText(edges.length) + '</span></div><strong>' + escapeText(t("graph.topologyOverlay")) + '</strong><div class="hint">' + escapeText(t("graph.overlayHint")) + '</div></div>',
        '<div class="event"><div class="event-top"><span>' + escapeText(t("common.readOnly")) + '</span><span>' + escapeText(t("section.graphView", undefined, "Graph View")) + '</span></div><strong>' + escapeText(t("graph.readOnlyRuntimeGraph", undefined, "Read-only runtime graph")) + '</strong><div class="hint">' + escapeText(t("graph.x6RuntimeHint", undefined, "Uses the same role and flow projection as Studio Bridge, including start and end boundaries.")) + '</div></div>',
        "</div>"
      ].join("");
      mountRunGraphIsland(graph);
      stateEl.innerHTML = renderRunStatePanel({
        state: state.detail?.state ?? null,
        header: state.detail?.header ?? null,
        graph,
        t
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
        reviewsEl.innerHTML = '<div class="hint">' + escapeText(t("review.noReviews")) + '</div>';
        reviewActionsEl.innerHTML = "";
        reviewDetailEl.innerHTML = '<div class="hint">' + escapeText(t("state.noReviewSelected")) + '</div>';
        renderActionState();
        return;
      }
      reviewsEl.innerHTML = renderReviewQueuePanel({
        reviews: state.reviews,
        selectedReviewId: state.selectedReviewId,
        t
      });
      for (const button of reviewsEl.querySelectorAll("[data-review-id]")) {
        button.disabled = Boolean(state.actionBusy);
        button.addEventListener("click", () => selectReview(state.selectedRunId, button.getAttribute("data-review-id")));
      }
      const detail = state.reviewDetail;
      reviewDetailEl.innerHTML = renderReviewDetailPanel(detail, t, formatTime);
      const actionable = detail && (detail.currentStatus === "pending" || detail.currentStatus === "paused");
      reviewActionsEl.innerHTML = actionable
        ? [
          '<button class="button primary" data-review-action="approve">' + escapeText(t("review.approve")) + '</button>',
          '<button class="button" data-review-action="rework">' + escapeText(t("review.requestRework")) + '</button>',
          '<button class="button warn" data-review-action="pause">' + escapeText(t("review.pause")) + '</button>',
          '<button class="button danger" data-review-action="terminate" data-review-scope="' + escapeText(detail.scope || "branch") + '">' + escapeText(t("review.terminateScope", { scope: detail.scope || "branch" })) + '</button>'
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
          }, { returnFocusEl: button })
        );
      }
      renderActionState();
    }

    function renderFailure() {
      if (!state.selectedRunId) {
        failureControlsEl.innerHTML = "";
        failureSummaryEl.innerHTML = '<div class="hint">' + escapeText(t("state.noRunSelected", undefined, "No run selected.")) + '</div>';
        failureDetailEl.innerHTML = '<div class="hint">' + escapeText(t("state.noRunSelected", undefined, "No run selected.")) + '</div>';
        failureNextChecksEl.innerHTML = '<div class="hint">' + escapeText(t("state.noRunSelected", undefined, "No run selected.")) + '</div>';
        return;
      }
      failureControlsEl.innerHTML = [
        '<button class="button subtle" id="refresh-failure"' + (state.actionBusy ? " disabled" : "") + '>' + escapeText(t("failure.refresh")) + '</button>',
        state.failureLoaded && state.failureStale ? '<span class="hint">' + escapeText(t("failure.dataStale")) + '</span>' : ""
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
        stale: state.failureStale,
        t
      });
      failureDetailEl.innerHTML = renderFailureDetailPanel({
        failure: state.failure,
        loaded: state.failureLoaded,
        t
      });
      failureNextChecksEl.innerHTML = renderSuggestedNextChecksPanel({
        failure: state.failure,
        loaded: state.failureLoaded,
        t
      });
      bindPanelJumpButtons();
    }

    function renderResumeDiagnostics() {
      const controls = [];
      if (!state.selectedRunId) {
        resumeControlsEl.innerHTML = "";
        resumeReadinessEl.innerHTML = '<div class="hint">' + escapeText(t("state.noRunSelected")) + '</div>';
        resumeEl.innerHTML = '<div class="hint">' + escapeText(t("state.noRunSelected")) + '</div>';
        return;
      }
      controls.push('<button class="button subtle" id="refresh-readiness"' + (state.actionBusy ? " disabled" : "") + '>' + escapeText(t("resume.refreshReadiness")) + '</button>');
      controls.push('<button class="button" id="load-diagnostics">' + escapeText(state.resumeDiagnosticsLoaded ? t("resume.refreshDiagnostics") : t("resume.loadDiagnostics")) + '</button>');
      if (state.resumeReadinessLoaded && state.resumeReadinessStale) {
        controls.push('<span class="hint">' + escapeText(t("resume.readinessStale")) + '</span>');
      }
      if (state.resumeDiagnosticsLoaded && state.resumeDiagnosticsStale) {
        controls.push('<span class="hint">' + escapeText(t("resume.diagnosticsStale")) + '</span>');
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
        diagnostics: state.resumeDiagnosticsLoaded ? state.resumeDiagnostics : null,
        t
      });
      if (!state.resumeDiagnosticsLoaded) {
        resumeEl.innerHTML = '<div class="hint">' + escapeText(t("resume.diagnosticsOnDemand")) + '</div>';
        return;
      }
      if (!state.resumeDiagnostics) {
        resumeEl.innerHTML = '<div class="hint">' + escapeText(t("resume.diagnosticsUnavailable")) + '</div>';
        return;
      }
      const checks = state.resumeDiagnostics.checks || [];
      const recommendations = state.resumeDiagnostics.recommendations || [];
      resumeEl.innerHTML = [
        ...checks.map((check) =>
          '<div class="event">' +
            '<div class="event-top">' +
              "<span>" + escapeText(check.label) + "</span>" +
              '<span class="status ' + statusClass(check.ok ? "done" : check.severity === "warning" ? "waiting_review" : "failed") + '">' + escapeText(displayUiToken(check.severity, t)) + "</span>" +
            "</div>" +
            "<strong>" + escapeText(check.ok ? t("common.ok") : t("common.attention")) + "</strong>" +
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
        logsFiltersEl.textContent = t("state.noRunSelected");
        logsEl.innerHTML = '<div class="hint">' + escapeText(t("state.noRunSelected")) + '</div>';
        return;
      }
      logsControlsEl.innerHTML = [
        '<button id="load-logs" class="button subtle"' + (state.actionBusy ? " disabled" : "") + '>' + escapeText(state.logsLoaded ? t("logs.refresh") : t("logs.load")) + '</button>',
        '<button id="load-more-logs" class="button subtle"' + (state.actionBusy || !state.logsLoaded ? " disabled" : "") + '>' + escapeText(t("logs.loadMore")) + '</button>'
      ].join("");
      const loadLogsButton = document.getElementById("load-logs");
      if (loadLogsButton) {
        loadLogsButton.addEventListener("click", async () => {
          await loadSelectedLogs(state.selectedRunId, { force: true });
        });
      }
      const loadMoreLogsButton = document.getElementById("load-more-logs");
      if (loadMoreLogsButton) {
        loadMoreLogsButton.addEventListener("click", async () => {
          const current = Number(state.logPageSize || state.logTail || "100");
          state.logTail = "";
          state.logPageSize = String(Number.isFinite(current) ? Math.min(current * 2, 5000) : 500);
          if (logPageSizeEl) logPageSizeEl.value = state.logPageSize;
          await loadSelectedLogs(state.selectedRunId, { force: true });
        });
      }
      logsFiltersEl.textContent =
        "role=" + (state.selectedLogRoleId || "all")
        + " pageSize=" + (state.logTail || state.logPageSize || "all")
        + " since=" + (state.logSince || "n/a")
        + (state.logsStale ? " · stale" : "");
      logsEl.innerHTML = renderLogsPanel({
        loaded: state.logsLoaded,
        stale: state.logsStale,
        selectedRoleId: state.selectedLogRoleId,
        engine: state.engineLogs,
        role: state.roleLogs,
        t,
        formatTime
      });
    }

    function renderDetail() {
      if (state.runDetailLoading) {
        detailEl.innerHTML = loadingSkeleton(t("state.loadingRunArtifacts", undefined, "Loading run artifacts"), 4);
        return;
      }
      detailEl.innerHTML = renderArtifactsPanel({
        detail: state.detail,
        graph: state.graph,
        reviews: state.reviews,
        reviewDetail: state.reviewDetail,
        resumeDiagnostics: state.resumeDiagnosticsLoaded ? state.resumeDiagnostics : null,
        t,
        formatTime
      });
    }

    function renderSelectedRun() {
      const detail = state.detail;
      const header = detail?.header || null;
      const graphPayload = state.graph;
      renderWorkbench({ preserveStudioGraphRoot: true });
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
      renderOperateTabs();
    }

    function stopStream() {
      if (state.stream) {
        state.stream.close();
        state.stream = null;
      }
      clearTimeout(state.streamRefreshTimer);
      state.streamRefreshTimer = null;
      state.streamRefreshPlan = createInitialStreamRefreshPlan();
      state.streamRefreshRunId = "";
    }

    function disposeVisualizerClient() {
      stopStream();
      resetWorkbenchValidationTimer();
      clearTimeout(state.flashTimer);
      state.flashTimer = null;
      if (state.listTimer) {
        clearInterval(state.listTimer);
        state.listTimer = null;
      }
    }

    function resetWorkbenchValidationTimer() {
      clearTimeout(state.workbenchValidationTimer);
      state.workbenchValidationTimer = null;
    }

    function resetStreamRefreshForRun(runId) {
      clearTimeout(state.streamRefreshTimer);
      state.streamRefreshTimer = null;
      state.streamRefreshPlan = createInitialStreamRefreshPlan();
      state.streamRefreshRunId = runId;
    }

    function populateLogRoleOptions(graphPayload, fallbackRoleId) {
      const roleIds = (graphPayload?.graph?.nodes || []).map((node) => node.roleId).filter(Boolean);
      const selected = state.selectedLogRoleId || "";
      const options = ['<option value="">' + escapeText(t("timeline.allRoles")) + '</option>']
        .concat(roleIds.map((roleId) => \`<option value="\${escapeText(roleId)}" \${roleId === selected ? "selected" : ""}>\${escapeText(roleId)}</option>\`));
      logRoleEl.innerHTML = options.join("");
      state.selectedLogRoleId = selected;
    }

    function populateTimelineRoleOptions(graphPayload) {
      const roleIds = (graphPayload?.graph?.nodes || []).map((node) => node.roleId).filter(Boolean);
      if (state.timelineRoleId && !roleIds.includes(state.timelineRoleId)) {
        state.timelineRoleId = "";
      }
      const options = ['<option value="">' + escapeText(t("timeline.allRoles")) + '</option>']
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
        state.eventCursorIndex = createStreamCursorIndex(state.events);
        renderTimeline(state.events);
        return;
      }
      const eventsPayload = await requestJson(buildTimelineQuery(runId, { cursor: 0, limit: 250 }));
      state.events = eventsPayload.events || [];
      state.eventCursor = eventsPayload.nextCursor || 0;
      state.eventCursorIndex = createStreamCursorIndex(state.events);
      renderTimeline(state.events);
      renderDetail();
    }

    async function refreshProjectDiagnostics() {
      if (!state.hasProject) {
        renderProject();
        return;
      }
      const [summary, config, roles, opsSummary, readiness, bindings, contracts, rolePackages, templates, roleCatalog] = await Promise.all([
        requestJson(\`\${API_PREFIX}/project\`),
        requestJson(\`\${API_PREFIX}/project/config\`),
        requestJson(\`\${API_PREFIX}/project/roles\`),
        requestJson(\`\${API_PREFIX}/project/ops-summary\`),
        requestJson(\`\${API_PREFIX}/project/readiness\`),
        requestJson(\`\${API_PREFIX}/project/bindings\`),
        requestJson(\`\${API_PREFIX}/project/contracts\`),
        requestJson(\`\${API_PREFIX}/project/role-packages\`),
        requestJson(\`\${API_PREFIX}/project/studio/templates\`).catch(() => ({ templates: [] })),
        requestJson(\`\${API_PREFIX}/project/role-catalog\`).catch(() => state.studioRoleCatalog)
      ]);
      state.project = Object.assign({}, state.project || {}, { summary, config, roles });
      state.opsSummary = opsSummary;
      state.projectReadiness = readiness;
      state.bindings = bindings;
      state.contracts = contracts;
      state.rolePackages = rolePackages;
      state.studioTemplates = templates.templates || state.studioTemplates || [];
      state.studioRoleCatalog = roleCatalog || state.studioRoleCatalog;
      renderProject();
    }

    async function refreshStudioBridge(options) {
      if (!state.hasProject) {
        return;
      }
      if ((!state.workbenchSource && !state.workbenchDiskSource) || !state.workbench?.systemSource) {
        await loadWorkbench({ skipBridgeWarmup: true });
      }
      if (!state.workbenchSource && state.workbenchDiskSource) {
        state.workbenchSource = state.workbenchDiskSource;
      }
      if (!state.workbenchSource && state.workbench?.systemSource) {
        state.workbenchSource = state.workbench.systemSource;
      }
      state.studioBridgeLoading = true;
      if (state.workbenchView === "bridge") {
        renderWorkbench({ preserveStudioGraphRoot: Boolean(options?.preserveGraphRoot) });
      }
      try {
        const payload = await requestAction(\`\${API_PREFIX}/project/studio/bridge\`, {
          systemSource: state.workbenchSource,
          systemPath: state.workbenchSavedPath || "system.mmd"
        });
        state.studioBridge = payload;
        state.studioCanvas = buildStudioCanvasFromBridge(payload);
        state.studioBridgeLoaded = true;
        state.studioBridgeStale = false;
        const roles = Array.isArray(payload.extracted?.roles) ? payload.extracted.roles : [];
        const flows = Array.isArray(payload.extracted?.flows) ? payload.extracted.flows : [];
        const hasSelectedRole = Boolean(state.studioBridgeSelectedRoleId && roles.some((role) => role.roleId === state.studioBridgeSelectedRoleId));
        const hasSelectedFlow = Boolean(state.studioBridgeSelectedFlowKey && flows.some((flow) => flow.flowKey === state.studioBridgeSelectedFlowKey));
        if (!hasSelectedRole) {
          state.studioBridgeSelectedRoleId = "";
        }
        if (!hasSelectedFlow) {
          state.studioBridgeSelectedFlowKey = "";
        }
        if (state.studioBridgeSelectedRoleId && state.studioBridgeSelectedFlowKey) {
          state.studioBridgeSelectedFlowKey = "";
        }
        state.workbench = {
          ...(state.workbench || {}),
          validation: payload.validation || state.workbench?.validation
        };
        renderWorkbench({ preserveStudioGraphRoot: Boolean(options?.preserveGraphRoot) });
        renderProject();
        if (state.studioBridgeSelectedRoleId) {
          ensureStudioRolePackageEditor(state.studioBridgeSelectedRoleId);
        }
        return payload;
      } finally {
        state.studioBridgeLoading = false;
        if (state.workbenchView === "bridge") {
          renderWorkbench({ preserveStudioGraphRoot: true });
        }
      }
    }

    async function ensureStudioBridgeReady(options) {
      const workdir = options?.workdir || state.workspace?.workdir || "";
      const requireGraph = options?.requireGraph === true;
      const attempts = Math.max(1, Number(options?.attempts) || 1);
      const requestId = (state.studioBridgeWarmupRequestId || 0) + 1;
      state.studioBridgeWarmupRequestId = requestId;
      let lastError = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (!state.hasProject || workdir !== (state.workspace?.workdir || "")) {
          return false;
        }
        if ((!state.workbenchSource && !state.workbenchDiskSource) || !state.workbench?.systemSource) {
          await loadWorkbench();
        }
        try {
          const payload = await refreshStudioBridge({ preserveGraphRoot: attempt > 0 });
          if (!requireGraph || hasStudioBridgeGraphContent(payload)) {
            return true;
          }
        } catch (error) {
          lastError = error;
        }
        if (attempt < attempts - 1) {
          await sleep(180 * (attempt + 1));
          if (requestId !== state.studioBridgeWarmupRequestId) {
            return false;
          }
        }
      }
      if (lastError) {
        throw lastError;
      }
      return hasStudioBridgeGraphContent(state.studioBridge);
    }

    async function applyStudioGraphCanvasPatch(canvas) {
      if (!state.studioBridge?.authoring) {
        await refreshStudioBridge();
      }
      if (!state.studioBridge?.authoring) {
        setFlash("error", t("studio.graph.editBlocked", undefined, "Studio Bridge cannot edit until Mermaid parses successfully."));
        return;
      }
      await runAction("studio:apply-canvas", async () => {
        await applyStudioGraphPayload({
          authoring: state.studioBridge.authoring,
          canvas,
          successMessage: t("studio.graph.canvasUpdated", undefined, "Studio canvas layout updated.")
        });
      });
    }

    async function applyStudioGraphAuthoringCommand(result) {
      if (!result?.authoring || !result?.canvas) {
        setFlash("error", studioGraphBlockedMessage(result?.blockedCode) || t("studio.graph.commandInvalidDraft", undefined, "Studio graph command did not produce a valid draft."));
        return;
      }
      await runAction("studio:apply-canvas", async () => {
        if (result.repositoryRoleId) {
          await requestAction(API_PREFIX + "/project/roles/import", {
            source: "installed",
            roleIds: [result.repositoryRoleId]
          });
          await refreshRolePackageDependentProjectState();
        }
        await persistStudioProfileDrafts(result.profileDrafts);
        await applyStudioGraphPayload({
          authoring: result.authoring,
          canvas: result.canvas,
          selectedRoleId: result.selectedRoleId,
          selectedFlowKey: result.selectedFlowKey,
          successMessage: t("studio.graph.draftUpdated", undefined, "Studio graph draft updated.")
        });
      });
    }

    async function persistStudioProfileDrafts(profileDrafts) {
      if (!Array.isArray(profileDrafts) || !profileDrafts.length) {
        return;
      }
      const payload = await requestAction(API_PREFIX + "/project/profiles", {
        profiles: profileDrafts
      });
      state.project = Object.assign({}, state.project || {}, {
        config: Object.assign({}, state.project?.config || {}, {
          profiles: payload.profiles || profileDrafts
        })
      });
    }

    function studioGraphBlockedMessage(code) {
      if (code === "entry-role-delete") return t("studio.graph.entryRoleDeletionBlocked", undefined, "Entry role deletion is blocked.");
      if (code === "invalid-edge-endpoints") return t("studio.graph.invalidEdgeEndpoints", undefined, "Invalid Studio edge endpoints.");
      if (code === "duplicate-role-id") return t("studio.graph.duplicateRoleId", undefined, "Role id already exists.");
      if (code === "invalid-role-id") return t("studio.graph.invalidRoleId", undefined, "Role id must start with a letter and use letters, digits, _ or -.");
      if (code === "duplicate-edge") return t("studio.graph.duplicateEdge", undefined, "This edge already exists.");
      if (code === "invalid-event-type") return t("studio.graph.invalidEventType", undefined, "Event type must be uppercase.");
      return "";
    }

    async function applyStudioGraphPayload(args) {
      const payload = await requestAction(\`\${API_PREFIX}/project/studio/authoring/apply-canvas\`, {
        authoring: args.authoring,
        canvas: args.canvas
      });
      state.workbenchSource = payload.systemSource || state.workbenchSource;
      persistDraftSource(state.workbenchSource !== state.workbenchDiskSource ? state.workbenchSource : "");
      const bridgePayload = await requestAction(\`\${API_PREFIX}/project/studio/bridge\`, {
        systemSource: state.workbenchSource,
        systemPath: state.workbenchSavedPath || "system.mmd"
      });
      state.studioBridge = withStudioAuthoringDisplayMetadata({
        ...bridgePayload,
        authoring: payload.authoring,
        validation: payload.validation || bridgePayload.validation
      }, payload.authoring);
      state.studioCanvas = payload.canvas || args.canvas;
      if (args.selectedRoleId !== undefined) {
        state.studioBridgeSelectedRoleId = args.selectedRoleId || "";
        state.studioBridgeSelectedFlowKey = "";
      }
      if (args.selectedFlowKey !== undefined) {
        state.studioBridgeSelectedFlowKey = args.selectedFlowKey || "";
        state.studioBridgeSelectedRoleId = "";
      }
      state.workbench = {
        ...(state.workbench || {}),
        validation: payload.validation || state.workbench?.validation
      };
      state.studioBridgeStale = false;
      renderWorkbench();
      renderProject();
      if (args.successMessage) {
        setFlash("success", args.successMessage);
      }
    }

    function questionsFallback(questions) {
      const list = asStudioChatList(questions);
      return list.length ? list.join(" ") : "";
    }

    async function submitStudioChatMessage(message, options) {
      const prompt = String(message || "").trim();
      if (!prompt) {
        setFlash("error", t("studio.chat.messageRequired", undefined, "Enter a message before sending."));
        return;
      }
      if (!state.hasProject) {
        setFlash("error", t("workspace.createOrLoadHint", undefined, "Use Project to create a project in this directory or load an existing project."));
        return;
      }
      if (!state.studioBridge?.authoring) {
        await refreshStudioBridge();
      }
      await runAction("studio:chat-mmd", async () => {
        const requestId = ++state.studioChatRequestId;
        if (state.studioChatAbortController) {
          state.studioChatAbortController.abort();
        }
        const chatAbortController = new AbortController();
        state.studioChatAbortController = chatAbortController;
        const requestMessage = options?.regenerate
          ? prompt + "\\\\n\\\\n" + t("studio.chat.regenerateInstruction", undefined, "Regenerate a fresh alternative for this request.")
          : prompt;
        if (!options?.regenerate) {
          state.studioChatMessages.push({ role: "user", text: prompt });
        }
        state.studioChatLastRequest = prompt;
        state.studioChatDraftMessage = "";
        patchStudioChatPanel();
        const payload = await requestAction(\`\${API_PREFIX}/project/studio/chat\`, {
          message: requestMessage,
          sessionId: state.studioChatSessionId || undefined,
          selectedRoleId: state.studioBridgeSelectedRoleId || undefined,
          selectedFlowKey: state.studioBridgeSelectedFlowKey || undefined,
          authoring: state.studioBridge?.authoring,
          systemSource: state.workbenchSource,
          validation: state.workbench?.validation
        }, {
          signal: chatAbortController.signal,
          timeoutMs: state.studioChatTimeoutMs || 60000
        });
        if (state.studioChatRequestId !== requestId) {
          return;
        }
        state.studioChatAbortController = null;
        state.studioChatSessionId = payload.sessionId || state.studioChatSessionId;
        state.studioChatResult = payload;
        state.studioChatMessages.push({
          role: "assistant",
          mode: payload.mode || "draft",
          text: payload.summary || questionsFallback(payload.questions) || t("studio.chat.responseReady", undefined, "A Studio draft response is ready.")
        });
        patchStudioChatPanel();
      }).catch((error) => {
        if (isAbortError(error)) {
          return;
        }
        throw error;
      }).finally(() => {
        if (state.studioChatAbortController?.signal?.aborted) {
          state.studioChatAbortController = null;
        }
      });
    }

    async function applyStudioChatResult() {
      const patch = state.studioChatResult?.authoringPatch;
      if (!patch?.authoring) {
        setFlash("error", t("studio.chat.noPatch", undefined, "No structured Studio draft is available to apply."));
        return;
      }
      if (!studioChatCanApply(state.studioChatResult)) {
        setFlash("error", t("studio.chat.applyBlocked", undefined, "Resolve preview validation issues before applying this draft."));
        return;
      }
      await runAction("studio:chat-apply", async () => {
        state.studioGraphHistoryEvent = {
          id: ++state.studioGraphHistoryEventId,
          kind: "push-before-replace",
          label: "Apply Chat to MMD"
        };
        renderStudioBridge({ preserveGraphRoot: true });
        state.studioBridge = withStudioAuthoringDisplayMetadata({
          ...(state.studioBridge || {}),
          authoring: patch.authoring,
          canvas: patch.canvas || state.studioCanvas,
          validation: state.studioChatResult?.validation?.project || state.studioBridge?.validation
        }, patch.authoring);
        state.studioCanvas = patch.canvas || buildStudioCanvasFromBridge(state.studioBridge);
        state.workbenchSource = state.studioChatResult?.previewMermaid || state.workbenchSource;
        state.workbench = {
          ...(state.workbench || {}),
          validation: state.studioChatResult?.validation?.project || state.workbench?.validation
        };
        state.studioBridgeLoaded = true;
        state.studioBridgeStale = false;
        state.studioChatDialogOpen = false;
        persistDraftSource(state.workbenchSource !== state.workbenchDiskSource ? state.workbenchSource : "");
        renderWorkbench({ preserveStudioGraphRoot: true });
        renderProject();
        setFlash("success", t("studio.chat.applied", undefined, "Chat draft applied to Studio Bridge."));
      });
    }

    async function saveStudioAuthoringDraft() {
      if (!state.studioBridge?.authoring) {
        await refreshStudioBridge();
      }
      if (!state.studioBridge?.authoring) {
        setFlash("error", t("studio.graph.saveDraftBlocked", undefined, "Studio Bridge cannot save a draft until Mermaid parses successfully."));
        return;
      }
      await runAction("studio:draft-save", async () => {
        const payload = await requestAction(\`\${API_PREFIX}/project/studio/authoring\`, {
          authoring: state.studioBridge.authoring
        });
        setFlash("success", t("studio.graph.draftSaved", { path: relativeToWorkdir(payload.draftPath || ".ogs/studio/system.authoring.json") }, "Studio draft saved to {path}."));
      });
    }

    async function generateMmdFromStudioBridge(options) {
      if (!state.hasProject) {
        setFlash("error", t("workspace.createOrLoadHint", undefined, "Use Project to create a project in this directory or load an existing project."));
        return false;
      }
      if (!state.studioBridge?.authoring) {
        await refreshStudioBridge();
      }
      if (!state.studioBridge?.authoring) {
        setFlash("error", t("studio.graph.generateMmdBlocked", undefined, "Studio Bridge cannot generate Mermaid until the source parses successfully."));
        return false;
      }
      await runAction("studio:generate-mmd", async () => {
        const payload = await requestAction(\`\${API_PREFIX}/project/studio/authoring/generate-mmd\`, {
          authoring: state.studioBridge.authoring
        });
        state.workbenchSource = payload.systemSource || state.workbenchSource;
        if (!options?.stayInMode) {
          state.workbenchView = "source";
          state.buildMode = "edit";
        }
        state.workbench = {
          ...(state.workbench || {}),
          validation: payload.validation || state.workbench?.validation
        };
        state.studioBridgeStale = true;
        persistDraftSource(state.workbenchSource !== state.workbenchDiskSource ? state.workbenchSource : "");
        renderWorkbench();
        setFlash("success", t("studio.graph.generatedWorkbenchSource", undefined, "Generated deterministic Mermaid into the Workbench source view."));
      });
      return true;
    }

    async function runWorkbenchValidation(force) {
      if (!state.hasProject) {
        return;
      }
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
      resetWorkbenchValidationTimer();
      state.workbenchValidationTimer = setTimeout(() => {
        void runWorkbenchValidation(false).catch((error) => {
          state.workbenchValidating = false;
          setFlash("error", t("workbench.validationFailed", { message: error.message || error }, "Workbench validation failed: {message}"));
          renderWorkbench({ preserveEditor: true });
        });
      }, WORKBENCH_VALIDATION_DEBOUNCE_MS);
    }

    async function loadWorkbench(options) {
      if (!state.hasProject) {
        renderWorkbench();
        return;
      }
      state.workbenchLoading = true;
      renderWorkbench();
      try {
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
        if (draft) {
          await runWorkbenchValidation(true);
        }
      } finally {
        state.workbenchLoading = false;
        renderWorkbench();
      }
      if (!options?.skipBridgeWarmup && state.workbenchView === "bridge" && (!state.studioBridgeLoaded || state.studioBridgeStale || !hasStudioBridgeGraphContent(state.studioBridge))) {
        const refreshWorkdir = state.workspace?.workdir || "";
        void ensureStudioBridgeReady({
          workdir: refreshWorkdir,
          requireGraph: true,
          attempts: 3
        }).catch((error) => {
          if (!state.hasProject || refreshWorkdir !== (state.workspace?.workdir || "")) {
            return;
          }
          state.studioBridgeStale = true;
          renderWorkbench();
          setFlash("warning", t("projectWizard.studioBridgeRefreshWarning", undefined, "Project was created, but the graph workspace needs a refresh. Use Build refresh if the graph is not visible."));
        });
      }
    }

    async function saveWorkbench() {
      if (!state.hasProject) {
        setFlash("error", t("workspace.createOrLoadHint", undefined, "Use Project to create a project in this directory or load an existing project."));
        return;
      }
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
          setFlash("error", t("workbench.saveBlockedByDiagnostics", undefined, "Save blocked by Mermaid validation diagnostics."));
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
          t("workbench.sourceSaved", {
            path: state.workbenchSavedPath,
            followUp: payload.followUpActions?.map((item) => item.label).join(" ") || t("workbench.sourceSavedFollowUpFallback", undefined, "Consider project sync, sync-models, or a new run for verification.")
          }, "Mermaid source saved to {path}. {followUp}")
        );
      });
    }

    async function saveWorkbenchAs(saveAsPath) {
      if (!saveAsPath) {
        setFlash("error", t("workbench.relativeSavePathRequired", undefined, "A relative save path is required."));
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
          setFlash("error", t("workbench.saveCopyBlockedByDiagnostics", undefined, "Save copy blocked by Mermaid validation diagnostics."));
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
          t("workbench.sourceSaved", {
            path: state.workbenchSavedPath,
            followUp: payload.followUpActions?.map((item) => item.label).join(" ") || t("workbench.sourceSavedFollowUpFallback", undefined, "Consider project sync, sync-models, or a new run for verification.")
          }, "Mermaid source saved to {path}. {followUp}")
        );
      });
    }

    async function prepareDryRunFromBuild() {
      if (!state.hasProject) {
        setFlash("error", t("workspace.createOrLoadHint", undefined, "Use Project to create a project in this directory or load an existing project."));
        return;
      }
      state.buildMode = "dry-run";
      renderWorkbench();
      await runWorkbenchValidation(true);
      if (state.workbench?.validation?.ok !== true) {
        setFlash("error", t("workbench.saveBlockedByDiagnostics", undefined, "Save blocked by Mermaid validation diagnostics."));
        return;
      }
      if (state.studioBridge?.authoring || state.workbenchView === "bridge") {
        const generated = await generateMmdFromStudioBridge({ stayInMode: true });
        if (!generated) {
          return;
        }
      }
      if (state.workbenchSource !== state.workbenchDiskSource) {
        await saveWorkbench();
      }
      openActionForm("start", {
        systemPath: state.workbenchSavedPath || "system.mmd",
        input: "",
        dryRun: true,
        runtimePath: "",
        userProfilePath: "",
        lawsPath: ""
      }, { returnFocusEl: document.getElementById("build-dry-run") });
      renderWorkbench();
    }

    async function startRunFromWorkbench(args) {
      if (!args.input) {
        if (state.actionForm?.kind === "start") {
          state.actionForm.errors = {
            ...(state.actionForm.errors || {}),
            input: t("run.inputRequired", undefined, "Run input is required.")
          };
          renderActionForm();
          focusActionField("action-run-prompt");
        }
        setFlash("error", t("run.inputRequired", undefined, "Run input is required."));
        return;
      }
      const readinessBlockers = state.projectReadiness?.blockers || [];
      if (args.dryRun && state.projectReadiness && state.projectReadiness.canDryRun === false) {
        setFlash("error", t("flash.dryRunBlocked", {
          message: readinessBlockers[0]?.message || t("flash.resolveReadinessBlockers")
        }));
        state.consoleTab = "validate-release";
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
        setFlash("success", t("flash.startCompleted", {
          runId: payload.runId,
          status: displayUiToken(payload.status, t)
        }));
        if (args.dryRun && payload.runId) {
          state.studioBridgeLastDryRunId = payload.runId;
          state.buildMode = "debug";
        }
        await loadProject();
        await loadRuns();
        if (payload.runId) {
          if (args.dryRun && state.consoleTab === "build") {
            state.selectedRunId = payload.runId;
            await loadSelectedRunBoot(payload.runId, { keepStream: false });
            state.consoleTab = "build";
            state.projectHome = false;
            renderConsoleTabs();
            renderWorkbench({ preserveStudioGraphRoot: true });
            writeRouteToLocation();
          } else {
            await selectRun(payload.runId);
          }
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
        setFlash("success", t("flash.resumeFinished", {
          runId: payload.runId,
          status: displayUiToken(payload.status, t)
        }));
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
        const promptElement = document.getElementById("action-run-prompt");
        const promptValue = typeof promptElement?.value === "string" ? promptElement.value.trim() : "";
        const payload = {
          systemPath: readActionFieldValue("action-start-system-path") || state.workbenchSavedPath || "system.mmd",
          input: promptValue,
          dryRun: readActionFieldValue("action-start-dry-run") !== "false",
          runtimePath: readActionFieldValue("action-start-runtime-path"),
          userProfilePath: readActionFieldValue("action-start-user-profile-path"),
          lawsPath: readActionFieldValue("action-start-laws-path")
        };
        state.actionForm.fields = Object.assign({}, form.fields, payload);
        if (!payload.input) {
          state.actionForm.errors = {
            ...(state.actionForm.errors || {}),
            input: t("run.inputRequired", undefined, "Run input is required.")
          };
          renderActionForm();
          focusActionField("action-run-prompt");
          setFlash("error", t("run.inputRequired", undefined, "Run input is required."));
          return;
        }
        state.actionForm.errors = {};
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
      if (form.kind === "reindex") {
        await reindexRuns();
      }
    }

    async function reindexRuns() {
      if (!state.hasProject) {
        setFlash("error", t("workspace.createOrLoadHint", undefined, "Use Project to create a project in this directory or load an existing project."));
        return;
      }
      await runAction("reindex", async () => {
        const payload = await requestAction(\`\${API_PREFIX}/runs/reindex\`);
        state.runs = payload.runs || [];
        closeActionForm();
        renderRuns();
        setFlash("success", t("runs.indexRebuilt", undefined, "Runs index rebuilt."));
      });
    }

    async function exportProject() {
      if (!state.hasProject) {
        setFlash("error", t("workspace.createOrLoadHint", undefined, "Use Project to create a project in this directory or load an existing project."));
        return;
      }
      const releaseDecision = buildReleaseReadinessDecision({
        validation: state.workbench?.validation,
        readiness: state.projectReadiness,
        contracts: state.contracts,
        rolePackages: state.rolePackages,
        bindings: state.bindings,
        workbenchDirty: state.workbenchSource !== state.workbenchDiskSource
      });
      if (!releaseDecision.canExport) {
        state.consoleTab = "validate-release";
        renderConsoleTabs();
        renderProject();
        setFlash("error", t("release.exportBlocked", {
          message: releaseDecision.blockers[0]?.message || t("release.resolveBlockers", undefined, "Resolve release blockers.")
        }, "Export blocked: " + (releaseDecision.blockers[0]?.message || "Resolve release blockers.")));
        return;
      }
      await runAction("project:export", async () => {
        const payload = await requestAction(\`\${API_PREFIX}/project/export\`);
        const blob = new Blob([JSON.stringify(payload, null, 2) + "\\n"], { type: "application/json" });
        const anchor = document.createElement("a");
        anchor.href = URL.createObjectURL(blob);
        anchor.download = "ogs-project-export-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".json";
        anchor.click();
        URL.revokeObjectURL(anchor.href);
        setFlash("success", t("release.exportGenerated", {
          mode: payload.mode || "single-project-v1"
        }, "Release candidate export generated (" + (payload.mode || "single-project-v1") + "). It excludes runtime artifacts."));
      });
    }

    async function loadProject() {
      state.projectLoading = true;
      renderProject();
      try {
        state.workspace = await requestJson(API_PREFIX + "/workspace");
        state.hasProject = state.workspace?.state === "project";
        if (!state.hasProject) {
          state.project = null;
          state.opsSummary = null;
          state.projectReadiness = null;
          state.bindings = null;
          state.contracts = null;
          state.rolePackages = null;
          state.studioRoleCatalog = null;
          state.workbench = null;
          state.workbenchSource = "";
          state.workbenchDiskSource = "";
          state.studioTemplates = [];
          state.projectLoading = false;
          state.workbenchLoading = false;
          state.runDetailLoading = false;
          renderProject();
          renderWorkbench();
          renderGraph();
          renderActionState();
          return;
        }
        const [summary, system, config, roles, opsSummary, readiness, bindings, contracts, rolePackages, templates, roleCatalog] = await Promise.all([
          requestJson(\`\${API_PREFIX}/project\`),
          requestJson(\`\${API_PREFIX}/project/system\`),
          requestJson(\`\${API_PREFIX}/project/config\`),
          requestJson(\`\${API_PREFIX}/project/roles\`),
          requestJson(\`\${API_PREFIX}/project/ops-summary\`),
          requestJson(\`\${API_PREFIX}/project/readiness\`),
          requestJson(\`\${API_PREFIX}/project/bindings\`),
          requestJson(\`\${API_PREFIX}/project/contracts\`),
          requestJson(\`\${API_PREFIX}/project/role-packages\`),
          requestJson(\`\${API_PREFIX}/project/studio/templates\`).catch(() => ({ templates: [] })),
          requestJson(\`\${API_PREFIX}/project/role-catalog\`).catch(() => state.studioRoleCatalog)
        ]);
        state.project = { summary, system, config, roles };
        state.opsSummary = opsSummary;
        state.projectReadiness = readiness;
        state.bindings = bindings;
        state.contracts = contracts;
        state.rolePackages = rolePackages;
        state.studioTemplates = templates.templates || [];
        state.studioRoleCatalog = roleCatalog || state.studioRoleCatalog;
      } finally {
        state.projectLoading = false;
        renderProject();
      }
      await loadWorkbench();
    }

    async function loadWorkspaceView() {
      await loadProject();
      if (state.hasProject) {
        await loadRuns();
        if (state.selectedRunId) {
          await loadSelectedRunBoot(state.selectedRunId, { keepStream: false });
        } else {
          renderSelectedRun();
        }
        return;
      }
      state.selectedRunId = "";
      state.selectedReviewId = "";
      state.selectedLogRoleId = "";
      state.runs = [];
      renderRuns();
      renderSelectedRun();
      renderLogs();
      writeRouteToLocation();
    }

    async function createProjectFromWizard(_formData) {
      const draft = updateProjectWizardDraftFromForm(document.getElementById("project-create-form"));
      const body = {
        requestId: state.projectCreateRequestId || ("project-create-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)),
        projectName: String(draft.projectName || ""),
        templateId: String(draft.templateId || "empty"),
        conflictStrategy: String(draft.conflictStrategy || "reject")
      };
      state.projectCreateRequestId = body.requestId;
      state.projectCreateError = null;
      setProjectCreateStage("request");
      await runAction("project:create", async () => {
        try {
          await requestAction(API_PREFIX + "/project/create", body);
        } catch (error) {
          const { code, message } = projectCreateErrorFromResponse(error);
          state.projectCreateError = {
            code,
            message
          };
          setProjectCreateStage("");
          renderProject();
          throw error;
        }
        state.projectCreateRequestId = "";
        state.projectCreateError = null;
        state.projectWizardDraft = null;
        state.consoleTab = "build";
        state.workbenchView = "bridge";
        state.projectHome = false;
        state.hasProject = true;
        try {
          setProjectCreateStage("project");
          await loadProject();
          setProjectCreateStage("workbench");
          await loadRuns();
          renderConsoleTabs();
          renderWorkbench();
        } catch (error) {
          setProjectCreateStage("");
          setFlash("warning", t("projectWizard.studioBridgeRefreshWarning", undefined, "Project was created, but the graph workspace needs a refresh. Use Build refresh if the graph is not visible."));
        }
        try {
          setProjectCreateStage("bridge");
          await ensureStudioBridgeReady({
            workdir: state.workspace?.workdir || "",
            requireGraph: true,
            attempts: 5
          });
        } catch (error) {
          state.studioBridgeStale = true;
          try {
            setProjectCreateStage("workbench");
            await loadWorkbench();
          } catch {
            // keep the created project usable even if the bridge refresh is temporarily unavailable
          }
          renderWorkbench();
          setFlash("warning", t("projectWizard.studioBridgeRefreshWarning", undefined, "Project was created, but the graph workspace needs a refresh. Use Build refresh if the graph is not visible."));
        }
        setProjectCreateStage("");
        if (!state.flash || state.flash.kind !== "warning") {
          setFlash("success", t("projectWizard.createSuccess", undefined, "Project created. Continue in Build."));
        }
      });
    }

    async function loadRuns() {
      const payload = await requestJson(\`\${API_PREFIX}/runs\`);
      state.runs = payload.runs || [];
      renderRuns();
      if (!state.projectHome && !state.selectedRunId && state.runs.length && (state.consoleTab === "operate" || state.consoleTab === "legacy")) {
        await selectRun(state.runs[0].runId);
      }
      if (!state.runs.length) {
        setLive("idle", t("live.noRuns"));
      }
    }

    async function loadSelectedLogs(runId, options) {
      if (!runId) {
        return;
      }
      const requestId = state.runSelectionRequestId;
      const load = async () => {
        const payload = await fetchSelectedLogs({
          requestJson,
          apiPrefix: API_PREFIX,
          runId,
          selectedLogRoleId: state.selectedLogRoleId,
          graphPayload: state.graph,
          logTail: state.logTail,
          logPageSize: state.logPageSize,
          logSince: state.logSince
        });
        if (!isCurrentRunSelection(runId, requestId)) {
          return;
        }
        state.engineLogs = payload.engineLogs;
        state.roleLogs = payload.roleLogs;
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
      const requestId = state.runSelectionRequestId;
      if (!state.selectedReviewId) {
        state.reviewDetail = null;
        renderReviews();
        renderDetail();
        writeRouteToLocation();
        return;
      }
      try {
        const reviewDetail = await requestJson(
          \`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/reviews/\${encodeURIComponent(state.selectedReviewId)}\`
        );
        if (!isCurrentRunSelection(runId, requestId)) {
          return;
        }
        state.reviewDetail = reviewDetail;
      } catch (error) {
        if (!isCurrentRunSelection(runId, requestId)) {
          return;
        }
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
      const requestId = state.runSelectionRequestId;
      const reviewsPayload = await requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/reviews\`);
      if (!isCurrentRunSelection(runId, requestId)) {
        return;
      }
      state.reviews = reviewsPayload;
      state.selectedReviewId = selectReviewId({
        currentReviewId: state.selectedReviewId,
        reviewsPayload
      });
      await refreshSelectedReviewDetail(runId, { allowMissing: true });
      renderSelectedRun();
      writeRouteToLocation();
    }

    async function refreshRunDetailAndGraph(runId) {
      const requestId = state.runSelectionRequestId;
      const [detail, graphPayload, contractRuntimeStatus] = await Promise.all([
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}\`),
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/graph\`),
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/contracts\`).catch(() => null)
      ]);
      if (!isCurrentRunSelection(runId, requestId)) {
        return;
      }
      state.detail = detail;
      state.graph = graphPayload;
      state.contractRuntimeStatus = contractRuntimeStatus;
      upsertRunFromHeader(detail.header);
      const fallbackRoleId = fallbackLogRoleId(detail.header);
      populateLogRoleOptions(graphPayload, fallbackRoleId);
      populateTimelineRoleOptions(graphPayload);
      renderSelectedRun();
      renderRuns();
      renderProject();
      writeRouteToLocation();
      const liveState = resolveRunLiveState(detail.header);
      setLive(liveState.mode, liveState.label);
    }

    async function loadFailure(runId, options) {
      if (shouldSkipDeferredPanelLoad({
        runId,
        actionBusy: state.actionBusy,
        internal: options?.internal,
        loaded: state.failureLoaded,
        stale: state.failureStale,
        force: options?.force
      })) {
        return;
      }
      const requestId = state.runSelectionRequestId;
      try {
        const failure = await fetchFailureData({ requestJson, apiPrefix: API_PREFIX, runId });
        if (!isCurrentRunSelection(runId, requestId)) {
          return;
        }
        state.failure = failure;
        state.failureLoaded = true;
        state.failureStale = false;
      } catch (error) {
        if (!isCurrentRunSelection(runId, requestId)) {
          return;
        }
        state.failure = null;
        state.failureLoaded = true;
        if (!options?.suppressFlash) {
          setFlash("error", t("failure.loadFailed", { message: error.message || error }, "Failed to load failure triage: {message}"));
        }
      }
      renderFailure();
    }

    async function loadResumeReadiness(runId, options) {
      if (shouldSkipDeferredPanelLoad({
        runId,
        actionBusy: state.actionBusy,
        internal: options?.internal,
        loaded: state.resumeReadinessLoaded,
        stale: state.resumeReadinessStale,
        force: options?.force
      })) {
        return;
      }
      const requestId = state.runSelectionRequestId;
      try {
        const readiness = await fetchResumeReadinessData({ requestJson, apiPrefix: API_PREFIX, runId });
        if (!isCurrentRunSelection(runId, requestId)) {
          return;
        }
        state.resumeReadiness = readiness;
        state.resumeReadinessLoaded = true;
        state.resumeReadinessStale = false;
      } catch (error) {
        if (!isCurrentRunSelection(runId, requestId)) {
          return;
        }
        state.resumeReadiness = null;
        state.resumeReadinessLoaded = true;
        if (!options?.suppressFlash) {
          setFlash("error", t("resume.readinessLoadFailed", { message: error.message || error }, "Failed to load resume readiness: {message}"));
        }
      }
      renderResumeDiagnostics();
      renderDetail();
    }

    async function loadResumeDiagnostics(runId, options) {
      if (shouldSkipDeferredPanelLoad({
        runId,
        actionBusy: state.actionBusy,
        internal: options?.internal,
        loaded: state.resumeDiagnosticsLoaded,
        stale: state.resumeDiagnosticsStale,
        force: options?.force
      })) {
        return;
      }
      const requestId = state.runSelectionRequestId;
      try {
        const payload = await fetchResumeDiagnosticsData({ requestJson, apiPrefix: API_PREFIX, runId });
        if (!isCurrentRunSelection(runId, requestId)) {
          return;
        }
        state.resumeDiagnostics = payload;
        state.resumeDiagnosticsLoaded = true;
        state.resumeDiagnosticsStale = false;
        renderResumeDiagnostics();
        renderDetail();
      } catch (error) {
        if (!isCurrentRunSelection(runId, requestId)) {
          return;
        }
        setFlash("error", t("resume.diagnosticsLoadFailed", { message: error.message || error }, "Failed to load resume diagnostics: {message}"));
      }
    }

    async function loadSelectedRunBoot(runId, options) {
      const requestId = state.runSelectionRequestId;
      state.runDetailLoading = true;
      renderSelectedRun();
      try {
        const [detail, eventsPayload, graphPayload, reviewsPayload, contractRuntimeStatus] = await Promise.all([
          requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}\`),
          requestJson(buildTimelineQuery(runId, { cursor: 0, limit: 250 })),
          requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/graph\`),
          requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/reviews\`),
          requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/contracts\`).catch(() => null)
        ]);
        if (!isCurrentRunSelection(runId, requestId)) {
          return;
        }

        state.detail = detail;
        state.events = eventsPayload.events || [];
        state.eventCursor = eventsPayload.nextCursor || 0;
        state.eventCursorIndex = createStreamCursorIndex(state.events);
        state.graph = graphPayload;
        state.reviews = reviewsPayload;
        state.contractRuntimeStatus = contractRuntimeStatus;
        upsertRunFromHeader(detail.header);
        const fallbackRoleId = fallbackLogRoleId(detail.header);
        state.selectedReviewId = selectReviewId({
          currentReviewId: state.selectedReviewId,
          reviewsPayload
        });
        await refreshSelectedReviewDetail(runId, { allowMissing: true });
        populateLogRoleOptions(graphPayload, fallbackRoleId);
        populateTimelineRoleOptions(graphPayload);
        state.runDetailLoading = false;
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
        const liveState = resolveRunLiveState(detail.header);
        setLive(liveState.mode, liveState.label);
      } finally {
        if (isCurrentRunSelection(runId, requestId)) {
          state.runDetailLoading = false;
          renderSelectedRun();
        }
      }
    }

    async function selectRun(runId) {
      if (!runId) return;
      stopStream();
      state.projectHome = false;
      if (state.consoleTab === "project" || state.consoleTab === "build" || state.consoleTab === "validate-release") {
        state.consoleTab = "operate";
        renderConsoleTabs();
      }
      state.selectedRunId = runId;
      state.runSelectionRequestId += 1;
      state.selectedReviewId = "";
      resetSelectedRunPanels();
      resetStreamRefreshForRun(runId);
      closeActionForm();
      setSidebarOpen(false);
      renderRuns();
      await loadSelectedRunBoot(runId, { keepStream: false });
    }

    function selectProjectHome() {
      stopStream();
      resetWorkbenchValidationTimer();
      state.projectHome = true;
      state.consoleTab = "project";
      state.selectedRunId = "";
      state.runSelectionRequestId += 1;
      state.selectedReviewId = "";
      resetSelectedRunPanels();
      closeActionForm();
      syncTimelineFilterInputs();
      renderProject();
      renderSelectedRun();
      renderConsoleTabs();
      renderRuns();
      writeRouteToLocation();
      setLive("idle", t("live.project"));
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
          t("flash.reviewActionRecorded", {
            reviewId: state.selectedReviewId,
            status: displayUiToken(payload.semanticStatus || args.decision, t),
            note: payload.detail?.note || ""
          })
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
          t("flash.stopRequestRecorded", {
            runId: state.selectedRunId,
            request: detail.requestRecorded ? t("common.yes") : t("common.no"),
            outcome: detail.stopOutcomeApplied ? t("status.applied") : t("status.pending"),
            status: displayUiToken(detail.runStatus || "unknown", t),
            converged: detail.converged ? t("common.yes") : t("common.no")
          })
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
      if (state.streamRefreshInFlight) {
        scheduleStreamRefresh();
        return;
      }
      if (!state.selectedRunId || state.streamRefreshRunId !== state.selectedRunId) {
        state.streamRefreshPlan = createInitialStreamRefreshPlan();
        state.streamRefreshRunId = state.selectedRunId || "";
        return;
      }
      state.streamRefreshTimer = null;
      const runId = state.selectedRunId;
      const plan = state.streamRefreshPlan;
      state.streamRefreshPlan = createInitialStreamRefreshPlan();
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
          plan.detailGraph ? refreshRunDetailAndGraph(runId) : Promise.resolve(),
          plan.failure ? loadFailure(runId, { force: true, internal: true, suppressFlash: true }) : Promise.resolve(),
          plan.resumeReadiness ? loadResumeReadiness(runId, { force: true, internal: true, suppressFlash: true }) : Promise.resolve()
        ]);
        if (plan.reviews) {
          await refreshReviews(runId);
        } else if (plan.reviewDetail) {
          await refreshSelectedReviewDetail(runId, { allowMissing: true });
        }
      } catch (error) {
        setFlash("error", t("stream.refreshFailed", { message: error.message || error }, "Stream refresh failed: {message}"));
      } finally {
        state.streamRefreshInFlight = false;
        if (state.streamRefreshRunId === runId && state.selectedRunId === runId) {
          const pendingPlan = state.streamRefreshPlan;
          if (
            pendingPlan.detailGraph ||
            pendingPlan.reviews ||
            pendingPlan.reviewDetail ||
            pendingPlan.failure ||
            pendingPlan.resumeReadiness ||
            pendingPlan.markDiagnosticsStale
          ) {
            scheduleStreamRefresh();
          }
        }
      }
    }

    function scheduleStreamRefresh(plan) {
      if (plan) {
        mergeStreamRefreshPlan(plan);
      }
      if (!state.selectedRunId) {
        state.streamRefreshPlan = createInitialStreamRefreshPlan();
        state.streamRefreshRunId = "";
        clearTimeout(state.streamRefreshTimer);
        state.streamRefreshTimer = null;
        return;
      }
      state.streamRefreshRunId = state.selectedRunId;
      clearTimeout(state.streamRefreshTimer);
      state.streamRefreshTimer = setTimeout(() => {
        void flushStreamRefresh();
      }, 250);
    }

    function connectStream(runId, cursor) {
      stopStream();
      resetStreamRefreshForRun(runId);
      const stream = new EventSource(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/stream?cursor=\${cursor}\`);
      state.stream = stream;
      stream.onopen = () => setLive("online", t("live.live"));
      stream.onmessage = (message) => {
        if (state.selectedRunId !== runId) {
          return;
        }
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
            state.events = appendIndexedStreamEntry(state.events, state.eventCursorIndex, payload, 250);
            renderTimeline(state.events);
          }
          scheduleStreamRefresh(getStreamRefreshPlan(payload.record.type));
        } catch {
          // Ignore malformed stream payloads.
        }
      };
      stream.onerror = () => {
        setLive("idle", t("live.streamReconnecting"));
      };
    }

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
    if (releaseExportButton) {
      releaseExportButton.addEventListener("click", async () => {
        await exportProject();
      });
    }

    reindexButton.addEventListener("click", async () => {
      openActionForm("reindex", {}, { returnFocusEl: reindexButton });
    });

    stopRunButton.addEventListener("click", async () => {
      if (!state.selectedRunId) {
        return;
      }
      openActionForm("stop", {
        reason: "requested via visualizer"
      }, { returnFocusEl: stopRunButton });
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
      }, { returnFocusEl: resumeRunButton });
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
        setFlash("success", t("visualizer.refreshed", undefined, "Visualizer refreshed."));
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
      // Log filters intentionally commit on change to avoid reloading logs on every keystroke.
      state.logTail = event.target.value || "";
      if (state.selectedRunId && state.logsLoaded) {
        await loadSelectedLogs(state.selectedRunId, { force: true });
      } else {
        renderLogs();
      }
      writeRouteToLocation();
    });

    logPageSizeEl.addEventListener("change", async (event) => {
      state.logPageSize = event.target.value || "";
      if (state.selectedRunId && state.logsLoaded) {
        await loadSelectedLogs(state.selectedRunId, { force: true });
      } else {
        renderLogs();
      }
    });

    logSinceEl.addEventListener("change", async (event) => {
      // Datetime-local edits stay local until commit/change.
      state.logSince = event.target.value || "";
      if (state.selectedRunId && state.logsLoaded) {
        await loadSelectedLogs(state.selectedRunId, { force: true });
      } else {
        renderLogs();
      }
      writeRouteToLocation();
    });

    searchEl.addEventListener("input", (event) => {
      // Run list search is an in-memory filter only; no debounce needed at current list size.
      state.filter = event.target.value || "";
      renderRuns();
    });

    if (localeSelectEl) {
      localeSelectEl.value = state.locale;
      localeSelectEl.addEventListener("change", (event) => {
        setLocaleFromControl(event.target.value || "");
      });
    }

    applyStaticLocalizedContent();
    renderConsoleTabs();

    const initialRoute = readRouteStateFromSearch(window.location.search);
    state.consoleTab = normalizeLifecycleView(initialRoute.lifecycle, initialRoute.view);
    if (!initialRoute.lifecycle && (initialRoute.runId || initialRoute.reviewId || initialRoute.logRoleId || initialRoute.tail || initialRoute.since)) {
      state.consoleTab = "operate";
    }
    state.projectHome = state.consoleTab === "project" || initialRoute.view === "project";
    renderConsoleTabs();
    state.selectedRunId = initialRoute.runId;
    state.selectedReviewId = initialRoute.reviewId;
    state.selectedLogRoleId = initialRoute.logRoleId;
    state.logTail = initialRoute.tail;
    state.logSince = initialRoute.since;
    logTailEl.value = state.logTail;
    logPageSizeEl.value = state.logPageSize;
    logSinceEl.value = state.logSince;
    syncTimelineFilterInputs();
    window.OGSVisualizerClient.dispose = disposeVisualizerClient;

    function renderWorkspaceLoadFailure(error) {
      const message = String(error.message || error);
      setInnerHtmlIfChanged(
        runListEl,
        '<div class="structure-list"><div class="event"><div class="event-top"><span>' + escapeText(t("common.unknown", undefined, "unknown")) + '</span><span>' + escapeText(t("action.retry", undefined, "Retry")) + '</span></div><strong>' +
          escapeText(t("state.visualizerLoadFailed", {
            message
          }, "Failed to load visualizer data: " + message)) +
          '</strong><div class="hint">' +
          escapeText(t("state.projectLoadFailed", {
            message
          }, "Failed to load project: " + message)) +
          '</div><div class="toolbar-group"><button id="project-load-retry" class="button subtle" type="button">' +
          escapeText(t("action.retry", undefined, "Retry")) +
          '</button></div></div></div>'
      );
      const retryButton = document.getElementById("project-load-retry");
      if (retryButton) {
        bindOnce(retryButton, "click", "project-load-retry", async () => {
          retryButton.disabled = true;
          try {
            await loadWorkspaceView();
            setFlash("success", t("visualizer.refreshed", undefined, "Visualizer refreshed."));
          } catch (retryError) {
            renderWorkspaceLoadFailure(retryError);
          } finally {
            retryButton.disabled = false;
          }
        });
      }
      if (projectWizardEl) {
        projectWizardEl.textContent = t("state.projectLoadFailed", {
          message
        }, "Failed to load project: " + message);
      }
      setLive("idle", t("live.offline"));
    }

    loadWorkspaceView()
      .catch((error) => {
        renderWorkspaceLoadFailure(error);
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
