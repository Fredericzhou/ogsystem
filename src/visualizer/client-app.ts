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
  sortStudioBridgeRolesTopologically,
  filterStudioBridgeItems,
  sortStudioBridgeFlowsByTopology,
  renderSuggestedNextChecksPanel,
  renderRunTopologySvg,
  renderWorkbenchTopologySvg,
  statusTone
} from "./client-renderers.js";
import { getDictionary, type Dictionary, type Locale } from "./i18n/index.js";

type RouteState = {
  view: string;
  lifecycle: string;
  runId: string;
  reviewId: string;
  logRoleId: string;
  tail: string;
  since: string;
};

type ReleaseReadinessDecision = {
  canExport: boolean;
  blockers: Array<{ code: string; message: string }>;
};

type StreamRefreshPlan = {
  detailGraph: boolean;
  reviews: boolean;
  reviewDetail: boolean;
  failure: boolean;
  resumeReadiness: boolean;
  markDiagnosticsStale: boolean;
};

export type ClientI18nOptions = {
  locale?: Locale;
  messages?: Dictionary;
  messagesByLocale?: Partial<Record<Locale, Dictionary>>;
};

export function readRouteStateFromSearch(search: string): RouteState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    view: params.get("view") || "",
    lifecycle: params.get("lifecycle") || "",
    runId: params.get("runId") || "",
    reviewId: params.get("reviewId") || "",
    logRoleId: params.get("logRoleId") || "",
    tail: params.get("tail") || "",
    since: params.get("since") || ""
  };
}

export function normalizeLifecycleView(lifecycle: string | undefined, legacyView: string | undefined): string {
  switch (lifecycle) {
    case "project":
    case "build":
    case "validate-release":
    case "operate":
    case "legacy":
      return lifecycle;
    default:
      return legacyView === "project" ? "project" : "operate";
  }
}

export function buildRouteSearch(args: {
  lifecycle?: string;
  projectHome: boolean;
  selectedRunId: string;
  selectedReviewId: string;
  selectedLogRoleId: string;
  logTail: string;
  logSince: string;
}): string {
  const params = new URLSearchParams();
  const lifecycle = args.lifecycle || "";
  if (lifecycle) {
    params.set("lifecycle", lifecycle);
  }
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

function listFromRecord(value: unknown, keys: string[]): Record<string, unknown>[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
    }
  }
  return [];
}

