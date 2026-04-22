import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { runSystemWithAdapter } from "../../dist/runtime/adapter.js";
import { validateRuntimeConfig } from "../../dist/runtime/config.js";
import { createExecutionPlan } from "../../dist/runtime/execution-plan.js";
import {
  createInitialGraphState,
  projectStateSnapshot
} from "../../dist/runtime/graph-runtime-state.js";
import { parseSystemFromMermaidSource } from "../../dist/runtime/parse-mermaid.js";
import { createEmptyAuditSummary, mergeAuditSummaries } from "../../dist/runtime/run-summary.js";
import {
  initializeRunContext,
  loadPendingRuntimeCheckpoints,
  loadResumeGraphState
} from "../../dist/runtime/run-artifacts.js";

const LOOP_BUDGET = 500;
const RESTORED_CHECKPOINT_SEQUENCE = 490;

const systemSource = `flowchart TD
%% system.id=benchmark.runtime.replay
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=test-loop-probe
%% loop.max.test-loop-probe=${LOOP_BUDGET}
%% model.bind.test-loop-probe=opencode/gpt-5-nano

input -->|GO| operator[Role:test-loop-probe]
operator[Role:test-loop-probe] -->|RETRY| operator[Role:test-loop-probe]
operator[Role:test-loop-probe] -->|DONE| output
`;

function mergeStatus(current, update) {
  if (current === "failed" || update === "failed") {
    return "failed";
  }
  if (current === "stopped" || update === "stopped") {
    return "stopped";
  }
  if (current === "done" || update === "done") {
    return "done";
  }
  if (current === "stopping" || update === "stopping") {
    return "stopping";
  }
  return "running";
}

function mergeRoleMetrics(left, right) {
  const merged = { ...left };
  for (const [roleId, rightMetrics] of Object.entries(right)) {
    const leftMetrics = merged[roleId] ?? {
      total: 0,
      ok: 0,
      failed: 0,
      noop: 0,
      durationMsTotal: 0
    };
    merged[roleId] = {
      total: leftMetrics.total + rightMetrics.total,
      ok: leftMetrics.ok + rightMetrics.ok,
      failed: leftMetrics.failed + rightMetrics.failed,
      noop: leftMetrics.noop + rightMetrics.noop,
      durationMsTotal: leftMetrics.durationMsTotal + rightMetrics.durationMsTotal
    };
  }
  return merged;
}

function applyGraphUpdate(state, update) {
  return {
    userPrompt: state.userPrompt,
    status: update.status ? mergeStatus(state.status, update.status) : state.status,
    error: state.error || update.error || "",
    errorEnvelope: state.errorEnvelope ?? update.errorEnvelope,
    transitionCount: state.transitionCount + (update.transitionCount ?? 0),
    recentAudits: state.recentAudits.concat(update.recentAudits ?? []).slice(-5),
    auditSummary: mergeAuditSummaries(
      state.auditSummary,
      update.auditSummary ?? createEmptyAuditSummary()
    ),
    roleMetricsByRoleId: mergeRoleMetrics(state.roleMetricsByRoleId, update.roleMetricsByRoleId ?? {}),
    roleResults: { ...state.roleResults, ...(update.roleResults ?? {}) },
    pendingReviewsById: { ...state.pendingReviewsById, ...(update.pendingReviewsById ?? {}) },
    reviewHistoryByBranchId: {
      ...state.reviewHistoryByBranchId,
      ...(update.reviewHistoryByBranchId ?? {})
    },
    humanReviewContextByBranchId: {
      ...state.humanReviewContextByBranchId,
      ...(update.humanReviewContextByBranchId ?? {})
    },
    reviewRoundByRoleLineageKey: {
      ...state.reviewRoundByRoleLineageKey,
      ...(update.reviewRoundByRoleLineageKey ?? {})
    },
    lastWaitingReviewId: update.lastWaitingReviewId ?? state.lastWaitingReviewId,
    branchRecords: { ...state.branchRecords, ...(update.branchRecords ?? {}) },
    loopIterations: { ...state.loopIterations, ...(update.loopIterations ?? {}) },
    selectedEventByBranchId: {
      ...state.selectedEventByBranchId,
      ...(update.selectedEventByBranchId ?? {})
    },
    finalOutput: update.finalOutput || state.finalOutput,
    finalRoleId: update.finalRoleId || state.finalRoleId,
    lastExecutedRoleId: update.lastExecutedRoleId ?? state.lastExecutedRoleId,
    nextBranchSequence: update.nextBranchSequence ?? state.nextBranchSequence,
    lastCheckpointSequence: Math.max(
      state.lastCheckpointSequence,
      update.lastCheckpointSequence ?? state.lastCheckpointSequence
    )
  };
}

