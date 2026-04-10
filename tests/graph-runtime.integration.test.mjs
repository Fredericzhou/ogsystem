import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { lstat, mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

test("adapter runs graph debate example with parallel branches, join, and bounded loop", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-langgraph-runtime-"));

  await mkdir(path.resolve(tempRoot, ".ogsystem"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-roles"), path.resolve(tempRoot, "og-roles"), "dir");
  await symlink(path.resolve(repoRoot, "og-models"), path.resolve(tempRoot, "og-models"), "dir");
  await symlink(
    path.resolve(repoRoot, ".ogsystem", "runtime.json"),
    path.resolve(tempRoot, ".ogsystem", "runtime.json")
  );
  await symlink(
    path.resolve(repoRoot, ".ogsystem", "user-profile.json"),
    path.resolve(tempRoot, ".ogsystem", "user-profile.json")
  );

  const result = await runSystemWithAdapter({
    systemPath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "system.mmd"),
    lawsPath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "laws.json"),
    userProfilePath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "user-profile.json"),
    prompt: "是否应继续保持 OGSystem 最小化并延后 reducer 与恢复语义？",
    workdir: tempRoot,
    dryRun: true
  });

  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "debate-summary");
  assert.ok(result.auditTrail.some((item) => item.roleId === "debate-minimalist"));
  assert.ok(result.auditTrail.some((item) => item.roleId === "debate-alignmentist"));
  assert.ok(result.auditTrail.some((item) => item.selectedEvent === "REBUTTAL_NEEDED"));
  assert.ok(result.auditTrail.some((item) => item.loopIteration === 2));

  const runsDir = path.resolve(tempRoot, "ogsystem-history");
  const runs = await readdir(runsDir);
  assert.strictEqual(runs.length, 1);

  const runDir = path.resolve(runsDir, runs[0]);
  const stateJson = JSON.parse(await readFile(path.resolve(runDir, "state.json"), "utf8"));
  const metricsJson = JSON.parse(await readFile(path.resolve(runDir, "metrics.json"), "utf8"));
  assert.strictEqual(stateJson.finalRoleId, "debate-summary");
  assert.ok(Array.isArray(stateJson.completedBranches));
  assert.deepStrictEqual(stateJson.loopIterations["debate-moderator"], 2);
  assert.strictEqual(metricsJson.systemId, "architecture.debate.current");
  assert.strictEqual(metricsJson.roleMetrics["debate-moderator"].total, 2);
  assert.strictEqual(metricsJson.summary.totalTransitions, 9);

  const eventsText = await readFile(path.resolve(runDir, "events.ndjson"), "utf8");
  assert.match(eventsText, /"branchId":"debate-minimalist@1#\d+"/);
  assert.match(eventsText, /"joinId":"debate-judge@2"/);

  assert.ok((await lstat(path.resolve(runDir, "shared"))).isDirectory());
  await assert.rejects(lstat(path.resolve(runDir, "roles", "debate-minimalist", "shared")));
  await assert.rejects(lstat(path.resolve(runDir, "roles", "debate-alignmentist", "shared")));

  const moderatorPrompt = await readFile(
    path.resolve(runDir, "roles", "debate-moderator", "prompt.md"),
    "utf8"
  );
  const moderatorExecutions = await readdir(
    path.resolve(runDir, "roles", "debate-moderator", "executions")
  );
  assert.strictEqual(moderatorExecutions.length, 2);
  const moderatorFirstExecution = JSON.parse(
    await readFile(
      path.resolve(
        runDir,
        "roles",
        "debate-moderator",
        "executions",
        moderatorExecutions[0],
        "execution.json"
      ),
      "utf8"
    )
  );
  const moderatorSecondExecution = JSON.parse(
    await readFile(
      path.resolve(
        runDir,
        "roles",
        "debate-moderator",
        "executions",
        moderatorExecutions[1],
        "execution.json"
      ),
      "utf8"
    )
  );
  assert.strictEqual(moderatorFirstExecution.executionIndex, 1);
  assert.strictEqual(moderatorSecondExecution.executionIndex, 2);
  const summaryPrompt = await readFile(
    path.resolve(runDir, "roles", "debate-summary", "prompt.md"),
    "utf8"
  );
  assert.match(moderatorPrompt, /architecture\.review\.zh\.executive/);
  assert.match(summaryPrompt, /Context:/);
  assert.match(summaryPrompt, /\[dry-run\] opencode-sdk/);
  assert.match(summaryPrompt, /SUMMARY_READY/);

  const resumed = await runSystemWithAdapter({
    systemPath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "system.mmd"),
    lawsPath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "laws.json"),
    userProfilePath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "user-profile.json"),
    prompt: "是否应继续保持 OGSystem 最小化并延后 reducer 与恢复语义？",
    workdir: tempRoot,
    resumeRunDir: path.relative(tempRoot, runDir),
    dryRun: true
  });
  assert.strictEqual(resumed.status, "done");
  assert.strictEqual(resumed.finalRoleId, "debate-summary");

  const moderatorExecutionsAfterResume = await readdir(
    path.resolve(runDir, "roles", "debate-moderator", "executions")
  );
  const summaryExecutionsAfterResume = await readdir(
    path.resolve(runDir, "roles", "debate-summary", "executions")
  );
  assert.strictEqual(moderatorExecutionsAfterResume.length, 2);
  assert.strictEqual(summaryExecutionsAfterResume.length, 1);
});

