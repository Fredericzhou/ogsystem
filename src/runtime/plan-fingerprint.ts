import { createHash } from "node:crypto";
import { resolve } from "node:path";

import type { CompiledExecutionSnapshot } from "./compiler.js";
import type { ResolvedModelRuntimeConfig } from "./model-selection.js";
import type { RunPlanFingerprint } from "./run-artifacts.js";
import {
  RUNTIME_ROLE_PROMPT_INPUT_SCHEMA,
  RUNTIME_ROLE_PROMPT_INPUT_SCHEMA_PATH
} from "./role-prompt-input-schema.js";
import type {
  EffectiveLawConstraints,
  FlowContractPlan,
  LoadedModelPackage,
  LoadedRolePackage,
  SystemDefinition
} from "./types.js";

function sortedRecordEntries(record: Record<string, string>): Array<[string, string]> {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

function sortedRoleIds(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

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

function buildSystemFingerprintComponent(
  system: SystemDefinition,
  contractPlanDigest: string | null = null
): Record<string, unknown> {
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
      handoffMode: system.graph?.handoffMode,
      handoffContracts: null,
      contractPlanDigest,
      routeOrderByRoleId: Object.entries(system.graph?.routeOrderByRoleId ?? {})
        .map(([roleId, order]) => [roleId, [...order]] as [string, string[]])
        .sort(([left], [right]) => left.localeCompare(right)),
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
  return Array.from(rolePackagesByRoleId.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([roleId, rolePackage]) => ({
      identity: {
        roleId,
        manifest: normalizeFingerprintValue(rolePackage.manifest),
        promptTemplate: rolePackage.promptTemplate,
        outputSchema: normalizeFingerprintValue(rolePackage.outputSchema),
        agent: rolePackage.agent
      },
      sourceHints: {
        roleId,
        resolvedPath: rolePackage.resolvedPath,
        promptTemplatePath: resolve(rolePackage.resolvedPath, rolePackage.manifest.promptTemplate),
        outputSchemaPath: rolePackage.outputSchemaPath,
        agentPath: resolve(rolePackage.resolvedPath, "agent.md")
      }
    }));
}

function buildRuntimePromptInputFingerprintComponent(): {
  identity: Record<string, unknown>;
  sourceHints: Record<string, unknown>;
} {
  return {
    identity: {
      schema: normalizeFingerprintValue(RUNTIME_ROLE_PROMPT_INPUT_SCHEMA)
    },
    sourceHints: {
      schemaPath: RUNTIME_ROLE_PROMPT_INPUT_SCHEMA_PATH
    }
  };
}

function buildModelSelectionFingerprintComponent(
  resolvedModelsByRoleId: Map<string, ResolvedModelRuntimeConfig>
): Array<{
  identity: Record<string, unknown>;
  sourceHints: Record<string, unknown>;
}> {
  return Array.from(resolvedModelsByRoleId.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([roleId, resolvedModel]) => ({
      identity: {
        roleId,
        modelRef: resolvedModel.modelRef,
        variant: resolvedModel.variant ?? null,
        timeoutMs: resolvedModel.timeoutMs ?? null,
        maxOutputBytes: resolvedModel.maxOutputBytes ?? null,
        bindingSource: resolvedModel.bindingSource
      },
      sourceHints: {
        roleId,
        modelRef: resolvedModel.modelRef
      }
    }));
}

function buildCompilerFingerprintComponent(
  compilerSnapshot: CompiledExecutionSnapshot
): {
  identity: Record<string, unknown>;
  sourceHints: Record<string, unknown>;
} {
  return {
    identity: {
      digest: compilerSnapshot.digest,
      runtimePromptInputSchemaDigest: compilerSnapshot.runtimePromptInputSchemaDigest,
      roleIds: sortedRoleIds(Object.keys(compilerSnapshot.roleSummaryByRoleId)),
      contractIds: sortedRoleIds(Object.keys(compilerSnapshot.contractSummaryById))
    },
    sourceHints: {
      digest: compilerSnapshot.digest,
      runtimePromptInputSchemaPath: compilerSnapshot.runtimePromptInputSchemaPath,
      diagnostics: compilerSnapshot.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        roleId: diagnostic.roleId ?? null,
        contractId: diagnostic.contractId ?? null,
        fieldName: diagnostic.fieldName ?? null
      }))
    }
  };
}

export function buildRunPlanFingerprint(args: {
  system: SystemDefinition;
  rolePackagesByRoleId: Map<string, LoadedRolePackage>;
  resolvedModelsByRoleId?: Map<string, ResolvedModelRuntimeConfig>;
  modelsById?: Map<string, LoadedModelPackage>;
  effectiveLaw: EffectiveLawConstraints;
  contractPlan?: FlowContractPlan;
  compilerSnapshot?: CompiledExecutionSnapshot;
  specificationDigest?: string;
}): RunPlanFingerprint {
  const rolePackageComponents = buildRolePackageFingerprintComponent(args.rolePackagesByRoleId);
  const modelSelectionComponents = args.resolvedModelsByRoleId
    ? buildModelSelectionFingerprintComponent(args.resolvedModelsByRoleId)
    : Array.from(args.modelsById?.entries() ?? [])
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([modelId, modelPackage]) => ({
          identity: {
            legacyModelId: modelId,
            manifest: normalizeFingerprintValue(modelPackage.manifest)
          },
          sourceHints: {
            legacyModelId: modelId,
            resolvedPath: modelPackage.resolvedPath
          }
        }));
  const runtimePromptInputComponent = buildRuntimePromptInputFingerprintComponent();
  const compilerComponent = args.compilerSnapshot
    ? buildCompilerFingerprintComponent(args.compilerSnapshot)
    : undefined;
  const componentValues: Record<string, unknown> = {
    system: buildSystemFingerprintComponent(args.system, args.contractPlan?.digest ?? null),
    rolePackages: rolePackageComponents.map((component) => component.identity),
    modelSelection: modelSelectionComponents.map((component) => component.identity),
    runtimePromptInput: runtimePromptInputComponent.identity,
    effectiveLaw: normalizeFingerprintValue(args.effectiveLaw)
  };
  if (args.specificationDigest) {
    componentValues.specification = args.specificationDigest;
  }
  if (compilerComponent) {
    componentValues.compiler = compilerComponent.identity;
  }
  const componentDigests = Object.fromEntries(
    Object.keys(componentValues).map((componentName) => [
      componentName,
      hashFingerprintValue(componentValues[componentName])
    ])
  ) as Record<string, string>;
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
      modelSelection: {
        digest: componentDigests.modelSelection,
        value: componentValues.modelSelection,
        sourceHints: modelSelectionComponents.map((component) => component.sourceHints)
      },
      runtimePromptInput: {
        digest: componentDigests.runtimePromptInput,
        value: componentValues.runtimePromptInput,
        sourceHints: runtimePromptInputComponent.sourceHints
      },
      effectiveLaw: {
        digest: componentDigests.effectiveLaw,
        value: componentValues.effectiveLaw
      },
      ...(args.specificationDigest
        ? {
            specification: {
              digest: componentDigests.specification,
              value: componentValues.specification
            }
          }
        : {}),
      ...(compilerComponent
        ? {
            compiler: {
              digest: componentDigests.compiler,
              value: compilerComponent.identity,
              sourceHints: compilerComponent.sourceHints
            }
          }
        : {})
    }
  };

  const digest = hashFingerprintValue(componentDigests);
  return {
    version: 6,
    algorithm: "sha256",
    digest,
    payload
  };
}
