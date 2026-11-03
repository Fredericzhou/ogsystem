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
  ReasoningCapability,
  ReasoningEffort,
  ReasoningEffortLevel,
  ResolvedFallbackModel,
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

function rejectUnknownFields(record: Record<string, unknown>, allowed: readonly string[], filePath: string, fieldPath: string): void {
  const allowedFields = new Set(allowed);
  const unknownField = Object.keys(record).find((field) => !allowedFields.has(field));
  if (unknownField) fail(filePath, `${fieldPath}.${unknownField}`, "unsupported field");
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

const REASONING_EFFORTS: readonly ReasoningEffort[] = ["auto", "off", "on", "low", "medium", "high", "xhigh", "max"];

function optionalReasoningEffort(value: unknown, filePath: string, fieldPath: string): ReasoningEffort | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !REASONING_EFFORTS.includes(value as ReasoningEffort)) {
    fail(filePath, fieldPath, `expected one of ${REASONING_EFFORTS.join(", ")}`);
  }
  return value as ReasoningEffort;
}

function optionalFallback(value: unknown, filePath: string, fieldPath: string): ResolvedFallbackModel | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, filePath, fieldPath);
  rejectUnknownFields(record, ["backend", "modelId", "modelRef", "reasoningEffort"], filePath, fieldPath);
  const backend = optionalString(record.backend, filePath, `${fieldPath}.backend`);
  const modelId = optionalString(record.modelId, filePath, `${fieldPath}.modelId`);
  if (!backend || !modelId || !defaultBackendRegistry.has(backend)) {
    fail(filePath, fieldPath, "fallback.backend and fallback.modelId must be a registered backend pair");
  }
  return {
    backend,
    modelId,
    modelRef: optionalString(record.modelRef, filePath, `${fieldPath}.modelRef`) ?? modelId,
    reasoningEffort: optionalReasoningEffort(record.reasoningEffort, filePath, `${fieldPath}.reasoningEffort`)
  };
}

function validateEntry(
  value: unknown,
  filePath: string,
  fieldPath: string,
  options: { requireModelIdentity: boolean }
): ModelSelectionDefaults {
  const record = asRecord(value, filePath, fieldPath);
  rejectUnknownFields(record, ["backend", "modelId", "variant", "timeoutMs", "maxOutputBytes", "reasoningEffort", "fallback"], filePath, fieldPath);
  const backend = optionalString(record.backend, filePath, `${fieldPath}.backend`);
  const modelId = optionalString(record.modelId, filePath, `${fieldPath}.modelId`);
  const registeredIds = defaultBackendRegistry.listBackendIds();
  if (options.requireModelIdentity && (!backend || !modelId || !defaultBackendRegistry.has(backend))) {
    fail(filePath, fieldPath, `backend and modelId must be a registered backend pair (${registeredIds.join(", ")})`);
  }
  if (backend && !defaultBackendRegistry.has(backend)) {
    fail(filePath, `${fieldPath}.backend`, `expected a registered backend (${registeredIds.join(", ")})`);
  }
  return {
    backend,
    modelId,
    variant: optionalString(record.variant, filePath, `${fieldPath}.variant`),
    timeoutMs: optionalPositiveInteger(record.timeoutMs, filePath, `${fieldPath}.timeoutMs`),
    maxOutputBytes: optionalPositiveInteger(record.maxOutputBytes, filePath, `${fieldPath}.maxOutputBytes`),
    reasoningEffort: optionalReasoningEffort(record.reasoningEffort, filePath, `${fieldPath}.reasoningEffort`),
    fallback: optionalFallback(record.fallback, filePath, `${fieldPath}.fallback`)
  };
}

export function validateModelSelection(value: unknown, filePath: string): ModelSelectionConfig {
  const record = asRecord(value, filePath, "$");
  if (record.configVersion !== "3") fail(filePath, "$.configVersion", `unsupported version "${String(record.configVersion ?? "(missing)")}"`);
  const defaults = record.defaults === undefined ? undefined : validateEntry(record.defaults, filePath, "$.defaults", { requireModelIdentity: true });
  const rolesValue = record.roles === undefined ? undefined : asRecord(record.roles, filePath, "$.roles");
  const roles = rolesValue
    ? Object.fromEntries(Object.entries(rolesValue).map(([roleId, entry]) => [roleId, validateEntry(entry, filePath, `$.roles.${roleId}`, { requireModelIdentity: false })]))
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
  modelRef: string;
  variant?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  reasoningEffort?: ReasoningEffort;
  effectiveReasoningEffort?: ReasoningEffortLevel;
  frozenReasoningEffort?: ReasoningEffortLevel;
  reasoningCapability?: ReasoningCapability;
  fallback?: ResolvedFallbackModel;
  bindingSource: "selection";
};

