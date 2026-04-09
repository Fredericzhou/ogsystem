import { appendFile, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

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
  loadRolePackage,
  renderRolePrompt,
  validateRoleInputSchema,
  validateRoleOutputSchema
} from "./role-repo.js";
import { runSystemWithLangGraph } from "./langgraph-runner.js";
import { projectStages } from "./stage-projector.js";
import { OpencodeExecutionError, executeOpencodeModelRole } from "./opencode-executor.js";
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
  RuntimeConfig,
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
  dryRun?: boolean;
};

type RoleRunDirs = {
  roleDir: string;
  privateDir: string;
};

type RunContext = {
  runId: string;
  runDir: string;
  auditDir: string;
  eventsPath: string;
  statePath: string;
  roleDirsById: Map<string, RoleRunDirs>;
  sharedDir: string;
};

function preview(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, 400);
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "run";
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function renderUserProfile(userProfile?: UserProfile): string {
  if (!userProfile) {
    return "";
  }
  return stringifyJson(userProfile);
}

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

export function parseRoleExecutionOutput(
  output: string,
  options: { requireEvent: boolean }
): RoleExecutionOutput {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error("Executable role output is empty; expected JSON object");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Executable role output must be valid JSON: ${message}`);
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

  const result: RoleExecutionOutput = {};

  if (record.event !== undefined) {
    if (typeof record.event !== "string" || !record.event.trim()) {
      throw new Error('Executable role output field "event" must be a non-empty string');
    }
    result.event = record.event;
  }

  if (record.content !== undefined) {
    if (typeof record.content !== "string") {
      throw new Error('Executable role output field "content" must be a string');
    }
    result.content = record.content;
  }

  if (record.data !== undefined) {
    if (typeof record.data !== "object" || record.data === null || Array.isArray(record.data)) {
      throw new Error('Executable role output field "data" must be an object');
    }
    result.data = record.data as Record<string, unknown>;
  }

  if (options.requireEvent && !result.event) {
    throw new Error('Executable role output must include "event" for roles with outgoing flows');
  }

  return result;
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

async function persistRolePrelude(args: {
  roleId: string;
  context: RuntimeInput;
  prompt: string;
  allowedEvents: string[];
  modelId?: string;
  state: RuntimeState;
}): Promise<void> {
  const roleDirs = args.context.runContext.roleDirsById.get(args.roleId);
  if (!roleDirs) {
    return;
  }
  const rolePackage = args.context.rolePackagesByRoleId.get(args.roleId);
  const roleInput = buildRoleInputProjection({
    roleId: args.roleId,
    state: args.state,
    allowedEvents: args.allowedEvents,
    userProfile: args.context.userProfile
  });
  await writeFile(
    resolve(roleDirs.roleDir, "inbox.md"),
    [
      `# Inbox: ${args.roleId}`,
      "",
      `Role: ${rolePackage?.manifest.name ?? args.roleId}`,
      "",
      "Role Description:",
      rolePackage?.manifest.description ?? "",
      "",
      "Runtime Input Projection:",
      "```json",
      stringifyJson(roleInput),
      "```"
    ].join("\n"),
    "utf8"
  );
  await writeFile(resolve(roleDirs.roleDir, "prompt.md"), `${args.prompt}\n`, "utf8");
  await writeFile(
    resolve(roleDirs.roleDir, "role.md"),
    [
      `# Role ${args.roleId}`,
      "",
      `- modelId: ${args.modelId ?? "legacy-profile"}`,
      `- allowedEvents: ${args.allowedEvents.join(", ") || "(none)"}`,
      `- resolvedRolePath: ${rolePackage?.resolvedPath ?? ""}`,
      `- preferredModelTags: ${(rolePackage?.manifest.preferredModelTags ?? []).join(", ") || "(none)"}`,
      `- sharedDir: ${args.context.runContext.sharedDir}`,
      `- privateDir: ${roleDirs.privateDir}`
    ].join("\n"),
    "utf8"
  );
}

