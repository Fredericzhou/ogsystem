import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";

import {
  loadConversationRunProjection,
  normalizeConversationItemStatus,
  presentationChannelForRoute,
  projectConversationRun,
  projectConversationRunWithDiagnostics
} from "../dist/runtime/conversation-projector.js";

const at = "2026-09-03T00:00:00.000Z";

test("conversation projection maps generic flow channels without creating a feedback seat", () => {
  const projection = projectConversationRun({
    runId: "run-contract",
    systemId: "generic-system",
    events: [
      { type: "audit", roleId: "a", branchId: "a@0#1", lineageId: "line-a", loopIteration: 0, selectedEvent: "DONE", status: "ok", content: "token=secret-value", at },
      { type: "audit", roleId: "b", branchId: "b@0#2", lineageId: "line-a", selectedEvent: "FEEDBACK", channel: "feedback", targetRoleId: "a", status: "ok", at },
      { type: "route_decision", roleId: "a", targetRoleId: "b", channel: "main", condition: "all_of", outcome: "selected", status: "active", at },
      { type: "error_flow", roleId: "a", targetRoleId: "error-handler", channel: "error", errorCode: "TOOL_FAILED", status: "failed", at },
      { type: "loop_round", roleId: "a", targetRoleId: "a", channel: "loop", backEdge: true, loopIteration: 2, status: "active", at }
    ]
  });

  assert.equal(projection.items.length, 5);
  assert.equal(projection.items.filter((item) => item.roleId === "feedback").length, 0);
  assert.equal(projection.items[1].route.channel, "feedback");
  assert.equal(projection.items[1].route.presentationChannel, "normal");
  assert.equal(projection.items[2].kind, "route_decision");
  assert.equal(projection.items[2].route.presentationChannel, "primary");
  assert.equal(projection.items[3].kind, "error_flow");
  assert.equal(projection.items[3].route.presentationChannel, "error");
  assert.equal(projection.items[4].kind, "loop_round");
  assert.equal(projection.items[4].route.presentationChannel, "backEdge");
  assert.equal(projection.items[4].route.backEdge, true);
  assert.equal(projection.items[0].content.redacted, true);
  assert.doesNotMatch(projection.items[0].content.text, /secret-value/);
});

test("conversation projection covers joins, snapshot results, review lifecycle, and typed locators", () => {
  const projection = projectConversationRun({
    runId: "run-snapshot",
    systemId: "generic-system",
    events: [
      { type: "join_activated", roleId: "join", joinId: "join-1", joinMode: "quorum_of", joinSources: ["a", "b"], satisfiedSources: ["a"], status: "activated", at },
      { type: "human_review_requested", roleId: "reviewer", branchId: "reviewer@0#1", lineageId: "line-r", reviewId: "review-pending", status: "pending", at },
      { type: "human_review_approved", roleId: "reviewer", branchId: "reviewer@0#1", lineageId: "line-r", reviewId: "review-approved", status: "resolved", appliedAt: at, at },
      { type: "human_review_rework_requested", roleId: "reviewer", branchId: "reviewer@0#1", lineageId: "line-r", reviewId: "review-rework", status: "resolved", at },
      { type: "human_review_paused", roleId: "reviewer", branchId: "reviewer@0#1", lineageId: "line-r", reviewId: "review-pause", status: "paused", at },
      { type: "human_review_terminated", roleId: "reviewer", branchId: "reviewer@0#1", lineageId: "line-r", reviewId: "review-terminate", status: "resolved", at }
    ],
    stateSnapshot: {
      stateVersion: 7,
      status: "stopped",
      roleResults: {
        "a@0#1": { roleId: "a", branchId: "a@0#1", lineageId: "line-a", loopIteration: 0, event: "DONE", content: "completed output" }
      },
      joinScopes: {
        "join-1": { joinRoleId: "join", joinId: "join-1", lineageId: "line-a", loopIteration: 0, status: "waiting", expectedSourceRoleIds: ["a", "b"], readySourceRoleIds: ["a"], missingSourceRoleIds: ["b"], startedAt: at, timeoutAction: "pause" }
      },
      pendingReviewsById: {
        "review-pending": { reviewId: "review-pending", roleId: "reviewer", branchId: "reviewer@0#1", lineageId: "line-r", loopIteration: 0, requestedAt: at, status: "pending" }
      },
      reviewHistoryByBranchId: {
        "reviewer@0#1": [
          { reviewId: "review-approved", decision: "approve", decidedAt: at, committedAt: at, appliedAt: at },
          { reviewId: "review-paused", decision: "pause", decidedAt: at, committedAt: at }
        ]
      }
    }
  });

  assert.equal(projection.status, "waiting");
  const join = projection.items.find((item) => item.kind === "join" && item.source.file === "state.json");
  assert.deepEqual(join.join.expected, ["a", "b"]);
  assert.deepEqual(join.join.ready, ["a"]);
  assert.deepEqual(join.join.missing, ["b"]);
  assert.equal(join.route.presentationChannel, "join");
  const snapshotRole = projection.items.find((item) => item.source.file === "state.json" && item.roleId === "a");
  assert.equal(snapshotRole.source.snapshotVersion, 7);
  assert.equal(snapshotRole.status, "completed");
  assert.equal(projection.items.find((item) => item.review?.reviewId === "review-pending").review.reviewStatus, "pending");
  assert.equal(projection.items.find((item) => item.review?.reviewId === "review-approved").review.reviewStatus, "applied");
  assert.equal(projection.items.find((item) => item.review?.reviewId === "review-approved").review.decision, "approve");
  assert.equal(projection.items.find((item) => item.review?.reviewId === "review-rework").review.decision, "rework");
  assert.equal(projection.items.find((item) => item.review?.reviewId === "review-pause").review.decision, "pause");
  assert.equal(projection.items.find((item) => item.review?.reviewId === "review-terminate").review.decision, "terminate");
  assert.equal(projection.items.find((item) => item.review?.reviewId === "review-paused").review.reviewStatus, "recorded");
  assert.equal(projection.items.filter((item) => item.source.file === "state.json").every((item) => item.source.snapshotVersion === 7), true);
  assert.equal(projection.items.filter((item) => item.roleId === "feedback").length, 0);
});

