import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { lstat, mkdtemp, mkdir, readFile, readdir, readlink, symlink } from "node:fs/promises";

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

  const moderatorPrompt = await readFile(
    path.resolve(runDir, "roles", "debate-moderator", "prompt.md"),
    "utf8"
  );
  assert.match(moderatorPrompt, /讨论当前架构是否继续最小化/);

  const moderatorRole = await readFile(
    path.resolve(runDir, "roles", "debate-moderator", "role.md"),
    "utf8"
  );
  assert.match(moderatorRole, /modelId: fast-gpt54/);
  assert.match(moderatorRole, /preferredModelTags:/);

  const moderatorInbox = await readFile(
    path.resolve(runDir, "roles", "debate-moderator", "inbox.md"),
    "utf8"
  );
  assert.match(moderatorInbox, /Runtime Input Projection:/);
  assert.match(moderatorInbox, /"user_profile"/);
  assert.match(moderatorInbox, /"allowed_events"/);

  const moderatorPrivateStat = await lstat(
    path.resolve(runDir, "roles", "debate-moderator", "private")
  );
  assert.ok(moderatorPrivateStat.isDirectory());

  const moderatorSharedPath = path.resolve(runDir, "roles", "debate-moderator", "shared");
  const moderatorSharedStat = await lstat(moderatorSharedPath);
  assert.ok(moderatorSharedStat.isSymbolicLink());
  assert.strictEqual(await readlink(moderatorSharedPath), tempRoot);

  const judgeResult = JSON.parse(
    await readFile(path.resolve(runDir, "roles", "debate-judge", "result.json"), "utf8")
  );
  assert.strictEqual(judgeResult.event, "DECISION_READY");
});
