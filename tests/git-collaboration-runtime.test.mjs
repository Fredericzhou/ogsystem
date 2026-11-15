import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createGitCollaboration, runSystemWithAdapter } from "../dist/runtime/adapter.js";
import { createFilesystemRuntimeServices } from "../dist/runtime/filesystem-runtime-services.js";
import { writeHumanReviewDecision } from "../dist/runtime/project-lifecycle.js";
import { latestRoleContract } from "../tests-support/role-fixture.mjs";

const execFile = promisify(execFileCallback);

async function git(cwd, args) {
  return execFile("git", [
    "-c", "user.name=OGS Runtime Test",
    "-c", "user.email=ogs-runtime-test@example.test",
    ...args
  ], { cwd });
}

async function writeRole(rolesRoot, roleId, options = {}) {
  const roleDir = path.join(rolesRoot, roleId);
  await mkdir(roleDir, { recursive: true });
  await writeFile(path.join(roleDir, "role.json"), JSON.stringify({
    roleId,
    roleVersion: "1.0.0",
    name: roleId,
    description: `Git collaboration ${roleId}`,
    promptTemplate: "prompt.md",
    outputSchema: "output.schema.json",
    ...latestRoleContract({ events: ["READY"], allowedTools: ["tool.collaboration"] }),
    ...(options.controlActions ? { authority: { controlActions: options.controlActions } } : {}),
    failure: { retryableErrorCodes: options.retryableErrorCodes ?? [], terminalErrorCodes: [] },
    constraints: { writableStateFields: [], allowedTools: ["tool.collaboration"] }
  }, null, 2), "utf8");
  await writeFile(path.join(roleDir, "prompt.md"), "{{agent}}\n{{task}}\n{{input}}\n", "utf8");
  await writeFile(path.join(roleDir, "agent.md"), `# ${roleId}\n`, "utf8");
  await writeFile(path.join(roleDir, "output.schema.json"), JSON.stringify({
    type: "object",
    properties: { event: { type: "string", enum: ["READY"] }, content: { type: "string" } },
    required: ["event"],
    additionalProperties: true
  }, null, 2), "utf8");
}

