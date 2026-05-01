import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";

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
import { authoringToCanvasDocument } from "../dist/visualizer/studio-authoring.js";

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

async function seedAlternateProjectFixture(workdir) {
  await seedProjectFixture(workdir);
  await writeFile(
    path.resolve(workdir, ".ogs", "project.json"),
    JSON.stringify(
      {
        projectId: "viz.project.loaded",
        createdAt: "2026-04-23T12:00:00.000Z"
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
      "%% system.id=viz.project.loaded",
      "%% system.version=2.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=demo-analyst",
      "%% model.bind.demo-analyst=opencode/gpt-5.4",
      "input -->|ENTER| analyst[Role:demo-analyst]",
      "analyst[Role:demo-analyst] -->|DONE| output",
      ""
    ].join("\n"),
    "utf8"
  );
}

async function seedRunnableReviewProjectFixture(workdir) {
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
        projectId: "viz.runtime.review.demo",
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
      "%% system.id=viz.runtime.review.demo",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=imported.agency.experiment-tracker",
      "%% model.bind.imported.agency.experiment-tracker=opencode/gpt-5.4",
      "%% review.mode.imported.agency.experiment-tracker=required",
      "%% review.timeout.imported.agency.experiment-tracker=3600",
      "%% review.timeout.action.imported.agency.experiment-tracker=pause",
      "%% review.rework.target.imported.agency.experiment-tracker=imported.agency.experiment-tracker",
      "%% review.rework.max.imported.agency.experiment-tracker=2",
      "%% review.terminate.scope.imported.agency.experiment-tracker=branch",
      "input -->|ENTER| tracker[Role:imported.agency.experiment-tracker]",
      "tracker[Role:imported.agency.experiment-tracker] -->|DONE| output",
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
          comment: "ship it",
          ...decisionMarkers
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
    assert.match(rootHtml, /Ops Summary/);
    assert.match(rootHtml, /Failure Triage/);
    assert.match(rootHtml, /Review Queue/);
    assert.match(rootHtml, /Resume Readiness/);
    assert.match(rootHtml, /Config Explain/);
    assert.match(rootHtml, /Logs/);
    assert.match(rootHtml, /debug-graph-body/);
    assert.match(rootHtml, /operate-tabs/);
    assert.match(rootHtml, /<script src="\/assets\/studio-graph\.js"><\/script>/);
    assert.match(rootHtml, /<article class="card span-12 operate-panel operate-overview">\s*<header><h3>Timeline<\/h3><\/header>/);

    const studioGraphAsset = await fetch(`${url}/assets/studio-graph.js`);
    assert.equal(studioGraphAsset.status, 200);
    assert.match(studioGraphAsset.headers.get("content-type") ?? "", /application\/javascript/);
    assert.match(await studioGraphAsset.text(), /mountStudioX6Bridge/);

    const unknownAsset = await fetch(`${url}/assets/not-allowed.js`);
    assert.equal(unknownAsset.status, 404);

    const zhRoot = await fetch(`${url}/?lang=zh-CN`);
    assert.equal(zhRoot.status, 200);
    const zhRootHtml = await zhRoot.text();
    assert.match(zhRootHtml, /<html lang="zh-CN">/);
    assert.match(zhRootHtml, /项目概览/);
    assert.match(zhRootHtml, /运行调试/);
    assert.match(zhRootHtml, /<option value="pending">待处理<\/option>/);
    assert.match(zhRootHtml, /<option value="waiting_review">等待评审<\/option>/);

    const acceptLanguageRoot = await fetch(url, {
      headers: { "accept-language": "fr-CA, zh;q=0.9, en;q=0.4" }
    });
    assert.equal(acceptLanguageRoot.status, 200);
    assert.match(await acceptLanguageRoot.text(), /<html lang="zh-CN">/);

    const unsupportedRoot = await fetch(`${url}/?lang=fr`, {
      headers: { "accept-language": "zh-CN" }
    });
    assert.equal(unsupportedRoot.status, 200);
    const unsupportedRootHtml = await unsupportedRoot.text();
    assert.match(unsupportedRootHtml, /<html lang="en">/);
    assert.match(unsupportedRootHtml, /Project Overview/);

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
    assert.equal(projectConfig.profiles[0].profileId, "profile.review");
    assert.equal(projectConfig.tools[0].toolRef, "tool.review");

    const profileUpsertResponse = await fetch(`${url}/api/v1/project/profiles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [{ profileId: "profile.generated", toolRef: "tool.review", timeoutMs: 30000 }]
      })
    });
    assert.equal(profileUpsertResponse.status, 200);
    const profileUpsert = await profileUpsertResponse.json();
    assert.ok(profileUpsert.profiles.some((profile) => profile.profileId === "profile.generated"));
    const profilesFile = JSON.parse(await readFile(path.resolve(workdir, "profiles.json"), "utf8"));
    assert.ok(profilesFile.some((profile) => profile.profileId === "profile.generated"));

    const projectRolesResponse = await fetch(`${url}/api/v1/project/roles`);
    assert.equal(projectRolesResponse.status, 200);
    const projectRoles = await projectRolesResponse.json();
    assert.equal(projectRoles.roles.length, 1);
    assert.equal(projectRoles.roles[0].roleId, "demo-analyst");

    const projectOpsResponse = await fetch(`${url}/api/v1/project/ops-summary`);
    assert.equal(projectOpsResponse.status, 200);
    const projectOps = await projectOpsResponse.json();
    assert.equal(projectOps.summary.recentFailureCount, 1);
    assert.equal(projectOps.failureGroups.byErrorCode[0].key, "E_VIS_TEST");
    assert.equal(projectOps.reviewRework.pendingReviewCount, 0);
    assert.equal(Array.isArray(projectOps.resumeReadiness.runs), true);

    const projectReadinessResponse = await fetch(`${url}/api/v1/project/readiness`);
    assert.equal(projectReadinessResponse.status, 200);
    const projectReadiness = await projectReadinessResponse.json();
    assert.equal(projectReadiness.systemId, "viz.project.demo");
    assert.equal(projectReadiness.canDryRun, true);
    assert.equal(projectReadiness.roleRepoHealth.roles[0].status, "ok");

    const projectBindingsResponse = await fetch(`${url}/api/v1/project/bindings`);
    assert.equal(projectBindingsResponse.status, 200);
    const projectBindings = await projectBindingsResponse.json();
    assert.equal(projectBindings.bindings.length, 1);
    assert.equal(projectBindings.bindings[0].roleId, "demo-analyst");

    const projectRolePackagesResponse = await fetch(`${url}/api/v1/project/role-packages`);
    assert.equal(projectRolePackagesResponse.status, 200);
    const projectRolePackages = await projectRolePackagesResponse.json();
    assert.equal(projectRolePackages.rolePackages.length > 1, true);
    const activeRolePackage = projectRolePackages.rolePackages.find((entry) => entry.roleId === "demo-analyst");
    assert.equal(activeRolePackage.files.roleJson, true);
    assert.equal(activeRolePackage.inSystem, true);
    assert.ok(projectRolePackages.rolePackages.some((entry) => entry.roleId !== "demo-analyst" && entry.inSystem === false));

    const projectContractsResponse = await fetch(`${url}/api/v1/project/contracts`);
    assert.equal(projectContractsResponse.status, 200);
    const projectContracts = await projectContractsResponse.json();
    assert.equal(Array.isArray(projectContracts.contracts), true);

    const listResponse = await fetch(`${url}/api/v1/runs`);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    assert.equal(list.runs.length, 1);
    assert.equal(list.runs[0].runId, runId);
    assert.equal(list.runs[0].status, "done");

    const detailResponse = await fetch(`${url}/api/v1/runs/${runId}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.header.status, "done");
    assert.equal(detail.header.activeBranches, 1);
    assert.equal(detail.header.transitionCount, 5);
    assert.equal(detail.header.finalRoleId, "alpha");
    assert.equal(detail.header.isSimulation, true);
    assert.match(detail.systemSource, /alpha\[Role:alpha\] -->\|DONE\| output/);

    const failureResponse = await fetch(`${url}/api/v1/runs/${runId}/failure`);
    assert.equal(failureResponse.status, 200);
    const failure = await failureResponse.json();
    assert.equal(failure.status, "failed");
    assert.equal(failure.summary.errorCode, "E_VIS_TEST");
    assert.equal(Array.isArray(failure.suggestedNextChecks), true);

    const runContractsResponse = await fetch(`${url}/api/v1/runs/${runId}/contracts`);
    assert.equal(runContractsResponse.status, 200);
    const runContracts = await runContractsResponse.json();
    assert.equal(runContracts.status, "pass");
    assert.equal(runContracts.runId, runId);

    for (const debugEndpoint of ["failure", "contracts", "resume-readiness"]) {
      const missingResponse = await fetch(`${url}/api/v1/runs/missing-run/${debugEndpoint}`);
      assert.equal(missingResponse.status, 404);
      const missing = await missingResponse.json();
      assert.equal(missing.error.code, "RUN_NOT_FOUND");
    }

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

test("visualizer server maps config explain API setup failures to error envelopes", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-config-error-"));
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
    for (const endpoint of ["bindings", "contracts", "role-packages"]) {
      const response = await fetch(`${url}/api/v1/project/${endpoint}`);
      assert.equal(response.status, 409);
      const body = await response.json();
      assert.equal(body.error.code, "PROJECT_NOT_INITIALIZED");
      assert.match(body.error.message, /Create or load an OGSystem project/);
    }
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
    assert.equal(detail.header.status, "stopped");
    assert.equal(detail.header.pendingReviewCount, 1);
    assert.equal(detail.header.hasWaitingHumanReview, true);
    assert.equal(detail.header.activeBranches, 0);
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
    assert.equal(reviews.reviews[0].currentStatus, "pending");
    assert.equal(reviews.reviews[0].decisionPhase, "recorded");

    const reviewDetailResponse = await fetch(
      `${url}/api/v1/runs/${runId}/reviews/review.demo-analyst@1%231.r1`
    );
    assert.equal(reviewDetailResponse.status, 200);
    const reviewDetail = await reviewDetailResponse.json();
    assert.equal(reviewDetail.roleId, "demo-analyst");
    assert.equal(reviewDetail.comment, "ship it");
    assert.equal(reviewDetail.currentStatus, "pending");
    assert.equal(reviewDetail.decisionPhase, "recorded");

    const diagnosticsResponse = await fetch(`${url}/api/v1/runs/${runId}/resume-diagnostics`);
    assert.equal(diagnosticsResponse.status, 200);
    const diagnostics = await diagnosticsResponse.json();
    assert.equal(diagnostics.status, "dirty");
    assert.ok(diagnostics.checks.some((check) => check.id === "review-decisions"));
    assert.ok(diagnostics.checks.some((check) => check.id === "execution-outcomes"));

    const readinessResponse = await fetch(`${url}/api/v1/runs/${runId}/resume-readiness`);
    assert.equal(readinessResponse.status, 200);
    const readiness = await readinessResponse.json();
    assert.equal(Array.isArray(readiness.blockers), true);
    assert.equal(Array.isArray(readiness.driftSources), true);
    assert.equal(readiness.status, "dirty");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server exposes applied review decision phases without changing lifecycle status", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-review-phase-"));
  await seedProjectFixture(workdir);
  const { runId } = await createWaitingReviewFixtureRun(workdir, {
    decisionMarkers: {
      checkpointSequence: 7,
      appliedAt: "2026-04-22T09:15:02.000Z",
      reconciledAt: "2026-04-22T09:15:03.000Z"
    }
  });
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
    const reviewsResponse = await fetch(`${url}/api/v1/runs/${runId}/reviews`);
    assert.equal(reviewsResponse.status, 200);
    const reviews = await reviewsResponse.json();
    assert.equal(reviews.reviews[0].currentStatus, "pending");
    assert.equal(reviews.reviews[0].decisionPhase, "applied");

    const reviewDetailResponse = await fetch(
      `${url}/api/v1/runs/${runId}/reviews/review.demo-analyst@1%231.r1`
    );
    assert.equal(reviewDetailResponse.status, 200);
    const reviewDetail = await reviewDetailResponse.json();
    assert.equal(reviewDetail.currentStatus, "pending");
    assert.equal(reviewDetail.decisionPhase, "applied");
    assert.equal(reviewDetail.reconciledAt, "2026-04-22T09:15:03.000Z");
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
    assert.equal(decision.action, "review:approve");
    assert.equal(decision.semanticStatus, "human-review-approved");
    assert.equal(decision.detail.reviewId, "review.demo-analyst@1#1.r1");

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
    assert.equal(stop.action, "run-stop");
    assert.equal(stop.detail.lifecycle.request.reason, "stop from visualizer test");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server keeps idle run list stable until reindex refreshes the cache", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-runs-cache-"));
  await seedProjectFixture(workdir);
  const firstRun = await createFixtureRun(workdir);
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
    const firstListResponse = await fetch(`${url}/api/v1/runs`);
    assert.equal(firstListResponse.status, 200);
    const firstList = await firstListResponse.json();
    assert.equal(firstList.runs.length, 1);
    assert.equal(firstList.runs[0].runId, firstRun.runId);

    const secondRun = await createWaitingReviewFixtureRun(workdir);
    const cachedListResponse = await fetch(`${url}/api/v1/runs`);
    assert.equal(cachedListResponse.status, 200);
    const cachedList = await cachedListResponse.json();
    assert.equal(cachedList.runs.length, 1);
    assert.equal(cachedList.runs[0].runId, firstRun.runId);

    const reindexResponse = await fetch(`${url}/api/v1/runs/reindex`, { method: "POST" });
    assert.equal(reindexResponse.status, 200);
    const reindex = await reindexResponse.json();
    assert.equal(reindex.runs.length, 2);

    const refreshedListResponse = await fetch(`${url}/api/v1/runs`);
    assert.equal(refreshedListResponse.status, 200);
    const refreshedList = await refreshedListResponse.json();
    assert.equal(refreshedList.runs.length, 2);
    assert.ok(refreshedList.runs.some((run) => run.runId === secondRun.runId));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server exposes Mermaid workbench APIs and project export", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-workbench-"));
  await seedProjectFixture(workdir);
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
    const workbenchResponse = await fetch(`${url}/api/v1/project/system/workbench`);
    assert.equal(workbenchResponse.status, 200);
    const workbench = await workbenchResponse.json();
    assert.equal(workbench.validation.ok, true);
    assert.equal(workbench.validation.structure.roleCount, 1);

    const invalidValidateResponse = await fetch(`${url}/api/v1/project/system/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemSource: "flowchart TD\nINVALID"
      })
    });
    assert.equal(invalidValidateResponse.status, 200);
    const invalidValidation = await invalidValidateResponse.json();
    assert.equal(invalidValidation.ok, false);
    assert.ok(invalidValidation.diagnostics.length > 0);

    const originalSystemSource = await readFile(path.resolve(workdir, "system.mmd"), "utf8");
    const invalidSaveResponse = await fetch(`${url}/api/v1/project/system/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemSource: "flowchart TD\nINVALID"
      })
    });
    assert.equal(invalidSaveResponse.status, 200);
    const invalidSave = await invalidSaveResponse.json();
    assert.equal(invalidSave.validation.ok, false);
    assert.equal(await readFile(path.resolve(workdir, "system.mmd"), "utf8"), originalSystemSource);

    const bridgeResponse = await fetch(`${url}/api/v1/project/studio/bridge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemSource: workbench.systemSource,
        systemPath: "system.mmd"
      })
    });
    assert.equal(bridgeResponse.status, 200);
    const bridge = await bridgeResponse.json();
    assert.equal(bridge.validation.ok, true);
    assert.equal(bridge.extracted.systemId, "viz.project.demo");
    assert.equal(bridge.extracted.roles.some((role) => role.roleId === "demo-analyst" && role.bindingKind === "model"), true);
    assert.equal(bridge.extracted.flows.some((flow) => flow.eventType === "DONE"), true);

    const templatesResponse = await fetch(`${url}/api/v1/project/studio/templates`);
    assert.equal(templatesResponse.status, 200);
    const templates = await templatesResponse.json();
    assert.deepEqual(templates.templates.map((template) => template.id).sort(), ["consultation", "debate", "review"]);

    const draftSaveResponse = await fetch(`${url}/api/v1/project/studio/authoring`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        authoring: bridge.authoring
      })
    });
    assert.equal(draftSaveResponse.status, 200);
    const draftSave = await draftSaveResponse.json();
    assert.match(draftSave.draftPath, /\.ogs\/studio\/system\.authoring\.json$/);
    assert.equal(await readFile(path.resolve(workdir, "system.mmd"), "utf8"), originalSystemSource);

    const generateResponse = await fetch(`${url}/api/v1/project/studio/authoring/generate-mmd`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        authoring: bridge.authoring
      })
    });
    assert.equal(generateResponse.status, 200);
    const generated = await generateResponse.json();
    assert.equal(generated.validation.ok, true);
    assert.match(generated.systemSource, /%% system\.id=viz\.project\.demo/);

    const canvas = authoringToCanvasDocument(bridge.authoring);
    const applyCanvasResponse = await fetch(`${url}/api/v1/project/studio/authoring/apply-canvas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        authoring: bridge.authoring,
        canvas: {
          ...canvas,
          nodes: canvas.nodes.map((node) =>
            node.roleId === "demo-analyst"
              ? { ...node, x: 500, y: 600, width: 210, height: 100 }
              : node
          ),
          edges: [
            ...canvas.edges.filter((edge) => edge.eventType !== "DONE"),
            {
              source: "demo-analyst",
              target: "__system_end__",
              label: "COMPLETE",
              eventType: "COMPLETE",
              runtimeOnlyErrorFlow: false,
              participatesInJoin: false
            }
          ]
        }
      })
    });
    assert.equal(applyCanvasResponse.status, 200);
    const appliedCanvas = await applyCanvasResponse.json();
    assert.equal(appliedCanvas.validation.ok, true);
    assert.match(appliedCanvas.systemSource, /\|COMPLETE\| output/);
    assert.equal(appliedCanvas.authoring.layout.nodes["demo-analyst"].x, 500);
    assert.equal(appliedCanvas.canvas.edges.some((edge) => edge.eventType === "COMPLETE"), true);
    assert.equal(await readFile(path.resolve(workdir, "system.mmd"), "utf8"), originalSystemSource);

    const saveAsResponse = await fetch(`${url}/api/v1/project/system/save-as`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemSource: workbench.systemSource,
        saveAsPath: "drafts/system-copy.mmd"
      })
    });
    assert.equal(saveAsResponse.status, 200);
    const saveAs = await saveAsResponse.json();
    assert.equal(saveAs.validation.ok, true);
    assert.match(saveAs.savedPath, /drafts\/system-copy\.mmd$/);

    const exportResponse = await fetch(`${url}/api/v1/project/export`, { method: "POST" });
    assert.equal(exportResponse.status, 200);
    const exported = await exportResponse.json();
    assert.equal(exported.mode, "single-project-v1");
    assert.equal(exported.releaseManifest.manifestVersion, 1);
    assert.equal(exported.releaseManifest.systemPath, "system.mmd");
    assert.match(exported.releaseManifest.systemHash, /^[a-f0-9]{64}$/);
    assert.ok(exported.releaseManifest.excludes.includes(".ogs/runs"));
    assert.match(exported.project.systemSource, /viz\.project\.demo/);
    assert.equal(Object.hasOwn(exported.project, "runs"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server supports empty workspace project creation without implicit writes", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-empty-"));
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
    const workspaceResponse = await fetch(`${url}/api/v1/workspace`);
    assert.equal(workspaceResponse.status, 200);
    const workspace = await workspaceResponse.json();
    assert.equal(workspace.hasProject, false);
    assert.equal(workspace.state, "empty");

    const runsResponse = await fetch(`${url}/api/v1/runs`);
    assert.equal(runsResponse.status, 200);
    assert.deepEqual((await runsResponse.json()).runs, []);

    const startResponse = await fetch(`${url}/api/v1/runs/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemPath: "system.mmd", input: "must not write", dryRun: true })
    });
    assert.equal(startResponse.status, 409);
    assert.equal((await startResponse.json()).error.code, "PROJECT_NOT_INITIALIZED");
    await assert.rejects(() => stat(path.resolve(workdir, ".ogs")), /ENOENT/);
    await assert.rejects(() => stat(path.resolve(workdir, "system.mmd")), /ENOENT/);

    const catalogResponse = await fetch(`${url}/api/v1/project/role-catalog`);
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json();
    assert.equal(catalog.source, "installed");
    assert.ok(catalog.roles.some((role) => role.roleId === "demo-analyst"));
    await assert.rejects(() => stat(path.resolve(workdir, ".ogs")), /ENOENT/);
    await assert.rejects(() => stat(path.resolve(workdir, "og-roles")), /ENOENT/);

    const roleImportResponse = await fetch(`${url}/api/v1/project/roles/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "installed", roleIds: ["demo-analyst"] })
    });
    assert.equal(roleImportResponse.status, 409);
    assert.equal((await roleImportResponse.json()).error.code, "PROJECT_NOT_INITIALIZED");
    await assert.rejects(() => stat(path.resolve(workdir, "og-roles")), /ENOENT/);

    const createResponse = await fetch(`${url}/api/v1/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "create-empty-once",
        projectId: "viz.empty.created",
        projectName: "Empty Created",
        templateId: "empty",
        conflictStrategy: "init-current"
      })
    });
    const createBody = await createResponse.json();
    assert.equal(createResponse.status, 200, JSON.stringify(createBody));
    const created = createBody;
    assert.equal(created.projectId, "viz.empty.created");
    assert.equal(created.draftState, "draft-unbound-unpublishable");
    await stat(path.resolve(workdir, ".ogs", "project.json"));
    await stat(path.resolve(workdir, ".ogs", "studio", "system.authoring.json"));
    await stat(path.resolve(workdir, "og-roles", "roles", "demo-analyst", "role.json"));
    const projectJson = JSON.parse(await readFile(path.resolve(workdir, ".ogs", "project.json"), "utf8"));
    assert.equal(projectJson.projectId, "viz.empty.created");
    assert.equal(projectJson.projectName, "Empty Created");
    const systemSource = await readFile(path.resolve(workdir, "system.mmd"), "utf8");
    const parsed = parseSystemFromMermaidSource(systemSource);
    assert.equal(parsed.entryRoleId, "demo-analyst");

    const createReplayResponse = await fetch(`${url}/api/v1/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "create-empty-once",
        projectId: "viz.empty.created",
        projectName: "Empty Created",
        templateId: "empty",
        conflictStrategy: "init-current"
      })
    });
    assert.equal(createReplayResponse.status, 200);
    const createReplay = await createReplayResponse.json();
    assert.equal(createReplay.idempotentReplay, true);
    assert.equal(createReplay.projectId, "viz.empty.created");

    const workspaceAfterResponse = await fetch(`${url}/api/v1/workspace`);
    assert.equal(workspaceAfterResponse.status, 200);
    const workspaceAfter = await workspaceAfterResponse.json();
    assert.equal(workspaceAfter.hasProject, true);
    assert.equal(workspaceAfter.state, "project");

    const duplicateCreateResponse = await fetch(`${url}/api/v1/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "viz.empty.created", templateId: "empty" })
    });
    assert.equal(duplicateCreateResponse.status, 409);
    assert.equal((await duplicateCreateResponse.json()).error.code, "PROJECT_ALREADY_EXISTS");

    const roleImportAfterCreate = await fetch(`${url}/api/v1/project/roles/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "installed", roleIds: ["demo-analyst"] })
    });
    assert.equal(roleImportAfterCreate.status, 200);
    const roleImportAfterCreateBody = await roleImportAfterCreate.json();
    assert.deepEqual(roleImportAfterCreateBody.importedRoleIds, []);
    assert.deepEqual(roleImportAfterCreateBody.skippedRoleIds, ["demo-analyst"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server creates into target workdir aliases and persists safe create preferences", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-target-root-"));
  const targetWorkdir = path.resolve(workdir, "nested-project");
  await mkdir(targetWorkdir, { recursive: true });
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
    const createBody = {
      requestId: "create-target-workdir",
      targetWorkdir,
      projectId: "viz.target.created",
      projectName: "Target Created",
      templateId: "minimal",
      authoringDefaults: {
        newRole: {
          bindingKind: "model",
          modelRef: "opencode/gpt-5.4"
        },
        viewport: {
          zoom: 0.9
        }
      },
      modelProfileStrategy: {
        modelDefaults: {
          model: "opencode/gpt-5.4"
        },
        profiles: [
          {
            profileId: "profile.review",
            toolRef: "tool.review"
          }
        ]
      }
    };
    const createResponse = await fetch(`${url}/api/v1/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createBody)
    });
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json();
    assert.equal(created.workdir, targetWorkdir);
    assert.deepEqual(created.createPreferences, {
      authoringDefaults: createBody.authoringDefaults,
      modelProfileStrategy: createBody.modelProfileStrategy
    });
    assert.equal(created.modelDefaults.model, "opencode/gpt-5.4");
    assert.deepEqual(created.profiles, [
      {
        profileId: "profile.review",
        toolRef: "tool.review"
      }
    ]);

    const projectJson = JSON.parse(
      await readFile(path.resolve(targetWorkdir, ".ogs", "project.json"), "utf8")
    );
    assert.deepEqual(projectJson.visualizer.projectCreate, created.createPreferences);

    const authoringJson = JSON.parse(
      await readFile(path.resolve(targetWorkdir, ".ogs", "studio", "system.authoring.json"), "utf8")
    );
    assert.deepEqual(authoringJson.visualizer.projectCreate, created.createPreferences);

    const modelSelectionJson = JSON.parse(
      await readFile(path.resolve(targetWorkdir, ".ogs", "model-selection.json"), "utf8")
    );
    assert.equal(modelSelectionJson.defaults.model, "opencode/gpt-5.4");

    const profilesJson = JSON.parse(
      await readFile(path.resolve(targetWorkdir, "profiles.json"), "utf8")
    );
    assert.ok(profilesJson.some((profile) => profile.profileId === "profile.review"));

    const workspaceResponse = await fetch(`${url}/api/v1/workspace`);
    assert.equal(workspaceResponse.status, 200);
    const workspace = await workspaceResponse.json();
    assert.equal(workspace.workdir, targetWorkdir);
    assert.equal(workspace.hasProject, true);

    const replayResponse = await fetch(`${url}/api/v1/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createBody)
    });
    assert.equal(replayResponse.status, 200);
    const replay = await replayResponse.json();
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.workdir, targetWorkdir);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server treats blank project create workdir as current workdir", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-blank-workdir-"));
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
    const createResponse = await fetch(`${url}/api/v1/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "blank-workdir",
        workdir: "",
        projectId: "viz.blank.workdir",
        projectName: "Blank Workdir",
        templateId: "empty"
      })
    });
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json();
    assert.equal(created.workdir, workdir);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server resolves relative project create workdir against the active workdir", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-relative-workdir-"));
  const targetWorkdir = path.resolve(workdir, "nested", "project");
  await mkdir(targetWorkdir, { recursive: true });
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
    const createResponse = await fetch(`${url}/api/v1/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "relative-workdir",
        workdir: "nested/project",
        projectId: "viz.relative.workdir",
        projectName: "Relative Workdir",
        templateId: "empty"
      })
    });
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json();
    assert.equal(created.workdir, targetWorkdir);
    assert.equal(await readFile(path.resolve(targetWorkdir, ".ogs", "project.json"), "utf8").then(() => true), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server rejects invalid default model references with a stable code", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-invalid-model-"));
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
    const createResponse = await fetch(`${url}/api/v1/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "invalid-model-default",
        projectId: "viz.invalid.model",
        projectName: "Invalid Model",
        templateId: "empty",
        modelProfileStrategy: {
          modelDefaults: {
            model: "missing-provider"
          }
        }
      })
    });
    assert.equal(createResponse.status, 400);
    assert.equal((await createResponse.json()).error.code, "INVALID_PROJECT_MODEL_DEFAULT");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server reports stable project create error codes for invalid inputs", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-create-errors-"));
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
    const cases = [
      {
        body: { requestId: "bad request id", projectId: "viz.create.errors", templateId: "empty" },
        status: 400,
        code: "INVALID_PROJECT_CREATE_REQUEST_ID"
      },
      {
        body: { requestId: "missing-workdir", workdir: path.resolve(workdir, "missing"), projectId: "viz.create.errors", templateId: "empty" },
        status: 400,
        code: "INVALID_PROJECT_WORKDIR"
      },
      {
        body: { requestId: "bad-id", projectId: "bad id", templateId: "empty" },
        status: 400,
        code: "INVALID_PROJECT_ID"
      },
      {
        body: { requestId: "bad-name", projectId: "viz.create.errors", projectName: "!", templateId: "empty" },
        status: 400,
        code: "INVALID_PROJECT_NAME"
      },
      {
        body: { requestId: "bad-template", projectId: "viz.create.errors", templateId: "missing-template" },
        status: 400,
        code: "INVALID_PROJECT_TEMPLATE"
      }
    ];

    for (const testCase of cases) {
      const response = await fetch(`${url}/api/v1/project/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(testCase.body)
      });
      assert.equal(response.status, testCase.status);
      assert.equal((await response.json()).error.code, testCase.code);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server reports non-project directory conflicts during project creation", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-conflict-"));
  await writeFile(path.resolve(workdir, "README.md"), "existing content\n", "utf8");
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
    const createRejected = await fetch(`${url}/api/v1/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "viz.conflict", templateId: "empty" })
    });
    assert.equal(createRejected.status, 409);
    assert.equal((await createRejected.json()).error.code, "PROJECT_DIR_CONFLICT");

    await writeFile(path.resolve(workdir, "system.mmd"), "flowchart TD\n", "utf8");
    const fileConflict = await fetch(`${url}/api/v1/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "viz.conflict",
        templateId: "empty",
        conflictStrategy: "init-current"
      })
    });
    assert.equal(fileConflict.status, 409);
    const fileConflictPayload = await fileConflict.json();
    assert.equal(fileConflictPayload.error.code, "PROJECT_FILE_CONFLICT");
    assert.ok(fileConflictPayload.error.details.conflicts.includes("system.mmd"));

    const pseudoProject = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-pseudo-"));
    await mkdir(path.resolve(pseudoProject, ".ogs"), { recursive: true });
    await writeFile(path.resolve(pseudoProject, "system.mmd"), "flowchart TD\n", "utf8");
    const loadPseudoProject = await fetch(`${url}/api/v1/project/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: pseudoProject })
    });
    assert.equal(loadPseudoProject.status, 400);
    assert.equal((await loadPseudoProject.json()).error.code, "PROJECT_INVALID_WORKDIR");

    const userDirs = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-user-dirs-"));
    await mkdir(path.resolve(userDirs, ".ogs", "notes"), { recursive: true });
    await mkdir(path.resolve(userDirs, "og-roles", "custom"), { recursive: true });
    await writeFile(path.resolve(userDirs, ".ogs", "notes", "keep.txt"), "keep\n", "utf8");
    await writeFile(path.resolve(userDirs, "og-roles", "custom", "keep.txt"), "keep\n", "utf8");
    const loadUserDirs = await fetch(`${url}/api/v1/project/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: userDirs })
    });
    assert.equal(loadUserDirs.status, 400);
    assert.equal((await loadUserDirs.json()).error.code, "PROJECT_INVALID_WORKDIR");
    const userDirCreate = await fetch(`${url}/api/v1/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workdir: userDirs,
        projectId: "viz.user.dirs",
        templateId: "empty",
        conflictStrategy: "init-current"
      })
    });
    assert.equal(userDirCreate.status, 409);
    const userDirCreateBody = await userDirCreate.json();
    assert.equal(userDirCreateBody.error.code, "PROJECT_FILE_CONFLICT");
    assert.ok(userDirCreateBody.error.details.conflicts.includes(".ogs"));
    assert.ok(userDirCreateBody.error.details.conflicts.includes("og-roles"));
    assert.equal(await readFile(path.resolve(userDirs, ".ogs", "notes", "keep.txt"), "utf8"), "keep\n");
    assert.equal(await readFile(path.resolve(userDirs, "og-roles", "custom", "keep.txt"), "utf8"), "keep\n");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server expires project create request replay entries after TTL", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-create-ttl-"));
  const targetWorkdir = path.resolve(workdir, "ttl-project");
  await mkdir(targetWorkdir, { recursive: true });
  let started;
  try {
    started = await startVisualizationServer({
      workdir,
      host: "127.0.0.1",
      port: 0,
      projectCreateRequestCacheTtlMs: 10,
      projectCreateRequestCacheMaxSize: 8
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
    const body = {
      requestId: "ttl-request",
      targetWorkdir,
      projectId: "viz.ttl.project",
      templateId: "empty"
    };
    const createResponse = await fetch(`${url}/api/v1/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    assert.equal(createResponse.status, 200);

    await new Promise((resolve) => setTimeout(resolve, 30));

    const replayResponse = await fetch(`${url}/api/v1/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    assert.equal(replayResponse.status, 409);
    assert.equal((await replayResponse.json()).error.code, "PROJECT_ALREADY_EXISTS");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server bounds project create request replay cache by max size", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-create-cache-"));
  const targets = [
    path.resolve(workdir, "cache-project-a"),
    path.resolve(workdir, "cache-project-b"),
    path.resolve(workdir, "cache-project-c")
  ];
  await Promise.all(targets.map((target) => mkdir(target, { recursive: true })));
  let started;
  try {
    started = await startVisualizationServer({
      workdir,
      host: "127.0.0.1",
      port: 0,
      projectCreateRequestCacheTtlMs: 60_000,
      projectCreateRequestCacheMaxSize: 2
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
    const bodies = [
      {
        requestId: "cache-request-a",
        targetWorkdir: targets[0],
        projectId: "viz.cache.project.a",
        templateId: "empty"
      },
      {
        requestId: "cache-request-b",
        targetWorkdir: targets[1],
        projectId: "viz.cache.project.b",
        templateId: "empty"
      },
      {
        requestId: "cache-request-c",
        targetWorkdir: targets[2],
        projectId: "viz.cache.project.c",
        templateId: "empty"
      }
    ];
    for (const body of bodies) {
      const response = await fetch(`${url}/api/v1/project/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      assert.equal(response.status, 200);
    }

    const evictedReplayResponse = await fetch(`${url}/api/v1/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bodies[0])
    });
    assert.equal(evictedReplayResponse.status, 409);
    assert.equal((await evictedReplayResponse.json()).error.code, "PROJECT_ALREADY_EXISTS");

    const retainedReplayResponse = await fetch(`${url}/api/v1/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bodies[2])
    });
    assert.equal(retainedReplayResponse.status, 200);
    assert.equal((await retainedReplayResponse.json()).idempotentReplay, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server starts and resumes runs through lifecycle APIs", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-run-lifecycle-"));
  await seedRunnableReviewProjectFixture(workdir);
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
    const startResponse = await fetch(`${url}/api/v1/runs/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemPath: "system.mmd",
        input: "operator smoke",
        dryRun: true
      })
    });
    assert.equal(startResponse.status, 200);
    const startedRun = await startResponse.json();
    assert.equal(startedRun.status, "stopped");
    assert.ok(startedRun.runId);
    const snapshotManifest = JSON.parse(
      await readFile(path.resolve(workdir, ".ogs", "runs", startedRun.runId, "snapshot-manifest.json"), "utf8")
    );
    assert.equal(snapshotManifest.manifestVersion, 1);
    assert.equal(snapshotManifest.snapshotId, startedRun.runId);
    assert.equal(snapshotManifest.source.runArtifactSystemPath, "system.mmd");
    assert.match(snapshotManifest.source.sourceHash, /^[a-f0-9]{64}$/);

    const runDetailResponse = await fetch(`${url}/api/v1/runs/${startedRun.runId}`);
    assert.equal(runDetailResponse.status, 200);
    const runDetail = await runDetailResponse.json();
    assert.equal(runDetail.snapshotManifest.status, "ok");
    assert.equal(runDetail.snapshotManifest.snapshotId, startedRun.runId);
    assert.equal(runDetail.snapshotManifest.source.sourceHash, snapshotManifest.source.sourceHash);

    const reviewsResponse = await fetch(`${url}/api/v1/runs/${startedRun.runId}/reviews`);
    assert.equal(reviewsResponse.status, 200);
    const reviews = await reviewsResponse.json();
    assert.ok(reviews.latestPendingReviewId);

    const decisionResponse = await fetch(
      `${url}/api/v1/runs/${startedRun.runId}/reviews/${encodeURIComponent(reviews.latestPendingReviewId)}/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision: "approve",
          actor: "qa",
          comment: "resume now"
        })
      }
    );
    assert.equal(decisionResponse.status, 200);

    const resumeResponse = await fetch(`${url}/api/v1/runs/${startedRun.runId}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dryRun: true
      })
    });
    assert.equal(resumeResponse.status, 200);
    const resumed = await resumeResponse.json();
    assert.equal(resumed.runId, startedRun.runId);
    assert.equal(resumed.status, "done");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("visualizer server rebinds the active project to another workdir", async (t) => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-project-a-"));
  const alternateWorkdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-visualizer-project-b-"));
  await seedProjectFixture(workdir);
  await seedAlternateProjectFixture(alternateWorkdir);
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
    const loadResponse = await fetch(`${url}/api/v1/project/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: alternateWorkdir })
    });
    assert.equal(loadResponse.status, 200);
    const loaded = await loadResponse.json();
    assert.equal(loaded.workdir, alternateWorkdir);

    const projectResponse = await fetch(`${url}/api/v1/project`);
    assert.equal(projectResponse.status, 200);
    const project = await projectResponse.json();
    assert.equal(project.project.systemId, "viz.project.loaded");
    assert.equal(project.project.projectId, "viz.project.loaded");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
