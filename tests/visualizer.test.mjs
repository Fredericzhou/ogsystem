import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import { startVisualizationServer } from "../dist/visualizer/server.js";

async function createFixtureRun(workdir) {
  const runId = "20260416-010203-deadbeef";
  const runDir = path.resolve(workdir, ".ogs", "runs", runId);
  await mkdir(path.resolve(runDir, "logs", "roles"), { recursive: true });
  await writeFile(
    path.resolve(runDir, "state.json"),
    JSON.stringify(
      {
        status: "running",
        error: "",
        transitionCount: 3,
        recentAudits: [
          { roleId: "alpha", status: "ok", at: "2026-04-16T01:02:03.000Z" }
        ],
        auditSummary: {
          okCount: 1,
          failedCount: 0,
          noopCount: 0,
          handledFailureCount: 0,
          unhandledFailureCount: 0,
          handledFailureByEvent: {},
          handledFailureByTargetRole: {},
          repairAttemptedCount: 0,
          repairAppliedCount: 0,
          failureCountsByErrorCode: {}
        },
        roleMetricsByRoleId: {},
        roleResults: {},
        branchRecords: {
          branch_a: {
            branchId: "branch_a",
            roleId: "alpha",
            loopIteration: 0,
            branchSequence: 1,
            lineageId: "lineage_a",
            sessionLineageId: "session_a",
            status: "active"
          }
        },
        loopIterations: {},
        selectedEventByBranchId: {},
        finalOutput: "",
        finalRoleId: "",
        lastExecutedRoleId: "alpha",
        nextBranchSequence: 2,
        lastCheckpointSequence: 3
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.resolve(runDir, "metrics.json"), JSON.stringify({ durationMs: 42 }, null, 2), "utf8");
  await writeFile(
    path.resolve(runDir, "summary.json"),
    JSON.stringify(
      {
        version: 1,
        runId,
        systemId: "viz.demo",
        systemVersion: "1.0.0",
        status: "done",
        transitionCount: 5,
        durationMs: 42,
        lastRoleId: "alpha",
        finalRoleId: "alpha",
        executionDirCount: 1,
        okCount: 1,
        failedCount: 0,
        noopCount: 0,
        updatedAt: "2026-04-16T01:02:05.000Z"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "resolved-config.json"),
    JSON.stringify({ systemId: "viz.demo", runtime: "local" }, null, 2),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "system.mmd"),
    [
      "flowchart TD",
      "input -->|ENTER| alpha[Role:alpha]",
      "alpha -->|DONE| output",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "events.ndjson"),
    [
      JSON.stringify({ type: "run_start", at: "2026-04-16T01:02:03.000Z" }),
      JSON.stringify({
        type: "audit",
        at: "2026-04-16T01:02:04.000Z",
        roleId: "alpha",
        status: "ok",
        durationMs: 12
      })
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "timeline.jsonl"),
    [
      JSON.stringify({
        version: 1,
        cursor: 0,
        at: "2026-04-16T01:02:03.000Z",
        type: "run_start"
      }),
      JSON.stringify({
        version: 1,
        cursor: 1,
        at: "2026-04-16T01:02:04.000Z",
        type: "audit",
        roleId: "alpha",
        status: "ok",
        durationMs: 12
      })
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "logs", "engine.ndjson"),
    JSON.stringify({ type: "engine", at: "2026-04-16T01:02:04.000Z", message: "ok" }) + "\n",
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "logs", "roles", "alpha.ndjson"),
    JSON.stringify({ type: "audit", at: "2026-04-16T01:02:04.000Z", roleId: "alpha", status: "ok" }) +
      "\n",
    "utf8"
  );
  return { runId, runDir };
}

async function createWaitingReviewFixtureRun(workdir) {
  const runId = "20260422-091500-feedface";
  const runDir = path.resolve(workdir, ".ogs", "runs", runId);
  await mkdir(path.resolve(runDir, "logs", "roles"), { recursive: true });
  await writeFile(
    path.resolve(runDir, "state.json"),
    JSON.stringify(
      {
        status: "stopped",
        error: "waiting for human review",
        transitionCount: 1,
        recentAudits: [{ roleId: "writer", status: "ok", at: "2026-04-22T09:15:00.000Z" }],
        auditSummary: {
          okCount: 1,
          failedCount: 0,
          noopCount: 0,
          handledFailureCount: 0,
          unhandledFailureCount: 0,
          handledFailureByEvent: {},
          handledFailureByTargetRole: {},
          repairAttemptedCount: 0,
          repairAppliedCount: 0,
          failureCountsByErrorCode: {}
        },
        roleMetricsByRoleId: {},
        roleResults: {},
        pendingReviewsById: {
          "review.writer@1#1.r1": {
            reviewId: "review.writer@1#1.r1",
            roleId: "writer",
            branchId: "writer@1#1",
            lineageId: "writer@1#1",
            loopIteration: 1,
            executionId: "exec-1",
            selectedEvent: "DONE",
            draftResult: {
              roleId: "writer",
              event: "DONE",
              content: "draft",
              branchId: "writer@1#1",
              lineageId: "writer@1#1",
              loopIteration: 1
            },
            requestedAt: "2026-04-22T09:15:00.000Z",
            requestedByExecutionId: "exec-1",
            status: "pending",
            round: 1,
            spec: {
              mode: "required",
              timeoutAction: "pause",
              reworkTargetRoleId: "writer",
              terminateScope: "branch"
            }
          }
        },
        reviewHistoryByBranchId: {},
        humanReviewContextByBranchId: {},
        reviewRoundByRoleLineageKey: {
          "writer::writer@1#1": 1
        },
        lastWaitingReviewId: "review.writer@1#1.r1",
        branchRecords: {
          "writer@1#1": {
            branchId: "writer@1#1",
            roleId: "writer",
            loopIteration: 1,
            branchSequence: 1,
            lineageId: "writer@1#1",
            sessionLineageId: "writer@1#1",
            status: "waiting_review"
          }
        },
        loopIterations: { writer: 1 },
        selectedEventByBranchId: {},
        finalOutput: "",
        finalRoleId: "",
        lastExecutedRoleId: "writer",
        nextBranchSequence: 2,
        lastCheckpointSequence: 1
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "summary.json"),
    JSON.stringify(
      {
        version: 1,
        runId,
        systemId: "viz.review.demo",
        systemVersion: "1.0.0",
        status: "stopped",
        transitionCount: 1,
        durationMs: 10,
        lastRoleId: "writer",
        executionDirCount: 1,
        okCount: 1,
        failedCount: 0,
        noopCount: 0,
        pendingReviewCount: 1,
        hasWaitingHumanReview: true,
        updatedAt: "2026-04-22T09:15:01.000Z"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "resolved-config.json"),
    JSON.stringify({ systemId: "viz.review.demo", runtime: "local" }, null, 2),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "system.mmd"),
    [
      "flowchart TD",
      "input -->|GO| writer[Role:writer]",
      "writer -->|DONE| output",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "events.ndjson"),
    [
      JSON.stringify({ type: "run_start", at: "2026-04-22T09:15:00.000Z" }),
      JSON.stringify({
        type: "human_review_requested",
        at: "2026-04-22T09:15:00.100Z",
        roleId: "writer",
        branchId: "writer@1#1",
        lineageId: "writer@1#1",
        loopIteration: 1,
        reviewId: "review.writer@1#1.r1",
        round: 1
      })
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "timeline.jsonl"),
    JSON.stringify({
      version: 1,
      cursor: 0,
      at: "2026-04-22T09:15:00.100Z",
      type: "human_review_requested",
      roleId: "writer",
      reviewId: "review.writer@1#1.r1"
    }) + "\n",
    "utf8"
  );
  return { runId, runDir };
}

async function readFirstSseChunk(url) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const request = http.request(url, { method: "GET" }, (response) => {
      response.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        if (buffer.includes('"type":"audit"')) {
          request.destroy();
          resolve({
            statusCode: response.statusCode,
            contentType: response.headers["content-type"],
            chunk: buffer
          });
        }
      });
      response.once("end", () => reject(new Error("SSE stream ended before audit event arrived")));
      response.once("error", reject);
    });
    request.once("error", reject);
    request.end();
  });
}

