import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Executor, ExecutorBinding } from "./executor.js";
import { getExecutionPlanNode } from "./execution-plan.js";
import { OpencodeExecutionError } from "./opencode-executor.js";
import {
  allocateRoleExecution,
  appendEvent,
  getRoleSession,
  persistRolePrelude,
  persistRoleResult,
  persistRoleSession
} from "./run-artifacts.js";
import {
  renderRolePrompt,
  validateRoleInputSchema,
  validateRoleOutputSchema
} from "./role-repo.js";
import { preview, renderUserProfile, stringifyJson } from "./runtime-support.js";
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
  GraphState,
  LoadedModelPackage,
  LoadedRolePackage,
  RoleExecutionOutput,
  RoleOutputRepairRecord,
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
      branchId: string;
      loopIteration: number;
    }
  | {
      status: "failed";
      error: string;
      audit: AuditRecord;
      branchId: string;
      loopIteration: number;
    };

function buildBranchId(roleId: string, loopIteration: number): string {
  return `${roleId}@${loopIteration}`;
}

export function findCurrentBranch(state: GraphState, roleId: string): BranchRecord | undefined {
  const branches = Object.values(state.branchRecords).filter(
    (branch) => branch.roleId === roleId && branch.status === "active"
  );
  branches.sort((left, right) => right.loopIteration - left.loopIteration);
  return branches[0];
}

function getDirectContext(state: GraphState, node: ExecutionPlanNode): string {
  if (node.incoming.length !== 1) {
    return state.userPrompt;
  }
  const upstream = state.roleResults[node.incoming[0].fromRoleId];
  return upstream?.content ?? state.userPrompt;
}

function renderJoinContext(state: GraphState, joinSources: string[]): string {
  const sections = joinSources.map((sourceRoleId) => {
    const result = state.roleResults[sourceRoleId];
    return [
      `## ${sourceRoleId}`,
      result?.content ?? "",
      result?.data ? stringifyJson(result.data) : ""
    ]
      .filter(Boolean)
      .join("\n");
  });
  return sections.join("\n\n").trim() || state.userPrompt;
}

function buildRolePromptInput(args: {
  roleId: string;
  node: ExecutionPlanNode;
  state: GraphState;
  userProfile?: UserProfile;
}): RolePromptInput {
  const allowedEvents = args.node.outgoing.map((item) => item.eventType);
  const context =
    args.node.joinSources.length > 0
      ? renderJoinContext(args.state, args.node.joinSources)
      : getDirectContext(args.state, args.node);
  const currentLoop =
    findCurrentBranch(args.state, args.roleId)?.loopIteration ??
    args.state.loopIterations[args.roleId] ??
    1;

  return {
    task: args.state.userPrompt,
    context,
    allowed_events: JSON.stringify(allowedEvents),
    last_output: context,
    system_notes: "",
    round: String(currentLoop),
    user_profile: renderUserProfile(args.userProfile)
  };
}

function makeAuditRecord(args: {
  roleId: string;
  branchId?: string;
  joinId?: string;
  loopIteration?: number;
  lawRef: string;
  started: number;
  status: AuditRecord["status"];
  modelId?: string;
  profileId?: string;
  toolRef?: string;
  command?: string;
  resultArgs?: string[];
  sessionId?: string;
  messageId?: string;
  serverPid?: number;
  exitCode: number;
  selectedEvent?: string;
  nextRoleId?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  repair?: RoleOutputRepairRecord;
}): AuditRecord {
  return {
    at: new Date().toISOString(),
    roleId: args.roleId,
    branchId: args.branchId,
    joinId: args.joinId,
    loopIteration: args.loopIteration,
    lawRef: args.lawRef,
    modelId: args.modelId,
    profileId: args.profileId,
    toolRef: args.toolRef,
    command: args.command,
    args: args.resultArgs,
    sessionId: args.sessionId,
    messageId: args.messageId,
    serverPid: args.serverPid,
    exitCode: args.exitCode,
    durationMs: Date.now() - args.started,
    selectedEvent: args.selectedEvent,
    nextRoleId: args.nextRoleId,
    status: args.status,
    stdoutPreview: preview(args.stdout ?? ""),
    stderrPreview: preview(args.stderr ?? ""),
    error: args.error,
    repair: args.repair
  };
}

async function appendAuditFiles(runContext: RunContext, audit: AuditRecord): Promise<void> {
  await appendEvent(runContext, { type: "audit", ...audit });
  await appendFile(
    resolve(runContext.auditDir, "transitions.md"),
    `- ${audit.roleId}: ${audit.status}${audit.selectedEvent ? ` (${audit.selectedEvent})` : ""}\n`,
    "utf8"
  );
}

