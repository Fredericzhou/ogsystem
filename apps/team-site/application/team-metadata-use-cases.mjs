export function createTeamMetadataUseCases({ teamCatalog, teamMetadataStore, withTeamVersionLock }) {
  if (typeof teamCatalog?.getTeamVersion !== "function" || typeof teamCatalog?.assertTeamNameAvailable !== "function"
    || typeof teamMetadataStore?.saveTeamMetadata !== "function" || typeof withTeamVersionLock !== "function") {
    throw new TypeError("Team metadata use cases require catalog, persistence, and TeamVersion locking.");
  }

  return Object.freeze({
    async updateTeamMetadata(teamVersionId, changes = {}) {
      const initial = await teamCatalog.getTeamVersion(teamVersionId);
      return withTeamVersionLock(initial.teamRootId || initial.teamId || teamVersionId, async () => {
        const team = await teamCatalog.getTeamVersion(teamVersionId);
        if (team.projectType === "collaboration" || team.teamProjectId) {
          throw new Error("TEAM_VERSION_NOT_FOUND: the requested TeamVersion does not exist.");
        }
        if ((team.teamVersionStatus || "draft") !== "draft") {
          throw new Error("TEAM_VERSION_IMMUTABLE: only a design-stage TeamVersion can be changed.");
        }
        const name = changes.name === undefined ? team.name : String(changes.name).trim().slice(0, 120);
        const overview = changes.overview === undefined ? team.overview : String(changes.overview).trim().slice(0, 4000);
        if (!name) throw new Error("TEAM_NAME_REQUIRED: team name is required.");
        if (changes.name !== undefined && name !== team.name) {
          await teamCatalog.assertTeamNameAvailable(name, { excludeProjectId: teamVersionId, teamRootId: team.teamRootId });
        }
        const updatedAt = new Date().toISOString();
        return teamMetadataStore.saveTeamMetadata(teamVersionId, {
          ...team,
          name,
          teamName: name,
          overview,
          projectDigest: null,
          teamVersionStatus: "draft",
          releasedAt: null,
          updatedAt
        });
      });
    }
  });
}
