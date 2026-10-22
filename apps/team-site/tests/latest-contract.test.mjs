import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withRunQueryUseCases } from "./run-query-test-helpers.mjs";
import { withTaskCreationUseCases } from "./task-creation-test-helpers.mjs";
import { createRunRecoveryUseCases } from "../application/run-recovery-use-cases.mjs";
import { createFileRunRecoveryStore } from "../infrastructure/file-run-recovery-store.mjs";

test("latest domain contract exposes only canonical run statuses", async () => {
  const contracts = await import("../domain/contracts.mjs");
  assert.deepEqual(contracts.RUN_STATUSES, [
    "planning", "ready", "running", "pause_requested", "paused", "waiting_review",
    "completed", "failed", "cancel_requested", "cancelled"
  ]);
  assert.equal(contracts.isTerminalRunStatus("stopped"), false);
  assert.equal(contracts.isTerminalRunStatus("cancelled"), true);
  assert.throws(() => contracts.assertLatestProjectOverview({ intent: "legacy" }), /PROJECT_SCHEMA_UNSUPPORTED/);
});

test("Run domain accepts only documented lifecycle transitions", async () => {
  const run = await import("../domain/run.mjs");
  const valid = [
    ["planning", "ready"],
    ["ready", "running"],
    ["running", "waiting_review"],
    ["waiting_review", "paused"],
    ["paused", "running"],
    ["running", "cancel_requested"],
    ["cancel_requested", "cancelled"],
    ["paused", "cancelled"],
    ["ready", "failed"]
  ];
  for (const [from, to] of valid) assert.equal(run.canTransitionRun(from, to), true, `${from} -> ${to}`);
  for (const [from, to] of [["planning", "completed"], ["completed", "running"], ["waiting_review", "running"], ["unknown", "failed"]]) {
    assert.equal(run.canTransitionRun(from, to), false, `${from} -> ${to}`);
    assert.throws(() => run.assertRunTransition(from, to), /RUN_TRANSITION_INVALID/);
  }
});

test("Task domain rejects lifecycle jumps that bypass Run and review decisions", async () => {
  const task = await import("../domain/task.mjs");
  const valid = [
    ["queued", "planning"],
    ["planning", "running"],
    ["running", "waiting_review"],
    ["waiting_review", "queued"],
    ["paused", "running"],
    ["failed", "queued"],
    ["failed", "deleted"]
  ];
  for (const [from, to] of valid) assert.equal(task.canTransitionTask(from, to), true, `${from} -> ${to}`);
  for (const [from, to] of [["queued", "completed"], ["completed", "running"], ["deleted", "queued"], ["unknown", "failed"]]) {
    assert.equal(task.canTransitionTask(from, to), false, `${from} -> ${to}`);
    assert.throws(() => task.assertTaskTransition(from, to), /TASK_TRANSITION_INVALID/);
  }
});

