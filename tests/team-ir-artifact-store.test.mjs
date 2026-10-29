import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const publications = new Map();
  const backend = {
    async reservePublication(owner, invocationId, publicationId) {
      const key = `${owner.projectId}:${owner.runId}:${publicationId}`;
      const existing = publications.get(key);
      if (existing) return structuredClone(existing.token);
      const token = { ...owner, invocationId, publicationId, fencingGeneration: 1 };
      publications.set(key, { token, state: "reserved", artifacts: [] });
      return structuredClone(token);
    },
    async activatePublication(token, ids) {
      const item = publications.get(`${token.projectId}:${token.runId}:${token.publicationId}`);
      item.state = "pending";
      assert.deepEqual([...item.artifacts].sort(), [...ids].sort());
    },
    async finishPublication(token) { publications.get(`${token.projectId}:${token.runId}:${token.publicationId}`).state = "committed"; },
    async abortPublication(token) { publications.get(`${token.projectId}:${token.runId}:${token.publicationId}`).state = "aborted"; },
    async recoverPublications() { return []; },
    async put(id, bytes, metadata) {
      publications.get(`${metadata.projectId}:${metadata.runId}:${metadata.publicationId}`).artifacts.push(id);
      blobs.set(id, { content: Uint8Array.from(bytes), metadata: structuredClone(metadata) });
    },
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
  const reservation = await store.reserveOutputPublication({ owner, invocationId: "writer-invocation", publicationId });
  const reference = await store.prepareOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
    mediaType: "text/markdown", content: Buffer.from("prepared"), publicationId, reservation
  });
  assert.equal(await store.getReference(reference.artifactId), undefined);
  await assert.rejects(store.createInvocationResolver({ owner, allowedArtifacts: [reference] }),
    (error) => error instanceof TeamArtifactError && error.code === "ARTIFACT_REFERENCE_INVALID");
  await store.activateOutputPublication({ reservation, references: [reference] });
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

test("File Artifact publication reservations fence stale writers across store instances", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-artifact-fence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = new FileTeamArtifactStore(root);
  const second = new FileTeamArtifactStore(root);
  const owner = { projectId: "project-1", runId: "run-fenced" };
  const reservation = await first.reserveOutputPublication({ owner, invocationId: "writer-invocation", publicationId: "fenced-publication" });
  const reference = await first.prepareOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
    mediaType: "text/markdown", content: Buffer.from("prepared"), publicationId: reservation.publicationId,
    invocationId: reservation.invocationId, reservation
  });
  const forged = { ...reservation, fencingGeneration: "stale-generation" };
  await assert.rejects(second.abortOutputPublication({ reservation: forged }),
    (error) => error?.code === "ARTIFACT_RESERVATION_STALE");
  assert.ok(await readFile(join(root, "index", `${reference.artifactId}.json`)));
  await second.abortOutputPublication({ reservation });
  await assert.rejects(first.prepareOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
    mediaType: "text/markdown", content: Buffer.from("late write"), publicationId: reservation.publicationId,
    invocationId: reservation.invocationId, reservation
  }), (error) => error?.code === "ARTIFACT_RESERVATION_STALE");
  await assert.rejects(first.abortOutputPublication({ reservation }),
    (error) => error?.code === "ARTIFACT_RESERVATION_STALE");
  await assert.rejects(readFile(join(root, "index", `${reference.artifactId}.json`)), { code: "ENOENT" });
  await assert.rejects(readFile(join(root, "projects", owner.projectId, "runs", owner.runId, "artifacts", `${reference.artifactId}.bin`)), { code: "ENOENT" });
});

