import { readJsonFile } from "./json-file.js";
import { defaultBackendRegistry, type ModelBackendId } from "./model-backend-registry.js";
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

export const MODEL_BACKENDS: readonly ModelBackendId[] = Object.freeze(
  defaultBackendRegistry.listBackendIds()
);
export type ModelBackend = ModelBackendId;
export const REQUIRED_MODEL_CAPABILITIES = ["textInput", "textOutput"] as const;

export function isRegisteredModelBackend(backend: unknown): backend is ModelBackendId {
  return typeof backend === "string" && defaultBackendRegistry.has(backend.trim());
}

export function isDirectModelRef(value: string | undefined): value is string {
  return typeof value === "string" && value.indexOf("/") > 0 && value.indexOf("/") < value.length - 1;
}

function fail(filePath: string, fieldPath: string, message: string): never {
  throw new Error(`Invalid model selection in ${filePath} at ${fieldPath}: ${message}`);
}

function asRecord(value: unknown, filePath: string, fieldPath: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(filePath, fieldPath, "expected object");
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, filePath: string, fieldPath: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) fail(filePath, fieldPath, "expected non-empty string");
  return value;
}

function optionalPositiveInteger(value: unknown, filePath: string, fieldPath: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) fail(filePath, fieldPath, "expected positive integer");
  return value;
}

function validateEntry(value: unknown, filePath: string, fieldPath: string): ModelSelectionDefaults {
  const record = asRecord(value, filePath, fieldPath);
  const backend = optionalString(record.backend, filePath, `${fieldPath}.backend`);
  const modelId = optionalString(record.modelId, filePath, `${fieldPath}.modelId`);
  const registeredIds = defaultBackendRegistry.listBackendIds();
  if (!backend || !modelId || !defaultBackendRegistry.has(backend)) {
    fail(filePath, fieldPath, `backend and modelId must be a registered backend pair (${registeredIds.join(", ")})`);
  }
  return {
    backend,
    modelId,
    variant: optionalString(record.variant, filePath, `${fieldPath}.variant`),
    timeoutMs: optionalPositiveInteger(record.timeoutMs, filePath, `${fieldPath}.timeoutMs`),
    maxOutputBytes: optionalPositiveInteger(record.maxOutputBytes, filePath, `${fieldPath}.maxOutputBytes`),
    fallbackModelId: optionalString(record.fallbackModelId, filePath, `${fieldPath}.fallbackModelId`)
  };
}

export function validateModelSelection(value: unknown, filePath: string): ModelSelectionConfig {
  const record = asRecord(value, filePath, "$");
  if (record.configVersion !== "3") fail(filePath, "$.configVersion", `unsupported version "${String(record.configVersion ?? "(missing)")}"`);
  const defaults = record.defaults === undefined ? undefined : validateEntry(record.defaults, filePath, "$.defaults");
  const rolesValue = record.roles === undefined ? undefined : asRecord(record.roles, filePath, "$.roles");
  const roles = rolesValue
    ? Object.fromEntries(Object.entries(rolesValue).map(([roleId, entry]) => [roleId, validateEntry(entry, filePath, `$.roles.${roleId}`)]))
    : undefined;
  if (record.systems !== undefined) fail(filePath, "$.systems", "system-specific model overrides are not supported; configure role bindings directly");
  return { configVersion: "3", defaults, roles };
}

export async function loadModelSelection(path: string): Promise<ModelSelectionConfig | undefined> {
  if (!(await pathExists(path))) return undefined;
  return validateModelSelection(await readJsonFile(path), path);
}

export function withDefaultModelSelection(
  selection: ModelSelectionConfig | undefined,
  defaults: ModelSelectionDefaults | undefined
): ModelSelectionConfig | undefined {
  if (!defaults) return selection;
  return {
    configVersion: "3",
    defaults: { ...defaults, ...selection?.defaults },
    roles: selection?.roles
  };
}

export type ResolvedModelRuntimeConfig = {
  backend: ModelBackendId;
  modelId: string;
  variant?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  fallbackModelId?: string;
  bindingSource: "selection";
};

export type ModelSelectionCatalogIssue = {
  code: "MODEL_UNAVAILABLE" | "MODEL_CAPABILITY_MISMATCH";
  roleId: string;
  backend: string;
  modelId: string;
  modelRef: string;
  message: string;
  missingCapabilities?: string[];
};

