import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  validateLawsConfig,
  validateProfilesConfig,
  validateRuntimeConfig,
  validateToolsConfig,
  validateUserProfileConfig
} from "./config.js";
import { createDefaultExecutor } from "./executor.js";
import { createExecutionPlan } from "./execution-plan.js";
import { runSystemWithGraphRunner } from "./graph-runner.js";
import { readJsonFile } from "./json-file.js";
import { loadModelPackage } from "./model-repo.js";
import { loadSystemFromMermaid } from "./parse-mermaid.js";
import { loadRolePackage } from "./role-repo.js";
import { createRuntimeError, normalizeRuntimeError } from "./runtime-errors.js";
import {
  initializeRunContext,
  loadResumeGraphState,
  pathExists,
  persistRunPlanFingerprint,
  validateResumePlanFingerprint
} from "./run-artifacts.js";
import type {
  AdapterRunResult,
  CliTool,
  EffectiveLawConstraints,
  ExecutionProfile,
  GraphState,
  LawCatalog,
  LawSpec,
  LoadedModelPackage,
  LoadedRolePackage,
  RuntimeConfig,
  SystemDefinition,
  UserProfile
} from "./types.js";
import type { RunPlanFingerprint } from "./run-artifacts.js";

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

async function loadRuntimeConfig(path: string | undefined, workdir: string): Promise<RuntimeConfig> {
  const runtimePath = path ?? resolve(workdir, ".ogsystem", "runtime.json");
  if (!(await pathExists(runtimePath))) {
    return validateRuntimeConfig(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        modelRepo: "./og-models",
        runsDir: "ogsystem-history",
        workspace: {
          rolesDir: "roles",
          privateDirName: "private"
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

function sortedRecordEntries(record: Record<string, string>): Array<[string, string]> {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

function sortedRoleIds(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertBindingPreflight(args: {
  plan: ReturnType<typeof createExecutionPlan>;
  effectiveLaw: EffectiveLawConstraints;
}): void {
  for (const roleId of args.plan.roleIds) {
    const node = args.plan.nodesByRoleId.get(roleId);
    if (!node) {
      throw new Error(`Execution plan is missing role "${roleId}"`);
    }
    if (node.binding.kind !== "noop") {
      continue;
    }
    if (!args.effectiveLaw.allowNoopWithoutExecutionBinding) {
      throw new Error(
        `Role "${roleId}" has no executable binding (model.bind/exec.bind). ` +
          `Set binding or enable allowNoopWithoutExecutionBinding in effective law.`
      );
    }
    if (node.outgoing.length > 1) {
      throw new Error(
        `Role "${roleId}" cannot use noop binding with ${node.outgoing.length} outgoing flows.`
      );
    }
  }
}

type FingerprintComponentName = "system" | "rolePackages" | "modelPackages" | "effectiveLaw";

function normalizeFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeFingerprintValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, normalizeFingerprintValue((value as Record<string, unknown>)[key])])
    );
  }
  return value ?? null;
}

function hashFingerprintValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(normalizeFingerprintValue(value))).digest("hex");
}

function buildSystemFingerprintComponent(system: SystemDefinition): Record<string, unknown> {
  return {
    systemId: system.systemId,
    systemVersion: system.systemVersion,
    entryRoleId: system.entryRoleId,
    roleIds: sortedRoleIds(system.roleIds),
    flows: [...system.flows]
      .map((flow) => ({
        fromRoleId: flow.fromRoleId,
        toRoleId: flow.toRoleId,
        eventType: flow.eventType
      }))
      .sort((left, right) => {
        if (left.fromRoleId !== right.fromRoleId) {
          return left.fromRoleId.localeCompare(right.fromRoleId);
        }
        if (left.eventType !== right.eventType) {
          return left.eventType.localeCompare(right.eventType);
        }
        return left.toRoleId.localeCompare(right.toRoleId);
      }),
    lawRef: system.lawBinding.globalLawRef,
    talentBinding: sortedRecordEntries(system.talentBinding),
    executionBinding: sortedRecordEntries(system.executionBinding),
    modelBinding: sortedRecordEntries(system.modelBinding),
    graph: {
      routingModeByRoleId: sortedRecordEntries(system.graph?.routingModeByRoleId ?? {}),
      joinModeByRoleId: sortedRecordEntries(system.graph?.joinModeByRoleId ?? {}),
      joinSourcesByRoleId: Object.entries(system.graph?.joinSourcesByRoleId ?? {})
        .map(([roleId, sources]) => [roleId, sortedRoleIds(sources)] as [string, string[]])
        .sort(([left], [right]) => left.localeCompare(right)),
      loopMaxByRoleId: Object.entries(system.graph?.loopMaxByRoleId ?? {})
        .map(([roleId, max]) => [roleId, max] as [string, number])
        .sort(([left], [right]) => left.localeCompare(right))
    }
  };
}

