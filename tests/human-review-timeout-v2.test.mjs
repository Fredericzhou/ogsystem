import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";

import {
  inspectHumanReview,
  listHumanReviews,
  reconcileHumanReviewTimeouts,
  writeHumanReviewDecision
} from "../dist/runtime/project-lifecycle.js";

async function createTimedOutRun(timeoutAction) {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-v2-review-timeout-"));
  const runId = "run-timeout";
  const runDir = path.resolve(workdir, ".ogs", "runs", runId);
  const reviewsDir = path.resolve(runDir, "control", "reviews");
  await mkdir(reviewsDir, { recursive: true });
  const reviewId = "review.demo-analyst@1#1.timeout";
  const request = {
    ogsContractVersion: 2,
    schemaVersion: 1,
    reviewId,
    runId,
    round: 1,
    lineageId: "lineage-1",
    branchId: "demo-analyst@1#1",
    loopIteration: 0,
    stateVersion: 1,
    trigger: "explicit",
    status: "pending",
    payload: {
      roleId: "demo-analyst",
      executionId: "execution-1",
      draftResult: { content: "draft" },
      requestedAt: "2026-01-01T00:00:00.000Z",
      requestedByExecutionId: "execution-1",
      spec: {
        mode: "required",
        timeoutSeconds: 60,
        timeoutAction,
        reworkTargetRoleId: "demo-analyst",
        terminateScope: "branch"
      }
    }
  };
  await writeFile(path.resolve(reviewsDir, `${reviewId}.request.json`), `${JSON.stringify(request)}\n`);
  await writeFile(path.resolve(runDir, "state.json"), JSON.stringify({
    stateVersion: 1,
    status: "waiting_review",
    pendingReviewsById: {
      [reviewId]: {
        ...request.payload,
        reviewId,
        round: 1,
        lineageId: "lineage-1",
        branchId: "demo-analyst@1#1",
        loopIteration: 0,
        stateVersion: 1,
        status: "pending"
      }
    },
    reviewHistoryByBranchId: {},
    branchRecords: {}
  }));
  await writeFile(path.resolve(runDir, "resolved-config.json"), JSON.stringify({
    effective: { roleRepoDir: path.resolve("og-roles", "roles") }
  }));
  await writeFile(path.resolve(runDir, "events.jsonl"), "");
  return { workdir, runId, runDir, reviewsDir, reviewId };
}

test("terminate timeout writes a valid exception decision without an empty artifact", async () => {
  const context = await createTimedOutRun("terminate");
  await reconcileHumanReviewTimeouts(context.runDir, Date.parse("2026-01-01T00:02:00.000Z"));
  const decisionPath = path.resolve(context.reviewsDir, `${context.reviewId}.decision.json`);
  const decision = JSON.parse(await readFile(decisionPath, "utf8"));
  assert.equal(decision.trigger, "exception");
  assert.equal(decision.exceptionContext.code, "human_review_timeout");
  assert.equal(decision.decision.action, "terminate");
  assert.equal(decision.payload.timedOut, true);
  assert.ok((await stat(decisionPath)).size > 0);
  const detail = await inspectHumanReview(context.workdir, context.runId, context.reviewId);
  assert.equal(detail.currentStatus, "expired");
});

test("pause timeout is projected consistently by list and inspect", async () => {
  const context = await createTimedOutRun("pause");
  await reconcileHumanReviewTimeouts(context.runDir, Date.parse("2026-01-01T00:02:00.000Z"));
  const detail = await inspectHumanReview(context.workdir, context.runId, context.reviewId);
  const list = await listHumanReviews(context.workdir, context.runId);
  assert.equal(detail.currentStatus, "paused");
  assert.equal(list.reviews[0].currentStatus, "paused");
  assert.equal(list.reviews[0].timedOut, true);
});

test("pause timeout remains actionable for a later durable human decision", async () => {
  const context = await createTimedOutRun("pause");
  await reconcileHumanReviewTimeouts(context.runDir, Date.parse("2026-01-01T00:02:00.000Z"));
  await writeHumanReviewDecision({
    workdir: context.workdir,
    runId: context.runId,
    reviewId: context.reviewId,
    decision: "approve",
    principal: { id: "local:test-reviewer", issuer: "ogs:local", displayName: "Test reviewer" }
  });
  const decision = JSON.parse(await readFile(path.resolve(context.reviewsDir, `${context.reviewId}.decision.json`), "utf8"));
  assert.equal(decision.decision.action, "approve");
  assert.equal(decision.trigger, "explicit");
});

test("concurrent human decisions publish one durable decision without truncation", async () => {
  const context = await createTimedOutRun("pause");
  const principal = { id: "local:test-reviewer", issuer: "ogs:local", displayName: "Test reviewer" };
  const results = await Promise.allSettled([
    writeHumanReviewDecision({
      workdir: context.workdir,
      runId: context.runId,
      reviewId: context.reviewId,
      decision: "approve",
      principal
    }),
    writeHumanReviewDecision({
      workdir: context.workdir,
      runId: context.runId,
      reviewId: context.reviewId,
      decision: "approve",
      principal
    })
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const decisionPath = path.resolve(context.reviewsDir, `${context.reviewId}.decision.json`);
  const decision = JSON.parse(await readFile(decisionPath, "utf8"));
  assert.equal(decision.status, "resolved");
  assert.equal(decision.decision.action, "approve");
  assert.ok((await stat(decisionPath)).size > 0);
});

test("loop budget continue is rejected before a decision file is persisted without a budget", async () => {
  const context = await createTimedOutRun("pause");
  const requestPath = path.resolve(context.reviewsDir, `${context.reviewId}.request.json`);
  const request = JSON.parse(await readFile(requestPath, "utf8"));
  request.payload.kind = "loop_budget";
  request.payload.loopBudget = {
    loopId: "review-loop",
    maxAdditionalRounds: 2,
    targetRoleIds: ["demo-analyst"],
    reworkTargetRoleIds: ["demo-analyst"],
    rejectTargetRoleIds: []
  };
  await writeFile(requestPath, `${JSON.stringify(request)}\n`);
  const statePath = path.resolve(context.runDir, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.pendingReviewsById[context.reviewId].kind = "loop_budget";
  state.pendingReviewsById[context.reviewId].loopBudget = request.payload.loopBudget;
  await writeFile(statePath, JSON.stringify(state));
  await assert.rejects(
    () => writeHumanReviewDecision({
      workdir: context.workdir,
      runId: context.runId,
      reviewId: context.reviewId,
      decision: "continue",
      targetRoleId: "demo-analyst",
      principal: { id: "local:test-reviewer", issuer: "ogs:local", displayName: "Test reviewer" }
    }),
    /GRAPH_LOOP_BUDGET_AUTHORIZATION_INVALID/
  );
  await assert.rejects(() => readFile(path.resolve(context.reviewsDir, `${context.reviewId}.decision.json`)));
});
