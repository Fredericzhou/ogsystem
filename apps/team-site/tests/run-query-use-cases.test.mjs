import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
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
        projectType: "collaboration",
        taskRecords: [{
          taskId: "task-1", projectId: "project-1", taskNumber: 3, currentRunId: "run-1", runIds: ["run-1"], teamVersionId: "team-1",
          status: projectReads === 1 ? "running" : "completed", outputSummary: projectReads === 1 ? "old" : "latest"
        }]
      };
    },
    waitForActiveTaskWorker: async (projectId, taskId) => {
      calls.push(`wait-${projectId}-${taskId}`);
      return true;
    },
    runQueryStore: {
      readRunOwner: async () => ({ taskNumber: 3, attemptNumber: 1, teamVersionId: "team-1", teamCoreDigest: "a".repeat(64) }),
      readRunState: async (projectId, taskId, runId) => (calls.push(`state-${projectId}-${taskId}-${runId}`), { projectId: "project-1", status: "completed", attemptNumber: 1 }),
      readRunPlan: async (projectId, taskId, runId) => (calls.push(`plan-${projectId}-${taskId}-${runId}`), { projectId: "project-1", executionPolicy: { mode: "dry-run" } }),
      readRunEvents: async () => ({ events: [] })
    }
  });

  const run = await useCases.getProjectRun("project-1", "task-1", "run-1");
  assert.deepEqual(calls, ["project-1", "state-project-1-task-1-run-1", "wait-project-1-task-1", "project-2", "plan-project-1-task-1-run-1"]);
  assert.equal(run.runKind, "project_task");
  assert.equal(run.owner.projectId, "project-1");
  assert.equal(run.owner.teamVersionId, "team-1");
  assert.equal(run.owner.teamCoreDigest, "a".repeat(64));
  assert.equal(run.taskId, "task-1");
  assert.equal(Object.hasOwn(run, "projectId"), false);
  assert.equal(Object.hasOwn(run.state, "projectId"), false);
  assert.equal(Object.hasOwn(run.plan, "projectId"), false);
  assert.equal(Object.hasOwn(run.task, "projectId"), false);
  assert.equal(run.attemptNumber, 1);
  assert.equal(run.isCurrent, true);
  assert.equal(run.task.outputSummary, "latest");
});

test("Run events reject Task records without a fixed TeamVersion owner", async () => {
  const calls = [];
  const useCases = createRunQueryUseCases({
    getProject: async () => ({ taskRecords: [{ taskId: "task-2", currentRunId: "run-2", runIds: ["run-2"] }] }),
    waitForActiveTaskWorker: async () => { throw new Error("events must not wait for Task workers"); },
    runQueryStore: {
      readRunOwner: async () => ({ attemptNumber: 1, teamVersionId: "project-2" }),
      readRunState: async () => undefined,
      readRunPlan: async () => undefined,
      readRunEvents: async (projectId, taskId, runId, options) => (calls.push([projectId, taskId, runId, options]), { events: [{ id: 1 }] })
    }
  });

  await assert.rejects(() => useCases.getProjectRunEvents("project-2", "task-2", "run-2", { limit: 10 }), /fixed TeamVersion owner/);
  assert.deepEqual(calls, []);
});

test("Run query rejects unowned Runs before artifact access and preserves storage failures", async () => {
  const useCases = createRunQueryUseCases({
    getProject: async () => ({ taskRecords: [] }),
    waitForActiveTaskWorker: async () => false,
    runQueryStore: {
      readRunOwner: async () => { throw new Error("owner read failed"); },
      readRunState: async () => { throw new Error("state read failed"); },
      readRunPlan: async () => undefined,
      readRunEvents: async () => { throw new Error("events read failed"); }
    }
  });
  await assert.rejects(() => useCases.getProjectRun("project-3", "task-3", "run-3"), /RUN_NOT_FOUND/);
  await assert.rejects(() => useCases.getProjectRun("project-3", "task-3", "bad/run"), /runId is invalid/);
  const ownedUseCases = createRunQueryUseCases({
    getProject: async () => ({ taskRecords: [{ taskId: "task-3", taskNumber: 1, currentRunId: "run-3", runIds: ["run-3"], teamVersionId: "team-3" }] }),
    waitForActiveTaskWorker: async () => false,
    runQueryStore: {
      readRunOwner: async () => ({ taskNumber: 1, attemptNumber: 1, teamVersionId: "team-3" }),
      readRunState: async () => { throw new Error("state read failed"); },
      readRunPlan: async () => undefined,
      readRunEvents: async () => { throw new Error("events read failed"); }
    }
  });
  await assert.rejects(() => ownedUseCases.getProjectRun("project-3", "task-3", "run-3"), /state read failed/);
  await assert.rejects(() => ownedUseCases.getProjectRunEvents("project-3", "task-3", "run-3"), /events read failed/);
  await assert.rejects(() => ownedUseCases.getProjectRun("project-3", "different-task", "run-3"), /RUN_NOT_FOUND/);
});

