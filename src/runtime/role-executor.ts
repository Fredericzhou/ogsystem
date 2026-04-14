/**
 * Coordinates single-role execution attempts, including context projection, binding selection,
 * prompt rendering, executor invocation, auditing, and persistence of results/outcomes.
 * Boundaries: does not manage branch activation, transitions, or graph resolution; that stays with
 * graph-runner. Trade-off: keeps every attempt isolated (dedicated execution dirs + outcomes) so
 * retries and diagnostics can replay without destroying prior evidence, at the cost of more files.
 */
import { appendAuditRecord, createAuditRecord } from "./audit-recorder.js";
import { createRunConsoleLogger } from "./console-run-log.js";
import type { RunConsoleLogger } from "./console-run-log.js";
import type { Executor, ExecutorBinding } from "./executor.js";
import {
  buildJoinId,
  getBranchResult,
  listActiveBranches,
  findRoleResult,
  wouldExceedLoopBudget
} from "./graph-runtime-state.js";
import { OpencodeExecutionError } from "./opencode-executor.js";
import {
  allocateRoleExecution,
  buildRoleSessionKey,
  getRoleSession,
  persistRoleExecutionOutcome,
  persistRolePrelude,
  persistRoleResult,
  persistRoleSession
} from "./run-artifacts.js";
import {
  renderRolePrompt,
  validateRoleInputSchema,
  validateRoleOutputSchema
} from "./role-repo.js";
import { isRuntimeOnlyErrorEvent } from "./error-flow-utils.js";
import { createRuntimeError, normalizeRuntimeError } from "./runtime-errors.js";
import { renderUserProfile, stringifyJson } from "./runtime-support.js";
import { ToolExecutionError } from "./tool-runner.js";
import { SYSTEM_END_ROLE_ID } from "./types.js";
import type {
  AuditRecord,
  BranchRecord,
  CliTool,
  EffectiveLawConstraints,
  ExecutionPlan,
  ExecutionPlanNode,
  ExecutionProfile,
  Flow,
  GraphState,
  LoadedModelPackage,
  LoadedRolePackage,
  RoleExecutionOutput,
  RoleExecutionOutcomeRecord,
  RoleExecutionRecord,
  RoleOutputRepairRecord,
  RuntimeErrorEnvelope,
  RunContext,
  StoredRoleResult,
  UserProfile
} from "./types.js";

type RolePromptInput = {
  task: string;
  context: string;
  allowed_events: string;
  last_output: string;
  system_notes: string;
  round: string;
  user_profile: string;
};

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

type PersistedRoleExecutorResult =
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

function buildRoleExecutionOutcome(args: {
  execution: RoleExecutionRecord;
  branch: BranchRecord;
  result: PersistedRoleExecutorResult;
}): RoleExecutionOutcomeRecord {
  const committedAt = new Date().toISOString();
  if (args.result.status === "failed") {
    return {
      version: 1,
      executionId: args.result.executionId,
      roleId: args.execution.roleId,
      branchId: args.result.branchId,
      loopIteration: args.result.loopIteration,
      sessionKey: args.execution.sessionKey,
      branch: args.branch,
      committedAt,
      status: "failed",
      error: args.result.error,
      failure: args.result.failure,
      audit: args.result.audit
    };
  }
  return {
    version: 1,
    executionId: args.result.executionId,
    roleId: args.execution.roleId,
    branchId: args.result.branchId,
    loopIteration: args.result.loopIteration,
    sessionKey: args.execution.sessionKey,
    branch: args.branch,
    committedAt,
    status: args.result.status,
    selectedEvent: args.result.selectedEvent,
    storedResult: args.result.storedResult,
    audit: args.result.audit
  };
}

async function persistCommittedExecutionResult(args: {
  execution: RoleExecutionRecord;
  branch: BranchRecord;
  result: PersistedRoleExecutorResult;
}): Promise<RoleExecutionOutcomeRecord> {
  // This outcome file is the durable marker that a role attempt has finished. The graph runner
  // may still crash before checkpointing, so resume relies on this marker to reconcile safely.
  const outcome = buildRoleExecutionOutcome(args);
  await persistRoleExecutionOutcome({
    execution: args.execution,
    outcome
  });
  return outcome;
}

