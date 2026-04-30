import {
  STUDIO_SYSTEM_END_ROLE_ID,
  normalizeStudioGraphStoredRoleId,
  normalizeStudioGraphTargetRoleId,
  type StudioAuthoringDocument,
  type StudioAuthoringRole,
  type StudioDiagnosticDto
} from "../studio-contracts.js";

export type StudioRolePackageSummary = {
  roleId?: string;
  name?: string;
  description?: string;
  status?: string;
  allowedEvents?: string[];
  preferredModelTags?: string[];
  files?: Record<string, unknown>;
  manifest?: {
    roleId?: string;
    name?: string;
    description?: string;
    preferredModelTags?: string[];
  };
};

export type StudioBindingSummary = {
  roleId?: string;
  bindingKind?: string;
  kind?: string;
  modelRef?: string;
  profileId?: string;
  resolvedModel?: string;
  resolvedProfile?: string;
};

export type StudioCommandValidationContext = {
  authoring?: StudioAuthoringDocument | null;
  rolePackages?: unknown;
  bindings?: unknown;
  readiness?: unknown;
};

export type StudioAddRoleDraft = {
  mode: "repository" | "custom";
  originalRoleId?: string;
  repositoryRoleId?: string;
  roleId: string;
  title?: string;
  bindingKind: StudioAuthoringRole["bindingKind"];
  modelRef?: string;
  profileId?: string;
};

export type StudioAddEdgeDraft = {
  flowId?: string;
  originalSourceRoleId?: string;
  originalTargetRoleId?: string;
  originalEventType?: string;
  sourceRoleId: string;
  targetRoleId: string;
  eventType?: string;
  runtimeOnlyErrorFlow?: boolean;
  participatesInJoin?: boolean;
};

export type StudioValidationResult = {
  ok: boolean;
  diagnostics: StudioDiagnosticDto[];
};

const ROLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const EVENT_TYPE_PATTERN = /^[A-Z][A-Z0-9_:-]*$/;
const RESERVED_ROLE_IDS = new Set(["input", "output", STUDIO_SYSTEM_END_ROLE_ID]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function issue(args: {
  severity: StudioDiagnosticDto["severity"];
  fieldPath?: string;
  roleId?: string;
  flowKey?: string;
  code: string;
  messageKey: string;
  vars?: Record<string, unknown>;
  message?: string;
}): StudioDiagnosticDto {
  return {
    source: "client-preflight",
    severity: args.severity,
    fieldPath: args.fieldPath,
    roleId: args.roleId,
    flowKey: args.flowKey,
    code: args.code,
    messageKey: args.messageKey,
    vars: args.vars,
    message: args.message
  };
}

export function extractStudioRolePackages(value: unknown): StudioRolePackageSummary[] {
  const record = asRecord(value);
  const entries = asArray(record?.rolePackages ?? record?.roles ?? record?.entries);
  return entries
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const manifest = asRecord(entry.manifest);
      return {
        roleId: asString(entry.roleId ?? manifest?.roleId),
        name: asString(entry.name ?? manifest?.name),
        description: asString(entry.description ?? manifest?.description),
        status: asString(entry.status),
        allowedEvents: asArray(entry.allowedEvents).map(asString).filter(Boolean),
        preferredModelTags: asArray(entry.preferredModelTags ?? manifest?.preferredModelTags).map(asString).filter(Boolean),
        files: asRecord(entry.files),
        manifest: manifest
          ? {
              roleId: asString(manifest.roleId),
              name: asString(manifest.name),
              description: asString(manifest.description),
              preferredModelTags: asArray(manifest.preferredModelTags).map(asString).filter(Boolean)
            }
          : undefined
      };
    })
    .filter((entry) => Boolean(entry.roleId));
}

export function extractStudioBindings(value: unknown): StudioBindingSummary[] {
  const record = asRecord(value);
  return asArray(record?.bindings ?? record?.roles ?? record?.entries)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      roleId: asString(entry.roleId),
      bindingKind: asString(entry.bindingKind ?? entry.kind),
      kind: asString(entry.kind),
      modelRef: asString(entry.modelRef ?? entry.resolvedModel),
      profileId: asString(entry.profileId ?? entry.resolvedProfile),
      resolvedModel: asString(entry.resolvedModel),
      resolvedProfile: asString(entry.resolvedProfile)
    }))
    .filter((entry) => Boolean(entry.roleId));
}

