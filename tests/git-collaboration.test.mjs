import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { createGitCollaboration, probeGitCollaboration } from "../dist/runtime/adapter.js";

const execFile = promisify(execFileCallback);

async function git(cwd, args) {
  return execFile("git", ["-c", "user.name=Git Collaboration Test", "-c", "user.email=git-collab@example.test", ...args], { cwd });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ogs-git-collaboration-"));
  const repo = join(root, "repo");
  const worktrees = join(root, "worktrees");
  await git(root, ["init", "--quiet", repo]);
  await writeFile(join(repo, "shared.txt"), "base\n", "utf8");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "--quiet", "-m", "base"]);
  return { root, repo, worktrees };
}

async function cleanup(result) {
  if (result?.path) await result.collaboration.removeWorktree(result.path, true).catch(() => undefined);
  await rm(result?.fixture?.root ?? result?.root, { recursive: true, force: true });
}

test("probe rejects dirty repositories and workspaces outside the repository", async () => {
  const item = await fixture();
  try {
    const clean = await probeGitCollaboration({ repositoryRoot: item.repo, workspaceDir: item.repo });
    assert.equal(clean.supported, true);
    await writeFile(join(item.repo, "dirty.txt"), "dirty\n", "utf8");
    const dirty = await probeGitCollaboration({ repositoryRoot: item.repo, workspaceDir: item.repo });
    assert.equal(dirty.supported, false);
    assert.equal(dirty.reason, "WORKTREE_NOT_CLEAN");
    const outside = await probeGitCollaboration({ repositoryRoot: item.repo, workspaceDir: item.root });
    assert.equal(outside.reason, "WORKSPACE_OUTSIDE_REPOSITORY");
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("probe rejects tracked submodules", async () => {
  const item = await fixture();
  try {
    const submoduleCommit = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    await git(item.repo, ["update-index", "--add", "--cacheinfo", `160000,${submoduleCommit},vendor/submodule`]);
    await git(item.repo, ["commit", "--quiet", "-m", "add submodule entry"]);
    const result = await probeGitCollaboration({ repositoryRoot: item.repo, workspaceDir: item.repo });
    assert.equal(result.supported, false);
    assert.equal(result.reason, "SUBMODULE_UNSUPPORTED");
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("probe accepts repositories with tracked LFS attributes when Git LFS is available", async () => {
  const item = await fixture();
  try {
    await writeFile(join(item.repo, ".gitattributes"), "*.bin filter=lfs diff=lfs merge=lfs -text\n", "utf8");
    await git(item.repo, ["add", ".gitattributes"]);
    await git(item.repo, ["commit", "--quiet", "-m", "add lfs attributes"]);
    const result = await probeGitCollaboration({ repositoryRoot: item.repo, workspaceDir: item.repo });
    let lfsAvailable = true;
    try {
      await git(item.repo, ["lfs", "version"]);
    } catch {
      lfsAvailable = false;
    }
    assert.equal(result.supported, lfsAvailable);
    if (!lfsAvailable) assert.equal(result.reason, "LFS_UNAVAILABLE");
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("commit fails closed when a committed Git LFS pointer has no local object", async () => {
  const item = await fixture();
  let collaboration;
  let worktree;
  try {
    collaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId: "run-lfs-missing" });
    const baseCommit = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    worktree = await collaboration.addWorktree({ roleId: "writer", executionId: "exec-lfs", baseCommit });
    await writeFile(join(worktree.path, "payload.bin"), `version https://git-lfs.github.com/spec/v1\noid sha256:${"a".repeat(64)}\nsize 3\n`, "utf8");
    await assert.rejects(
      () => collaboration.commitWorktree(worktree, "missing lfs object"),
      /WORKSPACE_LFS_UNAVAILABLE/
    );
  } finally {
    if (worktree && collaboration) await collaboration.removeWorktree(worktree.path, true).catch(() => undefined);
    await rm(item.root, { recursive: true, force: true });
  }
});

test("probe rejects sparse checkout repositories", async () => {
  const item = await fixture();
  try {
    await writeFile(join(item.repo, "other.txt"), "other\n", "utf8");
    await git(item.repo, ["add", "other.txt"]);
    await git(item.repo, ["commit", "--quiet", "-m", "add sparse candidate"]);
    await git(item.repo, ["sparse-checkout", "init", "--no-cone"]);
    await git(item.repo, ["sparse-checkout", "set", "shared.txt"]);
    const result = await probeGitCollaboration({ repositoryRoot: item.repo, workspaceDir: item.repo });
    assert.equal(result.supported, false);
    assert.equal(result.reason, "SPARSE_CHECKOUT_UNSUPPORTED");
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("recovers a committed Role result after the worker process exits", async () => {
  const item = await fixture();
  const runId = "run-process-recovery";
  const script = `
    import { writeFile } from "node:fs/promises";
    import { join } from "node:path";
    import { createGitCollaboration } from ${JSON.stringify(new URL("../dist/runtime/adapter.js", import.meta.url).href)};
    const collaboration = createGitCollaboration({
      repositoryRoot: process.env.OGS_REPO,
      worktreeRoot: process.env.OGS_WORKTREES,
      runId: ${JSON.stringify(runId)}
    });
    const worktree = await collaboration.addWorktree({ roleId: "worker", executionId: "execution-1", baseCommit: process.env.OGS_BASE });
    await writeFile(join(worktree.path, "worker.txt"), "persisted before interruption\\n", "utf8");
    const commit = await collaboration.commitWorktree(worktree, "worker result before interruption");
    process.stdout.write(JSON.stringify(commit));
    process.exit(17);
  `;
  let childOutput = "";
  try {
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    await execFile(process.execPath, ["--input-type=module", "-e", script], {
      cwd: item.root,
      env: { ...process.env, OGS_REPO: item.repo, OGS_WORKTREES: item.worktrees, OGS_BASE: base },
      maxBuffer: 8 * 1024 * 1024
    });
    assert.fail("worker process should have exited at the interruption point");
  } catch (error) {
    assert.equal(error?.code, 17);
    childOutput = String(error?.stdout ?? "");
  }
  try {
    const commit = JSON.parse(childOutput);
    const recovered = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId });
    await recovered.registerRoleCommit(commit);
    const merged = await recovered.mergeCommits({
      mergeId: "recovered-merge",
      baseCommit: commit.baseCommit,
      candidateCommits: [commit.resultCommit]
    });
    assert.equal(merged.status, "merged");
    const verification = await recovered.verifyMergeWorktree(merged.path, commit.baseCommit, {
      mergeId: merged.mergeId,
      branch: merged.branch,
      mergeCommit: merged.mergeCommit,
      candidateCommits: [commit.resultCommit]
    });
    assert.equal(verification.passed, true);
    assert.equal(await readFile(join(merged.path, "worker.txt"), "utf8"), "persisted before interruption\n");
    await recovered.removeWorktree(merged.path, true);
    await recovered.removeWorktree(commit.path, true);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("records changed paths when a Role commits inside its worktree", async () => {
  const item = await fixture();
  const collaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId: "run-worker-commit", workspaceId: "workspace-project-stable" });
  let role;
  try {
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    role = await collaboration.addWorktree({ roleId: "role-worker-commit", executionId: "exec-worker-commit", baseCommit: base });
    await writeFile(join(role.path, "worker-committed.txt"), "committed by worker\n", "utf8");
    await git(role.path, ["add", "worker-committed.txt"]);
    await git(role.path, ["commit", "--quiet", "-m", "worker commit"]);
    const commit = await collaboration.commitWorktree(role, "record worker commit", { allowNoChanges: true });
    assert.deepEqual(commit.changedPaths, ["worker-committed.txt"]);
    assert.equal(commit.workspaceRefs[0].workspaceId, "workspace-project-stable");
  } finally {
    if (role) await collaboration.removeWorktree(role.path, true).catch(() => undefined);
    await rm(item.root, { recursive: true, force: true });
  }
});

test("isolates role worktrees and merges independent commits", async () => {
  const item = await fixture();
  const collaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId: "run-independent" });
  const created = [];
  try {
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    const a = await collaboration.addWorktree({ roleId: "role-a", executionId: "exec-a", baseCommit: base });
    const b = await collaboration.addWorktree({ roleId: "role-b", executionId: "exec-b", baseCommit: base });
    created.push(a, b);
    assert.notEqual(a.path, b.path);
    await writeFile(join(a.path, "a.txt"), "A\n", "utf8");
    await writeFile(join(b.path, "b.txt"), "B\n", "utf8");
    const commitA = await collaboration.commitWorktree(a, "role A change");
    const commitB = await collaboration.commitWorktree(b, "role B change");
    assert.equal(commitA.baseCommit, base);
    assert.equal(commitA.changedPaths.includes("a.txt"), true);
    const merged = await collaboration.mergeCommits({ mergeId: "merge-independent", baseCommit: base, candidateCommits: [commitA.resultCommit, commitB.resultCommit] });
    created.push(merged);
    assert.equal(merged.status, "merged");
    assert.ok(merged.mergeCommit);
    const verification = await collaboration.verifyMergeWorktree(merged.path, base);
    assert.equal(verification.passed, true);
    assert.deepEqual(verification.changedPaths, ["a.txt", "b.txt"]);
    assert.equal(await readFile(join(merged.path, "a.txt"), "utf8"), "A\n");
    assert.equal(await readFile(join(merged.path, "b.txt"), "utf8"), "B\n");
    const resumed = await collaboration.mergeCommits({ mergeId: "merge-independent", baseCommit: base, candidateCommits: [commitA.resultCommit, commitB.resultCommit] });
    assert.equal(resumed.status, "merged");
    assert.equal(resumed.path, merged.path);
    assert.equal(resumed.mergeCommit, merged.mergeCommit);
  } finally {
    for (const value of created.reverse()) await collaboration.removeWorktree(value.path, true).catch(() => undefined);
    await rm(item.root, { recursive: true, force: true });
  }
});

test("rebuilds a merge worktree when the candidate set changes", async () => {
  const item = await fixture();
  const collaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId: "run-candidate-set" });
  const created = [];
  try {
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    const a = await collaboration.addWorktree({ roleId: "role-a", executionId: "exec-a", baseCommit: base });
    const b = await collaboration.addWorktree({ roleId: "role-b", executionId: "exec-b", baseCommit: base });
    created.push(a, b);
    await writeFile(join(a.path, "a.txt"), "A\n", "utf8");
    await writeFile(join(b.path, "b.txt"), "B\n", "utf8");
    const commitA = await collaboration.commitWorktree(a, "role A change");
    const commitB = await collaboration.commitWorktree(b, "role B change");
    const first = await collaboration.mergeCommits({ mergeId: "merge-candidate-set", baseCommit: base, candidateCommits: [commitA.resultCommit] });
    created.push(first);
    const rebuilt = await collaboration.mergeCommits({
      mergeId: "merge-candidate-set",
      baseCommit: base,
      candidateCommits: [commitB.resultCommit]
    });
    assert.equal(rebuilt.status, "merged");
    assert.notEqual(rebuilt.mergeCommit, first.mergeCommit);
    assert.equal(await readFile(join(rebuilt.path, "b.txt"), "utf8"), "B\n");
    await assert.rejects(readFile(join(rebuilt.path, "a.txt"), "utf8"));
  } finally {
    for (const value of created.reverse()) await collaboration.removeWorktree(value.path, true).catch(() => undefined);
    await rm(item.root, { recursive: true, force: true });
  }
});

test("rebuilds an existing merge worktree when candidate order changes", async () => {
  const item = await fixture();
  const collaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId: "run-merge-order" });
  const created = [];
  try {
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    const a = await collaboration.addWorktree({ roleId: "role-a", executionId: "exec-a", baseCommit: base });
    const b = await collaboration.addWorktree({ roleId: "role-b", executionId: "exec-b", baseCommit: base });
    created.push(a, b);
    await writeFile(join(a.path, "a.txt"), "A\n", "utf8");
    await writeFile(join(b.path, "b.txt"), "B\n", "utf8");
    const commitA = await collaboration.commitWorktree(a, "role A change");
    const commitB = await collaboration.commitWorktree(b, "role B change");
    const first = await collaboration.mergeCommits({ mergeId: "merge-order", baseCommit: base, candidateCommits: [commitA.resultCommit, commitB.resultCommit] });
    created.push(first);
    const reordered = await collaboration.mergeCommits({ mergeId: "merge-order", baseCommit: base, candidateCommits: [commitB.resultCommit, commitA.resultCommit] });
    assert.equal(reordered.status, "merged");
    assert.notEqual(reordered.mergeCommit, first.mergeCommit);
    const firstParentCommits = (await git(reordered.path, ["rev-list", "--first-parent", "--reverse", `${base}..${reordered.mergeCommit}`])).stdout.trim().split(/\r?\n/).filter(Boolean);
    const appliedOrder = [];
    for (const mergeCommit of firstParentCommits) {
      const parents = (await git(reordered.path, ["rev-list", "--parents", "-n", "1", mergeCommit])).stdout.trim().split(" ").slice(1);
      if (parents[1]) appliedOrder.push(parents[1]);
    }
    assert.deepEqual(appliedOrder, [commitB.resultCommit, commitA.resultCommit]);
  } finally {
    for (const value of created.reverse()) await collaboration.removeWorktree(value.path, true).catch(() => undefined);
    await rm(item.root, { recursive: true, force: true });
  }
});

test("verifies a persisted merge head and candidate set against the actual worktree", async () => {
  const item = await fixture();
  const collaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId: "run-merge-evidence" });
  const created = [];
  try {
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    const role = await collaboration.addWorktree({ roleId: "role-evidence", executionId: "exec-evidence", baseCommit: base });
    const other = await collaboration.addWorktree({ roleId: "role-other", executionId: "exec-other", baseCommit: base });
    created.push(role, other);
    await writeFile(join(role.path, "evidence.txt"), "verified\n", "utf8");
    await writeFile(join(other.path, "other.txt"), "other\n", "utf8");
    const commit = await collaboration.commitWorktree(role, "evidence change");
    const otherCommit = await collaboration.commitWorktree(other, "other change");
    const merged = await collaboration.mergeCommits({ mergeId: "merge-evidence", baseCommit: base, candidateCommits: [commit.resultCommit] });
    created.push(merged);
    const wrongHead = await collaboration.verifyMergeWorktree(merged.path, base, {
      mergeId: merged.mergeId,
      branch: merged.branch,
      mergeCommit: otherCommit.resultCommit,
      candidateCommits: [commit.resultCommit]
    });
    assert.equal(wrongHead.passed, false);
    assert.equal(wrongHead.reason, "MERGE_HEAD_MISMATCH");
    const wrongCandidates = await collaboration.verifyMergeWorktree(merged.path, base, {
      mergeId: merged.mergeId,
      branch: merged.branch,
      mergeCommit: merged.mergeCommit,
      candidateCommits: [otherCommit.resultCommit]
    });
    assert.equal(wrongCandidates.passed, false);
    assert.equal(wrongCandidates.reason, "MERGE_CANDIDATE_MISMATCH");
  } finally {
    for (const value of created.reverse()) await collaboration.removeWorktree(value.path, true).catch(() => undefined);
    await rm(item.root, { recursive: true, force: true });
  }
});

test("rejects persisted merge verification when Role provenance is missing", async () => {
  const item = await fixture();
  const collaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId: "run-merge-provenance-recovery" });
  const created = [];
  try {
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    const role = await collaboration.addWorktree({ roleId: "role-recovery", executionId: "exec-recovery", baseCommit: base });
    created.push(role);
    await writeFile(join(role.path, "recovery.txt"), "verified\n", "utf8");
    const commit = await collaboration.commitWorktree(role, "recovery change");
    const merged = await collaboration.mergeCommits({ mergeId: "merge-recovery", baseCommit: base, candidateCommits: [commit.resultCommit] });
    created.push(merged);
    const recoveredCollaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId: "run-merge-provenance-recovery" });
    const verification = await recoveredCollaboration.verifyMergeWorktree(merged.path, base, {
      mergeId: merged.mergeId,
      branch: merged.branch,
      mergeCommit: merged.mergeCommit,
      candidateCommits: [commit.resultCommit]
    });
    assert.equal(verification.passed, false);
    assert.equal(verification.reason, "MERGE_CANDIDATE_PROVENANCE_MISMATCH");
  } finally {
    for (const value of created.reverse()) await collaboration.removeWorktree(value.path, true).catch(() => undefined);
    await rm(item.root, { recursive: true, force: true });
  }
});