test("conversation projection skips malformed and duplicate sources, normalizes unknown status, and appends after cursor", () => {
  assert.equal(normalizeConversationItemStatus("future_status"), "unknown");
  assert.equal(normalizeConversationItemStatus("WAITING_REVIEW"), "waiting_review");
  assert.equal(presentationChannelForRoute("main"), "primary");
  assert.equal(presentationChannelForRoute("loop", true), "backEdge");

  const first = projectConversationRun({
    runId: "run-incremental",
    events: [
      { cursor: 0, record: { type: "audit", roleId: "a", status: "ok", at } },
      { cursor: 1, record: { type: "audit", roleId: "b", status: "future_status", at } }
    ],
    cursor: { next: 2 }
  });
  const result = projectConversationRunWithDiagnostics({
    runId: "run-incremental",
    previous: first,
    events: [
      { cursor: 1, record: { type: "audit", roleId: "b", status: "future_status", at } },
      { cursor: 2, record: { type: "audit", roleId: "c", status: "done", at } },
      { cursor: 2, record: { type: "audit", roleId: "c", status: "done", at } },
      { cursor: 3, record: { roleId: "bad" } }
    ],
    cursor: { next: 4 }
  });
  assert.deepEqual(result.projection.items.map((item) => item.roleId), ["a", "b", "c"]);
  assert.equal(result.projection.items.find((item) => item.roleId === "b").status, "unknown");
  assert.equal(result.projection.cursor.next, 4);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "duplicate_record"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "malformed_record"));
});

test("conversation pagination keeps snapshot observations visible after stream pages advance", () => {
  const options = {
    runId: "run-paginated-snapshot",
    limit: 2,
    events: [
      { cursor: 0, record: { type: "audit", roleId: "stream-a", status: "ok", at } },
      { cursor: 1, record: { type: "audit", roleId: "stream-b", status: "ok", at } },
      { cursor: 2, record: { type: "audit", roleId: "stream-c", status: "ok", at } }
    ],
    stateSnapshot: {
      stateVersion: 4,
      status: "running",
      roleResults: {
        "snapshot-role@0#1": { roleId: "snapshot-role", branchId: "snapshot-role@0#1", event: "DONE" }
      }
    }
  };
  const first = projectConversationRun(options);
  assert.equal(first.items.some((item) => item.source.file === "state.json"), true);
  assert.equal(first.items.find((item) => item.source.file === "state.json").roleId, "snapshot-role");
  assert.equal(first.cursor.hasMore, true);

  const second = projectConversationRun({ ...options, startCursor: first.cursor.next });
  assert.equal(second.items.some((item) => item.source.file === "state.json"), true);
  assert.equal(second.items.find((item) => item.source.file === "state.json").roleId, "snapshot-role");
});

test("conversation file loader reads current event and state projections", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ogsystem-conversation-projector-"));
  const eventsPath = path.join(root, "events.ndjson");
  const statePath = path.join(root, "state.json");
  await writeFile(eventsPath, `${JSON.stringify({ type: "audit", roleId: "a", status: "ok", at })}\n`, "utf8");
  await writeFile(statePath, JSON.stringify({ stateVersion: 3, status: "done", roleResults: {} }), "utf8");

  const projection = await loadConversationRunProjection({ runId: "run-files", eventsPath, statePath });
  assert.equal(projection.items.length, 1);
  assert.equal(projection.items[0].source.file, "events.ndjson");
  assert.equal(projection.items[0].source.cursor, 0);
  assert.equal(projection.cursor.next, 1);
});

test("conversation content is redacted and truncated independently of status projection", () => {
  const projection = projectConversationRun({
    runId: "run-content",
    maxPreviewChars: 12,
    events: [
      { type: "audit", roleId: "a", status: "ok", content: "token=secret-value /Users/maple/private/workspace/data.txt", at }
    ]
  });
  assert.equal(projection.items[0].status, "ok");
  assert.equal(projection.items[0].content.truncated, true);
  assert.equal(projection.items[0].content.redacted, true);
  assert.doesNotMatch(projection.items[0].content.text, /secret-value|\/Users\/maple/);
});
