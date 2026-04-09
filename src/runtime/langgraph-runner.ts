// @ts-nocheck
import { appendFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { END, START, ReducedValue, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";

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
import {
  type OpencodeRunClient,
  OpencodeExecutionError,
  executeOpencodeModelRole
} from "./opencode-executor.js";
import { projectStages } from "./stage-projector.js";
import { runCliTool, ToolExecutionError } from "./tool-runner.js";
import {
  buildAdjacency,
  buildIncoming,
  parseRoleExecutionOutput,
  preview,
  renderUserProfile,
  stringifyJson
} from "./runtime-support.js";
import { SYSTEM_END_ROLE_ID } from "./types.js";
import type {
  AdapterRunResult,
  AuditRecord,
  BranchRecord,
  CliTool,
  EffectiveLawConstraints,
  ExecutionProfile,
  Flow,
  LoadedModelPackage,
  LoadedRolePackage,
  RoleExecutionOutput,
  RunContext,
  RuntimeConfig,
  StoredRoleResult,
  SystemDefinition,
  UserProfile
} from "./types.js";

type RunnerInput = {
  system: SystemDefinition;
  effectiveLaw: EffectiveLawConstraints;
  profilesById: Map<string, ExecutionProfile>;
  toolsByRef: Map<string, CliTool>;
  modelsById: Map<string, LoadedModelPackage>;
  runtimeConfig: RuntimeConfig;
  userProfile?: UserProfile;
  workdir: string;
  rolePackagesByRoleId: Map<string, LoadedRolePackage>;
  runContext: RunContext;
  opencodeRun?: OpencodeRunClient;
  prompt: string;
  dryRun?: boolean;
  initialState?: LangGraphState;
};

type LangGraphState = {
  userPrompt: string;
  status: "running" | "done" | "failed";
  error: string;
  transitionCount: number;
  auditTrail: AuditRecord[];
  roleResults: Record<string, StoredRoleResult>;
  branchRecords: Record<string, BranchRecord>;
  loopIterations: Record<string, number>;
  selectedEventByRoleId: Record<string, string>;
  finalOutput: string;
  finalRoleId: string;
  lastExecutedRoleId: string;
};


function mergeStatus(
  current: LangGraphState["status"],
  update: LangGraphState["status"]
): LangGraphState["status"] {
  if (current === "failed" || update === "failed") {
    return "failed";
  }
  if (current === "done" || update === "done") {
    return "done";
  }
  return update;
}

const LangGraphStateSchema = new StateSchema({
  userPrompt: z.string(),
  status: new ReducedValue(z.enum(["running", "done", "failed"]).default("running"), {
    inputSchema: z.enum(["running", "done", "failed"]),
    reducer: mergeStatus
  }),
  error: new ReducedValue(z.string().default(""), {
    inputSchema: z.string(),
    reducer: (current, update) => current || update
  }),
  transitionCount: new ReducedValue(z.number().default(0), {
    inputSchema: z.number(),
    reducer: (current, update) => current + update
  }),
  auditTrail: new ReducedValue(z.array(z.any()).default([]), {
    inputSchema: z.array(z.any()),
    reducer: (current, update) => current.concat(update)
  }),
  roleResults: new ReducedValue(z.record(z.string(), z.any()).default({}), {
    inputSchema: z.record(z.string(), z.any()),
    reducer: (current, update) => ({ ...current, ...update })
  }),
  branchRecords: new ReducedValue(z.record(z.string(), z.any()).default({}), {
    inputSchema: z.record(z.string(), z.any()),
    reducer: (current, update) => ({ ...current, ...update })
  }),
  loopIterations: new ReducedValue(z.record(z.string(), z.number()).default({}), {
    inputSchema: z.record(z.string(), z.number()),
    reducer: (current, update) => ({ ...current, ...update })
  }),
  selectedEventByRoleId: new ReducedValue(z.record(z.string(), z.string()).default({}), {
    inputSchema: z.record(z.string(), z.string()),
    reducer: (current, update) => ({ ...current, ...update })
  }),
  finalOutput: new ReducedValue(z.string().default(""), {
    inputSchema: z.string(),
    reducer: (current, update) => update || current
  }),
  finalRoleId: new ReducedValue(z.string().default(""), {
    inputSchema: z.string(),
    reducer: (current, update) => update || current
  }),
  lastExecutedRoleId: new ReducedValue(z.string().default(""), {
    inputSchema: z.string(),
    reducer: (_current, update) => update
  })
});

function getOutgoingFlows(system: SystemDefinition, roleId: string): Flow[] {
  return system.flows.filter((flow) => flow.fromRoleId === roleId);
}

function findCurrentBranch(state: LangGraphState, roleId: string): BranchRecord | undefined {
  const branches = Object.values(state.branchRecords).filter(
    (branch) => branch.roleId === roleId && branch.status === "active"
  );
  branches.sort((left, right) => right.loopIteration - left.loopIteration);
  return branches[0];
}

function getDirectContext(state: LangGraphState, incoming: Flow[]): string {
  if (incoming.length !== 1) {
    return state.userPrompt;
  }
  const upstream = state.roleResults[incoming[0].fromRoleId];
  return upstream?.content ?? state.userPrompt;
}

function renderJoinContext(state: LangGraphState, joinSources: string[]): string {
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

function resolvePromptInput(args: {
  roleId: string;
  state: LangGraphState;
  system: SystemDefinition;
  rolePackagesByRoleId: Map<string, LoadedRolePackage>;
  incomingByRole: Map<string, Flow[]>;
  userProfile?: UserProfile;
}): { prompt: string; allowedEvents: string[] } {
  const rolePackage = args.rolePackagesByRoleId.get(args.roleId);
  if (!rolePackage) {
    throw new Error(`Role package not loaded for role "${args.roleId}"`);
  }

  const outgoing = getOutgoingFlows(args.system, args.roleId);
  const allowedEvents = outgoing.map((item) => item.eventType);
  const joinSources = args.system.langGraph?.joinSourcesByRoleId[args.roleId] ?? [];
  const context =
    joinSources.length > 0
      ? renderJoinContext(args.state, joinSources)
      : getDirectContext(args.state, args.incomingByRole.get(args.roleId) ?? []);
  const currentLoop =
    findCurrentBranch(args.state, args.roleId)?.loopIteration ??
    args.state.loopIterations[args.roleId] ??
    1;

  const values = {
    task: args.state.userPrompt,
    context,
    allowed_events: JSON.stringify(allowedEvents),
    last_output: context,
    system_notes: "",
    round: String(currentLoop),
    user_profile: renderUserProfile(args.userProfile)
  };

  if (rolePackage.inputSchema) {
    validateRoleInputSchema({
      input: values,
      schema: rolePackage.inputSchema,
      roleId: args.roleId
    });
  }

  return {
    prompt: renderRolePrompt({
      promptTemplate: rolePackage.promptTemplate,
      persona: rolePackage.persona,
      work: rolePackage.work,
      values
    }),
    allowedEvents
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
    error: args.error
  };
}

function getTargetLoopIteration(args: {
  targetRoleId: string;
  currentLoopIteration: number;
  state: LangGraphState;
  system: SystemDefinition;
}): number {
  if (args.system.langGraph?.loopMaxByRoleId[args.targetRoleId] !== undefined) {
    return (args.state.loopIterations[args.targetRoleId] ?? 0) + 1;
  }
  return args.currentLoopIteration;
}

function wouldExceedLoopBudget(args: {
  targetRoleId: string;
  currentLoopIteration: number;
  state: LangGraphState;
  system: SystemDefinition;
}): boolean {
  const max = args.system.langGraph?.loopMaxByRoleId[args.targetRoleId];
  if (max === undefined) {
    return false;
  }
  return getTargetLoopIteration(args) > max;
}

function pickDryRunEvent(args: {
  roleId: string;
  outgoing: Flow[];
  state: LangGraphState;
  system: SystemDefinition;
}): string | undefined {
  if (args.system.langGraph?.routingModeByRoleId[args.roleId] === "parallel_split") {
    return undefined;
  }
  if (args.outgoing.length === 0) {
    return undefined;
  }
  if (args.outgoing.length === 1) {
    return args.outgoing[0].eventType;
  }
  const allowed = args.outgoing.find(
    (flow) =>
      flow.toRoleId === SYSTEM_END_ROLE_ID ||
      !wouldExceedLoopBudget({
        targetRoleId: flow.toRoleId,
        currentLoopIteration:
          findCurrentBranch(args.state, args.roleId)?.loopIteration ??
          args.state.loopIterations[args.roleId] ??
          1,
        state: args.state,
        system: args.system
      })
  );
  return allowed?.eventType ?? args.outgoing[0].eventType;
}

function buildBranchId(roleId: string, loopIteration: number): string {
  return `${roleId}@${loopIteration}`;
}

function normalizeSelectedEvent(args: {
  roleId: string;
  output: RoleExecutionOutput;
  outgoing: Flow[];
  system: SystemDefinition;
}): string | undefined {
  if (args.system.langGraph?.routingModeByRoleId[args.roleId] === "parallel_split") {
    return args.output.event;
  }
  return args.output.event;
}

function allJoinSourcesReady(args: {
  joinRoleId: string;
  currentRoleId: string;
  loopIteration: number;
  state: LangGraphState;
  system: SystemDefinition;
}): boolean {
  const sources = args.system.langGraph?.joinSourcesByRoleId[args.joinRoleId] ?? [];
  for (const sourceRoleId of sources) {
    if (sourceRoleId === args.currentRoleId) {
      continue;
    }
    const result = args.state.roleResults[sourceRoleId];
    if (!result || result.loopIteration !== args.loopIteration) {
      return false;
    }
  }
  return true;
}

function projectStateSnapshot(args: {
  state: LangGraphState;
  system: SystemDefinition;
}): Record<string, unknown> {
  const branches = Object.values(args.state.branchRecords);
  const activeBranches = branches.filter((branch) => branch.status === "active");
  const completedBranches = branches.filter((branch) => branch.status === "completed");
  const pendingJoinRoleIds = activeBranches
    .map((branch) => branch.roleId)
    .filter((roleId) => args.system.langGraph?.joinModeByRoleId[roleId] === "all_of");

  return {
    status: args.state.status,
    currentRoleId: args.state.finalRoleId || args.state.lastExecutedRoleId || args.system.entryRoleId,
    nextRoleId: activeBranches.length === 1 ? activeBranches[0].roleId : undefined,
    finalRoleId: args.state.finalRoleId || undefined,
    transitionCount: args.state.transitionCount,
    lastOutput: args.state.finalOutput || undefined,
    error: args.state.error || undefined,
    activeBranches,
    completedBranches,
    pendingJoinRoleIds,
    loopIterations: args.state.loopIterations,
    roleResults: args.state.roleResults,
    graphState: args.state
  };
}

async function persistProjectedState(args: {
  state: LangGraphState;
  system: SystemDefinition;
  runContext: RunContext;
}): Promise<void> {
  await writeFile(args.runContext.statePath, stringifyJson(projectStateSnapshot(args)), "utf8");
}

function createInitialState(system: SystemDefinition, prompt: string): LangGraphState {
  return {
    userPrompt: prompt,
    status: "running",
    error: "",
    transitionCount: 0,
    auditTrail: [],
    roleResults: {},
    branchRecords: {
      [buildBranchId(system.entryRoleId, 1)]: {
        branchId: buildBranchId(system.entryRoleId, 1),
        roleId: system.entryRoleId,
        loopIteration: 1,
        status: "active"
      }
    },
    loopIterations: {
      [system.entryRoleId]: 1
    },
    selectedEventByRoleId: {},
    finalOutput: "",
    finalRoleId: "",
    lastExecutedRoleId: ""
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

export async function runSystemWithLangGraph(args: RunnerInput): Promise<AdapterRunResult> {
  const system = args.system;
  const adjacency = buildAdjacency(system.flows);
  const incomingByRole = buildIncoming(system.flows);
  const roleIdsInOrder = system.roleIds;

  const graphBuilder = new StateGraph(LangGraphStateSchema);

  for (const roleId of roleIdsInOrder) {
    graphBuilder.addNode(roleId, async (state: LangGraphState) => {
      const outgoing = adjacency.get(roleId) ?? [];
      const currentBranch = findCurrentBranch(state, roleId);
      const loopIteration = currentBranch?.loopIteration ?? state.loopIterations[roleId] ?? 1;
      const branchId = currentBranch?.branchId ?? buildBranchId(roleId, loopIteration);
      const started = Date.now();
      const nextTransitionCount = state.transitionCount + 1;
      const lawRef = system.lawBinding.globalLawRef;
      const maxTransitions = args.effectiveLaw.maxTransitions;
      const isParallelSplit = system.langGraph?.routingModeByRoleId[roleId] === "parallel_split";
      const rolePackage = args.rolePackagesByRoleId.get(roleId);
      const modelId = system.modelBinding[roleId] ?? system.executionBinding[roleId];
      const legacyProfileRef = system.executionBinding[roleId];
      const execution = allocateRoleExecution({
        context: args.runContext,
        roleId,
        branchId,
        loopIteration
      });

      if (maxTransitions !== undefined && nextTransitionCount > maxTransitions) {
        const error = `Transition budget exceeded: ${nextTransitionCount} > ${maxTransitions}`;
        const audit = makeAuditRecord({
          roleId,
          branchId,
          loopIteration,
          lawRef,
          started,
          modelId,
          exitCode: 1,
          status: "failed",
          error
        });
        await persistRoleResult({ roleId, context: args.runContext, execution, audit });
        await appendAuditFiles(args.runContext, audit);
        return {
          status: "failed",
          error,
          transitionCount: 1,
          auditTrail: [audit],
          finalRoleId: roleId,
          lastExecutedRoleId: roleId,
          branchRecords: {
            [branchId]: { branchId, roleId, loopIteration, status: "completed" }
          }
        };
      }

      const { prompt, allowedEvents } = resolvePromptInput({
        roleId,
        state,
        system,
        rolePackagesByRoleId: args.rolePackagesByRoleId,
        incomingByRole,
        userProfile: args.userProfile
      });

      await persistRolePrelude({
        roleId,
        roleName: rolePackage?.manifest.name ?? roleId,
        roleDescription: rolePackage?.manifest.description ?? "",
        prompt,
        allowedEvents,
        modelId,
        resolvedRolePath: rolePackage?.resolvedPath,
        preferredModelTags: rolePackage?.manifest.preferredModelTags,
        sharedDir: args.runContext.sharedDir,
        privateDir: args.runContext.roleDirsById.get(roleId)?.privateDir ?? "",
        execution,
        roleInputProjection: {
          role_id: roleId,
          task: state.userPrompt,
          allowed_events: allowedEvents,
          round: loopIteration,
          user_profile: args.userProfile ?? {}
        },
        context: args.runContext
      });

      let tool: CliTool | undefined;
      let effectiveModelId: string | undefined = modelId;
      let effectiveProfileId: string | undefined;
      let executionWorkdir = args.workdir;
      let executionEnv: Record<string, string> | undefined;
      let timeoutMs = 120000;
      let maxOutputBytes = 64 * 1024;
      let auditCommand: string | undefined;
      const existingSession = getRoleSession(args.runContext, roleId);

      try {
        if (modelId && args.modelsById.has(modelId)) {
        const modelPackage = args.modelsById.get(modelId);
        if (!modelPackage) {
          throw new Error(`Model package not loaded for model "${modelId}"`);
        }
        timeoutMs = modelPackage.manifest.timeoutMs ?? timeoutMs;
        maxOutputBytes = modelPackage.manifest.maxOutputBytes ?? maxOutputBytes;
        const roleDirs = args.runContext.roleDirsById.get(roleId);
        executionWorkdir = roleDirs?.roleDir ?? args.workdir;
        executionEnv = {
          OGSYSTEM_RUN_DIR: args.runContext.runDir,
          OGSYSTEM_SHARED_DIR: args.runContext.sharedDir,
          OGSYSTEM_ROLE_DIR: roleDirs?.roleDir ?? executionWorkdir,
          OGSYSTEM_ROLE_ID: roleId,
          OGSYSTEM_MODEL_ID: modelPackage.manifest.modelId,
          OGSYSTEM_ALLOWED_EVENTS: allowedEvents.join(",")
        };
        auditCommand = "opencode-sdk";
        tool = {
          toolRef: `model.${modelPackage.manifest.modelId}`,
          runner: "local_shell",
          command: auditCommand,
          argsTemplate: [],
          stdinMode: "none"
        };
      } else {
        effectiveModelId = undefined;
        effectiveProfileId = legacyProfileRef;
        if (!effectiveProfileId) {
          if (!args.effectiveLaw.allowNoopWithoutExecutionBinding) {
            const error = `Role "${roleId}" has no execution binding`;
            const audit = makeAuditRecord({
              roleId,
              branchId,
              loopIteration,
              lawRef,
              started,
              exitCode: 1,
              status: "failed",
              error
            });
            await persistRoleResult({ roleId, context: args.runContext, execution, audit });
            await appendAuditFiles(args.runContext, audit);
            return {
              status: "failed",
              error,
              transitionCount: 1,
              auditTrail: [audit],
              finalRoleId: roleId,
              lastExecutedRoleId: roleId,
              branchRecords: {
                [branchId]: { branchId, roleId, loopIteration, status: "completed" }
              }
            };
          }

          if (outgoing.length > 1) {
            const error = `Role "${roleId}" cannot use explicit noop mode with multiple outgoing flows`;
            const audit = makeAuditRecord({
              roleId,
              branchId,
              loopIteration,
              lawRef,
              started,
              exitCode: 1,
              status: "failed",
              error
            });
            await persistRoleResult({ roleId, context: args.runContext, execution, audit });
            await appendAuditFiles(args.runContext, audit);
            return {
              status: "failed",
              error,
              transitionCount: 1,
              auditTrail: [audit],
              finalRoleId: roleId,
              lastExecutedRoleId: roleId,
              branchRecords: {
                [branchId]: { branchId, roleId, loopIteration, status: "completed" }
              }
            };
          }

          const selectedToRoleId = outgoing[0]?.toRoleId;
          const selectedEvent = outgoing[0]?.eventType;
          const branchUpdates: Record<string, BranchRecord> = {
            [branchId]: { branchId, roleId, loopIteration, status: "completed" }
          };
          const loopUpdates: Record<string, number> = {};
          let finalStatus: LangGraphState["status"] = "running";
          let finalRoleId = "";
          let nextRoleIdForAudit: string | undefined;

          if (!selectedToRoleId || selectedToRoleId === SYSTEM_END_ROLE_ID) {
            finalStatus = "done";
            finalRoleId = roleId;
          } else {
            const nextLoopIteration = getTargetLoopIteration({
              targetRoleId: selectedToRoleId,
              currentLoopIteration: loopIteration,
              state,
              system
            });

            if (
              wouldExceedLoopBudget({
                targetRoleId: selectedToRoleId,
                currentLoopIteration: loopIteration,
                state,
                system
              })
            ) {
              const error = `Loop budget exceeded for ${selectedToRoleId}`;
              const audit = makeAuditRecord({
                roleId,
                branchId,
                loopIteration,
                lawRef,
                started,
                exitCode: 1,
                status: "failed",
                error
              });
              await persistRoleResult({ roleId, context: args.runContext, execution, audit });
              await appendAuditFiles(args.runContext, audit);
              return {
                status: "failed",
                error,
                transitionCount: 1,
                auditTrail: [audit],
                finalRoleId: roleId,
                lastExecutedRoleId: roleId,
                branchRecords: {
                  [branchId]: { branchId, roleId, loopIteration, status: "completed" }
                }
              };
            }

            loopUpdates[selectedToRoleId] = nextLoopIteration;
            const nextBranchId = buildBranchId(selectedToRoleId, nextLoopIteration);
            branchUpdates[nextBranchId] = {
              branchId: nextBranchId,
              roleId: selectedToRoleId,
              loopIteration: nextLoopIteration,
              status: "active"
            };
            nextRoleIdForAudit = selectedToRoleId;
          }

          const audit = makeAuditRecord({
            roleId,
            branchId,
            loopIteration,
            lawRef,
            started,
            exitCode: 0,
            selectedEvent,
            nextRoleId: nextRoleIdForAudit,
            status: "noop"
          });
          await persistRoleResult({ roleId, context: args.runContext, execution, audit });
          await appendAuditFiles(args.runContext, audit);
          return {
            status: finalStatus,
            transitionCount: 1,
            auditTrail: [audit],
            branchRecords: branchUpdates,
            loopIterations: loopUpdates,
            selectedEventByRoleId: selectedEvent ? { [roleId]: selectedEvent } : {},
            finalRoleId,
            lastExecutedRoleId: roleId,
            finalOutput: ""
          };
        }

        const profile = args.profilesById.get(effectiveProfileId);
        if (!profile) {
          throw new Error(`Execution profile not found: ${effectiveProfileId}`);
        }
        const legacyTool = args.toolsByRef.get(profile.toolRef);
        if (!legacyTool) {
          throw new Error(`Tool not found: ${profile.toolRef}`);
        }
        if (args.effectiveLaw.forbiddenToolRefs.includes(profile.toolRef)) {
          throw new Error(`Tool is forbidden by effective law: ${profile.toolRef}`);
        }
        tool = legacyTool;
        auditCommand = tool.command;
        timeoutMs = profile.timeoutMs ?? timeoutMs;
        maxOutputBytes = profile.maxOutputBytes ?? maxOutputBytes;
      }

        if (modelId && args.modelsById.has(modelId) && !args.dryRun && !args.opencodeRun) {
          throw new Error(`OpenCode run server missing for model-bound role "${roleId}"`);
        }
        const result =
          modelId && args.modelsById.has(modelId) && !args.dryRun
            ? await executeOpencodeModelRole({
                roleId,
                prompt,
                schema: rolePackage?.outputSchema,
                modelPackage: args.modelsById.get(modelId)!,
                workdir: executionWorkdir,
                timeoutMs,
                maxOutputBytes,
                runClient: args.opencodeRun!,
                sessionId: existingSession?.sessionId
              })
            : await runCliTool({
                tool,
                vars: { prompt },
                env: executionEnv,
                workdir: executionWorkdir,
                timeoutMs,
                maxOutputBytes,
                dryRun: args.dryRun,
                dryRunOutput: {
                  event: pickDryRunEvent({ roleId, outgoing, state, system })
                }
              });
        const parsedOutput = parseRoleExecutionOutput(result.stdout, {
          requireEvent: outgoing.length > 0 && !isParallelSplit
        });
        if (rolePackage) {
          validateRoleOutputSchema({
            output: parsedOutput,
            schema: rolePackage.outputSchema,
            roleId
          });
        }

        const selectedEvent = normalizeSelectedEvent({
          roleId,
          output: parsedOutput,
          outgoing,
          system
        });
        if (!isParallelSplit && outgoing.length > 0 && !outgoing.find((flow) => flow.eventType === selectedEvent)) {
          throw new Error(
            `Executable role output event "${selectedEvent ?? ""}" does not match any outgoing flow on role "${roleId}"`
          );
        }

        const branchUpdates: Record<string, BranchRecord> = {
          [branchId]: { branchId, roleId, loopIteration, status: "completed" }
        };
        const loopUpdates: Record<string, number> = {
          [roleId]: loopIteration
        };
        let finalStatus: LangGraphState["status"] = "running";
        let finalError = "";
        let finalOutput = "";
        let finalRoleId = "";
        let nextRoleIdForAudit: string | undefined;

        const activatedTargets: string[] = [];
        const candidateTargets = isParallelSplit
          ? outgoing.map((flow) => flow.toRoleId)
          : outgoing
              .filter((flow) => flow.eventType === selectedEvent)
              .map((flow) => flow.toRoleId);

        for (const targetRoleId of candidateTargets) {
          if (targetRoleId === SYSTEM_END_ROLE_ID) {
            finalStatus = "done";
            finalOutput = parsedOutput.content ?? "";
            finalRoleId = roleId;
            continue;
          }

          const nextLoopIteration = getTargetLoopIteration({
            targetRoleId,
            currentLoopIteration: loopIteration,
            state,
            system
          });

          if (
            wouldExceedLoopBudget({
              targetRoleId,
              currentLoopIteration: loopIteration,
              state,
              system
            })
          ) {
            finalStatus = "failed";
            finalError = `Loop budget exceeded for ${targetRoleId}`;
            finalRoleId = roleId;
            break;
          }

          loopUpdates[targetRoleId] = nextLoopIteration;
          const joinMode = system.langGraph?.joinModeByRoleId[targetRoleId];
          if (joinMode === "all_of") {
            if (
              allJoinSourcesReady({
                joinRoleId: targetRoleId,
                currentRoleId: roleId,
                loopIteration,
                state: {
                  ...state,
                  roleResults: {
                    ...state.roleResults,
                    [roleId]: {
                      roleId,
                      event: parsedOutput.event,
                      content: parsedOutput.content,
                      data: parsedOutput.data,
                      branchId,
                      loopIteration
                    }
                  }
                },
                system
              })
            ) {
              const nextBranchId = buildBranchId(targetRoleId, nextLoopIteration);
              branchUpdates[nextBranchId] = {
                branchId: nextBranchId,
                roleId: targetRoleId,
                loopIteration: nextLoopIteration,
                status: "active"
              };
              activatedTargets.push(targetRoleId);
            }
            continue;
          }

          const nextBranchId = buildBranchId(targetRoleId, nextLoopIteration);
          branchUpdates[nextBranchId] = {
            branchId: nextBranchId,
            roleId: targetRoleId,
            loopIteration: nextLoopIteration,
            status: "active"
          };
          activatedTargets.push(targetRoleId);
        }

        nextRoleIdForAudit = activatedTargets.length === 1 ? activatedTargets[0] : undefined;

        const audit = makeAuditRecord({
          roleId,
          branchId,
          joinId:
            system.langGraph?.joinModeByRoleId[roleId] === "all_of" ? `${roleId}@${loopIteration}` : undefined,
          loopIteration,
          lawRef,
          started,
          modelId: effectiveModelId,
          profileId: effectiveProfileId,
          toolRef: tool?.toolRef,
          command: auditCommand,
          resultArgs: result.args,
          sessionId: result.sessionId,
          messageId: result.messageId,
          serverPid: result.serverPid,
          exitCode: result.exitCode,
          selectedEvent,
          nextRoleId: nextRoleIdForAudit,
          status: finalStatus === "failed" ? "failed" : "ok",
          stdout: result.stdout,
          stderr: result.stderr,
          error: finalError || undefined
        });

        if (result.sessionId) {
          await persistRoleSession({
            context: args.runContext,
            roleId,
            execution,
            sessionId: result.sessionId,
            messageId: result.messageId
          });
        }
        await persistRoleResult({
          roleId,
          context: args.runContext,
          execution,
          output: parsedOutput,
          audit
        });
        await appendAuditFiles(args.runContext, audit);

        return {
          status: finalStatus,
          error: finalError,
          transitionCount: 1,
          auditTrail: [audit],
          roleResults: {
            [roleId]: {
              roleId,
              event: parsedOutput.event,
              content: parsedOutput.content,
              data: parsedOutput.data,
              branchId,
              loopIteration
            }
          },
          branchRecords: branchUpdates,
          loopIterations: loopUpdates,
          selectedEventByRoleId: selectedEvent ? { [roleId]: selectedEvent } : {},
          finalOutput,
          finalRoleId,
          lastExecutedRoleId: roleId
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const category = error instanceof ToolExecutionError ? ` (${error.category})` : "";
        const executionError =
          error instanceof OpencodeExecutionError ? error.details : undefined;
        const audit = makeAuditRecord({
          roleId,
          branchId,
          loopIteration,
          lawRef,
          started,
          modelId: effectiveModelId,
          profileId: effectiveProfileId,
          toolRef: tool?.toolRef,
          command: auditCommand,
          resultArgs: executionError?.args,
          sessionId: executionError?.sessionId,
          messageId: executionError?.messageId,
          serverPid: executionError?.serverPid,
          exitCode: 1,
          status: "failed",
          stdout: executionError?.stdout,
          stderr: executionError?.stderr,
          error: `${message}${category}`
        });
        if (executionError?.sessionId) {
          await persistRoleSession({
            context: args.runContext,
            roleId,
            execution,
            sessionId: executionError.sessionId,
            messageId: executionError.messageId
          });
        }
        await persistRoleResult({ roleId, context: args.runContext, execution, audit });
        await appendAuditFiles(args.runContext, audit);
        return {
          status: "failed",
          error: `${message}${category}`,
          transitionCount: 1,
          auditTrail: [audit],
          finalRoleId: roleId,
          lastExecutedRoleId: roleId,
          branchRecords: {
            [branchId]: { branchId, roleId, loopIteration, status: "completed" }
          }
        };
      }
    });
  }

  graphBuilder.addConditionalEdges(START, (state: LangGraphState) => {
    if (state.status !== "running") {
      return END;
    }
    const activeRoles = Object.values(state.branchRecords)
      .filter((branch) => branch.status === "active")
      .map((branch) => branch.roleId);
    if (activeRoles.length === 0) {
      return END;
    }
    return Array.from(new Set(activeRoles));
  });

  for (const roleId of roleIdsInOrder) {
    const outgoing = adjacency.get(roleId) ?? [];
    const joinSources = system.langGraph?.joinSourcesByRoleId[roleId];
    if (joinSources?.length) {
      graphBuilder.addEdge(joinSources, roleId);
    }

    if (system.langGraph?.routingModeByRoleId[roleId] === "parallel_split") {
      for (const flow of outgoing) {
        if (flow.toRoleId === SYSTEM_END_ROLE_ID) {
          graphBuilder.addEdge(roleId, END);
          continue;
        }
        if (system.langGraph?.joinModeByRoleId[flow.toRoleId] === "all_of") {
          continue;
        }
        graphBuilder.addEdge(roleId, flow.toRoleId);
      }
      continue;
    }

    if (outgoing.length === 0) {
      graphBuilder.addEdge(roleId, END);
      continue;
    }

    if (outgoing.length === 1) {
      const onlyFlow = outgoing[0];
      if (onlyFlow.toRoleId === SYSTEM_END_ROLE_ID) {
        graphBuilder.addEdge(roleId, END);
      } else if (system.langGraph?.joinModeByRoleId[onlyFlow.toRoleId] !== "all_of") {
        graphBuilder.addEdge(roleId, onlyFlow.toRoleId);
      }
      continue;
    }

    graphBuilder.addConditionalEdges(roleId, (state: LangGraphState) => {
      if (state.status !== "running") {
        return END;
      }
      const selectedEvent = state.selectedEventByRoleId[roleId];
      const selectedFlow = outgoing.find((flow) => flow.eventType === selectedEvent);
      if (!selectedFlow) {
        return END;
      }
      if (selectedFlow.toRoleId === SYSTEM_END_ROLE_ID) {
        return END;
      }
      return selectedFlow.toRoleId;
    });
  }

  const graph = graphBuilder.compile();
  let finalState = args.initialState ?? createInitialState(system, args.prompt);
  await persistProjectedState({ state: finalState, system, runContext: args.runContext });

  const recursionLimit = (args.effectiveLaw.maxTransitions ?? 100) + 20;
  const stream = await graph.stream(finalState, {
    streamMode: "values",
    recursionLimit
  });

  for await (const chunk of stream) {
    finalState = chunk as LangGraphState;
    await persistProjectedState({ state: finalState, system, runContext: args.runContext });
  }

  if (finalState.status === "running") {
    finalState = {
      ...finalState,
      status: "done"
    };
    await persistProjectedState({ state: finalState, system, runContext: args.runContext });
  }

  const auditTrail = finalState.auditTrail;
  const stages = projectStages({ auditTrail });
  await writeFile(
    resolve(args.runContext.auditDir, "summary.md"),
    [
      "# Audit Summary",
      "",
      `- runId: ${args.runContext.runId}`,
      `- status: ${finalState.status}`,
      `- finalRoleId: ${finalState.finalRoleId}`,
      `- transitionCount: ${finalState.transitionCount}`,
      `- opencodeServerUrl: ${args.opencodeRun?.url ?? ""}`,
      `- opencodeServerPid: ${args.opencodeRun?.pid ?? ""}`,
      `- opencodeServerStartedAt: ${args.opencodeRun?.startedAt ?? ""}`
    ].join("\n"),
    "utf8"
  );

  return {
    systemId: system.systemId,
    systemVersion: system.systemVersion,
    lawRef: system.lawBinding.globalLawRef,
    status: finalState.status === "failed" ? "failed" : "done",
    finalRoleId: finalState.finalRoleId || undefined,
    finalOutput: finalState.finalOutput || undefined,
    systemState: {
      status: finalState.status,
      currentRoleId: finalState.finalRoleId || finalState.lastExecutedRoleId || system.entryRoleId,
      nextRoleId: undefined,
      finalRoleId: finalState.finalRoleId || undefined,
      transitionCount: finalState.transitionCount,
      lastOutput: finalState.finalOutput || undefined,
      error: finalState.error || undefined
    },
    stages,
    auditTrail,
    error: finalState.error || undefined
  };
}
