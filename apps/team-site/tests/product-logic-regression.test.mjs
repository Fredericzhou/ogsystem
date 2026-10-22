import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTeamDesignUseCasesForStore } from "./team-design-test-helpers.mjs";
import { withRunQueryUseCases } from "./run-query-test-helpers.mjs";
import { withProjectMaterialUseCases } from "./project-material-test-helpers.mjs";

async function withStore(prefix, callback) {
  const projectsRoot = await mkdtemp(join(tmpdir(), `ogs-site-${prefix}-`));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const repository = await import(`../infrastructure/file-project-store.mjs?product-logic=${prefix}-${Date.now()}-${Math.random()}`);
  const store = withProjectMaterialUseCases(withRunQueryUseCases(repository, projectsRoot));
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
    const project = await store.getProject(projectId);
    const task = project.taskRecords.find((record) => record.currentRunId === runId || record.runIds?.includes(runId));
    assert.ok(task, `Task owner not found for Run ${runId}`);
    const run = await store.getProjectRun(projectId, task.taskId, runId);
    if (["completed", "failed", "cancelled"].includes(run.state.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Run did not reach a terminal state in time.");
}

test("built-in provisioning creates stable persisted TeamVersion identities", async () => {
  await withStore("builtin-provisioning", async (store) => {
    const first = await store.provisionBuiltInTeamVersions();
    const listed = await store.listTeamRepository();
    assert.ok(first.length > 0);
    assert.ok(first.every((team) => team.teamVersionId === team.projectId && !team.teamVersionId.startsWith("case:")));
    assert.equal(listed.filter((team) => team.builtIn).length, first.length);
    assert.equal(new Set(listed.filter((team) => team.builtIn).map((team) => team.teamVersionId)).size, first.length);

    const second = await store.provisionBuiltInTeamVersions();
    assert.deepEqual(second.map((team) => team.teamVersionId), first.map((team) => team.teamVersionId));
  });
});

test("Natural and Professional design paths share one validated, publishable team definition", async () => {
  await withStore("team-design", async (store) => {
    const draft = await store.createProject({ name: "Shared Design Team", overview: "Turn a brief into a reviewed recommendation.", templateId: "minimal" });
    const designUseCases = createTeamDesignUseCasesForStore(store);
    const naturalDesign = await designUseCases.getTeamDesign(draft.projectId);
    assert.equal((await designUseCases.validateTeamDesign(draft.projectId, { authoring: naturalDesign.authoring })).ok, true);

    const roleId = Object.keys(naturalDesign.authoring.roles)[0];
    const authoredDraft = {
      ...naturalDesign.authoring,
      roles: {
        ...naturalDesign.authoring.roles,
        [roleId]: { ...naturalDesign.authoring.roles[roleId], title: "Round-trip role title", contextMap: { brief: "global.task" } }
      }
    };
    const professionalSave = await designUseCases.saveTeamDesign(draft.projectId, {
      authoring: authoredDraft,
      expectedTeamVersionDigest: naturalDesign.teamVersionDigest
    });
    assert.equal(professionalSave.projectStatus, "draft");
    assert.equal(professionalSave.authoring.roles[roleId].title, "Round-trip role title");
    assert.deepEqual(professionalSave.authoring.roles[roleId].contextMap, { brief: "global.task" });
    assert.equal((await designUseCases.getTeamDesign(draft.projectId)).authoring.roles[roleId].title, "Round-trip role title");

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

test("project metadata with a case alias is rejected by the latest identity contract", async () => {
  await withStore("invalid-built-in-identity", async (store) => {
    const team = await store.createClassicTeamProject({ caseId: "software-team" });
    const project = await store.createCollaborationProject({ name: "Canonical Built-in Project", teamVersionIds: [team.teamVersionId] });
    const projectMetaPath = join(project.workdir, ".site", "project.json");
    const metadata = JSON.parse(await readFile(projectMetaPath, "utf8"));
    await writeFile(projectMetaPath, JSON.stringify({
      ...metadata,
      mountedTeams: [{ ...metadata.mountedTeams[0], teamVersionId: "case:software-team" }]
    }, null, 2) + "\n", "utf8");
    await assert.rejects(() => store.getProject(project.projectId), /TEAM_VERSION_ID_INVALID/);
  });
});

test("all persisted Team and Task workspace references reject noncanonical identities", async () => {
  await withStore("invalid-root-identity", async (store) => {
    const team = await store.createClassicTeamProject({ caseId: "software-team" });
    const project = await store.createCollaborationProject({ name: "Canonical Identity Project", teamVersionIds: [team.teamVersionId] });
    const projectMetaPath = join(project.workdir, ".site", "project.json");
    const metadata = JSON.parse(await readFile(projectMetaPath, "utf8"));
    for (const invalidField of ["teamId", "teamRootId", "parentTeamVersionId"]) {
      await writeFile(projectMetaPath, JSON.stringify({ ...metadata, [invalidField]: "case:software-team" }, null, 2) + "\n", "utf8");
      await assert.rejects(() => store.getProject(project.projectId), /TEAM_VERSION_ID_INVALID/, invalidField);
    }
    await writeFile(projectMetaPath, JSON.stringify({
      ...metadata,
      taskRecords: [{ taskId: "identity-task", teamVersionId: "case:software-team" }]
    }, null, 2) + "\n", "utf8");
    await assert.rejects(() => store.getProject(project.projectId), /TEAM_VERSION_ID_INVALID/, "teamVersionId");
  });
});
