export function createTeamVersionLifecycleUseCases({ teamVersions }) {
  if (!teamVersions || typeof teamVersions.getTeamVersion !== "function" || typeof teamVersions.archiveReleasedTeamVersion !== "function") {
    throw new TypeError("Team version lifecycle use cases require team version operations.");
  }

  return Object.freeze({
    async archiveTeamVersion(teamVersionId) {
      const team = await teamVersions.getTeamVersion(teamVersionId);
      if (team.teamProjectId) throw new Error("TEAM_VERSION_INVALID: project workspaces cannot be archived as team versions.");
      if (team.teamVersionStatus !== "released") throw new Error("TEAM_VERSION_NOT_RELEASED: only a released team version can be archived.");
      return teamVersions.archiveReleasedTeamVersion(teamVersionId);
    }
  });
}
