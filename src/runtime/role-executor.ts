/**
 * Coordinates single-role execution attempts, including context projection, binding selection,
 * prompt rendering, executor invocation, auditing, and persistence of results/outcomes.
 * Boundaries: does not manage branch activation, transitions, or graph resolution; that stays with
 * graph-runner. Trade-off: keeps every attempt isolated (dedicated execution dirs + outcomes) so
 * retries and diagnostics can replay without destroying prior evidence, at the cost of more files.
 */
import { mkdir } from "node:fs/promises";

import { createAuditRecord } from "./audit-recorder.js";
import { resolveExecutionBinding } from "./binding-resolver.js";
import type { ResolvedExecutionBinding } from "./binding-resolver.js";
import { createRunConsoleLogger } from "./console-run-log.js";
import type { RunConsoleLogger } from "./console-run-log.js";
import type { Executor } from "./executor.js";
import {
  buildJoinId,
  listActiveBranches,
  wouldExceedLoopBudget
} from "./graph-runtime-state.js";
import {
  getRoleInputContract,
  validateContractAgainstSchema
} from "./flow-contract.js";
import { OpencodeExecutionError } from "./opencode-executor.js";
import {
  mapRuntimeErrorToCompilerDiagnosticCode,
  type CompiledExecutionSnapshot
} from "./compiler.js";
import { filesystemArtifactStore } from "./artifact-store.js";
import {
  renderRolePrompt,
  validateRoleInputSchema,
  validateRoleOutputSchema
} from "./role-repo.js";
import { evaluateCondition } from "./condition-ast.js";
import { applySemanticBusinessState } from "./semantic-state.js";
import {
  buildProjectedContext,
  buildRolePromptInput,
  failContextProjection,
  getSelectableOutgoingFlows,
  sanitizeRoleInputContext
} from "./role-input-projector.js";
import type { RolePromptInput } from "./role-input-projector.js";
import {
  RUNTIME_ROLE_PROMPT_INPUT_SCHEMA,
  RUNTIME_ROLE_PROMPT_INPUT_SCHEMA_PATH
} from "./role-prompt-input-schema.js";
import {
  assertNoReservedErrorEventFromRoleOutput,
  buildCorrectionRequest,
  mergeRepairRecord,
  parseRoleExecutionOutputWithRepair,
  repairUnknownEvent
} from "./role-output-parser.js";
import {
  persistCommittedExecutionResult,
  recordAudit,
  recordRolePrelude,
  recordRoleResult,
  recordRoleSession
} from "./role-execution-recorder.js";
import type { PersistedRoleExecutorResult } from "./role-execution-recorder.js";
import { normalizeRuntimeError } from "./runtime-errors.js";
import { ToolExecutionError } from "./tool-runner.js";
import { validateEventCandidate } from "./event-contract.js";
import type { RuntimeAuditEvent } from "./engine-adapter.js";
import { SYSTEM_END_ROLE_ID } from "./types.js";
import type {
  AuditRecord,
  BranchRecord,
  CliTool,
  EffectiveLawConstraints,
  ExecutionPlan,
  ExecutionPlanNode,
  ExecutionProfile,
  GraphState,
  LoadedRolePackage,
  FlowContractPlan,
  RoleOutputRepairRecord,
  RuntimeErrorEnvelope,
  RunContext,
  StoredRoleResult,
  UserProfile
} from "./types.js";

export type RoleExecutorResult =
  | {
      status: "ok" | "noop";
      audit: AuditRecord;
      storedResult?: StoredRoleResult;
      selectedEvent?: string;
      executionId: string;
      branchId: string;
      loopIteration: number;
    }
  | {
      status: "failed";
      error: string;
      failure: RuntimeErrorEnvelope;
      audit: AuditRecord;
      executionId: string;
      branchId: string;
      loopIteration: number;
    };

const DEFAULT_ROLE_WAIT_HEARTBEAT_MS = 15000;

