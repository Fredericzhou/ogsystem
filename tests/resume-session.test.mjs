import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";
import { createExecutionPlan } from "../dist/runtime/execution-plan.js";
import { createInitialGraphState } from "../dist/runtime/graph-runtime-state.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";

test("adapter resume reloads sessions.json and reuses the same model session", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-resume-session-"));
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const runDir = path.resolve(tempRoot, "ogsystem-history", "existing-run");

  const systemSource = `flowchart TD
%% system.id=resume.session.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-minimalist
%% model.bind.debate-minimalist=balanced-gpt52

input -->|GO| minimalist[Role:debate-minimalist]
minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| output
`;

  await mkdir(runDir, { recursive: true });
  await writeFile(systemPath, systemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: path.resolve("og-roles"),
        modelRepo: path.resolve("og-models"),
        runsDir: "ogsystem-history"
      },
      null,
      2
    ),
    "utf8"
  );

  const plan = createExecutionPlan(parseSystemFromMermaidSource(systemSource));
  const graphState = createInitialGraphState({
    plan,
    prompt: "resume session"
  });

  await writeFile(
    path.resolve(runDir, "state.json"),
    JSON.stringify({ graphState }, null, 2),
    "utf8"
  );
  await writeFile(
    path.resolve(runDir, "sessions.json"),
    JSON.stringify(
      [
        {
          sessionKey: "debate-minimalist",
          roleId: "debate-minimalist",
          sessionId: "ses_existing",
          directory: path.resolve(runDir, "roles", "debate-minimalist"),
          createdAt: "2026-04-10T00:00:00.000Z",
          lastPromptAt: "2026-04-10T00:01:00.000Z",
          lastMessageId: "msg_old",
          promptCount: 2
        }
      ],
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.resolve(runDir, "events.ndjson"), "corrupted historical log\n", "utf8");

  const result = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath: path.resolve(".ogsystem", "laws.json"),
    workdir: tempRoot,
    resumeRunDir: "ogsystem-history/existing-run",
    prompt: "resume session",
    dryRun: true
  });

  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "debate-minimalist");

  const sessions = JSON.parse(await readFile(path.resolve(runDir, "sessions.json"), "utf8"));
  assert.strictEqual(sessions.length, 1);
  assert.strictEqual(sessions[0].sessionId, "ses_existing");
  assert.strictEqual(sessions[0].promptCount, 3);

  const roleSession = JSON.parse(
    await readFile(path.resolve(runDir, "roles", "debate-minimalist", "session.json"), "utf8")
  );
  assert.strictEqual(roleSession.sessionId, "ses_existing");
  assert.strictEqual(roleSession.promptCount, 3);

  const stateJson = JSON.parse(await readFile(path.resolve(runDir, "state.json"), "utf8"));
  assert.strictEqual(stateJson.graphState.finalRoleId, "debate-minimalist");
});

test("adapter resume rejects partial or corrupted state snapshots", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-resume-corrupt-"));
  const systemPath = path.resolve(tempRoot, "resume-system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const runDir = path.resolve(tempRoot, "ogsystem-history", "broken-run");

  const systemSource = `flowchart TD
%% system.id=resume.corrupt.demo
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-minimalist
%% model.bind.debate-minimalist=balanced-gpt52

input -->|GO| minimalist[Role:debate-minimalist]
minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| output
`;

  await mkdir(runDir, { recursive: true });
  await writeFile(systemPath, systemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: path.resolve("og-roles"),
        modelRepo: path.resolve("og-models"),
        runsDir: "ogsystem-history"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.resolve(runDir, "state.json"), JSON.stringify({ graphState: { status: "running" } }), "utf8");
  await writeFile(path.resolve(runDir, "sessions.json"), JSON.stringify([], null, 2), "utf8");

  await assert.rejects(
    () =>
      runSystemWithAdapter({
        systemPath,
        runtimeConfigPath: runtimePath,
        lawsPath: path.resolve(".ogsystem", "laws.json"),
        workdir: tempRoot,
        resumeRunDir: "ogsystem-history/broken-run",
        prompt: "resume corrupted",
        dryRun: true
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /partial or corrupted/);
      return true;
    }
  );
});
