import assert from "node:assert/strict";
import test from "node:test";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import {
  WORKSPACE_EVENT_TYPES,
  assertEvidenceManifest,
  assertMaterializationManifest,
  assertRelease,
  assertWorkspaceRef,
  buildWorkspaceEvent,
  buildWorkspaceRef,
  digestRecord,
  acquireCanonicalWorkspaceLock,
  createWorkspaceReleaseService,
  readCanonicalWorkspaceLock,
  WorkspaceLockError
} from "../dist/runtime/adapter.js";

const commit = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const execFile = promisify(execFileCallback);

async function git(cwd, args) {
  return execFile("git", ["-c", "user.name=Workspace Test", "-c", "user.email=workspace@example.test", ...args], { cwd });
}

test("WorkspaceRef accepts repository hidden files and rejects mutable or unsafe references", () => {
  const ref = buildWorkspaceRef({ workspaceId: "workspace-1", commit, path: ".gitattributes", digest });
  assert.equal(ref.path, ".gitattributes");
  assert.doesNotThrow(() => assertWorkspaceRef(ref));
  assert.throws(() => buildWorkspaceRef({ workspaceId: "workspace-1", commit: "main", path: "README.md", digest }), /WORKSPACE_REF_INVALID/);
  assert.throws(() => buildWorkspaceRef({ workspaceId: "workspace-1", commit, path: "../README.md", digest }), /WORKSPACE_PATH_INVALID/);
});

test("Workspace event registry has one contract source and validates the envelope", () => {
  assert.equal(WORKSPACE_EVENT_TYPES.length, 30);
  const event = buildWorkspaceEvent({ eventId: "event-1", eventType: "workspace_integrated", runId: "run-1", recordedAt: new Date().toISOString(), payload: { mergeCommit: commit } });
  assert.equal(event.ogsContractVersion, 2);
  assert.throws(() => buildWorkspaceEvent({ eventId: "event-2", eventType: "READY", runId: "run-1", recordedAt: new Date().toISOString(), payload: {} }), /WORKSPACE_EVENT_INVALID/);
  const projectionPayload = { runId: "run-1", resultId: "result-1", stateVersion: 0 };
  assert.doesNotThrow(() => buildWorkspaceEvent({ eventId: "event-3", eventType: "result_committed", runId: "run-1", recordedAt: new Date().toISOString(), payload: projectionPayload }));
  assert.throws(() => buildWorkspaceEvent({ eventId: "event-3a", eventType: "result_committed", runId: "run-1", recordedAt: new Date().toISOString(), payload: { resultId: "result-1", stateVersion: 0 } }), /WORKSPACE_EVENT_INVALID/);
  assert.throws(() => buildWorkspaceEvent({ eventId: "event-3b", eventType: "result_committed", runId: "run-1", recordedAt: new Date().toISOString(), payload: { ...projectionPayload, runId: "run-2" } }), /WORKSPACE_EVENT_INVALID/);
  assert.throws(() => buildWorkspaceEvent({ eventId: "event-4", eventType: "result_committed", runId: "run-1", recordedAt: new Date().toISOString(), payload: { resultCommit: commit } }), /WORKSPACE_EVENT_INVALID/);
  const commitPayload = { runId: "run-1", nodeId: "writer", roleId: "writer", baseCommit: commit, resultCommit: "c".repeat(40), changedPaths: ["result.md"], lfsObjectIds: [], decisionBackground: {}, evidenceRefs: [] };
  assert.doesNotThrow(() => buildWorkspaceEvent({ eventId: "event-5", eventType: "result_committed", runId: "run-1", recordedAt: new Date().toISOString(), payload: commitPayload }));
  assert.throws(() => buildWorkspaceEvent({ eventId: "event-6", eventType: "result_committed", runId: "run-1", recordedAt: new Date().toISOString(), payload: { ...commitPayload, runId: undefined } }), /WORKSPACE_EVENT_INVALID/);
  assert.throws(() => buildWorkspaceEvent({ eventId: "event-7", eventType: "result_committed", runId: "run-1", recordedAt: new Date().toISOString(), payload: { resultId: "result-1", stateVersion: 0, resultCommit: "not-a-commit" } }), /WORKSPACE_EVENT_INVALID/);
  assert.throws(() => buildWorkspaceEvent({ eventId: "event-8", eventType: "result_committed", runId: "run-1", recordedAt: new Date().toISOString(), payload: { ...commitPayload, runId: "run-2" } }), /WORKSPACE_EVENT_INVALID/);
  assert.throws(() => buildWorkspaceEvent({ eventId: 4, eventType: "workspace_integrated", runId: "run-1", recordedAt: new Date().toISOString(), payload: {} }), /WORKSPACE_EVENT_INVALID/);
  const joinPayload = { joinId: "join-1", roleId: "reviewer", lineageId: "lineage-1", loopIteration: 0, joinMode: "all", joinSources: ["writer"], requiredSourceCount: 1, satisfiedSources: ["writer"], arrivedFromRoleId: "writer", arrivedFromBranchId: "writer:1", activatedBranchId: "reviewer:1" };
  assert.doesNotThrow(() => buildWorkspaceEvent({ eventId: "join-1", eventType: "join_quorum_reached", runId: "run-1", recordedAt: new Date().toISOString(), payload: joinPayload }));
  assert.throws(() => buildWorkspaceEvent({ eventId: "join-2", eventType: "join_quorum_reached", runId: "run-1", recordedAt: new Date().toISOString(), payload: { ...joinPayload, satisfiedSources: undefined } }), /WORKSPACE_EVENT_INVALID/);
  assert.throws(() => buildWorkspaceEvent({ eventId: "join-3", eventType: "join_quorum_reached", runId: "run-1", recordedAt: new Date().toISOString(), payload: { ...joinPayload, sourceSnapshot: [{ roleId: "writer" }] } }), /WORKSPACE_EVENT_INVALID/);
});

