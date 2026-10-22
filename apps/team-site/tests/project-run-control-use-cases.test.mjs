import assert from "node:assert/strict";
import test from "node:test";
import { createProjectRunControlUseCases } from "../application/project-run-control-use-cases.mjs";

function makeUseCases(state = { status: "running" }, latestControl = undefined) {
  const calls = [];
  const project = {
    projectId: "project-1",
    projectType: "collaboration",
    taskRecords: [{ taskId: "task-1", taskNumber: 1, teamVersionId: "team-version-1", currentRunId: "run-1", runIds: ["run-1"] }]
  };
  const runControlStore = {
    async readState(project, runId) { calls.push(["readState", project.projectId, runId]); return state; },
    async writeControl(project, runId, control) { calls.push(["writeControl", project.projectId, runId, control]); return { action: control }; },
    async updateState(project, runId, control) { calls.push(["updateState", project.projectId, runId, control]); return { status: control === "pause" ? "pause_requested" : "cancel_requested" }; },
    async readLatestControl(project, runId) { calls.push(["readLatestControl", project.projectId, runId]); return latestControl; },
    async readResumeData(project, runId) {
      calls.push(["readResumeData", project.projectId, runId]);
      return {
        runDir: "/runs/run-1",
        plan: { executionPolicy: { mode: "sandbox" } },
        task: { prompt: "Continue" },
        projectTask: project.taskRecords[0],
        owner: { projectId: project.projectId, taskId: "task-1", runId, taskNumber: 1, attemptNumber: 1, teamVersionId: "team-version-1" }
      };
    }
  };
  return {
    calls,
    useCases: createProjectRunControlUseCases({
      projectStore: {
        async getProject() { return project; },
        async withProjectWriteLock(_projectId, _operation, action) { return action(); }
      },
      runControlStore,
      async startProjectRun(...args) { calls.push(["startProjectRun", ...args]); return { runId: "run-1", state: { status: "running" } }; }
    })
  };
}

test("Run controls use the Collaboration Project workspace and delegate state changes to Runtime", async () => {
  const { calls, useCases } = makeUseCases();
  const result = await useCases.controlProjectRun("team-version-1", "run-1", "pause");
  assert.equal(result.state.status, "pause_requested");
  assert.deepEqual(calls, [
    ["readState", "project-1", "run-1"],
    ["writeControl", "project-1", "run-1", "pause"],
    ["updateState", "project-1", "run-1", "pause"]
  ]);
});

test("Run control intent failure propagates without advancing the Run projection", async () => {
  const failure = new Error("control request write failed");
  let stateWrites = 0;
  const useCases = createProjectRunControlUseCases({
    projectStore: {
      async getProject(projectId) { return { projectId }; },
      async withProjectWriteLock(_projectId, _operation, action) { return action(); }
    },
    runControlStore: {
      async readState() { return { status: "running" }; },
      async writeControl() { throw failure; },
      async updateState() { stateWrites += 1; return { status: "pause_requested" }; },
      async readLatestControl() { return undefined; },
      async readResumeData() { throw new Error("unused"); }
    },
    async startProjectRun() { throw new Error("unused"); }
  });

  await assert.rejects(() => useCases.controlProjectRun("project-1", "run-1", "pause"), (error) => error === failure);
  assert.equal(stateWrites, 0);
});

test("Run resume creates a resumed execution from the Run snapshot", async () => {
  const { calls, useCases } = makeUseCases({ status: "paused" });
  await useCases.controlProjectRun("project-1", "run-1", "resume");
  assert.ok(calls.some(([kind]) => kind === "startProjectRun"));
  assert.deepEqual(calls.at(-1), ["startProjectRun", "project-1", {
    prompt: "Continue", mode: "sandbox", resumeRunId: "run-1", resumeRunDir: "/runs/run-1",
    runKind: "project_task", taskId: "task-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-version-1"
  }]);
});

test("Run resume releases the Project write lock before starting Runtime resume", async () => {
  const calls = [];
  let lockHeld = false;
  const project = {
    projectId: "project-1",
    projectType: "collaboration",
    taskRecords: [{ taskId: "task-1", taskNumber: 1, teamVersionId: "team-version-1", currentRunId: "run-1", runIds: ["run-1"] }]
  };
  const useCases = createProjectRunControlUseCases({
    projectStore: {
      async getProject() { return project; },
      async withProjectWriteLock(_projectId, _operation, action) {
        lockHeld = true;
        try { return await action(); }
        finally { lockHeld = false; }
      }
    },
    runControlStore: {
      async readState() { return { status: "waiting_review" }; },
      async writeControl() { throw new Error("unused"); },
      async updateState() { throw new Error("unused"); },
      async readLatestControl() { return undefined; },
      async readResumeData() {
        return {
          runDir: "/runs/run-1", plan: { executionPolicy: { mode: "sandbox" } }, task: { prompt: "Continue" },
          projectTask: project.taskRecords[0],
          owner: { projectId: "project-1", taskId: "task-1", runId: "run-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-version-1" }
        };
      }
    },
    async startProjectRun(...args) { calls.push({ args, lockHeld }); return { runId: "run-1" }; }
  });

  await useCases.controlProjectRun("project-1", "run-1", "resume");
  assert.equal(calls[0].lockHeld, false);
});

test("Run resume is idempotent when the durable Run is already running", async () => {
  const { calls, useCases } = makeUseCases({ status: "running" });
  const result = await useCases.controlProjectRun("project-1", "run-1", "resume");
  assert.equal(result.idempotent, true);
  assert.deepEqual(calls.map(([kind]) => kind), ["readState"]);
});

test("Run resume rejects cancelled and terminal attempts", async () => {
  const { useCases } = makeUseCases({ status: "paused" }, { action: "cancel" });
  await assert.rejects(() => useCases.controlProjectRun("project-1", "run-1", "resume"), /RUN_RESUME_NOT_ALLOWED/);
  const terminal = makeUseCases({ status: "completed" });
  await assert.rejects(() => terminal.useCases.controlProjectRun("project-1", "run-1", "cancel"), /RUN_CONTROL_INVALID/);
});
