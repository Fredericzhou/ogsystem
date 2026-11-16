import { STUDIO_SYSTEM_END_ROLE_ID, type StudioAuthoringFlow, type StudioAuthoringRole } from "../studio-contracts.js";
import { escapeHtml } from "../html-escape.js";
import { asRecord, asTrimmedString } from "../json-guards.js";
import type {
  StudioAuthoringCommand
} from "./studio-graph-commands.js";
import {
  extractStudioRolePackages,
  normalizeStudioEventType,
  validateStudioAddEdgeDraft,
  listStudioBusinessEventTypes,
  validateStudioAddRoleDraft,
  type StudioAddEdgeDraft,
  type StudioAddRoleDraft,
  type StudioCommandValidationContext,
  type StudioRolePackageSummary,
  type StudioValidationResult
} from "./studio-graph-validation.js";

export type StudioCommandFormKind = "add-role" | "add-edge" | "edit-role" | "edit-edge";

export type StudioCommandFormLabels = Partial<Record<
  | "roleDialogTitle"
  | "edgeDialogTitle"
  | "editRoleDialogTitle"
  | "editEdgeDialogTitle"
  | "repositoryRole"
  | "customRole"
  | "rolePackage"
  | "rolePackageSource"
  | "roleId"
  | "title"
  | "modelRef"
  | "sourceRole"
  | "targetRole"
  | "flowLabel"
  | "eventType"
  | "runtimeOnlyErrorFlow"
  | "participatesInJoin"
  | "cancel"
  | "create"
  | "save"
  | "noRepositoryRoles"
  | "noModels"
  | "noProfiles"
  | "noTools"
  | "outputTarget",
  string
>>;

export type StudioCommandFormState =
  | {
      kind: "add-role";
      fields: StudioAddRoleDraft;
      validation: StudioValidationResult;
    }
  | {
      kind: "add-edge";
      fields: StudioAddEdgeDraft;
      validation: StudioValidationResult;
    }
  | {
      kind: "edit-role";
      fields: StudioAddRoleDraft;
      validation: StudioValidationResult;
    }
  | {
      kind: "edit-edge";
      fields: StudioAddEdgeDraft;
      validation: StudioValidationResult;
    };

