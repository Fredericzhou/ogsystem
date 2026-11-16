import { constants } from "node:fs";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveProjectRoleRootDir } from "./bundled-repos.js";
import {
  compileExecutionSnapshot,
  validateRoleContract,
  type CompiledExecutionSnapshot
} from "./compiler.js";
import { createExecutionPlan } from "./execution-plan.js";
import { assertNoLegacyV1ExecutionAssets, loadExecutionBindingsV2 } from "./contract-v2-loader.js";
import type { HarnessTemplateV2, ExecutionBindingsV2 } from "./contract-v2.js";
import { loadFlowContractPlan } from "./flow-contract.js";
import { loadModelCatalog, mergeModelCatalogWithLiveSnapshot } from "./model-catalog.js";
import { resolveModelSelectionForSystem } from "./model-selection.js";
import { loadSystemFromMermaid, parseSystemFromMermaidSource } from "./parse-mermaid.js";
import { buildRunPlanFingerprint } from "./plan-fingerprint.js";
import { createRuntimeError } from "./runtime-errors.js";
import { filesystemRunStore } from "./run-store.js";
import { loadOgsSpecification, type OgsSpecificationSnapshot } from "./ogs-spec-loader.js";
import { compileSemanticIR } from "./semantic-ir-compiler.js";
import { defaultBackendRegistry } from "./model-backend-registry.js";
import {
  assertCapabilitySnapshot,
  createEffectiveExecutionPolicy,
  createRunCapabilitySnapshot,
  resolveEffectiveEnvironmentPolicy
} from "./v2-execution-policy.js";
import type { SemanticIR } from "./semantic-ir.js";
import { designDigest, designToSystemDefinition, loadSystemDesign } from "../design/index.js";
import { resolveProjectTargetDirectory } from "./project-target.js";
import { assertProjectAssetSnapshot, snapshotProjectAssets } from "./project-run-snapshot.js";
import {
  loadLaws,
  loadRolePackages,
  loadRuntimeConfig,
  loadUserProfile
} from "./runtime-loader.js";
import { createRunId } from "./run-artifacts.js";
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
  ReasoningEffortLevel,
  RuntimeConfig,
  RunContext,
  SystemDefinition,
  UserProfile
} from "./types.js";