function getDirectContext(state: GraphState, branch: BranchRecord): string {
  if (!branch.parentBranchId) {
    return state.userPrompt;
  }
  const upstream = getBranchResult(state, branch.parentBranchId);
  return upstream?.content ?? state.userPrompt;
}

function renderJoinContext(args: {
  state: GraphState;
  joinSources: string[];
  branch: BranchRecord;
}): string {
  // Join prompts receive a normalized projection keyed by declared sources rather than the raw
  // graph state shape. This keeps role templates stable even if internal runtime state evolves.
  const namespace = Object.fromEntries(args.joinSources.map((sourceRoleId) => {
    const result = findRoleResult({
      state: args.state,
      roleId: sourceRoleId,
      lineageId: args.branch.lineageId,
      loopIteration: args.branch.loopIteration
    });
    const artifact: Record<string, unknown> = {};
    if (result?.event) {
      artifact.event = result.event;
    }
    if (result?.content !== undefined) {
      artifact.content = result.content;
    }
    if (result?.data !== undefined) {
      artifact.data = result.data;
    }
    return [sourceRoleId, artifact];
  }));
  return stringifyJson(namespace);
}

function failContextProjection(args: {
  errorCode: string;
  message: string;
  roleId: string;
  branchId: string;
}): never {
  throw createRuntimeError({
    errorCode: args.errorCode,
    errorCategory: "state",
    message: args.message,
    retryable: false,
    stage: "execute",
    roleId: args.roleId,
    branchId: args.branchId
  });
}