async function persistRoleResult(args: {
  roleId: string;
  context: RuntimeInput;
  output?: RoleExecutionOutput;
  audit: AuditRecord;
}): Promise<void> {
  const roleDirs = args.context.runContext.roleDirsById.get(args.roleId);
  if (!roleDirs) {
    return;
  }
  if (args.output) {
    await writeFile(resolve(roleDirs.roleDir, "result.json"), stringifyJson(args.output), "utf8");
    await writeFile(
      resolve(roleDirs.roleDir, "outbox.md"),
      `${args.output.content ?? ""}\n`,
      "utf8"
    );
  }
  await writeFile(resolve(roleDirs.roleDir, "audit.md"), stringifyJson(args.audit), "utf8");
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
      context: args.context,
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
      await persistRoleResult({ roleId: args.roleId, context: args.context, audit });
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
      await persistRoleResult({ roleId: args.roleId, context: args.context, audit });
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
    await persistRoleResult({ roleId: args.roleId, context: args.context, audit });
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
    context: args.context,
    prompt,
    allowedEvents: outgoing.map((item) => item.eventType),
    modelId,
    state: args.state
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
      context: args.context,
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
      await persistRoleResult({ roleId: args.roleId, context: args.context, audit });
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
      await persistRoleResult({ roleId: args.roleId, context: args.context, audit });
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
      await persistRoleResult({ roleId: args.roleId, context: args.context, audit });
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
    const result =
      modelId && args.context.modelsById.has(modelId) && !args.context.dryRun
        ? await executeOpencodeModelRole({
            roleId: args.roleId,
            prompt,
            schema: rolePackage?.outputSchema,
            modelPackage: args.context.modelsById.get(modelId)!,
            workdir: executionWorkdir,
            env: executionEnv,
            timeoutMs,
            maxOutputBytes
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
        exitCode: result.exitCode,
        status: "failed",
        stdout: result.stdout,
        stderr: result.stderr,
        error
      });
      await persistRoleResult({
        roleId: args.roleId,
        context: args.context,
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
      exitCode: result.exitCode,
      selectedEvent: selectedFlow?.eventType,
      nextRoleId: nextRoleId ?? undefined,
      status: failed ? "failed" : "ok",
      stdout: result.stdout,
      stderr: result.stderr,
      error: error ?? undefined
    });
    await persistRoleResult({
      roleId: args.roleId,
      context: args.context,
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
      exitCode: 1,
      status: "failed",
      stdout: executionError?.stdout,
      stderr: executionError?.stderr,
      error: `${message}${category}`
    });
    await persistRoleResult({ roleId: args.roleId, context: args.context, audit });
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

function buildAdjacency(flows: Flow[]): Map<string, Flow[]> {
  const map = new Map<string, Flow[]>();
  for (const flow of flows) {
    const list = map.get(flow.fromRoleId) ?? [];
    list.push(flow);
    map.set(flow.fromRoleId, list);
  }
  return map;
}

async function readJsonFile(path: string): Promise<unknown> {
  const source = await readFile(path, "utf8");
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${path}: ${message}`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
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

async function ensureSymlink(target: string, path: string): Promise<void> {
  try {
    await symlink(target, path, "dir");
  } catch {
    // Ignore if already created by a previous run attempt.
  }
}

function resolveSharedDir(args: {
  runDir: string;
  workdir: string;
  runtimeConfig: RuntimeConfig;
}): string {
  if (!args.runtimeConfig.sharedDir) {
    return resolve(args.runDir, "shared");
  }
  return resolve(args.workdir, args.runtimeConfig.sharedDir);
}

async function initializeRunContext(args: {
  system: SystemDefinition;
  systemPath: string;
  prompt: string;
  workdir: string;
  runtimeConfig: RuntimeConfig;
  resumeRunDir?: string;
}): Promise<RunContext> {
  const createdAt = new Date();
  const runDir = args.resumeRunDir
    ? resolve(args.workdir, args.resumeRunDir)
    : resolve(
        args.workdir,
        args.runtimeConfig.runsDir,
        `${timestampForPath(createdAt)}-${slugify(args.system.systemId)}`
      );
  const runId = basename(runDir);
  const auditDir = resolve(runDir, "audit");
  const rolesRootDir = resolve(runDir, args.runtimeConfig.workspace.rolesDir);
  const sharedDir = resolveSharedDir({
    runDir,
    workdir: args.workdir,
    runtimeConfig: args.runtimeConfig
  });
  const roleDirsById = new Map<string, RoleRunDirs>();

  await mkdir(auditDir, { recursive: true });
  await mkdir(rolesRootDir, { recursive: true });
  await mkdir(sharedDir, { recursive: true });

  const sourceSystem = await readFile(args.systemPath, "utf8");
  if (!(await pathExists(resolve(runDir, "request.md")))) {
    await writeFile(resolve(runDir, "request.md"), `${args.prompt}\n`, "utf8");
  }
  if (!(await pathExists(resolve(runDir, "system.mmd")))) {
    await writeFile(resolve(runDir, "system.mmd"), sourceSystem, "utf8");
  }
  if (!(await pathExists(resolve(runDir, "run.md")))) {
    await writeFile(
      resolve(runDir, "run.md"),
      [
        `# Run ${runId}`,
        "",
        `- systemId: ${args.system.systemId}`,
        `- systemVersion: ${args.system.systemVersion}`,
        `- entryRoleId: ${args.system.entryRoleId}`,
        `- sharedDir: ${sharedDir}`
      ].join("\n"),
      "utf8"
    );
  }
  if (!(await pathExists(resolve(auditDir, "summary.md")))) {
    await writeFile(resolve(auditDir, "summary.md"), "# Audit Summary\n", "utf8");
  }
  if (!(await pathExists(resolve(auditDir, "transitions.md")))) {
    await writeFile(resolve(auditDir, "transitions.md"), "# Transitions\n", "utf8");
  }

  for (const roleId of args.system.roleIds) {
    const roleDir = resolve(rolesRootDir, roleId);
    const privateDir = resolve(roleDir, args.runtimeConfig.workspace.privateDirName);
    await mkdir(privateDir, { recursive: true });
    if (args.runtimeConfig.workspace.linkSharedIntoRoleDir) {
      await ensureSymlink(sharedDir, resolve(roleDir, "shared"));
    }
    roleDirsById.set(roleId, { roleDir, privateDir });
  }

  return {
    runId,
    runDir,
    auditDir,
    eventsPath: resolve(runDir, "events.ndjson"),
    statePath: resolve(runDir, "state.json"),
    roleDirsById,
    sharedDir
  };
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

async function appendEvent(context: RunContext, payload: Record<string, unknown>): Promise<void> {
  await appendFile(context.eventsPath, `${JSON.stringify(payload)}\n`, "utf8");
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
      `- transitionCount: ${state.transitionCount}`
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
}
