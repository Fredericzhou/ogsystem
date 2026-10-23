export function createTeamVersionLifecycleUseCases({ teamVersions, withTeamVersionLock }) {
  if (!teamVersions || typeof teamVersions.getTeamVersion !== "function" || typeof teamVersions.archiveReleasedTeamVersion !== "function"
    || typeof teamVersions.listProjects !== "function" || typeof teamVersions.deleteTeamVersions !== "function"
    || typeof withTeamVersionLock !== "function") {
    throw new TypeError("Team version lifecycle use cases require team version operations.");
  }

  function isBuiltIn(team) {
    return team.builtIn === true || (Boolean(team.caseId) && ["classic", "classic-template"].includes(team.source));
  }

  return Object.freeze({
    async archiveTeamVersion(teamVersionId) {
      const team = await teamVersions.getTeamVersion(teamVersionId);
      if (team.teamProjectId) throw new Error("TEAM_VERSION_INVALID: project workspaces cannot be archived as team versions.");
      if (team.teamVersionStatus !== "released") throw new Error("TEAM_VERSION_NOT_RELEASED: only a released team version can be archived.");
      return teamVersions.archiveReleasedTeamVersion(teamVersionId);
    },

    async deleteTeam(teamVersionId) {
      const initial = await teamVersions.getTeamVersion(teamVersionId);
      if (initial.teamProjectId || initial.projectType === "collaboration") throw new Error("TEAM_VERSION_INVALID: project workspaces cannot be deleted as teams.");
      const teamRootId = initial.teamRootId || initial.teamId || initial.projectId;
      return withTeamVersionLock(teamRootId, async () => {
        const team = await teamVersions.getTeamVersion(teamVersionId);
        if (team.teamProjectId || team.projectType === "collaboration") throw new Error("TEAM_VERSION_INVALID: project workspaces cannot be deleted as teams.");
        const projects = await teamVersions.listProjects();
        const versions = projects.filter((item) => !item.teamProjectId
          && item.projectType !== "collaboration"
          && (item.teamRootId || item.teamId || item.projectId) === teamRootId);
        if (versions.some(isBuiltIn)) throw new Error("BUILT_IN_TEAM_DELETE_BLOCKED: built-in teams cannot be deleted.");
        const versionIds = new Set(versions.map((item) => item.teamVersionId || item.projectId));
        const mountedProject = projects.find((item) => item.projectType === "collaboration"
          && (item.mountedTeams || []).some((mounted) => versionIds.has(mounted.teamVersionId)));
        if (mountedProject) throw new Error(`TEAM_IN_USE: team is mounted by project ${mountedProject.projectId}.`);
        await teamVersions.deleteTeamVersions([...versionIds]);
        return { teamId: teamRootId, deletedTeamVersionIds: [...versionIds] };
      });
    }
  });
}
