import assert from "node:assert/strict";
import test from "node:test";
import { createStudioSimulationUseCases } from "../application/studio-simulation-use-cases.mjs";
import { computeReleaseBaselineDigest, computeTeamPackageCoreDigest } from "../infrastructure/package-integrity.mjs";

const packageBundle = { team: { systemSource: "flow", design: { roles: { analyst: { name: "分析师" } } } } };
const digest = computeTeamPackageCoreDigest(packageBundle);

function createHarness({ runResult, runError, runGate, mutateBundleOnRun, dynamicDigest = false, team = {}, siblingTeams = [], siblingPackages = {}, packageBundle: selectedPackageBundle = packageBundle, digest: selectedDigest = computeTeamPackageCoreDigest(selectedPackageBundle), processIsAlive = () => true, initialBatch = null, onLockQueued, projectTeamDesign } = {}) {
  const records = new Map();
  const batches = new Map(initialBatch ? [["team-v1", initialBatch]] : []);
  const calls = [];
  let lockDepth = 0;
  let simulationSequence = 0;
  const lockTails = new Map();
  const teamVersion = {
    projectId: "team-v1",
    teamId: "team-root",
    teamVersionId: "team-v1",
    teamVersionStatus: "draft",
    teamCoreDigest: digest,
    workdir: "/teams/team-v1",
    ...team
  };
  const catalogTeams = [teamVersion, ...siblingTeams];
  const simulationStore = {
    async createSimulation(versionId, input, options) {
      calls.push(["create", versionId, input, options]);
      const simulation = { simulationId: options.simulationId, runKind: "studio_simulation", teamId: options.teamId, teamVersionId: versionId, owner: { kind: "studio_simulation", teamId: options.teamId, teamVersionId: versionId, simulationId: options.simulationId, teamCoreDigest: options.teamCoreDigest, teamDigestVersion: options.teamDigestVersion }, ...options, input, status: "running" };
      records.set(options.simulationId, { simulation, state: {}, events: [{ type: "simulation.started" }] });
      return simulation;
    },
    async updateSimulation(versionId, simulationId, update) {
      const record = records.get(simulationId);
      record.simulation = { ...record.simulation, ...update.metadata };
      record.state = update.state || record.state;
      record.events = [...record.events, ...(update.events || [])];
      return record.simulation;
    },
    async appendSimulationEvents(versionId, simulationId, events) {
      const record = records.get(simulationId);
      record.events.push(...(Array.isArray(events) ? events : [events]));
    },
    async getSimulationEvidence(versionId, simulationId) {
      const record = records.get(simulationId);
      if (!record || record.simulation.teamVersionId !== versionId) throw new Error("STUDIO_SIMULATION_NOT_FOUND");
      return record;
    },
    async listVersionSimulations(versionId) {
      return [...records.values()].map((record) => record.simulation).filter((item) => item.teamVersionId === versionId);
    },
    async recoverInterruptedSimulations(versionId) {
      return [...records.values()].map((record) => record.simulation).filter((item) => item.teamVersionId === versionId && item.status === "running");
    },
    async readLatestBatch(versionId) { return batches.get(versionId) || null; },
    async writeLatestBatch(versionId, batch) {
      assert.ok(lockDepth > 0, "batch state writes must happen while holding the TeamVersion lock");
      batches.set(versionId, batch);
      return batch;
    },
    async clearInteractiveSimulations(versionId) {
      const removed = [];
      for (const [id, record] of records) {
        if (record.simulation.teamVersionId === versionId && record.simulation.mode !== "sandbox" && record.simulation.status !== "running") {
          records.delete(id);
          removed.push(id);
        }
      }
      return { removedCount: removed.length, removedSimulationIds: removed };
    }
  };
  const withTeamVersionLock = async (id, action) => {
    const previous = lockTails.get(id) || Promise.resolve();
    let releaseTurn;
    const turn = new Promise((resolve) => { releaseTurn = resolve; });
    const queued = previous.then(() => turn);
    if (lockDepth > 0) onLockQueued?.(id);
    lockTails.set(id, queued);
    await previous;
    lockDepth += 1;
    try { return await action(); }
    finally {
      lockDepth -= 1;
      releaseTurn();
      if (lockTails.get(id) === queued) lockTails.delete(id);
    }
  };
  const useCases = createStudioSimulationUseCases({
    teamCatalog: {
      getTeamVersion: async (id) => catalogTeams.find((item) => (item.teamVersionId || item.projectId) === id),
      listTeamRepository: async () => catalogTeams
    },
    teamPackageReader: {
      async exportTeamPackage(workdir) {
        calls.push(["export", workdir]);
        if (siblingPackages[workdir]) return siblingPackages[workdir];
        return selectedPackageBundle;
      }
    },
    packageIntegrity: { computeTeamPackageCoreDigest: (bundle) => bundle === selectedPackageBundle ? dynamicDigest ? computeTeamPackageCoreDigest(selectedPackageBundle) : selectedDigest : computeTeamPackageCoreDigest(bundle), computeReleaseBaselineDigest },
    simulationStore,
    simulationRunner: {
      async simulate(selectedTeam, options) {
        calls.push(["run", selectedTeam.teamVersionId, options]);
        if (runError) throw runError;
        if (mutateBundleOnRun) mutateBundleOnRun(selectedPackageBundle);
        if (runGate) {
          runGate.onStart?.();
          await runGate.promise;
        }
        const result = runResult || { status: "completed", finalOutputsByRoleId: { analyst: [{ content: "result" }] }, finalOutputRoleOrder: ["analyst"], auditTrail: [{ roleId: "analyst", status: "completed" }] };
        for (const item of result.auditTrail || []) await options.onRuntimeEvent?.({ type: "audit", ...item });
        return result;
      }
    },
    identifiers: { simulationId: () => `sim-${++simulationSequence}`, batchId: () => `batch-${simulationSequence + 1}` },
    processIsAlive,
    hostName: "test-host",
    withTeamVersionLock,
    baselineStore: {
      async readReleaseBaselineScenarios() { return []; },
      async saveReleaseBaselineScenarios() { return []; }
    },
    projectTeamDesign,
    now: (() => { let tick = 0; return () => `2026-01-01T00:00:0${tick++}.000Z`; })()
  });
  return { useCases, records, calls, batches, withTeamVersionLock };
}

