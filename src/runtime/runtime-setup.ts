import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveProjectRoleRootDir } from "./bundled-repos.js";
import {
  compileExecutionSnapshot,
  validateRoleContract,
  type CompiledExecutionSnapshot
} from "./compiler.js";
import { createExecutionPlan } from "./execution-plan.js";
import { loadFlowContractPlan } from "./flow-contract.js";
import { loadModelCatalog, mergeModelCatalogWithLiveSnapshot } from "./model-catalog.js";
import { loadModelSelection, resolveModelSelectionForSystem, withDefaultModelSelection } from "./model-selection.js";
import { loadSystemFromMermaid, parseSystemFromMermaidSource } from "./parse-mermaid.js";
import { buildRunPlanFingerprint } from "./plan-fingerprint.js";
import { filesystemRunStore } from "./run-store.js";
import { loadOgsSpecification, type OgsSpecificationSnapshot } from "./ogs-spec-loader.js";
import { compileSemanticIR } from "./semantic-ir-compiler.js";
import type { SemanticIR } from "./semantic-ir.js";
import { designDigest, designToSystemDefinition, loadSystemDesign } from "../design/index.js";
import { resolveProjectTargetDirectory } from "./project-target.js";
import { assertProjectAssetSnapshot, snapshotProjectAssets } from "./project-run-snapshot.js";
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
  ModelCatalogEntry,
  ModelSelectionDefaults,
  RuntimeConfig,
  RunContext,
  SystemDefinition,
  UserProfile
} from "./types.js";

const PROJECT_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function sameEvidenceFile(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
    && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

async function assertProjectRunPath(projectRoot: string, runId: string): Promise<string> {
  if (!PROJECT_RUN_ID.test(runId)) throw new Error("RUN_RESUME_INVALID: Project Run resume requires a relative Run ID.");
  let current = resolve(projectRoot);
  const rootInfo = await lstat(current);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("RUN_EVIDENCE_PATH_INVALID: Project Run root must be a real directory.");
  }
  for (const segment of [".ogs", "runs", runId]) {
    current = resolve(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("RUN_EVIDENCE_PATH_INVALID: Project Run path contains a linked or non-directory component.");
    }
  }
  return current;
}

