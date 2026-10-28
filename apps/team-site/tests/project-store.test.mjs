import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireActiveRunLock } from "../../../dist/runtime/project-run-lock.js";
import { withTaskCreationUseCases } from "./task-creation-test-helpers.mjs";
import { withProjectUpdateUseCases } from "./project-update-test-helpers.mjs";
import { withCollaborationProjectUseCases } from "./collaboration-project-test-helpers.mjs";
import { withTeamLifecycleUseCases } from "./team-lifecycle-test-helpers.mjs";
import { withProjectMaterialUseCases } from "./project-material-test-helpers.mjs";
import { createFileRunQueryStore } from "../infrastructure/file-run-query-store.mjs";

test("native Team IR v2 is required before material access or direct Project Run", async () => {
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
    assert.equal(project.teamVersionStatus, "draft");
    await assert.rejects(
      () => store.addProjectMaterial(project.projectId, { filename: "brief.md", content: "blocked" }),
      /PROJECT_NOT_CONFIRMED/
    );
    const confirmed = await store.confirmProjectTeam(project.projectId);
    assert.equal(confirmed.teamVersionStatus, "released");
    assert.equal(typeof confirmed.projectDigest, "string");
    const confirmedAgain = await store.confirmProjectTeam(project.projectId);
    assert.equal(confirmedAgain.confirmedAt, confirmed.confirmedAt);
    const renamed = await store.updateProject(project.projectId, { name: "Renamed Team", overview: confirmed.overview });
    assert.equal(renamed.teamVersionStatus, "released");
    const changed = await store.updateProject(project.projectId, { overview: "A changed objective." });
    assert.equal(changed.teamVersionStatus, "draft");
    await store.confirmProjectTeam(project.projectId);
    await assert.rejects(
      () => store.addProjectMaterial(project.projectId, {
        filename: "brief.md",
        content: "# Brief\nUse the supplied facts only.\n",
        contentType: "text/markdown"
      }),
      /TEAM_IR_V2_REQUIRED/
    );

    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "Summarize the brief.", mode: "dry-run" }),
      /TEAM_IR_V2_REQUIRED/
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
    assert.equal(project.teamVersionStatus, "released");
    assert.equal(project.source, "classic");
    assert.match(project.teamIrSemanticDigest, /^[a-f0-9]{64}$/);
    assert.match(project.compiledPlanDigest, /^[a-f0-9]{64}$/);
    const frozenVersion = JSON.parse(await readFile(join(project.workdir, ".site", "team-version.json"), "utf8"));
    assert.equal(frozenVersion.teamIrSemanticDigest, project.teamIrSemanticDigest);
    assert.equal(frozenVersion.compiledPlanDigest, project.compiledPlanDigest);
    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "Prepare a concise delivery plan.", mode: "dry-run" }),
      /TEAM_IR_V2_REQUIRED/
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

