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

export function buildClientAppScript(apiPrefix: string): string {
  return `
    const API_PREFIX = ${JSON.stringify(apiPrefix)};
    const readRouteStateFromSearch = ${readRouteStateFromSearch.toString()};
    const buildRouteSearch = ${buildRouteSearch.toString()};
    const appendStreamEntry = ${appendStreamEntry.toString()};
    const getStreamRefreshPlan = ${getStreamRefreshPlan.toString()};
    const state = {
      project: null,
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
    const projectSummaryEl = document.getElementById("project-summary");
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
    const projectHomeButton = document.getElementById("project-home");
    const reindexButton = document.getElementById("reindex");
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

    function statusClass(status) {
      return ["running", "stopping", "stopped", "done", "failed", "waiting_review", "active", "idle", "simulation", "completed"].includes(status)
        ? status
        : "unknown";
    }

    async function requestJson(path, options) {
      const response = await fetch(path, {
        headers: { accept: "application/json" },
        cache: "no-store",
        ...(options || {})
      });
      if (!response.ok) {
        throw new Error(\`\${response.status} \${response.statusText}\`);
      }
      return response.json();
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

    function renderActionState() {
      const disabled = Boolean(state.actionBusy);
      projectHomeButton.disabled = disabled;
      reindexButton.disabled = disabled;
      stopRunButton.disabled = disabled || !state.selectedRunId;
      refreshButton.disabled = disabled;
      for (const button of reviewActionsEl.querySelectorAll("[data-review-action]")) {
        button.disabled = disabled;
      }
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
        "system.mmd:",
        state.project.system?.systemSource ?? "n/a"
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
              <span>\${escapeText(run.runId)}</span>
              <span class="status \${statusClass(run.status)}">\${escapeText(run.status)}</span>
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
              "<span><code>" + escapeText(review.reviewId) + "</code></span>" +
              '<span class="status ' + statusClass(review.currentStatus || "unknown") + '">' + escapeText(review.currentStatus || "unknown") + "</span>" +
            "</div>" +
            '<div class="meta">' +
              "<span>" + escapeText(review.roleId || "n/a") + "</span>" +
              "<span>" + escapeText(review.branchStatus || "n/a") + "</span>" +
            "</div>" +
          "</button>"
        )
        .join("");
      for (const button of reviewsEl.querySelectorAll("[data-review-id]")) {
        button.disabled = Boolean(state.actionBusy);
        button.addEventListener("click", () => selectReview(state.selectedRunId, button.getAttribute("data-review-id")));
      }
      const detail = state.reviewDetail;
      reviewDetailEl.textContent = detail
        ? formatJson({
            reviewId: detail.reviewId,
            roleId: detail.roleId,
            branchId: detail.branchId,
            round: detail.round,
            currentStatus: detail.currentStatus,
            decision: detail.decision,
            actor: detail.actor,
            comment: detail.comment,
            appliedAt: detail.appliedAt,
            reconciledAt: detail.reconciledAt,
            history: detail.history,
            humanReviewContext: detail.humanReviewContext
          })
        : "No review selected.";
      const actionable = detail && (detail.currentStatus === "pending" || detail.currentStatus === "paused");
      reviewActionsEl.innerHTML = actionable
        ? [
          '<button class="button" data-review-action="approve">Approve</button>',
          '<button class="button" data-review-action="rework">Rework</button>',
          '<button class="button" data-review-action="pause">Pause</button>',
          '<button class="button" data-review-action="terminate" data-review-scope="' + escapeText(detail.scope || "branch") + '">Terminate</button>'
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

    async function loadProject() {
      const [summary, system, config, roles] = await Promise.all([
        requestJson(\`\${API_PREFIX}/project\`),
        requestJson(\`\${API_PREFIX}/project/system\`),
        requestJson(\`\${API_PREFIX}/project/config\`),
        requestJson(\`\${API_PREFIX}/project/roles\`)
      ]);
      state.project = { summary, system, config, roles };
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
        await requestAction(
          \`\${API_PREFIX}/runs/\${encodeURIComponent(state.selectedRunId)}/reviews/\${encodeURIComponent(state.selectedReviewId)}/decide\`,
          {
            decision,
            scope: decision === "terminate" ? effectiveScope : undefined,
            actor,
            comment
          }
        );
        state.resumeDiagnosticsStale = true;
        setFlash("success", \`Decision "\${decision}" recorded; reconcile may still be pending.\`);
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
        await requestAction(
          \`\${API_PREFIX}/runs/\${encodeURIComponent(state.selectedRunId)}/stop\`,
          { reason }
        );
        state.resumeDiagnosticsStale = true;
        setFlash("success", "Stop request recorded.");
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
