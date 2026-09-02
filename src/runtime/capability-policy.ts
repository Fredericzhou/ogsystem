export type CapabilityValidationInput = {
  roleIds: string[];
  allowedToolsByRoleId: Record<string, string[]>;
  declaredToolsByRoleId?: Record<string, string[]>;
  maxTransitionsPerRun: number;
  maxOutputTokensByRoleId?: Record<string, number>;
  timeoutSecondsByRoleId?: Record<string, number>;
};

export function validateCapabilityPolicy(input: CapabilityValidationInput): string[] {
  const errors: string[] = [];
  const roles = new Set(input.roleIds);
  if (!Number.isInteger(input.maxTransitionsPerRun) || input.maxTransitionsPerRun <= 0) errors.push("maxTransitionsPerRun must be a positive integer");
  for (const [roleId, tools] of Object.entries(input.allowedToolsByRoleId)) {
    if (!roles.has(roleId)) errors.push(`unknown role in allowedToolsByRoleId: ${roleId}`);
    if (!Array.isArray(tools) || !tools.every((tool) => typeof tool === "string" && tool.length > 0)) errors.push(`invalid tools for role ${roleId}`);
    const declared = input.declaredToolsByRoleId?.[roleId];
    if (declared && tools.some((tool) => !declared.includes(tool))) errors.push(`tool capability exceeds declaration for role ${roleId}`);
  }
  for (const [roleId, value] of Object.entries(input.maxOutputTokensByRoleId ?? {})) {
    if (!roles.has(roleId) || !Number.isInteger(value) || value <= 0) errors.push(`invalid max output budget for role ${roleId}`);
  }
  for (const [roleId, value] of Object.entries(input.timeoutSecondsByRoleId ?? {})) {
    if (!roles.has(roleId) || !Number.isInteger(value) || value <= 0) errors.push(`invalid timeout budget for role ${roleId}`);
  }
  return errors;
}
