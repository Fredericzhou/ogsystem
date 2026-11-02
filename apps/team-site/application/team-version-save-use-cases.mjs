const VOLATILE_KEYS = new Set(["createdAt", "updatedAt", "modifiedAt", "generatedAt", "probedAt", "refreshedAt"]);

function normalize(value) {
  if (typeof value === "string") return value.replace(/\r\n?/g, "\n");
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => !VOLATILE_KEYS.has(key)).map((key) => [key, normalize(value[key])]));
}

export function createTeamVersionSaveUseCases({ teamCatalog, designUseCases, lifecycleUseCases, withTeamVersionSaveLock, removeProject, digestSnapshot }) {
  if (typeof teamCatalog?.getTeamVersion !== "function" || typeof designUseCases?.getTeamDesign !== "function"
    || typeof designUseCases?.getTeamDesignAssets !== "function" || typeof designUseCases?.saveTeamDesign !== "function"
    || typeof designUseCases?.saveTeamDesignAssets !== "function" || typeof designUseCases?.validateTeamDesign !== "function"
    || typeof lifecycleUseCases?.forkTeamVersion !== "function"
    || typeof withTeamVersionSaveLock !== "function" || typeof removeProject !== "function" || typeof digestSnapshot !== "function") {
    throw new TypeError("TeamVersion save requires catalog, design, lifecycle, lock, and rollback operations.");
  }

  async function readSnapshot(team) {
    let baselineResult;
    try {
      baselineResult = await designUseCases.getReleaseBaselineScenarios(team.teamVersionId || team.projectId);
    } catch (error) {
      if (String(error?.message || error).includes("TEAM_RELEASE_BASELINES_UNAVAILABLE")) {
        baselineResult = { scenarios: [] };
      } else {
        throw error;
      }
    }
    const [design, assets] = await Promise.all([
      designUseCases.getTeamDesign(team.teamVersionId || team.projectId),
      designUseCases.getTeamDesignAssets(team.teamVersionId || team.projectId)
    ]);
    return {
      name: team.name || team.teamName || "",
      overview: team.overview || "",
      authoring: design.authoring || {},
      assets,
      scenarios: baselineResult?.scenarios || []
    };
  }

  const serialize = (value) => JSON.stringify(normalize(value));
  const digest = (value) => digestSnapshot(serialize(value));
  const metadataDigest = (snapshot) => digest({ name: snapshot.name || snapshot.teamName || "", overview: snapshot.overview || "" });
  const saveDigest = (team, snapshot) => team.teamVersionStatus === "released" ? team.projectDigest : digest(snapshot);
  const assetsForPersistence = (assets) => {
    const persisted = { ...assets };
    if (persisted.contracts === "") delete persisted.contracts;
    return persisted;
  };

  return Object.freeze({
    async getTeamVersionForSave(teamVersionId) {
      const initial = await teamCatalog.getTeamVersion(teamVersionId);
      const lockId = initial.teamRootId || initial.teamId || teamVersionId;
      return withTeamVersionSaveLock(lockId, async () => {
        const team = await teamCatalog.getTeamVersion(teamVersionId);
        return { ...team, expectedMetadataDigest: metadataDigest(team) };
      });
    },

    async getTeamDesignForSave(teamVersionId, locale = "zh-CN") {
      const initial = await teamCatalog.getTeamVersion(teamVersionId);
      const lockId = initial.teamRootId || initial.teamId || teamVersionId;
      return withTeamVersionSaveLock(lockId, async () => {
        const team = await teamCatalog.getTeamVersion(teamVersionId);
        const [snapshot, design] = await Promise.all([
          readSnapshot(team),
          designUseCases.getTeamDesign(teamVersionId, locale)
        ]);
        return { ...design, saveSnapshotDigest: saveDigest(team, snapshot), saveSnapshotAssets: snapshot.assets };
      });
    },

    async saveTeamVersion(teamVersionId, body = {}) {
      const initial = await teamCatalog.getTeamVersion(teamVersionId);
      const lockId = initial.teamRootId || initial.teamId || teamVersionId;
      return withTeamVersionSaveLock(lockId, async () => {
        const source = await teamCatalog.getTeamVersion(teamVersionId);
        if (source.teamVersionStatus === "archived") {
          throw new Error("TEAM_VERSION_IMMUTABLE: archived TeamVersions are read-only.");
        }
        if (source.teamVersionStatus === "released" && body.expectedTeamVersionDigest && body.expectedTeamVersionDigest !== source.projectDigest) {
          throw new Error("TEAM_VERSION_DIGEST_CONFLICT: the TeamVersion changed in another editor.");
        }

        const isMetadataOnly = body.authoring === undefined && body.assets === undefined && body.scenarios === undefined;
        if (isMetadataOnly) {
          const currentName = source.name || source.teamName || "";
          const currentOverview = source.overview || "";
          const candidateName = body.name === undefined ? currentName : String(body.name).trim().slice(0, 120);
          const candidateOverview = body.overview === undefined ? currentOverview : String(body.overview).trim().slice(0, 4000);
          if (!candidateName) throw new Error("TEAM_NAME_REQUIRED: team name is required.");
          if (!body.expectedMetadataDigest) throw new Error("TEAM_VERSION_DIGEST_REQUIRED: metadata saves require the current metadata digest.");
          if (body.expectedMetadataDigest !== metadataDigest({ name: currentName, overview: currentOverview })) {
            throw new Error("TEAM_VERSION_DIGEST_CONFLICT: the TeamVersion metadata changed in another editor.");
          }
          const changed = serialize({ name: candidateName, overview: candidateOverview }) !== serialize({ name: currentName, overview: currentOverview });
          if (source.teamVersionStatus === "released" && !changed) {
            return { teamVersionId, createdDraft: false, unchanged: true, name: currentName, overview: currentOverview, expectedMetadataDigest: metadataDigest({ name: currentName, overview: currentOverview }) };
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
            if (changed) {
              await designUseCases.updateTeamMetadata(targetId, { name: candidateName, overview: candidateOverview });
            }
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
        }

        const current = await readSnapshot(source);
        if (!body.expectedTeamVersionDigest) throw new Error("TEAM_VERSION_DIGEST_REQUIRED: design saves require the current TeamVersion digest.");
        if (body.expectedTeamVersionDigest !== saveDigest(source, current)) {
          throw new Error("TEAM_VERSION_DIGEST_CONFLICT: the TeamVersion changed in another editor.");
        }
        const candidate = {
          name: body.name === undefined ? current.name : String(body.name).trim().slice(0, 120),
          overview: body.overview === undefined ? current.overview : String(body.overview).trim().slice(0, 4000),
          authoring: body.authoring === undefined ? current.authoring : body.authoring,
          assets: body.assets === undefined ? current.assets : body.assets,
          scenarios: body.scenarios === undefined ? current.scenarios : body.scenarios
        };
        if (!candidate.name) throw new Error("TEAM_NAME_REQUIRED: team name is required.");
        const changed = serialize(candidate) !== serialize(current);
        const designChanged = serialize(candidate.authoring) !== serialize(current.authoring);
        const assetsChanged = serialize(candidate.assets) !== serialize(current.assets);
        const scenariosChanged = serialize(candidate.scenarios) !== serialize(current.scenarios);
        if (source.teamVersionStatus === "released" && !changed) {
          return { ...(await designUseCases.getTeamDesign(teamVersionId)), teamVersionId, createdDraft: false, unchanged: true };
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
        let assetsWritten = false;
        let designWritten = false;
        let scenariosWritten = false;
        let metadataWritten = false;
        try {
          if (designChanged || assetsChanged) {
            if (assetsChanged || designChanged) {
              assetsWritten = true;
              await designUseCases.saveTeamDesignAssets(targetId, { authoring: candidate.authoring, assets: assetsForPersistence(candidate.assets) });
            }
            const validation = await designUseCases.validateTeamDesign(targetId, { authoring: candidate.authoring });
            if (validation?.ok === false) {
              const diagnostics = validation.diagnostics?.map((item) => item.message || item.code).filter(Boolean).join("; ");
              throw new Error(`TEAM_DESIGN_INVALID: ${diagnostics || "design validation failed."}`);
            }
            designWritten = true;
            await designUseCases.saveTeamDesign(targetId, {
              authoring: candidate.authoring,
              expectedTeamVersionDigest: target.projectDigest
            });
          }
          if (scenariosChanged) {
            scenariosWritten = true;
            await designUseCases.saveReleaseBaselineScenarios(targetId, { scenarios: candidate.scenarios });
          }
          const metadata = { name: candidate.name, overview: candidate.overview };
          if (candidate.name !== (target.name || target.teamName) || candidate.overview !== (target.overview || "")) {
            metadataWritten = true;
            await designUseCases.updateTeamMetadata(targetId, metadata);
          }
          return {
            ...(designChanged || assetsChanged ? await designUseCases.getTeamDesign(targetId) : {}),
            teamVersionId: targetId,
            teamVersionStatus: "draft",
            name: candidate.name,
            overview: candidate.overview,
            teamVersionDigest: saveDigest(target, await readSnapshot(target)),
            expectedMetadataDigest: metadataDigest({ name: candidate.name, overview: candidate.overview }),
            createdDraft,
            unchanged: false
          };
        } catch (error) {
          if (createdDraft) {
            await removeProject(targetId).catch(() => undefined);
          } else {
            if (metadataWritten) await designUseCases.updateTeamMetadata(targetId, { name: current.name, overview: current.overview }).catch(() => undefined);
            if (designWritten) await designUseCases.saveTeamDesign(targetId, { authoring: current.authoring }).catch(() => undefined);
            if (assetsWritten) await designUseCases.saveTeamDesignAssets(targetId, { authoring: current.authoring, assets: assetsForPersistence(current.assets) }).catch(() => undefined);
            if (scenariosWritten) await designUseCases.saveReleaseBaselineScenarios(targetId, { scenarios: current.scenarios }).catch(() => undefined);
          }
          throw error;
        }
      });
    }
  });
}
