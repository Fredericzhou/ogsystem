export function createTeamDesignUseCases({
  teamCatalog,
  withTeamVersionLock,
  teamMetadataStore,
  designStore,
  designProjector,
  designSerializer,
  designValidator,
  designAssetStore,
  packageIntegrity,
  rolePackageValidator
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

  function normalizeConfirmedList(value, label) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
      throw new Error(`TEAM_SOURCE_${label.toUpperCase()}_INVALID`);
    }
    const normalized = value.map((item) => item.trim());
    if (new Set(normalized).size !== normalized.length) throw new Error(`TEAM_SOURCE_${label.toUpperCase()}_INVALID`);
    return normalized.sort();
  }

  function createOutputSchema(content, events) {
    let schema;
    try { schema = JSON.parse(String(content || "")); }
    catch { throw new Error("TEAM_SOURCE_OUTPUT_SCHEMA_INVALID"); }
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error("TEAM_SOURCE_OUTPUT_SCHEMA_INVALID");
    const properties = schema.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) throw new Error("TEAM_SOURCE_OUTPUT_SCHEMA_INVALID");
    const event = properties.event;
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("TEAM_SOURCE_OUTPUT_SCHEMA_INVALID");
    if (events.length) event.enum = events;
    else delete event.enum;
    return schema;
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

  function assertDesignStage(team) {
    if ((team.teamVersionStatus || "draft") !== "draft") {
      throw new Error("TEAM_VERSION_IMMUTABLE: only a design-stage TeamVersion can be changed.");
    }
  }

  async function projectDesign(team, locale = "zh-CN") {
    return {
      ...await designProjector.project(team, locale),
      teamVersionStatus: team.teamVersionStatus,
      releasedAt: team.releasedAt,
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
      const override = {};
      const modelRef = String(role.modelRef || "").trim();
      const fallbackModelRef = String(role.fallbackModelRef || "").trim();
      if (role.modelSelectionSource !== "default") {
        const separator = modelRef.indexOf("/");
        if (separator < 1 || separator === modelRef.length - 1) {
          throw new Error(`TEAM_MODEL_BINDING_REQUIRED: select a runnable model for ${roleId} before saving.`);
        }
        override.backend = modelRef.slice(0, separator);
        override.modelId = modelRef.slice(separator + 1);
      } else if (fallbackModelRef && current.modelSelection?.defaults?.backend && current.modelSelection?.defaults?.modelId) {
        override.backend = current.modelSelection.defaults.backend;
        override.modelId = current.modelSelection.defaults.modelId;
      }
      if (fallbackModelRef) override.fallbackModelRef = fallbackModelRef;
      if (override.backend && override.modelId) roleOverrides[roleId] = override;
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
        assertDesignStage(team);
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
          projectDigest: null,
          teamVersionStatus: "draft",
          releasedAt: null,
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
        assertDesignStage(team);
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
        assertDesignStage(team);
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
    async copyRoleSourceToDraft({ teamVersionId, roleId, converted, events, allowedTools, identityConfirmed = false, sourceVersion }) {
      if (typeof designAssetStore?.saveImportedRoleAssets !== "function") throw new Error("TEAM_SOURCE_IMPORT_UNAVAILABLE");
      const initialTeam = await readTeamVersion(teamVersionId);
      return withTeamVersionLock(initialTeam.teamRootId || initialTeam.teamId || teamVersionId, async () => {
        const team = await readTeamVersion(teamVersionId);
        assertDesignStage(team);
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(String(roleId || ""))) throw new Error("TEAM_ROLE_ID_INVALID");
        if (!converted?.files || typeof converted.files !== "object") throw new Error("TEAM_SOURCE_PACKAGE_INVALID");
        const design = await projectDesign(team);
        const roles = design.authoring?.roles || {};
        if (!Object.hasOwn(roles, roleId)) throw new Error("TEAM_SOURCE_ROLE_NOT_IN_DESIGN");
        const current = await designAssetStore.readAssets({ workdir: team.workdir, roleIds: [roleId] });
        if (current.roles?.[roleId]?.["source.json"]) throw new Error("TEAM_SOURCE_ROLE_ALREADY_IMPORTED");

        const outgoingEvents = [...new Set(Object.values(design.authoring?.flows || {})
          .filter((flow) => flow?.fromRoleId === roleId && !rolePackageValidator?.isRuntimeOnlyErrorEvent?.(flow.eventType))
          .map((flow) => String(flow.eventType || "").trim())
          .filter(Boolean))].sort();
        const selectedEvents = events === undefined ? undefined : normalizeConfirmedList(events, "events");
        if (selectedEvents && (selectedEvents.length !== outgoingEvents.length || selectedEvents.some((event, index) => event !== outgoingEvents[index]))) {
          throw new Error("TEAM_SOURCE_EVENTS_MISMATCH: selected events must match the role's Team outgoing events.");
        }
        const configuredTools = new Set((current.executionConfig?.tools?.tools || []).map((tool) => String(tool.toolRef || "")).filter(Boolean));
        const selectedTools = allowedTools === undefined ? undefined : normalizeConfirmedList(allowedTools, "allowedTools");
        if (selectedTools?.some((tool) => !configuredTools.has(tool))) throw new Error("TEAM_SOURCE_TOOL_NOT_ALLOWED");
        if (!selectedEvents || !selectedTools || identityConfirmed !== true) {
          if (!converted?.verification || typeof converted.verification !== "object") throw new Error("TEAM_SOURCE_VERIFICATION_REQUIRED");
        }

        const role = JSON.parse(String(converted.files["role.json"] || ""));
        const source = JSON.parse(String(converted.files["source.json"] || ""));
        const selectedSource = converted.source || source;
        if (!converted.source || !converted.source.sourceId) throw new Error("TEAM_SOURCE_PROVENANCE_REQUIRED");
        const sourceVersionMatches = sourceVersion && sourceVersion.sourceId === selectedSource.sourceId
          && String(sourceVersion.gitUrl || "").replace(/\.git$/, "") === selectedSource.gitUrl
          && sourceVersion.commit === selectedSource.commit && sourceVersion.path === selectedSource.path
          && sourceVersion.adapterId === selectedSource.adapterId && sourceVersion.adapterVersion === selectedSource.adapterVersion
          && sourceVersion.language === selectedSource.language && sourceVersion.sourceDigest === selectedSource.sourceContentDigest;
        if (!sourceVersionMatches) throw new Error("TEAM_SOURCE_PROVENANCE_MISMATCH");
        role.roleId = roleId;
        role.outputs = { ...role.outputs, events: selectedEvents || [] };
        role.constraints = { ...role.constraints, allowedTools: selectedTools || [] };
        const verification = selectedEvents && selectedTools && identityConfirmed === true
          ? { status: "verified", identityConfirmed: true, eventsConfirmed: true, toolsConfirmed: true, confirmedEvents: selectedEvents, confirmedTools: selectedTools }
          : { status: "unverified", identityConfirmed: identityConfirmed === true, eventsConfirmed: selectedEvents !== undefined, toolsConfirmed: selectedTools !== undefined, missingConfirmations: [
            ...(identityConfirmed !== true ? ["roleIdentity"] : []),
            ...(!selectedEvents ? ["outputEvents"] : []),
            ...(!selectedTools ? ["allowedTools"] : [])
          ] };
        source.verification = verification;
        const packageFiles = {
          ...converted.files,
          "role.json": `${JSON.stringify(role, null, 2)}\n`,
          "output.schema.json": `${JSON.stringify(createOutputSchema(converted.files["output.schema.json"], selectedEvents || []), null, 2)}\n`,
          "source.json": `${JSON.stringify(source, null, 2)}\n`
        };
        if (verification.status === "verified") {
          if (!rolePackageValidator || typeof rolePackageValidator.validateManifest !== "function"
            || typeof rolePackageValidator.validatePrompt !== "function" || typeof rolePackageValidator.validateSchema !== "function"
            || typeof rolePackageValidator.validateSource !== "function") throw new Error("TEAM_ROLE_PACKAGE_VALIDATOR_UNAVAILABLE");
          const validatedRole = rolePackageValidator.validateManifest(role, `${roleId}/role.json`);
          const validatedSchema = JSON.parse(packageFiles["output.schema.json"]);
          rolePackageValidator.validatePrompt(packageFiles["prompt.md"], `${roleId}/prompt.md`);
          rolePackageValidator.validateSchema(validatedSchema, `${roleId}/output.schema.json`);
          rolePackageValidator.validateSource(source, `${roleId}/source.json`);
          const eventEnum = validatedSchema?.properties?.event?.enum;
          if (JSON.stringify(eventEnum || []) !== JSON.stringify(validatedRole.outputs.events)) {
            throw new Error("TEAM_SOURCE_SCHEMA_EVENTS_MISMATCH");
          }
        }
        await designAssetStore.saveImportedRoleAssets({ workdir: team.workdir, roleId, files: packageFiles });
        return { teamVersionId, roleId, verification, assets: await designAssetStore.readAssets({ workdir: team.workdir, roleIds: [roleId] }) };
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
        assertDesignStage(team);
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