test("manifest validators enforce identity, digest, and verified LFS object formats", () => {
  const evidenceBase = {
    ogsContractVersion: 2,
    schemaVersion: 1,
    manifestId: "run-1:evidence",
    runId: "run-1",
    eventRefs: [],
    checkpointRefs: [],
    provenanceRefs: [],
    reviewRefs: []
  };
  assert.doesNotThrow(() => assertEvidenceManifest({ ...evidenceBase, digest: digestRecord(evidenceBase) }));

  const materializationBase = {
    ogsContractVersion: 2,
    schemaVersion: 1,
    manifestId: "release-1:materialization",
    releaseId: "release-1",
    releaseCommit: commit,
    files: [{ path: "report.md", digest, sizeBytes: 1, lfsObjectId: `sha256:${"c".repeat(64)}` }]
  };
  assert.doesNotThrow(() => assertMaterializationManifest({ ...materializationBase, digest: digestRecord(materializationBase) }));
  const materialization = { ...materializationBase, digest: `sha256:${"d".repeat(64)}` };
  assert.throws(() => assertMaterializationManifest(materialization), /WORKSPACE_MANIFEST_DIGEST_MISMATCH/);
  assert.throws(() => assertMaterializationManifest({ ...materializationBase, digest: digestRecord({ ...materializationBase, manifestId: "" }), manifestId: "" }), /WORKSPACE_MANIFEST_INVALID/);
  assert.throws(() => assertMaterializationManifest({ ...materializationBase, digest: digestRecord(materializationBase), files: [{ ...materializationBase.files[0], lfsObjectId: "sha256:not-valid" }] }), /WORKSPACE_MANIFEST_INVALID/);
});

