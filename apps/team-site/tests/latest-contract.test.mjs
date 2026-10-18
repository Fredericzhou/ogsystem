import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("latest domain contract exposes only canonical run statuses", async () => {
  const contracts = await import("../domain/contracts.mjs");
  assert.deepEqual(contracts.RUN_STATUSES, [
    "planning", "running", "pause_requested", "paused", "waiting_review",
    "completed", "failed", "cancel_requested", "cancelled"
  ]);
  assert.equal(contracts.isTerminalRunStatus("stopped"), false);
  assert.equal(contracts.isTerminalRunStatus("cancelled"), true);
  assert.throws(() => contracts.assertLatestProjectOverview({ intent: "legacy" }), /PROJECT_SCHEMA_UNSUPPORTED/);
});

test("service restart converts an active run state into a durable failure", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-recovery-"));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?recovery=${Date.now()}-${Math.random()}`);
  const runService = await import(`../run-service.mjs?recovery=${Date.now()}-${Math.random()}`);
  try {
    const project = await store.createProject({ name: "Recovery Team", overview: "Recovery test.", templateId: "empty" });
    const runDir = join(project.workdir, ".ogs", "runs", "recovery-run");
    await mkdir(join(runDir, "control"), { recursive: true });
    await writeFile(join(runDir, "control", "state.json"), JSON.stringify({ status: "running", updatedAt: new Date().toISOString() }), "utf8");
    const recovered = await runService.recoverOrphanedRuns();
    assert.deepEqual(recovered, [{ projectId: project.projectId, runId: "recovery-run" }]);
    const state = JSON.parse(await readFile(join(runDir, "control", "state.json"), "utf8"));
    assert.equal(state.status, "failed");
    assert.match(state.error, /^RUNNER_RESTARTED:/);
  } finally {
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
