import { resolve } from "node:path";

import { resolveModelRepoRoot, resolveRoleRootDir } from "./bundled-repos.js";
import { compileExecutionSnapshot, type CompiledExecutionSnapshot } from "./compiler.js";
import { createExecutionPlan } from "./execution-plan.js";
import { loadFlowContractPlan } from "./flow-contract.js";
import { loadSystemFromMermaid } from "./parse-mermaid.js";
import { buildRunPlanFingerprint } from "./plan-fingerprint.js";
import { initializeRunContext, persistRunPlanFingerprint } from "./run-artifacts.js";
import {
  loadLaws,
  loadModelPackages,
  loadProfiles,
  loadRolePackages,
  loadRuntimeConfig,
  loadTools,
  loadUserProfile
} from "./runtime-loader.js";
import type { RunPlanFingerprint } from "./run-artifacts.js";
import type {
  CliTool,
  EffectiveLawConstraints,
  ExecutionPlan,
  ExecutionProfile,
  FlowContractPlan,
  LawCatalog,
  LawSpec,
  LoadedModelPackage,
  LoadedRolePackage,
  RuntimeConfig,
  RunContext,
  SystemDefinition,
  UserProfile
} from "./types.js";

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

function formatCompilerDiagnosticsMessage(
  diagnostics: CompiledExecutionSnapshot["diagnostics"]
): string {
  return diagnostics
    .map((diagnostic) => {
      const scope = [
        diagnostic.roleId ? `role=${diagnostic.roleId}` : null,
        diagnostic.contractId ? `contract=${diagnostic.contractId}` : null,
        diagnostic.fieldName ? `field=${diagnostic.fieldName}` : null
      ]
        .filter(Boolean)
        .join(" ");
      return scope
        ? `[${diagnostic.code}] ${scope}: ${diagnostic.message}`
        : `[${diagnostic.code}] ${diagnostic.message}`;
    })
    .join("\n");
}

export type RuntimeAdapterSetup = {
  plan: ExecutionPlan;
  effectiveLaw: EffectiveLawConstraints;
  contractPlan?: FlowContractPlan;
  compilerSnapshot: CompiledExecutionSnapshot;
  profilesById: Map<string, ExecutionProfile>;
  toolsByRef: Map<string, CliTool>;
  modelsById: Map<string, LoadedModelPackage>;
  userProfile?: UserProfile;
  rolePackagesByRoleId: Map<string, LoadedRolePackage>;
  runContext: RunContext;
  planFingerprint: RunPlanFingerprint;
  runtimeConfig: RuntimeConfig;
};

export async function prepareRuntimeSetup(args: {
  systemPath: string;
  profilesPath?: string;
  toolsPath?: string;
  lawsPath?: string;
  runtimeConfigPath?: string;
  userProfilePath?: string;
  resumeRunDir?: string;
  prompt: string;
  workdir: string;
}): Promise<RuntimeAdapterSetup> {
  const system = await loadSystemFromMermaid(args.systemPath);
  const plan = createExecutionPlan(system);
  const runtimeConfig = await loadRuntimeConfig(args.runtimeConfigPath, args.workdir);
  const profiles = await loadProfiles(args.profilesPath);
  const tools = await loadTools(args.toolsPath);
  const lawCatalog = await loadLaws(args.lawsPath, args.workdir);
  const userProfile = await loadUserProfile(args.userProfilePath, args.workdir);
  const effectiveLaw = resolveEffectiveLaw(system, lawCatalog);
  const roleRootDir = resolveRoleRootDir(args.workdir, runtimeConfig.roleRepo);
  const modelRepoDir = resolveModelRepoRoot(args.workdir, runtimeConfig.modelRepo);
  const contractPlan = system.graph?.handoffContracts
    ? await loadFlowContractPlan({
        system,
        contractPath: system.graph.handoffContracts
      })
    : undefined;
  const rolePackagesByRoleId = await loadRolePackages({
    system,
    roleRootDir
  });
  const modelsById = await loadModelPackages({
    system,
    modelRootDir: modelRepoDir
  });
  const compilerResult = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    contractPlan,
    effectiveLaw
  });
  if (!compilerResult.ok) {
    throw new Error(
      `Compiler static semantics check failed:\n${formatCompilerDiagnosticsMessage(
        compilerResult.diagnostics
      )}`
    );
  }
  const planFingerprint = buildRunPlanFingerprint({
    system,
    rolePackagesByRoleId,
    modelsById,
    effectiveLaw,
    contractPlan,
    compilerSnapshot: compilerResult.snapshot
  });
  const resolvedConfigSnapshot: Record<string, unknown> = {
    version: 1,
    resolvedAt: new Date().toISOString(),
    sources: {
      runtimeConfigPath: args.runtimeConfigPath ?? ".ogs/runtime.json",
      userProfilePath: args.userProfilePath ?? ".ogs/user-profile.json",
      lawsPath: args.lawsPath ?? ".ogs/laws.json",
      profilesPath: args.profilesPath ?? null,
      toolsPath: args.toolsPath ?? null
    },
    effective: {
      runtimeConfig,
      roleRepoDir: roleRootDir,
      modelRepoDir,
      runsDir: resolve(args.workdir, runtimeConfig.runsDir),
      workdir: args.workdir,
      compiler: {
        digest: compilerResult.digest,
        diagnostics: compilerResult.diagnostics
      }
    }
  };
  const runContext = await initializeRunContext({
    system,
    systemPath: args.systemPath,
    prompt: args.prompt,
    workdir: args.workdir,
    runtimeConfig,
    resolvedConfigSnapshot,
    resumeRunDir: args.resumeRunDir
  });
  if (!args.resumeRunDir) {
    await persistRunPlanFingerprint({
      runDir: runContext.runDir,
      fingerprint: planFingerprint
    });
  }

  return {
    plan,
    effectiveLaw,
    contractPlan,
    profilesById: new Map(profiles.map((item) => [item.profileId, item])),
    toolsByRef: new Map(tools.map((item) => [item.toolRef, item])),
    modelsById,
    userProfile,
    rolePackagesByRoleId,
    compilerSnapshot: compilerResult.snapshot,
    runContext,
    planFingerprint,
    runtimeConfig
  };
}