function buildRolePackageFingerprintComponent(
  rolePackagesByRoleId: Map<string, LoadedRolePackage>
): Array<{
  identity: Record<string, unknown>;
  sourceHints: Record<string, unknown>;
}> {
  // Resume safety is based on loaded package contents rather than machine-local paths.
  // Paths are preserved only as diagnostics to explain mismatches to the operator.
  return Array.from(rolePackagesByRoleId.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([roleId, rolePackage]) => ({
      identity: {
        roleId,
        manifest: normalizeFingerprintValue(rolePackage.manifest),
        promptTemplate: rolePackage.promptTemplate,
        inputSchema: normalizeFingerprintValue(rolePackage.inputSchema ?? null),
        outputSchema: normalizeFingerprintValue(rolePackage.outputSchema),
        persona: rolePackage.persona ?? null,
        work: rolePackage.work ?? null
      },
      sourceHints: {
        roleId,
        resolvedPath: rolePackage.resolvedPath,
        promptTemplatePath: resolve(rolePackage.resolvedPath, rolePackage.manifest.promptTemplate),
        inputSchemaPath: rolePackage.inputSchemaPath ?? null,
        outputSchemaPath: rolePackage.outputSchemaPath,
        personaPath: rolePackage.persona !== undefined ? resolve(rolePackage.resolvedPath, "persona.md") : null,
        workPath: rolePackage.work !== undefined ? resolve(rolePackage.resolvedPath, "work.md") : null
      }
    }));
}

function buildModelPackageFingerprintComponent(
  modelsById: Map<string, LoadedModelPackage>
): Array<{
  identity: Record<string, unknown>;
  sourceHints: Record<string, unknown>;
}> {
  return Array.from(modelsById.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([modelId, modelPackage]) => ({
      identity: {
        modelId,
        manifest: normalizeFingerprintValue(modelPackage.manifest)
      },
      sourceHints: {
        modelId,
        resolvedPath: modelPackage.resolvedPath,
        manifestPath: resolve(modelPackage.resolvedPath, "model.json")
      }
    }));
}

export function buildRunPlanFingerprint(args: {
  system: SystemDefinition;
  rolePackagesByRoleId: Map<string, LoadedRolePackage>;
  modelsById: Map<string, LoadedModelPackage>;
  effectiveLaw: EffectiveLawConstraints;
}): RunPlanFingerprint {
  // A run may resume only against the same executable contract: graph semantics, loaded role content,
  // loaded model config, and the effective law set must all remain identical.
  const rolePackageComponents = buildRolePackageFingerprintComponent(args.rolePackagesByRoleId);
  const modelPackageComponents = buildModelPackageFingerprintComponent(args.modelsById);
  const componentValues: Record<FingerprintComponentName, unknown> = {
    system: buildSystemFingerprintComponent(args.system),
    rolePackages: rolePackageComponents.map((component) => component.identity),
    modelPackages: modelPackageComponents.map((component) => component.identity),
    effectiveLaw: normalizeFingerprintValue(args.effectiveLaw)
  };
  const componentDigests = Object.fromEntries(
    (Object.keys(componentValues) as FingerprintComponentName[]).map((componentName) => [
      componentName,
      hashFingerprintValue(componentValues[componentName])
    ])
  ) as Record<FingerprintComponentName, string>;
  const payload = {
    components: {
      system: {
        digest: componentDigests.system,
        value: componentValues.system
      },
      rolePackages: {
        digest: componentDigests.rolePackages,
        value: componentValues.rolePackages,
        sourceHints: rolePackageComponents.map((component) => component.sourceHints)
      },
      modelPackages: {
        digest: componentDigests.modelPackages,
        value: componentValues.modelPackages,
        sourceHints: modelPackageComponents.map((component) => component.sourceHints)
      },
      effectiveLaw: {
        digest: componentDigests.effectiveLaw,
        value: componentValues.effectiveLaw
      }
    }
  };

  const digest = hashFingerprintValue(componentDigests);
  return {
    version: 3,
    algorithm: "sha256",
    digest,
    payload
  };
}

