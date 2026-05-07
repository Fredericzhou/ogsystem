import { STUDIO_SYSTEM_END_ROLE_ID, type StudioAuthoringRole } from "../studio-contracts.js";
import { escapeHtml } from "../html-escape.js";
import { asRecord, asTrimmedString } from "../json-guards.js";
import type { StudioAuthoringCommand, StudioExecutionProfileDraft } from "./studio-graph-commands.js";
import {
  extractStudioRolePackages,
  normalizeStudioEventType,
  validateStudioAddEdgeDraft,
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
  | "bindingKind"
  | "modelRef"
  | "profileId"
  | "existingProfile"
  | "createProfile"
  | "newProfileId"
  | "newProfileToolRef"
  | "newProfileTimeoutMs"
  | "newProfileMaxOutputBytes"
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

function profileIdFromRoleId(roleId: string): string {
  const normalized = roleId.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `profile.${normalized || "role"}`;
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
}): StudioCommandFormState {
  if (args.kind === "edit-role") {
    const roleId = args.roleId || firstRoleId(args.context);
    const role = args.context.authoring?.roles?.[roleId];
    const fields: StudioAddRoleDraft = {
      mode: "custom",
      originalRoleId: roleId,
      roleId,
      title: role?.title || roleId,
      bindingKind: role?.bindingKind || "noop",
      modelRef: role?.modelRef,
      profileId: role?.profileId,
      profileMode: "existing"
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
    const fields: StudioAddRoleDraft = {
      mode: rolePackage ? "repository" : "custom",
      repositoryRoleId: rolePackage?.roleId,
      roleId,
      title: rolePackage?.name || rolePackage?.roleId || "",
      bindingKind: "noop",
      profileMode: "existing",
      newProfileId: profileIdFromRoleId(roleId)
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
    eventType: args.eventType || "DONE",
    label: args.label || "",
    runtimeOnlyErrorFlow: Boolean(args.runtimeOnlyErrorFlow),
    participatesInJoin: Boolean(args.participatesInJoin)
  };
  return {
    kind: args.kind === "edit-edge" ? "edit-edge" : "add-edge",
    fields,
    validation: validateStudioAddEdgeDraft(fields, args.context)
  };
}

export function commandFromStudioCommandFormState(state: StudioCommandFormState): StudioAuthoringCommand | null {
  if (!state.validation.ok) {
    return null;
  }
  if (state.kind === "add-role" || state.kind === "edit-role") {
    const bindingKind: StudioAuthoringRole["bindingKind"] =
      state.fields.bindingKind === "model" || state.fields.bindingKind === "exec"
        ? state.fields.bindingKind
        : "noop";
    if (state.kind === "edit-role") {
      return {
        type: "update-role",
        originalRoleId: state.fields.originalRoleId || state.fields.roleId.trim(),
        roleId: state.fields.roleId.trim(),
        title: (state.fields.title || state.fields.roleId).trim(),
        bindingKind,
        modelRef: bindingKind === "model" ? state.fields.modelRef?.trim() : undefined,
        profileId: bindingKind === "exec" ? state.fields.profileId?.trim() : undefined,
        profileDraft: bindingKind === "exec" ? profileDraftFromFields(state.fields) : undefined
      };
    }
    return {
      type: "add-role",
      roleId: state.fields.roleId.trim(),
      title: (state.fields.title || state.fields.roleId).trim(),
      bindingKind,
      modelRef: bindingKind === "model" ? state.fields.modelRef?.trim() : undefined,
      profileId: bindingKind === "exec" ? state.fields.profileId?.trim() : undefined,
      profileDraft: bindingKind === "exec" ? profileDraftFromFields(state.fields) : undefined
    };
  }
  if (state.kind === "edit-edge") {
    return {
      type: "update-edge",
      flowId: state.fields.flowId,
      originalSourceRoleId: state.fields.originalSourceRoleId || state.fields.sourceRoleId.trim(),
      originalTargetRoleId: state.fields.originalTargetRoleId || state.fields.targetRoleId.trim(),
      originalEventType: state.fields.originalEventType || normalizeStudioEventType(state.fields.eventType || "DONE"),
      sourceRoleId: state.fields.sourceRoleId.trim(),
      targetRoleId: state.fields.targetRoleId.trim(),
      eventType: normalizeStudioEventType(state.fields.eventType || "DONE"),
      label: state.fields.label?.trim(),
      runtimeOnlyErrorFlow: Boolean(state.fields.runtimeOnlyErrorFlow),
      participatesInJoin: Boolean(state.fields.participatesInJoin)
    };
  }
  return {
    type: "add-edge",
    sourceRoleId: state.fields.sourceRoleId.trim(),
    targetRoleId: state.fields.targetRoleId.trim(),
    eventType: normalizeStudioEventType(state.fields.eventType || "DONE"),
    label: state.fields.label?.trim(),
    runtimeOnlyErrorFlow: Boolean(state.fields.runtimeOnlyErrorFlow),
    participatesInJoin: Boolean(state.fields.participatesInJoin)
  };
}

export function renderStudioCommandFormDiagnostics(state: StudioCommandFormState): string {
  return '<div class="studio-command-form-diagnostics" data-studio-command-diagnostics aria-live="polite">' + state.validation.diagnostics.map((diagnostic) =>
    '<div class="studio-command-form-diagnostic ' + escapeHtml(diagnostic.severity) + '" data-studio-diagnostic-code="' +
    escapeHtml(diagnostic.code) + '">' + escapeHtml(diagnostic.message || diagnostic.code) + "</div>"
  ).join("") + "</div>";
}

export function renderStudioCommandFormFieldError(state: StudioCommandFormState, fieldPath: string): string {
  const diagnostic = state.validation.diagnostics.find((item) => item.fieldPath === fieldPath);
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

type StudioProfileOption = {
  profileId: string;
  label: string;
};

type StudioToolOption = {
  toolRef: string;
  label: string;
};

function extractStudioModelOptions(context: StudioCommandValidationContext): StudioModelOption[] {
  const config = asRecord(context.projectConfig);
  const catalog = asRecord(config?.modelCatalog ?? context.projectConfig);
  return asArray(catalog?.models)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const ref = asTrimmedStringOrEmpty(entry.ref);
      const name = asTrimmedStringOrEmpty(entry.name);
      const provider = asTrimmedStringOrEmpty(entry.provider);
      const model = asTrimmedStringOrEmpty(entry.model);
      const labelParts = [name || ref, provider && model ? `${provider}/${model}` : ""].filter(Boolean);
      return {
        ref,
        label: labelParts.length ? labelParts.join(" - ") : ref
      };
    })
    .filter((entry) => Boolean(entry.ref))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function extractStudioProfileOptions(context: StudioCommandValidationContext): StudioProfileOption[] {
  const config = asRecord(context.projectConfig);
  const profiles = asArray(config?.profiles ?? context.projectConfig);
  return profiles
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const profileId = asTrimmedStringOrEmpty(entry.profileId);
      const toolRef = asTrimmedStringOrEmpty(entry.toolRef);
      return {
        profileId,
        label: toolRef ? `${profileId} - ${toolRef}` : profileId
      };
    })
    .filter((entry) => Boolean(entry.profileId))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function extractStudioToolOptions(context: StudioCommandValidationContext): StudioToolOption[] {
  const config = asRecord(context.projectConfig);
  const toolsRecord = asRecord(config?.tools);
  const tools = asArray(toolsRecord?.tools ?? config?.tools);
  return tools
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const toolRef = asTrimmedStringOrEmpty(entry.toolRef);
      const runner = asTrimmedStringOrEmpty(entry.runner);
      return {
        toolRef,
        label: runner ? `${toolRef} - ${runner}` : toolRef
      };
    })
    .filter((entry) => Boolean(entry.toolRef))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function profileDraftFromFields(fields: StudioAddRoleDraft): StudioExecutionProfileDraft | undefined {
  if (fields.profileMode !== "create") {
    return undefined;
  }
  const profileId = (fields.newProfileId || fields.profileId || "").trim();
  const toolRef = (fields.newProfileToolRef || "").trim();
  if (!profileId || !toolRef) {
    return undefined;
  }
  const timeoutMs = Number(fields.newProfileTimeoutMs);
  const maxOutputBytes = Number(fields.newProfileMaxOutputBytes);
  return {
    profileId,
    toolRef,
    ...(Number.isInteger(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}),
    ...(Number.isInteger(maxOutputBytes) && maxOutputBytes > 0 ? { maxOutputBytes } : {})
  };
}