test("File Artifact recovery and prepare serialize across independent store instances", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-artifact-fence-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const writer = new FileTeamArtifactStore(root);
  const recovery = new FileTeamArtifactStore(root);
  const owner = { projectId: "project-1", runId: "run-fence-race" };
  const reservation = await writer.reserveOutputPublication({ owner, invocationId: "race-invocation", publicationId: "race-publication" });
  let prepared;
  const contenders = await Promise.allSettled([
    writer.prepareOutput({
      team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
      mediaType: "text/markdown", content: Buffer.from("race"), publicationId: reservation.publicationId, reservation
    }).then((reference) => { prepared = reference; }),
    recovery.recoverOutputPublications({ owner, retainedPublicationIds: [], liveInvocationIds: [] })
  ]);
  assert.equal(contenders.filter((item) => item.status === "rejected").length <= 1, true);
  const reconciled = await recovery.recoverOutputPublications({ owner, retainedPublicationIds: [], liveInvocationIds: [] });
  assert.equal(reconciled[0].state, "aborted");
  if (prepared) {
    await assert.rejects(readFile(join(root, "index", `${prepared.artifactId}.json`)), { code: "ENOENT" });
    await assert.rejects(readFile(join(root, "projects", owner.projectId, "runs", owner.runId, "artifacts", `${prepared.artifactId}.bin`)), { code: "ENOENT" });
  }
});

test("File Artifact recovery keeps live and retained publications, then reclaims only abandoned prepared outputs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-artifact-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = new FileTeamArtifactStore(root);
  const second = new FileTeamArtifactStore(root);
  const owner = { projectId: "project-1", runId: "run-recovery" };
  const live = await first.reserveOutputPublication({ owner, invocationId: "run-recovery:worker:loop:1", publicationId: "live-publication" });
  const liveRef = await first.prepareOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
    mediaType: "text/markdown", content: Buffer.from("live"), publicationId: live.publicationId, reservation: live
  });
  const retained = await first.reserveOutputPublication({ owner, invocationId: "retained-invocation", publicationId: "retained-publication" });
  const retainedRef = await first.prepareOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
    mediaType: "text/markdown", content: Buffer.from("pending"), publicationId: retained.publicationId, reservation: retained
  });
  await first.activateOutputPublication({ reservation: retained, references: [retainedRef] });
  const abandoned = await first.reserveOutputPublication({ owner, invocationId: "settled-invocation", publicationId: "abandoned-publication" });
  const abandonedRef = await first.prepareOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
    mediaType: "text/markdown", content: Buffer.from("orphan"), publicationId: abandoned.publicationId, reservation: abandoned
  });

  const whileLive = await second.recoverOutputPublications({ owner, retainedPublicationIds: [retained.publicationId], liveInvocationIds: [live.invocationId] });
  assert.equal(whileLive.find((item) => item.reservation.publicationId === live.publicationId).state, "reserved");
  assert.equal(whileLive.find((item) => item.reservation.publicationId === retained.publicationId).state, "pending");
  assert.equal(whileLive.find((item) => item.reservation.publicationId === abandoned.publicationId).state, "aborted");
  assert.ok(await readFile(join(root, "index", `${liveRef.artifactId}.json`)));
  assert.ok(await readFile(join(root, "index", `${retainedRef.artifactId}.json`)));
  await assert.rejects(readFile(join(root, "index", `${abandonedRef.artifactId}.json`)), { code: "ENOENT" });

  const afterSettle = await second.recoverOutputPublications({ owner, retainedPublicationIds: [retained.publicationId], liveInvocationIds: [] });
  assert.equal(afterSettle.find((item) => item.reservation.publicationId === live.publicationId).state, "aborted");
  await assert.rejects(readFile(join(root, "index", `${liveRef.artifactId}.json`)), { code: "ENOENT" });
  assert.equal(afterSettle.find((item) => item.reservation.publicationId === retained.publicationId).state, "pending");
  const repeated = await second.recoverOutputPublications({ owner, retainedPublicationIds: [retained.publicationId], liveInvocationIds: [] });
  assert.equal(repeated.find((item) => item.reservation.publicationId === live.publicationId).state, "aborted");
  await assert.rejects(second.recoverOutputPublications({ owner, retainedPublicationIds: [live.publicationId], liveInvocationIds: [] }),
    (error) => error?.code === "ARTIFACT_RESERVATION_INVALID");
});

