import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTaskLifecycleUseCases } from "../application/task-lifecycle-use-cases.mjs";
import { createRuntimeTaskReviewStore } from "../infrastructure/runtime-task-review-store.mjs";

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
      async controlRun(projectId, runId, control) { calls.push(["run", projectId, runId, control]); return { state: { status: control === "pause" ? "pause_requested" : control === "resume" ? "running" : "cancel_requested" } }; }
    },
    reviewStore: {
      async listReviews() { return { reviews: [{ reviewId: "review-1", currentStatus: "pending", allowedDecisions: ["approve", "rework"] }] }; },
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
    taskRecords: [{ taskId: "task-1", status: "running", currentRunId: "run-2", runIds: ["run-1", "run-2"], teamVersionId: "team-version-1" }]
  });
  assert.equal((await useCases.controlProjectTask("project-1", "task-1", "pause")).status, "pause_requested");
  assert.ok(calls.some(([kind, ownerId, runId, control]) => kind === "run" && ownerId === "project-1" && runId === "run-2" && control === "pause"));
  assert.equal(calls.some(([kind, , runId]) => kind === "run" && runId === "run-1"), false);
});

test("Task resume reacquires Runtime control after releasing the Task write lock", async () => {
  let state = { projectId: "project-1", taskRecords: [{ taskId: "task-1", teamVersionId: "team-version-1", status: "paused", currentRunId: "run-1", runIds: ["run-1"] }] };
  let lockHeld = false;
  let resumedUnderLock = false;
  const useCases = createTaskLifecycleUseCases({
    projectStore: {
      async getProject() { return structuredClone(state); },
      async withProjectWriteLock(_id, _operation, action) {
        lockHeld = true;
        try { return await action(); }
        finally { lockHeld = false; }
      },
      async saveTaskRecord(_project, taskId, update) {
        const index = state.taskRecords.findIndex((task) => task.taskId === taskId);
        state.taskRecords[index] = { ...state.taskRecords[index], ...update };
        return structuredClone(state.taskRecords[index]);
      }
    },
    runControlStore: { async controlRun() { resumedUnderLock = lockHeld; return { state: { status: "running" } }; } },
    reviewStore: { async listReviews() { return { reviews: [] }; }, async decideReview() {} }
  });

  const result = await useCases.controlProjectTask("project-1", "task-1", "resume");
  assert.equal(resumedUnderLock, false);
  assert.equal(result.status, "running");
});

test("Task review persists the decision and resumes the selected Run when available", async () => {
  const { useCases, calls } = makeUseCases({
    projectId: "project-1",
    taskRecords: [{ taskId: "task-1", status: "waiting_review", currentRunId: "run-1" }]
  });
  const result = await useCases.reviewProjectTask("project-1", "task-1", { decision: "approve", comment: "Looks good" });
  assert.equal(result.task.status, "running");
  assert.equal(result.review.reviewId, "review-1");
  assert.ok(calls.some(([kind, , , control]) => kind === "run" && control === "resume"));
});

test("Task review releases the Project lock before resuming Runtime", async () => {
  const state = { projectId: "project-1", taskRecords: [{ taskId: "task-1", teamVersionId: "team-version-1", status: "waiting_review", currentRunId: "run-1" }] };
  let lockHeld = false;
  let resumedUnderLock = false;
  const useCases = createTaskLifecycleUseCases({
    projectStore: {
      async getProject() { return structuredClone(state); },
      async withProjectWriteLock(_id, _operation, action) {
        lockHeld = true;
        try { return await action(); }
        finally { lockHeld = false; }
      },
      async saveTaskRecord(_project, taskId, update) {
        const index = state.taskRecords.findIndex((task) => task.taskId === taskId);
        state.taskRecords[index] = { ...state.taskRecords[index], ...update };
        return structuredClone(state.taskRecords[index]);
      }
    },
    runControlStore: { async controlRun() { resumedUnderLock = lockHeld; return { state: { status: "running" } }; } },
    reviewStore: {
      async listReviews() { return { reviews: [{ reviewId: "review-1", currentStatus: "pending", allowedDecisions: ["approve"] }] }; },
      async decideReview() { return { reviewId: "review-1", decision: "approve" }; }
    }
  });

  const result = await useCases.reviewProjectTask("project-1", "task-1", { decision: "approve" });
  assert.equal(resumedUnderLock, false);
  assert.equal(result.task.status, "running");
  assert.equal(result.task.reviewTransition, null);
});

test("review approval keeps the resumed Run active instead of returning it to the queue", async () => {
  const { useCases } = makeUseCases({
    projectId: "project-1",
    taskRecords: [{ taskId: "task-1", status: "waiting_review", currentRunId: "run-1" }]
  });
  const result = await useCases.reviewProjectTask("project-1", "task-1", { decision: "approve" });
  assert.equal(result.task.status, "running");
});

