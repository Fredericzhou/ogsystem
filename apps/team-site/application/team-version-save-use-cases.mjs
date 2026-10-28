export function createTeamVersionSaveUseCases({ teamCatalog, teamMetadataUseCases, lifecycleUseCases, withTeamVersionSaveLock, removeProject, digestSnapshot }) {
  if (typeof teamCatalog?.getTeamVersion !== "function" || typeof teamMetadataUseCases?.updateTeamMetadata !== "function"
    || typeof lifecycleUseCases?.forkTeamVersion !== "function"
    || typeof withTeamVersionSaveLock !== "function" || typeof removeProject !== "function" || typeof digestSnapshot !== "function") {
    throw new TypeError("TeamVersion metadata save requires catalog, metadata, lifecycle, lock, and rollback operations.");
  }

  const metadataDigest = (team) => digestSnapshot(JSON.stringify({
    name: team.name || team.teamName || "",
    overview: team.overview || ""
  }));

  return Object.freeze({
    async getTeamVersionForSave(teamVersionId) {
      const initial = await teamCatalog.getTeamVersion(teamVersionId);
      const lockId = initial.teamRootId || initial.teamId || teamVersionId;
      return withTeamVersionSaveLock(lockId, async () => {
        const team = await teamCatalog.getTeamVersion(teamVersionId);
        return { ...team, expectedMetadataDigest: metadataDigest(team) };
      });
    },

    async saveTeamVersion(teamVersionId, body = {}) {
      const unsupported = Object.keys(body).filter((key) => !["name", "overview", "expectedMetadataDigest"].includes(key));
      if (unsupported.length) {
        throw new Error("TEAM_IR_V2_REQUIRED: TeamVersion content must be authored and saved through Team IR v2.");
      }

      const initial = await teamCatalog.getTeamVersion(teamVersionId);
      const lockId = initial.teamRootId || initial.teamId || teamVersionId;
      return withTeamVersionSaveLock(lockId, async () => {
        const source = await teamCatalog.getTeamVersion(teamVersionId);
        if (source.teamVersionStatus === "archived") {
          throw new Error("TEAM_VERSION_IMMUTABLE: archived TeamVersions are read-only.");
        }

        const currentName = source.name || source.teamName || "";
        const currentOverview = source.overview || "";
        const candidateName = body.name === undefined ? currentName : String(body.name).trim().slice(0, 120);
        const candidateOverview = body.overview === undefined ? currentOverview : String(body.overview).trim().slice(0, 4000);
        if (!candidateName) throw new Error("TEAM_NAME_REQUIRED: team name is required.");
        if (!body.expectedMetadataDigest) throw new Error("TEAM_VERSION_DIGEST_REQUIRED: metadata saves require the current metadata digest.");
        if (body.expectedMetadataDigest !== metadataDigest({ name: currentName, overview: currentOverview })) {
          throw new Error("TEAM_VERSION_DIGEST_CONFLICT: the TeamVersion metadata changed in another editor.");
        }

        const changed = candidateName !== currentName || candidateOverview !== currentOverview;
        if (source.teamVersionStatus === "released" && !changed) {
          return {
            teamVersionId,
            createdDraft: false,
            unchanged: true,
            name: currentName,
            overview: currentOverview,
            expectedMetadataDigest: metadataDigest({ name: currentName, overview: currentOverview })
          };
        }

        let target = source;
        let createdDraft = false;
        if (source.teamVersionStatus === "released") {
          target = await lifecycleUseCases.forkTeamVersion(teamVersionId);
          createdDraft = true;
        } else if ((source.teamVersionStatus || "draft") !== "draft") {
          throw new Error("TEAM_VERSION_IMMUTABLE: only a design-stage TeamVersion can be saved.");
        }

        const targetId = target.teamVersionId || target.projectId;
        try {
          if (changed) await teamMetadataUseCases.updateTeamMetadata(targetId, { name: candidateName, overview: candidateOverview });
          return {
            teamVersionId: targetId,
            teamVersionStatus: "draft",
            name: candidateName,
            overview: candidateOverview,
            createdDraft,
            unchanged: !changed,
            expectedMetadataDigest: metadataDigest({ name: candidateName, overview: candidateOverview })
          };
        } catch (error) {
          if (createdDraft) await removeProject(targetId).catch(() => undefined);
          throw error;
        }
      });
    }
  });
}
