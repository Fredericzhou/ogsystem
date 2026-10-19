export function createRecentRunUseCases({ listProjects, runArtifactStore }) {
  if (typeof listProjects !== "function") throw new TypeError("Recent run use cases require a project query.");
  if (!runArtifactStore || typeof runArtifactStore.readRunArtifacts !== "function") {
    throw new TypeError("Recent run use cases require a Run artifact store.");
  }

  return Object.freeze({
    async listRecentProjectRuns(limit = 50) {
      const projects = await listProjects();
      const teams = new Map(projects.filter((project) => !project.teamProjectId)
        .map((project) => [project.teamVersionId || project.projectId, project]));
      const runs = [];
      for (const project of projects.filter((item) => item.teamProjectId || item.projectType === "collaboration")) {
        if (project.projectType === "collaboration" && Array.isArray(project.taskRecords) && project.taskRecords.length) {
          for (const task of project.taskRecords.filter((item) => !item.deletedAt && item.status !== "deleted")) {
            const runIds = task.runIds || (task.currentRunId ? [task.currentRunId] : []);
            const runtimeProjectId = task.runProjectId || task.teamVersionId;
            const attempts = await Promise.all(runIds.map(async (runId, attemptIndex) => {
              const artifacts = await runArtifactStore.readRunArtifacts(runtimeProjectId, runId).catch(() => ({}));
              const state = artifacts.state;
              const plan = artifacts.plan;
              return {
                runId,
                taskId: task.taskId,
                taskNumber: task.taskNumber,
                attemptNumber: state?.attemptNumber || attemptIndex + 1,
                isCurrent: task.currentRunId === runId,
                collaborationProjectId: project.projectId,
                runtimeProjectId,
                projectName: project.name,
                workspaceKey: project.workspaceKey || "",
                teamId: task.teamId || null,
                teamVersionId: task.teamVersionId || null,
                teamName: task.teamName || "未选择团队",
                teamVersionNumber: task.teamVersionNumber || 1,
                input: task.input || "",
                status: state?.status || (task.currentRunId === runId ? task.status : "unknown"),
                mode: plan?.executionPolicy?.mode || "unknown",
                outputSummary: task.currentRunId === runId ? task.outputSummary || "" : "",
                updatedAt: state?.updatedAt || task.updatedAt,
                durationMs: state?.durationMs || 0,
                pendingReviewCount: state?.pendingReviewCount || 0
              };
            }));
            runs.push(...attempts);
          }
          continue;
        }
        const team = teams.get(project.teamVersionId) || teams.get(project.teamProjectId);
        const ordered = [...(project.runs || [])].sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
        ordered.forEach((run, index) => runs.push({
          runId: run.runId,
          collaborationProjectId: null,
          taskId: null,
          runtimeProjectId: project.projectId,
          projectName: project.name,
          workspaceKey: project.workspaceKey || "",
          teamId: project.teamId || team?.teamId || project.teamProjectId,
          teamVersionId: project.teamVersionId || team?.teamVersionId || project.teamProjectId,
          teamName: project.teamName || team?.teamName || team?.name || "团队",
          teamVersionNumber: project.teamVersionNumber || team?.teamVersionNumber || 1,
          taskNumber: null,
          input: run.prompt || run.input || "",
          status: run.status,
          mode: run.isSimulation ? "dry-run" : "sandbox",
          updatedAt: run.updatedAt,
          durationMs: run.durationMs || 0,
          pendingReviewCount: run.pendingReviewCount || 0
        }));
      }
      const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 50, 200));
      return runs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, safeLimit);
    }
  });
}
