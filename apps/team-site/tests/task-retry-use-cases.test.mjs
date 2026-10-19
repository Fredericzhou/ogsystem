import assert from "node:assert/strict";
import test from "node:test";
import { createTaskRetryUseCases } from "../application/task-retry-use-cases.mjs";

function setup(overrides = {}) {
  const calls = [];
  const task = {
    taskId: "task-1",
    status: "failed",
    currentRunId: "run-1",
    runProjectId: "team-1",
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
          : { projectType: "collaboration", workdir: "/tmp/project-1", materials: { materials: [{ materialId: "mat-1", path: "workspace/files/input.txt", contentType: "text/plain" }] }, taskRecords: [task] };
      }
    },
    runStore: {
      async readRunState(workdir, runId) { calls.push(["readRunState", workdir, runId]); return { status: "failed" }; },
      async loadMaterialSnapshots(workdir, runId) {
        calls.push(["loadMaterialSnapshots", workdir, runId]);
        return [{ materialId: "mat-1", snapshotPath: "inputs/input.txt", contentType: "text/plain", selectedRanges: [], consumingNodeIds: ["role-a"] }];
      },
      resolveMaterialPath(workdir, path) { return `${workdir}/${path}`; },
      resolveRunArtifactPath(workdir, runId, path) { return `${workdir}/.ogs/runs/${runId}/${path}`; }
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
    retryInputs: [{
      materialId: "mat-1",
      sourcePath: "/tmp/team-1/.ogs/runs/run-1/inputs/input.txt",
      contentType: "text/plain",
      selectedRanges: [],
      consumingNodeIds: ["role-a"]
    }],
    retrySourceRoot: undefined,
    idempotencyKey: "retry-key"
  });
});

test("Task retry refuses a Task that is not failed", async () => {
  const { useCases } = setup({ projectStore: { async getProject() { return { projectType: "collaboration", taskRecords: [{ taskId: "task-1", status: "completed" }] }; } } });
  await assert.rejects(() => useCases.retryProjectTask("project-1", "task-1"), /TASK_RETRY_UNSUPPORTED/);
});

test("Task retry can recover a failed reservation with no Run state", async () => {
  const { useCases, calls } = setup({
    projectStore: { async getProject(projectId) {
      return projectId === "team-1"
        ? { workdir: "/tmp/team-1" }
        : { projectType: "collaboration", workdir: "/tmp/project-1", materials: { materials: [{ materialId: "mat-1", path: "workspace/files/input.txt", contentType: "text/plain" }] }, taskRecords: [{ taskId: "task-1", status: "failed", currentRunId: "missing-run", runProjectId: "team-1", teamVersionId: "team-1", lastError: "RUN_STATE_MISSING: reserved Run state was not created." }] };
    } },
    runStore: { async readRunState() { return undefined; } }
  });
  await useCases.retryProjectTask("project-1", "task-1");
  const start = calls.find(([name]) => name === "startTask");
  assert.deepEqual(start[3].retryInputs, [{ materialId: "mat-1", sourcePath: "/tmp/project-1/workspace/files/input.txt", contentType: "text/plain" }]);
  assert.equal(start[3].retrySourceRoot, "/tmp/project-1");
});

test("Task retry rejects invalid IDs before reading the Task", async () => {
  const { useCases, calls } = setup();
  await assert.rejects(() => useCases.retryProjectTask("project-1", "../task"), /TASK_NOT_FOUND/);
  assert.deepEqual(calls, []);
});
