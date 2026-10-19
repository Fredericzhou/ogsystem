export function createProjectQueryUseCases({ projectStore, taskAttemptStore, waitForActiveTaskWorker, workspaceInspector }) {
  if (typeof projectStore?.getProject !== "function") throw new TypeError("Project queries require a Project store.");
  if (typeof taskAttemptStore?.readAttempt !== "function") throw new TypeError("Project queries require a Task attempt reader.");
  if (typeof waitForActiveTaskWorker !== "function") throw new TypeError("Project queries require a Task worker waiter.");

  async function projectWithTaskAttempts(projectId) {
    let project = await projectStore.getProject(projectId);
    if (typeof workspaceInspector === "function" && project.workdir) {
      project = { ...project, workspace: await workspaceInspector(project.workdir) };
    }
    if (project.projectType !== "collaboration") return project;
    const taskRecords = await Promise.all((project.taskRecords || []).map(async (task) => {
      const runIds = Array.isArray(task.runIds) ? task.runIds : [];
      const runtimeProjectId = task.runProjectId || task.teamVersionId || project.projectId;
      const attemptData = await Promise.all(runIds.map(async (runId, index) => {
        const attempt = await taskAttemptStore.readAttempt(runtimeProjectId, runId).catch(() => ({}));
        return { runId, index, attempt };
      }));
      const runAttempts = attemptData.map(({ runId, index, attempt }) => ({
        runId,
        attemptNumber: attempt.state?.attemptNumber || index + 1,
        isCurrent: task.currentRunId === runId,
        status: attempt.state?.status || "unknown",
        mode: attempt.plan?.executionPolicy?.mode || "unknown",
        error: attempt.state?.error || null,
        outputSummary: attempt.outputSummary || (task.currentRunId === runId ? task.outputSummary || "" : ""),
        updatedAt: attempt.state?.updatedAt || null
      }));
      const currentAttempt = attemptData.find(({ runId }) => runId === task.currentRunId)?.attempt;
      if (!currentAttempt) return { ...task, runAttempts };
      const state = currentAttempt.state;
      if (!state?.status) return { ...task, runAttempts };
      return {
        ...task,
        runAttempts,
        status: state.status,
        startedAt: task.startedAt || state.startedAt || null,
        completedAt: task.completedAt || state.finishedAt || null,
        lastError: state.error || task.lastError || null,
        updatedAt: state.updatedAt || task.updatedAt
      };
    }));
    return { ...project, taskRecords };
  }

  return Object.freeze({
    getProject: projectWithTaskAttempts,
    async getProjectTask(projectId, taskId) {
      let project = await projectWithTaskAttempts(projectId);
      let task = (project.taskRecords || []).find((item) => item.taskId === taskId && !item.deletedAt);
      if (!task) throw new Error("TASK_NOT_FOUND: task does not exist.");
      if (task.currentRunId && ["completed", "failed", "cancelled", "deleted"].includes(task.status)
        && await waitForActiveTaskWorker(projectId, taskId)) {
        project = await projectWithTaskAttempts(projectId);
        task = (project.taskRecords || []).find((item) => item.taskId === taskId && !item.deletedAt);
      }
      return task;
    }
  });
}
