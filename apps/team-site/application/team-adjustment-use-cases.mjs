export function createTeamAdjustmentUseCases({ projectStore, forkTeamVersion }) {
  if (typeof projectStore?.getProject !== "function" || typeof forkTeamVersion !== "function") {
    throw new TypeError("Team adjustment requires Project lookup and TeamVersion forking.");
  }

  return Object.freeze({
    async createProjectTeamAdjustment(projectId, teamVersionId) {
      const project = await projectStore.getProject(projectId);
      if (project.projectType !== "collaboration") {
        throw new Error("PROJECT_TYPE_INVALID: Team adjustments can only be started from a Collaboration Project.");
      }
      if (!(project.mountedTeams || []).some((team) => team.teamVersionId === teamVersionId)) {
        throw new Error("TEAM_VERSION_NOT_MOUNTED: the selected version is not mounted in this project.");
      }
      const draft = await forkTeamVersion(teamVersionId);
      return { draft, collaborationProjectId: projectId, sourceTeamVersionId: teamVersionId };
    }
  });
}