function resolveObjectPath(args: {
  value: unknown;
  path: string[];
  selector: string;
  roleId: string;
  branchId: string;
}): unknown {
  let current = args.value;
  for (const segment of args.path) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      failContextProjection({
        errorCode: "ROLE_CONTEXT_PATH_MISSING",
        message: `Role "${args.roleId}" selector "${args.selector}" is missing required path "${segment}".`,
        roleId: args.roleId,
        branchId: args.branchId
      });
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function resolveArtifactField(args: {
  artifact: StoredRoleResult;
  field: "content" | "event" | "data";
  selector: string;
  roleId: string;
  branchId: string;
}): unknown {
  const value = args.artifact[args.field];
  if (value === undefined) {
    failContextProjection({
      errorCode: "ROLE_CONTEXT_PATH_MISSING",
      message: `Role "${args.roleId}" selector "${args.selector}" is missing required field "${args.field}".`,
      roleId: args.roleId,
      branchId: args.branchId
    });
  }
  return value;
}

function getRequiredDirectArtifact(args: {
  state: GraphState;
  branch: BranchRecord;
  roleId: string;
}): StoredRoleResult {
  if (!args.branch.parentBranchId) {
    failContextProjection({
      errorCode: "ROLE_CONTEXT_SOURCE_UNAVAILABLE",
      message: `Role "${args.roleId}" cannot resolve direct.* selector without an upstream branch.`,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }
  const upstream = getBranchResult(args.state, args.branch.parentBranchId);
  if (!upstream) {
    failContextProjection({
      errorCode: "ROLE_CONTEXT_SOURCE_UNAVAILABLE",
      message: `Role "${args.roleId}" requires an upstream result for direct.* selector evaluation.`,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }
  return upstream;
}

function getRequiredJoinSourceArtifact(args: {
  state: GraphState;
  branch: BranchRecord;
  roleId: string;
  node: ExecutionPlanNode;
  sourceRoleId: string;
}): StoredRoleResult {
  if (!args.node.joinMode) {
    failContextProjection({
      errorCode: "ROLE_CONTEXT_SELECTOR_UNAUTHORIZED",
      message: `Role "${args.roleId}" cannot use source(...) selectors without join.mode.`,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }
  if (!args.node.joinSources.includes(args.sourceRoleId)) {
    failContextProjection({
      errorCode: "ROLE_CONTEXT_SELECTOR_UNAUTHORIZED",
      message:
        `Role "${args.roleId}" selector source("${args.sourceRoleId}") is not declared in join.sources.`,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }
  const result = findRoleResult({
    state: args.state,
    roleId: args.sourceRoleId,
    lineageId: args.branch.lineageId,
    loopIteration: args.branch.loopIteration
  });
  if (!result) {
    failContextProjection({
      errorCode: "ROLE_CONTEXT_SOURCE_UNAVAILABLE",
      message:
        `Role "${args.roleId}" selector source("${args.sourceRoleId}") is not available for the current lineage and loop iteration.`,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }
  return result;
}

function evaluateContextSelector(args: {
  selector: string;
  roleId: string;
  node: ExecutionPlanNode;
  branch: BranchRecord;
  state: GraphState;
  userProfile?: UserProfile;
}): unknown {
  const selector = args.selector;
  if (selector === "global.task") {
    return args.state.userPrompt;
  }
  if (selector === "global.user_profile") {
    if (!args.userProfile) {
      failContextProjection({
        errorCode: "ROLE_CONTEXT_SOURCE_UNAVAILABLE",
        message: `Role "${args.roleId}" selector "${selector}" requires user_profile input.`,
        roleId: args.roleId,
        branchId: args.branch.branchId
      });
    }
    return args.userProfile;
  }
  if (selector.startsWith("global.user_profile.")) {
    if (!args.userProfile) {
      failContextProjection({
        errorCode: "ROLE_CONTEXT_SOURCE_UNAVAILABLE",
        message: `Role "${args.roleId}" selector "${selector}" requires user_profile input.`,
        roleId: args.roleId,
        branchId: args.branch.branchId
      });
    }
    return resolveObjectPath({
      value: args.userProfile,
      path: selector.slice("global.user_profile.".length).split("."),
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }

  if (selector === "direct.content" || selector === "direct.event" || selector === "direct.data") {
    const artifact = getRequiredDirectArtifact({
      state: args.state,
      branch: args.branch,
      roleId: args.roleId
    });
    return resolveArtifactField({
      artifact,
      field: selector.slice("direct.".length) as "content" | "event" | "data",
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }

  if (selector.startsWith("direct.data.")) {
    const artifact = getRequiredDirectArtifact({
      state: args.state,
      branch: args.branch,
      roleId: args.roleId
    });
    return resolveObjectPath({
      value: resolveArtifactField({
        artifact,
        field: "data",
        selector,
        roleId: args.roleId,
        branchId: args.branch.branchId
      }),
      path: selector.slice("direct.data.".length).split("."),
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }

  const sourceMatch = selector.match(/^source\(([A-Za-z0-9._:-]+)\)\.(content|event|data)(?:\.(.+))?$/);
  if (sourceMatch) {
    const [, sourceRoleId, field, nestedPath] = sourceMatch;
    const artifact = getRequiredJoinSourceArtifact({
      state: args.state,
      branch: args.branch,
      roleId: args.roleId,
      node: args.node,
      sourceRoleId
    });
    const fieldValue = resolveArtifactField({
      artifact,
      field: field as "content" | "event" | "data",
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
    if (!nestedPath) {
      return fieldValue;
    }
    return resolveObjectPath({
      value: fieldValue,
      path: nestedPath.split("."),
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }

  failContextProjection({
    errorCode: "ROLE_CONTEXT_SELECTOR_UNSUPPORTED",
    message: `Role "${args.roleId}" uses unsupported context selector "${selector}".`,
    roleId: args.roleId,
    branchId: args.branch.branchId
  });
}

function buildProjectedContext(args: {
  roleId: string;
  node: ExecutionPlanNode;
  branch: BranchRecord;
  state: GraphState;
  userProfile?: UserProfile;
}): string {
  const sortedEntries = Object.entries(args.node.contextMap ?? {}).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const projected = Object.fromEntries(sortedEntries.map(([fieldName, selector]) => [
    fieldName,
    evaluateContextSelector({
      selector,
      roleId: args.roleId,
      node: args.node,
      branch: args.branch,
      state: args.state,
      userProfile: args.userProfile
    })
  ]));
  return stringifyJson(projected);
}

function getSelectableOutgoingFlows(node: ExecutionPlanNode): Flow[] {
  return node.outgoing.filter((flow) => !isRuntimeOnlyErrorEvent(flow.eventType));
}

const ROLE_INPUT_CONTEXT_MAX_CHARS = 800;

function sanitizeRoleInputContext(value: string): string {
  const redacted = value.replace(
    /\b(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
    "$1=<redacted>"
  );
  if (redacted.length <= ROLE_INPUT_CONTEXT_MAX_CHARS) {
    return redacted;
  }
  return `${redacted.slice(0, ROLE_INPUT_CONTEXT_MAX_CHARS)}...`;
}

/**
 * Prompt input is intentionally flattened into a small stable contract. Executors and prompt
 * templates should not depend on full runtime state or branch internals.
 */
function buildRolePromptInput(args: {
  roleId: string;
  node: ExecutionPlanNode;
  branch: BranchRecord;
  state: GraphState;
  userProfile?: UserProfile;
}): RolePromptInput {
  const allowedEvents = getSelectableOutgoingFlows(args.node).map((item) => item.eventType);
  const hasContextMap = Boolean(args.node.contextMap && Object.keys(args.node.contextMap).length > 0);
  const context =
    hasContextMap
      ? buildProjectedContext(args)
      : args.node.joinMode
        ? renderJoinContext({
            state: args.state,
            joinSources: args.node.joinSources,
            branch: args.branch
          })
        : getDirectContext(args.state, args.branch);

  return {
    task: args.state.userPrompt,
    context,
    allowed_events: JSON.stringify(allowedEvents),
    last_output: context,
    system_notes: "",
    round: String(args.branch.loopIteration),
    user_profile: renderUserProfile(args.userProfile)
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
        plan: args.plan
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

function extractJsonObjectCandidate(raw: string): string | undefined {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) {
    return fenced[1].trim();
  }

  const start = raw.indexOf("{");
  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (character === "\\") {
        escaping = true;
        continue;
      }
      if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1).trim();
      }
    }
  }

  return undefined;
}

/**
 * Output repair is intentionally narrow: recover a wrapped JSON object and normalize the only
 * allowed event when that choice is unambiguous. Anything broader would hide contract drift.
 */
export function parseRoleExecutionOutputWithRepair(args: {
  rawOutput: string;
  requireEvent: boolean;
}): { output: RoleExecutionOutput; repair?: RoleOutputRepairRecord } {
  const trimmed = args.rawOutput.trim();
  if (!trimmed) {
    throw new Error("Executable role output is empty; expected JSON object");
  }

  let parsed: unknown;
  let repair: RoleOutputRepairRecord | undefined;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const candidate = extractJsonObjectCandidate(trimmed);
    if (candidate && candidate !== trimmed) {
      try {
        parsed = JSON.parse(candidate);
        repair = {
          kind: "invalid_json",
          attempted: true,
          applied: true,
          strategy: "extract_json_object",
          detail: "Recovered JSON object from wrapped stdout"
        };
      } catch {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Executable role output must be valid JSON: ${message}`);
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Executable role output must be valid JSON: ${message}`);
    }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Executable role output must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  const allowedKeys = new Set(["event", "content", "data"]);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Executable role output contains unsupported field "${key}"`);
    }
  }

  const output: RoleExecutionOutput = {};
  if (record.event !== undefined) {
    if (typeof record.event !== "string" || !record.event.trim()) {
      throw new Error('Executable role output field "event" must be a non-empty string');
    }
    output.event = record.event.trim();
  }
  if (record.content !== undefined) {
    if (typeof record.content !== "string") {
      throw new Error('Executable role output field "content" must be a string');
    }
    output.content = record.content;
  }
  if (record.data !== undefined) {
    if (typeof record.data !== "object" || record.data === null || Array.isArray(record.data)) {
      throw new Error('Executable role output field "data" must be an object');
    }
    output.data = record.data as Record<string, unknown>;
  }
  if (args.requireEvent && !output.event) {
    throw new Error('Executable role output must include "event" for roles with outgoing flows');
  }

  return {
    output,
    repair
  };
}

export function repairUnknownEvent(args: {
  output: RoleExecutionOutput;
  allowedEvents: string[];
}): RoleOutputRepairRecord | undefined {
  if (args.allowedEvents.length !== 1) {
    return undefined;
  }
  const [onlyAllowedEvent] = args.allowedEvents;
  if (args.output.event === onlyAllowedEvent) {
    return undefined;
  }

  args.output.event = onlyAllowedEvent;
  return {
    kind: "unknown_event",
    attempted: true,
    applied: true,
    strategy: "single_allowed_event",
    detail: `Normalized event to the only allowed transition "${onlyAllowedEvent}"`
  };
}

function assertNoReservedErrorEventFromRoleOutput(args: {
  roleId: string;
  event?: string;
}): void {
  if (!args.event) {
    return;
  }
  if (!args.event.startsWith("ERROR")) {
    return;
  }
  throw new Error(
    `Executable role output event "${args.event}" uses reserved prefix "ERROR*"; runtime-only failure routing must trigger it`
  );
}

function mergeRepairRecord(
  left?: RoleOutputRepairRecord,
  right?: RoleOutputRepairRecord
): RoleOutputRepairRecord | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return {
    kind: right.kind,
    attempted: left.attempted || right.attempted,
    applied: left.applied || right.applied,
    strategy: `${left.strategy},${right.strategy}`,
    detail: `${left.detail}; ${right.detail}`
  };
}

function buildFailureEnvelope(args: {
  error: unknown;
  roleId: string;
  branchId: string;
  runId: string;
  loopIteration: number;
  message?: string;
}): RuntimeErrorEnvelope {
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

function inferCorrectionReason(message: string): RoleOutputRepairRecord["kind"] | undefined {
  if (
    /valid JSON/i.test(message) ||
    /JSON object/i.test(message) ||
    /unsupported field/i.test(message)
  ) {
    return "invalid_json";
  }
  if (/does not match schema/i.test(message)) {
    return "schema_mismatch";
  }
  if (/does not match any outgoing flow/i.test(message)) {
    return "unknown_event";
  }
  return undefined;
}

function buildCorrectionRequest(args: {
  roleId: string;
  message: string;
  rawOutput?: string;
  allowedEvents: string[];
  schemaPath?: string;
}) {
  const reason = inferCorrectionReason(args.message);
  if (!reason || !args.rawOutput?.trim()) {
    return undefined;
  }

  return {
    roleId: args.roleId,
    reason,
    rawOutput: args.rawOutput,
    allowedEvents: args.allowedEvents,
    schemaPath: args.schemaPath,
    detail: args.message
  };
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
  modelsById: Map<string, LoadedModelPackage>;
  rolePackagesByRoleId: Map<string, LoadedRolePackage>;
  runContext: RunContext;
  executor: Executor;
  userProfile?: UserProfile;
  workdir: string;
  logger?: RunConsoleLogger;
}): Promise<RoleExecutorResult> {
  const currentBranch =
    args.branch ?? listActiveBranches(args.state, args.roleId).at(-1);
  if (!currentBranch) {
    throw new Error(`No active branch available for role "${args.roleId}"`);
  }
  const loopIteration = currentBranch.loopIteration;
  const branchId = currentBranch.branchId;
  const sessionKey = buildRoleSessionKey(args.roleId, currentBranch.sessionLineageId);
  const started = Date.now();
  const nextTransitionCount = args.state.transitionCount + 1;
  const lawRef = args.plan.lawBinding.globalLawRef;
  const rolePackage = args.rolePackagesByRoleId.get(args.roleId);
  const execution = allocateRoleExecution({
    context: args.runContext,
    roleId: args.roleId,
    sessionKey,
    sessionLineageId: currentBranch.sessionLineageId,
    branchId,
    loopIteration
  });
  // Invariant: each allocation increments the per-role execution counter and uses a unique directory so retries/replays never clobber prior evidence.
  const maxTransitions = args.effectiveLaw.maxTransitions;

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
      joinId: args.node.joinMode ? buildJoinId(args.roleId, loopIteration) : undefined,
      loopIteration,
      lawRef,
      started,
      exitCode: 1,
      status: "failed",
      error,
      errorEnvelope: failure
    });
    await persistRoleResult({ roleId: args.roleId, context: args.runContext, execution, audit });
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
    await appendAuditRecord(args.runContext, audit);
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
      errorEnvelope: failure
    });
    await persistRoleResult({ roleId: args.roleId, context: args.runContext, execution, audit });
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
    await appendAuditRecord(args.runContext, audit);
    return result;
  }

  const selectableOutgoing = getSelectableOutgoingFlows(args.node);
  const allowedEvents = selectableOutgoing.map((item) => item.eventType);
  const roleDirs = args.runContext.roleDirsById.get(args.roleId);
  const existingSession = getRoleSession(args.runContext, sessionKey);

  let timeoutMs = 120000;
  let maxOutputBytes = 64 * 1024;
  let workdir = args.workdir;
  let env: Record<string, string> | undefined;
  let binding: ExecutorBinding | undefined;
  let modelId: string | undefined;
  let profileId: string | undefined;
  let toolRef: string | undefined;
  let command: string | undefined;
  let lastStdout: string | undefined;
  let bindingLabel = "noop";
  let promptInput!: RolePromptInput;
  let inputContextForAudit: string | undefined;
  let prompt = "";
  const logger = args.logger ?? createRunConsoleLogger(false);

  try {
    promptInput = buildRolePromptInput({
      roleId: args.roleId,
      node: args.node,
      branch: currentBranch,
      state: args.state,
      userProfile: args.userProfile
    });
    inputContextForAudit = sanitizeRoleInputContext(promptInput.context);

    if (rolePackage.inputSchema) {
      validateRoleInputSchema({
        input: promptInput,
        schema: rolePackage.inputSchema,
        schemaPath: rolePackage.inputSchemaPath,
        roleId: args.roleId
      });
    }

    prompt = renderRolePrompt({
      promptTemplate: rolePackage.promptTemplate,
      persona: rolePackage.persona,
      work: rolePackage.work,
      values: promptInput
    });

    if (args.node.binding.kind === "model") {
      const modelPackage = args.modelsById.get(args.node.binding.modelId);
      if (!modelPackage) {
        throw new Error(`Model package not loaded for model "${args.node.binding.modelId}"`);
      }
      modelId = modelPackage.manifest.modelId;
      timeoutMs = modelPackage.manifest.timeoutMs ?? timeoutMs;
      maxOutputBytes = modelPackage.manifest.maxOutputBytes ?? maxOutputBytes;
      workdir = roleDirs?.roleDir ?? args.workdir;
      env = {
        OGSYSTEM_RUN_DIR: args.runContext.runDir,
        OGSYSTEM_SHARED_DIR: args.runContext.sharedDir,
        OGSYSTEM_ROLE_DIR: roleDirs?.roleDir ?? workdir,
        OGSYSTEM_ROLE_ID: args.roleId,
        OGSYSTEM_MODEL_ID: modelPackage.manifest.modelId,
        OGSYSTEM_ALLOWED_EVENTS: allowedEvents.join(",")
      };
      binding = {
        kind: "model",
        modelPackage
      };
      bindingLabel = `model:${modelPackage.manifest.modelId}`;
    } else if (args.node.binding.kind === "profile") {
      const profile = args.profilesById.get(args.node.binding.profileId);
      if (!profile) {
        throw new Error(`Execution profile not found: ${args.node.binding.profileId}`);
      }
      const tool = args.toolsByRef.get(profile.toolRef);
      if (!tool) {
        throw new Error(`Tool not found: ${profile.toolRef}`);
      }
      if (args.effectiveLaw.forbiddenToolRefs.includes(profile.toolRef)) {
        throw new Error(`Tool is forbidden by effective law: ${profile.toolRef}`);
      }
      profileId = profile.profileId;
      toolRef = tool.toolRef;
      command = tool.command;
      timeoutMs = profile.timeoutMs ?? timeoutMs;
      maxOutputBytes = profile.maxOutputBytes ?? maxOutputBytes;
      binding = {
        kind: "profile",
        profile,
        tool
      };
      env = {
        OGSYSTEM_RUN_DIR: args.runContext.runDir,
        OGSYSTEM_SHARED_DIR: args.runContext.sharedDir,
        OGSYSTEM_ROLE_DIR: roleDirs?.roleDir ?? args.workdir,
        OGSYSTEM_ROLE_ID: args.roleId,
        OGSYSTEM_PROFILE_ID: profile.profileId,
        OGSYSTEM_TOOL_REF: tool.toolRef,
        OGSYSTEM_ALLOWED_EVENTS: allowedEvents.join(",")
      };
      bindingLabel = `profile:${profile.profileId}`;
    }

    logger.roleStart({
      roleId: args.roleId,
      branchId,
      loopIteration,
      binding: binding ? bindingLabel : "noop"
    });

    await persistRolePrelude({
      roleId: args.roleId,
      roleName: rolePackage.manifest.name ?? args.roleId,
      roleDescription: rolePackage.manifest.description ?? "",
      prompt,
      allowedEvents,
      modelId,
      resolvedRolePath: rolePackage.resolvedPath,
      preferredModelTags: rolePackage.manifest.preferredModelTags,
      sharedDir: args.runContext.sharedDir,
      privateDir: roleDirs?.privateDir ?? "",
      execution,
        roleInputProjection: {
          role_id: args.roleId,
          task: args.state.userPrompt,
          context: promptInput.context,
          allowed_events: allowedEvents,
          last_output: promptInput.last_output,
          system_notes: promptInput.system_notes,
        round: loopIteration,
        user_profile: args.userProfile ?? {}
      },
      context: args.runContext
    });

    if (!binding) {
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
        status: "noop"
      });
      await persistRoleResult({ roleId: args.roleId, context: args.runContext, execution, audit });
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
      await appendAuditRecord(args.runContext, audit);
      return result;
    }

    const executionResult = await args.executor.execute({
      roleId: args.roleId,
      sessionKey,
      prompt,
      schema: rolePackage.outputSchema,
      binding,
      workdir,
      env,
      timeoutMs,
      maxOutputBytes,
      dryRunOutputEvent: pickDryRunEvent({
        node: args.node,
        branch: currentBranch,
        state: args.state,
        plan: args.plan
      }),
      sessionId: existingSession?.sessionId
    });
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
      joinId: args.node.joinMode ? buildJoinId(args.roleId, loopIteration) : undefined,
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
      repair
    });

    if (executionResult.sessionId) {
      await persistRoleSession({
        context: args.runContext,
        roleId: args.roleId,
        execution,
        sessionId: executionResult.sessionId,
        messageId: executionResult.messageId
      });
    }
    await persistRoleResult({
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
    await appendAuditRecord(args.runContext, audit);
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
      schemaPath: rolePackage?.outputSchemaPath
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
      repair,
      correctionRequest,
      inputContext: inputContextForAudit
    });
    if (executionError?.sessionId) {
      await persistRoleSession({
        context: args.runContext,
        roleId: args.roleId,
        execution,
        sessionId: executionError.sessionId,
        messageId: executionError.messageId
      });
    }
    await persistRoleResult({ roleId: args.roleId, context: args.runContext, execution, audit });
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
    await appendAuditRecord(args.runContext, audit);
    return result;
  }
}
