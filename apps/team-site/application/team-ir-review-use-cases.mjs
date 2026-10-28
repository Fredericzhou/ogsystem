function findOwnedTask(project, taskId, runId) {
  const task = (project?.taskRecords || []).find((item) => item.taskId === taskId && !item.deletedAt);
  if (!task || task.currentRunId !== runId || !(task.runIds || []).includes(runId)) {
    throw new Error("TEAM_REVIEW_RUN_NOT_FOUND: Run does not belong to this active Project Task.");
  }
  if (!task.teamIrSemanticDigest || !task.compiledPlanDigest) {
    throw new Error("TEAM_REVIEW_V2_REQUIRED: Run is not bound to a frozen Team IR v2 plan.");
  }
  return task;
}

export function createTeamIrReviewUseCases({ projectStore, resolveReviewContext }) {
  if (typeof projectStore?.getProject !== "function" || typeof resolveReviewContext !== "function") {
    throw new TypeError("Team IR Review use cases require Project lookup and a trusted Review runtime resolver.");
  }

  async function getContext(projectId, taskId, runId, reviewId) {
    const project = await projectStore.getProject(projectId);
    const task = findOwnedTask(project, taskId, runId);
    const context = await resolveReviewContext({ project, task, runId, reviewId });
    if (!context || !context.runtime || !context.plan || !context.runRecord) {
      throw new Error("TEAM_REVIEW_RUNTIME_UNAVAILABLE: durable Team Review runtime and frozen plan are unavailable.");
    }
    if (context.plan.compiledPlanDigest !== task.compiledPlanDigest
      || teamIRSemanticDigest(context.plan.team) !== task.teamIrSemanticDigest) {
      throw new Error("TEAM_REVIEW_PLAN_MISMATCH: Review runtime plan does not match the Task snapshot.");
    }
    const waitingReview = context.runRecord.waitingReview;
    if (context.runRecord.runId !== runId || context.runRecord.status !== "waiting_human_review"
      || !waitingReview || waitingReview.reviewId !== reviewId
      || waitingReview.lineage !== context.lineage || waitingReview.loopRound !== context.loopRound) {
      throw new Error("TEAM_REVIEW_CHECKPOINT_MISMATCH: current persisted Run checkpoint does not identify this Review activation.");
    }
    return { project, task, ...context };
  }

  return Object.freeze({
    async getProjectTaskTeamIrReview(projectId, taskId, runId, reviewId) {
      const context = await getContext(projectId, taskId, runId, reviewId);
      const review = await context.runtime.getReview(runId, reviewId, context.lineage, context.loopRound);
      if (review.status !== "pending") throw new Error(`TEAM_REVIEW_NOT_PENDING: Review is ${review.status}.`);
      return {
        projectId,
        taskId,
        runId,
        reviewId,
        lineage: context.lineage,
        ...(context.loopRound === undefined ? {} : { loopRound: context.loopRound }),
        revision: review.revision,
        revisionToken: review.revisionToken,
        activatedAt: review.activatedAt,
        deadlineAt: review.deadlineAt,
        status: review.status
      };
    },

    async decideProjectTaskTeamIrReview(projectId, taskId, runId, reviewId, input = {}) {
      const context = await getContext(projectId, taskId, runId, reviewId);
      if (!context.reviewerId) throw new Error("TEAM_REVIEW_PRINCIPAL_UNAVAILABLE: authenticated reviewer identity is unavailable.");
      const review = await context.runtime.decideReview({
        runId,
        reviewId,
        lineage: context.lineage,
        loopRound: context.loopRound,
        revisionToken: input.revisionToken,
        idempotencyKey: input.idempotencyKey,
        reviewerId: context.reviewerId,
        decision: input.decision,
        ...(Object.hasOwn(input, "feedback") ? { feedback: input.feedback } : {}),
        plan: context.plan
      });
      return { projectId, taskId, runId, reviewId, status: review.status, decision: review.decision, revision: review.revision };
    }
  });
}
import { teamIRSemanticDigest } from "../../../dist/team-ir/index.js";

