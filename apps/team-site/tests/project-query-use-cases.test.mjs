import assert from "node:assert/strict";
import test from "node:test";
import { createProjectQueryUseCases } from "../application/project-query-use-cases.mjs";

test("Project query composes Run attempt history and projects the current Run status", async () => {
  const useCases = createProjectQueryUseCases({
    projectStore: {
      async getProject() {
        return {
          projectId: "project-1",
          projectType: "collaboration",
          taskRecords: [{
            taskId: "task-1", taskNumber: 4, status: "planning", currentRunId: "run-2",
            runIds: ["run-1", "run-2"], teamVersionId: "team-version-1",
            startedAt: null, completedAt: null, updatedAt: "stored", outputSummary: "stored summary"
          }]
        };
      }
    },
    taskAttemptStore: {
      async readAttempt(_projectId, _taskId, runId) {
        return runId === "run-1"
          ? { state: { status: "failed", attemptNumber: 1, error: "transient", updatedAt: "old" }, plan: { executionPolicy: { mode: "dry-run" } }, outputSummary: "old summary" }
          : { state: { status: "completed", attemptNumber: 2, startedAt: "started", finishedAt: "finished", updatedAt: "latest" }, plan: { executionPolicy: { mode: "sandbox" } }, outputSummary: "latest summary" };
      }
    },
    waitForActiveTaskWorker: async () => false
  });

  const project = await useCases.getProject("project-1");
  const [task] = project.taskRecords;
  assert.equal(task.status, "completed");
  assert.equal(task.taskNumber, 4);
  assert.equal(task.startedAt, "started");
  assert.equal(task.completedAt, "finished");
  assert.equal(task.lastError, null);
  assert.deepEqual(task.runAttempts.map(({ runId, status, mode, isCurrent, outputSummary }) => ({ runId, status, mode, isCurrent, outputSummary })), [
    { runId: "run-1", status: "failed", mode: "dry-run", isCurrent: false, outputSummary: "old summary" },
    { runId: "run-2", status: "completed", mode: "sandbox", isCurrent: true, outputSummary: "latest summary" }
  ]);
});

test("Task detail waits for a terminal worker before returning the projected attempt", async () => {
  let reads = 0;
  let waited = false;
  const useCases = createProjectQueryUseCases({
    projectStore: { async getProject() { return { projectType: "collaboration", projectId: "project-1", taskRecords: [{ taskId: "task-1", status: "failed", currentRunId: "run-1", runIds: ["run-1"], teamVersionId: "team-1" }] }; } },
    taskAttemptStore: { async readAttempt() { reads += 1; return { state: { status: "failed" } }; } },
    waitForActiveTaskWorker: async () => { waited = true; return true; }
  });
  const task = await useCases.getProjectTask("project-1", "task-1");
  assert.equal(task.status, "failed");
  assert.equal(waited, true);
  assert.equal(reads, 2);
});
