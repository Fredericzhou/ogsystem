import assert from "node:assert/strict";
import test from "node:test";
import { createTaskLifecycleUseCases } from "../application/task-lifecycle-use-cases.mjs";

function makeUseCases(project = { projectId: "project-1", taskRecords: [{ taskId: "task-1", status: "queued", currentRunId: null }] }, { beforeLock } = {}) {
  const calls = [];
  const state = structuredClone({
    ...project,
    taskRecords: (project.taskRecords || []).map((task) => ({ teamVersionId: "team-version-1", ...task }))
  });
  const useCases = createTaskLifecycleUseCases({
    projectStore: {
      async getProject() { return structuredClone(state); },
      async withProjectWriteLock(_projectId, operation, action) { calls.push(["lock", operation]); await beforeLock?.(operation, state); return action(); },
      async saveTaskRecord(_project, taskId, update) {
        calls.push(["save", taskId, update]);
        const index = state.taskRecords.findIndex((task) => task.taskId === taskId);
        state.taskRecords[index] = { ...state.taskRecords[index], ...update };
        return structuredClone(state.taskRecords[index]);
      }
    },
    runControlStore: {
      async controlRun(projectId, runId, control) {
        calls.push(["run", projectId, runId, control]);
        return { state: { status: "cancel_requested" } };
      }
    }
  });
  return { useCases, calls, state };
}

test("Task lifecycle supports queued start and enforces the Project execution slot", async () => {
  const { useCases } = makeUseCases();
  const started = await useCases.controlProjectTask("project-1", "task-1", "start");
  assert.equal(started.status, "running");
  await assert.rejects(() => useCases.controlProjectTask("project-1", "task-1", "start"), /TASK_START_NOT_ALLOWED|already has a run/);

  const { useCases: blocked } = makeUseCases({
    projectId: "project-1",
    taskRecords: [
      { taskId: "task-1", status: "queued", currentRunId: null },
      { taskId: "task-2", status: "running", currentRunId: "run-2" }
    ]
  });
  await assert.rejects(() => blocked.controlProjectTask("project-1", "task-1", "start"), /PROJECT_TASK_CONCURRENCY_LIMIT/);
});

test("Task lifecycle rejects pause, resume, and embedded review controls", async () => {
  const { useCases } = makeUseCases();
  for (const action of ["pause", "resume", "review"]) {
    await assert.rejects(() => useCases.controlProjectTask("project-1", "task-1", action), /TASK_CONTROL_INVALID/);
  }
  assert.equal("reviewProjectTask" in useCases, false);
  assert.equal("getProjectTaskReviewContext" in useCases, false);
});

test("cancel controls only the current Run and queued cancellation creates no Run", async () => {
  const { useCases, calls } = makeUseCases({
    projectId: "project-1",
    taskRecords: [{ taskId: "task-1", status: "running", currentRunId: "run-2", runIds: ["run-1", "run-2"] }]
  });
  const result = await useCases.controlProjectTask("project-1", "task-1", "cancel");
  assert.equal(result.status, "cancel_requested");
  assert.ok(calls.some(([kind, ownerId, runId, action]) => kind === "run" && ownerId === "project-1" && runId === "run-2" && action === "cancel"));
  assert.equal(calls.some(([kind, , runId]) => kind === "run" && runId === "run-1"), false);

  const queued = makeUseCases();
  const cancelled = await queued.useCases.controlProjectTask("project-1", "task-1", "cancel");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.currentRunId, null);
  assert.equal(queued.calls.some(([kind]) => kind === "run"), false);
});

test("deleting an active Task cancels its Run and persists deletion", async () => {
  const { useCases, calls } = makeUseCases({
    projectId: "project-1",
    taskRecords: [{ taskId: "task-1", status: "waiting_review", currentRunId: "run-1" }]
  });
  const result = await useCases.deleteProjectTask("project-1", "task-1");
  assert.equal(result.status, "deleted");
  assert.ok(result.deletedAt);
  assert.ok(calls.some(([kind, , runId, action]) => kind === "run" && runId === "run-1" && action === "cancel"));
});

test("cancel re-reads under the Project lock when Run reservation wins", async () => {
  const { useCases, calls } = makeUseCases(undefined, {
    async beforeLock(operation, current) {
      if (operation !== "project-task-cancel") return;
      current.taskRecords[0] = { ...current.taskRecords[0], status: "planning", currentRunId: "run-reserved", runIds: ["run-reserved"], teamVersionId: "team-v1" };
    }
  });
  const result = await useCases.controlProjectTask("project-1", "task-1", "cancel");
  assert.equal(result.currentRunId, "run-reserved");
  assert.equal(result.status, "cancel_requested");
  assert.ok(calls.some(([kind, projectId, runId, action]) => kind === "run"
    && projectId === "project-1" && runId === "run-reserved" && action === "cancel"));
});
