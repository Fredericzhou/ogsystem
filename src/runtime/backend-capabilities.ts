import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * The small, backend-neutral capability surface currently enforced by OGS.
 * Native tools remain owned by each backend; this contract only scopes the
 * session to the current Role execution workspace.
 */
export type WorkspaceCapabilityPolicy = {
  root: string;
  read?: boolean;
  write?: boolean;
  command?: boolean;
};

export type WorkspaceCapabilityId =
  | "workspace.read"
  | "workspace.write"
  | "workspace.patch_text"
  | "workspace.run";

function within(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

function fail(message: string): never {
  throw new Error(`[BACKEND_WORKSPACE_CONTRACT_INVALID] ${message}`);
}

/** Validate the policy before it reaches a backend adapter. */
export function validateWorkspaceCapabilityPolicy(policy: WorkspaceCapabilityPolicy): void {
  if (!policy || typeof policy !== "object") fail("workspace capability policy is required");
  if (typeof policy.root !== "string" || !policy.root.trim() || !isAbsolute(policy.root)) {
    fail("workspace capability root must be an absolute path");
  }
  for (const [key, value] of Object.entries(policy)) {
    if (key === "root") continue;
    if (!["read", "write", "command"].includes(key)) fail(`unsupported capability field: ${key}`);
    if (value !== undefined && typeof value !== "boolean") fail(`${key} must be a boolean`);
  }
}

/**
 * Validate the directory an adapter will hand to its native session. This is
 * intentionally lexical; staging itself performs symlink and file path checks.
 */
export function assertWorkspaceExecutionDirectory(args: {
  policy?: WorkspaceCapabilityPolicy;
  directory: string;
}): string {
  // Policy is optional for legacy adapters. Role execution supplies it when
  // the backend contract is active; without one, preserve the adapter's
  // existing directory semantics and apply no additional root assertion.
  if (!args.policy) return resolve(args.directory);
  validateWorkspaceCapabilityPolicy(args.policy);
  if (typeof args.directory !== "string" || !args.directory.trim() || !isAbsolute(args.directory)) {
    fail("backend execution directory must be an absolute path");
  }
  const root = resolve(args.policy.root);
  const directory = resolve(args.directory);
  if (!within(root, directory)) {
    fail(`backend execution directory escapes capability root: ${directory}`);
  }
  return directory;
}

export function projectWorkspaceCapabilities(policy: WorkspaceCapabilityPolicy): WorkspaceCapabilityId[] {
  validateWorkspaceCapabilityPolicy(policy);
  const capabilities: WorkspaceCapabilityId[] = [];
  if (policy.read === true) capabilities.push("workspace.read");
  if (policy.write === true) capabilities.push("workspace.write", "workspace.patch_text");
  if (policy.command === true) capabilities.push("workspace.run");
  return capabilities;
}