function label(labels: StudioCommandFormLabels | undefined, key: keyof StudioCommandFormLabels, fallback: string): string {
  return labels?.[key] ?? fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asTrimmedStringOrEmpty(value: unknown): string {
  return asTrimmedString(value) ?? "";
}

function firstRoleId(context: StudioCommandValidationContext): string {
  return Object.keys(context.authoring?.roles ?? {}).sort()[0] ?? "";
}

function nextRoleId(context: StudioCommandValidationContext, base = "new-role"): string {
  const roles = context.authoring?.roles ?? {};
  let candidate = base;
  let suffix = 2;
  while (roles[candidate]) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function defaultRepositoryRolePackage(context: StudioCommandValidationContext): StudioRolePackageSummary | undefined {
  const existingRoleIds = new Set(Object.keys(context.authoring?.roles ?? {}));
  return extractStudioRolePackages(context.rolePackages)
    .find((rolePackage) =>
      Boolean(rolePackage.roleId) &&
      !existingRoleIds.has(rolePackage.roleId as string) &&
      (!rolePackage.status || rolePackage.status === "ok")
    );
}

export function createDefaultStudioCommandFormState(args: {
  kind: StudioCommandFormKind;
  context: StudioCommandValidationContext;
  sourceRoleId?: string;
  targetRoleId?: string;
  roleId?: string;
  flowId?: string;
  eventType?: string;
  label?: string;
  runtimeOnlyErrorFlow?: boolean;
  participatesInJoin?: boolean;
  condition?: StudioAuthoringFlow["condition"];
  priority?: number;
}): StudioCommandFormState {
  if (args.kind === "edit-role") {
    const roleId = args.roleId || firstRoleId(args.context);
    const role = args.context.authoring?.roles?.[roleId];
    const fields: StudioAddRoleDraft = {
      mode: "custom",
      originalRoleId: roleId,
      roleId,
      title: role?.title || roleId,
      // v2 authoring creates only Harness/model bindings. Legacy values are
      // shown as an unresolved model so saving requires an explicit repair.
      bindingKind: "model",
      modelRef: role?.modelRef,
    };
    return {
      kind: "edit-role",
      fields,
      validation: validateStudioAddRoleDraft(fields, args.context)
    };
  }

  if (args.kind === "add-role") {
    const rolePackage = defaultRepositoryRolePackage(args.context);
    const roleId = rolePackage?.roleId || nextRoleId(args.context);
    const models = extractStudioModelOptions(args.context);
    const fields: StudioAddRoleDraft = {
      mode: rolePackage ? "repository" : "custom",
      repositoryRoleId: rolePackage?.roleId,
      roleId,
      title: rolePackage?.name || rolePackage?.roleId || "",
      bindingKind: "model",
      modelRef: models.find((model) => model.ref === "opencode/openai/gpt-6-luna" || model.ref.endsWith("/gpt-6-luna"))?.ref ||
        models.find((model) => model.ref.startsWith("opencode/"))?.ref ||
        models[0]?.ref,
    };
    return {
      kind: "add-role",
      fields,
      validation: validateStudioAddRoleDraft(fields, args.context)
    };
  }

  const fields: StudioAddEdgeDraft = {
    flowId: args.flowId,
    originalSourceRoleId: args.kind === "edit-edge" ? args.sourceRoleId : undefined,
    originalTargetRoleId: args.kind === "edit-edge" ? args.targetRoleId : undefined,
    originalEventType: args.kind === "edit-edge" ? args.eventType : undefined,
    sourceRoleId: args.sourceRoleId || firstRoleId(args.context),
    targetRoleId: args.targetRoleId || STUDIO_SYSTEM_END_ROLE_ID,
    eventType: args.eventType || defaultStudioFlowEventType(args.context, args.sourceRoleId || firstRoleId(args.context)),
    label: args.label || "",
    runtimeOnlyErrorFlow: Boolean(args.runtimeOnlyErrorFlow),
    participatesInJoin: Boolean(args.participatesInJoin),
    conditionJson: args.condition ? JSON.stringify(args.condition, null, 2) : "",
    priority: String(args.priority ?? 0)
  };
  return {
    kind: args.kind === "edit-edge" ? "edit-edge" : "add-edge",
    fields,
    validation: validateStudioAddEdgeDraft(fields, args.context)
  };
}

export function defaultStudioFlowEventType(context: StudioCommandValidationContext, sourceRoleId: string): string {
  if (sourceRoleId === "__system_start__") return "START";
  const existing = Object.values(context.authoring?.flows ?? {})
    .find((flow) => flow.fromRoleId === sourceRoleId)?.eventType;
  if (existing) return existing;
  const declared = extractStudioRolePackages(context.rolePackages)
    .find((rolePackage) => rolePackage.roleId === sourceRoleId)?.allowedEvents?.[0];
  if (declared) return declared;
  const roleId = context.authoring?.roles?.[sourceRoleId]?.roleId || sourceRoleId;
  const stem = roleId.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return "READY";
}

export function commandFromStudioCommandFormState(state: StudioCommandFormState): StudioAuthoringCommand | null {
  if (!state.validation.ok) {
    return null;
  }
  if (state.kind === "add-role" || state.kind === "edit-role") {
    const bindingKind: StudioAuthoringRole["bindingKind"] = "model";
    const modelRef = bindingKind === "model" ? state.fields.modelRef?.trim() : undefined;
    const modelSeparator = modelRef?.indexOf("/") ?? -1;
    const backend = modelSeparator > 0 ? modelRef?.slice(0, modelSeparator) : undefined;
    const modelId = modelSeparator > 0 ? modelRef?.slice(modelSeparator + 1) : undefined;
    if (state.kind === "edit-role") {
      return {
        type: "update-role",
        originalRoleId: state.fields.originalRoleId || state.fields.roleId.trim(),
        roleId: state.fields.roleId.trim(),
        title: (state.fields.title || state.fields.roleId).trim(),
        bindingKind,
        backend,
        modelId,
        modelRef
      };
    }
    return {
      type: "add-role",
      repositoryRoleId: state.fields.mode === "repository" ? state.fields.repositoryRoleId?.trim() : undefined,
      roleId: state.fields.roleId.trim(),
      title: (state.fields.title || state.fields.roleId).trim(),
      bindingKind,
      backend,
      modelId,
      modelRef
    };
  }
  if (state.kind === "edit-edge") {
    return {
      type: "update-edge",
      flowId: state.fields.flowId,
      originalSourceRoleId: state.fields.originalSourceRoleId || state.fields.sourceRoleId.trim(),
      originalTargetRoleId: state.fields.originalTargetRoleId || state.fields.targetRoleId.trim(),
      originalEventType: state.fields.originalEventType || normalizeStudioEventType(state.fields.eventType || "READY"),
      sourceRoleId: state.fields.sourceRoleId.trim(),
      targetRoleId: state.fields.targetRoleId.trim(),
      eventType: normalizeStudioEventType(state.fields.eventType || "READY"),
      label: state.fields.label?.trim(),
      runtimeOnlyErrorFlow: Boolean(state.fields.runtimeOnlyErrorFlow),
      participatesInJoin: Boolean(state.fields.participatesInJoin),
      condition: parseCondition(state.fields.conditionJson),
      priority: Number(state.fields.priority || 0)
    };
  }
  return {
    type: "add-edge",
    sourceRoleId: state.fields.sourceRoleId.trim(),
    targetRoleId: state.fields.targetRoleId.trim(),
    eventType: normalizeStudioEventType(state.fields.eventType || "READY"),
    label: state.fields.label?.trim(),
    runtimeOnlyErrorFlow: Boolean(state.fields.runtimeOnlyErrorFlow),
    participatesInJoin: Boolean(state.fields.participatesInJoin),
    condition: parseCondition(state.fields.conditionJson),
    priority: Number(state.fields.priority || 0)
  };
}

function parseCondition(source: string | undefined): StudioAuthoringFlow["condition"] {
  const text = (source ?? "").trim();
  if (!text) return undefined;
  try { return JSON.parse(text) as StudioAuthoringFlow["condition"]; } catch { return undefined; }
}

export function renderStudioCommandFormDiagnostics(state: StudioCommandFormState): string {
  return '<div class="studio-command-form-diagnostics" data-studio-command-diagnostics aria-live="polite">' + state.validation.diagnostics.map((diagnostic) =>
    '<div class="studio-command-form-diagnostic ' + escapeHtml(diagnostic.severity) + '" data-studio-diagnostic-code="' +
    escapeHtml(diagnostic.code) + '">' + escapeHtml(diagnostic.message || diagnostic.code) + "</div>"
  ).join("") + "</div>";
}

export function renderStudioCommandFormFieldError(state: StudioCommandFormState, fieldPath: string): string {
  const diagnostic = state.validation.diagnostics.find((item) => item.severity === "error" && item.fieldPath === fieldPath);
  return diagnostic
    ? '<div class="studio-command-form-error" data-studio-command-error="' + escapeHtml(fieldPath) + '" aria-live="polite">' + escapeHtml(diagnostic.message || diagnostic.code) + '</div>'
    : '<div class="studio-command-form-error" data-studio-command-error="' + escapeHtml(fieldPath) + '" aria-live="polite"></div>';
}

function renderRoleOptions(context: StudioCommandValidationContext, selected: string): string {
  const roleIds = Object.keys(context.authoring?.roles ?? {}).sort();
  return roleIds.map((roleId) =>
    '<option value="' + escapeHtml(roleId) + '"' + (roleId === selected ? " selected" : "") + ">" +
    escapeHtml(roleId) + "</option>"
  ).join("");
}

type StudioModelOption = {
  ref: string;
  label: string;
};

function extractStudioModelOptions(context: StudioCommandValidationContext): StudioModelOption[] {
  const config = asRecord(context.projectConfig);
  const catalog = asRecord(config?.modelCatalog ?? context.projectConfig);
  return asArray(catalog?.models)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined && entry.runnable === true)
    .map((entry) => {
      const backend = asTrimmedStringOrEmpty(entry.backend);
      const modelId = asTrimmedStringOrEmpty(entry.modelId) || asTrimmedStringOrEmpty(entry.id);
      const ref = backend && modelId ? `${backend}/${modelId}` : "";
      const name = asTrimmedStringOrEmpty(entry.name);
      const labelParts = [name || modelId || ref, backend && modelId ? `${backend} · ${modelId}` : ""].filter(Boolean);
      return {
        ref,
        label: labelParts.length ? labelParts.join(" - ") : ref
      };
    })
    .filter((entry) => Boolean(entry.ref))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function renderModelBindingField(args: {
  state: StudioCommandFormState;
  fields: StudioAddRoleDraft;
  context: StudioCommandValidationContext;
  labels?: StudioCommandFormLabels;
}): string {
  const options = extractStudioModelOptions(args.context);
  const selected = args.fields.modelRef || "";
  if (!options.length) {
    return '<label class="studio-command-form-row"><span>' + escapeHtml(label(args.labels, "modelRef", "Model")) + '</span><select name="modelRef" disabled><option value="" selected>' + escapeHtml(label(args.labels, "noModels", "No runnable models available.")) + '</option></select>' +
      renderStudioCommandFormFieldError(args.state, "modelRef") + "</label>";
  }
  const hasSelected = options.some((option) => option.ref === selected);
  const optionHtml = (hasSelected ? [] : [{ ref: "", label: label(args.labels, "modelRef", "Choose a discovered model") }])
    .concat(options)
    .map((option) =>
      '<option value="' + escapeHtml(option.ref) + '"' + (option.ref === selected || (!hasSelected && !option.ref) ? " selected" : "") + ">" +
      escapeHtml(option.label) + "</option>"
    )
    .join("");
  return '<label class="studio-command-form-row"><span>' + escapeHtml(label(args.labels, "modelRef", "Model")) + '</span><select name="modelRef">' +
    optionHtml + "</select>" + renderStudioCommandFormFieldError(args.state, "modelRef") + "</label>";
}

export function renderStudioCommandForm(args: {
  state: StudioCommandFormState;
  context: StudioCommandValidationContext;
  labels?: StudioCommandFormLabels;
}): string {
  const labels = args.labels;
  const disabled = args.state.validation.ok ? "" : " disabled";
  if (args.state.kind === "add-role" || args.state.kind === "edit-role") {
    const rolePackages = extractStudioRolePackages(args.context.rolePackages);
    const fields = args.state.fields;
    const isEdit = args.state.kind === "edit-role";
    const packageOptions = rolePackages.length
      ? rolePackages.map((rolePackage) =>
          '<option value="' + escapeHtml(rolePackage.roleId) + '"' +
          (rolePackage.roleId === fields.repositoryRoleId ? " selected" : "") + ">" +
          escapeHtml(rolePackage.name || rolePackage.roleId) +
          (rolePackage.alreadyImported ? " · imported" : "") +
          "</option>"
        ).join("")
      : '<option value="">' + escapeHtml(label(labels, "noRepositoryRoles", "No role library entries")) + "</option>";
    return [
      '<form class="studio-command-form" data-studio-command-form="' + (isEdit ? "edit-role" : "add-role") + '" role="dialog" aria-modal="true" aria-labelledby="studio-command-form-title">',
      '<div class="studio-command-form-header"><strong id="studio-command-form-title">' + escapeHtml(isEdit ? label(labels, "editRoleDialogTitle", "Edit role") : label(labels, "roleDialogTitle", "Add role")) + '</strong>',
      '<button type="button" data-studio-command-close aria-label="' + escapeHtml(label(labels, "cancel", "Cancel")) + '">' + escapeHtml(label(labels, "cancel", "Cancel")) + '</button></div>',
      isEdit ? "" : '<div class="studio-command-form-row segmented">',
      isEdit ? "" : '<label><input type="radio" name="mode" value="repository"' + (fields.mode === "repository" ? " checked" : "") + "> " + escapeHtml(label(labels, "repositoryRole", "Role library")) + "</label>",
      isEdit ? "" : '<label><input type="radio" name="mode" value="custom"' + (fields.mode === "custom" ? " checked" : "") + "> " + escapeHtml(label(labels, "customRole", "Custom role")) + "</label>",
      isEdit ? "" : "</div>",
      isEdit ? '<input type="hidden" name="mode" value="custom"><input type="hidden" name="originalRoleId" value="' + escapeHtml(fields.originalRoleId || fields.roleId) + '">' : "",
      !isEdit && fields.mode === "repository" ? '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "rolePackage", "Role package")) + '</span><select name="repositoryRoleId">' + packageOptions + "</select><div class=\"studio-command-form-hint\">" + escapeHtml(label(labels, "rolePackageSource", "Import from the installed role catalog.")) + "</div>" + renderStudioCommandFormFieldError(args.state, "repositoryRoleId") + "</label>" : "",
      '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "roleId", "Role id")) + '</span><input name="roleId" value="' + escapeHtml(fields.roleId) + '"' + (!isEdit && fields.mode === "repository" ? " readonly" : "") + '>' + renderStudioCommandFormFieldError(args.state, "roleId") + "</label>",
      '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "title", "Title")) + '</span><input name="title" value="' + escapeHtml(fields.title || "") + '"></label>',
      renderModelBindingField({ state: args.state, fields, context: args.context, labels }),
      renderStudioCommandFormDiagnostics(args.state),
      '<div class="studio-command-form-actions"><button type="submit"' + disabled + '>' + escapeHtml(isEdit ? label(labels, "save", "Save") : label(labels, "create", "Create")) + "</button></div>",
      "</form>"
    ].join("");
  }

  const fields = args.state.fields;
  const isEditEdge = args.state.kind === "edit-edge";
  const targetOptions = renderRoleOptions(args.context, fields.targetRoleId) +
    '<option value="' + STUDIO_SYSTEM_END_ROLE_ID + '"' +
    (fields.targetRoleId === STUDIO_SYSTEM_END_ROLE_ID || fields.targetRoleId === "output" ? " selected" : "") + ">" +
    escapeHtml(label(labels, "outputTarget", "output/end")) + "</option>";
  return [
    '<form class="studio-command-form" data-studio-command-form="' + (isEditEdge ? "edit-edge" : "add-edge") + '" role="dialog" aria-modal="true" aria-labelledby="studio-command-form-title">',
    '<div class="studio-command-form-header"><strong id="studio-command-form-title">' + escapeHtml(isEditEdge ? label(labels, "editEdgeDialogTitle", "Edit flow") : label(labels, "edgeDialogTitle", "Add edge")) + '</strong>',
    '<button type="button" data-studio-command-close aria-label="' + escapeHtml(label(labels, "cancel", "Cancel")) + '">' + escapeHtml(label(labels, "cancel", "Cancel")) + '</button></div>',
    isEditEdge ? '<input type="hidden" name="flowId" value="' + escapeHtml(fields.flowId || "") + '"><input type="hidden" name="originalSourceRoleId" value="' + escapeHtml(fields.originalSourceRoleId || fields.sourceRoleId) + '"><input type="hidden" name="originalTargetRoleId" value="' + escapeHtml(fields.originalTargetRoleId || fields.targetRoleId) + '"><input type="hidden" name="originalEventType" value="' + escapeHtml(fields.originalEventType || fields.eventType || "") + '">' : "",
    '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "sourceRole", "Source role")) + '</span><select name="sourceRoleId">' + renderRoleOptions(args.context, fields.sourceRoleId) + "</select>" + renderStudioCommandFormFieldError(args.state, "sourceRoleId") + "</label>",
    '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "targetRole", "Target role")) + '</span><select name="targetRoleId">' + targetOptions + "</select>" + renderStudioCommandFormFieldError(args.state, "targetRoleId") + "</label>",
    '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "flowLabel", "Display name")) + '</span><input name="label" value="' + escapeHtml(fields.label || "") + '"></label>',
    '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "eventType", "Event type")) + '</span><select name="eventType">' + listStudioBusinessEventTypes().map((eventType) => '<option value="' + escapeHtml(eventType) + '"' + (eventType === fields.eventType ? " selected" : "") + '>' + escapeHtml(eventType) + '</option>').join("") + '</select>' + renderStudioCommandFormFieldError(args.state, "eventType") + "</label>",
    '<label class="studio-command-form-row"><span>Condition AST (JSON, optional)</span><textarea name="conditionJson" rows="8" spellcheck="false">' + escapeHtml(fields.conditionJson || "") + '</textarea><div class="studio-command-form-hint">Restricted AST. Paths may read state, loop, event, or role. Leave empty for an unconditional route.</div>' + renderStudioCommandFormFieldError(args.state, "conditionJson") + '</label>',
    '<label class="studio-command-form-row"><span>Priority</span><input type="number" name="priority" min="0" step="1" value="' + escapeHtml(fields.priority || "0") + '">' + renderStudioCommandFormFieldError(args.state, "priority") + '</label>',
    '<label class="studio-command-form-check"><input type="checkbox" name="runtimeOnlyErrorFlow"' + (fields.runtimeOnlyErrorFlow ? " checked" : "") + "> " + escapeHtml(label(labels, "runtimeOnlyErrorFlow", "Runtime error flow")) + "</label>",
    '<label class="studio-command-form-check"><input type="checkbox" name="participatesInJoin"' + (fields.participatesInJoin ? " checked" : "") + "> " + escapeHtml(label(labels, "participatesInJoin", "Join source")) + "</label>",
    renderStudioCommandFormDiagnostics(args.state),
    '<div class="studio-command-form-actions"><button type="submit"' + disabled + '>' + escapeHtml(isEditEdge ? label(labels, "save", "Save") : label(labels, "create", "Create")) + "</button></div>",
    "</form>"
  ].join("");
}

export function readStudioCommandFormState(args: {
  form: HTMLFormElement;
  previous: StudioCommandFormState;
  context: StudioCommandValidationContext;
}): StudioCommandFormState {
  const data = new FormData(args.form);
  if (args.previous.kind === "add-role" || args.previous.kind === "edit-role") {
    const mode = data.get("mode") === "repository" ? "repository" : "custom";
    const rolePackages = extractStudioRolePackages(args.context.rolePackages);
    const repositoryRoleId = String(data.get("repositoryRoleId") ?? "").trim() || rolePackages[0]?.roleId || "";
    const rolePackage = rolePackages.find((entry) => entry.roleId === repositoryRoleId);
    const bindingKind = "model" as const;
    const roleId = mode === "repository"
      ? rolePackage?.roleId ?? ""
      : String(data.get("roleId") ?? "").trim();
    const fields: StudioAddRoleDraft = {
      mode,
      originalRoleId: String(data.get("originalRoleId") ?? args.previous.fields.originalRoleId ?? "").trim(),
      repositoryRoleId,
      roleId,
      title: String(data.get("title") ?? "").trim() || (mode === "repository" ? rolePackage?.name ?? "" : ""),
      bindingKind,
      modelRef: String(data.get("modelRef") ?? "").trim()
    };
    return {
      kind: args.previous.kind,
      fields,
      validation: validateStudioAddRoleDraft(fields, args.context)
    };
  }

  const fields: StudioAddEdgeDraft = {
    flowId: String(data.get("flowId") ?? args.previous.fields.flowId ?? "").trim() || undefined,
    originalSourceRoleId: String(data.get("originalSourceRoleId") ?? args.previous.fields.originalSourceRoleId ?? "").trim() || undefined,
    originalTargetRoleId: String(data.get("originalTargetRoleId") ?? args.previous.fields.originalTargetRoleId ?? "").trim() || undefined,
    originalEventType: String(data.get("originalEventType") ?? args.previous.fields.originalEventType ?? "").trim() || undefined,
    sourceRoleId: String(data.get("sourceRoleId") ?? "").trim(),
    targetRoleId: String(data.get("targetRoleId") ?? "").trim(),
    eventType: String(data.get("eventType") ?? "").trim(),
    label: String(data.get("label") ?? "").trim(),
    runtimeOnlyErrorFlow: data.get("runtimeOnlyErrorFlow") === "on",
    participatesInJoin: data.get("participatesInJoin") === "on",
    conditionJson: String(data.get("conditionJson") ?? ""),
    priority: String(data.get("priority") ?? "0")
  };
  return {
    kind: args.previous.kind,
    fields,
    validation: validateStudioAddEdgeDraft(fields, args.context)
  };
}
