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
  mapProjectLoadView,
  mapProjectTransferView
} from "../dist/visualizer/dto.js";
import { bindProjectWizardControls } from "../dist/visualizer/client-project-menu-controls.js";
import {
  projectCreateErrorFromResponse,
  projectOpenMessageFromResponse
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
  renderRunTopologySvg,
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
    projectTab: "",
    runId: "",
    reviewId: "",
    logRoleId: "",
    tail: "",
    since: ""
  });
  assert.equal(normalizeLifecycleView("operate", ""), "operate");
  assert.equal(normalizeLifecycleView("unknown", "project"), "project");
  assert.equal(normalizeLifecycleView("", "operate"), "operate");
  assert.equal(normalizeLifecycleView("unknown", "legacy"), "legacy");

  assert.equal(
    buildRouteSearch({
      lifecycle: "project",
      projectTab: "recent",
      projectHome: true,
      selectedRunId: "",
      selectedReviewId: "",
      selectedLogRoleId: "",
      logTail: "",
      logSince: ""
    }),
    "lifecycle=project&view=project&projectTab=recent"
  );
  assert.deepEqual(
    readRouteStateFromSearch("?lifecycle=operate&runId=run-1&reviewId=review-2&logRoleId=qa&tail=50&since=2026-05-03T09%3A00"),
    {
      view: "",
      lifecycle: "operate",
      projectTab: "",
      runId: "run-1",
      reviewId: "review-2",
      logRoleId: "qa",
      tail: "50",
      since: "2026-05-03T09:00"
    }
  );
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
    rolePackages: { roles: [{ roleId: "writer", health: { promptTemplate: false } }] },
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
  assert.equal(state.consoleTab, "project");
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

test("visualizer dto project views normalize the supported artifact mode", () => {
  assert.equal(mapProjectTransferView({ mode: "unexpected", project: {} }).mode, "single-project-v1");
  assert.equal(mapProjectLoadView({ mode: "unexpected", loadedFiles: [] }).mode, "single-project-v1");
});

