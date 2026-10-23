export function createDeliverableUseCases({ getProject, getRun, runResultStore, deliverableStore }) {
  if (typeof getProject !== "function" || typeof getRun !== "function") throw new TypeError("Deliverables require Project and Run queries.");
  if (typeof runResultStore?.readFinalOutputs !== "function" || typeof deliverableStore?.archive !== "function") throw new TypeError("Deliverables require result and snapshot stores.");
  return Object.freeze({
    async listProjectDeliverables(projectId) {
      const project = await getProject(projectId);
      if (project.projectType !== "collaboration") throw new Error("PROJECT_TYPE_INVALID: deliverables belong to collaboration projects.");
      return { projectId, deliverables: await deliverableStore.list(project) };
    },
    async archiveProjectRun(projectId, taskId, runId) {
      const project = await getProject(projectId);
      if (project.projectType !== "collaboration") throw new Error("PROJECT_TYPE_INVALID: deliverables belong to collaboration projects.");
      const run = await getRun(projectId, taskId, runId);
      if (run.state?.status !== "completed") throw new Error("DELIVERABLE_RUN_NOT_SUCCESSFUL: only a completed Run can be archived.");
      const result = await runResultStore.readFinalOutputs(run);
      if (!result || !Object.keys(result.finalOutputsByRoleId).length) throw new Error("DELIVERABLE_RESULT_UNAVAILABLE: this Run has no final outputs to archive.");
      const summary = result.finalOutputRoleOrder.flatMap((roleId) =>
        (result.finalOutputsByRoleId[roleId] || []).map((output) => `${roleId}: ${output.content || JSON.stringify(output.data || {})}`)
      ).join(" | ");
      const record = await deliverableStore.archive(project, {
        taskId: run.taskId,
        runId: run.runId,
        teamVersionId: run.teamVersionId,
        attemptNumber: run.attemptNumber,
        summary: summary.replace(/\s+/g, " ").slice(0, 500),
        contentFormat: "application/json"
      }, result);
      return { projectId, deliverable: record };
    },
    async getProjectDeliverableContent(projectId, deliverableId) {
      const project = await getProject(projectId);
      if (project.projectType !== "collaboration") throw new Error("PROJECT_TYPE_INVALID: deliverables belong to collaboration projects.");
      return { projectId, deliverableId, content: await deliverableStore.readContent(project, deliverableId) };
    }
  });
}
