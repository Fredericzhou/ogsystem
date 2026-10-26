import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createTeamVersionSaveUseCases } from "../application/team-version-save-use-cases.mjs";

const digestSnapshot = (value) => createHash("sha256").update(value).digest("hex");

function setup(status = "released", validationResult = { ok: true }) {
  const calls = [];
  const versions = new Map([
    ["v1", { projectId: "v1", teamVersionId: "v1", teamId: "team", teamRootId: "team", name: "Team", overview: "Goal", teamVersionStatus: status, projectDigest: status === "released" ? "digest-1" : null }]
  ]);
  const design = new Map([["v1", { authoring: { roles: { planner: { name: "规划师" } } } }]]);
  const assets = new Map([["v1", { roles: {}, contracts: "", contractSchemas: {} }]]);
  const validationAssets = [];
  const designUseCases = {
    async getTeamDesign(id) { return { ...design.get(id), teamVersionDigest: versions.get(id)?.projectDigest }; },
    async getTeamDesignAssets(id) { return assets.get(id); },
    async validateTeamDesign(id) { validationAssets.push(structuredClone(assets.get(id))); return validationResult; },
    async getReleaseBaselineScenarios() { return { scenarios: [] }; },
    async saveTeamDesignAssets(id, body) { calls.push(["assets", id]); assets.set(id, { contracts: "", ...body.assets }); },
    async saveTeamDesign(id, body) {
      calls.push(["design", id]);
      if (body.expectedTeamVersionDigest && body.expectedTeamVersionDigest !== versions.get(id).projectDigest) throw new Error("unexpected stale digest");
      design.set(id, { authoring: body.authoring });
      return { teamVersionDigest: versions.get(id).projectDigest };
    },
    async updateTeamMetadata(id, body) {
      calls.push(["metadata", id]);
      Object.assign(versions.get(id), body, { projectDigest: null });
    },
    async saveReleaseBaselineScenarios() {}
  };
  const useCases = createTeamVersionSaveUseCases({
    teamCatalog: { getTeamVersion: async (id) => versions.get(id) },
    designUseCases,
    lifecycleUseCases: {
      async forkTeamVersion() {
        const team = { ...versions.get("v1"), projectId: "v2", teamVersionId: "v2", teamVersionStatus: "draft", projectDigest: null };
        versions.set("v2", team);
        design.set("v2", structuredClone(design.get("v1")));
        assets.set("v2", structuredClone(assets.get("v1")));
        calls.push(["fork", "v1"]);
        return team;
      }
    },
    withTeamVersionSaveLock: async (_id, action) => action(),
    removeProject: async (id) => { calls.push(["remove", id]); versions.delete(id); },
    digestSnapshot
  });
  return { useCases, calls, versions, assets, design, validationAssets };
}

test("saving unchanged released content does not fork", async () => {
  const { useCases, calls } = setup();
  const { expectedMetadataDigest } = await useCases.getTeamVersionForSave("v1");
  const saved = await useCases.saveTeamVersion("v1", { expectedMetadataDigest });
  assert.equal(saved.unchanged, true);
  assert.equal(saved.createdDraft, false);
  assert.equal(calls.some(([operation]) => operation === "fork"), false);
});

test("invalid changed candidate rolls back a newly forked draft", async () => {
  const { useCases, calls } = setup("released", { ok: false, diagnostics: [{ message: "Invalid topology" }] });
  await assert.rejects(useCases.saveTeamVersion("v1", {
    expectedTeamVersionDigest: "digest-1",
    authoring: { roles: {} }
  }), /TEAM_DESIGN_INVALID: Invalid topology/);
  assert.deepEqual(calls.map(([operation]) => operation), ["fork", "remove"]);
});

