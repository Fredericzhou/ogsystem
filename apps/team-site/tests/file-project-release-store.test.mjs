import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { digestRecord } from "../../../dist/runtime/workspace-contracts.js";
import { createFileProjectReleaseStore } from "../infrastructure/file-project-release-store.mjs";

test("Project Release reads tracked dotfiles from a published materialization", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-project-release-store-"));
  const runId = "run-release-dotfile";
  const releaseId = "release-dotfile";
  const releaseCommit = "a".repeat(40);
  const releaseRoot = join(root, ".ogs", "runs", runId, "release-store");
  const dotfile = Buffer.from("*.bin filter=lfs\n", "utf8");
  const manifestBase = {
    ogsContractVersion: 2,
    schemaVersion: 1,
    manifestId: `${releaseId}:materialization`,
    releaseId,
    releaseCommit,
    files: [{ path: ".gitattributes", digest: `sha256:${createHash("sha256").update(dotfile).digest("hex")}`, sizeBytes: dotfile.length }]
  };
  try {
    await mkdir(join(root, ".site"), { recursive: true });
    await mkdir(join(root, ".ogs", "runs", runId), { recursive: true });
    await writeFile(join(root, ".site", "project.json"), "{}\n", "utf8");
    await writeFile(join(root, ".ogs", "runs", runId, "run-owner.json"), `${JSON.stringify({
      version: 1,
      runKind: "project_task",
      projectId: "project-release-dotfile",
      taskId: "task-release-dotfile",
      runId,
      taskNumber: 1,
      attemptNumber: 1,
      teamVersionId: "team-release-dotfile"
    })}\n`, "utf8");
    await mkdir(join(releaseRoot, "releases"), { recursive: true });
    await mkdir(join(releaseRoot, "materializations", releaseId, "output"), { recursive: true });
    await writeFile(join(releaseRoot, "releases", `${releaseId}.json`), `${JSON.stringify({
      ogsContractVersion: 2,
      schemaVersion: 1,
      releaseId,
      runId,
      workspaceId: "workspace-release-dotfile",
      releaseCommit,
      expectedCanonicalHead: releaseCommit,
      status: "published",
      failureCode: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      materializationManifestRef: `materializations/${releaseId}/manifest.json`,
      materializationManifestDigest: digestRecord(manifestBase),
      outputDigest: digestRecord(manifestBase.files),
      downloadReference: `project://release/${releaseId}`
    }, null, 2)}\n`, "utf8");
    await writeFile(join(releaseRoot, "materializations", releaseId, "manifest.json"), `${JSON.stringify({ ...manifestBase, digest: digestRecord(manifestBase) }, null, 2)}\n`, "utf8");
    await writeFile(join(releaseRoot, "materializations", releaseId, "output", ".gitattributes"), "*.bin filter=lfs\n", "utf8");

    const store = createFileProjectReleaseStore();
    const project = {
      projectId: "project-release-dotfile",
      workspaceId: "workspace-release-dotfile",
      ogsDir: root,
      taskRecords: [{
        taskId: "task-release-dotfile",
        taskNumber: 1,
        teamVersionId: "team-release-dotfile",
        runIds: [runId]
      }]
    };
    const result = await store.read(project, releaseId);
    const listed = await store.list(project);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].runId, runId);
    assert.equal(listed[0].workspaceId, project.workspaceId);
    assert.equal(result.manifest.files[0].path, ".gitattributes");
    const file = await store.readFile(project, releaseId, ".gitattributes");
    assert.equal(file.path, ".gitattributes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Project Release rejects invalid materialization manifest identity and LFS object IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-project-release-manifest-"));
  const runId = "run-release-manifest";
  const releaseId = "release-manifest";
  const releaseCommit = "a".repeat(40);
  const releaseRoot = join(root, ".ogs", "runs", runId, "release-store");
  try {
    await mkdir(join(root, ".site"), { recursive: true });
    await mkdir(join(root, ".ogs", "runs", runId), { recursive: true });
    await writeFile(join(root, ".site", "project.json"), "{}\n", "utf8");
    await writeFile(join(root, ".ogs", "runs", runId, "run-owner.json"), `${JSON.stringify({
      version: 1,
      runKind: "project_task",
      projectId: "project-release-manifest",
      taskId: "task-release-manifest",
      runId,
      taskNumber: 1,
      attemptNumber: 1,
      teamVersionId: "team-release-manifest"
    })}\n`, "utf8");
    await mkdir(join(releaseRoot, "releases"), { recursive: true });
    await mkdir(join(releaseRoot, "materializations", releaseId, "output"), { recursive: true });
    const manifestBase = {
      ogsContractVersion: 2,
      schemaVersion: 1,
      manifestId: `${releaseId}:materialization`,
      releaseId,
      releaseCommit,
      files: [{ path: "report.md", digest: `sha256:${"b".repeat(64)}`, sizeBytes: 1, lfsObjectId: "sha256:not-a-valid-object-id" }]
    };
    const manifest = { ...manifestBase, digest: digestRecord(manifestBase) };
    await writeFile(join(releaseRoot, "releases", `${releaseId}.json`), `${JSON.stringify({
      ogsContractVersion: 2,
      schemaVersion: 1,
      releaseId,
      runId,
      workspaceId: "workspace-release-manifest",
      releaseCommit,
      expectedCanonicalHead: releaseCommit,
      status: "published",
      failureCode: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      materializationManifestRef: `materializations/${releaseId}/manifest.json`,
      materializationManifestDigest: manifest.digest,
      outputDigest: digestRecord(manifest.files),
      downloadReference: `project://release/${releaseId}`
    }, null, 2)}\n`, "utf8");
    await writeFile(join(releaseRoot, "materializations", releaseId, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const store = createFileProjectReleaseStore();
    const project = {
      projectId: "project-release-manifest",
      workspaceId: "workspace-release-manifest",
      ogsDir: root,
      taskRecords: [{ taskId: "task-release-manifest", taskNumber: 1, teamVersionId: "team-release-manifest", runIds: [runId] }]
    };
    await assert.rejects(() => store.read(project, releaseId), /RELEASE_MATERIALIZATION_INVALID/);
    const wrongIdentity = { ...manifest, manifestId: "another-release:materialization" };
    const { digest: _digest, ...withoutDigest } = wrongIdentity;
    wrongIdentity.digest = digestRecord(withoutDigest);
    await writeFile(join(releaseRoot, "materializations", releaseId, "manifest.json"), `${JSON.stringify(wrongIdentity, null, 2)}\n`, "utf8");
    await assert.rejects(() => store.read(project, releaseId), /RELEASE_MATERIALIZATION_INVALID/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Project Release list and detail reject records detached from their owning Run or Workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-project-release-identity-"));
  const runId = "run-release-identity";
  const releaseId = "release-identity";
  const releaseDirectory = join(root, ".ogs", "runs", runId, "release-store", "releases");
  const releasePath = join(releaseDirectory, `${releaseId}.json`);
  const project = {
    projectId: "project-release-identity",
    workspaceId: "workspace-release-identity",
    ogsDir: root,
    taskRecords: [{ taskId: "task-release-identity", taskNumber: 1, teamVersionId: "team-release-identity", runIds: [runId] }]
  };
  const record = {
    ogsContractVersion: 2,
    schemaVersion: 1,
    releaseId,
    runId,
    workspaceId: project.workspaceId,
    releaseCommit: "a".repeat(40),
    expectedCanonicalHead: "a".repeat(40),
    status: "failed",
    failureCode: "MATERIALIZATION_FAILED",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z"
  };
  try {
    await mkdir(join(root, ".ogs", "runs", runId), { recursive: true });
    await writeFile(join(root, ".ogs", "runs", runId, "run-owner.json"), `${JSON.stringify({
      version: 1,
      runKind: "project_task",
      projectId: project.projectId,
      taskId: "task-release-identity",
      runId,
      taskNumber: 1,
      attemptNumber: 1,
      teamVersionId: "team-release-identity"
    })}\n`, "utf8");
    await mkdir(releaseDirectory, { recursive: true });
    const store = createFileProjectReleaseStore();
    const writeRecord = (value) => writeFile(releasePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");

    await writeRecord(record);
    assert.equal((await store.list(project))[0].releaseId, releaseId);
    await assert.rejects(() => store.read(project, releaseId), /RELEASE_NOT_PUBLISHED/);

    await writeRecord({ ...record, runId: "run-forged" });
    await assert.rejects(() => store.list(project), /RELEASE_INVALID.*identity/);
    await assert.rejects(() => store.read(project, releaseId), /RELEASE_INVALID.*identity/);

    await writeRecord({ ...record, workspaceId: "workspace-forged" });
    await assert.rejects(() => store.list(project), /RELEASE_INVALID.*identity/);
    await assert.rejects(() => store.read(project, releaseId), /RELEASE_INVALID.*identity/);

    const missingProjectWorkspace = { ...project, workspaceId: undefined };
    await assert.rejects(() => store.list(missingProjectWorkspace), /RELEASE_INVALID.*Project Workspace identity/);
    await assert.rejects(() => store.read(missingProjectWorkspace, releaseId), /RELEASE_INVALID.*Project Workspace identity/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
