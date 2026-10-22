import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTeamCatalogUseCases } from "../application/team-catalog-use-cases.mjs";
import { createTeamVersionLifecycleUseCases } from "../application/team-version-lifecycle-use-cases.mjs";
import { createFileTeamCatalog } from "../infrastructure/file-team-catalog.mjs";
import { createFileTeamVersionLifecycle } from "../infrastructure/file-team-version-lifecycle.mjs";
import { createProjectPackageOperations, createTeamPackageOperations } from "./package-test-helpers.mjs";
import { withRunQueryUseCases } from "./run-query-test-helpers.mjs";
import { withCollaborationProjectUseCases } from "./collaboration-project-test-helpers.mjs";
import { withTeamLifecycleUseCases } from "./team-lifecycle-test-helpers.mjs";
import { withProjectMaterialUseCases } from "./project-material-test-helpers.mjs";

function createTeamCatalog(projectsRoot) {
  return createTeamCatalogUseCases({ teamCatalog: createFileTeamCatalog({ projectsRoot }) });
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

test("team repository supports stable filtering, sorting, pagination, and statistics", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-repository-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const catalog = createTeamCatalog(projectsRoot);
  const store = withTeamLifecycleUseCases(await import(`../infrastructure/file-project-store.mjs?capability-catalog=${Date.now()}`));
  try {
    await store.provisionBuiltInTeamVersions();
    const first = await catalog.queryTeamRepository({ page: 1, pageSize: 2, sort: "name" });
    assert.equal(first.pagination.page, 1);
    assert.equal(first.pagination.pageSize, 2);
    assert.ok(first.teams.length <= 2);
    assert.ok(first.stats.total >= 3);
    assert.equal(first.stats.builtIn, 3);
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
    const draft = await store.createProject({ name: "Status Draft Team", overview: "Draft status query.", templateId: "empty" });
    const released = await store.confirmProjectTeam(draft.projectId, { release: true });
    const fork = await store.forkTeamVersion(released.projectId);
    assert.equal(fork.name, released.name);
    assert.equal(fork.teamId, released.teamId);
    const lifecycle = createTeamVersionLifecycleUseCases({
      teamVersions: { ...createFileTeamVersionLifecycle({ projectsRoot, getTeamVersion: store.getProject }), getTeamVersion: store.getProject }
    });
    const reference = JSON.parse(await readFile(join(fork.workdir, ".site", "team-version.json"), "utf8"));
    assert.equal(reference.teamVersionId, fork.teamVersionId);
    assert.equal(reference.status, "editing");

    await lifecycle.archiveTeamVersion(released.projectId);
    assert.ok((await catalog.queryTeamRepository({ status: "editing", pageSize: 50 })).teams.some((team) => team.projectId === fork.projectId));
    assert.ok((await catalog.queryTeamRepository({ status: "archived", pageSize: 50 })).teams.some((team) => team.projectId === released.projectId));
    assert.ok((await catalog.queryTeamRepository({ status: "all", pageSize: 50 })).teams.some((team) => team.projectId === draft.projectId));
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("team package preview exposes fingerprint conflicts and explicit reuse does not create a project", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-import-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(await import(`../infrastructure/file-project-store.mjs?capability-import=${Date.now()}`));
  const packages = createTeamPackageOperations(store);
  try {
    const source = await store.createProject({ name: "Capability Source", overview: "Import preview.", templateId: "minimal" });
    await store.confirmProjectTeam(source.projectId, { release: true });
    const exported = await packages.exportTeamPackage(source.projectId);
    const preview = await packages.previewTeamPackage(exported);
    assert.equal(preview.duplicate.projectId, source.projectId);
    assert.equal(preview.suggestedStrategy, "reuse");
    await assert.rejects(
      () => store.filePackageStore.importTeamPackage(exported, { conflictStrategy: "reuse" }),
      /Validated Team package preview is required/
    );
    const reused = await packages.importTeamPackage(exported, { conflictStrategy: "reuse" });
    assert.equal(reused.projectId, source.projectId);
    const projects = await store.listProjects();
    assert.equal(projects.filter((project) => project.projectId === source.projectId).length, 1);
    await assert.rejects(() => packages.importTeamPackage(exported, { conflictStrategy: "reject" }), /TEAM_(IMPORT_CONFLICT|NAME_EXISTS)/);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("team import distinguishes identical content from same-name different content", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-import-name-conflict-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(await import(`../infrastructure/file-project-store.mjs?capability-import-name-conflict=${Date.now()}`));
  const packages = createTeamPackageOperations(store);
  try {
    const source = await store.createProject({ name: "Imported Team Source", overview: "Original content.", templateId: "minimal" });
    await store.confirmProjectTeam(source.projectId, { release: true });
    const exported = await packages.exportTeamPackage(source.projectId);

    const sameContentPreview = await packages.previewTeamPackage(exported);
    assert.equal(sameContentPreview.duplicate.projectId, source.projectId);
    assert.equal(sameContentPreview.conflicts.length, 0);
    assert.equal((await packages.importTeamPackage(exported, { conflictStrategy: "reuse" })).projectId, source.projectId);

    const differentContent = {
      ...exported,
      packageDigest: undefined,
      teamCoreDigest: undefined,
      team: { ...exported.team, systemSource: exported.team.systemSource.replace("system.version=1.0.0", "system.version=1.0.1") }
    };
    const renamedSource = await store.createProject({ name: "Different Content Team", overview: "Conflicting name.", templateId: "minimal" });
    await store.confirmProjectTeam(renamedSource.projectId, { release: true });
    const renamedBundle = {
      ...differentContent,
      team: { ...differentContent.team, project: { ...differentContent.team.project, name: renamedSource.name, teamName: renamedSource.name } }
    };
    const preview = await packages.previewTeamPackage(renamedBundle);
    assert.equal(preview.duplicate, null);
    assert.equal(preview.conflicts[0].name, renamedSource.name);
    await assert.rejects(() => packages.importTeamPackage(renamedBundle, { conflictStrategy: "reject" }), /TEAM_IMPORT_CONFLICT/);
    const imported = await packages.importTeamPackage(renamedBundle, { conflictStrategy: "reject", name: "Different Content Team (导入)" });
    assert.equal(imported.name, "Different Content Team (导入)");
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("project package preview and reuse preserve the existing collaboration project", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-project-import-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
    const store = withProjectMaterialUseCases(withCollaborationProjectUseCases(await import(`../infrastructure/file-project-store.mjs?capability-project=${Date.now()}`)));
  const packages = createProjectPackageOperations(store);
  try {
    assert.equal(store.previewProjectBundle, undefined);
    await assert.rejects(
      () => store.filePackageStore.importProjectBundle({}),
      /Validated Project package preview is required/
    );
    const team = await store.createClassicTeamProject({ caseId: "software-team" });
    const project = await store.createCollaborationProject({ name: "Capability Project", overview: "Project import.", teamVersionIds: [team.projectId] });
    await store.addProjectMaterial(project.projectId, { filename: "brief.md", content: "capability regression", contentType: "text/markdown" });
    const exported = await packages.exportProjectBundle(project.projectId);
    const preview = await packages.previewProjectBundle(exported);
    assert.equal(preview.duplicate.projectId, project.projectId);
    const reused = await packages.importProjectBundle(exported, { conflictStrategy: "reuse" });
    assert.equal(reused.projectId, project.projectId);
    await assert.rejects(() => packages.importProjectBundle(exported, { conflictStrategy: "reject" }), /PROJECT_IMPORT_CONFLICT/);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("project-v2 imports one nested released team into a clean workspace transaction", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "ogs-project-v2-source-"));
  const targetRoot = await mkdtemp(join(tmpdir(), "ogs-project-v2-target-"));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  try {
    process.env.OGS_SITE_PROJECTS_DIR = sourceRoot;
    const sourceStore = withProjectMaterialUseCases(withCollaborationProjectUseCases(await import(`../infrastructure/file-project-store.mjs?project-v2-source=${Date.now()}`)));
    const firstTeam = await sourceStore.createProject({ name: "Project v2 Team One", overview: "First dependency.", templateId: "minimal" });
    const secondTeam = await sourceStore.createProject({ name: "Project v2 Team Two", overview: "Second dependency.", templateId: "minimal" });
    await sourceStore.confirmProjectTeam(firstTeam.projectId, { release: true });
    await sourceStore.confirmProjectTeam(secondTeam.projectId, { release: true });
    const sourceProject = await sourceStore.createCollaborationProject({
      name: "Project v2 Source",
      overview: "Cross-workspace project definition.",
      teamVersionIds: [firstTeam.projectId]
    });
    await sourceStore.addProjectMaterial(sourceProject.projectId, { filename: "brief/source.md", content: "source material", contentType: "text/markdown" });
    const bundle = await createProjectPackageOperations(sourceStore).exportProjectBundle(sourceProject.projectId);

    await assert.rejects(
      () => createProjectPackageOperations(sourceStore).previewProjectBundle({
        ...bundle,
        packageDigest: undefined,
        project: { ...bundle.project, mountedTeams: [...bundle.project.mountedTeams, bundle.project.mountedTeams[0]] }
      }),
      /PROJECT_SINGLE_TEAM_REQUIRED/
    );

    assert.equal(bundle.mode, "project-v2");
    assert.equal(bundle.project.mountedTeams.length, 1);
    assert.equal(bundle.project.mountedTeams.every((team) => team.teamPackage.mode === "team-v2"), true);
    assert.equal("taskRecords" in bundle.project, false);
    assert.equal("runs" in bundle.project, false);
    assert.match(JSON.stringify(bundle), /sourceWorkspaceId/);

    process.env.OGS_SITE_PROJECTS_DIR = targetRoot;
    const targetRepository = await import(`../infrastructure/file-project-store.mjs?project-v2-target=${Date.now()}`);
    const targetStore = withRunQueryUseCases(targetRepository, targetRoot);
    const projectPackages = createProjectPackageOperations(targetStore);
    const targetPackages = createTeamPackageOperations(targetStore);
    await assert.rejects(
      () => projectPackages.previewProjectBundle({ ...bundle, mode: "project-v1" }),
      /PROJECT_PACKAGE_VERSION_UNSUPPORTED/
    );
    await assert.rejects(
      () => targetPackages.previewTeamPackage({ ...bundle, mode: "single-project-v1" }),
      /PROJECT_PACKAGE_VERSION_UNSUPPORTED/
    );
    const preview = await projectPackages.previewProjectBundle(bundle);
    assert.equal(preview.teamDependencies.length, 1);
    assert.deepEqual((await readdir(targetRoot)).filter((entry) => entry !== ".staging"), []);

    const imported = await projectPackages.importProjectBundle(bundle, { conflictStrategy: "create-new" });
    assert.equal(imported.projectType, "collaboration");
    assert.equal(imported.mountedTeams.length, 1);
    assert.equal(imported.mountedTeams.every((team) => team.status === "available"), true);
    assert.equal(imported.mountedTeams.some((team) => team.teamVersionId === firstTeam.projectId), false);
    assert.equal(imported.mountedTeams.some((team) => team.teamVersionId === secondTeam.projectId), false);
    assert.equal(imported.projectDefinitionDigest, bundle.project.projectDefinitionDigest);
    const importedTeams = (await targetStore.listProjects()).filter((project) => project.projectType === "team");
    assert.equal(importedTeams.length, 1);
    assert.equal(importedTeams.every((team) => team.teamVersionStatus === "released"), true);
    const task = await targetStore.createProjectTask(imported.projectId, {
      input: "Run the imported project.",
      teamVersionId: imported.mountedTeams[0].teamVersionId,
      idempotencyKey: "project-v2-run"
    });
    const started = await targetStore.startProjectTask(imported.projectId, task.taskId, { mode: "dry-run" });
    assert.equal(started.status, "planning");
    await waitForTerminal(targetStore, imported.projectId, started.currentRunId);
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
  const store = withCollaborationProjectUseCases(await import(`../infrastructure/file-project-store.mjs?capability-project-validation=${Date.now()}`));
  const packages = createProjectPackageOperations(store);
  try {
    const team = await store.createClassicTeamProject({ caseId: "software-team" });
    const project = await store.createCollaborationProject({ name: "Validation Project", overview: "Validate imported definitions.", teamVersionIds: [team.projectId] });
    const exported = await packages.exportProjectBundle(project.projectId);
    const { packageDigest: _packageDigest, ...withoutPackageDigest } = exported;

    const missingMaterials = {
      ...withoutPackageDigest,
      project: { ...withoutPackageDigest.project, materials: undefined }
    };
    const imported = await packages.importProjectBundle(missingMaterials, { conflictStrategy: "create-new" });
    assert.deepEqual(imported.materials.materials, []);

    await assert.rejects(
      () => packages.previewProjectBundle({
        ...withoutPackageDigest,
        project: { ...withoutPackageDigest.project, projectDefinitionDigest: "0".repeat(64) }
      }),
      /PROJECT_IMPORT_DIGEST_MISMATCH: projectDefinitionDigest/
    );
    await assert.rejects(
      () => packages.previewProjectBundle({
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
  const store = withCollaborationProjectUseCases(await import(`../infrastructure/file-project-store.mjs?capability-import-name-scope=${Date.now()}`));
  const packages = createTeamPackageOperations(store);
  const projectPackages = createProjectPackageOperations(store);
  try {
    const team = await store.createClassicTeamProject({ caseId: "software-team", name: "Cross Scope Name" });
    const project = await store.createCollaborationProject({ name: team.name, overview: "Cross-scope project.", teamVersionIds: [team.projectId] });
    const projectBundle = await projectPackages.exportProjectBundle(project.projectId);
    const importedProject = await projectPackages.importProjectBundle({
      ...projectBundle
    }, { conflictStrategy: "create-new" });
    assert.match(importedProject.name, new RegExp(`^${team.name} \\(2\\)$`));

    const teamBundle = await packages.exportTeamPackage(team.projectId);
    const importedTeam = await packages.importTeamPackage(teamBundle, { conflictStrategy: "create-new" });
    assert.match(importedTeam.name, new RegExp(`^${project.name} \\(3\\)$`));
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("team simulation uses a temporary workspace and leaves no project or run behind", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-simulation-capability-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(await import(`../infrastructure/file-project-store.mjs?capability-simulation=${Date.now()}`));
  const { createTeamSimulationUseCases } = await import("../application/team-simulation-use-cases.mjs");
  const { createFileTeamCatalog } = await import("../infrastructure/file-team-catalog.mjs");
  const { createRuntimeTeamSimulation } = await import("../infrastructure/runtime-team-simulation.mjs");
  try {
    const team = await store.createClassicTeamProject({ caseId: "software-team" });
    const before = (await store.listProjects()).map((project) => project.projectId).sort();
    const useCases = createTeamSimulationUseCases({
      teamCatalog: createFileTeamCatalog({ projectsRoot }),
      simulationRunner: createRuntimeTeamSimulation()
    });
    const result = await useCases.simulateTeamVersion(team.projectId, { prompt: "Preview the software delivery workflow." });
    assert.equal(result.persisted, false);
    assert.equal(result.mode, "dry-run");
    assert.ok(Array.isArray(result.auditTrail));
    assert.deepEqual((await store.listProjects()).map((project) => project.projectId).sort(), before);
    const runEntries = await readdir(join(team.workdir, ".ogs", "runs"), { withFileTypes: true }).catch(() => []);
    assert.equal(runEntries.length, 0);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("Studio Simulation maps Runtime done and ok into canonical completion evidence", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-simulation-status-contract-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(await import(`../infrastructure/file-project-store.mjs?capability-simulation-status=${Date.now()}`));
  const { createRuntimeTeamSimulation } = await import("../infrastructure/runtime-team-simulation.mjs");
  try {
    const team = await store.createClassicTeamProject({ caseId: "software-team" });
    const bundle = await createTeamPackageOperations(store).exportTeamPackage(team.projectId);
    const runner = createRuntimeTeamSimulation({
      run: async () => ({
        status: "done",
        finalOutput: JSON.stringify({ event: "DONE" }),
        auditTrail: [{ roleId: "delivery-coordinator", status: "ok", backend: "opencode", modelId: "model-a", profileId: "profile-a", toolRef: "tool.task.execute" }]
      })
    });
    const result = await runner.simulate(team, { prompt: "baseline probe", teamPackageBundle: bundle, mode: "sandbox" });
    assert.equal(result.status, "completed");
    assert.equal(result.auditTrail[0].status, "completed");
    assert.deepEqual(
      { backend: result.auditTrail[0].backend, modelId: result.auditTrail[0].modelId, profileId: result.auditTrail[0].profileId, toolRef: result.auditTrail[0].toolRef },
      { backend: "opencode", modelId: "model-a", profileId: "profile-a", toolRef: "tool.task.execute" }
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("team simulation removes its temporary workspace when the runtime rejects", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-simulation-failure-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(await import(`../infrastructure/file-project-store.mjs?capability-simulation-failure=${Date.now()}`));
  const { createTeamSimulationUseCases } = await import("../application/team-simulation-use-cases.mjs");
  const { createFileTeamCatalog } = await import("../infrastructure/file-team-catalog.mjs");
  const { createRuntimeTeamSimulation } = await import("../infrastructure/runtime-team-simulation.mjs");
  let temporaryWorkdir;
  try {
    const team = await store.createClassicTeamProject({ caseId: "software-team" });
    const useCases = createTeamSimulationUseCases({
      teamCatalog: createFileTeamCatalog({ projectsRoot }),
      simulationRunner: createRuntimeTeamSimulation({
        run: async ({ workdir }) => {
          temporaryWorkdir = workdir;
          throw new Error("runtime failed");
        }
      })
    });
    await assert.rejects(useCases.simulateTeamVersion(team.projectId, { prompt: "Preview the workflow." }), /runtime failed/);
    await assert.rejects(readFile(join(temporaryWorkdir, "system.mmd")), { code: "ENOENT" });
    assert.deepEqual((await store.listProjects()).map((project) => project.projectId), [team.projectId]);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
