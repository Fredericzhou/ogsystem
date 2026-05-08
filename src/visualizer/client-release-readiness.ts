import { studioRolePackageHasRequiredFileCoverage, type StudioRolePackageSummary } from "./studio-client/studio-graph-validation.js";

export type ReleaseReadinessDecision = {
  canExport: boolean;
  blockers: Array<{ code: string; message: string }>;
};

export function listFromRecord(value: unknown, keys: string[]): Record<string, unknown>[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
    }
  }
  return [];
}

export function buildReleaseReadinessDecision(args: {
  validation: Record<string, unknown> | null | undefined;
  readiness: Record<string, unknown> | null | undefined;
  bindings: Record<string, unknown> | null | undefined;
  rolePackages: Record<string, unknown> | null | undefined;
  contracts: Record<string, unknown> | null | undefined;
  workbenchDirty: boolean;
}): ReleaseReadinessDecision {
  const blockers: ReleaseReadinessDecision["blockers"] = [];
  if (args.workbenchDirty) {
    blockers.push({ code: "RELEASE_DIRTY_WORKBENCH", message: "Unsaved Build changes must be saved before export." });
  }
  if (args.validation?.ok !== true) {
    blockers.push({ code: "RELEASE_VALIDATION_FAILED", message: "Mermaid validation must pass before export." });
  }
  const readinessBlockers = listFromRecord(args.readiness, ["blockers"]);
  for (const blocker of readinessBlockers) {
    blockers.push({
      code: String(blocker.code ?? "RELEASE_READINESS_BLOCKER"),
      message: String(blocker.message ?? "Release readiness blocker remains.")
    });
  }
  const coverage = (args.readiness?.contractCoverage ?? {}) as Record<string, unknown>;
  const missingContracts = Number(coverage.missingCount ?? coverage.missingFlowCount ?? 0);
  if (Number.isFinite(missingContracts) && missingContracts > 0) {
    blockers.push({
      code: "RELEASE_CONTRACT_COVERAGE_MISSING",
      message: String(missingContracts) + " required contract(s) are missing."
    });
  }
  const contractFlows = listFromRecord(args.contracts, ["flows", "contracts", "entries"]);
  const uncoveredEdges = listFromRecord(args.contracts, ["uncoveredEdges"]);
  const missingContractFlows = contractFlows.filter((contract) =>
    contract.lastStatus === "missing" || contract.contractId === null || contract.schemaPath === null
  );
  if (uncoveredEdges.length || missingContractFlows.length) {
    blockers.push({
      code: "RELEASE_ARTIFACT_CONTRACT_INCOMPLETE",
      message: "Artifact contract coverage is incomplete."
    });
  }
  const bindings = listFromRecord(args.bindings, ["roles", "bindings", "entries"]);
  const unresolvedBindings = bindings.filter((binding) =>
    binding.resolved === false || (!binding.resolvedBinding && !binding.effectiveBinding)
  );
  if (unresolvedBindings.length) {
    blockers.push({
      code: "RELEASE_BINDINGS_UNRESOLVED",
      message: String(unresolvedBindings.length) + " role binding(s) are unresolved."
    });
  }
  const rolePackages = listFromRecord(args.rolePackages, ["roles", "rolePackages", "entries"]);
  const unhealthyRolePackages = rolePackages.filter((role) => {
    if (role.status && role.status !== "ok") {
      return true;
    }
    return !studioRolePackageHasRequiredFileCoverage(role as StudioRolePackageSummary);
  });
  if (unhealthyRolePackages.length) {
    blockers.push({
      code: "RELEASE_ROLE_PACKAGES_UNHEALTHY",
      message: String(unhealthyRolePackages.length) + " role package(s) are unhealthy."
    });
  }
  return {
    canExport: blockers.length === 0,
    blockers
  };
}
