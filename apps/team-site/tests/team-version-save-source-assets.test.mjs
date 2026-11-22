import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createTeamVersionSaveUseCases } from "../application/team-version-save-use-cases.mjs";

const digestSnapshot = (value) => createHash("sha256").update(value).digest("hex");

test("TeamVersion design saves omit managed role source metadata and preserve it on disk", async () => {
  const team = {
    projectId: "team-draft",
    teamVersionId: "team-draft",
    teamVersionStatus: "draft",
    name: "Draft team",
    overview: "A team",
    projectDigest: null
  };
  const source = JSON.stringify({ sourceId: "role-source-1", commit: "abc123" });
  const assets = {
    roles: { writer: { "agent.md": "Writer", "source.json": source } },
    contracts: "",
    contractSchemas: {}
  };
  let authoring = { version: 2, roles: { writer: { title: "Writer" } } };
  let submittedAssets;
  const designUseCases = {
    async getTeamDesign() { return { authoring }; },
    async getTeamDesignAssets() { return structuredClone(assets); },
    async getTrainingBaselineScenarios() { return { scenarios: [] }; },
    async saveTeamDesignAssets(_id, body) {
      submittedAssets = structuredClone(body.assets);
      for (const [roleId, files] of Object.entries(body.assets.roles || {})) {
        assets.roles[roleId] = { ...assets.roles[roleId], ...files };
      }
    },
    async validateTeamDesign() { return { ok: true }; },
    async saveTeamDesign(_id, body) { authoring = body.authoring; },
    async updateTeamMetadata() {},
    async saveTrainingBaselineScenarios() {}
  };
  const useCases = createTeamVersionSaveUseCases({
    teamCatalog: { getTeamVersion: async () => team },
    designUseCases,
    lifecycleUseCases: { forkTeamVersion: async () => team },
    withTeamVersionSaveLock: async (_id, action) => action(),
    removeProject: async () => {},
    digestSnapshot
  });
  const { saveSnapshotDigest } = await useCases.getTeamDesignForSave("team-draft");

  await useCases.saveTeamVersion("team-draft", {
    expectedTeamVersionDigest: saveSnapshotDigest,
    authoring: { version: 2, roles: { writer: { title: "Technical writer" } } },
    assets
  });

  assert.equal(submittedAssets.roles.writer["source.json"], undefined);
  assert.equal(submittedAssets.roles.writer["agent.md"], "Writer");
  assert.equal(assets.roles.writer["source.json"], source);
});
