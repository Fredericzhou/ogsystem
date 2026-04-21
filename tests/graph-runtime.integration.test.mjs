import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { lstat, mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

function parseJsonCodeBlock(markdown) {
  const match = markdown.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(match, "expected markdown to contain one json code block");
  return JSON.parse(match[1]);
}

async function writeModelBoundRole(args) {
  const roleDir = path.resolve(args.rolesRoot, args.roleId);
  await mkdir(roleDir, { recursive: true });
  await writeFile(
    path.resolve(roleDir, "role.json"),
    JSON.stringify(
      {
        roleId: args.roleId,
        roleVersion: "1.0.0",
        name: args.name ?? args.roleId,
        description: args.description ?? `${args.roleId} test role`,
        promptTemplate: "prompt.md",
        outputSchema: "output.schema.json"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "prompt.md"),
    [
      "{{agent}}",
      "",
      "Allowed events:",
      "{{allowed_events}}",
      "",
      "User preferences:",
      "{{user_preferences}}",
      "",
      "Task:",
      "{{task}}",
      "",
      "Input:",
      "{{input}}"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "agent.md"),
    `# ${args.roleId}\n\n${args.description ?? `${args.roleId} test role`}\n`,
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "output.schema.json"),
    JSON.stringify(
      {
        type: "object",
        properties: {
          event: {
            type: "string",
            enum: args.allowedEvents
          },
          content: {
            type: "string"
          },
          data: {
            type: "object",
            additionalProperties: true
          }
        },
        required: args.requireEvent === false ? [] : ["event"],
        additionalProperties: true
      },
      null,
      2
    ),
    "utf8"
  );
}

test("adapter runs graph debate example with parallel branches, join, and bounded loop", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-langgraph-runtime-"));

  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-roles"), path.resolve(tempRoot, "og-roles"), "dir");
  await symlink(path.resolve(repoRoot, "og-models"), path.resolve(tempRoot, "og-models"), "dir");
  await symlink(
    path.resolve(repoRoot, ".ogs", "runtime.json"),
    path.resolve(tempRoot, ".ogs", "runtime.json")
  );
  await symlink(
    path.resolve(repoRoot, ".ogs", "user-profile.json"),
    path.resolve(tempRoot, ".ogs", "user-profile.json")
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
  const minimalistAudits = result.auditTrail.filter((item) => item.roleId === "debate-minimalist");
  const moderatorAudits = result.auditTrail.filter((item) => item.roleId === "debate-moderator");
  assert.ok(minimalistAudits.every((item) => item.nextRoleId === "debate-judge"));
  assert.ok(moderatorAudits.every((item) => item.nextRoleId === undefined));

  const runsDir = path.resolve(tempRoot, ".ogs/runs");
  const runs = await readdir(runsDir);
  assert.strictEqual(runs.length, 1);

  const runDir = path.resolve(runsDir, runs[0]);
  const stateJson = JSON.parse(await readFile(path.resolve(runDir, "state.json"), "utf8"));
  const metricsJson = JSON.parse(await readFile(path.resolve(runDir, "metrics.json"), "utf8"));
  const summaryJson = JSON.parse(await readFile(path.resolve(runDir, "summary.json"), "utf8"));
  const summaryMarkdown = await readFile(path.resolve(runDir, "audit", "summary.md"), "utf8");
  assert.strictEqual(stateJson.finalRoleId, "debate-summary");
  assert.strictEqual(summaryJson.status, "done");
  assert.strictEqual(summaryJson.finalRoleId, "debate-summary");
  assert.strictEqual(summaryJson.transitionCount, stateJson.graphState.transitionCount);
  assert.ok(Array.isArray(stateJson.completedBranches));
  assert.deepStrictEqual(stateJson.loopIterations["debate-moderator"], 2);
  assert.ok(Array.isArray(stateJson.graphState.recentAudits));
  assert.ok(stateJson.graphState.recentAudits.length <= 5);
  assert.strictEqual(
    stateJson.graphState.auditSummary.okCount +
      stateJson.graphState.auditSummary.failedCount +
      stateJson.graphState.auditSummary.noopCount,
    stateJson.graphState.transitionCount
  );
  assert.strictEqual(metricsJson.systemId, "architecture.debate.current");
  assert.strictEqual(metricsJson.roleMetrics["debate-moderator"].total, 2);
  assert.strictEqual(metricsJson.summary.totalTransitions, 9);
  assert.ok(typeof metricsJson.rssBytes === "number");
  assert.ok(typeof metricsJson.stateWriteMs === "number");
  assert.ok(typeof metricsJson.executionDirCount === "number");
  assert.ok(metricsJson.executionDirCount >= 1);
  assert.match(summaryMarkdown, /```mermaid/);
  assert.match(summaryMarkdown, /\ngantt\n/);

  const eventsText = await readFile(path.resolve(runDir, "events.ndjson"), "utf8");
  assert.match(eventsText, /"branchId":"debate-minimalist@1#\d+"/);
  assert.match(eventsText, /"joinId":"debate-judge@2"/);
  const timelineText = await readFile(path.resolve(runDir, "timeline.jsonl"), "utf8");
  assert.match(timelineText, /"type":"audit"/);
  const checkpointEntries = await readdir(path.resolve(runDir, "checkpoints"));
  assert.ok(checkpointEntries.length > 0);

  assert.ok((await lstat(path.resolve(runDir, "shared"))).isDirectory());
  await assert.rejects(lstat(path.resolve(runDir, "roles", "debate-minimalist", "shared")));
  await assert.rejects(lstat(path.resolve(runDir, "roles", "debate-alignmentist", "shared")));

  const moderatorPrompt = await readFile(
    path.resolve(runDir, "roles", "debate-moderator", "prompt.md"),
    "utf8"
  );
  const moderatorExecutions = (
    await readdir(path.resolve(runDir, "roles", "debate-moderator", "executions"))
  ).sort();
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
  const summaryExecutions = (
    await readdir(path.resolve(runDir, "roles", "debate-summary", "executions"))
  ).sort();
  assert.strictEqual(summaryExecutions.length, 1);
  const summaryOutcome = JSON.parse(
    await readFile(
      path.resolve(
        runDir,
        "roles",
        "debate-summary",
        "executions",
        summaryExecutions[0],
        "execution-outcome.json"
      ),
      "utf8"
    )
  );
  assert.strictEqual(summaryOutcome.status, "ok");
  assert.ok(summaryOutcome.checkpointSequence >= 1);
  const summaryPrompt = await readFile(
    path.resolve(runDir, "roles", "debate-summary", "prompt.md"),
    "utf8"
  );
  const judgePrompt = await readFile(
    path.resolve(runDir, "roles", "debate-judge", "prompt.md"),
    "utf8"
  );
  const moderatorInbox = await readFile(
    path.resolve(runDir, "roles", "debate-moderator", "inbox.md"),
    "utf8"
  );
  const moderatorSecondInbox = parseJsonCodeBlock(
    await readFile(
      path.resolve(
        runDir,
        "roles",
        "debate-moderator",
        "executions",
        moderatorExecutions[1],
        "inbox.md"
      ),
      "utf8"
    )
  );
  const judgeInbox = parseJsonCodeBlock(
    await readFile(path.resolve(runDir, "roles", "debate-judge", "inbox.md"), "utf8")
  );
  const judgeContext = JSON.parse(judgeInbox.input);
  assert.match(moderatorPrompt, /architecture\.review\.zh\.executive/);
  assert.match(moderatorPrompt, /Allowed events:/);
  assert.match(moderatorInbox, /"input":/);
  assert.equal(moderatorSecondInbox.user_preferences.userProfileId, "architecture.review.zh.executive");
  assert.equal(moderatorSecondInbox.user_preferences.language, "zh-CN");
  assert.equal(moderatorSecondInbox.user_preferences.style, "executive");
  assert.equal(moderatorSecondInbox.user_preferences.riskPreference, "high");
  assert.deepStrictEqual(Object.keys(judgeContext), [
    "debate-minimalist",
    "debate-alignmentist"
  ]);
  assert.strictEqual(judgeContext["debate-minimalist"].event, "MINIMALIST_DONE");
  assert.strictEqual(judgeContext["debate-alignmentist"].event, "ALIGNMENTIST_DONE");
  assert.match(judgePrompt, /"debate-minimalist"/);
  assert.match(judgePrompt, /"debate-alignmentist"/);
  assert.match(summaryPrompt, /Input:/);
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

  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-roles"), path.resolve(tempRoot, "og-roles"), "dir");
  await symlink(path.resolve(repoRoot, "og-models"), path.resolve(tempRoot, "og-models"), "dir");
  await symlink(
    path.resolve(repoRoot, ".ogs", "runtime.json"),
    path.resolve(tempRoot, ".ogs", "runtime.json")
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

  const runs = await readdir(path.resolve(tempRoot, ".ogs/runs"));
  assert.strictEqual(runs.length, 1);
  const runDir = path.resolve(tempRoot, ".ogs/runs", runs[0]);
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

test("adapter preserves session lineage semantics and join context projection across split and join", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-orchestration-semantics-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  const rolesRoot = path.resolve(tempRoot, "og-roles", "roles");

  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-models"), path.resolve(tempRoot, "og-models"), "dir");
  await symlink(
    path.resolve(repoRoot, ".ogs", "laws.json"),
    path.resolve(tempRoot, ".ogs", "laws.json")
  );
  await writeFile(
    path.resolve(tempRoot, ".ogs", "runtime.json"),
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        modelRepo: "./og-models",
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );

  await writeModelBoundRole({
    rolesRoot,
    roleId: "coordinator",
    allowedEvents: ["TO_A", "TO_B"],
    requireEvent: false
  });
  await writeModelBoundRole({
    rolesRoot,
    roleId: "analyst_a",
    allowedEvents: ["A_DONE"]
  });
  await writeModelBoundRole({
    rolesRoot,
    roleId: "analyst_b",
    allowedEvents: ["B_DONE"]
  });
  await writeModelBoundRole({
    rolesRoot,
    roleId: "merger",
    allowedEvents: ["MERGED"]
  });
  await writeModelBoundRole({
    rolesRoot,
    roleId: "summary",
    allowedEvents: ["DONE"]
  });

  await writeFile(
    systemPath,
    `flowchart TD
%% system.id=test.orchestration.semantics
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=coordinator
%% role.mode.coordinator=parallel_split
%% join.mode.merger=all_of
%% join.sources.merger=analyst_a,analyst_b
%% model.bind.coordinator=fast-gpt54
%% model.bind.analyst_a=balanced-gpt52
%% model.bind.analyst_b=balanced-gpt52
%% model.bind.merger=deep-o3
%% model.bind.summary=steady-gpt54

input -->|START| coordinator[Role:coordinator]
coordinator[Role:coordinator] -->|TO_A| analystA[Role:analyst_a]
coordinator[Role:coordinator] -->|TO_B| analystB[Role:analyst_b]
analystA[Role:analyst_a] -->|A_DONE| merger[Role:merger]
analystB[Role:analyst_b] -->|B_DONE| merger[Role:merger]
merger[Role:merger] -->|MERGED| summary[Role:summary]
summary[Role:summary] -->|DONE| output
`,
    "utf8"
  );

  const result = await runSystemWithAdapter({
    systemPath,
    prompt: "验证编排语义是否稳定",
    workdir: tempRoot,
    dryRun: true
  });

  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "summary");

  const runId = (await readdir(path.resolve(tempRoot, ".ogs/runs")))[0];
  const runDir = path.resolve(tempRoot, ".ogs/runs", runId);
  const sessionIndex = JSON.parse(await readFile(path.resolve(runDir, "sessions.json"), "utf8"));
  const sessionByRoleId = new Map(sessionIndex.map((entry) => [entry.roleId, entry]));
  const coordinatorSession = sessionByRoleId.get("coordinator");
  const analystASession = sessionByRoleId.get("analyst_a");
  const analystBSession = sessionByRoleId.get("analyst_b");
  const mergerSession = sessionByRoleId.get("merger");
  const summarySession = sessionByRoleId.get("summary");

  assert.ok(coordinatorSession);
  assert.ok(analystASession);
  assert.ok(analystBSession);
  assert.ok(mergerSession);
  assert.ok(summarySession);
  assert.notStrictEqual(analystASession.sessionLineageId, analystBSession.sessionLineageId);
  assert.notStrictEqual(mergerSession.sessionLineageId, analystASession.sessionLineageId);
  assert.notStrictEqual(mergerSession.sessionLineageId, analystBSession.sessionLineageId);
  assert.strictEqual(summarySession.sessionLineageId, mergerSession.sessionLineageId);

  const mergerInbox = await readFile(path.resolve(runDir, "roles", "merger", "inbox.md"), "utf8");
  assert.match(mergerInbox, /\\"analyst_a\\"/);
  assert.match(mergerInbox, /\\"analyst_b\\"/);
  assert.match(mergerInbox, /"input":/);
  assert.match(mergerInbox, /"allowed_events": \[\s*"MERGED"\s*\]/);
});

test("adapter runs quorum_of join once and applies context.map projection", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-quorum-projection-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  const runtimePath = path.resolve(tempRoot, ".ogs", "runtime.json");
  const profilesPath = path.resolve(tempRoot, "profiles.json");
  const toolsPath = path.resolve(tempRoot, "tools.json");
  const toolScriptPath = path.resolve(tempRoot, "projection-tool.mjs");
  const rolesRoot = path.resolve(tempRoot, "og-roles", "roles");

  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        modelRepo: path.resolve(repoRoot, "og-models"),
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    profilesPath,
    JSON.stringify(
      [
        {
          profileId: "profile.fixture",
          toolRef: "tool.fixture"
        }
      ],
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    toolsPath,
    JSON.stringify(
      {
        tools: [
          {
            toolRef: "tool.fixture",
            runner: "local_shell",
            command: "node",
            argsTemplate: [toolScriptPath],
            stdinMode: "none"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    toolScriptPath,
    `#!/usr/bin/env node
const roleId = process.env.OGSYSTEM_ROLE_ID;
const outputs = {
  coordinator: {
    content: "dispatch plan",
    data: {
      brief: "dispatch brief"
    }
  },
  worker_a: {
    event: "A_DONE",
    content: "alpha summary",
    data: {
      risks: {
        primary: "alpha risk"
      }
    }
  },
  worker_b: {
    event: "B_DONE",
    content: "beta summary",
    data: {
      risks: {
        primary: "beta risk"
      }
    }
  },
  worker_c: {
    event: "C_DONE",
    content: "gamma summary",
    data: {
      risks: {
        primary: "gamma risk"
      }
    }
  },
  review: {
    event: "DONE",
    content: "review ready"
  }
};
process.stdout.write(JSON.stringify(outputs[roleId] ?? { event: "DONE", content: roleId ?? "unknown" }));\n`,
    "utf8"
  );

  await writeModelBoundRole({
    rolesRoot,
    roleId: "coordinator",
    allowedEvents: ["TO_A", "TO_B", "TO_C"],
    requireEvent: false
  });
  await writeModelBoundRole({
    rolesRoot,
    roleId: "worker_a",
    allowedEvents: ["A_DONE"]
  });
  await writeModelBoundRole({
    rolesRoot,
    roleId: "worker_b",
    allowedEvents: ["B_DONE"]
  });
  await writeModelBoundRole({
    rolesRoot,
    roleId: "worker_c",
    allowedEvents: ["C_DONE"]
  });
  await writeModelBoundRole({
    rolesRoot,
    roleId: "review",
    allowedEvents: ["DONE"]
  });

  await writeFile(
    systemPath,
    `flowchart TD
%% system.id=test.quorum.projection.runtime
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=coordinator
%% role.mode.coordinator=parallel_split
%% join.mode.review=quorum_of
%% join.sources.review=worker_a,worker_b,worker_c
%% join.min.review=3
%% context.map.worker_a.brief=direct.data.brief
%% context.map.worker_a.language=global.user_profile.language
%% context.map.worker_a.task=global.task
%% context.map.review.a_summary=source(worker_a).content
%% context.map.review.b_risk=source(worker_b).data.risks.primary
%% context.map.review.task=global.task
%% exec.bind.coordinator=profile.fixture
%% exec.bind.worker_a=profile.fixture
%% exec.bind.worker_b=profile.fixture
%% exec.bind.worker_c=profile.fixture
%% exec.bind.review=profile.fixture

input -->|START| coordinator[Role:coordinator]
coordinator[Role:coordinator] -->|TO_A| workerA[Role:worker_a]
coordinator[Role:coordinator] -->|TO_B| workerB[Role:worker_b]
coordinator[Role:coordinator] -->|TO_C| workerC[Role:worker_c]
workerA[Role:worker_a] -->|A_DONE| review[Role:review]
workerB[Role:worker_b] -->|B_DONE| review[Role:review]
workerC[Role:worker_c] -->|C_DONE| review[Role:review]
review[Role:review] -->|DONE| output
`,
    "utf8"
  );

  const result = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    profilesPath,
    toolsPath,
    lawsPath: path.resolve(repoRoot, ".ogs", "laws.json"),
    userProfilePath: path.resolve(repoRoot, ".ogs", "user-profile.json"),
    prompt: "quorum projection prompt",
    workdir: tempRoot
  });

  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "review");
  assert.strictEqual(result.auditTrail.filter((item) => item.roleId === "review").length, 1);

  const runDir = path.resolve(
    tempRoot,
    ".ogs/runs",
    (await readdir(path.resolve(tempRoot, ".ogs/runs")))[0]
  );
  const workerAInbox = parseJsonCodeBlock(
    await readFile(path.resolve(runDir, "roles", "worker_a", "inbox.md"), "utf8")
  );
  const reviewInbox = parseJsonCodeBlock(
    await readFile(path.resolve(runDir, "roles", "review", "inbox.md"), "utf8")
  );
  const workerAContext = JSON.parse(workerAInbox.input);
  const reviewContext = JSON.parse(reviewInbox.input);
  assert.deepStrictEqual(Object.keys(workerAContext), ["brief", "language", "task"]);
  assert.deepStrictEqual(workerAContext, {
    brief: "dispatch brief",
    language: "zh-CN",
    task: "quorum projection prompt"
  });
  assert.deepStrictEqual(Object.keys(reviewContext), ["a_summary", "b_risk", "task"]);
  assert.deepStrictEqual(reviewContext, {
    a_summary: "alpha summary",
    b_risk: "beta risk",
    task: "quorum projection prompt"
  });

  const reviewExecutions = await readdir(path.resolve(runDir, "roles", "review", "executions"));
  assert.strictEqual(reviewExecutions.length, 1);
  const eventsText = await readFile(path.resolve(runDir, "events.ndjson"), "utf8");
  assert.match(eventsText, /"type":"join_quorum_reached"/);
  assert.match(eventsText, /"type":"join_activated"/);

  const resumed = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    profilesPath,
    toolsPath,
    lawsPath: path.resolve(repoRoot, ".ogs", "laws.json"),
    userProfilePath: path.resolve(repoRoot, ".ogs", "user-profile.json"),
    prompt: "quorum projection prompt",
    workdir: tempRoot,
    resumeRunDir: path.relative(tempRoot, runDir)
  });
  assert.strictEqual(resumed.status, "done");

  const reviewExecutionsAfterResume = await readdir(
    path.resolve(runDir, "roles", "review", "executions")
  );
  assert.strictEqual(reviewExecutionsAfterResume.length, 1);
});

test("adapter transition skips warned contract violations and still activates valid flows", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-flow-contract-transition-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  const runtimePath = path.resolve(tempRoot, ".ogs", "runtime.json");
  const profilesPath = path.resolve(tempRoot, "profiles.json");
  const toolsPath = path.resolve(tempRoot, "tools.json");
  const toolScriptPath = path.resolve(tempRoot, "transition-tool.mjs");
  const rolesRoot = path.resolve(tempRoot, "og-roles", "roles");
  const contractsDir = path.resolve(tempRoot, "contracts");

  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await mkdir(rolesRoot, { recursive: true });
  await mkdir(contractsDir, { recursive: true });
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        modelRepo: path.resolve(repoRoot, "og-models"),
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    profilesPath,
    JSON.stringify(
      [
        {
          profileId: "profile.fixture",
          toolRef: "tool.fixture"
        }
      ],
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    toolsPath,
    JSON.stringify(
      {
        tools: [
          {
            toolRef: "tool.fixture",
            runner: "local_shell",
            command: "node",
            argsTemplate: [toolScriptPath],
            stdinMode: "none"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    toolScriptPath,
    `#!/usr/bin/env node
const roleId = process.env.OGSYSTEM_ROLE_ID;
const outputs = {
  dispatcher: {
    event: "PASS",
    content: "dispatch to the valid branch"
  },
  good: {
    event: "DONE",
    content: "good branch completed"
  },
  bad: {
    event: "DONE",
    content: "bad branch should not run"
  }
};
process.stdout.write(JSON.stringify(outputs[roleId] ?? { event: "DONE", content: roleId ?? "unknown" }));\n`,
    "utf8"
  );

  await writeModelBoundRole({
    rolesRoot,
    roleId: "dispatcher",
    allowedEvents: ["PASS"],
    requireEvent: false
  });
  await writeModelBoundRole({
    rolesRoot,
    roleId: "good",
    allowedEvents: ["DONE"]
  });
  await writeModelBoundRole({
    rolesRoot,
    roleId: "bad",
    allowedEvents: ["DONE"]
  });

  await writeFile(
    path.resolve(contractsDir, "dispatch-good.schema.json"),
    JSON.stringify(
      {
        "$schema": "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          event: {
            type: "string",
            enum: ["PASS"]
          },
          content: {
            type: "string"
          }
        },
        required: ["event", "content"],
        additionalProperties: false
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(contractsDir, "dispatch-bad.schema.json"),
    JSON.stringify(
      {
        "$schema": "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          event: {
            type: "string",
            enum: ["PASS"]
          },
          content: {
            type: "string",
            enum: ["dispatch to the skipped branch"]
          }
        },
        required: ["event", "content"],
        additionalProperties: false
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(contractsDir, "good-input.schema.json"),
    JSON.stringify(
      {
        "$schema": "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          task: {
            type: "string"
          },
          dispatch_note: {
            type: "string"
          }
        },
        required: ["task", "dispatch_note"],
        additionalProperties: false
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(contractsDir, "handoff.contracts.json"),
    JSON.stringify(
      {
        version: 1,
        contracts: [
          {
            id: "dispatcher.good.v1",
            kind: "flow",
            match: {
              fromRoleId: "dispatcher",
              eventType: "PASS",
              toRoleId: "good"
            },
            schema: "dispatch-good.schema.json",
            onViolation: "FAIL"
          },
          {
            id: "dispatcher.bad.v1",
            kind: "flow",
            match: {
              fromRoleId: "dispatcher",
              eventType: "PASS",
              toRoleId: "bad"
            },
            schema: "dispatch-bad.schema.json",
            onViolation: "WARN"
          },
          {
            id: "good.input.v1",
            kind: "role_input",
            match: {
              roleId: "good"
            },
            schema: "good-input.schema.json",
            onViolation: "FAIL"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    systemPath,
    `flowchart TD
%% system.id=test.flow.contract.transition
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=dispatcher
%% handoff.mode=transition
%% handoff.contracts=contracts/handoff.contracts.json
%% route.order.dispatcher=good,bad
%% exec.bind.dispatcher=profile.fixture
%% exec.bind.good=profile.fixture
%% exec.bind.bad=profile.fixture
%% context.map.good.task=global.task
%% context.map.good.dispatch_note=direct.content

input -->|START| dispatcher[Role:dispatcher]
dispatcher[Role:dispatcher] -->|PASS| good[Role:good]
dispatcher[Role:dispatcher] -->|PASS| bad[Role:bad]
good[Role:good] -->|DONE| output
bad[Role:bad] -->|DONE| output
`,
    "utf8"
  );

  const result = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    profilesPath,
    toolsPath,
    lawsPath: path.resolve(repoRoot, ".ogs", "laws.json"),
    prompt: "transition contract prompt",
    workdir: tempRoot
  });

  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "good");
  assert.ok(result.auditTrail.some((item) => item.roleId === "dispatcher"));
  assert.ok(result.auditTrail.some((item) => item.roleId === "good"));
  assert.ok(!result.auditTrail.some((item) => item.roleId === "bad"));

  const runs = await readdir(path.resolve(tempRoot, ".ogs/runs"));
  assert.strictEqual(runs.length, 1);
  const runDir = path.resolve(tempRoot, ".ogs/runs", runs[0]);
  const goodInbox = parseJsonCodeBlock(
    await readFile(path.resolve(runDir, "roles", "good", "inbox.md"), "utf8")
  );
  assert.deepStrictEqual(JSON.parse(goodInbox.input), {
    task: "transition contract prompt",
    dispatch_note: "dispatch to the valid branch"
  });
});

test("adapter executes non-join multi-incoming role once per active branch", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-multi-branch-role-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");

  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-roles"), path.resolve(tempRoot, "og-roles"), "dir");
  await symlink(path.resolve(repoRoot, "og-models"), path.resolve(tempRoot, "og-models"), "dir");
  await symlink(
    path.resolve(repoRoot, ".ogs", "runtime.json"),
    path.resolve(tempRoot, ".ogs", "runtime.json")
  );
  await symlink(
    path.resolve(repoRoot, ".ogs", "user-profile.json"),
    path.resolve(tempRoot, ".ogs", "user-profile.json")
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
    lawsPath: path.resolve(repoRoot, ".ogs", "laws.json"),
    userProfilePath: path.resolve(repoRoot, ".ogs", "user-profile.json"),
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
    ".ogs/runs",
    (await readdir(path.resolve(tempRoot, ".ogs/runs")))[0]
  );
  const decisionExecutions = await readdir(
    path.resolve(runDir, "roles", "test-decision", "executions")
  );
  assert.strictEqual(decisionExecutions.length, 2);
  const sessionIndex = JSON.parse(await readFile(path.resolve(runDir, "sessions.json"), "utf8"));
  const decisionSessions = sessionIndex.filter((entry) => entry.roleId === "test-decision");
  assert.strictEqual(decisionSessions.length, 2);
  assert.deepStrictEqual(
    new Set(decisionSessions.map((entry) => entry.sessionKey)).size,
    2
  );
  assert.deepStrictEqual(
    new Set(decisionSessions.map((entry) => entry.sessionId)).size,
    2
  );
  assert.deepStrictEqual(
    new Set(decisionSessions.map((entry) => entry.sessionLineageId)).size,
    2
  );
});

test("adapter optionally cleans historical execution snapshots without touching resume sources", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-cleanup-runtime-"));

  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-roles"), path.resolve(tempRoot, "og-roles"), "dir");
  await symlink(path.resolve(repoRoot, "og-models"), path.resolve(tempRoot, "og-models"), "dir");
  await symlink(
    path.resolve(repoRoot, ".ogs", "runtime.json"),
    path.resolve(tempRoot, ".ogs", "runtime.json")
  );
  await symlink(
    path.resolve(repoRoot, ".ogs", "user-profile.json"),
    path.resolve(tempRoot, ".ogs", "user-profile.json")
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

  const runId = (await readdir(path.resolve(tempRoot, ".ogs/runs")))[0];
  const runDir = path.resolve(tempRoot, ".ogs/runs", runId);
  const moderatorExecutions = await readdir(
    path.resolve(runDir, "roles", "debate-moderator", "executions")
  );

  assert.strictEqual(moderatorExecutions.length, 1);
  await readFile(path.resolve(runDir, "state.json"), "utf8");
  await readFile(path.resolve(runDir, "sessions.json"), "utf8");
});

test("adapter applies retention cleanup from runtime config when execution directories exceed threshold", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-retention-runtime-"));

  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-roles"), path.resolve(tempRoot, "og-roles"), "dir");
  await symlink(path.resolve(repoRoot, "og-models"), path.resolve(tempRoot, "og-models"), "dir");
  await writeFile(
    path.resolve(tempRoot, ".ogs", "runtime.json"),
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        modelRepo: "./og-models",
        runsDir: ".ogs/runs",
        retention: {
          enabled: true,
          executionDirThreshold: 1,
          keepLatest: 1
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await symlink(
    path.resolve(repoRoot, ".ogs", "user-profile.json"),
    path.resolve(tempRoot, ".ogs", "user-profile.json")
  );

  await runSystemWithAdapter({
    systemPath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "system.mmd"),
    lawsPath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "laws.json"),
    userProfilePath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "user-profile.json"),
    prompt: "retention cleanup threshold",
    workdir: tempRoot,
    dryRun: true
  });

  const runId = (await readdir(path.resolve(tempRoot, ".ogs/runs")))[0];
  const runDir = path.resolve(tempRoot, ".ogs/runs", runId);
  const moderatorExecutions = await readdir(
    path.resolve(runDir, "roles", "debate-moderator", "executions")
  );
  const minimalistExecutions = await readdir(
    path.resolve(runDir, "roles", "debate-minimalist", "executions")
  );
  const alignmentistExecutions = await readdir(
    path.resolve(runDir, "roles", "debate-alignmentist", "executions")
  );
  const judgeExecutions = await readdir(
    path.resolve(runDir, "roles", "debate-judge", "executions")
  );
  const summaryExecutions = await readdir(
    path.resolve(runDir, "roles", "debate-summary", "executions")
  );
  assert.strictEqual(moderatorExecutions.length, 1);
  assert.strictEqual(minimalistExecutions.length, 1);
  assert.strictEqual(alignmentistExecutions.length, 1);
  assert.strictEqual(judgeExecutions.length, 1);
  assert.strictEqual(summaryExecutions.length, 1);

  const metricsJson = JSON.parse(await readFile(path.resolve(runDir, "metrics.json"), "utf8"));
  assert.strictEqual(metricsJson.executionDirCount, 5);
});

test("adapter skips auto retention cleanup when retention is disabled", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-retention-disabled-"));

  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-roles"), path.resolve(tempRoot, "og-roles"), "dir");
  await symlink(path.resolve(repoRoot, "og-models"), path.resolve(tempRoot, "og-models"), "dir");
  await writeFile(
    path.resolve(tempRoot, ".ogs", "runtime.json"),
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        modelRepo: "./og-models",
        runsDir: ".ogs/runs",
        retention: {
          enabled: false,
          executionDirThreshold: 1,
          keepLatest: 1
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await symlink(
    path.resolve(repoRoot, ".ogs", "user-profile.json"),
    path.resolve(tempRoot, ".ogs", "user-profile.json")
  );

  await runSystemWithAdapter({
    systemPath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "system.mmd"),
    lawsPath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "laws.json"),
    userProfilePath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "user-profile.json"),
    prompt: "retention disabled should keep full history",
    workdir: tempRoot,
    dryRun: true
  });

  const runId = (await readdir(path.resolve(tempRoot, ".ogs/runs")))[0];
  const runDir = path.resolve(tempRoot, ".ogs/runs", runId);
  const moderatorExecutions = await readdir(
    path.resolve(runDir, "roles", "debate-moderator", "executions")
  );
  assert.strictEqual(moderatorExecutions.length, 2);

  const metricsJson = JSON.parse(await readFile(path.resolve(runDir, "metrics.json"), "utf8"));
  assert.ok(metricsJson.executionDirCount >= 9);
});

test("adapter persists metrics fields on failed graph runs", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-metrics-failure-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  const lawsPath = path.resolve(tempRoot, "laws.json");
  const runtimePath = path.resolve(tempRoot, ".ogs", "runtime.json");

  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-models"), path.resolve(tempRoot, "og-models"), "dir");
  await symlink(
    path.resolve(repoRoot, ".ogs", "user-profile.json"),
    path.resolve(tempRoot, ".ogs", "user-profile.json")
  );
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        modelRepo: "./og-models",
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );

  await writeModelBoundRole({
    rolesRoot: path.resolve(tempRoot, "og-roles", "roles"),
    roleId: "test-budget-failure",
    allowedEvents: ["RETRY", "DONE"]
  });

  const laws = JSON.parse(await readFile(path.resolve(repoRoot, ".ogs", "laws.json"), "utf8"));
  const globalLaw = laws.laws.find((item) => item.lawId === "law.console.base");
  assert.ok(globalLaw);
  globalLaw.constraints = {
    ...(globalLaw.constraints ?? {}),
    maxTransitions: 2
  };
  await writeFile(lawsPath, JSON.stringify(laws, null, 2), "utf8");

  await writeFile(
    systemPath,
    `flowchart TD
%% system.id=test.metrics.failed
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=test-budget-failure
%% loop.max.test-budget-failure=10
%% model.bind.test-budget-failure=balanced-gpt52

input -->|GO| worker[Role:test-budget-failure]
worker[Role:test-budget-failure] -->|RETRY| worker[Role:test-budget-failure]
worker[Role:test-budget-failure] -->|DONE| output
`,
    "utf8"
  );

  const result = await runSystemWithAdapter({
    systemPath,
    lawsPath,
    userProfilePath: path.resolve(tempRoot, ".ogs", "user-profile.json"),
    prompt: "trigger transition budget failure",
    workdir: tempRoot,
    dryRun: true
  });

  assert.strictEqual(result.status, "failed");
  assert.ok(typeof result.errorEnvelope?.errorCode === "string");

  const runId = (await readdir(path.resolve(tempRoot, ".ogs/runs")))[0];
  const runDir = path.resolve(tempRoot, ".ogs/runs", runId);
  const metricsJson = JSON.parse(await readFile(path.resolve(runDir, "metrics.json"), "utf8"));
  assert.ok(typeof metricsJson.rssBytes === "number");
  assert.ok(typeof metricsJson.stateWriteMs === "number");
  assert.ok(typeof metricsJson.executionDirCount === "number");
  assert.ok(metricsJson.summary.failedCount >= 1);
});

test("adapter keeps scheduler recursion budget above loop-heavy transition counts", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-recursion-budget-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  const lawsPath = path.resolve(tempRoot, "laws.json");
  const runtimePath = path.resolve(tempRoot, ".ogs", "runtime.json");
  const roleDir = path.resolve(tempRoot, "og-roles", "roles", "test-loop-probe");

  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-models"), path.resolve(tempRoot, "og-models"), "dir");
  await mkdir(roleDir, { recursive: true });
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        modelRepo: "./og-models",
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "role.json"),
    JSON.stringify(
      {
        roleId: "test-loop-probe",
        roleVersion: "1.0.0",
        name: "Loop Probe",
        description: "Scheduler recursion stress role",
        promptTemplate: "prompt.md",
        outputSchema: "output.schema.json"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "prompt.md"),
    [
      "Return a JSON object.",
      "Allowed events: {{allowed_events}}.",
      "Task: {{task}}.",
      "Input: {{input}}."
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "agent.md"),
    "# test-loop-probe\n\nScheduler recursion stress role\n",
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "output.schema.json"),
    JSON.stringify(
      {
        type: "object",
        properties: {
          event: {
            type: "string",
            enum: ["RETRY", "DONE"]
          },
          content: {
            type: "string"
          }
        },
        required: ["event"],
        additionalProperties: true
      },
      null,
      2
    ),
    "utf8"
  );

  const laws = JSON.parse(await readFile(path.resolve(repoRoot, ".ogs", "laws.json"), "utf8"));
  const globalLaw = laws.laws.find((item) => item.lawId === "law.console.base");
  assert.ok(globalLaw);
  globalLaw.constraints = {
    ...(globalLaw.constraints ?? {}),
    maxTransitions: 40
  };
  await writeFile(lawsPath, JSON.stringify(laws, null, 2), "utf8");

  await writeFile(
    systemPath,
    `flowchart TD
%% system.id=test.scheduler.recursion
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=test-loop-probe
%% loop.max.test-loop-probe=40
%% model.bind.test-loop-probe=balanced-gpt52

input -->|GO| operator[Role:test-loop-probe]
operator[Role:test-loop-probe] -->|RETRY| operator[Role:test-loop-probe]
operator[Role:test-loop-probe] -->|DONE| output
`,
    "utf8"
  );

  const result = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath,
    prompt: "stress scheduler recursion budget",
    workdir: tempRoot,
    dryRun: true
  });

  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "test-loop-probe");
  assert.strictEqual(result.auditTrail.length, 40);
  assert.strictEqual(result.systemState.transitionCount, 40);

  const runDir = path.resolve(
    tempRoot,
    ".ogs/runs",
    (await readdir(path.resolve(tempRoot, ".ogs/runs")))[0]
  );
  const executionDirs = (
    await readdir(path.resolve(runDir, "roles", "test-loop-probe", "executions"))
  ).sort((left, right) => left.localeCompare(right));
  const lastPrompt = await readFile(
    path.resolve(
      runDir,
      "roles",
      "test-loop-probe",
      "executions",
      executionDirs.at(-1),
      "prompt.md"
    ),
    "utf8"
  );
  assert.match(lastPrompt, /Task: stress scheduler recursion budget\./);
  assert.match(lastPrompt, /Input: \[dry-run\] opencode-sdk\./);
});