test("Studio Simulation creates its own owner record and stores completed state/events", async () => {
  const { useCases, records, calls } = createHarness();
  const created = await useCases.createSimulation("team-root", "team-v1", { prompt: "Analyze this task", locale: "en" });
  assert.equal(created.simulation.runKind, "studio_simulation");
  assert.equal(created.simulation.owner.kind, "studio_simulation");
  assert.equal(created.simulation.status, "completed");
  assert.deepEqual(created.state.finalOutputsByRoleId, { analyst: [{ content: "result" }] });
  assert.deepEqual(created.events.map((event) => event.type), ["simulation.started", "role.completed", "simulation.completed"]);
  assert.equal(created.simulation.roleDisplayNames.analyst, "分析师");
  assert.equal(records.get("sim-1").simulation.teamCoreDigest, digest);
  assert.deepEqual(calls.map((call) => call[0]), ["export", "create", "run"]);
  assert.equal(calls[2][2].simulationId, "sim-1");
  assert.deepEqual(calls[2][2].teamPackageBundle, packageBundle);
  assert.equal(calls[2][2].teamCoreDigest, digest);
  assert.deepEqual((await useCases.listTeamVersionSimulations("team-root", "team-v1")).simulations.map((item) => item.simulationId), ["sim-1"]);
  assert.equal((await useCases.getTeamVersionSimulationEvents("team-root", "team-v1", "sim-1")).events.length, 3);
});

test("Studio Simulation forwards canonical Graph Edge IDs and failed role diagnostics", async () => {
  const { useCases, calls } = createHarness({
    projectTeamDesign: async () => ({ viewModel: { edges: [
      { id: "custom-flow-id", source: "dispatch", eventType: "WORK", target: "worker" }
    ] } }),
    runResult: {
      status: "failed",
      auditTrail: [{
        roleId: "worker",
        status: "failed",
        failure: "Model call timed out",
        errorEnvelope: { errorCode: "MODEL_TIMEOUT", message: "Model call timed out" }
      }]
    }
  });
  const result = await useCases.createSimulation("team-root", "team-v1", { prompt: "Run" });
  assert.equal(calls[2][2].runtimeEdgeIdsByTransition[JSON.stringify(["dispatch", "WORK", "worker"])], "custom-flow-id");
  const failure = result.events.find((event) => event.type === "role.failed");
  assert.equal(failure.errorCode, "MODEL_TIMEOUT");
  assert.equal(failure.errorEnvelope.message, "Model call timed out");
});

