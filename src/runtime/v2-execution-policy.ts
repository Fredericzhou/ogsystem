import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Contract Set v2 capability facts exposed by discovery. */
export type CapabilityPreview = {
  ogsContractVersion: 2;
  schemaVersion: 1;
  backend: string;
  model?: string;
  variant?: string;
  reasoningEfforts?: string[];
  verifiedTools: string[];
  adapterVersion?: string;
  verifiedAt: string;
  digest: string;
  readiness: "ready" | "degraded" | "unavailable";
};

/** Immutable capability facts used by one Run and reused during recovery. */
export type RunCapabilitySnapshot = {
  ogsContractVersion: 2;
  schemaVersion: 1;
  backend: string;
  model: string;
  variant?: string;
  requestedReasoningEffort?: string;
  effectiveReasoningEffort?: string;
  adapterVersion: string;
  verifiedAt: string;
  verifiedTools: string[];
  digest: string;
};

export type EnvironmentIntent = {
  filesystem?: { read?: boolean; write?: boolean } | "staged" | "read_only" | "none";
  process?: boolean | "allow" | "deny";
  network?: boolean | "allow" | "deny";
  limits?: Partial<EffectiveEnvironmentPolicy["limits"]>;
};

export type EffectiveEnvironmentPolicy = {
  ogsContractVersion: 2;
  schemaVersion: 1;
  root: string;
  filesystem: { read: boolean; write: boolean };
  process: boolean;
  network: boolean;
  limits: {
    timeoutMs: number;
    maxOutputBytes: number;
    maxStorageBytes: number;
  };
  policyDigest: string;
};

export type AdapterResourceCapabilities = {
  filesystem: boolean;
  process: boolean;
  network: boolean;
};

export type EffectiveExecutionPolicy = {
  allowedTools: string[];
  verifiedTools: string[];
  effectiveTools: string[];
  environment: EffectiveEnvironmentPolicy;
  capabilityDigest: string;
  policyDigest: string;
};

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function fail(code: string, message: string): never {
  throw new Error(`[${code}] ${message}`);
}

function sortedUnique(values: string[], field: string): string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
    fail("V2_CAPABILITY_INVALID", `${field} must contain non-empty strings`);
  }
  return [...new Set(values)].sort();
}

export function createCapabilityPreview(input: Omit<CapabilityPreview, "digest" | "ogsContractVersion" | "schemaVersion">): CapabilityPreview {
  if (!input.backend.trim()) fail("V2_CAPABILITY_INVALID", "backend is required");
  const preview = {
    ogsContractVersion: 2 as const,
    schemaVersion: 1 as const,
    ...input,
    verifiedTools: sortedUnique(input.verifiedTools, "verifiedTools")
  };
  return Object.freeze({ ...preview, digest: digest(preview), verifiedTools: Object.freeze([...preview.verifiedTools]) }) as CapabilityPreview;
}

export function createRunCapabilitySnapshot(input: Omit<RunCapabilitySnapshot, "digest" | "ogsContractVersion" | "schemaVersion">): RunCapabilitySnapshot {
  if (!input.backend.trim() || !input.model.trim() || !input.adapterVersion.trim()) {
    fail("V2_CAPABILITY_INVALID", "backend, model, and adapterVersion are required");
  }
  const snapshot = {
    ogsContractVersion: 2 as const,
    schemaVersion: 1 as const,
    ...input,
    verifiedTools: sortedUnique(input.verifiedTools, "verifiedTools")
  };
  return Object.freeze({ ...snapshot, digest: digest(snapshot), verifiedTools: Object.freeze([...snapshot.verifiedTools]) }) as RunCapabilitySnapshot;
}

export function assertCapabilitySnapshot(snapshot: RunCapabilitySnapshot): void {
  const expected = digest({
    ogsContractVersion: 2,
    schemaVersion: 1,
    backend: snapshot.backend,
    model: snapshot.model,
    ...(snapshot.variant ? { variant: snapshot.variant } : {}),
    ...(snapshot.requestedReasoningEffort ? { requestedReasoningEffort: snapshot.requestedReasoningEffort } : {}),
    ...(snapshot.effectiveReasoningEffort ? { effectiveReasoningEffort: snapshot.effectiveReasoningEffort } : {}),
    adapterVersion: snapshot.adapterVersion,
    verifiedAt: snapshot.verifiedAt,
    verifiedTools: [...snapshot.verifiedTools].sort()
  });
  if (snapshot.digest !== expected) fail("V2_CAPABILITY_SNAPSHOT_INVALID", "capability snapshot digest does not match its facts");
}