function mergeEntry(...layers: Array<ModelSelectionDefaults | ModelSelectionRoleOverride | undefined>): ModelSelectionDefaults {
  return layers.reduce<ModelSelectionDefaults>((merged, layer) => ({
    backend: layer?.backend ?? merged.backend,
    modelId: layer?.modelId ?? merged.modelId,
    variant: layer?.variant ?? merged.variant,
    timeoutMs: layer?.timeoutMs ?? merged.timeoutMs,
    maxOutputBytes: layer?.maxOutputBytes ?? merged.maxOutputBytes,
    fallbackModelId: layer?.fallbackModelId ?? merged.fallbackModelId
  }), {});
}

export function inspectResolvedModelCatalogEntry(args: {
  roleId: string;
  backend?: string;
  modelId?: string;
  modelRef?: string;
  catalog?: ModelCatalog;
}): ModelSelectionCatalogIssue | undefined {
  if (!args.catalog) return undefined;
  const backend = args.backend ?? "opencode";
  const modelId = args.modelId ?? args.modelRef ?? "";
  const modelRef = args.modelRef ?? modelId;
  const entry = args.catalog.models.find((item) => item.backend === backend && item.modelId === modelId);
  if (!entry || !entry.runnable) {
    if (isModelCatalogStale(args.catalog)) return undefined;
    return {
      code: "MODEL_UNAVAILABLE",
      roleId: args.roleId,
      backend,
      modelId,
      modelRef,
      message: `Role "${args.roleId}" selects ${backend}/${modelId}, which is absent from the current model catalog. Run \`ogs models sync\`.`
    };
  }
  const status = entry.status?.trim().toLowerCase();
  if (status && ["unavailable", "inactive", "disabled", "deprecated", "offline"].includes(status)) {
    return { code: "MODEL_UNAVAILABLE", roleId: args.roleId, backend, modelId, modelRef, message: `Model ${backend}/${modelId} is reported as ${status}.` };
  }
  const missingCapabilities = REQUIRED_MODEL_CAPABILITIES.filter((capability) => !entry.capabilities[capability]);
  if (missingCapabilities.length) {
    return { code: "MODEL_CAPABILITY_MISMATCH", roleId: args.roleId, backend, modelId, modelRef, missingCapabilities, message: `Model ${backend}/${modelId} lacks required capabilities: ${missingCapabilities.join(", ")}.` };
  }
  return undefined;
}

export function resolveModelSelectionForSystem(args: {
  system: SystemDefinition;
  selection?: ModelSelectionConfig;
  catalog?: ModelCatalog;
  validateCatalog?: boolean;
}): { resolvedByRoleId: Map<string, ResolvedModelRuntimeConfig>; warnings: string[] } {
  const selection = args.selection ? validateModelSelection(args.selection, ".ogs/model-selection.json") : undefined;
  const resolvedByRoleId = new Map<string, ResolvedModelRuntimeConfig>();
  const warnings: string[] = [];
  for (const roleId of args.system.roleIds) {
    if (args.system.modelBinding[roleId]) {
      throw createRuntimeError({
        errorCode: "MODEL_BINDING_UNRESOLVED",
        errorCategory: "config",
        stage: "config",
        retryable: false,
        roleId,
        message: `Role "${roleId}" configures a model in system.mmd. Put backend and modelId in .ogs/model-selection.json.`
      });
    }
    const selected = mergeEntry(selection?.defaults, selection?.roles?.[roleId]);
    if (!selected.backend || !selected.modelId) {
      continue;
    }
    const resolved: ResolvedModelRuntimeConfig = {
      backend: selected.backend,
      modelId: selected.modelId,
      variant: selected.variant,
      timeoutMs: selected.timeoutMs,
      maxOutputBytes: selected.maxOutputBytes,
      fallbackModelId: selected.fallbackModelId,
      bindingSource: "selection"
    };
    resolvedByRoleId.set(roleId, resolved);
    if (args.validateCatalog !== false) {
      const issue = inspectResolvedModelCatalogEntry({ ...resolved, roleId, catalog: args.catalog });
      if (issue) throw createRuntimeError({ errorCode: issue.code, errorCategory: "config", stage: "config", retryable: false, roleId, message: issue.message });
    }
    if (args.catalog && !args.catalog.models.some((item) => item.backend === resolved.backend && item.modelId === resolved.modelId && item.runnable)) {
      warnings.push(`Role "${roleId}" selects ${resolved.backend}/${resolved.modelId}, which is not present in .ogs/model-catalog.json.`);
    }
  }
  if (resolvedByRoleId.size && (!args.catalog || isModelCatalogStale(args.catalog))) {
    warnings.push(args.catalog
      ? `Model catalog generated at ${args.catalog.generatedAt} is stale; refresh with \`ogs models sync\`.`
      : "Model availability has not been discovered; refresh with `ogs models sync`.");
  }
  return { resolvedByRoleId, warnings };
}
