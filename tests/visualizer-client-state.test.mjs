import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRouteSearch,
  normalizeLifecycleView,
  readRouteStateFromSearch
} from "../dist/visualizer/client-route-state.js";
import {
  renderOperateTabsHtml,
  renderRunStatsHtml,
  renderTimelineHtml,
  renderWorkbenchStructureHtml,
  renderWorkspaceEmptyStateHtml
} from "../dist/visualizer/client-lifecycle-panels.js";
import {
  createInitialStreamRefreshPlan,
  createInitialVisualizerState
} from "../dist/visualizer/client-lifecycle-state.js";
import { projectCreateErrorFromResponse } from "../dist/visualizer/client-project-workspace.js";
import {
  renderStudioChatPanelHtml,
  studioChatCanApply,
  studioChatModeLabel
} from "../dist/visualizer/client-studio-chat-panel.js";
import {
  buildReleaseReadinessDecision,
  listFromRecord
} from "../dist/visualizer/client-release-readiness.js";
import {
  appendStreamEntry,
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
  assert.equal(state.consoleTab, "project");
  assert.equal(state.buildMode, "edit");
  assert.equal(state.workbenchView, "bridge");
  assert.equal(state.operateTab, "overview");
  assert.equal(state.workbenchSavedPath, "system.mmd");
  assert.deepEqual(state.streamRefreshPlan, createInitialStreamRefreshPlan());
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
  assert.match(html, /生成流程/);
  assert.match(html, /flowchart TD/);
  assert.match(html, /id="studio-chat-apply"/);
  assert.doesNotMatch(html, /id="studio-chat-apply" disabled/);
});
