import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { withTaskCreationUseCases } from "./task-creation-test-helpers.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function recordRecoveryEvidence(scenario, evidence) {
  if (process.env.OGS_CAPTURE_RECOVERY_EVIDENCE === "1") {
    process.stdout.write(`UAT_RECOVERY_EVIDENCE ${JSON.stringify({ scenario, ...evidence })}\n`);
  }
}

const activeRunHoldPreload = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const originalRename = fs.promises.rename.bind(fs.promises);
const markerPath = process.env.OGS_TEST_ACTIVE_RUN_MARKER;
let held = false;
fs.promises.rename = async (source, target, ...args) => {
  const targetPath = String(target);
  if (!held && markerPath && /[\\/]control[\\/]state\\.json$/.test(targetPath)) {
    let state;
    try { state = JSON.parse(fs.readFileSync(String(source), "utf8")); } catch { state = undefined; }
    const result = await originalRename(source, target, ...args);
    if (state?.status === "running") {
      held = true;
      fs.writeFileSync(markerPath, JSON.stringify({ runId: state.runId, status: state.status }));
      await new Promise(() => {});
    }
    return result;
  }
  return originalRename(source, target, ...args);
};
syncBuiltinESMExports();
`;
const renameFaultPreload = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const originalRename = fs.promises.rename.bind(fs.promises);
let remaining = Number(process.env.OGS_TEST_CONTROL_RENAME_FAULT_COUNT || 0);
fs.promises.rename = async (source, target, ...args) => {
  if (remaining > 0 && /[\\/]control[\\/]requests[\\/]/.test(String(target))) {
    remaining -= 1;
    const error = new Error("Injected control request write failure.");
    error.code = "EIO";
    throw error;
  }
  return originalRename(source, target, ...args);
};
syncBuiltinESMExports();
`;

async function writeJsonAtomic(path, value) {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
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

async function spawnServer(projectsRoot, { preloadPath, controlWriteFault = false, activeRunMarker } = {}) {
  let output = "";
  const args = [...(preloadPath ? ["--import", preloadPath] : []), "server.mjs"];
  const server = spawn(process.execPath, args, {
    cwd: appRoot,
    env: {
      ...process.env,
      PORT: "0",
      OGS_SITE_PROJECTS_DIR: projectsRoot,
      OGS_PLATFORM_CONFIG_DIR: projectsRoot,
      OGS_TEST_CONTROL_RENAME_FAULT_COUNT: controlWriteFault ? "1" : "0",
      OGS_TEST_ACTIVE_RUN_MARKER: activeRunMarker || ""
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  return { server, baseUrl: await waitForServer(server, () => output), getOutput: () => output };
}

async function stopServer(server) {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  server.kill("SIGTERM");
  await once(server, "exit");
}

async function waitForFile(path, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try { return await readFile(path, "utf8"); } catch { await new Promise((resolveWait) => setTimeout(resolveWait, 10)); }
  }
  throw new Error(`Timed out waiting for file: ${path}`);
}

async function createFixture(projectsRoot, label) {
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  let repository;
  try {
    repository = await import(`../infrastructure/file-project-store.mjs?control-recovery=${Date.now()}-${Math.random()}`);
  } finally {
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
  }
  const store = withTaskCreationUseCases(repository);
  const teamDraft = await store.createProject({
    name: `${label} Team`,
    overview: "Durable fixture for Task Run failure and restart recovery boundaries.",
    templateId: "empty"
  });
  const team = await store.confirmProjectTeam(teamDraft.projectId, { release: true });
  const project = await store.createCollaborationProject({
    name: `${label} Project`,
    overview: "Validate durable Task and Run projections through the public API.",
    teamVersionIds: [team.teamVersionId]
  });
  const task = await store.createProjectTask(project.projectId, {
    input: "Create a durable Run that can be inspected after restart.",
    teamVersionId: team.teamVersionId
  });
  return { store, project, task, team };
}

async function startTask(baseUrl, projectId, taskId, key) {
  const response = await fetch(`${baseUrl}/api/v1/projects/${projectId}/tasks/${taskId}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "dry-run", idempotencyKey: key })
  });
  const payload = await response.json();
  assert.equal(response.status, 202, JSON.stringify(payload));
  return payload.task || payload;
}

async function waitForCompletedTask(baseUrl, projectId, taskId) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/v1/projects/${projectId}/tasks/${taskId}`);
    assert.equal(response.status, 200);
    const task = await response.json();
    if (task.status === "completed") return task;
    if (task.status === "failed") throw new Error(task.lastError || "Fixture Task failed.");
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Task did not complete: ${projectId}/${taskId}`);
}

async function retryTask(baseUrl, projectId, taskId, key) {
  const response = await fetch(`${baseUrl}/api/v1/projects/${projectId}/tasks/${taskId}/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "dry-run", idempotencyKey: key })
  });
  const payload = await response.json();
  assert.equal(response.status, 202, JSON.stringify(payload));
  return payload;
}