test("interactive Studio Simulation returns running immediately and persists role events incrementally", async () => {
  let resolveRun;
  const deferred = createHarness();
  const pending = new Promise((resolve) => { resolveRun = resolve; });
  deferred.useCases = createStudioSimulationUseCases({
    teamCatalog: { getTeamVersion: async () => ({ projectId: "team-v1", teamId: "team-root", teamVersionId: "team-v1", teamVersionStatus: "draft", workdir: "/teams/team-v1" }) },
    teamPackageReader: { exportTeamPackage: async () => packageBundle },
    packageIntegrity: { computeTeamPackageCoreDigest: () => digest, computeReleaseBaselineDigest },
    simulationStore: {
      createSimulation: async (_versionId, input, options) => { const simulation = { simulationId: options.simulationId, teamId: options.teamId, teamVersionId: "team-v1", owner: { kind: "studio_simulation", teamVersionId: "team-v1", simulationId: options.simulationId }, input, ...options, status: "running" }; deferred.records.set(options.simulationId, { simulation, state: {}, events: [{ type: "simulation.started" }] }); return simulation; },
      updateSimulation: async (_versionId, simulationId, update) => { const record = deferred.records.get(simulationId); record.simulation = { ...record.simulation, ...update.metadata }; record.state = update.state || record.state; record.events.push(...(update.events || [])); return record.simulation; },
      appendSimulationEvents: async (_versionId, simulationId, event) => deferred.records.get(simulationId).events.push(event),
      getSimulationEvidence: async (_versionId, simulationId) => deferred.records.get(simulationId),
      listVersionSimulations: async () => [...deferred.records.values()].map((record) => record.simulation)
    },
    simulationRunner: { simulate: async (_team, options) => { await options.onRuntimeEvent({ type: "role.started", roleId: "analyst", branchId: "analyst:1", executionId: "analyst-1" }); await options.onRuntimeEvent({ type: "role.input_ready", roleId: "analyst", branchId: "analyst:1", executionId: "analyst-1", inputContext: { task: "Inspect" } }); return pending; } },
    identifiers: { simulationId: () => "sim-1" },
    baselineStore: { readReleaseBaselineScenarios: async () => [], saveReleaseBaselineScenarios: async () => [] }
  });

  const started = await deferred.useCases.createSimulation("team-root", "team-v1", { prompt: "Inspect", awaitCompletion: false });
  assert.equal(started.simulation.status, "running");
  assert.deepEqual((await deferred.useCases.getTeamVersionSimulationEvents("team-root", "team-v1", "sim-1")).events.map((event) => event.type), ["simulation.started", "role.started", "role.input_ready"]);
  resolveRun({ status: "completed", finalOutputsByRoleId: { analyst: [{ content: "done" }] }, finalOutputRoleOrder: ["analyst"], auditTrail: [{ roleId: "analyst", status: "running" }] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await deferred.useCases.getTeamVersionSimulation("team-root", "team-v1", "sim-1")).simulation.status, "completed");
});

test("Studio Simulation persists redacted failures and rejects mismatched team ownership", async () => {
  const { useCases, records } = createHarness({ runError: new Error("failed with api_key=private-token") });
  const result = await useCases.createSimulation("team-root", "team-v1", { prompt: "secret_key=input-secret" });
  assert.equal(result.simulation.status, "failed");
  assert.doesNotMatch(JSON.stringify(result), /private-token|input-secret/);
  assert.equal(records.get("sim-1").state.status, "failed");
  await assert.rejects(useCases.getTeamVersionSimulation("other-team", "team-v1", "sim-1"), /STUDIO_SIMULATION_NOT_FOUND/);
});

