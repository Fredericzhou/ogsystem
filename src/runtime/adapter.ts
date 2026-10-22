/**
 * Bridges CLI inputs, resume checkpoints, and fingerprinting into the runtime orchestrator.
 * Responsibilities stop at setup composition, artifact bookkeeping, and executor coordination;
 * graph execution is delegated to graph-runner and the execution backends.
 */
import { createDefaultExecutor } from "./executor.js";
import { runSystemWithGraphRunner } from "./graph-runner.js";
import { LangGraphEngineAdapter } from "./langgraph-engine-adapter.js";
import type { LangGraphEngineAdapterOptions } from "./langgraph-engine-adapter.js";
import type { ExecutionEngineAdapter, RuntimeExecutionServices } from "./engine-adapter.js";
import { createInitialGraphState, projectStateSnapshot } from "./graph-runtime-state.js";
import { RunControl } from "@langchain/langgraph";
import { createRuntimeError, normalizeRuntimeError, RuntimeError } from "./runtime-errors.js";
import { filesystemRunStore } from "./run-store.js";
import { reconcileHumanReviewTimeouts } from "./project-lifecycle.js";
import { prepareRuntimeSetup, type RuntimeAdapterSetup } from "./runtime-setup.js";
import type { AdapterRunResult, GraphState } from "./types.js";
import { assertResumeAllowed, markResumeFailure, writeAtomicFile } from "./run-artifacts.js";
import { stringifyJson } from "./runtime-support.js";
import { initializeProjectRunArtifacts } from "./project-run.js";
import type { ProjectMaterialInput, ProjectRunMode } from "./project-run.js";
import { applyRunControl, projectRunStateFromResult, updateProjectRunState } from "./project-run-state.js";
import { acquireActiveRunLock } from "./project-run-lock.js";
import { createRunId } from "./run-artifacts.js";
import { readLatestProjectRunControl } from "./project-run-control.js";

