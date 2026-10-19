export function createProjectReadinessUseCases({ getProject, readinessInspector }) {
  if (typeof getProject !== "function") throw new TypeError("Project readiness requires a Project query.");
  if (!readinessInspector || typeof readinessInspector.inspect !== "function") {
    throw new TypeError("Project readiness requires a readiness inspector.");
  }

  return Object.freeze({
    async getProjectReadiness(projectId) {
      const project = await getProject(projectId);
      const readiness = await readinessInspector.inspect(project.workdir);
      const messageByCode = {
        READINESS_CONTRACT_BUNDLE_UNREADABLE: "Handoff contract bundle cannot be inspected. Check the configured contract file.",
        READINESS_CONTRACT_PLAN_INVALID: "Handoff contract plan is invalid. Check the contract definitions and schemas.",
        READINESS_MODEL_CATALOG_INVALID: "Model catalog is invalid. Repair .ogs/model-catalog.json.",
        READINESS_ROLE_PACKAGE_INVALID: (issue) => `Role package "${issue.roleId}" is invalid. Check role.json and its referenced package files.`
      };
      const projectIssue = (issue) => ({
        code: issue.code,
        severity: issue.severity,
        ...(issue.roleId ? { roleId: issue.roleId } : {}),
        message: typeof messageByCode[issue.code] === "function"
          ? messageByCode[issue.code](issue)
          : messageByCode[issue.code] ?? issue.message
      });
      return {
        projectId,
        projectStatus: project.projectStatus,
        projectDigest: project.projectDigest,
        confirmedAt: project.confirmedAt,
        canDryRun: readiness.canDryRun,
        blockers: readiness.blockers.map(projectIssue),
        warnings: readiness.warnings.map(projectIssue),
        missingBindings: readiness.missingBindings
      };
    }
  });
}
