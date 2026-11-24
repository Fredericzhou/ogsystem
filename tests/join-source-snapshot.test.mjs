import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";
import { buildJoinSourceStatus, mergeJoinSourceStatus } from "../dist/runtime/graph-mode-registry.js";

test("four-valued join source status preserves sticky failed invariant across all 4x4 transitions", () => {
  const states = ["pending", "arrived", "skipped", "failed"];

  // 1. Absorbing top element: failed is never silently downgraded to skipped, arrived, or pending.
  for (const state of states) {
    assert.equal(mergeJoinSourceStatus("failed", state), "failed", `failed -> ${state} must remain failed`);
    assert.equal(mergeJoinSourceStatus(state, "failed"), "failed", `${state} -> failed must escalate to failed`);
  }

  // 2. Irreversibility: arrived and skipped cannot revert to pending or flip into each other.
  assert.equal(mergeJoinSourceStatus("arrived", "pending"), "arrived");
  assert.equal(mergeJoinSourceStatus("arrived", "skipped"), "arrived");
  assert.equal(mergeJoinSourceStatus("arrived", "arrived"), "arrived");
  assert.equal(mergeJoinSourceStatus("skipped", "pending"), "skipped");
  assert.equal(mergeJoinSourceStatus("skipped", "arrived"), "skipped");
  assert.equal(mergeJoinSourceStatus("skipped", "skipped"), "skipped");

  // 3. Pending advances to any observed status.
  for (const state of states) {
    assert.equal(mergeJoinSourceStatus("pending", state), state);
    assert.equal(mergeJoinSourceStatus(undefined, state), state);
  }

  // 4. buildJoinSourceStatus precedence: failed > skipped > arrived > pending.
  const built = buildJoinSourceStatus({
    declaredSources: ["role-a", "role-b", "role-c", "role-d"],
    completedSourceRoleIds: ["role-a", "role-b", "role-c"],
    skippedSourceRoleIds: ["role-a", "role-b"],
    failedSourceRoleIds: ["role-a"]
  });
  assert.deepEqual(built, {
    "role-a": "failed",
    "role-b": "skipped",
    "role-c": "arrived",
    "role-d": "pending"
  });
});

test("quorum decision event freezes source role, branch, status, and arrival time", async () => {
  const repoRoot = process.cwd();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-join-source-snapshot-"));
  let runId;
  try {
    await mkdir(path.resolve(workdir, ".ogs"), { recursive: true });
    await symlink(path.resolve(repoRoot, "og-roles"), path.resolve(workdir, "og-roles"), "dir");
    for (const name of ["runtime.json", "execution-bindings.json", "model-catalog.json", "laws.json", "user-profile.json"]) {
      await symlink(path.resolve(repoRoot, ".ogs", name), path.resolve(workdir, ".ogs", name));
    }

    const result = await runSystemWithAdapter({
      systemPath: path.resolve(repoRoot, "examples/medical-quorum-consultation/system.mmd"),
      runtimeConfigPath: path.resolve(workdir, ".ogs/runtime.json"),
      lawsPath: path.resolve(repoRoot, "examples/medical-quorum-consultation/laws.json"),
      userProfilePath: path.resolve(workdir, ".ogs/user-profile.json"),
      prompt: "verify quorum source audit snapshot",
      workdir,
      dryRun: true,
      onRunInitialized: (run) => { runId = run.runId; }
    });
    assert.equal(result.status, "done");
    assert.ok(runId);

    const eventsPath = path.resolve(workdir, ".ogs", "runs", runId, "events.ndjson");
    const events = (await readFile(eventsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const quorum = events.find((event) => event.type === "join_quorum_reached");
    assert.ok(quorum, "expected a quorum decision event");
    assert.equal(quorum.requiredSourceCount, 3);
    assert.deepEqual(quorum.sourceSnapshot.map((source) => source.roleId), [
      "diagnosis-cardiology",
      "diagnosis-neurology",
      "diagnosis-imaging"
    ]);
    assert.ok(quorum.sourceSnapshot.every((source) => source.status === "arrived"));
    assert.ok(quorum.sourceSnapshot.every((source) => source.branchId));
    assert.ok(quorum.sourceSnapshot.every((source) => Number.isFinite(Date.parse(source.arrivedAt))));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
