import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTeamCatalogUseCases } from "../application/team-catalog-use-cases.mjs";
import { createTeamVersionLifecycleUseCases } from "../application/team-version-lifecycle-use-cases.mjs";
import { createFileTeamCatalog } from "../infrastructure/file-team-catalog.mjs";
import { createFileTeamVersionLifecycle } from "../infrastructure/file-team-version-lifecycle.mjs";
import { withCollaborationProjectUseCases } from "./collaboration-project-test-helpers.mjs";
import { withTeamLifecycleUseCases } from "./team-lifecycle-test-helpers.mjs";

function createTeamCatalog(projectsRoot) {
  return createTeamCatalogUseCases({ teamCatalog: createFileTeamCatalog({ projectsRoot }) });
}

test("team repository supports stable filtering, sorting, pagination, and statistics", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-repository-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const catalog = createTeamCatalog(projectsRoot);
  const store = withTeamLifecycleUseCases(await import(`../infrastructure/file-project-store.mjs?capability-catalog=${Date.now()}`));
  try {
    const templates = await store.provisionBuiltInTeamTemplates();
    assert.equal(templates.length, 8);
    const first = await catalog.queryTeamRepository({ page: 1, pageSize: 2, sort: "name" });
    assert.equal(first.pagination.page, 1);
    assert.equal(first.pagination.pageSize, 2);
    assert.ok(first.teams.length <= 2);
    assert.ok(first.stats.total >= 3);
    assert.equal(first.stats.builtIn, 8);
    const filtered = await catalog.queryTeamRepository({ query: "软件", pageSize: 10 });
    assert.equal(filtered.teams.length, 1);
    assert.equal(filtered.teams[0].teamName, "软件研发");
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
test("team repository queries include unreleased versions and forks refresh reference metadata", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-repository-status-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(await import(`../infrastructure/file-project-store.mjs?capability-repository-status=${Date.now()}`));
  const catalog = createTeamCatalog(projectsRoot);
  try {
    const released = await store.createClassicTeamProject({ caseId: "software-team", name: "Status Draft Team" });
    const fork = await store.forkTeamVersion(released.projectId);
    assert.equal(fork.name, released.name);
    assert.equal(fork.teamId, released.teamId);
    const lifecycle = createTeamVersionLifecycleUseCases({
      teamVersions: {
        ...createFileTeamVersionLifecycle({
          projectsRoot,
          getTeamVersion: store.getProject,
          listProjects: store.listProjects,
          removeProjectData: store.removeProjectData
        }),
        getTeamVersion: store.getProject
      },
      withTeamVersionLock: async (_id, action) => action()
    });
    const reference = JSON.parse(await readFile(join(fork.workdir, ".site", "team-version.json"), "utf8"));
    assert.equal(reference.teamVersionId, fork.teamVersionId);
    assert.equal(reference.status, "draft");

    await lifecycle.archiveTeamVersion(released.projectId);
    assert.ok((await catalog.queryTeamRepository({ status: "draft", pageSize: 50 })).teams.some((team) => team.projectId === fork.projectId));
    assert.ok((await catalog.queryTeamRepository({ status: "archived", pageSize: 50 })).teams.some((team) => team.projectId === released.projectId));
    assert.ok((await catalog.queryTeamRepository({ status: "all", pageSize: 50 })).teams.some((team) => team.projectId === released.projectId));
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
test("custom Team deletion removes its unused version lineage from persistent storage", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-delete-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(await import(`../infrastructure/file-project-store.mjs?capability-team-delete=${Date.now()}`));
  try {
    const root = await store.createTeamIrDraft({ name: "Disposable Team", overview: "Delete the full version lineage." });
    const released = await store.confirmProjectTeam(root.projectId, { release: true });
    const fork = await store.forkTeamVersion(released.projectId);
    const persistence = createFileTeamVersionLifecycle({
      projectsRoot,
      getTeamVersion: store.getProject,
      listProjects: store.listProjects,
      removeProjectData: store.removeProjectData
    });
    const locks = (await import("../infrastructure/file-team-lifecycle-locks.mjs")).createFileTeamLifecycleLocks({ projectsRoot });
    const lifecycle = createTeamVersionLifecycleUseCases({
      teamVersions: { ...persistence, getTeamVersion: store.getProject },
      withTeamVersionLock: locks.withTeamVersionLock
    });
    const deleted = await lifecycle.deleteTeam(root.projectId);
    assert.deepEqual(new Set(deleted.deletedTeamVersionIds), new Set([root.projectId, fork.projectId]));
    await assert.rejects(() => store.getProject(root.projectId), /not found/i);
    await assert.rejects(() => store.getProject(fork.projectId), /not found/i);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
test("Collaboration Project deletion removes the workspace and retains the active Task guard", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-project-delete-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withCollaborationProjectUseCases(await import(`../infrastructure/file-project-store.mjs?capability-project-delete=${Date.now()}`));
  try {
    const team = await store.createProject({ name: "Project Delete Team", overview: "Available for a test Project.", templateId: "minimal" });
    const released = await store.confirmProjectTeam(team.projectId, { release: true });
    const project = await store.createCollaborationProject({ name: "Disposable Project", teamVersionIds: [released.projectId] });
    assert.deepEqual(await store.deleteCollaborationProject(project.projectId), { projectId: project.projectId, deleted: true });
    await assert.rejects(() => store.getProject(project.projectId), /not found/i);

    const activeProject = await store.createCollaborationProject({ name: "Protected Project", teamVersionIds: [released.projectId] });
    const current = await store.getProject(activeProject.projectId);
    await store.saveProjectMetadata(activeProject.projectId, {
      ...current,
      taskRecords: [{ taskId: "task-1", status: "waiting_review" }]
    });
    await assert.rejects(() => store.deleteCollaborationProject(activeProject.projectId), /PROJECT_DELETE_LOCKED/);
    assert.equal((await store.getProject(activeProject.projectId)).projectId, activeProject.projectId);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
