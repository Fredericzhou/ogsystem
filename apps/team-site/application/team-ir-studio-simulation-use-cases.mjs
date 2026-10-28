import { redactTeamIrSimulationText, redactTeamIrSimulationValue } from "../domain/team-ir-simulation-redaction.mjs";

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
  artifactStoreFactory,
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
    return redactTeamIrSimulationValue(evidence);
  }

  function artifactScope(teamVersionId, scopeId) {
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(String(scopeId || ""))) throw new Error("TEAM_IR_SIMULATION_ARTIFACT_SCOPE_INVALID");
    if (typeof identifiers.artifactScopeId !== "function") throw new Error("TEAM_IR_SIMULATION_ARTIFACT_SCOPE_ID_UNAVAILABLE");
    const digest = identifiers.artifactScopeId(teamVersionId, scopeId);
    if (!/^[a-f0-9]{48}$/.test(String(digest || ""))) throw new Error("TEAM_IR_SIMULATION_ARTIFACT_SCOPE_ID_INVALID");
    return `studio-artifact-${digest}`;
  }

  async function getArtifactStore(teamVersionId, scopeId) {
    if (typeof artifactStoreFactory !== "function") throw new Error("TEAM_IR_SIMULATION_ARTIFACT_STORE_UNAVAILABLE");
    return artifactStoreFactory({ teamVersionId, artifactScopeId: scopeId, projectId: artifactScope(teamVersionId, scopeId) });
  }

  return Object.freeze({
    async listRunInputArtifactSlots(teamVersionId) {
      const snapshot = await loadSnapshot(teamVersionId);
      return {
        teamVersionId,
        semanticDigest: snapshot.semanticDigest,
        slots: Object.entries(snapshot.teamIR.runInput.artifactSlots || {}).map(([slotId, spec]) => ({ slotId, ...spec }))
      };
    },

    async registerSimulationInputArtifact(teamVersionId, input = {}) {
      const snapshot = await loadSnapshot(teamVersionId);
      const scopeId = String(input.artifactScopeId || "");
      const projectId = artifactScope(teamVersionId, scopeId);
      const store = await getArtifactStore(teamVersionId, scopeId);
      if (typeof input.contentBase64 !== "string" || !input.contentBase64.length || input.contentBase64.length > 699052
        || input.contentBase64.length % 4 !== 0
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.contentBase64)) {
        throw new Error("ARTIFACT_CONTENT_INVALID: upload must be canonical base64 no larger than 512 KiB.");
      }
      const content = Buffer.from(input.contentBase64, "base64");
      if (!content.length || content.length > 512 * 1024 || content.toString("base64") !== input.contentBase64) {
        throw new Error("ARTIFACT_CONTENT_INVALID: upload must be canonical base64 no larger than 512 KiB.");
      }
      const reference = await store.registerRunInput({
        team: snapshot.teamIR,
        projectId,
        slotId: input.slotId,
        mediaType: input.mediaType,
        content,
        authorizeUpload: async () => true
      });
      return { teamVersionId, artifactScopeId: scopeId, slotId: input.slotId, ...reference };
    },

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
      const scopeId = String(input.artifactScopeId || simulationId);
      const projectId = artifactScope(teamVersionId, scopeId);
      const artifactStore = await getArtifactStore(teamVersionId, scopeId);
      const normalizedAttachments = await artifactStore.validateRunInputAttachments({ team: snapshot.teamIR, projectId, attachments });
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
        input: redactTeamIrSimulationValue(request),
        preferences: redactTeamIrSimulationValue(preferences),
        attachments: redactTeamIrSimulationValue(attachments),
        artifactScopeId: scopeId,
        task: redactTeamIrSimulationText(input.task || "Team IR v2 Studio Simulation"),
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
          artifactStore,
          projectId,
          mode: "sandbox"
        });
        if (!bindings || typeof bindings !== "object") throw new Error("TEAM_BINDING_RESOLVER_UNAVAILABLE");
        const runStore = await simulationStore.openRunStore(teamVersionId, simulationId, { create: true });
        const run = await simulationRunner.execute({
          plan: snapshot.plan, bindings, simulationId, teamIR: snapshot.teamIR,
          input: request, task: input.task, preferences, attachments: normalizedAttachments, store: runStore, createRun: true,
          artifactStore, projectId
        });
        const completedAt = clock.now();
        const result = {
          ...record,
          status: run.status,
          updatedAt: completedAt,
          result: run.result === undefined ? null : redactTeamIrSimulationValue(run.result),
          run: redactTeamIrSimulationValue(run),
          events: [...record.events, ...run.events.map((event) => redactTeamIrSimulationValue(event)), {
            type: run.status === "completed" ? "simulation.completed" : "simulation.failed",
            at: completedAt,
            ...(run.status === "failed" ? { data: { code: run.events.findLast((event) => event.type === "run.failing")?.data?.code || "TEAM_RUN_FAILED" } } : {})
          }]
        };
        await simulationStore.save(result);
        return redactTeamIrSimulationValue(result);
      } catch (error) {
        const completedAt = clock.now();
        const failed = {
          ...record,
          status: "failed",
          updatedAt: completedAt,
          error: redactTeamIrSimulationText(error instanceof Error ? error.message : String(error)).slice(0, 500),
          events: [...record.events, { type: "simulation.failed", at: completedAt, data: { code: error?.message?.match(/^[A-Z][A-Z0-9_]+/)?.[0] || "TEAM_IR_SIMULATION_FAILED" } }]
        };
          await simulationStore.save(failed);
          return redactTeamIrSimulationValue(failed);
        }
      });
    },
    async getSimulation(teamVersionId, simulationId) {
      return getSimulation(teamVersionId, simulationId);
    },
    async listSimulations(teamVersionId) {
      assertTeamVersionId(teamVersionId);
      return redactTeamIrSimulationValue({ simulations: await simulationStore.list(teamVersionId) });
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
              const artifactScopeId = latest.artifactScopeId || latest.simulationId;
              const projectId = artifactScope(teamVersionId, artifactScopeId);
              const artifactStore = await getArtifactStore(teamVersionId, artifactScopeId);
              await artifactStore.validateRunInputAttachments({ team: snapshot.teamIR, projectId, attachments: latest.attachments || {} });
              const runStore = await simulationStore.openRunStore(teamVersionId, latest.simulationId);
              const run = await simulationRunner.execute({
                plan: snapshot.plan, bindings, simulationId: latest.simulationId, teamIR: snapshot.teamIR,
                attachments: latest.attachments || {}, store: runStore, createRun: false, artifactStore, projectId
              });
              const updatedAt = clock.now();
              const resumed = {
                ...latest,
                status: run.status,
                updatedAt,
                result: run.result === undefined ? null : redactTeamIrSimulationValue(run.result),
                run: redactTeamIrSimulationValue(run),
                events: [...latest.events, ...run.events.map((event) => redactTeamIrSimulationValue(event)), {
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
                error: redactTeamIrSimulationText(error instanceof Error ? error.message : String(error)).slice(0, 500),
                events: [...latest.events, { type: "simulation.failed", at: updatedAt, data: { code: error?.message?.match(/^[A-Z][A-Z0-9_]+/)?.[0] || "TEAM_IR_SIMULATION_RECOVERY_FAILED" } }]
              };
              await simulationStore.save(failed);
              return failed;
            }
          });
          recovered.push(redactTeamIrSimulationValue(outcome));
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
