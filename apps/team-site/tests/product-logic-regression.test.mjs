import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function withStore(prefix, callback) {
  const projectsRoot = await mkdtemp(join(tmpdir(), `ogs-site-${prefix}-`));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?product-logic=${prefix}-${Date.now()}-${Math.random()}`);
  try {
    return await callback(store, projectsRoot);
  } finally {
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
    await rm(projectsRoot, { recursive: true, force: true });
  }
}

async function createReleasedTeam(store, name) {
  const team = await store.createProject({ name, overview: `Product logic for ${name}.`, templateId: "minimal" });
  return store.confirmProjectTeam(team.projectId, { release: true });
}

async function waitForTerminal(store, projectId, runId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await store.getProjectRun(projectId, runId);
    if (["completed", "failed", "cancelled"].includes(run.state.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Run did not reach a terminal state in time.");
}

test("Natural and Professional design paths share one validated, publishable team definition", async () => {
  await withStore("team-design", async (store) => {
    const draft = await store.createProject({ name: "Shared Design Team", overview: "Turn a brief into a reviewed recommendation.", templateId: "minimal" });
    const naturalDesign = await store.getProjectDesign(draft.projectId);
    assert.equal((await store.validateProjectDesign(draft.projectId, { authoring: naturalDesign.authoring })).ok, true);

    const professionalSave = await store.saveProjectDesign(draft.projectId, {
      authoring: naturalDesign.authoring,
      expectedProjectDigest: naturalDesign.projectDigest
    });
    assert.equal(professionalSave.projectStatus, "draft");
    assert.equal(professionalSave.authoring.version, naturalDesign.authoring.version);

    const released = await store.confirmProjectTeam(draft.projectId, { release: true });
    assert.equal(released.teamVersionStatus, "released");
    assert.match(released.teamCoreDigest, /^[a-f0-9]{64}$/);
  });
});

test("task creation requires the selected team to be mounted instead of silently switching teams", async () => {
  await withStore("task-selection", async (store) => {
    const mounted = await createReleasedTeam(store, "Mounted Task Team");
    const other = await createReleasedTeam(store, "Other Task Team");
    const project = await store.createCollaborationProject({
      name: "Explicit Task Team Project",
      overview: "Each task must execute with the selected mounted team.",
      teamVersionIds: [mounted.projectId]
    });

    await assert.rejects(
      () => store.createProjectTask(project.projectId, { input: "Use an unknown team.", teamVersionId: other.projectId }),
      /TEAM_VERSION_NOT_MOUNTED/
    );
    await assert.rejects(
      () => store.createProjectTask(project.projectId, { input: "Omit the team." }),
      /TEAM_VERSION_REQUIRED/
    );
    assert.equal((await store.getProject(project.projectId)).taskRecords.length, 0);

    const task = await store.createProjectTask(project.projectId, {
      input: "Use the mounted team.",
      teamVersionId: mounted.projectId,
      idempotencyKey: "explicit-mounted-team"
    });
    assert.equal(task.teamVersionId, mounted.projectId);
  });
});

test("batch project materials are all-or-nothing and preserve relative paths", async () => {
  await withStore("materials-atomicity", async (store) => {
    const team = await createReleasedTeam(store, "Materials Team");
    const project = await store.createCollaborationProject({ name: "Materials Product Project", teamVersionIds: [team.projectId] });
    await assert.rejects(
      () => store.addProjectMaterials(project.projectId, [
        { filename: "brief/valid.md", content: "valid", contentType: "text/markdown" },
        { filename: "brief/invalid.exe", content: "must not be stored", contentType: "application/octet-stream" }
      ]),
      /Only md, txt, json, yaml, yml, and csv materials are supported/
    );
    const afterFailure = await store.getProject(project.projectId);
    assert.deepEqual(afterFailure.materials.materials, []);
    const materialRootEntries = await readdir(join(project.workdir, "workspace", "files")).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
    assert.deepEqual(materialRootEntries.filter((entry) => entry !== ".gitkeep"), []);

    const accepted = await store.addProjectMaterials(project.projectId, [
      { filename: "brief/source.md", content: "source", contentType: "text/markdown" },
      { filename: "brief/data.json", content: "{}", contentType: "application/json" }
    ]);
    assert.deepEqual(accepted.map((item) => item.filename), ["brief/source.md", "brief/data.json"]);
    assert.ok(accepted.every((item) => item.path.includes("/brief/")));
  });
});

test("a persisted pre-materialization built-in mount is repaired before the first task run", async () => {
  await withStore("legacy-built-in", async (store) => {
    const project = await store.createCollaborationProject({ name: "Persisted Built-in Project", teamVersionIds: ["case:software-team"] });
    const projectMetaPath = join(project.workdir, ".site", "project.json");
    const metadata = JSON.parse(await readFile(projectMetaPath, "utf8"));
    const legacyMount = { ...metadata.mountedTeams[0], teamVersionId: "case:software-team", teamId: "case:software-team", builtIn: true };
    await writeFile(projectMetaPath, JSON.stringify({ ...metadata, mountedTeams: [legacyMount] }, null, 2) + "\n", "utf8");
    const task = await store.createProjectTask(project.projectId, {
      input: "Run the persisted built-in team.",
      teamVersionId: "case:software-team",
      idempotencyKey: "legacy-built-in-run"
    });

    const started = await store.startProjectTask(project.projectId, task.taskId, { mode: "dry-run" });
    assert.equal(started.status, "planning");
    const repaired = await store.getProject(project.projectId);
    const repairedTask = repaired.taskRecords.find((item) => item.taskId === task.taskId);
    assert.ok(repairedTask && !repairedTask.teamVersionId.startsWith("case:"));
    assert.ok(repaired.mountedTeams.every((item) => !item.teamVersionId.startsWith("case:")));
    await waitForTerminal(store, project.projectId, started.runId);
  });
});
