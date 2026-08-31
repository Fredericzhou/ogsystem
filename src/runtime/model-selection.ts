import { readJsonFile } from "./json-file.js";
import { pathExists } from "./run-store.js";
import { createRuntimeError } from "./runtime-errors.js";
import type {
  ModelCatalog,
  ModelSelectionConfig,
  ModelSelectionDefaults,
  ModelSelectionRoleOverride,
  SystemDefinition
} from "./types.js";

function fail(filePath: string, fieldPath: string, message: string): never {
  throw new Error(`Invalid model selection in ${filePath} at ${fieldPath}: ${message}`);
}

function asRecord(value: unknown, filePath: string, fieldPath: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(filePath, fieldPath, "expected object");
  }
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown, filePath: string, fieldPath: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    fail(filePath, fieldPath, "expected non-empty string");
  }
  return value;
}

function asOptionalPositiveInteger(
  value: unknown,
  filePath: string,
  fieldPath: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(filePath, fieldPath, "expected positive integer");
  }
  return value;
}

export function isDirectModelRef(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  const separator = value.indexOf("/");
  return separator > 0 && separator < value.length - 1;
}

function validateSelectionDefaults(
  value: unknown,
  filePath: string,
  fieldPath: string
): ModelSelectionDefaults {
  const record = asRecord(value, filePath, fieldPath);
  return {
    model: asOptionalString(record.model, filePath, `${fieldPath}.model`),
    variant: asOptionalString(record.variant, filePath, `${fieldPath}.variant`),
    timeoutMs: asOptionalPositiveInteger(record.timeoutMs, filePath, `${fieldPath}.timeoutMs`),
    maxOutputBytes: asOptionalPositiveInteger(
      record.maxOutputBytes,
      filePath,
      `${fieldPath}.maxOutputBytes`
    )
  };
}

function validateRoleOverrides(
  value: unknown,
  filePath: string,
  fieldPath: string
): Record<string, ModelSelectionRoleOverride> {
  const record = asRecord(value, filePath, fieldPath);
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      validateSelectionDefaults(entry, filePath, `${fieldPath}.${key}`)
    ])
  );
}

export function validateModelSelection(value: unknown, filePath: string): ModelSelectionConfig {
  const record = asRecord(value, filePath, "$");
  const configVersion = asOptionalString(record.configVersion, filePath, "$.configVersion");
  if (configVersion !== "1") {
    fail(filePath, "$.configVersion", `unsupported version "${configVersion ?? "(missing)"}"`);
  }

  const systemsValue = record.systems;
  const systems =
    systemsValue === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(asRecord(systemsValue, filePath, "$.systems")).map(([systemId, entry]) => {
            const systemRecord = asRecord(entry, filePath, `$.systems.${systemId}`);
            return [
              systemId,
              {
                defaults:
                  systemRecord.defaults === undefined
                    ? undefined
                    : validateSelectionDefaults(
                        systemRecord.defaults,
                        filePath,
                        `$.systems.${systemId}.defaults`
                      ),
                roles:
                  systemRecord.roles === undefined
                    ? undefined
                    : validateRoleOverrides(systemRecord.roles, filePath, `$.systems.${systemId}.roles`)
              }
            ];
          })
        );

  const selection = {
    configVersion: "1",
    defaults:
      record.defaults === undefined
        ? undefined
        : validateSelectionDefaults(record.defaults, filePath, "$.defaults"),
    systems,
    roles:
      record.roles === undefined ? undefined : validateRoleOverrides(record.roles, filePath, "$.roles")
  } satisfies ModelSelectionConfig;

  const selectionsToValidate: ReadonlyArray<
    readonly [string, ModelSelectionDefaults | ModelSelectionRoleOverride | undefined]
  > = [
    ["$.defaults", selection.defaults],
    ...Object.entries(selection.roles ?? {}).map(([roleId, entry]) => [`$.roles.${roleId}`, entry] as const),
    ...Object.entries(selection.systems ?? {}).flatMap(([systemId, entry]) => [
      [`$.systems.${systemId}.defaults`, entry.defaults] as const,
      ...Object.entries(entry.roles ?? {}).map(
        ([roleId, roleEntry]) => [`$.systems.${systemId}.roles.${roleId}`, roleEntry] as const
      )
    ])
  ];

  for (const [pathLabel, maybeSelection] of selectionsToValidate) {
    if (maybeSelection?.model && !isDirectModelRef(maybeSelection.model)) {
      fail(filePath, `${pathLabel}.model`, 'expected "provider/model" format');
    }
  }

  return selection;
}

