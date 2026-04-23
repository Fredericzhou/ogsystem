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
  assert.ok(policy.some((entry) => entry.path === "plan-fingerprint.json" && entry.resumeConsumed));
  assert.ok(policy.some((entry) => entry.path === ".resume.lock" && entry.resumeConsumed));
  assert.ok(
    policy.some(
      (entry) => entry.path === "checkpoints/<sequence>-<executionId>.json" && entry.resumeConsumed
    )
  );
  assert.ok(
    policy.some(
      (entry) =>
        entry.path === "control/reviews/<reviewId>.request.json" && entry.resumeConsumed
    )
  );
  assert.ok(
    policy.some(
      (entry) =>
        entry.path === "control/reviews/<reviewId>.decision.json" && entry.resumeConsumed
    )
  );
  assert.ok(
    policy.some(
      (entry) =>
        entry.path === "roles/<roleId>/executions/<executionId>/execution-outcome.json" &&
        entry.resumeConsumed
    )
  );
  assert.ok(policy.some((entry) => entry.path === "events.ndjson" && !entry.resumeConsumed));
  assert.ok(
    policy.some(
      (entry) =>
        entry.path === "summary.json" &&
        entry.retention === "operator_latest" &&
        !entry.resumeConsumed
    )
  );
  assert.ok(
    policy.some(
      (entry) =>
        entry.path === "timeline.jsonl" &&
        entry.retention === "operator_latest" &&
        !entry.resumeConsumed
    )
  );
  assert.ok(policy.some((entry) => entry.path === "repro.sh" && !entry.resumeConsumed));
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
  await symlink(
    path.resolve(repoRoot, ".ogs", "laws.json"),
    path.resolve(tempRoot, ".ogs", "laws.json")
  );
  await symlink(
    path.resolve(repoRoot, ".ogs", "model-selection.json"),
    path.resolve(tempRoot, ".ogs", "model-selection.json")
  );

  await runSystemWithAdapter({
    systemPath: path.resolve(repoRoot, "examples/target-model-binding-system.mmd"),
    prompt: "artifact contract",
    workdir: tempRoot,
    dryRun: true
  });

  const runId = (await readdir(path.resolve(tempRoot, ".ogs/runs")))[0];
  assert.match(runId, /^\d{8}-\d{6}-[a-f0-9]{8}$/);
  const runDir = path.resolve(tempRoot, ".ogs/runs", runId);
  const sessions = JSON.parse(await readFile(path.resolve(runDir, "sessions.json"), "utf8"));
  const resolvedConfig = JSON.parse(await readFile(path.resolve(runDir, "resolved-config.json"), "utf8"));

  assert.ok(Array.isArray(sessions));
  await readFile(path.resolve(runDir, "state.json"), "utf8");
  await readFile(path.resolve(runDir, "summary.json"), "utf8");
  await readFile(path.resolve(runDir, "timeline.jsonl"), "utf8");
  await readFile(path.resolve(runDir, "plan-fingerprint.json"), "utf8");
  await readFile(path.resolve(runDir, "events.ndjson"), "utf8");
  const reproScript = await readFile(path.resolve(runDir, "repro.sh"), "utf8");
  assert.match(reproScript, /# Environment Context:/);
  assert.match(reproScript, /# Node\.js:/);
  assert.match(reproScript, /# OS:/);
  assert.match(reproScript, /# Timestamp:/);
  assert.match(reproScript, /ARGS=\(\n  run\n  resume\n  "\$RUN_ID"/);
  assert.match(reproScript, /--workdir "\$WORKDIR"/);
  await readFile(path.resolve(runDir, "audit", "summary.md"), "utf8");
  await readFile(path.resolve(runDir, "audit", "transitions.md"), "utf8");
  assert.equal(resolvedConfig.effective?.invocation?.dryRun, true);
  await readFile(path.resolve(runDir, "roles", "debate-minimalist", "role.md"), "utf8");
  await readFile(path.resolve(runDir, "roles", "debate-minimalist", "latest-session.json"), "utf8");

  const executions = await readdir(
    path.resolve(runDir, "roles", "debate-minimalist", "executions")
  );
  assert.equal(executions.length, 1);
  await readFile(
      path.resolve(runDir, "roles", "debate-minimalist", "executions", executions[0], "prompt.md"),
    "utf8"
  );
  await readFile(
    path.resolve(
      runDir,
      "roles",
      "debate-minimalist",
      "executions",
      executions[0],
      "execution-outcome.json"
    ),
    "utf8"
  );
});
