export function createRecentRunUseCases({ listProjects, runArtifactStore }) {
  if (typeof listProjects !== "function") throw new TypeError("Recent run use cases require a project query.");
  if (!runArtifactStore || typeof runArtifactStore.readRunArtifacts !== "function") {
    throw new TypeError("Recent run use cases require a Run artifact store.");
  }

  return Object.freeze({
    async listRecentProjectRuns(limit = 50) {
      const projects = await listProjects();
      const runs = [];
      for (const project of projects.filter((item) => item.projectType === "collaboration")) {
        for (const task of (project.taskRecords || []).filter((item) => !item.deletedAt && item.status !== "deleted")) {
          const runIds = task.runIds || (task.currentRunId ? [task.currentRunId] : []);
          const attempts = await Promise.all(runIds.map(async (runId, attemptIndex) => {
            const artifacts = await runArtifactStore.readRunArtifacts(project.projectId, task.taskId, runId).catch(() => ({}));
            const state = artifacts.state;
            const plan = artifacts.plan;
            return {
              runKind: "project_task",
              owner: {
                kind: "project_task",
                projectId: project.projectId,
                taskId: task.taskId,
                taskNumber: task.taskNumber,
                attemptNumber: state?.attemptNumber || attemptIndex + 1,
                teamVersionId: task.teamVersionId || null,
                ...(task.teamCoreDigest ? { teamCoreDigest: task.teamCoreDigest } : {})
              },
              runId,
              taskId: task.taskId,
              taskNumber: task.taskNumber,
              attemptNumber: state?.attemptNumber || attemptIndex + 1,
              isCurrent: task.currentRunId === runId,
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
      }
      const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 50, 200));
      return runs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, safeLimit);
    }
  });
}
