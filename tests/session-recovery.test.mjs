import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";

import { createExecutionPlan, getExecutionPlanNode } from "../dist/runtime/execution-plan.js";
import { createInitialState } from "../dist/runtime/graph-runtime-state.js";
import { loadSystemFromMermaid } from "../dist/runtime/parse-mermaid.js";
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
  const runDir = path.resolve(workdir, ".ogsystems", "resume-run");
  await mkdir(runDir, { recursive: true });
  await writeFile(
    path.resolve(runDir, "sessions.json"),
    JSON.stringify(
      [
        {
          sessionKey: "test-operator",
          roleId: "test-operator",
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
      modelRepo: "./og-models",
      runsDir: ".ogsystems"
    },
    "runtime.json"
  );

  const runContext = await initializeRunContext({
    system,
    systemPath,
    prompt: "resume prompt",
    workdir,
    runtimeConfig,
    resumeRunDir: ".ogsystems/resume-run"
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
