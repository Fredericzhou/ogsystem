import { compileTeamIr, teamIRSemanticDigest, validateTeamIr } from "../../../dist/team-ir/index.js";

function blocker(code, message) {
  return { code, severity: "blocker", message };
}

export async function inspectTeamIrV2Readiness({ workdir, team, teamIrStore, resolveReleaseClosure, resolveBindings }) {
  if (typeof teamIrStore?.read !== "function") {
    return { canDryRun: false, blockers: [blocker("TEAM_IR_V2_STORE_UNAVAILABLE", "Team IR v2 storage is not configured.")], warnings: [], missingBindings: [] };
  }
  const stored = await teamIrStore.read({ workdir });
  const teamIR = stored?.teamIR;
  if (teamIR?.schemaVersion !== 2) {
    return { canDryRun: false, blockers: [blocker("TEAM_IR_V2_REQUIRED", "This TeamVersion has no native Team IR v2 document.")], warnings: [], missingBindings: [] };
  }

  const diagnostics = validateTeamIr(teamIR);
  const blockers = diagnostics.filter((item) => item.severity === "error").map((item) => ({
    code: item.code,
    severity: "blocker",
    message: item.message,
    ...(item.pointer ? { pointer: item.pointer } : {})
  }));
  if (blockers.length) return { canDryRun: false, blockers, warnings: [], missingBindings: [] };
  if (typeof resolveReleaseClosure !== "function" || typeof resolveBindings !== "function") {
    return { canDryRun: false, blockers: [blocker("TEAM_IR_V2_RESOLVER_UNAVAILABLE", "Trusted Team IR v2 resolver is not configured.")], warnings: [], missingBindings: [] };
  }

  try {
    if (team?.teamIrSemanticDigest && team.teamIrSemanticDigest !== teamIRSemanticDigest(teamIR)) {
      throw new Error("TEAM_IR_SNAPSHOT_MISMATCH");
    }
    const closure = await resolveReleaseClosure({ team, teamIR });
    if (closure?.complete !== true || !closure.packageDigests || !closure.bindingDigests || !closure.adapterVersions) {
      throw new Error("TEAM_IR_RELEASE_CLOSURE_INCOMPLETE");
    }
    const plan = compileTeamIr(teamIR, {
      packageDigests: closure.packageDigests,
      bindingDigests: closure.bindingDigests,
      adapterVersions: closure.adapterVersions,
      schemaDigests: closure.schemaDigests,
      packageSchemas: closure.packageSchemas
    });
    if (team?.compiledPlanDigest && team.compiledPlanDigest !== plan.compiledPlanDigest) {
      throw new Error("TEAM_IR_COMPILED_DIGEST_MISMATCH");
    }
    const bindings = await resolveBindings({ team, teamIR, closure, mode: "sandbox" });
    const missingBindings = teamIR.bindings.filter((binding) => !bindings || typeof bindings[binding.id]?.invoke !== "function").map((binding) => binding.id);
    if (missingBindings.length) {
      return { canDryRun: false, blockers: [blocker("TEAM_IR_BINDING_UNAVAILABLE", "One or more frozen Team IR v2 Bindings are unavailable.")], warnings: [], missingBindings };
    }
    return { canDryRun: true, blockers: [], warnings: [], missingBindings: [] };
  } catch (error) {
    const code = String(error?.message || "TEAM_IR_V2_READINESS_FAILED").split(":", 1)[0];
    return { canDryRun: false, blockers: [blocker(code, "Trusted Team IR v2 closure or Sandbox Binding validation failed.")], warnings: [], missingBindings: [] };
  }
}
