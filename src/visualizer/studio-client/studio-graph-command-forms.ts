import { STUDIO_SYSTEM_END_ROLE_ID, type StudioAuthoringRole } from "../studio-contracts.js";
import type { StudioAuthoringCommand } from "./studio-graph-commands.js";
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

export type StudioCommandFormKind = "add-role" | "add-edge";

export type StudioCommandFormLabels = Partial<Record<
  | "roleDialogTitle"
  | "edgeDialogTitle"
  | "repositoryRole"
  | "customRole"
  | "rolePackage"
  | "roleId"
  | "title"
  | "bindingKind"
  | "modelRef"
  | "profileId"
  | "sourceRole"
  | "targetRole"
  | "eventType"
  | "runtimeOnlyErrorFlow"
  | "participatesInJoin"
  | "cancel"
  | "create"
  | "noRepositoryRoles"
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
    };

function label(labels: StudioCommandFormLabels | undefined, key: keyof StudioCommandFormLabels, fallback: string): string {
  return labels?.[key] ?? fallback;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstRoleId(context: StudioCommandValidationContext): string {
  return Object.keys(context.authoring?.roles ?? {}).sort()[0] ?? "";
}

function defaultRoleIdFromPackage(rolePackage: StudioRolePackageSummary | undefined): string {
  return rolePackage?.roleId ? rolePackage.roleId : "new-role";
}

export function createDefaultStudioCommandFormState(args: {
  kind: StudioCommandFormKind;
  context: StudioCommandValidationContext;
  sourceRoleId?: string;
  targetRoleId?: string;
}): StudioCommandFormState {
  if (args.kind === "add-role") {
    const rolePackage = extractStudioRolePackages(args.context.rolePackages)[0];
    const fields: StudioAddRoleDraft = {
      mode: rolePackage ? "repository" : "custom",
      repositoryRoleId: rolePackage?.roleId,
      roleId: defaultRoleIdFromPackage(rolePackage),
      title: rolePackage?.name || rolePackage?.roleId || "",
      bindingKind: "noop"
    };
    return {
      kind: "add-role",
      fields,
      validation: validateStudioAddRoleDraft(fields, args.context)
    };
  }

  const fields: StudioAddEdgeDraft = {
    sourceRoleId: args.sourceRoleId || firstRoleId(args.context),
    targetRoleId: args.targetRoleId || STUDIO_SYSTEM_END_ROLE_ID,
    eventType: "DONE",
    runtimeOnlyErrorFlow: false,
    participatesInJoin: false
  };
  return {
    kind: "add-edge",
    fields,
    validation: validateStudioAddEdgeDraft(fields, args.context)
  };
}

export function commandFromStudioCommandFormState(state: StudioCommandFormState): StudioAuthoringCommand | null {
  if (!state.validation.ok) {
    return null;
  }
  if (state.kind === "add-role") {
    const bindingKind: StudioAuthoringRole["bindingKind"] =
      state.fields.bindingKind === "model" || state.fields.bindingKind === "exec"
        ? state.fields.bindingKind
        : "noop";
    return {
      type: "add-role",
      roleId: state.fields.roleId.trim(),
      title: (state.fields.title || state.fields.roleId).trim(),
      bindingKind,
      modelRef: bindingKind === "model" ? state.fields.modelRef?.trim() : undefined,
      profileId: bindingKind === "exec" ? state.fields.profileId?.trim() : undefined
    };
  }
  return {
    type: "add-edge",
    sourceRoleId: state.fields.sourceRoleId.trim(),
    targetRoleId: state.fields.targetRoleId.trim(),
    eventType: normalizeStudioEventType(state.fields.eventType || "DONE"),
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

export function renderStudioCommandForm(args: {
  state: StudioCommandFormState;
  context: StudioCommandValidationContext;
  labels?: StudioCommandFormLabels;
}): string {
  const labels = args.labels;
  const disabled = args.state.validation.ok ? "" : " disabled";
  if (args.state.kind === "add-role") {
    const rolePackages = extractStudioRolePackages(args.context.rolePackages);
    const fields = args.state.fields;
    const packageOptions = rolePackages.length
      ? rolePackages.map((rolePackage) =>
          '<option value="' + escapeHtml(rolePackage.roleId) + '"' +
          (rolePackage.roleId === fields.repositoryRoleId ? " selected" : "") + ">" +
          escapeHtml(rolePackage.name || rolePackage.roleId) + "</option>"
        ).join("")
      : '<option value="">' + escapeHtml(label(labels, "noRepositoryRoles", "No repository roles")) + "</option>";
    return [
      '<form class="studio-command-form" data-studio-command-form="add-role" role="dialog" aria-modal="true" aria-labelledby="studio-command-form-title">',
      '<div class="studio-command-form-header"><strong id="studio-command-form-title">' + escapeHtml(label(labels, "roleDialogTitle", "Add role")) + '</strong>',
      '<button type="button" data-studio-command-close aria-label="' + escapeHtml(label(labels, "cancel", "Cancel")) + '">' + escapeHtml(label(labels, "cancel", "Cancel")) + '</button></div>',
      '<div class="studio-command-form-row segmented">',
      '<label><input type="radio" name="mode" value="repository"' + (fields.mode === "repository" ? " checked" : "") + "> " + escapeHtml(label(labels, "repositoryRole", "Repository")) + "</label>",
      '<label><input type="radio" name="mode" value="custom"' + (fields.mode === "custom" ? " checked" : "") + "> " + escapeHtml(label(labels, "customRole", "Custom")) + "</label>",
      "</div>",
      '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "rolePackage", "Role package")) + '</span><select name="repositoryRoleId"' + (fields.mode === "custom" ? " disabled" : "") + ">" + packageOptions + "</select>" + renderStudioCommandFormFieldError(args.state, "repositoryRoleId") + "</label>",
      '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "roleId", "Role id")) + '</span><input name="roleId" value="' + escapeHtml(fields.roleId) + '">' + renderStudioCommandFormFieldError(args.state, "roleId") + "</label>",
      '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "title", "Title")) + '</span><input name="title" value="' + escapeHtml(fields.title || "") + '"></label>',
      '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "bindingKind", "Binding")) + '</span><select name="bindingKind">',
      '<option value="noop"' + (fields.bindingKind === "noop" ? " selected" : "") + ">noop</option>",
      '<option value="model"' + (fields.bindingKind === "model" ? " selected" : "") + ">model</option>",
      '<option value="exec"' + (fields.bindingKind === "exec" ? " selected" : "") + ">exec</option>",
      "</select></label>",
      '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "modelRef", "Model ref")) + '</span><input name="modelRef" value="' + escapeHtml(fields.modelRef || "") + '"' + (fields.bindingKind === "model" ? "" : " disabled") + ">" + renderStudioCommandFormFieldError(args.state, "modelRef") + "</label>",
      '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "profileId", "Profile id")) + '</span><input name="profileId" value="' + escapeHtml(fields.profileId || "") + '"' + (fields.bindingKind === "exec" ? "" : " disabled") + ">" + renderStudioCommandFormFieldError(args.state, "profileId") + "</label>",
      renderStudioCommandFormDiagnostics(args.state),
      '<div class="studio-command-form-actions"><button type="submit"' + disabled + '>' + escapeHtml(label(labels, "create", "Create")) + "</button></div>",
      "</form>"
    ].join("");
  }

  const fields = args.state.fields;
  const targetOptions = renderRoleOptions(args.context, fields.targetRoleId) +
    '<option value="' + STUDIO_SYSTEM_END_ROLE_ID + '"' +
    (fields.targetRoleId === STUDIO_SYSTEM_END_ROLE_ID || fields.targetRoleId === "output" ? " selected" : "") + ">" +
    escapeHtml(label(labels, "outputTarget", "output/end")) + "</option>";
  return [
    '<form class="studio-command-form" data-studio-command-form="add-edge" role="dialog" aria-modal="true" aria-labelledby="studio-command-form-title">',
    '<div class="studio-command-form-header"><strong id="studio-command-form-title">' + escapeHtml(label(labels, "edgeDialogTitle", "Add edge")) + '</strong>',
    '<button type="button" data-studio-command-close aria-label="' + escapeHtml(label(labels, "cancel", "Cancel")) + '">' + escapeHtml(label(labels, "cancel", "Cancel")) + '</button></div>',
    '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "sourceRole", "Source role")) + '</span><select name="sourceRoleId">' + renderRoleOptions(args.context, fields.sourceRoleId) + "</select>" + renderStudioCommandFormFieldError(args.state, "sourceRoleId") + "</label>",
    '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "targetRole", "Target role")) + '</span><select name="targetRoleId">' + targetOptions + "</select>" + renderStudioCommandFormFieldError(args.state, "targetRoleId") + "</label>",
    '<label class="studio-command-form-row"><span>' + escapeHtml(label(labels, "eventType", "Event type")) + '</span><input name="eventType" value="' + escapeHtml(fields.eventType || "") + '">' + renderStudioCommandFormFieldError(args.state, "eventType") + "</label>",
    '<label class="studio-command-form-check"><input type="checkbox" name="runtimeOnlyErrorFlow"' + (fields.runtimeOnlyErrorFlow ? " checked" : "") + "> " + escapeHtml(label(labels, "runtimeOnlyErrorFlow", "Runtime error flow")) + "</label>",
    '<label class="studio-command-form-check"><input type="checkbox" name="participatesInJoin"' + (fields.participatesInJoin ? " checked" : "") + "> " + escapeHtml(label(labels, "participatesInJoin", "Join source")) + "</label>",
    renderStudioCommandFormDiagnostics(args.state),
    '<div class="studio-command-form-actions"><button type="submit"' + disabled + '>' + escapeHtml(label(labels, "create", "Create")) + "</button></div>",
    "</form>"
  ].join("");
}

export function readStudioCommandFormState(args: {
  form: HTMLFormElement;
  previous: StudioCommandFormState;
  context: StudioCommandValidationContext;
}): StudioCommandFormState {
  const data = new FormData(args.form);
  if (args.previous.kind === "add-role") {
    const mode = data.get("mode") === "repository" ? "repository" : "custom";
    const repositoryRoleId = String(data.get("repositoryRoleId") ?? "").trim();
    const rolePackage = extractStudioRolePackages(args.context.rolePackages).find((entry) => entry.roleId === repositoryRoleId);
    const bindingKindValue = String(data.get("bindingKind") ?? "noop");
    const fields: StudioAddRoleDraft = {
      mode,
      repositoryRoleId,
      roleId: String(data.get("roleId") ?? "").trim() || (mode === "repository" ? rolePackage?.roleId ?? "" : ""),
      title: String(data.get("title") ?? "").trim() || (mode === "repository" ? rolePackage?.name ?? "" : ""),
      bindingKind: bindingKindValue === "model" || bindingKindValue === "exec" ? bindingKindValue : "noop",
      modelRef: String(data.get("modelRef") ?? "").trim(),
      profileId: String(data.get("profileId") ?? "").trim()
    };
    return {
      kind: "add-role",
      fields,
      validation: validateStudioAddRoleDraft(fields, args.context)
    };
  }

  const fields: StudioAddEdgeDraft = {
    sourceRoleId: String(data.get("sourceRoleId") ?? "").trim(),
    targetRoleId: String(data.get("targetRoleId") ?? "").trim(),
    eventType: String(data.get("eventType") ?? "").trim(),
    runtimeOnlyErrorFlow: data.get("runtimeOnlyErrorFlow") === "on",
    participatesInJoin: data.get("participatesInJoin") === "on"
  };
  return {
    kind: "add-edge",
    fields,
    validation: validateStudioAddEdgeDraft(fields, args.context)
  };
}
