function publicOutput(entry) {
  const availability = entry.status === "published"
    ? "available"
    : entry.status === "failed" ? "unavailable" : "processing";
  return {
    taskId: entry.taskId,
    runId: entry.runId,
    attemptNumber: entry.attemptNumber,
    availability,
    commit: entry.releaseCommit,
    digest: entry.outputDigest || null,
    createdAt: entry.createdAt
  };
}

export function createTaskRunOutputUseCases({ getProject, outputStore }) {
  async function getProjectOutput(projectId, taskId, runId) {
    const project = await getProject(projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND: Project does not exist.");
    const entry = (await outputStore.list(project)).find((item) => item.taskId === taskId && item.runId === runId);
    if (!entry) throw new Error("COLLABORATION_OUTPUT_NOT_FOUND: Run has no collaboration output.");
    return { project, entry };
  }

  function assertAvailable(entry) {
    if (entry.status !== "published") throw new Error("COLLABORATION_OUTPUT_NOT_AVAILABLE: Run output is not ready to read.");
  }

  return Object.freeze({
    async listProjectCollaborationOutputs(projectId) {
      const project = await getProject(projectId);
      if (!project) throw new Error("PROJECT_NOT_FOUND: Project does not exist.");
      const outputs = (await outputStore.list(project)).map(publicOutput);
      return { outputs };
    },
    async getProjectRunOutput(projectId, taskId, runId) {
      const { project, entry } = await getProjectOutput(projectId, taskId, runId);
      assertAvailable(entry);
      const result = await outputStore.read(project, entry.releaseId);
      return { ...publicOutput(entry), files: result.manifest.files };
    },
    async listProjectRunOutputFiles(projectId, taskId, runId) {
      const { project, entry } = await getProjectOutput(projectId, taskId, runId);
      assertAvailable(entry);
      const result = await outputStore.listFiles(project, entry.releaseId);
      return { taskId, runId, files: result.files };
    },
    async readProjectRunOutputFile(projectId, taskId, runId, filePath, options) {
      const { project, entry } = await getProjectOutput(projectId, taskId, runId);
      assertAvailable(entry);
      const result = await outputStore.readFile(project, entry.releaseId, filePath, options);
      const { releaseId: _releaseId, ...publicResult } = result;
      return { taskId, runId, ...publicResult };
    }
  });
}
