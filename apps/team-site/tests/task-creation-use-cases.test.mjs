import assert from "node:assert/strict";
import test from "node:test";
import { createTaskCreationUseCases } from "../application/task-creation-use-cases.mjs";

function setup({ project, taskId = "task-1", validateRunInputAttachments } = {}) {
  const current = structuredClone(project || {
    projectId: "project-1",
    projectType: "collaboration",
    nextTaskNumber: 1,
    mountedTeams: [{ teamId: "team-1", teamVersionId: "team-1", teamVersionNumber: 1, teamName: "Software Team", teamIrSemanticDigest: "a".repeat(64), compiledPlanDigest: "b".repeat(64), compilerSemanticsVersion: "team-ir-v2/1" }],
    taskRecords: []
  });
  const calls = [];
  const useCases = createTaskCreationUseCases({
    projectStore: {
      async getProject() { return structuredClone(current); },
      async withProjectWriteLock(projectId, operation, action) { calls.push(["lock", projectId, operation]); return action(); },
      async saveProjectMetadata(projectId, next) { calls.push(["save", projectId, next]); Object.assign(current, next); }
    },
    taskStore: { createTaskId: () => taskId },
    fingerprintRequest: (request) => `fingerprint:${request}`,
    validateRunInputAttachments
  });
  return { useCases, calls, current };
}

test("Task creation records a queued Task with no Run and a normalized request", async () => {
  const { useCases, current } = setup();
  const task = await useCases.createProjectTask("project-1", {
    input: "  Plan the first release.  ",
    teamVersionId: "team-1",
    idempotencyKey: "request-1"
  });
  assert.equal(task.status, "queued");
  assert.equal(task.compiledPlanDigest, "b".repeat(64));
  assert.equal(task.teamIrSemanticDigest, "a".repeat(64));
  assert.equal(task.taskNumber, 1);
  assert.equal(task.input, "Plan the first release.");
  assert.equal(task.currentRunId, null);
  assert.deepEqual(task.runIds, []);
  assert.ok(Number.isFinite(Date.parse(task.createdAt)));
  assert.equal(current.taskRecords.length, 1);
});

test("Task creation replays an identical idempotency key and rejects changed input", async () => {
  const { useCases } = setup();
  const request = { input: "Plan the first release.", teamVersionId: "team-1", idempotencyKey: "request-1" };
  const first = await useCases.createProjectTask("project-1", request);
  const replay = await useCases.createProjectTask("project-1", request);
  assert.equal(replay.taskId, first.taskId);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.taskNumber, first.taskNumber);
  assert.equal((await useCases.createProjectTask("project-1", request)).taskNumber, 1);
  await assert.rejects(() => useCases.createProjectTask("project-1", { ...request, input: "Changed request" }), /IDEMPOTENCY_KEY_REUSE/);
});

test("Task numbers increment independently of deleted records and are required on latest-format projects", async () => {
  const { useCases, current } = setup();
  const first = await useCases.createProjectTask("project-1", { input: "First", teamVersionId: "team-1" });
  current.taskRecords = [];
  const second = await useCases.createProjectTask("project-1", { input: "Second", teamVersionId: "team-1" });
  assert.equal(first.taskNumber, 1);
  assert.equal(second.taskNumber, 2);
  assert.equal(current.nextTaskNumber, 3);
  const unsupported = setup({ project: { projectId: "project-1", projectType: "collaboration", mountedTeams: [{ teamId: "team-1", teamVersionId: "team-1", teamIrSemanticDigest: "a".repeat(64), compiledPlanDigest: "b".repeat(64) }], taskRecords: [] } });
  await assert.rejects(() => unsupported.useCases.createProjectTask("project-1", { input: "Old schema", teamVersionId: "team-1" }), /PROJECT_SCHEMA_UNSUPPORTED/);
});

