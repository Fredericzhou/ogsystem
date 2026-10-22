import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleRunRoutes } from "../api/run-routes.mjs";
import { handleTaskRoutes } from "../api/task-routes.mjs";
import { withRunQueryUseCases } from "./run-query-test-helpers.mjs";
import { withCollaborationProjectUseCases } from "./collaboration-project-test-helpers.mjs";

const forcedRuntimeError = "OGSYSTEM_TEST_FORCE_RUNTIME_ERROR_AFTER_SETUP";

function apiHarness(store) {
  const taskUseCases = {
    createProjectTask: store.createProjectTask,
    getProjectTask: store.getProjectTask,
    startProjectTask: store.startProjectTask,
    retryProjectTask: store.retryProjectTask
  };
  const runUseCases = {
    getProjectRun: store.getProjectRun,
    getProjectRunEvents: store.getProjectRunEvents
  };

  async function invoke(handler, method, path, body = {}) {
    const sent = [];
    const handled = await handler({
      request: { method },
      response: {},
      url: new URL(`http://site.test${path}`),
      readBody: async () => body,
      sendJson: (_response, status, payload) => sent.push({ status, payload }),
      errorStatus: () => 500,
      publicTask: (task) => {
        const { requestFingerprint, attemptRequests, ...publicTaskDto } = task;
        return publicTaskDto;
      },
      useCases: handler === handleTaskRoutes ? taskUseCases : runUseCases
    });
    assert.equal(handled, true, `${method} ${path} should be handled`);
    assert.equal(sent.length, 1);
    return sent[0];
  }

  return {
    task: (method, path, body) => invoke(handleTaskRoutes, method, path, body),
    run: (method, path, body) => invoke(handleRunRoutes, method, path, body)
  };
}

async function waitForTerminalTask(store, projectId, taskId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const task = await store.getProjectTask(projectId, taskId);
    if (["completed", "failed", "cancelled"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Task did not reach a terminal state in time.");
}

async function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("Runtime failure is queryable on Run and Task and retry preserves the failed attempt", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-task-run-runtime-failure-"));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  const previousFailure = process.env[forcedRuntimeError];
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  delete process.env[forcedRuntimeError];
  const store = withCollaborationProjectUseCases(await import(`../infrastructure/file-project-store.mjs?runtime-failure=${Date.now()}-${Math.random()}`));
  const api = apiHarness(withRunQueryUseCases(store, projectsRoot));

  try {
    const teamDraft = await store.createProject({
      name: "Runtime Failure Team",
      overview: "Exercise durable Runtime failure handling.",
      templateId: "empty"
    });
    const team = await store.confirmProjectTeam(teamDraft.projectId, { release: true });
    const project = await store.createCollaborationProject({
      name: "Runtime Failure Project",
      overview: "Query and retry a failed Run without rewriting its history.",
      teamVersionIds: [team.teamVersionId]
    });
    const created = await api.task("POST", `/api/v1/projects/${project.projectId}/tasks`, {
      input: "Force one Runtime failure, then retry this Task.",
      teamVersionId: team.teamVersionId
    });
    assert.equal(created.status, 201);
    const taskId = created.payload.taskId;

    process.env[forcedRuntimeError] = "1";
    const start = await api.task("POST", `/api/v1/projects/${project.projectId}/tasks/${taskId}/start`, { mode: "dry-run" });
    assert.equal(start.status, 202);
    const failedTask = await waitForTerminalTask(store, project.projectId, taskId);
    delete process.env[forcedRuntimeError];
    assert.equal(failedTask.status, "failed");

    const taskProjection = await api.task("GET", `/api/v1/projects/${project.projectId}/tasks/${taskId}`);
    assert.equal(taskProjection.status, 200);
    assert.equal(taskProjection.payload.status, "failed");
    const failedRunId = failedTask.currentRunId;
    assert.ok(failedRunId);

    const runPath = `/api/v1/projects/${project.projectId}/tasks/${taskId}/runs/${failedRunId}`;
    const failedRunResponse = await api.run("GET", runPath);
    assert.equal(failedRunResponse.status, 200);
    assert.equal(failedRunResponse.payload.state.status, "failed");
    assert.match(failedRunResponse.payload.state.error, /Forced runtime error after setup/);
    const originalFailedState = structuredClone(failedRunResponse.payload.state);

    const eventsResponse = await api.run("GET", `${runPath}/events?limit=100`);
    assert.equal(eventsResponse.status, 200);
    assert.ok(Array.isArray(eventsResponse.payload.events));
    assert.equal(typeof eventsResponse.payload.nextCursor, "number");
    const originalEvents = structuredClone(eventsResponse.payload.events);

    const retry = await api.task("POST", `/api/v1/projects/${project.projectId}/tasks/${taskId}/retry`, {
      mode: "dry-run",
      idempotencyKey: "retry-after-runtime-failure"
    });
    assert.equal(retry.status, 202);
    const retriedTask = await waitForTerminalTask(store, project.projectId, taskId);
    assert.equal(retriedTask.status, "completed", retriedTask.lastError || "retry should complete");
    assert.notEqual(retriedTask.currentRunId, failedRunId);
    assert.deepEqual(retriedTask.runIds, [failedRunId, retriedTask.currentRunId]);

    const oldRunAfterRetry = await api.run("GET", runPath);
    assert.equal(oldRunAfterRetry.status, 200);
    assert.deepEqual(oldRunAfterRetry.payload.state, originalFailedState);
    const oldEventsAfterRetry = await api.run("GET", `${runPath}/events?limit=100`);
    assert.equal(oldEventsAfterRetry.status, 200);
    assert.deepEqual(oldEventsAfterRetry.payload.events, originalEvents);
    assert.equal(oldRunAfterRetry.payload.state.status, "failed");
  } finally {
    await restoreEnv(forcedRuntimeError, previousFailure);
    await restoreEnv("OGS_SITE_PROJECTS_DIR", previousRoot);
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
