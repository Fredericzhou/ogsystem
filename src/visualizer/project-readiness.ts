/**
 * Read-only project readiness projection for the visualizer.
 * Boundaries:
 * - Does not execute runtime setup or mutate project files.
 * - Reports dry-run blockers using the same project inputs the runtime would inspect.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveProjectRoleRepoRoot, resolveProjectRoleRootDir } from "../runtime/bundled-repos.js";
import {
  buildFlowContractKeyForFlow,
  buildFlowContractKeyForSplit,
  loadFlowContractPlan
} from "../runtime/flow-contract.js";
import { readJsonFile } from "../runtime/json-file.js";
import { isModelCatalogStale, loadModelCatalog, mergeModelCatalogWithLiveSnapshot } from "../runtime/model-catalog.js";
import {
  inspectResolvedModelCatalogEntry,
  loadModelSelection,
  resolveModelSelectionForSystem
} from "../runtime/model-selection.js";
import { parseSystemFromMermaidSource } from "../runtime/parse-mermaid.js";
import { resolveOgsPaths } from "../runtime/project-lifecycle.js";
import { loadLaws, loadProfiles, loadRuntimeConfig, loadTools } from "../runtime/runtime-loader.js";
import { validateRolePackageManifest } from "../runtime/role-repo.js";
import { pathExists } from "../runtime/run-store.js";
import { resolveEffectiveLaw } from "../runtime/runtime-setup.js";
import { SYSTEM_END_ROLE_ID } from "../runtime/types.js";
import { isRuntimeOnlyErrorEvent } from "../runtime/error-flow-utils.js";
import {
  asNonEmptyString,
  asRecord
} from "./json-guards.js";
import type {
  Flow,
  FlowContractDefinition,
  FlowContractFile,
  ModelCatalog,
  ModelCatalogEntry,
  SystemDefinition
} from "../runtime/types.js";
import type { ProviderHealthCheck as DoctorProviderHealthCheck } from "../runtime/doctor.js";

type ReadinessSeverity = "blocker" | "warning";

type ReadinessIssue = {
  code: string;
  message: string;
  severity: ReadinessSeverity;
  roleId?: string;
  flowKey?: string;
  path?: string;
  detail?: unknown;
};

type RoleRepoFileHealth = {
  roleJson: boolean;
  promptTemplate: boolean;
  outputSchema: boolean;
  agent: boolean;
  source: boolean;
};

type RoleRepoHealthItem = {
  roleId: string;
  status: "ok" | "missing" | "invalid";
  resolvedPath: string;
  files: RoleRepoFileHealth;
  missingFiles: string[];
  error?: string;
};

type RoleReadinessInspection = RoleRepoHealthItem & {
  declaredEvents?: string[];
  outputSchemaValue?: unknown;
};

type ContractCoverageItem = {
  flowKey: string;
  fromRoleId: string;
  toRoleId: string;
  eventType: string;
  expectedKey: string;
  contractId?: string;
  status: "covered" | "missing";
};

type ModelCapabilityCheck = {
  roleId: string;
  bindingKind: "model";
  backend: string;
  modelId: string;
  modelRef: string;
  status: "ok" | "warning" | "blocker";
  capabilities?: ModelCatalogEntry["capabilities"];
  missingCapabilities: string[];
  warningCapabilities: string[];
  catalogPresent: boolean;
};

type ModelSelectionReadinessIssue = {
  roleId: string;
  code: "MODEL_SELECTION_NOT_FOUND" | "MODEL_BINDING_UNRESOLVED";
  message: string;
};

type ModelSelectionReadinessResult = {
  resolvedByRoleId: Map<string, { backend: string; modelId: string; modelRef: string }>;
  warnings: string[];
  issues: ModelSelectionReadinessIssue[];
};

export type ProjectReadinessProjection = {
  workdir: string;
  systemId: string | null;
  canDryRun: boolean;
  blockers: ReadinessIssue[];
  warnings: ReadinessIssue[];
  missingBindings: Array<{
    roleId: string;
    reason: string;
  }>;
  contractCoverage: {
    handoffMode: string | null;
    contractPath: string | null;
    eligibleFlowCount: number;
    coveredFlowCount: number;
    missingFlowCount: number;
    roleInputContractCount: number;
    missingFlows: ContractCoverageItem[];
    flows: ContractCoverageItem[];
    loadError?: string;
  };
  roleRepoHealth: {
    roleRepoRoot: string | null;
    roles: RoleRepoHealthItem[];
  };
  modelCapabilityChecks: ModelCapabilityCheck[];
  providerHealth: DoctorProviderHealthCheck[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getModelSelectionErrorCode(error: unknown): ModelSelectionReadinessIssue["code"] | undefined {
  const errorRecord = asRecord(error);
  const envelope = asRecord(errorRecord?.envelope);
  const errorCode = envelope?.errorCode;
  return errorCode === "MODEL_SELECTION_NOT_FOUND" || errorCode === "MODEL_BINDING_UNRESOLVED"
    ? errorCode
    : undefined;
}

function resolveModelSelectionForReadiness(args: {
  system: SystemDefinition;
  selection: Awaited<ReturnType<typeof loadModelSelection>>;
  catalog: ModelCatalog | undefined;
}): ModelSelectionReadinessResult {
  const resolvedByRoleId = new Map<string, { backend: string; modelId: string; modelRef: string }>();
  const warnings = new Set<string>();
  const issues: ModelSelectionReadinessIssue[] = [];

  // Resolve roles independently so one unresolved selector does not hide other pinned models.
  for (const roleId of [...args.system.roleIds].sort((left, right) => left.localeCompare(right))) {
    try {
      const result = resolveModelSelectionForSystem({
        system: { ...args.system, roleIds: [roleId] },
        selection: args.selection,
        catalog: args.catalog,
        validateCatalog: false
      });
      const resolved = result.resolvedByRoleId.get(roleId);
      if (resolved) {
        resolvedByRoleId.set(roleId, resolved);
      }
      for (const warning of result.warnings) {
        warnings.add(warning);
      }
    } catch (error) {
      const code = getModelSelectionErrorCode(error);
      if (!code) {
        throw error;
      }
      issues.push({
        roleId,
        code,
        message: errorMessage(error)
      });
    }
  }

  return {
    resolvedByRoleId,
    warnings: [...warnings],
    issues
  };
}

function buildProviderHealth(
  resolvedModelsByRoleId: Map<string, { backend: string; modelId: string; modelRef: string }>
): DoctorProviderHealthCheck[] {
  const health = [...resolvedModelsByRoleId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([roleId, resolved]) => ({
      roleId,
      modelRef: `${resolved.backend}/${resolved.modelId}`,
      status: "skipped" as const,
      code: "DOCTOR_PROVIDER_ONLINE_SKIPPED" as const,
      message: "online provider credential check skipped; project readiness never probes connectivity"
    }));

  return health;
}

function createIssue(args: {
  code: string;
  message: string;
  severity: ReadinessSeverity;
  roleId?: string;
  flowKey?: string;
  path?: string;
  detail?: unknown;
}): ReadinessIssue {
  return {
    code: args.code,
    message: args.message,
    severity: args.severity,
    roleId: args.roleId,
    flowKey: args.flowKey,
    path: args.path,
    detail: args.detail
  };
}

function getEligibleFlows(system: SystemDefinition): Flow[] {
  return system.flows.filter(
    (flow) => flow.toRoleId !== SYSTEM_END_ROLE_ID && !isRuntimeOnlyErrorEvent(flow.eventType)
  );
}

function getCoverageKey(system: SystemDefinition, flow: Flow): string {
  return system.graph?.routingModeByRoleId[flow.fromRoleId] === "parallel_split"
    ? buildFlowContractKeyForSplit({
        fromRoleId: flow.fromRoleId,
        toRoleId: flow.toRoleId
      })
    : buildFlowContractKeyForFlow({
        fromRoleId: flow.fromRoleId,
        toRoleId: flow.toRoleId,
        eventType: flow.eventType
      });
}

function getRawContractFlowKey(contract: FlowContractDefinition): string | undefined {
  if (contract.kind !== "flow") {
    return undefined;
  }
  const fromRoleId = contract.match.fromRoleId;
  const toRoleId = contract.match.toRoleId;
  if (!fromRoleId || !toRoleId) {
    return undefined;
  }
  if (contract.match.mode === "split") {
    return buildFlowContractKeyForSplit({ fromRoleId, toRoleId });
  }
  const eventType = contract.match.eventType;
  return eventType
    ? buildFlowContractKeyForFlow({ fromRoleId, toRoleId, eventType })
    : undefined;
}

function parseRawContractFile(value: unknown): FlowContractFile | undefined {
  const record = asRecord(value);
  if (!record || record.version !== 1 || !Array.isArray(record.contracts)) {
    return undefined;
  }
  const contracts: FlowContractDefinition[] = [];
  for (const entry of record.contracts) {
    const contract = asRecord(entry);
    const match = asRecord(contract?.match);
    const id = asNonEmptyString(contract?.id);
    const kind = contract?.kind;
    const schema = asNonEmptyString(contract?.schema);
    if (!contract || !id || (kind !== "flow" && kind !== "role_input") || !match || !schema) {
      continue;
    }
    contracts.push({
      id,
      kind,
      schema,
      match: Object.fromEntries(
        Object.entries(match).filter(([, value]) => typeof value === "string")
      ) as FlowContractDefinition["match"],
      onViolation:
        contract.onViolation === "FAIL" || contract.onViolation === "WARN"
          ? contract.onViolation
          : undefined
    });
  }
  return {
    version: 1,
    contracts
  };
}

async function buildContractCoverage(args: {
  system: SystemDefinition;
  blockers: ReadinessIssue[];
  warnings: ReadinessIssue[];
}): Promise<ProjectReadinessProjection["contractCoverage"]> {
  const contractPath = args.system.graph?.handoffContracts ?? null;
  const eligibleFlows = getEligibleFlows(args.system);
  const rawFlowContractsByKey = new Map<string, FlowContractDefinition>();
  let roleInputContractCount = 0;
  let loadError: string | undefined;

  if (contractPath) {
    try {
      const raw = parseRawContractFile(await readJsonFile(contractPath));
      if (!raw) {
        throw new Error("Invalid contract bundle shape");
      }
      for (const contract of raw.contracts) {
        if (contract.kind === "role_input") {
          roleInputContractCount += 1;
          continue;
        }
        const key = getRawContractFlowKey(contract);
        if (key) {
          rawFlowContractsByKey.set(key, contract);
        }
      }
    } catch (error) {
      loadError = errorMessage(error);
      args.blockers.push(
        createIssue({
          code: "READINESS_CONTRACT_BUNDLE_UNREADABLE",
          message: `Handoff contract bundle cannot be inspected: ${loadError}`,
          severity: "blocker",
          path: contractPath
        })
      );
    }

    try {
      await loadFlowContractPlan({
        system: args.system,
        contractPath
      });
    } catch (error) {
      loadError = loadError ?? errorMessage(error);
      args.blockers.push(
        createIssue({
          code: "READINESS_CONTRACT_PLAN_INVALID",
          message: `Handoff contract plan cannot load: ${errorMessage(error)}`,
          severity: "blocker",
          path: contractPath
        })
      );
    }
  } else if (args.system.graph?.handoffMode) {
    args.blockers.push(
      createIssue({
        code: "READINESS_HANDOFF_CONTRACTS_MISSING",
        message: `handoff.mode=${args.system.graph.handoffMode} requires handoff.contracts for dry-run readiness`,
        severity: "blocker"
      })
    );
  }

  const flows = eligibleFlows
    .map((flow) => {
      const expectedKey = getCoverageKey(args.system, flow);
      const contract = rawFlowContractsByKey.get(expectedKey);
      return {
        flowKey: `${flow.fromRoleId}:${flow.eventType}:${flow.toRoleId}`,
        fromRoleId: flow.fromRoleId,
        toRoleId: flow.toRoleId,
        eventType: flow.eventType,
        expectedKey,
        contractId: contract?.id,
        status: contract ? "covered" as const : "missing" as const
      };
    })
    .sort((left, right) => left.flowKey.localeCompare(right.flowKey));
  const missingFlows = flows.filter((flow) => flow.status === "missing");

  if (args.system.graph?.handoffMode === "strict") {
    for (const flow of missingFlows) {
      args.blockers.push(
        createIssue({
          code: "READINESS_STRICT_HANDOFF_CONTRACT_MISSING",
          message: `Missing strict handoff contract for ${flow.flowKey}`,
          severity: "blocker",
          flowKey: flow.flowKey
        })
      );
    }
  } else if (missingFlows.length > 0 && args.system.graph?.handoffMode === "transition") {
    args.warnings.push(
      createIssue({
        code: "READINESS_TRANSITION_HANDOFF_CONTRACT_GAPS",
        message: `${missingFlows.length} transition handoff flow(s) do not have a contract`,
        severity: "warning",
        detail: missingFlows.map((flow) => flow.flowKey)
      })
    );
  }

  return {
    handoffMode: args.system.graph?.handoffMode ?? null,
    contractPath,
    eligibleFlowCount: eligibleFlows.length,
    coveredFlowCount: flows.filter((flow) => flow.status === "covered").length,
    missingFlowCount: missingFlows.length,
    roleInputContractCount,
    missingFlows,
    flows,
    loadError
  };
}

function buildModelCapabilityChecks(args: {
  system: SystemDefinition;
  modelCatalog: ModelCatalog | undefined;
  resolvedModelsByRoleId: Map<string, { backend: string; modelId: string; modelRef: string }>;
  blockers: ReadinessIssue[];
  warnings: ReadinessIssue[];
}): ModelCapabilityCheck[] {
  const checks: ModelCapabilityCheck[] = [];
  for (const roleId of [...args.system.roleIds].sort((left, right) => left.localeCompare(right))) {
    if (args.system.executionBinding[roleId]) {
      continue;
    }
    const resolved = args.resolvedModelsByRoleId.get(roleId);
    if (!resolved?.modelRef) {
      continue;
    }
    const catalogEntry = args.modelCatalog?.models.find((entry) => entry.backend === resolved.backend && entry.modelId === resolved.modelId);
    if (!catalogEntry) {
      const catalogIssue = inspectResolvedModelCatalogEntry({
        roleId,
        backend: resolved.backend,
        modelId: resolved.modelId,
        modelRef: `${resolved.backend}/${resolved.modelId}`,
        catalog: args.modelCatalog
      });
      if (catalogIssue) {
        const check: ModelCapabilityCheck = {
          roleId,
          bindingKind: "model",
          backend: resolved.backend,
          modelId: resolved.modelId,
          modelRef: `${resolved.backend}/${resolved.modelId}`,
          status: "blocker",
          missingCapabilities: catalogIssue.missingCapabilities ?? [],
          warningCapabilities: [],
          catalogPresent: true
        };
        checks.push(check);
        args.blockers.push(
          createIssue({
            code: "READINESS_MODEL_UNAVAILABLE",
            message: catalogIssue.message,
            severity: "blocker",
            roleId,
            detail: check
          })
        );
        continue;
      }
      const check: ModelCapabilityCheck = {
        roleId,
        bindingKind: "model",
        backend: resolved.backend,
        modelId: resolved.modelId,
        modelRef: `${resolved.backend}/${resolved.modelId}`,
        status: "warning",
        missingCapabilities: [],
        warningCapabilities: [],
        catalogPresent: false
      };
      checks.push(check);
      const catalogStale = args.modelCatalog ? isModelCatalogStale(args.modelCatalog) : false;
      args.warnings.push(
        createIssue({
          code: catalogStale ? "READINESS_MODEL_CATALOG_STALE_REF" : "READINESS_MODEL_CATALOG_MISSING",
          message: args.modelCatalog
            ? catalogStale
              ? `Role "${roleId}" selects "${resolved.modelRef}" but the stale catalog cannot confirm current availability; the pinned reference remains visible.`
              : `Role "${roleId}" selects "${resolved.modelRef}" which is not present in the current OpenCode discovery catalog.`
            : `Role "${roleId}" selects pinned model "${resolved.modelRef}"; availability was not discovered because .ogs/model-catalog.json is missing.`,
          severity: "warning",
          roleId,
          detail: check
        })
      );
      continue;
    }
    const catalogIssue = inspectResolvedModelCatalogEntry({
      roleId,
      backend: resolved.backend,
      modelId: resolved.modelId,
      modelRef: `${resolved.backend}/${resolved.modelId}`,
      catalog: args.modelCatalog
    });
    if (catalogIssue) {
      const check: ModelCapabilityCheck = {
        roleId,
        bindingKind: "model",
        backend: resolved.backend,
        modelId: resolved.modelId,
        modelRef: `${resolved.backend}/${resolved.modelId}`,
        status: "blocker",
        capabilities: catalogEntry.capabilities,
        missingCapabilities: catalogIssue.missingCapabilities ?? [],
        warningCapabilities: [],
        catalogPresent: true
      };
      checks.push(check);
      args.blockers.push(
        createIssue({
          code: catalogIssue.code === "MODEL_UNAVAILABLE"
            ? "READINESS_MODEL_UNAVAILABLE"
            : "READINESS_MODEL_CAPABILITY_MISMATCH",
          message: catalogIssue.message,
          severity: "blocker",
          roleId,
          detail: check
        })
      );
      continue;
    }
    const missingCapabilities = [
      catalogEntry.capabilities.textInput ? "" : "textInput",
      catalogEntry.capabilities.textOutput ? "" : "textOutput"
    ].filter(Boolean);
    const warningCapabilities = catalogEntry.capabilities.toolcall ? [] : ["toolcall"];
    const status = missingCapabilities.length > 0
      ? "blocker"
      : warningCapabilities.length > 0
        ? "warning"
        : "ok";
    const check: ModelCapabilityCheck = {
      roleId,
      bindingKind: "model",
      backend: resolved.backend,
      modelId: resolved.modelId,
      modelRef: `${resolved.backend}/${resolved.modelId}`,
      status,
      capabilities: catalogEntry.capabilities,
      missingCapabilities,
      warningCapabilities,
      catalogPresent: true
    };
    checks.push(check);
    if (missingCapabilities.length > 0) {
      args.blockers.push(
        createIssue({
          code: "READINESS_MODEL_CAPABILITY_MISMATCH",
          message: `Role "${roleId}" model "${resolved.modelRef}" is missing required capabilities: ${missingCapabilities.join(", ")}`,
          severity: "blocker",
          roleId,
          detail: check
        })
      );
    } else if (warningCapabilities.length > 0) {
      args.warnings.push(
        createIssue({
          code: "READINESS_MODEL_CAPABILITY_WARNING",
          message: `Role "${roleId}" model "${resolved.modelRef}" does not advertise capabilities: ${warningCapabilities.join(", ")}`,
          severity: "warning",
          roleId,
          detail: check
        })
      );
    }
  }
  return checks;
}

async function inspectRoleHealth(args: {
  roleId: string;
  roleRootDir: string;
}): Promise<RoleReadinessInspection> {
  const resolvedPath = resolve(args.roleRootDir, args.roleId);
  const manifestPath = resolve(resolvedPath, "role.json");
  const files: RoleRepoFileHealth = {
    roleJson: await pathExists(manifestPath),
    promptTemplate: false,
    outputSchema: false,
    agent: await pathExists(resolve(resolvedPath, "agent.md")),
    source: await pathExists(resolve(resolvedPath, "source.json"))
  };
  let error: string | undefined;
  let declaredEvents: string[] | undefined;
  let outputSchemaValue: unknown;

  if (files.roleJson) {
    try {
      const manifest = validateRolePackageManifest(await readJsonFile(manifestPath), manifestPath);
      declaredEvents = manifest.outputs.events;
      const promptTemplate = asNonEmptyString(manifest.promptTemplate);
      const outputSchema = asNonEmptyString(manifest.outputSchema);
      files.promptTemplate = promptTemplate
        ? await pathExists(resolve(resolvedPath, promptTemplate))
        : false;
      files.outputSchema = outputSchema
        ? await pathExists(resolve(resolvedPath, outputSchema))
        : false;
      if (files.outputSchema && outputSchema) {
        outputSchemaValue = await readJsonFile(resolve(resolvedPath, outputSchema));
      }
      if (manifest.roleId !== args.roleId) {
        error = `role.json roleId mismatch: expected "${args.roleId}"`;
      }
    } catch (readError) {
      error = errorMessage(readError);
    }
  }

  const missingFiles = Object.entries({
    roleJson: files.roleJson,
    promptTemplate: files.promptTemplate,
    outputSchema: files.outputSchema,
    agent: files.agent
  })
    .filter(([, present]) => !present)
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));

  return {
    roleId: args.roleId,
    status: error ? "invalid" : missingFiles.length > 0 ? "missing" : "ok",
    resolvedPath,
    files,
    missingFiles,
    error,
    declaredEvents,
    outputSchemaValue
  };
}

function collectCodexStrictSchemaIssues(schema: unknown, path = "$", issues: string[] = [], visited = new Set<object>()): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || visited.has(schema)) return issues;
  visited.add(schema);
  const record = schema as Record<string, unknown>;
  if (record.type === "object" || record.properties && typeof record.properties === "object") {
    const properties = record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)
      ? Object.keys(record.properties as Record<string, unknown>)
      : [];
    if (record.additionalProperties !== false) issues.push(`${path}.additionalProperties must be false`);
    const required = Array.isArray(record.required) ? record.required.filter((item): item is string => typeof item === "string") : [];
    const missingRequired = properties.filter((property) => !required.includes(property));
    if (missingRequired.length) issues.push(`${path}.required must include ${missingRequired.join(", ")}`);
  }

  const schemaMapKeywords = ["properties", "patternProperties", "$defs", "definitions"];
  for (const keyword of schemaMapKeywords) {
    const children = record[keyword];
    if (children && typeof children === "object" && !Array.isArray(children)) {
      for (const [key, child] of Object.entries(children as Record<string, unknown>)) {
        collectCodexStrictSchemaIssues(child, `${path}.${keyword}.${key}`, issues, visited);
      }
    }
  }
  for (const keyword of ["items", "additionalProperties", "contains", "propertyNames", "not", "if", "then", "else"]) {
    collectCodexStrictSchemaIssues(record[keyword], `${path}.${keyword}`, issues, visited);
  }
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    const children = record[keyword];
    if (Array.isArray(children)) children.forEach((child, index) => collectCodexStrictSchemaIssues(child, `${path}.${keyword}[${index}]`, issues, visited));
  }
  return issues;
}

function validateRoleEventContracts(args: {
  system: SystemDefinition;
  roles: RoleReadinessInspection[];
  blockers: ReadinessIssue[];
}): void {
  const rolesById = new Map(args.roles.map((role) => [role.roleId, role]));
  for (const roleId of args.system.roleIds) {
    const role = rolesById.get(roleId);
    if (!role || role.status !== "ok" || !role.declaredEvents) continue;
    const graphEvents = [...new Set(args.system.flows
      .filter((flow) => flow.fromRoleId === roleId && !isRuntimeOnlyErrorEvent(flow.eventType))
      .map((flow) => flow.eventType))].sort();
    const declaredEvents = [...new Set(role.declaredEvents)].sort();
    if (graphEvents.length !== declaredEvents.length || graphEvents.some((event, index) => event !== declaredEvents[index])) {
      args.blockers.push(createIssue({
        code: "READINESS_ROLE_EVENTS_MISMATCH",
        message: `Role "${roleId}" declares output events [${declaredEvents.join(", ")}] but its normal outgoing flows are [${graphEvents.join(", ")}].`,
        severity: "blocker",
        roleId,
        detail: { declaredEvents, graphEvents }
      }));
    }
  }
}

function validateCodexOutputSchemas(args: {
  roles: RoleReadinessInspection[];
  resolvedModelsByRoleId: Map<string, { backend: string; modelId: string; modelRef: string }>;
  blockers: ReadinessIssue[];
}): void {
  for (const role of args.roles) {
    const model = args.resolvedModelsByRoleId.get(role.roleId);
    if (!model || model.backend !== "codex" || role.status !== "ok") continue;
    const issues = collectCodexStrictSchemaIssues(role.outputSchemaValue);
    if (issues.length) {
      args.blockers.push(createIssue({
        code: "READINESS_CODEX_OUTPUT_SCHEMA_INVALID",
        message: `Role "${role.roleId}" output schema is incompatible with Codex structured output: ${issues.join("; ")}`,
        severity: "blocker",
        roleId: role.roleId,
        detail: { modelRef: model.modelRef, issues }
      }));
    }
  }
}

export async function inspectProjectReadiness(
  workdir: string,
  options: { modelCatalogModels?: ModelCatalogEntry[]; modelCatalogGeneratedAt?: string } = {}
): Promise<ProjectReadinessProjection> {
  const blockers: ReadinessIssue[] = [];
  const warnings: ReadinessIssue[] = [];
  const missingBindings: ProjectReadinessProjection["missingBindings"] = [];
  const emptyContractCoverage: ProjectReadinessProjection["contractCoverage"] = {
    handoffMode: null,
    contractPath: null,
    eligibleFlowCount: 0,
    coveredFlowCount: 0,
    missingFlowCount: 0,
    roleInputContractCount: 0,
    missingFlows: [],
    flows: []
  };

  let system: SystemDefinition;
  try {
    system = parseSystemFromMermaidSource(await readFile(resolve(workdir, "system.mmd"), "utf8"));
  } catch (error) {
    blockers.push(
      createIssue({
        code: "READINESS_SYSTEM_PARSE_FAILED",
        message: `system.mmd cannot be parsed: ${errorMessage(error)}`,
        severity: "blocker",
        path: resolve(workdir, "system.mmd")
      })
    );
    return {
      workdir,
      systemId: null,
      canDryRun: false,
      blockers,
      warnings,
      missingBindings,
      contractCoverage: emptyContractCoverage,
      roleRepoHealth: {
        roleRepoRoot: null,
        roles: []
      },
      modelCapabilityChecks: [],
      providerHealth: []
    };
  }

  const ogsPaths = resolveOgsPaths(workdir);
  const runtimeConfig = await loadRuntimeConfig(undefined, workdir);
  const roleRepoRoot = resolveProjectRoleRepoRoot(workdir, runtimeConfig.roleRepo);
  const roleRootDir = resolveProjectRoleRootDir(workdir, runtimeConfig.roleRepo);
  const modelSelection = await loadModelSelection(ogsPaths.modelSelectionPath);
  const hasLiveModelCatalog = Array.isArray(options.modelCatalogModels) && options.modelCatalogModels.length > 0;
  let storedModelCatalog: ModelCatalog | undefined;
  try {
    storedModelCatalog = await loadModelCatalog(ogsPaths.modelCatalogPath);
  } catch (error) {
    (hasLiveModelCatalog ? warnings : blockers).push(
      createIssue({
        code: "READINESS_MODEL_CATALOG_INVALID",
        message: hasLiveModelCatalog
          ? `The local model catalog is invalid and was ignored in favor of the current Platform catalog: ${errorMessage(error)}`
          : `Model catalog cannot be used: ${errorMessage(error)}`,
        severity: hasLiveModelCatalog ? "warning" : "blocker",
        path: ogsPaths.modelCatalogPath
      })
    );
  }
  const modelCatalog = mergeModelCatalogWithLiveSnapshot(
    storedModelCatalog,
    options.modelCatalogModels,
    options.modelCatalogGeneratedAt
  );
  const resolvedModelSelection = resolveModelSelectionForReadiness({
    system,
    selection: modelSelection,
    catalog: modelCatalog
  });
  const laws = await loadLaws(undefined, workdir);
  const [profiles, tools] = await Promise.all([
    loadProfiles(undefined, workdir),
    loadTools(undefined, workdir)
  ]);
  const effectiveLaw = resolveEffectiveLaw(system, laws);

  for (const warning of resolvedModelSelection.warnings) {
    warnings.push(
      createIssue({
        code: "READINESS_MODEL_SELECTION_WARNING",
        message: warning,
        severity: "warning"
      })
    );
  }

  const modelSelectionIssuesByRoleId = new Map(
    resolvedModelSelection.issues.map((issue) => [issue.roleId, issue])
  );
  const profilesById = new Map(profiles.map((profile) => [profile.profileId, profile]));
  const toolsByRef = new Map(tools.map((tool) => [tool.toolRef, tool]));

  for (const roleId of [...system.roleIds].sort((left, right) => left.localeCompare(right))) {
    const bindingRef = system.executionBinding[roleId];
    if (bindingRef?.startsWith("profile.")) {
      const profile = profilesById.get(bindingRef.slice("profile.".length));
      const tool = profile ? toolsByRef.get(profile.toolRef) : undefined;
      if (tool?.stdinMode === "none") {
        warnings.push(
          createIssue({
            code: "READINESS_TOOL_INPUT_NOT_FORWARDED",
            message: `Role "${roleId}" is bound to tool "${tool.toolRef}" with stdinMode "none"; the rendered role prompt and projected input are not sent on stdin. Set stdinMode to "text" if the tool expects prompt input there.`,
            severity: "warning",
            roleId,
            detail: {
              profileId: profile?.profileId,
              toolRef: tool.toolRef,
              stdinMode: tool.stdinMode
            }
          })
        );
      }
    }
    if (!system.executionBinding[roleId] && !resolvedModelSelection.resolvedByRoleId.has(roleId)) {
      const selectionIssue = modelSelectionIssuesByRoleId.get(roleId);
      if (selectionIssue) {
        missingBindings.push({
          roleId,
          reason: "model binding did not resolve to a backend/model selection"
        });
        blockers.push(
          createIssue({
            code: "READINESS_MODEL_SELECTION_UNRESOLVED",
            message: selectionIssue.message,
            severity: "blocker",
            roleId,
            detail: {
              runtimeCode: selectionIssue.code
            }
          })
        );
        continue;
      }
      missingBindings.push({
        roleId,
        reason: "no execution binding or model-selection entry resolved"
      });
      const issue = createIssue({
        code: "READINESS_BINDING_MISSING",
        message: `Role "${roleId}" has no execution binding`,
        severity: effectiveLaw.allowNoopWithoutExecutionBinding ? "warning" : "blocker",
        roleId
      });
      if (issue.severity === "blocker") {
        blockers.push(issue);
      } else {
        warnings.push(issue);
      }
    }
  }

  const roleInspections = await Promise.all(
    [...system.roleIds]
      .sort((left, right) => left.localeCompare(right))
      .map((roleId) => inspectRoleHealth({ roleId, roleRootDir }))
  );
  for (const role of roleInspections) {
    if (role.status !== "ok") {
      blockers.push(
        createIssue({
          code: role.status === "invalid"
            ? "READINESS_ROLE_PACKAGE_INVALID"
            : "READINESS_ROLE_PACKAGE_FILES_MISSING",
          message: role.error
            ? `Role package "${role.roleId}" is invalid: ${role.error}`
            : `Role package "${role.roleId}" is missing files: ${role.missingFiles.join(", ")}`,
          severity: "blocker",
          roleId: role.roleId,
          path: role.resolvedPath,
          detail: {
            files: role.files,
            missingFiles: role.missingFiles
          }
        })
      );
    }
  }

  const modelCapabilityChecks = buildModelCapabilityChecks({
    system,
    modelCatalog,
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId,
    blockers,
    warnings
  });

  validateRoleEventContracts({ system, roles: roleInspections, blockers });
  validateCodexOutputSchemas({
    roles: roleInspections,
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId,
    blockers
  });

  const contractCoverage = await buildContractCoverage({
    system,
    blockers,
    warnings
  });

  return {
    workdir,
    systemId: system.systemId,
    canDryRun: blockers.length === 0,
    blockers,
    warnings,
    missingBindings,
    contractCoverage,
    roleRepoHealth: {
      roleRepoRoot,
      roles: roleInspections.map(({ declaredEvents: _declaredEvents, outputSchemaValue: _outputSchemaValue, ...role }) => role)
    },
    modelCapabilityChecks,
    providerHealth: buildProviderHealth(resolvedModelSelection.resolvedByRoleId)
  };
}