export function isValidStudioRoleId(roleId: string): boolean {
  return ROLE_ID_PATTERN.test(roleId) && !RESERVED_ROLE_IDS.has(roleId);
}

export function normalizeStudioEventType(value: unknown): string {
  return asString(value).toUpperCase();
}

export function validateStudioAddRoleDraft(
  draft: StudioAddRoleDraft,
  context: StudioCommandValidationContext
): StudioValidationResult {
  const diagnostics: StudioDiagnosticDto[] = [];
  const roleId = asString(draft.roleId);
  if (!roleId) {
    diagnostics.push(issue({
      severity: "error",
      fieldPath: "roleId",
      code: "ROLE_ID_INVALID",
      messageKey: "studio.validation.roleIdRequired",
      message: "Role id is required."
    }));
  } else if (!isValidStudioRoleId(roleId)) {
    diagnostics.push(issue({
      severity: "error",
      fieldPath: "roleId",
      roleId,
      code: "ROLE_ID_INVALID",
      messageKey: "studio.validation.roleIdInvalid",
      vars: { roleId },
      message: "Role id must start with a letter and use letters, digits, _ or -."
    }));
  } else if (context.authoring?.roles?.[roleId] && roleId !== asString(draft.originalRoleId)) {
    diagnostics.push(issue({
      severity: "error",
      fieldPath: "roleId",
      roleId,
      code: "ROLE_ID_DUPLICATED",
      messageKey: "studio.validation.roleIdDuplicated",
      vars: { roleId },
      message: `Role "${roleId}" already exists.`
    }));
  }

  if (draft.mode === "repository") {
    const rolePackage = extractStudioRolePackages(context.rolePackages).find((entry) => entry.roleId === draft.repositoryRoleId);
    if (!rolePackage) {
      diagnostics.push(issue({
        severity: "error",
        fieldPath: "repositoryRoleId",
        code: "ROLE_PACKAGE_UNHEALTHY",
        messageKey: "studio.validation.rolePackageMissing",
        message: "Selected role package is unavailable."
      }));
    } else if (rolePackage.status && rolePackage.status !== "ok") {
      diagnostics.push(issue({
        severity: "error",
        fieldPath: "repositoryRoleId",
        roleId: rolePackage.roleId,
        code: "ROLE_PACKAGE_UNHEALTHY",
        messageKey: "studio.validation.rolePackageUnhealthy",
        vars: { roleId: rolePackage.roleId, status: rolePackage.status },
        message: `Role package "${rolePackage.roleId}" is not healthy.`
      }));
    } else if (rolePackage.files && Object.values(rolePackage.files).some((value) => value === false)) {
      diagnostics.push(issue({
        severity: "warning",
        fieldPath: "repositoryRoleId",
        roleId: rolePackage.roleId,
        code: "ROLE_PACKAGE_UNHEALTHY",
        messageKey: "studio.validation.rolePackageIncomplete",
        vars: { roleId: rolePackage.roleId },
        message: `Role package "${rolePackage.roleId}" has incomplete file coverage.`
      }));
    }
  }

  if (draft.bindingKind === "model" && !asString(draft.modelRef)) {
    diagnostics.push(issue({
      severity: "error",
      fieldPath: "modelRef",
      roleId,
      code: "ROLE_BINDING_UNRESOLVED",
      messageKey: "studio.validation.modelRefRequired",
      message: "Model binding requires a model reference."
    }));
  }
  if (draft.bindingKind === "exec" && !asString(draft.profileId)) {
    diagnostics.push(issue({
      severity: "error",
      fieldPath: "profileId",
      roleId,
      code: "ROLE_BINDING_UNRESOLVED",
      messageKey: "studio.validation.profileIdRequired",
      message: "Execution binding requires a profile id."
    }));
  }

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics
  };
}

