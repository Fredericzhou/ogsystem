import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  validateLawsConfig,
  validateProfilesConfig,
  validateRuntimeConfig,
  validateToolsConfig,
  validateUserProfileConfig
} from "./config.js";
import { loadModelPackage } from "./model-repo.js";
import { loadSystemFromMermaid } from "./parse-mermaid.js";
import {
  allocateRoleExecution,
  appendEvent,
  getRoleSession,
  initializeRunContext,
  pathExists,
  persistRolePrelude,
  persistRoleResult,
  persistRoleSession,
  readJsonFile
} from "./run-artifacts.js";
import {
  loadRolePackage,
  renderRolePrompt,
  validateRoleInputSchema,
  validateRoleOutputSchema
} from "./role-repo.js";
import {
  buildAdjacency,
  parseRoleExecutionOutput,
  preview,
  renderUserProfile,
  stringifyJson
} from "./runtime-support.js";
import { runSystemWithLangGraph } from "./langgraph-runner.js";
import { projectStages } from "./stage-projector.js";
import {
  OpencodeExecutionError,
  type OpencodeRunClient,
  executeOpencodeModelRole,
  startOpencodeRunClient
} from "./opencode-executor.js";
import { runCliTool, ToolExecutionError } from "./tool-runner.js";
import { SYSTEM_END_ROLE_ID } from "./types.js";
import type {
  AdapterRunResult,
  AuditRecord,
  CliTool,
  EffectiveLawConstraints,
  ExecutionProfile,
  Flow,
  LawCatalog,
  LawSpec,
  LoadedModelPackage,
  LoadedRolePackage,
  RoleExecutionOutput,
  RoleExecutionRecord,
  RuntimeConfig,
  RunContext,
  SystemDefinition,
  UserProfile
} from "./types.js";

type RuntimeState = {
  currentRoleId: string;
  nextRoleId: string | null;
  status: "running" | "done" | "failed";
  userPrompt: string;
  lastOutput: string;
  transitionCount: number;
  auditTrail: AuditRecord[];
  error: string | null;
  finalRoleId: string | null;
};

type RuntimeInput = {
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
  dryRun?: boolean;
};

function buildRoleInputProjection(args: {
  roleId: string;
  state: RuntimeState;
  allowedEvents: string[];
  userProfile?: UserProfile;
}): Record<string, unknown> {
  return {
    role_id: args.roleId,
    task: args.state.userPrompt,
    context: args.state.userPrompt,
    allowed_events: args.allowedEvents,
    last_output: args.state.lastOutput,
    system_notes: "",
    round: args.state.transitionCount + 1,
    user_profile: args.userProfile ?? {}
  };
}

function mergeLawConstraints(base: EffectiveLawConstraints, spec?: LawSpec): EffectiveLawConstraints {
  if (!spec?.constraints) {
    return base;
  }

  const next: EffectiveLawConstraints = {
    forbiddenToolRefs: [...base.forbiddenToolRefs],
    maxTransitions: base.maxTransitions,
    allowNoopWithoutExecutionBinding: base.allowNoopWithoutExecutionBinding
  };

  if (spec.constraints.forbiddenToolRefs?.length) {
    next.forbiddenToolRefs = Array.from(
      new Set([...next.forbiddenToolRefs, ...spec.constraints.forbiddenToolRefs])
    );
  }

  const nextMaxTransitions = spec.constraints.maxTransitions;
  if (nextMaxTransitions !== undefined) {
    if (base.maxTransitions !== undefined && nextMaxTransitions > base.maxTransitions) {
      throw new Error(
        `Law merge violation on ${spec.lawId}: maxTransitions cannot be relaxed (${nextMaxTransitions} > ${base.maxTransitions})`
      );
    }
    next.maxTransitions = nextMaxTransitions;
  }

  const nextAllowNoop = spec.constraints.allowNoopWithoutExecutionBinding;
  if (nextAllowNoop !== undefined) {
    if (!base.allowNoopWithoutExecutionBinding && nextAllowNoop === true) {
      next.allowNoopWithoutExecutionBinding = true;
    }
    if (base.allowNoopWithoutExecutionBinding && nextAllowNoop === false) {
      throw new Error(
        `Law merge violation on ${spec.lawId}: allowNoopWithoutExecutionBinding cannot be relaxed`
      );
    }
  }

  return next;
}