export function resolveEffectiveEnvironmentPolicy(input: {
  root: string;
  intent?: EnvironmentIntent;
  resources: AdapterResourceCapabilities;
  limits: EffectiveEnvironmentPolicy["limits"];
}): EffectiveEnvironmentPolicy {
  if (!isAbsolute(input.root)) fail("V2_ENVIRONMENT_INVALID", "execution root must be absolute");
  for (const key of ["filesystem", "process", "network"] as const) {
    if (typeof input.resources[key] !== "boolean") fail("V2_ENVIRONMENT_INVALID", `resource capability ${key} must be boolean`);
  }
  const intent = input.intent ?? {};
  const filesystemIntent = intent.filesystem;
  const read = filesystemIntent === "none"
    ? false
    : typeof filesystemIntent === "string"
      ? true
      : filesystemIntent?.read !== false;
  const write = filesystemIntent === "staged"
    ? true
    : typeof filesystemIntent === "string"
      ? false
      : filesystemIntent?.write === true;
  const process = intent.process === true || intent.process === "allow";
  const network = intent.network === true || intent.network === "allow";
  const filesystem = {
    read: read && input.resources.filesystem,
    write: write && input.resources.filesystem
  };
  if (read && !input.resources.filesystem) fail("V2_READINESS_RESOURCE_UNENFORCEABLE", "filesystem.read: adapter cannot enforce filesystem boundary");
  if (write && !input.resources.filesystem) fail("V2_READINESS_RESOURCE_UNENFORCEABLE", "filesystem.write: adapter cannot enforce filesystem boundary");
  if (process && !input.resources.process) fail("V2_READINESS_RESOURCE_UNENFORCEABLE", "process: adapter cannot enforce process boundary");
  if (network && !input.resources.network) fail("V2_READINESS_RESOURCE_UNENFORCEABLE", "network: adapter cannot enforce network boundary");
  const policy = {
    ogsContractVersion: 2 as const,
    schemaVersion: 1 as const,
    root: resolve(input.root),
    filesystem,
    process: process && input.resources.process,
    network: network && input.resources.network,
    limits: { ...input.limits, ...intent.limits }
  };
  return { ...policy, policyDigest: digest(policy) };
}

export function resolveEffectiveTools(input: {
  allowedTools: string[];
  snapshot: RunCapabilitySnapshot;
  environment: EffectiveEnvironmentPolicy;
  validateToolResources?: (toolId: string, policy: EffectiveEnvironmentPolicy) => { allowed: boolean; reason?: string };
}): string[] {
  assertCapabilitySnapshot(input.snapshot);
  const allowed = sortedUnique(input.allowedTools, "allowedTools");
  const verified = new Set(input.snapshot.verifiedTools);
  const effective: string[] = [];
  for (const tool of allowed) {
    if (!verified.has(tool)) fail("V2_READINESS_TOOL_MISSING", `allowed tool is not in the frozen capability snapshot: ${tool}`);
    const result = input.validateToolResources?.(tool, input.environment) ?? { allowed: true };
    if (!result.allowed) fail("V2_READINESS_RESOURCE_UNENFORCEABLE", `${tool}: ${result.reason ?? "resource boundary cannot be enforced"}`);
    effective.push(tool);
  }
  return effective;
}

export function createEffectiveExecutionPolicy(input: {
  allowedTools: string[];
  snapshot: RunCapabilitySnapshot;
  environment: EffectiveEnvironmentPolicy;
  validateToolResources?: (toolId: string, policy: EffectiveEnvironmentPolicy) => { allowed: boolean; reason?: string };
}): EffectiveExecutionPolicy {
  const allowedTools = sortedUnique(input.allowedTools, "allowedTools");
  const effectiveTools = resolveEffectiveTools({ ...input, allowedTools });
  return Object.freeze({
    allowedTools,
    verifiedTools: [...input.snapshot.verifiedTools],
    effectiveTools,
    environment: input.environment,
    capabilityDigest: input.snapshot.digest,
    policyDigest: digest({ allowedTools, effectiveTools, environment: input.environment, capabilityDigest: input.snapshot.digest })
  });
}

export function assertWithinExecutionRoot(root: string, candidate: string): string {
  if (!isAbsolute(root) || !isAbsolute(candidate)) fail("V2_STAGING_PATH_INVALID", "execution paths must be absolute");
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const relation = relative(resolvedRoot, resolvedCandidate);
  if (relation !== "" && (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation))) {
    fail("V2_STAGING_ESCAPE", `path escapes execution staging root: ${resolvedCandidate}`);
  }
  return resolvedCandidate;
}

export type PermissionDecision = "allow" | "deny";

export function decidePermission(args: {
  toolId: string;
  effectiveTools: string[];
  policy: EffectiveEnvironmentPolicy;
  resourceCheck?: (toolId: string, policy: EffectiveEnvironmentPolicy) => { allowed: boolean };
}): PermissionDecision {
  if (!args.effectiveTools.includes(args.toolId)) return "deny";
  if (args.resourceCheck && !args.resourceCheck(args.toolId, args.policy).allowed) return "deny";
  return "allow";
}
