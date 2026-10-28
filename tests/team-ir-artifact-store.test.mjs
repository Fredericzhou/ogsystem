import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileTeamArtifactStore, MemoryTeamArtifactBackend, TeamArtifactError, TeamArtifactStore, teamArtifactMediaTypeMatches } from "../dist/team-ir/index.js";

function team() {
  return {
    runInput: { artifactSlots: { brief: { required: false, acceptedMediaTypes: ["text/*"], cardinality: "single" } } },
    runResult: { artifactSlots: { report: { required: false, acceptedMediaTypes: ["text/markdown"], cardinality: "single" } } },
    agents: [{
      id: "writer",
      inputPorts: { draft: { artifactSlots: { sources: { required: false, acceptedMediaTypes: ["text/uri-list"], cardinality: "single" } } } },
      outputPorts: { DONE: { artifactSlots: { report: { required: true, mediaTypes: ["text/markdown"], cardinality: "single" } } } }
    }]
  };
}

test("output registration validates declared slot and actual media type then exposes an opaque reference", async () => {
  const store = new TeamArtifactStore({ backend: new MemoryTeamArtifactBackend() });
  const owner = { projectId: "project-1", runId: "run-1" };
  const reference = await store.registerOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report", mediaType: "text/markdown; charset=utf-8", content: Buffer.from("# Report")
  });
  assert.match(reference.artifactId, /^art_[0-9a-f-]{36}$/);
  assert.equal(reference.artifactId.includes("#"), false);
  assert.equal(reference.mediaType, "text/markdown; charset=utf-8");
  assert.deepEqual(Object.keys(reference).sort(), ["artifactId", "mediaType"]);
  assert.equal("uri" in reference, false);
  assert.equal("credential" in reference, false);
  assert.deepEqual(await store.getReference(reference.artifactId), reference);
  await assert.rejects(store.registerOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report", mediaType: "application/json", content: Buffer.from("{}")
  }), (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_MEDIA_TYPE_INCOMPATIBLE");
  await assert.rejects(store.registerOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "missing", mediaType: "text/markdown", content: Buffer.from("x")
  }), (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_SLOT_UNKNOWN");
});

