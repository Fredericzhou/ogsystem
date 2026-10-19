export function createRunResultUseCases({ getRun, runResultStore }) {
  if (typeof getRun !== "function") throw new TypeError("Run result use cases require a Run query.");
  if (!runResultStore || typeof runResultStore.readFinalOutput !== "function") {
    throw new TypeError("Run result use cases require a result store.");
  }

  return Object.freeze({
    async getProjectRunResult(projectId, runId) {
      const run = await getRun(projectId, runId);
      const finalOutput = await runResultStore.readFinalOutput(run);
      const identity = {
        collaborationProjectId: projectId,
        runtimeProjectId: run.runtimeProjectId,
        teamVersionId: run.teamVersionId,
        taskId: run.taskId,
        runId,
        attemptNumber: run.attemptNumber
      };
      if (typeof finalOutput !== "string" || !finalOutput.trim()) {
        return { ...identity, available: false, result: null };
      }
      return { ...identity, available: true, result: { finalOutput } };
    }
  });
}
