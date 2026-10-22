import { assertCollaborationProject, assertProjectHasSingleTeam, assertProjectTeamMutationAllowed } from "../domain/project.mjs";
import { assertCanonicalTeamVersionId, assertReleasedTeamVersion, createMountedTeamRecord } from "../domain/team.mjs";

export function createCollaborationProjectUseCases({ projectStore, teamStore, computeProjectDefinitionDigest }) {
  if (typeof projectStore?.getProject !== "function"
    || typeof projectStore?.withProjectWriteLock !== "function"
    || typeof projectStore?.withCollaborationProjectNameLock !== "function"
    || typeof projectStore?.saveProjectMetadata !== "function") {
    throw new TypeError("Collaboration Project use cases require Project read, lock, and persistence operations.");
  }
  if (typeof projectStore?.listProjects !== "function"
    || typeof projectStore?.createProject !== "function"
    || typeof projectStore?.initializeCollaborationProject !== "function"
    || typeof projectStore?.removeProject !== "function") {
    throw new TypeError("Collaboration Project use cases require project creation and compensation operations.");
  }
  if (typeof teamStore?.getTeamVersion !== "function") {
    throw new TypeError("Collaboration Project use cases require TeamVersion lookup.");
  }
  if (typeof computeProjectDefinitionDigest !== "function") {
    throw new TypeError("Collaboration Project use cases require a definition digest function.");
  }

  async function resolveMountedTeams(teamVersionIds, previous = []) {
    assertProjectHasSingleTeam(teamVersionIds);
    const requestedIds = [...new Set(teamVersionIds.map((value) => String(value || "").trim()).filter(Boolean))];
    const previousById = new Map(previous.map((team) => [team.teamVersionId, team]));
    const mountedTeams = [];
    for (const teamVersionId of requestedIds) {
      assertCanonicalTeamVersionId(teamVersionId);
      const team = await teamStore.getTeamVersion(teamVersionId);
      assertReleasedTeamVersion(team);
      mountedTeams.push(createMountedTeamRecord(team, previousById.get(team.teamVersionId || team.projectId)));
    }
    return mountedTeams;
  }

  return Object.freeze({
    async listCollaborationProjects() {
      return (await projectStore.listProjects()).filter((project) => project.projectType === "collaboration");
    },

    async createCollaborationProject({ name, overview = "", teamVersionIds = [] } = {}) {
      const normalizedName = String(name || "协作项目").trim() || "协作项目";
      return projectStore.withCollaborationProjectNameLock(normalizedName, async () => {
        const existingProject = (await projectStore.listProjects()).find((item) => item.projectType === "collaboration"
          && String(item.name).trim().toLocaleLowerCase() === normalizedName.toLocaleLowerCase());
        if (existingProject) throw new Error("PROJECT_NAME_EXISTS: a project with this name already exists.");
        const mountedTeams = await resolveMountedTeams(teamVersionIds);
        let project;
        try {
          project = await projectStore.createProject({
            name: normalizedName,
            overview: String(overview),
            templateId: "empty",
            source: "collaboration-project"
          });
          const collaborationProject = {
            ...project,
            projectType: "collaboration",
            mountedTeams,
            materials: { version: 1, materials: [] }
          };
          const projectDefinitionDigest = computeProjectDefinitionDigest(collaborationProject);
          await projectStore.initializeCollaborationProject(project.projectId, { mountedTeams, projectDefinitionDigest });
          return await projectStore.getProject(project.projectId);
        } catch (error) {
          if (project?.projectId) await projectStore.removeProject(project.projectId).catch(() => undefined);
          throw error;
        }
      });
    },

    async listProjectTeams(projectId) {
      const project = await projectStore.getProject(projectId);
      assertCollaborationProject(project);
      return {
        projectId: project.projectId,
        projectDefinitionDigest: project.projectDefinitionDigest,
        mountedTeams: project.mountedTeams || []
      };
    },

    async replaceProjectTeams(projectId, teamVersionIds = []) {
      const current = await projectStore.getProject(projectId);
      assertCollaborationProject(current);
      assertProjectTeamMutationAllowed(current);
      assertProjectHasSingleTeam(teamVersionIds);

      return projectStore.withProjectWriteLock(projectId, "project-team-replace", async () => {
        const project = await projectStore.getProject(projectId);
        assertCollaborationProject(project);
        assertProjectTeamMutationAllowed(project);
        const mountedTeams = await resolveMountedTeams(teamVersionIds, project.mountedTeams || []);
        const next = {
          ...project,
          projectType: "collaboration",
          mountedTeams,
          projectDefinitionDigest: computeProjectDefinitionDigest({ ...project, mountedTeams }),
          updatedAt: new Date().toISOString()
        };
        return projectStore.saveProjectMetadata(projectId, next);
      });
    }
  });
}