export function resolveEffectiveLaw(
  system: SystemDefinition,
  lawCatalog?: LawCatalog
): EffectiveLawConstraints {
  const defaultConstraints: EffectiveLawConstraints = {
    forbiddenToolRefs: [],
    maxTransitions: undefined,
    allowNoopWithoutExecutionBinding: false
  };

  if (!lawCatalog) {
    return defaultConstraints;
  }

  const lawsById = new Map(lawCatalog.laws.map((item) => [item.lawId, item]));
  const globalLaw = lawsById.get(system.lawBinding.globalLawRef);
  if (!globalLaw) {
    throw new Error(`Global law not found in catalog: ${system.lawBinding.globalLawRef}`);
  }

  return mergeLawConstraints(defaultConstraints, globalLaw);
}

function findFlowByEvent(flows: Flow[], event: string): Flow | null {
  return flows.find((item) => item.eventType === event) ?? null;
}

function resolveRolePrompt(args: {
  roleId: string;
  state: RuntimeState;
  rolePackagesByRoleId: Map<string, LoadedRolePackage>;
  outgoingFlows: Flow[];
  userProfile?: UserProfile;
}): string {
  const rolePackage = args.rolePackagesByRoleId.get(args.roleId);
  if (!rolePackage) {
    throw new Error(`Role package not loaded for role "${args.roleId}"`);
  }

  const values = {
    task: args.state.userPrompt,
    context: args.state.userPrompt,
    allowed_events: JSON.stringify(args.outgoingFlows.map((item) => item.eventType)),
    last_output: args.state.lastOutput,
    system_notes: "",
    round: String(args.state.transitionCount + 1),
    user_profile: renderUserProfile(args.userProfile)
  };

  if (rolePackage.inputSchema) {
    validateRoleInputSchema({
      input: values,
      schema: rolePackage.inputSchema,
      roleId: args.roleId
    });
  }

  return renderRolePrompt({
    promptTemplate: rolePackage.promptTemplate,
    persona: rolePackage.persona,
    work: rolePackage.work,
    values
  });
}

