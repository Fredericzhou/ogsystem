import test from "node:test";
import assert from "node:assert/strict";

import {
  appendStreamEntry,
  buildRouteSearch,
  getStreamRefreshPlan,
  readRouteStateFromSearch
} from "../dist/visualizer/client-app.js";

test("visualizer client route helpers round-trip query state", () => {
  const search = buildRouteSearch({
    projectHome: false,
    selectedRunId: "run-123",
    selectedReviewId: "review-1",
    selectedLogRoleId: "alpha",
    logTail: "25",
    logSince: "2026-04-23T10:11"
  });
  assert.equal(
    search,
    "runId=run-123&reviewId=review-1&logRoleId=alpha&tail=25&since=2026-04-23T10%3A11"
  );
  assert.deepEqual(readRouteStateFromSearch(`?${search}`), {
    view: "",
    runId: "run-123",
    reviewId: "review-1",
    logRoleId: "alpha",
    tail: "25",
    since: "2026-04-23T10:11"
  });
});

test("visualizer client stream helpers dedupe timeline entries and cap history", () => {
  const first = appendStreamEntry([{ cursor: 1 }, { cursor: 2 }], { cursor: 2 }, 2);
  assert.deepEqual(first, [{ cursor: 1 }, { cursor: 2 }]);

  const second = appendStreamEntry([{ cursor: 1 }, { cursor: 2 }], { cursor: 3 }, 2);
  assert.deepEqual(second, [{ cursor: 2 }, { cursor: 3 }]);
});

test("visualizer client stream refresh plan keeps review and runtime refreshes targeted", () => {
  assert.deepEqual(getStreamRefreshPlan("human_review_requested"), {
    detailGraph: true,
    reviews: true,
    reviewDetail: true,
    markDiagnosticsStale: true
  });
  assert.deepEqual(getStreamRefreshPlan("runtime_error"), {
    detailGraph: true,
    reviews: false,
    reviewDetail: false,
    markDiagnosticsStale: true
  });
  assert.deepEqual(getStreamRefreshPlan("audit"), {
    detailGraph: true,
    reviews: false,
    reviewDetail: false,
    markDiagnosticsStale: true
  });
});
