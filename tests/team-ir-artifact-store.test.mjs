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
    async commitOutput(id, publicationId) {
      const stored = blobs.get(id);
      if (!stored || stored.metadata.publicationId !== publicationId) throw new Error("publication mismatch");
      stored.metadata.publicationState = "committed";
    },
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

test("prepared output Artifacts remain private until the publication intent commits", async () => {
  const backend = new MemoryTeamArtifactBackend();
  const store = new TeamArtifactStore({ backend });
  const owner = { projectId: "project-1", runId: "run-1" };
  const publicationId = "publication-1";
  const reference = await store.prepareOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
    mediaType: "text/markdown", content: Buffer.from("prepared"), publicationId
  });
  assert.equal(await store.getReference(reference.artifactId), undefined);
  await assert.rejects(store.createInvocationResolver({ owner, allowedArtifacts: [reference] }),
    (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_REFERENCE_INVALID");
  await store.commitOutput({ owner, reference, publicationId });
  await store.commitOutput({ owner, reference, publicationId });
  assert.deepEqual(await store.getReference(reference.artifactId), reference);
  const resolver = await store.createInvocationResolver({ owner, allowedArtifacts: [reference] });
  assert.equal(Buffer.from(await resolver.read(reference.artifactId)).toString(), "prepared");
});

test("abort removes only a matching prepared output and preserves committed outputs and Run inputs", async () => {
  const backend = new MemoryTeamArtifactBackend();
  const store = new TeamArtifactStore({ backend });
  const owner = { projectId: "project-1", runId: "run-1" };
  const prepared = await store.prepareOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
    mediaType: "text/markdown", content: Buffer.from("prepared"), publicationId: "publication-abort"
  });
  await store.abortOutput({ owner, reference: prepared, publicationId: "publication-abort" });
  await store.abortOutput({ owner, reference: prepared, publicationId: "publication-abort" });
  assert.equal(await store.getReference(prepared.artifactId), undefined);
  await assert.rejects(store.commitOutput({ owner, reference: prepared, publicationId: "publication-abort" }),
    (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_PUBLICATION_INVALID");

  const committed = await store.registerOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
    mediaType: "text/markdown", content: Buffer.from("committed")
  });
  await assert.rejects(store.abortOutput({ owner, reference: committed, publicationId: "publication-abort" }),
    (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_PUBLICATION_INVALID");
  const input = await store.registerRunInput({
    team: team(), projectId: owner.projectId, slotId: "brief", mediaType: "text/plain", content: Buffer.from("input"), authorizeUpload: () => true
  });
  await assert.rejects(store.abortOutput({ owner, reference: input, publicationId: "publication-abort" }),
    (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_PUBLICATION_INVALID");
  assert.equal(Buffer.from(await (await store.createInvocationResolver({ owner, allowedArtifacts: [committed] })).read(committed.artifactId)).toString(), "committed");
});

test("File Artifact abort removes both prepared index and blob", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-artifact-abort-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new FileTeamArtifactStore(root);
  const owner = { projectId: "project-1", runId: "run-1" };
  const reference = await store.prepareOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
    mediaType: "text/markdown", content: Buffer.from("prepared"), publicationId: "publication-file-abort"
  });
  await store.abortOutput({ owner, reference, publicationId: "publication-file-abort" });
  await assert.rejects(readFile(join(root, "index", `${reference.artifactId}.json`)), { code: "ENOENT" });
  await assert.rejects(readFile(join(root, "projects", owner.projectId, "runs", owner.runId, "artifacts", `${reference.artifactId}.bin`)), { code: "ENOENT" });
});

test("File Artifact abort cleans blob-only and index-only prepared writes", async (t) => {
  for (const partial of ["blob-only", "index-only"]) {
    await t.test(partial, async (t) => {
      const root = await mkdtemp(join(tmpdir(), `team-ir-artifact-${partial}-`));
      t.after(() => rm(root, { recursive: true, force: true }));
      const store = new FileTeamArtifactStore(root);
      const owner = { projectId: "project-1", runId: "run-1" };
      const reference = await store.prepareOutput({
        team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
        mediaType: "text/markdown", content: Buffer.from("prepared"), publicationId: `publication-${partial}`
      });
      const indexPath = join(root, "index", `${reference.artifactId}.json`);
      const blobPath = join(root, "projects", owner.projectId, "runs", owner.runId, "artifacts", `${reference.artifactId}.bin`);
      await rm(partial === "blob-only" ? indexPath : blobPath, { force: true });
      await store.abortOutput({ owner, reference, publicationId: `publication-${partial}` });
      await assert.rejects(readFile(indexPath), { code: "ENOENT" });
      await assert.rejects(readFile(blobPath), { code: "ENOENT" });
    });
  }
});

test("blob and index write interruptions never expose an uncommitted Artifact", async (t) => {
  for (const faultPoint of ["after-blob", "after-index"]) {
    await t.test(faultPoint, async () => {
      const blobs = new Map();
      const index = new Map();
      const backend = {
        async put(id, content, metadata) {
          blobs.set(id, Uint8Array.from(content));
          if (faultPoint === "after-blob") throw new Error("injected blob write interruption");
          index.set(id, structuredClone(metadata));
          throw new Error("injected index write interruption");
        },
        async commitOutput() { throw new Error("must not commit an interrupted prepare"); },
        async get(id) {
          const metadata = index.get(id);
          return metadata && { content: Uint8Array.from(blobs.get(id)), metadata: structuredClone(metadata) };
        },
        async bindRunInput() {},
        async getRunInputGrant() { return []; }
      };
      const store = new TeamArtifactStore({ backend });
      const owner = { projectId: "project-1", runId: `run-${faultPoint}` };
      await assert.rejects(store.prepareOutput({
        team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
        mediaType: "text/markdown", content: Buffer.from("interrupted"), publicationId: `pub-${faultPoint}`
      }));
      if (index.size) {
        const [storedId] = index.keys();
        await assert.rejects(store.createInvocationResolver({ owner, allowedArtifacts: [{ artifactId: storedId, mediaType: "text/markdown" }] }),
          (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_REFERENCE_INVALID");
      }
      assert.equal(blobs.size, 1);
      assert.equal(index.size, faultPoint === "after-index" ? 1 : 0);
    });
  }
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
