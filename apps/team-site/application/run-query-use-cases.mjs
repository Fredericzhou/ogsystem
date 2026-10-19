const terminalRunStatuses = new Set(["completed", "failed", "cancelled"]);

function assertRunId(runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(runId || ""))) throw new Error("runId is invalid.");
}

function findRunOwner(project, projectId, runId) {
  const task = (project.taskRecords || []).find((item) => {
    const currentRunId = item.currentRunId || null;
    const runIds = Array.isArray(item.runIds) ? item.runIds : currentRunId ? [currentRunId] : [];
    return !item.deletedAt && (currentRunId === runId || runIds.includes(runId));
  });
  if (!task) throw new Error("RUN_NOT_FOUND: run does not belong to this project.");
  return {
    task,
    collaborationProjectId: projectId,
    runtimeProjectId: task.runProjectId || task.teamVersionId || projectId,
    teamVersionId: task.teamVersionId,
    taskId: task.taskId
  };
}

export function createRunQueryUseCases({ getProject, waitForActiveTaskWorker, runQueryStore }) {
  if (typeof getProject !== "function") throw new TypeError("Run query use cases require a Project query.");
  if (typeof waitForActiveTaskWorker !== "function") throw new TypeError("Run query use cases require a Task worker waiter.");
  if (!runQueryStore || typeof runQueryStore.readRunState !== "function"
    || typeof runQueryStore.readRunPlan !== "function"
    || typeof runQueryStore.readRunEvents !== "function") {
    throw new TypeError("Run query use cases require a Run query store.");
  }

  return Object.freeze({
    async getProjectRun(projectId, runId) {
      assertRunId(runId);
      const project = await getProject(projectId);
      const owner = findRunOwner(project, projectId, runId);
      const state = await runQueryStore.readRunState(owner.runtimeProjectId, runId);
      let latestProject = project;
      if (terminalRunStatuses.has(state.status)
        && await waitForActiveTaskWorker(projectId, owner.taskId)) {
        latestProject = await getProject(projectId);
      }
      const latestTask = (latestProject.taskRecords || []).find((item) => item.taskId === owner.taskId) || owner.task;
      const currentRunId = latestTask.currentRunId || null;
      const runIds = Array.isArray(latestTask.runIds) ? latestTask.runIds : currentRunId ? [currentRunId] : [];
      const plan = await runQueryStore.readRunPlan(owner.runtimeProjectId, runId);
      const { projectId: _stateProjectId, ...publicState } = state || {};
      const { projectId: _planProjectId, ...publicPlan } = plan || {};
      const { projectId: _taskProjectId, ...publicTask } = latestTask;
      const publicPlanValue = Object.keys(publicPlan).length ? publicPlan : null;
      return {
        collaborationProjectId: projectId,
        runtimeProjectId: owner.runtimeProjectId,
        teamVersionId: owner.teamVersionId,
        taskId: owner.taskId,
        runId,
        attemptNumber: state.attemptNumber || runIds.indexOf(runId) + 1,
        isCurrent: currentRunId === runId,
        state: publicState,
        plan: publicPlanValue,
        task: publicTask
      };
    },

    async getProjectRunEvents(projectId, runId, options = {}) {
      assertRunId(runId);
      const project = await getProject(projectId);
      const owner = findRunOwner(project, projectId, runId);
      return {
        collaborationProjectId: projectId,
        runtimeProjectId: owner.runtimeProjectId,
        teamVersionId: owner.teamVersionId,
        taskId: owner.taskId,
        runId,
        ...(await runQueryStore.readRunEvents(owner.runtimeProjectId, runId, options))
      };
    }
  });
}