async function forceTaskActiveSnapshot(project, task, team, runId) {
  const runStatePath = join(team.workdir, ".ogs", "runs", runId, "control", "state.json");
  const runState = JSON.parse(await readFile(runStatePath, "utf8"));
  const projectPath = join(project.workdir, ".site", "project.json");
  const metadata = JSON.parse(await readFile(projectPath, "utf8"));
  metadata.taskRecords = metadata.taskRecords.map((record) => record.taskId === task.taskId
    ? { ...record, status: "running", currentRunId: runId, runIds: [runId], runProjectId: team.teamVersionId, lastError: null, completedAt: null }
    : record);
  await Promise.all([
    writeJsonAtomic(runStatePath, { ...runState, status: "running", error: undefined, finishedAt: undefined, updatedAt: new Date().toISOString() }),
    writeJsonAtomic(projectPath, metadata)
  ]);
  return { runId, runStatePath, projectPath };
}

test("Task control write failure leaves control and Run projections unchanged until a successful request", { timeout: 90000 }, async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "ogs-task-control-write-boundary-"));
  const projectsRoot = join(testRoot, "projects");
  const preloadPath = join(testRoot, "rename-fault.mjs");
  await writeFile(preloadPath, renameFaultPreload, "utf8");
  const { project, task, team } = await createFixture(projectsRoot, "Control Failure");
  let running;

  try {
    running = await spawnServer(projectsRoot, { preloadPath, controlWriteFault: true });
    await startTask(running.baseUrl, project.projectId, task.taskId, "control-fault-start");
    const terminal = await waitForCompletedTask(running.baseUrl, project.projectId, task.taskId);
    const { runId, runStatePath } = await forceTaskActiveSnapshot(project, task, team, terminal.currentRunId);
    assert.ok(runId);
    const controlDir = join(team.workdir, ".ogs", "runs", runId, "control", "requests");
    const controlUrl = `${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}/pause`;
    const failedResponse = await fetch(controlUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const failedPayload = await failedResponse.json();
    assert.equal(failedResponse.status, 400, JSON.stringify(failedPayload));
    assert.match(failedPayload.error, /Injected control request write failure/);

    const failedStateOnDisk = JSON.parse(await readFile(runStatePath, "utf8"));
    assert.equal(failedStateOnDisk.status, "running");
    assert.deepEqual((await readdir(controlDir).catch(() => [])).filter((name) => name.endsWith(".json")), []);
    const runUrl = `${running.baseUrl}/api/v1/projects/${project.projectId}/runs/${runId}`;
    const firstRunRead = await fetch(runUrl).then((response) => response.json());
    const secondRunRead = await fetch(runUrl).then((response) => response.json());
    assert.equal(firstRunRead.state.status, "running");
    assert.deepEqual(secondRunRead.state, firstRunRead.state);
    const firstTaskRead = await fetch(`${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}`).then((response) => response.json());
    const secondTaskRead = await fetch(`${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}`).then((response) => response.json());
    assert.equal(firstTaskRead.status, "running");
    assert.deepEqual(secondTaskRead, firstTaskRead);

    const successResponse = await fetch(controlUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(successResponse.status, 200);
    const controlledTask = await successResponse.json();
    assert.equal(controlledTask.status, "pause_requested");
    const successfulState = JSON.parse(await readFile(runStatePath, "utf8"));
    assert.equal(successfulState.status, "pause_requested");
    const requests = (await readdir(controlDir)).filter((name) => name.endsWith(".json"));
    assert.equal(requests.length, 1);
    assert.equal(JSON.parse(await readFile(join(controlDir, requests[0]), "utf8")).action, "pause");
    recordRecoveryEvidence("control request write failure", {
      projectId: project.projectId,
      taskId: task.taskId,
      runId,
      taskStateAfterFailure: firstTaskRead.status,
      runStateOnDiskAfterFailure: failedStateOnDisk.status,
      runStateApiAfterFailure: firstRunRead.state.status,
      committedControlRequestsAfterFailure: 0,
      retryControlState: controlledTask.status,
      committedControlRequestsAfterRecovery: requests.length
    });
  } finally {
    await stopServer(running?.server);
    await rm(testRoot, { recursive: true, force: true });
    await assert.rejects(readFile(testRoot), { code: "ENOENT" });
  }
});