test("canonical Workspace lock fences stale heads and reclaims expired leases", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-lock-"));
  try {
    const first = await acquireCanonicalWorkspaceLock({ workspaceDir: root, workspaceId: "workspace-1", owner: "run-1", expectedCanonicalHead: commit, leaseMs: 10_000 });
    await assert.rejects(() => acquireCanonicalWorkspaceLock({ workspaceDir: root, workspaceId: "workspace-1", owner: "run-2", expectedCanonicalHead: commit }), (error) => error instanceof WorkspaceLockError && error.code === "WORKSPACE_LOCK_HELD");
    assert.equal((await readCanonicalWorkspaceLock(root)).fencingToken, first.lock.fencingToken);
    await first.release();
    const expired = await acquireCanonicalWorkspaceLock({ workspaceDir: root, workspaceId: "workspace-1", owner: "run-3", expectedCanonicalHead: commit, leaseMs: -1 });
    await expired.release();
    await assert.rejects(() => acquireCanonicalWorkspaceLock({ workspaceDir: root, workspaceId: "workspace-1", owner: "run-4", expectedCanonicalHead: "c".repeat(40), currentCanonicalHead: commit }), /WORKSPACE_LOCK_STALE_HEAD/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Release materialization follows the contract state machine and creates a digest manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-release-"));
  const source = join(root, "source");
  try {
    await mkdir(source, { recursive: true });
    await git(root, ["init", "--quiet", "--initial-branch=main", source]);
    await writeFile(join(source, ".gitattributes"), "*.bin filter=lfs\n", "utf8");
    await writeFile(join(source, "report.md"), "release\n", "utf8");
    await git(source, ["add", ".gitattributes", "report.md"]);
    await git(source, ["commit", "--quiet", "-m", "release"]);
    const sourceCommit = (await git(source, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(join(source, "untracked.txt"), "must not ship\n", "utf8");
    const service = createWorkspaceReleaseService(join(root, "store"));
    const prepared = await service.prepare({ releaseId: "release-1", runId: "run-1", workspaceId: "workspace-1", releaseCommit: sourceCommit, expectedCanonicalHead: sourceCommit });
    assert.equal(prepared.status, "prepared");
    await assert.rejects(() => service.publish("release-1"), /RELEASE_STATE_INVALID/);
    const materialized = await service.materialize({ releaseId: "release-1", sourceDir: source });
    assert.equal(materialized.status, "materialized");
    assert.match(materialized.materializationManifestDigest, /^sha256:/);
    const updated = await service.markRefUpdated("release-1");
    const published = await service.publish("release-1");
    assert.equal(updated.status, "ref_updated");
    assert.equal(published.status, "published");
    assert.doesNotThrow(() => assertRelease(published));
    await assert.rejects(() => service.prepare({ releaseId: "release-1", runId: "run-other", workspaceId: "workspace-1", releaseCommit: sourceCommit, expectedCanonicalHead: sourceCommit }), /RELEASE_STATE_INVALID/);
    assert.throws(() => assertRelease({ ...published, status: "materialized", failureCode: "MATERIALIZATION_FAILED" }), /RELEASE_INVALID/);
    const manifest = JSON.parse(await readFile(join(root, "store", "materializations", "release-1", "manifest.json"), "utf8"));
    assert.deepEqual(manifest.files.map((item) => item.path), [".gitattributes", "report.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Release reconciliation binds the materialization manifest ID and classifies output digest failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-release-output-digest-failure-"));
  const source = join(root, "source");
  const storeDir = join(root, "store");
  try {
    await mkdir(source, { recursive: true });
    await git(root, ["init", "--quiet", "--initial-branch=main", source]);
    await writeFile(join(source, "report.md"), "release\n", "utf8");
    await git(source, ["add", "report.md"]);
    await git(source, ["commit", "--quiet", "-m", "release"]);
    const releaseCommit = (await git(source, ["rev-parse", "HEAD"])).stdout.trim();
    const service = createWorkspaceReleaseService(storeDir);
    await service.prepare({ releaseId: "release-digest", runId: "run-digest", workspaceId: "workspace-digest", releaseCommit, expectedCanonicalHead: releaseCommit });
    const materialized = await service.materialize({ releaseId: "release-digest", sourceDir: source });
    const manifestPath = join(storeDir, materialized.materializationManifestRef);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const wrongIdentity = { ...manifest, manifestId: "another-release:materialization" };
    const { digest: _oldDigest, ...withoutDigest } = wrongIdentity;
    wrongIdentity.digest = digestRecord(withoutDigest);
    await writeFile(manifestPath, `${JSON.stringify(wrongIdentity, null, 2)}\n`, "utf8");
    await assert.rejects(() => service.reconcile({ releaseId: "release-digest", canonicalHead: releaseCommit }), /WORKSPACE_MANIFEST_INVALID/);
    assert.equal((await service.load("release-digest"))?.failureCode, "RELEASE_RECONCILIATION_FAILED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Release materialization failure is durable and does not expose a download reference", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-release-materialization-failure-"));
  try {
    const service = createWorkspaceReleaseService(join(root, "store"));
    const prepared = await service.prepare({
      releaseId: "release-failure",
      runId: "run-failure",
      workspaceId: "workspace-failure",
      releaseCommit: commit,
      expectedCanonicalHead: commit
    });
    assert.equal(prepared.status, "prepared");
    await assert.rejects(() => service.materialize({ releaseId: prepared.releaseId, sourceDir: join(root, "missing-source") }));
    const failed = await service.load(prepared.releaseId);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.failureCode, "CANDIDATE_INVALID");
    assert.equal(failed?.downloadReference, undefined);
    assert.throws(() => assertRelease({ ...prepared, downloadReference: "project://release/private" }), /RELEASE_INVALID/);
    assert.throws(() => assertRelease({ ...failed, downloadReference: "project://release/private" }), /RELEASE_INVALID/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Release rejects Git tree paths that could escape or collide outside a portable output root", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-release-unsafe-path-"));
  const source = join(root, "source");
  const storeDir = join(root, "store");
  const outputRoot = join(storeDir, "materializations", "release-unsafe-path", "output");
  const escapedTarget = join(storeDir, "materializations", "outside.txt");
  try {
    await mkdir(source, { recursive: true });
    await git(root, ["init", "--quiet", "--initial-branch=main", source]);
    await writeFile(join(source, "safe.txt"), "must not be partially materialized\n", "utf8");
    await writeFile(join(source, "..\\..\\outside.txt"), "must never escape output root\n", "utf8");
    await git(source, ["add", "--", "safe.txt", "..\\..\\outside.txt"]);
    await git(source, ["commit", "--quiet", "-m", "unsafe portable path"]);
    const releaseCommit = (await git(source, ["rev-parse", "HEAD"])).stdout.trim();
    const service = createWorkspaceReleaseService(storeDir);
    await service.prepare({ releaseId: "release-unsafe-path", runId: "run-unsafe-path", workspaceId: "workspace-unsafe-path", releaseCommit, expectedCanonicalHead: releaseCommit });

    await assert.rejects(() => service.materialize({ releaseId: "release-unsafe-path", sourceDir: source }), /MATERIALIZATION_ENTRY_INVALID/);
    const failed = await service.load("release-unsafe-path");
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.failureCode, "CANDIDATE_INVALID");
    await assert.rejects(() => readFile(escapedTarget), { code: "ENOENT" });
    await assert.rejects(() => readFile(join(outputRoot, "safe.txt")), { code: "ENOENT" });
    await assert.rejects(() => readFile(join(storeDir, "materializations", "outside.txt")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Release persists MATERIALIZATION_FAILED when a committed LFS object is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-release-lfs-unavailable-"));
  const source = join(root, "source");
  try {
    await mkdir(source, { recursive: true });
    await git(root, ["init", "--quiet", "--initial-branch=main", source]);
    await writeFile(join(source, ".gitattributes"), "*.png filter=lfs diff=lfs merge=lfs -text\n", "utf8");
    await writeFile(join(source, "missing.png"), `version https://git-lfs.github.com/spec/v1\noid sha256:${"a".repeat(64)}\nsize 12\n`, "utf8");
    await git(source, ["add", ".gitattributes", "missing.png"]);
    await git(source, ["commit", "--quiet", "-m", "LFS pointer without object"]);
    const releaseCommit = (await git(source, ["rev-parse", "HEAD"])).stdout.trim();
    const service = createWorkspaceReleaseService(join(root, "store"));
    await service.prepare({ releaseId: "release-lfs-missing", runId: "run-lfs-missing", workspaceId: "workspace-lfs-missing", releaseCommit, expectedCanonicalHead: releaseCommit });
    await assert.rejects(() => service.materialize({ releaseId: "release-lfs-missing", sourceDir: source }), /MATERIALIZATION_LFS_UNAVAILABLE/);
    const failed = await service.load("release-lfs-missing");
    assert.equal(failed?.failureCode, "MATERIALIZATION_FAILED");
    assert.equal(failed?.downloadReference, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Release output and store failures persist their contract failure codes without downloads", async (t) => {
  await t.test("same-size output content tampering persists OUTPUT_DIGEST_MISMATCH", async () => {
    const root = await mkdtemp(join(tmpdir(), "ogs-release-output-corruption-"));
    const source = join(root, "source");
    const storeDir = join(root, "store");
    try {
      await mkdir(source, { recursive: true });
      await git(root, ["init", "--quiet", "--initial-branch=main", source]);
      await writeFile(join(source, "report.md"), "release\n", "utf8");
      await git(source, ["add", "report.md"]);
      await git(source, ["commit", "--quiet", "-m", "release"]);
      const releaseCommit = (await git(source, ["rev-parse", "HEAD"])).stdout.trim();
      const service = createWorkspaceReleaseService(storeDir);
      await service.prepare({ releaseId: "release-corrupt", runId: "run-corrupt", workspaceId: "workspace-corrupt", releaseCommit, expectedCanonicalHead: releaseCommit });
      const materialized = await service.materialize({ releaseId: "release-corrupt", sourceDir: source });
      const tamperedContent = "replace\n";
      assert.equal(Buffer.byteLength(tamperedContent), Buffer.byteLength("release\n"));
      await writeFile(join(storeDir, "materializations", "release-corrupt", "output", "report.md"), tamperedContent, "utf8");
      await assert.rejects(() => service.reconcile({ releaseId: "release-corrupt", canonicalHead: releaseCommit }), /OUTPUT_DIGEST_MISMATCH/);
      const failed = await service.load("release-corrupt");
      assert.equal(failed?.failureCode, "OUTPUT_DIGEST_MISMATCH");
      assert.equal(failed?.downloadReference, undefined);
      assert.equal(materialized.status, "materialized");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("release store unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "ogs-release-store-unavailable-"));
    const source = join(root, "source");
    const storeDir = join(root, "store");
    try {
      await mkdir(source, { recursive: true });
      await mkdir(storeDir, { recursive: true });
      await git(root, ["init", "--quiet", "--initial-branch=main", source]);
      await writeFile(join(source, "report.md"), "release\n", "utf8");
      await git(source, ["add", "report.md"]);
      await git(source, ["commit", "--quiet", "-m", "release"]);
      const releaseCommit = (await git(source, ["rev-parse", "HEAD"])).stdout.trim();
      const service = createWorkspaceReleaseService(storeDir);
      await service.prepare({ releaseId: "release-store", runId: "run-store", workspaceId: "workspace-store", releaseCommit, expectedCanonicalHead: releaseCommit });
      await writeFile(join(storeDir, "materializations"), "not a directory", "utf8");
      await assert.rejects(() => service.materialize({ releaseId: "release-store", sourceDir: source }), /ENOTDIR/);
      const failed = await service.load("release-store");
      assert.equal(failed?.failureCode, "RELEASE_STORE_UNAVAILABLE");
      assert.equal(failed?.downloadReference, undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("Release output digest disagrees with its materialization manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "ogs-release-record-digest-mismatch-"));
    const source = join(root, "source");
    const storeDir = join(root, "store");
    try {
      await mkdir(source, { recursive: true });
      await git(root, ["init", "--quiet", "--initial-branch=main", source]);
      await writeFile(join(source, "report.md"), "release\n", "utf8");
      await git(source, ["add", "report.md"]);
      await git(source, ["commit", "--quiet", "-m", "release"]);
      const releaseCommit = (await git(source, ["rev-parse", "HEAD"])).stdout.trim();
      const service = createWorkspaceReleaseService(storeDir);
      await service.prepare({ releaseId: "release-record-digest", runId: "run-record-digest", workspaceId: "workspace-record-digest", releaseCommit, expectedCanonicalHead: releaseCommit });
      const materialized = await service.materialize({ releaseId: "release-record-digest", sourceDir: source });
      await writeFile(join(storeDir, "releases", "release-record-digest.json"), `${JSON.stringify({ ...materialized, outputDigest: `sha256:${"c".repeat(64)}` }, null, 2)}\n`, "utf8");
      await assert.rejects(() => service.reconcile({ releaseId: "release-record-digest", canonicalHead: releaseCommit }), /OUTPUT_DIGEST_MISMATCH/);
      const failed = await service.load("release-record-digest");
      assert.equal(failed?.failureCode, "OUTPUT_DIGEST_MISMATCH");
      assert.equal(failed?.downloadReference, undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
