import { readJsonFile } from "./json-file.js";
import { isModelCatalogStale } from "./model-catalog.js";
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

export const REQUIRED_MODEL_CAPABILITIES = ["textInput", "textOutput"] as const;

export type ModelSelectionCatalogIssue = {
  code: "MODEL_UNAVAILABLE" | "MODEL_CAPABILITY_MISMATCH";
  roleId: string;
  modelRef: string;
  message: string;
  missingCapabilities?: string[];
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

export function inspectResolvedModelCatalogEntry(args: {
  roleId: string;
  modelRef: string;
  catalog?: ModelCatalog;
}): ModelSelectionCatalogIssue | undefined {
  if (!args.catalog) {
    return undefined;
  }

  const catalogEntry = args.catalog.models.find((entry) => entry.ref === args.modelRef);
  const catalogStale = isModelCatalogStale(args.catalog);
  if (!catalogEntry) {
    if (catalogStale) {
      return undefined;
    }
    return {
      code: "MODEL_UNAVAILABLE",
      roleId: args.roleId,
      modelRef: args.modelRef,
      message:
        `Role "${args.roleId}" selects "${args.modelRef}", but the fresh OpenCode discovery catalog does not report that model. ` +
        "Refresh the catalog or pin an available provider/model reference."
    };
  }

  const status = catalogEntry.status?.trim().toLowerCase();
  if (status && ["unavailable", "inactive", "disabled", "deprecated", "offline"].includes(status)) {
    return {
      code: "MODEL_UNAVAILABLE",
      roleId: args.roleId,
      modelRef: args.modelRef,
      message:
        `Role "${args.roleId}" selects "${args.modelRef}", which OpenCode reports as ${status}. ` +
        "Refresh discovery or pin an active provider/model reference."
    };
  }

  const missingCapabilities = REQUIRED_MODEL_CAPABILITIES.filter(
    (capability) => !catalogEntry.capabilities[capability]
  );
  if (missingCapabilities.length > 0) {
    return {
      code: "MODEL_CAPABILITY_MISMATCH",
      roleId: args.roleId,
      modelRef: args.modelRef,
      missingCapabilities: [...missingCapabilities],
      message:
        `Role "${args.roleId}" model "${args.modelRef}" is missing required capabilities: ${missingCapabilities.join(", ")}. ` +
        "Pin a model that advertises text input and text output capabilities."
    };
  }

  return undefined;
}

function assertResolvedModelCatalogEntry(args: {
  roleId: string;
  modelRef: string;
  catalog?: ModelCatalog;
}): void {
  const issue = inspectResolvedModelCatalogEntry(args);
  if (!issue) {
    return;
  }
  throw createRuntimeError({
    errorCode: issue.code,
    errorCategory: "config",
    stage: "config",
    retryable: false,
    roleId: issue.roleId,
    message: issue.message
  });
}

export function resolveModelSelectionForSystem(args: {
  system: SystemDefinition;
  selection?: ModelSelectionConfig;
  catalog?: ModelCatalog;
  validateCatalog?: boolean;
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
      if (args.validateCatalog !== false) {
        assertResolvedModelCatalogEntry({ roleId, modelRef: resolved.modelRef, catalog: args.catalog });
      }
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
      if (args.validateCatalog !== false) {
        assertResolvedModelCatalogEntry({ roleId, modelRef: resolved.modelRef, catalog: args.catalog });
      }
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

  if (resolvedByRoleId.size > 0 && !args.catalog) {
    warnings.push(
      "Model availability was not discovered because .ogs/model-catalog.json is missing; the pinned selections remain usable offline. Refresh with `ogs project sync-models` before relying on current availability."
    );
  } else if (resolvedByRoleId.size > 0 && args.catalog && isModelCatalogStale(args.catalog)) {
    warnings.push(
      `Model catalog generated at ${args.catalog.generatedAt} is stale; pinned model references remain in force and were not replaced. Refresh with \`ogs project sync-models\`.`
    );
  }

  return {
    resolvedByRoleId,
    warnings
  };
}
