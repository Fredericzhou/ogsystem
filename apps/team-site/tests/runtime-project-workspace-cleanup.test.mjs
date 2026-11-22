import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createGitCollaboration } from "../../../dist/runtime/adapter.js";
import { createRuntimeProjectRunExecutor } from "../infrastructure/runtime-project-run-executor.mjs";
import { ensureGitLfsWorkspace, readWorkspaceHead } from "../infrastructure/workspace-repository.mjs";

const execFile = promisify(execFileCallback);

test("Project Run cleanup removes its worktree and retains an unmerged branch and commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-project-run-cleanup-"));
  const projectRoot = join(root, "project");
  const workspaceDir = join(projectRoot, "workspace");
  const runId = "run-cleanup-integration";
  let collaboration;
  try {
    await mkdir(projectRoot, { recursive: true });
    const workspace = await ensureGitLfsWorkspace({ workspaceDir });
    collaboration = createGitCollaboration({
      repositoryRoot: workspaceDir,
      worktreeRoot: resolve(projectRoot, ".ogs", "worktrees"),
      runId,
      workspaceId: workspace.workspaceId
    });
    const candidateWorktree = await collaboration.addWorktree({ roleId: "candidate", executionId: "exec-1", baseCommit: workspace.baseCommit });
    await writeFile(join(candidateWorktree.path, "candidate.txt"), "retained candidate\n", "utf8");
    const candidate = await collaboration.commitWorktree(candidateWorktree, "candidate commit");

    const executor = createRuntimeProjectRunExecutor();
    const result = await executor.cleanupWorkspace({
      projectId: "project-1",
      workdir: projectRoot,
      ogsDir: projectRoot,
      workspaceDir,
      workspaceId: workspace.workspaceId
    }, {
      runId,
      terminalStatus: "failed",
      workspaceId: workspace.workspaceId,
      expectedCanonicalHead: workspace.baseCommit
    });

    assert.deepEqual(result.removedWorktrees, [candidateWorktree.path]);
    assert.deepEqual(result.removedBranches, []);
    const remainingWorktrees = (await execFile("git", ["worktree", "list", "--porcelain"], { cwd: workspaceDir })).stdout;
    assert.equal(remainingWorktrees.includes(candidateWorktree.path), false);
    assert.equal((await collaboration.runBranchEntries()).length, 1);
    assert.equal((await execFile("git", ["show", `${candidate.resultCommit}:candidate.txt`], { cwd: workspaceDir })).stdout, "retained candidate\n");
    assert.equal(await readWorkspaceHead(workspaceDir), workspace.baseCommit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