test("recovers a committed Role from a merge worktree checkpoint", async () => {
  const item = await fixture();
  const runId = "run-merge-role-recovery";
  const collaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId });
  const created = [];
  try {
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    const source = await collaboration.addWorktree({ roleId: "source", executionId: "source-exec", baseCommit: base });
    created.push(source);
    await writeFile(join(source.path, "source.txt"), "source\n", "utf8");
    const sourceCommit = await collaboration.commitWorktree(source, "source change");
    const merged = await collaboration.mergeCommits({ mergeId: "merge-role", baseCommit: base, candidateCommits: [sourceCommit.resultCommit] });
    created.push(merged);
    await writeFile(join(merged.path, "join-output.txt"), "join\n", "utf8");
    const mergeRole = {
      roleId: "join-role",
      executionId: "join-exec",
      branch: merged.branch,
      path: merged.path,
      baseCommit: merged.baseCommit
    };
    const committed = await collaboration.commitWorktree(mergeRole, "merge role change");
    const recoveredCollaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId });
    const recovered = await recoveredCollaboration.recoverPreparedRoleCommit({
      roleId: mergeRole.roleId,
      executionId: mergeRole.executionId,
      branch: mergeRole.branch,
      baseCommit: mergeRole.baseCommit
    });
    assert.equal(recovered?.resultCommit, committed.resultCommit);
    assert.equal(recovered?.branch, merged.branch);
    assert.deepEqual(recovered?.changedPaths, ["join-output.txt"]);
    assert.equal(/[\\/]merge-merge-role$/.test(recovered?.path ?? ""), true);
  } finally {
    for (const value of created.reverse()) await collaboration.removeWorktree(value.path, true).catch(() => undefined);
    await rm(item.root, { recursive: true, force: true });
  }
});

