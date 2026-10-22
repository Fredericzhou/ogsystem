import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRunResultUseCases } from "../application/run-result-use-cases.mjs";
import { createFileRunResultStore } from "../infrastructure/file-run-result-store.mjs";

test("Run result use case reads only final output and returns unavailable when absent", async () => {
  const runs = new Map([
    ["run-1", { runKind: "project_task", owner: { kind: "project_task", projectId: "collaboration-1", taskId: "task-1", teamVersionId: "team-1", attemptNumber: 2 }, teamVersionId: "team-1", taskId: "task-1", runId: "run-1", attemptNumber: 2 }],
    ["run-2", { runKind: "project_task", owner: { kind: "project_task", projectId: "collaboration-1", taskId: "task-1", teamVersionId: "team-1", attemptNumber: 3 }, teamVersionId: "team-1", taskId: "task-1", runId: "run-2", attemptNumber: 3 }]
  ]);
  const runResultStore = { readFinalOutput: async (run) => run.runId === "run-1" ? "  complete output  " : undefined };
  const useCases = createRunResultUseCases({ getRun: async (_projectId, _taskId, runId) => runs.get(runId), runResultStore });

  const first = await useCases.getProjectRunResult("collaboration-1", "task-1", "run-1");
  assert.equal(first.runKind, "project_task");
  assert.deepEqual(first.owner, { kind: "project_task", projectId: "collaboration-1", taskId: "task-1", taskNumber: undefined, attemptNumber: 2, teamVersionId: "team-1" });
  assert.equal(first.runId, "run-1");
  assert.equal(first.available, true);
  assert.deepEqual(first.result, { finalOutput: "  complete output  " });
  const second = await useCases.getProjectRunResult("collaboration-1", "task-1", "run-2");
  assert.equal(second.runKind, "project_task");
  assert.equal(second.owner.projectId, "collaboration-1");
  assert.equal(second.available, false);
  assert.equal(second.result, null);
});

test("file Run result store reads only graph final output and redacts credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-run-result-"));
  const statePath = join(root, "project-1", ".ogs", "runs", "run-1", "state.json");
  try {
    await mkdir(join(root, "project-1", ".site"), { recursive: true });
    await mkdir(join(root, "project-1", ".ogs", "runs", "run-1"), { recursive: true });
    await mkdir(join(root, "project-1", ".ogs", "runs", "missing"), { recursive: true });
    const task = { taskId: "task-1", taskNumber: 1, currentRunId: "run-1", runIds: ["run-1", "missing"], teamVersionId: "team-1" };
    await writeFile(join(root, "project-1", ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [task] }), "utf8");
    for (const runId of ["run-1", "missing"]) {
      await writeFile(join(root, "project-1", ".ogs", "runs", runId, "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId: "project-1", taskId: "task-1", taskNumber: 1, attemptNumber: runId === "run-1" ? 1 : 2, teamVersionId: "team-1", runId }), "utf8");
    }
    await writeFile(statePath, JSON.stringify({
      graphState: { finalOutput: "Authorization: Bearer abcdefghijklmnop" },
      privateRuntimeField: "must not escape"
    }), "utf8");
    const store = createFileRunResultStore({ projectsRoot: root });
    const owner = { kind: "project_task", projectId: "project-1", taskId: "task-1" };
    assert.match(await store.readFinalOutput({ owner, taskId: "task-1", runId: "run-1" }), /\[REDACTED\]/);
    assert.equal(await store.readFinalOutput({ owner, taskId: "task-1", runId: "missing" }), undefined);
    await assert.rejects(store.readFinalOutput({ owner: { ...owner, projectId: "../outside" }, taskId: "task-1", runId: "run-1" }), /projectId is invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file Run result store rejects linked final-output evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ogs-run-result-link-"));
  try {
    const projectRoot = join(root, "project-1");
    const runDir = join(projectRoot, ".ogs", "runs", "run-1");
    await mkdir(join(projectRoot, ".site"), { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [{ taskId: "task-1", taskNumber: 1, runIds: ["run-1"], teamVersionId: "team-1" }] }));
    await writeFile(join(runDir, "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId: "project-1", taskId: "task-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-1", runId: "run-1" }));
    const outside = join(root, "outside.json");
    await writeFile(outside, JSON.stringify({ graphState: { finalOutput: "outside secret" } }));
    try {
      await symlink(outside, join(runDir, "state.json"), "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code)) return t.skip(`file links unavailable: ${error.code}`);
      throw error;
    }
    await assert.rejects(createFileRunResultStore({ projectsRoot: root }).readFinalOutput({ owner: { kind: "project_task", projectId: "project-1", taskId: "task-1" }, taskId: "task-1", runId: "run-1" }), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
