import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { compileTeamIr, FileTeamArtifactStore, FileTeamReviewStore, FileTeamRunStore, TeamReviewRuntime, TeamRuntime, teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
import { assertSafeEvidencePath } from "./safe-evidence-path.mjs";

function assertRunId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value || ""))) throw new Error("TEAM_RUN_ID_INVALID");
}

function defaultSleep(ms, signal) {
  return new Promise((resolveSleep, reject) => {
    if (signal?.aborted) return reject(new Error("TEAM_RUNTIME_SLEEP_ABORTED"));
    const timer = setTimeout(resolveSleep, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("TEAM_RUNTIME_SLEEP_ABORTED"));
    }, { once: true });
  });
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code !== "ESRCH"; }
}

async function acquireRunResumeLock(projectRoot, runRelative, stateDirectory, runId, waitMs = 10000) {
  const segments = [...runRelative, "team-ir-v2-state", `review-resume-${runId}.lock`];
  const lockPath = resolve(stateDirectory, `review-resume-${runId}.lock`);
  const deadline = Date.now() + waitMs;
  while (true) {
    await assertSafeEvidencePath(projectRoot, segments, { kind: "directory", allowMissingFinal: true, label: "Team IR v2 Review recovery lock" });
    try {
      await mkdir(lockPath);
      await assertSafeEvidencePath(projectRoot, segments, { kind: "directory", label: "Team IR v2 Review recovery lock" });
      await writeFile(resolve(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, host: hostname(), createdAt: Date.now() }), { encoding: "utf8", flag: "wx" });
      return async () => rm(lockPath, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      await assertSafeEvidencePath(projectRoot, segments, { kind: "directory", label: "Team IR v2 Review recovery lock" });
      let owner;
      try {
        await assertSafeEvidencePath(projectRoot, [...segments, "owner.json"], { kind: "file", label: "Team IR v2 Review recovery lock owner" });
        owner = JSON.parse(await readFile(resolve(lockPath, "owner.json"), "utf8"));
      } catch (readError) {
        if (readError?.code !== "ENOENT") throw readError;
      }
      if (owner?.host === hostname() && Number.isInteger(owner.pid) && !processIsAlive(owner.pid)) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new Error("TEAM_REVIEW_RESUME_BUSY: another process owns the same-Run recovery lock.");
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
  }
}

export function createRuntimeTeamIrProjectRunExecutor({ teamStore, teamIrStore, resolveReleaseClosure, resolveBindings, authorizeTeamIrReviewer, artifactStoreFactory, clock = { now: Date.now, sleep: defaultSleep } }) {
  if (typeof teamStore?.getTeamVersion !== "function" || typeof teamIrStore?.read !== "function") {
    throw new TypeError("Team IR Project Run executor requires TeamVersion and Team IR stores.");
  }

  function assertResolversAvailable() {
    if (typeof resolveReleaseClosure !== "function" || typeof resolveBindings !== "function") {
      throw new Error("TEAM_IR_V2_EXECUTOR_UNAVAILABLE: trusted frozen dependency and model Binding resolvers are not configured.");
    }
  }

  async function prepare(project, options, principal) {
      const { runId, teamVersionId, taskId, taskNumber, attemptNumber, teamIrSemanticDigest, compiledPlanDigest } = options;
      assertRunId(runId);
      if (options.mode !== "sandbox") throw new Error("TEAM_IR_V2_SANDBOX_REQUIRED: Team IR Project Runs require explicit sandbox execution mode.");
      assertResolversAvailable();
      if (!teamVersionId || !taskId || !/^[a-f0-9]{64}$/i.test(String(teamIrSemanticDigest || ""))
        || !/^[a-f0-9]{64}$/i.test(String(compiledPlanDigest || ""))) {
        throw new Error("TEAM_IR_V2_PLAN_BINDING_INVALID: Task must provide its frozen TeamVersion and digests.");
      }
      const team = await teamStore.getTeamVersion(teamVersionId);
      if (!team || team.teamIrSemanticDigest !== teamIrSemanticDigest || team.compiledPlanDigest !== compiledPlanDigest) {
        throw new Error("TASK_TEAM_IR_DIGEST_MISMATCH: frozen Team IR snapshot changed after Task creation.");
      }
      const stored = await teamIrStore.read({ workdir: team.workdir });
      if (!stored.teamIR || stored.semanticDigest !== teamIrSemanticDigest || teamIRSemanticDigest(stored.teamIR) !== teamIrSemanticDigest) {
        throw new Error("TEAM_IR_SNAPSHOT_MISMATCH: stored Team IR does not match the Task snapshot.");
      }
      const runInputSchema = stored.teamIR.runInput?.dataSchema;
      const requestSchema = runInputSchema?.properties?.request;
      const unsupportedRunFields = (runInputSchema?.required || []).filter((field) => field !== "request");
      const hasRequiredPreferences = (stored.teamIR.runInput?.preferencesSchema?.required || []).length > 0;
      if (!requestSchema || requestSchema.type !== "string" || unsupportedRunFields.length > 0
        || hasRequiredPreferences) {
        throw new Error("TEAM_IR_TASK_INPUT_UNSUPPORTED: Project Task currently supplies a request string, optional preferences, and registered Artifact slot references.");
      }
      const closure = await resolveReleaseClosure({ team, teamIR: stored.teamIR });
      if (closure?.complete !== true || !closure.packageDigests || !closure.bindingDigests || !closure.adapterVersions) {
        throw new Error("TEAM_IR_RELEASE_CLOSURE_INCOMPLETE: the frozen execution closure is unavailable.");
      }
      const plan = compileTeamIr(stored.teamIR, {
        packageDigests: closure.packageDigests,
        bindingDigests: closure.bindingDigests,
        adapterVersions: closure.adapterVersions,
        schemaDigests: closure.schemaDigests,
        packageSchemas: closure.packageSchemas
      });
      if (plan.compiledPlanDigest !== compiledPlanDigest) throw new Error("TEAM_IR_COMPILED_DIGEST_MISMATCH: current frozen closure does not match this Task.");
      const projectRoot = resolve(project.workdir);
      const artifactStore = typeof artifactStoreFactory === "function"
        ? await artifactStoreFactory({ project, projectRoot, runId })
        : new FileTeamArtifactStore(join(projectRoot, ".ogs", "team-artifacts"));
      await artifactStore.validateRunInputAttachments({
        team: stored.teamIR,
        projectId: project.projectId,
        attachments: options.attachments || {}
      });
      const bindings = await resolveBindings({ team, teamIR: stored.teamIR, closure, project, runId });
      if (!bindings || typeof bindings !== "object") throw new Error("TEAM_BINDING_RESOLVER_UNAVAILABLE: no executable Team Bindings were resolved.");

      const runRelative = [".ogs", "runs", runId];
      const runDirectory = await assertSafeEvidencePath(projectRoot, runRelative, { kind: "directory", label: "Project Run evidence" });
      const stateDirectory = resolve(runDirectory, "team-ir-v2-state");
      try {
        await mkdir(stateDirectory);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      await assertSafeEvidencePath(projectRoot, [...runRelative, "team-ir-v2-state"], { kind: "directory", label: "Team IR v2 Run state" });
      const store = new FileTeamRunStore(stateDirectory);
      const reviewDefinitions = stored.teamIR.orchestration?.reviews || [];
      let reviewRuntime;
      if (reviewDefinitions.length > 0) {
        const reviewDirectory = join(stateDirectory, "reviews");
        await mkdir(reviewDirectory, { recursive: true });
        await assertSafeEvidencePath(projectRoot, [...runRelative, "team-ir-v2-state", "reviews"], { kind: "directory", label: "Team IR v2 Review state" });
        reviewRuntime = new TeamReviewRuntime({
          store: new FileTeamReviewStore(reviewDirectory),
          now: clock.now,
          authorizeReviewer: async (authorization) => Boolean(
            principal && principal.id === authorization.reviewerId
            && typeof authorizeTeamIrReviewer === "function"
            && await authorizeTeamIrReviewer({ ...authorization, project, taskId, team, teamIR: stored.teamIR, principal })
          )
        });
      }
      const runtime = new TeamRuntime({ store, clock, bindings, artifactStore, reviewRuntime });
      return { projectRoot, runRelative, stateDirectory, store, runtime, artifactStore, plan, team, teamIR: stored.teamIR, runId, taskId, taskNumber, attemptNumber, teamVersionId, teamIrSemanticDigest, compiledPlanDigest };
  }

  async function execute(project, options) {
      const prepared = await prepare(project, options);
      const input = { request: String(options.prompt || "") };
      await prepared.runtime.createRun(prepared.plan, { runId: options.runId, projectId: project.projectId, task: String(options.prompt || ""), input, attachments: options.attachments || {} });
      await prepared.runtime.executeRun(prepared.plan, options.runId);
      const record = await prepared.store.load(options.runId);
      if (!record) throw new Error("TEAM_RUN_CHECKPOINT_MISSING: Runtime did not persist its terminal checkpoint.");
      return {
        state: {
          status: record.status,
          runId: options.runId,
          attemptNumber: options.attemptNumber,
          teamVersionId: options.teamVersionId,
          teamIrSemanticDigest: options.teamIrSemanticDigest,
          compiledPlanDigest: options.compiledPlanDigest,
          startedAt: new Date(record.createdAt).toISOString(),
          finishedAt: new Date(record.updatedAt).toISOString(),
          error: record.events.findLast((item) => item.type === "run.failing")?.data?.code
        },
        result: record.result === undefined ? null : { teamResult: record.result },
        teamRun: record,
        owner: { kind: "project_task", projectId: project.projectId, taskId: options.taskId, taskNumber: options.taskNumber, attemptNumber: options.attemptNumber, teamVersionId: options.teamVersionId }
      };
  }

  async function resume(project, options, principal) {
    const prepared = await prepare(project, options, principal);
    const current = await prepared.store.load(options.runId);
    if (!current) throw new Error("TEAM_REVIEW_RUN_NOT_FOUND: persisted Team Run checkpoint is unavailable.");
    const waitingReviews = current.waitingReviews || (current.waitingReview ? [current.waitingReview] : []);
    const activeReview = waitingReviews.find((item) => item.reviewId === options.reviewId);
    const lineage = options.lineage || activeReview?.lineage || current.waitingReview?.lineage || "run";
    const loopRound = options.loopRound ?? activeReview?.loopRound ?? current.waitingReview?.loopRound;
    const expectedDispatchId = `${options.runId}:team-review:${options.reviewId}:${lineage}:${loopRound ?? "run"}`;
    const decisionAlreadyApplied = current.events.some((item) =>
      item.type === "run.review.approved" || item.type === "run.review.rejected"
        ? item.data?.reviewId === options.reviewId && item.data?.loopRound === loopRound
        : false
    );
    if (options.dispatchId !== expectedDispatchId || (!activeReview && !decisionAlreadyApplied)) {
      throw new Error("TEAM_REVIEW_DISPATCH_ID_INVALID: Review resume must match a persisted activation and stable dispatch ID.");
    }
    if (activeReview && (activeReview.lineage !== lineage || activeReview.loopRound !== loopRound)) {
      throw new Error("TEAM_REVIEW_CHECKPOINT_MISMATCH: persisted Review activation changed before resume.");
    }
    const release = await acquireRunResumeLock(prepared.projectRoot, prepared.runRelative, prepared.stateDirectory, options.runId);
    let record;
    try {
      await prepared.runtime.executeRun(prepared.plan, options.runId);
      record = await prepared.store.load(options.runId);
      if (!record) throw new Error("TEAM_RUN_CHECKPOINT_MISSING: Runtime did not persist its resumed checkpoint.");
    } finally {
      await release();
    }
    return {
      state: {
        status: record.status,
        runId: options.runId,
        attemptNumber: options.attemptNumber,
        teamVersionId: options.teamVersionId,
        teamIrSemanticDigest: options.teamIrSemanticDigest,
        compiledPlanDigest: options.compiledPlanDigest,
        startedAt: new Date(record.createdAt).toISOString(),
        finishedAt: new Date(record.updatedAt).toISOString(),
        error: record.events.findLast((item) => item.type === "run.failing")?.data?.code
      },
      result: record.result === undefined ? null : { teamResult: record.result },
      teamRun: record,
      owner: { kind: "project_task", projectId: project.projectId, taskId: options.taskId, taskNumber: options.taskNumber, attemptNumber: options.attemptNumber, teamVersionId: options.teamVersionId }
    };
  }

  async function control(project, options, action) {
    if (action !== "cancel") {
      throw new Error(`TEAM_IR_TASK_CONTROL_UNSUPPORTED: ${action} is not supported for Team IR v2 Runs.`);
    }
    const prepared = await prepare(project, options);
    const record = await prepared.runtime.cancel(options.runId);
    return {
      state: {
        status: record.status,
        runId: options.runId,
        attemptNumber: options.attemptNumber,
        teamVersionId: options.teamVersionId,
        teamIrSemanticDigest: options.teamIrSemanticDigest,
        compiledPlanDigest: options.compiledPlanDigest
      },
      teamRun: record,
      owner: { kind: "project_task", projectId: project.projectId, taskId: options.taskId, attemptNumber: options.attemptNumber, teamVersionId: options.teamVersionId }
    };
  }

  return Object.freeze({
    assertAvailable: assertResolversAvailable,
    execute,
    resume,
    control,
    async getReviewContext({ project, task, runId, reviewId, principal }) {
      const prepared = await prepare(project, {
        runId,
        teamVersionId: task.teamVersionId,
        taskId: task.taskId,
        taskNumber: task.taskNumber,
        attemptNumber: task.runIds?.indexOf(runId) + 1,
        teamIrSemanticDigest: task.teamIrSemanticDigest,
        compiledPlanDigest: task.compiledPlanDigest,
        attachments: task.runInputAttachments || {},
        mode: "sandbox"
      }, principal);
      const runRecord = await prepared.store.load(runId);
      const decisionEvent = runRecord?.events.findLast((item) =>
        (item.type === "run.review.approved" || item.type === "run.review.rejected") && item.data?.reviewId === reviewId
      );
      const waitingReviews = runRecord?.waitingReviews || (runRecord?.waitingReview ? [runRecord.waitingReview] : []);
      const waitingReview = waitingReviews.find((item) => item.reviewId === reviewId);
      const activeReviewMatches = runRecord?.status === "waiting_human_review" && Boolean(waitingReview);
      const committedDecisionMatches = Boolean(decisionEvent);
      if (!runRecord || runRecord.runId !== runId || (!activeReviewMatches && !committedDecisionMatches)) {
        throw new Error("TEAM_REVIEW_CHECKPOINT_MISMATCH: current persisted Run checkpoint does not identify this Review activation.");
      }
      const lineage = waitingReview?.lineage || decisionEvent?.data?.lineage || "run";
      const loopRound = waitingReview?.loopRound ?? decisionEvent?.data?.loopRound;
      return {
        runtime: prepared.runtime,
        plan: prepared.plan,
        runRecord,
        lineage,
        loopRound,
        resumeTeamIrRun: ({ dispatchId }) => {
          if (dispatchId !== `${runId}:team-review:${reviewId}:${lineage}:${loopRound ?? "run"}`) {
            throw new Error("TEAM_REVIEW_DISPATCH_ID_INVALID: Review resume dispatch ID is not stable for this activation.");
          }
          return resume(project, {
            runId,
            teamVersionId: task.teamVersionId,
            taskId: task.taskId,
            taskNumber: task.taskNumber,
            attemptNumber: task.runIds?.indexOf(runId) + 1,
            teamIrSemanticDigest: task.teamIrSemanticDigest,
            compiledPlanDigest: task.compiledPlanDigest,
            mode: "sandbox",
            attachments: task.runInputAttachments || {},
            prompt: task.input,
            reviewId,
            lineage,
            loopRound,
            dispatchId
          }, principal);
        }
      };
    }
  });
}