test("preserves whitespace and status-looking bytes in Git path provenance", async () => {
  const item = await fixture();
  const collaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId: "run-path-bytes" });
  const created = [];
  try {
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    const role = await collaboration.addWorktree({ roleId: "role-paths", executionId: "exec-paths", baseCommit: base });
    created.push(role);
    // Windows NTFS strips trailing spaces from filenames, so retain leading/internal space cases on win32.
    const paths = process.platform === "win32"
      ? [" leading.txt", "ab file.txt"]
      : [" leading.txt", "ab file.txt", "trailing.txt "];
    for (const path of paths) await writeFile(join(role.path, path), "content\n", "utf8");
    const commit = await collaboration.commitWorktree(role, "preserve path bytes");
    assert.deepEqual(commit.changedPaths, paths);
    const merged = await collaboration.mergeCommits({ mergeId: "merge-path-bytes", baseCommit: base, candidateCommits: [commit.resultCommit] });
    created.push(merged);
    assert.equal(merged.status, "merged");
    const verification = await collaboration.verifyMergeWorktree(merged.path, base);
    assert.equal(verification.passed, true);
    assert.deepEqual(verification.changedPaths, paths);
  } finally {
    for (const value of created.reverse()) await collaboration.removeWorktree(value.path, true).catch(() => undefined);
    await rm(item.root, { recursive: true, force: true });
  }
});

