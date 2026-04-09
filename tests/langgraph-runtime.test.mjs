import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { lstat, mkdtemp, mkdir, readFile, readdir, readlink, symlink } from "node:fs/promises";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

test("adapter runs langgraph debate example with parallel branches, join, and bounded loop", async () => {
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

  const runsDir = path.resolve(tempRoot, ".ogsystems");
  const runs = await readdir(runsDir);
  assert.strictEqual(runs.length, 1);

  const runDir = path.resolve(runsDir, runs[0]);
  const stateJson = JSON.parse(await readFile(path.resolve(runDir, "state.json"), "utf8"));
  assert.strictEqual(stateJson.finalRoleId, "debate-summary");
  assert.ok(Array.isArray(stateJson.completedBranches));
  assert.deepStrictEqual(stateJson.loopIterations["debate-round-manager"], 2);

  const eventsText = await readFile(path.resolve(runDir, "events.ndjson"), "utf8");
  assert.match(eventsText, /"branchId":"debate-minimalist@1"/);
  assert.match(eventsText, /"joinId":"debate-judge@2"/);

  const minimalistShared = path.resolve(runDir, "roles", "debate-minimalist", "shared");
  const alignmentistShared = path.resolve(runDir, "roles", "debate-alignmentist", "shared");
  assert.ok((await lstat(minimalistShared)).isSymbolicLink());
  assert.ok((await lstat(alignmentistShared)).isSymbolicLink());
  assert.strictEqual(await readlink(minimalistShared), tempRoot);
  assert.strictEqual(await readlink(alignmentistShared), tempRoot);

  const moderatorPrompt = await readFile(
    path.resolve(runDir, "roles", "debate-moderator", "prompt.md"),
    "utf8"
  );
  const summaryPrompt = await readFile(
    path.resolve(runDir, "roles", "debate-summary", "prompt.md"),
    "utf8"
  );
  assert.ok(summaryPrompt.length > moderatorPrompt.length);

  const resumed = await runSystemWithAdapter({
    systemPath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "system.mmd"),
    lawsPath: path.resolve(repoRoot, "examples", "langgraph-debate-current", "laws.json"),
    prompt: "是否应继续保持 OGSystem 最小化并延后 reducer 与恢复语义？",
    workdir: tempRoot,
    resumeRunDir: path.relative(tempRoot, runDir),
    dryRun: true
  });
  assert.strictEqual(resumed.status, "done");
  assert.strictEqual(resumed.finalRoleId, "debate-summary");
});
