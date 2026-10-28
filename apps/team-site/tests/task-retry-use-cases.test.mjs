import assert from "node:assert/strict";
import test from "node:test";
import { createTaskRetryUseCases } from "../application/task-retry-use-cases.mjs";

function setup(overrides = {}) {
  const calls = [];
  const task = {
    taskId: "task-1",
    status: "failed",
    currentRunId: "run-1",
    teamVersionId: "team-1",
    lastError: "Runtime failed"
  };
  const ports = {
    taskStore: {
      async getTask(projectId, taskId) { calls.push(["getTask", projectId, taskId]); return task; },
      async startTask(...args) { calls.push(["startTask", ...args]); return { taskId: "task-1", currentRunId: "run-2" }; }
    },
    projectStore: {
      async getProject(projectId) {
        calls.push(["getProject", projectId]);
        return projectId === "team-1"
          ? { workdir: "/tmp/team-1" }
          : { projectType: "collaboration", workdir: "/tmp/project-1", taskRecords: [task] };
      }
    },
    runStore: {
      async readRunState(projectId, taskId, runId) { calls.push(["readRunState", projectId, taskId, runId]); return { status: "failed" }; },
      async loadMaterialSnapshots(projectId, taskId, runId) {
        calls.push(["loadMaterialSnapshots", projectId, taskId, runId]);
        return [];
      },
      resolveMaterialPath(projectId, path) { return `/tmp/${projectId}/${path}`; },
      resolveRunArtifactPath(projectId, taskId, runId, path) { return `/tmp/${projectId}/.ogs/runs/${runId}/${path}`; }
    }
  };
  Object.assign(ports.taskStore, overrides.taskStore);
  Object.assign(ports.projectStore, overrides.projectStore);
  Object.assign(ports.runStore, overrides.runStore);
  return { useCases: createTaskRetryUseCases(ports), calls, task };
}

test("Task retry validates the failed current Run and starts a new immutable attempt", async () => {
  const { useCases, calls } = setup();
  const result = await useCases.retryProjectTask("project-1", "task-1", { mode: "sandbox", idempotencyKey: "retry-key" });
  assert.equal(result.currentRunId, "run-2");
  const start = calls.find(([name]) => name === "startTask");
  assert.deepEqual(start[3], {
    mode: "sandbox",
    retrySourceRunId: "run-1",
    retryInputs: [],
    materialSnapshotPolicy: { kind: "team-ir-v2-task-snapshot", sourceRunId: "run-1" },
    idempotencyKey: "retry-key"
  });
});

test("Task retry refuses a Task that is not failed", async () => {
  const { useCases } = setup({ projectStore: { async getProject() { return { projectType: "collaboration", taskRecords: [{ taskId: "task-1", status: "completed" }] }; } } });
  await assert.rejects(() => useCases.retryProjectTask("project-1", "task-1"), /TASK_RETRY_UNSUPPORTED/);
});

test("Task retry fails closed when the failed Run has no Team IR v2 checkpoint", async () => {
  const { useCases, calls } = setup({
    projectStore: { async getProject(projectId) {
      return projectId === "team-1"
        ? { workdir: "/tmp/team-1" }
        : { projectType: "collaboration", workdir: "/tmp/project-1", taskRecords: [{ taskId: "task-1", status: "failed", currentRunId: "missing-run", teamVersionId: "team-1", lastError: "RUN_STATE_MISSING: reserved Run state was not created." }] };
    } },
    runStore: { async readRunState() { return undefined; } }
  });
  await assert.rejects(() => useCases.retryProjectTask("project-1", "task-1", { mode: "sandbox" }), /TASK_RETRY_UNSUPPORTED/);
  assert.equal(calls.some(([name]) => name === "startTask"), false);
});

test("Task retry rejects invalid IDs before reading the Task", async () => {
  const { useCases, calls } = setup();
  await assert.rejects(() => useCases.retryProjectTask("project-1", "../task"), /TASK_NOT_FOUND/);
  assert.deepEqual(calls, []);
});
