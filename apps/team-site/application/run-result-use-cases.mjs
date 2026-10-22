export function createRunResultUseCases({ getRun, runResultStore }) {
  if (typeof getRun !== "function") throw new TypeError("Run result use cases require a Run query.");
  if (!runResultStore || typeof runResultStore.readFinalOutput !== "function") {
    throw new TypeError("Run result use cases require a result store.");
  }

  return Object.freeze({
    async getProjectRunResult(projectId, taskId, runId) {
      const run = await getRun(projectId, taskId, runId);
      const finalOutput = await runResultStore.readFinalOutput(run);
      const identity = {
        runKind: "project_task",
        runId,
        owner: {
          kind: "project_task",
          projectId,
          taskId: run.taskId,
          taskNumber: run.owner?.taskNumber,
          attemptNumber: run.attemptNumber,
          teamVersionId: run.teamVersionId
        },
        teamVersionId: run.teamVersionId,
        taskId: run.taskId,
        attemptNumber: run.attemptNumber
      };
      if (typeof finalOutput !== "string" || !finalOutput.trim()) {
        return { ...identity, available: false, result: null };
      }
      return { ...identity, available: true, result: { finalOutput } };
    }
  });
}
