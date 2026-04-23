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
      markDiagnosticsStale: true
    };
  }
  return {
    detailGraph: false,
    reviews: false,
    reviewDetail: false,
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
    const state = {
      project: null,
      workbench: null,
      workbenchView: "render",
      workbenchSource: "",
      workbenchDiskSource: "",
      workbenchSavedPath: "system.mmd",
      workbenchHasDraft: false,
      workbenchValidationTimer: null,
      workbenchValidationRequestId: 0,
      workbenchValidating: false,
      sidebarOpen: false,
      runs: [],
      filter: "",
      projectHome: false,
      selectedRunId: "",
      selectedReviewId: "",
      selectedLogRoleId: "",
      logTail: "",
      logSince: "",
      eventCursor: 0,
      events: [],
      detail: null,
      graph: null,
      reviews: null,
      reviewDetail: null,
      resumeDiagnostics: null,
      resumeDiagnosticsLoaded: false,
      resumeDiagnosticsStale: false,
      engineLogs: [],
      roleLogs: [],
      stream: null,
      listTimer: null,
      flash: null,
      actionBusy: "",
      streamRefreshPlan: {
        detailGraph: false,
        reviews: false,
        reviewDetail: false,
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
    const workdirEl = document.getElementById("workdir");
    const projectSummaryEl = document.getElementById("project-summary");
    const workbenchMetaEl = document.getElementById("workbench-meta");
    const workbenchStatusEl = document.getElementById("workbench-status");
    const workbenchActionsEl = document.getElementById("workbench-actions");
    const workbenchTabsEl = document.getElementById("workbench-tabs");
    const workbenchBodyEl = document.getElementById("workbench-body");
    const statsEl = document.getElementById("stats");
    const timelineEl = document.getElementById("timeline");
    const graphViewEl = document.getElementById("graph-view");
    const stateEl = document.getElementById("state");
    const reviewsEl = document.getElementById("reviews");
    const reviewActionsEl = document.getElementById("review-actions");
    const reviewDetailEl = document.getElementById("review-detail");
    const resumeEl = document.getElementById("resume-diagnostics");
    const resumeControlsEl = document.getElementById("resume-controls");
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
      renderActionState();
    }

    function canRequestStop() {
      const status = state.detail?.header?.status || "";
      if (!state.selectedRunId) {
        return false;
      }
      return !["done", "failed", "stopped"].includes(status);
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
      if (sidebarToggleButton) {
        sidebarToggleButton.disabled = disabled;
      }
      for (const button of workbenchActionsEl.querySelectorAll("button")) {
        button.disabled = disabled || button.disabled;
      }
      for (const button of workbenchTabsEl.querySelectorAll("button")) {
        button.disabled = disabled;
      }
      for (const button of reviewActionsEl.querySelectorAll("[data-review-action]")) {
        button.disabled = disabled;
      }
    }

    function setSidebarOpen(nextValue) {
      state.sidebarOpen = nextValue;
      document.body.classList.toggle("drawer-open", nextValue);
    }

    function renderWorkbenchPreviewSvg(structure) {
      if (!structure || !Array.isArray(structure.roles) || !structure.roles.length) {
        return '<div class="hint">Rendered view is available after Mermaid validation succeeds.</div>';
      }
      const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(structure.roles.length))));
      const nodeWidth = 180;
      const nodeHeight = 76;
      const gapX = 64;
      const gapY = 96;
      const padding = 36;
      const positions = {};
      const nodes = structure.roles.map((role, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = padding + (column * (nodeWidth + gapX));
        const y = padding + (row * (nodeHeight + gapY));
        positions[role.roleId] = { x, y };
        const fill =
          role.bindingKind === "model"
            ? "rgba(56, 189, 248, 0.14)"
            : role.bindingKind === "profile"
              ? "rgba(52, 211, 153, 0.14)"
              : "rgba(148, 163, 184, 0.1)";
        return ''
          + '<g>'
          + '<rect x="' + x + '" y="' + y + '" rx="18" ry="18" width="' + nodeWidth + '" height="' + nodeHeight + '" fill="' + fill + '" stroke="rgba(148,163,184,0.28)" />'
          + '<text x="' + (x + 18) + '" y="' + (y + 30) + '" fill="#e5eefb" font-size="16" font-family="IBM Plex Sans, sans-serif">' + escapeText(role.roleId) + '</text>'
          + '<text x="' + (x + 18) + '" y="' + (y + 54) + '" fill="#8fa1c3" font-size="12" font-family="IBM Plex Sans, sans-serif">'
          + escapeText(role.bindingKind + (role.reviewMode ? " · review " + role.reviewMode : role.joinMode ? " · join " + role.joinMode : ""))
          + '</text>'
          + '</g>';
      });
      const edges = (structure.flows || []).map((flow) => {
        const from = positions[flow.fromRoleId];
        const to = positions[flow.toRoleId];
        if (!from || !to) {
          return "";
        }
        const x1 = from.x + (nodeWidth / 2);
        const y1 = from.y + nodeHeight;
        const x2 = to.x + (nodeWidth / 2);
        const y2 = to.y;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        return ''
          + '<g>'
          + '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="rgba(148,163,184,0.42)" stroke-width="2" marker-end="url(#arrow)" />'
          + '<rect x="' + (midX - 48) + '" y="' + (midY - 12) + '" rx="10" ry="10" width="96" height="24" fill="rgba(8,13,26,0.92)" stroke="rgba(148,163,184,0.18)" />'
          + '<text x="' + midX + '" y="' + (midY + 4) + '" text-anchor="middle" fill="#9be7ff" font-size="11" font-family="IBM Plex Mono, monospace">' + escapeText(flow.eventType) + '</text>'
          + '</g>';
      });
      const rows = Math.ceil(structure.roles.length / columns);
      const width = padding * 2 + (columns * nodeWidth) + ((columns - 1) * gapX);
      const height = padding * 2 + (rows * nodeHeight) + (Math.max(0, rows - 1) * gapY);
      return ''
        + '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Mermaid workbench render">'
        + '<defs><marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.52)"></path></marker></defs>'
        + edges.join("")
        + nodes.join("")
        + '</svg>';
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

    function renderWorkbench() {
      const validation = state.workbench?.validation || null;
      const diagnostics = validation?.diagnostics || [];
      const structure = validation?.structure || null;
      const dirty = state.workbenchSource !== state.workbenchDiskSource;
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
        '<button class="button subtle ' + (state.workbenchView === "structure" ? "active" : "") + '" data-workbench-view="structure">Structure</button>'
      ].join("");
      workbenchActionsEl.innerHTML = [
        '<button class="button subtle" id="workbench-new-draft">New draft</button>',
        '<button class="button subtle" id="workbench-recover-draft"' + (state.workbenchHasDraft ? "" : " disabled") + '>Recover draft</button>',
        '<button class="button subtle" id="workbench-revert"' + (dirty ? "" : " disabled") + '>Revert to disk</button>',
        '<button class="button primary" id="workbench-save"' + (dirty ? "" : " disabled") + '>Save</button>',
        '<button class="button" id="workbench-save-as">Save as</button>'
      ].join("");
      if (state.workbenchView === "source") {
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
      } else {
        workbenchBodyEl.innerHTML = renderWorkbenchStructure(structure);
      }
      const editor = document.getElementById("workbench-editor");
      if (editor) {
        editor.addEventListener("input", (event) => {
          state.workbenchSource = event.target.value || "";
          persistDraftSource(state.workbenchSource !== state.workbenchDiskSource ? state.workbenchSource : "");
          renderWorkbench();
          scheduleWorkbenchValidation();
        });
      }
      for (const button of workbenchTabsEl.querySelectorAll("[data-workbench-view]")) {
        button.addEventListener("click", () => {
          state.workbenchView = button.getAttribute("data-workbench-view") || "render";
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
      const saveButton = document.getElementById("workbench-save");
      if (saveButton) {
        saveButton.addEventListener("click", async () => {
          await saveWorkbench(false);
        });
      }
      const saveAsButton = document.getElementById("workbench-save-as");
      if (saveAsButton) {
        saveAsButton.addEventListener("click", async () => {
          await saveWorkbench(true);
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

    function renderProject() {
      if (!state.project) {
        projectSummaryEl.textContent = "Project data unavailable.";
        return;
      }
      if (workdirEl) {
        workdirEl.textContent = state.project.summary?.workdir || workdirEl.textContent;
      }
      const summary = state.project.summary?.project ?? {};
      const roles = state.project.roles?.roles ?? [];
      projectSummaryEl.textContent = [
        "projectName: " + (summary.projectName ?? "n/a"),
        "projectId: " + (summary.projectId ?? "n/a"),
        "systemId: " + (summary.systemId ?? "n/a"),
        "systemVersion: " + (summary.systemVersion ?? "n/a"),
        "entryRoleId: " + (summary.entryRoleId ?? "n/a"),
        "roleCount: " + (summary.roleCount ?? 0),
        "flowCount: " + (summary.flowCount ?? 0),
        "runsDir: " + (summary.runsDir ?? "n/a"),
        "reviewedRoleIds: " + ((summary.reviewedRoleIds ?? []).join(", ") || "none"),
        "joinRoleIds: " + ((summary.joinRoleIds ?? []).join(", ") || "none"),
        "loopRoleIds: " + ((summary.loopRoleIds ?? []).join(", ") || "none"),
        "contextMappedRoleIds: " + ((summary.contextMappedRoleIds ?? []).join(", ") || "none"),
        "",
        "roles:",
        ...roles.map((role) => "- " + role.roleId + " [binding=" + (role.binding?.bindingKind || "n/a") + " review=" + (role.review ? "yes" : "no") + " join=" + (role.join ? "yes" : "no") + " loop=" + (role.loop ? "yes" : "no") + "]"),
        "",
        "modelSelectionWarnings:",
        ...((state.project.config?.modelSelectionWarnings ?? []).length
          ? state.project.config.modelSelectionWarnings.map((warning) => "- " + warning)
          : ["- none"]),
        "",
        "systemPath: " + (state.workbenchSavedPath || "system.mmd"),
        "currentWorkbenchValidation: " + (state.workbench?.validation?.ok ? "ok" : "pending or failed")
      ].join("\\n");
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
      if (!events.length) {
        timelineEl.innerHTML = '<div class="hint">No events captured yet.</div>';
        return;
      }
      timelineEl.innerHTML = events
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
        .join("");
    }

    function renderGraph() {
      if (!state.graph) {
        graphViewEl.innerHTML = '<div class="hint">No run selected.</div>';
        stateEl.textContent = "No run selected.";
        return;
      }
      const graph = state.graph.graph;
      if (!graph) {
        graphViewEl.innerHTML = '<div class="hint">Graph projection unavailable.</div>';
        stateEl.textContent = formatJson(state.detail?.state ?? null);
        return;
      }
      const nodes = graph.nodes || [];
      const edges = (graph.edges || []).filter((edge) => edge.recentlyActivated || edge.isErrorFlow);
      graphViewEl.innerHTML = [
        '<div class="event"><strong>' + escapeText(graph.systemId || "unknown") + '</strong><div class="hint">entry ' + escapeText(graph.entryRoleId || "n/a") + " · roles " + escapeText(graph.roleCount || 0) + " · flows " + escapeText(graph.flowCount || 0) + "</div></div>",
        ...nodes.map((node) =>
          '<div class="event">' +
            '<div class="event-top">' +
              '<span><code>' + escapeText(node.roleId) + "</code> · " + escapeText(node.nodeType) + "</span>" +
              '<span class="status ' + statusClass(node.status) + '">' + escapeText(node.status) + "</span>" +
            "</div>" +
            "<strong>binding=" + escapeText(node.bindingKind) + " · active=" + escapeText(node.activeBranchCount) + " · waitingReview=" + escapeText(node.waitingReviewCount) + " · loop=" + escapeText(node.loopIteration) + "</strong>" +
            '<div class="hint">' + escapeText(node.lastErrorCode || "no error") + (node.missingSources?.length ? " · missing join sources " + escapeText(node.missingSources.join(", ")) : "") + "</div>" +
          "</div>"
        ),
        ...(edges.length > 0
          ? edges.map((edge) =>
              '<div class="event">' +
                '<div class="event-top">' +
                  '<span><code>' + escapeText(edge.sourceRoleId) + "</code> -> <code>" + escapeText(edge.targetRoleId) + "</code></span>" +
                  "<span>" + (edge.recentlyActivated ? "recent" : edge.isErrorFlow ? "error-flow" : "") + "</span>" +
                "</div>" +
                "<strong>" + escapeText(edge.event) + "</strong>" +
              "</div>"
            )
          : ['<div class="hint">No activated or error-flow edges in the current snapshot.</div>'])
      ].join("");
      stateEl.textContent = formatJson(state.detail?.state ?? null);
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
        reviewDetailEl.textContent = "No review selected.";
        renderActionState();
        return;
      }
      reviewsEl.innerHTML = state.reviews.reviews
        .map((review) =>
          '<button class="run-card ' + (review.reviewId === state.selectedReviewId ? "active" : "") + '" data-review-id="' + escapeText(review.reviewId) + '">' +
            '<div class="run-title">' +
              '<span class="truncate" title="' + escapeText(review.reviewId) + '"><code>' + escapeText(review.reviewId) + "</code></span>" +
              '<span class="status ' + statusClass(review.currentStatus || "unknown") + '">' + escapeText(formatReviewStatusLabel(review.currentStatus || "unknown")) + "</span>" +
            "</div>" +
            '<div class="meta">' +
              "<span>" + escapeText(review.roleId || "n/a") + "</span>" +
              "<span>" + escapeText(review.branchStatus || "n/a") + "</span>" +
              "<span>" + escapeText(review.decision || "no-decision") + "</span>" +
              "<span>" + escapeText("phase " + formatReviewStatusLabel(review.decisionPhase || "none")) + "</span>" +
            "</div>" +
          "</button>"
        )
        .join("");
      for (const button of reviewsEl.querySelectorAll("[data-review-id]")) {
        button.disabled = Boolean(state.actionBusy);
        button.addEventListener("click", () => selectReview(state.selectedRunId, button.getAttribute("data-review-id")));
      }
      const detail = state.reviewDetail;
      reviewDetailEl.textContent = formatReviewDetail(detail);
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
          submitReviewDecision(button.getAttribute("data-review-action"), button.getAttribute("data-review-scope"))
        );
      }
      renderActionState();
    }

    function renderResumeDiagnostics() {
      const controls = [];
      if (!state.selectedRunId) {
        resumeControlsEl.innerHTML = "";
        resumeEl.innerHTML = '<div class="hint">No run selected.</div>';
        return;
      }
      controls.push('<button class="button" id="load-diagnostics">' + (state.resumeDiagnosticsLoaded ? "Refresh diagnostics" : "Load diagnostics") + '</button>');
      if (state.resumeDiagnosticsLoaded && state.resumeDiagnosticsStale) {
        controls.push('<span class="hint">diagnostics stale</span>');
      }
      resumeControlsEl.innerHTML = controls.join("");
      const loadDiagnosticsButton = document.getElementById("load-diagnostics");
      if (loadDiagnosticsButton) {
        loadDiagnosticsButton.disabled = Boolean(state.actionBusy);
        loadDiagnosticsButton.addEventListener("click", async () => {
          await loadResumeDiagnostics(state.selectedRunId, { force: true });
        });
      }
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
        '<div class="event"><div class="event-top"><span>resume status</span><span class="status ' + statusClass(state.resumeDiagnostics.status) + '">' + escapeText(state.resumeDiagnostics.status) + "</span></div><strong>" + escapeText(state.resumeDiagnostics.fingerprint?.mismatch ? "fingerprint mismatch" : "authority set inspected") + "</strong></div>",
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
      logsFiltersEl.textContent = "role=" + (state.selectedLogRoleId || "latest") + " tail=" + (state.logTail || "all") + " since=" + (state.logSince || "n/a");
      logsEl.textContent = formatJson({
        selectedRoleId: state.selectedLogRoleId || null,
        engine: state.engineLogs,
        role: state.roleLogs
      });
    }

    function renderDetail() {
      detailEl.textContent = formatJson({
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
      renderStats(header, graphPayload);
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

    async function runWorkbenchValidation(force) {
      const requestId = ++state.workbenchValidationRequestId;
      state.workbenchValidating = true;
      renderWorkbench();
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
      } finally {
        if (requestId === state.workbenchValidationRequestId) {
          state.workbenchValidating = false;
        }
        renderWorkbench();
        renderProject();
      }
    }

    function scheduleWorkbenchValidation() {
      clearTimeout(state.workbenchValidationTimer);
      state.workbenchValidationTimer = setTimeout(() => {
        void runWorkbenchValidation(false).catch((error) => {
          state.workbenchValidating = false;
          setFlash("error", "Workbench validation failed: " + (error.message || error));
          renderWorkbench();
        });
      }, 250);
    }

    async function loadWorkbench() {
      const payload = await requestJson(\`\${API_PREFIX}/project/system/workbench\`);
      state.workbench = payload;
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

    async function saveWorkbench(saveAs) {
      const targetPath = saveAs
        ? promptText("Save Mermaid source as (relative path)", state.workbenchSavedPath || "drafts/system-copy.mmd")
        : state.workbenchSavedPath;
      if (saveAs && targetPath === null) {
        return;
      }
      await runAction(saveAs ? "workbench:save-as" : "workbench:save", async () => {
        const payload = await requestAction(
          saveAs ? \`\${API_PREFIX}/project/system/save-as\` : \`\${API_PREFIX}/project/system/save\`,
          {
            systemSource: state.workbenchSource,
            saveAsPath: saveAs ? targetPath : undefined
          }
        );
        state.workbenchDiskSource = state.workbenchSource;
        state.workbenchSavedPath = relativeToWorkdir(payload.savedPath || targetPath || "system.mmd") || "system.mmd";
        state.workbench = {
          ...(state.workbench || {}),
          validation: payload.validation
        };
        persistDraftSource("");
        renderWorkbench();
        renderProject();
        setFlash(
          "success",
          "Mermaid source saved to " + state.workbenchSavedPath + ". "
            + (payload.followUpActions?.map((item) => item.label).join(" ") || "Consider project sync, sync-models, or a new run for verification.")
        );
      });
    }

    function promptBoolean(message, initialValue) {
      const choice = window.prompt(message + " (yes/no)", initialValue ? "yes" : "no");
      if (choice === null) {
        return null;
      }
      return !/^n(o)?$/i.test(choice.trim());
    }

    async function startRunFromWorkbench() {
      const systemPath = promptText("System file for start", state.workbenchSavedPath || "system.mmd");
      if (systemPath === null) {
        return;
      }
      const input = promptText("Run input / prompt", "");
      if (input === null || !input) {
        return;
      }
      const dryRun = promptBoolean("Dry-run for this start request?", true);
      if (dryRun === null) {
        return;
      }
      const runtimePath = promptText("Optional runtime config path", "");
      if (runtimePath === null) {
        return;
      }
      const userProfilePath = promptText("Optional user-profile path", "");
      if (userProfilePath === null) {
        return;
      }
      const lawsPath = promptText("Optional laws path", "");
      if (lawsPath === null) {
        return;
      }
      await runAction("run:start", async () => {
        const payload = await requestAction(\`\${API_PREFIX}/runs/start\`, {
          systemPath,
          input,
          dryRun,
          runtimePath: runtimePath || undefined,
          userProfilePath: userProfilePath || undefined,
          lawsPath: lawsPath || undefined
        });
        setFlash("success", "Start completed for " + payload.runId + " (" + payload.status + ").");
        await loadProject();
        await loadRuns();
        if (payload.runId) {
          await selectRun(payload.runId);
        }
      });
    }

    async function resumeSelectedRun() {
      if (!state.selectedRunId) {
        return;
      }
      const systemPath = promptText("Optional system override for resume", state.workbenchSavedPath || "");
      if (systemPath === null) {
        return;
      }
      const input = promptText("Optional input override for resume", "");
      if (input === null) {
        return;
      }
      const dryRun = promptBoolean("Dry-run for this resume request?", false);
      if (dryRun === null) {
        return;
      }
      const runtimePath = promptText("Optional runtime config path", "");
      if (runtimePath === null) {
        return;
      }
      const userProfilePath = promptText("Optional user-profile path", "");
      if (userProfilePath === null) {
        return;
      }
      const lawsPath = promptText("Optional laws path", "");
      if (lawsPath === null) {
        return;
      }
      await runAction("run:resume", async () => {
        const payload = await requestAction(
          \`\${API_PREFIX}/runs/\${encodeURIComponent(state.selectedRunId)}/resume\`,
          {
            systemPath: systemPath || undefined,
            input: input || undefined,
            dryRun,
            runtimePath: runtimePath || undefined,
            userProfilePath: userProfilePath || undefined,
            lawsPath: lawsPath || undefined
          }
        );
        setFlash("success", "Resume finished for " + payload.runId + " (" + payload.status + ").");
        await loadProject();
        await loadRuns();
        await loadSelectedRunBoot(payload.runId, { keepStream: false });
      });
    }

    async function rebindProject() {
      const target = promptText("Project workdir to load", getCurrentWorkdir());
      if (target === null || !target) {
        return;
      }
      await runAction("project:load", async () => {
        const payload = await requestAction(\`\${API_PREFIX}/project/load\`, { workdir: target });
        setFlash("success", "Project rebound to " + payload.workdir + ".");
        setSidebarOpen(false);
        await loadProject();
        await loadRuns();
        selectProjectHome();
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
      const [summary, system, config, roles] = await Promise.all([
        requestJson(\`\${API_PREFIX}/project\`),
        requestJson(\`\${API_PREFIX}/project/system\`),
        requestJson(\`\${API_PREFIX}/project/config\`),
        requestJson(\`\${API_PREFIX}/project/roles\`)
      ]);
      state.project = { summary, system, config, roles };
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
        renderLogs();
        return;
      }
      const roleLogsPayload = await requestJson(buildLogsQuery(runId, { roleId }));
      state.roleLogs = roleLogsPayload.records || [];
      renderLogs();
    }

    async function loadEngineLogs(runId) {
      const engineLogsPayload = await requestJson(buildLogsQuery(runId, { engine: true }));
      state.engineLogs = engineLogsPayload.records || [];
      renderLogs();
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
      const [detail, graphPayload] = await Promise.all([
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}\`),
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/graph\`)
      ]);
      state.detail = detail;
      state.graph = graphPayload;
      upsertRunFromHeader(detail.header);
      const fallbackRoleId = detail.header?.lastExecutedRoleId || detail.header?.finalRoleId || "";
      populateLogRoleOptions(graphPayload, fallbackRoleId);
      renderSelectedRun();
      renderRuns();
      writeRouteToLocation();
      const status = detail.header?.status || "unknown";
      const hasWaitingHumanReview = Boolean(detail.header?.hasWaitingHumanReview);
      if (hasWaitingHumanReview) {
        setLive("idle", "waiting_review");
      } else {
        setLive(status === "running" || status === "stopping" ? "online" : "idle", status);
      }
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
      const [detail, eventsPayload, graphPayload, reviewsPayload] = await Promise.all([
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}\`),
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/events?cursor=0&limit=250\`),
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/graph\`),
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/reviews\`)
      ]);

      state.detail = detail;
      state.events = eventsPayload.events || [];
      state.eventCursor = eventsPayload.nextCursor || 0;
      state.graph = graphPayload;
      state.reviews = reviewsPayload;
      state.resumeDiagnostics = null;
      state.resumeDiagnosticsLoaded = false;
      state.resumeDiagnosticsStale = false;
      upsertRunFromHeader(detail.header);
      const fallbackRoleId = detail.header?.lastExecutedRoleId || detail.header?.finalRoleId || "";
      if (!state.selectedReviewId) {
        state.selectedReviewId = reviewsPayload.latestPendingReviewId || "";
      }
      await refreshSelectedReviewDetail(runId, { allowMissing: true });
      populateLogRoleOptions(graphPayload, fallbackRoleId);
      await Promise.all([
        loadEngineLogs(runId),
        loadRoleLogs(runId, state.selectedLogRoleId || fallbackRoleId)
      ]);
      renderSelectedRun();
      renderRuns();
      writeRouteToLocation();

      if (!options || !options.keepStream) {
        stopStream();
        connectStream(runId, state.eventCursor);
      }
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
      state.selectedRunId = runId;
      state.selectedReviewId = "";
      setSidebarOpen(false);
      renderRuns();
      await loadSelectedRunBoot(runId, { keepStream: false });
    }

    function selectProjectHome() {
      stopStream();
      state.projectHome = true;
      state.selectedRunId = "";
      state.selectedReviewId = "";
      state.detail = null;
      state.graph = null;
      state.reviews = null;
      state.reviewDetail = null;
      state.resumeDiagnostics = null;
      state.resumeDiagnosticsLoaded = false;
      state.resumeDiagnosticsStale = false;
      state.events = [];
      state.engineLogs = [];
      state.roleLogs = [];
      renderSelectedRun();
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

    function promptText(label, initialValue) {
      const value = window.prompt(label, initialValue || "");
      return value === null ? null : value.trim();
    }

    async function submitReviewDecision(decision, scope) {
      if (!state.selectedRunId || !state.selectedReviewId) {
        return;
      }
      const detail = state.reviewDetail || {};
      const actor = promptText("Actor", detail.actor || "visualizer");
      if (actor === null) {
        return;
      }
      const comment = promptText("Comment", detail.comment || \`recorded via visualizer (\${decision})\`);
      if (comment === null) {
        return;
      }
      let effectiveScope = scope;
      if (decision === "terminate") {
        const promptedScope = promptText("Terminate scope (branch|run)", scope || detail.scope || "branch");
        if (promptedScope === null) {
          return;
        }
        effectiveScope = promptedScope;
      }
      if (!window.confirm(\`Record review decision "\${decision}" for \${state.selectedReviewId}?\`)) {
        return;
      }
      await runAction("review:" + decision, async () => {
        const payload = await requestAction(
          \`\${API_PREFIX}/runs/\${encodeURIComponent(state.selectedRunId)}/reviews/\${encodeURIComponent(state.selectedReviewId)}/decide\`,
          {
            decision,
            scope: decision === "terminate" ? effectiveScope : undefined,
            actor,
            comment
          }
        );
        state.resumeDiagnosticsStale = true;
        setFlash(
          "success",
          'Review action recorded for ' + state.selectedReviewId + ': ' + (payload.semanticStatus || decision) + '. '
            + (payload.detail?.note || "")
        );
        await refreshRunDetailAndGraph(state.selectedRunId);
        await refreshReviews(state.selectedRunId);
      });
    }

    async function submitStopRequest() {
      if (!state.selectedRunId) {
        return;
      }
      const reason = promptText("Stop reason", "requested via visualizer");
      if (reason === null) {
        return;
      }
      if (!window.confirm(\`Record a stop request for \${state.selectedRunId}?\`)) {
        return;
      }
      await runAction("stop", async () => {
        const payload = await requestAction(
          \`\${API_PREFIX}/runs/\${encodeURIComponent(state.selectedRunId)}/stop\`,
          { reason }
        );
        state.resumeDiagnosticsStale = true;
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
      });
    }

    function mergeStreamRefreshPlan(nextPlan) {
      state.streamRefreshPlan = {
        detailGraph: state.streamRefreshPlan.detailGraph || nextPlan.detailGraph,
        reviews: state.streamRefreshPlan.reviews || nextPlan.reviews,
        reviewDetail: state.streamRefreshPlan.reviewDetail || nextPlan.reviewDetail,
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
        markDiagnosticsStale: false
      };
      if (plan.markDiagnosticsStale) {
        state.resumeDiagnosticsStale = state.resumeDiagnosticsLoaded || state.resumeDiagnosticsStale;
        renderResumeDiagnostics();
        renderDetail();
      }
      if (!plan.detailGraph && !plan.reviews && !plan.reviewDetail) {
        return;
      }
      state.streamRefreshInFlight = true;
      try {
        if (plan.detailGraph) {
          await refreshRunDetailAndGraph(state.selectedRunId);
        }
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
          state.events = appendStreamEntry(state.events, payload, 250);
          renderTimeline(state.events);
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
      await rebindProject();
    });

    projectExportButton.addEventListener("click", async () => {
      await exportProject();
    });

    reindexButton.addEventListener("click", async () => {
      if (!window.confirm("Rebuild runs index now?")) {
        return;
      }
      await runAction("reindex", async () => {
        const payload = await requestAction(\`\${API_PREFIX}/runs/reindex\`);
        state.runs = payload.runs || [];
        renderRuns();
        setFlash("success", "Runs index rebuilt.");
      });
    });

    stopRunButton.addEventListener("click", async () => {
      await submitStopRequest();
    });

    startRunButton.addEventListener("click", async () => {
      await startRunFromWorkbench();
    });

    resumeRunButton.addEventListener("click", async () => {
      await resumeSelectedRun();
    });

    refreshButton.addEventListener("click", async () => {
      await runAction("refresh", async () => {
        await loadProject();
        await loadRuns();
        if (state.selectedRunId) {
          await loadSelectedRunBoot(state.selectedRunId, { keepStream: false });
        } else {
          renderSelectedRun();
        }
        setFlash("success", "Visualizer refreshed.");
      });
    });

    logRoleEl.addEventListener("change", async (event) => {
      state.selectedLogRoleId = event.target.value || "";
      if (state.selectedRunId) {
        await Promise.all([
          loadEngineLogs(state.selectedRunId),
          loadRoleLogs(state.selectedRunId, state.selectedLogRoleId || state.detail?.header?.lastExecutedRoleId || "")
        ]);
        writeRouteToLocation();
      }
    });

    logTailEl.addEventListener("change", async (event) => {
      state.logTail = event.target.value || "";
      if (state.selectedRunId) {
        await Promise.all([
          loadEngineLogs(state.selectedRunId),
          loadRoleLogs(state.selectedRunId, state.selectedLogRoleId || state.detail?.header?.lastExecutedRoleId || "")
        ]);
      }
      writeRouteToLocation();
    });

    logSinceEl.addEventListener("change", async (event) => {
      state.logSince = event.target.value || "";
      if (state.selectedRunId) {
        await Promise.all([
          loadEngineLogs(state.selectedRunId),
          loadRoleLogs(state.selectedRunId, state.selectedLogRoleId || state.detail?.header?.lastExecutedRoleId || "")
        ]);
      }
      writeRouteToLocation();
    });

    searchEl.addEventListener("input", (event) => {
      state.filter = event.target.value || "";
      renderRuns();
    });

    const initialRoute = readRouteStateFromSearch(window.location.search);
    state.projectHome = initialRoute.view === "project";
    state.selectedRunId = initialRoute.runId;
    state.selectedReviewId = initialRoute.reviewId;
    state.selectedLogRoleId = initialRoute.logRoleId;
    state.logTail = initialRoute.tail;
    state.logSince = initialRoute.since;
    logTailEl.value = state.logTail;
    logSinceEl.value = state.logSince;

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
      if (document.visibilityState === "hidden" || state.actionBusy) {
        return;
      }
      loadRuns().catch(() => {
        // keep the page usable even if a background refresh fails
      });
    }, 30000);
  `;
}