function validateSemanticRoleEvent(args: {
  plan: ExecutionPlan;
  roleId: string;
  mode?: string;
  allowedEvents: string[];
  eventType?: string;
  payload?: unknown;
}): void {
  if (!args.eventType || !args.plan.semanticIR) return;
  if (args.plan.semanticIR.events && !args.plan.semanticIR.events[args.eventType]) {
    throw new Error(`Event ${args.eventType} is not declared for role ${args.roleId} mode ${args.mode ?? "default"}`);
  }
  if (!args.allowedEvents.includes(args.eventType)) {
    throw new Error(`Event ${args.eventType} is not allowed for role ${args.roleId} mode ${args.mode ?? "default"}`);
  }
  const contract = args.plan.semanticIR.events?.[args.eventType];
  if (contract) {
    validateEventCandidate({
      roleId: args.roleId,
      mode: args.mode ?? "default",
      eventType: args.eventType,
      payload: args.payload ?? {},
      contracts: { [args.eventType]: { eventType: args.eventType, ...contract } },
      stateUpdateFields: contract.writableStateFields && args.payload && typeof args.payload === "object" && !Array.isArray(args.payload)
        ? Object.keys(args.payload as Record<string, unknown>)
        : []
    });
  }
}

function resolveRoleWaitHeartbeatMs(): number {
  const raw = process.env.OGSYSTEM_ROLE_WAIT_HEARTBEAT_MS?.trim();
  if (!raw) {
    return DEFAULT_ROLE_WAIT_HEARTBEAT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_ROLE_WAIT_HEARTBEAT_MS;
  }
  return parsed;
}

function startRoleWaitHeartbeat(args: {
  logger: RunConsoleLogger;
  runContext: RunContext;
  roleId: string;
  branchId: string;
  binding: string;
  stage: string;
  timeoutMs?: number;
  auditAppend?: (event: RuntimeAuditEvent) => Promise<void>;
}): () => Promise<void> {
  const heartbeatMs = resolveRoleWaitHeartbeatMs();
  if (heartbeatMs <= 0) {
    return async () => {};
  }

  const startedAt = Date.now();
  let writing = false;
  let pendingWrite: Promise<void> | undefined;
  const emit = async () => {
    if (writing) {
      return;
    }
    writing = true;
    const elapsedMs = Date.now() - startedAt;
    try {
      args.logger.roleWaiting({
        roleId: args.roleId,
        branchId: args.branchId,
        waitKind: "technical",
        stage: args.stage,
        elapsedMs,
        timeoutMs: args.timeoutMs,
        binding: args.binding
      });
      const event: RuntimeAuditEvent = {
        type: "role_waiting",
        at: new Date().toISOString(),
        waitKind: "technical",
        roleId: args.roleId,
        branchId: args.branchId,
        stage: args.stage,
        elapsedMs,
        timeoutMs: args.timeoutMs,
        binding: args.binding
      };
      if (args.auditAppend) {
        await args.auditAppend(event);
      } else {
        await filesystemArtifactStore.appendEvent(args.runContext, event);
        await filesystemArtifactStore.flush(args.runContext);
      }
    } catch {
      // Observability must never change role execution outcome.
    } finally {
      writing = false;
    }
  };

  const timer = setInterval(() => {
    pendingWrite = emit();
  }, heartbeatMs);

  return async () => {
    clearInterval(timer);
    await pendingWrite;
  };
}

function pickDryRunEvent(args: {
  node: ExecutionPlanNode;
  branch: BranchRecord;
  state: GraphState;
  plan: ExecutionPlan;
}): string | undefined {
  const selectableOutgoing = getSelectableOutgoingFlows(args.node);
  if (args.node.routingMode === "parallel_split") {
    return undefined;
  }
  if (selectableOutgoing.length === 0) {
    return undefined;
  }
  if (selectableOutgoing.length === 1) {
    return selectableOutgoing[0].eventType;
  }
  const allowed = selectableOutgoing.find(
    (flow) =>
      flow.toRoleId === SYSTEM_END_ROLE_ID ||
      !wouldExceedLoopBudget({
        targetRoleId: flow.toRoleId,
        currentLoopIteration: args.branch.loopIteration,
        state: args.state,
        plan: args.plan,
        lineageId: args.branch.lineageId
      })
  );
  return allowed?.eventType ?? selectableOutgoing[0].eventType;
}

