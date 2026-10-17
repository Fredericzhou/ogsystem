import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireActiveRunLock } from "../../../dist/runtime/project-run-lock.js";

async function waitForTask(store, projectId, taskId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const project = await store.getProject(projectId);
    const task = project.taskRecords.find((item) => item.taskId === taskId);
    if (task && ["completed", "failed", "cancelled"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Task did not reach a terminal state in time.");
}

test("site creates a persistent project, snapshots materials, and performs a dry run", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-projects-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import("../project-repository.mjs?test=" + Date.now());
  try {
    const project = await store.createProject({
      name: "Research Team",
      intent: "Analyze the supplied brief.",
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
    const renamed = await store.updateProject(project.projectId, { name: "Renamed Team", intent: confirmed.intent });
    assert.equal(renamed.projectStatus, "confirmed");
    const changed = await store.updateProject(project.projectId, { intent: "A changed objective." });
    assert.equal(changed.projectStatus, "draft");
    await store.confirmProjectTeam(project.projectId);
    const material = await store.addProjectMaterial(project.projectId, {
      filename: "brief.md",
      content: "# Brief\nUse the supplied facts only.\n",
      contentType: "text/markdown"
    });
    assert.equal(material.status, "indexed");

    const run = await store.startProjectRun(project.projectId, {
      prompt: "Summarize the brief.",
      mode: "dry-run"
    });
    assert.equal(run.mode, "dry-run");
    assert.equal(run.runPlan.executionPolicy.mode, "dry-run");
    assert.equal(run.runPlan.workspaceDigest.length, 64);
    assert.equal(run.runPlan.nodeGraph.length > 0, true);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("classic team use creates a confirmed asset and runs its trusted graph", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-classic-projects-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import("../project-repository.mjs?classic=" + Date.now());
  try {
    const project = await store.createClassicTeamProject({ caseId: "software-team" });
    assert.equal(project.projectStatus, "confirmed");
    assert.equal(project.source, "classic");
    const run = await store.startProjectRun(project.projectId, {
      prompt: "Prepare a concise delivery plan.",
      mode: "dry-run",
      idempotencyKey: "classic-dry-run"
    });
    assert.equal(["done", "completed"].includes(run.state.status), true);
    assert.equal(run.runPlan.projectId, project.projectId);
    assert.equal(run.runPlan.nodeGraph.length, 5);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("project workspaces reuse a directory for one team and reject cross-team binding", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-workspace-binding-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import("../project-repository.mjs?workspace-binding=" + Date.now());
  try {
    const team = await store.createClassicTeamProject({ caseId: "software-team" });
    const otherTeam = await store.createClassicTeamProject({ caseId: "expert-consultation" });
    const workspace = await store.createProjectWorkspace(team.projectId, { name: "Research project", workspaceKey: "shared-research" });
    assert.equal(workspace.projectStatus, "confirmed");
    assert.equal(workspace.teamProjectId, team.projectId);
    assert.equal(workspace.workspaceKey, "shared-research");
    const reused = await store.createProjectWorkspace(team.projectId, { name: "Renamed project", workspaceKey: "shared-research" });
    assert.equal(reused.projectId, workspace.projectId);
    await assert.rejects(
      () => store.createProjectWorkspace(otherTeam.projectId, { name: "Conflict", workspaceKey: "shared-research" }),
      /WORKSPACE_BOUND_TO_OTHER_TEAM/
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("project readiness is separate from structure confirmation and gates sandbox runs", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-readiness-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import("../project-repository.mjs?readiness=" + Date.now());
  try {
    const project = await store.createProject({ name: "Readiness Team", intent: "Check readiness.", templateId: "empty" });
    const roleDirs = await readdir(join(project.workdir, "og-roles", "roles"), { withFileTypes: true });
    const roleDir = join(project.workdir, "og-roles", "roles", roleDirs.find((entry) => entry.isDirectory()).name);
    await writeFile(join(roleDir, "role.json"), "{}", "utf8");
    await writeFile(join(project.workdir, ".ogs", "model-catalog.json"), "{}", "utf8");
    await store.confirmProjectTeam(project.projectId);
    const readiness = await store.getProjectReadiness(project.projectId);
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
      (error) => {
        assert.match(error.message, /PROJECT_NOT_READY/);
        assert.equal(error.message.includes(project.workdir), false);
        return true;
      }
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("classic team templates can be confirmed and run after copying for edits", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-classic-template-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import("../project-repository.mjs?classic-template=" + Date.now());
  try {
    const project = await store.createClassicTeamProject({ caseId: "software-team", asTemplate: true });
    assert.equal(project.projectStatus, "draft");
    assert.equal(project.source, "classic-template");
    const confirmed = await store.confirmProjectTeam(project.projectId);
    assert.equal(confirmed.projectStatus, "confirmed");
    const run = await store.startProjectRun(project.projectId, {
      prompt: "Run the copied classic team.",
      mode: "dry-run",
      idempotencyKey: "classic-template-dry-run"
    });
    assert.equal(["done", "completed"].includes(run.state.status), true);
    assert.equal(run.runPlan.nodeGraph.length, 5);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("confirmed projects round-trip through the project bundle and retry as a new run", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-project-roundtrip-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import("../project-repository.mjs?roundtrip=" + Date.now());
  try {
    const project = await store.createProject({ name: "Roundtrip Team", intent: "Produce a concise brief.", templateId: "empty" });
    await store.confirmProjectTeam(project.projectId);
    await store.addProjectMaterial(project.projectId, { filename: "brief.md", content: "facts", contentType: "text/markdown" });
    const run = await store.startProjectRun(project.projectId, { prompt: "Summarize facts.", mode: "dry-run", idempotencyKey: "same-request" });
    const duplicate = await store.startProjectRun(project.projectId, { prompt: "Summarize facts.", mode: "dry-run", idempotencyKey: "same-request" });
    assert.equal(duplicate.runId, run.runId);
    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "A different prompt.", mode: "dry-run", idempotencyKey: "same-request" }),
      /IDEMPOTENCY_KEY_REUSE/
    );
    const bundle = await store.exportProjectTeam(project.projectId);
    assert.equal(bundle.mode, "single-project-v1");
    const imported = await store.importTeamPackage({ ...bundle, team: { ...bundle.team, project: { ...bundle.team.project, name: "Roundtrip Team Imported" } } });
    assert.equal(imported.projectStatus, "draft");
    assert.equal(imported.source, "imported");
    await assert.rejects(() => store.startProjectRun(imported.projectId, { prompt: "blocked" }), /PROJECT_NOT_CONFIRMED/);
    await store.confirmProjectTeam(imported.projectId);
    const importedRun = await store.startProjectRun(imported.projectId, { prompt: "Run the imported team.", mode: "dry-run" });
    assert.equal(importedRun.mode, "dry-run");
    assert.equal(importedRun.runPlan.projectDigest.length, 64);
    await assert.rejects(() => store.retryProjectRun(project.projectId, run.runId), /RUN_RETRY_UNSUPPORTED/);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("project bundles carry executable role and contract assets without importing the old project identity", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-package-assets-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import("../project-repository.mjs?package-assets=" + Date.now());
  try {
    const project = await store.createProject({ name: "Executable Team", intent: "Package executable assets.", templateId: "empty" });
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

    const bundle = await store.exportProjectTeam(project.projectId);
    assert.ok(bundle.team.executableFiles.some((file) => file.path.endsWith("package-role/prompt.md")));
    assert.ok(bundle.team.executableFiles.some((file) => file.path === ".ogs/contracts/handoff.json"));
    assert.ok(bundle.team.executableFiles.some((file) => file.path === ".ogs/semantics.yaml"));
    assert.ok(bundle.team.executableFiles.some((file) => file.path === ".ogs/models.json"));
    assert.ok(bundle.team.executableFiles.some((file) => file.path === ".ogs/systems/nested.mmd"));
    assert.ok(bundle.team.executableFiles.some((file) => file.path === ".ogs/subsystems/child.json"));
    const imported = await store.importTeamPackage({ ...bundle, team: { ...bundle.team, project: { ...bundle.team.project, name: "Executable Team Imported" } } });
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

test("running controls write durable intent without acquiring the active run lock", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-control-intent-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import("../project-repository.mjs?control-intent=" + Date.now());
  try {
    const project = await store.createProject({ name: "Control Intent Team", intent: "Test controls.", templateId: "empty" });
    await store.confirmProjectTeam(project.projectId);
    const run = await store.startProjectRun(project.projectId, { prompt: "Run the control test.", mode: "dry-run" });
    const statePath = join(project.workdir, ".ogs", "runs", run.runId, "control", "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    await writeFile(statePath, JSON.stringify({ ...state, status: "running", control: { paused: false, cancelRequested: false } }), "utf8");
    const activeLock = await acquireActiveRunLock(project.workdir, run.runId);
    try {
      const pause = await store.controlProjectRun(project.projectId, run.runId, "pause");
      assert.equal(pause.state.status, "pause_requested");
      const cancel = await store.controlProjectRun(project.projectId, run.runId, "cancel");
      assert.equal(cancel.state.status, "cancel_requested");
      await assert.rejects(
        () => store.controlProjectRun(project.projectId, run.runId, "resume"),
        /RUN_RESUME_NOT_ALLOWED/
      );
      const requestDir = join(project.workdir, ".ogs", "runs", run.runId, "control", "requests");
      const requestFiles = await readdir(requestDir);
      assert.equal(requestFiles.length, 2);
      const requests = await Promise.all(requestFiles.map((file) => readFile(join(requestDir, file), "utf8").then(JSON.parse)));
      assert.deepEqual(requests.map((request) => request.action).sort(), ["cancel", "pause"]);
    } finally {
      await activeLock.release();
    }
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("project asset digest detects role package changes and credential validation is field based", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-digest-import-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import("../project-repository.mjs?digest-import=" + Date.now());
    const { computeProjectAssetDigest } = await import("../../../dist/runtime/project-asset-digest.js?digest-import=" + Date.now());
  try {
    const project = await store.createProject({ name: "Digest Team", intent: "Check package assets.", templateId: "empty" });
    const confirmed = await store.confirmProjectTeam(project.projectId);
    const digestBeforeSemanticEdit = await computeProjectAssetDigest(project.workdir);
    await writeFile(join(project.workdir, ".ogs", "semantics.yaml"), "version: 1\nsystem:\n  systemId: digest-team\n  systemVersion: 1.0.0\n", "utf8");
    assert.notEqual(await computeProjectAssetDigest(project.workdir), digestBeforeSemanticEdit);
    await mkdir(join(project.workdir, "og-roles", "roles", "digest-role"), { recursive: true });
    await writeFile(join(project.workdir, "og-roles", "roles", "digest-role", "prompt.md"), "Discuss token budgets and password policy.", "utf8");
    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "Should be blocked.", mode: "dry-run" }),
      /PROJECT_CONFIRMATION_STALE/
    );
    await assert.rejects(
      () => store.startProjectRun(project.projectId, { prompt: "Semantic asset changed.", mode: "dry-run" }),
      /PROJECT_CONFIRMATION_STALE/
    );
    const bundle = {
      mode: "single-project-v1",
      team: {
        systemSource: await readFile(join(project.workdir, "system.mmd"), "utf8"),
        project: { name: "Imported", intent: "Discuss token budgets and password policy." }
      }
    };
    const imported = await store.importTeamPackage(bundle);
    assert.equal(imported.projectStatus, "draft");
    await assert.rejects(
      () => store.importTeamPackage({ ...bundle, team: { ...bundle.team, project: { apiKey: "secret-value" } } }),
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
  const store = await import("../project-repository.mjs?design-control=" + Date.now());
  try {
    const project = await store.createProject({ name: "Editable Team", intent: "Edit structure", templateId: "minimal" });
    const design = await store.getProjectDesign(project.projectId);
    assert.equal(design.authoring.version, 1);
    const saved = await store.saveProjectDesign(project.projectId, {
      systemSource: design.systemSource,
      expectedProjectDigest: design.projectDigest
    });
    assert.equal(saved.projectStatus, "draft");
    await store.confirmProjectTeam(project.projectId);
    const run = await store.startProjectRun(project.projectId, { prompt: "check terminal control", mode: "dry-run" });
    await assert.rejects(
      () => store.controlProjectRun(project.projectId, run.runId, "resume"),
      /RUN_RESUME_NOT_ALLOWED|status is completed/
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("project run resume rejects a directory that does not match the requested project and run", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-resume-path-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "ogs-site-resume-outside-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import("../project-repository.mjs?resume-path=" + Date.now());
  try {
    const project = await store.createProject({ name: "Resume Path Team", intent: "Validate resume paths.", templateId: "empty" });
    await store.confirmProjectTeam(project.projectId);
    const run = await store.startProjectRun(project.projectId, { prompt: "Validate this run.", mode: "dry-run" });
    await assert.rejects(
      () => store.startProjectRun(project.projectId, {
        prompt: "Validate this run.",
        mode: "dry-run",
        resumeRunId: run.runId,
        resumeRunDir: outsideRoot
      }),
      /RUN_RESUME_INVALID/
    );
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("collaboration tasks run sequentially across teams and preserve pause/review controls", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-task-controls-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import("../project-repository.mjs?task-controls=" + Date.now());
  try {
    const teamA = await store.createProject({ name: "Task Control A", intent: "Analyze input.", templateId: "empty" });
    await store.confirmProjectTeam(teamA.projectId, { release: true });
    const teamB = await store.createProject({ name: "Task Control B", intent: "Review output.", templateId: "empty" });
    await store.confirmProjectTeam(teamB.projectId, { release: true });
    const project = await store.createCollaborationProject({ name: "Task Control Project", workspaceKey: "task-control" });
    await store.mountProjectTeam(project.projectId, teamA.projectId);
    await store.mountProjectTeam(project.projectId, teamB.projectId);
    const first = await store.createProjectTask(project.projectId, { input: "Analyze input", teamVersionId: teamA.projectId, idempotencyKey: "task-a" });
    const second = await store.createProjectTask(project.projectId, { input: "Review output", teamVersionId: teamB.projectId, idempotencyKey: "task-b" });
    const firstRun = await store.startProjectTask(project.projectId, first.taskId, { mode: "dry-run" });
    assert.equal(firstRun.status, "planning");
    assert.ok(firstRun.runId);
    const firstCompleted = await waitForTask(store, project.projectId, first.taskId);
    assert.equal(firstCompleted.status, "completed");
    const secondRun = await store.startProjectTask(project.projectId, second.taskId, { mode: "dry-run" });
    assert.equal(secondRun.status, "planning");
    assert.ok(secondRun.runId);
    const secondCompleted = await waitForTask(store, project.projectId, second.taskId);
    assert.equal(secondCompleted.status, "completed");

    const manual = await store.createProjectTask(project.projectId, { input: "Manual review step", teamVersionId: teamA.projectId, idempotencyKey: "task-manual" });
    const running = await store.controlProjectTask(project.projectId, manual.taskId, "start");
    assert.equal(running.status, "running");
    const blocked = await store.createProjectTask(project.projectId, { input: "Must wait", teamVersionId: teamB.projectId, idempotencyKey: "task-blocked" });
    await assert.rejects(() => store.controlProjectTask(project.projectId, blocked.taskId, "start"), /PROJECT_TASK_CONCURRENCY_LIMIT/);
    assert.equal((await store.controlProjectTask(project.projectId, manual.taskId, "pause")).status, "paused");
    const reviewed = await store.reviewProjectTask(project.projectId, manual.taskId, { decision: "approve", comment: "继续处理" });
    assert.equal(reviewed.task.status, "ready");
    assert.equal((await store.controlProjectTask(project.projectId, manual.taskId, "resume")).status, "queued");
    assert.equal((await store.controlProjectTask(project.projectId, manual.taskId, "stop")).status, "stopped");
    assert.equal((await store.controlProjectTask(project.projectId, blocked.taskId, "start")).status, "running");
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("task controls enforce one active task, durable idempotency, and terminal boundaries", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-task-boundaries-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import("../project-repository.mjs?task-boundaries=" + Date.now());
  try {
    const project = await store.createCollaborationProject({ name: "Task Boundary Project", workspaceKey: "task-boundaries" });
    await store.mountProjectTeam(project.projectId, "case:software-team");
    const first = await store.createProjectTask(project.projectId, { input: "First task", teamVersionId: "case:software-team", idempotencyKey: "boundary-1" });
    const replay = await store.createProjectTask(project.projectId, { input: "First task", teamVersionId: "case:software-team", idempotencyKey: "boundary-1" });
    assert.equal(replay.taskId, first.taskId);
    assert.equal(replay.idempotentReplay, true);
    await assert.rejects(
      () => store.createProjectTask(project.projectId, { input: "Changed task", teamVersionId: "case:software-team", idempotencyKey: "boundary-1" }),
      /IDEMPOTENCY_KEY_REUSE/
    );

    const second = await store.createProjectTask(project.projectId, { input: "Second task", teamVersionId: "case:software-team", idempotencyKey: "boundary-2" });
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
    assert.equal((await store.reviewProjectTask(project.projectId, runningTask.taskId, { decision: "approve", comment: "人工确认后继续" })).task.status, "ready");
    await store.controlProjectTask(project.projectId, runningTask.taskId, "resume");
    await store.controlProjectTask(project.projectId, runningTask.taskId, "stop");
    assert.equal((await store.controlProjectTask(project.projectId, waitingTask.taskId, "start")).status, "running");
    await assert.rejects(() => store.controlProjectTask(project.projectId, runningTask.taskId, "resume"), /TASK_CONTROL_INVALID/);

    const deleted = await store.deleteProjectTask(project.projectId, waitingTask.taskId);
    assert.equal(deleted.status, "deleted");
    const deletedReplay = await store.createProjectTask(project.projectId, { input: waitingTask.input, teamVersionId: "case:software-team", idempotencyKey: waitingKey });
    assert.equal(deletedReplay.taskId, waitingTask.taskId);
    assert.equal(deletedReplay.status, "deleted");

    const builtIn = await store.createProjectTask(project.projectId, { input: "Built-in execution", teamVersionId: "case:software-team", idempotencyKey: "boundary-built-in" });
    await assert.rejects(() => store.startProjectTask(project.projectId, builtIn.taskId), /TASK_EXECUTION_UNAVAILABLE/);
    assert.equal((await store.getProject(project.projectId)).taskRecords.find((task) => task.taskId === builtIn.taskId).status, "queued");
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