test("service restart ignores legacy non-Project Run evidence", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-recovery-"));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../infrastructure/file-project-store.mjs?recovery=${Date.now()}-${Math.random()}`);
  const runRecovery = createRunRecoveryUseCases({ recoveryStore: createFileRunRecoveryStore({ projectsRoot }) });
  try {
    const project = await store.createProject({ name: "Recovery Team", overview: "Recovery test.", templateId: "empty" });
    const runDir = join(project.workdir, ".ogs", "runs", "recovery-run");
    await mkdir(join(runDir, "control"), { recursive: true });
    await writeFile(join(runDir, "control", "state.json"), JSON.stringify({ status: "running", updatedAt: new Date().toISOString() }), "utf8");
    const metadataPath = join(project.workdir, ".site", "project.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    await writeFile(metadataPath, JSON.stringify({
      ...metadata,
      taskRecords: [{ taskId: "recovery-task", currentRunId: "recovery-run", runIds: ["recovery-run"], status: "planning" }]
    }), "utf8");
    const recovered = await runRecovery.recoverOrphanedRuns();
    assert.deepEqual(recovered, []);
    const state = JSON.parse(await readFile(join(runDir, "control", "state.json"), "utf8"));
    assert.equal(state.status, "running");
    const recoveredMetadata = JSON.parse(await readFile(metadataPath, "utf8"));
    assert.equal(recoveredMetadata.taskRecords[0].status, "planning");
  } finally {
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("service restart ignores non-Project task metadata with a missing Run state", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-missing-run-state-"));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../infrastructure/file-project-store.mjs?missing-run=${Date.now()}-${Math.random()}`);
  const runRecovery = createRunRecoveryUseCases({ recoveryStore: createFileRunRecoveryStore({ projectsRoot }) });
  try {
    const project = await store.createProject({ name: "Missing Run Team", overview: "Reservation recovery.", templateId: "empty" });
    const metadataPath = join(project.workdir, ".site", "project.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    await writeFile(metadataPath, JSON.stringify({
      ...metadata,
      taskRecords: [{ taskId: "reserved-task", currentRunId: "reserved-run", runIds: ["reserved-run"], status: "planning" }]
    }), "utf8");
    assert.deepEqual(await runRecovery.recoverOrphanedRuns(), []);
    const recoveredMetadata = JSON.parse(await readFile(metadataPath, "utf8"));
    assert.equal(recoveredMetadata.taskRecords[0].status, "planning");
  } finally {
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("service restart repairs a stale Task projection from a Project-owned Run idempotently", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-cross-workspace-recovery-"));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTaskCreationUseCases(await import(`../infrastructure/file-project-store.mjs?cross-workspace-recovery=${Date.now()}-${Math.random()}`));
  const runRecovery = createRunRecoveryUseCases({ recoveryStore: createFileRunRecoveryStore({ projectsRoot }) });
  try {
    const createdTeam = await store.createProject({ name: "Recovery Source Team", overview: "Team workspace for the Run.", templateId: "empty" });
    const team = await store.confirmProjectTeam(createdTeam.projectId, { release: true });
    const project = await store.createCollaborationProject({
      name: "Recovery Collaboration Project",
      overview: "Task projection lives in this separate workspace.",
      teamVersionIds: [team.teamVersionId]
    });
    const task = await store.createProjectTask(project.projectId, {
      input: "Recover the projection after an interrupted cross-workspace update.",
      teamVersionId: team.teamVersionId
    });
    const runId = "cross-workspace-recovery-run";
    const runDir = join(project.workdir, ".ogs", "runs", runId);
    await mkdir(join(runDir, "control"), { recursive: true });
    await writeFile(join(runDir, "run-owner.json"), JSON.stringify({
      version: 1,
      runKind: "project_task",
      projectId: project.projectId,
      taskId: task.taskId,
      taskNumber: task.taskNumber,
      runId,
      attemptNumber: 1,
      teamVersionId: team.teamVersionId,
      teamCoreDigest: task.teamCoreDigest
    }), "utf8");
    await writeFile(join(runDir, "control", "state.json"), JSON.stringify({
      status: "failed",
      runId,
      attemptNumber: 1,
      taskReservation: {
        kind: "task-attempt",
        projectId: project.projectId,
        taskId: task.taskId,
        teamVersionId: team.teamVersionId,
        runId
      },
      error: "RUNNER_RESTARTED: simulated process exit after Run state commit.",
      updatedAt: "2026-10-18T00:00:00.000Z",
      finishedAt: "2026-10-18T00:00:00.000Z"
    }), "utf8");

    const metadataPath = join(project.workdir, ".site", "project.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    await writeFile(metadataPath, JSON.stringify({
      ...metadata,
      taskRecords: metadata.taskRecords.map((record) => record.taskId === task.taskId
        ? { ...record, currentRunId: runId, runIds: [runId], status: "planning" }
        : record)
    }), "utf8");

    assert.deepEqual(await runRecovery.recoverOrphanedRuns(), []);
    const recoveredMetadata = JSON.parse(await readFile(metadataPath, "utf8"));
    const recoveredTask = recoveredMetadata.taskRecords.find((record) => record.taskId === task.taskId);
    assert.equal(recoveredTask.status, "failed");
    assert.match(recoveredTask.lastError, /^RUNNER_RESTARTED:/);
    assert.equal(recoveredTask.currentRunId, runId);
    assert.deepEqual(recoveredTask.runIds, [runId]);

    const committedProjection = await readFile(metadataPath, "utf8");
    assert.deepEqual(await runRecovery.recoverOrphanedRuns(), []);
    assert.equal(await readFile(metadataPath, "utf8"), committedProjection);
  } finally {
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
