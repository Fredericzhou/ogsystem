const terminalRunStatuses = new Set(["completed", "failed", "cancelled"]);

function assertRunId(runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(runId || ""))) throw new Error("runId is invalid.");
}

function findRunOwner(project, projectId, taskId, runId) {
  const task = (project.taskRecords || []).find((item) => item.taskId === taskId && !item.deletedAt);
  const currentRunId = task?.currentRunId || null;
  const runIds = Array.isArray(task?.runIds) ? task.runIds : currentRunId ? [currentRunId] : [];
  if (!task || (currentRunId !== runId && !runIds.includes(runId))) throw new Error("RUN_NOT_FOUND: run does not belong to this Task.");
  if (!task.teamVersionId) throw new Error("RUN_NOT_FOUND: Task has no fixed TeamVersion owner.");
  return {
    task,
    projectId,
    teamVersionId: task.teamVersionId,
    taskId: task.taskId,
    taskNumber: task.taskNumber,
    teamCoreDigest: task.teamCoreDigest,
    teamDigestVersion: task.teamDigestVersion,
    attemptNumber: Math.max(1, runIds.indexOf(runId) + 1)
  };
}

export function createRunQueryUseCases({ getProject, waitForActiveTaskWorker, runQueryStore }) {
  if (typeof getProject !== "function") throw new TypeError("Run query use cases require a Project query.");
  if (typeof waitForActiveTaskWorker !== "function") throw new TypeError("Run query use cases require a Task worker waiter.");
  if (!runQueryStore || typeof runQueryStore.readRunState !== "function"
    || typeof runQueryStore.readRunPlan !== "function"
    || typeof runQueryStore.readRunEvents !== "function"
    || typeof runQueryStore.readRunOwner !== "function") {
    throw new TypeError("Run query use cases require a Run query store.");
  }

  return Object.freeze({
    async getProjectRun(projectId, taskId, runId) {
      assertRunId(runId);
      const project = await getProject(projectId);
      const owner = findRunOwner(project, projectId, taskId, runId);
      const persistedOwner = await runQueryStore.readRunOwner(projectId, owner.taskId, runId);
      if (persistedOwner.taskNumber !== owner.taskNumber || persistedOwner.teamVersionId !== owner.teamVersionId
        || persistedOwner.attemptNumber !== owner.attemptNumber
        || (owner.teamCoreDigest && persistedOwner.teamCoreDigest !== owner.teamCoreDigest)
        || (Number.isInteger(owner.teamDigestVersion) && persistedOwner.teamDigestVersion !== owner.teamDigestVersion)) {
        throw new Error("RUN_NOT_FOUND: persisted Run owner does not match the Task.");
      }
      const state = await runQueryStore.readRunState(projectId, owner.taskId, runId);
      if (state?.attemptNumber !== undefined && state.attemptNumber !== owner.attemptNumber) {
        throw new Error("RUN_NOT_FOUND: Run state attempt does not match its owner.");
      }
      let latestProject = project;
      if (terminalRunStatuses.has(state.status)
        && await waitForActiveTaskWorker(projectId, owner.taskId)) {
        latestProject = await getProject(projectId);
      }
      const latestTask = (latestProject.taskRecords || []).find((item) => item.taskId === owner.taskId) || owner.task;
      const currentRunId = latestTask.currentRunId || null;
      const runIds = Array.isArray(latestTask.runIds) ? latestTask.runIds : currentRunId ? [currentRunId] : [];
      const plan = await runQueryStore.readRunPlan(projectId, owner.taskId, runId);
      const { projectId: _stateProjectId, ...publicState } = state || {};
      const { projectId: _planProjectId, ...publicPlan } = plan || {};
      const { projectId: _taskProjectId, ...publicTask } = latestTask;
      const publicPlanValue = Object.keys(publicPlan).length ? publicPlan : null;
      return {
        runKind: "project_task",
        owner: {
          kind: "project_task",
          projectId: owner.projectId,
          taskId: owner.taskId,
          taskNumber: owner.taskNumber,
          attemptNumber: owner.attemptNumber,
          teamVersionId: owner.teamVersionId,
          ...(persistedOwner.teamCoreDigest ? { teamCoreDigest: persistedOwner.teamCoreDigest } : {}),
          ...(Number.isInteger(persistedOwner.teamDigestVersion) ? { teamDigestVersion: persistedOwner.teamDigestVersion } : {})
        },
        teamVersionId: owner.teamVersionId,
        taskId: owner.taskId,
        runId,
        attemptNumber: owner.attemptNumber,
        isCurrent: currentRunId === runId,
        state: publicState,
        plan: publicPlanValue,
        task: publicTask
      };
    },

    async getProjectRunEvents(projectId, taskId, runId, options = {}) {
      assertRunId(runId);
      const project = await getProject(projectId);
      const owner = findRunOwner(project, projectId, taskId, runId);
      const persistedOwner = await runQueryStore.readRunOwner(projectId, owner.taskId, runId);
      if (persistedOwner.taskNumber !== owner.taskNumber || persistedOwner.teamVersionId !== owner.teamVersionId
        || persistedOwner.attemptNumber !== owner.attemptNumber
        || (owner.teamCoreDigest && persistedOwner.teamCoreDigest !== owner.teamCoreDigest)
        || (Number.isInteger(owner.teamDigestVersion) && persistedOwner.teamDigestVersion !== owner.teamDigestVersion)) {
        throw new Error("RUN_NOT_FOUND: persisted Run owner does not match the Task.");
      }
      return {
        runKind: "project_task",
        owner: {
          kind: "project_task",
          projectId: owner.projectId,
          taskId: owner.taskId,
          taskNumber: owner.taskNumber,
          attemptNumber: owner.attemptNumber,
          teamVersionId: owner.teamVersionId,
          ...(persistedOwner.teamCoreDigest ? { teamCoreDigest: persistedOwner.teamCoreDigest } : {}),
          ...(Number.isInteger(persistedOwner.teamDigestVersion) ? { teamDigestVersion: persistedOwner.teamDigestVersion } : {})
        },
        teamVersionId: owner.teamVersionId,
        taskId: owner.taskId,
        runId,
        ...(await runQueryStore.readRunEvents(projectId, owner.taskId, runId, options))
      };
    }
  });
}
