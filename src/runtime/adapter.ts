/**
 * Bridges CLI inputs, resume checkpoints, and fingerprinting into the runtime orchestrator.
 * Responsibilities stop at setup composition, artifact bookkeeping, and executor coordination;
 * graph execution is delegated to graph-runner and the execution backends.
 */
import { createDefaultExecutor } from "./executor.js";
import { runSystemWithGraphRunner } from "./graph-runner.js";
import { createRuntimeError, normalizeRuntimeError } from "./runtime-errors.js";
import { loadResumeGraphState, validateResumePlanFingerprint } from "./run-artifacts.js";
import { prepareRuntimeSetup, type RuntimeAdapterSetup } from "./runtime-setup.js";
import type { AdapterRunResult, GraphState } from "./types.js";

export { buildRunPlanFingerprint } from "./plan-fingerprint.js";
export { resolveEffectiveLaw } from "./runtime-setup.js";

const TEST_HOLD_RESUME_LOCK_MS_ENV = "OGSYSTEM_TEST_HOLD_RESUME_LOCK_MS";
const TEST_FORCE_RUNTIME_ERROR_AFTER_SETUP_ENV = "OGSYSTEM_TEST_FORCE_RUNTIME_ERROR_AFTER_SETUP";

async function maybeHoldResumeLockForTest(): Promise<void> {
  const raw = process.env[TEST_HOLD_RESUME_LOCK_MS_ENV];
  if (!raw) {
    return;
  }
  const durationMs = Number.parseInt(raw, 10);
  if (!Number.isInteger(durationMs) || durationMs <= 0) {
    return;
  }
  process.stderr.write(`[test-failpoint] holding resume lock for ${durationMs}ms\n`);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

export async function runSystemWithAdapter(args: {
  systemPath: string;
  profilesPath?: string;
  toolsPath?: string;
  lawsPath?: string;
  runtimeConfigPath?: string;
  userProfilePath?: string;
  resumeRunDir?: string;
  prompt: string;
  workdir: string;
  dryRun?: boolean;
  cleanupExecutionHistory?: number;
  logRun?: boolean;
}): Promise<AdapterRunResult> {
  let runContextForCleanup: RuntimeAdapterSetup["runContext"] | undefined;
  let executionError: unknown;
  let result: AdapterRunResult | undefined;
  let setup: RuntimeAdapterSetup | undefined;

  try {
    try {
      setup = await prepareRuntimeSetup(args);
      runContextForCleanup = setup.runContext;
    } catch (error) {
      executionError = createRuntimeError(
        normalizeRuntimeError(error, {
          errorCode: "RUNTIME_SETUP_FAILED",
          errorCategory: "config",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
          stage: "config",
          runId: runContextForCleanup?.runId
        })
      );
    }

    if (!setup && !executionError) {
      executionError = createRuntimeError({
        errorCode: "RUNTIME_SETUP_FAILED",
        errorCategory: "config",
        message: "Runtime setup did not complete",
        retryable: false,
        stage: "config",
        runId: runContextForCleanup?.runId
      });
    }

    if (setup) {
      if (process.env[TEST_FORCE_RUNTIME_ERROR_AFTER_SETUP_ENV] === "1") {
        throw createRuntimeError({
          errorCode: "RUNTIME_TEST_FORCED_AFTER_SETUP",
          errorCategory: "system",
          message: "Forced runtime error after setup for CLI regression coverage",
          retryable: false,
          stage: "execute",
          runId: setup.runContext.runId
        });
      }

      const executor = createDefaultExecutor({
        dryRun: args.dryRun,
        runContext: setup.runContext,
        needsModelExecutor:
          Array.from(setup.plan.nodesByRoleId.values()).some((node) => node.binding.kind === "model")
      });

      try {
        if (args.resumeRunDir) {
          await maybeHoldResumeLockForTest();
        }
        await executor.start();

        let initialState: GraphState | undefined;
        if (args.resumeRunDir) {
          try {
            await validateResumePlanFingerprint({
              runDir: setup.runContext.runDir,
              expectedFingerprint: setup.planFingerprint
            });
            initialState = await loadResumeGraphState({ runDir: setup.runContext.runDir });
          } catch (error) {
            throw createRuntimeError(
              normalizeRuntimeError(error, {
                errorCode: "RUNTIME_RESUME_STATE_FAILED",
                errorCategory: "state",
                message: error instanceof Error ? error.message : String(error),
                retryable: false,
                stage: "resume",
                runId: setup.runContext.runId
              })
            );
          }
        }

        result = await runSystemWithGraphRunner({
          plan: setup.plan,
          effectiveLaw: setup.effectiveLaw,
          contractPlan: setup.contractPlan,
          compilerSnapshot: setup.compilerSnapshot,
          profilesById: setup.profilesById,
          toolsByRef: setup.toolsByRef,
          userProfile: setup.userProfile,
          workdir: args.workdir,
          rolePackagesByRoleId: setup.rolePackagesByRoleId,
          runContext: setup.runContext,
          executor,
          prompt: args.prompt,
          initialState,
          cleanupExecutionHistory: args.cleanupExecutionHistory,
          autoCleanupRetention:
            args.cleanupExecutionHistory === undefined &&
            setup.runtimeConfig.retention?.enabled
              ? {
                  executionDirThreshold: setup.runtimeConfig.retention.executionDirThreshold,
                  keepLatest: setup.runtimeConfig.retention.keepLatest
                }
              : undefined,
          errorFlowRoutingEnabled: setup.runtimeConfig.runtime.error_flows.v1,
          logRun: args.logRun ?? false
        });
      } catch (error) {
        executionError = createRuntimeError(
          normalizeRuntimeError(error, {
            errorCode: "RUNTIME_EXECUTION_FAILED",
            errorCategory: "system",
            message: error instanceof Error ? error.message : String(error),
            retryable: false,
            stage: "execute",
            runId: setup.runContext.runId
          })
        );
      }

      try {
        await executor.close();
      } catch (error) {
        if (!executionError) {
          executionError = createRuntimeError(
            normalizeRuntimeError(error, {
              errorCode: "RUNTIME_EXECUTOR_CLOSE_FAILED",
              errorCategory: "system",
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
              stage: "execute",
              runId: setup.runContext.runId
            })
          );
        }
      }
    }
  } finally {
    if (runContextForCleanup?.releaseResumeLock) {
      try {
        await runContextForCleanup.releaseResumeLock();
      } catch (error) {
        if (!executionError) {
          executionError = createRuntimeError(
            normalizeRuntimeError(error, {
              errorCode: "RUNTIME_RESUME_LOCK_RELEASE_FAILED",
              errorCategory: "system",
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
              stage: "resume",
              runId: runContextForCleanup.runId
            })
          );
        }
      }
    }
  }

  if (executionError) {
    throw executionError;
  }

  if (!result) {
    throw createRuntimeError({
      errorCode: "RUNTIME_EXECUTION_FAILED",
      errorCategory: "system",
      message: "Runtime execution completed without a result",
      retryable: false,
      stage: "execute",
      runId: setup?.runContext.runId ?? runContextForCleanup?.runId
    });
  }

  return result;
}
