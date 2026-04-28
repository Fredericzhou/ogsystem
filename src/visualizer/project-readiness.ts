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
import { loadModelCatalog } from "../runtime/model-catalog.js";
import { loadModelSelection, resolveModelSelectionForSystem } from "../runtime/model-selection.js";
import { parseSystemFromMermaidSource } from "../runtime/parse-mermaid.js";
import { resolveOgsPaths } from "../runtime/project-lifecycle.js";
import { loadLaws, loadRuntimeConfig } from "../runtime/runtime-loader.js";
import { pathExists } from "../runtime/run-artifacts.js";
import { resolveEffectiveLaw } from "../runtime/runtime-setup.js";
import { SYSTEM_END_ROLE_ID } from "../runtime/types.js";
import { isRuntimeOnlyErrorEvent } from "../runtime/error-flow-utils.js";
import type {
  Flow,
  FlowContractDefinition,
  FlowContractFile,
  SystemDefinition
} from "../runtime/types.js";

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

type ContractCoverageItem = {
  flowKey: string;
  fromRoleId: string;
  toRoleId: string;
  eventType: string;
  expectedKey: string;
  contractId?: string;
  status: "covered" | "missing";
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
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    const id = asString(contract?.id);
    const kind = contract?.kind;
    const schema = asString(contract?.schema);
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

async function inspectRoleHealth(args: {
  roleId: string;
  roleRootDir: string;
}): Promise<RoleRepoHealthItem> {
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

  if (files.roleJson) {
    try {
      const manifest = asRecord(await readJsonFile(manifestPath));
      const promptTemplate = asString(manifest?.promptTemplate);
      const outputSchema = asString(manifest?.outputSchema);
      files.promptTemplate = promptTemplate
        ? await pathExists(resolve(resolvedPath, promptTemplate))
        : false;
      files.outputSchema = outputSchema
        ? await pathExists(resolve(resolvedPath, outputSchema))
        : false;
      if (manifest?.roleId !== args.roleId) {
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
    error
  };
}

export async function inspectProjectReadiness(
  workdir: string
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
      }
    };
  }

  const ogsPaths = resolveOgsPaths(workdir);
  const runtimeConfig = await loadRuntimeConfig(undefined, workdir);
  const roleRepoRoot = resolveProjectRoleRepoRoot(workdir, runtimeConfig.roleRepo);
  const roleRootDir = resolveProjectRoleRootDir(workdir, runtimeConfig.roleRepo);
  const modelSelection = await loadModelSelection(ogsPaths.modelSelectionPath);
  const modelCatalog = await loadModelCatalog(ogsPaths.modelCatalogPath);
  const resolvedModelSelection = resolveModelSelectionForSystem({
    system,
    selection: modelSelection,
    catalog: modelCatalog
  });
  const laws = await loadLaws(undefined, workdir);
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

  for (const roleId of [...system.roleIds].sort((left, right) => left.localeCompare(right))) {
    if (!system.executionBinding[roleId] && !resolvedModelSelection.resolvedByRoleId.has(roleId)) {
      missingBindings.push({
        roleId,
        reason: "no exec.bind, model.bind, or model-selection default resolved"
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

  const roleHealth = await Promise.all(
    [...system.roleIds]
      .sort((left, right) => left.localeCompare(right))
      .map((roleId) => inspectRoleHealth({ roleId, roleRootDir }))
  );
  for (const role of roleHealth) {
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
      roles: roleHealth
    }
  };
}
