import { redactStudioSimulationText, redactStudioSimulationValue } from "../domain/studio-simulation-redaction.mjs";
import { assertCanonicalTeamVersionId, TEAM_CORE_DIGEST_VERSION } from "../domain/team.mjs";
import Ajv from "ajv";

const SIMULATION_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

function assertSimulationId(simulationId) {
  if (!SIMULATION_ID.test(String(simulationId || ""))) throw new Error("STUDIO_SIMULATION_ID_INVALID");
}

function teamVersionIdentity(team) {
  const teamVersionId = String(team?.teamVersionId || team?.projectId || "");
  const teamId = String(team?.teamId || team?.teamRootId || teamVersionId);
  assertCanonicalTeamVersionId(teamVersionId);
  assertCanonicalTeamVersionId(teamId);
  return { teamId, teamVersionId };
}

function publicSimulation(evidence) {
  return redactStudioSimulationValue(evidence);
}

export function createStudioSimulationUseCases({ teamCatalog, teamPackageReader, packageIntegrity, simulationStore, simulationRunner, identifiers, baselineStore, withTeamVersionLock = async (_id, action) => action(), now = () => new Date().toISOString() }) {
  if (!teamCatalog || typeof teamCatalog.getTeamVersion !== "function") {
    throw new TypeError("Studio simulation use cases require a TeamVersion reader.");
  }
  if (!simulationStore || !["createSimulation", "updateSimulation", "getSimulationEvidence", "listVersionSimulations"].every((method) => typeof simulationStore[method] === "function")) {
    throw new TypeError("Studio simulation use cases require a StudioSimulationStore.");
  }
  if (!teamPackageReader || typeof teamPackageReader.exportTeamPackage !== "function"
    || !packageIntegrity || typeof packageIntegrity.computeTeamPackageCoreDigest !== "function") {
    throw new TypeError("Studio simulation use cases require Team Package export and digest operations.");
  }
  if (typeof packageIntegrity.computeReleaseBaselineDigest !== "function") {
    throw new TypeError("Studio simulation use cases require canonical baseline digest support.");
  }
  if (!simulationRunner || typeof simulationRunner.simulate !== "function") {
    throw new TypeError("Studio simulation use cases require a simulation runner.");
  }
  if (!identifiers || typeof identifiers.simulationId !== "function") {
    throw new TypeError("Studio simulation use cases require a Simulation ID generator.");
  }

  async function loadTeamVersion(teamId, teamVersionId) {
    assertCanonicalTeamVersionId(teamId);
    assertCanonicalTeamVersionId(teamVersionId);
    const team = await teamCatalog.getTeamVersion(teamVersionId);
    if (!team) throw new Error("STUDIO_SIMULATION_NOT_FOUND");
    const identity = teamVersionIdentity(team);
    if (team.teamProjectId || identity.teamId !== teamId || identity.teamVersionId !== teamVersionId) {
      throw new Error("STUDIO_SIMULATION_NOT_FOUND");
    }
    const bundle = await teamPackageReader.exportTeamPackage(team.workdir);
    const teamCoreDigest = String(packageIntegrity.computeTeamPackageCoreDigest(bundle) || "");
    if (!/^[a-f0-9]{64}$/i.test(teamCoreDigest)) throw new Error("STUDIO_SIMULATION_TEAM_DIGEST_INVALID");
    return { team, bundle, ...identity, teamCoreDigest: teamCoreDigest.toLowerCase(), teamDigestVersion: TEAM_CORE_DIGEST_VERSION };
  }

  async function withLockedTeamVersion(teamVersionId, action) {
    const initial = await teamCatalog.getTeamVersion(teamVersionId);
    if (!initial) throw new Error("STUDIO_SIMULATION_NOT_FOUND");
    return withTeamVersionLock(initial.teamRootId || initial.teamId || teamVersionId, action);
  }

  async function loadSimulationEvidence(teamId, teamVersionId, simulationId) {
    await loadTeamVersion(teamId, teamVersionId);
    assertSimulationId(simulationId);
    const evidence = await simulationStore.getSimulationEvidence(teamVersionId, simulationId);
    if (evidence.simulation.teamId !== teamId) throw new Error("STUDIO_SIMULATION_NOT_FOUND");
    return evidence;
  }

  function findBaseline(bundle, scenarioId) {
    const scenarios = bundle?.team?.releaseBaselineScenarios;
    if (!Array.isArray(scenarios)) throw new Error("TEAM_RELEASE_BASELINE_REQUIRED: define a release baseline scenario first.");
    const scenario = scenarios.find((item) => item?.scenarioId === scenarioId);
    if (!scenario) throw new Error("TEAM_RELEASE_BASELINE_NOT_FOUND");
    return { ...scenario, scenarioDigest: packageIntegrity.computeReleaseBaselineDigest(scenario) };
  }

  function assertBaselineResult(result, scenario) {
    const audit = Array.isArray(result?.auditTrail) ? result.auditTrail : [];
    if (String(result?.status || "").toLowerCase() !== "completed") {
      const completedActivations = audit.filter((item) => item?.status === "completed" && item?.noop !== true).length;
      const failedRoles = audit
        .filter((item) => item?.status !== "completed" || item?.noop === true || item?.failure || item?.error)
        .map((item) => `${item.roleId || "unknown"}: ${item.failure || item.error || item.status || "incomplete"}`)
        .slice(0, 5)
        .join("; ");
      const failureCodes = Object.keys(result?.summary?.failureCountsByErrorCode || {}).join(", ");
      const progress = completedActivations
        ? `${completedActivations} role activation${completedActivations === 1 ? "" : "s"} completed before Runtime failure`
        : "No role completed the Sandbox run";
      const details = [result?.error || result?.failureSummary, failedRoles, failureCodes && `failure codes: ${failureCodes}`, progress].filter(Boolean).join("; ");
      const detail = String(details || "Runtime did not complete the Sandbox run.").slice(0, 400);
      throw new Error(`TEAM_RELEASE_BASELINE_RUN_FAILED: Sandbox status ${String(result?.status || "unknown")}; ${detail}`);
    }
    const output = typeof result?.finalOutput === "string" ? result.finalOutput.trim() : "";
    if (!output) throw new Error("TEAM_RELEASE_BASELINE_OUTPUT_EMPTY: Sandbox returned no output.");
    const badRole = audit.find((item) => item?.status !== "completed" || item?.noop === true || item?.failure || item?.error);
    if (badRole) throw new Error(`TEAM_RELEASE_BASELINE_ROLE_FAILED: ${badRole.roleId || "unknown"} did not complete.`);
    const completed = new Set(audit.filter((item) => item?.status === "completed").map((item) => String(item.roleId || "")));
    const missing = scenario.expectedRoleIds.filter((roleId) => !completed.has(roleId));
    if (missing.length) throw new Error(`TEAM_RELEASE_BASELINE_ROLE_MISSING: ${missing.join(", ")}`);
    let parsed;
    try { parsed = JSON.parse(output); }
    catch { throw new Error("TEAM_RELEASE_BASELINE_OUTPUT_INVALID: output must be JSON matching the baseline schema."); }
    const ajv = new Ajv({ allErrors: true, strict: false });
    if (!ajv.validate(scenario.outputSchema, parsed)) throw new Error(`TEAM_RELEASE_BASELINE_SCHEMA_FAILED: ${ajv.errorsText(ajv.errors, { separator: "; " })}`);
    return output;
  }

  return Object.freeze({
    async prepareBuiltInTeamVersion(team, { caseId, prompt } = {}) {
      const { teamId, teamVersionId } = teamVersionIdentity(team);
      const scenarioId = `classic-${String(caseId || "team").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 56)}`;
      const scenarioPrompt = `${String(prompt || "Review the built-in team workflow.").trim().slice(0, 3900)}\n\nReturn the final result as a valid JSON object.`;
      const baseline = await withLockedTeamVersion(teamVersionId, async () => {
        const snapshot = await loadTeamVersion(teamId, teamVersionId);
        const roleIds = Object.keys(snapshot.bundle?.team?.design?.seats || snapshot.bundle?.team?.design?.roles || {}).sort();
        if (roleIds.length === 0) throw new Error("TEAM_RELEASE_BASELINE_ROLE_INVALID: built-in TeamVersion has no executable roles.");
        const current = await baselineStore.readReleaseBaselineScenarios({ workdir: snapshot.team.workdir });
        const previous = current.find((item) => item.scenarioId === scenarioId);
        const candidate = {
          scenarioId,
          name: `Built-in ${caseId} smoke`,
          revision: previous ? previous.revision : 1,
          prompt: scenarioPrompt,
          materials: [],
          expectedRoleIds: roleIds,
          outputSchema: { type: "object" },
          requiredForRelease: true
        };
        candidate.scenarioDigest = packageIntegrity.computeReleaseBaselineDigest(candidate);
        if (previous?.scenarioDigest === candidate.scenarioDigest) return previous;
        if (previous) {
          candidate.revision = previous.revision + 1;
          candidate.scenarioDigest = packageIntegrity.computeReleaseBaselineDigest(candidate);
        }
        await baselineStore.saveReleaseBaselineScenarios({
          workdir: snapshot.team.workdir,
          scenarios: [...current.filter((item) => item.scenarioId !== scenarioId), { ...candidate, updatedAt: now() }]
        });
        return candidate;
      });
      const simulation = await this.createSimulation(teamId, teamVersionId, { prompt: baseline.prompt, baselineScenarioId: baseline.scenarioId });
      if (simulation.simulation.status !== "completed") {
        throw new Error(`TEAM_RELEASE_BASELINE_EVIDENCE_REQUIRED: built-in TeamVersion Sandbox baseline failed (${scenarioId}).`);
      }
      return simulation;
    },
    async createSimulation(teamId, teamVersionId, { prompt, locale = "zh-CN", baselineScenarioId } = {}) {
      const input = String(prompt || "").trim();
      if (!input || input.length > 4000) throw new Error("STUDIO_SIMULATION_INPUT_INVALID: enter a task between 1 and 4,000 characters.");
      const startedAt = now();
      const prepared = await withLockedTeamVersion(teamVersionId, async () => {
        const snapshot = await loadTeamVersion(teamId, teamVersionId);
        const baseline = baselineScenarioId ? findBaseline(snapshot.bundle, String(baselineScenarioId)) : null;
        if (!baseline && input.length > 1200) throw new Error("STUDIO_SIMULATION_INPUT_INVALID: non-baseline simulations are limited to 1,200 characters.");
        if (baseline && input !== baseline.prompt) throw new Error("TEAM_RELEASE_BASELINE_INPUT_MISMATCH: baseline runs use the saved prompt.");
        if (!["draft", "editing", "released"].includes(snapshot.team.teamVersionStatus)) {
          throw new Error("STUDIO_SIMULATION_TEAM_VERSION_UNAVAILABLE");
        }
        const simulationId = identifiers.simulationId();
        assertSimulationId(simulationId);
        const created = await simulationStore.createSimulation(teamVersionId, redactStudioSimulationText(input), {
          simulationId,
          teamId,
          teamCoreDigest: snapshot.teamCoreDigest,
          teamDigestVersion: snapshot.teamDigestVersion,
          mode: baseline ? "sandbox" : "dry-run",
          baselineScenarioId: baseline?.scenarioId || null,
          baselineRevision: baseline?.revision || null,
          baselineScenarioDigest: baseline?.scenarioDigest || null,
          expectedRoleIds: baseline?.expectedRoleIds || [],
          createdAt: startedAt,
          startedAt
        });
        return { ...snapshot, baseline, simulationId, created };
      });
      const { team, bundle, teamCoreDigest, teamDigestVersion, baseline, simulationId, created } = prepared;
      const runInput = baseline ? baseline.prompt : input;
      const materialPrompt = baseline?.materials?.length
        ? `${runInput}\n\nBaseline materials:\n${baseline.materials.map((item) => `--- ${item.name} ---\n${item.content}`).join("\n\n")}`
        : runInput;

      let runtimeEvidence;
      try {
        const result = await simulationRunner.simulate(team, {
          prompt: materialPrompt, locale, simulationId, teamPackageBundle: bundle, teamCoreDigest,
          mode: baseline ? "sandbox" : "dry-run",
          materials: baseline?.materials || []
        });
        runtimeEvidence = redactStudioSimulationValue({
          status: result?.status,
          error: result?.error,
          finalRoleId: result?.finalRoleId,
          finalOutput: result?.finalOutput,
          stages: result?.stages || [],
          auditTrail: result?.auditTrail || [],
          summary: result?.summary || {}
        });
        if (baseline) assertBaselineResult(result, baseline);
        const completedAt = now();
        const status = String(result?.status || "completed");
        const auditTrail = Array.isArray(result?.auditTrail) ? result.auditTrail : [];
        const events = auditTrail.map((item) => ({
          type: "role.completed",
          at: completedAt,
          roleId: item.roleId,
          selectedEvent: item.selectedEvent,
          status: item.status,
          durationMs: item.durationMs,
          failure: item.failure
        }));
        const state = redactStudioSimulationValue({
          status,
          mode: baseline ? "sandbox" : "dry-run",
          baselineScenarioId: baseline?.scenarioId || null,
          baselineRevision: baseline?.revision || null,
          finalRoleId: result?.finalRoleId,
          finalOutput: result?.finalOutput,
          stages: result?.stages || [],
          auditTrail,
          summary: result?.summary || {},
          durationMs: result?.durationMs
        });
        const failed = ["failed", "error"].includes(status.toLowerCase());
        const output = typeof result?.finalOutput === "string" ? redactStudioSimulationText(result.finalOutput) : "";
        const updated = await simulationStore.updateSimulation(teamVersionId, simulationId, {
          metadata: {
            status: failed ? "failed" : "completed",
            completedAt,
            durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
            outputSummary: output.slice(0, 320),
                failureSummary: failed ? redactStudioSimulationText(String(result?.error || output || "Simulation failed.")).slice(0, 500) : null
          },
          state,
          events: [...events, { type: failed ? "simulation.failed" : "simulation.completed", at: completedAt }]
        });
        return publicSimulation({ simulation: updated, state, events: [{ type: "simulation.started", at: startedAt }, ...events, { type: failed ? "simulation.failed" : "simulation.completed", at: completedAt }] });
      } catch (error) {
        const completedAt = now();
        const message = redactStudioSimulationText(error instanceof Error ? error.message : String(error)).slice(0, 500);
        const failed = await simulationStore.updateSimulation(teamVersionId, simulationId, {
          metadata: {
            status: "failed",
            completedAt,
            durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
            failureSummary: message
          },
          state: { status: "failed", error: message, runtimeEvidence },
          events: [{ type: "simulation.failed", at: completedAt, error: message }]
        });
        return publicSimulation({ simulation: failed, state: { status: "failed", error: message }, events: [{ type: "simulation.started", at: startedAt }, { type: "simulation.failed", at: completedAt, error: message }] });
      }
    },

    async listTeamVersionSimulations(teamId, teamVersionId) {
      await loadTeamVersion(teamId, teamVersionId);
      return publicSimulation({ teamId, teamVersionId, simulations: await simulationStore.listVersionSimulations(teamVersionId) });
    },

    async validateReleaseEvidence(teamVersionId, expectedDigest) {
      const team = await teamCatalog.getTeamVersion(teamVersionId);
      if (!team) throw new Error("TEAM_VERSION_NOT_FOUND");
      const { teamId: ownerTeamId } = teamVersionIdentity(team);
      const { bundle, teamCoreDigest } = await loadTeamVersion(team.teamId || team.teamRootId || teamVersionId, teamVersionId);
      if (teamCoreDigest !== expectedDigest) throw new Error("TEAM_RELEASE_DIGEST_CHANGED: TeamVersion changed during release validation.");
      const scenarios = bundle?.team?.releaseBaselineScenarios;
    const requiredScenarios = Array.isArray(scenarios) ? scenarios.filter((scenario) => scenario.requiredForRelease !== false) : [];
    if (requiredScenarios.length === 0) throw new Error("TEAM_RELEASE_BASELINE_REQUIRED: add at least one required baseline scenario and run it in Sandbox.");
      const runs = await simulationStore.listVersionSimulations(teamVersionId);
    const failures = [];
    for (const scenario of requiredScenarios) {
      const scenarioDigest = packageIntegrity.computeReleaseBaselineDigest(scenario);
      let passed = false;
      for (const run of runs) {
        if (run.status !== "completed" || run.mode !== "sandbox" || run.runKind !== "studio_simulation"
          || run.teamVersionId !== teamVersionId || run.teamCoreDigest !== expectedDigest || run.teamDigestVersion !== TEAM_CORE_DIGEST_VERSION
          || run.baselineScenarioId !== scenario.scenarioId || run.baselineRevision !== scenario.revision
          || run.baselineScenarioDigest !== scenarioDigest
          || run.owner?.kind !== "studio_simulation" || run.owner?.teamVersionId !== teamVersionId
          || run.owner?.teamId !== run.teamId || run.owner?.simulationId !== run.simulationId
          || run.owner?.teamCoreDigest !== expectedDigest || run.owner?.teamDigestVersion !== TEAM_CORE_DIGEST_VERSION) continue;
        const evidence = await simulationStore.getSimulationEvidence(teamVersionId, run.simulationId);
        if (evidence.simulation.teamId !== ownerTeamId || evidence.simulation.baselineScenarioDigest !== scenarioDigest) continue;
        try {
          assertBaselineResult({
            status: evidence.state?.status,
            finalOutput: evidence.state?.finalOutput,
            auditTrail: evidence.state?.auditTrail
          }, scenario);
          passed = true;
          break;
        } catch { /* Revalidate every candidate against current server-owned scenario data. */ }
      }
      if (!passed) failures.push(scenario.scenarioId);
      }
    if (failures.length) throw new Error(`TEAM_RELEASE_BASELINE_EVIDENCE_REQUIRED: required Sandbox evidence is missing or invalid for ${failures.join(", ")}.`);
    return { ok: true, teamVersionId, teamCoreDigest, teamDigestVersion: TEAM_CORE_DIGEST_VERSION, requiredScenarioCount: requiredScenarios.length };
    },

    async recoverInterruptedSimulations() {
      if (typeof teamCatalog.listTeamRepository !== "function" || typeof simulationStore.recoverInterruptedSimulations !== "function") {
        throw new TypeError("Studio Simulation recovery requires TeamVersion listing and recovery storage.");
      }
      const teams = await teamCatalog.listTeamRepository({ includeUnreleased: true, includeCollaboration: true });
      const recovered = [];
      for (const team of teams) {
        if (team.teamProjectId || team.projectType === "collaboration") continue;
        const { teamVersionId } = teamVersionIdentity(team);
        const simulations = await simulationStore.recoverInterruptedSimulations(teamVersionId);
        recovered.push(...simulations);
      }
      return publicSimulation({ recoveredCount: recovered.length, simulations: recovered });
    },

    async cleanupExpiredSimulations(options) {
      if (typeof simulationStore.cleanupExpiredSimulations !== "function") {
        throw new TypeError("Studio Simulation cleanup requires a retention-capable store.");
      }
      return simulationStore.cleanupExpiredSimulations(options);
    },

    async getTeamVersionSimulation(teamId, teamVersionId, simulationId) {
      return publicSimulation(await loadSimulationEvidence(teamId, teamVersionId, simulationId));
    },

    async getTeamVersionSimulationEvents(teamId, teamVersionId, simulationId) {
      const evidence = await loadSimulationEvidence(teamId, teamVersionId, simulationId);
      return {
        teamId,
        teamVersionId,
        simulationId,
        events: evidence.events
      };
    }
  });
}
