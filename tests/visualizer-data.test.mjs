import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";

import {
  inspectRunContractStatusVisualization,
  inspectRunFailureVisualization,
  inspectRunGraphVisualization as inspectRunGraphVisualizationFromData,
  inspectRunResumeDiagnostics,
  inspectRunResumeReadiness
} from "../dist/visualizer/data.js";
import {
  inspectProjectBindingVisualization,
  inspectProjectConfigVisualization,
  inspectProjectContractVisualization,
  inspectProjectRolePackagesVisualization,
  inspectProjectSystemVisualization,
  inspectProjectVisualization
} from "../dist/visualizer/project-projection.js";
import { inspectRunGraphVisualization } from "../dist/visualizer/run-graph-projection.js";
import { inspectHumanReview, listHumanReviews } from "../dist/runtime/project-lifecycle.js";

function decodeMermaidLivePayload(url) {
  const prefix = "https://mermaid.live/edit#base64:";
  assert.match(url, /^https:\/\/mermaid\.live\/edit#base64:/);
  const fragment = url.slice(prefix.length);
  const padded = fragment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(fragment.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

async function seedProjectFixture(workdir) {
  const repoRoot = process.cwd();
  await mkdir(path.resolve(workdir, ".ogs"), { recursive: true });
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
  await writeFile(
    path.resolve(workdir, ".ogs", "project.json"),
    JSON.stringify(
      {
        projectId: "viz.project.demo",
        createdAt: "2026-04-23T00:00:00.000Z"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(workdir, "profiles.json"),
    JSON.stringify([{ profileId: "profile.review", toolRef: "tool.review" }], null, 2),
    "utf8"
  );
  await writeFile(
    path.resolve(workdir, "tools.json"),
    JSON.stringify({ tools: [{ toolRef: "tool.review", runner: "local_shell", command: "echo", argsTemplate: [], stdinMode: "none" }] }, null, 2),
    "utf8"
  );
  await writeFile(
    path.resolve(workdir, "system.mmd"),
    [
      "flowchart TD",
      "%% system.id=viz.project.demo",
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
      "input -->|ENTER| analyst[Role:demo-analyst]",
      "analyst[Role:demo-analyst] -->|DONE| output",
      ""
    ].join("\n"),
    "utf8"
  );
}

async function seedStrictContractProjectFixture(workdir) {
  await seedProjectFixture(workdir);
  const contractBundlePath = path.resolve(workdir, "contracts", "handoff.contracts.json");
  await mkdir(path.resolve(workdir, "contracts"), { recursive: true });
  await writeFile(
    path.resolve(workdir, "system.mmd"),
    [
      "flowchart TD",
      "%% system.id=viz.project.contract.demo",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=demo-analyst",
      "%% handoff.mode=strict",
      `%% handoff.contracts=${contractBundlePath}`,
      "%% model.bind.demo-analyst=opencode/gpt-5.4",
      "%% model.bind.diagnosis-dispatch=opencode/gpt-5.4",
      "%% context.map.diagnosis-dispatch.content=direct.content",
      "input -->|ENTER| analyst[Role:demo-analyst]",
      "analyst[Role:demo-analyst] -->|ANALYSIS_DONE| tracker[Role:diagnosis-dispatch]",
      "tracker[Role:diagnosis-dispatch] -->|DONE| output",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.resolve(workdir, "contracts", "flow-envelope.schema.json"),
    JSON.stringify(
      {
        "$schema": "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          event: { type: "string" },
          content: { type: "string" },
          data: { type: "object" }
        },
        required: ["content"],
        additionalProperties: false
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(workdir, "contracts", "tracker-input.schema.json"),
    JSON.stringify(
      {
        "$schema": "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          content: { type: "string" }
        },
        required: ["content"],
        additionalProperties: true
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(workdir, "contracts", "handoff.contracts.json"),
    JSON.stringify(
      {
        version: 1,
        contracts: [
          {
            id: "demo-analyst.to.tracker.v1",
            kind: "flow",
            match: {
              fromRoleId: "demo-analyst",
              eventType: "ANALYSIS_DONE",
              toRoleId: "diagnosis-dispatch"
            },
            schema: "flow-envelope.schema.json",
            onViolation: "FAIL"
          },
          {
            id: "tracker.input.v1",
            kind: "role_input",
            match: {
              roleId: "diagnosis-dispatch"
            },
            schema: "tracker-input.schema.json",
            onViolation: "FAIL"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
}

async function createSimulationRun(workdir) {
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
          { roleId: "alpha", status: "ok", at: "2026-04-16T01:02:03.000Z" },
          {
            roleId: "alpha",
            status: "failed",
            at: "2026-04-16T01:02:04.500Z",
            errorEnvelope: { errorCode: "E_VIS_TEST" }
          }
        ],
        auditSummary: {
          okCount: 1,
          failedCount: 1,
          noopCount: 0,
          handledFailureCount: 0,
          unhandledFailureCount: 1,
          handledFailureByEvent: {},
          handledFailureByTargetRole: {},
          repairAttemptedCount: 0,
          repairAppliedCount: 0,
          failureCountsByErrorCode: { E_VIS_TEST: 1 }
        },
        roleMetricsByRoleId: {},
        roleResults: {},
        pendingReviewsById: {},
        reviewHistoryByBranchId: {},
        humanReviewContextByBranchId: {},
        reviewRoundByRoleLineageKey: {},
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
    JSON.stringify(
      {
        systemId: "viz.demo",
        runtime: "local",
        effective: {
          invocation: {
            dryRun: true
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "system.mmd"),
    [
      "flowchart TD",
      "%% system.id=viz.demo",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=alpha",
      "input -->|ENTER| alpha[Role:alpha]",
      "alpha[Role:alpha] -->|DONE| output",
      ""
    ].join("\n"),
    "utf8"
  );
  return { runId, runDir };
}

async function createContractFailureRun(workdir) {
  const runId = "20260416-020304-contract";
  const runDir = path.resolve(workdir, ".ogs", "runs", runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    path.resolve(runDir, "state.json"),
    JSON.stringify(
      {
        status: "failed",
        error: "Strict handoff contract violation.",
        lastExecutedRoleId: "demo-analyst",
        recentAudits: [
          {
            roleId: "demo-analyst",
            status: "failed",
            at: "2026-04-16T02:03:04.000Z",
            errorEnvelope: {
              errorCode: "CONTRACT_VIOLATION",
              errorCategory: "contract handoff violation",
              message: "Strict handoff contract violation.",
              stage: "contract",
              contract: {
                contractId: "demo-analyst.to.tracker.v1",
                flowKey: "demo-analyst:ANALYSIS_DONE:diagnosis-dispatch"
              }
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
          failureCountsByErrorCode: { CONTRACT_VIOLATION: 1 }
        },
        branchRecords: {},
        roleMetricsByRoleId: {},
        roleResults: {},
        pendingReviewsById: {},
        reviewHistoryByBranchId: {},
        humanReviewContextByBranchId: {},
        reviewRoundByRoleLineageKey: {},
        loopIterations: {},
        selectedEventByBranchId: {}
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
        status: "failed",
        failedCount: 1,
        lastRoleId: "demo-analyst",
        lastErrorCode: "CONTRACT_VIOLATION",
        updatedAt: "2026-04-16T02:03:05.000Z",
        terminalErrorEnvelope: {
          errorCode: "CONTRACT_VIOLATION",
          message: "Strict handoff contract violation.",
          stage: "contract"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  return { runId, runDir };
}

async function createUnknownContractRun(workdir) {
  const runId = "20260416-030405-unknown";
  const runDir = path.resolve(workdir, ".ogs", "runs", runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    path.resolve(runDir, "state.json"),
    JSON.stringify(
      {
        status: "running",
        recentAudits: [{ roleId: "demo-analyst", status: "ok", at: "2026-04-16T03:04:05.000Z" }],
        auditSummary: { okCount: 1, failedCount: 0 },
        branchRecords: {},
        roleMetricsByRoleId: {},
        roleResults: {},
        pendingReviewsById: {},
        reviewHistoryByBranchId: {},
        humanReviewContextByBranchId: {},
        reviewRoundByRoleLineageKey: {},
        loopIterations: {},
        selectedEventByBranchId: {}
      },
      null,
      2
    ),
    "utf8"
  );
  return { runId, runDir };
}

async function createNoRuntimeSignalRun(workdir) {
  const runId = "20260416-040506-empty";
  const runDir = path.resolve(workdir, ".ogs", "runs", runId);
  await mkdir(runDir, { recursive: true });
  return { runId, runDir };
}

async function createWaitingReviewRun(workdir, options = {}) {
  const decisionMarkers = options.decisionMarkers ?? {};
  const runId = "20260422-091500-feedface";
  const runDir = path.resolve(workdir, ".ogs", "runs", runId);
  await mkdir(path.resolve(runDir, "logs", "roles"), { recursive: true });
  await mkdir(path.resolve(runDir, "control", "reviews"), { recursive: true });
  await mkdir(path.resolve(runDir, "roles", "demo-analyst", "executions", "0001-exec-1"), {
    recursive: true
  });
  await mkdir(path.resolve(runDir, "checkpoints"), { recursive: true });
  await writeFile(path.resolve(runDir, "sessions.json"), JSON.stringify({}, null, 2), "utf8");
  await writeFile(
    path.resolve(runDir, "state.json"),
    JSON.stringify(
      {
        status: "stopped",
        error: "waiting for human review",
        transitionCount: 1,
        recentAudits: [{ roleId: "demo-analyst", status: "ok", at: "2026-04-22T09:15:00.000Z" }],
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
          "review.demo-analyst@1#1.r1": {
            reviewId: "review.demo-analyst@1#1.r1",
            roleId: "demo-analyst",
            branchId: "demo-analyst@1#1",
            lineageId: "demo-analyst@1#1",
            loopIteration: 1,
            executionId: "exec-1",
            selectedEvent: "DONE",
            draftResult: {
              roleId: "demo-analyst",
              event: "DONE",
              content: "draft",
              branchId: "demo-analyst@1#1",
              lineageId: "demo-analyst@1#1",
              loopIteration: 1
            },
            requestedAt: "2026-04-22T09:15:00.000Z",
            requestedByExecutionId: "exec-1",
            status: "pending",
            round: 1,
            spec: {
              mode: "required",
              timeoutAction: "pause",
              reworkTargetRoleId: "demo-analyst",
              terminateScope: "branch"
            }
          }
        },
        reviewHistoryByBranchId: {
          "demo-analyst@1#1": [
            {
              reviewId: "review.demo-analyst@1#1.r1",
              committedAt: "2026-04-22T09:15:01.000Z",
              decidedAt: "2026-04-22T09:15:01.000Z",
              decision: "approve",
              actor: "qa",
              comment: "ship it"
            }
          ]
        },
        humanReviewContextByBranchId: {
          "demo-analyst@1#1": {
            reviewId: "review.demo-analyst@1#1.r1",
            branchId: "demo-analyst@1#1",
            round: 1,
            comment: "ship it",
            previousOutput: {
              roleId: "demo-analyst",
              event: "DONE",
              content: "draft",
              branchId: "demo-analyst@1#1",
              lineageId: "demo-analyst@1#1",
              loopIteration: 1
            }
          }
        },
        reviewRoundByRoleLineageKey: {
          "demo-analyst::demo-analyst@1#1": 1
        },
        lastWaitingReviewId: "review.demo-analyst@1#1.r1",
        branchRecords: {
          "demo-analyst@1#1": {
            branchId: "demo-analyst@1#1",
            roleId: "demo-analyst",
            loopIteration: 1,
            branchSequence: 1,
            lineageId: "demo-analyst@1#1",
            sessionLineageId: "demo-analyst@1#1",
            status: "waiting_review"
          }
        },
        loopIterations: { "demo-analyst": 1 },
        selectedEventByBranchId: {},
        finalOutput: "",
        finalRoleId: "",
        lastExecutedRoleId: "demo-analyst",
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
        lastRoleId: "demo-analyst",
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
    JSON.stringify(
      {
        systemId: "viz.review.demo",
        runtime: "local",
        effective: {
          invocation: {
            dryRun: false
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "system.mmd"),
    [
      "flowchart TD",
      "%% system.id=viz.review.demo",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=demo-analyst",
      "input -->|GO| analyst[Role:demo-analyst]",
      "analyst[Role:demo-analyst] -->|DONE| output",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "control", "reviews", "review.demo-analyst@1#1.r1.request.json"),
    JSON.stringify(
      {
        reviewId: "review.demo-analyst@1#1.r1",
        roleId: "demo-analyst",
        branchId: "demo-analyst@1#1",
        lineageId: "demo-analyst@1#1",
        loopIteration: 1,
        executionId: "exec-1",
        selectedEvent: "DONE",
        draftResult: {
          roleId: "demo-analyst",
          event: "DONE",
          content: "draft",
          branchId: "demo-analyst@1#1",
          lineageId: "demo-analyst@1#1",
          loopIteration: 1
        },
        requestedAt: "2026-04-22T09:15:00.000Z",
        requestedByExecutionId: "exec-1",
        status: "pending",
        round: 1,
        spec: {
          mode: "required",
          timeoutAction: "pause",
          reworkTargetRoleId: "demo-analyst",
          terminateScope: "branch"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "control", "reviews", "review.demo-analyst@1#1.r1.decision.json"),
    JSON.stringify(
      {
        reviewId: "review.demo-analyst@1#1.r1",
        committedAt: "2026-04-22T09:15:01.000Z",
        decidedAt: "2026-04-22T09:15:01.000Z",
        decision: "approve",
        actor: "qa",
        comment: "ship it",
        ...decisionMarkers
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(
      runDir,
      "roles",
      "demo-analyst",
      "executions",
      "0001-exec-1",
      "execution-outcome.json"
    ),
    JSON.stringify(
      {
        version: 1,
        executionId: "exec-1",
        roleId: "demo-analyst",
        branchId: "demo-analyst@1#1",
        loopIteration: 1,
        sessionKey: "demo-analyst:demo-analyst@1#1",
        branch: {
          branchId: "demo-analyst@1#1",
          roleId: "demo-analyst",
          loopIteration: 1,
          branchSequence: 1,
          lineageId: "demo-analyst@1#1",
          sessionLineageId: "demo-analyst@1#1",
          status: "waiting_review"
        },
        committedAt: "2026-04-22T09:15:00.000Z",
        status: "ok",
        selectedEvent: "DONE",
        storedResult: {
          roleId: "demo-analyst",
          event: "DONE",
          content: "draft",
          branchId: "demo-analyst@1#1",
          lineageId: "demo-analyst@1#1",
          loopIteration: 1
        },
        audit: {
          at: "2026-04-22T09:15:00.000Z",
          roleId: "demo-analyst",
          exitCode: 0,
          durationMs: 5,
          status: "ok"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "plan-fingerprint.json"),
    JSON.stringify(
      {
        version: 1,
        algorithm: "sha256",
        digest: "stored-digest",
        payload: {
          components: {
            system: { digest: "system-old" },
            rolePackages: { digest: "roles-old" }
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "checkpoints", "1-exec-1.json"),
    JSON.stringify(
      {
        checkpointSequence: 1,
        executionId: "exec-1",
        branchId: "demo-analyst@1#1"
      },
      null,
      2
    ),
    "utf8"
  );
  return { runId, runDir };
}

async function createJoinRun(workdir) {
  const runId = "20260423-101500-joinbeef";
  const runDir = path.resolve(workdir, ".ogs", "runs", runId);
  await mkdir(path.resolve(runDir, "logs", "roles"), { recursive: true });
  await writeFile(
    path.resolve(runDir, "state.json"),
    JSON.stringify(
      {
        status: "running",
        error: "",
        transitionCount: 3,
        recentAudits: [],
        auditSummary: {
          okCount: 0,
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
        pendingReviewsById: {},
        reviewHistoryByBranchId: {},
        humanReviewContextByBranchId: {},
        reviewRoundByRoleLineageKey: {},
        branchRecords: {
          "test-operator@1#1": {
            branchId: "test-operator@1#1",
            roleId: "test-operator",
            loopIteration: 0,
            branchSequence: 3,
            lineageId: "test-operator@1#1",
            sessionLineageId: "test-operator@1#1",
            status: "active",
            activatedByRoleId: "test-branch-a",
            activatedByEvent: "A_DONE"
          }
        },
        loopIterations: {},
        selectedEventByBranchId: {},
        finalOutput: "",
        finalRoleId: "",
        lastExecutedRoleId: "test-branch-a",
        nextBranchSequence: 4,
        lastCheckpointSequence: 0
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "system.mmd"),
    [
      "flowchart TD",
      "%% system.id=viz.join.demo",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=demo-intake",
      "%% role.mode.demo-intake=parallel_split",
      "%% join.mode.test-operator=all_of",
      "%% join.sources.test-operator=test-branch-a,test-branch-b",
      "input -->|TASK_IN| intake[Role:demo-intake]",
      "intake[Role:demo-intake] -->|BRANCH_A| brancha[Role:test-branch-a]",
      "intake[Role:demo-intake] -->|BRANCH_B| branchb[Role:test-branch-b]",
      "brancha[Role:test-branch-a] -->|A_DONE| testop[Role:test-operator]",
      "branchb[Role:test-branch-b] -->|B_DONE| testop[Role:test-operator]",
      "testop[Role:test-operator] -->|RESULT_READY| output",
      ""
    ].join("\n"),
    "utf8"
  );
  return { runId, runDir };
}

test("visualizer data projects project and graph information", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-data-project-"));
  await seedProjectFixture(workdir);
  const { runId } = await createSimulationRun(workdir);

  const project = await inspectProjectVisualization(workdir);
  assert.equal(project.project.systemId, "viz.project.demo");
  assert.equal(project.project.reviewedRoleIds[0], "demo-analyst");
  assert.ok(project.project.bindingSummaryByRoleId["demo-analyst"]);

  const projectSystem = await inspectProjectSystemVisualization(workdir);
  assert.match(projectSystem.systemSource, /Role:demo-analyst/);

  const projectConfig = await inspectProjectConfigVisualization(workdir);
  assert.ok(projectConfig.modelCatalog);
  assert.ok(projectConfig.runtime);
  assert.equal(projectConfig.profiles[0].profileId, "profile.review");
  assert.equal(projectConfig.tools[0].toolRef, "tool.review");

  const graph = await inspectRunGraphVisualization({ workdir, runId });
  const graphFromData = await inspectRunGraphVisualizationFromData({ workdir, runId });
  assert.equal(graph.simulation.isSimulation, true);
  assert.equal(graph.simulation.summary.simulatedNodeCount, 1);
  assert.equal(graph.simulation.summary.simulatedExternalCallCount, 0);
  assert.ok(Array.isArray(graph.simulation.summary.expectedPathRoleIds));
  const graphPreview = decodeMermaidLivePayload(graph.simulation.summary.mermaidLiveUrl);
  assert.equal(graphPreview.code, graph.systemSource);
  assert.deepEqual(graphPreview.mermaid, { theme: "default" });
  const dataPreview = decodeMermaidLivePayload(graphFromData.simulation.summary.mermaidLiveUrl);
  assert.equal(dataPreview.code, graphFromData.systemSource);
  assert.deepEqual(dataPreview.mermaid, { theme: "default" });
  assert.equal(graph.graph.nodes[0].roleId, "alpha");
  assert.equal(graph.graph.nodes[0].status, "active");
  assert.equal(graph.graph.nodes[0].lastErrorCode, "E_VIS_TEST");
  assert.equal(graph.graph.nodes[0].lastFailure.errorCode, "E_VIS_TEST");
  assert.equal(graph.graph.edges[0].event, "DONE");
});

test("visualizer data normalizes reviews and resume diagnostics", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-data-review-"));
  await seedProjectFixture(workdir);
  const { runId } = await createWaitingReviewRun(workdir);

  const reviews = await listHumanReviews(workdir, runId);
  assert.equal(reviews.reviews.length, 1);
  assert.equal(reviews.reviews[0].branchStatus, "waiting_review");
  assert.equal(reviews.reviews[0].roleId, "demo-analyst");
  assert.equal(reviews.reviews[0].decision, "approve");
  assert.equal(reviews.reviews[0].decisionPhase, "recorded");
  assert.equal(reviews.reviews[0].history.length, 1);

  const reviewDetail = await inspectHumanReview(workdir, runId, "review.demo-analyst@1#1.r1");
  assert.equal(reviewDetail.branchStatus, "waiting_review");
  assert.equal(reviewDetail.roleId, "demo-analyst");
  assert.equal(reviewDetail.comment, "ship it");
  assert.equal(reviewDetail.currentStatus, "pending");
  assert.equal(reviewDetail.decisionPhase, "recorded");
  assert.equal(reviewDetail.humanReviewContext.comment, "ship it");

  const diagnostics = await inspectRunResumeDiagnostics(workdir, runId);
  assert.equal(diagnostics.status, "mismatch");
  assert.ok(diagnostics.fingerprint.mismatch);
  assert.ok(diagnostics.checks.some((check) => check.id === "review-decisions"));
  assert.ok(diagnostics.checks.some((check) => check.id === "execution-outcomes"));
  assert.ok(diagnostics.recommendations.some((item) => item.action === "inspect-project"));
});

test("visualizer data projects failure triage and resume readiness", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-data-failure-"));
  await seedProjectFixture(workdir);
  const { runId } = await createSimulationRun(workdir);

  const failure = await inspectRunFailureVisualization(workdir, runId);
  assert.equal(failure.status, "failed");
  assert.equal(failure.summary.errorCode, "E_VIS_TEST");
  assert.equal(failure.detail.allowedEvents.includes("DONE"), true);
  assert.equal(failure.suggestedNextChecks.some((item) => item.action === "inspect-binding-resolution"), true);

  const reviewWorkdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-data-readiness-"));
  await seedProjectFixture(reviewWorkdir);
  const { runId: readinessRunId } = await createWaitingReviewRun(reviewWorkdir, { includeDecision: false });
  const readiness = await inspectRunResumeReadiness(reviewWorkdir, readinessRunId);
  assert.equal(readiness.canResume, false);
  assert.equal(readiness.blockers.some((item) => item.blocking === true), true);
  assert.equal(readiness.driftSources.some((item) => item.source === "system.mmd"), true);
});

test("visualizer data projects run contract status pass fail unknown and missing signals", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-contract-status-"));

  const passRun = await createSimulationRun(workdir);
  const passStatus = await inspectRunContractStatusVisualization(workdir, passRun.runId);
  assert.equal(passStatus.status, "pass");
  assert.equal(passStatus.latestContractFailure, null);

  const failRun = await createContractFailureRun(workdir);
  const failStatus = await inspectRunContractStatusVisualization(workdir, failRun.runId);
  assert.equal(failStatus.status, "fail");
  assert.equal(failStatus.attribution.errorCode, "CONTRACT_VIOLATION");
  assert.equal(failStatus.attribution.contract.contractId, "demo-analyst.to.tracker.v1");

  const unknownRun = await createUnknownContractRun(workdir);
  const unknownStatus = await inspectRunContractStatusVisualization(workdir, unknownRun.runId);
  assert.equal(unknownStatus.status, "unknown");
  assert.match(unknownStatus.reason, /runtime artifacts exist/);

  const emptyRun = await createNoRuntimeSignalRun(workdir);
  const emptyStatus = await inspectRunContractStatusVisualization(workdir, emptyRun.runId);
  assert.equal(emptyStatus.status, "no-runtime-signal");
  assert.equal(emptyStatus.signalCount, 0);
});

test("visualizer data projects binding, role package, and contract explainability", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-data-bindings-"));
  await seedStrictContractProjectFixture(workdir);

  const bindings = await inspectProjectBindingVisualization(workdir);
  assert.equal(bindings.bindings.length, 2);
  assert.equal(bindings.bindings[0].source.startsWith("system.mmd"), true);

  const rolePackages = await inspectProjectRolePackagesVisualization(workdir);
  assert.equal(rolePackages.rolePackages.length >= 2, true);
  assert.equal(rolePackages.rolePackages[0].files.roleJson, true);
  assert.equal(rolePackages.rolePackages[0].files.outputSchema, true);
  assert.ok(rolePackages.rolePackages.some((entry) => entry.roleId === "demo-intake" && entry.inSystem === false));

  const contracts = await inspectProjectContractVisualization(workdir);
  assert.equal(contracts.coverage.coveredFlowCount, 1);
  assert.equal(contracts.coverage.missingFlowCount, 0);
  assert.equal(contracts.uncoveredEdges.length, 0);
  assert.equal(contracts.coverage.roleInputCount, 1);
  assert.equal(
    contracts.contracts.some((entry) => entry.kind === "flow" && entry.contractId === "demo-analyst.to.tracker.v1"),
    true
  );
  assert.equal(
    contracts.contracts.some((entry) => entry.kind === "role_input" && entry.contractId === "tracker.input.v1"),
    true
  );
});

test("visualizer data derives review decision phases from durable markers", async () => {
  const recordedWorkdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-data-review-phase-recorded-"));
  await seedProjectFixture(recordedWorkdir);
  const recordedRun = await createWaitingReviewRun(recordedWorkdir, {
    decisionMarkers: {}
  });

  const pendingWorkdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-data-review-phase-pending-"));
  await seedProjectFixture(pendingWorkdir);
  const pendingReconcileRun = await createWaitingReviewRun(pendingWorkdir, {
    decisionMarkers: {
      checkpointSequence: 7,
      appliedAt: "2026-04-22T09:15:02.000Z"
    }
  });

  const appliedWorkdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-data-review-phase-applied-"));
  await seedProjectFixture(appliedWorkdir);
  const appliedRun = await createWaitingReviewRun(appliedWorkdir, {
    decisionMarkers: {
      checkpointSequence: 8,
      appliedAt: "2026-04-22T09:15:02.000Z",
      reconciledAt: "2026-04-22T09:15:03.000Z"
    }
  });

  const recorded = await inspectHumanReview(recordedWorkdir, recordedRun.runId, "review.demo-analyst@1#1.r1");
  assert.equal(recorded.currentStatus, "pending");
  assert.equal(recorded.decisionPhase, "recorded");

  const pendingReconcile = await inspectHumanReview(
    pendingWorkdir,
    pendingReconcileRun.runId,
    "review.demo-analyst@1#1.r1"
  );
  assert.equal(pendingReconcile.currentStatus, "pending");
  assert.equal(pendingReconcile.decisionPhase, "pending_reconcile");

  const applied = await inspectHumanReview(appliedWorkdir, appliedRun.runId, "review.demo-analyst@1#1.r1");
  assert.equal(applied.currentStatus, "pending");
  assert.equal(applied.decisionPhase, "applied");
});

test("visualizer data projects join waiting sources for graph view", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-data-join-"));
  await seedProjectFixture(workdir);
  const { runId } = await createJoinRun(workdir);

  const graph = await inspectRunGraphVisualization({ workdir, runId });
  const joinNode = graph.graph.nodes.find((node) => node.roleId === "test-operator");
  assert.deepEqual(joinNode.expectedSources, ["test-branch-a", "test-branch-b"]);
  assert.deepEqual(joinNode.readySources, ["test-branch-a"]);
  assert.deepEqual(joinNode.missingSources, ["test-branch-b"]);
});
