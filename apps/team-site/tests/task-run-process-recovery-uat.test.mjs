import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { withTaskCreationUseCases } from "./task-creation-test-helpers.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function writeJsonAtomic(path, value) {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

async function waitForTerminalTask(baseUrl, projectId, taskId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/v1/projects/${projectId}/tasks/${taskId}`);
    assert.equal(response.status, 200);
    const task = await response.json();
    if (["completed", "failed", "cancelled"].includes(task.status)) return task;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error("Task did not reach a terminal state in time.");
}

async function waitForServer(server, getOutput) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    const baseUrl = getOutput().match(/ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    if (baseUrl) return baseUrl;
    if (server.exitCode !== null) throw new Error(`Team Site server exited before readiness: ${getOutput()}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Team Site server did not become ready: ${getOutput()}`);
}

async function stopServer(server) {
  if (!server) return;
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill("SIGTERM");
  await once(server, "exit");
}

test("server startup recovers a stranded Task Run and its Task retry completes over HTTP", { timeout: 60000 }, async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-task-process-recovery-"));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTaskCreationUseCases(await import(`../infrastructure/file-project-store.mjs?process-recovery-uat=${Date.now()}-${Math.random()}`));
  let server;
  let output = "";

  try {
    const teamDraft = await store.createProject({
      name: "Process Recovery UAT Team",
      overview: "Exercise startup recovery through the real Team Site process.",
      templateId: "empty"
    });
    const team = await store.confirmProjectTeam(teamDraft.projectId, { release: true });
    const project = await store.createCollaborationProject({
      name: "Process Recovery UAT Project",
      overview: "Recover an interrupted Task and retry it through HTTP.",
      teamVersionIds: [team.teamVersionId]
    });
    const task = await store.createProjectTask(project.projectId, {
      input: "Create a real Run fixture for process recovery.",
      teamVersionId: team.teamVersionId
    });
    const started = await store.startProjectTask(project.projectId, task.taskId, { mode: "dry-run" });
    assert.ok(started.currentRunId);

    let completedFixture;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      completedFixture = await store.getProjectTask(project.projectId, task.taskId);
      if (["completed", "failed", "cancelled"].includes(completedFixture.status)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    assert.equal(completedFixture.status, "completed", completedFixture.lastError || "fixture Run should complete");
    const strandedRunId = completedFixture.currentRunId;
    const runStatePath = join(team.workdir, ".ogs", "runs", strandedRunId, "control", "state.json");
    const runState = JSON.parse(await readFile(runStatePath, "utf8"));
    await writeJsonAtomic(runStatePath, {
      ...runState,
      status: "running",
      error: undefined,
      finishedAt: undefined,
      updatedAt: new Date().toISOString()
    });

    const projectMetadataPath = join(project.workdir, ".site", "project.json");
    const metadata = JSON.parse(await readFile(projectMetadataPath, "utf8"));
    metadata.taskRecords = metadata.taskRecords.map((record) => record.taskId === task.taskId
      ? { ...record, status: "running", currentRunId: strandedRunId, runIds: [strandedRunId], runProjectId: team.teamVersionId, lastError: null, completedAt: null }
      : record);
    await writeJsonAtomic(projectMetadataPath, metadata);

    server = spawn(process.execPath, ["server.mjs"], {
      cwd: appRoot,
      env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    server.stdout.on("data", (chunk) => { output += chunk.toString(); });
    server.stderr.on("data", (chunk) => { output += chunk.toString(); });
    const baseUrl = await waitForServer(server, () => output);

    const failedTaskResponse = await fetch(`${baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}`);
    assert.equal(failedTaskResponse.status, 200);
    const failedTask = await failedTaskResponse.json();
    assert.equal(failedTask.status, "failed");
    assert.equal(failedTask.currentRunId, strandedRunId);
    assert.match(failedTask.lastError, /RUNNER_RESTARTED/);

    const runPath = `${baseUrl}/api/v1/projects/${project.projectId}/runs/${strandedRunId}`;
    const failedRunResponse = await fetch(runPath);
    assert.equal(failedRunResponse.status, 200);
    const failedRunBeforeRetry = await failedRunResponse.json();
    assert.equal(failedRunBeforeRetry.state.status, "failed");
    assert.match(failedRunBeforeRetry.state.error, /RUNNER_RESTARTED/);

    const retryResponse = await fetch(`${baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "dry-run", idempotencyKey: "process-recovery-uat-retry" })
    });
    const retryPayload = await retryResponse.json();
    assert.equal(retryResponse.status, 202, JSON.stringify(retryPayload));
    const retryReservation = retryPayload;
    assert.equal(retryReservation.taskId, task.taskId);
    assert.notEqual(retryReservation.currentRunId, strandedRunId);

    const retriedTask = await waitForTerminalTask(baseUrl, project.projectId, task.taskId);
    assert.equal(retriedTask.status, "completed", retriedTask.lastError || "Task retry should complete");
    assert.deepEqual(retriedTask.runIds, [strandedRunId, retriedTask.currentRunId]);
    assert.notEqual(retriedTask.currentRunId, strandedRunId);

    const oldRunAfterRetry = await fetch(runPath).then((response) => response.json());
    assert.deepEqual(oldRunAfterRetry.state, failedRunBeforeRetry.state);
    const newRunResponse = await fetch(`${baseUrl}/api/v1/projects/${project.projectId}/runs/${retriedTask.currentRunId}`);
    assert.equal(newRunResponse.status, 200);
    assert.equal((await newRunResponse.json()).state.status, "completed");
  } finally {
    await stopServer(server);
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("server startup removes a Task Run initialized before its Task reservation committed", { timeout: 60000 }, async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-task-uncommitted-run-recovery-"));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTaskCreationUseCases(await import(`../infrastructure/file-project-store.mjs?uncommitted-recovery=${Date.now()}-${Math.random()}`));
  let server;
  let output = "";

  try {
    const teamDraft = await store.createProject({ name: "Uncommitted Recovery Team", overview: "Fixture for pre-commit Run recovery.", templateId: "empty" });
    const team = await store.confirmProjectTeam(teamDraft.projectId, { release: true });
    const project = await store.createCollaborationProject({ name: "Uncommitted Recovery Project", overview: "Task reservation remains uncommitted.", teamVersionIds: [team.teamVersionId] });
    const task = await store.createProjectTask(project.projectId, { input: "Start after orphan cleanup.", teamVersionId: team.teamVersionId });
    const orphanRunId = "orphan-precommit-run";
    const orphanRunDir = join(team.workdir, ".ogs", "runs", orphanRunId);
    await mkdir(join(orphanRunDir, "control"), { recursive: true });
    await writeJsonAtomic(join(orphanRunDir, "control", "state.json"), {
      version: 1,
      runId: orphanRunId,
      attemptNumber: 1,
      status: "planning",
      taskReservation: { kind: "task-attempt", collaborationProjectId: project.projectId, taskId: task.taskId, runId: orphanRunId, attemptKey: "crashed-before-commit" },
      control: { paused: false, cancelRequested: false },
      nodes: {},
      attempts: [],
      reviews: [],
      updatedAt: new Date().toISOString()
    });

    const startServer = async () => {
      output = "";
      server = spawn(process.execPath, ["server.mjs"], {
        cwd: appRoot,
        env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      server.stdout.on("data", (chunk) => { output += chunk.toString(); });
      server.stderr.on("data", (chunk) => { output += chunk.toString(); });
      return waitForServer(server, () => output);
    };

    let baseUrl = await startServer();
    const taskResponse = await fetch(`${baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}`);
    assert.equal(taskResponse.status, 200);
    const recoveredTask = await taskResponse.json();
    assert.equal(recoveredTask.status, "queued");
    assert.equal(recoveredTask.currentRunId, null);
    assert.deepEqual(recoveredTask.runIds, []);
    await assert.rejects(access(orphanRunDir), { code: "ENOENT" });

    await stopServer(server);
    server = undefined;
    baseUrl = await startServer();
    const secondRead = await fetch(`${baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}`);
    assert.equal(secondRead.status, 200);
    assert.equal((await secondRead.json()).status, "queued");
    await assert.rejects(access(orphanRunDir), { code: "ENOENT" });

    const startResponse = await fetch(`${baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}/start`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "dry-run", idempotencyKey: "start-after-orphan-cleanup" })
    });
    assert.equal(startResponse.status, 202);
    const started = await startResponse.json();
    assert.notEqual(started.currentRunId, orphanRunId);
    const finished = await waitForTerminalTask(baseUrl, project.projectId, task.taskId);
    assert.equal(finished.status, "completed", finished.lastError || "Task should run after orphan cleanup.");
  } finally {
    await stopServer(server);
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
