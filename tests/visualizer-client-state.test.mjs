import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRouteSearch,
  normalizeLifecycleView,
  readRouteStateFromSearch
} from "../dist/visualizer/client-route-state.js";
import {
  buildReleaseReadinessDecision,
  listFromRecord
} from "../dist/visualizer/client-release-readiness.js";
import {
  appendStreamEntry,
  formatReviewStatusLabel,
  getStreamRefreshPlan
} from "../dist/visualizer/client-stream-state.js";

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