test("Studio Simulation redacts errors returned as failed results", async () => {
  const { useCases } = createHarness({ runResult: { status: "failed", error: "harness returned api_key=returned-secret", finalOutputsByRoleId: { analyst: [{ content: "failed" }] }, finalOutputRoleOrder: ["analyst"] } });
  const result = await useCases.createSimulation("team-root", "team-v1", { prompt: "retry safely" });
  assert.equal(result.simulation.status, "failed");
  assert.match(result.simulation.failureSummary, /api_key=\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(result), /returned-secret/);
});

test("failed Sandbox baseline evidence retains a redacted Runtime diagnostic", async () => {
  const baseline = {
    scenarioId: "release-smoke", revision: 1, prompt: "Return JSON", expectedRoleIds: ["analyst"],
    materials: [], outputSchema: { type: "object", required: ["ok"], properties: { ok: { const: true } } }
  };
  const selectedPackageBundle = { team: { systemSource: "flow", releaseBaselineScenarios: [baseline] } };
  const { useCases, records } = createHarness({
    packageBundle: selectedPackageBundle,
    digest: computeTeamPackageCoreDigest(selectedPackageBundle),
    team: { teamVersionStatus: "draft" },
    runResult: { status: "failed", error: "request failed api_key=runtime-secret", auditTrail: [{ roleId: "analyst", status: "failed", error: "provider denied" }] }
  });

  const result = await useCases.createSimulation("team-root", "team-v1", { prompt: baseline.prompt, baselineScenarioId: baseline.scenarioId });

  assert.equal(result.simulation.status, "failed");
  assert.match(result.simulation.failureSummary, /Sandbox status failed; request failed api_key=\[REDACTED\]/);
  assert.match(result.state.error, /analyst: provider denied/);
  assert.doesNotMatch(JSON.stringify(result), /runtime-secret/);
  assert.match(records.get("sim-1").state.error, /Sandbox status failed/);
});

test("failed Sandbox baseline reports completed activations and Runtime failure codes accurately", async () => {
  const baseline = {
    scenarioId: "release-smoke", revision: 1, prompt: "Run the workflow", expectedRoleIds: ["analyst"],
    materials: [], outputSchema: { type: "object" }
  };
  const packageBundle = { team: { systemSource: "flow", releaseBaselineScenarios: [baseline] } };
  const { useCases } = createHarness({
    packageBundle,
    digest: computeTeamPackageCoreDigest(packageBundle),
    team: { teamVersionStatus: "draft" },
    runResult: {
      status: "failed",
      auditTrail: [{ roleId: "analyst", status: "completed" }, { roleId: "reviewer", status: "completed" }],
      summary: { failureCountsByErrorCode: { GRAPH_LOOP_BUDGET_EXCEEDED: 1 } }
    }
  });

  const result = await useCases.createSimulation("team-root", "team-v1", { prompt: baseline.prompt, baselineScenarioId: baseline.scenarioId });

  assert.match(result.simulation.failureSummary, /2 role activations completed before Runtime failure/);
  assert.match(result.simulation.failureSummary, /GRAPH_LOOP_BUDGET_EXCEEDED/);
  assert.doesNotMatch(result.simulation.failureSummary, /No role completed/);
});

test("Studio Simulation validates input, digest, identity, and eligible TeamVersion", async () => {
  const empty = createHarness();
  await assert.rejects(empty.useCases.createSimulation("team-root", "team-v1", { prompt: " " }), /STUDIO_SIMULATION_INPUT_INVALID/);
  await assert.rejects(empty.useCases.createSimulation("wrong-team", "team-v1", { prompt: "valid" }), /STUDIO_SIMULATION_NOT_FOUND/);
  const unavailable = createHarness({ team: { teamVersionStatus: "archived" } });
  await assert.rejects(unavailable.useCases.createSimulation("team-root", "team-v1", { prompt: "valid" }), /STUDIO_SIMULATION_TEAM_VERSION_UNAVAILABLE/);
  const invalidDigest = createHarness({ digest: "not-a-digest", team: { teamCoreDigest: null, projectDigest: null } });
  await assert.rejects(invalidDigest.useCases.createSimulation("team-root", "team-v1", { prompt: "valid" }), /STUDIO_SIMULATION_TEAM_DIGEST_INVALID/);
});