test("file Run query store constrains project/run paths and preserves missing state errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-run-query-"));
  try {
    const store = createFileRunQueryStore({ projectsRoot: root });
    await assert.rejects(store.readRunState("../outside", "task-1", "run-1"), /projectId is invalid/);
    await assert.rejects(store.readRunState("project-1", "task-1", "../outside"), /runId is invalid/);
    await assert.rejects(store.readRunState("project-1", "task-1", "missing"), /Project not found/);
    await mkdir(join(root, "project-1", ".site"), { recursive: true });
    await mkdir(join(root, "project-1", ".ogs", "runs", "run-1"), { recursive: true });
    const task = { taskId: "task-1", taskNumber: 1, currentRunId: "run-1", runIds: ["run-1"], teamVersionId: "team-1" };
    await writeFile(join(root, "project-1", ".site", "project.json"), JSON.stringify({ projectId: "project-1", projectType: "collaboration", taskRecords: [task] }));
    const runDir = join(root, "project-1", ".ogs", "runs", "run-1");
    await mkdir(runDir, { recursive: true });
    await mkdir(join(runDir, "control"), { recursive: true });
    await writeFile(join(runDir, "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId: "project-1", taskId: "task-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-1", runId: "run-1" }));
    await writeFile(join(runDir, "control", "state.json"), JSON.stringify({ status: "completed" }));
    await writeFile(join(runDir, "run-plan.json"), JSON.stringify({ executionPolicy: { mode: "dry-run" } }));
    assert.deepEqual(await store.readRunState("project-1", "task-1", "run-1"), { status: "completed" });
    assert.deepEqual(await store.readRunPlan("project-1", "task-1", "run-1"), { executionPolicy: { mode: "dry-run" } });
    await assert.rejects(store.readRunPlan("project-1", "task-1", "missing"), /RUN_NOT_FOUND/);
    await writeFile(join(root, "project-1", ".site", "project.json"), JSON.stringify({ projectId: "project-1", projectType: "team", taskRecords: [task] }));
    await assert.rejects(store.readRunState("project-1", "task-1", "run-1"), /owned by Collaboration Projects/);
    await writeFile(join(root, "project-1", ".site", "project.json"), JSON.stringify({ projectId: "project-1", projectType: "collaboration", taskRecords: [task] }));
    await writeFile(join(runDir, "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId: "another-project", taskId: "task-1", teamVersionId: "team-1", runId: "run-1" }));
    await assert.rejects(store.readRunState("project-1", "task-1", "run-1"), /does not match this Project/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file Run query store rejects a linked Collaboration Project workspace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ogs-run-query-link-"));
  const outside = join(root, "outside-project");
  try {
    await mkdir(join(outside, ".site"), { recursive: true });
    await mkdir(join(outside, ".ogs", "runs", "run-1"), { recursive: true });
    const task = { taskId: "task-1", taskNumber: 1, currentRunId: "run-1", runIds: ["run-1"], teamVersionId: "team-1" };
    await writeFile(join(outside, ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [task] }));
    await writeFile(join(outside, ".ogs", "runs", "run-1", "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId: "project-1", taskId: "task-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-1", runId: "run-1" }));
    try {
      await symlink(outside, join(root, "project-1"), "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code)) return t.skip(`directory links unavailable: ${error.code}`);
      throw error;
    }
    const store = createFileRunQueryStore({ projectsRoot: root });
    await assert.rejects(store.readRunState("project-1", "task-1", "run-1"), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file Run query store rejects linked state, plan, and event evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ogs-run-query-evidence-link-"));
  try {
    const projectRoot = join(root, "project-1");
    const runDir = join(projectRoot, ".ogs", "runs", "run-1");
    await mkdir(join(projectRoot, ".site"), { recursive: true });
    await mkdir(join(runDir, "control"), { recursive: true });
    const task = { taskId: "task-1", taskNumber: 1, currentRunId: "run-1", runIds: ["run-1"], teamVersionId: "team-1" };
    await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [task] }));
    await writeFile(join(runDir, "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId: "project-1", taskId: "task-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-1", runId: "run-1" }));
    const outside = join(root, "outside.json");
    await writeFile(outside, JSON.stringify({ status: "completed" }));
    const linked = [
      [join(runDir, "control", "state.json"), () => createFileRunQueryStore({ projectsRoot: root }).readRunState("project-1", "task-1", "run-1")],
      [join(runDir, "run-plan.json"), () => createFileRunQueryStore({ projectsRoot: root }).readRunPlan("project-1", "task-1", "run-1")],
      [join(runDir, "timeline.jsonl"), () => createFileRunQueryStore({ projectsRoot: root }).readRunEvents("project-1", "task-1", "run-1")]
    ];
    for (const [path, read] of linked) {
      try {
        await symlink(outside, path, "file");
      } catch (error) {
        if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code)) return t.skip(`file links unavailable: ${error.code}`);
        throw error;
      }
      await assert.rejects(read(), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
      await rm(path);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
