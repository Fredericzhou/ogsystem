import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createGitCollaboration, createWorkspaceCoordinator, runSystemWithAdapter } from "../dist/runtime/adapter.js";

const execFile = promisify(execFileCallback);

async function git(cwd, args) {
  return execFile("git", ["-c", "user.name=Workspace Test", "-c", "user.email=workspace@example.test", ...args], { cwd });
}

test("resume reclaims an uncommitted prepared worktree without rerunning committed Roles", { concurrency: false }, async () => {
  const repoRoot = process.cwd();
  const workdir = await mkdtemp(join(tmpdir(), "ogs-prepared-resume-run-"));
  const worktreeRoot = `${workdir}-worktrees`;
  const runId = "20261119-prepared-recovery-0001";
  try {
    await mkdir(join(workdir, ".ogs"), { recursive: true });
    await symlink(join(repoRoot, "og-roles"), join(workdir, "og-roles"), "dir");
    for (const name of ["runtime.json", "execution-bindings.json", "model-catalog.json", "laws.json", "user-profile.json"]) {
      await symlink(join(repoRoot, ".ogs", name), join(workdir, ".ogs", name));
    }
    await writeFile(join(workdir, ".gitignore"), ".ogs/\nog-roles\n", "utf8");
    await writeFile(join(workdir, "evidence.md"), "Prepared recovery baseline.\n", "utf8");
    await git(workdir, ["init", "--initial-branch=main", "--quiet"]);
    await git(workdir, ["add", ".gitignore", "evidence.md"]);
    await git(workdir, ["commit", "--quiet", "-m", "Workspace baseline"]);
    const baseCommit = (await git(workdir, ["rev-parse", "HEAD"])).stdout.trim();
    const collaboration = createGitCollaboration({ repositoryRoot: workdir, worktreeRoot, runId, workspaceId: "workspace-prepared-recovery-test" });
    const args = {
      systemPath: resolve(repoRoot, "examples/medical-quorum-consultation/system.mmd"),
      runtimeConfigPath: join(workdir, ".ogs", "runtime.json"),
      lawsPath: resolve(repoRoot, "examples/medical-quorum-consultation/laws.json"),
      userProfilePath: join(workdir, ".ogs", "user-profile.json"),
      prompt: "Exercise prepared Workspace recovery.",
      workdir,
      runId,
      dryRun: true,
      gitCollaboration: { collaboration, baseCommit }
    };

    const childConfig = {
      args: { ...args, gitCollaboration: undefined },
      collaboration: { repositoryRoot: workdir, worktreeRoot, runId, workspaceId: "workspace-prepared-recovery-test" },
      baseCommit
    };
    const childScript = [
      `const { runSystemWithAdapter, createGitCollaboration } = await import(${JSON.stringify(pathToFileURL(join(repoRoot, "dist/runtime/adapter.js")).href)});`,
      "const config = JSON.parse(process.env.OGS_TEST_PREPARED_RECOVERY_CONFIG);",
      "const collaboration = createGitCollaboration(config.collaboration);",
      "await runSystemWithAdapter({ ...config.args, gitCollaboration: { collaboration, baseCommit: config.baseCommit } });"
    ].join("\n");
    await assert.rejects(
      execFile(process.execPath, ["--input-type=module", "-e", childScript], {
        cwd: repoRoot,
        env: {
          ...process.env,
          OGS_TEST_PREPARED_RECOVERY_CONFIG: JSON.stringify(childConfig),
          OGSYSTEM_ENABLE_TEST_HOOKS: "1",
          OGSYSTEM_TEST_CRASH_AFTER_EXECUTION_CANDIDATE: "2"
        }
      }),
      (error) => error.code === 95
    );

    const runDir = join(workdir, ".ogs", "runs", runId);
    const eventsPath = join(runDir, "events.ndjson");
    const eventsBeforeResume = (await readFile(eventsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const durableRoleResult = eventsBeforeResume.find((event) => ["git_collaboration_role_commit", "git_collaboration_role_result"].includes(event.type));
    assert.ok(durableRoleResult, "the first Role result was durable before the interruption");
    const startedCountBeforeResume = eventsBeforeResume.filter((event) => event.type === "role.started" && event.roleId === durableRoleResult.roleId).length;
    assert.equal(startedCountBeforeResume, 1);

    delete process.env.OGSYSTEM_TEST_INTERRUPT_AFTER_PREPARED_WORKSPACE;
    const resumed = await runSystemWithAdapter({ ...args, runId: undefined, resumeRunDir: runId });
    assert.equal(resumed.status, "done");

    const eventsAfterResume = (await readFile(eventsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(
      eventsAfterResume.filter((event) => event.type === "role.started" && event.roleId === durableRoleResult.roleId).length,
      startedCountBeforeResume,
      "a durable Role result is restored instead of executing again"
    );
    assert.equal(eventsAfterResume.filter((event) => ["git_collaboration_role_commit", "git_collaboration_role_result"].includes(event.type) && event.roleId === durableRoleResult.roleId).length, 1);
    const checkpointNames = await (await import("node:fs/promises")).readdir(join(runDir, "workspace", "checkpoints"));
    const checkpoints = await Promise.all(checkpointNames.map(async (name) => JSON.parse(await readFile(join(runDir, "workspace", "checkpoints", name), "utf8"))));
    const stalePrepared = checkpoints.find((checkpoint) => {
      if (checkpoint.status !== "prepared" || !checkpoint.branch.startsWith(`ogs/${runId}/role/`)) return false;
      return !eventsAfterResume.some((event) => ["git_collaboration_role_commit", "git_collaboration_role_result"].includes(event.type) && `${event.roleId}:${event.executionId}` === checkpoint.worktreeId);
    });
    assert.ok(stalePrepared, "the interrupted Role's prepared checkpoint remains as recovery evidence");
    assert.equal((await collaboration.runBranchEntries()).some((entry) => entry.ref === `refs/heads/${stalePrepared.branch}`), false, "its uncommitted branch was reclaimed under the canonical lock");
    const staleExecutionId = stalePrepared.worktreeId.slice(stalePrepared.nodeId.length + 1);
    const staleExecutionDir = join(workdir, ".ogs", "runs", runId, "roles", stalePrepared.nodeId, "executions", staleExecutionId);
    await assert.rejects(readFile(join(staleExecutionDir, "execution-outcome.json")), { code: "ENOENT" }, "an uncommitted candidate never becomes a successful execution outcome");
    await assert.rejects(
      readFile(join(staleExecutionDir, "execution-candidate.json")),
      { code: "ENOENT" }
    );
    const resumedState = JSON.parse(await readFile(join(workdir, ".ogs", "runs", runId, "state.json"), "utf8"));
    const retriedResult = Object.values(resumedState.graphState.roleResults).find((result) => result.roleId === stalePrepared.nodeId);
    assert.ok(retriedResult?.provenance?.executionId);
    assert.notEqual(retriedResult.provenance.executionId, staleExecutionId, "the graph result comes from the replacement execution");
  } finally {
    await rm(workdir, { recursive: true, force: true });
    await rm(worktreeRoot, { recursive: true, force: true });
  }
});

test("resume promotes a verified Git commit candidate into Runtime outcome and graph state", { concurrency: false }, async () => {
  const repoRoot = process.cwd();
  const workdir = await mkdtemp(join(tmpdir(), "ogs-committed-resume-run-"));
  const worktreeRoot = `${workdir}-worktrees`;
  const runId = "20261119-commit-recovery-0001";

  try {
    await mkdir(join(workdir, ".ogs"), { recursive: true });
    await symlink(join(repoRoot, "og-roles"), join(workdir, "og-roles"), "dir");
    for (const name of ["runtime.json", "execution-bindings.json", "model-catalog.json", "laws.json", "user-profile.json"]) {
      await symlink(join(repoRoot, ".ogs", name), join(workdir, ".ogs", name));
    }
    await writeFile(join(workdir, ".gitignore"), ".ogs/\nog-roles\n", "utf8");
    await writeFile(join(workdir, "evidence.md"), "Commit recovery baseline.\n", "utf8");
    await git(workdir, ["init", "--initial-branch=main", "--quiet"]);
    await git(workdir, ["add", ".gitignore", "evidence.md"]);
    await git(workdir, ["commit", "--quiet", "-m", "Workspace baseline"]);
    const baseCommit = (await git(workdir, ["rev-parse", "HEAD"])).stdout.trim();
    const collaborationOptions = { repositoryRoot: workdir, worktreeRoot, runId, workspaceId: "workspace-commit-recovery-test" };
    const collaboration = createGitCollaboration(collaborationOptions);
    const args = {
      systemPath: resolve(repoRoot, "examples/medical-quorum-consultation/system.mmd"),
      runtimeConfigPath: join(workdir, ".ogs", "runtime.json"),
      lawsPath: resolve(repoRoot, "examples/medical-quorum-consultation/laws.json"),
      userProfilePath: join(workdir, ".ogs", "user-profile.json"),
      prompt: "Exercise Git commit recovery.",
      workdir,
      runId,
      dryRun: true
    };
    const childConfig = { args, collaboration: collaborationOptions, baseCommit };
    const childScript = [
      `const { runSystemWithAdapter, createGitCollaboration } = await import(${JSON.stringify(pathToFileURL(join(repoRoot, "dist/runtime/adapter.js")).href)});`,
      "const config = JSON.parse(process.env.OGS_TEST_PREPARED_RECOVERY_CONFIG);",
      "const collaboration = createGitCollaboration(config.collaboration);",
      "await runSystemWithAdapter({ ...config.args, gitCollaboration: { collaboration, baseCommit: config.baseCommit } });"
    ].join("\n");
    await assert.rejects(
      execFile(process.execPath, ["--input-type=module", "-e", childScript], {
        cwd: repoRoot,
        env: {
          ...process.env,
          OGS_TEST_PREPARED_RECOVERY_CONFIG: JSON.stringify(childConfig),
          OGSYSTEM_ENABLE_TEST_HOOKS: "1",
          OGSYSTEM_TEST_WORKSPACE_COMMIT_FILE: "recovered-output.md",
          OGSYSTEM_TEST_CRASH_AFTER_WORKSPACE_GIT_COMMIT: "1"
        }
      }),
      (error) => error.code === 94
    );

    const runDir = join(workdir, ".ogs", "runs", runId);
    const workspaceCheckpointDir = join(runDir, "workspace", "checkpoints");
    const preparedNames = (await (await import("node:fs/promises")).readdir(workspaceCheckpointDir)).filter((name) => name.startsWith("prepared-"));
    const preparedCheckpoints = await Promise.all(preparedNames.map(async (name) => JSON.parse(await readFile(join(workspaceCheckpointDir, name), "utf8"))));
    const prepared = preparedCheckpoints[0];
    assert.ok(prepared);
    const candidatePath = join(runDir, "roles", prepared.nodeId, "executions", prepared.worktreeId.slice(prepared.nodeId.length + 1), "execution-candidate.json");
    const candidateBeforeResume = JSON.parse(await readFile(candidatePath, "utf8"));
    assert.equal(candidateBeforeResume.output.event, candidateBeforeResume.audit.selectedEvent);
    await assert.rejects(readFile(join(runDir, "roles", prepared.nodeId, "result.json")), { code: "ENOENT" }, "candidate output is not exposed as the Role's latest result before commit recovery");

    const resumeArgs = { ...args, runId: undefined, resumeRunDir: runId, gitCollaboration: { collaboration, baseCommit } };
    const resumed = await runSystemWithAdapter(resumeArgs);
    assert.equal(resumed.status, "done");
    const eventsPath = join(runDir, "events.ndjson");
    const eventsAfterResume = (await readFile(eventsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const recoveredCommit = eventsAfterResume.find((event) => event.type === "git_collaboration_role_commit" && event.executionId === prepared.worktreeId.slice(prepared.nodeId.length + 1));
    assert.ok(recoveredCommit, "Git provenance is reconstructed from the prepared checkpoint and commit trailers");
    assert.deepEqual(recoveredCommit.changedPaths, ["recovered-output.md"]);
    const checkpointNames = await (await import("node:fs/promises")).readdir(workspaceCheckpointDir);
    const recoveredCheckpoint = await Promise.all(checkpointNames.map(async (name) => JSON.parse(await readFile(join(workspaceCheckpointDir, name), "utf8"))))
      .then((checkpoints) => checkpoints.find((checkpoint) => checkpoint.status === "completed" && checkpoint.roleCommit === recoveredCommit.resultCommit));
    assert.ok(recoveredCheckpoint, "the recovered commit has a completed Workspace checkpoint");
    assert.equal(eventsAfterResume.filter((event) => event.type === "role.started" && event.executionId === recoveredCommit.executionId).length, 1);
    const executionDir = join(runDir, "roles", prepared.nodeId, "executions", recoveredCommit.executionId);
    const recoveredOutcome = JSON.parse(await readFile(join(executionDir, "execution-outcome.json"), "utf8"));
    assert.equal(recoveredOutcome.selectedEvent, candidateBeforeResume.output.event);
    assert.equal(recoveredOutcome.storedResult.event, candidateBeforeResume.output.event);
    assert.equal(recoveredOutcome.storedResult.content, candidateBeforeResume.output.content);
    assert.deepEqual(recoveredOutcome.storedResult.workspaceRefs, recoveredCommit.workspaceRefs);
    const stateSnapshot = JSON.parse(await readFile(join(runDir, "state.json"), "utf8"));
    const restoredResult = Object.values(stateSnapshot.graphState.roleResults).find((result) => result.provenance?.executionId === recoveredCommit.executionId);
    assert.ok(restoredResult, "Runtime WAL reconciliation restores the Role result into graph state");
    assert.equal(restoredResult.event, candidateBeforeResume.output.event);
    assert.equal(restoredResult.content, candidateBeforeResume.output.content);
    await assert.rejects(readFile(candidatePath), { code: "ENOENT" }, "candidate is removed after promotion to the durable outcome");
  } finally {
    await rm(workdir, { recursive: true, force: true });
    await rm(worktreeRoot, { recursive: true, force: true });
  }
});

test("all no-content Role results project state and publish the existing base commit", async () => {
  const repoRoot = process.cwd();
  const workdir = await mkdtemp(join(tmpdir(), "ogs-noop-workspace-run-"));
  const worktreeRoot = `${workdir}-worktrees`;
  const runId = "20261119-000000-noop0001";
  let mergeResult;
  let releaseRecord;
  let workspaceCommitCallbacks = 0;

  try {
    await mkdir(join(workdir, ".ogs"), { recursive: true });
    await symlink(join(repoRoot, "og-roles"), join(workdir, "og-roles"), "dir");
    for (const name of ["runtime.json", "execution-bindings.json", "model-catalog.json", "laws.json", "user-profile.json"]) {
      await symlink(join(repoRoot, ".ogs", name), join(workdir, ".ogs", name));
    }
    await writeFile(join(workdir, ".gitignore"), ".ogs/\nog-roles\n", "utf8");
    await writeFile(join(workdir, "evidence.md"), "Committed Workspace baseline.\n", "utf8");
    await git(workdir, ["init", "--initial-branch=main", "--quiet"]);
    await git(workdir, ["add", ".gitignore", "evidence.md"]);
    await git(workdir, ["commit", "--quiet", "-m", "Workspace baseline"]);
    const baseCommit = (await git(workdir, ["rev-parse", "HEAD"])).stdout.trim();
    const collaboration = createGitCollaboration({ repositoryRoot: workdir, worktreeRoot, runId, workspaceId: "workspace-noop-test" });
    const runEvidenceDir = join(workdir, ".ogs", "runs", runId);
    const coordinator = createWorkspaceCoordinator({ repositoryRoot: workdir, evidenceDir: runEvidenceDir, collaboration, workspaceId: "workspace-noop-test" });

    const result = await runSystemWithAdapter({
      systemPath: resolve(repoRoot, "examples/medical-quorum-consultation/system.mmd"),
      runtimeConfigPath: join(workdir, ".ogs", "runtime.json"),
      lawsPath: resolve(repoRoot, "examples/medical-quorum-consultation/laws.json"),
      userProfilePath: join(workdir, ".ogs", "user-profile.json"),
      prompt: "Exercise no-op Workspace integration.",
      workdir,
      runId,
      dryRun: true,
      gitCollaboration: {
        collaboration,
        baseCommit,
        onRoleCommit: async (branchId, roleCommit) => {
          workspaceCommitCallbacks += 1;
          return (await coordinator.recordRoleCommit({
            runId,
            nodeId: roleCommit.roleId,
            branchId,
            roleCommit
          })).event;
        },
        onMerge: async (merge) => (await coordinator.recordMerge({ runId, nodeId: `merge-${merge.mergeId}`, merge })).event,
        publish: async (merge) => {
          mergeResult = merge;
          releaseRecord = await coordinator.publishRelease({
            releaseId: `release-${runId}`,
            runId,
            workspaceDir: workdir,
            sourceDir: workdir,
            releaseCommit: merge.mergeCommit,
            expectedCanonicalHead: baseCommit
          });
        }
      }
    });

    assert.equal(result.status, "done");
    assert.ok(mergeResult);
    assert.deepEqual(mergeResult.candidateCommits, [baseCommit]);
    assert.equal(mergeResult.mergeCommit, baseCommit);
    assert.equal(releaseRecord.status, "published");
    assert.equal(releaseRecord.releaseCommit, baseCommit);
    assert.equal(releaseRecord.expectedCanonicalHead, baseCommit);
    assert.match(releaseRecord.materializationManifestDigest, /^sha256:[0-9a-f]{64}$/);
    assert.match(releaseRecord.outputDigest, /^sha256:[0-9a-f]{64}$/);
    assert.ok(releaseRecord.downloadReference);
    assert.equal((await git(workdir, ["rev-parse", "HEAD"])).stdout.trim(), baseCommit);
    assert.equal((await git(workdir, ["rev-list", "--count", "--all"])).stdout.trim(), "1");
    assert.equal(workspaceCommitCallbacks, 0, "no-content results do not enter the Workspace content-commit coordinator");

    const events = (await readFile(join(runEvidenceDir, "events.ndjson"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const gitCommitEvents = events.filter((event) => event.type === "git_collaboration_role_commit");
    assert.deepEqual(gitCommitEvents, [], "base commit pointers are not persisted as Role content commits");
    const noContentResults = events.filter((event) => event.type === "git_collaboration_role_result");
    assert.equal(noContentResults.length, 5);
    assert.ok(noContentResults.every((event) => event.resultCommit === event.baseCommit && event.changedPaths.length === 0 && event.provenance === undefined));
    const roleCommits = events.filter((event) => event.type === "result_committed" && event.resultCommit);
    assert.deepEqual(roleCommits, [], "no-op outcomes do not emit a Workspace content-commit event");
    const resultProjections = events.filter((event) => event.type === "result_committed" && event.resultId);
    assert.equal(resultProjections.length, 6, "each role and the final Run result use result-state projections");
    assert.ok(resultProjections.every((event) => Number.isInteger(event.stateVersion) && event.stateVersion >= 0));
    assert.equal(new Set(resultProjections.map((event) => event.eventId)).size, resultProjections.length);
    assert.deepEqual(new Set(resultProjections.map((event) => event.roleId).filter(Boolean)), new Set([
      "diagnosis-dispatch",
      "diagnosis-cardiology",
      "diagnosis-neurology",
      "diagnosis-imaging",
      "diagnosis-chief-review"
    ]));
    const checkpointDirectory = join(runEvidenceDir, "workspace", "checkpoints");
    const checkpointFiles = await import("node:fs/promises").then(({ readdir }) => readdir(checkpointDirectory));
    const checkpoints = await Promise.all(checkpointFiles.map(async (name) => JSON.parse(await readFile(join(checkpointDirectory, name), "utf8"))));
    const preparedByWorktreeId = new Map(checkpoints.filter((checkpoint) => checkpoint.status === "prepared").map((checkpoint) => [checkpoint.worktreeId, checkpoint]));
    const completedByWorktreeId = new Map(checkpoints.filter((checkpoint) => checkpoint.status === "completed").map((checkpoint) => [checkpoint.worktreeId, checkpoint]));
    for (const event of noContentResults) {
      const worktreeId = `${event.roleId}:${event.executionId}`;
      const prepared = preparedByWorktreeId.get(worktreeId);
      const completed = completedByWorktreeId.get(worktreeId);
      assert.ok(prepared, `prepared Workspace checkpoint exists for ${worktreeId}`);
      assert.ok(completed, `completed Workspace checkpoint exists for ${worktreeId}`);
      assert.equal(prepared.branch, completed.branch);
      assert.equal(prepared.baseCommit, completed.baseCommit);
      assert.equal(prepared.attempt, completed.attempt);
      assert.equal(prepared.branchId, completed.branchId);
      assert.equal(prepared.lineageId, completed.lineageId);
      assert.equal(prepared.loopIteration, completed.loopIteration);
      assert.equal(prepared.stateVersion, completed.stateVersion);
      assert.equal(completed.roleCommit, undefined, "no-content checkpoint is not a content-version fact");
      assert.deepEqual(completed.changedPaths, []);
      assert.deepEqual(completed.evidenceRefs, []);
    }
    const finalMerge = events.find((event) => event.type === "workspace_integrated" && event.mergeId === `run-${runId}`);
    assert.deepEqual(finalMerge.candidateCommits, [baseCommit]);
    assert.equal(finalMerge.mergeCommit, baseCommit);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("preserves a parent Role file when a serial child has no content change", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-parent-noop-workspace-"));
  const repo = join(root, "repo");
  const worktrees = join(root, "worktrees");
  const evidence = join(root, "evidence");
  const runId = "20261119-parent-noop-0001";
  const workspaceId = "workspace-parent-noop-test";
  let parentWorktree;
  let childWorktree;

  try {
    await mkdir(repo, { recursive: true });
    await git(root, ["init", "--initial-branch=main", "--quiet", repo]);
    await writeFile(join(repo, "README.md"), "base\n", "utf8");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "--quiet", "-m", "Workspace baseline"]);
    const baseCommit = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    const collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: worktrees, runId, workspaceId });
    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir: evidence, collaboration, workspaceId });

    parentWorktree = await collaboration.addWorktree({ roleId: "parent", executionId: "exec-parent", baseCommit });
    await writeFile(join(parentWorktree.path, "parent-output.md"), "Produced by the parent Role.\n", "utf8");
    const parentCommit = await collaboration.commitWorktree(parentWorktree, "parent Role output");
    const parentEvidence = await coordinator.recordRoleCommit({
      runId,
      nodeId: "parent",
      branchId: "parent@1#1",
      roleCommit: parentCommit
    });
    assert.deepEqual(parentCommit.changedPaths, ["parent-output.md"]);

    childWorktree = await collaboration.addWorktree({ roleId: "child", executionId: "exec-child", baseCommit });
    const childCommit = await collaboration.commitWorktree(childWorktree, "serial child no-op", { allowNoChanges: true });
    const childEvidence = await coordinator.recordRoleCommit({
      runId,
      nodeId: "child",
      branchId: "child@1#1",
      roleCommit: childCommit
    });
    assert.equal(childCommit.resultCommit, baseCommit);
    assert.deepEqual(childCommit.changedPaths, []);

    // This is the same final candidate reduction used by the Graph Runner: a no-op
    // child that points at the frozen base must not displace a real parent commit.
    const observedCandidates = [parentCommit.resultCommit, childCommit.resultCommit];
    const uniqueCandidates = [...new Set(observedCandidates)];
    const finalCandidates = uniqueCandidates.length > 1
      ? uniqueCandidates.filter((commit) => commit !== baseCommit)
      : uniqueCandidates;
    assert.deepEqual(finalCandidates, [parentCommit.resultCommit]);

    const merged = await coordinator.merge({
      runId,
      nodeId: "final",
      baseCommit,
      candidateCommits: finalCandidates,
      mergeId: `run-${runId}`,
      checkpoint: parentEvidence.checkpoint
    });
    assert.equal(merged.merge.status, "merged");
    assert.notEqual(merged.merge.mergeCommit, parentCommit.resultCommit);
    assert.equal((await git(repo, ["merge-base", "--is-ancestor", parentCommit.resultCommit, merged.merge.mergeCommit])).stdout, "");
    assert.deepEqual(merged.merge.candidateCommits, [parentCommit.resultCommit]);
    assert.equal(await readFile(join(merged.merge.path, "parent-output.md"), "utf8"), "Produced by the parent Role.\n");

    const release = await coordinator.publishRelease({
      releaseId: `release-${runId}`,
      runId,
      workspaceDir: repo,
      sourceDir: merged.merge.path,
      releaseCommit: merged.merge.mergeCommit,
      expectedCanonicalHead: baseCommit
    });
    assert.equal(release.status, "published");
    assert.equal(release.releaseCommit, merged.merge.mergeCommit);
    const outputPath = join(evidence, "release-store", "materializations", release.releaseId, "output", "parent-output.md");
    assert.equal(await readFile(outputPath, "utf8"), "Produced by the parent Role.\n");
    const manifest = JSON.parse(await readFile(join(evidence, "release-store", "materializations", release.releaseId, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.files.map((entry) => entry.path), ["README.md", "parent-output.md"]);
    assert.equal((await git(repo, ["rev-parse", "HEAD"])).stdout.trim(), merged.merge.mergeCommit);
    assert.equal((await git(repo, ["rev-list", "--count", "--all"])).stdout.trim(), "3");
    assert.equal(childEvidence.event.payload.resultCommit, baseCommit);
  } finally {
    if (childWorktree) await rm(childWorktree.path, { recursive: true, force: true }).catch(() => undefined);
    if (parentWorktree) await rm(parentWorktree.path, { recursive: true, force: true }).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    await rm(worktrees, { recursive: true, force: true });
  }
});