test("File Artifact recovery preserves committed publications and fails closed for missing or corrupt reservations", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-artifact-reservation-integrity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = new FileTeamArtifactStore(root);
  const second = new FileTeamArtifactStore(root);
  const owner = { projectId: "project-1", runId: "run-integrity" };
  const committed = await first.registerOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
    mediaType: "text/markdown", content: Buffer.from("committed")
  });
  const committedId = (await second.recoverOutputPublications({ owner, retainedPublicationIds: [], liveInvocationIds: [] }))[0].reservation.publicationId;
  assert.equal((await second.getReference(committed.artifactId)).artifactId, committed.artifactId);
  assert.equal(committedId.length > 0, true);

  const interruptedCommit = await first.reserveOutputPublication({ owner, invocationId: "partial-commit-invocation", publicationId: "partial-commit-publication" });
  const committedBeforeFinish = await first.prepareOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
    mediaType: "text/markdown", content: Buffer.from("commit response lost"), publicationId: interruptedCommit.publicationId, reservation: interruptedCommit
  });
  await first.activateOutputPublication({ reservation: interruptedCommit, references: [committedBeforeFinish] });
  await first.commitOutput({ owner, reference: committedBeforeFinish, publicationId: interruptedCommit.publicationId });
  const interruptedRecovery = await second.recoverOutputPublications({ owner, retainedPublicationIds: [], liveInvocationIds: [] });
  assert.equal(interruptedRecovery.find((item) => item.reservation.publicationId === interruptedCommit.publicationId).state, "pending");
  assert.equal((await second.getReference(committedBeforeFinish.artifactId)).artifactId, committedBeforeFinish.artifactId);

  const missing = await first.reserveOutputPublication({ owner, invocationId: "missing-invocation", publicationId: "missing-publication" });
  const missingRef = await first.prepareOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
    mediaType: "text/markdown", content: Buffer.from("missing journal"), publicationId: missing.publicationId, reservation: missing
  });
  const missingPath = join(root, "projects", owner.projectId, "runs", owner.runId, "publications", `${missing.publicationId}.json`);
  await rm(missingPath, { force: true });
  await assert.rejects(second.recoverOutputPublications({ owner, retainedPublicationIds: [missing.publicationId], liveInvocationIds: [] }),
    (error) => error?.code === "ARTIFACT_RESERVATION_INVALID");
  assert.ok(await readFile(join(root, "index", `${missingRef.artifactId}.json`)));

  const corrupt = await first.reserveOutputPublication({ owner, invocationId: "corrupt-invocation", publicationId: "corrupt-publication" });
  const corruptRef = await first.prepareOutput({
    team: team(), owner, agentId: "writer", outputPortId: "DONE", slotId: "report",
    mediaType: "text/markdown", content: Buffer.from("corrupt journal"), publicationId: corrupt.publicationId, reservation: corrupt
  });
  const corruptPath = join(root, "projects", owner.projectId, "runs", owner.runId, "publications", `${corrupt.publicationId}.json`);
  await writeFile(corruptPath, "{broken", "utf8");
  await assert.rejects(second.abortOutputPublication({ reservation: corrupt }),
    (error) => error?.code === "ARTIFACT_RESERVATION_INVALID");
  assert.ok(await readFile(join(root, "index", `${corruptRef.artifactId}.json`)));
  assert.ok(await readFile(join(root, "index", `${committed.artifactId}.json`)));
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
      const publications = new Map();
      const backend = {
        async reservePublication(owner, invocationId, publicationId) {
          const reservation = { ...owner, invocationId, publicationId, fencingGeneration: `fence-${publicationId}` };
          publications.set(publicationId, { reservation, state: "reserved", artifactIds: [] });
          return reservation;
        },
        async activatePublication(reservation) { publications.get(reservation.publicationId).state = "pending"; },
        async finishPublication(reservation) { publications.get(reservation.publicationId).state = "committed"; },
        async abortPublication(reservation) { publications.get(reservation.publicationId).state = "aborted"; },
        async recoverPublications() { return []; },
        async put(id, content, metadata) {
          publications.get(metadata.publicationId).artifactIds.push(id);
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