export async function loadModelSelection(path: string): Promise<ModelSelectionConfig | undefined> {
  if (!(await pathExists(path))) {
    return undefined;
  }
  return validateModelSelection(await readJsonFile(path), path);
}

export type ResolvedModelRuntimeConfig = {
  modelRef: string;
  variant?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  bindingSource: "system" | "selection";
};

function mergeSelectionLayers(
  ...layers: Array<ModelSelectionDefaults | ModelSelectionRoleOverride | undefined>
): ModelSelectionDefaults {
  return layers.reduce<ModelSelectionDefaults>(
    (merged, layer) => ({
      model: layer?.model ?? merged.model,
      variant: layer?.variant ?? merged.variant,
      timeoutMs: layer?.timeoutMs ?? merged.timeoutMs,
      maxOutputBytes: layer?.maxOutputBytes ?? merged.maxOutputBytes
    }),
    {}
  );
}

function advisoryCatalogWarning(args: {
  systemId: string;
  roleId: string;
  modelRef: string;
  catalog?: ModelCatalog;
}): string | undefined {
  if (!args.catalog) {
    return undefined;
  }
  if (args.catalog.models.some((entry) => entry.ref === args.modelRef)) {
    return undefined;
  }
  return `system "${args.systemId}" role "${args.roleId}" selects "${args.modelRef}" which is not present in .ogs/model-catalog.json`;
}

export function resolveModelSelectionForSystem(args: {
  system: SystemDefinition;
  selection?: ModelSelectionConfig;
  catalog?: ModelCatalog;
}): {
  resolvedByRoleId: Map<string, ResolvedModelRuntimeConfig>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const resolvedByRoleId = new Map<string, ResolvedModelRuntimeConfig>();
  const systemSelection = args.selection?.systems?.[args.system.systemId];

  for (const roleId of args.system.roleIds) {
    const systemBinding = args.system.modelBinding[roleId];
    const directSystemRef = isDirectModelRef(systemBinding) ? systemBinding : undefined;
    const selectionLayer = mergeSelectionLayers(
      args.selection?.defaults,
      systemSelection?.defaults,
      args.selection?.roles?.[roleId],
      systemSelection?.roles?.[roleId]
    );

    if (directSystemRef) {
      const resolved = {
        modelRef: directSystemRef,
        variant: selectionLayer.variant,
        timeoutMs: selectionLayer.timeoutMs,
        maxOutputBytes: selectionLayer.maxOutputBytes,
        bindingSource: "system"
      } satisfies ResolvedModelRuntimeConfig;
      resolvedByRoleId.set(roleId, resolved);
      const advisory = advisoryCatalogWarning({
        systemId: args.system.systemId,
        roleId,
        modelRef: resolved.modelRef,
        catalog: args.catalog
      });
      if (advisory) {
        warnings.push(advisory);
      }
      continue;
    }

    if (selectionLayer.model) {
      const resolved = {
        modelRef: selectionLayer.model,
        variant: selectionLayer.variant,
        timeoutMs: selectionLayer.timeoutMs,
        maxOutputBytes: selectionLayer.maxOutputBytes,
        bindingSource: "selection"
      } satisfies ResolvedModelRuntimeConfig;
      resolvedByRoleId.set(roleId, resolved);
      const advisory = advisoryCatalogWarning({
        systemId: args.system.systemId,
        roleId,
        modelRef: resolved.modelRef,
        catalog: args.catalog
      });
      if (advisory) {
        warnings.push(advisory);
      }
      continue;
    }

    if (systemBinding && !args.selection && !args.system.executionBinding[roleId]) {
      throw createRuntimeError({
        errorCode: "MODEL_SELECTION_NOT_FOUND",
        errorCategory: "config",
        stage: "config",
        retryable: false,
        message:
          `Role "${roleId}" uses non-direct model.bind "${systemBinding}" but .ogs/model-selection.json is missing.`
      });
    }

    if (systemBinding && !args.system.executionBinding[roleId]) {
      throw createRuntimeError({
        errorCode: "MODEL_BINDING_UNRESOLVED",
        errorCategory: "config",
        stage: "config",
        retryable: false,
        message:
          `Role "${roleId}" uses model.bind "${systemBinding}" which is not a direct "provider/model" ref and no selection override resolved it.`
      });
    }
  }

  return {
    resolvedByRoleId,
    warnings
  };
}