test("review termination keeps the slot occupied until Run cancellation completes", async () => {
  const state = { projectId: "project-1", taskRecords: [{ taskId: "task-1", teamVersionId: "team-version-1", status: "waiting_review", currentRunId: "run-1" }] };
  const useCases = createTaskLifecycleUseCases({
    projectStore: {
      async getProject() { return structuredClone(state); },
      async withProjectWriteLock(_id, _operation, action) { return action(); },
      async saveTaskRecord(_project, taskId, update) {
        const index = state.taskRecords.findIndex((task) => task.taskId === taskId);
        state.taskRecords[index] = { ...state.taskRecords[index], ...update };
        return structuredClone(state.taskRecords[index]);
      }
    },
    runControlStore: { async controlRun() { return { state: { status: "cancel_requested" } }; } },
    reviewStore: {
      async listReviews() { return { reviews: [{ reviewId: "review-1", currentStatus: "pending", allowedDecisions: ["terminate"] }] }; },
      async decideReview() { return { reviewId: "review-1", decision: "terminate" }; }
    }
  });
  const result = await useCases.reviewProjectTask("project-1", "task-1", { decision: "terminate" });
  assert.equal(result.task.status, "cancel_requested");
});

test("branch-scoped review termination resumes the Run without cancelling other branches", async () => {
  const state = { projectId: "project-1", taskRecords: [{ taskId: "task-1", teamVersionId: "team-version-1", status: "waiting_review", currentRunId: "run-1" }] };
  const controls = [];
  const useCases = createTaskLifecycleUseCases({
    projectStore: {
      async getProject() { return structuredClone(state); },
      async withProjectWriteLock(_id, _operation, action) { return action(); },
      async saveTaskRecord(_project, taskId, update) {
        const index = state.taskRecords.findIndex((task) => task.taskId === taskId);
        state.taskRecords[index] = { ...state.taskRecords[index], ...update };
        return structuredClone(state.taskRecords[index]);
      }
    },
    runControlStore: { async controlRun(_projectId, _runId, control) {
      controls.push(control);
      return { state: { status: control === "resume" ? "running" : "cancel_requested" } };
    } },
    reviewStore: {
      async listReviews() { return { reviews: [{
        reviewId: "review-1", currentStatus: "pending", allowedDecisions: ["terminate"], spec: { terminateScope: "branch" }
      }] }; },
      async decideReview() { return { reviewId: "review-1", decision: "terminate" }; }
    }
  });

  const result = await useCases.reviewProjectTask("project-1", "task-1", { decision: "terminate" });
  assert.deepEqual(controls, ["resume"]);
  assert.equal(result.task.status, "running");
  assert.equal(result.task.review.decision, "terminate");
});

test("resuming a current Run rechecks the execution slot under the Project lock", async () => {
  const { useCases, calls } = makeUseCases({
    projectId: "project-1",
    taskRecords: [
      { taskId: "task-1", status: "paused", currentRunId: "run-1" },
      { taskId: "task-2", status: "queued", currentRunId: null }
    ]
  }, {
    async beforeLock(operation, state) {
      if (operation === "project-task-resume-run") state.taskRecords[1] = { ...state.taskRecords[1], status: "running", currentRunId: "run-2" };
    }
  });
  await assert.rejects(() => useCases.controlProjectTask("project-1", "task-1", "resume"), /PROJECT_TASK_CONCURRENCY_LIMIT/);
  assert.equal(calls.some(([kind, , , control]) => kind === "run" && control === "resume"), false);
});

test("Task review rechecks state under the Project lock", async () => {
  const project = { projectId: "project-1", taskRecords: [{ taskId: "task-1", status: "waiting_review", currentRunId: "run-1" }] };
  const { useCases, calls } = makeUseCases(project, {
    async beforeLock(operation, state) {
      if (operation === "project-task-review") state.taskRecords[0] = { ...state.taskRecords[0], status: "running" };
    }
  });
  await assert.rejects(() => useCases.reviewProjectTask("project-1", "task-1", { decision: "approve" }), /task status is running/);
  assert.equal(calls.some(([kind]) => kind === "review"), false);
});