function renderModelBindingField(args: {
  state: StudioCommandFormState;
  fields: StudioAddRoleDraft;
  context: StudioCommandValidationContext;
  labels?: StudioCommandFormLabels;
}): string {
  const options = extractStudioModelOptions(args.context);
  const selected = args.fields.modelRef || options[0]?.ref || "";
  if (!options.length) {
    return '<label class="studio-command-form-row"><span>' + escapeHtml(label(args.labels, "modelRef", "Model")) + '</span><input name="modelRef" value="' + escapeHtml(args.fields.modelRef || "") + '">' +
      '<div class="studio-command-form-hint">' + escapeHtml(label(args.labels, "noModels", "No model catalog entries available.")) + '</div>' +
      renderStudioCommandFormFieldError(args.state, "modelRef") + "</label>";
  }
  const hasSelected = options.some((option) => option.ref === selected);
  const optionHtml = (hasSelected ? [] : [{ ref: selected, label: `${selected} - current` }])
    .concat(options)
    .filter((option) => Boolean(option.ref))
    .map((option) =>
      '<option value="' + escapeHtml(option.ref) + '"' + (option.ref === selected ? " selected" : "") + ">" +
      escapeHtml(option.label) + "</option>"
    )
    .join("");
  return '<label class="studio-command-form-row"><span>' + escapeHtml(label(args.labels, "modelRef", "Model")) + '</span><select name="modelRef">' +
    optionHtml + "</select>" + renderStudioCommandFormFieldError(args.state, "modelRef") + "</label>";
}

