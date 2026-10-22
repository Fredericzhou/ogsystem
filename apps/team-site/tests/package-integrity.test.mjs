import assert from "node:assert/strict";
import test from "node:test";
import { computeTeamPackageCoreDigest } from "../infrastructure/package-integrity.mjs";

const base = {
  mode: "team-v2",
  releaseManifest: { generatedAt: "2026-01-01T00:00:00.000Z" },
  team: {
    systemSource: "flowchart TD\r\nA --> B\r\n",
    design: { schemaVersion: 1, bindings: { z: 1, a: 2 } },
    runtime: { executor: "opencode", roleRepo: "./og-roles", runsDir: "C:/outside", sharedDir: "C:/shared" },
    modelSelection: { defaults: { backend: "opencode", modelId: "model-a" } },
    modelCatalog: { generatedAt: "now", models: [{ modelId: "model-a" }] },
    userProfile: { userProfileId: "team.default", language: "zh-CN", style: "concise" },
    profiles: [{ profileId: "shell", command: "node", args: ["task.js"] }],
    tools: { tools: [{ toolId: "task", command: "node" }] },
    releaseBaselineScenarios: [{ scenarioId: "baseline", revision: 1, prompt: "run" }],
    executableFiles: [
      { path: "og-roles/roles/writer/prompt.md", content: "write\r\n" },
      { path: ".ogs/contracts/schemas/output.json", content: "{\"type\":\"object\"}" }
    ]
  }
};

test("TeamVersion digest covers execution assets and excludes mutable catalog and storage locations", () => {
  const digest = computeTeamPackageCoreDigest(base);
  assert.notEqual(computeTeamPackageCoreDigest({ ...base, team: { ...base.team, runtime: { ...base.team.runtime, executor: "other" } } }), digest);
  assert.notEqual(computeTeamPackageCoreDigest({ ...base, team: { ...base.team, modelSelection: { defaults: { backend: "opencode", modelId: "model-b" } } } }), digest);
  assert.notEqual(computeTeamPackageCoreDigest({ ...base, team: { ...base.team, profiles: [{ profileId: "shell", command: "bash" }] } }), digest);
  assert.notEqual(computeTeamPackageCoreDigest({ ...base, team: { ...base.team, releaseBaselineScenarios: [{ scenarioId: "baseline", revision: 2, prompt: "changed" }] } }), digest);
  assert.notEqual(computeTeamPackageCoreDigest({ ...base, team: { ...base.team, executableFiles: [{ ...base.team.executableFiles[0], content: "changed" }] } }), digest);
  assert.equal(computeTeamPackageCoreDigest({ ...base, releaseManifest: { generatedAt: "later" }, team: { ...base.team, modelCatalog: { generatedAt: "later", models: [] }, runtime: { ...base.team.runtime, runsDir: "/another/location", sharedDir: "/another/shared" } } }), digest);
});

test("TeamVersion digest canonicalizes JSON key order and text line endings while retaining team defaults", () => {
  const reordered = {
    team: {
      ...base.team,
      design: { bindings: { a: 2, z: 1 }, schemaVersion: 1 },
      systemSource: "flowchart TD\nA --> B\n"
    }
  };
  assert.equal(computeTeamPackageCoreDigest(reordered), computeTeamPackageCoreDigest(base));
  assert.notEqual(computeTeamPackageCoreDigest({ ...base, team: { ...base.team, userProfile: { userProfileId: "team.default", style: "detailed" } } }), computeTeamPackageCoreDigest(base));
  assert.equal(computeTeamPackageCoreDigest({ ...base, team: { ...base.team, tools: { tools: [{ toolId: "task", command: "node", apiKey: "secret-value" }] } } }), computeTeamPackageCoreDigest(base));
});

test("TeamVersion digest recomputes baseline identity from current content and excludes timestamps", () => {
  const scenario = {
    scenarioId: "baseline",
    revision: 1,
    prompt: "run",
    expectedRoleIds: ["writer"],
    outputSchema: { type: "object" },
    scenarioDigest: "stale-digest",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const digest = computeTeamPackageCoreDigest({ team: { ...base.team, releaseBaselineScenarios: [scenario] } });
  assert.notEqual(computeTeamPackageCoreDigest({
    team: { ...base.team, releaseBaselineScenarios: [{ ...scenario, prompt: "changed" }] }
  }), digest);
  assert.equal(computeTeamPackageCoreDigest({
    team: { ...base.team, releaseBaselineScenarios: [{ ...scenario, updatedAt: "2026-10-22T00:00:00.000Z" }] }
  }), digest);
});
