import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFilesystemRuntimeServices, runSystemWithAdapter } from "../../../dist/runtime/adapter.js";
import { exportTeamPackage, loadTeamPackage } from "../../../dist/visualizer/project-projection.js";

const TEAM_RUN_EVENT_TYPES = new Set([
  "role.started", "role.input_ready", "role_waiting", "role_retry_scheduled", "flow.activated",
  "join_activated", "join_quorum_reached", "join_late_arrival_ignored",
  "loop_exhausted",
  "human_review_requested", "human_review_approved", "human_review_rework_requested",
  "human_review_rejected", "human_review_decision_rejected",
  "human_review_paused", "human_review_terminated", "human_review_expired",
  "run_waiting", "run_stopping", "run_stopped", "run_terminated"
]);

function normalizeRuntimeStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "done" || value === "ok") return "completed";
  if (value === "error") return "failed";
  return value;
}

export function createRuntimeTeamSimulation({ run = runSystemWithAdapter, getDefaultModelSelection = async () => undefined } = {}) {
  return Object.freeze({
    async simulate(team, { prompt, teamPackageBundle, mode = "dry-run", runtimeEdgeIdsByTransition, onRuntimeEvent, runEvidenceDirectory, simulationScenario }) {
      if (simulationScenario && (mode !== "dry-run" || simulationScenario !== "review-reject-once")) {
        throw new Error("DRY_RUN_SCENARIO_INVALID: named simulation scenarios are available only for dry-run execution.");
      }
      const workdir = await mkdtemp(join(tmpdir(), "ogs-team-simulation-"));
      const runId = `simulation-${randomUUID()}`;
      try {
        await mkdir(join(workdir, ".ogs"), { recursive: true });
        const bundle = teamPackageBundle || await exportTeamPackage(team.workdir);
        const loaded = await loadTeamPackage({ workdir, bundle });
        if (loaded.validation?.ok === false) throw new Error("TEAM_SIMULATION_INVALID: team version failed validation.");
        const modelConfig = await getDefaultModelSelection();
        const result = await run({
          systemPath: resolve(workdir, "system.mmd"),
          prompt,
          workdir,
          runId,
          ...(runEvidenceDirectory ? { runEvidenceDirectory } : {}),
          dryRun: mode === "dry-run",
          executionMode: mode,
          runKind: "studio_simulation",
          trustedProjectTopology: team.source === "classic" || team.source === "classic-template",
          modelSelectionDefaults: modelConfig?.modelSelectionDefaults,
          modelCatalogModels: modelConfig?.modelCatalogModels,
          modelCatalogGeneratedAt: modelConfig?.modelCatalogGeneratedAt,
          runtimeEdgeIdsByTransition,
          dryRunScenario: simulationScenario,
          logRun: false,
          runtimeServicesFactory: (runtimeArgs) => {
            const services = createFilesystemRuntimeServices({
              context: runtimeArgs.runContext,
              initialState: runtimeArgs.initialState,
              irDigest: runtimeArgs.plan.irDigest,
              runtimeDigest: runtimeArgs.plan.planFingerprint
            });
            if (typeof onRuntimeEvent !== "function") return services;
            return {
              ...services,
              audit: {
                ...services.audit,
                append: async (event) => {
                  await services.audit.append(event);
                  if (event.type === "audit" || TEAM_RUN_EVENT_TYPES.has(event.type)) {
                    await onRuntimeEvent(event);
                  }
                }
              }
            };
          }
        });
        return {
          teamVersionId: team.teamVersionId,
          mode,
          persisted: false,
          status: normalizeRuntimeStatus(result.status),
          finalOutputsByRoleId: result.finalOutputsByRoleId || {},
          finalOutputRoleOrder: result.finalOutputRoleOrder || [],
          stages: Array.isArray(result.stages) ? result.stages : [],
          auditTrail: Array.isArray(result.auditTrail) ? result.auditTrail.map((item) => ({
            at: item.at,
            roleId: item.roleId,
            branchId: item.branchId,
            lineageId: item.lineageId,
            loopIteration: item.loopIteration,
            executionId: item.executionId,
            attempt: item.attempt,
            maxAttempts: item.maxAttempts,
            selectedEvent: item.selectedEvent,
            status: normalizeRuntimeStatus(item.status),
            durationMs: item.durationMs,
            backend: item.backend,
            modelId: item.modelId,
            profileId: item.profileId,
            toolRef: item.toolRef,
            promptCalls: item.promptCalls,
            projectedInputChars: item.projectedInputChars,
            renderedPromptChars: item.renderedPromptChars,
            estimatedInputTokens: item.estimatedInputTokens,
            estimatedOutputTokens: item.estimatedOutputTokens,
            externalDataIsolated: item.externalDataIsolated,
            fallbackUsed: item.fallbackUsed,
            primaryModelId: item.primaryModelId,
            failure: item.error,
            inputContext: item.inputContext,
            stdoutPreview: item.stdoutPreview,
            errorEnvelope: item.errorEnvelope
          })) : [],
          summary: result.runSummary || {},
          durationMs: 0
        };
      } finally {
        await rm(workdir, { recursive: true, force: true });
      }
    }
  });
}
