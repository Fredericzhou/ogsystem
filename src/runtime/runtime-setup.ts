import { resolve } from "node:path";

import { resolveProjectRoleRootDir } from "./bundled-repos.js";
import {
  compileExecutionSnapshot,
  validateRoleContract,
  type CompiledExecutionSnapshot
} from "./compiler.js";
import { createExecutionPlan } from "./execution-plan.js";
import { loadFlowContractPlan } from "./flow-contract.js";
import { loadModelCatalog } from "./model-catalog.js";
import { loadModelSelection, resolveModelSelectionForSystem } from "./model-selection.js";
import { loadSystemFromMermaid } from "./parse-mermaid.js";
import { buildRunPlanFingerprint } from "./plan-fingerprint.js";
import { filesystemRunStore } from "./run-store.js";
import { loadOgsSpecification, type OgsSpecificationSnapshot } from "./ogs-spec-loader.js";
import { compileSemanticIR } from "./semantic-ir-compiler.js";
import type { SemanticIR } from "./semantic-ir.js";
import { resolveProjectTargetDirectory } from "./project-target.js";
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

function schemaProperties(value: unknown): Set<string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Set();
  const properties = (value as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return new Set();
  return new Set(Object.keys(properties as Record<string, unknown>));
}

export function validateSemanticRoleContracts(args: { semanticIR: SemanticIR; specification: OgsSpecificationSnapshot; rolePackagesByRoleId: Map<string, LoadedRolePackage> }): void {
  const stateSource = Object.entries(args.specification.sources).find(([path]) => path === args.semanticIR.stateSchema.ref || path.endsWith("/" + args.semanticIR.stateSchema.ref) || path.endsWith("/" + args.semanticIR.stateSchema.ref.split("/").at(-1)));
  const stateFields = new Set(Object.keys((stateSource?.[1].value as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}));
  const writableByField = args.semanticIR.stateSchema.writableRolesByField ?? {};
  for (const [roleId, rolePackage] of args.rolePackagesByRoleId) {
    const contract = rolePackage.manifest;
    const composite = args.semanticIR.composites?.find((item) => item.ownerRoleId === roleId);
    if ((contract.responsibility.kind === "composite") !== Boolean(composite)) {
      throw new Error(`[IR_COMPOSITE_INVALID] Role ${roleId} responsibility kind does not match Semantic IR composition`);
    }
    if (composite && JSON.stringify(contract.responsibility.composition) !== JSON.stringify({
      nestedSystemRef: composite.nestedSystemRef,
      inputContract: composite.inputContract,
      outputContract: composite.outputContract,
      stateNamespace: composite.stateNamespace,
      checkpointNamespace: composite.checkpointNamespace,
      errorPropagation: composite.errorPropagation,
      terminationPropagation: composite.terminationPropagation
    })) throw new Error(`[IR_COMPOSITE_INVALID] Role ${roleId} composition contract does not match Semantic IR`);
    const retryPolicy = args.semanticIR.retryByRoleId?.[roleId];
    const contractRetryCodes = contract.failure.retryableErrorCodes;
    const policyRetryCodes = retryPolicy?.errorCodes ?? [];
    if (contractRetryCodes.length || policyRetryCodes.length) {
      if (!retryPolicy || contractRetryCodes.length !== policyRetryCodes.length || contractRetryCodes.some((code, index) => code !== policyRetryCodes[index])) {
        throw new Error(`[IR_CONTRACT_INVALID] ${roleId} retryable error codes do not match retryByRoleId`);
      }
    }
    for (const field of contract.constraints.writableStateFields) {
      if (!stateFields.has(field) || !writableByField[field]?.includes(roleId)) throw new Error(`[IR_CONTRACT_INVALID] ${roleId} may not write state field ${field}`);
    }
    for (const field of contract.responsibility.owns) {
      if (!contract.constraints.writableStateFields.includes(field)) throw new Error(`[IR_CONTRACT_INVALID] ${roleId} owns ${field} but may not write it`);
    }
    for (const field of contract.responsibility.doesNotOwn) {
      if (contract.constraints.writableStateFields.includes(field)) throw new Error(`[IR_CONTRACT_INVALID] ${roleId} doesNotOwn ${field} but may write it`);
    }
    const outputFields = new Set<string>();
    for (const eventType of contract.outputs.events) {
      const event = args.semanticIR.events?.[eventType];
      for (const field of schemaProperties(event?.payloadSchema)) outputFields.add(field);
    }
    for (const field of contract.responsibility.contributes) {
      if (!stateFields.has(field) && !outputFields.has(field)) {
        throw new Error(`[IR_CONTRACT_INVALID] ${roleId} contributes unknown state or declared output field ${field}`);
      }
    }
    if (!Object.prototype.hasOwnProperty.call(args.semanticIR.capabilities.allowedToolsByRoleId, roleId)) {
      throw new Error(`[IR_CONTRACT_INVALID] capability policy must declare tools for role ${roleId}`);
    }
    const allowedTools = args.semanticIR.capabilities.allowedToolsByRoleId[roleId];
    if (!contract.constraints.allowedTools.every((tool) => allowedTools.includes(tool))) throw new Error(`[IR_CONTRACT_INVALID] ${roleId} contract requests tools outside capability policy`);
  }
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
  targetDir: string;
  specificationSnapshot?: OgsSpecificationSnapshot;
  semanticIR?: SemanticIR;
  semanticIRDigest?: string;
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
  targetDir?: string;
  dryRun?: boolean;
}): Promise<RuntimeAdapterSetup> {
  const targetDir = await resolveProjectTargetDirectory({
    workdir: args.workdir,
    targetDir: args.targetDir,
    resumeRunDir: args.resumeRunDir
  });
  let specificationSnapshot: OgsSpecificationSnapshot | undefined;
  const semanticCandidates = ["semantics.yaml", "semantics.yml", "semantics.json"];
  for (const candidate of semanticCandidates) {
    if (await filesystemRunStore.pathExists(resolve(args.workdir, ".ogs", candidate))) {
      specificationSnapshot = await loadOgsSpecification(args.workdir);
      break;
    }
  }
  const system = await loadSystemFromMermaid(args.systemPath);
  if (
    specificationSnapshot &&
    (specificationSnapshot.systemId !== system.systemId ||
      specificationSnapshot.systemVersion !== system.systemVersion)
  ) {
    throw new Error(
      `OGS specification system mismatch: Mermaid is ${system.systemId}@${system.systemVersion}, ` +
        `semantic files are ${specificationSnapshot.systemId}@${specificationSnapshot.systemVersion}`
    );
  }
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
  let compiledSemanticIR = specificationSnapshot
    ? compileSemanticIR({
        system,
        specification: specificationSnapshot,
        maxTransitionsPerRun: effectiveLaw.maxTransitions ?? 100
      })
    : undefined;
  if (compiledSemanticIR) {
    plan.semanticIR = compiledSemanticIR.ir;
    for (const seat of compiledSemanticIR.ir.seats) {
      const node = plan.nodesByRoleId.get(seat.roleId);
      if (!node) continue;
      const executionMode = seat.defaultMode;
      const mode = executionMode ? seat.modes[executionMode] : undefined;
      const modeRecord = mode && typeof mode === "object" && !Array.isArray(mode)
        ? mode as Record<string, unknown>
        : undefined;
      const events = modeRecord?.events;
      node.executionMode = executionMode;
      if (Array.isArray(events) && events.every((event) => typeof event === "string")) {
        node.modeAllowedEvents = events as string[];
      }
    }
  }
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
  // Role Contracts are mandatory for every System, including plain Mermaid Systems without a semantic snapshot.
  const roleContractDiagnostics = system.roleIds.flatMap((roleId) => {
    const rolePackage = rolePackagesByRoleId.get(roleId);
    return rolePackage ? validateRoleContract({ system, basePlan: plan, roleId, rolePackage }) : [];
  });
  if (roleContractDiagnostics.length > 0) {
    throw new Error(
      `Role Contract validation failed:\n${roleContractDiagnostics.map((diagnostic) => diagnostic.message).join("\n")}`
    );
  }
  // Recompile with role contracts so the Semantic IR digest captures the executable responsibility boundary.
  if (specificationSnapshot) {
    const contractedSemanticIR = compileSemanticIR({
      system,
      specification: specificationSnapshot,
      maxTransitionsPerRun: effectiveLaw.maxTransitions ?? 100,
      rolePackagesByRoleId
    });
    validateSemanticRoleContracts({ semanticIR: contractedSemanticIR.ir, specification: specificationSnapshot, rolePackagesByRoleId });
    if (contractedSemanticIR.ir.composites?.length) {
      throw new Error("[IR_COMPOSITE_UNSUPPORTED] Composite responsibilities compile successfully but nested System execution is not implemented");
    }
    plan.semanticIR = contractedSemanticIR.ir;
    compiledSemanticIR = contractedSemanticIR;
  }
  const compilerResult = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    contractPlan,
    effectiveLaw,
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId,
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
    compilerSnapshot: compilerResult.snapshot,
    specificationDigest: compiledSemanticIR?.digest ?? specificationSnapshot?.digest
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
      invocation: {
        dryRun: args.dryRun === true
      },
      resolvedModelSelection: Object.fromEntries(
        Array.from(resolvedModelSelection.resolvedByRoleId.entries()).map(([roleId, selection]) => [
          roleId,
          selection
        ])
      ),
      advisoryWarnings: resolvedModelSelection.warnings,
      runsDir: resolve(args.workdir, runtimeConfig.runsDir),
      workdir: args.workdir,
      targetDir,
      compiler: {
        digest: compilerResult.digest,
        diagnostics: compilerResult.diagnostics
      },
      specification: specificationSnapshot
        ? {
            digest: specificationSnapshot.digest,
            semanticIRDigest: compiledSemanticIR?.digest,
            specVersion: specificationSnapshot.specVersion,
            systemId: specificationSnapshot.systemId,
            systemVersion: specificationSnapshot.systemVersion
          }
        : undefined
      , semanticIR: compiledSemanticIR?.ir
    }
  };
  const runContext = await filesystemRunStore.initialize({
    system,
    systemPath: args.systemPath,
    prompt: args.prompt,
    workdir: args.workdir,
    runtimeConfig,
    resolvedConfigSnapshot,
    resumeRunDir: args.resumeRunDir
  });
  if (!args.resumeRunDir) {
    await filesystemRunStore.persistPlanFingerprint({
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
    runtimeConfig,
    targetDir,
    specificationSnapshot,
    semanticIR: compiledSemanticIR?.ir,
    semanticIRDigest: compiledSemanticIR?.digest
  };
}
