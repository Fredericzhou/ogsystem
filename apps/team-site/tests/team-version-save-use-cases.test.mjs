import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createTeamVersionSaveUseCases } from "../application/team-version-save-use-cases.mjs";

const digestSnapshot = (value) => createHash("sha256").update(value).digest("hex");

function setup(status = "released", updateMetadata = async (team, changes) => Object.assign(team, changes, { projectDigest: null })) {
  const calls = [];
  const versions = new Map([
    ["v1", { projectId: "v1", teamVersionId: "v1", teamId: "team", teamRootId: "team", name: "Team", overview: "Goal", teamVersionStatus: status, projectDigest: status === "released" ? "digest-1" : null }]
  ]);
  const useCases = createTeamVersionSaveUseCases({
    teamCatalog: { getTeamVersion: async (id) => versions.get(id) },
    teamMetadataUseCases: {
      async updateTeamMetadata(id, changes) {
        calls.push(["metadata", id, changes]);
        return updateMetadata(versions.get(id), changes);
      }
    },
    lifecycleUseCases: {
      async forkTeamVersion() {
        const team = { ...versions.get("v1"), projectId: "v2", teamVersionId: "v2", teamVersionStatus: "draft", projectDigest: null };
        versions.set("v2", team);
        calls.push(["fork", "v1"]);
        return team;
      }
    },
    withTeamVersionSaveLock: async (_id, action) => action(),
    removeProject: async (id) => { calls.push(["remove", id]); versions.delete(id); },
    digestSnapshot
  });
  return { useCases, calls, versions };
}

test("saving unchanged released metadata does not fork", async () => {
  const { useCases, calls } = setup();
  const { expectedMetadataDigest } = await useCases.getTeamVersionForSave("v1");
  const saved = await useCases.saveTeamVersion("v1", { expectedMetadataDigest });
  assert.equal(saved.unchanged, true);
  assert.equal(saved.createdDraft, false);
  assert.deepEqual(calls, []);
});

test("metadata changes to a released TeamVersion fork once and update the new draft", async () => {
  const { useCases, calls, versions } = setup();
  const { expectedMetadataDigest } = await useCases.getTeamVersionForSave("v1");
  const saved = await useCases.saveTeamVersion("v1", { name: "Changed team", expectedMetadataDigest });
  assert.equal(saved.teamVersionId, "v2");
  assert.equal(saved.createdDraft, true);
  assert.equal(versions.get("v2").name, "Changed team");
  assert.deepEqual(calls.map(([operation]) => operation), ["fork", "metadata"]);
});

test("metadata-only draft edits update without forking", async () => {
  const { useCases, calls, versions } = setup("draft");
  const { expectedMetadataDigest } = await useCases.getTeamVersionForSave("v1");
  const saved = await useCases.saveTeamVersion("v1", { overview: "Updated goal", expectedMetadataDigest });
  assert.equal(saved.overview, "Updated goal");
  assert.equal(saved.teamVersionStatus, "draft");
  assert.equal(versions.get("v1").overview, "Updated goal");
  assert.deepEqual(calls.map(([operation]) => operation), ["metadata"]);
});

test("metadata-only draft edits reject stale metadata digests", async () => {
  const { useCases, versions } = setup("draft");
  const { expectedMetadataDigest } = await useCases.getTeamVersionForSave("v1");
  await useCases.saveTeamVersion("v1", { name: "First editor", expectedMetadataDigest });
  await assert.rejects(useCases.saveTeamVersion("v1", {
    name: "Stale editor",
    expectedMetadataDigest
  }), /TEAM_VERSION_DIGEST_CONFLICT/);
  assert.equal(versions.get("v1").name, "First editor");
});

test("legacy authoring, assets and scenario payloads fail closed before metadata writes", async () => {
  const { useCases, calls } = setup("draft");
  for (const field of ["authoring", "assets", "scenarios", "expectedTeamVersionDigest"]) {
    await assert.rejects(useCases.saveTeamVersion("v1", { [field]: {} }), /TEAM_IR_V2_REQUIRED/);
  }
  assert.deepEqual(calls, []);
});

test("metadata writer failure removes a newly forked draft", async () => {
  const { useCases, calls, versions } = setup("released", async () => { throw new Error("DISK_FULL"); });
  const { expectedMetadataDigest } = await useCases.getTeamVersionForSave("v1");
  await assert.rejects(useCases.saveTeamVersion("v1", { name: "Changed team", expectedMetadataDigest }), /DISK_FULL/);
  assert.deepEqual(calls.map(([operation]) => operation), ["fork", "metadata", "remove"]);
  assert.equal(versions.has("v2"), false);
});

test("archived TeamVersions reject metadata edits", async () => {
  const { useCases } = setup("archived");
  const { expectedMetadataDigest } = await useCases.getTeamVersionForSave("v1");
  await assert.rejects(useCases.saveTeamVersion("v1", { name: "Changed team", expectedMetadataDigest }), /TEAM_VERSION_IMMUTABLE/);
});
