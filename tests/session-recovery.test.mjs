import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { createExecutionPlan, getExecutionPlanNode } from "../dist/runtime/execution-plan.js";
import { createInitialState } from "../dist/runtime/graph-runtime-state.js";
import { loadModelPackage } from "../dist/runtime/model-repo.js";
import { loadSystemFromMermaid, parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import { loadRolePackage } from "../dist/runtime/role-repo.js";
import { initializeRunContext } from "../dist/runtime/run-artifacts.js";
import { executeRoleNode } from "../dist/runtime/role-executor.js";
import { validateRuntimeConfig } from "../dist/runtime/config.js";

test("resume context reloads sessions.json and reuses session ids for role execution", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-session-recovery-"));
  const workdir = tempRoot;
  const systemPath = path.resolve("tests/fixtures/mermaid/law-system.mmd");
  const system = await loadSystemFromMermaid(systemPath);
  const plan = createExecutionPlan(system);
  const runDir = path.resolve(workdir, ".ogs/runs", "resume-run");
  await mkdir(runDir, { recursive: true });
  await writeFile(
    path.resolve(runDir, "sessions.json"),
    JSON.stringify(
      [
        {
          sessionKey: "test-operator:test-operator@1#1",
          roleId: "test-operator",
          sessionLineageId: "test-operator@1#1",
          branchId: "test-operator@1#1",
          sessionId: "ses_resume",
          directory: path.resolve(runDir, "roles", "test-operator"),
          createdAt: "2026-04-10T00:00:00.000Z",
          lastPromptAt: "2026-04-10T00:00:00.000Z",
          lastMessageId: "msg_resume",
          promptCount: 1
        }
      ],
      null,
      2
    ),
    "utf8"
  );

  const runtimeConfig = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      runsDir: ".ogs/runs"
    },
    "runtime.json"
  );

  const runContext = await initializeRunContext({
    system,
    systemPath,
    prompt: "resume prompt",
    workdir,
    runtimeConfig,
    resumeRunDir: ".ogs/runs/resume-run"
  });
  const rolePackage = await loadRolePackage({
    roleId: "test-operator",
    roleRootDir: path.resolve("og-roles/roles")
  });
  const state = createInitialState(plan, "resume prompt");
  const seenSessionIds = [];
  const executor = {
    async start() {},
    async close() {},
    async abortSession() {},
    getServerMetadata() {
      return {};
    },
    async execute(request) {
      seenSessionIds.push(request.sessionId);
      return {
        exitCode: 0,
        stdout: JSON.stringify({ event: "DONE", content: "ok" }),
        stderr: "",
        args: [],
        sessionId: request.sessionId,
        messageId: "msg_next"
      };
    }
  };

  const result = await executeRoleNode({
    roleId: "test-operator",
    node: getExecutionPlanNode(plan, "test-operator"),
    plan,
    state,
    effectiveLaw: {
      forbiddenToolRefs: [],
      allowNoopWithoutExecutionBinding: false
    },
    profilesById: new Map([
      [
        "profile.forbid",
        {
          profileId: "profile.forbid",
          toolRef: "tool.forbidden"
        }
      ]
    ]),
    toolsByRef: new Map([
      [
        "tool.forbidden",
        {
          toolRef: "tool.forbidden",
          runner: "local_shell",
          command: "node",
          argsTemplate: ["tests/fixtures/scripts/branch-tool.js", "DONE"],
          stdinMode: "none"
        }
      ]
    ]),
    modelsById: new Map(),
    rolePackagesByRoleId: new Map([["test-operator", rolePackage]]),
    runContext,
    executor,
    workdir
  });

  assert.equal(result.status, "ok");
  assert.deepStrictEqual(seenSessionIds, ["ses_resume"]);
  assert.equal(result.audit.sessionId, "ses_resume");
});