test("Task review recovers a committed decision when Run resume initially fails", async () => {
  const state = { projectId: "project-1", taskRecords: [{ taskId: "task-1", teamVersionId: "team-version-1", status: "waiting_review", currentRunId: "run-1" }] };
  let committedReview;
  let failResume = true;
  let decisionWrites = 0;
  const useCases = createTaskLifecycleUseCases({
    projectStore: {
      async getProject() { return structuredClone(state); },
      async withProjectWriteLock(_id, _operation, action) { return action(); },
      async saveTaskRecord(_project, taskId, update) {
        const index = state.taskRecords.findIndex((task) => task.taskId === taskId);
        state.taskRecords[index] = { ...state.taskRecords[index], ...update };
        return structuredClone(state.taskRecords[index]);
      }
    },
    runControlStore: { async controlRun(_projectId, _runId, control) {
      if (control === "resume" && failResume) { failResume = false; throw new Error("Run is temporarily unavailable"); }
      return { state: { status: "running" } };
    } },
    reviewStore: {
      async listReviews() { return { reviews: [committedReview || { reviewId: "review-1", currentStatus: "pending", allowedDecisions: ["approve"] }] }; },
      async decideReview() {
        decisionWrites += 1;
        committedReview = { reviewId: "review-1", currentStatus: "resolved", decision: "approve", decisionPhase: "recorded" };
      }
    }
  });

  await assert.rejects(() => useCases.reviewProjectTask("project-1", "task-1", { decision: "approve" }), /temporarily unavailable/);
  assert.equal(state.taskRecords[0].status, "waiting_review");
  assert.equal(state.taskRecords[0].reviewTransition.decision, "approve");
  const recovered = await useCases.reviewProjectTask("project-1", "task-1", { decision: "approve" });
  assert.equal(recovered.task.status, "running");
  assert.equal(recovered.task.reviewTransition, null);
  assert.equal(decisionWrites, 1);
});

test("Task review recovers when the Run resumes but the final Task write fails", async () => {
  const state = { projectId: "project-1", taskRecords: [{ taskId: "task-1", teamVersionId: "team-version-1", status: "waiting_review", currentRunId: "run-1" }] };
  let committedReview;
  let failFinalWrite = true;
  let decisionWrites = 0;
  let resumeCalls = 0;
  const useCases = createTaskLifecycleUseCases({
    projectStore: {
      async getProject() { return structuredClone(state); },
      async withProjectWriteLock(_id, _operation, action) { return action(); },
      async saveTaskRecord(_project, taskId, update) {
        if (update.status && failFinalWrite) {
          failFinalWrite = false;
          throw new Error("Task persistence interrupted");
        }
        const index = state.taskRecords.findIndex((task) => task.taskId === taskId);
        state.taskRecords[index] = { ...state.taskRecords[index], ...update };
        return structuredClone(state.taskRecords[index]);
      }
    },
    runControlStore: { async controlRun() { resumeCalls += 1; return { state: { status: "running" } }; } },
    reviewStore: {
      async listReviews() { return { reviews: [committedReview || { reviewId: "review-1", currentStatus: "pending", allowedDecisions: ["approve"] }] }; },
      async decideReview() {
        decisionWrites += 1;
        committedReview = { reviewId: "review-1", currentStatus: "resolved", decision: "approve", decisionPhase: "recorded" };
      }
    }
  });

  await assert.rejects(() => useCases.reviewProjectTask("project-1", "task-1", { decision: "approve" }), /Task persistence interrupted/);
  assert.equal(state.taskRecords[0].status, "waiting_review");
  assert.equal(state.taskRecords[0].reviewTransition.decision, "approve");
  const recovered = await useCases.reviewProjectTask("project-1", "task-1", { decision: "approve" });
  assert.equal(recovered.task.status, "running");
  assert.equal(recovered.task.reviewTransition, null);
  assert.equal(decisionWrites, 1);
  assert.equal(resumeCalls, 2);
});

