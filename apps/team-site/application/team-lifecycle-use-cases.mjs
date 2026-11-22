export function createTeamLifecycleUseCases({
  projectStore,
  packageStore,
  caseCatalog,
  locks,
  confirmation,
  releaseEvidence,
  caseMaterializer,
  accuracyReviewStore,
  rolePackageValidator,
  initializeV2DraftAssets = async () => {},
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
    const classicVersions = projects.filter((project) => !project.teamProjectId
      && ["classic", "classic-template"].includes(project.source)
      && project.caseId === caseId
      && project.teamVersionStatus === "trained");
    let existingClassic = classicVersions.sort((left, right) => (right.teamVersionNumber || 0) - (left.teamVersionNumber || 0))[0];
    if (!asTemplate && !name && existingClassic && typeof caseMaterializer?.isCurrent === "function") {
      const current = await projectStore.getProject(existingClassic.projectId);
      if (!await caseMaterializer.isCurrent(caseId, current.workdir)) existingClassic = undefined;
    }
    if (asTemplate) {
      const existingTemplate = projects.find((project) => !project.teamProjectId
        && project.source === "classic-template"
        && project.caseId === caseId
        && project.teamVersionStatus === "draft"
        && String(project.name || "").toLocaleLowerCase() === String(name || defaultName).toLocaleLowerCase());
      if (existingTemplate) {
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
      const template = projects.find((project) => !project.teamProjectId
        && project.source === "classic-template"
        && project.caseId === caseId
        && project.teamVersionStatus === "draft"
        && String(project.name || "").toLocaleLowerCase() === defaultName.toLocaleLowerCase());
      if (template) {
        if (typeof releaseEvidence?.prepareBuiltInTeamVersion !== "function") {
          throw new Error("TEAM_TRAINING_BASELINE_REQUIRED: built-in TeamVersions require current Sandbox evidence.");
        }
        await releaseEvidence.prepareBuiltInTeamVersion(template, { caseId, prompt: defaultIntent });
        // Keep the canonical case draft available for an explicit accuracy review.
        // The machine baseline proves that the generated team can execute; it does
        // not prove that its responsibilities and output fit the user's target.
        return confirmProjectTeam(template.projectId, { trustedClassic: true });
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
    if (asTemplate) {
      if (typeof caseMaterializer?.materialize === "function") {
        await caseMaterializer.materialize(caseId, project.workdir, language);
      }
      return project;
    }
    if (typeof releaseEvidence?.prepareBuiltInTeamVersion !== "function") {
      throw new Error("TEAM_TRAINING_BASELINE_REQUIRED: built-in TeamVersions require current Sandbox evidence.");
    }
    await releaseEvidence.prepareBuiltInTeamVersion(project, { caseId, prompt: defaultIntent });
    return confirmProjectTeam(project.projectId, { trustedClassic: true });
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
      const training = options.train === true;
      if (training) {
        const contractIssues = await getRoleContractIssues(project);
        if (contractIssues.length) {
          throw new Error(`TEAM_ROLE_CONTRACT_INCOMPLETE: complete machine Role Contracts before training (${contractIssues.join(", ")}).`);
        }
        if (typeof releaseEvidence?.validateTrainingEvidence !== "function") throw new Error("TEAM_TRAINING_BASELINE_REQUIRED: training baseline evidence is not configured.");
        const baselineEvidence = await releaseEvidence.validateTrainingEvidence(project.teamVersionId || projectId, teamCoreDigest);
        await assertTeamAccuracy(project, teamCoreDigest, baselineEvidence);
      }
      const inheritedClassicTopology = Boolean(project.caseId
        && project.trustedClassicTopologyDigest
        && project.trustedClassicTopologyDigest === topologyDigest);
      await confirmation.validateTopology(project, {
        ...options,
        trustedClassic: Boolean(options.trustedClassic || inheritedClassicTopology)
      });
      if (project.teamVersionStatus === "trained" && project.projectDigest === projectDigest && project.teamCoreDigest === teamCoreDigest) return project;
      const trainedAt = new Date().toISOString();
      return projectStore.saveProjectMetadata(projectId, {
        ...project,
        projectDigest,
        teamCoreDigest,
        teamDigestVersion,
        teamVersionStatus: options.train === true ? "trained" : (project.teamVersionStatus || "draft"),
        trainedAt: options.train === true ? trainedAt : null,
        trustedClassicTopologyDigest: inheritedClassicTopology || options.trustedClassic ? topologyDigest : null,
        updatedAt: trainedAt
      });
    }));
  }

  function normalizeBaselineEvidence(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
      .map(([scenarioId, simulationId]) => [String(scenarioId || "").trim(), String(simulationId || "").trim()])
      .filter(([scenarioId, simulationId]) => scenarioId && simulationId));
  }

  function reviewCoversBaselineEvidence(review, baselineEvidence) {
    const expected = normalizeBaselineEvidence(baselineEvidence?.passedScenarioEvidence);
    const selected = normalizeBaselineEvidence(review?.baselineEvidence);
    const scenarioIds = Object.keys(expected);
    return scenarioIds.length > 0 && scenarioIds.every((scenarioId) => selected[scenarioId] === expected[scenarioId]);
  }

  async function getRoleContractIssues(project) {
    const bundle = await packageStore.exportTeamPackage(project.workdir);
    const files = bundle?.team?.executableFiles;
    if (!Array.isArray(files)) throw new Error("TEAM_ROLE_CONTRACT_UNAVAILABLE: Team Package has no executable Role assets.");
    const manifests = files.filter((file) => typeof file?.path === "string"
      && /(?:^|\/)roles\/[^/]+\/role\.json$/.test(file.path));
    const issues = [];
    for (const file of manifests) {
      let role;
      try { role = JSON.parse(file.content); }
      catch { issues.push(`${file.path}:invalid-json`); continue; }
      const roleId = String(role?.roleId || file.path.split("/").at(-2) || "unknown");
      if (typeof rolePackageValidator?.validateManifest !== "function") {
        throw new Error("TEAM_ROLE_CONTRACT_VALIDATOR_UNAVAILABLE: Runtime Role Package validator is required before training.");
      }
      try { rolePackageValidator.validateManifest(role, file.path); }
      catch { issues.push(`${roleId}:invalid-contract`); continue; }
      const owns = role?.responsibility?.owns;
      const contributes = role?.responsibility?.contributes;
      if (!Array.isArray(owns) || !Array.isArray(contributes) || owns.length + contributes.length === 0) issues.push(`${roleId}:responsibility`);
      if (!Array.isArray(role?.inputs?.preconditions) || role.inputs.preconditions.length === 0) issues.push(`${roleId}:inputs.preconditions`);
      const postconditions = role?.outputs?.postconditions;
      const decisionCriteria = role?.outputs?.decisionCriteria;
      if ((!Array.isArray(postconditions) || postconditions.length === 0)
        && (!Array.isArray(decisionCriteria) || decisionCriteria.length === 0)) issues.push(`${roleId}:outputs`);
    }
    if (manifests.length === 0) throw new Error("TEAM_ROLE_CONTRACT_UNAVAILABLE: Team Package contains no Role Contract manifests.");
    return issues;
  }

  async function assertTeamAccuracy(project, teamCoreDigest, baselineEvidence) {
    if (typeof accuracyReviewStore?.readTeamAccuracyReview !== "function") {
      throw new Error("TEAM_ACCURACY_REVIEW_REQUIRED: review the TeamVersion responsibilities, inputs, handoffs, tools, and completion criteria before training.");
    }
    const review = await accuracyReviewStore.readTeamAccuracyReview({ workdir: project.workdir });
    const criteria = review?.criteria;
    const requiredCriteria = ["responsibilities", "authority", "inputs", "handoffs", "tools", "completion", "outputs"];
    const criteriaPassed = requiredCriteria.every((key) => criteria?.[key] === true);
    if (!review || !String(review.reviewer || "").trim() || !String(review.representativeTask || "").trim()
      || !String(review.notes || "").trim()
      || review.teamVersionId !== (project.teamVersionId || project.projectId)
      || review.teamCoreDigest !== teamCoreDigest
      || !reviewCoversBaselineEvidence(review, baselineEvidence)
      || !criteriaPassed) {
      throw new Error("TEAM_ACCURACY_REVIEW_REQUIRED: complete and save the TeamVersion accuracy review for the current digest before training.");
    }
  }

  return Object.freeze({
    async getTeamTrainingReadiness(projectId) {
      const initial = await projectStore.getProject(projectId);
      if (!initial || initial.teamProjectId) throw new Error("TEAM_VERSION_NOT_FOUND: the requested TeamVersion does not exist.");
      const teamLockId = initial.teamRootId || initial.teamId || initial.projectId;
      return locks.withTeamVersionLock(teamLockId, () => projectStore.withProjectWriteLock(projectId, "team-release-readiness", async () => {
        const project = await projectStore.getProject(projectId);
        if (!project || project.teamProjectId) throw new Error("TEAM_VERSION_NOT_FOUND: the requested TeamVersion does not exist.");
        const { teamCoreDigest, teamDigestVersion } = await confirmation.computeDigests(project);
        let roleContractIssues = [];
        try {
          roleContractIssues = await getRoleContractIssues(project);
          const evidence = await releaseEvidence.validateTrainingEvidence(project.teamVersionId || projectId, teamCoreDigest);
          let accuracyReview = null;
          let accuracyReady = false;
          if (typeof accuracyReviewStore?.readTeamAccuracyReview === "function") {
            accuracyReview = await accuracyReviewStore.readTeamAccuracyReview({ workdir: project.workdir });
            const criteria = accuracyReview?.criteria;
            accuracyReady = Boolean(accuracyReview
              && accuracyReview.teamVersionId === (project.teamVersionId || projectId)
              && accuracyReview.teamCoreDigest === teamCoreDigest
              && ["responsibilities", "authority", "inputs", "handoffs", "tools", "completion", "outputs"].every((key) => criteria?.[key] === true)
              && String(accuracyReview.reviewer || "").trim()
              && String(accuracyReview.representativeTask || "").trim()
              && String(accuracyReview.notes || "").trim());
          }
          if (roleContractIssues.length || !accuracyReady || !reviewCoversBaselineEvidence(accuracyReview, evidence)) {
            return {
              ...evidence,
              teamVersionId: project.teamVersionId || projectId,
              teamCoreDigest,
              teamDigestVersion,
              ready: false,
              baselineReady: true,
              roleContractReady: roleContractIssues.length === 0,
              roleContractIssues,
              accuracyReady,
              accuracyReview,
              reason: "TEAM_ACCURACY_REVIEW_REQUIRED: review the TeamVersion against every current Sandbox baseline before training."
            };
          }
          return { ...evidence, teamVersionId: project.teamVersionId || projectId, teamCoreDigest, teamDigestVersion, ready: true, baselineReady: true, roleContractReady: true, roleContractIssues: [], accuracyReady: true, accuracyReview, proof: "baseline-sandbox" };
        } catch (error) {
          const roleContractUnavailable = /TEAM_ROLE_CONTRACT_(?:VALIDATOR_)?UNAVAILABLE/.test(String(error?.message || error));
          return {
            teamVersionId: project.teamVersionId || projectId,
            teamCoreDigest,
            teamDigestVersion,
            ready: false,
            baselineReady: false,
            roleContractReady: !roleContractUnavailable && roleContractIssues.length === 0,
            roleContractIssues: roleContractUnavailable ? ["role-contract-validation-unavailable"] : roleContractIssues,
            passedScenarioIds: Array.isArray(error?.passedScenarioIds) ? error.passedScenarioIds : [],
            passedScenarioEvidence: error?.passedScenarioEvidence || {},
            reason: error instanceof Error ? error.message : "TEAM_TRAINING_BASELINE_EVIDENCE_REQUIRED"
          };
        }
      }));
    },

    async getTeamAccuracyReview(teamVersionId) {
      const team = await projectStore.getProject(teamVersionId);
      if (!team || team.teamProjectId) throw new Error("TEAM_VERSION_NOT_FOUND: the requested TeamVersion does not exist.");
      if (typeof accuracyReviewStore?.readTeamAccuracyReview !== "function") return { teamVersionId, review: null };
      const { teamCoreDigest } = await confirmation.computeDigests(team);
      const review = await accuracyReviewStore.readTeamAccuracyReview({ workdir: team.workdir });
      return { teamVersionId: team.teamVersionId || teamVersionId, teamCoreDigest, review, current: Boolean(review?.teamCoreDigest === teamCoreDigest) };
    },

    async saveTeamAccuracyReview(teamVersionId, body = {}) {
      const initial = await projectStore.getProject(teamVersionId);
      if (!initial || initial.teamProjectId) throw new Error("TEAM_VERSION_NOT_FOUND: the requested TeamVersion does not exist.");
      return locks.withTeamVersionLock(initial.teamRootId || initial.teamId || teamVersionId, () => projectStore.withProjectWriteLock(teamVersionId, "team-accuracy-review", async () => {
        const team = await projectStore.getProject(teamVersionId);
        if ((team.teamVersionStatus || "draft") !== "draft") throw new Error("TEAM_VERSION_IMMUTABLE: only a design-stage TeamVersion can be reviewed.");
        const { teamCoreDigest, teamDigestVersion } = await confirmation.computeDigests(team);
        const reviewer = String(body.reviewer || body.reviewerId || "").trim().slice(0, 200);
        const representativeTask = String(body.representativeTask || "").trim().slice(0, 4000);
        const notes = String(body.notes || "").trim().slice(0, 8000);
        const baselineEvidence = normalizeBaselineEvidence(body.baselineEvidence || body.baselineSimulationIds);
        const criteria = body.criteria && typeof body.criteria === "object" ? body.criteria : {};
        const requiredCriteria = ["responsibilities", "authority", "inputs", "handoffs", "tools", "completion", "outputs"];
        if (!reviewer || !representativeTask || !notes || !Object.keys(baselineEvidence).length || requiredCriteria.some((key) => criteria[key] !== true)) {
          throw new Error("TEAM_ACCURACY_REVIEW_INVALID: reviewer, representative task, baseline evidence, review notes, and all accuracy criteria are required.");
        }
        const review = {
          version: 1,
          teamVersionId: team.teamVersionId || teamVersionId,
          teamCoreDigest,
          teamDigestVersion,
          reviewer,
          representativeTask,
          baselineEvidence,
          criteria: Object.fromEntries(requiredCriteria.map((key) => [key, true])),
          notes,
          reviewedAt: new Date().toISOString()
        };
        if (typeof accuracyReviewStore?.saveTeamAccuracyReview !== "function") throw new Error("TEAM_ACCURACY_REVIEW_UNAVAILABLE");
        return { teamVersionId: review.teamVersionId, teamCoreDigest, review: await accuracyReviewStore.saveTeamAccuracyReview({ workdir: team.workdir, review }) };
      }));
    },
    async createTeamDraft({ name, overview = "", locale = "zh-CN" } = {}) {
      const normalizedName = String(name || "").trim().slice(0, 120);
      if (!normalizedName) throw new Error("TEAM_NAME_REQUIRED: enter a name for the Team draft.");
      const project = await projectStore.createProject({
        name: normalizedName,
        overview: String(overview || "").trim().slice(0, 4000),
        templateId: "empty",
        source: "team-factory",
        locale: locale === "en" ? "en" : "zh-CN"
      });
      await initializeV2DraftAssets(project, locale === "en" ? "en" : "zh-CN");
      return projectStore.getProject(project.projectId);
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
      if (source.teamProjectId || source.teamVersionStatus !== "trained") throw new Error("TEAM_VERSION_NOT_TRAINED: only a trained team version can be edited.");
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
        throw new Error("TEAM_VERSION_COPY_INVALID: the trained version could not be copied.");
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
        teamVersionStatus: "draft",
        parentTeamVersionId: source.teamVersionId || source.projectId,
        caseId: source.caseId,
        trustedClassicTopologyDigest: trustedClassicTopologyDigest || null,
        projectDigest: null,
        trainedAt: null,
        updatedAt: new Date().toISOString()
      };
      return projectStore.saveProjectMetadata(project.projectId, next);
      });
    },

    async confirmProjectTeam(projectId, options = {}) {
      return confirmProjectTeam(projectId, options);
    },

    async trainTeamVersion(projectId) {
      return confirmProjectTeam(projectId, { train: true });
    }
  });
}
