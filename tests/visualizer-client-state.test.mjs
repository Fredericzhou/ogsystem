import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRouteSearch,
  normalizeLifecycleView,
  readRouteStateFromSearch
} from "../dist/visualizer/client-route-state.js";
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
} from "../dist/visualizer/client-lifecycle-panels.js";
import {
  renderArtifactsPanel,
  renderFailureDetailPanel,
  renderReviewDetailPanel,
  renderRunStatePanel
} from "../dist/visualizer/client-renderers.js";
import {
  createInitialStreamRefreshPlan,
  createInitialVisualizerState,
  createBuildStateSlice,
  createLogsStateSlice,
  createOperateStateSlice,
  createProjectStateSlice,
  createReviewStateSlice,
  createStreamingStateSlice
} from "../dist/visualizer/client-lifecycle-state.js";
import {
  mapFailureProjectionView,
  mapProjectTransferView,
  mapResumeDiagnosticsView
} from "../dist/visualizer/dto.js";
import { bindProjectWizardControls } from "../dist/visualizer/client-project-menu-controls.js";
import {
  projectCreateErrorFromResponse
} from "../dist/visualizer/client-project-workspace.js";
import {
  buildLogsQuery,
  fetchFailureData,
  fetchResumeDiagnosticsData,
  fetchResumeReadinessData,
  fetchSelectedLogs,
  shouldSkipDeferredPanelLoad
} from "../dist/visualizer/client-run-data-loaders.js";
import {
  getVisibleConsolePanelIds,
  renderConsoleTabsHtml,
  renderRunListHtml,
  shouldShowRunSidebar
} from "../dist/visualizer/client-shell-controls.js";
import {
  LOG_FILTER_INPUT_MODE,
  PROJECT_INIT_FORM_MODE,
  RUN_LIST_SEARCH_MODE,
  STUDIO_BRIDGE_FILTER_MODE,
  STUDIO_CHAT_INPUT_MODE,
  VISUALIZER_INPUT_BOUNDARIES,
  WORKBENCH_VALIDATION_DEBOUNCE_MS
} from "../dist/visualizer/client-input-policy.js";
import {
  fallbackLogRoleId,
  resolveRunLiveState,
  selectReviewId
} from "../dist/visualizer/client-run-selection.js";
import {
  renderStudioChatPanelHtml,
  studioChatCanApply,
  studioChatModeLabel
} from "../dist/visualizer/client-studio-chat-panel.js";
import {
  bindStudioBridgeControls as bindStudioBridgeControlsModule,
  bindStudioChatControls as bindStudioChatControlsModule
} from "../dist/visualizer/client-studio-bridge-controls.js";
import {
  renderStudioGraphCanvas,
  renderStudioBridgePanel,
  sortStudioBridgeFlowsByTopology,
  sortStudioBridgeRolesTopologically
} from "../dist/visualizer/client-renderers.js";
import {
  buildReleaseReadinessDecision,
  listFromRecord
} from "../dist/visualizer/client-release-readiness.js";
import {
  appendIndexedStreamEntry,
  appendStreamEntry,
  createStreamCursorIndex,
  formatReviewStatusLabel,
  getStreamRefreshPlan
} from "../dist/visualizer/client-stream-state.js";

function escapeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function t(key, vars, fallback) {
  const fallbackByKey = {
    "timeline.noEventsMatchFilters": "No events match {filters}.",
    "timeline.filteredBy": "Filtered by {filters}."
  };
  let text = fallback ?? fallbackByKey[key] ?? key;
  for (const [name, value] of Object.entries(vars || {})) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

function displayUiToken(value) {
  return String(value ?? "unknown").replaceAll("_", " ");
}

function statusClass(value) {
  return String(value || "unknown").replace(/[^a-z0-9_-]/gi, "_");
}

function formatTime(value) {
  return value ? `time:${value}` : "n/a";
}

class FakeBoundElement {
  constructor(attributes = {}, value = "", selectorMap = {}) {
    this.attributes = { ...attributes };
    this.value = value;
    this.listeners = new Map();
    this.selectorMap = selectorMap;
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  querySelectorAll(selector) {
    return this.selectorMap[selector] || [];
  }

  dispatch(type, value = this.value) {
    this.value = value;
    const listeners = this.listeners.get(type) || [];
    for (const listener of listeners) {
      listener({
        preventDefault() {},
        target: { value }
      });
    }
  }
}

class FakeQueryRoot {
  constructor(selectorMap = {}) {
    this.selectorMap = selectorMap;
  }

  querySelectorAll(selector) {
    return this.selectorMap[selector] || [];
  }
}

test("client route state helpers parse and serialize lifecycle query state", () => {
  assert.deepEqual(readRouteStateFromSearch(""), {
    view: "",
    lifecycle: "",
    runId: "",
    reviewId: "",
    logRoleId: "",
    tail: "",
    since: ""
  });
  assert.equal(normalizeLifecycleView("operate", ""), "run");
  assert.equal(normalizeLifecycleView("unknown", "project"), "project");
  assert.equal(normalizeLifecycleView("", "operate"), "run");
  assert.equal(normalizeLifecycleView("unknown", "legacy"), "run");
  assert.equal(normalizeLifecycleView("project", ""), "project");
  assert.equal(normalizeLifecycleView("design", ""), "design");
  assert.equal(normalizeLifecycleView("build", ""), "design");
  assert.equal(normalizeLifecycleView("validate-release", ""), "release");
  assert.equal(normalizeLifecycleView("legacy", ""), "run");

  assert.equal(
    buildRouteSearch({
      lifecycle: "design",
      projectHome: true,
      selectedRunId: "",
      selectedReviewId: "",
      selectedLogRoleId: "",
      logTail: "",
      logSince: ""
    }),
    "lifecycle=design"
  );
  assert.equal(
    buildRouteSearch({
      lifecycle: "run",
      projectHome: false,
      selectedRunId: "run-1",
      selectedReviewId: "",
      selectedLogRoleId: "",
      logTail: "",
      logSince: ""
    }),
    "lifecycle=run&runId=run-1"
  );
  assert.deepEqual(
    readRouteStateFromSearch("?lifecycle=run&runId=run-1&reviewId=review-2&logRoleId=qa&tail=50&since=2026-05-03T09%3A00"),
    {
      view: "",
      lifecycle: "run",
      runId: "run-1",
      reviewId: "review-2",
      logRoleId: "qa",
      tail: "50",
      since: "2026-05-03T09:00"
    }
  );
});

test("client route state helpers normalize Design Run Release lifecycle aliases", () => {
  assert.equal(normalizeLifecycleView("build", ""), "design");
  assert.equal(normalizeLifecycleView("operate", ""), "run");
  assert.equal(normalizeLifecycleView("validate-release", ""), "release");
  assert.equal(normalizeLifecycleView("unknown", "project"), "project");
  assert.equal(normalizeLifecycleView("project", ""), "project");
  assert.equal(normalizeLifecycleView("legacy", ""), "run");
  assert.equal(normalizeLifecycleView("", ""), "project");
  assert.equal(normalizeLifecycleView("", "build"), "design");
  assert.equal(normalizeLifecycleView("", "run"), "run");
  assert.equal(normalizeLifecycleView("", "release"), "release");

  assert.equal(
    buildRouteSearch({
      lifecycle: "design",
      projectHome: true,
      selectedRunId: "",
      selectedReviewId: "",
      selectedLogRoleId: "",
      logTail: "",
      logSince: ""
    }),
    "lifecycle=design"
  );
  assert.equal(
    buildRouteSearch({
      lifecycle: "run",
      projectHome: false,
      selectedRunId: "run-1",
      selectedReviewId: "review-2",
      selectedLogRoleId: "qa",
      logTail: "50",
      logSince: "2026-05-03T09:00"
    }),
    "lifecycle=run&runId=run-1&reviewId=review-2&logRoleId=qa&tail=50&since=2026-05-03T09%3A00"
  );
});

test("runtime renderers fold payload-heavy details by default", () => {
  const stateHtml = renderRunStatePanel({
    state: {
      status: "running",
      activeBranches: { "branch-1": { branchId: "branch-1", roleId: "demo-analyst" } },
      pendingReviewsById: { "review-1": { reviewId: "review-1", currentStatus: "pending" } },
      errors: [{ errorCode: "ROLE_EXECUTION_FAILED", message: "payload too large to scan inline" }],
      auditSummary: {
        payload: { nested: { value: "very long detail" } },
        failureCountsByErrorCode: { TOOL_TIMEOUT: 2 }
      }
    },
    header: {
      status: "running",
      activeBranches: 1,
      pendingReviewCount: 1,
      lastExecutedRoleId: "demo-analyst",
      finalRoleId: "__system_end__"
    },
    graph: {
      nodes: [{ roleId: "demo-analyst" }],
      edges: []
    },
    t
  });
  assert.match(stateHtml, /<details class="event disclosure summary-section notice" open>/);
  assert.match(stateHtml, /payloads and audit details are folded by default|payload 与审计细节默认折叠/);
  assert.match(stateHtml, /<details class="event disclosure warning">/);
  assert.match(stateHtml, /review-1/);
  assert.match(stateHtml, /TOOL_TIMEOUT/);

  const failureHtml = renderFailureDetailPanel({
    loaded: true,
    failure: {
      summary: { errorCode: "ROLE_EXECUTION_FAILED" },
      detail: {
        inputContext: { draft: "x".repeat(240) },
        rawOutput: { body: "y".repeat(260) },
        contract: { contractId: "contract-1", flowKey: "a:b:c", schemaPath: "schemas/out.json" },
        selectedBinding: { bindingKind: "model", resolvedBinding: "gpt-x" },
        allowedEvents: ["DONE"]
      }
    },
    t
  });
  assert.match(failureHtml, /<details class="event disclosure notice">/);
  assert.match(failureHtml, /<details class="event disclosure critical">/);

  const reviewHtml = renderReviewDetailPanel({
    reviewId: "review-1",
    roleId: "demo-analyst",
    branchId: "branch-1",
    currentStatus: "pending",
    decisionPhase: "recorded",
    reviewRequestSnapshot: { payload: "z".repeat(240) },
    decisionSnapshot: { comment: "approved" },
    humanReviewContext: { request: "more context" },
    history: [{ decision: "approve", actor: "ops", decidedAt: "2026-05-09T10:00:00.000Z", comment: "ok" }]
  }, t, formatTime);
  assert.match(reviewHtml, /<details class="event disclosure summary-section" open>/);
  assert.match(reviewHtml, /request snapshot/);

  const artifactsHtml = renderArtifactsPanel({
    detail: {
      runId: "run-1",
      runDir: ".ogs\\/runs\\/run-1",
      header: { status: "done", updatedAt: "2026-05-09T10:00:00.000Z" },
      summary: { payload: "a".repeat(220) },
      resolvedConfig: { nested: { config: true } },
      metrics: { tokens: 42 },
      state: { status: "done" }
    },
    graph: { graph: { nodes: [{ roleId: "demo-analyst" }], edges: [] } },
    reviews: { reviews: [] },
    reviewDetail: null,
    resumeDiagnostics: null,
    t,
    formatTime
  });
  assert.match(artifactsHtml, /<details class="event disclosure summary-section notice" open>/);
  assert.match(artifactsHtml, /<details class="event disclosure">/);
});

test("client release readiness state reports each export blocker category", () => {
  assert.deepEqual(listFromRecord({ entries: [{ id: "a" }, null, "bad"] }, ["entries"]), [{ id: "a" }]);

  const ready = buildReleaseReadinessDecision({
    validation: { ok: true },
    readiness: { blockers: [], contractCoverage: { missingFlowCount: 0 } },
    bindings: { roles: [{ roleId: "writer", effectiveBinding: "model:gpt" }] },
    rolePackages: { roles: [{ roleId: "writer", files: { roleJson: true, promptTemplate: true } }] },
    contracts: { flows: [{ contractId: "flow.done", schemaPath: "schemas/done.json", lastStatus: "covered" }] },
    workbenchDirty: false
  });
  assert.equal(ready.canExport, true);

  const blocked = buildReleaseReadinessDecision({
    validation: { ok: false },
    readiness: {
      blockers: [{ code: "CUSTOM_BLOCKER", message: "custom blocker" }],
      contractCoverage: { missingCount: 2 }
    },
    bindings: { roles: [{ roleId: "writer", resolved: false }] },
    rolePackages: { roles: [{ roleId: "writer", files: { promptTemplate: false } }] },
    contracts: {
      flows: [{ contractId: null, schemaPath: null, lastStatus: "missing" }],
      uncoveredEdges: [{ flowKey: "writer:DONE:output" }]
    },
    workbenchDirty: true
  });
  assert.equal(blocked.canExport, false);
  assert.deepEqual(blocked.blockers.map((blocker) => blocker.code), [
    "RELEASE_DIRTY_WORKBENCH",
    "RELEASE_VALIDATION_FAILED",
    "CUSTOM_BLOCKER",
    "RELEASE_CONTRACT_COVERAGE_MISSING",
    "RELEASE_ARTIFACT_CONTRACT_INCOMPLETE",
    "RELEASE_BINDINGS_UNRESOLVED",
    "RELEASE_ROLE_PACKAGES_UNHEALTHY"
  ]);
});

test("client stream state helpers keep refresh scope explicit", () => {
  assert.deepEqual(appendStreamEntry([{ cursor: 1 }, { cursor: 2 }], { cursor: 2 }, 2), [
    { cursor: 1 },
    { cursor: 2 }
  ]);
  assert.deepEqual(appendStreamEntry([{ cursor: 1 }, { cursor: 2 }], { cursor: 3 }, 2), [
    { cursor: 2 },
    { cursor: 3 }
  ]);
  const cursorIndex = createStreamCursorIndex([{ cursor: 1 }, { cursor: 2 }]);
  assert.deepEqual(appendIndexedStreamEntry([{ cursor: 1 }, { cursor: 2 }], cursorIndex, { cursor: 2 }, 2), [
    { cursor: 1 },
    { cursor: 2 }
  ]);
  const indexed = appendIndexedStreamEntry([{ cursor: 1 }, { cursor: 2 }], cursorIndex, { cursor: 3 }, 2);
  assert.deepEqual(indexed, [
    { cursor: 2 },
    { cursor: 3 }
  ]);
  assert.deepEqual([...cursorIndex].sort((a, b) => a - b), [2, 3]);

  assert.deepEqual(getStreamRefreshPlan("human_review_approved"), {
    detailGraph: true,
    reviews: true,
    reviewDetail: true,
    failure: false,
    resumeReadiness: true,
    markDiagnosticsStale: true
  });
  assert.deepEqual(getStreamRefreshPlan("run_completed"), {
    detailGraph: true,
    reviews: false,
    reviewDetail: false,
    failure: true,
    resumeReadiness: true,
    markDiagnosticsStale: true
  });
  assert.deepEqual(getStreamRefreshPlan("unknown"), {
    detailGraph: false,
    reviews: false,
    reviewDetail: false,
    failure: false,
    resumeReadiness: false,
    markDiagnosticsStale: true
  });
  assert.equal(formatReviewStatusLabel("pending_reconcile"), "pending reconcile");
  assert.equal(formatReviewStatusLabel("waiting_review"), "waiting review");
  assert.equal(formatReviewStatusLabel("custom_state"), "custom state");
});

test("client input policy keeps high-frequency boundaries explicit", () => {
  assert.equal(WORKBENCH_VALIDATION_DEBOUNCE_MS, 250);
  assert.equal(RUN_LIST_SEARCH_MODE, "immediate-local-filter");
  assert.equal(STUDIO_BRIDGE_FILTER_MODE, "immediate-local-filter");
  assert.equal(STUDIO_CHAT_INPUT_MODE, "draft-only");
  assert.equal(PROJECT_INIT_FORM_MODE, "draft-only");
  assert.equal(LOG_FILTER_INPUT_MODE, "commit-on-change");
  assert.deepEqual(
    VISUALIZER_INPUT_BOUNDARIES.map((item) => [item.control, item.mode, item.remoteTrigger]),
    [
      ["workbench-editor", "debounced-remote-validate:250ms", "input settles before /project/system/validate"],
      ["studio-chat-input", "draft-only", "send/regenerate/apply actions only"],
      ["project-create-form", "draft-only", "submit action only"],
      ["search", "immediate-local-filter", "none"],
      ["studio-bridge-filter", "immediate-local-filter", "none"],
      ["log-role/log-tail/log-page-size/log-since", "commit-on-change", "change event reloads selected logs when already loaded"]
    ]
  );
});

test("client shell control renderers keep lifecycle visibility and run-list filtering pure", () => {
  const consoleHtml = renderConsoleTabsHtml({
    consoleTab: "run",
    operateTab: "overview",
    t,
    escapeText
  });
  assert.match(consoleHtml, /data-console-tab="project"/);
  assert.match(consoleHtml, /data-console-tab="design"/);
  assert.match(consoleHtml, /data-console-tab="run"[^>]*aria-pressed="true"/);
  assert.match(consoleHtml, /data-console-tab="run"[^>]*role="tab"[^>]*aria-controls="operate-tabpanel-overview"/);
  assert.match(consoleHtml, /data-console-tab="release"/);
  assert.doesNotMatch(consoleHtml, /data-console-tab="build"/);
  assert.doesNotMatch(consoleHtml, /data-console-tab="operate"/);
  assert.doesNotMatch(consoleHtml, /data-console-tab="legacy"/);
  assert.deepEqual(getVisibleConsolePanelIds({ consoleTab: "project", operateTab: "overview" }), ["project"]);
  assert.deepEqual(getVisibleConsolePanelIds({ consoleTab: "design", operateTab: "overview" }), ["build"]);
  assert.deepEqual(getVisibleConsolePanelIds({ consoleTab: "run", operateTab: "overview" }), ["debug", "ops"]);
  assert.deepEqual(getVisibleConsolePanelIds({ consoleTab: "run", operateTab: "logs" }), ["debug", "logs"]);
  assert.deepEqual(getVisibleConsolePanelIds({ consoleTab: "release", operateTab: "overview" }), ["validate-release"]);
  assert.equal(shouldShowRunSidebar("run"), true);
  assert.equal(shouldShowRunSidebar("design"), false);

  const runListHtml = renderRunListHtml({
    runs: [
      { runId: "run-1", status: "waiting_review", finalRoleId: "writer", lastExecutedRoleId: "writer", transitionCount: 3, updatedAt: "2026-05-04T08:09:10.000Z" },
      { runId: "run-2", status: "done", finalRoleId: "qa", lastExecutedRoleId: "qa", transitionCount: 5, updatedAt: "2026-05-04T08:10:10.000Z" }
    ],
    filter: "writer",
    selectedRunId: "run-1",
    t,
    escapeText,
    formatTime,
    displayUiToken,
    statusClass
  });
  assert.match(runListHtml, /data-run-id="run-1"/);
  assert.doesNotMatch(runListHtml, /data-run-id="run-2"/);
  assert.match(runListHtml, /aria-label="Run run-1 status waiting review run\.transitions 3 run\.updated /);
});

test("client shell control renderers expose only the Project Design Run Release tabs", () => {
  const consoleHtml = renderConsoleTabsHtml({
    consoleTab: "run",
    operateTab: "logs",
    t,
    escapeText
  });
  assert.match(consoleHtml, /data-console-tab="project"/);
  assert.match(consoleHtml, /data-console-tab="design"/);
  assert.match(consoleHtml, /data-console-tab="run"[^>]*aria-pressed="true"/);
  assert.match(consoleHtml, /data-console-tab="run"[^>]*aria-controls="console-panel-logs"/);
  assert.match(consoleHtml, /data-console-tab="release"/);
  assert.doesNotMatch(consoleHtml, /data-console-tab="build"/);
  assert.doesNotMatch(consoleHtml, /data-console-tab="operate"/);
  assert.doesNotMatch(consoleHtml, /data-console-tab="validate-release"/);
  assert.doesNotMatch(consoleHtml, /data-console-tab="legacy"/);
  assert.deepEqual(
    getVisibleConsolePanelIds({
      consoleTab: "design",
      operateTab: "overview"
    }),
    ["build"]
  );
  assert.deepEqual(
    getVisibleConsolePanelIds({
      consoleTab: "run",
      operateTab: "logs"
    }),
    ["debug", "logs"]
  );
  assert.deepEqual(
    getVisibleConsolePanelIds({
      consoleTab: "release",
      operateTab: "overview"
    }),
    ["validate-release"]
  );
  assert.equal(shouldShowRunSidebar("run"), true);
  assert.equal(shouldShowRunSidebar("project"), false);
  assert.equal(shouldShowRunSidebar("design"), false);
  assert.equal(shouldShowRunSidebar("release"), false);
});

test("client shell controls enforce four-tab structure with exclusive panel visibility", () => {
  const allTabs = ["project", "design", "run", "release"];
  for (const tab of allTabs) {
    const html = renderConsoleTabsHtml({ consoleTab: tab, operateTab: "overview", t, escapeText });
    assert.match(html, /data-console-tab="project"/, "project tab missing when active=" + tab);
    assert.match(html, /data-console-tab="design"/, "design tab missing when active=" + tab);
    assert.match(html, /data-console-tab="run"/, "run tab missing when active=" + tab);
    assert.match(html, /data-console-tab="release"/, "release tab missing when active=" + tab);
    assert.doesNotMatch(html, /data-console-tab="build"/, "legacy build tab present when active=" + tab);
    assert.doesNotMatch(html, /data-console-tab="operate"/, "legacy operate tab present when active=" + tab);
    assert.doesNotMatch(html, /data-console-tab="legacy"/, "legacy tab present when active=" + tab);
    const activePattern = new RegExp('data-console-tab="' + tab + '"[^>]*aria-pressed="true"');
    assert.match(html, activePattern, "active tab " + tab + " not pressed");
  }
  const projectPanels = getVisibleConsolePanelIds({ consoleTab: "project", operateTab: "overview" });
  assert.ok(projectPanels.includes("project"), "project panel visible on project tab");
  assert.ok(!projectPanels.includes("build"), "build panel hidden on project tab");
  assert.ok(!projectPanels.includes("debug"), "debug panel hidden on project tab");

  const designPanels = getVisibleConsolePanelIds({ consoleTab: "design", operateTab: "overview" });
  assert.ok(designPanels.includes("build"), "build panel visible on design tab");
  assert.ok(!designPanels.includes("project"), "project panel hidden on design tab");
  assert.ok(!designPanels.includes("debug"), "debug panel hidden on design tab");

  const runPanels = getVisibleConsolePanelIds({ consoleTab: "run", operateTab: "overview" });
  assert.ok(runPanels.includes("debug"), "debug panel visible on run tab");
  assert.ok(!runPanels.includes("project"), "project panel hidden on run tab");
  assert.ok(!runPanels.includes("build"), "build panel hidden on run tab");

  const releasePanels = getVisibleConsolePanelIds({ consoleTab: "release", operateTab: "overview" });
  assert.ok(releasePanels.includes("validate-release"), "validate-release panel visible on release tab");
  assert.ok(!releasePanels.includes("project"), "project panel hidden on release tab");
  assert.ok(!releasePanels.includes("build"), "build panel hidden on release tab");
  assert.ok(!releasePanels.includes("debug"), "debug panel hidden on release tab");
});

test("client lifecycle state factory centralizes initial workspace state", () => {
  assert.deepEqual(createInitialStreamRefreshPlan(), {
    detailGraph: false,
    reviews: false,
    reviewDetail: false,
    failure: false,
    resumeReadiness: false,
    markDiagnosticsStale: false
  });
  const state = createInitialVisualizerState("zh-CN");
  assert.equal(state.locale, "zh-CN");
  assert.equal(state.hasProject, false);
  assert.equal(state.consoleTab, "design");
  assert.equal(state.buildMode, "edit");
  assert.equal(state.workbenchView, "bridge");
  assert.equal(state.operateTab, "overview");
  assert.equal(state.workbenchSavedPath, "system.mmd");
  assert.deepEqual(state.streamRefreshPlan, createInitialStreamRefreshPlan());
  assert.deepEqual(createProjectStateSlice("zh-CN").locale, "zh-CN");
  assert.equal(createBuildStateSlice().buildMode, "edit");
  assert.equal(createOperateStateSlice().selectedRunId, "");
  assert.equal(createReviewStateSlice().selectedReviewId, "");
  assert.equal(createLogsStateSlice().logPageSize, "100");
  assert.equal(createStreamingStateSlice().streamRefreshRunId, "");
});

test("client lifecycle state factory keeps Design Run Release active across explicit state slices", () => {
  const operateState = createOperateStateSlice();
  assert.equal(operateState.consoleTab, "design");

  const state = createInitialVisualizerState("en-US");
  assert.equal(state.locale, "en-US");
  assert.equal(state.consoleTab, "design");
  assert.equal(state.operateTab, "overview");
});

test("visualizer dto project views normalize the supported artifact mode", () => {
  assert.equal(mapProjectTransferView({ mode: "unexpected", project: {} }).mode, "single-project-v1");
});

test("visualizer dto guards preserve finite numbers and booleans after helper consolidation", () => {
  const diagnostics = mapResumeDiagnosticsView({
    runId: "run-1",
    runDir: "/tmp/run-1",
    status: "ready",
    checks: [
      { id: "ok", label: "healthy", ok: true, severity: "info", message: "all good" },
      { id: "fallback", label: "fallback", ok: false, severity: "unexpected" }
    ],
    recommendations: [
      { action: "resume", label: "Resume now" },
      { action: "", label: "ignored" }
    ]
  });
  assert.deepEqual(diagnostics.checks, [
    { id: "ok", label: "healthy", ok: true, severity: "info", message: "all good", detail: undefined },
    { id: "fallback", label: "fallback", ok: false, severity: "error", message: undefined, detail: undefined }
  ]);
  assert.deepEqual(diagnostics.recommendations, [
    { action: "resume", label: "Resume now", detail: undefined }
  ]);

  const failure = mapFailureProjectionView({
    runId: "run-1",
    runDir: "/tmp/run-1",
    status: "failed",
    summary: {
      errorCode: "FAILED",
      message: "boom",
      retryable: false,
      durationMs: Number.POSITIVE_INFINITY
    },
    detail: {
      allowedEvents: ["DONE", 42, ""],
      upstreamRoleIds: ["planner", null, "review"]
    }
  });
  assert.equal(failure.summary.durationMs, undefined);
  assert.equal(failure.summary.retryable, false);
  assert.deepEqual(failure.detail.allowedEvents, ["DONE"]);
  assert.deepEqual(failure.detail.upstreamRoleIds, ["planner", "review"]);
});

test("client lifecycle panel renderers expose workspace and operate tab HTML", () => {
  const empty = renderWorkspaceEmptyStateHtml({ kind: "build", t, escapeText });
  assert.match(empty, /Initialize the current directory before building/);
  assert.match(empty, /Use Project to initialize the current directory/);
  assert.doesNotMatch(empty, /<script/);

  const tabs = renderOperateTabsHtml({ operateTab: "logs", t, escapeText });
  assert.match(tabs, /data-operate-tab="logs"/);
  assert.match(tabs, /class="button subtle active"/);
  assert.match(tabs, /Load engine and role logs on demand/);

  const skeleton = renderLoadingSkeletonHtml({ label: "Loading project data", rows: 4, t, escapeText });
  assert.match(skeleton, /role="status"/);
  assert.match(skeleton, /aria-busy="true"/);
  assert.match(skeleton, /Loading project data/);
  assert.equal((skeleton.match(/class="skeleton-line /g) || []).length, 4);
});

test("client lifecycle panel renderers cover workbench structure, stats, and timeline", () => {
  const structureHtml = renderWorkbenchStructureHtml({
    structure: {
      systemId: "demo.system",
      systemVersion: "1.0.0",
      entryRoleId: "planner",
      roleCount: 1,
      flowCount: 1,
      roles: [{ roleId: "planner", bindingKind: "model", routingMode: "single" }],
      flows: [{ fromRoleId: "planner", toRoleId: "output", eventType: "DONE", label: "完成" }]
    },
    t,
    escapeText
  });
  assert.match(structureHtml, /demo\.system/);
  assert.match(structureHtml, /planner/);
  assert.match(structureHtml, /完成/);
  assert.match(renderWorkbenchStructureHtml({ structure: null, t, escapeText }), /workbench\.structurePending/);

  const statsHtml = renderRunStatsHtml({
    header: {
      status: "running",
      runMode: "runtime",
      transitionCount: 3,
      activeBranches: 1,
      pendingReviewCount: 2,
      recentAudits: 4
    },
    graphPayload: { simulation: { mode: "dry_run" } },
    t,
    escapeText,
    displayUiToken
  });
  assert.match(statsHtml, /running/);
  assert.match(statsHtml, /dry run/);
  assert.match(statsHtml, />3</);

  const emptyTimeline = renderTimelineHtml({
    events: [],
    filters: { roleId: "planner", type: "", status: "", branchId: "", reviewId: "", errorCode: "" },
    t,
    escapeText,
    statusClass,
    displayUiToken,
    formatTime
  });
  assert.match(emptyTimeline, /role=planner/);

  const timeline = renderTimelineHtml({
    events: [{
      cursor: 7,
      record: {
        type: "run_started",
        roleId: "planner",
        event: "START",
        status: "running",
        at: "2026-05-03T09:00:00Z"
      }
    }],
    filters: {},
    t,
    escapeText,
    statusClass,
    displayUiToken,
    formatTime
  });
  assert.match(timeline, /#7 run started/);
  assert.match(timeline, /<code>planner<\/code>/);
  assert.match(timeline, /time:2026-05-03T09:00:00Z/);
});

test("client lifecycle panel renderers cover Workbench controls and modes", () => {
  const statusHtml = renderWorkbenchStatusHtml({
    dirty: true,
    entryRoleId: "planner",
    lastDryRunId: "dry-1",
    validation: { ok: false },
    diagnostics: [{ code: "ERR" }],
    hasDraft: true,
    validating: true,
    t,
    escapeText
  });
  assert.match(statusHtml, /planner/);
  assert.match(statusHtml, /dry-1/);
  assert.match(statusHtml, /workbench\.diagnostics/);
  assert.match(statusHtml, /workbench\.draftCached/);

  const modeTabsHtml = renderWorkbenchModeTabsHtml({ buildMode: "dry-run", t, escapeText });
  assert.equal(modeTabsHtml, "");
  assert.match(renderWorkbenchViewTabsHtml({ buildMode: "edit", workbenchView: "source", t, escapeText }), /data-workbench-view="source"/);
  assert.match(renderWorkbenchViewTabsHtml({ buildMode: "debug", workbenchView: "source", t, escapeText }), /data-workbench-view="source"/);
  assert.match(renderWorkbenchActionsHtml({ dirty: false, t, escapeText }), /id="build-save" disabled/);
  assert.equal(renderWorkbenchModeBodyHtml({
    buildMode: "debug",
    workbenchView: "bridge",
    dirty: false,
    workbenchSavedPath: "system.mmd",
    lastDryRunId: "dry-1",
    hasDraft: false,
    workbenchSource: "",
    t,
    escapeText
  }), "");

  const sourceHtml = renderWorkbenchModeBodyHtml({
    buildMode: "edit",
    workbenchView: "source",
    dirty: true,
    workbenchSavedPath: "system.mmd",
    lastDryRunId: "",
    hasDraft: true,
    workbenchSource: "flowchart TD\ninput --> output",
    t,
    escapeText
  });
  assert.match(sourceHtml, /id="workbench-recover-draft"/);
  assert.match(sourceHtml, /id="workbench-revert"/);
  assert.match(sourceHtml, /id="workbench-source-actions-controls"/);
  assert.match(sourceHtml, /flowchart TD/);
});

test("client renderer graph canvas escapes selected ids before composing HTML", () => {
  const html = renderStudioGraphCanvas({
    selectedRoleId: 'planner"><script>alert(1)</script>',
    selectedFlowKey: "flow<'unsafe'>",
    t
  });
  assert.match(html, /planner&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /flow&lt;&#39;unsafe&#39;&gt;/);
  assert.match(html, /data-studio-side-tab="debug"/);
  assert.match(html, /data-studio-selection-panel="debug"/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("client project workspace maps stable create error codes", () => {
  assert.deepEqual(projectCreateErrorFromResponse({ code: "INVALID_PROJECT_NAME" }, t), {
    code: "INVALID_PROJECT_NAME",
    message: "Use a project name that starts with a letter or number."
  });
  assert.deepEqual(projectCreateErrorFromResponse({ errorCode: "UNKNOWN", message: "custom failure" }, t), {
    code: "UNKNOWN",
    message: "custom failure"
  });
});

test("client project/studio controller binders delegate interactions without owning state", () => {
  const actionButton = new FakeBoundElement({ "data-project-action": "build" });
  const projectNameInput = new FakeBoundElement({}, "Demo");
  const templateSelect = new FakeBoundElement({}, "empty");
  const createForm = new FakeBoundElement({}, "", {
    "input, select": [projectNameInput, templateSelect]
  });
  const root = new FakeQueryRoot({
    "[data-project-action]": [actionButton]
  });
  const byId = {
    "project-create-form": createForm
  };
  const calls = [];
  bindProjectWizardControls({
    root,
    getElementById: (id) => byId[id] || null,
    onCreateSubmit: () => calls.push(["create-submit"]),
    onDraftFormChange: () => calls.push(["draft-change"]),
    onAction: (value) => calls.push(["action", value])
  });
  createForm.dispatch("submit");
  projectNameInput.dispatch("input", "Review");
  templateSelect.dispatch("change", "minimal");
  actionButton.dispatch("click");
  assert.deepEqual(calls, [
    ["create-submit"],
    ["draft-change"],
    ["draft-change"],
    ["action", "build"]
  ]);

  const roleButton = new FakeBoundElement({ "data-studio-role-id": "planner" });
  const flowButton = new FakeBoundElement({ "data-studio-flow-key": "planner:DONE:output" });
  const filterInput = new FakeBoundElement({}, "需求");
  const listModeSelect = new FakeBoundElement({}, "flows");
  const studioRoot = new FakeQueryRoot({
    "[data-studio-role-id]": [roleButton],
    "[data-studio-flow-key]": [flowButton]
  });
  const studioCalls = [];
  bindStudioBridgeControlsModule({
    root: studioRoot,
    findElement: (selector) => selector === "[data-studio-bridge-filter]"
      ? filterInput
      : selector === "[data-studio-bridge-list-mode]"
        ? listModeSelect
        : null,
    onRoleSelect: (value) => studioCalls.push(["role", value]),
    onFlowSelect: (value) => studioCalls.push(["flow", value]),
    onFilterInput: (value) => studioCalls.push(["filter", value]),
    onListModeChange: (value) => studioCalls.push(["mode", value])
  });
  roleButton.dispatch("click");
  flowButton.dispatch("click");
  filterInput.dispatch("input", "需求");
  listModeSelect.dispatch("change", "flows");
  assert.deepEqual(studioCalls, [
    ["role", "planner"],
    ["flow", "planner:DONE:output"],
    ["filter", "需求"],
    ["mode", "flows"]
  ]);

  const chatById = {
    "studio-chat-toggle": new FakeBoundElement(),
    "studio-chat-input": new FakeBoundElement({}, "补充"),
    "studio-chat-send": new FakeBoundElement(),
    "studio-chat-close": new FakeBoundElement(),
    "studio-chat-regenerate": new FakeBoundElement(),
    "studio-chat-refine": new FakeBoundElement(),
    "studio-chat-apply": new FakeBoundElement(),
    "studio-chat-save-draft": new FakeBoundElement()
  };
  const chatCalls = [];
  bindStudioChatControlsModule({
    getElementById: (id) => chatById[id] || null,
    onToggle: () => chatCalls.push("toggle"),
    onInput: (value) => chatCalls.push(["input", value]),
    onSend: () => chatCalls.push("send"),
    onClose: () => chatCalls.push("close"),
    onRegenerate: () => chatCalls.push("regenerate"),
    onRefine: () => chatCalls.push("refine"),
    onApply: () => chatCalls.push("apply"),
    onSaveDraft: () => chatCalls.push("save-draft")
  });
  chatById["studio-chat-toggle"].dispatch("click");
  chatById["studio-chat-input"].dispatch("input", "补充");
  chatById["studio-chat-send"].dispatch("click");
  chatById["studio-chat-close"].dispatch("click");
  chatById["studio-chat-regenerate"].dispatch("click");
  chatById["studio-chat-refine"].dispatch("click");
  chatById["studio-chat-apply"].dispatch("click");
  chatById["studio-chat-save-draft"].dispatch("click");
  assert.deepEqual(chatCalls, [
    "toggle",
    ["input", "补充"],
    "send",
    "close",
    "regenerate",
    "refine",
    "apply",
    "save-draft"
  ]);
});

test("client run data loaders keep fetch scope and deferred-load gating explicit", async () => {
  assert.equal(
    buildLogsQuery({
      apiPrefix: "/api",
      runId: "run 1",
      engine: true,
      logPageSize: "250",
      logSince: "2026-05-03T01:00:00.000Z"
    }),
    "/api/runs/run%201/logs?engine=true&tail=250&since=2026-05-03T01%3A00%3A00.000Z"
  );

  const requests = [];
  const requestJson = async (path) => {
    requests.push(path);
    if (path.includes("engine=true")) {
      return { records: [{ scope: "engine" }] };
    }
    if (path.includes("roleId=planner")) {
      return { records: [{ scope: "planner" }] };
    }
    if (path.includes("roleId=qa")) {
      return { records: [{ scope: "qa" }] };
    }
    return { records: [] };
  };

  const allLogs = await fetchSelectedLogs({
    requestJson,
    apiPrefix: "/api",
    runId: "run-1",
    graphPayload: {
      graph: {
        nodes: [{ roleId: "planner" }, { roleId: "qa" }, { roleId: "" }]
      }
    },
    logTail: "100"
  });
  assert.deepEqual(allLogs, {
    engineLogs: [{ scope: "engine" }],
    roleLogs: [{ scope: "planner" }, { scope: "qa" }]
  });
  assert.equal(requests.length, 3);

  const selectedLogs = await fetchSelectedLogs({
    requestJson,
    apiPrefix: "/api",
    runId: "run-1",
    selectedLogRoleId: "planner",
    graphPayload: {
      graph: {
        nodes: [{ roleId: "planner" }, { roleId: "qa" }]
      }
    },
    logPageSize: "50"
  });
  assert.deepEqual(selectedLogs, {
    engineLogs: [{ scope: "engine" }],
    roleLogs: [{ scope: "planner" }]
  });

  const roleInFlight = new Set();
  let maxConcurrent = 0;
  const batchedRequests = [];
  const batchedRequestJson = async (path) => {
    batchedRequests.push(path);
    if (path.includes("engine=true")) {
      return { records: [{ scope: "engine" }] };
    }
    const roleId = new URL(path, "http://visualizer.test").searchParams.get("roleId");
    roleInFlight.add(roleId);
    maxConcurrent = Math.max(maxConcurrent, roleInFlight.size);
    await Promise.resolve();
    roleInFlight.delete(roleId);
    return { records: [{ scope: roleId }] };
  };
  const batchedLogs = await fetchSelectedLogs({
    requestJson: batchedRequestJson,
    apiPrefix: "/api",
    runId: "run-1",
    graphPayload: {
      graph: {
        nodes: [{ roleId: "a" }, { roleId: "b" }, { roleId: "c" }, { roleId: "d" }, { roleId: "e" }]
      }
    }
  });
  assert.equal(maxConcurrent <= 4, true);
  assert.deepEqual(batchedLogs.roleLogs.map((item) => item.scope), ["a", "b", "c", "d", "e"]);
  assert.equal(
    batchedRequests.filter((path) => path.includes("roleId=") || path.includes("engine=true")).length,
    6
  );

  assert.equal(shouldSkipDeferredPanelLoad({ runId: "", loaded: false }), true);
  assert.equal(shouldSkipDeferredPanelLoad({ runId: "run-1", actionBusy: true, internal: false }), true);
  assert.equal(shouldSkipDeferredPanelLoad({ runId: "run-1", loaded: true, stale: false, force: false }), true);
  assert.equal(shouldSkipDeferredPanelLoad({ runId: "run-1", loaded: true, stale: true, force: false }), false);
  assert.equal(shouldSkipDeferredPanelLoad({ runId: "run-1", actionBusy: true, internal: true }), false);

  const failure = await fetchFailureData({ requestJson, apiPrefix: "/api", runId: "run-1" });
  const readiness = await fetchResumeReadinessData({ requestJson, apiPrefix: "/api", runId: "run-1" });
  const diagnostics = await fetchResumeDiagnosticsData({ requestJson, apiPrefix: "/api", runId: "run-1" });
  assert.deepEqual(failure, { records: [] });
  assert.deepEqual(readiness, { records: [] });
  assert.deepEqual(diagnostics, { records: [] });
});

test("client Studio Bridge topology sorting keeps stable role and flow order", () => {
  const roles = [
    { roleId: "qa" },
    { roleId: "writer" },
    { roleId: "input" },
    { roleId: "publisher" },
    { roleId: "cycle" }
  ];
  const flows = [
    { flowKey: "writer:DONE:qa", fromRoleId: "writer", toRoleId: "qa", eventType: "DONE" },
    { flowKey: "input:START:writer", fromRoleId: "input", toRoleId: "writer", eventType: "START" },
    { flowKey: "qa:APPROVE:publisher", fromRoleId: "qa", toRoleId: "publisher", eventType: "APPROVE" },
    { flowKey: "cycle:LOOP:cycle", fromRoleId: "cycle", toRoleId: "cycle", eventType: "LOOP" }
  ];
  const orderedRoles = sortStudioBridgeRolesTopologically(roles, flows);
  assert.deepEqual(orderedRoles.map((role) => role.roleId), ["input", "cycle", "writer", "qa", "publisher"]);

  const orderedFlows = sortStudioBridgeFlowsByTopology(flows, orderedRoles);
  assert.deepEqual(orderedFlows.map((flow) => flow.flowKey), [
    "input:START:writer",
    "cycle:LOOP:cycle",
    "writer:DONE:qa",
    "qa:APPROVE:publisher"
  ]);
});

test("client run selection helpers keep review fallback and live state deterministic", () => {
  assert.equal(
    selectReviewId({
      currentReviewId: "review-2",
      reviewsPayload: {
        latestPendingReviewId: "review-3",
        reviews: [{ reviewId: "review-1" }, { reviewId: "review-2" }]
      }
    }),
    "review-2"
  );
  assert.equal(
    selectReviewId({
      currentReviewId: "missing",
      reviewsPayload: {
        latestPendingReviewId: "review-3",
        reviews: [{ reviewId: "review-1" }, { reviewId: "review-2" }]
      }
    }),
    "review-3"
  );
  assert.equal(
    selectReviewId({
      currentReviewId: "",
      reviewsPayload: {
        reviews: [{ reviewId: "review-1" }, { reviewId: "review-2" }]
      }
    }),
    "review-1"
  );
  assert.equal(fallbackLogRoleId({ lastExecutedRoleId: "qa", finalRoleId: "writer" }), "qa");
  assert.equal(fallbackLogRoleId({ finalRoleId: "writer" }), "writer");
  assert.deepEqual(resolveRunLiveState({ status: "running" }), { mode: "online", label: "running" });
  assert.deepEqual(resolveRunLiveState({ status: "failed" }), { mode: "idle", label: "failed" });
  assert.deepEqual(resolveRunLiveState({ status: "paused", hasWaitingHumanReview: true }), {
    mode: "idle",
    label: "waiting_review"
  });
});

test("client Studio chat panel keeps apply gating and display context pure", () => {
  assert.equal(studioChatModeLabel("ask", t), "needs input");
  assert.equal(studioChatCanApply(null), false);
  assert.equal(studioChatCanApply({ authoringPatch: { authoring: {} }, validation: { project: { ok: true } } }), true);
  assert.equal(
    studioChatCanApply({
      authoringPatch: { authoring: {} },
      actions: [{ id: "apply-authoring-patch", enabled: false }]
    }),
    false
  );

  const html = renderStudioChatPanelHtml({
    state: {
      studioChatDialogOpen: true,
      studioChatCollapsed: false,
      actionBusy: "",
      studioChatMessages: [{ role: "user", mode: "ask", text: "生成流程" }],
      studioChatDraftMessage: "补充中文标签",
      studioChatLastRequest: "生成流程",
      studioBridgeSelectedRoleId: "requirements_analyst",
      studioBridgeSelectedFlowKey: "",
      studioBridge: { authoring: {} },
      studioChatResult: {
        mode: "final",
        summary: "Ready to apply",
        previewMermaid: "flowchart TD",
        questions: ["Use reviewer?"],
        assumptions: ["Stable IDs remain ASCII"],
        warnings: ["Display labels only"],
        authoringPatch: { authoring: {} },
        validation: { project: { ok: true, diagnostics: [] } }
      }
    },
    t,
    escapeText
  });
  assert.match(html, /role requirements_analyst/);
  assert.match(html, /role="region"/);
  assert.doesNotMatch(html, /role="dialog"/);
  assert.doesNotMatch(html, /aria-modal="false"/);
  assert.match(html, /生成流程/);
  assert.match(html, /flowchart TD/);
  assert.match(html, /id="studio-chat-apply"/);
  assert.doesNotMatch(html, /id="studio-chat-apply" disabled/);
});

test("workbench source editor is accessible by label", () => {
  const html = renderWorkbenchModeBodyHtml({
    buildMode: "edit",
    workbenchView: "source",
    dirty: false,
    workbenchSavedPath: "system.mmd",
    lastDryRunId: "",
    hasDraft: false,
    workbenchSource: "flowchart TD",
    t,
    escapeText
  });
  assert.match(html, /aria-label="Graph source editor"/);
});

test("operate tabs and Studio Bridge filters expose accessible state and names", () => {
  const tabsHtml = renderOperateTabsHtml({
    operateTab: "logs",
    t,
    escapeText
  });
  assert.match(tabsHtml, /data-operate-tab="logs"[^>]*aria-pressed="true"/);
  assert.match(tabsHtml, /data-operate-tab="overview"[^>]*aria-pressed="false"/);

  const bridgeHtml = renderStudioBridgePanel({
    bridge: {
      validation: { ok: true, diagnostics: [] },
      extracted: {
        systemId: "demo.system",
        systemVersion: "1.0.0",
        entryRoleId: "writer",
        lawGlobal: "law.minimal",
        roles: [{ roleId: "writer", bindingKind: "model", incomingFlowCount: 0, outgoingFlowCount: 0, allowedEvents: [], badges: [] }],
        flows: []
      }
    },
    readiness: {},
    selectedRoleId: "",
    selectedFlowKey: "",
    filter: "",
    listMode: "all",
    actionBusy: "",
    t
  });
  assert.match(bridgeHtml, /data-studio-bridge-filter="1"[^>]*aria-label="Filter roles or flows"/);
  assert.match(bridgeHtml, /data-studio-bridge-list-mode="1"[^>]*aria-label="Browse"/);
});
