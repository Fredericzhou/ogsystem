export function createTeamDesignUseCases({
  teamCatalog,
  withTeamVersionLock,
  teamMetadataStore,
  designStore,
  designProjector,
  designSerializer,
  designValidator,
  designAssetStore,
  packageIntegrity
}) {
  if (typeof teamCatalog?.getTeamVersion !== "function") throw new TypeError("Team design requires a TeamVersion catalog.");
  if (typeof teamCatalog?.assertTeamNameAvailable !== "function") throw new TypeError("Team design requires Team name validation.");
  if (typeof withTeamVersionLock !== "function") throw new TypeError("Team design requires a TeamVersion lock.");
  if (typeof teamMetadataStore?.saveTeamMetadata !== "function") throw new TypeError("Team design requires Team metadata persistence.");
  if (typeof designStore?.saveAuthoring !== "function" && typeof designStore?.saveSystemSource !== "function") {
    throw new TypeError("Team design requires a design persistence port.");
  }
  if (typeof designProjector?.project !== "function") throw new TypeError("Team design requires a projection port.");
  if (typeof designSerializer?.serialize !== "function") throw new TypeError("Team design requires an authoring serializer.");
  if (typeof designValidator?.validate !== "function") throw new TypeError("Team design requires a static validator.");
  if (designAssetStore && (typeof designAssetStore.readAssets !== "function" || typeof designAssetStore.saveAssets !== "function")) {
    throw new TypeError("Team design asset store requires read and save operations.");
  }

  if (typeof packageIntegrity?.computeReleaseBaselineDigest !== "function") {
    throw new TypeError("Team design requires canonical baseline digest support.");
  }

  function validateReleaseBaselines(input, roleIds, current = []) {
    if (!Array.isArray(input) || input.length > 20) throw new Error("TEAM_RELEASE_BASELINES_INVALID: provide at most 20 baseline scenarios.");
    const seen = new Set();
    const previous = new Map(current.map((item) => [item.scenarioId, item]));
    return input.map((item) => {
      const scenarioId = String(item?.scenarioId || "").trim();
      const name = String(item?.name || "").trim();
      const prompt = String(item?.prompt || "").trim();
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(scenarioId) || seen.has(scenarioId)) throw new Error("TEAM_RELEASE_BASELINE_ID_INVALID");
      seen.add(scenarioId);
      if (!name || name.length > 120 || !prompt || prompt.length > 4000) throw new Error("TEAM_RELEASE_BASELINE_INPUT_INVALID");
      const expectedRoleIds = [...new Set(Array.isArray(item.expectedRoleIds) ? item.expectedRoleIds.map(String) : [])];
      if (!expectedRoleIds.length || expectedRoleIds.some((roleId) => !roleIds.includes(roleId))) throw new Error("TEAM_RELEASE_BASELINE_ROLE_INVALID: expected roles must belong to this TeamVersion.");
      const materials = Array.isArray(item.materials) ? item.materials : [];
      if (materials.length > 20 || materials.some((material) => !material || typeof material.name !== "string" || !material.name.trim() || material.name.length > 160 || typeof material.content !== "string" || Buffer.byteLength(material.content, "utf8") > 256 * 1024)) {
        throw new Error("TEAM_RELEASE_BASELINE_MATERIALS_INVALID: provide at most 20 text materials, each no larger than 256 KiB.");
      }
      let outputSchema = item.outputSchema;
      if (!outputSchema || typeof outputSchema !== "object" || Array.isArray(outputSchema)) throw new Error("TEAM_RELEASE_BASELINE_SCHEMA_REQUIRED");
      try { outputSchema = JSON.parse(JSON.stringify(outputSchema)); }
      catch { throw new Error("TEAM_RELEASE_BASELINE_SCHEMA_INVALID"); }
      const prior = previous.get(scenarioId);
      const revision = prior ? prior.revision + 1 : 1;
      const requiredForRelease = item?.requiredForRelease !== false;
      const scenario = { scenarioId, name, revision, prompt, materials, expectedRoleIds, outputSchema, requiredForRelease };
      return {
        ...scenario,
        scenarioDigest: packageIntegrity?.computeReleaseBaselineDigest
          ? packageIntegrity.computeReleaseBaselineDigest(scenario)
          : undefined,
        updatedAt: new Date().toISOString()
      };
    });
  }

  async function readTeamVersion(teamVersionId) {
    const team = await teamCatalog.getTeamVersion(teamVersionId);
    if (team.projectType === "collaboration" || team.teamProjectId) {
      throw new Error("TEAM_VERSION_NOT_FOUND: the requested TeamVersion does not exist.");
    }
    return team;
  }

  async function projectDesign(team, locale = "zh-CN") {
    return {
      ...await designProjector.project(team, locale),
      projectStatus: team.projectStatus,
      confirmedAt: team.confirmedAt,
      teamVersionId: team.teamVersionId || team.projectId,
      teamVersionDigest: team.projectDigest
    };
  }

  async function modelSelectionForAuthoring(team, authoring) {
    const roles = authoring?.roles && typeof authoring.roles === "object" ? authoring.roles : {};
    const current = await designAssetStore.readAssets({ workdir: team.workdir, roleIds: Object.keys(roles) });
    const roleOverrides = {};
    for (const [roleId, role] of Object.entries(roles)) {
      if (role?.bindingKind !== "model") continue;
      if (role.modelSelectionSource === "default") continue;
      const modelRef = String(role.modelRef || "").trim();
      const separator = modelRef.indexOf("/");
      if (separator < 1 || separator === modelRef.length - 1) {
        throw new Error(`TEAM_MODEL_BINDING_REQUIRED: select a runnable model for ${roleId} before saving.`);
      }
      roleOverrides[roleId] = {
        backend: modelRef.slice(0, separator),
        modelId: modelRef.slice(separator + 1)
      };
    }
    return {
      configVersion: "2",
      ...(current.modelSelection?.defaults ? { defaults: current.modelSelection.defaults } : {}),
      roles: roleOverrides
    };
  }

  return Object.freeze({
    async getTeamVersion(teamVersionId) {
      return readTeamVersion(teamVersionId);
    },
    async updateTeamMetadata(teamVersionId, changes = {}) {
      const initialTeam = await readTeamVersion(teamVersionId);
      return withTeamVersionLock(initialTeam.teamRootId || initialTeam.teamId || teamVersionId, async () => {
        const team = await readTeamVersion(teamVersionId);
        if (team.teamVersionStatus === "released" || team.teamVersionStatus === "archived") {
          throw new Error("TEAM_VERSION_IMMUTABLE: fork this released TeamVersion before editing it.");
        }
        const name = changes.name === undefined ? team.name : String(changes.name).trim().slice(0, 120);
        const overview = changes.overview === undefined ? team.overview : String(changes.overview).trim().slice(0, 4000);
        if (!name) throw new Error("TEAM_NAME_REQUIRED: team name is required.");
        if (changes.name !== undefined && name !== team.name) {
          await teamCatalog.assertTeamNameAvailable(name, { excludeProjectId: teamVersionId, teamRootId: team.teamRootId });
        }
        const next = {
          ...team,
          name,
          teamName: name,
          overview,
          projectStatus: "draft",
          projectDigest: null,
          confirmedAt: null,
          updatedAt: new Date().toISOString()
        };
        return teamMetadataStore.saveTeamMetadata(teamVersionId, next);
      });
    },
    async getTeamDesign(teamVersionId, locale = "zh-CN") {
      const team = await readTeamVersion(teamVersionId);
      return projectDesign(team, locale);
    },
    async getTeamDesignAssets(teamVersionId) {
      if (!designAssetStore) throw new Error("TEAM_DESIGN_ASSETS_UNAVAILABLE: Team design assets are not configured.");
      const team = await readTeamVersion(teamVersionId);
      const design = await projectDesign(team);
      return designAssetStore.readAssets({ workdir: team.workdir, roleIds: Object.keys(design.authoring?.roles || {}) });
    },
    async getReleaseBaselineScenarios(teamVersionId) {
      if (typeof designAssetStore?.readReleaseBaselineScenarios !== "function") throw new Error("TEAM_RELEASE_BASELINES_UNAVAILABLE");
      const team = await readTeamVersion(teamVersionId);
      return { teamVersionId, scenarios: await designAssetStore.readReleaseBaselineScenarios({ workdir: team.workdir }) };
    },
    async saveReleaseBaselineScenarios(teamVersionId, body = {}) {
      if (typeof designAssetStore?.readReleaseBaselineScenarios !== "function" || typeof designAssetStore?.saveReleaseBaselineScenarios !== "function") throw new Error("TEAM_RELEASE_BASELINES_UNAVAILABLE");
      const initialTeam = await readTeamVersion(teamVersionId);
      return withTeamVersionLock(initialTeam.teamRootId || initialTeam.teamId || teamVersionId, async () => {
        const team = await readTeamVersion(teamVersionId);
        if (["released", "archived"].includes(team.teamVersionStatus)) throw new Error("TEAM_VERSION_IMMUTABLE: fork this released TeamVersion before editing it.");
        const design = await projectDesign(team);
        const roleIds = Object.keys(design.authoring?.roles || {});
        const existing = await designAssetStore.readReleaseBaselineScenarios({ workdir: team.workdir });
        const scenarios = validateReleaseBaselines(body.scenarios, roleIds, existing);
        const saved = await designAssetStore.saveReleaseBaselineScenarios({ workdir: team.workdir, scenarios });
        return { teamVersionId, scenarios: saved };
      });
    },
    async saveTeamDesignAssets(teamVersionId, body = {}) {
      if (!designAssetStore) throw new Error("TEAM_DESIGN_ASSETS_UNAVAILABLE: Team design assets are not configured.");
      const initialTeam = await readTeamVersion(teamVersionId);
      return withTeamVersionLock(initialTeam.teamRootId || initialTeam.teamId || teamVersionId, async () => {
        const team = await readTeamVersion(teamVersionId);
        if (team.teamVersionStatus === "released" || team.teamVersionStatus === "archived") {
          throw new Error("TEAM_VERSION_IMMUTABLE: fork this released TeamVersion before editing it.");
        }
        const design = await projectDesign(team);
        const roleIds = Object.keys(body.authoring?.roles || design.authoring?.roles || {});
        const submittedRoles = body.assets?.roles || {};
        if (Object.keys(submittedRoles).some((roleId) => !roleIds.includes(roleId))) {
          throw new Error("TEAM_ASSET_ROLE_UNKNOWN: assets must belong to a role in this TeamVersion.");
        }
        if ((body.assets?.contracts !== undefined && body.assets.contracts !== "") || Object.keys(body.assets?.contractSchemas || {}).length) {
          const system = body.authoring?.system || design.authoring?.system || {};
          if (!system.handoffMode) throw new Error("TEAM_HANDOFF_MODE_REQUIRED: choose a handoff mode before saving contracts.");
          if (system.handoffContracts !== ".ogs/contracts/handoff.json") {
            throw new Error("TEAM_HANDOFF_PATH_UNSUPPORTED: Studio stores the manifest at .ogs/contracts/handoff.json.");
          }
        }
        const assets = { ...(body.assets || {}) };
        if (body.authoring && typeof body.authoring === "object") {
          assets.modelSelection = await modelSelectionForAuthoring(team, body.authoring);
        }
        return designAssetStore.saveAssets({ workdir: team.workdir, assets, roleIds });
      });
    },
    async getTeamGraph(teamVersionId, locale = "zh-CN") {
      const team = await readTeamVersion(teamVersionId);
      const projected = await designProjector.project(team, locale);
      return { teamVersionId: team.teamVersionId || team.projectId, systemSource: projected.systemSource, viewModel: projected.viewModel };
    },
    async validateTeamDesign(teamVersionId, body = {}) {
      const team = await readTeamVersion(teamVersionId);
      return designValidator.validate(team, body);
    },
    async saveTeamDesign(teamVersionId, body = {}) {
      const initialTeam = await readTeamVersion(teamVersionId);
      return withTeamVersionLock(initialTeam.teamRootId || initialTeam.teamId || teamVersionId, async () => {
        const team = await readTeamVersion(teamVersionId);
        if (["released", "archived"].includes(team.teamVersionStatus)) {
          throw new Error("TEAM_VERSION_IMMUTABLE: fork this released TeamVersion before editing it.");
        }
        if (body.expectedTeamVersionDigest && body.expectedTeamVersionDigest !== team.projectDigest) {
          throw new Error("TEAM_VERSION_DIGEST_CONFLICT: the TeamVersion changed in another editor.");
        }
        const systemSource = typeof body.systemSource === "string"
          ? body.systemSource
          : body.authoring && typeof body.authoring === "object"
            ? designSerializer.serialize(body.authoring)
            : "";
        if (!systemSource) throw new Error("SYSTEM_SOURCE_REQUIRED: design source is required.");
        const saved = body.authoring && typeof body.authoring === "object" && typeof designStore.saveAuthoring === "function"
          ? await designStore.saveAuthoring({ workdir: team.workdir, authoring: body.authoring })
          : await designStore.saveSystemSource({ workdir: team.workdir, systemSource });
        if (saved?.validation?.ok !== true) {
          const diagnostics = Array.isArray(saved?.validation?.diagnostics)
            ? saved.validation.diagnostics.map((item) => item?.message || item?.code).filter(Boolean).join("; ")
            : "";
          throw new Error(`TEAM_DESIGN_INVALID: ${diagnostics || "design validation failed."}`);
        }
        return projectDesign(await readTeamVersion(teamVersionId));
      });
    }
  });
}
