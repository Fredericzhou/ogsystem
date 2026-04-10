import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, readFile, readdir, symlink } from "node:fs/promises";

import { listRunArtifactPolicy } from "../dist/runtime/run-artifact-policy.js";
import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

test("artifact policy documents runtime-consumed and operator-facing files", () => {
  const policy = listRunArtifactPolicy();
  assert.ok(policy.some((entry) => entry.path === "state.json" && entry.resumeConsumed));
  assert.ok(policy.some((entry) => entry.path === "sessions.json" && entry.resumeConsumed));
  assert.ok(policy.some((entry) => entry.path === "events.ndjson" && !entry.resumeConsumed));
  assert.ok(
    policy.some(
      (entry) =>
        entry.path === "roles/<roleId>/executions/<executionId>/..." &&
        entry.retention === "history_only"
    )
  );
});

test("model runtime artifacts match the documented contract", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-artifact-policy-"));

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
  await symlink(
    path.resolve(repoRoot, ".ogsystem", "laws.json"),
    path.resolve(tempRoot, ".ogsystem", "laws.json")
  );

  await runSystemWithAdapter({
    systemPath: path.resolve(repoRoot, "examples/target-model-binding-system.mmd"),
    prompt: "artifact contract",
    workdir: tempRoot,
    dryRun: true
  });

  const runId = (await readdir(path.resolve(tempRoot, "ogsystem-history")))[0];
  assert.match(runId, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[a-z0-9]{4}$/);
  const runDir = path.resolve(tempRoot, "ogsystem-history", runId);
  const sessions = JSON.parse(await readFile(path.resolve(runDir, "sessions.json"), "utf8"));

  assert.ok(Array.isArray(sessions));
  await readFile(path.resolve(runDir, "state.json"), "utf8");
  await readFile(path.resolve(runDir, "events.ndjson"), "utf8");
  await readFile(path.resolve(runDir, "audit", "summary.md"), "utf8");
  await readFile(path.resolve(runDir, "audit", "transitions.md"), "utf8");
  await readFile(path.resolve(runDir, "roles", "debate-minimalist", "role.md"), "utf8");
  await readFile(path.resolve(runDir, "roles", "debate-minimalist", "session.json"), "utf8");

  const executions = await readdir(
    path.resolve(runDir, "roles", "debate-minimalist", "executions")
  );
  assert.equal(executions.length, 1);
  await readFile(
    path.resolve(runDir, "roles", "debate-minimalist", "executions", executions[0], "prompt.md"),
    "utf8"
  );
});