test("project readiness blocks runs when the native Team IR v2 inspector is unavailable", async () => {
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
    assert.equal(readiness.teamVersionStatus, "released");
    assert.equal(readiness.canDryRun, false);
    assert.ok(readiness.blockers.some((issue) => issue.code === "TEAM_IR_V2_STORE_UNAVAILABLE"));
    assert.equal(Object.hasOwn(readiness, "workdir"), false);
    const issueMessages = readiness.blockers.map((issue) => issue.message).join("\n");
    assert.equal(issueMessages.includes(project.workdir), false);
    assert.match(issueMessages, /Team IR v2 storage is not configured/);
    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "Sandbox check.", mode: "sandbox" }),
      /TEAM_IR_V2_REQUIRED/
    );
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
    assert.equal(project.teamVersionStatus, "draft");
    assert.equal(project.source, "classic-template");
    const confirmed = await store.confirmProjectTeam(project.projectId);
    assert.equal(confirmed.teamVersionStatus, "released");
    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "Run the copied classic team.", mode: "dry-run" }),
      /TEAM_IR_V2_REQUIRED/
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("direct Run control is rejected without a Project Task owner", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-control-intent-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = withTeamLifecycleUseCases(await import("../infrastructure/file-project-store.mjs?control-intent=" + Date.now()));
  try {
    const project = await store.createProject({ name: "Control Intent Team", overview: "Test controls.", templateId: "empty" });
    await store.confirmProjectTeam(project.projectId);
    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "Run the control test.", mode: "dry-run" }),
      /TEAM_IR_V2_REQUIRED/
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
        mode: "sandbox",
        resumeRunId: "unowned-run",
        resumeRunDir: outsideRoot
      }),
      /TEAM_IR_V2_REQUIRED/
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("v2 Collaboration Tasks execute their bound TeamVersion through the deterministic Runtime", async () => {
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
    const firstStarted = await store.startProjectTask(project.projectId, first.taskId, { mode: "sandbox" });
    assert.equal(firstStarted.status, "planning");
    await store.waitForActiveTaskWorker(project.projectId, first.taskId);
    const secondStarted = await store.startProjectTask(project.projectId, second.taskId, { mode: "sandbox" });
    assert.equal(secondStarted.status, "planning");
    await store.waitForActiveTaskWorker(project.projectId, second.taskId);
    const firstCompleted = await store.getProjectTask(project.projectId, first.taskId);
    const secondCompleted = await store.getProjectTask(project.projectId, second.taskId);
    assert.equal(firstCompleted.status, "completed");
    assert.equal(secondCompleted.status, "completed");
    assert.equal(firstCompleted.compiledPlanDigest, first.compiledPlanDigest);
    const runQueryStore = createFileRunQueryStore({ projectsRoot });
    for (const task of [firstCompleted, secondCompleted]) {
      const state = await runQueryStore.readRunState(project.projectId, task.taskId, task.currentRunId);
      const owner = await runQueryStore.readRunOwner(project.projectId, task.taskId, task.currentRunId);
      const plan = await runQueryStore.readRunPlan(project.projectId, task.taskId, task.currentRunId);
      assert.equal(state.status, "completed");
      assert.equal(owner.teamVersionId, teamA.teamVersionId);
      assert.equal(plan.compiledPlanDigest, task.compiledPlanDigest);
    }

    const manual = await store.createProjectTask(project.projectId, { input: "Manual review step", teamVersionId: teamA.projectId, idempotencyKey: "task-manual" });
    const running = await store.controlProjectTask(project.projectId, manual.taskId, "start");
    assert.equal(running.status, "running");
    const blocked = await store.createProjectTask(project.projectId, { input: "Must wait", teamVersionId: teamA.projectId, idempotencyKey: "task-blocked" });
    await assert.rejects(() => store.controlProjectTask(project.projectId, blocked.taskId, "start"), /PROJECT_TASK_CONCURRENCY_LIMIT/);
    await assert.rejects(() => store.controlProjectTask(project.projectId, manual.taskId, "pause"), /TASK_CONTROL_INVALID/);
    assert.equal(store.reviewProjectTask, undefined);
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
    await assert.rejects(() => store.controlProjectTask(project.projectId, runningTask.taskId, "pause"), /TASK_CONTROL_INVALID/);
    assert.equal(store.reviewProjectTask, undefined);
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
    const expanded = await store.replaceProjectTeams(project.projectId, [teamVersionId, builtInTeam.teamVersionId]);
    assert.deepEqual(expanded.mountedTeams.map((team) => team.teamVersionId), [teamVersionId, builtInTeam.teamVersionId]);
    const builtIn = await store.createProjectTask(project.projectId, { input: "Mounted TeamVersion execution", teamVersionId, idempotencyKey: "boundary-built-in" });
    const builtInStarted = await store.startProjectTask(project.projectId, builtIn.taskId);
    assert.equal(builtInStarted.status, "planning");
    await store.waitForActiveTaskWorker(project.projectId, builtIn.taskId);
    const builtInCompleted = await store.getProjectTask(project.projectId, builtIn.taskId);
    assert.equal(builtInCompleted.status, "completed");
    assert.equal(builtInCompleted.compiledPlanDigest, builtIn.compiledPlanDigest);
    const mountedTeam = (await store.getProject(project.projectId)).mountedTeams;
    assert.equal(mountedTeam.length, 2);
    assert.equal(mountedTeam.some((team) => team.teamVersionId === builtIn.teamVersionId), true);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
