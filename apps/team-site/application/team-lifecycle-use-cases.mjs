export function createTeamLifecycleUseCases({
  projectStore,
  caseCatalog,
  locks,
  confirmation,
  releaseEvidence,
  teamIrRelease,
  teamIrFixtures = {},
  assertTrustedTeamTopology = () => false
}) {
  for (const operation of ["getProject", "listProjects", "createProject", "saveProjectMetadata", "removeProject"]) {
    if (typeof projectStore?.[operation] !== "function") {
      throw new TypeError(`Team lifecycle use cases require project ${operation}.`);
    }
  }
  if (typeof projectStore.withProjectWriteLock !== "function"
    || typeof projectStore.saveProjectMetadata !== "function"
    || typeof confirmation?.validateTopology !== "function"
    || typeof confirmation?.computeDigests !== "function") {
    throw new TypeError("Team lifecycle use cases require locked Team confirmation and digest operations.");
  }
  if (typeof locks?.withWorkspaceBindingLock !== "function" || typeof locks?.withTeamVersionLock !== "function"
    || typeof locks?.withTeamNameLock !== "function") {
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
    const fixture = teamIrFixtures[caseId];
    if (fixture?.schemaVersion !== 2 || typeof fixture?.team?.id !== "string") {
      throw new Error(`TEAM_IR_V2_FIXTURE_REQUIRED: classic Case ${caseId} has no native Team IR v2 fixture.`);
    }
    const language = locale === "en" ? "en" : "zh-CN";
    const defaultName = caseSpec.title?.[language] || caseSpec.title?.["zh-CN"] || caseSpec.title?.en || caseId;
    const defaultIntent = caseSpec.detail?.scenario?.[language] || caseSpec.detail?.scenario?.["zh-CN"] || caseSpec.short?.[language] || caseSpec.short?.["zh-CN"] || "";
    async function readStoredTeamIr(teamVersionId) {
      if (typeof teamIrRelease.getTeamIr !== "function") {
        throw new Error("TEAM_IR_V2_STORE_UNAVAILABLE: native Team IR lookup is not configured.");
      }
      return teamIrRelease.getTeamIr(teamVersionId);
    }
    const projects = await projectStore.listProjects();
    const classicVersions = projects.filter((project) => !project.teamProjectId
      && ["classic", "classic-template"].includes(project.source)
      && project.templateId === "team-ir-v2"
      && project.caseId === caseId
      && project.teamVersionStatus === "released");
    let existingClassic;
    for (const candidate of classicVersions.sort((left, right) => (right.teamVersionNumber || 0) - (left.teamVersionNumber || 0))) {
      const stored = await readStoredTeamIr(candidate.teamVersionId || candidate.projectId);
      if (stored?.teamIR?.schemaVersion === 2) {
        existingClassic = candidate;
        break;
      }
    }
    if (asTemplate) {
      const existingTemplate = projects.find((project) => !project.teamProjectId
        && project.source === "classic-template"
        && project.templateId === "team-ir-v2"
        && project.caseId === caseId
        && project.teamVersionStatus !== "archived"
        && String(project.name || "").toLocaleLowerCase() === String(name || defaultName).toLocaleLowerCase());
      if (existingTemplate) {
        const stored = await readStoredTeamIr(existingTemplate.teamVersionId || existingTemplate.projectId);
        if (stored?.teamIR?.schemaVersion !== 2) throw new Error("TEAM_IR_V2_REQUIRED: built-in templates must contain native Team IR v2.");
        return existingTemplate;
      }
    }
    if (!asTemplate && !name) {
      if (existingClassic) return existingClassic;
      const template = projects.find((project) => !project.teamProjectId && project.source === "classic-template" && project.templateId === "team-ir-v2" && project.caseId === caseId && project.teamVersionStatus !== "archived" && String(project.name || "").toLocaleLowerCase() === defaultName.toLocaleLowerCase());
      if (template) {
        await assertTeamIrReleaseEvidence(template);
        return confirmProjectTeam(template.projectId, { trustedClassic: true, release: true });
      }
    }
    if (typeof projectStore.createNativeTeamIrProject !== "function" || typeof teamIrRelease.saveTeamIr !== "function") {
      throw new Error("TEAM_IR_V2_FIXTURE_PROVISIONING_UNAVAILABLE: native Team IR v2 storage is not configured.");
    }
    const project = await projectStore.createNativeTeamIrProject({
      name: name || defaultName,
      overview: overview || defaultIntent,
      templateId: "team-ir-v2",
      caseId,
      source: asTemplate ? "classic-template" : "classic",
      locale: language,
      ...(asTemplate && existingClassic ? {
        teamId: existingClassic.teamRootId || existingClassic.teamId || existingClassic.projectId,
        teamVersionNumber: existingClassic.teamVersionNumber + 1,
        parentTeamVersionId: existingClassic.teamVersionId
      } : {})
    });
    try {
      const teamIR = structuredClone(fixture);
      teamIR.team.id = project.teamVersionId || project.projectId;
      const saved = await teamIrRelease.saveTeamIr(project.teamVersionId || project.projectId, {
        teamIR,
        expectedSemanticDigest: null
      });
      if (!saved?.saved) throw new Error(`TEAM_IR_V2_FIXTURE_INVALID: classic Case ${caseId} fixture could not be saved.`);
      if (asTemplate) return project;
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
      bindings: [{ id: "binding:worker", kind: "model", modelRef: "codex-gateway/gpt-6-luna", attemptTimeoutMs: 120000, retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } } }]
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
    async createTeamIrDraft({ name, overview = "", locale = "zh-CN" } = {}) {
      if (typeof projectStore.createNativeTeamIrProject !== "function"
        || typeof teamIrRelease?.saveTeamIr !== "function" || typeof projectStore.removeProjectData !== "function") {
        throw new Error("TEAM_IR_DRAFT_CREATION_UNAVAILABLE: native v2 draft persistence and compensation are not configured.");
      }
      const normalizedName = String(name || "").trim().slice(0, 120);
      if (!normalizedName) throw new Error("TEAM_NAME_REQUIRED: enter a name for the Team draft.");
      return locks.withTeamNameLock(async () => {
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
      });
    },

    async createClassicTeamProject(input) {
      return createClassicTeamProject(input);
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
      const sourceTeamVersionId = source.teamVersionId || source.projectId;
      const sourceIr = await teamIrRelease.getTeamIr(sourceTeamVersionId);
      if (sourceIr?.teamIR?.schemaVersion !== 2) {
        throw new Error("TEAM_IR_V2_REQUIRED: only native Team IR v2 versions can be edited.");
      }
      if (typeof projectStore.createNativeTeamIrProject !== "function") {
        throw new Error("TEAM_IR_DRAFT_CREATION_UNAVAILABLE: native v2 version forking is not configured.");
      }
      const project = await projectStore.createNativeTeamIrProject({
        name: source.name,
        teamName: source.teamName || source.name,
        teamId: source.teamId,
        teamVersionNumber: nextVersionNumber,
        parentTeamVersionId: source.teamVersionId || source.projectId,
        overview: source.overview,
        templateId: "team-ir-v2",
        source: "version-edit",
        locale: source.locale || "zh-CN"
      });
      await teamIrRelease.copyTeamIr(sourceTeamVersionId, project.workdir);
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
        templateId: "team-ir-v2",
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
