export function createTeamLifecycleUseCases({
  projectStore,
  packageStore,
  caseCatalog,
  locks,
  confirmation,
  releaseEvidence,
  teamIrRelease,
  caseMaterializer,
  assertTrustedTeamTopology = () => false
}) {
  for (const operation of ["getProject", "listProjects", "createProject", "saveProjectMetadata", "removeProject"]) {
    if (typeof projectStore?.[operation] !== "function") {
      throw new TypeError(`Team lifecycle use cases require project ${operation}.`);
    }
  }
  for (const operation of ["exportTeamPackage", "loadTeamPackage"]) {
    if (typeof packageStore?.[operation] !== "function") {
      throw new TypeError(`Team lifecycle use cases require package ${operation}.`);
    }
  }
  if (typeof projectStore.withProjectWriteLock !== "function"
    || typeof projectStore.saveProjectMetadata !== "function"
    || typeof confirmation?.validateTopology !== "function"
    || typeof confirmation?.computeDigests !== "function") {
    throw new TypeError("Team lifecycle use cases require locked Team confirmation and digest operations.");
  }
  if (typeof locks?.withWorkspaceBindingLock !== "function" || typeof locks?.withTeamVersionLock !== "function") {
    throw new TypeError("Team lifecycle use cases require workspace and TeamVersion locks.");
  }
  if (typeof caseCatalog?.getCase !== "function" || typeof caseCatalog?.listCases !== "function") {
    throw new TypeError("Team lifecycle use cases require a case catalog.");
  }
  if (typeof teamIrRelease?.getTeamIrReleaseSnapshot !== "function" || typeof teamIrRelease?.copyTeamIr !== "function") {
    throw new TypeError("Team lifecycle use cases require Team IR v2 release compilation and version forking.");
  }

  async function createClassicTeamProject({ caseId, asTemplate = false, name, overview, locale = "zh-CN" } = {}) {
    const caseSpec = caseCatalog.getCase(caseId);
    if (!caseSpec) throw new Error("Unknown example team.");
    const language = locale === "en" ? "en" : "zh-CN";
    const defaultName = caseSpec.title?.[language] || caseSpec.title?.["zh-CN"] || caseSpec.title?.en || caseId;
    const defaultIntent = caseSpec.detail?.scenario?.[language] || caseSpec.detail?.scenario?.["zh-CN"] || caseSpec.short?.[language] || caseSpec.short?.["zh-CN"] || "";
    const projects = await projectStore.listProjects();
    const classicVersions = projects.filter((project) => !project.teamProjectId
      && ["classic", "classic-template"].includes(project.source)
      && project.caseId === caseId
      && project.teamVersionStatus === "released");
    let existingClassic = classicVersions.sort((left, right) => (right.teamVersionNumber || 0) - (left.teamVersionNumber || 0))[0];
    if (!asTemplate && !name && existingClassic && typeof caseMaterializer?.isCurrent === "function") {
      const current = await projectStore.getProject(existingClassic.projectId);
      if (!await caseMaterializer.isCurrent(caseId, current.workdir)) existingClassic = undefined;
    }
    if (asTemplate) {
      const existingTemplate = projects.find((project) => !project.teamProjectId
        && project.source === "classic-template"
        && project.caseId === caseId
        && project.teamVersionStatus !== "archived"
        && String(project.name || "").toLocaleLowerCase() === String(name || defaultName).toLocaleLowerCase());
      if (existingTemplate) {
        if (typeof teamIrRelease?.getTeamIr === "function") {
          const stored = await teamIrRelease.getTeamIr(existingTemplate.projectId);
          if (stored?.teamIR?.schemaVersion === 2) return existingTemplate;
        }
        if (typeof caseMaterializer?.isCurrent === "function" && typeof caseMaterializer?.materialize === "function") {
          const current = await projectStore.getProject(existingTemplate.projectId);
          if (!await caseMaterializer.isCurrent(caseId, current.workdir)) {
            await caseMaterializer.materialize(caseId, current.workdir, language);
          }
        }
        return existingTemplate;
      }
    }
    if (!asTemplate && !name) {
      if (existingClassic) return existingClassic;
      const template = projects.find((project) => !project.teamProjectId && project.source === "classic-template" && project.caseId === caseId && project.teamVersionStatus !== "archived" && String(project.name || "").toLocaleLowerCase() === defaultName.toLocaleLowerCase());
      if (template) {
        await assertTeamIrReleaseEvidence(template);
        return confirmProjectTeam(template.projectId, { trustedClassic: true, release: true });
      }
    }
    const project = await projectStore.createProject({
      name: name || defaultName,
      overview: overview || defaultIntent,
      templateId: `classic:${caseId}`,
      caseId,
      source: asTemplate ? "classic-template" : "classic",
      locale: language,
      ...(asTemplate && existingClassic ? {
        teamId: existingClassic.teamRootId || existingClassic.teamId || existingClassic.projectId,
        teamVersionNumber: existingClassic.teamVersionNumber + 1,
        parentTeamVersionId: existingClassic.teamVersionId
      } : {})
    });
    if (asTemplate) return project;
    try {
      await assertTeamIrReleaseEvidence(project);
      return await confirmProjectTeam(project.projectId, { trustedClassic: true, release: true });
    } catch (error) {
      try {
        if (typeof projectStore.removeProjectData === "function") await projectStore.removeProjectData(project.projectId);
        else await projectStore.removeProject(project.projectId);
      } catch (cleanupError) {
        throw new Error(`CLASSIC_TEAM_CREATION_COMPENSATION_FAILED: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`, { cause: error });
      }
      throw error;
    }
  }

  async function assertTeamIrReleaseEvidence(team) {
    const teamVersionId = team.teamVersionId || team.projectId;
    const currentTeam = await projectStore.getProject(teamVersionId);
    if (!currentTeam) throw new Error("TEAM_VERSION_NOT_FOUND: the requested TeamVersion does not exist.");
    const { teamCoreDigest } = await confirmation.computeDigests(currentTeam);
    const irSnapshot = await teamIrRelease.getTeamIrReleaseSnapshot(teamVersionId);
    if (typeof releaseEvidence?.validateTeamIrReleaseEvidence !== "function") {
      throw new Error("TEAM_IR_V2_RELEASE_EVIDENCE_UNAVAILABLE: v2 Sandbox release evidence is not connected.");
    }
    await releaseEvidence.validateTeamIrReleaseEvidence({
      teamVersionId,
      teamCoreDigest,
      teamIrSemanticDigest: irSnapshot.teamIrSemanticDigest,
      compiledPlanDigest: irSnapshot.compiledPlanDigest
    });
    return irSnapshot;
  }

  function createStarterTeamIr(teamVersionId) {
    const requestSchema = { type: "object", properties: { request: { type: "string" } }, required: ["request"], additionalProperties: false };
    const summarySchema = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false };
    return {
      schemaVersion: 2,
      team: { id: teamVersionId, version: "2.0.0" },
      runInput: { dataSchema: requestSchema, preferencesSchema: { type: "object", additionalProperties: true }, artifactSlots: {} },
      runResult: { dataSchema: summarySchema, artifactSlots: {} },
      executionPolicy: { resultMode: "required", activeExecutionBudgetMs: 900000 },
      agents: [{
        id: "worker", packageRef: "role:worker@1", bindingRef: "binding:worker",
        inputPorts: { default: { dataSchema: requestSchema } },
        outputPorts: { DONE: { dataSchema: summarySchema } }
      }],
      handoffs: [
        { id: "run-to-worker", from: { kind: "run" }, to: { kind: "agent", agentId: "worker", inputPort: "default" }, map: { data: { request: { $ref: "$.run.input.request" } } }, when: { priority: 0 }, delivery: { deadlineMs: 300000 } },
        { id: "worker-to-result", from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { summary: { $ref: "$.output.data.summary" } } }, when: { priority: 0 } }
      ],
      orchestration: { routes: [
        { from: { kind: "run" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["run-to-worker"] },
        { from: { kind: "agent", agentId: "worker", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["worker-to-result"] }
      ], joins: [], loops: [], reviews: [] },
      bindings: [{ id: "binding:worker", kind: "model", modelRef: "sandbox/default", attemptTimeoutMs: 120000, retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } } }]
    };
  }

  async function confirmProjectTeam(projectId, options = {}) {
    const initial = await projectStore.getProject(projectId);
    if (!initial || initial.teamProjectId) throw new Error("TEAM_VERSION_NOT_FOUND: the requested TeamVersion does not exist.");
    const teamLockId = initial.teamRootId || initial.teamId || initial.projectId;
    return locks.withTeamVersionLock(teamLockId, () => projectStore.withProjectWriteLock(projectId, "project-confirm", async () => {
      const project = await projectStore.getProject(projectId);
      const { projectDigest, teamCoreDigest, teamDigestVersion } = await confirmation.computeDigests(project);
      const releasing = options.release !== false;
      const irSnapshot = releasing
        ? await teamIrRelease.getTeamIrReleaseSnapshot(project.teamVersionId || projectId)
        : undefined;
      const topologyDigest = !releasing && typeof confirmation.computeTopologyDigest === "function"
        ? await confirmation.computeTopologyDigest(project)
        : teamCoreDigest;
      if (releasing) {
        if (typeof releaseEvidence?.validateTeamIrReleaseEvidence !== "function") {
          throw new Error("TEAM_IR_V2_RELEASE_EVIDENCE_UNAVAILABLE: v2 Sandbox release evidence is not connected.");
        }
        await releaseEvidence.validateTeamIrReleaseEvidence({
          teamVersionId: project.teamVersionId || projectId,
          teamCoreDigest,
          teamIrSemanticDigest: irSnapshot.teamIrSemanticDigest,
          compiledPlanDigest: irSnapshot.compiledPlanDigest
        });
      }
      const inheritedClassicTopology = Boolean(!releasing && project.caseId
        && project.trustedClassicTopologyDigest
        && project.trustedClassicTopologyDigest === topologyDigest);
      if (releasing) {
        if (project.teamVersionStatus === "released"
          && (project.teamIrSemanticDigest !== irSnapshot.teamIrSemanticDigest
            || project.compiledPlanDigest !== irSnapshot.compiledPlanDigest)) {
          throw new Error("TEAM_IR_RELEASE_IMMUTABLE: the released Team IR digest does not match its frozen v2 snapshot.");
        }
      } else {
        await confirmation.validateTopology(project, {
          ...options,
          trustedClassic: Boolean(options.trustedClassic || inheritedClassicTopology)
        });
      }
      if (project.teamVersionStatus === "released" && project.projectDigest === projectDigest && project.teamCoreDigest === teamCoreDigest
        && project.teamIrSemanticDigest === irSnapshot?.teamIrSemanticDigest
        && project.compiledPlanDigest === irSnapshot?.compiledPlanDigest) return project;
      const releasedAt = new Date().toISOString();
      return projectStore.saveProjectMetadata(projectId, {
        ...project,
        projectDigest,
        teamCoreDigest,
        teamDigestVersion,
        teamVersionStatus: options.release === false ? (project.teamVersionStatus || "draft") : "released",
        ...(irSnapshot ? {
          teamIrSemanticDigest: irSnapshot.teamIrSemanticDigest,
          compiledPlanDigest: irSnapshot.compiledPlanDigest,
          compilerSemanticsVersion: irSnapshot.compilerSemanticsVersion
        } : {}),
        releasedAt: options.release === false ? null : releasedAt,
        trustedClassicTopologyDigest: !releasing && (inheritedClassicTopology || options.trustedClassic) ? topologyDigest : null,
        updatedAt: releasedAt
      });
    }));
  }

  return Object.freeze({
    async getTeamReleaseReadiness(projectId) {
      const initial = await projectStore.getProject(projectId);
      if (!initial || initial.teamProjectId) throw new Error("TEAM_VERSION_NOT_FOUND: the requested TeamVersion does not exist.");
      const teamLockId = initial.teamRootId || initial.teamId || initial.projectId;
      return locks.withTeamVersionLock(teamLockId, () => projectStore.withProjectWriteLock(projectId, "team-release-readiness", async () => {
        const project = await projectStore.getProject(projectId);
        if (!project || project.teamProjectId) throw new Error("TEAM_VERSION_NOT_FOUND: the requested TeamVersion does not exist.");
        const { teamCoreDigest, teamDigestVersion } = await confirmation.computeDigests(project);
        try {
          const irSnapshot = await teamIrRelease.getTeamIrReleaseSnapshot(project.teamVersionId || projectId);
          if (project.teamVersionStatus === "released"
            && (project.teamIrSemanticDigest !== irSnapshot.teamIrSemanticDigest
              || project.compiledPlanDigest !== irSnapshot.compiledPlanDigest)) {
            throw new Error("TEAM_IR_RELEASE_IMMUTABLE: the released Team IR digest does not match its frozen v2 snapshot.");
          }
          if (typeof releaseEvidence?.validateTeamIrReleaseEvidence !== "function") {
            throw new Error("TEAM_IR_V2_RELEASE_EVIDENCE_UNAVAILABLE: v2 Sandbox release evidence is not connected.");
          }
          const evidence = await releaseEvidence.validateTeamIrReleaseEvidence({
            teamVersionId: project.teamVersionId || projectId,
            teamCoreDigest,
            teamIrSemanticDigest: irSnapshot.teamIrSemanticDigest,
            compiledPlanDigest: irSnapshot.compiledPlanDigest
          });
          return {
            ...evidence,
            teamVersionId: project.teamVersionId || projectId,
            teamCoreDigest,
            teamDigestVersion,
            teamIrSemanticDigest: irSnapshot.teamIrSemanticDigest,
            compiledPlanDigest: irSnapshot.compiledPlanDigest,
            compilerSemanticsVersion: irSnapshot.compilerSemanticsVersion,
            ready: true,
            proof: "team-ir-v2-sandbox"
          };
        } catch (error) {
          return {
            teamVersionId: project.teamVersionId || projectId,
            teamCoreDigest,
            teamDigestVersion,
            ready: false,
            reason: error instanceof Error ? error.message : "TEAM_RELEASE_BASELINE_EVIDENCE_REQUIRED"
          };
        }
      }));
    },
    async createTeamDraft({ name, overview = "", locale = "zh-CN" } = {}) {
      const normalizedName = String(name || "").trim().slice(0, 120);
      if (!normalizedName) throw new Error("TEAM_NAME_REQUIRED: enter a name for the Team draft.");
      return projectStore.createProject({
        name: normalizedName,
        overview: String(overview || "").trim().slice(0, 4000),
        templateId: "empty",
        source: "team-factory",
        locale: locale === "en" ? "en" : "zh-CN"
      });
    },

    async createTeamIrDraft({ name, overview = "", locale = "zh-CN" } = {}) {
      if (typeof projectStore.createNativeTeamIrProject !== "function"
        || typeof teamIrRelease?.saveTeamIr !== "function" || typeof projectStore.removeProjectData !== "function") {
        throw new Error("TEAM_IR_DRAFT_CREATION_UNAVAILABLE: native v2 draft persistence and compensation are not configured.");
      }
      const normalizedName = String(name || "").trim().slice(0, 120);
      if (!normalizedName) throw new Error("TEAM_NAME_REQUIRED: enter a name for the Team draft.");
      const project = await projectStore.createNativeTeamIrProject({
        name: normalizedName,
        overview: String(overview || "").trim().slice(0, 4000),
        templateId: "team-ir-v2",
        source: "team-ir-v2",
        locale: locale === "en" ? "en" : "zh-CN"
      });
      try {
        const result = await teamIrRelease.saveTeamIr(project.projectId, {
          teamIR: createStarterTeamIr(project.projectId),
          expectedSemanticDigest: null
        });
        if (!result.saved) throw new Error("TEAM_IR_DRAFT_INVALID: the starter Team IR failed validation.");
        return await projectStore.getProject(project.projectId);
      } catch (error) {
        try {
          await projectStore.removeProjectData(project.projectId);
        } catch (cleanupError) {
          throw new Error(`TEAM_IR_DRAFT_COMPENSATION_FAILED: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`, { cause: error });
        }
        throw error;
      }
    },

    async createClassicTeamProject(input) {
      return createClassicTeamProject(input);
    },

    async provisionBuiltInTeamVersions() {
      return Promise.all(caseCatalog.listCases().map((item) => createClassicTeamProject({ caseId: item.id })));
    },

    async provisionBuiltInTeamTemplates() {
      const templates = await Promise.all(caseCatalog.listCases().map(async (item) => {
        try {
          return await createClassicTeamProject({ caseId: item.id, asTemplate: true });
        } catch (error) {
          if (String(error?.message || error).includes("TEAM_NAME_EXISTS")) return undefined;
          throw error;
        }
      }));
      return templates.filter(Boolean);
    },

    async forkTeamVersion(teamVersionId) {
      const initialSource = await projectStore.getProject(teamVersionId);
      return locks.withTeamVersionLock(initialSource.teamRootId || initialSource.teamId || initialSource.projectId, async () => {
      const source = await projectStore.getProject(teamVersionId);
      if (source.teamProjectId || source.teamVersionStatus !== "released") throw new Error("TEAM_VERSION_NOT_RELEASED: only a released team version can be edited.");
      const versions = (await projectStore.listProjects()).filter((project) => !project.teamProjectId && project.teamId === source.teamId);
      const nextVersionNumber = Math.max(...versions.map((project) => project.teamVersionNumber || 0), 0) + 1;
      const project = await projectStore.createProject({
        name: source.name,
        teamName: source.teamName || source.name,
        teamId: source.teamId,
        teamVersionNumber: nextVersionNumber,
        parentTeamVersionId: source.teamVersionId || source.projectId,
        overview: source.overview,
        templateId: "empty",
        source: "version-edit"
      });
      const bundle = await packageStore.exportTeamPackage(source.workdir);
      const loaded = await packageStore.loadTeamPackage({ workdir: project.workdir, bundle });
      if (loaded.validation?.ok === false) {
        await projectStore.removeProject(project.projectId).catch(() => undefined);
        throw new Error("TEAM_VERSION_COPY_INVALID: the released version could not be copied.");
      }
      await teamIrRelease.copyTeamIr(source.teamVersionId || source.projectId, project.workdir);
      const current = await projectStore.getProject(project.projectId);
      let trustedClassicTopologyDigest = null;
      if (source.caseId && (source.source === "classic" || source.source === "classic-template" || source.trustedClassicTopologyDigest)) {
        const currentTopologyDigest = typeof confirmation.computeTopologyDigest === "function"
          ? await confirmation.computeTopologyDigest(current)
          : (await confirmation.computeDigests(current)).teamCoreDigest;
        if (!source.trustedClassicTopologyDigest || source.trustedClassicTopologyDigest === currentTopologyDigest) {
          trustedClassicTopologyDigest = currentTopologyDigest;
        }
      }
      const next = {
        ...current,
        name: source.name,
        teamName: source.teamName || source.name,
        teamId: source.teamId,
        teamRootId: source.teamRootId || source.teamId,
        templateId: source.templateId || "empty",
        teamVersionId: project.projectId,
        teamVersionNumber: nextVersionNumber,
        teamVersionStatus: "draft",
        parentTeamVersionId: source.teamVersionId || source.projectId,
        caseId: source.caseId,
        trustedClassicTopologyDigest: trustedClassicTopologyDigest || null,
        projectDigest: null,
        releasedAt: null,
        updatedAt: new Date().toISOString()
      };
      return projectStore.saveProjectMetadata(project.projectId, next);
      });
    },

    async confirmProjectTeam(projectId, options = {}) {
      return confirmProjectTeam(projectId, options);
    },

    async releaseTeamVersion(projectId) {
      return confirmProjectTeam(projectId, { release: true });
    }
  });
}
