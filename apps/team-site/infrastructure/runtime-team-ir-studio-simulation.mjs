import { compileTeamIr, MemoryTeamRunStore, TeamRuntime, teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
import { redactStudioSimulationText, redactStudioSimulationValue } from "../domain/studio-simulation-redaction.mjs";

export function createRuntimeTeamIrStudioSimulation({
  clock = {
    now: Date.now,
    sleep: (ms, signal) => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error("TEAM_RUNTIME_SLEEP_ABORTED"));
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("TEAM_RUNTIME_SLEEP_ABORTED"));
      }, { once: true });
    })
  },
  artifactStore
} = {}) {
  return Object.freeze({
    semanticDigest(teamIR) {
      return teamIRSemanticDigest(teamIR);
    },
    prepare(teamIR, closure) {
      const plan = compileTeamIr(teamIR, {
        packageDigests: closure.packageDigests,
        bindingDigests: closure.bindingDigests,
        adapterVersions: closure.adapterVersions,
        schemaDigests: closure.schemaDigests,
        packageSchemas: closure.packageSchemas
      });
      return { plan };
    },
    async execute({ plan, bindings, store = new MemoryTeamRunStore(), simulationId, teamIR, input, task, preferences, attachments, createRun = false }) {
      const runtime = new TeamRuntime({ store, clock, bindings, artifactStore });
      if (createRun) {
        const runInput = {
          runId: simulationId,
          projectId: `studio-${simulationId}`,
          task: redactStudioSimulationText(task || "Team IR v2 Studio Simulation"),
          input,
          preferences,
          attachments
        };
        await runtime.createRun(plan, runInput);
      }
      return runtime.executeRun(plan, simulationId);
    },
    redact(value) {
      return redactStudioSimulationValue(value);
    },
    redactText(value) {
      return redactStudioSimulationText(value);
    }
  });
}