test("role and execution identifiers that collide under concatenation get distinct worktrees", async () => {
  const item = await fixture();
  const collaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId: "run-id-collision" });
  const created = [];
  try {
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    const first = await collaboration.addWorktree({ roleId: "a-b", executionId: "c", baseCommit: base });
    const second = await collaboration.addWorktree({ roleId: "a", executionId: "b-c", baseCommit: base });
    created.push(first, second);
    assert.notEqual(first.path, second.path);
    assert.notEqual(first.branch, second.branch);
  } finally {
    for (const value of created.reverse()) await collaboration.removeWorktree(value.path, true).catch(() => undefined);
    await rm(item.root, { recursive: true, force: true });
  }
});

test("merge verification checks the full base-to-head diff across all candidates", async () => {
  const item = await fixture();
  const collaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId: "run-full-diff" });
  const created = [];
  try {
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    const a = await collaboration.addWorktree({ roleId: "role-a", executionId: "exec-a", baseCommit: base });
    const b = await collaboration.addWorktree({ roleId: "role-b", executionId: "exec-b", baseCommit: base });
    created.push(a, b);
    await writeFile(join(a.path, "a.txt"), "trailing whitespace \n", "utf8");
    await writeFile(join(b.path, "b.txt"), "B\n", "utf8");
    const commitA = await collaboration.commitWorktree(a, "role A change");
    const commitB = await collaboration.commitWorktree(b, "role B change");
    const merged = await collaboration.mergeCommits({ mergeId: "merge-full-diff", baseCommit: base, candidateCommits: [commitA.resultCommit, commitB.resultCommit] });
    created.push(merged);
    assert.equal(merged.status, "merged");
    const verification = await collaboration.verifyMergeWorktree(merged.path, base);
    assert.equal(verification.passed, false);
    assert.equal(verification.reason, "DIFF_CHECK_FAILED");
    assert.deepEqual(verification.changedPaths, ["a.txt", "b.txt"]);
  } finally {
    for (const value of created.reverse()) await collaboration.removeWorktree(value.path, true).catch(() => undefined);
    await rm(item.root, { recursive: true, force: true });
  }
});