test("first changed save forks once and applies metadata after the design digest write", async () => {
  const { useCases, calls } = setup();
  const saved = await useCases.saveTeamVersion("v1", {
    expectedTeamVersionDigest: "digest-1",
    name: "Changed team",
    authoring: { roles: { planner: { name: "规划师" }, reviewer: { name: "审核师" } } }
  });
  assert.equal(saved.teamVersionId, "v2");
  assert.equal(saved.createdDraft, true);
  assert.deepEqual(calls.map(([operation]) => operation), ["fork", "design", "metadata"]);
});

test("saving changes to a draft updates it without forking", async () => {
  const { useCases, calls } = setup("draft");
  const { expectedMetadataDigest } = await useCases.getTeamVersionForSave("v1");
  const saved = await useCases.saveTeamVersion("v1", { overview: "Updated goal", expectedMetadataDigest });
  assert.equal(saved.teamVersionId, "v1");
  assert.equal(saved.createdDraft, false);
  assert.equal(calls.some(([operation]) => operation === "fork"), false);
});

test("metadata-only draft edits do not revalidate unchanged role assets", async () => {
  const { useCases, calls } = setup("draft", { ok: false, diagnostics: [{ message: "Unchanged asset is invalid" }] });
  const { expectedMetadataDigest } = await useCases.getTeamVersionForSave("v1");
  const saved = await useCases.saveTeamVersion("v1", { overview: "Updated goal", expectedMetadataDigest });
  assert.equal(saved.overview, "Updated goal");
  assert.equal(saved.teamVersionStatus, "draft");
  assert.deepEqual(calls, [["metadata", "v1"]]);
});

test("invalid design validation leaves an existing draft's persisted assets unchanged", async () => {
  const { useCases, calls, assets } = setup("draft", { ok: false, diagnostics: [{ message: "Invalid topology" }] });
  const { saveSnapshotDigest } = await useCases.getTeamDesignForSave("v1");
  await assert.rejects(useCases.saveTeamVersion("v1", {
    expectedTeamVersionDigest: saveSnapshotDigest,
    authoring: { roles: {} },
    assets: { roles: { planner: { "prompt.md": "changed" } } }
  }), /TEAM_DESIGN_INVALID/);
  assert.deepEqual(calls.map(([operation]) => operation), ["assets", "assets"]);
  assert.deepEqual(assets.get("v1"), { roles: {}, contracts: "", contractSchemas: {} });
});

test("design validation sees candidate contracts and schemas before validating their references", async () => {
  const { useCases, validationAssets } = setup("draft");
  const { saveSnapshotDigest } = await useCases.getTeamDesignForSave("v1");
  const candidateAssets = {
    roles: {},
    contracts: JSON.stringify({ contracts: [{ id: "handoff", schema: "schemas/handoff.json" }] }),
    contractSchemas: { "schemas/handoff.json": JSON.stringify({ type: "object" }) }
  };
  await useCases.saveTeamVersion("v1", {
    expectedTeamVersionDigest: saveSnapshotDigest,
    authoring: { roles: { planner: { name: "规划师" } }, system: { handoffContracts: ".ogs/contracts/handoff.json" } },
    assets: candidateAssets
  });
  assert.deepEqual(validationAssets[0], candidateAssets);
});

test("draft saves reject stale snapshots when projectDigest is null", async () => {
  const { useCases, versions, design } = setup("draft");
  versions.get("v1").projectDigest = null;
  const { saveSnapshotDigest } = await useCases.getTeamDesignForSave("v1");
  const firstAuthoring = { roles: { planner: { name: "First editor" } } };

  await assert.rejects(useCases.saveTeamVersion("v1", { authoring: firstAuthoring }), /TEAM_VERSION_DIGEST_REQUIRED/);
  const firstSave = await useCases.saveTeamVersion("v1", {
    authoring: firstAuthoring,
    expectedTeamVersionDigest: saveSnapshotDigest
  });
  assert.notEqual(firstSave.teamVersionDigest, saveSnapshotDigest);
  await assert.rejects(useCases.saveTeamVersion("v1", {
    authoring: { roles: { planner: { name: "Stale editor" } } },
    expectedTeamVersionDigest: saveSnapshotDigest
  }), /TEAM_VERSION_DIGEST_CONFLICT/);
  assert.deepEqual(design.get("v1").authoring, firstAuthoring);
});

