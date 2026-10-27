import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { compileTeamIr, FileTeamRunStore, TeamRuntime, teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
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

export function createRuntimeTeamIrProjectRunExecutor({ teamStore, teamIrStore, resolveReleaseClosure, resolveBindings, clock = { now: Date.now, sleep: defaultSleep } }) {
  if (typeof teamStore?.getTeamVersion !== "function" || typeof teamIrStore?.read !== "function") {
    throw new TypeError("Team IR Project Run executor requires TeamVersion and Team IR stores.");
  }

  function assertResolversAvailable() {
    if (typeof resolveReleaseClosure !== "function" || typeof resolveBindings !== "function") {
      throw new Error("TEAM_IR_V2_EXECUTOR_UNAVAILABLE: trusted frozen dependency and model Binding resolvers are not configured.");
    }
  }

  return Object.freeze({
    assertAvailable: assertResolversAvailable,
    async execute(project, options) {
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
      const hasRequiredAttachments = Object.values(stored.teamIR.runInput?.artifactSlots || {}).some((slot) => slot?.required === true);
      if (!requestSchema || requestSchema.type !== "string" || unsupportedRunFields.length > 0
        || hasRequiredPreferences || hasRequiredAttachments) {
        throw new Error("TEAM_IR_TASK_INPUT_UNSUPPORTED: Project Task currently supplies only a request string and cannot satisfy this Run input contract.");
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
      const bindings = await resolveBindings({ team, teamIR: stored.teamIR, closure, project, runId });
      if (!bindings || typeof bindings !== "object") throw new Error("TEAM_BINDING_RESOLVER_UNAVAILABLE: no executable Team Bindings were resolved.");

      const projectRoot = resolve(project.workdir);
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
      const runtime = new TeamRuntime({ store, clock, bindings });
      const input = { request: String(options.prompt || "") };
      await runtime.createRun(plan, { runId, task: String(options.prompt || ""), input });
      const record = await runtime.executeRun(plan, runId);
      return {
        state: {
          status: record.status,
          runId,
          attemptNumber,
          teamVersionId,
          teamIrSemanticDigest,
          compiledPlanDigest,
          startedAt: new Date(record.createdAt).toISOString(),
          finishedAt: new Date(record.updatedAt).toISOString(),
          error: record.events.findLast((item) => item.type === "run.failing")?.data?.code
        },
        result: record.result === undefined ? null : { teamResult: record.result },
        teamRun: record,
        owner: { kind: "project_task", projectId: project.projectId, taskId, taskNumber, attemptNumber, teamVersionId }
      };
    }
  });
}
