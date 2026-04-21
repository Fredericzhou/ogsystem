import { resolve } from "node:path";

import { resolveProjectRoleRootDir } from "./bundled-repos.js";
import { compileExecutionSnapshot, type CompiledExecutionSnapshot } from "./compiler.js";
import { createExecutionPlan } from "./execution-plan.js";
import { loadFlowContractPlan } from "./flow-contract.js";
import { loadModelCatalog } from "./model-catalog.js";
import { loadModelSelection, resolveModelSelectionForSystem } from "./model-selection.js";
import { loadSystemFromMermaid } from "./parse-mermaid.js";
import { buildRunPlanFingerprint } from "./plan-fingerprint.js";
import { initializeRunContext, persistRunPlanFingerprint } from "./run-artifacts.js";
import {
  loadLaws,
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
  LoadedRolePackage,
  RuntimeConfig,
  RunContext,
  SystemDefinition,
  UserProfile
} from "./types.js";

function resolveOptionalProjectPath(args: {
  workdir: string;
  explicitPath?: string;
  defaultBasename: string;
}): string | undefined {
  return args.explicitPath ?? resolve(args.workdir, args.defaultBasename);
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
  const runtimeConfig = await loadRuntimeConfig(args.runtimeConfigPath, args.workdir);
  const modelSelection = await loadModelSelection(resolve(args.workdir, ".ogs", "model-selection.json"));
  const modelCatalog = await loadModelCatalog(resolve(args.workdir, ".ogs", "model-catalog.json"));
  const resolvedModelSelection = resolveModelSelectionForSystem({
    system,
    selection: modelSelection,
    catalog: modelCatalog
  });
  const plan = createExecutionPlan(system, resolvedModelSelection.resolvedByRoleId);
  const resolvedProfilesPath = resolveOptionalProjectPath({
    workdir: args.workdir,
    explicitPath: args.profilesPath,
    defaultBasename: "profiles.json"
  });
  const resolvedToolsPath = resolveOptionalProjectPath({
    workdir: args.workdir,
    explicitPath: args.toolsPath,
    defaultBasename: "tools.json"
  });
  const profiles = await loadProfiles(args.profilesPath, args.workdir);
  const tools = await loadTools(args.toolsPath, args.workdir);
  const lawCatalog = await loadLaws(args.lawsPath, args.workdir);
  const userProfile = await loadUserProfile(args.userProfilePath, args.workdir);
  const effectiveLaw = resolveEffectiveLaw(system, lawCatalog);
  const roleRootDir = resolveProjectRoleRootDir(args.workdir, runtimeConfig.roleRepo);
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
  const compilerResult = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    contractPlan,
    effectiveLaw,
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId
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
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId,
    effectiveLaw,
    contractPlan,
    compilerSnapshot: compilerResult.snapshot
  });
  const resolvedConfigSnapshot: Record<string, unknown> = {
    version: 1,
    resolvedAt: new Date().toISOString(),
    sources: {
      runtimeConfigPath: args.runtimeConfigPath ?? ".ogs/runtime.json",
      modelSelectionPath: ".ogs/model-selection.json",
      modelCatalogPath: ".ogs/model-catalog.json",
      userProfilePath: args.userProfilePath ?? ".ogs/user-profile.json",
      lawsPath: args.lawsPath ?? ".ogs/laws.json",
      profilesPath: profiles.length > 0 ? resolvedProfilesPath ?? null : null,
      toolsPath: tools.length > 0 ? resolvedToolsPath ?? null : null
    },
    effective: {
      runtimeConfig,
      roleRepoDir: roleRootDir,
      resolvedModelSelection: Object.fromEntries(
        Array.from(resolvedModelSelection.resolvedByRoleId.entries()).map(([roleId, selection]) => [
          roleId,
          selection
        ])
      ),
      advisoryWarnings: resolvedModelSelection.warnings,
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
    userProfile,
    rolePackagesByRoleId,
    compilerSnapshot: compilerResult.snapshot,
    runContext,
    planFingerprint,
    runtimeConfig
  };
}