export { buildRunPlanFingerprint } from "./plan-fingerprint.js";
export { resolveEffectiveLaw } from "./runtime-setup.js";
export { validateSemanticRoleContracts } from "./runtime-setup.js";
export {
  buildJoinDisplayId,
  buildJoinScopeKey,
  semanticIRDigest,
  validateSemanticIR
} from "./semantic-ir.js";
export { evaluateCondition, resolveConditionValue, selectSemanticRoute, SemanticRouteSelectionError, validateConditionAst } from "./condition-ast.js";
export { applyStateReducer } from "./state-reducer.js";
export { loadOgsSpecification } from "./ogs-spec-loader.js";
export { compileSemanticIR } from "./semantic-ir-compiler.js";
export { buildLoopScopeKey, getTargetLoopIteration, wouldExceedLoopBudget } from "./graph-runtime-state.js";
export { validateEventCandidate } from "./event-contract.js";
export { resolveJoinPolicy } from "./join-policy.js";
export { buildRolePromptInput } from "./role-input-projector.js";
export { projectOgsSpan, toOgsCloudEvent } from "./observability.js";
export { validateCapabilityPolicy } from "./capability-policy.js";
export { compileSubgraphSpec, validateSubgraphSpec } from "./subgraph.js";
export { createFilesystemRuntimeServices } from "./filesystem-runtime-services.js";
export type { EngineRunInput, ExecutionEngineAdapter, RuntimeAuditEvent, RuntimeExecutionServices } from "./engine-adapter.js";
export type { ControlPlaneAction, ControlPlaneIdentityProvider, ControlPlanePrincipal } from "./identity.js";
export { createLocalControlPlanePrincipal } from "./identity.js";
export type { RemoteExecutionRequest, RemoteExecutionResponse } from "./remote-execution-contract.js";
export { validateRemoteExecutionRequest, validateRemoteExecutionResponse } from "./remote-execution-contract.js";
export { LangGraphEngineAdapter } from "./langgraph-engine-adapter.js";
export type { LangGraphEngineAdapterOptions } from "./langgraph-engine-adapter.js";
export {
  FileVersionedStateStore,
  StateVersionConflictError,
  VersionedStateStore
} from "./versioned-state.js";

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
  systemBaseDir?: string;
  profilesPath?: string;
  toolsPath?: string;
  lawsPath?: string;
  runtimeConfigPath?: string;
  userProfilePath?: string;
  resumeRunDir?: string;
  enforceTerminalResumeGate?: boolean;
  runId?: string;
  projectId?: string;
  /** Immutable TeamVersion asset directory used to resolve the graph and role configuration. */
  assetSource?: string;
  /** Optional owner-controlled directory containing this run's evidence. */
  runEvidenceRoot?: string;
  onRunInitialized?: (run: { runId: string; runDir: string }) => void | Promise<void>;
  onProjectRunPrepared?: (run: { runId: string; runDir: string }) => void | Promise<void>;
  prompt: string;
  workdir: string;
  targetDir?: string;
  dryRun?: boolean;
  executionMode?: ProjectRunMode;
  runKind?: "project_task" | "studio_simulation";
  owner?: {
    kind: "project_task";
    projectId: string;
    taskId: string;
    taskNumber: number;
    attemptNumber: number;
    runId: string;
    teamVersionId: string;
    teamCoreDigest?: string;
  };
  /** Trusted platform-provided team graphs may use supported parallel/join semantics. */
  trustedProjectTopology?: boolean;
  projectDigest?: string;
  projectRunLock?: boolean;
  materialInputs?: ProjectMaterialInput[];
  materialSourceRoot?: string;
  materialSnapshotPolicy?: {
    kind: "project_current" | "source_run_snapshot" | "current_project_fallback";
    sourceRunId?: string;
    reason?: "source_run_state_missing";
  };
  cleanupExecutionHistory?: number;
  logRun?: boolean;
  engineFactory?: () => ExecutionEngineAdapter;
  runtimeServicesFactory?: (args: {
    runContext: RuntimeAdapterSetup["runContext"];
    plan: RuntimeAdapterSetup["plan"];
    initialState: GraphState;
  }) => RuntimeExecutionServices | Promise<RuntimeExecutionServices>;
}): Promise<AdapterRunResult> {
  const projectTaskRun = args.runKind === "project_task";
  if (projectTaskRun && !args.executionMode) throw new Error("PROJECT_RUN_MODE_REQUIRED: Project Task Runtime requires an explicit execution mode.");
  if (args.runKind === "studio_simulation" && args.executionMode && !["dry-run", "sandbox"].includes(args.executionMode)) {
    throw new Error("STUDIO_SIMULATION_MODE_INVALID: Studio Simulation supports dry-run or isolated sandbox execution.");
  }
  if (projectTaskRun && (!args.owner || args.owner.kind !== "project_task"
    || !args.projectId || args.owner.projectId !== args.projectId
    || !args.owner.taskId || !args.owner.teamVersionId
    || !args.runId || args.owner.runId !== args.runId)) {
    throw new Error("PROJECT_RUN_OWNER_INVALID: Project Task Runtime requires a matching explicit owner.");
  }
  const taskReservation = projectTaskRun ? {
    kind: "task-attempt" as const,
    projectId: args.owner!.projectId,
    taskId: args.owner!.taskId,
    teamVersionId: args.owner!.teamVersionId,
    runId: args.owner!.runId
  } : undefined;
  const trace = (phase: string) => {
    if (process.env.OGS_RUNTIME_TRACE === "1") process.stderr.write(`[runtime-trace] ${phase} run=${args.runId ?? "pending"}\n`);
  };
  let runContextForCleanup: RuntimeAdapterSetup["runContext"] | undefined;
  let executionError: unknown;
  let result: AdapterRunResult | undefined;
  let setup: RuntimeAdapterSetup | undefined;
  let releaseProjectRunLock: (() => Promise<void>) | undefined;

  try {
    try {
      // Reserve the project before setup creates any run artifacts. The run id is
      // deterministic for resumes and supplied by callers for new runs; when a
      // project-mode caller omits it, allocate it before acquiring the lock so a
      // competing worker cannot leave a partial run directory behind.
      const preparedRunId = args.resumeRunDir
        ? args.resumeRunDir.split(/[\\/]/).pop()
        : args.runId ?? (projectTaskRun ? createRunId(new Date()) : undefined);
      if (projectTaskRun && args.projectRunLock !== false) {
        if (!preparedRunId) throw new Error("PROJECT_RUN_ID_REQUIRED: project runs must have a stable run id.");
        const activeLock = await acquireActiveRunLock(args.runEvidenceRoot ?? args.workdir, preparedRunId);
        releaseProjectRunLock = activeLock.release;
      }
      trace("setup:start");
      setup = await prepareRuntimeSetup({
        ...args,
        runKind: args.runKind,
        ...(preparedRunId ? { runId: preparedRunId } : {})
      });
      trace("setup:complete");
      runContextForCleanup = setup.runContext;
      if (args.resumeRunDir && (args.enforceTerminalResumeGate === true || projectTaskRun)) {
        const resumeState = await filesystemRunStore.loadResumeState({ runDir: setup.runContext.runDir });
        assertResumeAllowed({ runDir: setup.runContext.runDir, state: resumeState });
      }
      await initializeProjectRunArtifacts({
        workdir: args.workdir,
        materialSourceRoot: args.materialSourceRoot,
        runDir: setup.runContext.runDir,
        prompt: args.prompt,
        plan: setup.plan,
        fingerprint: setup.planFingerprint,
        mode: args.executionMode ?? (args.dryRun ? "dry-run" : "real"),
        projectId: args.projectId,
        projectDigest: args.projectDigest,
        materials: args.materialInputs,
        materialSnapshotPolicy: args.materialSnapshotPolicy,
        enforceLinearTopology: projectTaskRun && !args.trustedProjectTopology,
        enforceSnapshotContract: projectTaskRun,
        taskReservation
      });
      if (!args.resumeRunDir) {
        const initialState = createInitialGraphState({ plan: setup.plan, prompt: args.prompt });
        const snapshot = projectStateSnapshot({ state: initialState, plan: setup.plan });
        await writeAtomicFile(
          setup.runContext.statePath,
          stringifyJson(taskReservation ? {
            ...snapshot,
            taskReservation: { ...taskReservation, runId: setup.runContext.runId }
          } : snapshot)
        );
      }
      trace("artifacts:complete");
      if (args.onProjectRunPrepared) {
        trace("prepared-callback:start");
        await args.onProjectRunPrepared({ runId: setup.runContext.runId, runDir: setup.runContext.runDir });
        trace("prepared-callback:complete");
      }
      if (projectTaskRun) {
        await updateProjectRunState(setup.runContext.runDir, (currentState) =>
          !currentState.control.cancelRequested && !currentState.control.paused
            ? applyRunControl(currentState, "resume")
            : currentState
        );
      }
      if (args.resumeRunDir) await reconcileHumanReviewTimeouts(setup.runContext.runDir);
    } catch (error) {
      trace(`preparation:failed error=${error instanceof Error ? error.message : String(error)}`);
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

    if (setup && !executionError) {
      if (args.onRunInitialized) {
        try {
          await args.onRunInitialized({
            runId: setup.runContext.runId,
            runDir: setup.runContext.runDir
          });
        } catch (error) {
          process.stderr.write(`[warn] run initialization callback failed: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
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
        sandbox: args.executionMode === "sandbox",
        runContext: setup.runContext,
        targetDir: setup.targetDir,
        needsModelExecutor:
          Array.from(setup.plan.nodesByRoleId.values()).some((node) => node.binding.kind === "model"),
        modelBackends: [...new Set(Array.from(setup.plan.nodesByRoleId.values())
          .flatMap((node) => node.binding.kind === "model" ? [node.binding.backend] : []))],
        toolEnvironmentPolicy: setup.runtimeConfig.tools.environmentPolicy,
        toolEnvAllowlist: setup.runtimeConfig.tools.envAllowlist
      });

      try {
        trace("executor:start");
        if (args.resumeRunDir) {
          await maybeHoldResumeLockForTest();
        }
        await executor.start();

        let initialState: GraphState | undefined;
        if (args.resumeRunDir) {
          try {
            await filesystemRunStore.validatePlanFingerprint({
              runDir: setup.runContext.runDir,
              expectedFingerprint: setup.planFingerprint
            });
            initialState = await filesystemRunStore.loadResumeState({ runDir: setup.runContext.runDir });
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

        const runControl = new RunControl();
        let projectControlPoll: ReturnType<typeof setInterval> | undefined;
        const pollProjectControl = async (): Promise<void> => {
          if (!projectTaskRun) return;
          const control = await readLatestProjectRunControl(setup!.runContext.runDir);
          if (control?.action === "cancel" || control?.action === "pause") {
            runControl.requestDrain(`project-${control.action}-requested`);
          }
        };
        if (projectTaskRun) {
          await pollProjectControl();
          projectControlPoll = setInterval(() => { void pollProjectControl(); }, 100);
          projectControlPoll.unref?.();
        }
        const requestDrain = (signal: string) => runControl.requestDrain(signal);
        process.on("SIGTERM", requestDrain);
        process.on("SIGINT", requestDrain);
        try {
          const engineOptions: LangGraphEngineAdapterOptions = {
            effectiveLaw: setup.effectiveLaw,
            contractPlan: setup.contractPlan,
            compilerSnapshot: setup.compilerSnapshot,
            profilesById: setup.profilesById,
            toolsByRef: setup.toolsByRef,
            userProfile: setup.userProfile,
            workdir: setup.targetDir,
            commandBaseDir: args.workdir,
            rolePackagesByRoleId: setup.rolePackagesByRoleId,
            runContext: setup.runContext,
            executor,
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
            logRun: args.logRun ?? false,
            runControl
          };
          const engine = args.engineFactory
            ? args.engineFactory()
            : new LangGraphEngineAdapter(engineOptions);
          const engineInitialState = initialState ?? createInitialGraphState({ plan: setup.plan, prompt: args.prompt });
          const runtimeServices = args.runtimeServicesFactory
            ? await args.runtimeServicesFactory({
                runContext: setup.runContext,
                plan: setup.plan,
                initialState: engineInitialState
              })
            : undefined;
          result = await engine.run({
            plan: setup.plan,
            initialState: initialState ?? (runtimeServices ? engineInitialState : undefined),
            prompt: args.prompt,
            runtimeServices
          });
        } finally {
          process.off("SIGTERM", requestDrain);
          process.off("SIGINT", requestDrain);
          if (projectControlPoll) clearInterval(projectControlPoll);
        }
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
    if (releaseProjectRunLock) {
      try {
        await releaseProjectRunLock();
      } catch (error) {
        if (!executionError) {
          executionError = createRuntimeError(
            normalizeRuntimeError(error, {
              errorCode: "PROJECT_RUN_LOCK_RELEASE_FAILED",
              errorCategory: "state",
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
              stage: "resume",
              runId: runContextForCleanup?.runId
            })
          );
        }
      }
    }
  }

  if (executionError) {
    if (
      args.resumeRunDir &&
      !(executionError instanceof RuntimeError && executionError.envelope.errorCode === "RUN_RESUME_NOT_ALLOWED") &&
      !(executionError instanceof RuntimeError && executionError.envelope.errorCode.startsWith("RESUME_RUN_LOCK_"))
    ) {
      const envelope = executionError instanceof RuntimeError ? executionError.envelope : undefined;
      try {
        await markResumeFailure({
          runDir: args.resumeRunDir,
          errorCode: envelope?.errorCode ?? "RUNTIME_RESUME_FAILED",
          message: envelope?.message ?? (executionError instanceof Error ? executionError.message : String(executionError))
        });
        trace("executor:complete");
      } catch (markError) {
        process.stderr.write(`[warn] failed to persist resume failure for ${args.resumeRunDir}: ${markError instanceof Error ? markError.message : String(markError)}\n`);
      }
    }
    if (setup) {
      await updateProjectRunState(setup.runContext.runDir, (failedState) => ({
        ...failedState,
        status: "failed",
        updatedAt: new Date().toISOString()
      })).catch(() => undefined);
    }
    throw executionError;
  }

  if (setup && result) {
    await updateProjectRunState(setup.runContext.runDir, async (currentState) => {
      const latestProjectControl = projectTaskRun
        ? await readLatestProjectRunControl(setup.runContext.runDir)
        : undefined;
      const controlledState = latestProjectControl?.action === "cancel"
        ? applyRunControl(currentState, "cancel")
        : latestProjectControl?.action === "pause" && !["completed", "failed", "cancelled"].includes(currentState.status)
          ? applyRunControl(currentState, "pause")
          : currentState;
      return projectRunStateFromResult(controlledState, result);
    });
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