test("client lifecycle panel renderers expose workspace and operate tab HTML", () => {
  const empty = renderWorkspaceEmptyStateHtml({ kind: "build", t, escapeText });
  assert.match(empty, /Create or load a project before building/);
  assert.match(empty, /Use Project to create a project/);
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

  assert.match(renderWorkbenchModeTabsHtml({ buildMode: "dry-run", t, escapeText }), /data-build-mode="dry-run"/);
  assert.match(renderWorkbenchViewTabsHtml({ buildMode: "edit", workbenchView: "source", t, escapeText }), /data-workbench-view="source"/);
  assert.equal(renderWorkbenchViewTabsHtml({ buildMode: "debug", workbenchView: "source", t, escapeText }), "");
  assert.match(renderWorkbenchActionsHtml({ dirty: false, t, escapeText }), /id="build-save" disabled/);

  const dryRunHtml = renderWorkbenchModeBodyHtml({
    buildMode: "dry-run",
    workbenchView: "bridge",
    dirty: false,
    workbenchSavedPath: "system.mmd",
    lastDryRunId: "dry-1",
    hasDraft: false,
    workbenchSource: "",
    t,
    escapeText
  });
  assert.match(dryRunHtml, /dry-1/);
  assert.match(dryRunHtml, /Dry run uses system\.mmd/);

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
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("client project workspace maps stable create error codes", () => {
  assert.deepEqual(projectCreateErrorFromResponse({ code: "INVALID_PROJECT_ID" }, t), {
    code: "INVALID_PROJECT_ID",
    message: "Use a project id with letters, numbers, dots, underscores, or hyphens."
  });
  assert.deepEqual(projectCreateErrorFromResponse({ errorCode: "UNKNOWN", message: "custom failure" }, t), {
    code: "UNKNOWN",
    message: "custom failure"
  });
});

test("client project workspace maps stable project-open codes", () => {
  assert.deepEqual(projectOpenMessageFromResponse({ code: "PROJECT_OPEN_READY" }, t), {
    code: "PROJECT_OPEN_READY",
    message: "OGSystem project is ready to open."
  });
  assert.deepEqual(
    projectOpenMessageFromResponse(
      {
        code: "PROJECT_OPEN_DIR_CONFLICT",
        message: "Directory is not empty and is not an OGSystem project."
      },
      t
    ),
    {
      code: "PROJECT_OPEN_DIR_CONFLICT",
      message: "Directory is not empty and is not an OGSystem project."
    }
  );
  assert.deepEqual(
    projectOpenMessageFromResponse({ errorCode: "UNKNOWN", message: "custom open failure" }, t),
    {
      code: "UNKNOWN",
      message: "custom open failure"
    }
  );
});

test("client project/studio controller binders delegate interactions without owning state", () => {
  const projectMenuButton = new FakeBoundElement({ "data-project-menu-tab": "open" });
  const browseButton = new FakeBoundElement({ "data-project-open-browse": "/tmp/project-a" });
  const projectButton = new FakeBoundElement({ "data-project-open-project": "/tmp/project-b" });
  const recentButton = new FakeBoundElement({ "data-project-open-recent": "/tmp/project-c" });
  const openInput = new FakeBoundElement({}, "/tmp/current");
  const refreshBrowseButton = new FakeBoundElement();
  const validateBrowseButton = new FakeBoundElement();
  const roleFilterInput = new FakeBoundElement({}, "qa");
  const pageSizeSelect = new FakeBoundElement({}, "24");
  const createForm = new FakeBoundElement({}, "", {
    "input, select": [roleFilterInput, pageSizeSelect]
  });
  const openForm = new FakeBoundElement();
  const prevButton = new FakeBoundElement();
  const nextButton = new FakeBoundElement();
  const root = new FakeQueryRoot({
    "[data-project-menu-tab]": [projectMenuButton],
    "[data-project-open-browse]": [browseButton],
    "[data-project-open-project]": [projectButton],
    "[data-project-open-recent]": [recentButton]
  });
  const byId = {
    "project-open-workdir": openInput,
    "project-open-browse-refresh": refreshBrowseButton,
    "project-open-validate": validateBrowseButton,
    "project-open-form": openForm,
    "project-create-form": createForm,
    "project-role-catalog-filter": roleFilterInput,
    "project-role-page-size": pageSizeSelect,
    "project-role-prev": prevButton,
    "project-role-next": nextButton
  };
  const calls = [];
  bindProjectWizardControls({
    root,
    getElementById: (id) => byId[id] || null,
    onMenuTab: (value) => calls.push(["menu", value]),
    onOpenDraftInput: (value) => calls.push(["draft", value]),
    onRefreshBrowse: () => calls.push(["refresh"]),
    onValidateBrowse: () => calls.push(["validate"]),
    onOpenSubmit: (value) => calls.push(["open-submit", value]),
    onBrowseSelect: (value) => calls.push(["browse", value]),
    onProjectSelect: (value) => calls.push(["project", value]),
    onRecentSelect: (value) => calls.push(["recent", value]),
    onCreateSubmit: () => calls.push(["create-submit"]),
    onDraftFormChange: () => calls.push(["draft-change"]),
    onRoleFilter: (value) => calls.push(["role-filter", value]),
    onPageSize: (value) => calls.push(["page-size", value]),
    onPrevPage: () => calls.push(["prev"]),
    onNextPage: () => calls.push(["next"]),
    autoBrowse: () => calls.push(["auto-browse"])
  });
  projectMenuButton.dispatch("click");
  openInput.dispatch("input", "/tmp/next");
  refreshBrowseButton.dispatch("click");
  validateBrowseButton.dispatch("click");
  openForm.dispatch("submit");
  browseButton.dispatch("click");
  projectButton.dispatch("click");
  recentButton.dispatch("click");
  createForm.dispatch("submit");
  roleFilterInput.dispatch("input", "review");
  pageSizeSelect.dispatch("change", "24");
  prevButton.dispatch("click");
  nextButton.dispatch("click");
  assert.deepEqual(calls, [
    ["auto-browse"],
    ["menu", "open"],
    ["draft", "/tmp/next"],
    ["refresh"],
    ["validate"],
    ["open-submit", "/tmp/next"],
    ["browse", "/tmp/project-a"],
    ["project", "/tmp/project-b"],
    ["recent", "/tmp/project-c"],
    ["create-submit"],
    ["draft-change"],
    ["role-filter", "review"],
    ["draft-change"],
    ["page-size", "24"],
    ["prev"],
    ["next"]
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

test("client run topology SVG exposes node and edge accessibility descriptions", () => {
  const svg = renderRunTopologySvg({
    entryRoleId: "planner",
    nodes: [
      {
        roleId: "planner",
        nodeType: "role",
        status: "waiting_review",
        bindingKind: "model",
        activeBranchCount: 1,
        pendingReviewCount: 2,
        lastSelectedEvent: "PLAN"
      },
      {
        roleId: "qa",
        nodeType: "role",
        status: "failed",
        bindingKind: "profile",
        activeBranchCount: 0,
        pendingReviewCount: 0,
        lastErrorCode: "E_QA"
      }
    ],
    edges: [
      {
        sourceRoleId: "planner",
        targetRoleId: "qa",
        event: "DONE",
        recentlyActivated: true
      },
      {
        sourceRoleId: "qa",
        targetRoleId: "planner",
        event: "ERROR",
        isErrorFlow: true
      }
    ]
  }, t);

  assert.match(svg, /<title>Run topology graph<\/title>/);
  assert.match(svg, /<desc>Run topology graph with 2 nodes and 2 edges\.<\/desc>/);
  assert.match(svg, /<title>planner: role, waiting review, active branches 1 · pending reviews 2, PLAN<\/title>/);
  assert.match(svg, /<desc>qa: role, failed, active branches 0 · pending reviews 0, E_QA<\/desc>/);
  assert.match(svg, /<title>planner to qa on DONE: recently activated flow<\/title>/);
  assert.match(svg, /<desc>qa to planner on ERROR: error flow<\/desc>/);
  assert.match(svg, /stroke-dasharray="2 6"/);
  assert.match(svg, /stroke-dasharray="8 5"/);
  assert.match(svg, />DONE \*<\/text>/);
  assert.match(svg, />ERROR !<\/text>/);
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
  assert.match(html, /aria-label="Workbench source editor"/);
});