test("resume context restores branch-local sessions and keeps sibling session memory isolated", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-session-branch-recovery-"));
  const workdir = tempRoot;
  const systemPath = path.resolve(tempRoot, "branch-session-system.mmd");
  const systemSource = `flowchart TD
%% system.id=session.branch.restore
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-moderator
%% role.mode.debate-moderator=parallel_split
%% model.bind.debate-moderator=fast-gpt54
%% model.bind.debate-minimalist=balanced-gpt52
%% model.bind.debate-alignmentist=balanced-gpt52
%% model.bind.debate-summary=balanced-gpt52

input -->|START| moderator[Role:debate-moderator]
moderator[Role:debate-moderator] -->|TO_MIN| minimalist[Role:debate-minimalist]
moderator[Role:debate-moderator] -->|TO_ALIGN| alignmentist[Role:debate-alignmentist]
minimalist[Role:debate-minimalist] -->|MIN_DONE| summary[Role:debate-summary]
alignmentist[Role:debate-alignmentist] -->|ALIGN_DONE| summary[Role:debate-summary]
summary[Role:debate-summary] -->|SUMMARY_READY| output
`;
  const system = parseSystemFromMermaidSource(systemSource);
  const plan = createExecutionPlan(system);
  const runDir = path.resolve(workdir, ".ogs/runs", "resume-branch-run");
  await mkdir(runDir, { recursive: true });
  await writeFile(systemPath, systemSource, "utf8");
  await writeFile(
    path.resolve(runDir, "sessions.json"),
    JSON.stringify(
      [
        {
          sessionKey: "debate-summary:debate-minimalist@1#2",
          roleId: "debate-summary",
          sessionLineageId: "debate-minimalist@1#2",
          branchId: "debate-summary@1#4",
          sessionId: "ses_summary_a",
          directory: path.resolve(runDir, "roles", "debate-summary"),
          createdAt: "2026-04-10T00:00:00.000Z",
          lastPromptAt: "2026-04-10T00:00:00.000Z",
          lastMessageId: "msg_summary_a",
          promptCount: 1
        },
        {
          sessionKey: "debate-summary:debate-alignmentist@1#3",
          roleId: "debate-summary",
          sessionLineageId: "debate-alignmentist@1#3",
          branchId: "debate-summary@1#5",
          sessionId: "ses_summary_b",
          directory: path.resolve(runDir, "roles", "debate-summary"),
          createdAt: "2026-04-10T00:00:00.000Z",
          lastPromptAt: "2026-04-10T00:00:00.000Z",
          lastMessageId: "msg_summary_b",
          promptCount: 1
        }
      ],
      null,
      2
    ),
    "utf8"
  );

  const runtimeConfig = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      runsDir: ".ogs/runs"
    },
    "runtime.json"
  );

  const runContext = await initializeRunContext({
    system,
    systemPath,
    prompt: "resume branch prompt",
    workdir,
    runtimeConfig,
    resumeRunDir: ".ogs/runs/resume-branch-run"
  });
  const summaryRolePackage = await loadRolePackage({
    roleId: "debate-summary",
    roleRootDir: path.resolve("og-roles/roles")
  });
  const summaryModelPackage = await loadModelPackage({
    modelId: "balanced-gpt52",
    modelRootDir: path.resolve("og-models")
  });
  const state = createInitialState(plan, "resume branch prompt");
  const summaryBranchA = {
    branchId: "debate-summary@1#4",
    roleId: "debate-summary",
    loopIteration: 1,
    branchSequence: 4,
    lineageId: "debate-moderator@1#1",
    sessionLineageId: "debate-minimalist@1#2",
    parentBranchId: "debate-minimalist@1#2",
    activatedByRoleId: "debate-minimalist",
    activatedByEvent: "MIN_DONE",
    status: "active"
  };
  const summaryBranchB = {
    branchId: "debate-summary@1#5",
    roleId: "debate-summary",
    loopIteration: 1,
    branchSequence: 5,
    lineageId: "debate-moderator@1#1",
    sessionLineageId: "debate-alignmentist@1#3",
    parentBranchId: "debate-alignmentist@1#3",
    activatedByRoleId: "debate-alignmentist",
    activatedByEvent: "ALIGN_DONE",
    status: "active"
  };
  state.branchRecords[summaryBranchA.branchId] = summaryBranchA;
  state.branchRecords[summaryBranchB.branchId] = summaryBranchB;
  state.roleResults[summaryBranchA.parentBranchId] = {
    roleId: "debate-minimalist",
    event: "MIN_DONE",
    content: "minimalist context",
    branchId: summaryBranchA.parentBranchId,
    lineageId: "debate-moderator@1#1",
    loopIteration: 1
  };
  state.roleResults[summaryBranchB.parentBranchId] = {
    roleId: "debate-alignmentist",
    event: "ALIGN_DONE",
    content: "alignment context",
    branchId: summaryBranchB.parentBranchId,
    lineageId: "debate-moderator@1#1",
    loopIteration: 1
  };

  const seenSessionIds = [];
  const sessionMemory = new Map();
  const executor = {
    async start() {},
    async close() {},
    async abortSession() {},
    getServerMetadata() {
      return {};
    },
    async execute(request) {
      seenSessionIds.push(request.sessionId);
      const token = request.prompt.includes("minimalist context")
        ? "MIN"
        : request.prompt.includes("alignment context")
          ? "ALIGN"
          : "UNKNOWN";
      const history = sessionMemory.get(request.sessionId) ?? [];
      history.push(token);
      sessionMemory.set(request.sessionId, history);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          event: "SUMMARY_READY",
          content: history.join("|")
        }),
        stderr: "",
        args: [],
        sessionId: request.sessionId,
        messageId: `msg_${seenSessionIds.length}`
      };
    }
  };

  const baseArgs = {
    roleId: "debate-summary",
    node: getExecutionPlanNode(plan, "debate-summary"),
    plan,
    state,
    effectiveLaw: {
      forbiddenToolRefs: [],
      allowNoopWithoutExecutionBinding: false
    },
    profilesById: new Map(),
    toolsByRef: new Map(),
    modelsById: new Map([["balanced-gpt52", summaryModelPackage]]),
    rolePackagesByRoleId: new Map([["debate-summary", summaryRolePackage]]),
    runContext,
    executor,
    workdir
  };

  const resultA = await executeRoleNode({
    ...baseArgs,
    branch: summaryBranchA
  });
  const resultB = await executeRoleNode({
    ...baseArgs,
    branch: summaryBranchB
  });
  const resultARepeat = await executeRoleNode({
    ...baseArgs,
    branch: summaryBranchA
  });

  assert.equal(resultA.status, "ok");
  assert.equal(resultB.status, "ok");
  assert.equal(resultARepeat.status, "ok");
  assert.deepStrictEqual(seenSessionIds, ["ses_summary_a", "ses_summary_b", "ses_summary_a"]);
  assert.equal(resultA.audit.sessionId, "ses_summary_a");
  assert.equal(resultB.audit.sessionId, "ses_summary_b");
  assert.equal(resultARepeat.audit.sessionId, "ses_summary_a");
  assert.equal(resultA.storedResult.content, "MIN");
  assert.equal(resultB.storedResult.content, "ALIGN");
  assert.equal(resultARepeat.storedResult.content, "MIN|MIN");

  const sessions = JSON.parse(await readFile(path.resolve(runDir, "sessions.json"), "utf8"));
  const summarySessions = sessions
    .filter((item) => item.roleId === "debate-summary")
    .sort((left, right) => left.sessionKey.localeCompare(right.sessionKey));
  assert.deepStrictEqual(
    summarySessions.map((item) => [item.sessionKey, item.promptCount]),
    [
      ["debate-summary:debate-alignmentist@1#3", 2],
      ["debate-summary:debate-minimalist@1#2", 3]
    ]
  );
});