test("saved release baseline accepts its 4,000-character contract while ad hoc Simulation remains capped", async () => {
  const prompt = "x".repeat(4000);
  const baseline = {
    scenarioId: "long-release-check", revision: 1, prompt, expectedRoleIds: ["analyst"],
    materials: [], outputSchema: { type: "object" }
  };
  const bundle = { team: { systemSource: "flow", releaseBaselineScenarios: [baseline] } };
  const { useCases, records } = createHarness({
    packageBundle: bundle,
    digest: computeTeamPackageCoreDigest(bundle),
    team: { teamVersionStatus: "draft" },
    runResult: { status: "completed", finalOutputsByRoleId: { analyst: [{ data: {} }] }, finalOutputRoleOrder: ["analyst"], auditTrail: [{ roleId: "analyst", status: "completed" }] }
  });

  const result = await useCases.createSimulation("team-root", "team-v1", { prompt, baselineScenarioId: baseline.scenarioId });
  assert.equal(result.simulation.status, "completed");
  assert.equal(records.get("sim-1").simulation.input.length, 4000);
  await assert.rejects(useCases.createSimulation("team-root", "team-v1", { prompt }), /non-baseline simulations are limited to 1,200/);
  await assert.rejects(useCases.createSimulation("team-root", "team-v1", { prompt: "x".repeat(4001), baselineScenarioId: baseline.scenarioId }), /STUDIO_SIMULATION_INPUT_INVALID/);
});

test("Studio Simulation computes draft identity from canonical package contents", async () => {
  const packageBundle = { team: { systemSource: "draft flow", laws: { maxSteps: 3 } } };
  const canonicalDigest = computeTeamPackageCoreDigest(packageBundle);
  const { useCases, records, calls } = createHarness({
    packageBundle,
    digest: canonicalDigest,
    team: { teamVersionStatus: "draft", teamCoreDigest: null, projectDigest: null }
  });

  const created = await useCases.createSimulation("team-root", "team-v1", { prompt: "Try the draft" });

  assert.equal(created.simulation.status, "completed");
  assert.equal(records.get("sim-1").simulation.teamCoreDigest, canonicalDigest);
  assert.equal(calls[0][0], "export");
  assert.equal(calls[0][1], "/teams/team-v1");
});

test("release baseline Sandbox evidence is versioned, schema checked, and tied to the current digest", async () => {
  const baseline = {
    scenarioId: "release-smoke",
    revision: 2,
    prompt: "Return the release check result",
    expectedRoleIds: ["analyst"],
    materials: [{ name: "brief.md", content: "fixed input" }],
    outputSchema: { type: "object", required: ["ok"], properties: { ok: { const: true } } }
  };
  const packageBundle = { team: { systemSource: "flow", releaseBaselineScenarios: [baseline] } };
  const canonicalDigest = computeTeamPackageCoreDigest(packageBundle);
  const { useCases, records, calls } = createHarness({
    packageBundle,
    digest: canonicalDigest,
    team: { teamVersionStatus: "draft", teamCoreDigest: null, projectDigest: null },
    runResult: { status: "completed", finalOutputsByRoleId: { analyst: [{ data: { ok: true } }] }, finalOutputRoleOrder: ["analyst"], auditTrail: [{ roleId: "analyst", status: "completed", backend: "opencode", modelId: "model-a", profileId: "profile-a", toolRef: "tool.task.execute" }] }
  });

  await assert.rejects(useCases.createSimulation("team-root", "team-v1", { prompt: baseline.prompt, baselineScenarioId: "missing" }), /TEAM_RELEASE_BASELINE_NOT_FOUND/);
  const result = await useCases.createSimulation("team-root", "team-v1", { prompt: baseline.prompt, baselineScenarioId: baseline.scenarioId });
  assert.equal(result.simulation.mode, "sandbox");
  assert.deepEqual(
    { backend: result.state.auditTrail[0].backend, modelId: result.state.auditTrail[0].modelId, profileId: result.state.auditTrail[0].profileId, toolRef: result.state.auditTrail[0].toolRef },
    { backend: "opencode", modelId: "model-a", profileId: "profile-a", toolRef: "tool.task.execute" }
  );
  assert.equal(records.get("sim-1").simulation.baselineRevision, 2);
  assert.equal(records.get("sim-1").simulation.teamDigestVersion, 3);
  assert.equal(records.get("sim-1").simulation.owner.teamDigestVersion, 3);
  assert.equal(calls.at(-1)[2].mode, "sandbox");
  assert.equal((await useCases.validateReleaseEvidence("team-v1", canonicalDigest)).ok, true);
  records.get("sim-1").simulation.teamDigestVersion = 2;
  records.get("sim-1").simulation.owner.teamDigestVersion = 2;
  await assert.rejects(useCases.validateReleaseEvidence("team-v1", canonicalDigest), /TEAM_RELEASE_BASELINE_EVIDENCE_REQUIRED/);
  await assert.rejects(useCases.validateReleaseEvidence("team-v1", "0".repeat(64)), /TEAM_RELEASE_DIGEST_CHANGED/);
});