function getTargetLoopIteration(args: {
  targetRoleId: string;
  currentLoopIteration: number;
  state: GraphState;
  plan: ExecutionPlan;
}): number {
  const targetNode = getExecutionPlanNode(args.plan, args.targetRoleId);
  if (targetNode.loopMax !== undefined) {
    return (args.state.loopIterations[args.targetRoleId] ?? 0) + 1;
  }
  return args.currentLoopIteration;
}

function wouldExceedLoopBudget(args: {
  targetRoleId: string;
  currentLoopIteration: number;
  state: GraphState;
  plan: ExecutionPlan;
}): boolean {
  const targetNode = getExecutionPlanNode(args.plan, args.targetRoleId);
  if (targetNode.loopMax === undefined) {
    return false;
  }
  return getTargetLoopIteration(args) > targetNode.loopMax;
}

function pickDryRunEvent(args: {
  roleId: string;
  node: ExecutionPlanNode;
  state: GraphState;
  plan: ExecutionPlan;
}): string | undefined {
  if (args.node.routingMode === "parallel_split") {
    return undefined;
  }
  if (args.node.outgoing.length === 0) {
    return undefined;
  }
  if (args.node.outgoing.length === 1) {
    return args.node.outgoing[0].eventType;
  }
  const allowed = args.node.outgoing.find(
    (flow) =>
      flow.toRoleId === SYSTEM_END_ROLE_ID ||
      !wouldExceedLoopBudget({
        targetRoleId: flow.toRoleId,
        currentLoopIteration:
          findCurrentBranch(args.state, args.roleId)?.loopIteration ??
          args.state.loopIterations[args.roleId] ??
          1,
        state: args.state,
        plan: args.plan
      })
  );
  return allowed?.eventType ?? args.node.outgoing[0].eventType;
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

export async function executeRoleNode(args: {
  roleId: string;
  node: ExecutionPlanNode;
  plan: ExecutionPlan;
  state: GraphState;
  effectiveLaw: EffectiveLawConstraints;
  profilesById: Map<string, ExecutionProfile>;
  toolsByRef: Map<string, CliTool>;
  modelsById: Map<string, LoadedModelPackage>;
  rolePackagesByRoleId: Map<string, LoadedRolePackage>;
  runContext: RunContext;
  executor: Executor;
  userProfile?: UserProfile;
  workdir: string;
}): Promise<RoleExecutorResult> {
  const currentBranch = findCurrentBranch(args.state, args.roleId);
  const loopIteration =
    currentBranch?.loopIteration ?? args.state.loopIterations[args.roleId] ?? 1;
  const branchId = currentBranch?.branchId ?? buildBranchId(args.roleId, loopIteration);
  const started = Date.now();
  const nextTransitionCount = args.state.transitionCount + 1;
  const lawRef = args.plan.lawBinding.globalLawRef;
  const rolePackage = args.rolePackagesByRoleId.get(args.roleId);
  const execution = allocateRoleExecution({
    context: args.runContext,
    roleId: args.roleId,
    branchId,
    loopIteration
  });
  const maxTransitions = args.effectiveLaw.maxTransitions;

  if (maxTransitions !== undefined && nextTransitionCount > maxTransitions) {
    const error = `Transition budget exceeded: ${nextTransitionCount} > ${maxTransitions}`;
    const audit = makeAuditRecord({
      roleId: args.roleId,
      branchId,
      loopIteration,
      lawRef,
      started,
      exitCode: 1,
      status: "failed",
      error
    });
    await persistRoleResult({ roleId: args.roleId, context: args.runContext, execution, audit });
    await appendAuditFiles(args.runContext, audit);
    return {
      status: "failed",
      error,
      audit,
      branchId,
      loopIteration
    };
  }

  if (!rolePackage) {
    const error = `Role package not loaded for role "${args.roleId}"`;
    const audit = makeAuditRecord({
      roleId: args.roleId,
      branchId,
      loopIteration,
      lawRef,
      started,
      exitCode: 1,
      status: "failed",
      error
    });
    await persistRoleResult({ roleId: args.roleId, context: args.runContext, execution, audit });
    await appendAuditFiles(args.runContext, audit);
    return {
      status: "failed",
      error,
      audit,
      branchId,
      loopIteration
    };
  }

  const promptInput = buildRolePromptInput({
    roleId: args.roleId,
    node: args.node,
    state: args.state,
    userProfile: args.userProfile
  });

  if (rolePackage.inputSchema) {
    validateRoleInputSchema({
      input: promptInput,
      schema: rolePackage.inputSchema,
      schemaPath: rolePackage.inputSchemaPath,
      roleId: args.roleId
    });
  }

  const prompt = renderRolePrompt({
    promptTemplate: rolePackage.promptTemplate,
    persona: rolePackage.persona,
    work: rolePackage.work,
    values: promptInput
  });
  const allowedEvents = args.node.outgoing.map((item) => item.eventType);
  const roleDirs = args.runContext.roleDirsById.get(args.roleId);
  const existingSession = getRoleSession(args.runContext, args.roleId);

  let timeoutMs = 120000;
  let maxOutputBytes = 64 * 1024;
  let workdir = args.workdir;
  let env: Record<string, string> | undefined;
  let binding: ExecutorBinding | undefined;
  let modelId: string | undefined;
  let profileId: string | undefined;
  let toolRef: string | undefined;
  let command: string | undefined;

  try {
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
    }

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
      if (!args.effectiveLaw.allowNoopWithoutExecutionBinding) {
        throw new Error(`Role "${args.roleId}" has no execution binding`);
      }
      if (args.node.outgoing.length > 1) {
        throw new Error(
          `Role "${args.roleId}" cannot use explicit noop mode with multiple outgoing flows`
        );
      }

      const selectedToRoleId = args.node.outgoing[0]?.toRoleId;
      const selectedEvent = args.node.outgoing[0]?.eventType;
      const audit = makeAuditRecord({
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
      await appendAuditFiles(args.runContext, audit);
      return {
        status: "noop",
        audit,
        selectedEvent,
        branchId,
        loopIteration
      };
    }

    const result = await args.executor.execute({
      roleId: args.roleId,
      prompt,
      schema: rolePackage.outputSchema,
      binding,
      workdir,
      env,
      timeoutMs,
      maxOutputBytes,
      dryRunOutputEvent: pickDryRunEvent({
        roleId: args.roleId,
        node: args.node,
        state: args.state,
        plan: args.plan
      }),
      sessionId: existingSession?.sessionId
    });

    const parsed = parseRoleExecutionOutputWithRepair({
      rawOutput: result.stdout,
      requireEvent: args.node.outgoing.length > 0 && args.node.routingMode !== "parallel_split"
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
      args.node.outgoing.length > 0 &&
      !args.node.outgoing.find((flow) => flow.eventType === selectedEvent)
    ) {
      throw new Error(
        `Executable role output event "${selectedEvent ?? ""}" does not match any outgoing flow on role "${args.roleId}"`
      );
    }

    const audit = makeAuditRecord({
      roleId: args.roleId,
      branchId,
      joinId: args.node.joinMode === "all_of" ? `${args.roleId}@${loopIteration}` : undefined,
      loopIteration,
      lawRef,
      started,
      modelId: result.modelId ?? modelId,
      profileId: result.profileId ?? profileId,
      toolRef: result.toolRef ?? toolRef,
      command: result.command ?? command,
      resultArgs: result.args,
      sessionId: result.sessionId,
      messageId: result.messageId,
      serverPid: result.serverPid,
      exitCode: result.exitCode,
      selectedEvent,
      status: "ok",
      stdout: result.stdout,
      stderr: result.stderr,
      repair
    });

    if (result.sessionId) {
      await persistRoleSession({
        context: args.runContext,
        roleId: args.roleId,
        execution,
        sessionId: result.sessionId,
        messageId: result.messageId
      });
    }
    await persistRoleResult({
      roleId: args.roleId,
      context: args.runContext,
      execution,
      output: parsed.output,
      audit
    });
    await appendAuditFiles(args.runContext, audit);

    return {
      status: "ok",
      audit,
      storedResult: {
        roleId: args.roleId,
        event: parsed.output.event,
        content: parsed.output.content,
        data: parsed.output.data,
        branchId,
        loopIteration
      },
      selectedEvent,
      branchId,
      loopIteration
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const category = error instanceof ToolExecutionError ? ` (${error.category})` : "";
    const executionError = error instanceof OpencodeExecutionError ? error.details : undefined;
    const repair =
      typeof error === "object" &&
      error !== null &&
      "repair" in error &&
      typeof (error as { repair?: unknown }).repair === "object"
        ? ((error as { repair?: RoleOutputRepairRecord }).repair ?? undefined)
        : undefined;
    const audit = makeAuditRecord({
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
      repair
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
    await appendAuditFiles(args.runContext, audit);
    return {
      status: "failed",
      error: `${message}${category}`,
      audit,
      branchId,
      loopIteration
    };
  }
}
