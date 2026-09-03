export function latestRoleContract(options = {}) {
  const events = [...new Set(options.events ?? [])].sort();
  const allowedTools = [...new Set(options.allowedTools ?? [])].sort();
  return {
    contractVersion: 1,
    purpose: options.purpose ?? "Test role responsibility",
    responsibility: { kind: "atomic", owns: [], contributes: [], doesNotOwn: [] },
    inputs: { preconditions: [] },
    outputs: { events, postconditions: [] },
    authority: { controlActions: [] },
    constraints: { writableStateFields: [], allowedTools },
    failure: { retryableErrorCodes: [], terminalErrorCodes: [] },
    audit: { requiredFields: [] }
  };
}
