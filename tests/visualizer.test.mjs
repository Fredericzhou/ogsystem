import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";

import { resolveProjectRoleRootDir } from "../dist/runtime/bundled-repos.js";
import { compileExecutionSnapshot } from "../dist/runtime/compiler.js";
import { loadFlowContractPlan } from "../dist/runtime/flow-contract.js";
import { loadModelCatalog } from "../dist/runtime/model-catalog.js";
import { loadModelSelection, resolveModelSelectionForSystem } from "../dist/runtime/model-selection.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import { buildRunPlanFingerprint } from "../dist/runtime/plan-fingerprint.js";
import { loadLaws, loadRolePackages, loadRuntimeConfig } from "../dist/runtime/runtime-loader.js";
import { resolveEffectiveLaw } from "../dist/runtime/runtime-setup.js";
import { startVisualizationServer } from "../dist/visualizer/server.js";

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

async function writeMatchingPlanFingerprint(workdir, runDir, systemSource) {
  const system = parseSystemFromMermaidSource(systemSource);
  const runtimeConfig = await loadRuntimeConfig(undefined, workdir);
  const modelSelection = await loadModelSelection(path.resolve(workdir, ".ogs", "model-selection.json"));
  const modelCatalog = await loadModelCatalog(path.resolve(workdir, ".ogs", "model-catalog.json"));
  const resolvedModelSelection = resolveModelSelectionForSystem({
    system,
    selection: modelSelection,
    catalog: modelCatalog
  });
  const laws = await loadLaws(undefined, workdir);
  const effectiveLaw = resolveEffectiveLaw(system, laws);
  const rolePackagesByRoleId = await loadRolePackages({
    system,
    roleRootDir: resolveProjectRoleRootDir(workdir, runtimeConfig.roleRepo)
  });
  const contractPlan = system.graph?.handoffContracts
    ? await loadFlowContractPlan({
        system,
        contractPath: system.graph.handoffContracts
      })
    : undefined;
  const compilerResult = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    contractPlan,
    effectiveLaw,
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId
  });
  assert.equal(compilerResult.ok, true);
  const fingerprint = buildRunPlanFingerprint({
    system,
    rolePackagesByRoleId,
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId,
    effectiveLaw,
    contractPlan,
    compilerSnapshot: compilerResult.snapshot
  });
  await writeFile(path.resolve(runDir, "plan-fingerprint.json"), JSON.stringify(fingerprint, null, 2), "utf8");
}

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
      }),
      JSON.stringify({
        type: "runtime_error",
        at: "2026-04-16T01:02:04.500Z",
        roleId: "alpha",
        status: "failed",
        errorEnvelope: {
          errorCode: "E_VIS_TEST"
        }
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
      }),
      JSON.stringify({
        version: 1,
        cursor: 2,
        at: "2026-04-16T01:02:04.500Z",
        type: "runtime_error",
        roleId: "alpha",
        status: "failed",
        errorCode: "E_VIS_TEST"
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

async function createWaitingReviewFixtureRun(workdir, options = {}) {
  const includeDecision = options.includeDecision !== false;
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
        reviewHistoryByBranchId: {},
        humanReviewContextByBranchId: {},
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
  const systemSource = [
    "flowchart TD",
    "%% system.id=viz.review.demo",
    "%% system.version=1.0.0",
    "%% law.global=law.minimal.base",
    "%% entry.role=demo-analyst",
    "input -->|GO| analyst[Role:demo-analyst]",
    "analyst[Role:demo-analyst] -->|DONE| output",
    ""
  ].join("\n");
  await writeFile(path.resolve(runDir, "system.mmd"), systemSource, "utf8");
  await writeFile(
    path.resolve(runDir, "events.ndjson"),
    [
      JSON.stringify({ type: "run_start", at: "2026-04-22T09:15:00.000Z" }),
      JSON.stringify({
        type: "human_review_requested",
        at: "2026-04-22T09:15:00.100Z",
        roleId: "demo-analyst",
        branchId: "demo-analyst@1#1",
        lineageId: "demo-analyst@1#1",
        loopIteration: 1,
        reviewId: "review.demo-analyst@1#1.r1",
        round: 1
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
        at: "2026-04-22T09:15:00.100Z",
        type: "human_review_requested",
        roleId: "demo-analyst",
        reviewId: "review.demo-analyst@1#1.r1",
        status: "pending"
      }),
      JSON.stringify({
        version: 1,
        cursor: 1,
        at: "2026-04-22T09:15:01.000Z",
        type: "human_review_decision_applied",
        roleId: "demo-analyst",
        reviewId: "review.demo-analyst@1#1.r1",
        status: "pending"
      })
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
  if (includeDecision) {
    await writeFile(
      path.resolve(runDir, "control", "reviews", "review.demo-analyst@1#1.r1.decision.json"),
      JSON.stringify(
        {
          reviewId: "review.demo-analyst@1#1.r1",
          committedAt: "2026-04-22T09:15:01.000Z",
          decidedAt: "2026-04-22T09:15:01.000Z",
          decision: "approve",
          actor: "qa",
          comment: "ship it"
        },
        null,
        2
      ),
      "utf8"
    );
  }
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
  await writeMatchingPlanFingerprint(workdir, runDir, systemSource);
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
  await seedProjectFixture(workdir);
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
    assert.match(rootHtml, /Project Overview/);
    assert.match(rootHtml, /Reviews/);
    assert.match(rootHtml, /Resume Diagnostics/);
    assert.match(rootHtml, /Logs/);

    const projectHome = await fetch(`${url}/?view=project`);
    assert.equal(projectHome.status, 200);

    const projectResponse = await fetch(`${url}/api/v1/project`);
    assert.equal(projectResponse.status, 200);
    const project = await projectResponse.json();
    assert.equal(project.project.systemId, "viz.project.demo");
    assert.equal(project.project.roleCount, 1);
    assert.match(project.project.roleRepoRoot, /og-roles$/);

    const projectSystemResponse = await fetch(`${url}/api/v1/project/system`);
    assert.equal(projectSystemResponse.status, 200);
    const projectSystem = await projectSystemResponse.json();
    assert.match(projectSystem.systemSource, /Role:demo-analyst/);

    const projectConfigResponse = await fetch(`${url}/api/v1/project/config`);
    assert.equal(projectConfigResponse.status, 200);
    const projectConfig = await projectConfigResponse.json();
    assert.ok(projectConfig.runtime);
    assert.ok(projectConfig.modelCatalog);

    const projectRolesResponse = await fetch(`${url}/api/v1/project/roles`);
    assert.equal(projectRolesResponse.status, 200);
    const projectRoles = await projectRolesResponse.json();
    assert.equal(projectRoles.roles.length, 1);
    assert.equal(projectRoles.roles[0].roleId, "demo-analyst");

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
    assert.equal(detail.snapshot.isSimulation, true);
    assert.match(detail.systemSource, /alpha\[Role:alpha\] -->\|DONE\| output/);

    const eventsResponse = await fetch(`${url}/api/v1/runs/${runId}/events?cursor=0&limit=1`);
    assert.equal(eventsResponse.status, 200);
    const events = await eventsResponse.json();
    assert.equal(events.events.length, 1);
    assert.equal(events.nextCursor, 3);
    assert.equal(events.events[0].record.type, "run_start");

    const failedEventsResponse = await fetch(
      `${url}/api/v1/runs/${runId}/events?cursor=0&limit=10&status=failed&errorCode=E_VIS_TEST`
    );
    assert.equal(failedEventsResponse.status, 200);
    const failedEvents = await failedEventsResponse.json();
    assert.equal(failedEvents.events.length, 1);
    assert.equal(failedEvents.events[0].record.errorCode, "E_VIS_TEST");

    const graphResponse = await fetch(`${url}/api/v1/runs/${runId}/graph`);
    assert.equal(graphResponse.status, 200);
    const graph = await graphResponse.json();
    assert.match(graph.systemSource, /flowchart TD/);
    assert.equal(graph.simulation.isSimulation, true);
    assert.equal(graph.graph.nodes[0].roleId, "alpha");
    assert.equal(graph.graph.edges[0].event, "DONE");

    const engineLogsResponse = await fetch(`${url}/api/v1/runs/${runId}/logs?engine=true`);
    assert.equal(engineLogsResponse.status, 200);
    const engineLogs = await engineLogsResponse.json();
    assert.equal(engineLogs.records.length, 1);

    const roleLogsResponse = await fetch(`${url}/api/v1/runs/${runId}/logs?roleId=alpha`);
    assert.equal(roleLogsResponse.status, 200);
    const roleLogs = await roleLogsResponse.json();
    assert.equal(roleLogs.records.length, 1);

    const filteredRoleLogsResponse = await fetch(
      `${url}/api/v1/runs/${runId}/logs?roleId=alpha&tail=1&since=2026-04-16T01:02:04.000Z`
    );
    assert.equal(filteredRoleLogsResponse.status, 200);
    const filteredRoleLogs = await filteredRoleLogsResponse.json();
    assert.equal(filteredRoleLogs.records.length, 1);

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
  await seedProjectFixture(workdir);
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

    const reviewEventsResponse = await fetch(
      `${url}/api/v1/runs/${runId}/events?cursor=0&limit=10&reviewId=review.demo-analyst@1%231.r1`
    );
    assert.equal(reviewEventsResponse.status, 200);
    const reviewEvents = await reviewEventsResponse.json();
    assert.equal(reviewEvents.events.length, 2);

    const reviewsResponse = await fetch(`${url}/api/v1/runs/${runId}/reviews`);
    assert.equal(reviewsResponse.status, 200);
    const reviews = await reviewsResponse.json();
    assert.equal(reviews.reviews.length, 1);
    assert.equal(reviews.reviews[0].roleId, "demo-analyst");
    assert.equal(reviews.reviews[0].branchStatus, "waiting_review");
    assert.equal(reviews.reviews[0].decision, "approve");

    const reviewDetailResponse = await fetch(
      `${url}/api/v1/runs/${runId}/reviews/review.demo-analyst@1%231.r1`
    );
    assert.equal(reviewDetailResponse.status, 200);
    const reviewDetail = await reviewDetailResponse.json();
    assert.equal(reviewDetail.roleId, "demo-analyst");
    assert.equal(reviewDetail.comment, "ship it");

    const diagnosticsResponse = await fetch(`${url}/api/v1/runs/${runId}/resume-diagnostics`);
    assert.equal(diagnosticsResponse.status, 200);
    const diagnostics = await diagnosticsResponse.json();
    assert.equal(diagnostics.status, "dirty");
    assert.ok(diagnostics.checks.some((check) => check.id === "review-decisions"));
    assert.ok(diagnostics.checks.some((check) => check.id === "execution-outcomes"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server writes review decisions, stop requests, and reindex through lifecycle entrypoints", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-control-"));
  await seedProjectFixture(workdir);
  const { runId } = await createWaitingReviewFixtureRun(workdir, { includeDecision: false });
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
    const reindexResponse = await fetch(`${url}/api/v1/runs/reindex`, { method: "POST" });
    assert.equal(reindexResponse.status, 200);
    const reindex = await reindexResponse.json();
    assert.equal(reindex.runs[0].runId, runId);

    const decisionResponse = await fetch(
      `${url}/api/v1/runs/${runId}/reviews/review.demo-analyst@1%231.r1/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision: "approve",
          actor: "qa",
          comment: "approved in visualizer"
        })
      }
    );
    assert.equal(decisionResponse.status, 200);
    const decision = await decisionResponse.json();
    assert.equal(decision.decision.decision, "approve");

    const reviewDetailResponse = await fetch(
      `${url}/api/v1/runs/${runId}/reviews/review.demo-analyst@1%231.r1`
    );
    assert.equal(reviewDetailResponse.status, 200);
    const reviewDetail = await reviewDetailResponse.json();
    assert.equal(reviewDetail.decision, "approve");
    assert.equal(reviewDetail.comment, "approved in visualizer");

    const stopResponse = await fetch(`${url}/api/v1/runs/${runId}/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "stop from visualizer test" })
    });
    assert.equal(stopResponse.status, 200);
    const stop = await stopResponse.json();
    assert.equal(stop.runId, runId);
    assert.equal(stop.request.reason, "stop from visualizer test");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