test("adapter runs expert consultation example with parallel specialists and final summary", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-expert-runtime-"));

  await mkdir(path.resolve(tempRoot, ".ogsystem"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-roles"), path.resolve(tempRoot, "og-roles"), "dir");
  await symlink(path.resolve(repoRoot, "og-models"), path.resolve(tempRoot, "og-models"), "dir");
  await symlink(
    path.resolve(repoRoot, ".ogsystem", "runtime.json"),
    path.resolve(tempRoot, ".ogsystem", "runtime.json")
  );

  const result = await runSystemWithAdapter({
    systemPath: path.resolve(repoRoot, "examples", "langgraph-expert-consultation", "system.mmd"),
    lawsPath: path.resolve(repoRoot, "examples", "langgraph-expert-consultation", "laws.json"),
    userProfilePath: path.resolve(
      repoRoot,
      "examples",
      "langgraph-expert-consultation",
      "user-profile.json"
    ),
    prompt: "患者间断高热、皮疹、胸闷、肌无力，常规检查未能解释原因，请组织多学科会诊。",
    workdir: tempRoot,
    dryRun: true
  });

  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "diagnosis-chief-review");
  assert.ok(result.auditTrail.some((item) => item.roleId === "diagnosis-cardiology"));
  assert.ok(result.auditTrail.some((item) => item.roleId === "diagnosis-neurology"));
  assert.ok(result.auditTrail.some((item) => item.roleId === "diagnosis-imaging"));
  assert.ok(result.auditTrail.some((item) => item.selectedEvent === "CONSULTATION_READY"));

  const runs = await readdir(path.resolve(tempRoot, "ogsystem-history"));
  assert.strictEqual(runs.length, 1);
  const runDir = path.resolve(tempRoot, "ogsystem-history", runs[0]);
  const chiefPrompt = await readFile(
    path.resolve(runDir, "roles", "diagnosis-chief-review", "prompt.md"),
    "utf8"
  );
  assert.match(chiefPrompt, /hospital\.case\.board\.zh\.detailed/);
  const chiefExecutions = await readdir(
    path.resolve(runDir, "roles", "diagnosis-chief-review", "executions")
  );
  assert.strictEqual(chiefExecutions.length, 1);
});