test("startup recovery repairs missing Run state and stale Task projection, then supports retry and repeat recovery", { timeout: 120000 }, async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "ogs-task-run-recovery-boundaries-"));
  const projectsRoot = join(testRoot, "projects");
  const first = await createFixture(projectsRoot, "Missing State");
  const second = await createFixture(projectsRoot, "Stale Projection");
  let running;

  try {
    running = await spawnServer(projectsRoot);
    const missingStart = await startTask(running.baseUrl, first.project.projectId, first.task.taskId, "missing-state-start");
    const staleStart = await startTask(running.baseUrl, second.project.projectId, second.task.taskId, "stale-projection-start");
    const missingTerminal = await waitForCompletedTask(running.baseUrl, first.project.projectId, first.task.taskId);
    const staleTerminal = await waitForCompletedTask(running.baseUrl, second.project.projectId, second.task.taskId);
    assert.equal(missingStart.taskId, first.task.taskId);
    assert.equal(staleStart.taskId, second.task.taskId);

    const missingRunId = missingTerminal.currentRunId;
    const missingRunStatePath = join(first.team.workdir, ".ogs", "runs", missingRunId, "control", "state.json");
    const missingProjectPath = join(first.project.workdir, ".site", "project.json");
    const missingMetadata = JSON.parse(await readFile(missingProjectPath, "utf8"));
    missingMetadata.taskRecords = missingMetadata.taskRecords.map((record) => record.taskId === first.task.taskId
      ? { ...record, status: "running", currentRunId: missingRunId, runIds: [missingRunId], runProjectId: first.team.teamVersionId, lastError: null, completedAt: null }
      : record);
    await writeJsonAtomic(missingProjectPath, missingMetadata);
    await unlink(missingRunStatePath);

    const staleRunId = staleTerminal.currentRunId;
    const staleRunStatePath = join(second.team.workdir, ".ogs", "runs", staleRunId, "control", "state.json");
    const staleRunState = JSON.parse(await readFile(staleRunStatePath, "utf8"));
    const staleProjectPath = join(second.project.workdir, ".site", "project.json");
    const staleMetadata = JSON.parse(await readFile(staleProjectPath, "utf8"));
    staleMetadata.taskRecords = staleMetadata.taskRecords.map((record) => record.taskId === second.task.taskId
      ? { ...record, status: "completed", currentRunId: staleRunId, runIds: [staleRunId], runProjectId: second.team.teamVersionId, lastError: null }
      : record);
    await Promise.all([
      writeJsonAtomic(staleRunStatePath, { ...staleRunState, status: "running", error: undefined, finishedAt: undefined, updatedAt: new Date().toISOString() }),
      writeJsonAtomic(staleProjectPath, staleMetadata)
    ]);

    await stopServer(running.server);
    running = await spawnServer(projectsRoot);

    const missingTask = await fetch(`${running.baseUrl}/api/v1/projects/${first.project.projectId}/tasks/${first.task.taskId}`).then((response) => response.json());
    assert.equal(missingTask.status, "failed");
    assert.equal(missingTask.currentRunId, missingRunId);
    assert.deepEqual(missingTask.runIds, [missingRunId]);
    assert.match(missingTask.lastError, /RUN_STATE_MISSING/);
    assert.equal(JSON.parse(await readFile(missingProjectPath, "utf8")).taskRecords.find((record) => record.taskId === first.task.taskId).lastError, missingTask.lastError);
    const missingRunResponse = await fetch(`${running.baseUrl}/api/v1/projects/${first.project.projectId}/runs/${missingRunId}`);
    assert.notEqual(missingRunResponse.status, 200, "Run without durable state must not be exposed as a valid Run");

    const staleTask = await fetch(`${running.baseUrl}/api/v1/projects/${second.project.projectId}/tasks/${second.task.taskId}`).then((response) => response.json());
    assert.equal(staleTask.status, "failed");
    assert.equal(staleTask.currentRunId, staleRunId);
    assert.deepEqual(staleTask.runIds, [staleRunId]);
    assert.match(staleTask.lastError, /RUNNER_RESTARTED/);
    const staleRun = await fetch(`${running.baseUrl}/api/v1/projects/${second.project.projectId}/runs/${staleRunId}`).then((response) => response.json());
    assert.equal(staleRun.state.status, "failed");
    assert.match(staleRun.state.error, /RUNNER_RESTARTED/);
    assert.deepEqual(JSON.parse(await readFile(staleRunStatePath, "utf8")), staleRun.state);

    const missingRetry = await retryTask(running.baseUrl, first.project.projectId, first.task.taskId, "missing-state-retry");
    assert.notEqual(missingRetry.currentRunId, missingRunId);
    const staleRetry = await retryTask(running.baseUrl, second.project.projectId, second.task.taskId, "stale-projection-retry");
    assert.notEqual(staleRetry.currentRunId, staleRunId);
    const missingAfterRetry = await waitForCompletedTask(running.baseUrl, first.project.projectId, first.task.taskId);
    const staleAfterRetry = await waitForCompletedTask(running.baseUrl, second.project.projectId, second.task.taskId);
    assert.deepEqual(missingAfterRetry.runIds, [missingRunId, missingAfterRetry.currentRunId]);
    assert.deepEqual(staleAfterRetry.runIds, [staleRunId, staleAfterRetry.currentRunId]);

    const missingMetadataAfterRetry = await readFile(missingProjectPath, "utf8");
    const staleMetadataAfterRetry = await readFile(staleProjectPath, "utf8");
    const missingRunAfterRetry = await readFile(join(first.team.workdir, ".ogs", "runs", missingAfterRetry.currentRunId, "control", "state.json"), "utf8");
    const staleRunAfterRetry = await readFile(join(second.team.workdir, ".ogs", "runs", staleAfterRetry.currentRunId, "control", "state.json"), "utf8");
    await stopServer(running.server);
    running = await spawnServer(projectsRoot);
    assert.equal(await readFile(missingProjectPath, "utf8"), missingMetadataAfterRetry);
    assert.equal(await readFile(staleProjectPath, "utf8"), staleMetadataAfterRetry);
    assert.equal(await readFile(join(first.team.workdir, ".ogs", "runs", missingAfterRetry.currentRunId, "control", "state.json"), "utf8"), missingRunAfterRetry);
    assert.equal(await readFile(join(second.team.workdir, ".ogs", "runs", staleAfterRetry.currentRunId, "control", "state.json"), "utf8"), staleRunAfterRetry);
    recordRecoveryEvidence("missing Run state and stale Task projection", {
      missingProjectId: first.project.projectId,
      missingTaskId: first.task.taskId,
      missingRunId,
      missingTaskStateAfterRecovery: missingTask.status,
      missingRunApiStatus: missingRunResponse.status,
      missingRetryRunId: missingAfterRetry.currentRunId,
      staleProjectId: second.project.projectId,
      staleTaskId: second.task.taskId,
      staleRunId,
      staleTaskStateAfterRecovery: staleTask.status,
      staleRunStateAfterRecovery: staleRun.state.status,
      staleRetryRunId: staleAfterRetry.currentRunId,
      repeatRecoveryByteStable: true
    });
  } finally {
    await stopServer(running?.server);
    await rm(testRoot, { recursive: true, force: true });
    await assert.rejects(readFile(testRoot), { code: "ENOENT" });
  }
});