/** Freeze the technical decision for every model node before a Backend session starts. */
async function materializeV2ExecutionPolicies(
  plan: ExecutionPlan,
  runRoot: string,
  frozenByRoleId?: Record<string, Record<string, unknown>>,
  harnessTemplatesByRoleId?: Record<string, HarnessTemplateV2>,
  options?: { skipCapabilityDiscovery?: boolean }
): Promise<Record<string, Record<string, unknown>>> {
  if (Object.keys(harnessTemplatesByRoleId ?? {}).length > 0) await mkdir(runRoot, { recursive: true });
  const resolved: Record<string, Record<string, unknown>> = {};
  const discoveryByBackendModel = new Map<string, { verifiedTools: string[]; resources?: { filesystem: boolean; process: boolean; network: boolean } }>();
  for (const roleId of plan.roleIds) {
    const node = plan.nodesByRoleId.get(roleId);
    if (!node || node.binding.kind !== "model") continue;
    const adapter = defaultBackendRegistry.getAdapter(node.binding.backend);
    const template = harnessTemplatesByRoleId?.[roleId];
    if (template && !adapter) throw new Error(`V2_HARNESS_BACKEND_UNAVAILABLE: ${node.binding.backend}`);
    const adapterVersion = adapter?.adapterVersion ?? `unversioned:${node.binding.backend}`;
    const frozen = frozenByRoleId?.[roleId];
    let snapshot = frozen?.capabilitySnapshot as import("./v2-execution-policy.js").RunCapabilitySnapshot | undefined;
    if (snapshot) {
      assertCapabilitySnapshot(snapshot);
      if (snapshot.backend !== node.binding.backend || snapshot.model !== node.binding.modelId) {
        throw new Error(`V2_RECOVERY_SNAPSHOT_MISMATCH: ${roleId} capability identity changed during recovery`);
      }
    } else {
      snapshot = createRunCapabilitySnapshot({
        backend: node.binding.backend,
        model: node.binding.modelId,
        adapterVersion,
        verifiedAt: new Date().toISOString(),
        // Dry-run planning does not execute an Adapter probe. It therefore has
        // no verified native capability facts and must never promote the
        // Harness allow-list into the frozen snapshot.
        verifiedTools: []
      });
    }
    // A resume is a replay of the original technical decision.  Do not
    // recalculate the tool set or policy from the current Harness Template:
    // the project may have been edited after the Run was created.  The
    // resolved config is the immutable source for recovery.
    if (frozen) {
      const frozenAllowedTools = frozen.allowedTools;
      const frozenVerifiedTools = frozen.verifiedTools;
      const frozenEnvironment = frozen.effectiveEnvironmentPolicy;
      const frozenPolicyDigest = frozen.policyDigest;
      const frozenRecoveryIdentity = frozen.recoveryIdentity;
      if (!Array.isArray(frozenAllowedTools) || !frozenAllowedTools.every((tool) => typeof tool === "string")
        || !Array.isArray(frozenVerifiedTools) || !frozenVerifiedTools.every((tool) => typeof tool === "string")
        || !frozenEnvironment || typeof frozenEnvironment !== "object" || Array.isArray(frozenEnvironment)
        || typeof frozenPolicyDigest !== "string" || !frozenPolicyDigest
        || typeof frozenRecoveryIdentity !== "string" || !frozenRecoveryIdentity) {
        throw new Error(`V2_RECOVERY_FROZEN_CONFIG_INVALID: ${roleId} resolved technical binding is incomplete`);
      }
      if (frozen.capabilityDigest !== undefined && frozen.capabilityDigest !== snapshot.digest) {
        throw new Error(`V2_RECOVERY_SNAPSHOT_MISMATCH: ${roleId} capability digest changed during recovery`);
      }
      const environment = frozenEnvironment as import("./v2-execution-policy.js").EffectiveEnvironmentPolicy;
      const verifiedFrozenPolicy = createEffectiveExecutionPolicy({
        allowedTools: frozenAllowedTools as string[],
        snapshot,
        environment
      });
      if (verifiedFrozenPolicy.policyDigest !== frozenPolicyDigest) {
        throw new Error(`V2_RECOVERY_FROZEN_CONFIG_INVALID: ${roleId} frozen policy digest does not match its facts`);
      }
      node.capabilitySnapshot = snapshot;
      node.effectiveTools = [...verifiedFrozenPolicy.effectiveTools];
      node.effectiveEnvironmentPolicy = environment;
      node.capabilityDigest = snapshot.digest;
      node.policyDigest = frozenPolicyDigest;
      node.recoveryIdentity = frozenRecoveryIdentity;
      resolved[roleId] = {
        roleId,
        backend: node.binding.backend,
        model: node.binding.modelId,
        harnessTemplate: frozen.harnessTemplate,
        allowedTools: [...frozenAllowedTools] as string[],
        capabilitySnapshot: snapshot,
        verifiedTools: [...frozenVerifiedTools] as string[],
        effectiveEnvironmentPolicy: environment,
        capabilityDigest: snapshot.digest,
        policyDigest: frozenPolicyDigest,
        recoveryIdentity: frozenRecoveryIdentity
      };
      continue;
    }
    const discoveryKey = `${node.binding.backend}:${node.binding.modelId}`;
    let discovered = discoveryByBackendModel.get(discoveryKey);
    if (template && !frozen && !options?.skipCapabilityDiscovery && !discovered && adapter?.discoverNativeTools) {
      discovered = await adapter.discoverNativeTools({
        modelId: node.binding.modelId,
        workdir: runRoot,
        timeoutMs: node.binding.timeoutMs ?? 600_000
      });
      discoveryByBackendModel.set(discoveryKey, discovered);
    }
    if (template && template.allowedTools.length > 0 && !frozen && !options?.skipCapabilityDiscovery && !discovered) {
      throw new Error(`V2_CAPABILITY_DISCOVERY_UNAVAILABLE: ${node.binding.backend} does not expose native tool discovery`);
    }
    if (template && template.allowedTools.length > 0 && !frozen && options?.skipCapabilityDiscovery) {
      throw new Error(`V2_CAPABILITY_DISCOVERY_REQUIRED: dry-run cannot verify Harness tools; refresh Capability Preview or run without dry-run`);
    }
    const resources = discovered?.resources ?? adapter?.getResourceCapabilities?.() ?? { filesystem: true, process: false, network: false };
    if (discovered && !frozen) {
      snapshot = createRunCapabilitySnapshot({
        backend: node.binding.backend,
        model: node.binding.modelId,
        adapterVersion,
        verifiedAt: new Date().toISOString(),
        verifiedTools: discovered.verifiedTools
      });
    }
    const intent = template?.environment
      ? {
          filesystem: template.environment.filesystem,
          process: template.environment.process,
          network: template.environment.network,
          limits: template.environment.limits
        }
      : { filesystem: { read: true, write: false }, process: false, network: false };
    const environment = resolveEffectiveEnvironmentPolicy({
      root: runRoot,
      resources,
      intent,
      limits: {
        timeoutMs: node.binding.timeoutMs ?? 600_000,
        maxOutputBytes: node.binding.maxOutputBytes ?? 2 * 1024 * 1024,
        maxStorageBytes: 200 * 1024 * 1024
      }
      });
    const policy = createEffectiveExecutionPolicy({
      allowedTools: template?.allowedTools ?? [],
      snapshot,
      environment,
      validateToolResources: adapter?.validateToolResources?.bind(adapter)
    });
    const recoveryIdentity = `${plan.systemId}@${plan.systemVersion}:${roleId}:${snapshot.digest}:${policy.policyDigest}`;
    node.capabilitySnapshot = snapshot;
    node.effectiveTools = policy.effectiveTools;
    node.effectiveEnvironmentPolicy = environment;
    node.capabilityDigest = snapshot.digest;
    node.policyDigest = policy.policyDigest;
    node.recoveryIdentity = recoveryIdentity;
    resolved[roleId] = {
      roleId,
      backend: node.binding.backend,
      model: node.binding.modelId,
      harnessTemplate: template?.templateId,
      allowedTools: policy.allowedTools,
      capabilitySnapshot: snapshot,
      verifiedTools: policy.verifiedTools,
      effectiveEnvironmentPolicy: environment,
      capabilityDigest: snapshot.digest,
      policyDigest: policy.policyDigest,
      recoveryIdentity
    };
  }
  return resolved;
}

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

