import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";

import { validateRuntimeConfig } from "../dist/runtime/config.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import {
  buildHumanReviewDecisionPath,
  buildHumanReviewRequestPath,
  initializeRunContext,
  loadHumanReviewDecisions,
  loadHumanReviewRequests,
  markHumanReviewDecisionApplied,
  markHumanReviewDecisionReconciled,
  persistHumanReviewDecision,
  persistHumanReviewRequest
} from "../dist/runtime/run-artifacts.js";
import { inspectHumanReview, listHumanReviews, reconcileHumanReviewTimeouts } from "../dist/runtime/project-lifecycle.js";

async function createRunContext() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-human-review-artifacts-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  const runtimeConfigPath = path.resolve(tempRoot, "runtime.json");
  const system = parseSystemFromMermaidSource(`flowchart TD
%% system.id=test.human.review.artifacts
%% system.version=1.0.0
%% law.global=law.test
%% entry.role=writer
%% exec.bind.writer=profile.writer
input -->|GO| writer[Role:writer]
writer[Role:writer] -->|DONE| output
`);
  await writeFile(systemPath, `flowchart TD
%% system.id=test.human.review.artifacts
%% system.version=1.0.0
%% law.global=law.test
%% entry.role=writer
%% exec.bind.writer=profile.writer
input -->|GO| writer[Role:writer]
writer[Role:writer] -->|DONE| output
`, "utf8");
  await writeFile(runtimeConfigPath, JSON.stringify({ executor: "opencode", roleRepo: "./og-roles" }), "utf8");

  return initializeRunContext({
    system,
    systemPath,
    prompt: "persist review artifacts",
    workdir: tempRoot,
    runtimeConfig: validateRuntimeConfig(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        runsDir: ".ogs/runs"
      },
      runtimeConfigPath
    )
  });
}

test("human review request and decision artifacts persist, reload, and track apply markers", async () => {
  const context = await createRunContext();
  const requestedAt = "2026-04-22T08:00:00.000Z";

  await persistHumanReviewRequest({
    context,
    review: {
      reviewId: "review.writer@1#1.r1",
      roleId: "writer",
      branchId: "writer@1#1",
      lineageId: "writer@1#1",
      loopIteration: 1,
      executionId: "exec-writer-1",
      selectedEvent: "DONE",
      draftResult: {
        roleId: "writer",
        event: "DONE",
        content: "draft",
        branchId: "writer@1#1",
        lineageId: "writer@1#1",
        loopIteration: 1
      },
      requestedAt,
      requestedByExecutionId: "exec-writer-1",
      status: "pending",
      round: 1,
      spec: {
        mode: "required",
        timeoutSeconds: 120,
        timeoutAction: "pause",
        reworkTargetRoleId: "writer",
        reworkMax: 2,
        terminateScope: "branch"
      }
    }
  });
  await persistHumanReviewDecision({
    context,
    decision: {
      reviewId: "review.writer@1#1.r1",
      committedAt: "2026-04-22T08:01:00.000Z",
      decidedAt: "2026-04-22T08:00:30.000Z",
      decision: "approve",
      actor: "tester",
      comment: "ship it"
    }
  });

  const requests = await loadHumanReviewRequests({ context });
  const unresolvedBeforeApply = await loadHumanReviewDecisions({ context, unresolvedOnly: true });

  assert.strictEqual(requests.length, 1);
  assert.strictEqual(unresolvedBeforeApply.length, 1);
  assert.equal(
    JSON.parse(await readFile(buildHumanReviewRequestPath(context, "review.writer@1#1.r1"), "utf8")).status,
    "pending"
  );
  assert.equal(
    JSON.parse(await readFile(buildHumanReviewDecisionPath(context, "review.writer@1#1.r1"), "utf8")).decision,
    "approve"
  );

  const applied = await markHumanReviewDecisionApplied({
    context,
    reviewId: "review.writer@1#1.r1",
    checkpointSequence: 7,
    appliedAt: "2026-04-22T08:01:05.000Z"
  });
  assert.equal(applied.checkpointSequence, 7);
  assert.equal(applied.appliedAt, "2026-04-22T08:01:05.000Z");
  assert.equal(applied.reconciledAt, undefined);

  const reconciled = await markHumanReviewDecisionReconciled({
    context,
    reviewId: "review.writer@1#1.r1",
    reconciledAt: "2026-04-22T08:01:06.000Z"
  });
  assert.equal(reconciled.checkpointSequence, 7);
  assert.equal(reconciled.appliedAt, "2026-04-22T08:01:05.000Z");
  assert.equal(reconciled.reconciledAt, "2026-04-22T08:01:06.000Z");

  const unresolvedAfterReconcile = await loadHumanReviewDecisions({ context, unresolvedOnly: true });
  assert.deepStrictEqual(unresolvedAfterReconcile, []);
});