test("process termination during a live Run is recovered from durable state, queryable, retryable, and idempotent", { timeout: 180000 }, async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "ogs-live-process-run-recovery-"));
  const projectsRoot = join(testRoot, "projects");
  const preloadPath = join(testRoot, "hold-active-run.mjs");
  const activeRunMarker = join(testRoot, "active-run.json");
  await writeFile(preloadPath, activeRunHoldPreload, "utf8");
  const { project, task, team } = await createFixture(projectsRoot, "Live Process Recovery");
  let running;

  try {
    running = await spawnServer(projectsRoot, { preloadPath, activeRunMarker });
    const reservation = await startTask(running.baseUrl, project.projectId, task.taskId, "live-process-recovery-start");
    assert.equal(reservation.taskId, task.taskId);
    const marker = JSON.parse(await waitForFile(activeRunMarker));
    const runId = marker.runId;
    assert.equal(marker.status, "running");

    const runStatePath = join(team.workdir, ".ogs", "runs", runId, "control", "state.json");
    const projectPath = join(project.workdir, ".site", "project.json");
    const activeRunStateText = await readFile(runStatePath, "utf8");
    const activeRunState = JSON.parse(activeRunStateText);
    const activeProjectText = await readFile(projectPath, "utf8");
    const activeProject = JSON.parse(activeProjectText);
    const activeTaskOnDisk = activeProject.taskRecords.find((record) => record.taskId === task.taskId);
    assert.equal(activeRunState.status, "running");
    assert.equal(activeTaskOnDisk.currentRunId, runId);
    assert.deepEqual(activeTaskOnDisk.runIds, [runId]);
    assert.equal(activeTaskOnDisk.status, "planning");

    const taskUrl = `${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}`;
    const runUrl = `${running.baseUrl}/api/v1/projects/${project.projectId}/runs/${runId}`;
    const eventsUrl = `${runUrl}/events`;
    const activeTaskResponse = await fetch(taskUrl);
    assert.equal(activeTaskResponse.status, 200);
    const activeTask = await activeTaskResponse.json();
    assert.equal(activeTask.currentRunId, runId);
    assert.deepEqual(activeTask.runIds, [runId]);
    assert.equal(activeTask.status, "running");
    const activeRunResponse = await fetch(runUrl);
    assert.equal(activeRunResponse.status, 200);
    const activeRun = await activeRunResponse.json();
    assert.equal(activeRun.taskId, task.taskId);
    assert.equal(activeRun.state.status, "running");
    assert.equal(activeRun.isCurrent, true);
    const activeEventsResponse = await fetch(eventsUrl);
    assert.equal(activeEventsResponse.status, 200);
    const activeEvents = await activeEventsResponse.json();
    assert.equal(activeEvents.taskId, task.taskId);
    assert.equal(activeEvents.runId, runId);

    running.server.kill("SIGKILL");
    await once(running.server, "exit");
    running = undefined;
    await new Promise((resolveWait) => setTimeout(resolveWait, 31000));

    running = await spawnServer(projectsRoot);
    const recoveredTaskResponse = await fetch(taskUrl.replace(/http:\/\/127\.0\.0\.1:\d+/, running.baseUrl));
    assert.equal(recoveredTaskResponse.status, 200);
    const recoveredTask = await recoveredTaskResponse.json();
    assert.equal(recoveredTask.status, "failed");
    assert.equal(recoveredTask.currentRunId, runId);
    assert.deepEqual(recoveredTask.runIds, [runId]);
    assert.match(recoveredTask.lastError, /RUNNER_RESTARTED/);
    const recoveredTaskOnDisk = JSON.parse(await readFile(projectPath, "utf8")).taskRecords.find((record) => record.taskId === task.taskId);
    assert.equal(recoveredTaskOnDisk.status, "failed");
    assert.equal(recoveredTaskOnDisk.currentRunId, runId);
    assert.deepEqual(recoveredTaskOnDisk.runIds, [runId]);
    assert.equal(recoveredTaskOnDisk.lastError, recoveredTask.lastError);

    const recoveredRunUrl = `${running.baseUrl}/api/v1/projects/${project.projectId}/runs/${runId}`;
    const recoveredRunResponse = await fetch(recoveredRunUrl);
    assert.equal(recoveredRunResponse.status, 200);
    const failedRun = await recoveredRunResponse.json();
    assert.equal(failedRun.taskId, task.taskId);
    assert.equal(failedRun.runId, runId);
    assert.equal(failedRun.isCurrent, true);
    assert.equal(failedRun.state.status, "failed");
    assert.match(failedRun.state.error, /RUNNER_RESTARTED/);
    const recoveredEventsResponse = await fetch(`${recoveredRunUrl}/events`);
    assert.equal(recoveredEventsResponse.status, 200);
    const recoveredEvents = await recoveredEventsResponse.json();
    assert.equal(recoveredEvents.taskId, task.taskId);
    assert.equal(recoveredEvents.runId, runId);
    const recoveredRunStateText = await readFile(runStatePath, "utf8");
    assert.deepEqual(JSON.parse(recoveredRunStateText), failedRun.state);

    const retryReservation = await retryTask(running.baseUrl, project.projectId, task.taskId, "live-process-recovery-retry");
    assert.notEqual(retryReservation.currentRunId, runId);
    const completedTask = await waitForCompletedTask(running.baseUrl, project.projectId, task.taskId);
    assert.deepEqual(completedTask.runIds, [runId, completedTask.currentRunId]);
    const oldRunAfterRetry = await fetch(recoveredRunUrl).then((response) => response.json());
    assert.deepEqual(oldRunAfterRetry.state, failedRun.state);
    const projectAfterRetry = await readFile(projectPath, "utf8");
    const oldRunAfterRetryText = await readFile(runStatePath, "utf8");
    const newRunStatePath = join(team.workdir, ".ogs", "runs", completedTask.currentRunId, "control", "state.json");
    const newRunAfterRetryText = await readFile(newRunStatePath, "utf8");

    await stopServer(running.server);
    running = await spawnServer(projectsRoot);
    assert.equal(await readFile(projectPath, "utf8"), projectAfterRetry);
    assert.equal(await readFile(runStatePath, "utf8"), oldRunAfterRetryText);
    assert.equal(await readFile(newRunStatePath, "utf8"), newRunAfterRetryText);
    const taskAfterRepeatedRecovery = await fetch(`${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}`).then((response) => response.json());
    assert.equal(taskAfterRepeatedRecovery.status, "completed");
    assert.deepEqual(taskAfterRepeatedRecovery.runIds, [runId, completedTask.currentRunId]);
    recordRecoveryEvidence("live Run process termination", {
      projectId: project.projectId,
      taskId: task.taskId,
      failedRunId: runId,
      retryRunId: completedTask.currentRunId,
      taskStateBeforeTermination: activeTask.status,
      runStateBeforeTermination: activeRun.state.status,
      taskStateAfterRecovery: recoveredTask.status,
      runStateAfterRecovery: failedRun.state.status,
      retryTaskState: completedTask.status,
      oldRunUnchanged: oldRunAfterRetry.state.status === failedRun.state.status,
      repeatRecoveryByteStable: true
    });
  } finally {
    await stopServer(running?.server);
    await rm(testRoot, { recursive: true, force: true });
    await assert.rejects(readFile(testRoot), { code: "ENOENT" });
  }
});