test("release baseline batch persists an idempotent running record and completes required scenarios", async () => {
  const scenario = {
    scenarioId: "release-smoke", name: "Release smoke", revision: 1, prompt: "Return JSON",
    expectedRoleIds: ["analyst"], materials: [], outputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }
  };
  const bundle = { team: { systemSource: "flow", design: { roles: { analyst: { name: "Analyst" } } }, releaseBaselineScenarios: [scenario] } };
  const selectedDigest = computeTeamPackageCoreDigest(bundle);
  const { useCases, batches } = createHarness({
    packageBundle: bundle,
    digest: selectedDigest,
    runResult: { status: "completed", finalOutputsByRoleId: { analyst: [{ data: { ok: true } }] }, finalOutputRoleOrder: ["analyst"], auditTrail: [{ roleId: "analyst", status: "completed" }] }
  });

  const started = await useCases.startReleaseBaselineBatch("team-v1", { mode: "all_required" });
  assert.equal(started.status, "running");
  assert.equal(started.items[0].status, "queued");
  assert.equal((await useCases.startReleaseBaselineBatch("team-v1", { mode: "all_required" })).batchId, started.batchId, "duplicate starts return the persisted active batch");

  let latest;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    latest = batches.get("team-v1");
    if (latest.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(latest.status, "completed");
  assert.equal(latest.items[0].status, "completed");
  assert.equal(latest.items[0].simulationId, "sim-1");
});

test("release baseline batch recovery only interrupts a confirmed dead same-host owner", async () => {
  const stale = {
    batchId: "batch-1", teamVersionId: "team-v1", status: "running", ownerPid: 1234, ownerHost: "test-host",
    items: [{ scenarioId: "release-smoke", status: "running" }, { scenarioId: "second", status: "queued" }]
  };
  const deadOwner = createHarness({ initialBatch: stale, processIsAlive: () => false });
  const recovered = await deadOwner.useCases.getReleaseBaselineBatchStatus("team-v1");
  assert.equal(recovered.batch.status, "failed");
  assert.equal(recovered.batch.failureCode, "BATCH_INTERRUPTED_BY_RESTART");
  assert.deepEqual(recovered.batch.items.map((item) => item.status), ["interrupted", "interrupted"]);

  const liveOwner = createHarness({ initialBatch: { ...stale, ownerHost: "remote-host" }, processIsAlive: () => false });
  const preserved = await liveOwner.useCases.getReleaseBaselineBatchStatus("team-v1");
  assert.equal(preserved.batch.status, "running", "remote PID state is not treated as proof of death");
});

test("release baseline cancellation stops queued scenarios after the active run completes", async () => {
  let finishRun;
  let signalStarted;
  const startedPromise = new Promise((resolve) => { signalStarted = resolve; });
  const runPromise = new Promise((resolve) => { finishRun = resolve; });
  const scenarios = ["release-one", "release-two"].map((scenarioId) => ({
    scenarioId, name: scenarioId, revision: 1, prompt: "Return JSON", expectedRoleIds: ["analyst"], materials: [], outputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }
  }));
  const bundle = { team: { systemSource: "flow", design: { roles: { analyst: { name: "Analyst" } } }, releaseBaselineScenarios: scenarios } };
  const { useCases, batches } = createHarness({
    packageBundle: bundle,
    digest: computeTeamPackageCoreDigest(bundle),
    runGate: { promise: runPromise, onStart: signalStarted },
    runResult: { status: "completed", finalOutputsByRoleId: { analyst: [{ data: { ok: true } }] }, finalOutputRoleOrder: ["analyst"], auditTrail: [{ roleId: "analyst", status: "completed" }] }
  });
  const started = await useCases.startReleaseBaselineBatch("team-v1", { mode: "all_required" });
  await startedPromise;
  await useCases.cancelReleaseBaselineBatch("team-v1", started.batchId);
  finishRun();

  let latest;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    latest = batches.get("team-v1");
    if (latest.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(latest.status, "cancelled");
  assert.deepEqual(latest.items.map((item) => item.status), ["completed", "cancelled"]);
});