test("returns conflict evidence and does not publish a merge commit", async () => {
  const item = await fixture();
  const collaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId: "run-conflict" });
  const created = [];
  try {
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    const a = await collaboration.addWorktree({ roleId: "role-a", executionId: "exec-a", baseCommit: base });
    const b = await collaboration.addWorktree({ roleId: "role-b", executionId: "exec-b", baseCommit: base });
    created.push(a, b);
    await writeFile(join(a.path, "shared.txt"), "from A\n", "utf8");
    await writeFile(join(b.path, "shared.txt"), "from B\n", "utf8");
    const commitA = await collaboration.commitWorktree(a, "role A conflicting change");
    const commitB = await collaboration.commitWorktree(b, "role B conflicting change");
    const merged = await collaboration.mergeCommits({ mergeId: "merge-conflict", baseCommit: base, candidateCommits: [commitA.resultCommit, commitB.resultCommit] });
    created.push(merged);
    assert.equal(merged.status, "conflict");
    assert.deepEqual(merged.conflictPaths, ["shared.txt"]);
    assert.equal(merged.mergeCommit, undefined);
    const status = await git(merged.path, ["status", "--porcelain"]);
    assert.match(status.stdout, /UU shared\.txt/);
  } finally {
    for (const value of created.reverse()) await collaboration.removeWorktree(value.path, true).catch(() => undefined);
    await rm(item.root, { recursive: true, force: true });
  }
});