async function main() {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-runtime-replay-bench-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  const lawsPath = path.resolve(tempRoot, "laws.json");
  const runtimePath = path.resolve(tempRoot, ".ogs", "runtime.json");
  const roleDir = path.resolve(tempRoot, "og-roles", "roles", "test-loop-probe");

  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await mkdir(roleDir, { recursive: true });
  await writeFile(systemPath, systemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "role.json"),
    JSON.stringify(
      {
        roleId: "test-loop-probe",
        roleVersion: "1.0.0",
        name: "Loop Probe",
        description: "Runtime replay benchmark role",
        promptTemplate: "prompt.md",
        outputSchema: "output.schema.json"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "prompt.md"),
    ["Return a JSON object.", "Allowed events: {{allowed_events}}."].join("\n"),
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "agent.md"),
    "# Loop Probe\n\nBenchmark role fixture for runtime replay measurements.\n",
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "output.schema.json"),
    JSON.stringify(
      {
        type: "object",
        properties: {
          event: {
            type: "string",
            enum: ["RETRY", "DONE"]
          },
          content: {
            type: "string"
          }
        },
        required: ["event"],
        additionalProperties: true
      },
      null,
      2
    ),
    "utf8"
  );

  const laws = JSON.parse(await readFile(path.resolve(repoRoot, ".ogs", "laws.json"), "utf8"));
  const globalLaw = laws.laws.find((item) => item.lawId === "law.console.base");
  if (!globalLaw) {
    throw new Error("Global law law.console.base not found");
  }
  globalLaw.constraints = {
    ...(globalLaw.constraints ?? {}),
    maxTransitions: LOOP_BUDGET
  };
  await writeFile(lawsPath, JSON.stringify(laws, null, 2), "utf8");

  const initialRun = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath,
    prompt: "benchmark replay",
    workdir: tempRoot,
    dryRun: true
  });

  if (initialRun.status !== "done") {
    throw new Error(`Initial benchmark run failed: ${initialRun.status}`);
  }

  const runId = (await readdir(path.resolve(tempRoot, ".ogs/runs")))[0];
  const runDir = path.resolve(tempRoot, ".ogs/runs", runId);
  const system = parseSystemFromMermaidSource(systemSource);
  const plan = createExecutionPlan(system);
  let reconstructedGraphState = createInitialGraphState({
    plan,
    prompt: "benchmark replay"
  });

  const runtimeConfig = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      runsDir: ".ogs/runs"
    },
    runtimePath
  );
  const reconstructionContext = await initializeRunContext({
    system,
    systemPath,
    prompt: "benchmark replay",
    workdir: tempRoot,
    runtimeConfig,
    resumeRunDir: `.ogs/runs/${runId}`
  });
  const allCheckpoints = await loadPendingRuntimeCheckpoints({
    context: reconstructionContext,
    afterSequence: 0
  });
  await reconstructionContext.releaseResumeLock?.();

  for (const checkpoint of allCheckpoints) {
    if (checkpoint.checkpointSequence > RESTORED_CHECKPOINT_SEQUENCE) {
      break;
    }
    reconstructedGraphState = applyGraphUpdate(reconstructedGraphState, checkpoint.update);
  }
  await writeFile(
    path.resolve(runDir, "state.json"),
    JSON.stringify(
      projectStateSnapshot({
        state: reconstructedGraphState,
        plan
      }),
      null,
      2
    ),
    "utf8"
  );

  const stateLoadStart = performance.now();
  const loadedState = await loadResumeGraphState({ runDir });
  const stateLoadMs = performance.now() - stateLoadStart;

  const runContext = await initializeRunContext({
    system,
    systemPath,
    prompt: "benchmark replay",
    workdir: tempRoot,
    runtimeConfig,
    resumeRunDir: `.ogs/runs/${runId}`
  });

  const checkpointLoadStart = performance.now();
  const checkpoints = await loadPendingRuntimeCheckpoints({
    context: runContext,
    afterSequence: loadedState.lastCheckpointSequence
  });
  const checkpointLoadMs = performance.now() - checkpointLoadStart;
  await runContext.releaseResumeLock?.();

  const resumeStart = performance.now();
  const resumed = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath,
    prompt: "benchmark replay",
    workdir: tempRoot,
    resumeRunDir: `.ogs/runs/${runId}`,
    dryRun: true
  });
  const resumeTotalMs = performance.now() - resumeStart;
  const metrics = JSON.parse(await readFile(path.resolve(runDir, "metrics.json"), "utf8"));

  const summary = {
    date: new Date().toISOString(),
    platform: process.platform,
    node: process.version,
    loopBudget: LOOP_BUDGET,
    restoredCheckpointSequence: RESTORED_CHECKPOINT_SEQUENCE,
    totalCheckpointFiles: allCheckpoints.length,
    pendingCheckpointFiles: checkpoints.length,
    transitionCount: metrics.transitionCount,
    stateLoadMs: Number(stateLoadMs.toFixed(3)),
    stateWriteMs: metrics.stateWriteMs,
    checkpointLoadMs: Number(checkpointLoadMs.toFixed(3)),
    resumeTotalMs: Number(resumeTotalMs.toFixed(3)),
    finalStatus: resumed.status,
    finalRoleId: resumed.finalRoleId,
    tempRoot
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
