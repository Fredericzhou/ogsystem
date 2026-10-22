import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { withTaskCreationUseCases } from "./task-creation-test-helpers.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const forceRuntimeError = "OGSYSTEM_TEST_FORCE_RUNTIME_ERROR_AFTER_SETUP";

function recordRecoveryEvidence(scenario, evidence) {
  if (process.env.OGS_CAPTURE_RECOVERY_EVIDENCE === "1") {
    process.stdout.write(`UAT_RECOVERY_EVIDENCE ${JSON.stringify({ scenario, ...evidence })}\n`);
  }
}

const renameFaultPreload = `
import fs from "node:fs";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";

const originalRename = fs.promises.rename.bind(fs.promises);
let remaining = Number(process.env.OGS_TEST_RENAME_FAULT_COUNT || 0);
const targetSuffix = process.env.OGS_TEST_RENAME_FAULT_SUFFIX || "";
const taskId = process.env.OGS_TEST_RENAME_FAULT_TASK_ID || "";
const taskStatus = process.env.OGS_TEST_RENAME_FAULT_TASK_STATUS || "";

fs.promises.rename = async (source, target, ...args) => {
  const targetPath = resolve(String(target)).replaceAll("\\\\", "/");
  const normalizedSuffix = targetSuffix.replaceAll("\\\\", "/");
  let shouldFail = remaining > 0 && normalizedSuffix && targetPath.endsWith(normalizedSuffix);
  if (shouldFail && taskId) {
    try {
      const metadata = JSON.parse(readFileSync(String(source), "utf8"));
      shouldFail = metadata.taskRecords?.some((task) => task.taskId === taskId && task.status === taskStatus && task.currentRunId);
    } catch {
      shouldFail = false;
    }
  }
  if (shouldFail) {
    remaining -= 1;
    const error = new Error("Injected one-shot filesystem rename failure.");
    error.code = "EIO";
    throw error;
  }
  return originalRename(source, target, ...args);
};
syncBuiltinESMExports();
`;

async function waitForServer(server, getOutput) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45000) {
    const baseUrl = getOutput().match(/ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    if (baseUrl) return baseUrl;
    if (server.exitCode !== null) throw new Error(`Team Site server exited before readiness: ${getOutput()}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  server.kill("SIGTERM");
  throw new Error(`Team Site server did not become ready within 45 seconds: ${getOutput()}`);
}

async function spawnServer({ projectsRoot, platformConfigRoot = projectsRoot, preloadPath, fault = {}, runtimeFailure = false }) {
  let output = "";
  const server = spawn(process.execPath, ["--import", pathToFileURL(preloadPath).href, "server.mjs"], {
    cwd: appRoot,
    env: {
      ...process.env,
      PORT: "0",
      OGS_SITE_PROJECTS_DIR: projectsRoot,
      OGS_PLATFORM_CONFIG_DIR: platformConfigRoot,
      [forceRuntimeError]: runtimeFailure ? "1" : "",
      OGS_TEST_RENAME_FAULT_COUNT: String(fault.count || 0),
      OGS_TEST_RENAME_FAULT_SUFFIX: fault.suffix || "",
      OGS_TEST_RENAME_FAULT_TASK_ID: fault.taskId || "",
      OGS_TEST_RENAME_FAULT_TASK_STATUS: fault.taskStatus || ""
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const baseUrl = await waitForServer(server, () => output);
  return { server, baseUrl, getOutput: () => output };
}

async function stopServer(server) {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  server.kill("SIGTERM");
  await once(server, "exit");
}

async function waitForTask(baseUrl, projectId, taskId, predicate) {
  let latestTask;
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/v1/projects/${projectId}/tasks/${taskId}`);
    assert.equal(response.status, 200);
    const task = await response.json();
    latestTask = task;
    if (predicate(task)) return task;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Task did not reach the expected state: ${projectId}/${taskId}; last Task: ${JSON.stringify(latestTask)}`);
}

async function waitForRun(baseUrl, projectId, taskId, runId, predicate) {
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/v1/projects/${projectId}/tasks/${taskId}/runs/${runId}`);
    if (response.status === 200) {
      const run = await response.json();
      if (predicate(run)) return run;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Run did not reach the expected state: ${projectId}/${runId}`);
}

async function createTaskFixture(projectsRoot) {
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  let repository;
  try {
    repository = await import(`../infrastructure/file-project-store.mjs?recovery-faults=${Date.now()}-${Math.random()}`);
  } finally {
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
  }
  const store = withTaskCreationUseCases(repository);
  const teamDraft = await store.createProject({
    name: "Recovery Fault Team",
    overview: "Exercise durable Task Run recovery after file-operation failures.",
    templateId: "empty"
  });
  const team = await store.confirmProjectTeam(teamDraft.projectId, { release: true });
  const project = await store.createCollaborationProject({
    name: "Recovery Fault Project",
    overview: "Recover a Task projection from its durable Run state.",
    teamVersionIds: [team.teamVersionId]
  });
  const task = await store.createProjectTask(project.projectId, {
    input: "Create a durable Run that can be inspected and retried after recovery.",
    teamVersionId: team.teamVersionId
  });
  return { project, task, team };
}

async function startTask(baseUrl, projectId, taskId, idempotencyKey) {
  const response = await fetch(`${baseUrl}/api/v1/projects/${projectId}/tasks/${taskId}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "dry-run", idempotencyKey })
  });
  const payload = await response.json();
  assert.equal(response.status, 202, JSON.stringify(payload));
  assert.ok(payload.task?.currentRunId, JSON.stringify(payload));
  return payload.task;
}