function resolveAuditNextRoleId(args: {
  node: ExecutionPlanNode;
  selectedEvent?: string;
}): string | undefined {
  if (args.node.routingMode === "parallel_split" || !args.selectedEvent) {
    return undefined;
  }
  const selectedFlow = args.node.outgoing.find((flow) => flow.eventType === args.selectedEvent);
  if (!selectedFlow || selectedFlow.toRoleId === SYSTEM_END_ROLE_ID) {
    return undefined;
  }
  return selectedFlow.toRoleId;
}

function buildFailureEnvelope(args: {
  error: unknown;
  roleId: string;
  branchId: string;
  runId: string;
  loopIteration: number;
  message?: string;
}): RuntimeErrorEnvelope {
  const errorMessage = args.message ?? (args.error instanceof Error ? args.error.message : String(args.error));
  if (errorMessage.startsWith("[IR_CONTRACT_INVALID]")) {
    return {
      errorCode: "IR_CONTRACT_INVALID",
      errorCategory: "execution",
      message: errorMessage,
      retryable: false,
      stage: "execute",
      roleId: args.roleId,
      runId: args.runId,
      branchId: args.branchId
    };
  }
  if (args.error instanceof Error && "envelope" in args.error) {
    return normalizeRuntimeError(args.error, {
      errorCode: "ROLE_EXECUTION_FAILED",
      errorCategory: "execution",
      stage: "execute",
      retryable: false,
      roleId: args.roleId,
      runId: args.runId,
      branchId: args.branchId
    });
  }

  if (args.error instanceof ToolExecutionError) {
    const errorCode =
      args.error.category === "timeout"
        ? "TOOL_EXECUTION_TIMEOUT"
        : args.error.category === "output_limit"
          ? "TOOL_EXECUTION_OUTPUT_LIMIT"
          : "TOOL_EXECUTION_SPAWN";
    return {
      errorCode,
      errorCategory: "execution",
      message: args.message ?? args.error.message,
      retryable: args.error.category === "timeout",
      stage: "execute",
      roleId: args.roleId,
      runId: args.runId,
      branchId: args.branchId
    };
  }

  if (args.error instanceof OpencodeExecutionError) {
    return {
      errorCode: "OPENCODE_EXECUTION_ERROR",
      errorCategory: "execution",
      message: args.message ?? args.error.message,
      retryable: false,
      stage: "execute",
      roleId: args.roleId,
      runId: args.runId,
      branchId: args.branchId
    };
  }

  return normalizeRuntimeError(args.error, {
    errorCode: "ROLE_EXECUTION_FAILED",
    errorCategory: "execution",
    stage: "execute",
    retryable: false,
    message: args.message,
    roleId: args.roleId,
    runId: args.runId,
    branchId: args.branchId
  });
}