test("visualizer server serves run list, details, and live stream", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-"));
  const { runId } = await createFixtureRun(workdir);
  let started;
  try {
    started = await startVisualizationServer({
      workdir,
      host: "127.0.0.1",
      port: 0
    });
  } catch (error) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (
      errorCode === "EPERM" ||
      errorCode === "EACCES"
    ) {
      t.skip(`visualizer listen unavailable in sandbox: ${errorCode}`);
      return;
    }
    throw error;
  }
  const { server, url } = started;

  try {
    const root = await fetch(url);
    assert.equal(root.status, 200);
    const rootHtml = await root.text();
    assert.match(rootHtml, /OGSystem Visualizer/);

    const listResponse = await fetch(`${url}/api/v1/runs`);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    assert.equal(list.runs.length, 1);
    assert.equal(list.runs[0].runId, runId);
    assert.equal(list.runs[0].status, "done");

    const detailResponse = await fetch(`${url}/api/v1/runs/${runId}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.snapshot.status, "done");
    assert.equal(detail.snapshot.activeBranches, 1);
    assert.equal(detail.snapshot.transitionCount, 5);
    assert.equal(detail.snapshot.finalRoleId, "alpha");
    assert.match(detail.systemSource, /alpha -->\|DONE\| output/);

    const eventsResponse = await fetch(`${url}/api/v1/runs/${runId}/events?cursor=0&limit=1`);
    assert.equal(eventsResponse.status, 200);
    const events = await eventsResponse.json();
    assert.equal(events.events.length, 1);
    assert.equal(events.nextCursor, 2);
    assert.equal(events.events[0].record.type, "run_start");

    const graphResponse = await fetch(`${url}/api/v1/runs/${runId}/graph`);
    assert.equal(graphResponse.status, 200);
    const graph = await graphResponse.json();
    assert.match(graph.systemSource, /flowchart TD/);

    const stream = await readFirstSseChunk(`${url}/api/v1/runs/${runId}/stream?cursor=1`);
    assert.equal(stream.statusCode, 200);
    assert.equal(stream.contentType, "text/event-stream; charset=utf-8");
    assert.match(stream.chunk, /"type":"audit"/);
    assert.match(stream.chunk, /"status":"ok"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server exposes pending human review fields on waiting-review runs", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-review-"));
  const { runId } = await createWaitingReviewFixtureRun(workdir);
  let started;
  try {
    started = await startVisualizationServer({
      workdir,
      host: "127.0.0.1",
      port: 0
    });
  } catch (error) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (errorCode === "EPERM" || errorCode === "EACCES") {
      t.skip(`visualizer listen unavailable in sandbox: ${errorCode}`);
      return;
    }
    throw error;
  }
  const { server, url } = started;

  try {
    const listResponse = await fetch(`${url}/api/v1/runs`);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    assert.equal(list.runs.length, 1);
    assert.equal(list.runs[0].runId, runId);
    assert.equal(list.runs[0].status, "stopped");
    assert.equal(list.runs[0].pendingReviewCount, 1);
    assert.equal(list.runs[0].hasWaitingHumanReview, true);

    const detailResponse = await fetch(`${url}/api/v1/runs/${runId}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.snapshot.status, "stopped");
    assert.equal(detail.snapshot.pendingReviewCount, 1);
    assert.equal(detail.snapshot.hasWaitingHumanReview, true);
    assert.equal(detail.snapshot.activeBranches, 0);
    const eventsResponse = await fetch(`${url}/api/v1/runs/${runId}/events?cursor=0&limit=1`);
    assert.equal(eventsResponse.status, 200);
    const events = await eventsResponse.json();
    assert.equal(events.events[0].record.type, "human_review_requested");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
