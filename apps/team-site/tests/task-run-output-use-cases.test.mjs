import assert from "node:assert/strict";
import test from "node:test";
import { createTaskRunOutputUseCases } from "../application/task-run-output-use-cases.mjs";

const project = { projectId: "project-a", workspaceId: "workspace-a" };
const entry = {
  releaseId: "private-record-id",
  taskId: "task-a",
  runId: "run-a",
  attemptNumber: 1,
  status: "published",
  releaseCommit: "abc123",
  outputDigest: "sha256:abc",
  createdAt: "2026-11-20T00:00:00.000Z"
};

test("Run output projections hide internal materialization record identity and state", async () => {
  const calls = [];
  const useCases = createTaskRunOutputUseCases({
    getProject: async () => project,
    outputStore: {
      list: async () => [entry],
      read: async (owner, id) => { calls.push(["read", owner, id]); return { manifest: { files: [{ path: "notes.md" }] } }; },
      listFiles: async (owner, id) => ({ files: [{ path: "notes.md" }] }),
      readFile: async (owner, id, path) => ({ releaseId: id, path, content: Buffer.from("notes") })
    }
  });

  const listed = await useCases.listProjectCollaborationOutputs(project.projectId);
  assert.deepEqual(listed.outputs[0], {
    taskId: "task-a", runId: "run-a", attemptNumber: 1, availability: "available",
    commit: "abc123", digest: "sha256:abc", createdAt: entry.createdAt
  });
  assert.equal("releaseId" in listed.outputs[0], false);
  assert.equal("status" in listed.outputs[0], false);
  assert.deepEqual(await useCases.getProjectRunOutput(project.projectId, "task-a", "run-a"), {
    ...listed.outputs[0], files: [{ path: "notes.md" }]
  });
  const file = await useCases.readProjectRunOutputFile(project.projectId, "task-a", "run-a", "notes.md");
  assert.equal(file.releaseId, undefined);
  assert.deepEqual(calls.map(([kind, owner, id]) => [kind, owner.projectId, id]), [["read", "project-a", "private-record-id"]]);
});

test("Run output reads fail closed for missing ownership and processing outputs", async () => {
  const useCases = createTaskRunOutputUseCases({
    getProject: async () => project,
    outputStore: { list: async () => [{ ...entry, status: "prepared" }] }
  });
  await assert.rejects(() => useCases.getProjectRunOutput(project.projectId, "task-a", "run-a"), /COLLABORATION_OUTPUT_NOT_AVAILABLE/);
  await assert.rejects(() => useCases.getProjectRunOutput(project.projectId, "other-task", "run-a"), /COLLABORATION_OUTPUT_NOT_FOUND/);
});

test("failed Workspace materialization is projected as unavailable, not processing", async () => {
  const useCases = createTaskRunOutputUseCases({
    getProject: async () => project,
    outputStore: { list: async () => [{ ...entry, status: "failed" }] }
  });
  const result = await useCases.listProjectCollaborationOutputs(project.projectId);
  assert.equal(result.outputs[0].availability, "unavailable");
  assert.equal("failureCode" in result.outputs[0], false);
  await assert.rejects(() => useCases.getProjectRunOutput(project.projectId, "task-a", "run-a"), /COLLABORATION_OUTPUT_NOT_AVAILABLE/);
});