test("human review inspection lazily commits one timeout decision at its deadline", async () => {
  const context = await createRunContext();
  const reviewId = "review.writer@1#1.r1";
  await persistHumanReviewRequest({
    context,
    review: {
      reviewId,
      roleId: "writer",
      branchId: "writer@1#1",
      lineageId: "writer@1#1",
      loopIteration: 1,
      executionId: "exec-writer-timeout",
      draftResult: { roleId: "writer", content: "draft", branchId: "writer@1#1", lineageId: "writer@1#1", loopIteration: 1 },
      requestedAt: "2026-04-22T08:00:00.000Z",
      requestedByExecutionId: "exec-writer-timeout",
      status: "pending",
      round: 1,
      spec: { mode: "required", timeoutSeconds: 60, timeoutAction: "terminate", reworkTargetRoleId: "writer", terminateScope: "branch" }
    }
  });

  const [first, second] = await Promise.all([
    inspectHumanReview(path.dirname(path.dirname(path.dirname(context.runDir))), context.runId, reviewId),
    listHumanReviews(path.dirname(path.dirname(path.dirname(context.runDir))), context.runId)
  ]);
  assert.equal(first.currentStatus, "expired");
  assert.equal(first.timedOut, true);
  assert.equal(first.decision, "terminate");
  assert.equal(first.expiredAt, "2026-04-22T08:01:00.000Z");
  assert.equal(second.reviews.length, 1);
  const eventLines = (await readFile(path.resolve(context.runDir, "events.ndjson"), "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.includes('"type":"human_review_timeout_recorded"'));
  assert.equal(eventLines.length, 1);
  const eventsPath = path.resolve(context.runDir, "events.ndjson");
  await writeFile(eventsPath, (await readFile(eventsPath, "utf8")).replace(/[^\r\n]*"type":"human_review_timeout_recorded"[^\r\n]*(?:\r?\n|$)/, ""), "utf8");
  await reconcileHumanReviewTimeouts(context.runDir);
  const recoveredEventLines = (await readFile(eventsPath, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.includes('"type":"human_review_timeout_recorded"'));
  assert.equal(recoveredEventLines.length, 1);
  const decision = JSON.parse(await readFile(buildHumanReviewDecisionPath(context, reviewId), "utf8"));
  assert.equal(decision.timedOut, true);
  assert.equal(decision.scope, "branch");
});

test("human review without a timeout remains pending and creates no timeout artifacts", async () => {
  const context = await createRunContext();
  const reviewId = "review.writer@1#1.no-timeout";
  await persistHumanReviewRequest({
    context,
    review: {
      reviewId,
      roleId: "writer",
      branchId: "writer@1#1",
      lineageId: "writer@1#1",
      loopIteration: 1,
      executionId: "exec-writer-no-timeout",
      draftResult: { roleId: "writer", content: "draft", branchId: "writer@1#1", lineageId: "writer@1#1", loopIteration: 1 },
      requestedAt: "2020-01-01T00:00:00.000Z",
      requestedByExecutionId: "exec-writer-no-timeout",
      status: "pending",
      round: 1,
      spec: { mode: "required", reworkTargetRoleId: "writer", reworkMax: 2 }
    }
  });

  const detail = await inspectHumanReview(path.dirname(path.dirname(path.dirname(context.runDir))), context.runId, reviewId);
  assert.equal(detail.currentStatus, "pending");
  assert.equal(detail.decisionSnapshot, undefined);
  const events = await readFile(path.resolve(context.runDir, "events.ndjson"), "utf8").catch(() => "");
  assert.equal(events.includes("human_review_timeout_recorded"), false);
  await assert.rejects(readFile(buildHumanReviewDecisionPath(context, reviewId), "utf8"), { code: "ENOENT" });
});

test("human review timeout does not fire before the deadline", async () => {
  const context = await createRunContext();
  const reviewId = "review.writer@1#1.r1";
  const future = new Date(Date.now() + 60_000).toISOString();
  await persistHumanReviewRequest({
    context,
    review: {
      reviewId,
      roleId: "writer",
      branchId: "writer@1#1",
      lineageId: "writer@1#1",
      loopIteration: 1,
      executionId: "exec-writer-timeout",
      draftResult: { roleId: "writer", content: "draft", branchId: "writer@1#1", lineageId: "writer@1#1", loopIteration: 1 },
      requestedAt: future,
      requestedByExecutionId: "exec-writer-timeout",
      status: "pending",
      round: 1,
      spec: { mode: "required", timeoutSeconds: 60, timeoutAction: "pause", reworkTargetRoleId: "writer", terminateScope: "run" }
    }
  });

  const detail = await inspectHumanReview(path.dirname(path.dirname(path.dirname(context.runDir))), context.runId, reviewId);
  assert.equal(detail.currentStatus, "pending");
  assert.equal(detail.decisionSnapshot, undefined);
  await assert.rejects(readFile(buildHumanReviewDecisionPath(context, reviewId), "utf8"), { code: "ENOENT" });
});

test("human review timeout pause stays actionable after its deadline", async () => {
  const context = await createRunContext();
  const reviewId = "review.writer@1#1.timeout-pause";
  await persistHumanReviewRequest({
    context,
    review: {
      reviewId,
      roleId: "writer",
      branchId: "writer@1#1",
      lineageId: "writer@1#1",
      loopIteration: 1,
      executionId: "exec-writer-timeout-pause",
      draftResult: { roleId: "writer", content: "draft", branchId: "writer@1#1", lineageId: "writer@1#1", loopIteration: 1 },
      requestedAt: "2020-01-01T00:00:00.000Z",
      requestedByExecutionId: "exec-writer-timeout-pause",
      status: "pending",
      round: 1,
      spec: { mode: "required", timeoutSeconds: 60, timeoutAction: "pause", reworkTargetRoleId: "writer", terminateScope: "run" }
    }
  });

  const detail = await inspectHumanReview(path.dirname(path.dirname(path.dirname(context.runDir))), context.runId, reviewId);
  assert.equal(detail.currentStatus, "paused");
  assert.equal(detail.timedOut, true);
  assert.equal(detail.decision, "pause");
  assert.equal(detail.expiredAt, "2020-01-01T00:01:00.000Z");
  assert.equal(JSON.parse(await readFile(buildHumanReviewDecisionPath(context, reviewId), "utf8")).timedOut, true);
});
