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
  renderStudioBridgeInspector,
  renderStudioBridgePanel,
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
  projectCreateErrorFromResponse as mapProjectCreateErrorFromResponse,
  projectOpenMessageFromResponse as mapProjectOpenMessageFromResponse
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
    const mapProjectOpenMessageFromResponse = ${mapProjectOpenMessageFromResponse.toString()};
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
    const renderStudioBridgeInspector = ${renderStudioBridgeInspector.toString()};
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
    const selectedTitleEl = document.getElementById("selected-title");
    const selectedSubtitleEl = document.getElementById("selected-subtitle");
    const actionFormEl = document.getElementById("action-form");
    const actionFormSectionEl = document.getElementById("action-form-section");
    let actionFormReturnFocusEl = null;
    const consoleTabsEl = document.getElementById("console-tabs");
    const workdirEl = document.getElementById("workdir");
    const projectSummaryEl = document.getElementById("project-summary");
    const projectWizardEl = document.getElementById("project-wizard");
    const opsSummaryEl = document.getElementById("ops-summary");
    const projectReadinessEl = document.getElementById("project-readiness");
    const releaseGateEl = document.getElementById("release-gate");
    const workbenchMetaEl = document.getElementById("workbench-meta");
    const workbenchStatusEl = document.getElementById("workbench-status");
    const workbenchActionsEl = document.getElementById("workbench-actions");
    const workbenchTabsEl = document.getElementById("workbench-tabs");
    const workbenchViewTabsEl = document.getElementById("workbench-view-tabs");
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
    const logRoleEl = document.getElementById("log-role");
    const logPageSizeEl = document.getElementById("log-page-size");
    const logTailEl = document.getElementById("log-tail");
    const logSinceEl = document.getElementById("log-since");
    const sidebarEl = document.getElementById("sidebar");
    const sidebarOverlayEl = document.getElementById("sidebar-overlay");
    const sidebarToggleButton = document.getElementById("sidebar-toggle");
    const projectHomeButton = document.getElementById("project-home");
    const projectExportButton = document.getElementById("project-export");
    const releaseExportButton = document.getElementById("release-export");
    const reindexButton = document.getElementById("reindex");
    const startRunButton = document.getElementById("start-run");
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
        [projectHomeButton, "action.project"],
        [projectExportButton, "action.exportProject"],
        [releaseExportButton, "action.exportProject"],
        [reindexButton, "action.reindex"],
        [startRunButton, "action.startRun"],
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

    const RECENT_PROJECTS_KEY = "ogs.visualizer.recentProjects";

    function readRecentProjects() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(RECENT_PROJECTS_KEY) || "[]");
        return Array.isArray(parsed) ? parsed.filter(Boolean).map((item) => String(item)).slice(0, 6) : [];
      } catch {
        return [];
      }
    }

    function rememberRecentProject(workdir) {
      const target = String(workdir || "").trim();
      if (!target) {
        return;
      }
      try {
        const recent = readRecentProjects().filter((item) => item !== target);
        window.localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify([target].concat(recent).slice(0, 6)));
      } catch {
        // best effort only
      }
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

    function writeRouteToLocation() {
      const params = new URLSearchParams(buildRouteSearch({
        projectHome: state.projectHome,
        lifecycle: state.consoleTab,
        projectTab: state.projectMenuTab,
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
      const authoring = bridge?.authoring || null;
      const extracted = bridge?.extracted || {};
      const roles = extracted.roles || [];
      const flows = extracted.flows || [];
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
        workdir,
        projectName: workdir ? String(workdir).split(/[\\/]/).filter(Boolean).pop() || "my-ogs-project" : "my-ogs-project",
        projectId: "project.starter",
        templateId: "empty",
        defaultModelRef: "",
        profileStrategy: "visual-editor",
        defaultProfileId: "profile.default",
        defaultToolRef: "",
        conflictStrategy: workspace?.state === "non-project-conflict" ? "reject" : "init-current",
        selectedRoleIds: []
      };
    }

    function getWorkspaceStateLabel(workspace) {
      if (!workspace) {
        return t("projectWizard.workspaceUnknown", undefined, "unknown");
      }
      if (workspace.hasProject) {
        return t("projectWizard.workspaceHasProject", undefined, "project exists");
      }
      if (workspace.state === "non-project-conflict") {
        return t("projectWizard.workspaceConflict", undefined, "existing files");
      }
      if (workspace.state === "empty") {
        return t("projectWizard.workspaceEmpty", undefined, "empty");
      }
      return t("projectWizard.workspaceNoProject", undefined, "no project");
    }

    function getRoleHealthKey(role) {
      const health = String(role?.health?.status || role?.healthStatus || "").trim().toLowerCase();
      if (!health || health === "unknown" || health === "n/a") {
        return "unknown";
      }
      if (health === "ok" || health === "healthy" || health === "ready") {
        return "ok";
      }
      if (health === "warning" || health === "warn" || health === "attention") {
        return "warning";
      }
      if (health === "error" || health === "failed" || health === "unhealthy") {
        return "error";
      }
      return health;
    }

    function getRoleHealthLabel(role, includeFallback = true) {
      const key = getRoleHealthKey(role);
      if (key === "ok") return t("projectWizard.roleHealthOk", undefined, "healthy");
      if (key === "warning") return t("projectWizard.roleHealthWarning", undefined, "warning");
      if (key === "error") return t("projectWizard.roleHealthError", undefined, "unhealthy");
      return includeFallback ? t("projectWizard.roleHealthUnknown", undefined, "unknown") : "";
    }

    function filterRoleCatalogRoles(catalogRoles) {
      const term = state.roleCatalogFilter.trim().toLowerCase();
      const healthFilter = state.roleCatalogHealthFilter || "all";
      return catalogRoles.filter((role) => {
        const healthKey = getRoleHealthKey(role);
        if (healthFilter !== "all" && healthKey !== healthFilter) {
          return false;
        }
        if (!term) {
          return true;
        }
        return [role.roleId, role.name, role.summary, role.description, role.source, getRoleHealthLabel(role, false)]
          .filter(Boolean)
          .some((item) => String(item).toLowerCase().includes(term));
      });
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
      const selectedRoleIds = new Set(draft.selectedRoleIds || []);
      if (typeof formData.getAll === "function") {
        const visibleRoleIds = [];
        for (const input of projectWizardEl?.querySelectorAll('input[name="roleIds"]') || []) {
          visibleRoleIds.push(String(input.value || input.getAttribute("value") || "").trim());
        }
        for (const roleId of visibleRoleIds) {
          selectedRoleIds.delete(roleId);
        }
        for (const value of formData.getAll("roleIds")) {
          const roleId = String(value || "").trim();
          if (roleId) {
            selectedRoleIds.add(roleId);
          }
        }
      }
      Object.assign(draft, {
        workdir: draft.workdir || state.workspace?.workdir || getCurrentWorkdir(),
        projectName: readFormValue("projectName", String(draft.projectName || "")),
        projectId: readFormValue("projectId", String(draft.projectId || "")),
        templateId: readFormValue("templateId", String(draft.templateId || "empty")),
        defaultModelRef: readFormValue("defaultModelRef", String(draft.defaultModelRef || "")),
        profileStrategy: readFormValue("profileStrategy", String(draft.profileStrategy || "visual-editor")),
        defaultProfileId: readFormValue("defaultProfileId", String(draft.defaultProfileId || "")),
        defaultToolRef: readFormValue("defaultToolRef", String(draft.defaultToolRef || "")),
        conflictStrategy: readFormValue("conflictStrategy", String(draft.conflictStrategy || "reject")),
        selectedRoleIds: Array.from(selectedRoleIds)
      });
      return draft;
    }

    function projectPanelModeFromTab(tabId) {
      switch (tabId) {
        case "new":
          return "new";
        case "open":
          return "open";
        case "recent":
          return "recent";
        case "settings":
          return "settings";
        default:
          return "closed";
      }
    }

    function setProjectPanelMode(mode) {
      state.projectPanelMode = mode || "closed";
      state.projectMenuTab = mode === "closed" ? "overview" : mode;
    }

    function renderProjectMenuHtml(projectTab) {
      const menuItems = [
        ["overview", t("projectMenu.overview", undefined, "Overview")],
        ["new", t("projectMenu.new", undefined, "New Project")],
        ["open", t("projectMenu.open", undefined, "Open Project")],
        ["recent", t("projectMenu.recent", undefined, "Recent")],
        ["settings", t("projectMenu.settings", undefined, "Settings")]
      ];
      return '<div class="project-menu segmented">' + menuItems.map(([id, label]) =>
        '<button class="button subtle ' + (projectTab === id ? "active" : "") + '" type="button" data-project-menu-tab="' + escapeText(id) + '">' + escapeText(label) + '</button>'
      ).join("") + '</div>';
    }

    function renderProjectOverviewContent() {
      const templates = Array.isArray(state.studioTemplates) ? state.studioTemplates : [];
      const roles = state.project?.roles?.roles || [];
      const modelCount = state.project?.config?.modelCatalog?.models?.length || 0;
      const profiles = state.project?.config?.profiles || [];
      const entryRoleId = state.workbench?.validation?.structure?.entryRoleId
        || state.project?.summary?.project?.entryRoleId
        || roles[0]?.roleId
        || "n/a";
      return [
        '<div class="event"><div class="event-top"><span>' + escapeText(t("projectWizard.templates", undefined, "templates")) + '</span><span>' + escapeText(String(templates.length)) + '</span></div><strong>' +
          escapeText(templates.map((template) => template.title || template.id).join(", ") || t("common.none", undefined, "none")) +
          '</strong><div class="hint">' + escapeText(t("projectWizard.templatesHint", undefined, "Use a Studio template in Build to start graph authoring visually.")) + '</div></div>',
        '<div class="event"><div class="event-top"><span>' + escapeText(t("projectWizard.rolePackages", undefined, "role packages")) + '</span><span>' + escapeText(String(roles.length)) + '</span></div><strong>' +
          escapeText(roles.map((role) => role.roleId).filter(Boolean).slice(0, 4).join(", ") || t("common.none", undefined, "none")) +
          '</strong><div class="hint">' + escapeText(t("projectWizard.rolePackagesHint", undefined, "Role packages are resolved from the current project workspace.")) + '</div></div>',
        '<div class="event"><div class="event-top"><span>' + escapeText(t("projectWizard.modelProfile", undefined, "model / profile")) + '</span><span>' + escapeText(String(modelCount) + " / " + String(profiles.length)) + '</span></div><strong>' +
          escapeText(t("projectWizard.modelProfileTitle", undefined, "Select model references and execution profiles in the visual role editor.")) +
          '</strong><div class="hint">' + escapeText(t("projectWizard.modelProfileHint", undefined, "Profiles are created as drafts first and persisted only through explicit save actions.")) + '</div></div>',
        '<div class="event"><div class="event-top"><span>' + escapeText(t("projectWizard.entryRole", undefined, "entry role")) + '</span><span>' + escapeText(entryRoleId) + '</span></div><strong>' +
          escapeText(t("projectWizard.entryRoleTitle", undefined, "Lifecycle starts from a visible entry role.")) +
          '</strong><div class="hint">' + escapeText(t("projectWizard.loadHint", undefined, "Create/import/load project is explicit; no background workspace writes happen from this panel.")) + '</div></div>'
      ].join("");
    }

    function projectCreateErrorFromResponse(error) {
      return mapProjectCreateErrorFromResponse(error, t);
    }

    function projectOpenMessageFromResponse(result) {
      return mapProjectOpenMessageFromResponse(result, t);
    }

    function renderFlash() {
      if (!state.flash) {
        flashEl.className = "flash hidden";
        flashEl.textContent = "";
        return;
      }
      flashEl.className = "flash " + (state.flash.kind || "info");
      flashEl.innerHTML = escapeText(state.flash.message);
      if (state.flash.action === "retry-role-import" && state.pendingRoleImportRetry?.roleIds?.length) {
        flashEl.innerHTML += ' <button id="flash-retry-role-import" class="button subtle" type="button">' + escapeText(t("projectWizard.retryRoleImport", undefined, "Retry role import")) + '</button>';
        const retryButton = document.getElementById("flash-retry-role-import");
        if (retryButton) {
          bindOnce(retryButton, "click", "retry-role-import", () => {
            void retryPendingRoleImport();
          });
        }
      }
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

    function setActionBusy(actionId) {
      state.actionBusy = actionId;
      renderActionForm();
      renderLogs();
      renderActionState();
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
      return renderWorkspaceEmptyStateHtml({ kind, t, escapeText });
    }

    function renderActionState() {
      const disabled = Boolean(state.actionBusy);
      const noProject = !state.hasProject;
      const stopDisabled = disabled || !canRequestStop();
      projectHomeButton.disabled = disabled;
      projectExportButton.disabled = disabled || noProject;
      if (releaseExportButton) releaseExportButton.disabled = disabled || noProject;
      reindexButton.disabled = disabled || noProject;
      startRunButton.disabled = disabled || noProject;
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
      if (workbenchViewTabsEl) {
        for (const button of workbenchViewTabsEl.querySelectorAll("button")) {
          button.disabled = disabled;
        }
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
      const isBuild = state.consoleTab === "build";
      const isOperate = state.consoleTab === "operate" || state.consoleTab === "legacy";
      const isProject = state.consoleTab === "project";
      if (startRunButton) {
        startRunButton.hidden = !isBuild || !state.hasProject;
        startRunButton.textContent = t("studio.dryRun", undefined, "Dry run");
      }
      if (resumeRunButton) {
        resumeRunButton.hidden = !isOperate;
        resumeRunButton.disabled = !state.selectedRunId;
      }
      if (stopRunButton) {
        stopRunButton.hidden = !isOperate;
        stopRunButton.disabled = !state.selectedRunId;
      }
      if (projectHomeButton) {
        projectHomeButton.hidden = isProject;
      }
      if (projectExportButton) {
        projectExportButton.hidden = state.consoleTab !== "validate-release" || !state.hasProject;
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
        fullscreen: state.studioBridgeFullscreen,
        actionBusy: state.actionBusy,
        t
      };
    }

    function renderStudioBridge(options) {
      const args = studioBridgeRenderArgs();
      const html = renderStudioBridgePanel(args);
      const preservedRoot = options?.preserveGraphRoot ? document.getElementById("studio-graph-root") : null;
      if (options?.preserveGraphRoot && document.getElementById("studio-graph-root")) {
        patchStudioBridgePanel(html);
      } else {
        workbenchBodyEl.innerHTML = html;
      }
      const currentRoot = document.getElementById("studio-graph-root");
      if (preservedRoot && currentRoot && currentRoot !== preservedRoot && typeof currentRoot.replaceWith === "function") {
        currentRoot.replaceWith(preservedRoot);
      }
      updateStudioBridgeSelectionChrome();
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
      for (const region of ["toolbar", "graph", "index", "navigator", "inspector", "flow-list", "diagnostics"]) {
        const current = findStudioBridgeElement('[data-studio-bridge-region="' + region + '"]');
        const next = template.content.querySelector('[data-studio-bridge-region="' + region + '"]');
        if (current && next) {
          current.replaceWith(next);
        }
      }
      updateStudioBridgeSelectionChrome();
    }

    function bindStudioBridgeControls() {
      attachStudioBridgeControls({
        root: workbenchBodyEl,
        findElement: findStudioBridgeElement,
        onRoleSelect: (roleId) => {
          state.studioBridgeSelectedRoleId = roleId;
          state.studioBridgeSelectedFlowKey = "";
          state.studioBridgeEditSelectionRequest += 1;
          updateStudioBridgeSelection(true);
        },
        onFlowSelect: (flowKey) => {
          state.studioBridgeSelectedFlowKey = flowKey;
          state.studioBridgeSelectedRoleId = "";
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
    }

    function updateStudioBridgeSelection(syncGraph) {
      updateStudioBridgeSelectionChrome();
      const inspector = findStudioBridgeElement('[data-studio-bridge-region="inspector"]');
      if (inspector) {
        inspector.innerHTML = renderStudioBridgeInspector({
          bridge: studioBridgeRenderArgs().bridge,
          selectedRoleId: state.studioBridgeSelectedRoleId,
          selectedFlowKey: state.studioBridgeSelectedFlowKey,
          t
        });
      }
      if (syncGraph !== false) {
        mountStudioGraphIsland();
      }
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

    if (typeof document.addEventListener === "function") {
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && state.actionForm && !state.actionBusy) {
          closeActionForm();
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
        canvas: state.studioCanvas || buildStudioCanvasFromBridge(state.studioBridge),
        validation: state.studioBridge?.validation || state.workbench?.validation || null,
        selectedRoleId: state.studioBridgeSelectedRoleId,
        selectedFlowKey: state.studioBridgeSelectedFlowKey,
        editSelectionRequest: state.studioBridgeEditSelectionRequest,
        defaultAutoLayout: true,
        busy: Boolean(state.actionBusy),
        rolePackages: state.rolePackages,
        bindings: state.bindings,
        readiness: state.projectReadiness,
        projectConfig: state.project?.config,
        labels: buildStudioGraphLabels(),
        commandFormLabels: buildStudioGraphCommandFormLabels(),
        historyEvent: state.studioGraphHistoryEvent,
        onSelectRole: (roleId) => {
          state.studioBridgeSelectedRoleId = roleId || "";
          state.studioBridgeSelectedFlowKey = "";
          updateStudioBridgeSelection(false);
        },
        onSelectFlow: (flowKey) => {
          state.studioBridgeSelectedFlowKey = flowKey || "";
          state.studioBridgeSelectedRoleId = "";
          updateStudioBridgeSelection(false);
        },
        onClearSelection: () => {
          state.studioBridgeSelectedRoleId = "";
          state.studioBridgeSelectedFlowKey = "";
          updateStudioBridgeSelection(false);
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
        if (workbenchViewTabsEl) {
          workbenchViewTabsEl.innerHTML = "";
        }
        workbenchActionsEl.innerHTML = "";
        workbenchBodyEl.innerHTML = loadingSkeleton(t("state.loadingWorkbench", undefined, "Loading Build workbench"), 5);
        return;
      }
      if (!state.hasProject) {
        workbenchMetaEl.textContent = t("workspace.buildUnavailableTitle", undefined, "Create or load a project before building.");
        workbenchStatusEl.innerHTML = '<span class="pill warn">' + escapeText(t("workspace.notInitialized", undefined, "not initialized")) + '</span>';
        workbenchTabsEl.innerHTML = "";
        if (workbenchViewTabsEl) {
          workbenchViewTabsEl.innerHTML = "";
        }
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
      if (workbenchViewTabsEl) {
        setInnerHtmlIfChanged(workbenchViewTabsEl, renderWorkbenchViewTabsHtml({
          buildMode: state.buildMode,
          workbenchView: state.workbenchView,
          t,
          escapeText
        }));
      }
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
        renderStudioBridge({ preserveGraphRoot: Boolean(options?.preserveStudioGraphRoot) });
      } else {
        state.workbenchView = "bridge";
        renderStudioBridge({ preserveGraphRoot: Boolean(options?.preserveStudioGraphRoot) });
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
      if (workbenchViewTabsEl) {
        for (const button of workbenchViewTabsEl.querySelectorAll("[data-workbench-view]")) {
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
        const projectLabel = t("state.loadingProject", undefined, "Loading project data");
        projectSummaryEl.innerHTML = loadingSkeleton(projectLabel, 4);
        if (opsSummaryEl) opsSummaryEl.innerHTML = loadingSkeleton(t("state.loadingOpsSummary", undefined, "Loading operations summary"), 3);
        if (projectReadinessEl) projectReadinessEl.innerHTML = loadingSkeleton(t("state.loadingProjectReadiness", undefined, "Loading project readiness"), 3);
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
        projectSummaryEl.innerHTML = workspaceEmptyStateHtml("project");
        if (opsSummaryEl) opsSummaryEl.innerHTML = workspaceEmptyStateHtml("operate");
        if (projectReadinessEl) projectReadinessEl.innerHTML = '<div class="hint">' + escapeText(t("workspace.readinessUnavailable", undefined, "Project readiness loads after a project is created or loaded.")) + '</div>';
        if (releaseGateEl) releaseGateEl.innerHTML = workspaceEmptyStateHtml("validate");
        bindingExplainEl.innerHTML = '<div class="hint">' + escapeText(t("workspace.projectDataUnavailable", undefined, "Project configuration is unavailable until a project is created or loaded.")) + '</div>';
        rolePackagesEl.innerHTML = '<div class="hint">' + escapeText(t("workspace.roleCatalogHint", undefined, "Installed role catalog can be imported after project creation.")) + '</div>';
        contractExplainEl.innerHTML = '<div class="hint">' + escapeText(t("workspace.projectDataUnavailable", undefined, "Project configuration is unavailable until a project is created or loaded.")) + '</div>';
        renderProjectWizard();
        return;
      }
      if (!state.project) {
        projectSummaryEl.textContent = t("state.projectDataUnavailable");
        if (opsSummaryEl) opsSummaryEl.innerHTML = '<div class="hint">' + escapeText(t("state.opsSummaryUnavailable")) + '</div>';
        if (projectReadinessEl) projectReadinessEl.innerHTML = '<div class="hint">' + escapeText(t("state.projectReadinessUnavailable")) + '</div>';
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
      const summary = state.project.summary?.project ?? {};
      const roles = state.project.roles?.roles ?? [];
      const projectSummaryHtml = renderProjectSummaryPanel({
        summary,
        roles,
        warnings: state.project.config?.modelSelectionWarnings ?? [],
        workbenchSavedPath: state.workbenchSavedPath || "system.mmd",
        validationOk: Boolean(state.workbench?.validation?.ok),
        t
      });
      projectSummaryEl.innerHTML = projectSummaryHtml;
      if (opsSummaryEl) {
        opsSummaryEl.innerHTML = renderOpsSummaryPanel({
          opsSummary: state.opsSummary,
          t
        });
      }
      if (projectReadinessEl) {
        projectReadinessEl.innerHTML = renderProjectReadinessPanel({
          readiness: state.projectReadiness,
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
      const defaultProjectTab = state.hasProject ? "overview" : "new";
      const activeTab = ["overview", "new", "open", "recent", "settings"].includes(state.projectMenuTab)
        ? state.projectMenuTab
        : defaultProjectTab;
      if (!state.hasProject && activeTab === "overview") {
        state.projectMenuTab = "new";
      }
      const projectTab = !state.hasProject && activeTab === "overview" ? "new" : activeTab;
      state.projectPanelMode = projectPanelModeFromTab(projectTab);
      const menuHtml = renderProjectMenuHtml(projectTab);
      const openDraft = state.projectOpenDraft || workspace.workdir || getCurrentWorkdir();
      if (!state.projectOpenDraft) {
        state.projectOpenDraft = openDraft;
      }
      const recentProjects = readRecentProjects();
      const browse = state.projectOpenBrowse;
      const validation = state.projectOpenValidation;
      const validationMessage = validation ? projectOpenMessageFromResponse(validation).message : "";
      const browseMessage = browse ? projectOpenMessageFromResponse(browse).message : "";
      const browseDirectories = Array.isArray(browse?.children?.directories) ? browse.children.directories : [];
      const browseProjects = Array.isArray(browse?.recent) ? browse.recent : [];
      const browseFiles = Array.isArray(browse?.children?.files) ? browse.children.files : [];
      const validationClass = validation
        ? validation.isProject ? "" : validation.hasConflict || validation.exists === false || validation.readable === false ? " warn" : ""
        : "";
      const workspaceState = getWorkspaceStateLabel(workspace);
      const validationHtml = validation
        ? '<div id="project-open-validation" class="event' + validationClass + '"><div class="event-top"><span>' + escapeText(t("projectOpen.validation", undefined, "Validation")) + '</span><span>' + escapeText(validation.isProject ? t("projectOpen.ready", undefined, "ready") : validation.isEmpty ? t("common.empty", undefined, "empty") : t("common.attention", undefined, "attention")) + '</span></div><strong>' + escapeText(validationMessage) + '</strong>' +
          (Array.isArray(validation.conflicts) && validation.conflicts.length ? '<div class="hint">' + escapeText(t("projectOpen.conflicts", { items: validation.conflicts.join(", ") }, "Conflicts: " + validation.conflicts.join(", "))) + '</div>' : "") +
          '</div>'
        : '<div id="project-open-validation" class="hint">' + escapeText(t("projectOpen.validationPending", undefined, "Choose or validate a directory before opening.")) + '</div>';
      const browseSummaryHtml = browse
        ? '<div class="event"><div class="event-top"><span>' + escapeText(t("projectOpen.browser", undefined, "Directory browser")) + '</span><span>' + escapeText(relativeToWorkdir(browse.workdir || openDraft)) + '</span></div><strong>' + escapeText(t("projectOpen.browserTitle", undefined, "Browse server-visible directories")) + '</strong><div class="hint">' + escapeText(browseMessage || t("projectOpen.browserHint", undefined, "Select a child directory, parent, or known project before opening.")) + '</div></div>'
        : '<div class="event"><div class="event-top"><span>' + escapeText(t("projectOpen.browser", undefined, "Directory browser")) + '</span><span>' + escapeText(state.projectOpenLoading ? t("common.loading", undefined, "loading") : t("common.ready", undefined, "ready")) + '</span></div><strong>' + escapeText(t("projectOpen.browserTitle", undefined, "Browse server-visible directories")) + '</strong><div class="hint">' + escapeText(t("projectOpen.browserHint", undefined, "Select a child directory, parent, or known project before opening.")) + '</div></div>';
      const browseErrorHtml = state.projectOpenError
        ? '<div class="event warn"><strong>' + escapeText(state.projectOpenError) + '</strong></div>'
        : "";
      const parentButtonHtml = browse?.parent
        ? '<button class="button subtle" type="button" data-project-open-browse="' + escapeText(browse.parent) + '">..</button>'
        : "";
      const directoryHtml = browseDirectories.length
        ? '<div class="project-open-browser-grid">' + parentButtonHtml + browseDirectories.map((item) => '<button class="button subtle" type="button" data-project-open-browse="' + escapeText(item.path) + '">' + escapeText(item.name) + '</button>').join("") + '</div>'
        : '<div class="project-open-browser-grid">' + parentButtonHtml + '<span class="hint">' + escapeText(t("projectOpen.noDirectories", undefined, "No child directories.")) + '</span></div>';
      const projectSuggestionsHtml = browseProjects.length
        ? '<div class="structure-list">' + browseProjects.map((item) => '<button class="button subtle" type="button" data-project-open-project="' + escapeText(item.workdir) + '">' + escapeText(item.name || relativeToWorkdir(item.workdir)) + '</button>').join("") + '</div>'
        : '<div class="hint">' + escapeText(t("projectOpen.noProjectsNearby", undefined, "No OGSystem projects found in this directory.")) + '</div>';
      const filesHtml = browseFiles.length
        ? '<div class="hint">' + escapeText(t("projectOpen.filesPreview", { items: browseFiles.slice(0, 6).map((item) => item.name).join(", ") }, "Files: " + browseFiles.slice(0, 6).map((item) => item.name).join(", "))) + '</div>'
        : "";
      const openPanelHtml = [
        '<form id="project-open-form" class="structure-list">',
        '<div class="event"><div class="event-top"><span>' + escapeText(t("projectMenu.open", undefined, "Open Project")) + '</span><span>' + escapeText(t("form.workspace", undefined, "workspace")) + '</span></div><strong>' + escapeText(t("projectOpen.title", undefined, "Load an existing OGSystem project")) + '</strong><div class="hint">' + escapeText(t("projectOpen.hint", undefined, "Choose a project directory. The server validates the path before rebinding the visualizer.")) + '</div></div>',
        '<div class="event"><div class="event-top"><span>' + escapeText(t("projectOpen.currentDirectory", undefined, "Current directory")) + '</span><span>' + escapeText(workspaceState) + '</span></div><strong><code>' + escapeText(workspace.workdir || getCurrentWorkdir() || "n/a") + '</code></strong><div class="hint">' + escapeText(t("projectOpen.currentDirectoryHint", undefined, "The current visualizer workdir is shown here so you can decide whether to load it, initialize it, or switch paths.")) + '</div></div>',
        browseSummaryHtml,
        browseErrorHtml,
        '<div class="toolbar-group"><button class="button subtle" id="project-open-browse-refresh" type="button"' + (state.projectOpenLoading ? " disabled" : "") + '>' + escapeText(t("projectOpen.refreshBrowse", undefined, "Refresh")) + '</button><button class="button subtle" id="project-open-validate" type="button"' + (state.projectOpenLoading ? " disabled" : "") + '>' + escapeText(t("projectOpen.validate", undefined, "Validate")) + '</button></div>',
        directoryHtml,
        projectSuggestionsHtml,
        '<div class="toolbar-group">' +
          '<button class="button primary" type="submit">' + escapeText(t("projectOpen.loadCurrent", undefined, "Load current project")) + '</button>' +
          '<button class="button subtle" type="button" data-project-open-browse="' + escapeText(workspace.workdir || getCurrentWorkdir() || "") + '">' + escapeText(t("projectOpen.useOtherDirectory", undefined, "Use other directory")) + '</button>' +
        '</div>',
        filesHtml,
        recentProjects.length
          ? '<div class="structure-list">' + recentProjects.map((item) => '<button class="button subtle" type="button" data-project-open-recent="' + escapeText(item) + '">' + escapeText(relativeToWorkdir(item)) + '</button>').join("") + '</div>'
          : '<div class="hint">' + escapeText(t("projectOpen.noRecent", undefined, "No recent projects yet.")) + '</div>',
        '<label><span>' + escapeText(t("projectOpen.path", undefined, "Project directory")) + '</span><input id="project-open-workdir" name="workdir" value="' + escapeText(openDraft) + '"><span class="hint">' + escapeText(t("projectOpen.pathHint", undefined, "Use an absolute path or a server-visible project directory.")) + '</span></label>',
        validationHtml,
        '<div class="toolbar-group"><button class="button primary" id="project-open-submit" type="submit">' + escapeText(t("projectOpen.load", undefined, "Open Project")) + '</button></div>',
        '</form>'
      ].join("");
      const recentPanelHtml = [
        '<div class="event"><div class="event-top"><span>' + escapeText(t("projectMenu.recent", undefined, "Recent")) + '</span><span>' + escapeText(String(recentProjects.length)) + '</span></div><strong>' + escapeText(t("projectOpen.recentTitle", undefined, "Recently opened projects")) + '</strong><div class="hint">' + escapeText(t("projectOpen.recentHint", undefined, "Recent projects are stored locally in this browser.")) + '</div></div>',
        recentProjects.length
          ? '<div class="structure-list">' + recentProjects.map((item) => '<button class="button subtle" type="button" data-project-open-recent="' + escapeText(item) + '">' + escapeText(item) + '</button>').join("") + '</div>'
          : '<div class="hint">' + escapeText(t("projectOpen.noRecent", undefined, "No recent projects yet.")) + '</div>'
      ].join("");
      const overviewHtml = renderProjectOverviewContent();
      if (!state.hasProject) {
        const draft = ensureProjectWizardDraft(workspace);
        const conflict = workspace.state === "non-project-conflict";
        const catalogRoles = Array.isArray(state.roleCatalog?.roles) ? state.roleCatalog.roles : [];
        const filteredCatalogRoles = filterRoleCatalogRoles(catalogRoles);
        const pageSize = [12, 24, 48].includes(state.roleCatalogPageSize) ? state.roleCatalogPageSize : 24;
        const pageCount = Math.max(1, Math.ceil(filteredCatalogRoles.length / pageSize));
        state.roleCatalogPage = Math.min(Math.max(0, state.roleCatalogPage || 0), pageCount - 1);
        const pageStart = state.roleCatalogPage * pageSize;
        const visibleCatalogRoles = filteredCatalogRoles.slice(pageStart, pageStart + pageSize);
        const selectedRoleIds = Array.isArray(draft.selectedRoleIds) ? draft.selectedRoleIds : [];
        const selectedRoles = (draft.selectedRoleIds || [])
          .map((roleId) => catalogRoles.find((role) => role.roleId === roleId) || { roleId })
          .filter((role) => role.roleId);
        const healthCounts = catalogRoles.reduce((counts, role) => {
          const key = getRoleHealthKey(role);
          counts[key] = (counts[key] || 0) + 1;
          return counts;
        }, { all: catalogRoles.length, ok: 0, warning: 0, error: 0, unknown: 0 });
        const healthFilters = [
          ["all", t("common.all", undefined, "all"), healthCounts.all],
          ["ok", t("projectWizard.roleHealthOk", undefined, "healthy"), healthCounts.ok],
          ["warning", t("projectWizard.roleHealthWarning", undefined, "warning"), healthCounts.warning],
          ["error", t("projectWizard.roleHealthError", undefined, "unhealthy"), healthCounts.error],
          ["unknown", t("projectWizard.roleHealthUnknown", undefined, "unknown"), healthCounts.unknown]
        ];
        const roleOptions = catalogRoles.length
          ? visibleCatalogRoles.map((role) => {
              const roleId = role.roleId || "";
              const imported = role.alreadyImported ? " · " + t("common.loaded", undefined, "loaded") : "";
              const health = " · " + getRoleHealthLabel(role);
              const checked = selectedRoleIds.includes(roleId) ? " checked" : "";
              return '<label class="event role-catalog-item"><input type="checkbox" name="roleIds" value="' + escapeText(roleId) + '"' + checked + '><span><strong>' + escapeText(role.name || roleId) + '</strong><span class="hint">' + escapeText(roleId + imported + health) + '</span></span></label>';
            }).join("")
          : '<div class="hint">' + escapeText(t("projectWizard.roleCatalogEmpty", undefined, "Installed role catalog is unavailable.")) + '</div>';
        const selectedSummary = selectedRoles.length
          ? selectedRoles.map((role) => role.name || role.roleId).join(", ")
          : t("projectWizard.roleCatalogSelectedEmpty", undefined, "No roles selected.");
        const selectedSummaryText = selectedRoles.length
          ? selectedRoles.map((role) => (role.name || role.roleId) + " (" + getRoleHealthLabel(role) + ")").join(", ")
          : selectedSummary;
        const error = state.projectCreateError
          ? '<div class="event"><div class="event-top"><span>' + escapeText(t("common.attention", undefined, "attention")) + '</span><span>' + escapeText(state.projectCreateError.code || "error") + '</span></div><strong>' + escapeText(state.projectCreateError.message || t("projectWizard.createFailed", undefined, "Project creation failed.")) + '</strong></div>'
          : "";
        const wizardStep = state.projectWizardStep || "location";
        const createPanelHtml = [
          '<div class="event"><div class="event-top"><span>' + escapeText(t("section.projectWizard", undefined, "Project Wizard")) + '</span><span>' + escapeText(conflict ? t("common.attention", undefined, "attention") : t("common.empty", undefined, "empty")) + '</span></div><strong>' +
            escapeText(conflict ? t("projectWizard.directoryConflictTitle", undefined, "Directory is not empty.") : t("projectWizard.emptyDirectoryTitle", undefined, "Start a new OGSystem project here.")) +
            '</strong><div class="hint">' + escapeText(conflict ? t("projectWizard.directoryConflictHint", undefined, "Initialize the current directory only if the existing files belong with this project, or load another project.") : t("projectWizard.emptyDirectoryHint", undefined, "No files are written until you confirm project creation.")) + '</div></div>',
          '<div class="event"><div class="event-top"><span>' + escapeText(t("projectWizard.pathSummary", undefined, "Path summary")) + '</span><span>' + escapeText(t("projectWizard.pathSummaryMode", { mode: conflict ? t("projectWizard.pathSummaryConflict", undefined, "conflict") : t("projectWizard.pathSummaryClean", undefined, "ready") }, conflict ? "conflict" : "ready")) + '</span></div><strong>' + escapeText(t("projectWizard.pathSummaryTitle", undefined, "Current and target workdir stay visible while you choose whether to create or load.")) + '</strong><div class="hint">' + escapeText(t("projectWizard.pathSummaryHint", undefined, "Use Open Project for another path. Load current project reuses the active directory; initialize current directory keeps the current path and writes new project files only when you confirm.")) + '</div></div>',
          error,
          '<form id="project-create-form" class="structure-list">',
          '<div class="event"><div class="event-top"><span>' + escapeText(t("projectWizard.stepLabel", undefined, "Step")) + '</span><span>' + escapeText(
            wizardStep === "location" ? t("projectWizard.step.location", undefined, "Location") :
              wizardStep === "details" ? t("projectWizard.step.details", undefined, "Details") :
                wizardStep === "structure" ? t("projectWizard.step.structure", undefined, "Structure") :
                  t("projectWizard.step.review", undefined, "Review")
          ) + '</span></div><strong>' + escapeText(t("projectWizard.flowTitle", undefined, "Create a project, then continue in Build.")) + '</strong><div class="hint">' +
            escapeText(
              wizardStep === "location"
                ? t("projectWizard.stepHint.location", undefined, "Confirm the target directory and initialization mode.")
                : wizardStep === "details"
                  ? t("projectWizard.stepHint.details", undefined, "Enter the project name, id, template, and defaults.")
                  : wizardStep === "structure"
                    ? t("projectWizard.stepHint.structure", undefined, "Optionally preselect installed roles or continue with a blank graph.")
                    : t("projectWizard.stepHint.review", undefined, "Review the configuration before project files are written.")
            ) + '</div></div>',
          wizardStep === "location" ? [
          '<label><span>' + escapeText(t("projectWizard.workdir", undefined, "Target directory")) + '</span><input name="workdir" value="' + escapeText(draft.workdir) + '" readonly="readonly"><span class="hint">' + escapeText(conflict ? t("projectWizard.workdirConflictHint", undefined, "This is the current visualizer directory and it already has files. Use Open Project to change directories.") : t("projectWizard.workdirHint", undefined, "This is the current visualizer directory. Use Open Project to change directories.")) + '</span></label>',
          conflict ? '<label><span>' + escapeText(t("projectWizard.conflictStrategy", undefined, "Conflict strategy")) + '</span><select name="conflictStrategy"><option value="reject"' + (draft.conflictStrategy !== "init-current" ? " selected" : "") + '>' + escapeText(t("projectWizard.chooseAnotherDirectory", undefined, "Open Project instead")) + '</option><option value="init-current"' + (draft.conflictStrategy === "init-current" ? " selected" : "") + '>' + escapeText(t("projectWizard.initCurrentDirectory", undefined, "Initialize current directory")) + '</option></select><span class="hint">' + escapeText(t("projectWizard.conflictStrategyHint", undefined, "Reject keeps the existing files untouched; initialize current directory only when this path is intentionally the project root.")) + '</span></label>' : '<input type="hidden" name="conflictStrategy" value="init-current">'
          ].join("") : "",
          wizardStep === "details" ? [
          '<label><span>' + escapeText(t("projectWizard.projectName", undefined, "Project name")) + '</span><input name="projectName" value="' + escapeText(draft.projectName) + '"></label>',
          '<label><span>' + escapeText(t("projectWizard.projectId", undefined, "Project id")) + '</span><input name="projectId" value="' + escapeText(draft.projectId) + '"></label>',
          '<label><span>' + escapeText(t("projectWizard.template", undefined, "Template")) + '</span><select name="templateId"><option value="empty"' + (draft.templateId === "empty" ? " selected" : "") + '>' + escapeText(t("projectWizard.template.empty", undefined, "Blank draft")) + '</option><option value="minimal"' + (draft.templateId === "minimal" ? " selected" : "") + '>' + escapeText(t("projectWizard.template.minimal", undefined, "Minimal runnable")) + '</option><option value="software-dev"' + (draft.templateId === "software-dev" ? " selected" : "") + '>software-dev</option><option value="consultation"' + (draft.templateId === "consultation" ? " selected" : "") + '>consultation</option></select></label>',
          '<div class="event"><div class="event-top"><span>' + escapeText(t("projectWizard.modelProfileSummary", undefined, "Model / profile strategy")) + '</span><span>' + escapeText(t("projectWizard.advanced", undefined, "advanced")) + '</span></div><strong>' +
            escapeText(t("projectWizard.modelProfileSummaryTitle", undefined, "Keep model and profile defaults out of the main path unless you need them now.")) + '</strong><div class="hint">' + escapeText(t("projectWizard.modelProfileSummaryHint", undefined, "Default model and profile settings stay available here, but Build inspector remains the preferred place to refine them after creation.")) + '</div></div>',
          '<label><span>' + escapeText(t("projectWizard.defaultModel", undefined, "Default model")) + '</span><input name="defaultModelRef" value="' + escapeText(draft.defaultModelRef) + '"><span class="hint">' + escapeText(t("projectWizard.defaultModelHint", undefined, "Optional provider/model reference for generated model-selection defaults.")) + '</span></label>',
          '<label><span>' + escapeText(t("projectWizard.profileStrategy", undefined, "Profile strategy")) + '</span><select name="profileStrategy"><option value="visual-editor"' + (draft.profileStrategy === "visual-editor" ? " selected" : "") + '>' + escapeText(t("projectWizard.profileStrategy.visualEditor", undefined, "Configure in visual role editor")) + '</option><option value="create-profile"' + (draft.profileStrategy === "create-profile" ? " selected" : "") + '>' + escapeText(t("projectWizard.profileStrategy.createProfile", undefined, "Create reusable execution profile")) + '</option></select></label>',
          '<label><span>' + escapeText(t("projectWizard.defaultProfileId", undefined, "Default profile id")) + '</span><input name="defaultProfileId" value="' + escapeText(draft.defaultProfileId) + '"></label>',
          '<label><span>' + escapeText(t("projectWizard.defaultToolRef", undefined, "Default tool")) + '</span><input name="defaultToolRef" value="' + escapeText(draft.defaultToolRef) + '"></label>'
          ].join("") : "",
          wizardStep === "structure" ? [
          '<div class="event"><div class="event-top"><span>' + escapeText(t("projectWizard.roleCatalog", undefined, "Installed roles")) + '</span><span>' + escapeText(String(catalogRoles.length)) + '</span></div><strong>' + escapeText(t("projectWizard.roleCatalogTitle", undefined, "Import role packages after project creation")) + '</strong><div class="hint">' + escapeText(t("projectWizard.roleCatalogCreateHint", undefined, "Selected roles are imported through the controlled role import API after the project is created.")) + '</div></div>',
          '<label><span>' + escapeText(t("projectWizard.roleCatalogSearch", undefined, "Search roles")) + '</span><input id="project-role-catalog-filter" value="' + escapeText(state.roleCatalogFilter) + '"><span class="hint">' + escapeText(t("projectWizard.roleCatalogSummary", { visible: String(visibleCatalogRoles.length), total: String(filteredCatalogRoles.length) }, "Showing " + String(visibleCatalogRoles.length) + " of " + String(filteredCatalogRoles.length))) + '</span></label>',
          '<div class="toolbar-row compact"><div class="toolbar-group"><label><span>' + escapeText(t("projectWizard.roleCatalogHealth", undefined, "Health")) + '</span><select id="project-role-health-filter">' +
            healthFilters.map(([value, label, count]) => '<option value="' + escapeText(value) + '"' + (state.roleCatalogHealthFilter === value ? " selected" : "") + '>' + escapeText(label + " (" + String(count) + ")") + '</option>').join("") +
          '</select></label></div><div class="toolbar-group"><label><span>' + escapeText(t("projectWizard.roleCatalogPageSize", undefined, "Page size")) + '</span><select id="project-role-page-size"><option value="12"' + (pageSize === 12 ? " selected" : "") + '>12</option><option value="24"' + (pageSize === 24 ? " selected" : "") + '>24</option><option value="48"' + (pageSize === 48 ? " selected" : "") + '>48</option></select></label></div><div class="toolbar-group"><span class="hint">' + escapeText(t("projectWizard.roleCatalogPagerSummary", { visible: String(visibleCatalogRoles.length), total: String(filteredCatalogRoles.length) }, String(visibleCatalogRoles.length) + " visible of " + String(filteredCatalogRoles.length))) + '</span><button class="button subtle" type="button" id="project-role-prev"' + (state.roleCatalogPage <= 0 ? " disabled" : "") + '>' + escapeText(t("common.previous", undefined, "Previous")) + '</button><span class="hint">' + escapeText(t("projectWizard.roleCatalogPage", { page: String(state.roleCatalogPage + 1), pages: String(pageCount) }, "Page " + String(state.roleCatalogPage + 1) + " of " + String(pageCount))) + '</span><button class="button subtle" type="button" id="project-role-next"' + (state.roleCatalogPage >= pageCount - 1 ? " disabled" : "") + '>' + escapeText(t("common.next", undefined, "Next")) + '</button></div></div>',
          '<div class="event"><div class="event-top"><span>' + escapeText(t("projectWizard.roleCatalogSelected", undefined, "Selected roles")) + '</span><span>' + escapeText(String(selectedRoles.length)) + '</span></div><strong>' + escapeText(selectedSummaryText) + '</strong><div class="hint">' + escapeText(t("projectWizard.roleCatalogSelectedHint", undefined, "Selections remain visible even when the catalog filter changes.")) + '</div></div>',
          '<div class="structure-list">' + roleOptions + '</div>',
          '<div class="event"><div class="event-top"><span>' + escapeText(t("projectWizard.nl2mmdOption", undefined, "nl2mmd")) + '</span><span>' + escapeText(t("common.ready", undefined, "ready")) + '</span></div><strong>' + escapeText(t("projectWizard.nl2mmdOptionHint", undefined, "You can create a blank project now and generate the base framework later in Build with Chat / Generate.")) + '</strong></div>'
          ].join("") : "",
          wizardStep === "review" ? [
          '<div class="event"><div class="event-top"><span>' + escapeText(t("projectWizard.reviewTitle", undefined, "Review")) + '</span><span>' + escapeText(draft.templateId || "empty") + '</span></div><strong>' + escapeText(draft.projectName || "my-ogs-project") + '</strong><div class="hint">' + escapeText([
            t("projectWizard.workdir", undefined, "Target directory") + ": " + (draft.workdir || ""),
            t("projectWizard.projectId", undefined, "Project id") + ": " + (draft.projectId || ""),
            t("projectWizard.roleCatalogSelected", undefined, "Selected roles") + ": " + String(selectedRoles.length)
          ].join(" · ")) + '</div></div>'
          ].join("") : "",
          '<div class="toolbar-row compact"><div class="toolbar-group">' +
            (wizardStep !== "location" ? '<button class="button subtle" type="button" id="project-wizard-back">' + escapeText(t("common.previous", undefined, "Previous")) + '</button>' : "") +
            (wizardStep !== "review" ? '<button class="button subtle" type="button" id="project-wizard-next">' + escapeText(t("common.next", undefined, "Next")) + '</button>' : "") +
            (wizardStep === "review" ? '<button class="button primary" type="submit">' + escapeText(t("projectWizard.createProject", undefined, "Create project")) + '</button>' : "") +
          '</div></div>',
          '</form>'
        ].join("");
        const mainHtml = [
          '<div class="project-home-layout">',
          '<div class="project-home-main structure-list">',
          '<div class="event"><div class="event-top"><span>' + escapeText(t("projectMenu.overview", undefined, "Overview")) + '</span><span>' + escapeText(t("workspace.notInitialized", undefined, "not initialized")) + '</span></div><strong>' + escapeText(t("workspace.projectUnavailableTitle", undefined, "This directory is not initialized as an OGSystem project.")) + '</strong><div class="hint">' + escapeText(t("workspace.createOrLoadHint", undefined, "Use Project to create a project in this directory or load an existing project.")) + '</div></div>',
          '<div class="event"><div class="event-top"><span>' + escapeText(t("projectWizard.step.location", undefined, "Location")) + '</span><span>' + escapeText(relativeToWorkdir(workspace.workdir || getCurrentWorkdir() || "")) + '</span></div><strong>' + escapeText(conflict ? t("projectWizard.directoryConflictTitle", undefined, "Directory is not empty.") : t("projectWizard.emptyDirectoryTitle", undefined, "Start a new OGSystem project here.")) + '</strong><div class="hint">' + escapeText(conflict ? t("projectWizard.directoryConflictHint", undefined, "Initialize the current directory only if the existing files belong with this project, or load another project.") : t("projectWizard.emptyDirectoryHint", undefined, "No files are written until you confirm project creation.")) + '</div></div>',
          '</div>',
          '<aside class="project-side-panel structure-list">' + createPanelHtml + '</aside>',
          '</div>'
        ].join("");
        projectWizardEl.innerHTML = menuHtml + (projectTab === "open"
          ? '<div class="project-home-layout"><div class="project-home-main structure-list">' + overviewHtml + '</div><aside class="project-side-panel structure-list">' + openPanelHtml + '</aside></div>'
          : projectTab === "recent"
            ? '<div class="project-home-layout"><div class="project-home-main structure-list">' + overviewHtml + '</div><aside class="project-side-panel structure-list">' + recentPanelHtml + '</aside></div>'
            : mainHtml);
        const form = document.getElementById("project-create-form");
        if (form) {
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            void createProjectFromWizard(new FormData(form));
          });
          for (const input of projectWizardEl.querySelectorAll("input, select")) {
            input.addEventListener("input", () => updateProjectWizardDraftFromForm(form));
            input.addEventListener("change", () => updateProjectWizardDraftFromForm(form));
          }
        }
        const wizardBackButton = document.getElementById("project-wizard-back");
        if (wizardBackButton) {
          wizardBackButton.addEventListener("click", () => {
            state.projectWizardStep =
              wizardStep === "details" ? "location" :
                wizardStep === "structure" ? "details" :
                  wizardStep === "review" ? "structure" :
                    "location";
            renderProjectWizard();
          });
        }
        const wizardNextButton = document.getElementById("project-wizard-next");
        if (wizardNextButton) {
          wizardNextButton.addEventListener("click", () => {
            updateProjectWizardDraftFromForm(form);
            state.projectWizardStep =
              wizardStep === "location" ? "details" :
                wizardStep === "details" ? "structure" :
                  "review";
            renderProjectWizard();
          });
        }
        const roleFilterInput = document.getElementById("project-role-catalog-filter");
        if (roleFilterInput) {
          roleFilterInput.addEventListener("input", (event) => {
            updateProjectWizardDraftFromForm(form);
            state.roleCatalogFilter = event.target.value || "";
            state.roleCatalogPage = 0;
            renderProjectWizard();
          });
        }
        const healthFilterSelect = document.getElementById("project-role-health-filter");
        if (healthFilterSelect) {
          healthFilterSelect.addEventListener("change", (event) => {
            updateProjectWizardDraftFromForm(form);
            state.roleCatalogHealthFilter = event.target.value || "all";
            state.roleCatalogPage = 0;
            renderProjectWizard();
          });
        }
        const pageSizeSelect = document.getElementById("project-role-page-size");
        if (pageSizeSelect) {
          pageSizeSelect.addEventListener("change", (event) => {
            updateProjectWizardDraftFromForm(form);
            state.roleCatalogPageSize = event.target.value === "12" || event.target.value === "24" || event.target.value === "48" ? Number(event.target.value) : 24;
            state.roleCatalogPage = 0;
            renderProjectWizard();
          });
        }
        const previousButton = document.getElementById("project-role-prev");
        if (previousButton) {
          previousButton.addEventListener("click", () => {
            updateProjectWizardDraftFromForm(form);
            state.roleCatalogPage = Math.max(0, state.roleCatalogPage - 1);
            renderProjectWizard();
          });
        }
        const nextButton = document.getElementById("project-role-next");
        if (nextButton) {
          nextButton.addEventListener("click", () => {
            updateProjectWizardDraftFromForm(form);
            state.roleCatalogPage += 1;
            renderProjectWizard();
          });
        }
        bindProjectMenuControls();
        return;
      }
      const newProjectUnavailableHtml = '<div class="event"><div class="event-top"><span>' + escapeText(t("projectMenu.new", undefined, "New Project")) + '</span><span>' + escapeText(t("common.loaded", undefined, "loaded")) + '</span></div><strong>' + escapeText(t("projectWizard.currentProjectLoaded", undefined, "A project is already loaded.")) + '</strong><div class="hint">' + escapeText(t("projectWizard.currentProjectLoadedHint", undefined, "Use Open Project to switch directories before creating another project.")) + '</div></div>';
      const settingsHtml = '<div class="event"><div class="event-top"><span>' + escapeText(t("projectMenu.settings", undefined, "Settings")) + '</span><span>' + escapeText(t("common.loaded", undefined, "loaded")) + '</span></div><strong>' + escapeText(t("projectWizard.settingsTitle", undefined, "Project settings are edited in Build inspectors.")) + '</strong><div class="hint">' + escapeText(t("projectWizard.settingsHint", undefined, "Model references, profiles, role package bindings, and graph structure stay in the visual Build workflow.")) + '</div></div>';
      const sidePanelHtml =
        projectTab === "open" ? openPanelHtml :
          projectTab === "recent" ? recentPanelHtml :
            projectTab === "new" ? newProjectUnavailableHtml :
              projectTab === "settings" ? settingsHtml :
                "";
      projectWizardEl.innerHTML = menuHtml + '<div class="project-home-layout"><div class="project-home-main structure-list">' + overviewHtml + '</div>' +
        (sidePanelHtml ? '<aside class="project-side-panel structure-list">' + sidePanelHtml + '</aside>' : "") +
        '</div>';
      bindProjectMenuControls();
    }

    function bindProjectMenuControls() {
      attachProjectWizardControls({
        root: projectWizardEl,
        getElementById: (id) => document.getElementById(id),
        onMenuTab: (tabId) => {
          state.projectMenuTab = tabId;
          state.projectPanelMode = projectPanelModeFromTab(tabId);
          if (tabId === "new" && !state.projectWizardStep) {
            state.projectWizardStep = "location";
          }
          renderProjectWizard();
          writeRouteToLocation();
        },
        onOpenDraftInput: (value) => {
          // Path edits only update the local draft; validation/browse/open stay explicit.
          state.projectOpenDraft = value;
          state.projectOpenValidation = null;
        },
        onRefreshBrowse: () => {
          void browseProjectOpen(getProjectOpenTarget());
        },
        onValidateBrowse: () => {
          void validateProjectOpen(getProjectOpenTarget(), { render: true });
        },
        onOpenSubmit: (target) => {
          void openValidatedProject(target || state.projectOpenDraft || "");
        },
        onBrowseSelect: (target) => {
          state.projectOpenDraft = target;
          void browseProjectOpen(target);
        },
        onProjectSelect: (target) => {
          state.projectOpenDraft = target;
          void validateProjectOpen(target, { render: true });
        },
        onRecentSelect: (target) => {
          state.projectOpenDraft = target;
          void validateProjectOpen(target, { render: true });
        },
        onCreateSubmit: (form) => {
          void createProjectFromWizard(new FormData(form));
        },
        onDraftFormChange: (form) => {
          updateProjectWizardDraftFromForm(form);
        },
        onRoleFilter: (value, form) => {
          if (form) {
            updateProjectWizardDraftFromForm(form);
          }
          // Role catalog search is a local filter against the already loaded catalog.
          state.roleCatalogFilter = value;
          state.roleCatalogPage = 0;
          renderProjectWizard();
        },
        onHealthFilter: (value, form) => {
          if (form) {
            updateProjectWizardDraftFromForm(form);
          }
          state.roleCatalogHealthFilter = value || "all";
          state.roleCatalogPage = 0;
          renderProjectWizard();
        },
        onPageSize: (value, form) => {
          if (form) {
            updateProjectWizardDraftFromForm(form);
          }
          state.roleCatalogPageSize = value === "12" || value === "24" || value === "48" ? Number(value) : 24;
          state.roleCatalogPage = 0;
          renderProjectWizard();
        },
        onPrevPage: (form) => {
          if (form) {
            updateProjectWizardDraftFromForm(form);
          }
          state.roleCatalogPage = Math.max(0, state.roleCatalogPage - 1);
          renderProjectWizard();
        },
        onNextPage: (form) => {
          if (form) {
            updateProjectWizardDraftFromForm(form);
          }
          state.roleCatalogPage += 1;
          renderProjectWizard();
        },
        autoBrowse: state.projectMenuTab === "open" && !state.projectOpenBrowse && !state.projectOpenLoading
          ? () => {
              void browseProjectOpen(getProjectOpenTarget(), { renderStart: false });
            }
          : undefined
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
      if (!detail || !header || state.projectHome) {
        selectedTitleEl.textContent = t("section.projectOverview");
        selectedSubtitleEl.textContent = t("project.overviewSubtitle", undefined, "Use query-state deep links or the run list to switch between project, run, and review details.");
      } else {
        const simulation = graphPayload?.simulation?.isSimulation ? "simulation" : "runtime";
        selectedTitleEl.textContent = graphPayload?.simulation?.isSimulation ? \`\${detail.runId} [simulation]\` : detail.runId;
        selectedSubtitleEl.textContent = state.selectedReviewId
          ? \`\${detail.runDir} · \${simulation} · review \${state.selectedReviewId}\`
          : \`\${detail.runDir} · \${simulation}\`;
      }
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
      const [summary, config, roles, opsSummary, readiness, bindings, contracts, rolePackages, templates] = await Promise.all([
        requestJson(\`\${API_PREFIX}/project\`),
        requestJson(\`\${API_PREFIX}/project/config\`),
        requestJson(\`\${API_PREFIX}/project/roles\`),
        requestJson(\`\${API_PREFIX}/project/ops-summary\`),
        requestJson(\`\${API_PREFIX}/project/readiness\`),
        requestJson(\`\${API_PREFIX}/project/bindings\`),
        requestJson(\`\${API_PREFIX}/project/contracts\`),
        requestJson(\`\${API_PREFIX}/project/role-packages\`),
        requestJson(\`\${API_PREFIX}/project/studio/templates\`).catch(() => ({ templates: [] }))
      ]);
      state.project = Object.assign({}, state.project || {}, { summary, config, roles });
      state.opsSummary = opsSummary;
      state.projectReadiness = readiness;
      state.bindings = bindings;
      state.contracts = contracts;
      state.rolePackages = rolePackages;
      state.studioTemplates = templates.templates || state.studioTemplates || [];
      renderProject();
    }

    async function refreshStudioBridge() {
      if (!state.hasProject) {
        return;
      }
      if (!state.workbenchSource && state.workbenchDiskSource) {
        state.workbenchSource = state.workbenchDiskSource;
      }
      if (!state.workbenchSource && state.workbench?.systemSource) {
        state.workbenchSource = state.workbench.systemSource;
      }
      const payload = await requestAction(\`\${API_PREFIX}/project/studio/bridge\`, {
        systemSource: state.workbenchSource,
        systemPath: state.workbenchSavedPath || "system.mmd"
      });
      state.studioBridge = payload;
      state.studioCanvas = buildStudioCanvasFromBridge(payload);
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
      renderWorkbench({ preserveStudioGraphRoot: true });
      renderProject();
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

    async function loadWorkbench() {
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
      }, { returnFocusEl: startRunButton });
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

    async function rebindProject(target) {
      if (!target) {
        setFlash("error", t("projectOpen.workdirRequired", undefined, "Choose a project directory before loading."));
        return;
      }
      await runAction("project:load", async () => {
        const payload = await requestAction(\`\${API_PREFIX}/project/load\`, { workdir: target });
        rememberRecentProject(payload.workdir || target);
        state.projectOpenDraft = payload.workdir || target;
        state.projectMenuTab = "overview";
        closeActionForm();
        setFlash("success", t("projectOpen.projectLoaded", { workdir: payload.workdir }, "Project loaded from {workdir}."));
        setSidebarOpen(false);
        await loadProject();
        await loadRuns();
        selectProjectHome();
      });
    }

    function getProjectOpenTarget() {
      return String(document.getElementById("project-open-workdir")?.value || state.projectOpenDraft || "").trim();
    }

    async function browseProjectOpen(target, options) {
      const workdir = String(target || "").trim() || getCurrentWorkdir() || ".";
      state.projectOpenDraft = workdir;
      state.projectOpenLoading = true;
      state.projectOpenError = "";
      if (options?.renderStart !== false) {
        renderProjectWizard();
      }
      try {
        const params = new URLSearchParams({ workdir });
        const payload = await requestJson(\`\${API_PREFIX}/project/browse?\${params.toString()}\`);
        state.projectOpenBrowse = payload;
        state.projectOpenValidation = payload;
        state.projectOpenDraft = payload?.workdir || workdir;
      } catch (error) {
        state.projectOpenError = error instanceof Error ? error.message : String(error);
      } finally {
        state.projectOpenLoading = false;
        renderProjectWizard();
      }
    }

    async function validateProjectOpen(target, options) {
      const workdir = String(target || "").trim();
      if (!workdir) {
        state.projectOpenValidation = null;
        setFlash("error", t("projectOpen.workdirRequired", undefined, "Choose a project directory before loading."));
        if (options?.render) {
          renderProjectWizard();
        }
        return null;
      }
      state.projectOpenDraft = workdir;
      state.projectOpenLoading = true;
      state.projectOpenError = "";
      if (options?.render) {
        renderProjectWizard();
      }
      try {
        const payload = await requestAction(\`\${API_PREFIX}/project/validate-open\`, { workdir });
        state.projectOpenValidation = payload;
        state.projectOpenDraft = payload?.workdir || workdir;
        return payload;
      } catch (error) {
        state.projectOpenError = error instanceof Error ? error.message : String(error);
        return null;
      } finally {
        state.projectOpenLoading = false;
        if (options?.render) {
          renderProjectWizard();
        }
      }
    }

    async function openValidatedProject(target) {
      const validation = await validateProjectOpen(target, { render: true });
      if (!validation) {
        return;
      }
      if (!validation.isProject) {
        setFlash("error", projectOpenMessageFromResponse(validation).message || t("projectOpen.notOpenable", undefined, "Select a valid OGSystem project directory before opening."));
        return;
      }
      await rebindProject(validation.workdir || target);
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
        state.hasProject = state.workspace?.hasProject === true;
        if (state.projectOpenDraft && state.projectOpenDraft !== state.workspace?.workdir) {
          state.projectOpenBrowse = null;
          state.projectOpenValidation = null;
        }
        state.projectOpenDraft = state.workspace?.workdir || state.projectOpenDraft || "";
        state.projectOpenError = "";
        state.projectOpenLoading = false;
        if (!state.hasProject) {
          await loadRoleCatalog();
          state.project = null;
          state.opsSummary = null;
          state.projectReadiness = null;
          state.bindings = null;
          state.contracts = null;
          state.rolePackages = null;
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
        const [summary, system, config, roles, opsSummary, readiness, bindings, contracts, rolePackages, templates] = await Promise.all([
          requestJson(\`\${API_PREFIX}/project\`),
          requestJson(\`\${API_PREFIX}/project/system\`),
          requestJson(\`\${API_PREFIX}/project/config\`),
          requestJson(\`\${API_PREFIX}/project/roles\`),
          requestJson(\`\${API_PREFIX}/project/ops-summary\`),
          requestJson(\`\${API_PREFIX}/project/readiness\`),
          requestJson(\`\${API_PREFIX}/project/bindings\`),
          requestJson(\`\${API_PREFIX}/project/contracts\`),
          requestJson(\`\${API_PREFIX}/project/role-packages\`),
          requestJson(\`\${API_PREFIX}/project/studio/templates\`).catch(() => ({ templates: [] }))
        ]);
        state.project = { summary, system, config, roles };
        state.opsSummary = opsSummary;
        state.projectReadiness = readiness;
        state.bindings = bindings;
        state.contracts = contracts;
        state.rolePackages = rolePackages;
        state.studioTemplates = templates.templates || [];
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

    async function loadRoleCatalog() {
      try {
        state.roleCatalog = await requestJson(API_PREFIX + "/project/role-catalog");
      } catch {
        state.roleCatalog = { source: "installed", roles: [] };
      }
    }

    async function importProjectRoles(roleIds, options) {
      const selectedRoleIds = Array.from(new Set((roleIds || []).map((value) => String(value || "").trim()).filter(Boolean)));
      if (!selectedRoleIds.length) {
        return null;
      }
      let payload;
      try {
        payload = await requestAction(API_PREFIX + "/project/roles/import", {
          source: "installed",
          roleIds: selectedRoleIds
        });
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { roleImportFailed: true });
      }
      state.pendingRoleImportRetry = null;
      if (payload.roleCatalog) {
        state.roleCatalog = payload.roleCatalog;
      } else {
        await loadRoleCatalog();
      }
      try {
        await refreshProjectDiagnostics();
      } catch (error) {
        if (!options?.silent) {
          setFlash("warning", t("projectWizard.postImportRefreshWarning", undefined, "Roles were imported, but project diagnostics need a refresh."));
        }
      }
      if (!options?.silent) {
        const imported = (payload.importedRoleIds || []).length;
        const skipped = (payload.skippedRoleIds || []).length;
        setFlash("success", t("projectWizard.roleImportSuccess", { imported: String(imported), skipped: String(skipped) }, "Role import completed."));
      }
      return payload;
    }

    async function retryPendingRoleImport() {
      const retry = state.pendingRoleImportRetry;
      if (!retry?.roleIds?.length) {
        return;
      }
      await runAction("project:retry-role-import", async () => {
        try {
          await importProjectRoles(retry.roleIds);
        } catch (error) {
          setFlash("warning", t("projectWizard.roleImportRetryWarning", undefined, "Role import still needs attention. Check the installed role catalog and retry."), { action: "retry-role-import" });
        }
      });
    }

    async function createProjectFromWizard(formData) {
      const draft = updateProjectWizardDraftFromForm(document.getElementById("project-create-form"));
      const selectedRoleIds = draft.selectedRoleIds || (typeof formData.getAll === "function"
        ? formData.getAll("roleIds").map((value) => String(value || "")).filter(Boolean)
        : []);
      const defaultModelRef = String(draft.defaultModelRef || "").trim();
      const profileStrategy = String(draft.profileStrategy || "visual-editor");
      const defaultProfileId = String(draft.defaultProfileId || "").trim();
      const defaultToolRef = String(draft.defaultToolRef || "").trim();
      const modelProfileStrategy = {
        mode: profileStrategy,
        ...(defaultModelRef ? { modelDefaults: { model: defaultModelRef } } : {}),
        ...(profileStrategy === "create-profile" && defaultProfileId && defaultToolRef
          ? { profiles: [{ profileId: defaultProfileId, toolRef: defaultToolRef }] }
          : {})
      };
      const body = {
        requestId: state.projectCreateRequestId || ("project-create-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)),
        workdir: String(draft.workdir || "").trim(),
        projectName: String(draft.projectName || ""),
        projectId: String(draft.projectId || ""),
        templateId: String(draft.templateId || "empty"),
        conflictStrategy: String(draft.conflictStrategy || "reject"),
        authoringDefaults: {
          newRole: {
            bindingKind: defaultModelRef ? "model" : "noop",
            ...(defaultModelRef ? { modelRef: defaultModelRef } : {})
          }
        },
        modelProfileStrategy
      };
      state.projectCreateRequestId = body.requestId;
      state.projectCreateError = null;
      await runAction("project:create", async () => {
        try {
          await requestAction(API_PREFIX + "/project/create", body);
        } catch (error) {
          const { code, message } = projectCreateErrorFromResponse(error);
          state.projectCreateError = {
            code,
            message
          };
          renderProject();
          throw error;
        }
        state.projectCreateRequestId = "";
        state.projectCreateError = null;
        state.projectWizardDraft = null;
        state.consoleTab = "build";
        state.workbenchView = "bridge";
        state.hasProject = true;
        let postCreateWarning = "";
        try {
          await loadProject();
          await loadRuns();
          renderConsoleTabs();
          renderWorkbench();
        } catch (error) {
          postCreateWarning = t("projectWizard.studioBridgeRefreshWarning", undefined, "Project was created, but the graph workspace needs a refresh. Use Build refresh if the graph is not visible.");
        }
        if (selectedRoleIds.length) {
          try {
            await importProjectRoles(selectedRoleIds, { silent: true });
          } catch (error) {
            if (error?.roleImportFailed) {
              state.pendingRoleImportRetry = { roleIds: selectedRoleIds };
              postCreateWarning = postCreateWarning || t("projectWizard.roleImportWarning", undefined, "Project was created, but selected roles could not be imported. Use Project to retry role import.");
            } else {
              postCreateWarning = postCreateWarning || t("projectWizard.postImportRefreshWarning", undefined, "Roles were imported, but project diagnostics need a refresh.");
            }
          }
        }
        try {
          await refreshStudioBridge();
        } catch (error) {
          state.studioBridgeStale = true;
          try {
            await loadWorkbench();
          } catch {
            // keep the created project usable even if the bridge refresh is temporarily unavailable
          }
          renderWorkbench();
          postCreateWarning = postCreateWarning || t("projectWizard.studioBridgeRefreshWarning", undefined, "Project was created, but the graph workspace needs a refresh. Use Build refresh if the graph is not visible.");
        }
        setFlash(
          postCreateWarning ? "warning" : "success",
          postCreateWarning || t("projectWizard.createSuccess", undefined, "Project created. Continue in Build."),
          state.pendingRoleImportRetry ? { action: "retry-role-import" } : undefined
        );
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
    projectExportButton.addEventListener("click", async () => {
      await exportProject();
    });
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

    startRunButton.addEventListener("click", async () => {
      if (state.consoleTab === "build") {
        await prepareDryRunFromBuild();
      }
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
    if (["overview", "new", "open", "recent", "settings"].includes(initialRoute.projectTab)) {
      state.projectMenuTab = initialRoute.projectTab;
    }
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
      projectSummaryEl.textContent = t("state.projectLoadFailed", {
        message
      }, "Failed to load project: " + message);
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
