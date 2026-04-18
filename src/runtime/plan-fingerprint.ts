import { createHash } from "node:crypto";
import { resolve } from "node:path";

import type { CompiledExecutionSnapshot } from "./compiler.js";
import type { RunPlanFingerprint } from "./run-artifacts.js";
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
        personaPath:
          rolePackage.persona !== undefined ? resolve(rolePackage.resolvedPath, "persona.md") : null,
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

function buildCompilerFingerprintComponent(
  compilerSnapshot: CompiledExecutionSnapshot
): {
  identity: Record<string, unknown>;
  sourceHints: Record<string, unknown>;
} {
  return {
    identity: {
      digest: compilerSnapshot.digest,
      roleIds: sortedRoleIds(Object.keys(compilerSnapshot.roleSummaryByRoleId)),
      contractIds: sortedRoleIds(Object.keys(compilerSnapshot.contractSummaryById))
    },
    sourceHints: {
      digest: compilerSnapshot.digest,
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
  modelsById: Map<string, LoadedModelPackage>;
  effectiveLaw: EffectiveLawConstraints;
  contractPlan?: FlowContractPlan;
  compilerSnapshot?: CompiledExecutionSnapshot;
}): RunPlanFingerprint {
  const rolePackageComponents = buildRolePackageFingerprintComponent(args.rolePackagesByRoleId);
  const modelPackageComponents = buildModelPackageFingerprintComponent(args.modelsById);
  const compilerComponent = args.compilerSnapshot
    ? buildCompilerFingerprintComponent(args.compilerSnapshot)
    : undefined;
  const componentValues: Record<string, unknown> = {
    system: buildSystemFingerprintComponent(args.system, args.contractPlan?.digest ?? null),
    rolePackages: rolePackageComponents.map((component) => component.identity),
    modelPackages: modelPackageComponents.map((component) => component.identity),
    effectiveLaw: normalizeFingerprintValue(args.effectiveLaw)
  };
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
      modelPackages: {
        digest: componentDigests.modelPackages,
        value: componentValues.modelPackages,
        sourceHints: modelPackageComponents.map((component) => component.sourceHints)
      },
      effectiveLaw: {
        digest: componentDigests.effectiveLaw,
        value: componentValues.effectiveLaw
      },
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
    version: 4,
    algorithm: "sha256",
    digest,
    payload
  };
}