export type ModelSelectionCatalogIssue = {
  code: "MODEL_UNAVAILABLE" | "MODEL_CAPABILITY_MISMATCH" | "REASONING_UNSUPPORTED" | "REASONING_CAPABILITY_UNKNOWN";
  roleId: string;
  backend: string;
  modelId: string;
  modelRef: string;
  message: string;
  missingCapabilities?: string[];
  requestedReasoningEffort?: ReasoningEffort;
  supportedReasoningLevels?: string[];
};

function mergeEntry(...layers: Array<ModelSelectionDefaults | ModelSelectionRoleOverride | undefined>): ModelSelectionDefaults {
  return layers.reduce<ModelSelectionDefaults>((merged, layer) => ({
    backend: layer?.backend ?? merged.backend,
    modelId: layer?.modelId ?? merged.modelId,
    variant: layer?.variant ?? merged.variant,
    timeoutMs: layer?.timeoutMs ?? merged.timeoutMs,
    maxOutputBytes: layer?.maxOutputBytes ?? merged.maxOutputBytes,
    reasoningEffort: layer?.reasoningEffort ?? merged.reasoningEffort,
    fallback: layer?.fallback ?? merged.fallback
  }), {});
}

export function inspectResolvedModelCatalogEntry(args: {
  roleId: string;
  backend?: string;
  modelId?: string;
  modelRef?: string;
  reasoningEffort?: ReasoningEffort;
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
  const requestedReasoningEffort = args.reasoningEffort;
  if (requestedReasoningEffort && requestedReasoningEffort !== "auto") {
    const reasoning = entry.reasoning;
    if (!reasoning) {
      return {
        code: "REASONING_CAPABILITY_UNKNOWN",
        roleId: args.roleId,
        backend,
        modelId,
        modelRef,
        requestedReasoningEffort,
        message: `Reasoning capability is not known for ${backend}/${modelId}.`
      };
    }
    if (!reasoning.supported || !reasoning.levels.some((level) => level === requestedReasoningEffort)) {
      return {
        code: "REASONING_UNSUPPORTED",
        roleId: args.roleId,
        backend,
        modelId,
        modelRef,
        requestedReasoningEffort,
        supportedReasoningLevels: reasoning.levels,
        message: `Model ${backend}/${modelId} does not support reasoning effort ${requestedReasoningEffort}.`
      };
    }
  }
  return undefined;
}

export function resolveModelSelectionForSystem(args: {
  system: SystemDefinition;
  selection?: ModelSelectionConfig;
  catalog?: ModelCatalog;
  validateCatalog?: boolean;
  frozenReasoningByRoleId?: ReadonlyMap<string, ReasoningEffortLevel>;
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
      modelRef: selected.modelId,
      variant: selected.variant,
      timeoutMs: selected.timeoutMs,
      maxOutputBytes: selected.maxOutputBytes,
      reasoningEffort: selected.reasoningEffort,
      reasoningCapability: args.catalog?.models.find((item) => item.backend === selected.backend && item.modelId === selected.modelId)?.reasoning,
      effectiveReasoningEffort: selected.reasoningEffort === "auto"
        ? args.catalog?.models.find((item) => item.backend === selected.backend && item.modelId === selected.modelId)?.reasoning?.default
        : selected.reasoningEffort,
      frozenReasoningEffort: args.frozenReasoningByRoleId?.get(roleId),
      fallback: selected.fallback
        ? {
            ...selected.fallback,
            effectiveReasoningEffort: selected.fallback.reasoningEffort === "auto"
              ? args.catalog?.models.find((item) => item.backend === selected.fallback?.backend && item.modelId === selected.fallback?.modelId)?.reasoning?.default
              : selected.fallback.reasoningEffort
          }
        : undefined,
      bindingSource: "selection"
    };
    resolvedByRoleId.set(roleId, resolved);
    if (args.validateCatalog !== false) {
      const issue = inspectResolvedModelCatalogEntry({ ...resolved, roleId, catalog: args.catalog });
      if (issue) throw createRuntimeError({ errorCode: issue.code, errorCategory: "config", stage: "config", retryable: false, roleId, message: issue.message });
      if (resolved.fallback) {
        const fallbackIssue = inspectResolvedModelCatalogEntry({
          roleId,
          backend: resolved.fallback.backend,
          modelId: resolved.fallback.modelId,
          modelRef: resolved.fallback.modelRef,
          reasoningEffort: resolved.fallback.reasoningEffort,
          catalog: args.catalog
        });
        if (fallbackIssue) {
          throw createRuntimeError({
            errorCode: fallbackIssue.code,
            errorCategory: "config",
            stage: "config",
            retryable: false,
            roleId,
            message: `Fallback for role "${roleId}" is invalid: ${fallbackIssue.message}`
          });
        }
      }
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