function assertCompilerSnapshotConsistency(args: {
  roleId: string;
  node: ExecutionPlanNode;
  branchId: string;
  compilerSnapshot?: CompiledExecutionSnapshot;
  roleInputContractPresent: boolean;
}): void {
  if (!args.compilerSnapshot) {
    return;
  }

  const projectionSummary = args.compilerSnapshot.projectionSummaryByRoleId[args.roleId];
  if (projectionSummary) {
    const summaryEntries = projectionSummary.fields
      .map((field) => [field.fieldName, field.selector] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    const runtimeEntries = Object.entries(args.node.contextMap ?? {}).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    const matches =
      summaryEntries.length === runtimeEntries.length &&
      summaryEntries.every(([fieldName, selector], index) => {
        const runtimeEntry = runtimeEntries[index];
        return runtimeEntry !== undefined && runtimeEntry[0] === fieldName && runtimeEntry[1] === selector;
      });
    if (!matches) {
      failContextProjection({
        errorCode: "COMPILER_SNAPSHOT_INCONSISTENT",
        message: `Compiler projection summary for role "${args.roleId}" does not match runtime context.map metadata.`,
        roleId: args.roleId,
        branchId: args.branchId
      });
    }
  }

  if (args.roleInputContractPresent && !args.compilerSnapshot.contractSummaryById[`role_input:${args.roleId}`]) {
    failContextProjection({
      errorCode: "COMPILER_SNAPSHOT_INCONSISTENT",
      message: `Compiler contract summary for role "${args.roleId}" is missing role_input metadata.`,
      roleId: args.roleId,
      branchId: args.branchId
    });
  }
}

/**
 * Role execution deliberately stops at "run one node and persist durable evidence". Graph-level
 * progression, branch activation, join waiting, and terminal status are owned by graph-runner.
 */
export async function executeRoleNode(args: {
  roleId: string;
  node: ExecutionPlanNode;
  plan: ExecutionPlan;
  state: GraphState;
  branch?: BranchRecord;
  effectiveLaw: EffectiveLawConstraints;
  profilesById: Map<string, ExecutionProfile>;
  toolsByRef: Map<string, CliTool>;
  rolePackagesByRoleId: Map<string, LoadedRolePackage>;
  contractPlan?: FlowContractPlan;
  compilerSnapshot?: CompiledExecutionSnapshot;
  runContext: RunContext;
  executor: Executor;
  userProfile?: UserProfile;
  workdir: string;
  commandBaseDir?: string;
  logger?: RunConsoleLogger;
  signal?: AbortSignal;
  /** OGS audit port supplied by the active engine adapter. */
  auditAppend?: (event: RuntimeAuditEvent) => Promise<void>;
}): Promise<RoleExecutorResult> {
  const currentBranch =
    args.branch ?? listActiveBranches(args.state, args.roleId).at(-1);
  if (!currentBranch) {
    throw new Error(`No active branch available for role "${args.roleId}"`);
  }
  const loopIteration = currentBranch.loopIteration;
  const branchId = currentBranch.branchId;
  const sessionKey = filesystemArtifactStore.buildSessionKey(args.roleId, currentBranch.sessionLineageId);
  const started = Date.now();
  const nextTransitionCount = args.state.transitionCount + 1;
  const lawRef = args.plan.lawBinding.globalLawRef;
  const rolePackage = args.rolePackagesByRoleId.get(args.roleId);
  if (!rolePackage) {
    throw new Error(`[IR_CONTRACT_INVALID] Role Contract is missing for ${args.roleId}`);
  }
  const execution = filesystemArtifactStore.allocateExecution({
    context: args.runContext,
    roleId: args.roleId,
    sessionKey,
    sessionLineageId: currentBranch.sessionLineageId,
    branchId,
    loopIteration
  });
  const compilerDigest = args.compilerSnapshot?.digest;
  // Invariant: each allocation increments the per-role execution counter and uses a unique directory so retries/replays never clobber prior evidence.
  const maxTransitions = args.effectiveLaw.maxTransitions;

  const assertToolCapability = (toolRef: string | undefined): void => {
    const capabilityPolicy = args.plan.semanticIR?.capabilities.allowedToolsByRoleId;
    if (
      toolRef !== undefined &&
      capabilityPolicy &&
      (!Object.prototype.hasOwnProperty.call(capabilityPolicy, args.roleId) ||
        !capabilityPolicy[args.roleId].includes(toolRef))
    ) {
      throw new Error(`Tool is not authorized by semantic capability policy: ${toolRef}`);
    }
    const contractTools = rolePackage.manifest.constraints.allowedTools;
    if (toolRef !== undefined && !contractTools.includes(toolRef)) {
      throw new Error(`Tool is not authorized by role contract: ${toolRef ?? "none"}`);
    }
  };

  if (maxTransitions !== undefined && nextTransitionCount > maxTransitions) {
    // Failure window: exceeding the transition budget aborts before execution so we don't leave the graph in an over-consumed state.
    const error = `Transition budget exceeded: ${nextTransitionCount} > ${maxTransitions}`;
    const failure = buildFailureEnvelope({
      error: new Error(error),
      roleId: args.roleId,
      branchId,
      runId: args.runContext.runId,
      loopIteration,
      message: error
    });
    const audit = createAuditRecord({
      roleId: args.roleId,
      branchId,
      joinId: args.node.joinMode ? buildJoinId(args.roleId, loopIteration, currentBranch.lineageId) : undefined,
      loopIteration,
      lawRef,
      started,
      exitCode: 1,
      status: "failed",
      error,
      errorEnvelope: failure,
      compilerDigest,
      compilerDiagnosticCode: mapRuntimeErrorToCompilerDiagnosticCode(failure)
    });
    await recordRoleResult({ roleId: args.roleId, context: args.runContext, execution, audit });
    const result: PersistedRoleExecutorResult = {
      status: "failed",
      error,
      failure,
      audit,
      executionId: execution.executionId,
      branchId,
      loopIteration
    };
    await persistCommittedExecutionResult({
      execution,
      branch: currentBranch,
      result
    });
    await recordAudit({ context: args.runContext, audit, append: args.auditAppend });
    return result;
  }

  if (!rolePackage) {
    const error = `Role package not loaded for role "${args.roleId}"`;
    const failure = buildFailureEnvelope({
      error: new Error(error),
      roleId: args.roleId,
      branchId,
      runId: args.runContext.runId,
      loopIteration,
      message: error
    });
    const audit = createAuditRecord({
      roleId: args.roleId,
      branchId,
      loopIteration,
      lawRef,
      started,
      exitCode: 1,
      status: "failed",
      error,
      errorEnvelope: failure,
      compilerDigest,
      compilerDiagnosticCode: mapRuntimeErrorToCompilerDiagnosticCode(failure)
    });
    await recordRoleResult({ roleId: args.roleId, context: args.runContext, execution, audit });
    const result: PersistedRoleExecutorResult = {
      status: "failed",
      error,
      failure,
      audit,
      executionId: execution.executionId,
      branchId,
      loopIteration
    };
    await persistCommittedExecutionResult({
      execution,
      branch: currentBranch,
      result
    });
    await recordAudit({ context: args.runContext, audit, append: args.auditAppend });
    return result;
  }

  const selectableOutgoing = getSelectableOutgoingFlows(args.node).filter(
    (item) => !args.node.modeAllowedEvents || args.node.modeAllowedEvents.includes(item.eventType)
  );
  const allowedEvents = selectableOutgoing.map((item) => item.eventType);
  const roleDirs = args.runContext.roleDirsById.get(args.roleId);
  const resolvedRoleDirs = roleDirs
    ? {
        ...roleDirs,
        privateDir: filesystemArtifactStore.resolvePrivateWorkspace({
          roleDirs,
          workspaceIsolation: args.runContext.workspaceIsolation,
          branchId
        })
      }
    : undefined;
  const existingSession = filesystemArtifactStore.getSession(args.runContext, sessionKey);

  let modelId: string | undefined;
  let profileId: string | undefined;
  let toolRef: string | undefined;
  let command: string | undefined;
  let lastStdout: string | undefined;
  let resolvedBinding: ResolvedExecutionBinding | undefined;
  let promptInput!: RolePromptInput;
  let inputContextForAudit: string | undefined;
  let prompt = "";
  const logger = args.logger ?? createRunConsoleLogger(false);

  try {
    resolvedBinding = resolveExecutionBinding({
      roleId: args.roleId,
      node: args.node,
      runContext: args.runContext,
      baseWorkdir: args.workdir,
      commandBaseDir: args.commandBaseDir,
      roleDirs: resolvedRoleDirs,
      allowedEvents,
      effectiveLaw: args.effectiveLaw,
      profilesById: args.profilesById,
      toolsByRef: args.toolsByRef,
    });
    assertToolCapability(resolvedBinding.toolRef);
    promptInput = buildRolePromptInput({
      roleId: args.roleId,
      node: args.node,
      branch: currentBranch,
      state: args.state,
      userProfile: args.userProfile
    });
    inputContextForAudit = sanitizeRoleInputContext(promptInput.input);
    for (const condition of rolePackage.manifest.inputs.preconditions) {
      if (!evaluateCondition(condition, {
        state: args.state.businessState ?? {},
        loop: { iteration: loopIteration, lineageId: currentBranch.lineageId },
        event: {},
        role: { roleId: args.roleId, input: promptInput.input }
      })) throw new Error(`[IR_CONTRACT_INVALID] Role precondition failed: ${args.roleId}`);
    }

    if (args.contractPlan) {
      const projectedContext = buildProjectedContext({
        roleId: args.roleId,
        node: args.node,
        branch: currentBranch,
        state: args.state,
        userProfile: args.userProfile
      });
      const roleInputContract = getRoleInputContract({
        plan: args.contractPlan,
        roleId: args.roleId
      });
      assertCompilerSnapshotConsistency({
        roleId: args.roleId,
        node: args.node,
        branchId: currentBranch.branchId,
        compilerSnapshot: args.compilerSnapshot,
        roleInputContractPresent: roleInputContract !== undefined
      });
      if (roleInputContract) {
        const contractError = validateContractAgainstSchema({
          contract: roleInputContract,
          data: projectedContext,
          subject: "role_input"
        });
        if (contractError) {
          failContextProjection({
            errorCode: "CONTRACT_ROLE_INPUT_VALIDATION_FAILED",
            message: contractError,
            roleId: args.roleId,
            branchId: currentBranch.branchId
          });
        }
      }
    }

    validateRoleInputSchema({
      input: promptInput,
      schema: RUNTIME_ROLE_PROMPT_INPUT_SCHEMA,
      schemaPath: RUNTIME_ROLE_PROMPT_INPUT_SCHEMA_PATH,
      roleId: args.roleId
    });

    prompt = renderRolePrompt({
      promptTemplate: rolePackage.promptTemplate,
      agent: rolePackage.agent,
      values: promptInput
    });

    resolvedBinding = resolveExecutionBinding({
      roleId: args.roleId,
      node: args.node,
      runContext: args.runContext,
      baseWorkdir: args.workdir,
      commandBaseDir: args.commandBaseDir,
      roleDirs: resolvedRoleDirs,
      allowedEvents,
      effectiveLaw: args.effectiveLaw,
      profilesById: args.profilesById,
      toolsByRef: args.toolsByRef,
    });
    assertToolCapability(resolvedBinding.toolRef);
    modelId = resolvedBinding.modelRef;
    profileId = resolvedBinding.profileId;
    toolRef = resolvedBinding.toolRef;
    command = resolvedBinding.command;

    logger.roleStart({
      roleId: args.roleId,
      branchId,
      loopIteration,
      binding: resolvedBinding.binding ? resolvedBinding.bindingLabel : "noop",
      timeoutMs: resolvedBinding.binding ? resolvedBinding.timeoutMs : undefined
    });

    await recordRolePrelude({
      roleId: args.roleId,
      roleName: rolePackage.manifest.name ?? args.roleId,
      roleDescription: rolePackage.manifest.description ?? "",
      prompt,
      allowedEvents,
      modelId,
      resolvedRolePath: rolePackage.resolvedPath,
      preferredModelTags: rolePackage.manifest.preferredModelTags,
      sharedDir: args.runContext.sharedDir,
      privateDir: resolvedRoleDirs?.privateDir ?? "",
      execution,
        roleInputProjection: {
          role_id: args.roleId,
          ...(args.node.executionMode ? { mode: args.node.executionMode } : {}),
          task: args.state.userPrompt,
          input: promptInput.input,
          allowed_events: allowedEvents,
          user_preferences: args.userProfile ?? {}
        },
      context: args.runContext
    });

    if (!resolvedBinding.binding) {
      // Trade-off: explicit no-op execution is only allowed when laws permit and outgoing flow count is 1 to avoid injecting ambiguity.
      if (!args.effectiveLaw.allowNoopWithoutExecutionBinding) {
        throw new Error(`Role "${args.roleId}" has no execution binding`);
      }
      if (selectableOutgoing.length > 1) {
        throw new Error(
          `Role "${args.roleId}" cannot use explicit noop mode with multiple outgoing flows`
        );
      }

      const selectedToRoleId = selectableOutgoing[0]?.toRoleId;
      const selectedEvent = selectableOutgoing[0]?.eventType;
      validateSemanticRoleEvent({
        plan: args.plan,
        roleId: args.roleId,
        mode: args.node.executionMode,
        allowedEvents,
        eventType: selectedEvent
      });
      const audit = createAuditRecord({
        roleId: args.roleId,
        branchId,
        loopIteration,
        lawRef,
        started,
        exitCode: 0,
        selectedEvent,
        nextRoleId:
          !selectedToRoleId || selectedToRoleId === SYSTEM_END_ROLE_ID ? undefined : selectedToRoleId,
        status: "noop",
        compilerDigest
      });
      await recordRoleResult({ roleId: args.roleId, context: args.runContext, execution, audit });
      const result: PersistedRoleExecutorResult = {
        status: "noop",
        audit,
        selectedEvent,
        executionId: execution.executionId,
        branchId,
        loopIteration
      };
      await persistCommittedExecutionResult({
        execution,
        branch: currentBranch,
        result
      });
      logger.roleDone({
        roleId: args.roleId,
        branchId,
        status: "noop",
        selectedEvent,
        durationMs: audit.durationMs
      });
      await recordAudit({ context: args.runContext, audit, append: args.auditAppend });
      return result;
    }

    await mkdir(resolvedBinding.workdir, { recursive: true });

    const stopRoleWaitHeartbeat = startRoleWaitHeartbeat({
      logger,
      runContext: args.runContext,
      roleId: args.roleId,
      branchId,
      binding: resolvedBinding.bindingLabel,
      stage: resolvedBinding.binding.kind === "model" ? "model_provider" : "cli_tool",
      timeoutMs: resolvedBinding.timeoutMs,
      auditAppend: args.auditAppend
    });
    let executionResult;
    try {
      executionResult = await args.executor.execute({
        roleId: args.roleId,
        sessionKey,
        prompt,
        schema: rolePackage.outputSchema,
        binding: resolvedBinding.binding,
        workdir: resolvedBinding.workdir,
        directory: args.workdir,
        commandBaseDir: resolvedBinding.commandBaseDir,
        env: resolvedBinding.env,
        timeoutMs: resolvedBinding.timeoutMs,
        maxOutputBytes: resolvedBinding.maxOutputBytes,
        signal: args.signal,
        dryRunOutputEvent: pickDryRunEvent({
          node: args.node,
          branch: currentBranch,
          state: args.state,
          plan: args.plan
        }),
        sessionId: existingSession?.sessionId
      });
    } finally {
      await stopRoleWaitHeartbeat();
    }
    lastStdout = executionResult.stdout;

    const parsed = parseRoleExecutionOutputWithRepair({
      rawOutput: executionResult.stdout,
      requireEvent: selectableOutgoing.length > 0 && args.node.routingMode !== "parallel_split"
    });
    assertNoReservedErrorEventFromRoleOutput({
      roleId: args.roleId,
      event: parsed.output.event
    });
    let repair = parsed.repair;
    repair = mergeRepairRecord(
      repair,
      repairUnknownEvent({
        output: parsed.output,
        allowedEvents
      })
    );

    validateRoleOutputSchema({
      output: parsed.output,
      schema: rolePackage.outputSchema,
      schemaPath: rolePackage.outputSchemaPath,
      roleId: args.roleId
    });

    const selectedEvent = parsed.output.event;
    validateSemanticRoleEvent({
      plan: args.plan,
      roleId: args.roleId,
      mode: args.node.executionMode,
      allowedEvents,
      eventType: selectedEvent,
      payload: parsed.output.data
    });
    const reducedBusinessState = applySemanticBusinessState({ state: args.state, plan: args.plan, roleId: args.roleId, data: parsed.output.data });
    for (const condition of rolePackage.manifest.outputs.postconditions) {
      if (!evaluateCondition(condition, {
        state: reducedBusinessState ?? args.state.businessState ?? {}, loop: { iteration: loopIteration, lineageId: currentBranch.lineageId }, event: parsed.output.data ?? {}, role: { roleId: args.roleId, output: parsed.output }
      })) throw new Error(`[IR_CONTRACT_INVALID] Role postcondition failed: ${args.roleId}`);
    }
    if (
      args.node.routingMode !== "parallel_split" &&
      selectableOutgoing.length > 0 &&
      !selectableOutgoing.find((flow) => flow.eventType === selectedEvent)
    ) {
      throw new Error(
        `Executable role output event "${selectedEvent ?? ""}" does not match any outgoing flow on role "${args.roleId}"`
      );
    }

    const audit = createAuditRecord({
      roleId: args.roleId,
      branchId,
      joinId: args.node.joinMode ? buildJoinId(args.roleId, loopIteration, currentBranch.lineageId) : undefined,
      loopIteration,
      lawRef,
      started,
      modelId: executionResult.modelId ?? modelId,
      profileId: executionResult.profileId ?? profileId,
      toolRef: executionResult.toolRef ?? toolRef,
      command: executionResult.command ?? command,
      resultArgs: executionResult.args,
      sessionId: executionResult.sessionId,
      messageId: executionResult.messageId,
      serverPid: executionResult.serverPid,
      exitCode: executionResult.exitCode,
      selectedEvent,
      nextRoleId: resolveAuditNextRoleId({
        node: args.node,
        selectedEvent
      }),
      status: "ok",
      stdout: executionResult.stdout,
      stderr: executionResult.stderr,
      repair,
      compilerDigest
    });

    if (executionResult.sessionId) {
      await recordRoleSession({
        context: args.runContext,
        roleId: args.roleId,
        execution,
        sessionId: executionResult.sessionId,
        messageId: executionResult.messageId,
        sessionDirectory: resolvedBinding.sessionDirectory
      });
    }
    await recordRoleResult({
      roleId: args.roleId,
      context: args.runContext,
      execution,
      output: parsed.output,
      audit
    });
    const result: PersistedRoleExecutorResult = {
      status: "ok",
      audit,
      storedResult: {
        roleId: args.roleId,
        event: parsed.output.event,
        content: parsed.output.content,
        data: parsed.output.data,
        branchId,
        lineageId: currentBranch.lineageId,
        loopIteration
      },
      selectedEvent,
      executionId: execution.executionId,
      branchId,
      loopIteration
    };
    await persistCommittedExecutionResult({
      execution,
      branch: currentBranch,
      result
    });
    logger.roleDone({
      roleId: args.roleId,
      branchId,
      status: "ok",
      selectedEvent,
      durationMs: audit.durationMs
    });
    await recordAudit({ context: args.runContext, audit, append: args.auditAppend });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const category = error instanceof ToolExecutionError ? ` (${error.category})` : "";
    const executionError = error instanceof OpencodeExecutionError ? error.details : undefined;
    // Recovery semantics: every exception is normalized into a failure envelope so the graph runner can decide retry/recover policies consistently.
    const failure = buildFailureEnvelope({
      error,
      roleId: args.roleId,
      branchId,
      runId: args.runContext.runId,
      loopIteration,
      message: `${message}${category}`
    });
    const repair =
      typeof error === "object" &&
      error !== null &&
      "repair" in error &&
      typeof (error as { repair?: unknown }).repair === "object"
        ? ((error as { repair?: RoleOutputRepairRecord }).repair ?? undefined)
        : undefined;
    const correctionRequest = buildCorrectionRequest({
      roleId: args.roleId,
      message: `${message}${category}`,
      rawOutput: executionError?.stdout ?? lastStdout,
      allowedEvents,
      schemaPath: rolePackage.outputSchemaPath
    });
    const audit = createAuditRecord({
      roleId: args.roleId,
      branchId,
      loopIteration,
      lawRef,
      started,
      modelId,
      profileId,
      toolRef,
      command,
      resultArgs: executionError?.args,
      sessionId: executionError?.sessionId,
      messageId: executionError?.messageId,
      serverPid: executionError?.serverPid,
      exitCode: 1,
      status: "failed",
      stdout: executionError?.stdout,
      stderr: executionError?.stderr,
      error: `${message}${category}`,
      errorEnvelope: failure,
      compilerDigest,
      compilerDiagnosticCode: mapRuntimeErrorToCompilerDiagnosticCode(failure),
      repair,
      correctionRequest,
      inputContext: inputContextForAudit
    });
    if (executionError?.sessionId) {
      await recordRoleSession({
        context: args.runContext,
        roleId: args.roleId,
        execution,
        sessionId: executionError.sessionId,
        messageId: executionError.messageId,
        sessionDirectory: resolvedBinding?.sessionDirectory
      });
    }
    await recordRoleResult({ roleId: args.roleId, context: args.runContext, execution, audit });
    const result: PersistedRoleExecutorResult = {
      status: "failed",
      error: `${message}${category}`,
      failure,
      audit,
      executionId: execution.executionId,
      branchId,
      loopIteration
    };
    await persistCommittedExecutionResult({
      execution,
      branch: currentBranch,
      result
    });
    logger.roleDone({
      roleId: args.roleId,
      branchId,
      status: "failed",
      durationMs: audit.durationMs,
      errorCode: failure.errorCode
    });
    await recordAudit({ context: args.runContext, audit, append: args.auditAppend });
    return result;
  }
}
