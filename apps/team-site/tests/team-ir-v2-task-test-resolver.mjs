import { classicSoftwareTeamClosure, createClassicSoftwareTeamFakeBindings } from "./team-ir-test-runtime.mjs";
import { writeFile } from "node:fs/promises";

export async function resolveTeamIrReleaseClosure({ teamIR }) {
  return {
    complete: true,
    packageDigests: Object.fromEntries(teamIR.agents.map((agent) => [agent.packageRef, "a".repeat(64)])),
    bindingDigests: Object.fromEntries(teamIR.bindings.map((binding) => [binding.id, "b".repeat(64)])),
    adapterVersions: classicSoftwareTeamClosure.adapterVersions,
    schemaDigests: {}
  };
}

export async function resolveBindings({ teamIR }) {
  if (!teamIR.agents.some((agent) => agent.id === "planner")
    || !teamIR.agents.some((agent) => agent.id === "lead")) {
    throw new Error("Test resolver only supports the classic software Team fixture.");
  }
  const bindings = createClassicSoftwareTeamFakeBindings();
  const marker = process.env.OGS_TEST_ACTIVE_RUN_MARKER;
  if (marker) {
    const planner = teamIR.agents.find((agent) => agent.id === "planner");
    bindings[planner.bindingRef] = {
      async invoke({ runId }) {
        await writeFile(marker, JSON.stringify({ runId, status: "running" }), "utf8");
        return new Promise(() => {});
      }
    };
  }
  return bindings;
}