/**
 * Reads the canonical audit stream to recover reasoning values that were observed
 * during an earlier attempt. The stream is already part of the run evidence, so
 * resume does not create a second state file for provider defaults.
 */
async function loadFrozenReasoningFromAudit(runDir: string): Promise<Map<string, ReasoningEffortLevel>> {
  const frozen = new Map<string, ReasoningEffortLevel>();
  const eventsPath = resolve(runDir, "events.ndjson");
  const content = await readFile(eventsPath, "utf8").catch(() => "");
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      event = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type !== "audit" || event.requestedReasoningEffort !== "auto") continue;
    const roleId = typeof event.roleId === "string" ? event.roleId : undefined;
    const effective = typeof event.effectiveReasoningEffort === "string"
      && ["off", "on", "low", "medium", "high", "xhigh", "max"].includes(event.effectiveReasoningEffort)
      ? event.effectiveReasoningEffort as ReasoningEffortLevel
      : undefined;
    if (roleId && effective) frozen.set(roleId, effective);
  }
  return frozen;
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
    const roleEventTypes = args.semanticIR.transitions
      .filter((transition) => transition.fromRoleId === roleId && transition.channel === "normal")
      .map((transition) => transition.eventType);
    for (const eventType of roleEventTypes) {
      const event = args.semanticIR.events?.[eventType];
      for (const field of schemaProperties(event?.payloadSchema)) outputFields.add(field);
    }
    for (const field of contract.responsibility.contributes) {
      if (!stateFields.has(field) && !outputFields.has(field)) {
        throw new Error(`[IR_CONTRACT_INVALID] ${roleId} contributes unknown state or declared output field ${field}`);
      }
    }
  }
}