test("adapter executes non-join multi-incoming role once per active branch", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-multi-branch-role-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");

  await mkdir(path.resolve(tempRoot, ".ogsystem"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-roles"), path.resolve(tempRoot, "og-roles"), "dir");
  await symlink(path.resolve(repoRoot, "og-models"), path.resolve(tempRoot, "og-models"), "dir");
  await symlink(
    path.resolve(repoRoot, ".ogsystem", "runtime.json"),
    path.resolve(tempRoot, ".ogsystem", "runtime.json")
  );
  await symlink(
    path.resolve(repoRoot, ".ogsystem", "user-profile.json"),
    path.resolve(tempRoot, ".ogsystem", "user-profile.json")
  );

  await writeFile(
    systemPath,
    `flowchart TD
%% system.id=test.multi-branch-role
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-moderator
%% role.mode.debate-moderator=parallel_split
%% model.bind.debate-moderator=fast-gpt54
%% model.bind.test-branch-a=balanced-gpt52
%% model.bind.test-branch-b=balanced-gpt52
%% model.bind.test-decision=deep-o3

input -->|START| moderator[Role:debate-moderator]
moderator[Role:debate-moderator] -->|TO_A| branchA[Role:test-branch-a]
moderator[Role:debate-moderator] -->|TO_B| branchB[Role:test-branch-b]
branchA[Role:test-branch-a] -->|END_A| decision[Role:test-decision]
branchB[Role:test-branch-b] -->|END_B| decision[Role:test-decision]
decision[Role:test-decision] -->|PATH_A| output
decision[Role:test-decision] -->|PATH_B| output
`,
    "utf8"
  );

  const result = await runSystemWithAdapter({
    systemPath,
    lawsPath: path.resolve(repoRoot, ".ogsystem", "laws.json"),
    userProfilePath: path.resolve(repoRoot, ".ogsystem", "user-profile.json"),
    prompt: "parallel converge without join",
    workdir: tempRoot,
    dryRun: true
  });

  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "test-decision");
  assert.strictEqual(
    result.auditTrail.filter((item) => item.roleId === "test-decision").length,
    2
  );

  const runDir = path.resolve(
    tempRoot,
    "ogsystem-history",
    (await readdir(path.resolve(tempRoot, "ogsystem-history")))[0]
  );
  const decisionExecutions = await readdir(
    path.resolve(runDir, "roles", "test-decision", "executions")
  );
  assert.strictEqual(decisionExecutions.length, 2);
});

test("adapter optionally cleans historical execution snapshots without touching resume sources", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-cleanup-runtime-"));

  await mkdir(path.resolve(tempRoot, ".ogsystem"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-roles"), path.resolve(tempRoot, "og-roles"), "dir");
  await symlink(path.resolve(repoRoot, "og-models"), path.resolve(tempRoot, "og-models"), "dir");
  await symlink(
    path.resolve(repoRoot, ".ogsystem", "runtime.json"),
    path.resolve(tempRoot, ".ogsystem", "runtime.json")
  );
  await symlink(
    path.resolve(repoRoot, ".ogsystem", "user-profile.json"),
    path.resolve(tempRoot, ".ogsystem", "user-profile.json")
  );

  await runSystemWithAdapter({
    systemPath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "system.mmd"),
    lawsPath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "laws.json"),
    userProfilePath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "user-profile.json"),
    prompt: "cleanup historical snapshots",
    workdir: tempRoot,
    dryRun: true,
    cleanupExecutionHistory: 1
  });

  const runId = (await readdir(path.resolve(tempRoot, "ogsystem-history")))[0];
  const runDir = path.resolve(tempRoot, "ogsystem-history", runId);
  const moderatorExecutions = await readdir(
    path.resolve(runDir, "roles", "debate-moderator", "executions")
  );

  assert.strictEqual(moderatorExecutions.length, 1);
  await readFile(path.resolve(runDir, "state.json"), "utf8");
  await readFile(path.resolve(runDir, "sessions.json"), "utf8");
});