export function buildReleaseReadinessDecision(args: {
  validation: Record<string, unknown> | null | undefined;
  readiness: Record<string, unknown> | null | undefined;
  bindings: Record<string, unknown> | null | undefined;
  rolePackages: Record<string, unknown> | null | undefined;
  contracts: Record<string, unknown> | null | undefined;
  workbenchDirty: boolean;
}): ReleaseReadinessDecision {
  const blockers: ReleaseReadinessDecision["blockers"] = [];
  if (args.workbenchDirty) {
    blockers.push({ code: "RELEASE_DIRTY_WORKBENCH", message: "Unsaved Build changes must be saved before export." });
  }
  if (args.validation?.ok !== true) {
    blockers.push({ code: "RELEASE_VALIDATION_FAILED", message: "Mermaid validation must pass before export." });
  }
  const readinessBlockers = listFromRecord(args.readiness, ["blockers"]);
  for (const blocker of readinessBlockers) {
    blockers.push({
      code: String(blocker.code ?? "RELEASE_READINESS_BLOCKER"),
      message: String(blocker.message ?? "Release readiness blocker remains.")
    });
  }
  const coverage = (args.readiness?.contractCoverage ?? {}) as Record<string, unknown>;
  const missingContracts = Number(coverage.missingCount ?? coverage.missingFlowCount ?? 0);
  if (Number.isFinite(missingContracts) && missingContracts > 0) {
    blockers.push({
      code: "RELEASE_CONTRACT_COVERAGE_MISSING",
      message: String(missingContracts) + " required contract(s) are missing."
    });
  }
  const contractFlows = listFromRecord(args.contracts, ["flows", "contracts", "entries"]);
  const uncoveredEdges = listFromRecord(args.contracts, ["uncoveredEdges"]);
  const missingContractFlows = contractFlows.filter((contract) =>
    contract.lastStatus === "missing" || contract.contractId === null || contract.schemaPath === null
  );
  if (uncoveredEdges.length || missingContractFlows.length) {
    blockers.push({
      code: "RELEASE_ARTIFACT_CONTRACT_INCOMPLETE",
      message: "Artifact contract coverage is incomplete."
    });
  }
  const bindings = listFromRecord(args.bindings, ["roles", "bindings", "entries"]);
  const unresolvedBindings = bindings.filter((binding) =>
    binding.resolved === false || (!binding.resolvedBinding && !binding.effectiveBinding)
  );
  if (unresolvedBindings.length) {
    blockers.push({
      code: "RELEASE_BINDINGS_UNRESOLVED",
      message: String(unresolvedBindings.length) + " role binding(s) are unresolved."
    });
  }
  const rolePackages = listFromRecord(args.rolePackages, ["roles", "rolePackages", "entries"]);
  const unhealthyRolePackages = rolePackages.filter((role) => {
    if (role.status && role.status !== "ok") {
      return true;
    }
    const files = (role.files ?? role.health ?? {}) as Record<string, unknown>;
    return Object.values(files).some((present) => present === false);
  });
  if (unhealthyRolePackages.length) {
    blockers.push({
      code: "RELEASE_ROLE_PACKAGES_UNHEALTHY",
      message: String(unhealthyRolePackages.length) + " role package(s) are unhealthy."
    });
  }
  return {
    canExport: blockers.length === 0,
    blockers
  };
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
    const appendStreamEntry = ${appendStreamEntry.toString()};
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
    const state = {
      locale: resolvedLocale,
      project: null,
      opsSummary: null,
      projectReadiness: null,
      consoleTab: "operate",
      legacyConsoleTab: "debug",
      workbench: null,
      buildMode: "edit",
      workbenchView: "bridge",
      workbenchSource: "",
      workbenchDiskSource: "",
      workbenchSavedPath: "system.mmd",
      workbenchHasDraft: false,
      workbenchValidationTimer: null,
      workbenchValidationRequestId: 0,
      workbenchValidating: false,
      studioBridge: null,
      studioCanvas: null,
      studioBridgeLoaded: false,
      studioBridgeStale: false,
      studioBridgeSelectedRoleId: "",
      studioBridgeSelectedFlowKey: "",
      studioBridgeFilter: "",
      studioBridgeListMode: "all",
      studioBridgeFullscreen: false,
      studioBridgeEditSelectionRequest: 0,
      studioBridgeLastDryRunId: "",
      studioTemplates: [],
      runGraphSelectedRoleId: "",
      runGraphSelectedFlowKey: "",
      operateTab: "overview",
      sidebarOpen: false,
      runs: [],
      filter: "",
      projectHome: false,
      selectedRunId: "",
      selectedReviewId: "",
      selectedLogRoleId: "",
      logTail: "",
      logPageSize: "100",
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
    const actionFormSectionEl = document.getElementById("action-form-section");
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
    const projectWizardLoadButton = document.getElementById("project-wizard-load");
    const projectLoadButton = document.getElementById("project-load");
    const projectExportButton = document.getElementById("project-export");
    const releaseExportButton = document.getElementById("release-export");
    const reindexButton = document.getElementById("reindex");
    const startRunButton = document.getElementById("start-run");
    const resumeRunButton = document.getElementById("resume-run");
    const stopRunButton = document.getElementById("stop-run");
    const refreshButton = document.getElementById("refresh");
    const localeSelectEl = document.getElementById("locale-select");

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
        [projectLoadButton, "action.loadProject"],
        [projectExportButton, "action.exportProject"],
        [releaseExportButton, "action.exportProject"],
        [reindexButton, "action.reindex"],
        [startRunButton, "action.startRun"],
        [resumeRunButton, "action.resumeSelected"],
        [stopRunButton, "action.requestStop"],
        [refreshButton, "action.refresh"],
        [timelineApplyButton, "action.applyFilters"],
        [timelineClearButton, "action.clearFilters"],
        [projectWizardLoadButton, "action.loadProject"]
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
      liveEl.textContent = displayUiToken(label, t);
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

    function buildLogsQuery(runId, extra) {
      const params = new URLSearchParams();
      if (extra.engine) {
        params.set("engine", "true");
      }
      if (extra.roleId) {
        params.set("roleId", extra.roleId);
      }
      const effectiveTail = state.logTail || state.logPageSize;
      if (effectiveTail) {
        params.set("tail", effectiveTail);
      }
      if (state.logSince) {
        const normalized = state.logSince.includes(":") && state.logSince.length === 16
          ? new Date(state.logSince).toISOString()
          : state.logSince;
        params.set("since", normalized);
      }
      return API_PREFIX + "/runs/" + encodeURIComponent(runId) + "/logs?" + params.toString();
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
          label: flow.eventType,
          eventType: flow.eventType,
          runtimeOnlyErrorFlow: Boolean(flow.runtimeOnlyErrorFlow),
          participatesInJoin: Boolean(flow.participatesInJoin)
        })),
        viewport: authoring?.layout?.viewport
      };
    }

    function buildStudioGraphLabels() {
      return {
        zoomOut: t("studio.graph.zoomOut", undefined, "Zoom out"),
        zoomIn: t("studio.graph.zoomIn", undefined, "Zoom in"),
        resetView: t("studio.graph.resetView", undefined, "Actual size"),
        fullscreen: state.studioBridgeFullscreen
          ? t("action.exitFullscreen", undefined, "Exit fullscreen")
          : t("action.fullscreen", undefined, "Fullscreen"),
        fitView: t("studio.graph.fitView", undefined, "Fit view"),
        autoLayout: t("studio.graph.autoLayout", undefined, "Auto layout"),
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
        const flowId = String(edge?.flowId || "run-flow-" + index);
        authoringFlows[flowId] = {
          flowId,
          fromRoleId: source,
          toRoleId: target,
          eventType,
          runtimeOnlyErrorFlow: Boolean(edge?.isErrorFlow || edge?.runtimeOnlyErrorFlow)
        };
        return {
          id: flowId,
          source,
          target,
          label: eventType,
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
      if (state.workbench) {
        renderWorkbench({
          preserveEditor: true,
          preserveStudioGraphRoot: state.workbenchView === "bridge"
        });
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

    function renderActionState() {
      const disabled = Boolean(state.actionBusy);
      const stopDisabled = disabled || !canRequestStop();
      projectHomeButton.disabled = disabled;
      projectLoadButton.disabled = disabled;
      projectExportButton.disabled = disabled;
      if (releaseExportButton) releaseExportButton.disabled = disabled;
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
      if (!showOperateWorkspace) {
        operateTabsEl.innerHTML = "";
        return;
      }
      const tabs = [
        ["overview", t("operate.tab.overview", undefined, "Overview"), t("operate.tabHint.overview", undefined, "Run status, summary, and timeline")],
        ["graph", t("operate.tab.graph", undefined, "Graph"), t("operate.tabHint.graph", undefined, "Readonly runtime graph and state")],
        ["recovery", t("operate.tab.recovery", undefined, "Recovery"), t("operate.tabHint.recovery", undefined, "Failure triage and resume readiness")],
        ["logs", t("operate.tab.logs", undefined, "Logs"), t("operate.tabHint.logs", undefined, "Load engine and role logs on demand")],
        ["reviews", t("operate.tab.reviews", undefined, "Reviews"), t("operate.tabHint.reviews", undefined, "Human review queue and decisions")],
        ["artifacts", t("operate.tab.artifacts", undefined, "Artifacts"), t("operate.tabHint.artifacts", undefined, "Run snapshots and exported evidence")]
      ];
      operateTabsEl.innerHTML = tabs.map(([id, label, hint]) =>
        '<button class="button subtle ' + (state.operateTab === id ? "active" : "") +
        '" data-operate-tab="' + escapeText(id) +
        '" title="' + escapeText(hint) +
        '">' + escapeText(label) + '</button>'
      ).join("");
      for (const button of operateTabsEl.querySelectorAll("[data-operate-tab]")) {
        button.disabled = Boolean(state.actionBusy);
        button.addEventListener("click", () => {
          state.operateTab = button.getAttribute("data-operate-tab") || "overview";
          renderOperateTabs();
          renderActionState();
        });
      }
    }

    function renderHeroActions() {
      const isBuild = state.consoleTab === "build";
      const isOperate = state.consoleTab === "operate" || state.consoleTab === "legacy";
      const isProject = state.consoleTab === "project";
      if (startRunButton) {
        startRunButton.hidden = !isBuild;
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
      if (projectLoadButton) {
        projectLoadButton.hidden = !isProject;
      }
      if (projectExportButton) {
        projectExportButton.hidden = state.consoleTab !== "validate-release";
      }
    }

    function renderConsoleTabs() {
      if (!consoleTabsEl) {
        return;
      }
      const lifecycleTabs = [
        ["project", t("nav.lifecycle.project", undefined, "Project"), t("navHint.lifecycle.project", undefined, "Create, load, and inspect project context")],
        ["build", t("nav.lifecycle.build", undefined, "Build"), t("navHint.lifecycle.build", undefined, "Graph-first authoring, configuration, and dry-run setup")],
        ["validate-release", t("nav.lifecycle.validateRelease", undefined, "Validate & Release"), t("navHint.lifecycle.validateRelease", undefined, "Validation gate, readiness, reports, and export")],
        ["operate", t("nav.lifecycle.operate", undefined, "Operate"), t("navHint.lifecycle.operate", undefined, "Run monitoring, diagnostics, logs, recovery, and audit")]
      ];
      if (state.consoleTab === "legacy") {
        lifecycleTabs.push(["legacy", t("nav.lifecycle.legacy", undefined, "Legacy fallback"), t("navHint.lifecycle.legacy", undefined, "Developer fallback access to the previous tab layout")]);
      }
      const legacyTabs = [
        ["debug", t("nav.runDebug"), t("navHint.runDebug")],
        ["project", t("nav.project"), t("navHint.project")],
        ["ops", t("nav.ops"), t("navHint.ops")],
        ["config", t("nav.config"), t("navHint.config")],
        ["logs", t("nav.logs"), t("navHint.logs")],
        ["artifacts", t("nav.artifacts"), t("navHint.artifacts")]
      ];
      const lifecycleHtml = lifecycleTabs.map(([id, label, hint]) =>
        '<button class="button subtle ' + (state.consoleTab === id ? "active" : "") +
        '" data-console-tab="' + escapeText(id) +
        '" title="' + escapeText(hint) +
        '">' + escapeText(label) + '</button>'
      ).join("");
      const legacyHtml = state.consoleTab === "legacy"
        ? '<div class="legacy-tabs" data-legacy-tabs>' + legacyTabs.map(([id, label, hint]) =>
            '<button class="button subtle ' + (state.legacyConsoleTab === id ? "active" : "") +
            '" data-legacy-console-tab="' + escapeText(id) +
            '" title="' + escapeText(hint) +
            '">' + escapeText(label) + '</button>'
          ).join("") + '</div>'
        : "";
      consoleTabsEl.innerHTML = lifecycleHtml + legacyHtml;
      const visiblePanelIds = new Set(
        state.consoleTab === "legacy"
          ? [state.legacyConsoleTab || "debug"]
          : state.consoleTab === "project"
            ? ["project"]
            : state.consoleTab === "build"
              ? ["build"]
              : state.consoleTab === "validate-release"
                ? ["validate-release"]
                : ["ops", "debug", "logs", "artifacts"]
      );
      const showRunSidebar = state.consoleTab === "operate" || state.consoleTab === "legacy";
      document.body.classList.toggle("show-run-sidebar", showRunSidebar);
      if (!showRunSidebar) {
        setSidebarOpen(false);
      }
      if (sidebarToggleButton) {
        sidebarToggleButton.hidden = !showRunSidebar;
      }
      for (const id of ["project", "build", "debug", "ops", "config", "logs", "artifacts", "validate-release"]) {
        const panel = document.getElementById("console-panel-" + id);
        if (panel) {
          panel.hidden = !visiblePanelIds.has(id);
        }
      }
      renderOperateTabs();
      renderHeroActions();
      for (const button of consoleTabsEl.querySelectorAll("[data-console-tab]")) {
        button.addEventListener("click", () => {
          state.consoleTab = button.getAttribute("data-console-tab") || "operate";
          state.projectHome = state.consoleTab === "project";
          if (state.consoleTab === "build") {
            state.workbenchView = "bridge";
            void refreshStudioBridge().catch((error) => {
              setFlash("error", "Studio Bridge refresh failed: " + (error.message || error));
            });
          }
          renderConsoleTabs();
          renderSelectedRun();
          renderActionState();
          writeRouteToLocation();
        });
      }
      for (const button of consoleTabsEl.querySelectorAll("[data-legacy-console-tab]")) {
        button.addEventListener("click", () => {
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
      if (!structure) {
        return '<div class="hint">' + escapeText(t("workbench.structurePending")) + '</div>';
      }
      return [
        '<div class="structure-list">',
        '<div class="event"><div class="event-top"><span>' + escapeText(t("common.system")) + '</span><span>' + escapeText(structure.systemVersion || "n/a") + '</span></div><strong>' + escapeText(structure.systemId || t("common.unknown")) + '</strong><div class="hint">' + escapeText(t("common.entry")) + ' ' + escapeText(structure.entryRoleId || "n/a") + ' · ' + escapeText(t("common.roles")) + ' ' + escapeText(structure.roleCount || 0) + ' · ' + escapeText(t("studio.flows")) + ' ' + escapeText(structure.flowCount || 0) + '</div></div>',
        ...(structure.roles || []).map((role) =>
          '<div class="event"><div class="event-top"><span><code>' + escapeText(role.roleId) + '</code></span><span>' + escapeText(role.bindingKind) + '</span></div><strong>'
          + escapeText(role.reviewMode || role.joinMode || role.routingMode || t("project.standardRole"))
          + '</strong><div class="hint">'
          + escapeText([role.routingMode ? t("common.route") + " " + role.routingMode : "", role.joinMode ? t("common.join") + " " + role.joinMode : "", role.reviewMode ? t("common.review") + " " + role.reviewMode : ""].filter(Boolean).join(" · ") || t("project.noSpecialGraphMetadata"))
          + '</div></div>'
        ),
        ...(structure.flows || []).map((flow) =>
          '<div class="event"><div class="event-top"><span><code>' + escapeText(flow.fromRoleId) + '</code> -> <code>' + escapeText(flow.toRoleId) + '</code></span><span>' + escapeText(t("common.flow")) + '</span></div><strong>' + escapeText(flow.eventType) + '</strong></div>'
        ),
        '</div>'
      ].join("");
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
      bindStudioBridgeControls();
      mountStudioGraphIsland();
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
      for (const button of workbenchBodyEl.querySelectorAll("[data-studio-role-id]")) {
        button.addEventListener("click", () => {
          state.studioBridgeSelectedRoleId = button.getAttribute("data-studio-role-id") || "";
          state.studioBridgeSelectedFlowKey = "";
          state.studioBridgeEditSelectionRequest += 1;
          updateStudioBridgeSelection(true);
        });
      }
      for (const button of workbenchBodyEl.querySelectorAll("[data-studio-flow-key]")) {
        button.addEventListener("click", () => {
          state.studioBridgeSelectedFlowKey = button.getAttribute("data-studio-flow-key") || "";
          state.studioBridgeSelectedRoleId = "";
          state.studioBridgeEditSelectionRequest += 1;
          updateStudioBridgeSelection(true);
        });
      }
      const filterInput = findStudioBridgeElement("[data-studio-bridge-filter]");
      if (filterInput) {
        filterInput.addEventListener("input", (event) => {
          state.studioBridgeFilter = event.target.value || "";
          renderStudioBridge({ preserveGraphRoot: true });
        });
      }
      const listModeSelect = findStudioBridgeElement("[data-studio-bridge-list-mode]");
      if (listModeSelect) {
        listModeSelect.addEventListener("change", (event) => {
          const value = event.target.value || "all";
          state.studioBridgeListMode = value === "roles" || value === "flows" ? value : "all";
          renderStudioBridge({ preserveGraphRoot: true });
        });
      }
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

    function findStudioBridgeElement(selector) {
      if (typeof workbenchBodyEl.querySelector === "function") {
        return workbenchBodyEl.querySelector(selector);
      }
      if (typeof workbenchBodyEl.querySelectorAll === "function") {
        return workbenchBodyEl.querySelectorAll(selector)[0] || null;
      }
      return null;
    }

    if (typeof document.addEventListener === "function") {
      document.addEventListener("keydown", (event) => {
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
        onToggleFullscreen: () => {
          state.studioBridgeFullscreen = !state.studioBridgeFullscreen;
          renderStudioBridge({ preserveGraphRoot: true });
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
      const statusPills = [
        '<span class="pill' + (dirty ? " warn" : "") + '">' + escapeText(dirty ? t("workbench.unsavedChanges") : t("workbench.diskInSync")) + '</span>',
        state.workbenchHasDraft ? '<span class="pill warn">' + escapeText(t("workbench.draftCached")) + '</span>' : "",
        validation
          ? '<span class="pill' + (validation.ok ? "" : " warn") + '">' + escapeText(validation.ok ? t("workbench.validationOk") : t("workbench.diagnostics", { count: diagnostics.length })) + '</span>'
          : '<span class="pill">' + escapeText(t("workbench.validationPending")) + '</span>',
        state.workbenchValidating ? '<span class="pill warn">' + escapeText(t("workbench.validating")) + '</span>' : ""
      ].filter(Boolean);
      workbenchStatusEl.innerHTML = statusPills.join("");
      workbenchTabsEl.innerHTML = [
        '<button class="button subtle ' + (state.buildMode === "edit" ? "active" : "") + '" data-build-mode="edit">' + escapeText(t("build.mode.edit", undefined, "Edit")) + '</button>',
        '<button class="button subtle ' + (state.buildMode === "dry-run" ? "active" : "") + '" data-build-mode="dry-run">' + escapeText(t("build.mode.dryRun", undefined, "Dry Run")) + '</button>',
        '<button class="button subtle ' + (state.buildMode === "debug" ? "active" : "") + '" data-build-mode="debug">' + escapeText(t("build.mode.debug", undefined, "Debug")) + '</button>'
      ].join("");
      if (workbenchViewTabsEl) {
        workbenchViewTabsEl.innerHTML = state.buildMode === "edit"
          ? [
              '<button class="button subtle ' + (state.workbenchView === "bridge" ? "active" : "") + '" data-workbench-view="bridge">' + escapeText(t("workbench.graph", undefined, "Graph")) + '</button>',
              '<button class="button subtle ' + (state.workbenchView === "source" ? "active" : "") + '" data-workbench-view="source">' + escapeText(t("workbench.source")) + '</button>'
            ].join("")
          : "";
      }
      workbenchActionsEl.innerHTML = [
        '<button class="button" id="build-validate">' + escapeText(t("action.validate", undefined, "Validate")) + '</button>',
        '<button class="button" id="build-generate-mermaid">' + escapeText(t("studio.generateMmd", undefined, "Generate MMD")) + '</button>',
        '<button class="button primary" id="build-save"' + (dirty ? "" : " disabled") + '>' + escapeText(t("action.save", undefined, "Save")) + '</button>',
        '<button class="button primary" id="build-dry-run">' + escapeText(t("studio.dryRun", undefined, "Dry run")) + '</button>'
      ].join("");
      if (state.buildMode === "dry-run") {
        workbenchBodyEl.innerHTML = [
          '<div class="structure-list">',
          '<div class="event"><div class="event-top"><span>' + escapeText(t("build.mode.dryRun", undefined, "Dry Run")) + '</span><span>' + escapeText(dirty ? t("workbench.unsavedChanges", undefined, "unsaved changes") : t("workbench.diskInSync", undefined, "disk in sync")) + '</span></div><strong>' + escapeText(t("build.dryRunPrepTitle", undefined, "Validate, generate Mermaid, save, then start a dry run.")) + '</strong><div class="hint">' + escapeText(t("build.dryRunPrepHint", {
            path: state.workbenchSavedPath || "system.mmd"
          }, "Dry run uses " + (state.workbenchSavedPath || "system.mmd") + " after the generated source is saved.")) + '</div></div>',
          state.studioBridgeLastDryRunId
            ? '<div class="event"><div class="event-top"><span>' + escapeText(t("build.lastDryRun", undefined, "Last dry run")) + '</span><span>' + escapeText(t("common.captured", undefined, "captured")) + '</span></div><strong>' + escapeText(state.studioBridgeLastDryRunId) + '</strong><div class="hint">' + escapeText(t("build.openDebugHint", undefined, "Open Debug mode here or jump to Operate for runtime controls.")) + '</div></div>'
            : '<div class="hint">' + escapeText(t("build.noDryRunYet", undefined, "No dry run has been launched from Build yet.")) + '</div>',
          '</div>'
        ].join("");
      } else if (state.buildMode === "debug") {
        workbenchBodyEl.innerHTML = [
          '<div class="structure-list">',
          '<div class="event"><div class="event-top"><span>' + escapeText(t("build.mode.debug", undefined, "Debug")) + '</span><span>' + escapeText(state.studioBridgeLastDryRunId || t("common.missing", undefined, "missing")) + '</span></div><strong>' + escapeText(state.studioBridgeLastDryRunId ? t("build.debugDryRunTitle", undefined, "Dry-run result captured in Build.") : t("build.noDryRunYet", undefined, "No dry run has been launched from Build yet.")) + '</strong><div class="hint">' + escapeText(t("build.debugDryRunHint", undefined, "Use Operate for resume, stop, logs, and recovery controls.")) + '</div></div>',
          state.studioBridgeLastDryRunId ? '<button class="button subtle" id="build-open-operate">' + escapeText(t("build.openOperate", undefined, "Open in Operate")) + '</button>' : "",
          '</div>'
        ].join("");
      } else
      if (state.workbenchView === "source" && preserveEditor && existingEditor) {
        if (existingEditor.value !== state.workbenchSource) {
          existingEditor.value = state.workbenchSource || "";
        }
      } else if (state.workbenchView === "source") {
        workbenchBodyEl.innerHTML = [
          '<div class="workbench-source-actions">',
          '<div class="hint">' + escapeText(t("workbench.sourceActionsHint", undefined, "Draft actions only affect the current workbench source until you save.")) + '</div>',
          '<div class="toolbar-group">',
          '<button class="button subtle" id="workbench-new-draft">' + escapeText(t("action.newDraft")) + '</button>',
          state.workbenchHasDraft ? '<button class="button subtle" id="workbench-recover-draft">' + escapeText(t("action.recoverDraft")) + '</button>' : "",
          dirty ? '<button class="button subtle" id="workbench-revert">' + escapeText(t("action.revertToDisk")) + '</button>' : "",
          '</div>',
          '</div>',
          '<textarea id="workbench-editor" class="editor" spellcheck="false">' + escapeText(state.workbenchSource || "") + '</textarea>'
        ].join("");
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
          state.workbenchSource = event.target.value || "";
          state.studioBridgeStale = true;
          persistDraftSource(state.workbenchSource !== state.workbenchDiskSource ? state.workbenchSource : "");
          renderWorkbench({ preserveEditor: true });
          scheduleWorkbenchValidation();
        });
      }
      if (workbenchViewTabsEl) {
        for (const button of workbenchViewTabsEl.querySelectorAll("[data-workbench-view]")) {
          button.addEventListener("click", () => {
            state.workbenchView = button.getAttribute("data-workbench-view") || "bridge";
            state.buildMode = "edit";
            renderWorkbench();
            if (state.workbenchView === "bridge" && (!state.studioBridgeLoaded || state.studioBridgeStale)) {
              void refreshStudioBridge().catch((error) => {
                setFlash("error", "Studio Bridge refresh failed: " + (error.message || error));
              });
            }
          });
        }
      }
      for (const button of workbenchTabsEl.querySelectorAll("[data-build-mode]")) {
        button.addEventListener("click", () => {
          state.buildMode = button.getAttribute("data-build-mode") || "edit";
          renderWorkbench();
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
      const saveButton = document.getElementById("build-save");
      if (saveButton) {
        saveButton.addEventListener("click", async () => {
          await saveWorkbench();
        });
      }
      const validateButton = document.getElementById("build-validate");
      if (validateButton) {
        validateButton.addEventListener("click", async () => {
          await runWorkbenchValidation(true);
          await refreshStudioBridge();
        });
      }
      const generateButton = document.getElementById("build-generate-mermaid");
      if (generateButton) {
        generateButton.addEventListener("click", async () => {
          await generateMmdFromStudioBridge();
        });
      }
      const dryRunButton = document.getElementById("build-dry-run");
      if (dryRunButton) {
        dryRunButton.addEventListener("click", async () => {
          await prepareDryRunFromBuild();
        });
      }
      const openOperateButton = document.getElementById("build-open-operate");
      if (openOperateButton) {
        openOperateButton.addEventListener("click", async () => {
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
      if (actionFormSectionEl) {
        actionFormSectionEl.hidden = !form;
      }
      if (!form) {
        actionFormEl.innerHTML = '<div class="hint">' + escapeText(t("form.emptyHint")) + '</div>';
        return;
      }
      const disabled = state.actionBusy ? " disabled" : "";
      if (form.kind === "start") {
        actionFormEl.innerHTML = [
          '<div class="event"><div class="event-top"><span>' + escapeText(t("form.startRun")) + '</span><span>' + escapeText(t("form.fromWorkbench")) + '</span></div><strong>' + escapeText(t("form.prepareNewRunRequest")) + '</strong><div class="hint">' + escapeText(t("form.startRunHint")) + '</div></div>',
          '<div class="form-grid">',
          '<label class="field"><span>' + escapeText(t("form.systemPath")) + '</span><input id="action-start-system-path" value="' + escapeText(form.fields.systemPath || "") + '"' + disabled + ' /></label>',
          '<label class="field"><span>' + escapeText(t("form.dryRun")) + '</span><select id="action-start-dry-run"' + disabled + '><option value="true"' + (form.fields.dryRun ? " selected" : "") + '>' + escapeText(t("common.yes")) + '</option><option value="false"' + (!form.fields.dryRun ? " selected" : "") + '>' + escapeText(t("common.no")) + '</option></select></label>',
          '<label class="field full"><span>' + escapeText(t("form.runInput")) + '</span><textarea id="action-start-input"' + disabled + '>' + escapeText(form.fields.input || "") + '</textarea></label>',
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
      } else if (form.kind === "projectLoad") {
        actionFormEl.innerHTML = [
          '<div class="event"><div class="event-top"><span>' + escapeText(t("form.projectLoad")) + '</span><span>' + escapeText(t("form.workspace")) + '</span></div><strong>' + escapeText(t("form.rebindVisualizer")) + '</strong><div class="hint">' + escapeText(t("form.projectLoadHint")) + '</div></div>',
          '<label class="field full"><span>' + escapeText(t("form.projectWorkdir")) + '</span><input id="action-project-workdir" value="' + escapeText(form.fields.workdir || "") + '"' + disabled + ' /></label>',
          '<div class="actions"><button id="action-form-cancel" class="button subtle"' + disabled + '>' + escapeText(t("action.cancel")) + '</button><button id="action-form-submit" class="button primary"' + disabled + '>' + escapeText(t("action.loadProject")) + '</button></div>'
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
    }

    function renderProject() {
      if (!state.project) {
        projectSummaryEl.textContent = t("state.projectDataUnavailable");
        if (opsSummaryEl) opsSummaryEl.innerHTML = '<div class="hint">' + escapeText(t("state.opsSummaryUnavailable")) + '</div>';
        if (projectReadinessEl) projectReadinessEl.innerHTML = '<div class="hint">' + escapeText(t("state.projectReadinessUnavailable")) + '</div>';
        if (releaseGateEl) releaseGateEl.innerHTML = '<div class="hint">' + escapeText(t("release.dataUnavailable", undefined, "Release gate data unavailable.")) + '</div>';
        bindingExplainEl.innerHTML = '<div class="hint">' + escapeText(t("state.projectBindingDataUnavailable")) + '</div>';
        rolePackagesEl.innerHTML = '<div class="hint">' + escapeText(t("state.rolePackageDataUnavailable")) + '</div>';
        contractExplainEl.innerHTML = '<div class="hint">' + escapeText(t("state.contractDataUnavailable")) + '</div>';
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
      const term = state.filter.trim().toLowerCase();
      const runs = state.runs.filter((run) => {
        if (!term) return true;
        return [run.runId, run.status, run.finalRoleId, run.lastExecutedRoleId]
          .filter(Boolean)
          .some((item) => String(item).toLowerCase().includes(term));
      });
      if (!runs.length) {
        runListEl.innerHTML = '<div class="hint">' + escapeText(t("run.noMatches")) + '</div>';
        return;
      }
      runListEl.innerHTML = runs
        .map((run) => \`
          <button class="run-card \${run.runId === state.selectedRunId ? "active" : ""}" data-run-id="\${escapeText(run.runId)}">
            <div class="run-title">
              <span class="truncate" title="\${escapeText(run.runId)}">\${escapeText(run.runId)}</span>
              <span class="status \${statusClass(run.status)}" data-status="\${escapeText(run.status)}">\${escapeText(displayUiToken(run.status, t))}</span>
            </div>
            <div class="meta">
              <span>\${escapeText(t("run.transitions"))} \${escapeText(run.transitionCount)}</span>
              <span>\${escapeText(t("run.updated"))} \${escapeText(formatTime(run.updatedAt))}</span>
            </div>
          </button>
        \`)
        .join("");
      for (const button of runListEl.querySelectorAll("[data-run-id]")) {
        button.disabled = Boolean(state.actionBusy);
        button.addEventListener("click", () => selectRun(button.getAttribute("data-run-id")));
      }
    }

    function renderProjectWizard() {
      if (!projectWizardEl) {
        return;
      }
      const templates = Array.isArray(state.studioTemplates) ? state.studioTemplates : [];
      const roles = state.project?.roles?.roles || [];
      const modelCount = state.project?.config?.modelCatalog?.models?.length || 0;
      const profiles = state.project?.config?.profiles || [];
      const entryRoleId = state.workbench?.validation?.structure?.entryRoleId
        || state.project?.summary?.project?.entryRoleId
        || roles[0]?.roleId
        || "n/a";
      projectWizardEl.innerHTML = [
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

    function renderStats(header, graphPayload) {
      if (!header) {
        statsEl.innerHTML = "";
        return;
      }
      const cards = [
        [t("stats.status"), displayUiToken(header.status, t)],
        [t("stats.mode"), displayUiToken(graphPayload?.simulation?.mode || header.runMode || "runtime", t)],
        [t("stats.transitions"), header.transitionCount],
        [t("stats.activeBranches"), header.activeBranches],
        [t("stats.pendingReviews"), header.pendingReviewCount],
        [t("stats.recentAudits"), header.recentAudits]
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
          ? '<div class="hint">' + escapeText(t("timeline.noEventsMatchFilters", { filters: activeFilters.join(" · ") })) + '</div>'
          : '<div class="hint">' + escapeText(t("timeline.noEventsCaptured")) + '</div>';
        return;
      }
      timelineEl.innerHTML = [
        activeFilters.length
          ? '<div class="hint">' + escapeText(t("timeline.filteredBy", { filters: activeFilters.join(" · ") })) + "</div>"
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
            const status = record.status ? \`<span class="status \${statusClass(record.status)}">\${escapeText(displayUiToken(record.status, t))}</span>\` : "";
            return \`
              <div class="event">
                <div class="event-top">
                  <span>#\${escapeText(entry.cursor)} \${escapeText(displayUiToken(type, t))}</span>
                  <span>\${escapeText(formatTime(record.at))}</span>
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
          })
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
      state.studioBridge = {
        ...bridgePayload,
        authoring: payload.authoring,
        validation: payload.validation || bridgePayload.validation
      };
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

    async function generateMmdFromStudioBridge(options) {
      if (!state.studioBridge?.authoring) {
        await refreshStudioBridge();
      }
      if (!state.studioBridge?.authoring) {
        setFlash("error", "Studio Bridge cannot generate Mermaid until the source parses successfully.");
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
        setFlash("success", "Generated deterministic Mermaid into the Workbench source view.");
      });
      return true;
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
          "Mermaid source saved to " + state.workbenchSavedPath + ". "
            + (payload.followUpActions?.map((item) => item.label).join(" ") || "Consider project sync, sync-models, or a new run for verification.")
        );
      });
    }

    async function prepareDryRunFromBuild() {
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
      });
      renderWorkbench();
    }

    async function startRunFromWorkbench(args) {
      if (!args.input) {
        setFlash("error", "Run input is required.");
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
      await loadWorkbench();
      renderProject();
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

    async function loadRoleLogs(runId, roleId) {
      if (!roleId) {
        state.roleLogs = [];
        return;
      }
      const roleLogsPayload = await requestJson(buildLogsQuery(runId, { roleId }));
      state.roleLogs = roleLogsPayload.records || [];
    }

    async function loadAllRoleLogs(runId) {
      const roleIds = (state.graph?.graph?.nodes || []).map((node) => node.roleId).filter(Boolean);
      if (!roleIds.length) {
        state.roleLogs = [];
        return;
      }
      const payloads = await Promise.all(roleIds.map((roleId) => requestJson(buildLogsQuery(runId, { roleId }))));
      state.roleLogs = payloads.flatMap((payload) => payload.records || []);
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
        await Promise.all([
          loadEngineLogs(runId),
          state.selectedLogRoleId ? loadRoleLogs(runId, state.selectedLogRoleId) : loadAllRoleLogs(runId)
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
      if (state.consoleTab === "project" || state.consoleTab === "build" || state.consoleTab === "validate-release") {
        state.consoleTab = "operate";
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
      stream.onopen = () => setLive("online", t("live.live"));
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

    projectLoadButton.addEventListener("click", async () => {
      openActionForm("projectLoad", {
        workdir: getCurrentWorkdir()
      });
    });
    if (projectWizardLoadButton) {
      projectWizardLoadButton.addEventListener("click", async () => {
        openActionForm("projectLoad", {
          workdir: getCurrentWorkdir()
        });
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

    logPageSizeEl.addEventListener("change", async (event) => {
      state.logPageSize = event.target.value || "";
      if (state.selectedRunId && state.logsLoaded) {
        await loadSelectedLogs(state.selectedRunId, { force: true });
      } else {
        renderLogs();
      }
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

    Promise.all([loadProject(), loadRuns()])
      .then(async () => {
        if (state.selectedRunId) {
          await loadSelectedRunBoot(state.selectedRunId, { keepStream: false });
        } else {
          renderSelectedRun();
        }
      })
      .catch((error) => {
        runListEl.innerHTML = '<div class="hint">' + escapeText(t("state.visualizerLoadFailed", {
          message: String(error.message || error)
        }, "Failed to load visualizer data: " + String(error.message || error))) + '</div>';
        projectSummaryEl.textContent = t("state.projectLoadFailed", {
          message: String(error.message || error)
        }, "Failed to load project: " + String(error.message || error));
        setLive("idle", t("live.offline"));
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