async function retryTask(baseUrl, projectId, taskId, idempotencyKey) {
  const response = await fetch(`${baseUrl}/api/v1/projects/${projectId}/tasks/${taskId}/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "dry-run", idempotencyKey })
  });
  const payload = await response.json();
  assert.equal(response.status, 202, JSON.stringify(payload));
  return payload;
}

test("Task Run plan creation failure is persisted, queryable, and safely retryable", { timeout: 90000 }, async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "ogs-task-run-plan-fault-"));
  const projectsRoot = join(testRoot, "projects");
  const preloadPath = join(testRoot, "rename-fault.mjs");
  await writeFile(preloadPath, renameFaultPreload, "utf8");
  const { project, task, team } = await createTaskFixture(projectsRoot);
  let running;

  try {
    running = await spawnServer({ projectsRoot, preloadPath, fault: { suffix: "run-plan.json", count: 1 } });
    const initial = await startTask(running.baseUrl, project.projectId, task.taskId, "plan-write-fault-start");
    const failedTask = await waitForTask(running.baseUrl, project.projectId, task.taskId, (value) => value.status === "failed");
    assert.equal(failedTask.currentRunId, initial.currentRunId);
    assert.deepEqual(failedTask.runIds, [initial.currentRunId]);
    assert.match(failedTask.lastError, /Injected one-shot filesystem rename failure/);

    const runPath = `${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}/runs/${initial.currentRunId}`;
    const failedRunResponse = await fetch(runPath);
    assert.equal(failedRunResponse.status, 200);
    const failedRun = await failedRunResponse.json();
    assert.equal(failedRun.taskId, task.taskId);
    assert.equal(failedRun.state.status, "failed");
    assert.match(failedRun.state.error, /Injected one-shot filesystem rename failure/);
    assert.equal(failedRun.plan, null);
    const runDir = join(projectsRoot, project.projectId, ".ogs", "runs", initial.currentRunId);
    const durableFailedState = JSON.parse(await readFile(join(runDir, "control", "state.json"), "utf8"));
    assert.deepEqual(durableFailedState, failedRun.state);

    const retried = await retryTask(running.baseUrl, project.projectId, task.taskId, "plan-write-fault-retry");
    assert.equal(retried.taskId, task.taskId);
    assert.notEqual(retried.currentRunId, initial.currentRunId);
    const completedTask = await waitForTask(running.baseUrl, project.projectId, task.taskId, (value) => value.status === "completed");
    assert.deepEqual(completedTask.runIds, [initial.currentRunId, completedTask.currentRunId]);
    const oldRunAfterRetry = await fetch(runPath).then((response) => response.json());
    assert.deepEqual(oldRunAfterRetry.state, durableFailedState);
    const retriedRun = await waitForRun(running.baseUrl, project.projectId, task.taskId, completedTask.currentRunId, (value) => value.state.status === "completed");
    assert.equal(retriedRun.taskId, task.taskId);
    recordRecoveryEvidence("plan creation failure", {
      projectId: project.projectId,
      taskId: task.taskId,
      failedRunId: initial.currentRunId,
      retryRunId: completedTask.currentRunId,
      diskRunState: durableFailedState.status,
      apiRunState: failedRun.state.status,
      retryTaskState: completedTask.status,
      oldRunUnchanged: true,
      tempRootCleaned: true
    });
  } finally {
    await stopServer(running?.server);
    await rm(testRoot, { recursive: true, force: true });
    await assert.rejects(readFile(testRoot), { code: "ENOENT" });
  }
});

test("Task Run reservation write failure leaves no Run artifacts and permits a later start", { timeout: 90000 }, async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "ogs-task-run-reservation-fault-"));
  const projectsRoot = join(testRoot, "projects");
  const preloadPath = join(testRoot, "rename-fault.mjs");
  await writeFile(preloadPath, renameFaultPreload, "utf8");
  const { project, task, team } = await createTaskFixture(projectsRoot);
  let running;

  try {
    running = await spawnServer({
      projectsRoot,
      preloadPath,
      fault: { suffix: "project.json", count: 1, taskId: task.taskId, taskStatus: "planning" }
    });
    const startPath = `${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}/start`;
    const failedResponse = await fetch(startPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "dry-run", idempotencyKey: "reservation-write-fault" })
    });
    const failure = await failedResponse.json();
    assert.notEqual(failedResponse.status, 202, JSON.stringify(failure));
    assert.match(failure.error, /Injected one-shot filesystem rename failure/);

    const taskResponse = await fetch(`${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}`);
    assert.equal(taskResponse.status, 200);
    const taskAfterFailure = await taskResponse.json();
    assert.equal(taskAfterFailure.status, "queued");
    assert.equal(taskAfterFailure.currentRunId, null);
    assert.deepEqual(taskAfterFailure.runIds, []);

    const metadataPath = join(project.workdir, ".site", "project.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    const storedTask = metadata.taskRecords.find((record) => record.taskId === task.taskId);
    assert.equal(storedTask.status, "queued");
    assert.equal(storedTask.currentRunId, null);
    assert.deepEqual(storedTask.runIds, []);

    const runDirectories = await readdir(join(team.workdir, ".ogs", "runs"), { withFileTypes: true }).catch(() => []);
    assert.deepEqual(runDirectories.filter((entry) => entry.isDirectory()).map((entry) => entry.name), []);

    const started = await startTask(running.baseUrl, project.projectId, task.taskId, "reservation-write-fault-retry-start");
    assert.equal(started.taskId, task.taskId);
    assert.ok(started.currentRunId);
    const completedTask = await waitForTask(running.baseUrl, project.projectId, task.taskId, (value) => value.status === "completed");
    assert.equal(completedTask.currentRunId, started.currentRunId);
    assert.deepEqual(completedTask.runIds, [started.currentRunId]);
    const run = await waitForRun(running.baseUrl, project.projectId, task.taskId, started.currentRunId, (value) => value.state.status === "completed");
    assert.equal(run.taskId, task.taskId);
    recordRecoveryEvidence("Task Run reservation write failure", {
      projectId: project.projectId,
      taskId: task.taskId,
      retryRunId: completedTask.currentRunId,
      taskStateAfterFailure: "queued",
      runIdsAfterFailure: [],
      taskStateAfterRetry: completedTask.status,
      tempRootCleaned: true
    });
  } finally {
    await stopServer(running?.server);
    await rm(testRoot, { recursive: true, force: true });
    await assert.rejects(readFile(testRoot), { code: "ENOENT" });
  }
});

test("partial Run state initialization failure removes the reserved directory", { timeout: 90000 }, async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "ogs-task-run-state-init-fault-"));
  const projectsRoot = join(testRoot, "projects");
  const preloadPath = join(testRoot, "rename-fault.mjs");
  await writeFile(preloadPath, renameFaultPreload, "utf8");
  const { project, task, team } = await createTaskFixture(projectsRoot);
  let running;

  try {
    running = await spawnServer({ projectsRoot, preloadPath, fault: { suffix: "control/state.json", count: 1 } });
    const startPath = `${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}/start`;
    const failedResponse = await fetch(startPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "dry-run", idempotencyKey: "run-state-init-fault" })
    });
    const failure = await failedResponse.json();
    assert.notEqual(failedResponse.status, 202, JSON.stringify(failure));
    assert.match(failure.error, /Injected one-shot filesystem rename failure/);

    const taskAfterFailure = await fetch(`${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}`).then((response) => response.json());
    assert.equal(taskAfterFailure.status, "queued");
    assert.equal(taskAfterFailure.currentRunId, null);
    assert.deepEqual(taskAfterFailure.runIds, []);
    const runDirectories = await readdir(join(team.workdir, ".ogs", "runs"), { withFileTypes: true }).catch(() => []);
    assert.deepEqual(runDirectories.filter((entry) => entry.isDirectory()).map((entry) => entry.name), []);

    const started = await startTask(running.baseUrl, project.projectId, task.taskId, "run-state-init-retry");
    const completed = await waitForTask(running.baseUrl, project.projectId, task.taskId, (value) => value.status === "completed");
    assert.equal(completed.currentRunId, started.currentRunId);
    assert.deepEqual(completed.runIds, [started.currentRunId]);
  } finally {
    await stopServer(running?.server);
    await rm(testRoot, { recursive: true, force: true });
    await assert.rejects(readFile(testRoot), { code: "ENOENT" });
  }
});

test("recovery repairs a failed Run whose terminal Task projection write failed; retry and repeat recovery are idempotent", { timeout: 120000 }, async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "ogs-task-run-projection-fault-"));
  const projectsRoot = join(testRoot, "projects");
  const preloadPath = join(testRoot, "rename-fault.mjs");
  await writeFile(preloadPath, renameFaultPreload, "utf8");
  const { project, task, team } = await createTaskFixture(projectsRoot);
  let running;

  try {
    running = await spawnServer({
      projectsRoot,
      preloadPath,
      fault: { suffix: "project.json", count: 2, taskId: task.taskId, taskStatus: "failed" },
      runtimeFailure: true
    });
    const initial = await startTask(running.baseUrl, project.projectId, task.taskId, "projection-write-fault-start");
    const failedRun = await waitForRun(running.baseUrl, project.projectId, task.taskId, initial.currentRunId, (value) => value.state.status === "failed");
    assert.equal(failedRun.taskId, task.taskId);
    assert.match(failedRun.state.error, /Forced runtime error after setup/);
    const runStatePath = join(projectsRoot, project.projectId, ".ogs", "runs", initial.currentRunId, "control", "state.json");
    const persistedFailedRun = JSON.parse(await readFile(runStatePath, "utf8"));
    assert.deepEqual(persistedFailedRun, failedRun.state);
    assert.deepEqual(persistedFailedRun.taskReservation, {
      kind: "task-attempt",
      projectId: project.projectId,
      taskId: task.taskId,
      teamVersionId: team.teamVersionId,
      runId: initial.currentRunId
    });
    const staleTaskResponse = await fetch(`${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}`);
    assert.equal(staleTaskResponse.status, 200);
    const staleTask = await staleTaskResponse.json();
    assert.equal(staleTask.status, "failed", running.getOutput());
    assert.equal(staleTask.currentRunId, initial.currentRunId);
    assert.deepEqual(staleTask.runIds, [initial.currentRunId]);
    const metadataPath = join(project.workdir, ".site", "project.json");
    const staleMetadata = JSON.parse(await readFile(metadataPath, "utf8"));
    assert.equal(staleMetadata.taskRecords.find((record) => record.taskId === task.taskId).status, "planning");

    await stopServer(running.server);
    running = await spawnServer({ projectsRoot, preloadPath });
    const recoveredResponse = await fetch(`${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}`);
    assert.equal(recoveredResponse.status, 200);
    const recoveredTask = await recoveredResponse.json();
    assert.equal(recoveredTask.status, "failed");
    assert.equal(recoveredTask.currentRunId, initial.currentRunId);
    assert.deepEqual(recoveredTask.runIds, [initial.currentRunId]);
    assert.match(recoveredTask.lastError, /Forced runtime error after setup/);
    const runAfterRecovery = await fetch(`${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}/runs/${initial.currentRunId}`).then((response) => response.json());
    assert.deepEqual(runAfterRecovery.state, persistedFailedRun);
    const metadataAfterRecovery = await readFile(metadataPath, "utf8");
    const recoveredMetadata = JSON.parse(metadataAfterRecovery);
    assert.equal(recoveredMetadata.taskRecords.find((record) => record.taskId === task.taskId).status, "failed");

    await stopServer(running.server);
    running = await spawnServer({ projectsRoot, preloadPath });
    const repeatedRecoveryTask = await fetch(`${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}`).then((response) => response.json());
    assert.equal(repeatedRecoveryTask.status, "failed");
    assert.deepEqual(await readFile(metadataPath, "utf8"), metadataAfterRecovery);

    const retried = await retryTask(running.baseUrl, project.projectId, task.taskId, "projection-write-fault-retry");
    assert.notEqual(retried.currentRunId, initial.currentRunId);
    const completedTask = await waitForTask(running.baseUrl, project.projectId, task.taskId, (value) => value.status === "completed");
    assert.deepEqual(completedTask.runIds, [initial.currentRunId, completedTask.currentRunId]);
    const oldRunAfterRetry = await fetch(`${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}/runs/${initial.currentRunId}`).then((response) => response.json());
    assert.deepEqual(oldRunAfterRetry.state, persistedFailedRun);
    const retriedRun = await waitForRun(running.baseUrl, project.projectId, task.taskId, completedTask.currentRunId, (value) => value.state.status === "completed");
    assert.equal(retriedRun.taskId, task.taskId);
    recordRecoveryEvidence("terminal Task projection write failure", {
      projectId: project.projectId,
      taskId: task.taskId,
      failedRunId: initial.currentRunId,
      retryRunId: completedTask.currentRunId,
      diskTaskStateBeforeRecovery: staleMetadata.taskRecords.find((record) => record.taskId === task.taskId).status,
      apiTaskStateBeforeRecovery: staleTask.status,
      diskTaskStateAfterRecovery: recoveredMetadata.taskRecords.find((record) => record.taskId === task.taskId).status,
      apiTaskStateAfterRecovery: recoveredTask.status,
      repeatRecoveryByteStable: true,
      retryTaskState: completedTask.status,
      oldRunUnchanged: true,
      tempRootCleaned: true
    });
  } finally {
    await stopServer(running?.server);
    await rm(testRoot, { recursive: true, force: true });
    await assert.rejects(readFile(testRoot), { code: "ENOENT" });
  }
});
