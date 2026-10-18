import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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

test("team repository supports stable filtering, sorting, pagination, and statistics", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-repository-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?capability-repository=${Date.now()}`);
  try {
    const first = await store.queryTeamRepository({ page: 1, pageSize: 2, sort: "name" });
    assert.equal(first.pagination.page, 1);
    assert.equal(first.pagination.pageSize, 2);
    assert.ok(first.teams.length <= 2);
    assert.ok(first.stats.total >= 3);
    assert.equal(first.stats.builtIn, 3);
    const filtered = await store.queryTeamRepository({ query: "软件", pageSize: 10 });
    assert.equal(filtered.teams.length, 1);
    assert.equal(filtered.teams[0].teamName, "软件研发");
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("team repository queries include unreleased versions and forks refresh reference metadata", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-repository-status-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?capability-repository-status=${Date.now()}`);
  try {
    const draft = await store.createProject({ name: "Status Draft Team", overview: "Draft status query.", templateId: "empty" });
    const released = await store.confirmProjectTeam(draft.projectId, { release: true });
    const fork = await store.forkTeamVersion(released.projectId);
    const reference = JSON.parse(await readFile(join(fork.workdir, ".site", "team-version.json"), "utf8"));
    assert.equal(reference.teamVersionId, fork.teamVersionId);
    assert.equal(reference.status, "editing");

    await store.archiveTeamVersion(released.projectId);
    assert.ok((await store.queryTeamRepository({ status: "editing", pageSize: 50 })).teams.some((team) => team.projectId === fork.projectId));
    assert.ok((await store.queryTeamRepository({ status: "archived", pageSize: 50 })).teams.some((team) => team.projectId === released.projectId));
    assert.ok((await store.queryTeamRepository({ status: "all", pageSize: 50 })).teams.some((team) => team.projectId === draft.projectId));
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("team package preview exposes fingerprint conflicts and explicit reuse does not create a project", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-import-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?capability-import=${Date.now()}`);
  try {
    const source = await store.createProject({ name: "Capability Source", overview: "Import preview.", templateId: "minimal" });
    await store.confirmProjectTeam(source.projectId, { release: true });
    const exported = await store.exportProjectTeam(source.projectId);
    const preview = await store.previewTeamPackage(exported);
    assert.equal(preview.duplicate.projectId, source.projectId);
    assert.equal(preview.suggestedStrategy, "reuse");
    const reused = await store.importTeamPackage(exported, { conflictStrategy: "reuse" });
    assert.equal(reused.projectId, source.projectId);
    const projects = await store.listProjects();
    assert.equal(projects.filter((project) => project.projectId === source.projectId).length, 1);
    await assert.rejects(() => store.importTeamPackage(exported, { conflictStrategy: "reject" }), /TEAM_(IMPORT_CONFLICT|NAME_EXISTS)/);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("project package preview and reuse preserve the existing collaboration project", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-project-import-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?capability-project=${Date.now()}`);
  try {
    const team = await store.createClassicTeamProject({ caseId: "software-team" });
    const project = await store.createCollaborationProject({ name: "Capability Project", overview: "Project import.", teamVersionIds: [team.projectId] });
    await store.addProjectMaterial(project.projectId, { filename: "brief.md", content: "capability regression", contentType: "text/markdown" });
    const exported = await store.exportProjectBundle(project.projectId);
    const preview = await store.previewProjectBundle(exported);
    assert.equal(preview.duplicate.projectId, project.projectId);
    const reused = await store.importProjectBundle(exported, { conflictStrategy: "reuse" });
    assert.equal(reused.projectId, project.projectId);
    await assert.rejects(() => store.importProjectBundle(exported, { conflictStrategy: "reject" }), /PROJECT_IMPORT_CONFLICT/);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("project-v2 imports nested released teams into a clean workspace transaction", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "ogs-project-v2-source-"));
  const targetRoot = await mkdtemp(join(tmpdir(), "ogs-project-v2-target-"));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  try {
    process.env.OGS_SITE_PROJECTS_DIR = sourceRoot;
    const sourceStore = await import(`../project-repository.mjs?project-v2-source=${Date.now()}`);
    const firstTeam = await sourceStore.createProject({ name: "Project v2 Team One", overview: "First dependency.", templateId: "minimal" });
    const secondTeam = await sourceStore.createProject({ name: "Project v2 Team Two", overview: "Second dependency.", templateId: "minimal" });
    await sourceStore.confirmProjectTeam(firstTeam.projectId, { release: true });
    await sourceStore.confirmProjectTeam(secondTeam.projectId, { release: true });
    const sourceProject = await sourceStore.createCollaborationProject({
      name: "Project v2 Source",
      overview: "Cross-workspace project definition.",
      teamVersionIds: [firstTeam.projectId, secondTeam.projectId, secondTeam.projectId]
    });
    await sourceStore.addProjectMaterial(sourceProject.projectId, { filename: "brief/source.md", content: "source material", contentType: "text/markdown" });
    const bundle = await sourceStore.exportProjectBundle(sourceProject.projectId);

    assert.equal(bundle.mode, "project-v2");
    assert.equal(bundle.project.mountedTeams.length, 2);
    assert.equal(bundle.project.mountedTeams.every((team) => team.teamPackage.mode === "team-v2"), true);
    assert.equal("taskRecords" in bundle.project, false);
    assert.equal("runs" in bundle.project, false);
    assert.match(JSON.stringify(bundle), /sourceWorkspaceId/);

    process.env.OGS_SITE_PROJECTS_DIR = targetRoot;
    const targetStore = await import(`../project-repository.mjs?project-v2-target=${Date.now()}`);
    await assert.rejects(
      () => targetStore.previewProjectBundle({ ...bundle, mode: "project-v1" }),
      /PROJECT_PACKAGE_VERSION_UNSUPPORTED/
    );
    await assert.rejects(
      () => targetStore.previewTeamPackage({ ...bundle, mode: "single-project-v1" }),
      /PROJECT_PACKAGE_VERSION_UNSUPPORTED/
    );
    const preview = await targetStore.previewProjectBundle(bundle);
    assert.equal(preview.teamDependencies.length, 2);
    assert.deepEqual((await readdir(targetRoot)).filter((entry) => entry !== ".staging"), []);

    const imported = await targetStore.importProjectBundle(bundle, { conflictStrategy: "create-new" });
    assert.equal(imported.projectType, "collaboration");
    assert.equal(imported.mountedTeams.length, 2);
    assert.equal(imported.mountedTeams.every((team) => team.status === "available"), true);
    assert.equal(imported.mountedTeams.some((team) => team.teamVersionId === firstTeam.projectId), false);
    assert.equal(imported.mountedTeams.some((team) => team.teamVersionId === secondTeam.projectId), false);
    assert.equal(imported.projectDefinitionDigest, bundle.project.projectDefinitionDigest);
    const importedTeams = (await targetStore.listProjects()).filter((project) => project.projectType === "team");
    assert.equal(importedTeams.length, 2);
    assert.equal(importedTeams.every((team) => team.teamVersionStatus === "released"), true);
    const task = await targetStore.createProjectTask(imported.projectId, {
      input: "Run the imported project.",
      teamVersionId: imported.mountedTeams[0].teamVersionId,
      idempotencyKey: "project-v2-run"
    });
    const started = await targetStore.startProjectTask(imported.projectId, task.taskId, { mode: "dry-run" });
    assert.equal(started.status, "planning");
    await waitForTerminal(targetStore, imported.projectId, started.runId);
  } finally {
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("project package validation normalizes materials and verifies its definition digest", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-project-import-validation-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?capability-project-validation=${Date.now()}`);
  try {
    const team = await store.createClassicTeamProject({ caseId: "software-team" });
    const project = await store.createCollaborationProject({ name: "Validation Project", overview: "Validate imported definitions.", teamVersionIds: [team.projectId] });
    const exported = await store.exportProjectBundle(project.projectId);
    const { packageDigest: _packageDigest, ...withoutPackageDigest } = exported;

    const missingMaterials = {
      ...withoutPackageDigest,
      project: { ...withoutPackageDigest.project, materials: undefined }
    };
    const imported = await store.importProjectBundle(missingMaterials, { conflictStrategy: "create-new" });
    assert.deepEqual(imported.materials.materials, []);

    await assert.rejects(
      () => store.previewProjectBundle({
        ...withoutPackageDigest,
        project: { ...withoutPackageDigest.project, projectDefinitionDigest: "0".repeat(64) }
      }),
      /PROJECT_IMPORT_DIGEST_MISMATCH: projectDefinitionDigest/
    );
    await assert.rejects(
      () => store.previewProjectBundle({
        ...withoutPackageDigest,
        project: { ...withoutPackageDigest.project, projectDefinitionDigest: undefined }
      }),
      /PROJECT_IMPORT_DIGEST_MISMATCH: projectDefinitionDigest/
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("imported Team and Project names only conflict within their own scope", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-import-name-scope-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?capability-import-name-scope=${Date.now()}`);
  try {
    const team = await store.createClassicTeamProject({ caseId: "software-team", name: "Cross Scope Name" });
    const project = await store.createCollaborationProject({ name: team.name, overview: "Cross-scope project.", teamVersionIds: [team.projectId] });
    const projectBundle = await store.exportProjectBundle(project.projectId);
    const importedProject = await store.importProjectBundle({
      ...projectBundle
    }, { conflictStrategy: "create-new" });
    assert.match(importedProject.name, new RegExp(`^${team.name} \\(2\\)$`));

    const teamBundle = await store.exportProjectTeam(team.projectId);
    const importedTeam = await store.importTeamPackage(teamBundle, { conflictStrategy: "create-new" });
    assert.match(importedTeam.name, new RegExp(`^${project.name} \\(3\\)$`));
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("team simulation uses a temporary workspace and leaves no project or run behind", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-simulation-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?capability-simulation=${Date.now()}`);
  try {
    const team = await store.createClassicTeamProject({ caseId: "software-team" });
    const before = (await store.listProjects()).map((project) => project.projectId).sort();
    const result = await store.simulateTeamVersion(team.projectId, { prompt: "Preview the software delivery workflow." });
    assert.equal(result.persisted, false);
    assert.equal(result.mode, "simulation");
    assert.ok(Array.isArray(result.auditTrail));
    assert.deepEqual((await store.listProjects()).map((project) => project.projectId).sort(), before);
    const runEntries = await readdir(join(team.workdir, ".ogs", "runs"), { withFileTypes: true }).catch(() => []);
    assert.equal(runEntries.length, 0);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