function makeAuditRecord(args: {
  roleId: string;
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


async function executeRoleNode(args: {
  roleId: string;
  state: RuntimeState;
  context: RuntimeInput;
  adjacency: Map<string, Flow[]>;
}): Promise<Partial<RuntimeState>> {
  const started = Date.now();
  const nextTransitionCount = args.state.transitionCount + 1;
  const outgoing = args.adjacency.get(args.roleId) ?? [];
  const rolePackage = args.context.rolePackagesByRoleId.get(args.roleId);
  const modelId =
    args.context.system.modelBinding[args.roleId] ?? args.context.system.executionBinding[args.roleId];
  const legacyProfileRef = args.context.system.executionBinding[args.roleId];
  const maxTransitions = args.context.effectiveLaw.maxTransitions;
  const lawRef = args.context.system.lawBinding.globalLawRef;
  const execution = allocateRoleExecution({
    context: args.context.runContext,
    roleId: args.roleId
  });

  if (maxTransitions !== undefined && nextTransitionCount > maxTransitions) {
    const error = `Transition budget exceeded: ${nextTransitionCount} > ${maxTransitions}`;
    const audit = makeAuditRecord({
      roleId: args.roleId,
      lawRef,
      started,
      modelId,
      exitCode: 1,
      status: "failed",
      error
    });
    await persistRoleResult({
      roleId: args.roleId,
      context: args.context.runContext,
      execution,
      audit
    });
    return {
      currentRoleId: args.roleId,
      transitionCount: nextTransitionCount,
      status: "failed",
      error,
      finalRoleId: args.roleId,
      auditTrail: [audit]
    };
  }

  if (!modelId && !legacyProfileRef) {
    if (!args.context.effectiveLaw.allowNoopWithoutExecutionBinding) {
      const error = `Role "${args.roleId}" has no execution binding`;
      const audit = makeAuditRecord({
        roleId: args.roleId,
        lawRef,
        started,
        exitCode: 1,
        status: "failed",
        error
      });
      await persistRoleResult({
        roleId: args.roleId,
        context: args.context.runContext,
        execution,
        audit
      });
      return {
        currentRoleId: args.roleId,
        transitionCount: nextTransitionCount,
        status: "failed",
        error,
        finalRoleId: args.roleId,
        auditTrail: [audit]
      };
    }

    if (outgoing.length > 1) {
      const error = `Role "${args.roleId}" cannot use explicit noop mode with multiple outgoing flows`;
      const audit = makeAuditRecord({
        roleId: args.roleId,
        lawRef,
        started,
        exitCode: 1,
        status: "failed",
        error
      });
      await persistRoleResult({
        roleId: args.roleId,
        context: args.context.runContext,
        execution,
        audit
      });
      return {
        currentRoleId: args.roleId,
        transitionCount: nextTransitionCount,
        status: "failed",
        error,
        finalRoleId: args.roleId,
        auditTrail: [audit]
      };
    }

    const selectedToRoleId = outgoing[0]?.toRoleId;
    const nextRoleId = selectedToRoleId === SYSTEM_END_ROLE_ID ? null : selectedToRoleId ?? null;
    const status: RuntimeState["status"] = nextRoleId ? "running" : "done";

    const audit = makeAuditRecord({
      roleId: args.roleId,
      lawRef,
      started,
      exitCode: 0,
      selectedEvent: outgoing[0]?.eventType,
      nextRoleId: nextRoleId ?? undefined,
      status: "noop"
    });
    await persistRoleResult({
      roleId: args.roleId,
      context: args.context.runContext,
      execution,
      audit
    });
    return {
      currentRoleId: args.roleId,
      transitionCount: nextTransitionCount,
      nextRoleId,
      status,
      finalRoleId: status === "running" ? null : args.roleId,
      auditTrail: [audit]
    };
  }

  const prompt = resolveRolePrompt({
    roleId: args.roleId,
    state: args.state,
    rolePackagesByRoleId: args.context.rolePackagesByRoleId,
    outgoingFlows: outgoing,
    userProfile: args.context.userProfile
  });

  await persistRolePrelude({
    roleId: args.roleId,
    roleName: rolePackage?.manifest.name ?? args.roleId,
    roleDescription: rolePackage?.manifest.description ?? "",
    prompt,
    allowedEvents: outgoing.map((item) => item.eventType),
    modelId,
    resolvedRolePath: rolePackage?.resolvedPath,
    preferredModelTags: rolePackage?.manifest.preferredModelTags,
    sharedDir: args.context.runContext.sharedDir,
    privateDir: args.context.runContext.roleDirsById.get(args.roleId)?.privateDir ?? "",
    execution,
    roleInputProjection: buildRoleInputProjection({
      roleId: args.roleId,
      state: args.state,
      allowedEvents: outgoing.map((item) => item.eventType),
      userProfile: args.context.userProfile
    }),
    context: args.context.runContext
  });

  if (args.context.dryRun && outgoing.length > 1) {
    const error = `Dry-run requires an unambiguous single outgoing flow for role "${args.roleId}"`;
    const audit = makeAuditRecord({
      roleId: args.roleId,
      lawRef,
      started,
      modelId,
      exitCode: 1,
      status: "failed",
      error
    });
    await persistRoleResult({
      roleId: args.roleId,
      context: args.context.runContext,
      execution,
      audit
    });
    return {
      currentRoleId: args.roleId,
      transitionCount: nextTransitionCount,
      status: "failed",
      error,
      finalRoleId: args.roleId,
      auditTrail: [audit]
    };
  }

  let tool: CliTool;
  let effectiveModelId: string | undefined = modelId;
  let effectiveProfileId: string | undefined;
  let executionWorkdir = args.context.workdir;
  let executionEnv: Record<string, string> | undefined;
  let timeoutMs = 120000;
  let maxOutputBytes = 64 * 1024;
  let auditCommand: string | undefined;
  const existingSession = getRoleSession(args.context.runContext, args.roleId);

  if (modelId && args.context.modelsById.has(modelId)) {
    const modelPackage = args.context.modelsById.get(modelId);
    if (!modelPackage) {
      throw new Error(`Model package not loaded for model "${modelId}"`);
    }
    timeoutMs = modelPackage.manifest.timeoutMs ?? timeoutMs;
    maxOutputBytes = modelPackage.manifest.maxOutputBytes ?? maxOutputBytes;
    const roleDirs = args.context.runContext.roleDirsById.get(args.roleId);
    executionWorkdir = roleDirs?.roleDir ?? args.context.workdir;
    executionEnv = {
      OGSYSTEM_RUN_DIR: args.context.runContext.runDir,
      OGSYSTEM_SHARED_DIR: args.context.runContext.sharedDir,
      OGSYSTEM_ROLE_DIR: roleDirs?.roleDir ?? executionWorkdir,
      OGSYSTEM_ROLE_ID: args.roleId,
      OGSYSTEM_MODEL_ID: modelPackage.manifest.modelId,
      OGSYSTEM_ALLOWED_EVENTS: outgoing.map((item) => item.eventType).join(",")
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
      throw new Error(`Missing legacy execution profile for role "${args.roleId}"`);
    }
    const profile = args.context.profilesById.get(effectiveProfileId);
    if (!profile) {
      const error = `Execution profile not found: ${effectiveProfileId}`;
      const audit = makeAuditRecord({
        roleId: args.roleId,
        lawRef,
        started,
        profileId: effectiveProfileId,
        exitCode: 1,
        status: "failed",
        error
      });
      await persistRoleResult({
        roleId: args.roleId,
        context: args.context.runContext,
        execution,
        audit
      });
      return {
        currentRoleId: args.roleId,
        transitionCount: nextTransitionCount,
        status: "failed",
        error,
        finalRoleId: args.roleId,
        auditTrail: [audit]
      };
    }

    const legacyTool = args.context.toolsByRef.get(profile.toolRef);
    if (!legacyTool) {
      const error = `Tool not found: ${profile.toolRef}`;
      const audit = makeAuditRecord({
        roleId: args.roleId,
        lawRef,
        started,
        profileId: effectiveProfileId,
        toolRef: profile.toolRef,
        exitCode: 1,
        status: "failed",
        error
      });
      await persistRoleResult({
        roleId: args.roleId,
        context: args.context.runContext,
        execution,
        audit
      });
      return {
        currentRoleId: args.roleId,
        transitionCount: nextTransitionCount,
        status: "failed",
        error,
        finalRoleId: args.roleId,
        auditTrail: [audit]
      };
    }

    if (args.context.effectiveLaw.forbiddenToolRefs.includes(profile.toolRef)) {
      const error = `Tool is forbidden by effective law: ${profile.toolRef}`;
      const audit = makeAuditRecord({
        roleId: args.roleId,
        lawRef,
        started,
        profileId: effectiveProfileId,
        toolRef: profile.toolRef,
        exitCode: 1,
        status: "failed",
        error
      });
      await persistRoleResult({
        roleId: args.roleId,
        context: args.context.runContext,
        execution,
        audit
      });
      return {
        currentRoleId: args.roleId,
        transitionCount: nextTransitionCount,
        status: "failed",
        error,
        finalRoleId: args.roleId,
        auditTrail: [audit]
      };
    }

    tool = legacyTool;
    auditCommand = tool.command;
    timeoutMs = profile.timeoutMs ?? timeoutMs;
    maxOutputBytes = profile.maxOutputBytes ?? maxOutputBytes;
  }

  try {
    if (modelId && args.context.modelsById.has(modelId) && !args.context.dryRun && !args.context.opencodeRun) {
      throw new Error(`OpenCode run server missing for model-bound role "${args.roleId}"`);
    }
    const result: {
      exitCode: number;
      stdout: string;
      stderr: string;
      args: string[];
      sessionId?: string;
      messageId?: string;
      serverPid?: number;
    } =
      modelId && args.context.modelsById.has(modelId) && !args.context.dryRun
        ? await executeOpencodeModelRole({
            roleId: args.roleId,
            prompt,
            schema: rolePackage?.outputSchema,
            modelPackage: args.context.modelsById.get(modelId)!,
            workdir: executionWorkdir,
            timeoutMs,
            maxOutputBytes,
            runClient: args.context.opencodeRun!,
            sessionId: existingSession?.sessionId
          })
        : await runCliTool({
            tool,
            vars: { prompt },
            env: executionEnv,
            workdir: executionWorkdir,
            timeoutMs,
            maxOutputBytes,
            dryRun: args.context.dryRun,
            dryRunOutput: {
              event: outgoing.length === 1 ? outgoing[0].eventType : undefined
            }
          });
    const parsedOutput = parseRoleExecutionOutput(result.stdout, {
      requireEvent: outgoing.length > 0
    });
    if (rolePackage) {
      validateRoleOutputSchema({
        output: parsedOutput,
        schema: rolePackage.outputSchema,
        roleId: args.roleId
      });
    }
    const selectedFlow = parsedOutput.event ? findFlowByEvent(outgoing, parsedOutput.event) : null;
    if (outgoing.length > 0 && !selectedFlow) {
      const error = `Executable role output event "${parsedOutput.event ?? ""}" does not match any outgoing flow on role "${args.roleId}"`;
      const audit = makeAuditRecord({
        roleId: args.roleId,
        lawRef,
        started,
        modelId: effectiveModelId,
        profileId: effectiveProfileId,
        toolRef: tool.toolRef,
        command: auditCommand,
        resultArgs: result.args,
        sessionId: result.sessionId,
        messageId: result.messageId,
        serverPid: result.serverPid,
        exitCode: result.exitCode,
        status: "failed",
        stdout: result.stdout,
        stderr: result.stderr,
        error
      });
      if (result.sessionId) {
        await persistRoleSession({
          context: args.context.runContext,
          roleId: args.roleId,
          execution,
          sessionId: result.sessionId,
          messageId: result.messageId
        });
      }
      await persistRoleResult({
        roleId: args.roleId,
        context: args.context.runContext,
        execution,
        output: parsedOutput,
        audit
      });
      return {
        currentRoleId: args.roleId,
        transitionCount: nextTransitionCount,
        status: "failed",
        error,
        finalRoleId: args.roleId,
        lastOutput: parsedOutput.content ?? "",
        auditTrail: [audit]
      };
    }

    const failed = result.exitCode !== 0;
    const selectedToRoleId = selectedFlow?.toRoleId;
    const nextRoleId =
      failed || selectedToRoleId === SYSTEM_END_ROLE_ID ? null : selectedToRoleId ?? null;
    const status: RuntimeState["status"] = failed ? "failed" : nextRoleId ? "running" : "done";
    const error = failed ? `Command exited with code ${result.exitCode}` : null;

    const audit = makeAuditRecord({
      roleId: args.roleId,
      lawRef,
      started,
      modelId: effectiveModelId,
      profileId: effectiveProfileId,
      toolRef: tool.toolRef,
      command: auditCommand,
      resultArgs: result.args,
      sessionId: result.sessionId,
      messageId: result.messageId,
      serverPid: result.serverPid,
      exitCode: result.exitCode,
      selectedEvent: selectedFlow?.eventType,
      nextRoleId: nextRoleId ?? undefined,
      status: failed ? "failed" : "ok",
      stdout: result.stdout,
      stderr: result.stderr,
      error: error ?? undefined
    });
    if (result.sessionId) {
      await persistRoleSession({
        context: args.context.runContext,
        roleId: args.roleId,
        execution,
        sessionId: result.sessionId,
        messageId: result.messageId
      });
    }
    await persistRoleResult({
      roleId: args.roleId,
      context: args.context.runContext,
      execution,
      output: parsedOutput,
      audit
    });
    return {
      currentRoleId: args.roleId,
      transitionCount: nextTransitionCount,
      nextRoleId,
      status,
      error,
      finalRoleId: status === "running" ? null : args.roleId,
      lastOutput: parsedOutput.content ?? "",
      auditTrail: [audit]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const category =
      error instanceof ToolExecutionError ? ` (${error.category})` : "";
    const executionError = error instanceof OpencodeExecutionError ? error.details : undefined;
    const audit = makeAuditRecord({
      roleId: args.roleId,
      lawRef,
      started,
      modelId: effectiveModelId,
      profileId: effectiveProfileId,
      toolRef: tool.toolRef,
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
        context: args.context.runContext,
        roleId: args.roleId,
        execution,
        sessionId: executionError.sessionId,
        messageId: executionError.messageId
      });
    }
    await persistRoleResult({
      roleId: args.roleId,
      context: args.context.runContext,
      execution,
      audit
    });
    return {
      currentRoleId: args.roleId,
      transitionCount: nextTransitionCount,
      status: "failed",
      error: `${message}${category}`,
      finalRoleId: args.roleId,
      auditTrail: [audit]
    };
  }
}

async function loadRuntimeConfig(path: string | undefined, workdir: string): Promise<RuntimeConfig> {
  const runtimePath = path ?? resolve(workdir, ".ogsystem", "runtime.json");
  if (!(await pathExists(runtimePath))) {
    return validateRuntimeConfig(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        modelRepo: "./og-models",
        runsDir: ".ogsystems",
        workspace: {
          rolesDir: "roles",
          privateDirName: "private",
          linkSharedIntoRoleDir: false
        },
        opencode: {
          baseArgs: ["run"]
        }
      },
      runtimePath
    );
  }
  return validateRuntimeConfig(await readJsonFile(runtimePath), runtimePath);
}

async function loadUserProfile(
  path: string | undefined,
  workdir: string
): Promise<UserProfile | undefined> {
  const profilePath = path ?? resolve(workdir, ".ogsystem", "user-profile.json");
  if (!(await pathExists(profilePath))) {
    return undefined;
  }
  return validateUserProfileConfig(await readJsonFile(profilePath), profilePath);
}

async function loadProfiles(path?: string): Promise<ExecutionProfile[]> {
  if (!path) {
    return [];
  }
  return validateProfilesConfig(await readJsonFile(path), path);
}

async function loadTools(path?: string): Promise<CliTool[]> {
  if (!path) {
    return [];
  }
  return validateToolsConfig(await readJsonFile(path), path).tools;
}

async function loadLaws(path: string | undefined, workdir: string): Promise<LawCatalog | undefined> {
  const lawPath = path ?? resolve(workdir, ".ogsystem", "laws.json");
  if (!(await pathExists(lawPath))) {
    return undefined;
  }
  return validateLawsConfig(await readJsonFile(lawPath), lawPath);
}

async function loadRolePackages(args: {
  system: SystemDefinition;
  roleRootDir: string;
}): Promise<Map<string, LoadedRolePackage>> {
  const rolePackagesByRoleId = new Map<string, LoadedRolePackage>();

  for (const roleId of args.system.roleIds) {
    const rolePackage = await loadRolePackage({
      roleId,
      roleRootDir: args.roleRootDir
    });
    rolePackagesByRoleId.set(roleId, rolePackage);
  }

  return rolePackagesByRoleId;
}

async function loadModelPackages(args: {
  system: SystemDefinition;
  modelRootDir: string;
}): Promise<Map<string, LoadedModelPackage>> {
  const modelsById = new Map<string, LoadedModelPackage>();
  const referencedModelIds = new Set(Object.values(args.system.modelBinding));

  for (const modelId of referencedModelIds) {
    const modelPackage = await loadModelPackage({
      modelId,
      modelRootDir: args.modelRootDir
    });
    modelsById.set(modelId, modelPackage);
  }

  return modelsById;
}

async function persistState(context: RunContext, state: RuntimeState): Promise<void> {
  await writeFile(
    context.statePath,
    stringifyJson({
      status: state.status,
      currentRoleId: state.currentRoleId,
      nextRoleId: state.nextRoleId,
      transitionCount: state.transitionCount,
      lastOutput: state.lastOutput,
      error: state.error,
      finalRoleId: state.finalRoleId
    }),
    "utf8"
  );
}

function mergeRuntimeState(
  state: RuntimeState,
  patch: Partial<RuntimeState>,
  preservedUserPrompt: string
): RuntimeState {
  return {
    currentRoleId: patch.currentRoleId ?? state.currentRoleId,
    nextRoleId: patch.nextRoleId ?? null,
    status: patch.status ?? state.status,
    userPrompt: preservedUserPrompt,
    lastOutput: patch.lastOutput ?? state.lastOutput,
    transitionCount: patch.transitionCount ?? state.transitionCount,
    auditTrail: [...state.auditTrail, ...(patch.auditTrail ?? [])],
    error: patch.error ?? (patch.status === "running" ? null : state.error),
    finalRoleId: patch.finalRoleId ?? state.finalRoleId
  };
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
}): Promise<AdapterRunResult> {
  const system = await loadSystemFromMermaid(args.systemPath);
  const runtimeConfig = await loadRuntimeConfig(args.runtimeConfigPath, args.workdir);
  const profiles = await loadProfiles(args.profilesPath);
  const tools = await loadTools(args.toolsPath);
  const lawCatalog = await loadLaws(args.lawsPath, args.workdir);
  const userProfile = await loadUserProfile(args.userProfilePath, args.workdir);
  const rolePackagesByRoleId = await loadRolePackages({
    system,
    roleRootDir: resolve(args.workdir, runtimeConfig.roleRepo, "roles")
  });
  const modelsById = await loadModelPackages({
    system,
    modelRootDir: resolve(args.workdir, runtimeConfig.modelRepo)
  });
  const effectiveLaw = resolveEffectiveLaw(system, lawCatalog);
  const runContext = await initializeRunContext({
    system,
    systemPath: args.systemPath,
    prompt: args.prompt,
    workdir: args.workdir,
    runtimeConfig,
    resumeRunDir: args.resumeRunDir
  });

  const profilesById = new Map(profiles.map((item) => [item.profileId, item]));
  const toolsByRef = new Map(tools.map((item) => [item.toolRef, item]));
  const adjacency = buildAdjacency(system.flows);
  const requiresOpencodeRunServer = !args.dryRun && modelsById.size > 0;
  let opencodeRun: OpencodeRunClient | undefined;

  try {
    if (requiresOpencodeRunServer) {
      opencodeRun = await startOpencodeRunClient({
        timeoutMs: 30000,
        env: {
          OGSYSTEM_RUN_DIR: runContext.runDir,
          OGSYSTEM_SHARED_DIR: runContext.sharedDir
        }
      });
      runContext.opencodeServerUrl = opencodeRun.url;
      runContext.opencodeServerPid = opencodeRun.pid;
      runContext.opencodeServerStartedAt = opencodeRun.startedAt;
      await writeFile(
        runContext.opencodeServerPath,
        stringifyJson({
          lifecycle: "single-serve-multi-session",
          startedAt: runContext.opencodeServerStartedAt,
          url: runContext.opencodeServerUrl,
          pid: runContext.opencodeServerPid
        }),
        "utf8"
      );
      await appendEvent(runContext, {
        type: "opencode_server_started",
        at: runContext.opencodeServerStartedAt,
        url: runContext.opencodeServerUrl,
        pid: runContext.opencodeServerPid,
        lifecycle: "single-serve-multi-session"
      });
    }

    if (system.engine === "langgraph") {
      let initialState: unknown;
      if (args.resumeRunDir) {
        const resumeStatePath = resolve(runContext.runDir, "state.json");
        if (await pathExists(resumeStatePath)) {
          const resumeState = await readJsonFile(resumeStatePath);
          if (
            typeof resumeState === "object" &&
            resumeState !== null &&
            !Array.isArray(resumeState) &&
            "graphState" in resumeState
          ) {
            initialState = (resumeState as Record<string, unknown>).graphState;
          }
        }
      }
      return await runSystemWithLangGraph({
        system,
        effectiveLaw,
        profilesById,
        toolsByRef,
        modelsById,
        runtimeConfig,
        userProfile,
        workdir: args.workdir,
        rolePackagesByRoleId,
        runContext,
        opencodeRun,
        prompt: args.prompt,
        dryRun: args.dryRun,
        initialState: initialState as never
      });
    }

    let state: RuntimeState = {
      currentRoleId: system.entryRoleId,
      nextRoleId: system.entryRoleId,
      status: "running",
      userPrompt: args.prompt,
      lastOutput: "",
      transitionCount: 0,
      auditTrail: [],
      error: null,
      finalRoleId: null
    };
    await persistState(runContext, state);

    while (state.status === "running") {
      const roleId = state.nextRoleId ?? state.currentRoleId;
      const patch = await executeRoleNode({
        roleId,
        state,
        context: {
          system,
          effectiveLaw,
          profilesById,
          toolsByRef,
          modelsById,
          runtimeConfig,
          userProfile,
          workdir: args.workdir,
          rolePackagesByRoleId,
          runContext,
          opencodeRun,
          dryRun: args.dryRun
        },
        adjacency
      });

      state = mergeRuntimeState(state, patch, args.prompt);
      await persistState(runContext, state);
      for (const audit of patch.auditTrail ?? []) {
        await appendEvent(runContext, {
          type: "audit",
          ...audit
        });
        await appendFile(
          resolve(runContext.auditDir, "transitions.md"),
          `- ${audit.roleId}: ${audit.status}${audit.selectedEvent ? ` (${audit.selectedEvent})` : ""}\n`,
          "utf8"
        );
      }
      if (state.status === "running" && !state.nextRoleId) {
        state = mergeRuntimeState(
          state,
          {
            status: "failed",
            error: `Runtime lost next role after executing "${roleId}"`,
            finalRoleId: roleId,
            auditTrail: [
              makeAuditRecord({
                roleId,
                lawRef: system.lawBinding.globalLawRef,
                started: Date.now(),
                exitCode: 1,
                status: "failed",
                error: `Runtime lost next role after executing "${roleId}"`
              })
            ]
          },
          args.prompt
        );
        await persistState(runContext, state);
      }
    }

    const systemState = {
      status: state.status,
      currentRoleId: state.currentRoleId,
      nextRoleId: state.nextRoleId ?? undefined,
      finalRoleId: state.finalRoleId ?? undefined,
      transitionCount: state.transitionCount,
      lastOutput: state.lastOutput || undefined,
      error: state.error ?? undefined
    };
    const stages = projectStages({ auditTrail: state.auditTrail });
    await writeFile(
      resolve(runContext.auditDir, "summary.md"),
      [
        "# Audit Summary",
        "",
        `- runId: ${runContext.runId}`,
        `- status: ${state.status}`,
        `- finalRoleId: ${state.finalRoleId ?? ""}`,
        `- transitionCount: ${state.transitionCount}`,
        `- opencodeServerUrl: ${runContext.opencodeServerUrl ?? ""}`,
        `- opencodeServerPid: ${runContext.opencodeServerPid ?? ""}`,
        `- opencodeServerStartedAt: ${runContext.opencodeServerStartedAt ?? ""}`
      ].join("\n"),
      "utf8"
    );

    return {
      systemId: system.systemId,
      systemVersion: system.systemVersion,
      lawRef: system.lawBinding.globalLawRef,
      status: state.status === "failed" ? "failed" : "done",
      finalRoleId: state.finalRoleId ?? undefined,
      finalOutput: state.lastOutput || undefined,
      systemState,
      stages,
      auditTrail: state.auditTrail,
      error: state.error ?? undefined
    };
  } finally {
    if (opencodeRun) {
      opencodeRun.close();
      await writeFile(
        runContext.opencodeServerPath,
        stringifyJson({
          lifecycle: "single-serve-multi-session",
          startedAt: runContext.opencodeServerStartedAt,
          closedAt: new Date().toISOString(),
          url: runContext.opencodeServerUrl,
          pid: runContext.opencodeServerPid
        }),
        "utf8"
      );
      await appendEvent(runContext, {
        type: "opencode_server_closed",
        at: new Date().toISOString(),
        url: runContext.opencodeServerUrl,
        pid: runContext.opencodeServerPid,
        lifecycle: "single-serve-multi-session"
      });
    }
  }
}
