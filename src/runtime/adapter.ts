import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  validateLawsConfig,
  validateProfilesConfig,
  validateToolsConfig
} from "./config.js";
import { loadSystemFromMermaid } from "./parse-mermaid.js";
import {
  loadRolePackage,
  renderRolePrompt,
  validateRoleInputSchema,
  validateRoleOutputSchema
} from "./role-repo.js";
import { projectStages } from "./stage-projector.js";
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
  LoadedRolePackage,
  RoleExecutionOutput,
  SystemDefinition
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
  workdir: string;
  rolePackagesByRoleId: Map<string, LoadedRolePackage>;
  dryRun?: boolean;
};

function preview(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, 400);
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
    round: String(args.state.transitionCount + 1)
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
  const profileRef = args.context.system.executionBinding[args.roleId];
  const maxTransitions = args.context.effectiveLaw.maxTransitions;
  const lawRef = args.context.system.lawBinding.globalLawRef;

  if (maxTransitions !== undefined && nextTransitionCount > maxTransitions) {
    const error = `Transition budget exceeded: ${nextTransitionCount} > ${maxTransitions}`;
    return {
      currentRoleId: args.roleId,
      transitionCount: nextTransitionCount,
      status: "failed",
      error,
      finalRoleId: args.roleId,
      auditTrail: [
        makeAuditRecord({
          roleId: args.roleId,
          lawRef,
          started,
          exitCode: 1,
          status: "failed",
          error
        })
      ]
    };
  }

  if (!profileRef) {
    if (!args.context.effectiveLaw.allowNoopWithoutExecutionBinding) {
      const error = `Role "${args.roleId}" has no execution binding`;
      return {
        currentRoleId: args.roleId,
        transitionCount: nextTransitionCount,
        status: "failed",
        error,
        finalRoleId: args.roleId,
        auditTrail: [
          makeAuditRecord({
            roleId: args.roleId,
            lawRef,
            started,
            exitCode: 1,
            status: "failed",
            error
          })
        ]
      };
    }

    if (outgoing.length > 1) {
      const error = `Role "${args.roleId}" cannot use explicit noop mode with multiple outgoing flows`;
      return {
        currentRoleId: args.roleId,
        transitionCount: nextTransitionCount,
        status: "failed",
        error,
        finalRoleId: args.roleId,
        auditTrail: [
          makeAuditRecord({
            roleId: args.roleId,
            lawRef,
            started,
            exitCode: 1,
            status: "failed",
            error
          })
        ]
      };
    }

    const selectedToRoleId = outgoing[0]?.toRoleId;
    const nextRoleId = selectedToRoleId === SYSTEM_END_ROLE_ID ? null : selectedToRoleId ?? null;
    const status: RuntimeState["status"] = nextRoleId ? "running" : "done";

    return {
      currentRoleId: args.roleId,
      transitionCount: nextTransitionCount,
      nextRoleId,
      status,
      finalRoleId: status === "running" ? null : args.roleId,
      auditTrail: [
        makeAuditRecord({
          roleId: args.roleId,
          lawRef,
          started,
          exitCode: 0,
          selectedEvent: outgoing[0]?.eventType,
          nextRoleId: nextRoleId ?? undefined,
          status: "noop"
        })
      ]
    };
  }

  const profile = args.context.profilesById.get(profileRef);
  if (!profile) {
    const error = `Execution profile not found: ${profileRef}`;
    return {
      currentRoleId: args.roleId,
      transitionCount: nextTransitionCount,
      status: "failed",
      error,
      finalRoleId: args.roleId,
      auditTrail: [
        makeAuditRecord({
          roleId: args.roleId,
          lawRef,
          started,
          profileId: profileRef,
          exitCode: 1,
          status: "failed",
          error
        })
      ]
    };
  }

  const toolRef = profile.toolRef;
  const tool = args.context.toolsByRef.get(toolRef);
  if (!tool) {
    const error = `Tool not found: ${toolRef}`;
    return {
      currentRoleId: args.roleId,
      transitionCount: nextTransitionCount,
      status: "failed",
      error,
      finalRoleId: args.roleId,
      auditTrail: [
        makeAuditRecord({
          roleId: args.roleId,
          lawRef,
          started,
          profileId: profileRef,
          toolRef,
          exitCode: 1,
          status: "failed",
          error
        })
      ]
    };
  }

  if (args.context.effectiveLaw.forbiddenToolRefs.includes(toolRef)) {
    const error = `Tool is forbidden by effective law: ${toolRef}`;
    return {
      currentRoleId: args.roleId,
      transitionCount: nextTransitionCount,
      status: "failed",
      error,
      finalRoleId: args.roleId,
      auditTrail: [
        makeAuditRecord({
          roleId: args.roleId,
          lawRef,
          started,
          profileId: profileRef,
          toolRef,
          exitCode: 1,
          status: "failed",
          error
        })
      ]
    };
  }

  const prompt = resolveRolePrompt({
    roleId: args.roleId,
    state: args.state,
    rolePackagesByRoleId: args.context.rolePackagesByRoleId,
    outgoingFlows: outgoing
  });

  if (args.context.dryRun && outgoing.length > 1) {
    const error = `Dry-run requires an unambiguous single outgoing flow for role "${args.roleId}"`;
    return {
      currentRoleId: args.roleId,
      transitionCount: nextTransitionCount,
      status: "failed",
      error,
      finalRoleId: args.roleId,
      auditTrail: [
        makeAuditRecord({
          roleId: args.roleId,
          lawRef,
          started,
          profileId: profileRef,
          toolRef,
          command: tool.command,
          exitCode: 1,
          status: "failed",
          error
        })
      ]
    };
  }

  try {
    const result = await runCliTool({
      tool,
      vars: { prompt },
      workdir: args.context.workdir,
      timeoutMs: profile.timeoutMs ?? 120000,
      maxOutputBytes: profile.maxOutputBytes ?? 64 * 1024,
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
      return {
        currentRoleId: args.roleId,
        transitionCount: nextTransitionCount,
        status: "failed",
        error,
        finalRoleId: args.roleId,
        lastOutput: parsedOutput.content ?? "",
        auditTrail: [
          makeAuditRecord({
            roleId: args.roleId,
            lawRef,
            started,
            profileId: profileRef,
            toolRef,
            command: tool.command,
            resultArgs: result.args,
            exitCode: result.exitCode,
            status: "failed",
            stdout: result.stdout,
            stderr: result.stderr,
            error
          })
        ]
      };
    }

    const failed = result.exitCode !== 0;
    const selectedToRoleId = selectedFlow?.toRoleId;
    const nextRoleId =
      failed || selectedToRoleId === SYSTEM_END_ROLE_ID ? null : selectedToRoleId ?? null;
    const status: RuntimeState["status"] = failed ? "failed" : nextRoleId ? "running" : "done";
    const error = failed ? `Command exited with code ${result.exitCode}` : null;

    return {
      currentRoleId: args.roleId,
      transitionCount: nextTransitionCount,
      nextRoleId,
      status,
      error,
      finalRoleId: status === "running" ? null : args.roleId,
      lastOutput: parsedOutput.content ?? "",
      auditTrail: [
        makeAuditRecord({
          roleId: args.roleId,
          lawRef,
          started,
          profileId: profileRef,
          toolRef,
          command: tool.command,
          resultArgs: result.args,
          exitCode: result.exitCode,
          selectedEvent: selectedFlow?.eventType,
          nextRoleId: nextRoleId ?? undefined,
          status: failed ? "failed" : "ok",
          stdout: result.stdout,
          stderr: result.stderr,
          error: error ?? undefined
        })
      ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const category =
      error instanceof ToolExecutionError ? ` (${error.category})` : "";
    return {
      currentRoleId: args.roleId,
      transitionCount: nextTransitionCount,
      status: "failed",
      error: `${message}${category}`,
      finalRoleId: args.roleId,
      auditTrail: [
        makeAuditRecord({
          roleId: args.roleId,
          lawRef,
          started,
          profileId: profileRef,
          toolRef,
          command: tool.command,
          exitCode: 1,
          status: "failed",
          error: `${message}${category}`
        })
      ]
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

async function loadLaws(path?: string): Promise<LawCatalog | undefined> {
  if (!path) {
    return undefined;
  }
  return validateLawsConfig(await readJsonFile(path), path);
}

async function loadRolePackages(args: { system: SystemDefinition }): Promise<Map<string, LoadedRolePackage>> {
  const rolePackagesByRoleId = new Map<string, LoadedRolePackage>();
  const roleRootDir = resolve(process.cwd(), "og-roles", "roles");

  for (const roleId of args.system.roleIds) {
    const rolePackage = await loadRolePackage({
      roleId,
      roleRootDir
    });
    rolePackagesByRoleId.set(roleId, rolePackage);
  }

  return rolePackagesByRoleId;
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
  prompt: string;
  workdir: string;
  dryRun?: boolean;
}): Promise<AdapterRunResult> {
  const system = await loadSystemFromMermaid(args.systemPath);
  const profiles = await loadProfiles(args.profilesPath);
  const tools = await loadTools(args.toolsPath);
  const lawCatalog = await loadLaws(args.lawsPath);
  const rolePackagesByRoleId = await loadRolePackages({ system });
  const effectiveLaw = resolveEffectiveLaw(system, lawCatalog);

  const profilesById = new Map(profiles.map((item) => [item.profileId, item]));
  const toolsByRef = new Map(tools.map((item) => [item.toolRef, item]));
  const adjacency = buildAdjacency(system.flows);

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
        workdir: args.workdir,
        rolePackagesByRoleId,
        dryRun: args.dryRun
      },
      adjacency
    });

    state = mergeRuntimeState(state, patch, args.prompt);
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
