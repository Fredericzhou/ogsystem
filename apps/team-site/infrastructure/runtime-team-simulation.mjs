import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createFilesystemRuntimeServices,
  createGitCollaboration,
  createWorkspaceCoordinator,
  runSystemWithAdapter
} from "../../../dist/runtime/adapter.js";
import { exportTeamPackage, loadTeamPackage } from "../../../dist/visualizer/project-projection.js";
import { isRuntimeBusinessEvent } from "./runtime-business-event-types.mjs";
import { ensureGitLfsWorkspace } from "./workspace-repository.mjs";

function normalizeRuntimeStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "done" || value === "ok") return "completed";
  if (value === "error") return "failed";
  return value;
}

export function createRuntimeTeamSimulation({ run = runSystemWithAdapter, getDefaultHarnessBinding = async () => undefined } = {}) {
  return Object.freeze({
    async simulate(team, { prompt, teamPackageBundle, mode = "dry-run", runtimeEdgeIdsByTransition, onRuntimeEvent, runEvidenceDirectory, simulationId, simulationScenario }) {
      if (simulationScenario && (mode !== "dry-run" || simulationScenario !== "review-reject-once")) {
        throw new Error("DRY_RUN_SCENARIO_INVALID: named simulation scenarios are available only for dry-run execution.");
      }
      const persistentWorkspace = Boolean(runEvidenceDirectory);
      const workdir = persistentWorkspace
        ? resolve(runEvidenceDirectory, "..", "workspace")
        : await mkdtemp(join(tmpdir(), "ogs-team-simulation-"));
      const runId = `simulation-${simulationId || randomUUID()}`;
      let coordinator;
      try {
        await mkdir(workdir, { recursive: true });
        await mkdir(join(workdir, ".ogs"), { recursive: true });
        const bundle = teamPackageBundle || await exportTeamPackage(team.workdir);
        const loaded = await loadTeamPackage({ workdir, bundle });
        if (loaded.validation?.ok === false) {
          const diagnostics = Array.isArray(loaded.validation.diagnostics)
            ? loaded.validation.diagnostics
              .map((item) => String(item?.message || "").trim())
              .filter(Boolean)
              .slice(0, 3)
              .join("; ")
            : "";
          throw new Error(`TEAM_SIMULATION_INVALID: team version failed validation.${diagnostics ? ` ${diagnostics}` : ""}`);
        }
        const workspace = await ensureGitLfsWorkspace({ workspaceDir: workdir });
        const collaboration = createGitCollaboration({
          repositoryRoot: workdir,
          worktreeRoot: resolve(workdir, "..", "worktrees"),
          runId,
          workspaceId: workspace.workspaceId
        });
        coordinator = runEvidenceDirectory
          ? createWorkspaceCoordinator({
              repositoryRoot: workdir,
              evidenceDir: runEvidenceDirectory,
              collaboration,
              workspaceId: workspace.workspaceId
            })
          : undefined;
        const modelConfig = await getDefaultHarnessBinding();
        const result = await run({
          systemPath: resolve(workdir, "system.mmd"),
          prompt,
          workdir,
          runId,
          ...(runEvidenceDirectory ? { runEvidenceDirectory } : {}),
          dryRun: mode === "dry-run",
          executionMode: mode,
          runKind: "studio_simulation",
          gitCollaboration: coordinator
            ? {
                collaboration,
                baseCommit: workspace.baseCommit,
                onRoleCommit: async (branchId, commit) => (await coordinator.recordRoleCommit({
                  runId,
                  nodeId: commit.roleId,
                  branchId,
                  roleCommit: commit
                })).event,
                onMerge: async (merge) => (await coordinator.recordMerge({
                  runId,
                  nodeId: `merge-${merge.mergeId}`,
                  merge
                })).event,
                publish: (merge) => coordinator.publishRelease({
                  releaseId: `release-${runId}`,
                  runId,
                  workspaceDir: workdir,
                  sourceDir: workdir,
                  releaseCommit: merge.mergeCommit,
                  expectedCanonicalHead: workspace.baseCommit,
                  downloadReference: `simulation://${team.teamVersionId}/${runId}/release`
                }).then(() => undefined)
              }
            : undefined,
          trustedProjectTopology: team.source === "classic" || team.source === "classic-template",
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
                  if (event.type === "audit" || isRuntimeBusinessEvent(event)) {
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
          workspaceId: workspace.workspaceId,
          workspaceBackend: "git-lfs",
          workspaceCommit: workspace.baseCommit,
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
            sessionId: item.sessionId,
            messageId: item.messageId,
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
            stdout: item.stdout,
            stdoutPreview: item.stdoutPreview,
            errorEnvelope: item.errorEnvelope
          })) : [],
          summary: result.runSummary || {},
          durationMs: 0
        };
      } finally {
        if (coordinator) await coordinator.writeEvidenceManifest({ runId });
        if (!persistentWorkspace) await rm(workdir, { recursive: true, force: true });
      }
    }
  });
}
