import { classifyTeamIrDiagnostics, compileTeamIr, teamIRSemanticDigest, validateTeamIr } from "../../../dist/team-ir/index.js";

export function createTeamIrUseCases({ teamCatalog, teamIrStore, withTeamVersionLock, resolveTeamIrReleaseClosure }) {
  if (typeof teamCatalog?.getTeamVersion !== "function") throw new TypeError("Team IR requires a TeamVersion catalog.");
  if (typeof teamIrStore?.read !== "function" || typeof teamIrStore?.save !== "function") throw new TypeError("Team IR requires a Team IR store.");
  if (typeof withTeamVersionLock !== "function") throw new TypeError("Team IR requires a TeamVersion lock.");

  async function readTeam(teamVersionId) {
    const team = await teamCatalog.getTeamVersion(teamVersionId);
    if (team.projectType === "collaboration" || team.teamProjectId) throw new Error("TEAM_VERSION_NOT_FOUND: the requested TeamVersion does not exist.");
    return team;
  }

  return Object.freeze({
    async getTeamIr(teamVersionId) {
      const team = await readTeam(teamVersionId);
      const stored = await teamIrStore.read({ workdir: team.workdir });
      if (!stored.teamIR || stored.teamIR.schemaVersion !== 2) {
        throw new Error("TEAM_IR_V2_REQUIRED: this TeamVersion has no native Team IR v2 document.");
      }
      return { teamVersionId, ...stored };
    },
    async getTeamIrReleaseSnapshot(teamVersionId) {
      const team = await readTeam(teamVersionId);
      const stored = await teamIrStore.read({ workdir: team.workdir });
      if (!stored.teamIR) {
        throw new Error("TEAM_IR_V2_REQUIRED: this TeamVersion has no native Team IR v2 document; rebuild it in the v2 authoring flow.");
      }
      if (stored.teamIR.schemaVersion !== 2) throw new Error("TEAM_IR_INVALID: stored Team IR document is not schemaVersion 2.");
      try {
        if (typeof resolveTeamIrReleaseClosure !== "function") {
          throw new Error("TEAM_IR_RELEASE_CLOSURE_UNAVAILABLE: immutable role package, Binding, Schema, and Adapter closure resolution is not configured.");
        }
        const closure = await resolveTeamIrReleaseClosure({ team, teamIR: stored.teamIR });
        if (closure?.complete !== true || !closure.packageDigests || !closure.bindingDigests || !closure.adapterVersions) {
          throw new Error("TEAM_IR_RELEASE_CLOSURE_INCOMPLETE: release requires a trusted immutable dependency closure.");
        }
        const digestMapIsValid = (value) => value && typeof value === "object" && !Array.isArray(value)
          && Object.values(value).every((digest) => typeof digest === "string" && /^[a-f0-9]{64}$/i.test(digest));
        if (!digestMapIsValid(closure.packageDigests) || !digestMapIsValid(closure.bindingDigests)
          || !digestMapIsValid(closure.schemaDigests || {})
          || !closure.adapterVersions || typeof closure.adapterVersions !== "object" || Array.isArray(closure.adapterVersions)
          || !Object.values(closure.adapterVersions).every((version) => typeof version === "string" && version.trim())) {
          throw new Error("TEAM_IR_RELEASE_CLOSURE_INCOMPLETE: release dependency closure contains missing or invalid digests.");
        }
        const packageRefs = [...new Set(stored.teamIR.agents.map((agent) => agent.packageRef))];
        const bindingRefs = [...new Set(stored.teamIR.agents.map((agent) => agent.bindingRef))];
        const bindingKinds = [...new Set(stored.teamIR.bindings.map((binding) => binding.kind))];
        if (packageRefs.some((ref) => !Object.hasOwn(closure.packageDigests, ref))
          || bindingRefs.some((ref) => !Object.hasOwn(closure.bindingDigests, ref))
          || bindingKinds.some((kind) => typeof closure.adapterVersions[kind] !== "string")) {
          throw new Error("TEAM_IR_RELEASE_CLOSURE_INCOMPLETE: closure must resolve every Agent packageRef, bindingRef, and Binding adapter kind.");
        }
        const plan = compileTeamIr(stored.teamIR, {
          packageDigests: closure.packageDigests,
          bindingDigests: closure.bindingDigests,
          adapterVersions: closure.adapterVersions,
          schemaDigests: closure.schemaDigests,
          packageSchemas: closure.packageSchemas
        });
        return {
          teamVersionId,
          teamIrSemanticDigest: stored.semanticDigest,
          compiledPlanDigest: plan.compiledPlanDigest,
          compilerSemanticsVersion: plan.compilerSemanticsVersion
        };
      } catch (error) {
        if (/^TEAM_IR_RELEASE_CLOSURE_/.test(String(error?.message || ""))) throw error;
        const diagnostics = Array.isArray(error?.diagnostics) ? error.diagnostics : [];
        const wrapped = new Error("TEAM_IR_INVALID: Team IR v2 must compile without blocking diagnostics before release.");
        wrapped.code = "TEAM_IR_INVALID";
        wrapped.diagnostics = diagnostics;
        throw wrapped;
      }
    },
    async copyTeamIr(sourceTeamVersionId, destinationWorkdir) {
      const source = await readTeam(sourceTeamVersionId);
      const stored = await teamIrStore.read({ workdir: source.workdir });
      if (!stored.teamIR || stored.teamIR.schemaVersion !== 2) {
        throw new Error("TEAM_IR_V2_REQUIRED: only a native Team IR v2 TeamVersion can be forked.");
      }
      const saved = await teamIrStore.save({ workdir: destinationWorkdir, teamIR: stored.teamIR });
      return { copied: true, semanticDigest: saved.semanticDigest };
    },
    async validateTeamIr(teamVersionId, teamIR) {
      await readTeam(teamVersionId);
      const diagnostics = validateTeamIr(teamIR);
      const status = classifyTeamIrDiagnostics(diagnostics);
      return {
        teamVersionId,
        ...status,
        semanticDigest: teamIR && typeof teamIR === "object" ? teamIRSemanticDigest(teamIR) : null,
        diagnostics
      };
    },
    async saveTeamIr(teamVersionId, input = {}) {
      const initial = await readTeam(teamVersionId);
      return withTeamVersionLock(initial.teamRootId || initial.teamId || teamVersionId, async () => {
        const team = await readTeam(teamVersionId);
        if ((team.teamVersionStatus || "draft") !== "draft") throw new Error("TEAM_VERSION_IMMUTABLE: only a design-stage TeamVersion can be changed.");
        const { teamIR, expectedSemanticDigest } = input;
        const current = await teamIrStore.read({ workdir: team.workdir });
        if (expectedSemanticDigest !== current.semanticDigest) throw new Error("TEAM_IR_DIGEST_CONFLICT: Team IR changed in another editor.");
        const diagnostics = validateTeamIr(teamIR);
        const status = classifyTeamIrDiagnostics(diagnostics);
        if (!status.draftSaveable) {
          return { teamVersionId, ...status, saved: false, semanticDigest: null, diagnostics };
        }
        const { semanticDigest } = await teamIrStore.save({ workdir: team.workdir, teamIR });
        let releaseReady = false;
        if (status.ok && typeof resolveTeamIrReleaseClosure === "function") {
          try {
            const closure = await resolveTeamIrReleaseClosure({ team, teamIR });
            releaseReady = closure?.complete === true;
          } catch {
            releaseReady = false;
          }
        }
        return { teamVersionId, ...status, releaseReady, saved: true, semanticDigest, diagnostics };
      });
    }
  });
}
