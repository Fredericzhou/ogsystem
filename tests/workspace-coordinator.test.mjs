import assert from "node:assert/strict";
import test from "node:test";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertEvidenceManifest, createGitCollaboration, createWorkspaceCoordinator } from "../dist/runtime/adapter.js";

const execFile = promisify(execFileCallback);
async function git(cwd, args) {
  return execFile("git", ["-c", "user.name=Workspace Test", "-c", "user.email=workspace@example.test", ...args], { cwd });
}

test("Workspace coordinator exposes contract operations and persists checkpoints and provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-coordinator-"));
  const repo = join(root, "repo");
  const worktrees = join(root, "worktrees");
  const evidence = join(root, "evidence");
  try {
    await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
    await writeFile(join(repo, "README.md"), "base\n", "utf8");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "--quiet", "-m", "base"]);
    const base = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    const collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: worktrees, runId: "run-coordinator" });
    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: evidence, collaboration, workspaceId: "workspace-project-stable" });
    const prepared = await coordinator.prepare({ runId: "run-coordinator", nodeId: "writer", roleId: "writer", executionId: "exec-1", baseCommit: base });
    assert.equal(prepared.workspaceId, "workspace-project-stable");
    await writeFile(join(prepared.worktree.path, "README.md"), "updated\n", "utf8");
    const committed = await coordinator.commit({ runId: "run-coordinator", nodeId: "writer", roleId: "writer", worktree: prepared.worktree, message: "update readme", checkpoint: prepared.checkpoint });
    assert.equal(committed.checkpoint.roleCommit, committed.roleCommit.resultCommit);
    assert.equal(committed.event.eventType, "result_committed");
    assert.equal((await (await import("node:fs/promises")).readdir(join(evidence, "checkpoints"))).length, 2);
    const merged = await coordinator.merge({ runId: "run-coordinator", nodeId: "join", baseCommit: base, candidateCommits: [committed.roleCommit.resultCommit], mergeId: "join-1", checkpoint: prepared.checkpoint });
    assert.equal(merged.event.eventType, "workspace_integrated");
    assert.equal(merged.merge.status, "merged");
    const ref = coordinator.workspaceRef({ commit: merged.merge.mergeCommit, path: "README.md", digest: "sha256:" + "0".repeat(64) });
    assert.equal(ref.workspaceId, "workspace-project-stable");
    const actual = Buffer.from(await readFile(join(merged.merge.path, "README.md")));
    ref.digest = `sha256:${(await import("node:crypto")).createHash("sha256").update(actual).digest("hex")}`;
    assert.equal(Buffer.from(await coordinator.readWorkspaceRef(ref)).toString(), "updated\n");
    await writeFile(join(evidence, "events.ndjson"), `${JSON.stringify(committed.event)}\n${JSON.stringify(merged.event)}\n`, "utf8");
    const manifest = await coordinator.writeEvidenceManifest({ runId: "run-coordinator" });
    assert.doesNotThrow(() => assertEvidenceManifest(manifest));
    assert.equal(manifest.eventRefs.length, 2);
    assert.equal(manifest.checkpointRefs.length, 3);
    assert.equal(manifest.provenanceRefs.length, 1);
    assert.deepEqual(JSON.parse(await readFile(join(evidence, "evidence-manifest.json"), "utf8")), manifest);
    assert.match(await readFile(join(evidence, "provenance", `${committed.roleCommit.resultCommit}.json`), "utf8"), /ogsContractVersion/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace restore is fenced by the canonical lock and leaves canonical HEAD unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-restore-lock-"));
  const repo = join(root, "repo");
  const evidence = join(root, "evidence");
  try {
    await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
    await writeFile(join(repo, "README.md"), "base\n", "utf8");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "--quiet", "-m", "base"]);
    const base = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(join(repo, "README.md"), "canonical\n", "utf8");
    await git(repo, ["commit", "--quiet", "-am", "canonical"]);
    const head = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    const collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: join(root, "worktrees"), runId: "run-restore" });
    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: evidence, collaboration, workspaceId: "workspace-restore" });
    const prepared = await coordinator.prepare({ runId: "run-restore", nodeId: "restore", roleId: "restore", executionId: "restore-checkpoint", baseCommit: head });
    const restored = await coordinator.restore({ runId: "run-restore", nodeId: "restore", restoreId: "restore-1", targetCommit: base, expectedCanonicalHead: head, workspaceDir: repo, checkpoint: prepared.checkpoint });
    assert.equal((await git(repo, ["rev-parse", "HEAD"])).stdout.trim(), head);
    assert.equal(restored.restore.expectedCanonicalHead, head);
    assert.equal((await git(repo, ["show", `${restored.restore.resultCommit}:README.md`])).stdout, "base\n");

    const held = await coordinator.claim({ workspaceDir: repo, owner: "other-run", expectedCanonicalHead: head, currentCanonicalHead: head });
    try {
      await assert.rejects(() => coordinator.restore({ runId: "run-restore", nodeId: "restore", restoreId: "restore-blocked", targetCommit: base, expectedCanonicalHead: head, workspaceDir: repo, checkpoint: prepared.checkpoint }), /WORKSPACE_LOCK_HELD/);
    } finally {
      await held.release();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("WorkspaceRef resolves and verifies a local Git LFS object", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-lfs-"));
  const repo = join(root, "repo");
  try {
    try {
      await git(root, ["lfs", "version"]);
    } catch {
      return;
    }
    await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
    await git(repo, ["lfs", "install", "--local"]);
    await git(repo, ["lfs", "track", "*.bin"]);
    const content = Buffer.from("LFS workspace content\n", "utf8");
    await writeFile(join(repo, "payload.bin"), content);
    await git(repo, ["add", ".gitattributes", "payload.bin"]);
    await git(repo, ["commit", "--quiet", "-m", "lfs"]);
    const base = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    const collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: join(root, "worktrees"), runId: "run-lfs" });
    assert.equal((await collaboration.probe(repo)).supported, true);
    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: join(root, "evidence"), collaboration });
    const ref = coordinator.workspaceRef({ commit: base, path: "payload.bin", digest: `sha256:${createHash("sha256").update(content).digest("hex")}` });
    assert.deepEqual(Buffer.from(await coordinator.readWorkspaceRef(ref)), content);
    const badDigestRef = coordinator.workspaceRef({ commit: base, path: "payload.bin", digest: `sha256:${"f".repeat(64)}` });
    await assert.rejects(() => coordinator.readWorkspaceRef(badDigestRef), /WORKSPACE_REF_DIGEST_MISMATCH/);
    const release = await coordinator.release.prepare({ releaseId: "release-lfs", runId: "run-lfs", workspaceId: coordinator.workspaceId, releaseCommit: base, expectedCanonicalHead: base });
    assert.equal(release.status, "prepared");
    const materialized = await coordinator.release.materialize({ releaseId: "release-lfs", sourceDir: repo });
    const manifest = JSON.parse(await readFile(join(root, "evidence", "release-store", "materializations", "release-lfs", "manifest.json"), "utf8"));
    const payloadEntry = manifest.files.find((entry) => entry.path === "payload.bin");
    assert.equal(payloadEntry.lfsObjectId.startsWith("sha256:"), true);
    assert.equal(payloadEntry.digest, ref.digest);
    assert.deepEqual(await readFile(join(root, "evidence", "release-store", "materializations", "release-lfs", "output", "payload.bin")), content);
    assert.equal(materialized.status, "materialized");

    const worktree = await collaboration.addWorktree({ roleId: "lfs-writer", executionId: "exec-lfs-writer", baseCommit: base });
    try {
      const changedContent = Buffer.from("updated LFS workspace content\n", "utf8");
      await writeFile(join(worktree.path, "payload.bin"), changedContent);
      const roleCommit = await collaboration.commitWorktree(worktree, "update LFS payload");
      const roleResult = await coordinator.recordRoleCommit({ runId: "run-lfs", nodeId: "lfs-writer", branchId: "lfs-writer", roleCommit });
      assert.deepEqual(roleCommit.lfsObjectIds, [`sha256:${createHash("sha256").update(changedContent).digest("hex")}`]);
      assert.deepEqual(roleResult.event.payload.lfsObjectIds, roleCommit.lfsObjectIds);

      const noOpWorktree = await collaboration.addWorktree({ roleId: "lfs-writer-noop", executionId: "exec-lfs-noop", baseCommit: base });
      const noChange = await collaboration.commitWorktree(noOpWorktree, "record no-op", { allowNoChanges: true });
      const noOpResult = await coordinator.recordRoleCommit({ runId: "run-lfs", nodeId: "lfs-writer-noop", branchId: "lfs-writer-noop", roleCommit: noChange });
      assert.deepEqual(noChange.lfsObjectIds, []);
      assert.deepEqual(noOpResult.event.payload.lfsObjectIds, []);
      await collaboration.removeWorktree(noOpWorktree.path, true);
    } finally {
      await collaboration.removeWorktree(worktree.path, true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace coordinator release performs materialization, lock fencing, CAS, and publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-release-flow-"));
  const repo = join(root, "repo");
  const worktrees = join(root, "worktrees");
  const evidence = join(root, "evidence");
  try {
    await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
    await writeFile(join(repo, "README.md"), "release\n", "utf8");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "--quiet", "-m", "release"]);
    const head = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    const localChange = join(repo, "uncommitted-note.txt");
    await writeFile(localChange, "keep this local file\n", "utf8");
    const collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: worktrees, runId: "run-release" });
    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: evidence, collaboration });
    let lockClaims = 0;
    let guardedRefUpdates = 0;
    const claim = coordinator.claim.bind(coordinator);
    const updateCanonicalRef = coordinator.updateCanonicalRef.bind(coordinator);
    coordinator.claim = async (...args) => {
      lockClaims += 1;
      return claim(...args);
    };
    coordinator.updateCanonicalRef = async (...args) => {
      guardedRefUpdates += 1;
      return updateCanonicalRef(...args);
    };
    const published = await coordinator.publishRelease({ releaseId: "release-flow", runId: "run-release", workspaceDir: repo, sourceDir: repo, releaseCommit: head, expectedCanonicalHead: head });
    assert.equal(published.status, "published");
    assert.equal(published.releaseCommit, head);
    assert.equal(await (await coordinator.release.load("release-flow")).status, "published");
    assert.equal(lockClaims, 1);
    assert.equal(guardedRefUpdates, 1);
    assert.equal(await readFile(localChange, "utf8"), "keep this local file\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace Release persists OUTPUT_DIGEST_MISMATCH for same-size materialization tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-release-digest-mismatch-"));
  const repo = join(root, "repo");
  const worktrees = join(root, "worktrees");
  const evidence = join(root, "evidence");
  try {
    await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
    await writeFile(join(repo, "README.md"), "original\n", "utf8");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "--quiet", "-m", "release candidate"]);
    const head = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    const collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: worktrees, runId: "run-release-digest-mismatch" });
    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: evidence, collaboration });
    const prepared = await coordinator.release.prepare({
      releaseId: "release-digest-mismatch",
      runId: "run-release-digest-mismatch",
      workspaceId: coordinator.workspaceId,
      releaseCommit: head,
      expectedCanonicalHead: head
    });
    await coordinator.release.materialize({ releaseId: prepared.releaseId, sourceDir: repo });
    const materializedFile = join(evidence, "release-store", "materializations", prepared.releaseId, "output", "README.md");
    await writeFile(materializedFile, "tampered\n", "utf8");

    await assert.rejects(
      () => coordinator.release.reconcile({ releaseId: prepared.releaseId, canonicalHead: head }),
      /OUTPUT_DIGEST_MISMATCH.*materialized output digest mismatch/
    );
    const failed = await coordinator.release.load(prepared.releaseId);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.failureCode, "OUTPUT_DIGEST_MISMATCH");
    assert.equal(failed?.downloadReference, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace Release reconciliation classifies malformed and missing manifest files", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-release-manifest-errors-"));
  const repo = join(root, "repo");
  const worktrees = join(root, "worktrees");
  const evidence = join(root, "evidence");
  try {
    await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
    await writeFile(join(repo, "README.md"), "release\n", "utf8");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "--quiet", "-m", "release"]);
    const head = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    const collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: worktrees, runId: "run-manifest-errors" });
    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: evidence, collaboration });

    for (const [releaseId, failure] of [
      ["release-malformed-manifest", "malformed"],
      ["release-missing-manifest", "missing"]
    ]) {
      const prepared = await coordinator.release.prepare({
        releaseId,
        runId: "run-manifest-errors",
        workspaceId: coordinator.workspaceId,
        releaseCommit: head,
        expectedCanonicalHead: head
      });
      const materialized = await coordinator.release.materialize({ releaseId: prepared.releaseId, sourceDir: repo });
      const manifestPath = join(evidence, "release-store", materialized.materializationManifestRef);
      if (failure === "malformed") await writeFile(manifestPath, "{ invalid json", "utf8");
      else await rm(manifestPath);

      const expectedCode = failure === "malformed" ? "WORKSPACE_MANIFEST_INVALID" : "RELEASE_RECONCILIATION_FAILED";
      await assert.rejects(
        () => coordinator.release.reconcile({ releaseId, canonicalHead: head }),
        new RegExp(expectedCode)
      );
      const failed = await coordinator.release.load(releaseId);
      assert.equal(failed?.status, "failed");
      assert.equal(failed?.failureCode, "RELEASE_RECONCILIATION_FAILED");
      assert.equal(failed?.downloadReference, undefined);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace Release rejects ancestor and unrelated commits before changing canonical HEAD", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-release-non-descendant-"));
  const repo = join(root, "repo");
  const worktrees = join(root, "worktrees");
  const evidence = join(root, "evidence");
  let collaboration;
  let candidateWorktree;
  try {
    await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
    await writeFile(join(repo, "README.md"), "root\n", "utf8");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "--quiet", "-m", "root"]);
    const ancestor = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(join(repo, "canonical.txt"), "expected\n", "utf8");
    await git(repo, ["add", "canonical.txt"]);
    await git(repo, ["commit", "--quiet", "-m", "expected canonical head"]);
    const expectedHead = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();

    collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: worktrees, runId: "run-release-non-descendant" });
    candidateWorktree = await collaboration.addWorktree({ roleId: "candidate", executionId: "sibling-candidate", baseCommit: ancestor });
    await writeFile(join(candidateWorktree.path, "sibling.txt"), "not based on expected head\n", "utf8");
    const sibling = await collaboration.commitWorktree(candidateWorktree, "sibling candidate");
    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: evidence, collaboration, workspaceId: "workspace-release-non-descendant" });

    for (const [releaseId, releaseCommit] of [["release-ancestor", ancestor], ["release-sibling", sibling.resultCommit]]) {
      await assert.rejects(
        () => coordinator.publishRelease({ releaseId, runId: "run-release-non-descendant", workspaceDir: repo, sourceDir: repo, releaseCommit, expectedCanonicalHead: expectedHead }),
        /CANDIDATE_INVALID.*descend/
      );
      const failed = await coordinator.release.load(releaseId);
      assert.equal(failed?.status, "failed");
      assert.equal(failed?.failureCode, "CANDIDATE_INVALID");
      assert.equal(failed?.downloadReference, undefined);
      assert.equal(failed?.materializationManifestRef, undefined);
      assert.equal((await git(repo, ["rev-parse", "HEAD"])).stdout.trim(), expectedHead);
    }
  } finally {
    await collaboration?.removeWorktree(candidateWorktree?.path, true).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace coordinator reconciles a release after a canonical CAS before final publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-reconcile-"));
  const repo = join(root, "repo");
  const worktrees = join(root, "worktrees");
  const evidence = join(root, "evidence");
  let collaboration;
  let candidateWorktree;
  try {
    await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
    await writeFile(join(repo, "README.md"), "base\n", "utf8");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "--quiet", "-m", "base"]);
    const base = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: worktrees, runId: "run-reconcile" });
    candidateWorktree = await collaboration.addWorktree({ roleId: "release", executionId: "exec-release", baseCommit: base });
    await writeFile(join(candidateWorktree.path, "README.md"), "released\n", "utf8");
    const candidate = await collaboration.commitWorktree(candidateWorktree, "release candidate");
    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: evidence, collaboration, workspaceId: "workspace-reconcile" });
    const prepared = await coordinator.release.prepare({
      releaseId: "release-reconcile",
      runId: "run-reconcile",
      workspaceId: coordinator.workspaceId,
      releaseCommit: candidate.resultCommit,
      expectedCanonicalHead: base
    });
    await coordinator.release.materialize({ releaseId: prepared.releaseId, sourceDir: repo });

    // Simulate a successful canonical CAS followed by a process crash before state finalization.
    await git(repo, ["update-ref", "refs/heads/main", candidate.resultCommit, base]);
    await assert.rejects(() => coordinator.reconcileRelease({ releaseId: prepared.releaseId, runId: "another-run", workspaceDir: repo }), /RELEASE_STATE_INVALID.*identity/);
    const recovered = await coordinator.publishRelease({ releaseId: prepared.releaseId, runId: "run-reconcile", workspaceDir: repo, sourceDir: repo, releaseCommit: candidate.resultCommit, expectedCanonicalHead: base });
    assert.equal(recovered.status, "published");
    assert.equal(recovered.releaseCommit, candidate.resultCommit);
    assert.equal((await coordinator.release.load(prepared.releaseId))?.status, "published");
  } finally {
    await collaboration?.removeWorktree(candidateWorktree?.path, true).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace reconciliation does not perform the canonical CAS", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-reconcile-no-cas-"));
  const repo = join(root, "repo");
  const worktrees = join(root, "worktrees");
  const evidence = join(root, "evidence");
  let collaboration;
  let candidateWorktree;
  try {
    await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
    await writeFile(join(repo, "README.md"), "base\n", "utf8");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "--quiet", "-m", "base"]);
    const base = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: worktrees, runId: "run-reconcile-no-cas" });
    candidateWorktree = await collaboration.addWorktree({ roleId: "release", executionId: "exec-release", baseCommit: base });
    await writeFile(join(candidateWorktree.path, "README.md"), "candidate\n", "utf8");
    const candidate = await collaboration.commitWorktree(candidateWorktree, "candidate");
    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: evidence, collaboration, workspaceId: "workspace-reconcile-no-cas" });
    const release = await coordinator.release.prepare({ releaseId: "release-no-cas", runId: "run-reconcile-no-cas", workspaceId: coordinator.workspaceId, releaseCommit: candidate.resultCommit, expectedCanonicalHead: base });
    await coordinator.release.materialize({ releaseId: release.releaseId, sourceDir: repo });

    await assert.rejects(() => coordinator.reconcileRelease({ releaseId: release.releaseId, runId: "run-reconcile-no-cas", workspaceDir: repo }), /RELEASE_RECONCILIATION_FAILED.*canonical ref was not updated/);
    assert.equal((await git(repo, ["rev-parse", "HEAD"])).stdout.trim(), base);
    assert.equal((await coordinator.release.load(release.releaseId))?.status, "materialized");
  } finally {
    await collaboration?.removeWorktree(candidateWorktree?.path, true).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace coordinator rejects an external canonical ref write while a Release lock is held", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-external-ref-"));
  const repo = join(root, "repo");
  const worktrees = join(root, "worktrees");
  const evidence = join(root, "evidence");
  let collaboration;
  const created = [];
  try {
    await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
    await writeFile(join(repo, "README.md"), "base\n", "utf8");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "--quiet", "-m", "base"]);
    const base = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: worktrees, runId: "run-external-ref" });
    const candidateWorktree = await collaboration.addWorktree({ roleId: "candidate", executionId: "exec-candidate", baseCommit: base });
    created.push(candidateWorktree);
    await writeFile(join(candidateWorktree.path, "candidate.txt"), "candidate\n", "utf8");
    const candidate = await collaboration.commitWorktree(candidateWorktree, "candidate");
    const externalWorktree = await collaboration.addWorktree({ roleId: "external", executionId: "exec-external", baseCommit: base });
    created.push(externalWorktree);
    await writeFile(join(externalWorktree.path, "external.txt"), "external\n", "utf8");
    const external = await collaboration.commitWorktree(externalWorktree, "external ref writer");

    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: evidence, collaboration, workspaceId: "workspace-external-ref" });
    const handle = await coordinator.claim({ workspaceDir: repo, owner: "run-external-ref", expectedCanonicalHead: base, currentCanonicalHead: base });
    try {
      await git(repo, ["update-ref", "refs/heads/main", external.resultCommit, base]);
      await assert.rejects(
        () => coordinator.updateCanonicalRef({
          newCommit: candidate.resultCommit,
          expectedCanonicalHead: base,
          workspaceDir: repo,
          lock: handle.lock
        }),
        /WORKSPACE_LOCK_STALE_HEAD/
      );
      assert.equal((await git(repo, ["rev-parse", "HEAD"])).stdout.trim(), external.resultCommit);
    } finally {
      await handle.release();
    }
  } finally {
    for (const worktree of created.reverse()) await collaboration?.removeWorktree(worktree.path, true).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace branch cleanup requires the canonical lock and retains unmerged candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-branch-cleanup-"));
  const repo = join(root, "repo");
  const worktrees = join(root, "worktrees");
  const evidence = join(root, "evidence");
  const created = [];
  let collaboration;
  try {
    await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
    await writeFile(join(repo, "README.md"), "base\n", "utf8");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "--quiet", "-m", "base"]);
    const base = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: worktrees, runId: "run-cleanup" });
    const candidates = [];
    for (const [roleId, file] of [["merged", "merged.txt"], ["retained", "retained.txt"]]) {
      const worktree = await collaboration.addWorktree({ roleId, executionId: `exec-${roleId}`, baseCommit: base });
      created.push(worktree);
      await writeFile(join(worktree.path, file), roleId, "utf8");
      candidates.push(await collaboration.commitWorktree(worktree, roleId));
      if (roleId === "merged") await collaboration.removeWorktree(worktree.path, true);
    }
    const branchesBefore = await collaboration.runBranchEntries();
    assert.equal(branchesBefore.length, 2, "removing a worktree must retain its branch reference");
    await git(repo, ["update-ref", "refs/heads/main", candidates[0].resultCommit, base]);
    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: evidence, collaboration, workspaceId: "workspace-cleanup" });
    const canonicalHead = candidates[0].resultCommit;
    const held = await coordinator.claim({ workspaceDir: repo, owner: "other-run", expectedCanonicalHead: canonicalHead, currentCanonicalHead: canonicalHead });
    try {
      await assert.rejects(() => coordinator.cleanupMergedRunBranches({ runId: "run-cleanup", terminalStatus: "done", owner: "cleanup-run", workspaceDir: repo, expectedCanonicalHead: canonicalHead }), /WORKSPACE_LOCK_HELD/);
    } finally {
      await held.release();
    }
    const removed = await coordinator.cleanupMergedRunBranches({ runId: "run-cleanup", terminalStatus: "done", owner: "cleanup-run", workspaceDir: repo, expectedCanonicalHead: canonicalHead });
    assert.equal(removed.removedWorktrees.length, 1);
    assert.equal(removed.removedBranches.length, 1);
    const branchesAfter = await collaboration.runBranchEntries();
    assert.equal(branchesAfter.length, 1);
    assert.equal(branchesAfter[0].commit, candidates[1].resultCommit);
    assert.equal((await git(repo, ["show", `${candidates[0].resultCommit}:merged.txt`])).stdout, "merged");
    assert.equal((await git(repo, ["show", `${candidates[1].resultCommit}:retained.txt`])).stdout, "retained");
  } finally {
    for (const worktree of created.reverse()) await collaboration?.removeWorktree(worktree.path, true).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace cleanup rechecks the canonical head before removing Run worktrees", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-cleanup-stale-head-"));
  const repo = join(root, "repo");
  const worktrees = join(root, "worktrees");
  const evidence = join(root, "evidence");
  let collaboration;
  let runWorktree;
  try {
    await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
    await writeFile(join(repo, "README.md"), "base\n", "utf8");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "--quiet", "-m", "base"]);
    const base = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: worktrees, runId: "run-cleanup-stale" });
    runWorktree = await collaboration.addWorktree({ roleId: "writer", executionId: "exec-writer", baseCommit: base });
    await writeFile(join(runWorktree.path, "candidate.txt"), "recoverable candidate\n", "utf8");
    const candidate = await collaboration.commitWorktree(runWorktree, "candidate");

    await writeFile(join(repo, "external.txt"), "external update\n", "utf8");
    await git(repo, ["add", "external.txt"]);
    await git(repo, ["commit", "--quiet", "-m", "external update"]);
    const externalHead = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    await git(repo, ["update-ref", "refs/heads/main", base, externalHead]);

    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: evidence, collaboration, workspaceId: "workspace-cleanup-stale" });
    const claim = coordinator.claim.bind(coordinator);
    coordinator.claim = async (args) => {
      const handle = await claim(args);
      await git(repo, ["update-ref", "refs/heads/main", externalHead, base]);
      return handle;
    };

    await assert.rejects(
      () => coordinator.cleanupMergedRunBranches({ runId: "run-cleanup-stale", terminalStatus: "done", owner: "cleanup-stale", workspaceDir: repo, expectedCanonicalHead: base }),
      /WORKSPACE_LOCK_STALE_HEAD/
    );
    assert.equal((await stat(runWorktree.path)).isDirectory(), true);
    const refs = await collaboration.runBranchEntries();
    assert.deepEqual(refs, [{ ref: `refs/heads/${candidate.branch}`, commit: candidate.resultCommit }]);
    assert.equal((await git(repo, ["show", `${candidate.resultCommit}:candidate.txt`])).stdout, "recoverable candidate\n");
  } finally {
    if (runWorktree) await collaboration?.removeWorktree(runWorktree.path, true).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace cleanup preserves evidence and rebuildable candidates when HEAD changes during worktree removal", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-cleanup-head-race-"));
  const repo = join(root, "repo");
  const worktrees = join(root, "worktrees");
  const evidence = join(root, "evidence");
  let collaboration;
  let runWorktree;
  let recoveredWorktree;
  try {
    await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
    await writeFile(join(repo, "README.md"), "base\n", "utf8");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "--quiet", "-m", "base"]);
    const base = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    const baseBranch = await git(repo, ["symbolic-ref", "--short", "HEAD"]);
    collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: worktrees, runId: "run-cleanup-head-race" });
    const prepared = await collaboration.addWorktree({ roleId: "writer", executionId: "exec-writer", baseCommit: base });
    runWorktree = prepared;
    await writeFile(join(prepared.path, "candidate.txt"), "candidate survives\n", "utf8");
    const candidateCommit = await collaboration.commitWorktree(prepared, "candidate");
    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: evidence, collaboration, workspaceId: "workspace-cleanup-head-race" });
    const committed = await coordinator.recordRoleCommit({
      runId: "run-cleanup-head-race",
      nodeId: "writer",
      branchId: "writer@1#1",
      roleCommit: candidateCommit,
      checkpoint: {
        ogsContractVersion: 2,
        schemaVersion: 1,
        runId: "run-cleanup-head-race",
        nodeId: "writer",
        attempt: 1,
        status: "prepared",
        worktreeId: "writer-execution",
        branch: candidateCommit.branch,
        baseCommit: base,
        branchId: "writer@1#1",
        lineageId: "writer@1#1",
        round: 1,
        loopIteration: 0,
        stateVersion: 0,
        decisionBackground: {},
        evidenceRefs: []
      }
    });
    await writeFile(join(evidence, "events.ndjson"), `${JSON.stringify(committed.event)}\n`, "utf8");
    const manifest = await coordinator.writeEvidenceManifest({ runId: "run-cleanup-head-race" });

    await writeFile(join(repo, "external.txt"), "external update\n", "utf8");
    await git(repo, ["add", "external.txt"]);
    await git(repo, ["commit", "--quiet", "-m", "external update"]);
    const externalHead = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    await git(repo, ["update-ref", `refs/heads/${baseBranch.stdout.trim()}`, base, externalHead]);

    const racingCollaboration = Object.freeze({
      ...collaboration,
      async removeRunWorktrees() {
        const removed = await collaboration.removeRunWorktrees();
        await git(repo, ["update-ref", `refs/heads/${baseBranch.stdout.trim()}`, externalHead, base]);
        return removed;
      }
    });
    const racingCoordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: evidence, collaboration: racingCollaboration, workspaceId: "workspace-cleanup-head-race" });
    await assert.rejects(
      () => racingCoordinator.cleanupMergedRunBranches({ runId: "run-cleanup-head-race", terminalStatus: "done", owner: "cleanup-head-race", workspaceDir: repo, expectedCanonicalHead: base }),
      /WORKSPACE_LOCK_STALE_HEAD/
    );

    await assert.rejects(() => stat(prepared.path), { code: "ENOENT" });
    const refs = await collaboration.runBranchEntries();
    assert.deepEqual(refs, [{ ref: `refs/heads/${candidateCommit.branch}`, commit: candidateCommit.resultCommit }]);
    assert.equal((await git(repo, ["show", `${candidateCommit.resultCommit}:candidate.txt`])).stdout, "candidate survives\n");
    assert.deepEqual(JSON.parse(await readFile(join(evidence, "evidence-manifest.json"), "utf8")), manifest);
    assert.equal(await readFile(join(evidence, "events.ndjson"), "utf8"), `${JSON.stringify(committed.event)}\n`);

    recoveredWorktree = await collaboration.addWorktree({ roleId: "recovery", executionId: "rebuild-candidate", baseCommit: candidateCommit.resultCommit });
    assert.equal(await readFile(join(recoveredWorktree.path, "candidate.txt"), "utf8"), "candidate survives\n");
  } finally {
    if (recoveredWorktree) await collaboration?.removeWorktree(recoveredWorktree.path, true).catch(() => undefined);
    if (runWorktree) await collaboration?.removeWorktree(runWorktree.path, true).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("WorkspaceRef rejects committed symbolic links before reading their target", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-symlink-"));
  const repo = join(root, "repo");
  try {
    await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
    await writeFile(join(repo, "outside.txt"), "outside\n", "utf8");
    await symlink("outside.txt", join(repo, "link.txt"));
    await git(repo, ["add", "outside.txt", "link.txt"]);
    await git(repo, ["commit", "--quiet", "-m", "symlink"]);
    const head = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    const collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: join(root, "worktrees"), runId: "run-symlink" });
    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: join(root, "evidence"), collaboration });
    const ref = coordinator.workspaceRef({ commit: head, path: "link.txt", digest: `sha256:${createHash("sha256").update("outside\n").digest("hex")}` });
    await assert.rejects(() => coordinator.readWorkspaceRef(ref), /WORKSPACE_REF_SYMLINK/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
