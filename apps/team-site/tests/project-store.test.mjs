import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireActiveRunLock } from "../../../dist/runtime/project-run-lock.js";
import { withTaskCreationUseCases } from "./task-creation-test-helpers.mjs";
import { withProjectUpdateUseCases } from "./project-update-test-helpers.mjs";
import { createTeamDesignUseCasesForStore } from "./team-design-test-helpers.mjs";
import { createTeamPackageOperations } from "./package-test-helpers.mjs";
import { withCollaborationProjectUseCases } from "./collaboration-project-test-helpers.mjs";
import { withTeamLifecycleUseCases } from "./team-lifecycle-test-helpers.mjs";
import { withProjectMaterialUseCases } from "./project-material-test-helpers.mjs";
import { waitForActiveTaskWorker } from "../infrastructure/in-memory-task-workers.mjs";

async function waitForTask(store, projectId, taskId) {
  let lastTask;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const task = await store.getProjectTask(projectId, taskId);
    lastTask = task;
    if (task && ["completed", "failed", "cancelled"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Task did not reach a terminal state in time (status=${lastTask?.status || "missing"}; error=${lastTask?.lastError || "none"}).`);
}

test("site creates a persistent project and snapshots materials; runs require a Project Task", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-projects-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withProjectMaterialUseCases(withProjectUpdateUseCases(await import("../infrastructure/file-project-store.mjs?test=" + Date.now()), projectsRoot));
  try {
    const project = await store.createProject({
      name: "Research Team",
      overview: "Analyze the supplied brief.",
      templateId: "empty"
    });
    assert.match(project.projectId, /^research-team-/);
    assert.equal(project.projectStatus, "draft");
    await assert.rejects(
      () => store.addProjectMaterial(project.projectId, { filename: "brief.md", content: "blocked" }),
      /PROJECT_NOT_CONFIRMED/
    );
    const confirmed = await store.confirmProjectTeam(project.projectId);
    assert.equal(confirmed.projectStatus, "confirmed");
    assert.equal(typeof confirmed.projectDigest, "string");
    const confirmedAgain = await store.confirmProjectTeam(project.projectId);
    assert.equal(confirmedAgain.confirmedAt, confirmed.confirmedAt);
    const renamed = await store.updateProject(project.projectId, { name: "Renamed Team", overview: confirmed.overview });
    assert.equal(renamed.projectStatus, "confirmed");
    const changed = await store.updateProject(project.projectId, { overview: "A changed objective." });
    assert.equal(changed.projectStatus, "draft");
    await store.confirmProjectTeam(project.projectId);
    const material = await store.addProjectMaterial(project.projectId, {
      filename: "brief.md",
      content: "# Brief\nUse the supplied facts only.\n",
      contentType: "text/markdown"
    });
    assert.equal(material.status, "indexed");

    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "Summarize the brief.", mode: "dry-run" }),
      /PROJECT_RUN_OWNER_INVALID/
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("classic team use creates a confirmed asset; Studio runs use the Simulation lifecycle", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-classic-projects-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(await import("../infrastructure/file-project-store.mjs?classic=" + Date.now()));
  try {
    const project = await store.createClassicTeamProject({ caseId: "software-team" });
    assert.equal(project.projectStatus, "confirmed");
    assert.equal(project.source, "classic");
    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "Prepare a concise delivery plan.", mode: "dry-run" }),
      /PROJECT_RUN_OWNER_INVALID/
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("legacy TeamVersion cloning into project workspaces is not exposed", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-workspace-binding-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(await import("../infrastructure/file-project-store.mjs?workspace-binding=" + Date.now()));
  try {
    assert.equal(store.createProjectWorkspace, undefined);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("project readiness is separate from structure confirmation and gates sandbox runs", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-readiness-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTaskCreationUseCases(await import("../infrastructure/file-project-store.mjs?readiness=" + Date.now()));
  try {
    const project = await store.createProject({ name: "Readiness Team", overview: "Check readiness.", templateId: "empty" });
    const roleDirs = await readdir(join(project.workdir, "og-roles", "roles"), { withFileTypes: true });
    const roleDir = join(project.workdir, "og-roles", "roles", roleDirs.find((entry) => entry.isDirectory()).name);
    await writeFile(join(roleDir, "role.json"), "{}", "utf8");
    await writeFile(join(project.workdir, ".ogs", "model-catalog.json"), "{}", "utf8");
    await store.confirmProjectTeam(project.projectId);
    const { createProjectReadinessUseCases } = await import("../application/project-readiness-use-cases.mjs");
    const { createRuntimeProjectReadinessInspector } = await import("../infrastructure/runtime-project-readiness.mjs");
    const readiness = await createProjectReadinessUseCases({
      getProject: store.getProject,
      readinessInspector: createRuntimeProjectReadinessInspector()
    }).getProjectReadiness(project.projectId);
    assert.equal(readiness.projectStatus, "confirmed");
    assert.equal(readiness.canDryRun, false);
    assert.ok(readiness.blockers.some((issue) => issue.code === "READINESS_ROLE_PACKAGE_INVALID"));
    assert.ok(readiness.blockers.some((issue) => issue.code === "READINESS_MODEL_CATALOG_INVALID"));
    assert.equal(Object.hasOwn(readiness, "workdir"), false);
    const issueMessages = readiness.blockers.map((issue) => issue.message).join("\n");
    assert.equal(issueMessages.includes(project.workdir), false);
    assert.match(issueMessages, /Check role\.json/);
    assert.match(issueMessages, /\.ogs\/model-catalog\.json/);
    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "Sandbox check.", mode: "sandbox" }),
      /PROJECT_RUN_OWNER_INVALID/
    );
    const collaboration = await store.createCollaborationProject({
      name: "Blocked collaboration project",
      overview: "Readiness must block before a Task reserves a Run.",
      teamVersionIds: [project.teamVersionId]
    });
    const task = await store.createProjectTask(collaboration.projectId, {
      input: "Run only after readiness passes.",
      teamVersionId: project.teamVersionId,
      idempotencyKey: "readiness-before-reserve"
    });
    await assert.rejects(() => store.startProjectTask(collaboration.projectId, task.taskId, { mode: "sandbox" }), /PROJECT_NOT_READY/);
    const blockedTask = await store.getProjectTask(collaboration.projectId, task.taskId);
    assert.equal(blockedTask.status, "queued");
    assert.equal(blockedTask.currentRunId, null);
    assert.deepEqual(blockedTask.runIds, []);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("classic team templates can be confirmed and are not executed outside Studio Simulation", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-classic-template-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(await import("../infrastructure/file-project-store.mjs?classic-template=" + Date.now()));
  try {
    const project = await store.createClassicTeamProject({ caseId: "software-team", asTemplate: true });
    assert.equal(project.projectStatus, "draft");
    assert.equal(project.source, "classic-template");
    const confirmed = await store.confirmProjectTeam(project.projectId);
    assert.equal(confirmed.projectStatus, "confirmed");
    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "Run the copied classic team.", mode: "dry-run" }),
      /PROJECT_RUN_OWNER_INVALID/
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("Team package round-trip does not create a Run outside a Project Task", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-project-roundtrip-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withProjectMaterialUseCases(withTeamLifecycleUseCases(await import("../infrastructure/file-project-store.mjs?roundtrip=" + Date.now())));
  const packages = createTeamPackageOperations(store);
  try {
    const project = await store.createProject({ name: "Roundtrip Team", overview: "Produce a concise brief.", templateId: "empty" });
    await store.confirmProjectTeam(project.projectId);
    await store.addProjectMaterial(project.projectId, { filename: "brief.md", content: "facts", contentType: "text/markdown" });
    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "Summarize facts.", mode: "dry-run", idempotencyKey: "same-request" }),
      /PROJECT_RUN_OWNER_INVALID/
    );
    const bundle = await packages.exportTeamPackage(project.projectId);
    assert.equal(bundle.mode, "team-v2");
    const { packageDigest: _roundtripDigest, ...roundtripWithoutDigest } = bundle;
    const imported = await packages.importTeamPackage({ ...roundtripWithoutDigest, team: { ...bundle.team, project: { ...bundle.team.project, name: "Roundtrip Team Imported" } } });
    assert.equal(imported.projectStatus, "draft");
    assert.equal(imported.source, "imported");
    await assert.rejects(() => store.startProjectRun(imported.projectId, { prompt: "blocked" }), /PROJECT_RUN_OWNER_INVALID/);
    await store.confirmProjectTeam(imported.projectId);
    await assert.rejects(
      () => store.startProjectRun(imported.projectId, { prompt: "Run the imported team.", mode: "dry-run" }),
      /PROJECT_RUN_OWNER_INVALID/
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("project bundles carry executable role and contract assets without importing the old project identity", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-package-assets-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withProjectMaterialUseCases(withTeamLifecycleUseCases(await import("../infrastructure/file-project-store.mjs?package-assets=" + Date.now())));
  const packages = createTeamPackageOperations(store);
  try {
    const project = await store.createProject({ name: "Executable Team", overview: "Package executable assets.", templateId: "empty" });
    const roleDir = join(project.workdir, "og-roles", "roles", "package-role");
    await mkdir(roleDir, { recursive: true });
    await writeFile(join(roleDir, "role.json"), JSON.stringify({ roleId: "package-role", roleVersion: "1.0.0" }), "utf8");
    await writeFile(join(roleDir, "agent.md"), "Role agent instructions.", "utf8");
    await writeFile(join(roleDir, "prompt.md"), "Discuss token budgets.", "utf8");
    await writeFile(join(roleDir, "output.schema.json"), JSON.stringify({ type: "object" }), "utf8");
    await mkdir(join(project.workdir, ".ogs", "contracts"), { recursive: true });
    await writeFile(join(project.workdir, ".ogs", "contracts", "handoff.json"), JSON.stringify({ version: 1, contracts: [] }), "utf8");
    await mkdir(join(project.workdir, ".ogs", "systems"), { recursive: true });
    await mkdir(join(project.workdir, ".ogs", "subsystems"), { recursive: true });
    await writeFile(join(project.workdir, ".ogs", "semantics.yaml"), "version: 1\nsystemId: package\nsystemVersion: 1.0.0\n", "utf8");
    await writeFile(join(project.workdir, ".ogs", "models.json"), JSON.stringify({ version: 1, models: [] }), "utf8");
    await writeFile(join(project.workdir, ".ogs", "systems", "nested.mmd"), "%% system.id=nested\n%% system.version=1.0.0\n", "utf8");
    await writeFile(join(project.workdir, ".ogs", "subsystems", "child.json"), JSON.stringify({ version: 1 }), "utf8");

    const bundle = await packages.exportTeamPackage(project.projectId);
    assert.ok(bundle.team.executableFiles.some((file) => file.path.endsWith("package-role/prompt.md")));
    assert.ok(bundle.team.executableFiles.some((file) => file.path === ".ogs/contracts/handoff.json"));
    assert.ok(bundle.team.executableFiles.some((file) => file.path === ".ogs/semantics.yaml"));
    assert.ok(bundle.team.executableFiles.some((file) => file.path === ".ogs/models.json"));
    assert.ok(bundle.team.executableFiles.some((file) => file.path === ".ogs/systems/nested.mmd"));
    assert.ok(bundle.team.executableFiles.some((file) => file.path === ".ogs/subsystems/child.json"));
    const { packageDigest: _assetsDigest, ...assetsWithoutDigest } = bundle;
    const imported = await packages.importTeamPackage({ ...assetsWithoutDigest, team: { ...bundle.team, project: { ...bundle.team.project, name: "Executable Team Imported" } } });
    assert.notEqual(imported.projectId, project.projectId);
    assert.equal(JSON.parse(await readFile(join(imported.workdir, ".ogs", "project.json"), "utf8")).projectId, imported.ogsProjectId);
    assert.equal(await readFile(join(imported.workdir, "og-roles", "roles", "package-role", "prompt.md"), "utf8"), "Discuss token budgets.");
    assert.equal(await readFile(join(imported.workdir, ".ogs", "contracts", "handoff.json"), "utf8"), JSON.stringify({ version: 1, contracts: [] }));
    assert.equal(await readFile(join(imported.workdir, ".ogs", "semantics.yaml"), "utf8"), "version: 1\nsystemId: package\nsystemVersion: 1.0.0\n");
    assert.equal(await readFile(join(imported.workdir, ".ogs", "systems", "nested.mmd"), "utf8"), "%% system.id=nested\n%% system.version=1.0.0\n");
    assert.equal(JSON.parse(await readFile(join(imported.workdir, ".site", "project.json"), "utf8")).projectStatus, "draft");
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("legacy direct Run control is rejected without a Project Task owner", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-control-intent-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(await import("../infrastructure/file-project-store.mjs?control-intent=" + Date.now()));
  try {
    const project = await store.createProject({ name: "Control Intent Team", overview: "Test controls.", templateId: "empty" });
    await store.confirmProjectTeam(project.projectId);
    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "Run the control test.", mode: "dry-run" }),
      /PROJECT_RUN_OWNER_INVALID/
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("project asset digest detects role package changes and credential validation is field based", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-digest-import-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(await import("../infrastructure/file-project-store.mjs?digest-import=" + Date.now()));
  const packages = createTeamPackageOperations(store);
    const { computeProjectAssetDigest } = await import("../../../dist/runtime/project-asset-digest.js?digest-import=" + Date.now());
  try {
    const project = await store.createProject({ name: "Digest Team", overview: "Check package assets.", templateId: "empty" });
    const confirmed = await store.confirmProjectTeam(project.projectId);
    const digestBeforeSemanticEdit = await computeProjectAssetDigest(project.workdir);
    const modelCatalogPath = join(project.workdir, ".ogs", "model-catalog.json");
    const modelCatalog = JSON.parse(await readFile(modelCatalogPath, "utf8"));
    await writeFile(modelCatalogPath, JSON.stringify({ ...modelCatalog, generatedAt: "2099-01-01T00:00:00.000Z" }, null, 2), "utf8");
    assert.equal(await computeProjectAssetDigest(project.workdir), digestBeforeSemanticEdit,
      "refreshing the environment model catalog must not invalidate confirmed team assets");
    await writeFile(join(project.workdir, ".ogs", "semantics.yaml"), "version: 1\nsystem:\n  systemId: digest-team\n  systemVersion: 1.0.0\n", "utf8");
    assert.notEqual(await computeProjectAssetDigest(project.workdir), digestBeforeSemanticEdit);
    await mkdir(join(project.workdir, "og-roles", "roles", "digest-role"), { recursive: true });
    await writeFile(join(project.workdir, "og-roles", "roles", "digest-role", "prompt.md"), "Discuss token budgets and password policy.", "utf8");
    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "Should be blocked.", mode: "dry-run" }),
      /PROJECT_RUN_OWNER_INVALID/
    );
    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "Semantic asset changed.", mode: "dry-run" }),
      /PROJECT_RUN_OWNER_INVALID/
    );
    const bundle = {
      mode: "team-v2",
      team: {
        systemSource: await readFile(join(project.workdir, "system.mmd"), "utf8"),
        project: { name: "Imported", overview: "Discuss token budgets and password policy." }
      }
    };
    const imported = await packages.importTeamPackage(bundle);
    assert.equal(imported.projectStatus, "draft");
    await assert.rejects(
      () => packages.importTeamPackage({ ...bundle, team: { ...bundle.team, project: { apiKey: "secret-value" } } }),
      /credential field is not accepted/
    );
    assert.equal(typeof confirmed.projectDigest, "string");
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("site design editing invalidates confirmation and run control rejects terminal resume", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-design-control-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(await import("../infrastructure/file-project-store.mjs?design-control=" + Date.now()));
  try {
    const project = await store.createProject({ name: "Editable Team", overview: "Edit structure", templateId: "minimal" });
    const designUseCases = createTeamDesignUseCasesForStore(store, projectsRoot);
    const design = await designUseCases.getTeamDesign(project.projectId);
    assert.equal(design.authoring.version, 1);
    const saved = await designUseCases.saveTeamDesign(project.projectId, {
      systemSource: design.systemSource,
      expectedTeamVersionDigest: design.teamVersionDigest
    });
    assert.equal(saved.projectStatus, "draft");
    await assert.rejects(
      () => designUseCases.saveTeamDesign(project.projectId, {
        systemSource: design.systemSource,
        expectedTeamVersionDigest: "stale-team-digest"
      }),
      /TEAM_VERSION_DIGEST_CONFLICT/
    );
    await store.confirmProjectTeam(project.projectId);
    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "check terminal control", mode: "dry-run" }),
      /PROJECT_RUN_OWNER_INVALID/
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("Project Run resume requires a persisted Task owner before validating a snapshot path", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-resume-path-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "ogs-site-resume-outside-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(await import("../infrastructure/file-project-store.mjs?resume-path=" + Date.now()));
  try {
    const project = await store.createProject({ name: "Resume Path Team", overview: "Validate resume paths.", templateId: "empty" });
    await store.confirmProjectTeam(project.projectId);
    await assert.rejects(
      () => store.startProjectRun(project.projectId, {
        prompt: "Validate this run.",
        mode: "dry-run",
        resumeRunId: "unowned-run",
        resumeRunDir: outsideRoot
      }),
      /PROJECT_RUN_OWNER_INVALID/
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("collaboration tasks run sequentially on their single mounted TeamVersion and preserve controls", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-task-controls-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTaskCreationUseCases(withCollaborationProjectUseCases(await import("../infrastructure/file-project-store.mjs?task-controls=" + Date.now())));
  try {
    const teamA = await store.createProject({ name: "Task Control A", overview: "Analyze input.", templateId: "empty" });
    await store.confirmProjectTeam(teamA.projectId, { release: true });
    const teamB = await store.createProject({ name: "Task Control B", overview: "Review output.", templateId: "empty" });
    await store.confirmProjectTeam(teamB.projectId, { release: true });
    const project = await store.createCollaborationProject({ name: "Task Control Project", workspaceKey: "task-control", teamVersionIds: [teamA.projectId] });
    const first = await store.createProjectTask(project.projectId, { input: "Analyze input", teamVersionId: teamA.projectId, idempotencyKey: "task-a" });
    const second = await store.createProjectTask(project.projectId, { input: "Review output", teamVersionId: teamA.projectId, idempotencyKey: "task-b" });
    const firstRun = await store.startProjectTask(project.projectId, first.taskId, { mode: "dry-run" });
    assert.equal(firstRun.status, "planning");
    assert.ok(firstRun.currentRunId);
    const firstCompleted = await waitForTask(store, project.projectId, first.taskId);
    assert.equal(firstCompleted.status, "completed");
    const secondRun = await store.startProjectTask(project.projectId, second.taskId, { mode: "dry-run" });
    assert.equal(secondRun.status, "planning");
    assert.ok(secondRun.currentRunId);
    const secondCompleted = await waitForTask(store, project.projectId, second.taskId);
    assert.equal(secondCompleted.status, "completed");

    const manual = await store.createProjectTask(project.projectId, { input: "Manual review step", teamVersionId: teamA.projectId, idempotencyKey: "task-manual" });
    const running = await store.controlProjectTask(project.projectId, manual.taskId, "start");
    assert.equal(running.status, "running");
    const blocked = await store.createProjectTask(project.projectId, { input: "Must wait", teamVersionId: teamA.projectId, idempotencyKey: "task-blocked" });
    await assert.rejects(() => store.controlProjectTask(project.projectId, blocked.taskId, "start"), /PROJECT_TASK_CONCURRENCY_LIMIT/);
    assert.equal((await store.controlProjectTask(project.projectId, manual.taskId, "pause")).status, "paused");
    await assert.rejects(
      () => store.reviewProjectTask(project.projectId, manual.taskId, { decision: "approve", comment: "继续处理" }),
      /TASK_REVIEW_NOT_ALLOWED/
    );
    assert.equal((await store.controlProjectTask(project.projectId, manual.taskId, "cancel")).status, "cancelled");
    assert.equal((await store.controlProjectTask(project.projectId, blocked.taskId, "start")).status, "running");
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("task controls enforce one active task, durable idempotency, and terminal boundaries", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-task-boundaries-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(withTaskCreationUseCases(await import("../infrastructure/file-project-store.mjs?task-boundaries=" + Date.now())));
  try {
    const classicTeam = await store.createClassicTeamProject({ caseId: "software-team" });
    const teamVersionId = classicTeam.teamVersionId;
    const project = await store.createCollaborationProject({ name: "Task Boundary Project", workspaceKey: "task-boundaries", teamVersionIds: [teamVersionId] });
    await assert.rejects(() => store.createCollaborationProject({ name: "Alias Project", teamVersionIds: ["case:software-team"] }), /TEAM_VERSION_ID_INVALID/);
    const first = await store.createProjectTask(project.projectId, { input: "First task", teamVersionId, idempotencyKey: "boundary-1" });
    const replay = await store.createProjectTask(project.projectId, { input: "First task", teamVersionId, idempotencyKey: "boundary-1" });
    assert.equal(replay.taskId, first.taskId);
    assert.equal(replay.idempotentReplay, true);
    await assert.rejects(
      () => store.createProjectTask(project.projectId, { input: "Changed task", teamVersionId, idempotencyKey: "boundary-1" }),
      /IDEMPOTENCY_KEY_REUSE/
    );

    await assert.rejects(() => store.createProjectTask(project.projectId, { input: "Alias task", teamVersionId: "case:software-team" }), /TEAM_VERSION_ID_INVALID/);
    const second = await store.createProjectTask(project.projectId, { input: "Second task", teamVersionId, idempotencyKey: "boundary-2" });
    const starts = await Promise.allSettled([
      store.controlProjectTask(project.projectId, first.taskId, "start"),
      store.controlProjectTask(project.projectId, second.taskId, "start")
    ]);
    assert.equal(starts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(starts.filter((result) => result.status === "rejected" && /PROJECT_TASK_CONCURRENCY_LIMIT|PROJECT_LOCK_CONFLICT|Project lock is active/.test(result.reason?.message || result.reason?.code || "")).length, 1);
    const runningTask = starts.find((result) => result.status === "fulfilled").value;
    const waitingTask = runningTask.taskId === first.taskId ? second : first;
    const waitingKey = runningTask.taskId === first.taskId ? "boundary-2" : "boundary-1";
    assert.equal((await store.controlProjectTask(project.projectId, runningTask.taskId, "pause")).status, "paused");
    await assert.rejects(
      () => store.reviewProjectTask(project.projectId, runningTask.taskId, { decision: "approve", comment: "人工确认后继续" }),
      /TASK_REVIEW_NOT_ALLOWED/
    );
    await store.controlProjectTask(project.projectId, runningTask.taskId, "cancel");
    assert.equal((await store.controlProjectTask(project.projectId, waitingTask.taskId, "start")).status, "running");
    await assert.rejects(() => store.controlProjectTask(project.projectId, runningTask.taskId, "resume"), /TASK_CONTROL_INVALID/);

    const deleted = await store.deleteProjectTask(project.projectId, waitingTask.taskId);
    assert.equal(deleted.status, "deleted");
    const deletedReplay = await store.createProjectTask(project.projectId, { input: waitingTask.input, teamVersionId, idempotencyKey: waitingKey });
    assert.equal(deletedReplay.taskId, waitingTask.taskId);
    assert.equal(deletedReplay.status, "deleted");

    const builtInDraft = await store.createProject({ name: "Task Boundary Built In", overview: "A linear graph for the execution boundary.", templateId: "empty" });
    const builtInTeam = await store.confirmProjectTeam(builtInDraft.projectId, { release: true });
    await assert.rejects(
      () => store.replaceProjectTeams(project.projectId, [teamVersionId, builtInTeam.teamVersionId]),
      /PROJECT_SINGLE_TEAM_REQUIRED/
    );
    const builtIn = await store.createProjectTask(project.projectId, { input: "Mounted TeamVersion execution", teamVersionId, idempotencyKey: "boundary-built-in" });
    const builtInRun = await store.startProjectTask(project.projectId, builtIn.taskId);
    assert.equal(builtInRun.status, "planning");
    assert.ok(builtInRun.currentRunId);
    const builtInCompleted = await waitForTask(store, project.projectId, builtIn.taskId);
    assert.equal(builtInCompleted.status, "completed");
    await waitForActiveTaskWorker(project.projectId, builtIn.taskId);
    const mountedTeam = (await store.getProject(project.projectId)).mountedTeams;
    assert.equal(mountedTeam.length, 1);
    assert.equal(mountedTeam[0].teamVersionId, builtInCompleted.teamVersionId);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