const TEST_HOLD_RESUME_LOCK_MS_ENV = "OGSYSTEM_TEST_HOLD_RESUME_LOCK_MS";

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
  let runContextForCleanup: Awaited<ReturnType<typeof initializeRunContext>> | undefined;
  let executionError: unknown;
  let result: AdapterRunResult | undefined;
  let setup:
    | {
        plan: ReturnType<typeof createExecutionPlan>;
        effectiveLaw: EffectiveLawConstraints;
        profilesById: Map<string, ExecutionProfile>;
        toolsByRef: Map<string, CliTool>;
        modelsById: Map<string, LoadedModelPackage>;
        userProfile?: UserProfile;
        rolePackagesByRoleId: Map<string, LoadedRolePackage>;
        runContext: Awaited<ReturnType<typeof initializeRunContext>>;
        planFingerprint: RunPlanFingerprint;
        runtimeConfig: RuntimeConfig;
      }
    | undefined;
  try {
    try {
      const system = await loadSystemFromMermaid(args.systemPath);
      const plan = createExecutionPlan(system);
      const runtimeConfig = await loadRuntimeConfig(args.runtimeConfigPath, args.workdir);
      const profiles = await loadProfiles(args.profilesPath);
      const tools = await loadTools(args.toolsPath);
      const lawCatalog = await loadLaws(args.lawsPath, args.workdir);
      const userProfile = await loadUserProfile(args.userProfilePath, args.workdir);
      const effectiveLaw = resolveEffectiveLaw(system, lawCatalog);
      assertBindingPreflight({
        plan,
        effectiveLaw
      });
      const rolePackagesByRoleId = await loadRolePackages({
        system,
        roleRootDir: resolve(args.workdir, runtimeConfig.roleRepo, "roles")
      });
      const modelsById = await loadModelPackages({
        system,
        modelRootDir: resolve(args.workdir, runtimeConfig.modelRepo)
      });
      const planFingerprint = buildRunPlanFingerprint({
        system,
        rolePackagesByRoleId,
        modelsById,
        effectiveLaw
      });
      const runContext = await initializeRunContext({
        system,
        systemPath: args.systemPath,
        prompt: args.prompt,
        workdir: args.workdir,
        runtimeConfig,
        resumeRunDir: args.resumeRunDir
      });
      runContextForCleanup = runContext;
      if (!args.resumeRunDir) {
        await persistRunPlanFingerprint({
          runDir: runContext.runDir,
          fingerprint: planFingerprint
        });
      }

      const profilesById = new Map(profiles.map((item) => [item.profileId, item]));
      const toolsByRef = new Map(tools.map((item) => [item.toolRef, item]));
      setup = {
        plan,
        effectiveLaw,
        profilesById,
        toolsByRef,
        modelsById,
        userProfile,
        rolePackagesByRoleId,
        runContext,
        planFingerprint,
        runtimeConfig
      };
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
      const executor = createDefaultExecutor({
        dryRun: args.dryRun,
        runContext: setup.runContext,
        needsModelExecutor: setup.modelsById.size > 0
      });

      try {
        if (args.resumeRunDir) {
          await maybeHoldResumeLockForTest();
        }
        await executor.start();

        let initialState: GraphState | undefined;
        if (args.resumeRunDir) {
          try {
            // Reliability: Verify state consistency via Plan Fingerprinting.
            // Prevents resuming a state snapshot against a modified Mermaid graph or system
            // definition, which would violate the internal integrity of the state machine.
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
          profilesById: setup.profilesById,
          toolsByRef: setup.toolsByRef,
          modelsById: setup.modelsById,
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
