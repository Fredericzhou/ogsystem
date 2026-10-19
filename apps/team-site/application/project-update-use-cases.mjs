export function createProjectUpdateUseCases({ projectStore, teamCatalog, computeProjectDefinitionDigest }) {
  if (typeof projectStore?.getProject !== "function"
    || typeof projectStore?.withProjectWriteLock !== "function"
    || typeof projectStore?.saveProjectMetadata !== "function") {
    throw new TypeError("Project update requires Project read, lock, and persistence operations.");
  }
  if (typeof teamCatalog?.assertTeamNameAvailable !== "function" || typeof computeProjectDefinitionDigest !== "function") {
    throw new TypeError("Project update requires Team name validation and definition digest operations.");
  }

  return Object.freeze({
    async updateProject(projectId, changes = {}) {
      return projectStore.withProjectWriteLock(projectId, "project-edit", async () => {
        const project = await projectStore.getProject(projectId);
        const nextName = changes.name === undefined ? project.name : String(changes.name).trim().slice(0, 120);
        const nextOverview = changes.overview === undefined ? project.overview : String(changes.overview).trim().slice(0, 4000);
        if (!nextName) throw new Error("Project name is required.");
        if (changes.name !== undefined && project.projectType === "team") {
          await teamCatalog.assertTeamNameAvailable(nextName, { excludeProjectId: projectId, teamRootId: project.teamRootId });
        }
        const semanticChanged = nextOverview !== project.overview || changes.semanticChanged === true;
        const next = {
          ...project,
          name: nextName,
          ...(project.projectType === "team" && changes.name !== undefined ? { teamName: nextName } : {}),
          overview: nextOverview,
          updatedAt: new Date().toISOString()
        };
        if (project.projectType === "collaboration") next.projectDefinitionDigest = computeProjectDefinitionDigest(next);
        if (semanticChanged) {
          next.projectStatus = "draft";
          next.projectDigest = null;
          next.confirmedAt = null;
        }
        return projectStore.saveProjectMetadata(projectId, next);
      });
    },

    async invalidateProjectConfirmation(projectId, reason = "semantic-edit") {
      return projectStore.withProjectWriteLock(projectId, `invalidate:${reason}`, async () => {
        const project = await projectStore.getProject(projectId);
        const next = {
          ...project,
          projectStatus: "draft",
          projectDigest: null,
          confirmedAt: null,
          updatedAt: new Date().toISOString(),
          invalidatedReason: reason
        };
        return projectStore.saveProjectMetadata(projectId, next);
      });
    }
  });
}