test("Runtime Task review store forwards the selected request terminate scope", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-review-scope-"));
  const projectId = "review-project";
  const projectRoot = join(projectsRoot, projectId);
  const runIds = ["run-1", "run-2"];
  await Promise.all(runIds.map(async (runId, index) => {
    const runDir = join(projectRoot, ".ogs", "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "run-owner.json"), JSON.stringify({
      version: 1,
      runKind: "project_task",
      projectId,
      taskId: `task-${index + 1}`,
      taskNumber: index + 1,
      attemptNumber: 1,
      runId,
      teamVersionId: "team-version-1"
    }));
    await mkdir(join(runDir, "control", "reviews"), { recursive: true });
  }));
  const writes = [];
  const reviewStore = createRuntimeTaskReviewStore({
    listHumanReviews: async () => ({ reviews: [] }),
    writeHumanReviewDecision: async (input) => { writes.push(input); },
    createPrincipal: () => ({ id: "reviewer" }),
    getProject: async () => ({ workdir: projectRoot })
  });
  try {
    for (const [index, runId] of runIds.entries()) {
      await reviewStore.decideReview(
        { projectId, workdir: projectRoot },
        { taskId: `task-${index + 1}`, taskNumber: index + 1, teamVersionId: "team-version-1", currentRunId: runId, runIds: [runId] },
        index === 0 ? "review-branch" : "review-run",
        "terminate",
        index === 0 ? "stop branch" : "stop run",
        index === 0 ? "branch" : "run"
      );
    }
    assert.deepEqual(writes.map(({ scope }) => scope), ["branch", "run"]);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("Task review rejects decisions omitted by the active request and exposes only request actions", async () => {
  const project = { projectId: "project-1", taskRecords: [{ taskId: "task-1", teamVersionId: "team-version-1", status: "waiting_review", currentRunId: "run-1" }] };
  const { useCases } = makeUseCases(project);
  const context = await useCases.getProjectTaskReviewContext("project-1", "task-1");
  assert.deepEqual(context.reviews[0].allowedDecisions, ["approve", "rework"]);
  await assert.rejects(
    () => useCases.reviewProjectTask("project-1", "task-1", { decision: "terminate" }),
    /decision is not allowed/
  );

  const calls = [];
  const invalidRequestUseCases = createTaskLifecycleUseCases({
    projectStore: {
      async getProject() { return structuredClone(project); },
      async withProjectWriteLock(_id, _operation, action) { return action(); },
      async saveTaskRecord() { throw new Error("must not persist a rejected decision"); }
    },
    runControlStore: { async controlRun() { calls.push("run"); } },
    reviewStore: {
      async listReviews() { return { reviews: [{ reviewId: "review-1", currentStatus: "pending" }] }; },
      async decideReview() { calls.push("decision"); }
    }
  });
  const noActions = await invalidRequestUseCases.getProjectTaskReviewContext("project-1", "task-1");
  assert.deepEqual(noActions.reviews[0].allowedDecisions, []);
  await assert.rejects(() => invalidRequestUseCases.reviewProjectTask("project-1", "task-1", { decision: "approve" }), /decision is not allowed/);
  assert.deepEqual(calls, []);
});

test("Task review context exposes only the resolved request needed to recover a committed transition", async () => {
  const project = { projectId: "project-1", taskRecords: [{
    taskId: "task-1",
    teamVersionId: "team-version-1",
    status: "waiting_review",
    currentRunId: "run-1",
    reviewTransition: { reviewId: "review-1", decision: "approve", comment: "ship after checks", startedAt: "2026-01-01T00:00:00.000Z" }
  }] };
  const { useCases } = makeUseCases(project);
  const context = await useCases.getProjectTaskReviewContext("project-1", "task-1");
  assert.deepEqual(context.reviews, [{
    reviewId: "review-1",
    roleId: undefined,
    branchId: undefined,
    currentStatus: "pending",
    selectedEvent: undefined,
    draftResult: undefined,
    humanReviewContext: undefined,
    spec: undefined,
    allowedDecisions: ["approve", "rework"],
    recoveryDecision: "approve",
    recoveryComment: "ship after checks"
  }]);

  const committedStore = createTaskLifecycleUseCases({
    projectStore: {
      async getProject() { return structuredClone(project); },
      async withProjectWriteLock(_id, _operation, action) { return action(); },
      async saveTaskRecord() { throw new Error("review context must remain read-only"); }
    },
    runControlStore: { async controlRun() { throw new Error("review context must remain read-only"); } },
    reviewStore: {
      async listReviews() { return { reviews: [{ reviewId: "review-1", currentStatus: "resolved", decision: "approve", decisionPhase: "recorded", allowedDecisions: [] }] }; },
      async decideReview() { throw new Error("review context must remain read-only"); }
    }
  });
  const committedContext = await committedStore.getProjectTaskReviewContext("project-1", "task-1");
  assert.deepEqual(committedContext.reviews.map(({ reviewId, currentStatus, recoveryDecision, recoveryComment, allowedDecisions }) => ({
    reviewId, currentStatus, recoveryDecision, recoveryComment, allowedDecisions
  })), [{
    reviewId: "review-1", currentStatus: "resolved", recoveryDecision: "approve", recoveryComment: "ship after checks", allowedDecisions: []
  }]);
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
      current.taskRecords[0] = { ...current.taskRecords[0], status: "planning", currentRunId: "run-reserved", runIds: ["run-reserved"], teamVersionId: "team-v1" };
    }
  });
  const result = await useCases.controlProjectTask("project-1", "task-1", "cancel");
  assert.equal(result.currentRunId, "run-reserved");
  assert.equal(result.status, "cancel_requested");
  assert.ok(calls.some(([kind, projectId, runId, control]) => kind === "run"
    && projectId === "project-1" && runId === "run-reserved" && control === "cancel"));
});

test("cancel winning the project lock makes a queued Task terminal without creating a Run", async () => {
  const { useCases, calls } = makeUseCases();
  const result = await useCases.controlProjectTask("project-1", "task-1", "cancel");
  assert.equal(result.status, "cancelled");
  assert.equal(result.currentRunId, null);
  assert.equal(calls.some(([kind]) => kind === "run"), false);
});