test("Task creation requires a mounted canonical TeamVersion and valid input", async () => {
  const { useCases } = setup();
  await assert.rejects(() => useCases.createProjectTask("project-1", { input: "", teamVersionId: "team-1" }), /Task input/);
  await assert.rejects(() => useCases.createProjectTask("project-1", { input: "Request", teamVersionId: "team-2" }), /TEAM_VERSION_NOT_MOUNTED/);
  await assert.rejects(() => useCases.createProjectTask("project-1", { input: "Request", teamVersionId: "case:software-team" }), /TEAM_VERSION_ID_INVALID/);
  const { useCases: empty } = setup({ project: { projectId: "project-1", projectType: "collaboration", mountedTeams: [], taskRecords: [] } });
  await assert.rejects(() => empty.createProjectTask("project-1", { input: "Request", teamVersionId: "team-1" }), /PROJECT_TEAM_REQUIRED/);
});

test("Task creation binds each task to the selected mounted team version", async () => {
  const { useCases } = setup({ project: {
    projectId: "project-1",
    projectType: "collaboration",
    nextTaskNumber: 1,
    mountedTeams: [
      { teamId: "team-1", teamVersionId: "team-1", teamVersionNumber: 1, teamName: "Software Team", teamIrSemanticDigest: "a".repeat(64), compiledPlanDigest: "b".repeat(64) },
      { teamId: "team-2", teamVersionId: "team-2-v3", teamVersionNumber: 3, teamName: "Research Team", teamIrSemanticDigest: "c".repeat(64), compiledPlanDigest: "d".repeat(64) }
    ],
    taskRecords: []
  } });
  const task = await useCases.createProjectTask("project-1", { input: "Research the market", teamVersionId: "team-2-v3" });
  assert.equal(task.teamId, "team-2");
  assert.equal(task.teamVersionId, "team-2-v3");
  assert.equal(task.teamVersionNumber, 3);
  assert.equal(task.compiledPlanDigest, "d".repeat(64));
});

test("Task creation freezes validated Artifact slot references and includes them in idempotency", async () => {
  const reference = { artifactId: `art_${"a".repeat(36)}`, mediaType: "text/plain" };
  const { useCases } = setup({ validateRunInputAttachments: async ({ project, team, attachments }) => {
    assert.equal(project.projectId, "project-1");
    assert.equal(team.teamVersionId, "team-1");
    return structuredClone(attachments);
  } });
  const request = { input: "Read the brief", teamVersionId: "team-1", attachments: { brief: reference }, idempotencyKey: "artifact-task" };
  const task = await useCases.createProjectTask("project-1", request);
  assert.deepEqual(task.runInputAttachments, { brief: reference });
  assert.deepEqual((await useCases.createProjectTask("project-1", request)).runInputAttachments, { brief: reference });
  await assert.rejects(() => useCases.createProjectTask("project-1", {
    ...request, attachments: { brief: { ...reference, artifactId: `art_${"b".repeat(36)}` } }
  }), /IDEMPOTENCY_KEY_REUSE/);
});

test("Task creation refuses unregistered Artifact references when no validator is configured", async () => {
  const { useCases } = setup();
  await assert.rejects(() => useCases.createProjectTask("project-1", {
    input: "Read the brief", teamVersionId: "team-1", attachments: { brief: { artifactId: `art_${"a".repeat(36)}`, mediaType: "text/plain" } }
  }), /TASK_ARTIFACT_VALIDATION_UNAVAILABLE/);
});

test("Task creation rejects legacy mounts without frozen Team IR v2 digests", async () => {
  const legacy = setup({ project: {
    projectId: "project-1", projectType: "collaboration", nextTaskNumber: 1,
    mountedTeams: [{ teamId: "team-1", teamVersionId: "team-1", teamVersionNumber: 1, teamName: "Legacy" }], taskRecords: []
  } });
  await assert.rejects(() => legacy.useCases.createProjectTask("project-1", { input: "Run legacy", teamVersionId: "team-1" }), /TEAM_IR_V2_REQUIRED/);
});
