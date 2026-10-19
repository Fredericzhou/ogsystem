import assert from "node:assert/strict";
import test from "node:test";
import { createTeamSimulationUseCases } from "../application/team-simulation-use-cases.mjs";

function setup(team = { teamVersionId: "team-1", teamVersionStatus: "released" }) {
  const calls = [];
  const useCases = createTeamSimulationUseCases({
    teamCatalog: { getTeamVersion: async (id) => (calls.push(["get", id]), team) },
    simulationRunner: { simulate: async (record, input) => (calls.push(["simulate", record, input]), { mode: "simulation", persisted: false }) }
  });
  return { calls, useCases };
}

test("Team Simulation validates canonical identity, prompt, and supported TeamVersion states", async () => {
  const { calls, useCases } = setup({ teamVersionId: "team-1", teamVersionStatus: "archived" });
  await assert.rejects(useCases.simulateTeamVersion("case:software-team", { prompt: "Review" }), /TEAM_VERSION_ID_INVALID/);
  await assert.rejects(useCases.simulateTeamVersion("team-1", { prompt: " " }), /1 and 1,200/);
  await assert.rejects(useCases.simulateTeamVersion("team-1", { prompt: "Review" }), /TEAM_VERSION_NOT_SIMULATABLE/);
  assert.deepEqual(calls, [["get", "team-1"]]);
});

for (const teamVersionStatus of ["draft", "editing", "released"]) {
  test(`Team Simulation invokes the temporary runner for a ${teamVersionStatus} TeamVersion`, async () => {
    const team = { teamVersionId: "team-1", teamVersionStatus };
    const { calls, useCases } = setup(team);
    assert.deepEqual(await useCases.simulateTeamVersion("team-1", { prompt: "  Review delivery  ", locale: "en" }), { mode: "simulation", persisted: false });
    assert.deepEqual(calls, [["get", "team-1"], ["simulate", team, { prompt: "Review delivery", locale: "en" }]]);
  });
}