test("metadata-only draft saves reject a stale metadata digest", async () => {
  const { useCases, versions } = setup("draft");
  const { expectedMetadataDigest } = await useCases.getTeamVersionForSave("v1");
  await useCases.saveTeamVersion("v1", { name: "First editor", expectedMetadataDigest });
  await assert.rejects(useCases.saveTeamVersion("v1", {
    name: "Stale editor",
    expectedMetadataDigest
  }), /TEAM_VERSION_DIGEST_CONFLICT/);
  assert.equal(versions.get("v1").name, "First editor");
});

test("corrupted baseline scenario file throws instead of being masked as empty", async () => {
  const { useCases } = setup("draft");
  // Override baseline reader to throw a malformed error
  const failingUseCases = createTeamVersionSaveUseCases({
    teamCatalog: { getTeamVersion: async () => ({ projectId: "v1", teamVersionId: "v1", teamRootId: "team", name: "Team", teamVersionStatus: "draft", projectDigest: "d1" }) },
    designUseCases: {
      getTeamDesign: async () => ({ authoring: {} }),
      getTeamDesignAssets: async () => ({}),
      validateTeamDesign: async () => ({ ok: true }),
      getReleaseBaselineScenarios: async () => { throw new Error("TEAM_RELEASE_BASELINES_INVALID: release baseline file is malformed."); },
      saveTeamDesignAssets: async () => {},
      saveTeamDesign: async () => ({}),
      updateTeamMetadata: async () => {}
    },
    lifecycleUseCases: { forkTeamVersion: async () => {} },
    withTeamVersionSaveLock: async (_id, action) => action(),
    removeProject: async () => {},
    digestSnapshot
  });
  await assert.rejects(failingUseCases.saveTeamVersion("v1", {
    expectedTeamVersionDigest: "d1",
    authoring: { roles: { a: {} } }
  }), /TEAM_RELEASE_BASELINES_INVALID/);
});

test("saveTeamDesign failure rolls back previously written assets on existing draft", async () => {
  const { useCases, calls, assets } = setup("draft");
  assets.set("v1", { roles: { planner: { "prompt.md": "initial" } } });
  // Make saveTeamDesign throw
  const failingUseCases = createTeamVersionSaveUseCases({
    teamCatalog: { getTeamVersion: async () => ({ projectId: "v1", teamVersionId: "v1", teamRootId: "team", name: "Team", teamVersionStatus: "draft", projectDigest: "d1" }) },
    designUseCases: {
      getTeamDesign: async () => ({ authoring: { v: 1 } }),
      getTeamDesignAssets: async () => structuredClone(assets.get("v1")),
      validateTeamDesign: async () => ({ ok: true }),
      getReleaseBaselineScenarios: async () => ({ scenarios: [] }),
      saveTeamDesignAssets: async (id, body) => { calls.push(["assets", body.assets]); assets.set(id, body.assets); },
      saveTeamDesign: async () => { throw new Error("DISK_FULL: simulated design write failure"); },
      updateTeamMetadata: async () => {}
    },
    lifecycleUseCases: { forkTeamVersion: async () => {} },
    withTeamVersionSaveLock: async (_id, action) => action(),
    removeProject: async () => {},
    digestSnapshot
  });

  const { saveSnapshotDigest } = await failingUseCases.getTeamDesignForSave("v1");
  await assert.rejects(failingUseCases.saveTeamVersion("v1", {
    expectedTeamVersionDigest: saveSnapshotDigest,
    authoring: { v: 2 },
    assets: { roles: { planner: { "prompt.md": "mutated" } } }
  }), /DISK_FULL/);

  // Assert assets were restored to initial
  assert.deepEqual(assets.get("v1"), { roles: { planner: { "prompt.md": "initial" } } });
});
