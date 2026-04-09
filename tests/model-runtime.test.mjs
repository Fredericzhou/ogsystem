import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { lstat, mkdtemp, mkdir, readFile, readdir, symlink } from "node:fs/promises";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

test("adapter auto-discovers runtime config and persists run artifacts for model.bind systems", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-model-runtime-"));

  await mkdir(path.resolve(tempRoot, ".ogsystem"), { recursive: true });
  await symlink(path.resolve(repoRoot, "og-roles"), path.resolve(tempRoot, "og-roles"), "dir");
  await symlink(path.resolve(repoRoot, "og-models"), path.resolve(tempRoot, "og-models"), "dir");
  await symlink(path.resolve(repoRoot, ".ogsystem", "runtime.json"), path.resolve(tempRoot, ".ogsystem", "runtime.json"));
  await symlink(path.resolve(repoRoot, ".ogsystem", "user-profile.json"), path.resolve(tempRoot, ".ogsystem", "user-profile.json"));
  await symlink(path.resolve(repoRoot, ".ogsystem", "laws.json"), path.resolve(tempRoot, ".ogsystem", "laws.json"));

  const result = await runSystemWithAdapter({
    systemPath: path.resolve(repoRoot, "examples/target-model-binding-system.mmd"),
    prompt: "讨论当前架构是否继续最小化",
    workdir: tempRoot,
    dryRun: true
  });

  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "debate-judge");

  const runsDir = path.resolve(tempRoot, ".ogsystems");
  const runs = await readdir(runsDir);
  assert.strictEqual(runs.length, 1);

  const runDir = path.resolve(runsDir, runs[0]);
  const stateJson = JSON.parse(await readFile(path.resolve(runDir, "state.json"), "utf8"));
  assert.strictEqual(stateJson.finalRoleId, "debate-judge");

  const minimalistPrompt = await readFile(
    path.resolve(runDir, "roles", "debate-minimalist", "prompt.md"),
    "utf8"
  );
  assert.match(minimalistPrompt, /讨论当前架构是否继续最小化/);

  const minimalistRole = await readFile(
    path.resolve(runDir, "roles", "debate-minimalist", "role.md"),
    "utf8"
  );
  assert.match(minimalistRole, /modelId: balanced-gpt52/);
  assert.match(minimalistRole, /preferredModelTags:/);

  const minimalistInbox = await readFile(
    path.resolve(runDir, "roles", "debate-minimalist", "inbox.md"),
    "utf8"
  );
  assert.match(minimalistInbox, /Runtime Input Projection:/);
  assert.match(minimalistInbox, /"user_profile"/);
  assert.match(minimalistInbox, /"allowed_events"/);

  const minimalistPrivateStat = await lstat(
    path.resolve(runDir, "roles", "debate-minimalist", "private")
  );
  assert.ok(minimalistPrivateStat.isDirectory());
  const minimalistExecutions = await readdir(
    path.resolve(runDir, "roles", "debate-minimalist", "executions")
  );
  assert.strictEqual(minimalistExecutions.length, 1);
  const minimalistExecutionPrompt = await readFile(
    path.resolve(
      runDir,
      "roles",
      "debate-minimalist",
      "executions",
      minimalistExecutions[0],
      "prompt.md"
    ),
    "utf8"
  );
  assert.match(minimalistExecutionPrompt, /讨论当前架构是否继续最小化/);
  const privateReadme = await readFile(
    path.resolve(runDir, "roles", "debate-minimalist", "private", "README.md"),
    "utf8"
  );
  assert.match(privateReadme, /Role-private writable workspace/);

  const runSharedStat = await lstat(path.resolve(runDir, "shared"));
  assert.ok(runSharedStat.isDirectory());
  const sharedReadme = await readFile(path.resolve(runDir, "shared", "README.md"), "utf8");
  assert.match(sharedReadme, /Run-shared writable workspace/);
  await assert.rejects(lstat(path.resolve(runDir, "roles", "debate-minimalist", "shared")));

  const judgeResult = JSON.parse(
    await readFile(path.resolve(runDir, "roles", "debate-judge", "result.json"), "utf8")
  );
  assert.strictEqual(judgeResult.event, "DECISION_READY");
});
