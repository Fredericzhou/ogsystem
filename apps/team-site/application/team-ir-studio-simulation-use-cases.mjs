import { redactStudioSimulationText, redactStudioSimulationValue } from "../domain/studio-simulation-redaction.mjs";

const DIGEST = /^[a-f0-9]{64}$/i;
const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

function assertTeamVersionId(value) {
  if (!ID.test(String(value || ""))) throw new Error("TEAM_VERSION_ID_INVALID");
}

export function createTeamIrStudioSimulationUseCases({
  teamCatalog,
  teamIrStore,
  simulationStore,
  resolveReleaseClosure,
  resolveBindings,
  identifiers,
  simulationRunner,
  clock = { now: Date.now }
}) {
  if (typeof teamCatalog?.getTeamVersion !== "function" || typeof teamIrStore?.read !== "function") {
    throw new TypeError("Team IR Studio Simulation requires TeamVersion and Team IR stores.");
  }
  if (typeof simulationStore?.create !== "function" || typeof simulationStore?.save !== "function"
    || typeof simulationStore?.get !== "function" || typeof simulationStore?.list !== "function"
    || typeof simulationStore?.withExecutionLock !== "function" || typeof simulationStore?.openRunStore !== "function") {
    throw new TypeError("Team IR Studio Simulation requires an evidence store.");
  }
  if (typeof identifiers?.simulationId !== "function" || typeof simulationRunner?.prepare !== "function"
    || typeof simulationRunner?.execute !== "function" || typeof simulationRunner?.semanticDigest !== "function") {
    throw new TypeError("Team IR Studio Simulation requires ID and Runtime ports.");
  }

  async function loadSnapshot(teamVersionId) {
    assertTeamVersionId(teamVersionId);
    const team = await teamCatalog.getTeamVersion(teamVersionId);
    if (!team || team.projectType === "collaboration" || team.teamProjectId) throw new Error("TEAM_VERSION_NOT_FOUND");
    if (!["draft", "released"].includes(team.teamVersionStatus || "draft")) throw new Error("TEAM_IR_SIMULATION_TEAM_VERSION_UNAVAILABLE");
    const stored = await teamIrStore.read({ workdir: team.workdir });
    if (!stored.teamIR || stored.teamIR.schemaVersion !== 2) throw new Error("TEAM_IR_V2_REQUIRED");
    const semanticDigest = simulationRunner.semanticDigest(stored.teamIR);
    if (stored.semanticDigest !== semanticDigest) throw new Error("TEAM_IR_SNAPSHOT_MISMATCH");
    if (typeof resolveReleaseClosure !== "function" || typeof resolveBindings !== "function") {
      throw new Error("TEAM_IR_V2_SIMULATION_UNAVAILABLE: trusted dependency and Sandbox Binding resolvers are not configured.");
    }
    const closure = await resolveReleaseClosure({ team, teamIR: stored.teamIR });
    if (closure?.complete !== true || !closure.packageDigests || !closure.bindingDigests || !closure.adapterVersions) {
      throw new Error("TEAM_IR_RELEASE_CLOSURE_INCOMPLETE");
    }
    const { plan } = simulationRunner.prepare(stored.teamIR, closure);
    return { team, teamIR: stored.teamIR, semanticDigest, plan, closure };
  }

  async function getSimulation(teamVersionId, simulationId) {
    assertTeamVersionId(teamVersionId);
    const evidence = await simulationStore.get(teamVersionId, simulationId);
    return redactStudioSimulationValue(evidence);
  }

  return Object.freeze({
    async createSimulation(teamVersionId, input = {}) {
      const request = input.input;
      if (typeof request !== "object" || request === null || Array.isArray(request)) throw new Error("TEAM_IR_SIMULATION_INPUT_INVALID");
      const preferences = input.preferences ?? {};
      if (typeof preferences !== "object" || preferences === null || Array.isArray(preferences)) throw new Error("TEAM_IR_SIMULATION_PREFERENCES_INVALID");
      const attachments = input.attachments ?? {};
      if (typeof attachments !== "object" || attachments === null || Array.isArray(attachments)) throw new Error("TEAM_IR_SIMULATION_ATTACHMENTS_INVALID");
      const snapshot = await loadSnapshot(teamVersionId);
      const simulationId = identifiers.simulationId();
      assertTeamVersionId(simulationId);
      const startedAt = clock.now();
      const record = {
        kind: "team_ir_v2_simulation",
        simulationId,
        runId: simulationId,
        teamVersionId,
        teamIrSemanticDigest: snapshot.semanticDigest,
        compiledPlanDigest: snapshot.plan.compiledPlanDigest,
        compilerSemanticsVersion: snapshot.plan.compilerSemanticsVersion,
        status: "running",
        mode: "sandbox",
        createdAt: startedAt,
        updatedAt: startedAt,
        input: redactStudioSimulationValue(request),
        preferences: redactStudioSimulationValue(preferences),
        attachments: redactStudioSimulationValue(attachments),
        task: redactStudioSimulationText(input.task || "Team IR v2 Studio Simulation"),
        result: null,
        events: [{ type: "simulation.started", at: startedAt, data: { compiledPlanDigest: snapshot.plan.compiledPlanDigest } }]
      };
      return simulationStore.withExecutionLock(teamVersionId, simulationId, async () => {
        await simulationStore.create(record);
        try {
        const bindings = await resolveBindings({
          team: snapshot.team,
          teamIR: snapshot.teamIR,
          closure: snapshot.closure,
          simulationId,
          mode: "sandbox"
        });
        if (!bindings || typeof bindings !== "object") throw new Error("TEAM_BINDING_RESOLVER_UNAVAILABLE");
        const runStore = await simulationStore.openRunStore(teamVersionId, simulationId, { create: true });
        const run = await simulationRunner.execute({
          plan: snapshot.plan, bindings, simulationId, teamIR: snapshot.teamIR,
          input: request, task: input.task, preferences, attachments, store: runStore, createRun: true
        });
        const completedAt = clock.now();
        const result = {
          ...record,
          status: run.status,
          updatedAt: completedAt,
          result: run.result === undefined ? null : redactStudioSimulationValue(run.result),
          run: redactStudioSimulationValue(run),
          events: [...record.events, ...run.events.map((event) => redactStudioSimulationValue(event)), {
            type: run.status === "completed" ? "simulation.completed" : "simulation.failed",
            at: completedAt,
            ...(run.status === "failed" ? { data: { code: run.events.findLast((event) => event.type === "run.failing")?.data?.code || "TEAM_RUN_FAILED" } } : {})
          }]
        };
        await simulationStore.save(result);
        return redactStudioSimulationValue(result);
      } catch (error) {
        const completedAt = clock.now();
        const failed = {
          ...record,
          status: "failed",
          updatedAt: completedAt,
          error: redactStudioSimulationText(error instanceof Error ? error.message : String(error)).slice(0, 500),
          events: [...record.events, { type: "simulation.failed", at: completedAt, data: { code: error?.message?.match(/^[A-Z][A-Z0-9_]+/)?.[0] || "TEAM_IR_SIMULATION_FAILED" } }]
        };
          await simulationStore.save(failed);
          return redactStudioSimulationValue(failed);
        }
      });
    },
    async getSimulation(teamVersionId, simulationId) {
      return getSimulation(teamVersionId, simulationId);
    },
    async listSimulations(teamVersionId) {
      assertTeamVersionId(teamVersionId);
      return redactStudioSimulationValue({ simulations: await simulationStore.list(teamVersionId) });
    },
    async recoverInterruptedSimulations(teamVersionId) {
      assertTeamVersionId(teamVersionId);
      const recovered = [];
      for (const record of (await simulationStore.list(teamVersionId)).filter((item) => item.status === "running")) {
        try {
          const outcome = await simulationStore.withExecutionLock(teamVersionId, record.simulationId, async () => {
            const latest = await simulationStore.get(teamVersionId, record.simulationId);
            if (latest.status !== "running") return latest;
            try {
              const snapshot = await loadSnapshot(teamVersionId);
              if (snapshot.semanticDigest !== latest.teamIrSemanticDigest
                || snapshot.plan.compiledPlanDigest !== latest.compiledPlanDigest) {
                throw new Error("TEAM_IR_SIMULATION_SNAPSHOT_CHANGED: refusing to resume against changed dependencies.");
              }
              const bindings = await resolveBindings({ team: snapshot.team, teamIR: snapshot.teamIR, closure: snapshot.closure, simulationId: latest.simulationId, mode: "sandbox" });
              if (!bindings || typeof bindings !== "object") throw new Error("TEAM_BINDING_RESOLVER_UNAVAILABLE");
              const runStore = await simulationStore.openRunStore(teamVersionId, latest.simulationId);
              const run = await simulationRunner.execute({
                plan: snapshot.plan, bindings, simulationId: latest.simulationId, teamIR: snapshot.teamIR,
                store: runStore, createRun: false
              });
              const updatedAt = clock.now();
              const resumed = {
                ...latest,
                status: run.status,
                updatedAt,
                result: run.result === undefined ? null : redactStudioSimulationValue(run.result),
                run: redactStudioSimulationValue(run),
                events: [...latest.events, ...run.events.map((event) => redactStudioSimulationValue(event)), {
                  type: run.status === "completed" ? "simulation.completed" : "simulation.failed",
                  at: updatedAt,
                  ...(run.status === "completed" ? {} : { data: { code: run.events.findLast((event) => event.type === "run.failing")?.data?.code || run.status.toUpperCase() } })
                }]
              };
              await simulationStore.save(resumed);
              return resumed;
            } catch (error) {
              const updatedAt = clock.now();
              const failed = {
                ...latest, status: "failed", updatedAt,
                error: redactStudioSimulationText(error instanceof Error ? error.message : String(error)).slice(0, 500),
                events: [...latest.events, { type: "simulation.failed", at: updatedAt, data: { code: error?.message?.match(/^[A-Z][A-Z0-9_]+/)?.[0] || "TEAM_IR_SIMULATION_RECOVERY_FAILED" } }]
              };
              await simulationStore.save(failed);
              return failed;
            }
          });
          recovered.push(redactStudioSimulationValue(outcome));
        } catch (error) {
          if (/TEAM_IR_SIMULATION_EXECUTION_IN_PROGRESS/.test(String(error?.message || ""))) continue;
          throw error;
        }
      }
      return { recoveredCount: recovered.length, simulations: recovered };
    },
    async recoverAllInterruptedSimulations() {
      const teams = await teamCatalog.listTeamRepository({ includeUnreleased: true, includeCollaboration: false });
      let recoveredCount = 0;
      for (const team of teams) {
        const teamVersionId = team.teamVersionId || team.projectId;
        if (team.projectType === "collaboration" || team.teamProjectId || !teamVersionId) continue;
        const outcome = await this.recoverInterruptedSimulations(teamVersionId);
        recoveredCount += outcome.recoveredCount;
      }
      return { recoveredCount };
    },
    async validateReleaseEvidence({ teamVersionId, teamIrSemanticDigest, compiledPlanDigest }) {
      if (!DIGEST.test(String(teamIrSemanticDigest || "")) || !DIGEST.test(String(compiledPlanDigest || ""))) {
        throw new Error("TEAM_IR_V2_RELEASE_EVIDENCE_REQUIRED: invalid frozen digest.");
      }
      const records = await simulationStore.list(teamVersionId);
      const match = records.find((record) => record.kind === "team_ir_v2_simulation"
        && record.status === "completed" && record.mode === "sandbox"
        && record.teamIrSemanticDigest === teamIrSemanticDigest
        && record.compiledPlanDigest === compiledPlanDigest
        && record.run?.status === "completed"
        && record.run?.resultWritten === true);
      if (!match) throw new Error("TEAM_IR_V2_RELEASE_EVIDENCE_REQUIRED: no completed Team IR v2 Sandbox Simulation matches the frozen digests.");
      return { ok: true, simulationId: match.simulationId, teamIrSemanticDigest, compiledPlanDigest };
    }
  });
}
