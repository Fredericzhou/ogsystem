import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withTaskCreationUseCases } from "./task-creation-test-helpers.mjs";

async function waitForTerminalTask(store, projectId, taskId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const task = await store.getProjectTask(projectId, taskId);
    if (["completed", "failed", "cancelled"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Task did not reach a terminal state in time.");
}

test("concurrent idempotent Task creation and start reserve one Task and one Run", { timeout: 60000 }, async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-task-concurrency-"));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTaskCreationUseCases(await import(`../infrastructure/file-project-store.mjs?task-concurrency=${Date.now()}-${Math.random()}`));

  try {
    const teamDraft = await store.createProject({
      name: "Task Concurrency Team",
      overview: "Ensure concurrent Task requests have deterministic reservations.",
      templateId: "empty"
    });
    const team = await store.confirmProjectTeam(teamDraft.projectId, { release: true });
    const project = await store.createCollaborationProject({
      name: "Task Concurrency Project",
      overview: "Exercise durable Task and Run idempotency.",
      teamVersionIds: [team.teamVersionId]
    });

    const creationRequest = {
      input: "Create one Task despite concurrent retries.",
      teamVersionId: team.teamVersionId,
      idempotencyKey: "same-task-request"
    };
    const created = await Promise.all([
      store.createProjectTask(project.projectId, creationRequest),
      store.createProjectTask(project.projectId, creationRequest)
    ]);
    assert.equal(created[0].taskId, created[1].taskId);
    assert.equal((await store.getProject(project.projectId)).taskRecords.length, 1);

    const starts = await Promise.all([
      store.startProjectTask(project.projectId, created[0].taskId, { mode: "dry-run", idempotencyKey: "same-attempt" }),
      store.startProjectTask(project.projectId, created[0].taskId, { mode: "dry-run", idempotencyKey: "same-attempt" })
    ]);
    assert.equal(starts[0].currentRunId, starts[1].currentRunId);
    assert.equal(starts[0].runIds.length, 1);

    const completed = await waitForTerminalTask(store, project.projectId, created[0].taskId);
    assert.equal(completed.runIds.length, 1);
    assert.equal(completed.currentRunId, completed.runIds[0]);
    const runRoot = join(project.workdir, ".ogs", "runs");
    const runDirectories = await readdir(runRoot);
    assert.equal(runDirectories.filter((runId) => runId === completed.currentRunId).length, 1);
    await assert.rejects(access(join(team.workdir, ".ogs", "runs", completed.currentRunId)), { code: "ENOENT" });

    await assert.rejects(
      () => store.startProjectTask(project.projectId, created[0].taskId, { mode: "sandbox", idempotencyKey: "same-attempt" }),
      /IDEMPOTENCY_KEY_REUSE/
    );
  } finally {
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("concurrent distinct Task creation allocates unique monotonic numbers and does not reuse deleted numbers", { timeout: 60000 }, async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-task-number-concurrency-"));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTaskCreationUseCases(await import(`../infrastructure/file-project-store.mjs?task-number-concurrency=${Date.now()}-${Math.random()}`));

  try {
    const teamDraft = await store.createProject({ name: "Task Number Team", overview: "A team for task numbering." });
    const team = await store.confirmProjectTeam(teamDraft.projectId, { release: true });
    const project = await store.createCollaborationProject({ name: "Task Number Project", overview: "Allocate readable task numbers.", teamVersionIds: [team.teamVersionId] });
    const tasks = await Promise.all(Array.from({ length: 8 }, (_, index) => store.createProjectTask(project.projectId, {
      input: `Task ${index + 1}`,
      teamVersionId: team.teamVersionId,
      idempotencyKey: `task-number-${index + 1}`
    })));
    assert.deepEqual(tasks.map((task) => task.taskNumber).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
    await store.deleteProjectTask(project.projectId, tasks[3].taskId);
    const next = await store.createProjectTask(project.projectId, { input: "After deletion", teamVersionId: team.teamVersionId });
    assert.equal(next.taskNumber, 9);
  } finally {
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
