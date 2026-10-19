import assert from "node:assert/strict";
import test from "node:test";
import { handleProjectRoutes } from "../api/project-routes.mjs";
import { handleTaskRoutes } from "../api/task-routes.mjs";
import { handleRunRoutes } from "../api/run-routes.mjs";

function routeHarness(useCases) {
  const sent = [];
  return {
    sent,
    dependencies: {
      request: { method: "GET" },
      response: {},
      url: new URL("http://site.test/"),
      readBody: async () => ({}),
      sendJson: (_response, status, payload) => sent.push({ status, payload }),
      errorStatus: () => 400,
      publicProject: (project) => {
        const { workdir, ...safe } = project;
        return safe;
      },
      publicTask: (task) => {
        if (!task || typeof task !== "object") return task;
        const { requestFingerprint, attemptRequests, ...safe } = task;
        return safe;
      },
      useCases
    }
  };
}

test("Project routes call injected use cases and leave unrelated requests unmatched", async () => {
  const calls = [];
  const harness = routeHarness({
    listCollaborationProjects: async () => (calls.push(["listProjects"]), [{ projectId: "project-1", workdir: "/private" }]),
    createCollaborationProject: async (input) => (calls.push(["create", input]), { projectId: "research" }),
    listProjectTeams: async (id) => (calls.push(["listTeams", id]), { teams: [] }),
    replaceProjectTeams: async (id, ids) => (calls.push(["replaceTeams", id, ids]), { projectId: id })
  });
  const handler = (request) => handleProjectRoutes({ ...harness.dependencies, ...request });
  harness.dependencies.request = { method: "GET" };
  harness.dependencies.url = new URL("http://site.test/api/v1/projects");
  assert.equal(await handler({}), true);
  assert.deepEqual(harness.sent[0].payload, { projects: [{ projectId: "project-1" }] });
  assert.deepEqual(calls[0], ["listProjects"]);
  harness.dependencies.request = { method: "POST" };
  harness.dependencies.url = new URL("http://site.test/api/v1/projects");
  harness.dependencies.readBody = async () => ({ name: "Research", overview: "Analyze." });
  assert.equal(await handler({}), true);
  assert.equal(harness.sent[1].status, 201);
  assert.deepEqual(calls[1], ["create", { name: "Research", overview: "Analyze.", teamVersionIds: undefined }]);
  assert.equal(await handler({ url: new URL("http://site.test/api/v1/unknown") }), false);
});

test("Task routes map actions and hide internal task fingerprints", async () => {
  const calls = [];
  const harness = routeHarness({
    createProjectTask: async (projectId, input) => (calls.push(["create", projectId, input]), { taskId: "task-1", requestFingerprint: "private" }),
    getProjectTask: async () => ({ taskId: "task-1" }),
    deleteProjectTask: async () => ({ taskId: "task-1" }),
    reviewProjectTask: async () => ({ task: { taskId: "task-1", requestFingerprint: "private" }, review: { decision: "approve" } }),
    startProjectTask: async () => ({ task: { taskId: "task-1", requestFingerprint: "private" } }),
    retryProjectTask: async (projectId, taskId, input) => (calls.push(["retryTask", projectId, taskId, input]), { taskId }),
    controlProjectTask: async (_projectId, _taskId, action) => (calls.push(["control", action]), { taskId: "task-1" })
  });
  const invoke = (method, path, body = {}) => handleTaskRoutes({
    ...harness.dependencies,
    request: { method },
    url: new URL(`http://site.test${path}`),
    readBody: async () => body
  });
  assert.equal(await invoke("POST", "/api/v1/projects/project-1/tasks", { input: "Work" }), true);
  assert.equal(harness.sent[0].payload.requestFingerprint, undefined);
  assert.deepEqual(calls[0], ["create", "project-1", { input: "Work" }]);
  assert.equal(await invoke("POST", "/api/v1/projects/project-1/tasks/task-1/start"), true);
  assert.equal(harness.sent[1].status, 202);
  assert.equal(harness.sent[1].payload.task.requestFingerprint, undefined);
  assert.equal(await invoke("POST", "/api/v1/projects/project-1/tasks/task-1/cancel"), true);
  assert.deepEqual(calls[1], ["control", "cancel"]);
  assert.equal(await invoke("POST", "/api/v1/projects/project-1/tasks/task-1/retry", { mode: "dry-run", idempotencyKey: "retry-key" }), true);
  assert.equal(harness.sent[3].status, 202);
  assert.deepEqual(calls[2], ["retryTask", "project-1", "task-1", { mode: "dry-run", idempotencyKey: "retry-key" }]);
});

test("Run routes expose read operations only and keep controls and retry on Task", async () => {
  const calls = [];
  const harness = routeHarness({
    listRecentProjectRuns: async (limit) => (calls.push(["recent", limit]), [{ runId: "recent-run" }]),
    getProjectRun: async (...args) => (calls.push(["get", ...args]), { collaborationProjectId: null, taskId: null, teamVersionId: null, runtimeProjectId: "workspace-1", runId: "run-1" }),
    getProjectRunResult: async (...args) => (calls.push(["result", ...args]), { collaborationProjectId: null, taskId: null, teamVersionId: null, runtimeProjectId: "workspace-1", available: false, result: null }),
    getProjectRunEvents: async (...args) => (calls.push(["events", ...args]), { collaborationProjectId: null, taskId: null, teamVersionId: null, runtimeProjectId: "workspace-1", events: [] })
  });
  const invoke = (method, path, body = {}) => handleRunRoutes({
    ...harness.dependencies,
    request: { method },
    url: new URL(`http://site.test${path}`),
    readBody: async () => body
  });
  assert.equal(await invoke("GET", "/api/v1/runs/recent?limit=25"), true);
  assert.deepEqual(calls[0], ["recent", 25]);
  assert.equal(await invoke("GET", "/api/v1/projects/project-1/runs/run-1"), true);
  assert.deepEqual(calls[1], ["get", "project-1", "run-1"]);
  assert.deepEqual(harness.sent[1].payload, { collaborationProjectId: null, taskId: null, teamVersionId: null, runtimeProjectId: "workspace-1", runId: "run-1" });
  assert.equal(await invoke("GET", "/api/v1/projects/project-1/runs/run-1/events?cursor=3&limit=10&type=review"), true);
  assert.deepEqual(calls[2], ["events", "project-1", "run-1", {
    cursor: 3, limit: 10, type: "review", roleId: undefined, branchId: undefined,
    status: undefined, errorCode: undefined, channel: undefined
  }]);
  assert.equal(await invoke("POST", "/api/v1/projects/project-1/runs/run-1/retry"), false);
  assert.equal(await invoke("POST", "/api/v1/projects/project-1/runs/run-1/pause"), false);
  assert.equal(await invoke("POST", "/api/v1/projects/project-1/runs/run-1/resume"), false);
  assert.equal(await invoke("POST", "/api/v1/projects/project-1/runs/run-1/cancel"), false);
  assert.equal(await invoke("GET", "/api/v1/projects/project-1/runs/run-1/result"), true);
  assert.deepEqual(calls[3], ["result", "project-1", "run-1"]);
  assert.deepEqual(harness.sent[3].payload, { collaborationProjectId: null, taskId: null, teamVersionId: null, runtimeProjectId: "workspace-1", available: false, result: null });
});