test("release baseline batch invalidates evidence when the TeamVersion digest changes during a scenario", async () => {
  const scenario = {
    scenarioId: "release-smoke", name: "Release smoke", revision: 1, prompt: "Return JSON",
    expectedRoleIds: ["analyst"], materials: [], outputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }
  };
  const bundle = { team: { systemSource: "flow", design: { roles: { analyst: { name: "Analyst" } } }, releaseBaselineScenarios: [scenario] } };
  const { useCases, batches } = createHarness({
    packageBundle: bundle,
    dynamicDigest: true,
    mutateBundleOnRun: (candidate) => { candidate.team.systemSource = "changed during execution"; },
    runResult: { status: "completed", finalOutputsByRoleId: { analyst: [{ data: { ok: true } }] }, finalOutputRoleOrder: ["analyst"], auditTrail: [{ roleId: "analyst", status: "completed" }] }
  });
  const started = await useCases.startReleaseBaselineBatch("team-v1", { mode: "all_required" });
  let latest;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    latest = batches.get("team-v1");
    if (latest.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(latest.batchId, started.batchId);
  assert.equal(latest.status, "invalidated");
  assert.equal(latest.invalidationReason, "TEAM_OR_SCENARIO_DIGEST_CHANGED");
});

test("post-run digest check and batch result write share the TeamVersion lock", async () => {
  let finishRun;
  let signalRunStarted;
  const runStarted = new Promise((resolve) => { signalRunStarted = resolve; });
  const runPromise = new Promise((resolve) => { finishRun = resolve; });
  let signalEditAcquired;
  const editAcquired = new Promise((resolve) => { signalEditAcquired = resolve; });
  let releaseEdit;
  const editGate = new Promise((resolve) => { releaseEdit = resolve; });
  let signalBatchQueued;
  const batchQueued = new Promise((resolve) => { signalBatchQueued = resolve; });
  const scenario = {
    scenarioId: "release-smoke", name: "Release smoke", revision: 1, prompt: "Return JSON",
    expectedRoleIds: ["analyst"], materials: [], outputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }
  };
  const bundle = { team: { systemSource: "before-edit", design: { roles: { analyst: { name: "Analyst" } } }, releaseBaselineScenarios: [scenario] } };
  const { useCases, batches, withTeamVersionLock } = createHarness({
    packageBundle: bundle,
    dynamicDigest: true,
    runGate: { promise: runPromise, onStart: signalRunStarted },
    onLockQueued: () => signalBatchQueued?.(),
    runResult: { status: "completed", finalOutputsByRoleId: { analyst: [{ data: { ok: true } }] }, finalOutputRoleOrder: ["analyst"], auditTrail: [{ roleId: "analyst", status: "completed" }] }
  });
  const started = await useCases.startReleaseBaselineBatch("team-v1", { mode: "all_required" });
  await runStarted;
  const edit = withTeamVersionLock("team-root", async () => {
    signalEditAcquired();
    await editGate;
    bundle.team.systemSource = "edited while batch result waits for lock";
  });
  await editAcquired;
  finishRun();
  try {
    await batchQueued;
  } finally {
    releaseEdit();
    await edit;
  }

  let latest;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    latest = batches.get("team-v1");
    if (latest.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(latest.batchId, started.batchId);
  assert.equal(latest.status, "invalidated");
  assert.equal(latest.items[0].status, "interrupted", "the result must not be credited after the queued edit commits");
});

