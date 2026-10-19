import assert from "node:assert/strict";
import test from "node:test";
import { createTaskLifecycleUseCases } from "../application/task-lifecycle-use-cases.mjs";

function makeUseCases(project = { projectId: "project-1", taskRecords: [{ taskId: "task-1", status: "queued", currentRunId: null }] }, { beforeLock } = {}) {
  const calls = [];
  const state = structuredClone(project);
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
      async controlRun(projectId, runId, control) { calls.push(["run", projectId, runId, control]); return { state: { status: control === "pause" ? "pause_requested" : "cancel_requested" } }; }
    },
    reviewStore: {
      async listReviews() { return { reviews: [{ reviewId: "review-1", currentStatus: "pending" }] }; },
      async decideReview(...args) { calls.push(["review", ...args.slice(2, 4)]); return { reviewId: args[2], decision: args[3] }; }
    }
  });
  return { useCases, calls, state };
}

test("Task control enforces queued start, project execution slot, pause, resume, and terminal guards", async () => {
  const { useCases, calls } = makeUseCases();
  const started = await useCases.controlProjectTask("project-1", "task-1", "start");
  assert.equal(started.status, "running");
  await assert.rejects(() => useCases.controlProjectTask("project-1", "task-1", "start"), /TASK_START_NOT_ALLOWED/);
  assert.equal((await useCases.controlProjectTask("project-1", "task-1", "pause")).status, "paused");
  assert.equal((await useCases.controlProjectTask("project-1", "task-1", "resume")).status, "queued");
  const { useCases: blocked } = makeUseCases({
    projectId: "project-1",
    taskRecords: [
      { taskId: "task-1", status: "queued", currentRunId: null },
      { taskId: "task-2", status: "running", currentRunId: "run-2" }
    ]
  });
  await assert.rejects(() => blocked.controlProjectTask("project-1", "task-1", "start"), /PROJECT_TASK_CONCURRENCY_LIMIT/);
});

test("Task controls resolve the current Run and reject noncurrent state transitions", async () => {
  const { useCases, calls } = makeUseCases({
    projectId: "project-1",
    taskRecords: [{ taskId: "task-1", status: "running", currentRunId: "run-2", runIds: ["run-1", "run-2"], runProjectId: "team-version-1" }]
  });
  assert.equal((await useCases.controlProjectTask("project-1", "task-1", "pause")).status, "pause_requested");
  assert.ok(calls.some(([kind, ownerId, runId, control]) => kind === "run" && ownerId === "team-version-1" && runId === "run-2" && control === "pause"));
  assert.equal(calls.some(([kind, , runId]) => kind === "run" && runId === "run-1"), false);
});

test("Task review persists the decision and resumes the selected Run when available", async () => {
  const { useCases, calls } = makeUseCases({
    projectId: "project-1",
    taskRecords: [{ taskId: "task-1", status: "waiting_review", currentRunId: "run-1" }]
  });
  const result = await useCases.reviewProjectTask("project-1", "task-1", { decision: "approve", comment: "Looks good" });
  assert.equal(result.task.status, "queued");
  assert.equal(result.review.reviewId, "review-1");
  assert.ok(calls.some(([kind, , , control]) => kind === "run" && control === "resume"));
});

test("deleting an active Task requests Run cancellation and persists a deleted Task", async () => {
  const { useCases, calls } = makeUseCases({
    projectId: "project-1",
    taskRecords: [{ taskId: "task-1", status: "running", currentRunId: "run-1" }]
  });
  const result = await useCases.deleteProjectTask("project-1", "task-1");
  assert.equal(result.status, "deleted");
  assert.ok(result.deletedAt);
  assert.ok(calls.some(([kind, , , control]) => kind === "run" && control === "cancel"));
});

test("deleting a ready Task requests cancellation of its Run", async () => {
  const { useCases, calls } = makeUseCases({
    projectId: "project-1",
    taskRecords: [{ taskId: "task-1", status: "ready", currentRunId: "run-ready-1" }]
  });
  const result = await useCases.deleteProjectTask("project-1", "task-1");
  assert.equal(result.status, "deleted");
  assert.ok(calls.some(([kind, projectId, runId, control]) => kind === "run"
    && projectId === "project-1" && runId === "run-ready-1" && control === "cancel"));
});

test("cancel re-reads under the project lock when Run reservation wins", async () => {
  const { useCases, calls } = makeUseCases(undefined, {
    async beforeLock(operation, current) {
      if (operation !== "project-task-cancel") return;
      current.taskRecords[0] = { ...current.taskRecords[0], status: "planning", currentRunId: "run-reserved", runIds: ["run-reserved"], runProjectId: "team-v1" };
    }
  });
  const result = await useCases.controlProjectTask("project-1", "task-1", "cancel");
  assert.equal(result.currentRunId, "run-reserved");
  assert.equal(result.status, "cancel_requested");
  assert.ok(calls.some(([kind, projectId, runId, control]) => kind === "run"
    && projectId === "team-v1" && runId === "run-reserved" && control === "cancel"));
});

test("cancel winning the project lock makes a queued Task terminal without creating a Run", async () => {
  const { useCases, calls } = makeUseCases();
  const result = await useCases.controlProjectTask("project-1", "task-1", "cancel");
  assert.equal(result.status, "cancelled");
  assert.equal(result.currentRunId, null);
  assert.equal(calls.some(([kind]) => kind === "run"), false);
});
