import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function waitForTerminal(store, projectId, runId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await store.getProjectRun(projectId, runId);
    if (["completed", "failed", "cancelled"].includes(run.state.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Run did not reach a terminal state in time.");
}

test("collaboration project creation, batch materials, export, and async run reservation", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-contract-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?contract-test=${Date.now()}`);
  try {
    const team = await store.createProject({ name: "Contract Team", overview: "Review a brief.", templateId: "empty" });
    await store.confirmProjectTeam(team.projectId, { release: true });
    const releasedTeam = await store.getProject(team.projectId);
    assert.match(releasedTeam.teamCoreDigest, /^[a-f0-9]{64}$/);
    const renamedTeam = await store.updateProject(team.projectId, { name: "Renamed Contract Team" });
    assert.equal(renamedTeam.teamCoreDigest, releasedTeam.teamCoreDigest);
    const project = await store.createCollaborationProject({
      name: "Contract Project",
      overview: "Project overview",
      teamVersionIds: [team.projectId]
    });
    assert.equal(project.mountedTeams.length, 1);
    assert.equal(project.overview, "Project overview");
    assert.match(project.projectDefinitionDigest, /^[a-f0-9]{64}$/);

    const materials = await store.addProjectMaterials(project.projectId, [
      { filename: "brief/notes.md", content: "# Notes", contentType: "text/markdown" },
      { filename: "data.json", content: "{\"ok\":true}", contentType: "application/json" }
    ]);
    assert.deepEqual(materials.map((item) => item.filename), ["brief/notes.md", "data.json"]);
    assert.ok(materials.every((item) => item.path.startsWith("workspace/files/")));

    const bundle = await store.exportProjectBundle(project.projectId);
    assert.equal(bundle.mode, "project-v1");
    assert.equal(bundle.project.materials.length, 2);
    assert.equal(typeof bundle.project.projectDefinitionDigest, "string");
    assert.equal(bundle.packageDigest.length, 64);
    assert.equal(bundle.project.projectDefinitionDigest, (await store.getProject(project.projectId)).projectDefinitionDigest);

    const task = await store.createProjectTask(project.projectId, {
      input: "Summarize the brief.",
      teamVersionId: team.projectId,
      idempotencyKey: "contract-run"
    });
    const reserved = await store.startProjectTask(project.projectId, task.taskId, { mode: "dry-run" });
    assert.equal(reserved.status, "planning");
    assert.ok(reserved.runId);
    const observed = await store.getProjectRun(project.projectId, reserved.runId);
    assert.equal(observed.state.status, "planning");
    await waitForTerminal(store, project.projectId, reserved.runId);
    assert.equal((await store.getProjectTask(project.projectId, task.taskId)).runId, reserved.runId);
    assert.ok(Array.isArray((await store.getProjectRunEvents(project.projectId, reserved.runId)).events));
    await assert.rejects(
      () => store.controlProjectTask(project.projectId, task.taskId, "stop"),
      /TASK_CONTROL_INVALID/
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("invalid atomic project creation does not create a project directory", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-atomic-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?atomic-test=${Date.now()}`);
  try {
    await assert.rejects(
      () => store.createCollaborationProject({ name: "Should Roll Back", teamVersionIds: ["missing-team"] }),
      /Project not found|TEAM_NOT_FOUND|TEAM_VERSION_NOT_RELEASED/
    );
    const entries = await readdir(projectsRoot);
    assert.equal(entries.filter((entry) => entry !== ".site").length, 0);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