test("release baseline comparison selects a released parent and reports revision regression", async () => {
  const schema = { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } };
  const parentScenario = { scenarioId: "release-smoke", name: "Release smoke", revision: 1, prompt: "Parent prompt", expectedRoleIds: ["analyst"], materials: [], outputSchema: schema };
  const currentScenario = { ...parentScenario, revision: 2, prompt: "Changed prompt" };
  const parentBundle = { team: { systemSource: "parent", releaseBaselineScenarios: [parentScenario] } };
  const currentBundle = { team: { systemSource: "current", releaseBaselineScenarios: [currentScenario] } };
  const parentTeam = {
    projectId: "team-v0", teamId: "team-root", teamRootId: "team-root", teamVersionId: "team-v0", teamVersionNumber: 1,
    teamVersionStatus: "released", workdir: "/teams/team-v0"
  };
  const { useCases } = createHarness({
    team: { parentTeamVersionId: "team-v0", teamVersionNumber: 2 },
    siblingTeams: [parentTeam],
    siblingPackages: { "/teams/team-v0": parentBundle },
    packageBundle: currentBundle,
    digest: computeTeamPackageCoreDigest(currentBundle),
    runResult: { status: "completed", finalOutputsByRoleId: { analyst: [{ data: { ok: true } }] }, finalOutputRoleOrder: ["analyst"], auditTrail: [{ roleId: "analyst", status: "completed" }] }
  });
  await useCases.createSimulation("team-root", "team-v0", { prompt: parentScenario.prompt, baselineScenarioId: parentScenario.scenarioId });

  const comparison = await useCases.compareReleaseBaselines("team-v1", "parent_version");
  assert.equal(comparison.selectedTarget, "parent_version");
  assert.equal(comparison.availableTargets.parent_version.id, "team-v0");
  assert.deepEqual(comparison.scenarios[0], {
    scenarioId: "release-smoke",
    name: "Release smoke",
    revisionChanged: true,
    regression: true,
    current: { revision: 2, passed: false },
    target: { revision: 1, passed: true }
  });
});

test("release baseline proof rejects no-op, incomplete-role, and schema-invalid Sandbox results", async (t) => {
  const baseline = {
    scenarioId: "release-smoke", revision: 1, prompt: "Return JSON", expectedRoleIds: ["analyst", "reviewer"],
    materials: [], outputSchema: { type: "object", required: ["ok"], properties: { ok: { const: true } } }
  };
  const packageBundle = { team: { systemSource: "flow", releaseBaselineScenarios: [baseline] } };
  const canonicalDigest = computeTeamPackageCoreDigest(packageBundle);
  for (const [name, result] of [
    ["missing required role", { status: "completed", finalOutputsByRoleId: { analyst: [{ data: { ok: true } }] }, finalOutputRoleOrder: ["analyst"], auditTrail: [{ roleId: "analyst", status: "completed" }] }],
    ["noop role", { status: "completed", finalOutputsByRoleId: { analyst: [{ data: { ok: true } }] }, finalOutputRoleOrder: ["analyst"], auditTrail: [{ roleId: "analyst", status: "completed" }, { roleId: "reviewer", status: "noop", noop: true }] }],
    ["invalid schema", { status: "completed", finalOutputsByRoleId: { analyst: [{ data: { ok: false } }] }, finalOutputRoleOrder: ["analyst"], auditTrail: [{ roleId: "analyst", status: "completed" }, { roleId: "reviewer", status: "completed" }] }]
  ]) {
    await t.test(name, async () => {
      const { useCases, records } = createHarness({ packageBundle, digest: canonicalDigest, team: { teamVersionStatus: "draft" }, runResult: result });
      const run = await useCases.createSimulation("team-root", "team-v1", { prompt: baseline.prompt, baselineScenarioId: baseline.scenarioId });
      assert.equal(run.simulation.status, "failed");
      assert.equal(records.get("sim-1").simulation.status, "failed");
      await assert.rejects(useCases.validateReleaseEvidence("team-v1", canonicalDigest), /TEAM_RELEASE_BASELINE_EVIDENCE_REQUIRED/);
    });
  }
});

test("startup recovery is owned by TeamVersion inventory and the Studio store", async () => {
  const { useCases } = createHarness();
  const recovered = await useCases.recoverInterruptedSimulations();
  assert.equal(recovered.recoveredCount, 0);
  assert.deepEqual(recovered.simulations, []);
});
