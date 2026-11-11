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

function artifactsUrl(teamId, teamVersionId, simulationId) {
  return `/api/v1/teams/${encodeURIComponent(teamId)}/versions/${encodeURIComponent(teamVersionId)}/simulations/${encodeURIComponent(simulationId)}/artifacts`;
}

function publicSimulation(evidence) {
  const value = redactStudioSimulationValue(evidence);
  if (value?.simulation?.teamId && value.simulation.teamVersionId && value.simulation.simulationId) {
    value.simulation.artifactsUrl = artifactsUrl(value.simulation.teamId, value.simulation.teamVersionId, value.simulation.simulationId);
  }
  if (Array.isArray(value?.simulations)) {
    value.simulations = value.simulations.map((simulation) => simulation?.teamId && simulation?.teamVersionId && simulation?.simulationId
      ? { ...simulation, artifactsUrl: artifactsUrl(simulation.teamId, simulation.teamVersionId, simulation.simulationId) }
      : simulation);
  }
  return value;
}

export function createStudioSimulationUseCases({ teamCatalog, teamPackageReader, packageIntegrity, simulationStore, simulationRunner, identifiers, baselineStore, projectTeamDesign, requestRunStop = async () => undefined, openWorkspaceDirectory = async () => undefined, withTeamVersionLock = async (_id, action) => action(), processIsAlive = () => true, processId = 0, hostName = "unknown", now = () => new Date().toISOString() }) {
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

  async function updateBatchUnderLock(teamVersionId, batchId, update) {
    return withLockedTeamVersion(teamVersionId, async () => {
      const batch = await simulationStore.readLatestBatch(teamVersionId);
      if (!batch || batch.batchId !== batchId) throw new Error("STUDIO_SIMULATION_BATCH_NOT_FOUND");
      const next = await update(batch);
      if (next !== batch) await simulationStore.writeLatestBatch(teamVersionId, next);
      return next;
    });
  }

  async function recoverStaleBatchUnderLock(teamVersionId) {
    const batch = await simulationStore.readLatestBatch(teamVersionId);
    if (batch?.status !== "running") return batch;
    if (batch.ownerHost !== hostName || processIsAlive(batch.ownerPid)) return batch;
    const recoveredAt = now();
    const recovered = {
      ...batch,
      status: "failed",
      failureCode: "BATCH_INTERRUPTED_BY_RESTART",
      completedAt: recoveredAt,
      items: batch.items.map((item) => ["running", "queued"].includes(item.status)
        ? { ...item, status: "interrupted", completedAt: recoveredAt, failureCode: "BATCH_INTERRUPTED_BY_RESTART" }
        : item)
    };
    await simulationStore.writeLatestBatch(teamVersionId, recovered);
    return recovered;
  }

  async function hasValidScenarioEvidence(teamVersionId, teamCoreDigest, scenario) {
    const scenarioDigest = packageIntegrity.computeReleaseBaselineDigest(scenario);
    for (const run of await simulationStore.listVersionSimulations(teamVersionId)) {
      if (run.status !== "completed" || run.mode !== "sandbox" || run.runKind !== "studio_simulation"
        || run.teamVersionId !== teamVersionId || run.teamCoreDigest !== teamCoreDigest
        || run.teamDigestVersion !== TEAM_CORE_DIGEST_VERSION || run.baselineScenarioId !== scenario.scenarioId
        || run.baselineRevision !== scenario.revision || run.baselineScenarioDigest !== scenarioDigest
        || run.owner?.kind !== "studio_simulation" || run.owner?.teamVersionId !== teamVersionId
        || run.owner?.teamId !== run.teamId || run.owner?.simulationId !== run.simulationId
        || run.owner?.teamCoreDigest !== teamCoreDigest) continue;
      try {
        const evidence = await simulationStore.getSimulationEvidence(teamVersionId, run.simulationId);
        assertBaselineResult({ status: evidence.state?.status, finalOutputsByRoleId: evidence.state?.finalOutputsByRoleId, auditTrail: evidence.state?.auditTrail }, scenario);
        return true;
      } catch { /* Invalid evidence is never used as a passing baseline. */ }
    }
    return false;
  }

  async function markBatchTerminal(teamVersionId, batchId, status, extra = {}) {
    return updateBatchUnderLock(teamVersionId, batchId, (batch) => ({ ...batch, ...extra, status, completedAt: now() }));
  }

  function settledBatchItemCount(items) {
    return items.filter((item) => ["completed", "failed", "interrupted", "skipped", "cancelled"].includes(item.status)).length;
  }

  const activeBatchRuns = new Set();

  async function runReleaseBaselineBatch(useCases, teamId, teamVersionId, batchId, locale) {
    const initial = await simulationStore.readLatestBatch(teamVersionId);
    for (const item of initial?.items || []) {
      if (item.status !== "queued") continue;
      const state = await withLockedTeamVersion(teamVersionId, async () => {
        const batch = await recoverStaleBatchUnderLock(teamVersionId);
        if (!batch || batch.batchId !== batchId || batch.status !== "running") return { stop: true };
        if (batch.cancelRequested) {
          const items = batch.items.map((entry) => entry.status === "queued" ? { ...entry, status: "cancelled" } : entry);
          const cancelled = { ...batch, status: "cancelled", completedAt: now(), items, completedCount: settledBatchItemCount(items) };
          await simulationStore.writeLatestBatch(teamVersionId, cancelled);
          return { stop: true };
        }
        const snapshot = await loadTeamVersion(teamId, teamVersionId);
        const currentScenario = findBaseline(snapshot.bundle, item.scenarioId);
        if (snapshot.teamCoreDigest !== batch.teamCoreDigest || currentScenario.scenarioDigest !== item.expectedScenarioDigest) {
          await simulationStore.writeLatestBatch(teamVersionId, { ...batch, status: "invalidated", invalidationReason: "TEAM_OR_SCENARIO_DIGEST_CHANGED", completedAt: now() });
          return { stop: true };
        }
        await simulationStore.writeLatestBatch(teamVersionId, {
          ...batch,
          currentScenarioId: item.scenarioId,
          currentScenarioName: item.name,
          items: batch.items.map((entry) => entry.scenarioId === item.scenarioId ? { ...entry, status: "running", startedAt: now() } : entry)
        });
        return { scenario: currentScenario, expectedDigest: batch.teamCoreDigest };
      });
      if (state.stop) return;
      try {
        const result = await useCases.createSimulation(teamId, teamVersionId, {
          prompt: state.scenario.prompt,
          locale,
          baselineScenarioId: state.scenario.scenarioId,
          expectedTeamCoreDigest: state.expectedDigest,
          awaitCompletion: true
        });
        const invalid = await withLockedTeamVersion(teamVersionId, async () => {
          const batch = await simulationStore.readLatestBatch(teamVersionId);
          if (!batch || batch.batchId !== batchId || batch.status !== "running") return batch?.status === "invalidated";
          const after = await loadTeamVersion(teamId, teamVersionId);
          const currentScenario = findBaseline(after.bundle, item.scenarioId);
          const digestChanged = after.teamCoreDigest !== batch.teamCoreDigest || currentScenario.scenarioDigest !== item.expectedScenarioDigest;
          const items = batch.items.map((entry) => entry.scenarioId === item.scenarioId
            ? { ...entry, status: digestChanged ? "interrupted" : result.simulation.status === "completed" ? "completed" : "failed", simulationId: result.simulation.simulationId, completedAt: now(), ...(result.simulation.failureSummary ? { failureSummary: result.simulation.failureSummary } : {}) }
            : entry);
          const next = {
            ...batch,
            items,
            completedCount: settledBatchItemCount(items),
            ...(digestChanged ? { status: "invalidated", invalidationReason: "TEAM_OR_SCENARIO_DIGEST_CHANGED", completedAt: now() } : {})
          };
          await simulationStore.writeLatestBatch(teamVersionId, next);
          return digestChanged;
        });
        if (invalid) {
          return;
        }
      } catch (error) {
        const message = redactStudioSimulationText(error instanceof Error ? error.message : String(error)).slice(0, 500);
        const invalid = await withLockedTeamVersion(teamVersionId, async () => {
          const batch = await simulationStore.readLatestBatch(teamVersionId);
          if (!batch || batch.batchId !== batchId || batch.status !== "running") return batch?.status === "invalidated";
          const snapshot = await loadTeamVersion(teamId, teamVersionId).catch(() => null);
          const currentScenario = snapshot ? snapshot.bundle?.team?.releaseBaselineScenarios?.find((entry) => entry.scenarioId === item.scenarioId) : null;
          const currentScenarioDigest = currentScenario ? packageIntegrity.computeReleaseBaselineDigest(currentScenario) : null;
          const digestChanged = !snapshot || snapshot.teamCoreDigest !== batch.teamCoreDigest || currentScenarioDigest !== item.expectedScenarioDigest;
          const items = batch.items.map((entry) => entry.scenarioId === item.scenarioId
            ? { ...entry, status: digestChanged ? "interrupted" : "failed", completedAt: now(), ...(digestChanged ? {} : { failureSummary: message }) }
            : entry);
          await simulationStore.writeLatestBatch(teamVersionId, {
            ...batch,
            items,
            completedCount: settledBatchItemCount(items),
            ...(digestChanged ? { status: "invalidated", invalidationReason: "TEAM_OR_SCENARIO_DIGEST_CHANGED", completedAt: now() } : {})
          });
          return digestChanged;
        });
        if (invalid) return;
      }
    }
    await withLockedTeamVersion(teamVersionId, async () => {
      const batch = await simulationStore.readLatestBatch(teamVersionId);
      if (!batch || batch.batchId !== batchId || batch.status !== "running") return;
      if (batch.cancelRequested) {
        const items = batch.items.map((item) => item.status === "queued" ? { ...item, status: "cancelled" } : item);
        await simulationStore.writeLatestBatch(teamVersionId, { ...batch, status: "cancelled", completedAt: now(), items, completedCount: settledBatchItemCount(items) });
        return;
      }
      const snapshot = await loadTeamVersion(batch.teamId || batch.teamVersionId, teamVersionId);
      const currentScenarioDigests = new Map((snapshot.bundle?.team?.releaseBaselineScenarios || []).map((scenario) => [scenario.scenarioId, packageIntegrity.computeReleaseBaselineDigest(scenario)]));
      if (snapshot.teamCoreDigest !== batch.teamCoreDigest || batch.items.some((item) => currentScenarioDigests.get(item.scenarioId) !== item.expectedScenarioDigest)) {
        await simulationStore.writeLatestBatch(teamVersionId, { ...batch, status: "invalidated", invalidationReason: "TEAM_OR_SCENARIO_DIGEST_CHANGED", completedAt: now() });
        return;
      }
      const failed = batch.items.some((item) => ["failed", "interrupted"].includes(item.status));
      await simulationStore.writeLatestBatch(teamVersionId, { ...batch, status: failed ? "failed" : "completed", completedAt: now() });
    });
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
    const outputMap = result?.finalOutputsByRoleId;
    const outputs = outputMap && typeof outputMap === "object" ? Object.values(outputMap).flat() : [];
    const parsed = outputs.length === 1 && outputs[0]?.data && typeof outputs[0].data === "object"
      ? outputs[0].data
      : outputs.length === 1 && typeof outputs[0]?.content === "string"
        ? (() => { try { return JSON.parse(outputs[0].content); } catch { return undefined; } })()
        : undefined;
    if (!parsed) throw new Error("TEAM_RELEASE_BASELINE_OUTPUT_EMPTY: Sandbox returned no structured output.");
    const badRole = audit.find((item) => item?.status !== "completed" || item?.noop === true || item?.failure || item?.error);
    if (badRole) throw new Error(`TEAM_RELEASE_BASELINE_ROLE_FAILED: ${badRole.roleId || "unknown"} did not complete.`);
    const completed = new Set(audit.filter((item) => item?.status === "completed").map((item) => String(item.roleId || "")));
    const missing = scenario.expectedRoleIds.filter((roleId) => !completed.has(roleId));
    if (missing.length) throw new Error(`TEAM_RELEASE_BASELINE_ROLE_MISSING: ${missing.join(", ")}`);
    const ajv = new Ajv({ allErrors: true, strict: false });
    if (!ajv.validate(scenario.outputSchema, parsed)) throw new Error(`TEAM_RELEASE_BASELINE_SCHEMA_FAILED: ${ajv.errorsText(ajv.errors, { separator: "; " })}`);
    return parsed;
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
    async createSimulation(teamId, teamVersionId, { prompt, locale = "zh-CN", mode = "dry-run", baselineScenarioId, simulationScenario, expectedTeamCoreDigest, awaitCompletion = true } = {}) {
      const input = String(prompt || "").trim();
      if (!input || input.length > 4000) throw new Error("STUDIO_SIMULATION_INPUT_INVALID: enter a task between 1 and 4,000 characters.");
      if (!["dry-run", "sandbox"].includes(mode)) throw new Error("STUDIO_SIMULATION_MODE_INVALID: choose dry-run or sandbox.");
      if (simulationScenario && (mode !== "dry-run" || simulationScenario !== "review-reject-once")) throw new Error("DRY_RUN_SCENARIO_INVALID: named simulation scenarios are available only for dry-run execution.");
      const startedAt = now();
      const prepared = await withLockedTeamVersion(teamVersionId, async () => {
        const snapshot = await loadTeamVersion(teamId, teamVersionId);
        if (expectedTeamCoreDigest && snapshot.teamCoreDigest !== expectedTeamCoreDigest) throw new Error("TEAM_VERSION_DIGEST_CHANGED: TeamVersion changed before baseline execution.");
        const baseline = baselineScenarioId ? findBaseline(snapshot.bundle, String(baselineScenarioId)) : null;
        const executionMode = baseline ? "sandbox" : mode;
        if (!baseline && input.length > 1200) throw new Error("STUDIO_SIMULATION_INPUT_INVALID: non-baseline simulations are limited to 1,200 characters.");
        if (baseline && input !== baseline.prompt) throw new Error("TEAM_RELEASE_BASELINE_INPUT_MISMATCH: baseline runs use the saved prompt.");
        if (!["draft", "released"].includes(snapshot.team.teamVersionStatus)) {
          throw new Error("STUDIO_SIMULATION_TEAM_VERSION_UNAVAILABLE");
        }
        const simulationId = identifiers.simulationId();
        assertSimulationId(simulationId);
        const roles = snapshot.bundle?.team?.design?.roles || snapshot.bundle?.team?.design?.seats || {};
        const roleDisplayNames = Object.fromEntries(Object.entries(roles).map(([roleId, role]) => [
          roleId,
          String(role?.name || role?.title || role?.label || roleId)
        ]));
        const runtimeEdgeIdsByTransition = typeof projectTeamDesign === "function"
          ? Object.fromEntries((await projectTeamDesign(snapshot.team)).viewModel.edges.map((edge) => [JSON.stringify([edge.source, edge.eventType, edge.target]), edge.id]))
          : {};
        const created = await simulationStore.createSimulation(teamVersionId, redactStudioSimulationText(input), {
          simulationId,
          teamId,
          teamCoreDigest: snapshot.teamCoreDigest,
          teamDigestVersion: snapshot.teamDigestVersion,
          mode: executionMode,
          baselineScenarioId: baseline?.scenarioId || null,
          baselineRevision: baseline?.revision || null,
          baselineScenarioDigest: baseline?.scenarioDigest || null,
          simulationScenario: simulationScenario || null,
          expectedRoleIds: baseline?.expectedRoleIds || [],
          roleDisplayNames,
          createdAt: startedAt,
          startedAt
        });
        return { ...snapshot, baseline, executionMode, simulationId, created, runtimeEdgeIdsByTransition, simulationScenario };
      });
      const { team, bundle, teamCoreDigest, teamDigestVersion, baseline, executionMode, simulationId, created, runtimeEdgeIdsByTransition } = prepared;
      const runInput = baseline ? baseline.prompt : input;
      const materialPrompt = baseline?.materials?.length
        ? `${runInput}\n\nBaseline materials:\n${baseline.materials.map((item) => `--- ${item.name} ---\n${item.content}`).join("\n\n")}`
        : runInput;

      const execution = (async () => {
      let runtimeEvidence;
      try {
        const runEvidenceDirectory = typeof simulationStore.getSimulationRunDirectory === "function"
          ? simulationStore.getSimulationRunDirectory(teamVersionId, simulationId)
          : undefined;
        const result = await simulationRunner.simulate(team, {
          prompt: materialPrompt, locale, simulationId, teamPackageBundle: bundle, teamCoreDigest,
          runtimeEdgeIdsByTransition,
          mode: executionMode,
          simulationScenario,
          materials: baseline?.materials || [],
          runEvidenceDirectory,
          onRuntimeEvent: async (runtimeEvent) => {
            const event = runtimeEvent.type === "audit"
              ? redactStudioSimulationValue({
                  type: `role.${runtimeEvent.status === "failed" ? "failed" : runtimeEvent.status === "noop" ? "skipped" : "completed"}`,
                  at: runtimeEvent.at || now(),
                  roleId: runtimeEvent.roleId,
                  branchId: runtimeEvent.branchId,
                  lineageId: runtimeEvent.lineageId,
                  loopIteration: runtimeEvent.loopIteration,
                  executionId: runtimeEvent.executionId,
                  attempt: runtimeEvent.attempt,
                  maxAttempts: runtimeEvent.maxAttempts,
                  selectedEvent: runtimeEvent.selectedEvent,
                  status: runtimeEvent.status === "failed" ? "failed" : runtimeEvent.status === "noop" ? "skipped" : "completed",
                  durationMs: runtimeEvent.durationMs,
                  backend: runtimeEvent.backend,
                  modelId: runtimeEvent.modelId,
                  profileId: runtimeEvent.profileId,
                  toolRef: runtimeEvent.toolRef,
                  promptCalls: runtimeEvent.promptCalls,
                  projectedInputChars: runtimeEvent.projectedInputChars,
                  renderedPromptChars: runtimeEvent.renderedPromptChars,
                  estimatedInputTokens: runtimeEvent.estimatedInputTokens,
                  estimatedOutputTokens: runtimeEvent.estimatedOutputTokens,
                  externalDataIsolated: runtimeEvent.externalDataIsolated,
                  fallbackUsed: runtimeEvent.fallbackUsed,
                  primaryModelId: runtimeEvent.primaryModelId,
                  inputContext: runtimeEvent.inputContext,
                  stdout: runtimeEvent.stdout,
                  stdoutPreview: runtimeEvent.stdoutPreview,
                  failure: runtimeEvent.error,
                  errorCode: runtimeEvent.errorCode || runtimeEvent.errorEnvelope?.errorCode,
                  errorEnvelope: runtimeEvent.errorEnvelope
                })
              : redactStudioSimulationValue(runtimeEvent);
            if (typeof simulationStore.appendSimulationEvents === "function") {
              await simulationStore.appendSimulationEvents(teamVersionId, simulationId, event);
            } else {
              await simulationStore.updateSimulation(teamVersionId, simulationId, { events: event });
            }
          }
        });
        runtimeEvidence = redactStudioSimulationValue({
          status: result?.status,
          error: result?.error,
          finalOutputsByRoleId: result?.finalOutputsByRoleId || {},
          finalOutputRoleOrder: result?.finalOutputRoleOrder || [],
          stages: result?.stages || [],
          auditTrail: result?.auditTrail || [],
          summary: result?.summary || {}
        });
        if (baseline) assertBaselineResult(result, baseline);
        const completedAt = now();
        const rawStatus = String(result?.status || "unknown").toLowerCase();
        const status = ["done", "ok", "completed"].includes(rawStatus)
          ? "completed"
          : rawStatus === "stopped" ? "stopped" : "failed";
        const auditTrail = Array.isArray(result?.auditTrail) ? result.auditTrail : [];
        const events = auditTrail.map((item) => {
          const rawRoleStatus = String(item.status || (item.failure || item.error ? "failed" : "unknown")).toLowerCase();
          const roleStatus = ["done", "ok"].includes(rawRoleStatus) ? "completed" : rawRoleStatus;
          const failed = ["failed", "error"].includes(roleStatus) || Boolean(item.failure || item.error);
          const skipped = ["noop", "no-op", "skipped"].includes(roleStatus) || item.noop === true;
          const roleEvent = {
            type: `role.${failed ? "failed" : skipped ? "skipped" : roleStatus === "completed" ? "completed" : "unknown"}`,
            roleId: item.roleId,
            branchId: item.branchId,
            lineageId: item.lineageId,
            loopIteration: item.loopIteration,
            executionId: item.executionId,
            attempt: item.attempt,
            maxAttempts: item.maxAttempts,
            selectedEvent: item.selectedEvent,
            status: failed ? "failed" : skipped ? "skipped" : roleStatus,
            durationMs: item.durationMs,
            backend: item.backend,
            modelId: item.modelId,
            profileId: item.profileId,
            toolRef: item.toolRef,
            promptCalls: item.promptCalls,
            projectedInputChars: item.projectedInputChars,
            renderedPromptChars: item.renderedPromptChars,
            estimatedInputTokens: item.estimatedInputTokens,
            estimatedOutputTokens: item.estimatedOutputTokens,
            externalDataIsolated: item.externalDataIsolated,
            fallbackUsed: item.fallbackUsed,
            primaryModelId: item.primaryModelId,
            inputContext: item.inputContext,
            stdout: item.stdout,
            stdoutPreview: item.stdoutPreview,
            failure: item.failure || item.error,
            errorCode: item.errorCode || item.errorEnvelope?.errorCode,
            errorEnvelope: item.errorEnvelope
          };
          const eventTime = item.at || item.timestamp || item.startedAt || item.completedAt || item.finishedAt;
          if (eventTime) roleEvent.at = eventTime;
          return roleEvent;
        });
        const persistedEvents = (await simulationStore.getSimulationEvidence(teamVersionId, simulationId)).events;
        const persistedCounts = new Map();
        for (const item of persistedEvents) {
          if (!String(item.type || "").startsWith("role.")) continue;
          const key = `${item.executionId || ""}\0${item.type || ""}\0${item.selectedEvent || ""}`;
          persistedCounts.set(key, (persistedCounts.get(key) || 0) + 1);
        }
        const missingEvents = events.filter((item) => {
          const key = `${item.executionId || ""}\0${item.type || ""}\0${item.selectedEvent || ""}`;
          const count = persistedCounts.get(key) || 0;
          if (count > 0) {
            persistedCounts.set(key, count - 1);
            return false;
          }
          return true;
        });
        const failed = status !== "completed";
        const outputs = result?.finalOutputsByRoleId || {};
        const output = (result?.finalOutputRoleOrder || []).flatMap((roleId) => (outputs[roleId] || []).map((item) => `${roleId}: ${item.content || JSON.stringify(item.data || {})}`)).join(" | ");
        const failureCodes = Object.keys(result?.summary?.failureCountsByErrorCode || {});
        const failedRoles = auditTrail
          .filter((item) => item?.status !== "completed" || item?.failure || item?.error)
          .map((item) => `${item.roleId || "unknown"}: ${item.failure || item.error || item.status || "incomplete"}`)
          .slice(0, 5);
        const failureSummary = failed
          ? redactStudioSimulationText([
            result?.error,
            failureCodes.length ? `failure codes: ${failureCodes.join(", ")}` : "",
            failedRoles.join("; "),
            output,
            `Simulation returned status ${rawStatus}.`
          ].filter(Boolean).join("; ")).slice(0, 500)
          : null;
        const state = redactStudioSimulationValue({
          status,
          runtimeStatus: rawStatus,
          mode: executionMode,
          baselineScenarioId: baseline?.scenarioId || null,
          baselineRevision: baseline?.revision || null,
          finalOutputsByRoleId: result?.finalOutputsByRoleId || {},
          finalOutputRoleOrder: result?.finalOutputRoleOrder || [],
          stages: result?.stages || [],
          auditTrail,
          summary: result?.summary || {},
          ...(failureSummary ? { error: failureSummary } : {}),
          durationMs: result?.durationMs
        });
        const updated = await simulationStore.updateSimulation(teamVersionId, simulationId, {
            metadata: {
            status: failed ? (status === "stopped" ? "stopped" : "failed") : "completed",
            completedAt,
            durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
            outputSummary: output.slice(0, 320),
            failureSummary
          },
          state,
          events: [...missingEvents, {
            type: failed ? (status === "stopped" ? "simulation.stopped" : "simulation.failed") : "simulation.completed",
            at: completedAt,
            ...(failureSummary ? { error: failureSummary } : {}),
            ...(failureCodes[0] ? { errorCode: failureCodes[0] } : {})
          }]
        });
        return publicSimulation({ simulation: updated, state, events: (await simulationStore.getSimulationEvidence(teamVersionId, simulationId)).events });
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
        return publicSimulation({ simulation: failed, state: { status: "failed", error: message }, events: (await simulationStore.getSimulationEvidence(teamVersionId, simulationId)).events });
      }
      })();
      if (baseline || awaitCompletion) return execution;
      void execution.catch(() => undefined);
      return publicSimulation({ simulation: created, state: { status: "running" }, events: [{ type: "simulation.started", at: startedAt }] });
    },

    async stopSimulation(teamId, teamVersionId, simulationId, reason = "Stopped from Studio") {
      const evidence = await loadSimulationEvidence(teamId, teamVersionId, simulationId);
      const current = String(evidence.simulation.status || "");
      if (!["running", "stopping"].includes(current)) return publicSimulation(evidence);
      if (current === "running") {
        const runDirectory = typeof simulationStore.getSimulationRunDirectory === "function"
          ? simulationStore.getSimulationRunDirectory(teamVersionId, simulationId)
          : undefined;
        if (!runDirectory) throw new Error("STUDIO_SIMULATION_STOP_UNAVAILABLE");
        const stopReason = String(reason || "Stopped from Studio").slice(0, 300);
        await simulationStore.updateSimulation(teamVersionId, simulationId, {
          metadata: { status: "stopping" },
          state: { ...evidence.state, status: "stopping" },
          events: [{ type: "simulation.stopping", at: now(), reason: stopReason }]
        });
        await requestRunStop({ runDir: runDirectory, reason: stopReason });
      }
      return publicSimulation(await loadSimulationEvidence(teamId, teamVersionId, simulationId));
    },

    async listTeamVersionSimulations(teamId, teamVersionId) {
      const team = await loadTeamVersion(teamId, teamVersionId);
      return publicSimulation({
        teamId,
        teamVersionId,
        workspaceAvailable: Boolean(team?.workspaceDir),
        simulations: await simulationStore.listVersionSimulations(teamVersionId)
      });
    },

    async openTeamVersionWorkspaceDirectory(teamId, teamVersionId) {
      const { team } = await loadTeamVersion(teamId, teamVersionId);
      const workspaceDir = team?.workspaceDir;
      if (!workspaceDir) throw new Error("TEAM_WORKSPACE_UNBOUND");
      await openWorkspaceDirectory(workspaceDir);
      return { opened: true };
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
            finalOutputsByRoleId: evidence.state?.finalOutputsByRoleId,
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

    async startReleaseBaselineBatch(teamIdOrVersionId, teamVersionIdOrOptions = {}, optionsValue = {}) {
      let teamId;
      let teamVersionId;
      let options;
      if (typeof teamVersionIdOrOptions === "string") {
        teamId = teamIdOrVersionId;
        teamVersionId = teamVersionIdOrOptions;
        options = optionsValue;
      } else {
        teamVersionId = teamIdOrVersionId;
        options = teamVersionIdOrOptions || {};
        const team = await teamCatalog.getTeamVersion(teamVersionId);
        if (!team) throw new Error("STUDIO_SIMULATION_NOT_FOUND");
        teamId = team.teamId || team.teamRootId || teamVersionId;
      }
      const { mode = "missing_only", locale = "zh-CN" } = options;
      if (!simulationStore.readLatestBatch || !simulationStore.writeLatestBatch) throw new Error("STUDIO_SIMULATION_BATCH_UNAVAILABLE");
      if (!["missing_only", "retry_failed", "all_required"].includes(mode)) throw new Error("STUDIO_SIMULATION_BATCH_MODE_INVALID");
      const identity = teamVersionIdentity({ teamId, teamVersionId });
      const batch = await withLockedTeamVersion(teamVersionId, async () => {
        const existing = await recoverStaleBatchUnderLock(teamVersionId);
        if (existing?.status === "running") return existing;
        const snapshot = await loadTeamVersion(identity.teamId, teamVersionId);
        const scenarios = (snapshot.bundle?.team?.releaseBaselineScenarios || []).filter((scenario) => scenario.requiredForRelease !== false);
        if (!scenarios.length) throw new Error("TEAM_RELEASE_BASELINE_REQUIRED: define at least one required baseline scenario first.");
        const previous = mode === "retry_failed" ? existing : null;
        const previousFailed = new Set((previous?.items || []).filter((item) => ["failed", "interrupted"].includes(item.status)).map((item) => item.scenarioId));
        const items = [];
        for (const scenario of scenarios) {
          const scenarioDigest = packageIntegrity.computeReleaseBaselineDigest(scenario);
          let status = "queued";
          if (mode === "missing_only" && await hasValidScenarioEvidence(teamVersionId, snapshot.teamCoreDigest, scenario)) status = "skipped";
          if (mode === "retry_failed" && !previousFailed.has(scenario.scenarioId)) status = "skipped";
          items.push({ scenarioId: scenario.scenarioId, name: scenario.name, revision: scenario.revision, expectedScenarioDigest: scenarioDigest, status });
        }
        const createdAt = now();
        const next = {
          batchId: identifiers.batchId?.() || identifiers.simulationId(),
          teamId: identity.teamId,
          teamVersionId,
          teamCoreDigest: snapshot.teamCoreDigest,
          mode,
          status: "running",
          ownerPid: processId,
          ownerHost: hostName,
          startedAt: createdAt,
          completedCount: items.filter((item) => item.status === "skipped").length,
          totalCount: items.length,
          cancelRequested: false,
          items
        };
        await simulationStore.writeLatestBatch(teamVersionId, next);
        return next;
      });
      if (batch.ownerPid === processId && batch.ownerHost === hostName && batch.status === "running" && !activeBatchRuns.has(batch.batchId)) {
        activeBatchRuns.add(batch.batchId);
        void runReleaseBaselineBatch(this, identity.teamId, teamVersionId, batch.batchId, locale)
          .catch(async (error) => {
            const message = redactStudioSimulationText(error instanceof Error ? error.message : String(error)).slice(0, 500);
            await markBatchTerminal(teamVersionId, batch.batchId, "failed", { failureSummary: message }).catch(() => undefined);
          })
          .finally(() => activeBatchRuns.delete(batch.batchId));
      }
      return batch;
    },

    async getReleaseBaselineBatchStatus(teamVersionId) {
      if (!simulationStore.readLatestBatch || !simulationStore.writeLatestBatch) throw new Error("STUDIO_SIMULATION_BATCH_UNAVAILABLE");
      const batch = await withLockedTeamVersion(teamVersionId, () => recoverStaleBatchUnderLock(teamVersionId));
      return publicSimulation({ teamVersionId, batch });
    },

    async cancelReleaseBaselineBatch(teamVersionId, batchId) {
      if (!simulationStore.readLatestBatch || !simulationStore.writeLatestBatch) throw new Error("STUDIO_SIMULATION_BATCH_UNAVAILABLE");
      return publicSimulation(await updateBatchUnderLock(teamVersionId, batchId, (batch) => {
        if (batch.status !== "running") return batch;
        return { ...batch, cancelRequested: true, cancelRequestedAt: now() };
      }));
    },

    async compareReleaseBaselines(teamVersionId, target = "parent_version") {
      const current = await loadTeamVersion((await teamCatalog.getTeamVersion(teamVersionId))?.teamId || teamVersionId, teamVersionId);
      const siblings = typeof teamCatalog.listTeamRepository === "function"
        ? await teamCatalog.listTeamRepository({ includeUnreleased: true })
        : [];
      const sameTeam = siblings.filter((item) => !item.teamProjectId && (item.teamRootId || item.teamId) === current.teamId);
      const parent = current.team.parentTeamVersionId ? sameTeam.find((item) => item.teamVersionId === current.team.parentTeamVersionId && item.teamVersionStatus === "released") : null;
      const latest = sameTeam.filter((item) => item.teamVersionStatus === "released" && item.teamVersionId !== teamVersionId)
        .sort((left, right) => (right.teamVersionNumber || 0) - (left.teamVersionNumber || 0) || String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))[0] || null;
      const targetTeam = target === "latest_released" ? latest : target === "parent_version" ? parent : null;
      const targetSnapshot = targetTeam ? await loadTeamVersion(current.teamId, targetTeam.teamVersionId || targetTeam.projectId) : null;
      const currentScenarios = current.bundle?.team?.releaseBaselineScenarios || [];
      const targetScenarios = targetSnapshot?.bundle?.team?.releaseBaselineScenarios || [];
      const targetById = new Map(targetScenarios.map((scenario) => [scenario.scenarioId, scenario]));
      const currentById = new Map(currentScenarios.map((scenario) => [scenario.scenarioId, scenario]));
      const comparisons = [];
      const scenarioIds = [...new Set([...currentScenarios.map((scenario) => scenario.scenarioId), ...targetScenarios.map((scenario) => scenario.scenarioId)])];
      for (const scenarioId of scenarioIds) {
        const scenario = currentById.get(scenarioId);
        const previous = targetById.get(scenarioId);
        const currentPassed = scenario ? await hasValidScenarioEvidence(teamVersionId, current.teamCoreDigest, scenario) : false;
        const targetPassed = previous ? await hasValidScenarioEvidence(targetSnapshot.team.teamVersionId || targetSnapshot.team.projectId, targetSnapshot.teamCoreDigest, previous) : false;
        const revisionChanged = Boolean(previous && scenario && packageIntegrity.computeReleaseBaselineDigest(previous) !== packageIntegrity.computeReleaseBaselineDigest(scenario));
        comparisons.push({
          scenarioId,
          name: scenario?.name || previous?.name,
          revisionChanged,
          regression: Boolean(targetPassed && !currentPassed),
          current: scenario ? { revision: scenario.revision, passed: currentPassed } : null,
          target: previous ? { revision: previous.revision, passed: targetPassed } : null
        });
      }
      const describeTarget = (kind, team) => team ? {
        target: kind,
        id: team.teamVersionId || team.projectId,
        teamVersionId: team.teamVersionId || team.projectId,
        versionNumber: team.teamVersionNumber,
        teamName: team.teamName || team.name,
        label: kind === "parent_version" ? "Parent version" : "Latest released"
      } : null;
      return {
        teamVersionId,
        availableTargets: {
          parent_version: describeTarget("parent_version", parent),
          latest_released: describeTarget("latest_released", latest)
        },
        selectedTarget: targetTeam ? target : null,
        targetTeamVersionId: targetTeam?.teamVersionId || targetTeam?.projectId || null,
        scenarios: comparisons
      };
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
        const simulations = await withLockedTeamVersion(teamVersionId, async () => {
          if (simulationStore.readLatestBatch && simulationStore.writeLatestBatch) await recoverStaleBatchUnderLock(teamVersionId);
          return simulationStore.recoverInterruptedSimulations(teamVersionId);
        });
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
      const [evidence, team] = await Promise.all([
        loadSimulationEvidence(teamId, teamVersionId, simulationId),
        teamCatalog.getTeamVersion(teamVersionId)
      ]);
      return publicSimulation({
        ...evidence,
        simulation: { ...evidence.simulation, workspaceAvailable: Boolean(team?.workspaceDir) }
      });
    },

    async listTeamVersionSimulationArtifacts(teamId, teamVersionId, simulationId) {
      await loadSimulationEvidence(teamId, teamVersionId, simulationId);
      if (typeof simulationStore.listSimulationArtifacts !== "function") throw new Error("STUDIO_SIMULATION_ARTIFACTS_UNAVAILABLE");
      const payload = await simulationStore.listSimulationArtifacts(teamVersionId, simulationId);
      let sealedEntries = [];
      if (typeof simulationStore.readSimulationSealManifest === "function") {
        try {
          const manifest = await simulationStore.readSimulationSealManifest(teamVersionId, simulationId);
          const artifactRoot = String(manifest.artifact || "").replace(/^shared\//, "").replace(/\/$/, "");
          if (artifactRoot && Array.isArray(manifest.files)) {
            sealedEntries = manifest.files.map((entry) => ({
              path: `sealed/${artifactRoot}/${entry.path}`,
              kind: "file",
              size: Number(entry.sizeBytes || 0),
              sizeBytes: Number(entry.sizeBytes || 0),
              sha256: entry.sha256,
              mediaType: entry.mediaType || "application/octet-stream",
              sealed: true
            }));
          }
        } catch (error) {
          // Runs without declared artifacts have no seal manifest. Their
          // ordinary role evidence remains available through this endpoint.
          if (!String(error?.message || "").includes("NOT_FOUND")) throw error;
        }
      }
      return publicSimulation({
        teamId,
        teamVersionId,
        simulationId,
        ...payload,
        entries: [...(payload.entries || []), ...sealedEntries].map((entry) => ({
          ...entry,
          url: `${artifactsUrl(teamId, teamVersionId, simulationId)}/${entry.path.split("/").map(encodeURIComponent).join("/")}`
        }))
      });
    },

    async readTeamVersionSimulationArtifact(teamId, teamVersionId, simulationId, pathValue, options = {}) {
      await loadSimulationEvidence(teamId, teamVersionId, simulationId);
      if (typeof simulationStore.readSimulationArtifact !== "function") throw new Error("STUDIO_SIMULATION_ARTIFACTS_UNAVAILABLE");
      return simulationStore.readSimulationArtifact(teamVersionId, simulationId, pathValue, options);
    },

    async readTeamVersionSimulationSealManifest(teamId, teamVersionId, simulationId) {
      await loadSimulationEvidence(teamId, teamVersionId, simulationId);
      if (typeof simulationStore.readSimulationSealManifest !== "function") throw new Error("STUDIO_SIMULATION_SEALED_ARTIFACTS_UNAVAILABLE");
      return simulationStore.readSimulationSealManifest(teamVersionId, simulationId);
    },

    async readTeamVersionSimulationVerificationReport(teamId, teamVersionId, simulationId) {
      await loadSimulationEvidence(teamId, teamVersionId, simulationId);
      if (typeof simulationStore.readSimulationVerificationReport !== "function") throw new Error("STUDIO_SIMULATION_SEALED_ARTIFACTS_UNAVAILABLE");
      return simulationStore.readSimulationVerificationReport(teamVersionId, simulationId);
    },

    async readTeamVersionSimulationSealedFile(teamId, teamVersionId, simulationId, pathValue, options = {}) {
      await loadSimulationEvidence(teamId, teamVersionId, simulationId);
      if (typeof simulationStore.readSimulationSealedFile !== "function") throw new Error("STUDIO_SIMULATION_SEALED_ARTIFACTS_UNAVAILABLE");
      return simulationStore.readSimulationSealedFile(teamVersionId, simulationId, pathValue, options);
    },

    async openTeamVersionSimulationSealedFile(teamId, teamVersionId, simulationId, pathValue, options = {}) {
      await loadSimulationEvidence(teamId, teamVersionId, simulationId);
      if (typeof simulationStore.openSimulationSealedFile !== "function") throw new Error("STUDIO_SIMULATION_SEALED_ARTIFACTS_UNAVAILABLE");
      return simulationStore.openSimulationSealedFile(teamVersionId, simulationId, pathValue, options);
    },

    async getTeamVersionSimulationEvents(teamId, teamVersionId, simulationId, afterCursor = 0) {
      const evidence = await loadSimulationEvidence(teamId, teamVersionId, simulationId);
      const cursor = Number.isSafeInteger(Number(afterCursor)) && Number(afterCursor) >= 0 ? Number(afterCursor) : 0;
      const allEvents = evidence.events;
      return {
        teamId,
        teamVersionId,
        simulationId,
        events: allEvents.slice(cursor),
        cursor: allEvents.length,
        done: ["completed", "failed", "stopped"].includes(evidence.simulation.status)
      };
    },

    async clearInteractiveSimulations(teamId, teamVersionId) {
      await loadTeamVersion(teamId, teamVersionId);
      if (typeof simulationStore.clearInteractiveSimulations !== "function") throw new TypeError("Studio Simulation store does not support history cleanup.");
      return simulationStore.clearInteractiveSimulations(teamVersionId);
    }
  });
}
