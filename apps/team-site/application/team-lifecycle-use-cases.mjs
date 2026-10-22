export function createTeamLifecycleUseCases({
  projectStore,
  packageStore,
  caseCatalog,
  locks,
  confirmation,
  releaseEvidence,
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

  async function createClassicTeamProject({ caseId, asTemplate = false, name, overview, locale = "zh-CN" } = {}) {
    const caseSpec = caseCatalog.getCase(caseId);
    if (!caseSpec) throw new Error("Unknown example team.");
    const language = locale === "en" ? "en" : "zh-CN";
    const defaultName = caseSpec.title?.[language] || caseSpec.title?.["zh-CN"] || caseSpec.title?.en || caseId;
    const defaultIntent = caseSpec.detail?.scenario?.[language] || caseSpec.detail?.scenario?.["zh-CN"] || caseSpec.short?.[language] || caseSpec.short?.["zh-CN"] || "";
    const projects = await projectStore.listProjects();
    const classicVersions = projects.filter((project) => !project.teamProjectId && project.source === "classic" && project.caseId === caseId && project.teamVersionStatus === "released");
    const existingClassic = classicVersions.sort((left, right) => (right.teamVersionNumber || 0) - (left.teamVersionNumber || 0))[0];
    if (asTemplate) {
      const existingTemplate = projects.find((project) => !project.teamProjectId
        && project.source === "classic-template"
        && project.caseId === caseId
        && project.teamVersionStatus !== "archived"
        && String(project.name || "").toLocaleLowerCase() === String(name || defaultName).toLocaleLowerCase());
      if (existingTemplate) return existingTemplate;
    }
    if (!asTemplate && !name) {
      if (existingClassic) return existingClassic;
      const template = projects.find((project) => !project.teamProjectId && project.source === "classic-template" && project.caseId === caseId && project.teamVersionStatus !== "archived" && String(project.name || "").toLocaleLowerCase() === defaultName.toLocaleLowerCase());
      if (template) {
        if (typeof releaseEvidence?.prepareBuiltInTeamVersion !== "function") {
          throw new Error("TEAM_RELEASE_BASELINE_REQUIRED: built-in TeamVersions require current Sandbox evidence.");
        }
        await releaseEvidence.prepareBuiltInTeamVersion(template, { caseId, prompt: defaultIntent });
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
    if (typeof releaseEvidence?.prepareBuiltInTeamVersion !== "function") {
      throw new Error("TEAM_RELEASE_BASELINE_REQUIRED: built-in TeamVersions require current Sandbox evidence.");
    }
    await releaseEvidence.prepareBuiltInTeamVersion(project, { caseId, prompt: defaultIntent });
    return confirmProjectTeam(project.projectId, { trustedClassic: true, release: true });
  }

  async function confirmProjectTeam(projectId, options = {}) {
    const initial = await projectStore.getProject(projectId);
    if (!initial || initial.teamProjectId) throw new Error("TEAM_VERSION_NOT_FOUND: the requested TeamVersion does not exist.");
    const teamLockId = initial.teamRootId || initial.teamId || initial.projectId;
    return locks.withTeamVersionLock(teamLockId, () => projectStore.withProjectWriteLock(projectId, "project-confirm", async () => {
      const project = await projectStore.getProject(projectId);
      const { projectDigest, teamCoreDigest, teamDigestVersion } = await confirmation.computeDigests(project);
      const topologyDigest = typeof confirmation.computeTopologyDigest === "function"
        ? await confirmation.computeTopologyDigest(project)
        : teamCoreDigest;
      const releasing = options.release === true;
      if (releasing) {
        if (typeof releaseEvidence?.validateReleaseEvidence !== "function") throw new Error("TEAM_RELEASE_BASELINE_REQUIRED: release evidence validation is not configured.");
        await releaseEvidence.validateReleaseEvidence(project.teamVersionId || projectId, teamCoreDigest);
      }
      const inheritedClassicTopology = Boolean(project.caseId
        && project.trustedClassicTopologyDigest
        && project.trustedClassicTopologyDigest === topologyDigest);
      await confirmation.validateTopology(project, {
        ...options,
        trustedClassic: Boolean(options.trustedClassic || inheritedClassicTopology)
      });
      if (project.projectStatus === "confirmed" && project.projectDigest === projectDigest && project.teamCoreDigest === teamCoreDigest) return project;
      const confirmedAt = new Date().toISOString();
      return projectStore.saveProjectMetadata(projectId, {
        ...project,
        projectStatus: "confirmed",
        projectDigest,
        teamCoreDigest,
        teamDigestVersion,
        confirmedAt,
        teamVersionStatus: options.release === false ? (project.teamVersionStatus || "draft") : "released",
        releasedAt: options.release === false ? null : confirmedAt,
        trustedClassicTopologyDigest: inheritedClassicTopology || options.trustedClassic ? topologyDigest : null,
        updatedAt: confirmedAt
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
          const evidence = await releaseEvidence.validateReleaseEvidence(project.teamVersionId || projectId, teamCoreDigest);
          return { ...evidence, teamVersionId: project.teamVersionId || projectId, teamCoreDigest, teamDigestVersion, ready: true, proof: "baseline-sandbox" };
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

    async createClassicTeamProject(input) {
      return createClassicTeamProject(input);
    },

    async provisionBuiltInTeamVersions() {
      return Promise.all(caseCatalog.listCases().map((item) => createClassicTeamProject({ caseId: item.id })));
    },

    async provisionBuiltInTeamTemplates() {
      return Promise.all(caseCatalog.listCases().map((item) => createClassicTeamProject({ caseId: item.id, asTemplate: true })));
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
        teamVersionStatus: "editing",
        parentTeamVersionId: source.teamVersionId || source.projectId,
        caseId: source.caseId,
        trustedClassicTopologyDigest: trustedClassicTopologyDigest || null,
        projectStatus: "draft",
        projectDigest: null,
        confirmedAt: null,
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
