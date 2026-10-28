import { inspectTeamIrV2Readiness } from "./team-ir-v2-readiness.mjs";

export function createRuntimeProjectReadinessInspector({
  teamIrStore,
  resolveReleaseClosure,
  resolveBindings
} = {}) {
  return Object.freeze({
    async inspect(workdir, team) {
      return inspectTeamIrV2Readiness({ workdir, team, teamIrStore, resolveReleaseClosure, resolveBindings });
    }
  });
}