test("Run input registration requires caller authorization and matches the declared accepted media range", async () => {
  const store = new TeamArtifactStore({ backend: new MemoryTeamArtifactBackend() });
  await assert.rejects(store.registerRunInput({
    team: team(), projectId: "project-1", slotId: "brief", mediaType: "text/plain", content: Buffer.from("private"), authorizeUpload: () => false
  }), (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_ACCESS_DENIED");
  const reference = await store.registerRunInput({
    team: team(), projectId: "project-1", slotId: "brief", mediaType: "text/plain", content: Buffer.from("authorized"), authorizeUpload: () => true
  });
  assert.equal(reference.mediaType, "text/plain");
  const owner = { projectId: "project-1", runId: "run-1" };
  const bound = await store.bindRunInputAttachments({ team: team(), owner, attachments: { brief: reference } });
  assert.deepEqual(bound, { brief: reference });
  const resolver = await store.createInvocationResolver({ owner, allowedArtifacts: [reference] });
  assert.equal(Buffer.from(await resolver.read(reference.artifactId)).toString(), "authorized");
  await assert.rejects(store.bindRunInputAttachments({ team: team(), owner: { ...owner, projectId: "other-project" }, attachments: { brief: reference } }),
    (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_ACCESS_DENIED");
});

test("Task Artifact validation accepts only registered same-Project slot references and supported cardinality", async () => {
  const store = new TeamArtifactStore({ backend: new MemoryTeamArtifactBackend() });
  const reference = await store.registerRunInput({
    team: team(), projectId: "project-1", slotId: "brief", mediaType: "text/plain", content: Buffer.from("brief"), authorizeUpload: () => true
  });
  assert.deepEqual(await store.validateRunInputAttachments({ team: team(), projectId: "project-1", attachments: { brief: reference } }), { brief: reference });
  await assert.rejects(store.validateRunInputAttachments({ team: team(), projectId: "project-2", attachments: { brief: reference } }),
    (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_ACCESS_DENIED");
  await assert.rejects(store.validateRunInputAttachments({ team: team(), projectId: "project-1", attachments: { unknown: reference } }),
    (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_SLOT_UNKNOWN");
  await assert.rejects(store.validateRunInputAttachments({ team: team(), projectId: "project-1", attachments: { brief: { ...reference, mediaType: "text/html" } } }),
    (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_ACCESS_DENIED");
  const many = team();
  many.runInput.artifactSlots.brief.cardinality = "many";
  await assert.rejects(store.validateRunInputAttachments({ team: many, projectId: "project-1", attachments: { brief: reference } }),
    (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_CARDINALITY_UNSUPPORTED");
});

test("invocation resolver can read only explicitly allowed Artifacts and verifies content integrity", async () => {
  const blobs = new Map();
  const backend = {
    async put(id, bytes, metadata) { blobs.set(id, { content: Uint8Array.from(bytes), metadata: structuredClone(metadata) }); },
    async get(id) { const value = blobs.get(id); return value && { content: Uint8Array.from(value.content), metadata: structuredClone(value.metadata) }; },
    async bindRunInput() {},
    async getRunInputGrant() { return []; }
  };
  const store = new TeamArtifactStore({ backend });
  const owner = { projectId: "project-1", runId: "run-1" };
  const a = await store.registerOutput({ team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report", mediaType: "text/markdown", content: Buffer.from("approved") });
  const b = await store.registerOutput({ team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report", mediaType: "text/markdown", content: Buffer.from("secret") });
  const resolver = await store.createInvocationResolver({ owner, allowedArtifacts: [a] });
  assert.equal(Buffer.from(await resolver.read(a.artifactId)).toString(), "approved");
  await assert.rejects(resolver.read(b.artifactId), (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_ACCESS_DENIED");
  blobs.get(a.artifactId).content = Buffer.from("tampered");
  await assert.rejects(resolver.read(a.artifactId), (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_INTEGRITY_FAILED");
});

test("artifact media type matching supports exact and wildcard ranges", () => {
  assert.equal(teamArtifactMediaTypeMatches("text/markdown", "text/*"), true);
  assert.equal(teamArtifactMediaTypeMatches("application/json", "text/*"), false);
  assert.equal(teamArtifactMediaTypeMatches("text/plain", "not-a-media-type"), false);
});

test("registered Artifact media type cannot be a wildcard", async () => {
  const store = new TeamArtifactStore({ backend: new MemoryTeamArtifactBackend() });
  const owner = { projectId: "project-1", runId: "run-1" };
  await assert.rejects(store.registerOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report", mediaType: "text/*", content: Buffer.from("x")
  }), (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_MEDIA_TYPE_INVALID");
});

test("FileTeamArtifactStore persists blob, metadata, Project ownership and Run grant across instances", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = new FileTeamArtifactStore(root);
  const ref = await first.registerRunInput({
    team: team(), projectId: "project-1", slotId: "brief", mediaType: "text/plain", content: Buffer.from("persisted"), authorizeUpload: () => true
  });
  const owner = { projectId: "project-1", runId: "run-1" };
  await first.bindRunInputAttachments({ team: team(), owner, attachments: { brief: ref } });
  const second = new FileTeamArtifactStore(root);
  const resolver = await second.createInvocationResolver({ owner, allowedArtifacts: [ref] });
  assert.equal(Buffer.from(await resolver.read(ref.artifactId)).toString(), "persisted");
  await assert.rejects(second.createInvocationResolver({ owner: { ...owner, projectId: "project-2" }, allowedArtifacts: [ref] }),
    (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_REFERENCE_INVALID");
  const fileList = await readFile(join(root, "index", `${ref.artifactId}.json`), "utf8");
  assert.equal(fileList.includes("persisted"), false);
  assert.equal(fileList.includes("contentDigest"), true);
});

test("Run input Artifact grants are immutable, idempotent, and linearized across File store instances", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-artifact-grant-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const owner = { projectId: "project-1", runId: "run-1" };
  const first = new FileTeamArtifactStore(root);
  const second = new FileTeamArtifactStore(root);
  const firstRef = await first.registerRunInput({
    team: team(), projectId: owner.projectId, slotId: "brief", mediaType: "text/plain", content: Buffer.from("first"), authorizeUpload: () => true
  });
  const secondRef = await second.registerRunInput({
    team: team(), projectId: owner.projectId, slotId: "brief", mediaType: "text/plain", content: Buffer.from("second"), authorizeUpload: () => true
  });

  const contenders = await Promise.allSettled([
    first.bindRunInputAttachments({ team: team(), owner, attachments: { brief: firstRef } }),
    second.bindRunInputAttachments({ team: team(), owner, attachments: { brief: secondRef } })
  ]);
  assert.equal(contenders.filter((item) => item.status === "fulfilled").length, 1);
  const rejected = contenders.find((item) => item.status === "rejected");
  assert.equal(rejected.reason.code, "ARTIFACT_RUN_INPUT_CONFLICT");
  const winner = contenders.find((item) => item.status === "fulfilled").value.brief;
  const loser = winner.artifactId === firstRef.artifactId ? secondRef : firstRef;
  assert.deepEqual(await second.bindRunInputAttachments({ team: team(), owner, attachments: { brief: winner } }), { brief: winner });
  await assert.rejects(second.bindRunInputAttachments({ team: team(), owner, attachments: { brief: loser } }),
    (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_RUN_INPUT_CONFLICT");

  const resolver = await second.createInvocationResolver({ owner, allowedArtifacts: [winner] });
  assert.equal(Buffer.from(await resolver.read(winner.artifactId)).toString(), winner.artifactId === firstRef.artifactId ? "first" : "second");
  await assert.rejects(second.createInvocationResolver({ owner, allowedArtifacts: [loser] }),
    (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_REFERENCE_INVALID");
});
