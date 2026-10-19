import { assertCanonicalTeamVersionId } from "../domain/team.mjs";

export function createTeamSimulationUseCases({ teamCatalog, simulationRunner }) {
  if (!teamCatalog || typeof teamCatalog.getTeamVersion !== "function") {
    throw new TypeError("Team simulation use cases require a TeamVersion reader.");
  }
  if (!simulationRunner || typeof simulationRunner.simulate !== "function") {
    throw new TypeError("Team simulation use cases require a simulation runner.");
  }

  return Object.freeze({
    async simulateTeamVersion(teamVersionId, { prompt, locale = "zh-CN" } = {}) {
      const input = String(prompt || "").trim();
      if (!input || input.length > 1200) throw new Error("Enter a task between 1 and 1,200 characters.");
      assertCanonicalTeamVersionId(teamVersionId);
      const team = await teamCatalog.getTeamVersion(teamVersionId);
      if (team.teamProjectId || !["draft", "editing", "released"].includes(team.teamVersionStatus)) {
        throw new Error("TEAM_VERSION_NOT_SIMULATABLE: only a draft, editing, or released TeamVersion can be simulated.");
      }
      return simulationRunner.simulate(team, { prompt: input, locale });
    }
  });
}