export function validateStudioAddEdgeDraft(
  draft: StudioAddEdgeDraft,
  context: StudioCommandValidationContext
): StudioValidationResult {
  const diagnostics: StudioDiagnosticDto[] = [];
  const authoring = context.authoring;
  const sourceRoleId = asString(draft.sourceRoleId);
  const targetRoleId = normalizeStudioGraphStoredRoleId(asString(draft.targetRoleId));
  const targetDisplay = normalizeStudioGraphTargetRoleId(targetRoleId);
  const eventType = normalizeStudioEventType(draft.eventType || "DONE");
  const flowKey = sourceRoleId && targetRoleId && eventType
    ? `${sourceRoleId}:${eventType}:${targetDisplay}`
    : undefined;

  if (!sourceRoleId || !authoring?.roles?.[sourceRoleId]) {
    diagnostics.push(issue({
      severity: "error",
      fieldPath: "sourceRoleId",
      code: "EDGE_ENDPOINT_INVALID",
      messageKey: "studio.validation.edgeSourceInvalid",
      message: "Choose an existing source role."
    }));
  }
  if (!targetRoleId || (targetRoleId !== STUDIO_SYSTEM_END_ROLE_ID && !authoring?.roles?.[targetRoleId])) {
    diagnostics.push(issue({
      severity: "error",
      fieldPath: "targetRoleId",
      code: "EDGE_ENDPOINT_INVALID",
      messageKey: "studio.validation.edgeTargetInvalid",
      message: "Choose an existing target role or output."
    }));
  }
  if (sourceRoleId && targetRoleId && sourceRoleId === targetRoleId) {
    diagnostics.push(issue({
      severity: "error",
      fieldPath: "targetRoleId",
      roleId: sourceRoleId,
      flowKey,
      code: "EDGE_ENDPOINT_INVALID",
      messageKey: "studio.validation.edgeSelfLoop",
      message: "Self loops require explicit loop semantics."
    }));
  }
  if (!eventType || !EVENT_TYPE_PATTERN.test(eventType)) {
    diagnostics.push(issue({
      severity: "error",
      fieldPath: "eventType",
      flowKey,
      code: "EDGE_EVENT_UNSUPPORTED",
      messageKey: "studio.validation.eventTypeInvalid",
      message: "Event type must be uppercase and may use digits, _, : or -."
    }));
  }
  if (authoring && sourceRoleId && targetRoleId && eventType) {
    const duplicated = Object.values(authoring.flows ?? {}).some((flow) => {
      const sameOriginal =
        (draft.flowId && flow.flowId === draft.flowId) ||
        (flow.fromRoleId === asString(draft.originalSourceRoleId) &&
          flow.toRoleId === normalizeStudioGraphStoredRoleId(asString(draft.originalTargetRoleId)) &&
          flow.eventType === normalizeStudioEventType(draft.originalEventType));
      if (sameOriginal) {
        return false;
      }
      return (
      flow.fromRoleId === sourceRoleId &&
      flow.toRoleId === targetRoleId &&
      flow.eventType === eventType
      );
    });
    if (duplicated) {
      diagnostics.push(issue({
        severity: "error",
        fieldPath: "eventType",
        flowKey,
        code: "EDGE_DUPLICATED",
        messageKey: "studio.validation.edgeDuplicated",
        message: "This source, event, and target edge already exists."
      }));
    }

    const allowedEvents = Array.from(new Set(
      Object.values(authoring.flows ?? {})
        .filter((flow) => flow.fromRoleId === sourceRoleId)
        .map((flow) => flow.eventType)
    ));
    if (allowedEvents.length > 0 && eventType && !allowedEvents.includes(eventType)) {
      diagnostics.push(issue({
        severity: "warning",
        fieldPath: "eventType",
        roleId: sourceRoleId,
        flowKey,
        code: "EDGE_EVENT_UNSUPPORTED",
        messageKey: "studio.validation.eventTypeNotSeen",
        vars: { eventType, roleId: sourceRoleId },
        message: `Event "${eventType}" is not currently emitted by "${sourceRoleId}".`
      }));
    }

    const targetRole = authoring.roles[targetRoleId];
    if (targetRole?.joinMode && !(targetRole.joinSources ?? []).includes(sourceRoleId)) {
      diagnostics.push(issue({
        severity: "warning",
        fieldPath: "participatesInJoin",
        roleId: targetRoleId,
        flowKey,
        code: "JOIN_SOURCE_MISSING",
        messageKey: "studio.validation.joinSourceMissing",
        vars: { roleId: targetRoleId, sourceRoleId },
        message: `Join role "${targetRoleId}" does not include "${sourceRoleId}" in join.sources.`
      }));
    }
  }

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics
  };
}