test("branch workspace isolation stores session directory under branch private workspace", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-session-branch-isolation-"));
  const workdir = tempRoot;
  const systemPath = path.resolve("examples/target-model-binding-system.mmd");
  const system = await loadSystemFromMermaid(systemPath);
  const plan = createExecutionPlan(system);
  const runtimeConfig = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      runsDir: ".ogs/runs",
      workspace: {
        rolesDir: "roles",
        privateDirName: "private",
        workspaceIsolation: "branch"
      }
    },
    "runtime.json"
  );
  const runContext = await initializeRunContext({
    system,
    systemPath,
    prompt: "branch workspace prompt",
    workdir,
    runtimeConfig
  });
  const rolePackage = await loadRolePackage({
    roleId: system.entryRoleId,
    roleRootDir: path.resolve("og-roles/roles")
  });
  const modelPackage = await loadModelPackage({
    modelId: "general-balanced",
    modelRootDir: path.resolve("og-models")
  });
  const state = createInitialState(plan, "branch workspace prompt");
  const seenWorkdirs = [];
  const executor = {
    async start() {},
    async close() {},
    async abortSession() {},
    getServerMetadata() {
      return {};
    },
    async execute(request) {
      seenWorkdirs.push(request.workdir);
      return {
        exitCode: 0,
        stdout: JSON.stringify({ event: "DONE", content: "ok" }),
        stderr: "",
        args: [],
        sessionId: "ses_branch_private",
        messageId: "msg_branch_private"
      };
    }
  };

  const result = await executeRoleNode({
    roleId: system.entryRoleId,
    node: getExecutionPlanNode(plan, system.entryRoleId),
    plan,
    state,
    effectiveLaw: {
      forbiddenToolRefs: [],
      allowNoopWithoutExecutionBinding: false
    },
    profilesById: new Map(),
    toolsByRef: new Map(),
    modelsById: new Map([["general-balanced", modelPackage]]),
    rolePackagesByRoleId: new Map([[system.entryRoleId, rolePackage]]),
    runContext,
    executor,
    workdir
  });

  assert.equal(result.status, "ok");
  assert.equal(seenWorkdirs.length, 1);
  assert.match(
    seenWorkdirs[0],
    /roles\/debate-minimalist\/private\/branches\/debate-minimalist@1#1$/
  );
  const sessions = JSON.parse(await readFile(path.resolve(runContext.runDir, "sessions.json"), "utf8"));
  assert.match(
    sessions[0].directory,
    /roles\/debate-minimalist\/private\/branches\/debate-minimalist@1#1$/
  );
});
