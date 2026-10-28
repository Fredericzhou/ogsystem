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

function publicRunProjection(value) {
  const state = value?.state || value;
  return {
    runId: state?.runId,
    status: state?.status,
    ...(state?.startedAt ? { startedAt: state.startedAt } : {}),
    ...(state?.finishedAt ? { finishedAt: state.finishedAt } : {}),
    ...(state?.error ? { error: state.error } : {}),
    ...(value?.result !== undefined ? { result: value.result } : {})
  };
}

export function createProjectTaskTeamIrReviewContextResolver({ teamIrProjectRunExecutor, getTaskExecutionUseCases }) {
  if (typeof teamIrProjectRunExecutor?.getReviewContext !== "function" || typeof getTaskExecutionUseCases !== "function") {
    throw new TypeError("Team IR Review recovery bridge requires the durable executor and Task execution use cases.");
  }
  return async (input) => {
    const context = await teamIrProjectRunExecutor.getReviewContext(input);
    return {
      ...context,
      resumeTeamIrRun: ({ dispatchId }) => getTaskExecutionUseCases().resumeProjectTaskRun(
        input.project.projectId, input.task.taskId, input.runId,
        { reviewId: input.reviewId, lineage: context.lineage, loopRound: context.loopRound, dispatchId }
      )
    };
  };
}

export function createTeamIrReviewUseCases({ projectStore, resolveReviewContext }) {
  if (typeof projectStore?.getProject !== "function" || typeof resolveReviewContext !== "function") {
    throw new TypeError("Team IR Review use cases require Project lookup and a trusted Review runtime resolver.");
  }

  async function getContext(projectId, taskId, runId, reviewId, principal) {
    if (!principal || typeof principal.id !== "string" || !principal.id.trim()) {
      throw new Error("TEAM_REVIEW_PRINCIPAL_UNAVAILABLE: authenticated reviewer identity is unavailable.");
    }
    const project = await projectStore.getProject(projectId);
    const task = findOwnedTask(project, taskId, runId);
    const context = await resolveReviewContext({ project, task, runId, reviewId, principal });
    if (!context || !context.runtime || !context.plan || !context.runRecord) {
      throw new Error("TEAM_REVIEW_RUNTIME_UNAVAILABLE: durable Team Review runtime and frozen plan are unavailable.");
    }
    if (context.plan.compiledPlanDigest !== task.compiledPlanDigest
      || teamIRSemanticDigest(context.plan.team) !== task.teamIrSemanticDigest) {
      throw new Error("TEAM_REVIEW_PLAN_MISMATCH: Review runtime plan does not match the Task snapshot.");
    }
    const waitingReviews = context.runRecord.waitingReviews || (context.runRecord.waitingReview ? [context.runRecord.waitingReview] : []);
    const waitingReview = waitingReviews.find((item) => item.reviewId === reviewId);
    const decisionEvent = context.runRecord.events?.findLast((item) =>
      (item.type === "run.review.approved" || item.type === "run.review.rejected") && item.data?.reviewId === reviewId
    );
    const activeCheckpointMatches = context.runRecord.status === "waiting_human_review"
      && waitingReview?.reviewId === reviewId
      && waitingReview.lineage === context.lineage && waitingReview.loopRound === context.loopRound;
    const committedDecisionMatches = context.runRecord.status !== "waiting_human_review" && Boolean(decisionEvent);
    if (context.runRecord.runId !== runId || (!activeCheckpointMatches && !committedDecisionMatches)) {
      throw new Error("TEAM_REVIEW_CHECKPOINT_MISMATCH: current persisted Run checkpoint does not identify this Review activation.");
    }
    return { project, task, ...context };
  }

  return Object.freeze({
    async getProjectTaskTeamIrReview(projectId, taskId, runId, reviewId, principal) {
      const context = await getContext(projectId, taskId, runId, reviewId, principal);
      const review = await context.runtime.getReview(runId, reviewId, context.lineage, context.loopRound);
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

    async decideProjectTaskTeamIrReview(projectId, taskId, runId, reviewId, input = {}, principal) {
      const context = await getContext(projectId, taskId, runId, reviewId, principal);
      if (["approve", "reject"].includes(input.decision) && typeof context.resumeTeamIrRun !== "function") {
        throw new Error("TEAM_REVIEW_RESUME_UNAVAILABLE: trusted same-Run resume dispatch is unavailable; no decision was recorded.");
      }
      const review = await context.runtime.decideReview({
        runId,
        reviewId,
        lineage: context.lineage,
        loopRound: context.loopRound,
        revisionToken: input.revisionToken,
        idempotencyKey: input.idempotencyKey,
        reviewerId: principal.id,
        decision: input.decision,
        ...(Object.hasOwn(input, "feedback") ? { feedback: input.feedback } : {}),
        plan: context.plan
      });
      let resumedRun;
      if (["approved", "rejected"].includes(review.status)) {
        const dispatchId = `${runId}:team-review:${reviewId}:${context.lineage}:${context.loopRound ?? "run"}`;
        resumedRun = await context.resumeTeamIrRun({
          project: context.project,
          task: context.task,
          runId,
          reviewId,
          decision: review.decision,
          lineage: context.lineage,
          loopRound: context.loopRound,
          dispatchId,
          runRecord: context.runRecord,
          runtime: context.runtime,
          plan: context.plan
        });
      }
      return {
        projectId, taskId, runId, reviewId, status: review.status, decision: review.decision, revision: review.revision,
        ...(resumedRun === undefined ? {} : { resumedRun: publicRunProjection(resumedRun) })
      };
    }
  });
}
import { teamIRSemanticDigest } from "../../../dist/team-ir/index.js";

