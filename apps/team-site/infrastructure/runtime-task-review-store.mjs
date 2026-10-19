export function createRuntimeTaskReviewStore({ listHumanReviews, writeHumanReviewDecision, createPrincipal, getProject }) {
  if (typeof listHumanReviews !== "function" || typeof writeHumanReviewDecision !== "function"
    || typeof createPrincipal !== "function" || typeof getProject !== "function") {
    throw new TypeError("Runtime Task review store requires review readers, writers, principal creation, and Project lookup.");
  }
  return Object.freeze({
    async listReviews(project, task) {
      const runProject = task.runProjectId ? await getProject(task.runProjectId) : project;
      return listHumanReviews(runProject.workdir, task.currentRunId).catch(() => ({ reviews: [] }));
    },
    async decideReview(project, task, selectedReviewId, decision, comment) {
      const runProject = task.runProjectId ? await getProject(task.runProjectId) : project;
      return writeHumanReviewDecision({
        workdir: runProject.workdir,
        runId: task.currentRunId,
        reviewId: selectedReviewId,
        decision,
        comment,
        principal: createPrincipal(),
        ...(decision === "terminate" ? { scope: "run" } : {})
      });
    }
  });
}
