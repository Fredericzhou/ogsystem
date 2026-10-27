import { readFileSync } from "node:fs";
import { compileTeamIr, TeamBindingError, teamIRSemanticDigest } from "../../../dist/team-ir/index.js";

export const classicSoftwareTeamIr = JSON.parse(readFileSync(new URL("../../../examples/team-ir-v2/classic-software-team.json", import.meta.url), "utf8"));

const digest = (value) => value.repeat(64);

export const classicSoftwareTeamClosure = Object.freeze({
  complete: true,
  packageDigests: Object.fromEntries(classicSoftwareTeamIr.agents.map((agent) => [agent.packageRef, digest("a")])),
  bindingDigests: Object.fromEntries(classicSoftwareTeamIr.bindings.map((binding) => [binding.id, digest("b")])),
  adapterVersions: { model: "team-site-test-fake/1" },
  schemaDigests: {}
});

const classicPlan = compileTeamIr(classicSoftwareTeamIr, classicSoftwareTeamClosure);

export const classicSoftwareTeamSnapshot = Object.freeze({
  teamIrSemanticDigest: teamIRSemanticDigest(classicSoftwareTeamIr),
  compiledPlanDigest: classicPlan.compiledPlanDigest,
  compilerSemanticsVersion: classicPlan.compilerSemanticsVersion
});

const outputsByAgent = {
  planner: { event: "PLAN", data: { plan: "implement" } },
  implementer: { event: "IMPLEMENTED", data: { changes: "done" } },
  tester: { event: "TESTED", data: { tests: "passed" } },
  lead: { event: "DELIVERED", data: { summary: "completed" } }
};

export function createClassicSoftwareTeamFakeBindings() {
  return Object.fromEntries(classicSoftwareTeamIr.agents.map((agent) => [agent.bindingRef, {
    async invoke() {
      if (agent.id === "planner" && process.env.OGSYSTEM_TEST_FORCE_RUNTIME_ERROR_AFTER_SETUP) {
        throw new TeamBindingError("Forced runtime error after setup", "server_error");
      }
      return { kind: "completed", output: structuredClone(outputsByAgent[agent.id]) };
    }
  }]));
}
