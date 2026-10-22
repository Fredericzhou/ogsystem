import assert from "node:assert/strict";
import test from "node:test";
import { createDeliverableUseCases } from "../application/deliverable-use-cases.mjs";
import { handleDeliverableRoutes } from "../api/deliverable-routes.mjs";

test("Deliverable archive requires a completed Run and stores an independent snapshot", async () => {
  const project = { projectId: "project-1", projectType: "collaboration", workdir: "/project" };
  const archives = [];
  const useCases = createDeliverableUseCases({
    getProject: async () => project,
    getRun: async (_projectId, taskId, runId) => ({ runId, taskId, teamVersionId: "team-v1", attemptNumber: runId === "run-2" ? 2 : 1, state: { status: runId === "run-failed" ? "failed" : "completed" } }),
    runResultStore: { readFinalOutput: async () => "final output" },
    deliverableStore: {
      archive: async (_project, metadata, content) => (archives.push({ metadata, content }), { deliverableId: "d-1", ...metadata }),
      list: async () => [],
      readContent: async () => "snapshot"
    }
  });
  await assert.rejects(useCases.archiveProjectRun("project-1", "task-1", "run-failed"), /DELIVERABLE_RUN_NOT_SUCCESSFUL/);
  const first = await useCases.archiveProjectRun("project-1", "task-1", "run-1");
  const second = await useCases.archiveProjectRun("project-1", "task-1", "run-2");
  assert.equal(first.deliverable.attemptNumber, 1);
  assert.equal(second.deliverable.attemptNumber, 2);
  assert.equal(archives.length, 2);
  assert.equal(archives[0].content, "final output");
});

test("archive API reports created snapshots and idempotent replays with distinct statuses", async () => {
  const statuses = [];
  const response = {};
  const sendJson = (_response, status, payload) => statuses.push({ status, payload });
  const useCases = {
    archiveProjectRun: async (_projectId, taskId, runId) => ({ projectId: "project-1", deliverable: { taskId, runId, idempotentReplay: runId === "run-existing" } })
  };
  const handle = (runId) => handleDeliverableRoutes({
    request: { method: "POST" }, response, url: new URL(`http://localhost/api/v1/projects/project-1/tasks/task-1/runs/${runId}/deliverable`), sendJson, errorStatus: () => 500, useCases
  });

  assert.equal(await handle("run-new"), true);
  assert.equal(await handle("run-existing"), true);
  assert.deepEqual(statuses.map((item) => item.status), [201, 200]);
});

test("Deliverable collection and content routes expose independent read operations", async () => {
  const sent = [];
  const useCases = {
    listProjectDeliverables: async (projectId) => ({ projectId, deliverables: [{ deliverableId: "deliverable-1" }] }),
    getProjectDeliverableContent: async (projectId, deliverableId) => ({ projectId, deliverableId, content: "snapshot" })
  };
  const invoke = (method, path) => handleDeliverableRoutes({
    request: { method },
    response: {},
    url: new URL(`http://localhost${path}`),
    sendJson: (_response, status, payload) => sent.push({ status, payload }),
    errorStatus: () => 500,
    useCases
  });

  assert.equal(await invoke("GET", "/api/v1/projects/project-1/deliverables"), true);
  assert.equal(await invoke("GET", "/api/v1/projects/project-1/deliverables/deliverable-1/content"), true);
  assert.deepEqual(sent, [
    { status: 200, payload: { projectId: "project-1", deliverables: [{ deliverableId: "deliverable-1" }] } },
    { status: 200, payload: { projectId: "project-1", deliverableId: "deliverable-1", content: "snapshot" } }
  ]);
  assert.equal(await invoke("POST", "/api/v1/projects/project-1/deliverables"), false);
});