async function readProjectRunEvidenceFile(projectRoot: string, runId: string, name: string): Promise<string> {
  if (!new Set(["run-owner.json", "run-plan.json", "task.json"]).has(name)) {
    throw new Error("RUN_EVIDENCE_PATH_INVALID: unsupported Project Run evidence file.");
  }
  const runDir = await assertProjectRunPath(projectRoot, runId);
  const path = resolve(runDir, name);
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error("RUN_EVIDENCE_PATH_INVALID: Project Run evidence must be a regular file.");
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    const after = await lstat(path);
    await assertProjectRunPath(projectRoot, runId);
    if (!opened.isFile() || after.isSymbolicLink() || !sameEvidenceFile(before, opened) || !sameEvidenceFile(opened, after)) {
      throw new Error("RUN_EVIDENCE_RACE: Project Run evidence changed while it was opened.");
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

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
  systemBaseDir?: string;
  profilesPath?: string;
  toolsPath?: string;
  lawsPath?: string;
  runtimeConfigPath?: string;
  userProfilePath?: string;
  modelSelectionDefaults?: ModelSelectionDefaults;
  modelCatalogModels?: ModelCatalogEntry[];
  modelCatalogGeneratedAt?: string;
  resumeRunDir?: string;
  runId?: string;
  projectId?: string;
  prompt: string;
  workdir: string;
  assetSource?: string;
  runEvidenceRoot?: string;
  targetDir?: string;
  dryRun?: boolean;
  executionMode?: "dry-run" | "sandbox" | "real";
  runKind?: "project_task" | "studio_simulation";
  owner?: {
    kind: "project_task";
    projectId: string;
    taskId: string;
    taskNumber: number;
    attemptNumber: number;
    runId: string;
    teamVersionId: string;
    teamCoreDigest?: string;
    teamDigestVersion?: number;
  };
}): Promise<RuntimeAdapterSetup> {
  const projectRun = args.runKind === "project_task";
  if (projectRun && !args.executionMode) throw new Error("PROJECT_RUN_MODE_REQUIRED: Project Task Runtime requires an explicit execution mode.");
  if (projectRun && (!args.owner || args.owner.kind !== "project_task"
    || args.owner.projectId !== args.projectId || !args.owner.taskId
    || args.owner.runId !== args.runId || !args.owner.teamVersionId)) {
    throw new Error("PROJECT_RUN_OWNER_INVALID: Runtime setup requires a matching Project Task owner.");
  }
  const projectResume = projectRun && Boolean(args.resumeRunDir);
  const runEvidenceRoot = args.runEvidenceRoot
    ? resolve(args.runEvidenceRoot)
    : undefined;
  if (projectRun && !runEvidenceRoot) throw new Error("PROJECT_RUN_EVIDENCE_ROOT_REQUIRED: Project Task Runtime requires the owning Project root.");
  const resumeRoot = runEvidenceRoot
    ? resolve(runEvidenceRoot, ".ogs", "runs")
    : args.workdir;
  let projectResumePlan;
  if (projectResume) {
    const resumeRunId = args.resumeRunDir!;
    if (resumeRunId !== args.owner!.runId) throw new Error("RUN_RESUME_INVALID: resume Run ID does not match its owner.");
    await assertProjectRunPath(runEvidenceRoot!, resumeRunId);
    const persistedOwner = JSON.parse(await readProjectRunEvidenceFile(runEvidenceRoot!, resumeRunId, "run-owner.json"));
    const owner = args.owner!;
    if (persistedOwner?.version !== 1 || persistedOwner.runKind !== "project_task"
      || persistedOwner.projectId !== args.projectId || persistedOwner.projectId !== owner.projectId
      || persistedOwner.taskId !== owner.taskId || persistedOwner.taskNumber !== owner.taskNumber
      || persistedOwner.attemptNumber !== owner.attemptNumber || persistedOwner.runId !== resumeRunId
      || persistedOwner.teamVersionId !== owner.teamVersionId
      || (owner.teamCoreDigest && persistedOwner.teamCoreDigest !== owner.teamCoreDigest)
      || (owner.teamDigestVersion !== undefined && persistedOwner.teamDigestVersion !== owner.teamDigestVersion)) {
      throw new Error("RUN_RESUME_INVALID: persisted Run owner does not match the Project Task owner.");
    }
    projectResumePlan = JSON.parse(await readProjectRunEvidenceFile(runEvidenceRoot!, resumeRunId, "run-plan.json"));
    if (!projectResumePlan || typeof projectResumePlan !== "object") throw new Error("RUN_RESUME_INVALID: Run plan is invalid.");
  }
  const projectResumeManifestDigest = typeof projectResumePlan?.projectAssetManifestDigest === "string"
    ? projectResumePlan.projectAssetManifestDigest
    : undefined;
  if (projectResume && !projectResumeManifestDigest) {
    throw new Error("RUN_SNAPSHOT_INVALID: project resume requires a manifest digest in run-plan.json.");
  }
  const assetWorkdir = projectResume
    ? await assertProjectAssetSnapshot(resolve(resumeRoot, args.resumeRunDir!), projectResumeManifestDigest)
    : resolve(args.assetSource ?? args.workdir);
  const effectiveSystemPath = projectResume
    ? resolve(assetWorkdir, "system.mmd")
    : args.systemPath;
  const targetDir = await resolveProjectTargetDirectory({
    workdir: args.workdir,
    targetDir: args.targetDir,
    resumeRunDir: args.resumeRunDir
  });
  let specificationSnapshot: OgsSpecificationSnapshot | undefined;
  const semanticCandidates = ["semantics.yaml", "semantics.yml", "semantics.json"];
  for (const candidate of semanticCandidates) {
    if (await filesystemRunStore.pathExists(resolve(assetWorkdir, ".ogs", candidate))) {
      specificationSnapshot = await loadOgsSpecification(assetWorkdir);
      break;
    }
  }
  const projectDesign = await loadSystemDesign(assetWorkdir);
  const requestedProjectMermaid = resolve(effectiveSystemPath) === resolve(assetWorkdir, "system.mmd");
  const activeDesign = projectDesign && (requestedProjectMermaid || effectiveSystemPath.endsWith("system.design.json"))
    ? projectDesign
    : undefined;
  let system = activeDesign
    ? designToSystemDefinition(activeDesign)
    : await loadSystemFromMermaid(effectiveSystemPath);
  if (!activeDesign && args.systemBaseDir && system.graph?.handoffContracts) {
    const sourceSystem = parseSystemFromMermaidSource(await readFile(effectiveSystemPath, "utf8"));
    if (sourceSystem.graph?.handoffContracts) {
      system = {
        ...system,
        graph: { ...system.graph, handoffContracts: resolve(projectResume ? assetWorkdir : args.systemBaseDir, sourceSystem.graph.handoffContracts) }
      };
    }
  }
  if (
    specificationSnapshot &&
    (specificationSnapshot.systemId !== system.systemId ||
      specificationSnapshot.systemVersion !== system.systemVersion)
  ) {
    throw new Error(
      `OGS specification system mismatch: design is ${system.systemId}@${system.systemVersion}, ` +
        `semantic files are ${specificationSnapshot.systemId}@${specificationSnapshot.systemVersion}`
    );
  }
  const runtimeConfig = await loadRuntimeConfig(projectResume ? undefined : args.runtimeConfigPath, assetWorkdir);
  const storedModelSelection = await loadModelSelection(resolve(assetWorkdir, ".ogs", "model-selection.json"));
  const effectiveModelSelection = withDefaultModelSelection(storedModelSelection, args.modelSelectionDefaults);
  const designModelOverrides = activeDesign
    ? Object.fromEntries(Object.entries(activeDesign.seats).flatMap(([roleId, seat]) => {
        if (seat.binding.kind !== "model" || !seat.binding.modelRef) return [];
        const separator = seat.binding.modelRef.indexOf("/");
        if (separator <= 0 || separator === seat.binding.modelRef.length - 1) return [];
        return [[roleId, {
          backend: seat.binding.modelRef.slice(0, separator),
          modelId: seat.binding.modelRef.slice(separator + 1)
        }]];
      }))
    : {};
  const modelSelection = activeDesign && Object.keys(designModelOverrides).length
    ? {
        configVersion: "2" as const,
        defaults: effectiveModelSelection?.defaults,
        roles: { ...(effectiveModelSelection?.roles ?? {}), ...designModelOverrides }
      }
    : effectiveModelSelection;
  const storedModelCatalog = await loadModelCatalog(resolve(assetWorkdir, ".ogs", "model-catalog.json"));
  const modelCatalog = mergeModelCatalogWithLiveSnapshot(
    storedModelCatalog,
    args.modelCatalogModels,
    args.modelCatalogGeneratedAt
  );
  const resolvedModelSelection = resolveModelSelectionForSystem({
    system: activeDesign ? { ...system, modelBinding: {} } : system,
    selection: modelSelection,
    catalog: modelCatalog
  });
  const plan = createExecutionPlan(system, resolvedModelSelection.resolvedByRoleId);
  const resolvedProfilesPath = resolveOptionalProjectPath({
    workdir: assetWorkdir,
    explicitPath: projectResume ? undefined : args.profilesPath,
    defaultBasename: "profiles.json"
  });
  const resolvedToolsPath = resolveOptionalProjectPath({
    workdir: assetWorkdir,
    explicitPath: projectResume ? undefined : args.toolsPath,
    defaultBasename: "tools.json"
  });
  const profiles = await loadProfiles(projectResume ? undefined : args.profilesPath, assetWorkdir);
  const tools = await loadTools(projectResume ? undefined : args.toolsPath, assetWorkdir);
  const lawCatalog = await loadLaws(projectResume ? undefined : args.lawsPath, assetWorkdir);
  const userProfile = await loadUserProfile(projectResume ? undefined : args.userProfilePath, assetWorkdir);
  const baseLaw = resolveEffectiveLaw(system, lawCatalog);
  const effectiveLaw = activeDesign
    ? {
        ...baseLaw,
        forbiddenToolRefs: Array.from(new Set([
          ...baseLaw.forbiddenToolRefs,
          ...(activeDesign.policies.forbiddenToolRefs ?? [])
        ])),
        maxTransitions: activeDesign.policies.maxTransitionsPerRun === undefined
          ? baseLaw.maxTransitions
          : baseLaw.maxTransitions === undefined
            ? activeDesign.policies.maxTransitionsPerRun
            : Math.min(baseLaw.maxTransitions, activeDesign.policies.maxTransitionsPerRun),
        allowNoopWithoutExecutionBinding: activeDesign.policies.allowNoopWithoutExecutionBinding ?? baseLaw.allowNoopWithoutExecutionBinding
      }
    : baseLaw;
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
  const roleRootDir = resolveProjectRoleRootDir(assetWorkdir, runtimeConfig.roleRepo);
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
    specificationDigest: compiledSemanticIR?.digest ?? specificationSnapshot?.digest,
    designDigest: projectDesign ? designDigest(projectDesign) : undefined,
    runtimeConfig,
    profiles,
    tools,
    userProfile
  });
  const resolvedConfigSnapshot: Record<string, unknown> = {
    version: 1,
    resolvedAt: new Date().toISOString(),
    sources: {
      runtimeConfigPath: projectResume ? resolve(assetWorkdir, ".ogs/runtime.json") : args.runtimeConfigPath ?? ".ogs/runtime.json",
      designPath: activeDesign ? "system.design.json" : null,
      modelSelectionPath: ".ogs/model-selection.json",
      modelCatalogPath: ".ogs/model-catalog.json",
      userProfilePath: projectResume ? resolve(assetWorkdir, ".ogs/user-profile.json") : args.userProfilePath ?? ".ogs/user-profile.json",
      lawsPath: projectResume ? resolve(assetWorkdir, ".ogs/laws.json") : args.lawsPath ?? ".ogs/laws.json",
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
      runsDir: projectRun
        ? resolve(runEvidenceRoot!, ".ogs/runs")
        : resolve(runEvidenceRoot ?? args.workdir, runtimeConfig.runsDir),
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
      , design: activeDesign ? {
        path: "system.design.json",
        revision: activeDesign.revision,
        digest: designDigest(activeDesign)
      } : undefined
    }
  };
  const runRuntimeConfig = projectRun
    ? { ...runtimeConfig, runsDir: ".ogs/runs", sharedDir: undefined }
    : runtimeConfig;
  const runContext = await filesystemRunStore.initialize({
    system,
    systemPath: effectiveSystemPath,
    prompt: args.prompt,
    workdir: args.workdir,
    runtimeConfig: runRuntimeConfig,
    resolvedConfigSnapshot,
    resumeRunDir: args.resumeRunDir,
    runId: args.runId,
    runEvidenceRoot
  });
  if (!args.resumeRunDir) {
    await filesystemRunStore.persistPlanFingerprint({
      runDir: runContext.runDir,
      fingerprint: planFingerprint
    });
  }
  if (projectRun && !args.resumeRunDir) {
    await snapshotProjectAssets({
      sourceWorkdir: assetWorkdir,
      runDir: runContext.runDir,
      runtimeConfig,
      additionalFiles: typeof system.graph?.handoffContracts === "string"
        ? [system.graph.handoffContracts]
        : undefined
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
