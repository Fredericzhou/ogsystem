import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRunQueryUseCases } from "../application/run-query-use-cases.mjs";
import { createFileRunQueryStore } from "../infrastructure/file-run-query-store.mjs";

test("Run detail resolves canonical ownership and waits for an active terminal worker before rereading the projection", async () => {
  const calls = [];
  let projectReads = 0;
  const useCases = createRunQueryUseCases({
    getProject: async () => {
      projectReads += 1;
      calls.push(`project-${projectReads}`);
      return {
        taskRecords: [{
          taskId: "task-1", projectId: "project-1", taskNumber: 3, currentRunId: "run-1", runIds: ["run-1"], runProjectId: "team-1", teamVersionId: "team-1",
          status: projectReads === 1 ? "running" : "completed", outputSummary: projectReads === 1 ? "old" : "latest"
        }]
      };
    },
    waitForActiveTaskWorker: async (projectId, taskId) => {
      calls.push(`wait-${projectId}-${taskId}`);
      return true;
    },
    runQueryStore: {
      readRunState: async (projectId, runId) => (calls.push(`state-${projectId}-${runId}`), { projectId: "runtime-team", status: "completed", attemptNumber: 1 }),
      readRunPlan: async (projectId, runId) => (calls.push(`plan-${projectId}-${runId}`), { projectId: "runtime-team", executionPolicy: { mode: "dry-run" } }),
      readRunEvents: async () => ({ events: [] })
    }
  });

  const run = await useCases.getProjectRun("project-1", "run-1");
  assert.deepEqual(calls, ["project-1", "state-team-1-run-1", "wait-project-1-task-1", "project-2", "plan-team-1-run-1"]);
  assert.equal(run.collaborationProjectId, "project-1");
  assert.equal(run.runtimeProjectId, "team-1");
  assert.equal(run.taskId, "task-1");
  assert.equal(Object.hasOwn(run, "projectId"), false);
  assert.equal(Object.hasOwn(run.state, "projectId"), false);
  assert.equal(Object.hasOwn(run.plan, "projectId"), false);
  assert.equal(Object.hasOwn(run.task, "projectId"), false);
  assert.equal(run.attemptNumber, 1);
  assert.equal(run.isCurrent, true);
  assert.equal(run.task.outputSummary, "latest");
});

test("Run events resolve canonical Task history and fall back to the collaboration workspace identity", async () => {
  const calls = [];
  const useCases = createRunQueryUseCases({
    getProject: async () => ({ taskRecords: [{ taskId: "task-2", currentRunId: "run-2", runIds: ["run-2"] }] }),
    waitForActiveTaskWorker: async () => { throw new Error("events must not wait for Task workers"); },
    runQueryStore: {
      readRunState: async () => undefined,
      readRunPlan: async () => undefined,
      readRunEvents: async (projectId, runId, options) => (calls.push([projectId, runId, options]), { events: [{ id: 1 }] })
    }
  });

  const events = await useCases.getProjectRunEvents("project-2", "run-2", { limit: 10 });
  assert.equal(events.runtimeProjectId, "project-2");
  assert.equal(events.teamVersionId, undefined);
  assert.equal(events.taskId, "task-2");
  assert.deepEqual(calls, [["project-2", "run-2", { limit: 10 }]]);
});

test("Run query rejects unowned Runs before artifact access and preserves storage failures", async () => {
  const useCases = createRunQueryUseCases({
    getProject: async () => ({ taskRecords: [] }),
    waitForActiveTaskWorker: async () => false,
    runQueryStore: {
      readRunState: async () => { throw new Error("state read failed"); },
      readRunPlan: async () => undefined,
      readRunEvents: async () => { throw new Error("events read failed"); }
    }
  });
  await assert.rejects(() => useCases.getProjectRun("project-3", "run-3"), /RUN_NOT_FOUND/);
  await assert.rejects(() => useCases.getProjectRun("project-3", "bad/run"), /runId is invalid/);
  const ownedUseCases = createRunQueryUseCases({
    getProject: async () => ({ taskRecords: [{ taskId: "task-3", currentRunId: "run-3", runIds: ["run-3"] }] }),
    waitForActiveTaskWorker: async () => false,
    runQueryStore: {
      readRunState: async () => { throw new Error("state read failed"); },
      readRunPlan: async () => undefined,
      readRunEvents: async () => { throw new Error("events read failed"); }
    }
  });
  await assert.rejects(() => ownedUseCases.getProjectRun("project-3", "run-3"), /state read failed/);
  await assert.rejects(() => ownedUseCases.getProjectRunEvents("project-3", "run-3"), /events read failed/);
});

test("file Run query store constrains project/run paths and preserves missing state errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-run-query-"));
  try {
    const store = createFileRunQueryStore({ projectsRoot: root });
    await assert.rejects(store.readRunState("../outside", "run-1"), /runtimeProjectId is invalid/);
    await assert.rejects(store.readRunState("team-1", "../outside"), /runId is invalid/);
    await assert.rejects(store.readRunState("team-1", "missing"), /Project not found/);
    await mkdir(join(root, "team-1", ".site"), { recursive: true });
    await writeFile(join(root, "team-1", ".site", "project.json"), JSON.stringify({ projectId: "team-1" }));
    await assert.rejects(store.readRunState("team-1", "missing"), /ENOENT/);
    const runDir = join(root, "team-1", ".ogs", "runs", "run-1");
    await mkdir(runDir, { recursive: true });
    await mkdir(join(runDir, "control"), { recursive: true });
    await writeFile(join(runDir, "control", "state.json"), JSON.stringify({ status: "completed" }));
    await writeFile(join(runDir, "run-plan.json"), JSON.stringify({ executionPolicy: { mode: "dry-run" } }));
    assert.deepEqual(await store.readRunState("team-1", "run-1"), { status: "completed" });
    assert.deepEqual(await store.readRunPlan("team-1", "run-1"), { executionPolicy: { mode: "dry-run" } });
    assert.equal(await store.readRunPlan("team-1", "missing"), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
