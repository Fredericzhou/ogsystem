export function latestRoleContract(options = {}) {
  const events = [...new Set(options.events ?? [])].sort();
  return {
    ogsContractVersion: 2,
    schemaVersion: 2,
    purpose: options.purpose ?? "Test role responsibility",
    responsibility: { kind: "atomic", owns: [], contributes: [], doesNotOwn: [] },
    inputs: { preconditions: [] },
    outputs: { decisionCriteria: [], postconditions: [] },
    authority: { controlActions: [] },
    constraints: { writableStateFields: [] },
    failure: { retryableErrorCodes: [], terminalErrorCodes: [] },
    audit: { requiredFields: [] }
  };
}
