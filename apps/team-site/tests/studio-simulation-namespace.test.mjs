import assert from "node:assert/strict";
import { test } from "node:test";
import { createStudioSimulationUseCases } from "../application/studio-simulation-use-cases.mjs";

function createUseCases(team) {
  return createStudioSimulationUseCases({
    teamCatalog: { getTeamVersion: async () => team },
    teamPackageReader: { exportTeamPackage: async () => ({}) },
    packageIntegrity: {
      computeTeamPackageCoreDigest: () => "a".repeat(64),
      computeTrainingBaselineDigest: () => "b".repeat(64)
    },
    simulationStore: {
      createSimulation: async () => undefined,
      updateSimulation: async () => undefined,
      getSimulationEvidence: async () => undefined,
      listVersionSimulations: async () => []
    },
    simulationRunner: { simulate: async () => undefined },
    identifiers: { simulationId: () => "simulation-1" }
  });
}

test("Studio Simulation rejects a Collaboration Project namespace", async () => {
  const useCases = createUseCases({
    projectId: "project-1",
    projectType: "collaboration",
    teamId: "project-1",
    teamVersionId: "project-1"
  });

  await assert.rejects(
    useCases.listTeamVersionSimulations("project-1", "project-1"),
    /STUDIO_SIMULATION_NOT_FOUND/
  );
});

test("TeamVersion training requires a valid baseline Evidence Manifest but not a materialization", async () => {
  const team = {
    projectId: "team-v1",
    teamId: "team",
    teamVersionId: "team-v1",
    teamVersionStatus: "draft",
    workdir: "/private/team-v1"
  };
  const scenario = {
    scenarioId: "smoke",
    revision: 1,
    scenarioDigest: "b".repeat(64),
    requiredForTraining: true,
    expectedRoleIds: ["worker"],
    outputSchema: { type: "object" }
  };
  const run = {
    simulationId: "simulation-1",
    teamId: "team",
    teamVersionId: "team-v1",
    teamCoreDigest: "a".repeat(64),
    teamDigestVersion: 3,
    mode: "sandbox",
    runKind: "studio_simulation",
    status: "completed",
    baselineScenarioId: "smoke",
    baselineRevision: 1,
    baselineScenarioDigest: "b".repeat(64),
    owner: {
      kind: "studio_simulation",
      teamId: "team",
      teamVersionId: "team-v1",
      simulationId: "simulation-1",
      teamCoreDigest: "a".repeat(64),
      teamDigestVersion: 3
    }
  };
  let manifestVerified = false;
  const useCases = createStudioSimulationUseCases({
    teamCatalog: { getTeamVersion: async () => team },
    teamPackageReader: { exportTeamPackage: async () => ({ team: { trainingBaselineScenarios: [scenario] } }) },
    packageIntegrity: {
      computeTeamPackageCoreDigest: () => "a".repeat(64),
      computeTrainingBaselineDigest: () => "b".repeat(64)
    },
    simulationStore: {
      createSimulation: async () => undefined,
      updateSimulation: async () => undefined,
      getSimulationEvidence: async () => ({
        simulation: { teamId: "team", baselineScenarioDigest: "b".repeat(64) },
        state: {
          status: "completed",
          finalOutputsByRoleId: { worker: [{ content: "done" }] },
          auditTrail: [{ roleId: "worker", status: "completed" }]
        }
      }),
      listVersionSimulations: async () => [run],
      async readSimulationArtifact(_teamVersionId, _simulationId, path) {
        assert.equal(path, "evidence-manifest.json");
        manifestVerified = true;
        return { content: "{}" };
      }
    },
    simulationRunner: { simulate: async () => undefined },
    identifiers: { simulationId: () => "simulation-2" }
  });

  const result = await useCases.validateTrainingEvidence("team-v1", "a".repeat(64));
  assert.equal(manifestVerified, true);
  assert.deepEqual(result.passedScenarioIds, ["smoke"]);
  assert.equal(Object.hasOwn(result, "materialization"), false);
});

test("TeamVersion training rejects baseline evidence with an unverifiable Evidence Manifest", async () => {
  const team = {
    projectId: "team-v1", teamId: "team", teamVersionId: "team-v1", teamVersionStatus: "draft", workdir: "/private/team-v1"
  };
  const scenario = {
    scenarioId: "smoke", revision: 1, scenarioDigest: "b".repeat(64), requiredForTraining: true,
    expectedRoleIds: ["worker"], outputSchema: { type: "object" }
  };
  const run = {
    simulationId: "simulation-1", teamId: "team", teamVersionId: "team-v1", teamCoreDigest: "a".repeat(64),
    teamDigestVersion: 3, mode: "sandbox", runKind: "studio_simulation", status: "completed",
    baselineScenarioId: "smoke", baselineRevision: 1, baselineScenarioDigest: "b".repeat(64),
    owner: { kind: "studio_simulation", teamId: "team", teamVersionId: "team-v1", simulationId: "simulation-1", teamCoreDigest: "a".repeat(64), teamDigestVersion: 3 }
  };
  const useCases = createStudioSimulationUseCases({
    teamCatalog: { getTeamVersion: async () => team },
    teamPackageReader: { exportTeamPackage: async () => ({ team: { trainingBaselineScenarios: [scenario] } }) },
    packageIntegrity: { computeTeamPackageCoreDigest: () => "a".repeat(64), computeTrainingBaselineDigest: () => "b".repeat(64) },
    simulationStore: {
      createSimulation: async () => undefined,
      updateSimulation: async () => undefined,
      getSimulationEvidence: async () => ({
        simulation: { teamId: "team", baselineScenarioDigest: "b".repeat(64) },
        state: { status: "completed", finalOutputsByRoleId: { worker: [{ content: "done" }] }, auditTrail: [{ roleId: "worker", status: "completed" }] }
      }),
      listVersionSimulations: async () => [run],
      async readSimulationArtifact() { throw new Error("STUDIO_SIMULATION_EVIDENCE_MANIFEST_REFERENCE_NOT_FOUND"); }
    },
    simulationRunner: { simulate: async () => undefined },
    identifiers: { simulationId: () => "simulation-2" }
  });

  await assert.rejects(useCases.validateTrainingEvidence("team-v1", "a".repeat(64)), /TEAM_TRAINING_BASELINE_EVIDENCE_REQUIRED/);
});