test("refuses a worktree root inside the repository", async () => {
  const item = await fixture();
  try {
    const collaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: join(item.repo, ".ogs-worktrees"), runId: "run-invalid" });
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    await assert.rejects(
      collaboration.addWorktree({ roleId: "role", executionId: "execution", baseCommit: base }),
      /WORKTREE_ROOT_MUST_BE_OUTSIDE_REPOSITORY/
    );
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("checks real worktree containment through symlinked roots", async (t) => {
  const item = await fixture();
  const outside = join(item.root, "outside");
  const insideLink = join(item.root, "inside-link");
  const outsideLink = join(item.root, "outside-link");
  try {
    await mkdir(outside, { recursive: true });
    try {
      await symlink(item.repo, insideLink, process.platform === "win32" ? "junction" : "dir");
      await symlink(outside, outsideLink, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code)) {
        t.skip(`directory links unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    const inside = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: insideLink, runId: "run-symlink-inside" });
    await assert.rejects(
      inside.addWorktree({ roleId: "role", executionId: "execution", baseCommit: base }),
      /WORKTREE_ROOT_MUST_BE_OUTSIDE_REPOSITORY/
    );
    const outsideCollaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: outsideLink, runId: "run-symlink-outside" });
    const worktree = await outsideCollaboration.addWorktree({ roleId: "role", executionId: "execution", baseCommit: base });
    await outsideCollaboration.removeWorktree(worktree.path, true);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("rejects candidate commits without Role provenance from this collaboration run", async () => {
  const item = await fixture();
  try {
    const collaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId: "run-provenance" });
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(join(item.repo, "untrusted.txt"), "untrusted\n", "utf8");
    await git(item.repo, ["add", "untrusted.txt"]);
    await git(item.repo, ["commit", "--quiet", "-m", "untrusted commit"]);
    const untrusted = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    await assert.rejects(
      collaboration.mergeCommits({ mergeId: "merge-untrusted", baseCommit: base, candidateCommits: [untrusted] }),
      /CANDIDATE_PROVENANCE_INVALID/
    );
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("mergeCommits fails closed instead of reporting conflict when git merge errors without unmerged paths", async () => {
  const item = await fixture();
  const collaboration = createGitCollaboration({ repositoryRoot: item.repo, worktreeRoot: item.worktrees, runId: "run-merge-nonconflict-error" });
  const created = [];
  try {
    const base = (await git(item.repo, ["rev-parse", "HEAD"])).stdout.trim();
    const roleA = await collaboration.addWorktree({ roleId: "role-a", executionId: "exec-a", baseCommit: base });
    const roleB = await collaboration.addWorktree({ roleId: "role-b", executionId: "exec-b", baseCommit: base });
    created.push(roleA, roleB);
    await writeFile(join(roleA.path, "a.txt"), "A\n", "utf8");
    await writeFile(join(roleB.path, "b.txt"), "B\n", "utf8");
    const commitA = await collaboration.commitWorktree(roleA, "role A change");
    const commitB = await collaboration.commitWorktree(roleB, "role B change");
    const treeB = (await git(item.repo, ["rev-parse", `${commitB.resultCommit}^{tree}`])).stdout.trim();
    // Remove commitB's loose tree object after provenance registration so git merge fails at tree-read time with no unmerged paths.
    await rm(join(item.repo, ".git", "objects", treeB.slice(0, 2), treeB.slice(2)), { force: true });
    await assert.rejects(
      collaboration.mergeCommits({ mergeId: "merge-nonconflict", baseCommit: base, candidateCommits: [commitA.resultCommit, commitB.resultCommit] }),
      /GIT_COLLABORATION_MERGE_FAILED/
    );
  } finally {
    for (const value of created.reverse()) await collaboration.removeWorktree(value.path, true).catch(() => undefined);
    await rm(item.root, { recursive: true, force: true });
  }
});