function mergeLawConstraints(base: EffectiveLawConstraints, spec?: LawSpec, allowGlobalIsolationOverride = false): EffectiveLawConstraints {
  if (!spec?.constraints) {
    return base;
  }

  const next: EffectiveLawConstraints = {
    forbiddenToolRefs: [...base.forbiddenToolRefs],
    maxTransitions: base.maxTransitions,
    allowNoopWithoutExecutionBinding: base.allowNoopWithoutExecutionBinding,
    maxPromptCharsPerRole: base.maxPromptCharsPerRole,
    maxTotalPromptCharsPerRun: base.maxTotalPromptCharsPerRun,
    isolateExternalData: base.isolateExternalData
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

  for (const key of ["maxPromptCharsPerRole", "maxTotalPromptCharsPerRun"] as const) {
    const candidate = spec.constraints[key];
    if (candidate === undefined) continue;
    const existing = base[key];
    if (existing !== undefined && candidate > existing) {
      throw new Error(`Law merge violation on ${spec.lawId}: ${key} cannot be relaxed (${candidate} > ${existing})`);
    }
    next[key] = candidate;
  }
  if (!allowGlobalIsolationOverride && base.isolateExternalData && spec.constraints.isolateExternalData === false) {
    throw new Error(`Law merge violation on ${spec.lawId}: isolateExternalData cannot be disabled`);
  }
  if (spec.constraints.isolateExternalData !== undefined) {
    next.isolateExternalData = spec.constraints.isolateExternalData;
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
    allowNoopWithoutExecutionBinding: false,
    isolateExternalData: true
  };

  if (!lawCatalog) {
    return defaultConstraints;
  }

  const lawsById = new Map(lawCatalog.laws.map((item) => [item.lawId, item]));
  const globalLaw = lawsById.get(system.lawBinding.globalLawRef);
  if (!globalLaw) {
    throw new Error(`Global law not found in catalog: ${system.lawBinding.globalLawRef}`);
  }

  return mergeLawConstraints(defaultConstraints, globalLaw, true);
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
  /** Mermaid source for regular runs; in-memory Role trials persist their SystemDefinition instead. */
  systemSource?: string;
};

export async function prepareRuntimeSetup(args: {
  systemPath: string;
  systemDefinition?: SystemDefinition;
  systemBaseDir?: string;
  profilesPath?: string;
  toolsPath?: string;
  lawsPath?: string;
  runtimeConfigPath?: string;
  userProfilePath?: string;
  modelCatalogModels?: ModelCatalogEntry[];
  modelCatalogGeneratedAt?: string;
  resumeRunDir?: string;
  runId?: string;
  projectId?: string;
  prompt: string;
  workdir: string;
  assetSource?: string;
  runEvidenceRoot?: string;
  runEvidenceDirectory?: string;
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
  // Recovery is anchored by the immutable resolved-config written in the Run
  // directory. It must remain possible even if the project Harness document
  // was edited or removed after the Run was created.
  const resumeEvidenceDir = args.resumeRunDir
    ? (projectResume
      ? resolve(resumeRoot, args.resumeRunDir)
      : (args.resumeRunDir.startsWith("/")
        ? resolve(args.resumeRunDir)
        : resolve(args.workdir, ".ogs", "runs", args.resumeRunDir)))
    : undefined;
  let frozenV2ExecutionPlans: Record<string, Record<string, unknown>> | undefined;
  let frozenResolvedConfig: Record<string, unknown> | undefined;
  if (resumeEvidenceDir) {
    frozenResolvedConfig = await readFile(resolve(resumeEvidenceDir, "resolved-config.json"), "utf8")
      .then((source) => JSON.parse(source) as Record<string, unknown>)
      .catch(() => undefined);
    const effective = frozenResolvedConfig?.effective;
    const previousPlans = effective && typeof effective === "object" && !Array.isArray(effective)
      ? (effective as Record<string, unknown>).resolvedExecutionPlans
      : undefined;
    if (previousPlans && typeof previousPlans === "object" && !Array.isArray(previousPlans)) {
      frozenV2ExecutionPlans = previousPlans as Record<string, Record<string, unknown>>;
    }
  }
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
  let system = args.systemDefinition
    ? args.systemDefinition
    : activeDesign
      ? designToSystemDefinition(activeDesign)
      : await loadSystemFromMermaid(effectiveSystemPath);
  const systemSource = args.systemDefinition ? undefined : await readFile(effectiveSystemPath, "utf8");
  if (!activeDesign && args.systemBaseDir && system.graph?.handoffContracts) {
    const sourceSystem = parseSystemFromMermaidSource(systemSource ?? await readFile(effectiveSystemPath, "utf8"));
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
  // Contract Set v2 has no compatibility reader for the v1 fixed-command
  // registry. Reject these files at the project boundary even when a project
  // has not yet persisted an explicit Harness binding index.
  await assertNoLegacyV1ExecutionAssets(assetWorkdir);
  const executionBindingsPath = resolve(assetWorkdir, ".ogs", "execution-bindings.json");
  let executionBindings: ExecutionBindingsV2;
  const frozenEffective = frozenResolvedConfig?.effective;
  const persistedFrozenBindings = frozenEffective && typeof frozenEffective === "object" && !Array.isArray(frozenEffective)
    ? (frozenEffective as Record<string, unknown>).executionBindings
    : undefined;
  if (args.resumeRunDir && frozenV2ExecutionPlans && persistedFrozenBindings && typeof persistedFrozenBindings === "object" && !Array.isArray(persistedFrozenBindings)) {
    executionBindings = persistedFrozenBindings as ExecutionBindingsV2;
  } else if (args.resumeRunDir && frozenV2ExecutionPlans) {
    const harnessTemplates: Record<string, HarnessTemplateV2> = {};
    const roles: ExecutionBindingsV2["roles"] = {};
    for (const roleId of system.roleIds) {
      const frozen = frozenV2ExecutionPlans[roleId];
      if (!frozen || typeof frozen.backend !== "string" || typeof frozen.model !== "string"
        || !Array.isArray(frozen.allowedTools) || !Array.isArray(frozen.verifiedTools)
        || !frozen.effectiveEnvironmentPolicy || typeof frozen.effectiveEnvironmentPolicy !== "object") {
        throw new Error(`V2_RECOVERY_FROZEN_CONFIG_INVALID: ${roleId} has no complete frozen Harness binding`);
      }
      const policy = frozen.effectiveEnvironmentPolicy as Record<string, unknown>;
      const templateId = typeof frozen.harnessTemplate === "string" && frozen.harnessTemplate
        ? frozen.harnessTemplate
        : `recovery-${roleId}`;
      harnessTemplates[templateId] = {
        ogsContractVersion: 2,
        schemaVersion: 1,
        kind: "harness",
        templateId,
        backend: frozen.backend,
        model: frozen.model,
        allowedTools: frozen.allowedTools.filter((tool): tool is string => typeof tool === "string"),
        environment: {
          filesystem: {
            read: Boolean((policy.filesystem as Record<string, unknown> | undefined)?.read),
            write: Boolean((policy.filesystem as Record<string, unknown> | undefined)?.write)
          },
          process: policy.process === true ? "allow" : "deny",
          network: policy.network === true ? "allow" : "deny",
          limits: policy.limits as HarnessTemplateV2["environment"]["limits"]
        }
      };
      roles[roleId] = { kind: "harness", harnessTemplate: templateId };
    }
    executionBindings = { ogsContractVersion: 2, schemaVersion: 1, harnessTemplates, roles };
  } else {
    if (args.resumeRunDir && !frozenV2ExecutionPlans) {
      throw new Error("V2_RECOVERY_FROZEN_CONFIG_REQUIRED: resolved-config.json must contain frozen execution plans");
    }
    if (!(await filesystemRunStore.pathExists(executionBindingsPath))) {
      throw new Error("V2_EXECUTION_BINDINGS_REQUIRED: .ogs/execution-bindings.json must declare Harness Templates for every Role");
    }
    executionBindings = await loadExecutionBindingsV2(executionBindingsPath);
  }
  const harnessTemplatesByRoleId: Record<string, HarnessTemplateV2> = {};
  {
    const defaultTemplateId = executionBindings.defaults?.harnessTemplate;
    for (const roleId of system.roleIds) {
      const templateId = executionBindings.roles[roleId]?.harnessTemplate ?? defaultTemplateId;
      if (!templateId) {
        throw new Error(`V2_HARNESS_BINDING_REQUIRED: role "${roleId}" has no Harness Template reference`);
      }
      const template = executionBindings.harnessTemplates?.[templateId];
      if (!template) throw new Error(`V2_HARNESS_TEMPLATE_UNRESOLVED: ${templateId}`);
      harnessTemplatesByRoleId[roleId] = template;
    }
  }
  const runtimeConfig = await loadRuntimeConfig(projectResume ? undefined : args.runtimeConfigPath, assetWorkdir);
  const harnessModelOverrides = Object.fromEntries(Object.entries(harnessTemplatesByRoleId).map(([roleId, template]) => {
    const separator = template.model.indexOf("/");
    if (!template.backend.trim() || !template.model.trim() || (separator === 0 || separator === template.model.length - 1)) {
      throw new Error(`V2_HARNESS_MODEL_INVALID: ${roleId} template requires a backend and model`);
    }
    return [roleId, {
      backend: template.backend,
      // Backend catalogs and native SDKs use the provider/model reference as
      // the immutable model identity; keep it intact for Adapter execution.
      modelId: template.model,
    }];
  }));
  // The model-selection resolver is an internal normalization adapter only.
  // Its input is synthesized from the authoritative Harness Templates and is
  // never read from or written to a model-selection asset.
  const harnessResolutionInput = {
    configVersion: "3" as const,
    roles: harnessModelOverrides
  };
  const frozenReasoningByRoleId = resumeEvidenceDir
    ? await loadFrozenReasoningFromAudit(resumeEvidenceDir)
    : undefined;
  let resolvedHarnessBindings: ReturnType<typeof resolveModelSelectionForSystem>;
  if (frozenV2ExecutionPlans) {
    resolvedHarnessBindings = (() => {
        // Recovery must replay the frozen technical identity. The current project
        // model catalog may be stale, missing, or describe a different provider;
        // it is diagnostic input for new Runs only and must not gate resume.
        const persisted = frozenEffective && typeof frozenEffective === "object" && !Array.isArray(frozenEffective)
          ? (frozenEffective as Record<string, unknown>).resolvedHarnessBindings
          : undefined;
        const persistedByRole = persisted && typeof persisted === "object" && !Array.isArray(persisted)
          ? persisted as Record<string, Record<string, unknown>>
          : {};
        const resolvedByRoleId = new Map<string, import("./model-selection.js").ResolvedModelRuntimeConfig>();
        for (const roleId of system.roleIds) {
          const frozen = frozenV2ExecutionPlans[roleId];
          if (!frozen || typeof frozen.backend !== "string" || typeof frozen.model !== "string") {
            throw new Error(`V2_RECOVERY_FROZEN_CONFIG_INVALID: ${roleId} has no frozen backend/model identity`);
          }
          const previous = persistedByRole[roleId] ?? {};
          resolvedByRoleId.set(roleId, {
            backend: frozen.backend as import("./model-selection.js").ModelBackend,
            modelId: frozen.model,
            modelRef: typeof previous.modelRef === "string" ? previous.modelRef : frozen.model,
            ...(typeof previous.variant === "string" ? { variant: previous.variant } : {}),
            ...(typeof previous.timeoutMs === "number" ? { timeoutMs: previous.timeoutMs } : {}),
            ...(typeof previous.maxOutputBytes === "number" ? { maxOutputBytes: previous.maxOutputBytes } : {}),
            ...(typeof previous.reasoningEffort === "string" ? { reasoningEffort: previous.reasoningEffort as import("./types.js").ReasoningEffort } : {}),
            ...(typeof previous.effectiveReasoningEffort === "string" ? { effectiveReasoningEffort: previous.effectiveReasoningEffort as import("./types.js").ReasoningEffortLevel } : {}),
            ...(typeof previous.frozenReasoningEffort === "string" ? { frozenReasoningEffort: previous.frozenReasoningEffort as import("./types.js").ReasoningEffortLevel } : {}),
            bindingSource: "selection"
          });
        }
        return { resolvedByRoleId, warnings: [] };
      })();
  } else {
    const storedModelCatalog = await loadModelCatalog(resolve(assetWorkdir, ".ogs", "model-catalog.json"));
    const modelCatalog = mergeModelCatalogWithLiveSnapshot(
      storedModelCatalog,
      args.modelCatalogModels,
      args.modelCatalogGeneratedAt
    );
    resolvedHarnessBindings = resolveModelSelectionForSystem({
      system: { ...system, modelBinding: {} },
      selection: harnessResolutionInput,
      catalog: modelCatalog,
      frozenReasoningByRoleId,
      sourceLabel: "Harness Template"
    });
  }
  if (args.resumeRunDir) {
    for (const [roleId, resolved] of resolvedHarnessBindings.resolvedByRoleId) {
      if (resolved.reasoningEffort !== "auto" || resolved.frozenReasoningEffort || resolved.effectiveReasoningEffort) continue;
      if (resolved.reasoningCapability?.kind === "none") continue;
      throw createRuntimeError({
        errorCode: "REASONING_CAPABILITY_UNKNOWN",
        errorCategory: "config",
        stage: "resume",
        retryable: false,
        roleId,
        message: `Role "${roleId}" uses reasoning auto, but no replayable effective reasoning value was recorded for resume.`
      });
    }
  }
  const plan = createExecutionPlan(system, resolvedHarnessBindings.resolvedByRoleId);
  const v2RunId = args.resumeRunDir?.split(/[\\/]/).at(-1) ?? args.runId ?? createRunId(new Date());
  const v2RunRoot = resolve(runEvidenceRoot ?? assetWorkdir, runtimeConfig.runsDir, v2RunId);
  const resolvedV2ExecutionPlans = await materializeV2ExecutionPolicies(
    plan,
    v2RunRoot,
    frozenV2ExecutionPlans,
    harnessTemplatesByRoleId,
    { skipCapabilityDiscovery: args.dryRun === true }
  );
  if (args.profilesPath || args.toolsPath) {
    throw new Error("V2_LEGACY_EXECUTION_ARGUMENT: profilesPath/toolsPath are not accepted by Contract Set v2; use Harness Templates.");
  }
  const profiles: ExecutionProfile[] = [];
  const tools: CliTool[] = [];
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
        maxTransitionsPerRun: effectiveLaw.maxTransitions ?? 100,
        harnessTemplateByRoleId: new Map(Object.entries(harnessTemplatesByRoleId).map(([roleId, template]) => [roleId, template.templateId]))
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
    roleRootDir,
    strictEvents: [resolve(process.cwd(), "og-roles"), resolve(process.cwd(), "examples")]
      .some((root) => roleRootDir === root || roleRootDir.startsWith(root + "/"))
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
      rolePackagesByRoleId,
      harnessTemplateByRoleId: new Map(Object.entries(harnessTemplatesByRoleId).map(([roleId, template]) => [roleId, template.templateId]))
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
    resolvedModelsByRoleId: resolvedHarnessBindings.resolvedByRoleId,
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
    resolvedModelsByRoleId: resolvedHarnessBindings.resolvedByRoleId,
    effectiveLaw,
    contractPlan,
    compilerSnapshot: compilerResult.snapshot,
    specificationDigest: compiledSemanticIR?.digest ?? specificationSnapshot?.digest,
    designDigest: projectDesign ? designDigest(projectDesign) : undefined,
    runtimeConfig,
    profiles,
    tools,
    userProfile,
    executionBindings
  });
  const resolvedConfigSnapshot: Record<string, unknown> = {
    ogsContractVersion: 2,
    schemaVersion: 1,
    resolvedAt: new Date().toISOString(),
    sources: {
      runtimeConfigPath: projectResume ? resolve(assetWorkdir, ".ogs/runtime.json") : args.runtimeConfigPath ?? ".ogs/runtime.json",
      designPath: activeDesign ? "system.design.json" : null,
      modelCatalogPath: ".ogs/model-catalog.json",
      executionBindingsPath: args.resumeRunDir && frozenV2ExecutionPlans ? null : executionBindingsPath,
      userProfilePath: projectResume ? resolve(assetWorkdir, ".ogs/user-profile.json") : args.userProfilePath ?? ".ogs/user-profile.json",
      lawsPath: projectResume ? resolve(assetWorkdir, ".ogs/laws.json") : args.lawsPath ?? ".ogs/laws.json",
    },
    effective: {
      runtimeConfig,
      roleRepoDir: roleRootDir,
      invocation: {
        dryRun: args.dryRun === true
      },
      resolvedHarnessBindings: Object.fromEntries(
        Array.from(resolvedHarnessBindings.resolvedByRoleId.entries()).map(([roleId, selection]) => [
          roleId,
          selection
        ])
      ),
      resolvedExecutionPlans: resolvedV2ExecutionPlans,
      advisoryWarnings: resolvedHarnessBindings.warnings,
      executionBindings,
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
    systemSource,
    prompt: args.prompt,
    workdir: args.workdir,
    runtimeConfig: runRuntimeConfig,
    resolvedConfigSnapshot,
    resumeRunDir: args.resumeRunDir,
    runId: v2RunId,
    runEvidenceRoot,
    runEvidenceDirectory: args.runEvidenceDirectory
  });
  runContext.promptBudgetLedger.maxTotalPromptCharsPerRun = effectiveLaw.maxTotalPromptCharsPerRun;
  runContext.promptBudgetLedger.legacyBaseCommittedChars = 0;
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
    semanticIRDigest: compiledSemanticIR?.digest,
    systemSource
  };
}
