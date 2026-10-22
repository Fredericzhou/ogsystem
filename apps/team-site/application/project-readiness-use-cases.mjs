function publicIssues(readiness) {
  const messageByCode = {
    READINESS_CONTRACT_BUNDLE_UNREADABLE: "Handoff contract bundle cannot be inspected. Check the configured contract file.",
    READINESS_CONTRACT_PLAN_INVALID: "Handoff contract plan is invalid. Check the contract definitions and schemas.",
    READINESS_MODEL_CATALOG_INVALID: "Model catalog is invalid. Repair .ogs/model-catalog.json.",
    READINESS_ROLE_PACKAGE_INVALID: (issue) => `Role package \"${issue.roleId}\" is invalid. Check role.json and its referenced package files.`
  };
  const projectIssue = (issue) => ({
    code: issue.code,
    severity: issue.severity,
    ...(issue.roleId ? { roleId: issue.roleId } : {}),
    message: typeof messageByCode[issue.code] === "function" ? messageByCode[issue.code](issue) : messageByCode[issue.code] ?? issue.message
  });
  return { blockers: readiness.blockers.map(projectIssue), warnings: readiness.warnings.map(projectIssue), missingBindings: readiness.missingBindings };
}

export function createProjectReadinessUseCases({ getProject, readinessInspector }) {
  if (typeof getProject !== "function") throw new TypeError("Project readiness requires a Project query.");
  if (!readinessInspector || typeof readinessInspector.inspect !== "function") throw new TypeError("Project readiness requires a readiness inspector.");

  async function inspectTeamVersion(teamId, teamVersionId) {
    const version = await getProject(teamVersionId);
    if (version.projectType === "collaboration" || (version.teamRootId || version.teamId) !== teamId || version.teamVersionId !== teamVersionId) {
      throw new Error("TEAM_VERSION_NOT_FOUND: TeamVersion does not belong to this Team.");
    }
    const readiness = await readinessInspector.inspect(version.workdir);
    return {
      teamId,
      teamVersionId,
      versionStatus: version.teamVersionStatus,
      scope: "static_configuration",
      externalConnectivityChecked: false,
      canDryRun: readiness.canDryRun,
      ...publicIssues(readiness)
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
          projectStatus: project.projectStatus || project.status,
          mountedTeamVersionIds: [],
          canDryRun: readiness.canDryRun,
          ...publicIssues(readiness),
          teams: []
        };
      }
      const mountedTeams = Array.isArray(project.mountedTeams) ? project.mountedTeams : [];
      const blockers = [];
      if (mountedTeams.length !== 1) blockers.push({ code: "PROJECT_SINGLE_TEAM_REQUIRED", severity: "blocker", message: "Mount exactly one released TeamVersion before running this project." });
      const versions = await Promise.all(mountedTeams.map(async (team) => {
        try {
          const readiness = await inspectTeamVersion(team.teamId, team.teamVersionId);
          if (readiness.versionStatus !== "released") blockers.push({ code: "PROJECT_TEAM_VERSION_UNAVAILABLE", severity: "blocker", teamVersionId: team.teamVersionId, message: `TeamVersion ${team.teamVersionId} is not released.` });
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