async function runScenario({ failWriterB = false, failJoinOnce = false, publishFailure = false, failFinalize = false, auditFailure = false, artifact = false, serial = false, quorum = false, noopDispatch = false, reviewRework = false, probeFailure = false, runId = "run-e2e-git" } = {}) {
  const controlRoot = await mkdtemp(path.join(tmpdir(), "ogs-runtime-git-control-"));
  const codeRepo = path.join(controlRoot, "project");
  const worktreeRoot = path.join(controlRoot, "worktrees");
  const rolesRoot = path.join(controlRoot, "og-roles", "roles");
  const scriptsRoot = path.join(controlRoot, "scripts");
  const systemPath = path.join(controlRoot, "system.mmd");
  const profilesPath = path.join(controlRoot, "profiles.json");
  const toolsPath = path.join(controlRoot, "tools.json");
  const runtimePath = path.join(controlRoot, ".ogs", "runtime.json");
  const lawsPath = path.join(controlRoot, ".ogs", "laws.json");
  const userProfilePath = path.join(controlRoot, ".ogs", "user-profile.json");
  const modelSelectionPath = path.join(controlRoot, ".ogs", "model-selection.json");

  try {
    await mkdir(path.join(controlRoot, ".ogs"), { recursive: true });
    await mkdir(scriptsRoot, { recursive: true });
    await mkdir(rolesRoot, { recursive: true });
    await mkdir(codeRepo, { recursive: true });
    await writeFile(path.join(codeRepo, "README.md"), "base project\n", "utf8");
    await git(controlRoot, ["init", "--quiet", codeRepo]);
    await git(codeRepo, ["add", "."]);
    await git(codeRepo, ["commit", "--quiet", "-m", "base"]);
    const baseCommit = (await git(codeRepo, ["rev-parse", "HEAD"])).stdout.trim();

    await cp(path.resolve(".ogs/laws.json"), lawsPath);
    await cp(path.resolve(".ogs/user-profile.json"), userProfilePath);
    await writeFile(modelSelectionPath, JSON.stringify(noopDispatch
      ? { configVersion: "3" }
      : { configVersion: "3", defaults: {
        backend: "opencode", modelId: "opencode/gpt-5-nano", timeoutMs: 120000, maxOutputBytes: 65536
      } }, null, 2), "utf8");
    await writeFile(runtimePath, JSON.stringify({ executor: "opencode", roleRepo: "./og-roles", runsDir: ".ogs/runs" }, null, 2), "utf8");
    await writeFile(profilesPath, JSON.stringify([
      { profileId: "profile.collaboration", toolRef: "tool.collaboration", timeoutMs: 30000 },
      ...(failJoinOnce ? [{ profileId: "profile.collaboration-retry", toolRef: "tool.collaboration", timeoutMs: 100 }] : [])
    ], null, 2), "utf8");
    const toolScript = path.join(scriptsRoot, "collaboration-role.mjs");
    await writeFile(toolsPath, JSON.stringify({ tools: [{
      toolRef: "tool.collaboration", runner: "local_shell", command: process.execPath,
      argsTemplate: [toolScript], stdinMode: "none"
    }] }, null, 2), "utf8");
    await writeFile(toolScript, `import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const role = process.env.OGSYSTEM_ROLE_ID;
if (role === "writer-a") await writeFile("a.txt", "A from writer-a\\n", "utf8");
if (role === "writer-b") await writeFile(${serial ? "\"a.txt\"" : "\"b.txt\""}, "B from writer-b\\n", "utf8");
if (role === "writer-b" && ${failWriterB}) process.exit(1);
if (role === "writer") {
  const marker = path.join(process.env.OGSYSTEM_RUN_DIR, "writer-rework-seen");
  const firstRound = !(await readFile(marker, "utf8").catch(() => ""));
  await writeFile("same.txt", firstRound ? "v1\\n" : "v2\\n", "utf8");
  await writeFile(marker, "seen\\n", "utf8");
}
if (role === "join" && ${failJoinOnce}) {
  const sourceA = await readFile("a.txt", "utf8").catch(() => "");
  const sourceB = await readFile("b.txt", "utf8").catch(() => "");
  if (!sourceA || !sourceB) process.exit(2);
  const marker = path.join(process.env.OGSYSTEM_RUN_DIR, "join-failed-once");
  const firstAttempt = await readFile(marker, "utf8").catch(() => "");
  if (!firstAttempt) {
    await writeFile(marker, "failed once\\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await writeFile("join.txt", "Join saw both merged sources\\n", "utf8");
}
if (role === "join" && ${quorum}) {
  const sourceA = await readFile("a.txt", "utf8").catch(() => "");
  if (!sourceA) process.exit(3);
  await writeFile("join.txt", "Join saw the available quorum source\\n", "utf8");
}
if (role === "writer-a" && ${artifact}) {
  await writeFile("artifact.txt", "sealed artifact\\n", "utf8");
  process.stdout.write(JSON.stringify({ event: "READY", content: role, artifacts: [{ artifactId: "writer-a-artifact", kind: "text", path: "artifact.txt", mediaType: "text/plain" }] }));
  process.exit(0);
}
process.stdout.write(JSON.stringify({ event: "READY", content: role }));
`, "utf8");

    if (failJoinOnce) {
      await mkdir(path.join(controlRoot, ".ogs", "contracts"), { recursive: true });
      await writeFile(path.join(controlRoot, ".ogs", "contracts", "state.json"), JSON.stringify({ version: "1", type: "object" }), "utf8");
      await writeFile(path.join(controlRoot, ".ogs", "semantics.yaml"), [
        "version: \"1\"",
        "system:",
        "  systemId: test.git.collaboration.runtime",
        "  systemVersion: 1.0.0",
        "state:",
        "  schema: contracts/state.json",
        "errors:",
        "  join:",
        "    retry: { max_attempts: 2, backoff: constant, error_codes: [TOOL_EXECUTION_TIMEOUT] }",
        "capabilities:",
        "  allowed_tools_by_role:",
        "    dispatch: [tool.collaboration]",
        "    writer-a: [tool.collaboration]",
        "    writer-b: [tool.collaboration]",
        "    join: [tool.collaboration]"
      ].join("\n"), "utf8");
    }

    for (const roleId of ["dispatch", "writer-a", "writer-b", "join", "writer"]) {
      await writeRole(rolesRoot, roleId, roleId === "join" && failJoinOnce
        ? { retryableErrorCodes: ["TOOL_EXECUTION_TIMEOUT"] }
        : roleId === "writer" && reviewRework
          ? { controlActions: ["approve", "pause", "rework", "terminate"] }
          : {});
    }
    const graphSource = reviewRework ? `flowchart TD
%% system.id=test.git.collaboration.runtime
%% system.version=1.0.0
%% law.global=law.console.base
%% exec.bind.writer=profile.collaboration
%% review.mode.writer=required
%% review.rework.target.writer=writer
%% review.rework.max.writer=2
start[开始] -->|START| writer[Role:writer]
writer[Role:writer] -->|READY| end[结束]
` : quorum ? `flowchart TD
%% system.id=test.git.collaboration.runtime
%% system.version=1.0.0
%% law.global=law.console.base
%% exec.bind.dispatch=profile.collaboration
%% exec.bind.writer-a=profile.collaboration
%% exec.bind.writer-b=profile.collaboration
%% exec.bind.join=profile.collaboration
%% join.mode.join=quorum_of
%% join.min.join=1
%% join.sources.join=writer-a,writer-b
start[开始] -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|READY| writer-a[Role:writer-a]
writer-a[Role:writer-a] -->|READY| join[Role:join]
writer-b[Role:writer-b] -->|READY| join[Role:join]
join[Role:join] -->|READY| end[结束]
` : serial ? `flowchart TD
%% system.id=test.git.collaboration.runtime
%% system.version=1.0.0
%% law.global=${noopDispatch ? "law.minimal.base" : "law.console.base"}
${noopDispatch ? "" : "%% exec.bind.dispatch=profile.collaboration"}
%% exec.bind.writer-a=profile.collaboration
%% exec.bind.writer-b=profile.collaboration
start[开始] -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|READY| writer-a[Role:writer-a]
writer-a[Role:writer-a] -->|READY| writer-b[Role:writer-b]
writer-b[Role:writer-b] -->|READY| end[结束]
` : `flowchart TD
%% system.id=test.git.collaboration.runtime
%% system.version=1.0.0
%% law.global=law.console.base
%% exec.bind.dispatch=profile.collaboration
%% exec.bind.writer-a=profile.collaboration
%% exec.bind.writer-b=profile.collaboration
%% exec.bind.join=${failJoinOnce ? "profile.collaboration-retry" : "profile.collaboration"}
%% role.mode.dispatch=parallel_split
%% join.mode.join=all_of
%% join.sources.join=writer-a,writer-b
start[开始] -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|READY| writer-a[Role:writer-a]
dispatch[Role:dispatch] -->|READY| writer-b[Role:writer-b]
writer-a[Role:writer-a] -->|READY| join[Role:join]
writer-b[Role:writer-b] -->|READY| join[Role:join]
join[Role:join] -->|READY| end[结束]
`;
    await writeFile(systemPath, graphSource, "utf8");

    const rawCollaboration = createGitCollaboration({
      repositoryRoot: codeRepo,
      worktreeRoot,
      runId
    });
    const collaboration = {
      ...rawCollaboration,
      ...(failFinalize ? {
        commitWorktree: async (worktree, message, options) => {
          if (worktree.roleId === "writer-a") throw new Error("simulated Git finalization failure");
          return rawCollaboration.commitWorktree(worktree, message, options);
        }
      } : {}),
      ...(probeFailure ? {
        probe: async () => ({
          supported: false,
          repositoryRoot: codeRepo,
          clean: true,
          reason: "SUBMODULE_UNSUPPORTED"
        })
      } : {})
    };
    const published = [];
    const runAdapter = (extra = {}) => runSystemWithAdapter({
      systemPath,
      workdir: controlRoot,
      targetDir: codeRepo,
      runtimeConfigPath: runtimePath,
      lawsPath,
      userProfilePath,
      profilesPath,
      toolsPath,
      runId,
      prompt: "build the project changes",
      ...extra,
      ...(auditFailure ? {
        runtimeServicesFactory: ({ runContext, plan, initialState }) => {
          const services = createFilesystemRuntimeServices({ context: runContext, initialState, irDigest: plan.semanticIR ? "test" : "none" });
          return {
            ...services,
            audit: {
              ...services.audit,
              append: async (event) => {
                if (event.type === "audit" && event.roleId === "writer-a") throw new Error("simulated audit persistence failure after finalize");
                await services.audit.append(event);
              }
            }
          };
        }
      } : {}),
      gitCollaboration: {
        collaboration,
        baseCommit,
        publish: async (merge) => {
          published.push(merge);
          assert.equal(merge.status, "merged");
          if (publishFailure) {
            await git(codeRepo, ["merge", "--ff-only", merge.mergeCommit]);
            throw new Error("simulated publish failure after applying merge");
          }
          await git(codeRepo, ["merge", "--ff-only", merge.mergeCommit]);
        }
      }
    });
    let result;
    try {
      result = await runAdapter();
    } catch (error) {
      if (!auditFailure) throw error;
      result = { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
    if (reviewRework) {
      const firstEvents = (await readFile(path.join(controlRoot, ".ogs", "runs", runId, "events.ndjson"), "utf8"))
        .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      const reviewRequest = firstEvents.find((event) => event.type === "human_review_requested");
      assert.ok(reviewRequest?.reviewId, "expected a durable human review request");
      await writeHumanReviewDecision({
        workdir: controlRoot,
        runId,
        reviewId: reviewRequest.reviewId,
        decision: "rework",
        principal: { id: "local:tester", issuer: "ogs:local", displayName: "tester" },
        comment: "Rework the same file once."
      });
      result = await runAdapter({ resumeRunDir: runId });
      if (result.status === "stopped") {
        const resumedEvents = (await readFile(path.join(controlRoot, ".ogs", "runs", runId, "events.ndjson"), "utf8"))
          .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
        const followUpReview = resumedEvents
          .filter((event) => event.type === "human_review_requested")
          .at(-1);
        assert.ok(followUpReview?.reviewId && followUpReview.reviewId !== reviewRequest.reviewId);
        await writeHumanReviewDecision({
          workdir: controlRoot,
          runId,
          reviewId: followUpReview.reviewId,
          decision: "approve",
          principal: { id: "local:tester", issuer: "ogs:local", displayName: "tester" },
          comment: "Approve the reworked file."
        });
        result = await runAdapter({ resumeRunDir: runId });
      }
    }

    const events = (await readFile(path.join(controlRoot, ".ogs", "runs", runId, "events.ndjson"), "utf8"))
      .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const summary = JSON.parse(await readFile(path.join(controlRoot, ".ogs", "runs", runId, "summary.json"), "utf8"));
    const businessFiles = {
      a: await readFile(path.join(codeRepo, "a.txt"), "utf8").catch(() => undefined),
      b: await readFile(path.join(codeRepo, "b.txt"), "utf8").catch(() => undefined),
      join: await readFile(path.join(codeRepo, "join.txt"), "utf8").catch(() => undefined),
      same: await readFile(path.join(codeRepo, "same.txt"), "utf8").catch(() => undefined)
    };
    const worktreeList = (await git(codeRepo, ["worktree", "list", "--porcelain"])).stdout;
    const branches = (await git(codeRepo, ["branch", "--format=%(refname:short)"])).stdout
      .split(/\r?\n/).filter(Boolean);
    const sharedFiles = await readdir(path.join(controlRoot, ".ogs", "runs", runId, "shared")).catch(() => []);
    return { result, published, events, summary, businessFiles, sharedFiles, worktreeList, branches };
  } finally {
    await rm(controlRoot, { recursive: true, force: true });
  }
}

test("Graph Runner isolates parallel code roles, merges at Join, and publishes verified code", async () => {
  const { result, published, events, businessFiles } = await runScenario();
  assert.equal(result.status, "done", JSON.stringify(result));
  assert.equal(published.length, 1);
  assert.ok(published[0].mergeCommit);
  assert.equal(businessFiles.a, "A from writer-a\n");
  assert.equal(businessFiles.b, "B from writer-b\n");
  const mergeEvent = events.find((event) => event.type === "git_collaboration_merge");
  assert.equal(mergeEvent?.status, "merged");
  assert.equal(mergeEvent?.verification?.passed, true);
  assert.equal(mergeEvent?.candidateCommits?.length, 2);
});

test("Graph Runner does not publish partial Git results from a failed Run", async () => {
  const { result, published, events, businessFiles } = await runScenario({
    failWriterB: true,
    runId: "run-e2e-git-failed"
  });
  assert.equal(result.status, "failed");
  assert.equal(published.length, 0);
  assert.equal(businessFiles.a, undefined);
  assert.equal(businessFiles.b, undefined);
  const skipped = events.find((event) => event.type === "git_collaboration_publish_skipped");
  assert.equal(skipped?.reason, "RUN_NOT_DONE");
});

test("Graph Runner rejects a directly supplied coordinator when its capability probe fails", async () => {
  await assert.rejects(
    () => runScenario({ probeFailure: true, runId: "run-e2e-git-probe-gate" }),
    /GIT_COLLABORATION_UNSUPPORTED: SUBMODULE_UNSUPPORTED/
  );
});

test("Join retry reuses the verified merge worktree and sees merged source files", async () => {
  const { result, businessFiles, events } = await runScenario({
    failJoinOnce: true,
    runId: "run-e2e-git-join-retry"
  });
  assert.equal(result.status, "done", JSON.stringify({ result, events: events.slice(-12) }));
  assert.equal(businessFiles.join, "Join saw both merged sources\n");
  assert.ok(events.some((event) => event.type === "role_retry_scheduled" && event.roleId === "join"));
});

test("quorum Git Join merges the source commits that reached quorum", async () => {
  const { result, businessFiles, events } = await runScenario({
    quorum: true,
    runId: "run-e2e-git-quorum"
  });
  assert.equal(result.status, "done", JSON.stringify({ result, events: events.slice(-12) }));
  assert.equal(businessFiles.join, "Join saw the available quorum source\n");
  assert.equal(businessFiles.a, "A from writer-a\n");
  const joinMerge = events.find((event) => event.type === "git_collaboration_merge" && event.phase === "join");
  assert.equal(joinMerge?.status, "merged");
  assert.equal(joinMerge?.candidateCommits?.length, 1);
});

test("Git finalization failure removes the sealed artifact bundle so retry can recover", async () => {
  const { result, summary, businessFiles, sharedFiles } = await runScenario({
    artifact: true,
    failFinalize: true,
    runId: "run-e2e-git-artifact-finalize-failure"
  });
  assert.equal(result.status, "failed");
  assert.equal(summary.status, "failed");
  assert.equal(businessFiles.a, undefined);
  assert.equal(sharedFiles.includes("seal-manifest.json"), false);
  assert.equal(sharedFiles.includes("artifact-manifest.json"), false);
  assert.equal(sharedFiles.includes("verification.json"), false);
});

test("post-finalize audit failure does not discard the committed Git worktree", async () => {
  const { result, events, worktreeList, branches } = await runScenario({
    auditFailure: true,
    runId: "run-e2e-git-post-finalize-failure"
  });
  assert.equal(result.status, "failed");
  const started = events.find((event) => event.type === "role.started" && event.roleId === "writer-a");
  assert.ok(started?.executionId);
  const worktreeId = createHash("sha256")
    .update(JSON.stringify(["writer-a", started.executionId]), "utf8")
    .digest("hex");
  assert.match(worktreeList, new RegExp(`/worktrees/run-e2e-git-post-finalize-failure/${worktreeId}`));
  assert.ok(branches.includes(`ogs/run-e2e-git-post-finalize-failure/role/${worktreeId}`));
});

test("final Git merge selects the latest successful serial leaf commit", async () => {
  const { result, businessFiles, events } = await runScenario({
    serial: true,
    runId: "run-e2e-git-serial-leaf"
  });
  assert.equal(result.status, "done");
  assert.equal(businessFiles.a, "B from writer-b\n");
  const finalMerge = events.find((event) => event.type === "git_collaboration_merge" && event.phase === "final");
  assert.equal(finalMerge?.status, "merged");
  assert.equal(finalMerge?.candidateCommits?.length, 1);
});

test("Git-enabled noop roles discard their prepared worktree and branch", async () => {
  const { result, worktreeList, branches, events } = await runScenario({
    serial: true,
    noopDispatch: true,
    runId: "run-e2e-git-noop-cleanup"
  });
  assert.equal(result.status, "done", JSON.stringify(result));
  const dispatchStart = events.find((event) => event.type === "role.started" && event.roleId === "dispatch");
  assert.ok(dispatchStart?.executionId);
  const dispatchWorktreeId = createHash("sha256")
    .update(JSON.stringify(["dispatch", dispatchStart.executionId]), "utf8")
    .digest("hex");
  assert.equal(worktreeList.includes(`/worktrees/run-e2e-git-noop-cleanup/${dispatchWorktreeId}`), false, worktreeList);
  assert.equal(branches.includes(`ogs/run-e2e-git-noop-cleanup/role/${dispatchWorktreeId}`), false, branches.join("\n"));
});

test("human review rework merges only the latest same-file leaf", async () => {
  const { result, businessFiles, events } = await runScenario({
    reviewRework: true,
    runId: "run-e2e-git-review-rework"
  });
  assert.equal(result.status, "done", JSON.stringify(result));
  assert.equal(businessFiles.same, "v2\n");
  const finalMerge = events.find((event) => event.type === "git_collaboration_merge" && event.phase === "final");
  assert.equal(finalMerge?.status, "merged");
  assert.equal(finalMerge?.candidateCommits?.length, 1);
  assert.equal(events.some((event) => event.type === "git_collaboration_merge" && event.status === "conflict"), false);
  assert.ok(events.some((event) => event.type === "human_review_rework_requested"));
});

test("publish failure persists a failed Run and possible partial publish evidence", async () => {
  const { result, published, summary, events, businessFiles } = await runScenario({
    publishFailure: true,
    runId: "run-e2e-git-publish-failure"
  });
  assert.equal(result.status, "failed");
  assert.equal(summary.status, "failed");
  assert.equal(published.length, 1);
  assert.equal(businessFiles.a, "A from writer-a\n");
  const failed = events.find((event) => event.type === "git_collaboration_publish_failed");
  assert.equal(failed?.possiblePartialPublish, true);
  assert.match(failed?.error ?? "", /simulated publish failure/);
});
