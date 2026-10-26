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
      const initial = await teamVersions.getTeamVersion(teamVersionId);
      const teamRootId = initial.teamRootId || initial.teamId || initial.projectId;
      return withTeamVersionLock(teamRootId, async () => {
        const team = await teamVersions.getTeamVersion(teamVersionId);
        if (team.teamProjectId || team.projectType === "collaboration") throw new Error("TEAM_VERSION_INVALID: project workspaces cannot be archived as team versions.");
        if (team.teamVersionStatus !== "released") throw new Error("TEAM_VERSION_NOT_RELEASED: only a released team version can be archived.");
        return teamVersions.archiveReleasedTeamVersion(teamVersionId);
      });
    },

    async deleteTeamVersion(teamVersionId) {
      const initial = await teamVersions.getTeamVersion(teamVersionId);
      if (initial.teamProjectId || initial.projectType === "collaboration") throw new Error("TEAM_VERSION_INVALID: project workspaces cannot be deleted as team versions.");
      const teamRootId = initial.teamRootId || initial.teamId || initial.projectId;
      return withTeamVersionLock(teamRootId, async () => {
        const team = await teamVersions.getTeamVersion(teamVersionId);
        if (team.teamProjectId || team.projectType === "collaboration") throw new Error("TEAM_VERSION_INVALID: project workspaces cannot be deleted as team versions.");
        if (isBuiltIn(team)) throw new Error("BUILT_IN_TEAM_DELETE_BLOCKED: built-in teams cannot be deleted.");
        if (team.teamVersionStatus !== "draft") {
          const error = new Error("TEAM_RELEASED_DELETE_BLOCKED: only draft team versions can be deleted individually. Delete the entire team instead.");
          error.code = "TEAM_RELEASED_DELETE_BLOCKED";
          throw error;
        }
        const targetId = team.teamVersionId || team.projectId;
        const lockedProjects = await teamVersions.listProjects();
        const mountedProjects = lockedProjects.filter((item) => item.projectType === "collaboration"
          && (item.mountedTeams || []).some((mounted) => mounted.teamVersionId === targetId));
        if (mountedProjects.length) {
          const error = new Error("TEAM_IN_USE: team versions are currently mounted by collaboration projects.");
          error.code = "TEAM_IN_USE";
          error.blockedProjects = mountedProjects.map((project) => ({ projectId: project.projectId, name: project.name }));
          throw error;
        }
        await teamVersions.deleteTeamVersions([targetId]);
        return { teamId: teamRootId, deletedTeamVersionIds: [targetId] };
      });
    },

    async deleteTeam(teamId) {
      if (typeof teamId !== "string" || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(teamId)) throw new Error("TEAM_NOT_FOUND: invalid Team id.");
      const projects = await teamVersions.listProjects();
      const allVersions = projects.filter((item) => !item.teamProjectId
        && item.projectType !== "collaboration"
        && (item.teamRootId || item.teamId || item.projectId) === teamId);
      if (!allVersions.length) throw new Error("TEAM_NOT_FOUND: the requested Team does not exist.");
      const teamRootId = teamId;
      return withTeamVersionLock(teamRootId, async () => {
        const lockedProjects = await teamVersions.listProjects();
        const versions = lockedProjects.filter((item) => !item.teamProjectId
          && item.projectType !== "collaboration"
          && (item.teamRootId || item.teamId || item.projectId) === teamRootId);
        if (!versions.length) throw new Error("TEAM_NOT_FOUND: the requested Team does not exist.");
        if (versions.some(isBuiltIn)) throw new Error("BUILT_IN_TEAM_DELETE_BLOCKED: built-in teams cannot be deleted.");
        const versionIds = new Set(versions.map((item) => item.teamVersionId || item.projectId));
        const mountedProjects = lockedProjects.filter((item) => item.projectType === "collaboration"
          && (item.mountedTeams || []).some((mounted) => versionIds.has(mounted.teamVersionId)));
        if (mountedProjects.length) {
          const error = new Error("TEAM_IN_USE: team versions are currently mounted by collaboration projects.");
          error.code = "TEAM_IN_USE";
          error.blockedProjects = mountedProjects.map((project) => ({ projectId: project.projectId, name: project.name }));
          throw error;
        }
        await teamVersions.deleteTeamVersions([...versionIds]);
        return { teamId: teamRootId, deletedTeamVersionIds: [...versionIds] };
      });
    }
  });
}
