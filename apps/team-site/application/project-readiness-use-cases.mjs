const messageByCode = {
  READINESS_CONTRACT_BUNDLE_UNREADABLE: "Handoff contract bundle cannot be inspected. Check the configured contract file.",
  READINESS_CONTRACT_PLAN_INVALID: "Handoff contract plan is invalid. Check the contract definitions and schemas.",
  READINESS_MODEL_CATALOG_INVALID: "Model catalog is invalid. Repair .ogs/model-catalog.json.",
  READINESS_ROLE_PACKAGE_INVALID: (issue) => `Role package \"${issue.roleId}\" is invalid. Check role.json and its referenced package files.`
};

function projectIssue(issue) {
  return {
    code: issue.code,
    severity: issue.severity,
    ...(issue.roleId ? { roleId: issue.roleId } : {}),
    message: typeof messageByCode[issue.code] === "function" ? messageByCode[issue.code](issue) : messageByCode[issue.code] ?? issue.message
  };
}

function publicIssues(readiness) {
  return { blockers: readiness.blockers.map(projectIssue), warnings: readiness.warnings.map(projectIssue), missingBindings: readiness.missingBindings };
}

export function createProjectReadinessUseCases({ getProject, readinessInspector, confirmation }) {
  if (typeof getProject !== "function") throw new TypeError("Project readiness requires a Project query.");
  if (!readinessInspector || typeof readinessInspector.inspect !== "function") throw new TypeError("Project readiness requires a readiness inspector.");

  async function inspectTeamVersion(teamId, teamVersionId) {
    const version = await getProject(teamVersionId);
    if (version.projectType === "collaboration" || (version.teamRootId || version.teamId) !== teamId || version.teamVersionId !== teamVersionId) {
      throw new Error("TEAM_VERSION_NOT_FOUND: TeamVersion does not belong to this Team.");
    }
    const readiness = await readinessInspector.inspect(version.workdir);
    const blockers = readiness.blockers.map(projectIssue);
    let canDryRun = readiness.canDryRun;
    if (confirmation?.assertCurrent && ["trained", "archived"].includes(version.teamVersionStatus)) {
      try {
        await confirmation.assertCurrent(version);
      } catch (error) {
        if (!String(error?.message || error).startsWith("PROJECT_CONFIRMATION_STALE:")) throw error;
        blockers.push({
          code: "PROJECT_CONFIRMATION_STALE",
          severity: "blocker",
          message: "Trained TeamVersion assets changed; create and train a new TeamVersion before running."
        });
        canDryRun = false;
      }
    }
    return {
      teamId,
      teamVersionId,
      versionStatus: version.teamVersionStatus,
      scope: "static_configuration",
      externalConnectivityChecked: false,
      canDryRun,
      blockers,
      warnings: readiness.warnings.map(projectIssue),
      missingBindings: readiness.missingBindings
    };
  }

  return Object.freeze({
    getTeamVersionReadiness: inspectTeamVersion,
    async getProjectReadiness(projectId) {
      const project = await getProject(projectId);
      if (project.projectType !== "collaboration") {
        const readiness = await readinessInspector.inspect(project.workdir);
        return {
          projectId,
          scope: "static_configuration",
          externalConnectivityChecked: false,
          teamVersionStatus: project.teamVersionStatus,
          mountedTeamVersionIds: [],
          canDryRun: readiness.canDryRun,
          ...publicIssues(readiness),
          teams: []
        };
      }
      const mountedTeams = Array.isArray(project.mountedTeams) ? project.mountedTeams : [];
      const blockers = [];
      if (!mountedTeams.length) blockers.push({ code: "PROJECT_TEAM_REQUIRED", severity: "blocker", message: "Mount at least one trained TeamVersion before running this project." });
      const versions = await Promise.all(mountedTeams.map(async (team) => {
        try {
          const readiness = await inspectTeamVersion(team.teamId, team.teamVersionId);
          if (!["trained", "archived"].includes(readiness.versionStatus)) blockers.push({ code: "PROJECT_TEAM_VERSION_UNAVAILABLE", severity: "blocker", teamVersionId: team.teamVersionId, message: `TeamVersion ${team.teamVersionId} is not available to this existing Project.` });
          return readiness;
        } catch (error) {
          blockers.push({ code: "PROJECT_TEAM_VERSION_UNAVAILABLE", severity: "blocker", teamVersionId: team.teamVersionId, message: error instanceof Error ? error.message : String(error) });
          return null;
        }
      }));
      const teams = versions.filter(Boolean);
      for (const version of teams) blockers.push(...version.blockers.map((issue) => ({ ...issue, teamVersionId: version.teamVersionId })));
      const warnings = teams.flatMap((version) => version.warnings.map((issue) => ({ ...issue, teamVersionId: version.teamVersionId })));
      return {
        projectId,
        scope: "static_configuration",
        externalConnectivityChecked: false,
        projectStatus: project.projectStatus,
        mountedTeamVersionIds: mountedTeams.map((team) => team.teamVersionId),
        canDryRun: blockers.length === 0 && teams.every((version) => version.canDryRun),
        blockers,
        warnings,
        teams
      };
    }
  });
}
