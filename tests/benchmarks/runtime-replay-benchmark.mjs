import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { runSystemWithAdapter } from "../../dist/runtime/adapter.js";
import { validateRuntimeConfig } from "../../dist/runtime/config.js";
import { createExecutionPlan } from "../../dist/runtime/execution-plan.js";
import { createInitialGraphState } from "../../dist/runtime/graph-runtime-state.js";
import { parseSystemFromMermaidSource } from "../../dist/runtime/parse-mermaid.js";
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
%% model.bind.test-loop-probe=balanced-gpt52

input -->|GO| operator[Role:test-loop-probe]
operator[Role:test-loop-probe] -->|RETRY| operator[Role:test-loop-probe]
operator[Role:test-loop-probe] -->|DONE| output
`;

function applyGraphUpdate(state, update) {
  const mergedFailureCountsByErrorCode = {
    ...(state.auditSummary?.failureCountsByErrorCode ?? {})
  };
  for (const [errorCode, count] of Object.entries(update.auditSummary?.failureCountsByErrorCode ?? {})) {
    mergedFailureCountsByErrorCode[errorCode] =
      (mergedFailureCountsByErrorCode[errorCode] ?? 0) + count;
  }

  const mergedRoleMetricsByRoleId = {
    ...(state.roleMetricsByRoleId ?? {})
  };
  for (const [roleId, incoming] of Object.entries(update.roleMetricsByRoleId ?? {})) {
    const current = mergedRoleMetricsByRoleId[roleId] ?? {
      total: 0,
      ok: 0,
      failed: 0,
      noop: 0,
      durationMsTotal: 0
    };
    mergedRoleMetricsByRoleId[roleId] = {
      total: current.total + (incoming.total ?? 0),
      ok: current.ok + (incoming.ok ?? 0),
      failed: current.failed + (incoming.failed ?? 0),
      noop: current.noop + (incoming.noop ?? 0),
      durationMsTotal: current.durationMsTotal + (incoming.durationMsTotal ?? 0)
    };
  }

  return {
    userPrompt: state.userPrompt,
    status:
      update.status === "failed" || state.status === "failed"
        ? "failed"
        : update.status === "done" || state.status === "done"
          ? "done"
          : state.status,
    error: state.error || update.error || "",
    errorEnvelope: state.errorEnvelope ?? update.errorEnvelope,
    transitionCount: state.transitionCount + (update.transitionCount ?? 0),
    recentAudits: state.recentAudits.concat(update.recentAudits ?? []).slice(-5),
    auditSummary: {
      okCount: (state.auditSummary?.okCount ?? 0) + (update.auditSummary?.okCount ?? 0),
      failedCount: (state.auditSummary?.failedCount ?? 0) + (update.auditSummary?.failedCount ?? 0),
      noopCount: (state.auditSummary?.noopCount ?? 0) + (update.auditSummary?.noopCount ?? 0),
      repairAttemptedCount:
        (state.auditSummary?.repairAttemptedCount ?? 0) +
        (update.auditSummary?.repairAttemptedCount ?? 0),
      repairAppliedCount:
        (state.auditSummary?.repairAppliedCount ?? 0) +
        (update.auditSummary?.repairAppliedCount ?? 0),
      failureCountsByErrorCode: mergedFailureCountsByErrorCode
    },
    roleMetricsByRoleId: mergedRoleMetricsByRoleId,
    roleResults: { ...state.roleResults, ...(update.roleResults ?? {}) },
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
  await symlink(path.resolve(repoRoot, "og-models"), path.resolve(tempRoot, "og-models"), "dir");
  await writeFile(systemPath, systemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        modelRepo: "./og-models",
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
      modelRepo: "./og-models",
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
    JSON.stringify({ graphState: reconstructedGraphState }, null, 2),
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
