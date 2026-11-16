/**
 * Contract Set v2 core objects.
 *
 * This module is deliberately independent from the v1 Semantic IR.  v2 roots
 * carry an explicit contract-set marker and reject legacy execution fields
 * instead of silently interpreting them as compatibility input.
 */

export const OGS_CONTRACT_VERSION = 2 as const;

export type ContractRoot = {
  ogsContractVersion: 2;
  schemaVersion: number;
};

export type RoleContractV2 = ContractRoot & {
  roleId: string;
  purpose: string;
  responsibility: {
    kind: "atomic" | "composite";
    owns: string[];
    contributes: string[];
    doesNotOwn: string[];
  };
  inputs: {
    preconditions: string[];
  };
  outputs: {
    postconditions: string[];
    decisionCriteria: string[];
  };
  authority: {
    controlActions: BusinessReviewAction[];
  };
  failure: {
    retryableErrorCodes: string[];
    terminalErrorCodes: string[];
  };
  audit: {
    requiredFields: string[];
  };
};

/** Role Contracts own business result decisions only. Runtime exception actions are not Role authority. */
export type BusinessReviewAction = "approve" | "rework" | "reject";

/** Runtime exception controls are a separate action contract from business review. */
export type ExceptionReviewAction = "continue" | "retry" | "rework" | "reject" | "terminate";

/** Persisted Human Review decisions never include the internal timeout pause state. */
export type HumanReviewAction = BusinessReviewAction | ExceptionReviewAction;

export type BusinessGraphV2 = ContractRoot & {
  graphId: string;
  systemId: string;
  roles: string[];
  entryRoleId: string;
  edges: Array<{
    edgeId: string;
    fromRoleId: string;
    toRoleId: string;
    eventType: string;
    contextMap?: Record<string, string>;
    artifactRefs?: string[];
  }>;
};

export type HandoffProjectionV2 = ContractRoot & {
  projectionId: string;
  edgeId: string;
  fromRoleId: string;
  toRoleId: string;
  eventType: string;
  contextMap: Record<string, string>;
  artifactRefs: string[];
};

export type EnvironmentIntentV2 = {
  filesystem: { read: boolean; write: boolean } | "staged" | "read_only" | "none";
  process: "allow" | "deny";
  network: "allow" | "deny";
  limits?: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    maxStorageBytes?: number;
  };
};

export type HarnessTemplateV2 = ContractRoot & {
  kind?: "harness";
  templateId: string;
  backend: string;
  model: string;
  allowedTools: string[];
  environment: EnvironmentIntentV2;
  preset?: string;
};

export type ExecutionBindingsV2 = ContractRoot & {
  harnessTemplates?: Record<string, HarnessTemplateV2>;
  defaults?: { harnessTemplate?: string };
  roles: Record<string, {
    kind: "harness";
    harnessTemplate: string;
  }>;
};

export type CapabilityPreviewV2 = ContractRoot & {
  backend: string;
  model?: string;
  verifiedTools: string[];
  adapterVersion?: string;
  verifiedAt: string;
  digest: string;
  readiness: "ready" | "degraded" | "unavailable";
};

export type RunCapabilitySnapshotV2 = ContractRoot & {
  backend: string;
  model: string;
  adapterVersion: string;
  verifiedAt: string;
  verifiedTools: string[];
  digest: string;
};

export type EffectiveEnvironmentPolicyV2 = {
  ogsContractVersion: 2;
  schemaVersion: 1;
  root: string;
  filesystem: { read: boolean; write: boolean };
  process: boolean;
  network: boolean;
  limits: { timeoutMs: number; maxOutputBytes: number; maxStorageBytes: number };
  policyDigest: string;
};

export type ResolvedExecutionPlanV2 = ContractRoot & {
  roleId: string;
  backend: string;
  model: string;
  capabilitySnapshot: RunCapabilitySnapshotV2;
  allowedTools: string[];
  verifiedTools: string[];
  effectiveEnvironmentPolicy: EffectiveEnvironmentPolicyV2;
  policyDigest: string;
  recoveryIdentity: string;
};

export type HumanReviewRequestV2 = ContractRoot & {
  schemaVersion: 1;
  reviewId: string;
  runId: string;
  round: number;
  lineageId: string;
  branchId: string;
  loopIteration: number;
  stateVersion: number;
  trigger: "explicit" | "exception";
  exceptionContext?: { code: string; details?: Record<string, unknown> };
  status: "pending" | "resolved" | "cancelled";
  decision?: {
    action: HumanReviewAction;
    actor: string;
    comment?: string;
    decidedAt: string;
    round: number;
    lineageId: string;
    branchId: string;
    loopIteration: number;
    stateVersion: number;
    targetRoleId?: string;
    scope?: "branch" | "run";
    additionalBudget?: number;
  };
};

export type EvidenceEventV2<TPayload = unknown> = ContractRoot & {
  schemaVersion: 1;
  eventId: string;
  eventType: string;
  runId: string;
  recordedAt: string;
  payload: TPayload;
};

export type ToolInvocationEvidenceV2 = {
  roleId: string;
  executionId: string;
  backend: string;
  model: string;
  tool: string;
  decision: "allow" | "deny";
  status: "started" | "completed" | "failed" | "denied";
  durationMs?: number;
  policyDigest?: string;
};

export type PermissionRequestEvidenceV2 = {
  requestId: string;
  backend: string;
  resource: string;
  decision: "allow" | "deny";
  reason?: string;
};

const legacyKeys = new Set([
  "constraints",
  "allowedToolsByRoleId",
  "permissionProfile",
  "requiredTools",
  "deniedTools",
  "toolsMode",
  "exec",
  "bind",
  "profiles",
  "tools",
  "local_shell",
  "noop",
  "api",
  "cmd",
  "profileId"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return all legacy v1 paths found in a candidate v2 root. */
export function findLegacyV1Paths(value: unknown, path = "$", result: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findLegacyV1Paths(item, `${path}[${index}]`, result));
    return result;
  }
  if (!isRecord(value)) return result;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (legacyKeys.has(key) || key === "allowedTools" && path.includes(".constraints")) result.push(childPath);
    findLegacyV1Paths(child, childPath, result);
  }
  return result;
}

/** Validate the v2 envelope and fail closed on any v1 execution field. */
export function assertV2ContractRoot(value: unknown, subject = "contract"): asserts value is ContractRoot {
  if (!isRecord(value)) throw new Error(`${subject} must be an object`);
  if (value.ogsContractVersion !== OGS_CONTRACT_VERSION) {
    throw new Error(`${subject}.ogsContractVersion must be 2; v1 roots are not accepted`);
  }
  const schemaVersion = value.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || (schemaVersion as number) < 1) {
    throw new Error(`${subject}.schemaVersion must be a positive integer`);
  }
  const legacyPaths = findLegacyV1Paths(value);
  if (legacyPaths.length > 0) {
    throw new Error(`${subject} contains legacy v1 fields: ${legacyPaths.join(", ")}`);
  }
}

export function assertAllowedTools(args: {
  allowedTools: string[];
  verifiedTools: string[];
  subject?: string;
}): void {
  const verified = new Set(args.verifiedTools);
  const unknown = args.allowedTools.filter((tool) => !verified.has(tool));
  if (unknown.length > 0) {
    throw new Error(`${args.subject ?? "Harness Template"}.allowedTools contains unverified tools: ${unknown.join(", ")}`);
  }
}
