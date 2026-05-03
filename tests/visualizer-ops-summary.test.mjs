import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";

import { inspectProjectOpsSummaryVisualization } from "../dist/visualizer/ops-summary-projection.js";

async function seedOpsProject(workdir) {
  const repoRoot = process.cwd();
  await mkdir(path.resolve(workdir, ".ogs", "runs"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-roles"), path.resolve(workdir, "og-roles"), "dir");
  for (const file of [
    "runtime.json",
    "model-selection.json",
    "model-catalog.json",
    "laws.json",
    "user-profile.json"
  ]) {
    await symlink(path.resolve(repoRoot, ".ogs", file), path.resolve(workdir, ".ogs", file));
  }
  const systemSource = [
    "flowchart TD",
    "%% system.id=viz.ops.demo",
    "%% system.version=1.0.0",
    "%% law.global=law.minimal.base",
    "%% entry.role=demo-analyst",
    "%% model.bind.demo-analyst=opencode/gpt-5.4",
    "%% review.mode.demo-analyst=required",
    "%% review.timeout.demo-analyst=3600",
    "%% review.timeout.action.demo-analyst=pause",
    "%% review.rework.target.demo-analyst=demo-analyst",
    "%% review.rework.max.demo-analyst=2",
    "%% review.terminate.scope.demo-analyst=branch",
    "input -->|GO| analyst[Role:demo-analyst]",
    "analyst[Role:demo-analyst] -->|DONE| output",
    ""
  ].join("\n");
  await writeFile(path.resolve(workdir, "system.mmd"), systemSource, "utf8");
  return systemSource;
}

async function seedOpsRun(workdir, systemSource) {
  const runId = "20260428-010203-opssum01";
  const runDir = path.resolve(workdir, ".ogs", "runs", runId);
  await mkdir(path.resolve(runDir, "control", "reviews"), { recursive: true });
  await mkdir(path.resolve(runDir, "roles", "demo-analyst", "executions", "0001-exec-1"), {
    recursive: true
  });
  await mkdir(path.resolve(runDir, "checkpoints"), { recursive: true });
  await writeFile(path.resolve(runDir, "system.mmd"), systemSource, "utf8");
  await writeFile(
    path.resolve(runDir, "state.json"),
    JSON.stringify(
      {
        status: "failed",
        error: "strict contract failed",
        transitionCount: 4,
        recentAudits: [
          {
            roleId: "demo-analyst",
            branchId: "demo-analyst@1#1",
            status: "failed",
            at: "2026-04-28T01:02:04.000Z",
            errorEnvelope: {
              errorCode: "CONTRACT_OUTPUT_INVALID",
              errorCategory: "contract",
              message: "Output did not satisfy handoff contract."
            }
          }
        ],
        auditSummary: {
          okCount: 0,
          failedCount: 1,
          noopCount: 0,
          handledFailureCount: 0,
          unhandledFailureCount: 1,
          handledFailureByEvent: {},
          handledFailureByTargetRole: {},
          repairAttemptedCount: 0,
          repairAppliedCount: 0,
          failureCountsByErrorCode: { CONTRACT_OUTPUT_INVALID: 1 }
        },
        roleMetricsByRoleId: {},
        roleResults: {},
        pendingReviewsById: {
          "review.demo-analyst@1#1.r1": {
            reviewId: "review.demo-analyst@1#1.r1",
            roleId: "demo-analyst",
            branchId: "demo-analyst@1#1",
            lineageId: "demo-analyst@1#1",
            loopIteration: 1,
            executionId: "exec-1",
            status: "pending",
            round: 1,
            requestedAt: "2026-04-28T01:02:03.000Z",
            spec: {
              mode: "required",
              timeoutAction: "pause",
              reworkTargetRoleId: "demo-analyst",
              terminateScope: "branch"
            }
          }
        },
        reviewHistoryByBranchId: {},
        humanReviewContextByBranchId: {},
        reviewRoundByRoleLineageKey: {},
        branchRecords: {
          "demo-analyst@1#1": {
            branchId: "demo-analyst@1#1",
            roleId: "demo-analyst",
            loopIteration: 1,
            branchSequence: 1,
            lineageId: "demo-analyst@1#1",
            sessionLineageId: "demo-analyst@1#1",
            status: "waiting_review"
          },
          "demo-analyst@2#2": {
            branchId: "demo-analyst@2#2",
            roleId: "demo-analyst",
            loopIteration: 2,
            branchSequence: 2,
            lineageId: "demo-analyst@1#1",
            sessionLineageId: "demo-analyst@2#2",
            parentBranchId: "demo-analyst@1#1",
            activatedByRoleId: "demo-analyst",
            activatedByEvent: "REWORK",
            status: "active"
          }
        },
        loopIterations: { "demo-analyst": 2 },
        selectedEventByBranchId: {},
        finalOutput: "",
        finalRoleId: "",
        lastExecutedRoleId: "demo-analyst",
        nextBranchSequence: 3,
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
        systemId: "viz.ops.demo",
        systemVersion: "1.0.0",
        status: "failed",
        transitionCount: 4,
        lastRoleId: "demo-analyst",
        pendingReviewCount: 1,
        hasWaitingHumanReview: true,
        updatedAt: "2026-04-28T01:02:05.000Z"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "resolved-config.json"),
    JSON.stringify({ systemId: "viz.ops.demo", effective: { invocation: { dryRun: false } } }, null, 2),
    "utf8"
  );
  await writeFile(
    path.resolve(workdir, ".ogs", "runs-index.json"),
    JSON.stringify(
      {
        version: 1,
        generatedAt: "2026-04-28T01:03:00.000Z",
        runs: [
          {
            runId,
            runDir,
            status: "failed",
            transitionCount: 4,
            updatedAt: "2026-04-28T01:02:05.000Z",
            pendingReviewCount: 1,
            hasWaitingHumanReview: true
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
  return runId;
}

test("ops summary aggregates failures, review/rework pending, and resume blockers", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-ops-summary-"));
  const systemSource = await seedOpsProject(workdir);
  const runId = await seedOpsRun(workdir, systemSource);

  const summary = await inspectProjectOpsSummaryVisualization(workdir, {
    runLimit: 5,
    failureLimit: 5,
    readinessLimit: 1
  });

  assert.equal(summary.summary.recentFailureCount, 1);
  assert.equal(summary.scope.strategy, "bounded-sequential-scan");
  assert.deepEqual(summary.scope.runtimeEventSources, ["timeline.jsonl", "events.ndjson"]);
  assert.equal(summary.recentFailures[0].runId, runId);
  assert.equal(summary.failureGroups.byRole[0].key, "demo-analyst");
  assert.equal(summary.failureGroups.byErrorCode[0].key, "CONTRACT_OUTPUT_INVALID");
  assert.equal(summary.failureGroups.byErrorCategory[0].key, "contract");
  assert.equal(summary.reviewRework.pendingReviewCount, 1);
  assert.equal(summary.reviewRework.pendingReworkCount, 1);
  assert.equal(summary.reviewRework.pendingReviewByRole[0].key, "demo-analyst");
  assert.equal(summary.resumeReadiness.inspectedRunCount, 1);
  assert.equal(summary.resumeReadiness.blockedRunCount, 1);
  assert.equal(Array.isArray(summary.resumeReadiness.blockingByCategory), true);
});