function renderProfileBindingField(args: {
  state: StudioCommandFormState;
  fields: StudioAddRoleDraft;
  context: StudioCommandValidationContext;
  labels?: StudioCommandFormLabels;
}): string {
  const options = extractStudioProfileOptions(args.context);
  const tools = extractStudioToolOptions(args.context);
  const profileMode = args.fields.profileMode === "create" || !options.length ? "create" : "existing";
  const generatedProfileId = args.fields.newProfileId || profileIdFromRoleId(args.fields.roleId);
  if (profileMode === "create") {
    const toolRef = args.fields.newProfileToolRef || tools[0]?.toolRef || "";
    const toolOptions = tools.length
      ? tools.map((option) =>
          '<option value="' + escapeHtml(option.toolRef) + '"' + (option.toolRef === toolRef ? " selected" : "") + ">" +
          escapeHtml(option.label) + "</option>"
        ).join("")
      : '<option value="">' + escapeHtml(label(args.labels, "noTools", "No tools available")) + "</option>";
    return [
      options.length ? '<div class="studio-command-form-row segmented"><label><input type="radio" name="profileMode" value="existing"> ' + escapeHtml(label(args.labels, "existingProfile", "Existing profile")) + '</label><label><input type="radio" name="profileMode" value="create" checked> ' + escapeHtml(label(args.labels, "createProfile", "Create profile")) + "</label></div>" : '<input type="hidden" name="profileMode" value="create">',
      '<label class="studio-command-form-row"><span>' + escapeHtml(label(args.labels, "newProfileId", "Generated profile id")) + '</span><input name="newProfileId" value="' + escapeHtml(generatedProfileId) + '" readonly><input type="hidden" name="profileId" value="' + escapeHtml(generatedProfileId) + '">' + renderStudioCommandFormFieldError(args.state, "newProfileId") + "</label>",
      '<label class="studio-command-form-row"><span>' + escapeHtml(label(args.labels, "newProfileToolRef", "Tool")) + '</span><select name="newProfileToolRef">' + toolOptions + "</select>" + renderStudioCommandFormFieldError(args.state, "newProfileToolRef") + "</label>",
      '<label class="studio-command-form-row"><span>' + escapeHtml(label(args.labels, "newProfileTimeoutMs", "Timeout ms")) + '</span><input name="newProfileTimeoutMs" inputmode="numeric" value="' + escapeHtml(args.fields.newProfileTimeoutMs || "") + '">' + renderStudioCommandFormFieldError(args.state, "newProfileTimeoutMs") + "</label>",
      '<label class="studio-command-form-row"><span>' + escapeHtml(label(args.labels, "newProfileMaxOutputBytes", "Max output bytes")) + '</span><input name="newProfileMaxOutputBytes" inputmode="numeric" value="' + escapeHtml(args.fields.newProfileMaxOutputBytes || "") + '">' + renderStudioCommandFormFieldError(args.state, "newProfileMaxOutputBytes") + "</label>"
    ].join("");
  }
  const selected = args.fields.profileId || options[0]?.profileId || "";
  const hasSelected = options.some((option) => option.profileId === selected);
  const optionHtml = (hasSelected ? [] : [{ profileId: selected, label: `${selected} - current` }])
    .concat(options)
    .filter((option) => Boolean(option.profileId))
    .map((option) =>
      '<option value="' + escapeHtml(option.profileId) + '"' + (option.profileId === selected ? " selected" : "") + ">" +
      escapeHtml(option.label) + "</option>"
    )
    .join("");
  return '<div class="studio-command-form-row segmented"><label><input type="radio" name="profileMode" value="existing" checked> ' + escapeHtml(label(args.labels, "existingProfile", "Existing profile")) + '</label><label><input type="radio" name="profileMode" value="create"> ' + escapeHtml(label(args.labels, "createProfile", "Create profile")) + '</label></div>' +
    '<label class="studio-command-form-row"><span>' + escapeHtml(label(args.labels, "profileId", "Execution profile")) + '</span><select name="profileId">' +
    optionHtml + "</select>" + renderStudioCommandFormFieldError(args.state, "profileId") + "</label>";
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
          escapeHtml(rolePackage.name || rolePackage.roleId) + "</option>"
        ).join("")
      : '<option value="">' + escapeHtml(label(labels, "noRepositoryRoles", "No repository roles")) + "</option>";
    return [
      '<form class="studio-command-form" data-studio-command-form="' + (isEdit ? "edit-role" : "add-role") + '" role="dialog" aria-modal="true" aria-labelledby="studio-command-form-title">',
      '<div class="studio-command-form-header"><strong id="studio-command-form-title">' + escapeHtml(isEdit ? label(labels, "editRoleDialogTitle", "Edit role") : label(labels, "roleDialogTitle", "Add role")) + '</strong>',
      '<button type="button" data-studio-command-close aria-label="' + escapeHtml(label(labels, "cancel", "Cancel")) + '">' + escapeHtml(label(labels, "cancel", "Cancel")) + '</button></div>',
      isEdit ? "" : '<div class="studio-command-form-row segmented">',
      isEdit ? "" : '<label><input type="radio" name="mode" value="repository"' + (fields.mode === "repository" ? " checked" : "") + "> " + escapeHtml(label(labels, "repositoryRole", "Repository")) + "</label>",
      isEdit ? "" : '<label><input type="radio" name="mode" value="custom"' + (fields.mode === "custom" ? " checked" : "") + "> " + escapeHtml(label(labels, "customRole", "Custom")) + "</label>",
      isEdit ? "" : "</div>",
      isEdit ? '<input type="hidden" name="mode" value="custom"><input type="hidden" name="originalRoleId" value="' + escapeHtml(fields.originalRoleId || fields.roleId) + '">' : "",
      !isEdit && fields.mode === "repository" ? '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "rolePackage", "Role package")) + '</span><select name="repositoryRoleId">' + packageOptions + "</select><div class=\"studio-command-form-hint\">" + escapeHtml(label(labels, "rolePackageSource", "From this project's role repository.")) + "</div>" + renderStudioCommandFormFieldError(args.state, "repositoryRoleId") + "</label>" : "",
      '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "roleId", "Role id")) + '</span><input name="roleId" value="' + escapeHtml(fields.roleId) + '">' + renderStudioCommandFormFieldError(args.state, "roleId") + "</label>",
      '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "title", "Title")) + '</span><input name="title" value="' + escapeHtml(fields.title || "") + '"></label>',
      '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "bindingKind", "Binding")) + '</span><select name="bindingKind">',
      '<option value="noop"' + (fields.bindingKind === "noop" ? " selected" : "") + ">noop</option>",
      '<option value="model"' + (fields.bindingKind === "model" ? " selected" : "") + ">model</option>",
      '<option value="exec"' + (fields.bindingKind === "exec" ? " selected" : "") + ">exec</option>",
      "</select></label>",
      fields.bindingKind === "model" ? renderModelBindingField({ state: args.state, fields, context: args.context, labels }) : "",
      fields.bindingKind === "exec" ? renderProfileBindingField({ state: args.state, fields, context: args.context, labels }) : "",
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
    '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "eventType", "Event type")) + '</span><input name="eventType" value="' + escapeHtml(fields.eventType || "") + '">' + renderStudioCommandFormFieldError(args.state, "eventType") + "</label>",
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
    const bindingKindValue = String(data.get("bindingKind") ?? "noop");
    const bindingKind = bindingKindValue === "model" || bindingKindValue === "exec" ? bindingKindValue : "noop";
    const modelOptions = extractStudioModelOptions(args.context);
    const profileOptions = extractStudioProfileOptions(args.context);
    const toolOptions = extractStudioToolOptions(args.context);
    const roleId = String(data.get("roleId") ?? "").trim() || (mode === "repository" ? rolePackage?.roleId ?? "" : "");
    const profileMode = data.get("profileMode") === "create" || (bindingKind === "exec" && !profileOptions.length) ? "create" : "existing";
    const newProfileId = profileIdFromRoleId(roleId);
    const fields: StudioAddRoleDraft = {
      mode,
      originalRoleId: String(data.get("originalRoleId") ?? args.previous.fields.originalRoleId ?? "").trim(),
      repositoryRoleId,
      roleId,
      title: String(data.get("title") ?? "").trim() || (mode === "repository" ? rolePackage?.name ?? "" : ""),
      bindingKind,
      modelRef: bindingKind === "model" ? String(data.get("modelRef") ?? "").trim() || modelOptions[0]?.ref : "",
      profileId: bindingKind === "exec"
        ? profileMode === "create"
          ? newProfileId
          : String(data.get("profileId") ?? "").trim() || profileOptions[0]?.profileId
        : "",
      profileMode,
      newProfileId,
      newProfileToolRef: profileMode === "create" ? String(data.get("newProfileToolRef") ?? "").trim() || toolOptions[0]?.toolRef : "",
      newProfileTimeoutMs: String(data.get("newProfileTimeoutMs") ?? "").trim(),
      newProfileMaxOutputBytes: String(data.get("newProfileMaxOutputBytes") ?? "").trim()
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
    participatesInJoin: data.get("participatesInJoin") === "on"
  };
  return {
    kind: args.previous.kind,
    fields,
    validation: validateStudioAddEdgeDraft(fields, args.context)
  };
}
