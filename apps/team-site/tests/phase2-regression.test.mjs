import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("team repository supports stable filtering, sorting, pagination, and statistics", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-repository-phase2-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?phase2-repository=${Date.now()}`);
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
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-repository-status-phase2-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?phase2-repository-status=${Date.now()}`);
  try {
    const draft = await store.createProject({ name: "Status Draft Team", intent: "Draft status query.", templateId: "empty" });
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
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-import-phase2-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?phase2-import=${Date.now()}`);
  try {
    const source = await store.createProject({ name: "Phase 2 Source", intent: "Import preview.", templateId: "minimal" });
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
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-project-import-phase2-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?phase2-project=${Date.now()}`);
  try {
    const team = await store.createClassicTeamProject({ caseId: "software-team" });
    const project = await store.createCollaborationProject({ name: "Phase 2 Project", overview: "Project import.", teamVersionIds: [team.projectId] });
    await store.addProjectMaterial(project.projectId, { filename: "brief.md", content: "phase two", contentType: "text/markdown" });
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

test("project package validation normalizes materials and verifies its definition digest", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-project-import-validation-phase2-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?phase2-project-validation=${Date.now()}`);
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
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-import-name-scope-phase2-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?phase2-import-name-scope=${Date.now()}`);
  try {
    const team = await store.createClassicTeamProject({ caseId: "software-team", name: "Source Team" });
    const project = await store.createCollaborationProject({ name: "Cross Scope Name", overview: "Cross-scope project." });
    const projectBundle = await store.exportProjectBundle(project.projectId);
    const { packageDigest: _projectPackageDigest, ...projectWithoutPackageDigest } = projectBundle;
    const importedProject = await store.importProjectBundle({
      ...projectWithoutPackageDigest,
      project: { ...projectWithoutPackageDigest.project, name: team.name }
    }, { conflictStrategy: "create-new" });
    assert.equal(importedProject.name, team.name);

    const teamBundle = await store.exportProjectTeam(team.projectId);
    const importedTeam = await store.importTeamPackage({
      ...teamBundle,
      team: { ...teamBundle.team, project: { ...teamBundle.team.project, name: project.name } }
    }, { conflictStrategy: "create-new" });
    assert.equal(importedTeam.name, project.name);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("team simulation uses a temporary workspace and leaves no project or run behind", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-simulation-phase2-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?phase2-simulation=${Date.now()}`);
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
