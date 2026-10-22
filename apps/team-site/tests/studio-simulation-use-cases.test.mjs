import assert from "node:assert/strict";
import test from "node:test";
import { createStudioSimulationUseCases } from "../application/studio-simulation-use-cases.mjs";
import { computeReleaseBaselineDigest, computeTeamPackageCoreDigest } from "../infrastructure/package-integrity.mjs";

const packageBundle = { team: { systemSource: "flow" } };
const digest = computeTeamPackageCoreDigest(packageBundle);

function createHarness({ runResult, runError, team = {}, packageBundle: selectedPackageBundle = packageBundle, digest: selectedDigest = computeTeamPackageCoreDigest(selectedPackageBundle) } = {}) {
  const records = new Map();
  const calls = [];
  const teamVersion = {
    projectId: "team-v1",
    teamId: "team-root",
    teamVersionId: "team-v1",
    teamVersionStatus: "editing",
    teamCoreDigest: digest,
    workdir: "/teams/team-v1",
    ...team
  };
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
    }
  };
  const useCases = createStudioSimulationUseCases({
    teamCatalog: {
      getTeamVersion: async (id) => id === teamVersion.teamVersionId ? teamVersion : undefined,
      listTeamRepository: async () => [teamVersion]
    },
    teamPackageReader: {
      async exportTeamPackage(workdir) {
        calls.push(["export", workdir]);
        return selectedPackageBundle;
      }
    },
    packageIntegrity: { computeTeamPackageCoreDigest: () => selectedDigest, computeReleaseBaselineDigest },
    simulationStore,
    simulationRunner: {
      async simulate(selectedTeam, options) {
        calls.push(["run", selectedTeam.teamVersionId, options]);
        if (runError) throw runError;
        return runResult || { status: "completed", finalOutput: "result", auditTrail: [{ roleId: "analyst", status: "completed" }] };
      }
    },
    identifiers: { simulationId: () => "sim-1" },
    baselineStore: {
      async readReleaseBaselineScenarios() { return []; },
      async saveReleaseBaselineScenarios() { return []; }
    },
    now: (() => { let tick = 0; return () => `2026-01-01T00:00:0${tick++}.000Z`; })()
  });
  return { useCases, records, calls };
}

test("Studio Simulation creates its own owner record and stores completed state/events", async () => {
  const { useCases, records, calls } = createHarness();
  const created = await useCases.createSimulation("team-root", "team-v1", { prompt: "Analyze this task", locale: "en" });
  assert.equal(created.simulation.runKind, "studio_simulation");
  assert.equal(created.simulation.owner.kind, "studio_simulation");
  assert.equal(created.simulation.status, "completed");
  assert.equal(created.state.finalOutput, "result");
  assert.deepEqual(created.events.map((event) => event.type), ["simulation.started", "role.completed", "simulation.completed"]);
  assert.equal(records.get("sim-1").simulation.teamCoreDigest, digest);
  assert.deepEqual(calls.map((call) => call[0]), ["export", "create", "run"]);
  assert.equal(calls[2][2].simulationId, "sim-1");
  assert.deepEqual(calls[2][2].teamPackageBundle, packageBundle);
  assert.equal(calls[2][2].teamCoreDigest, digest);
  assert.deepEqual((await useCases.listTeamVersionSimulations("team-root", "team-v1")).simulations.map((item) => item.simulationId), ["sim-1"]);
  assert.equal((await useCases.getTeamVersionSimulationEvents("team-root", "team-v1", "sim-1")).events.length, 3);
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
  const { useCases } = createHarness({ runResult: { status: "failed", error: "harness returned api_key=returned-secret", finalOutput: "failed" } });
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
    runResult: { status: "completed", finalOutput: "{}", auditTrail: [{ roleId: "analyst", status: "completed" }] }
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
    runResult: { status: "completed", finalOutput: JSON.stringify({ ok: true }), auditTrail: [{ roleId: "analyst", status: "completed", backend: "opencode", modelId: "model-a", profileId: "profile-a", toolRef: "tool.task.execute" }] }
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

test("release baseline proof rejects no-op, incomplete-role, and schema-invalid Sandbox results", async (t) => {
  const baseline = {
    scenarioId: "release-smoke", revision: 1, prompt: "Return JSON", expectedRoleIds: ["analyst", "reviewer"],
    materials: [], outputSchema: { type: "object", required: ["ok"], properties: { ok: { const: true } } }
  };
  const packageBundle = { team: { systemSource: "flow", releaseBaselineScenarios: [baseline] } };
  const canonicalDigest = computeTeamPackageCoreDigest(packageBundle);
  for (const [name, result] of [
    ["missing required role", { status: "completed", finalOutput: '{"ok":true}', auditTrail: [{ roleId: "analyst", status: "completed" }] }],
    ["noop role", { status: "completed", finalOutput: '{"ok":true}', auditTrail: [{ roleId: "analyst", status: "completed" }, { roleId: "reviewer", status: "noop", noop: true }] }],
    ["invalid schema", { status: "completed", finalOutput: '{"ok":false}', auditTrail: [{ roleId: "analyst", status: "completed" }, { roleId: "reviewer", status: "completed" }] }]
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
