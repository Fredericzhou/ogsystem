import { compileTeamIr, MemoryTeamReviewStore, MemoryTeamRunStore, TeamReviewRuntime, TeamRuntime, teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
import { redactTeamIrSimulationText, redactTeamIrSimulationValue } from "../domain/team-ir-simulation-redaction.mjs";

export function createRuntimeTeamIrStudioSimulation({
  clock = {
    now: Date.now,
    sleep: (ms, signal) => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error("TEAM_RUNTIME_SLEEP_ABORTED"));
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("TEAM_RUNTIME_SLEEP_ABORTED"));
      }, { once: true });
    })
  },
  artifactStore
} = {}) {
  return Object.freeze({
    semanticDigest(teamIR) {
      return teamIRSemanticDigest(teamIR);
    },
    prepare(teamIR, closure) {
      const plan = compileTeamIr(teamIR, {
        packageDigests: closure.packageDigests,
        bindingDigests: closure.bindingDigests,
        adapterVersions: closure.adapterVersions,
        schemaDigests: closure.schemaDigests,
        packageSchemas: closure.packageSchemas
      });
      return { plan };
    },
    async execute({ plan, bindings, store = new MemoryTeamRunStore(), simulationId, teamIR, input, task, preferences, attachments, artifactStore: runArtifactStore, projectId, createRun = false }) {
      const reviews = plan.team.orchestration?.reviews || [];
      const reviewRuntime = reviews.length ? new TeamReviewRuntime({
        store: new MemoryTeamReviewStore(),
        now: clock.now,
        authorizeReviewer: async ({ reviewerId }) => reviewerId === "studio-sandbox-auto-approver"
      }) : undefined;
      const runtime = new TeamRuntime({ store, clock, bindings, artifactStore: runArtifactStore || artifactStore, reviewRuntime });
      if (createRun) {
        const runInput = {
          runId: simulationId,
          projectId: projectId || `studio-${simulationId}`,
          task: redactTeamIrSimulationText(task || "Team IR v2 Studio Simulation"),
          input,
          preferences,
          attachments
        };
        await runtime.createRun(plan, runInput);
      }
      let run = await runtime.executeRun(plan, simulationId);
      let reviewCount = 0;
      while (run.status === "waiting_human_review") {
        if (!reviewRuntime || !run.waitingReview || reviewCount >= 32) throw new Error("TEAM_IR_SIMULATION_REVIEW_LIMIT");
        const waiting = run.waitingReview;
        const review = await runtime.getReview(simulationId, waiting.reviewId, waiting.lineage, waiting.loopRound);
        if (review.status !== "pending") throw new Error("TEAM_IR_SIMULATION_REVIEW_STATE_INVALID");
        await runtime.decideReview({
          runId: simulationId,
          reviewId: waiting.reviewId,
          lineage: waiting.lineage,
          loopRound: waiting.loopRound,
          revisionToken: review.revisionToken,
          idempotencyKey: `studio-simulation:${simulationId}:${waiting.reviewId}:${waiting.loopRound ?? "run"}`,
          reviewerId: "studio-sandbox-auto-approver",
          decision: "approve",
          plan
        });
        run = await runtime.executeRun(plan, simulationId);
        reviewCount += 1;
      }
      return run;
    },
    redact(value) {
      return redactTeamIrSimulationValue(value);
    },
    redactText(value) {
      return redactTeamIrSimulationText(value);
    }
  });
}
