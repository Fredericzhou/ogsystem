import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { runSystemWithAdapter } from "../../dist/runtime/adapter.js";
import { createRunId } from "../../dist/runtime/run-artifacts.js";
import { rebuildRunsIndex } from "../../dist/runtime/project-lifecycle.js";
import { loadProjectRunPlan, loadProjectMaterialSnapshots, validateLinearProjectTopology } from "../../dist/runtime/project-run.js";
import { evaluateProjectRunResult } from "../../dist/runtime/project-quality.js";
import { createExecutionPlan } from "../../dist/runtime/execution-plan.js";
import { parseSystemFromMermaidSource } from "../../dist/runtime/parse-mermaid.js";
import { acquireActiveRunLock, acquireProjectWriteLock } from "../../dist/runtime/project-run-lock.js";
import { applyRunControl as writeRunStateControl, loadProjectRunState, updateProjectRunState } from "../../dist/runtime/project-run-state.js";
import { readLatestProjectRunControl, writeProjectRunControl } from "../../dist/runtime/project-run-control.js";
import { listHumanReviews, writeHumanReviewDecision } from "../../dist/runtime/project-lifecycle.js";
import { createLocalControlPlanePrincipal } from "../../dist/runtime/identity.js";
import { computeProjectAssetDigest } from "../../dist/runtime/project-asset-digest.js";
import {
  createProjectVisualization,
  inspectProjectWorkspace,
  exportTeamPackage,
  loadTeamPackage
} from "../../dist/visualizer/project-projection.js";
import { authoringToCanvasDocument, importMermaidToAuthoring, serializeAuthoringToMermaid } from "../../dist/visualizer/studio-authoring.js";
import { buildGraphViewModel } from "../../dist/visualizer/graph-view-model.js";
import { inspectProjectReadiness } from "../../dist/visualizer/project-readiness.js";
import { validateProjectSystemSource, saveProjectSystemSource } from "../../dist/visualizer/project-projection.js";
import { getCase } from "./cases.mjs";
import { materializeCaseTeam } from "./demo-runner.mjs";

const projectsRoot = resolve(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects"));
const allowedExtensions = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv"]);

function slug(value) {
  const normalized = String(value || "new-team").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 48) || "new-team";
}

function assertProjectId(projectId) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(projectId)) throw new Error("Invalid project id.");
}

function assertSafeId(value, field) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value || ""))) throw new Error(`${field} is invalid.`);
}

function projectPath(projectId) {
  assertProjectId(projectId);
  const target = resolve(projectsRoot, projectId);
  if (!target.startsWith(projectsRoot + sep)) throw new Error("Project path is outside the site workspace.");
  return target;
}

async function readJson(path, fallback = undefined) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temp, path);
}

function normalizeMeta(meta, projectId) {
  const confirmed = meta?.projectStatus === "confirmed" && typeof meta?.projectDigest === "string" && typeof meta?.confirmedAt === "string";
  const teamVersionStatus = meta?.teamVersionStatus || (confirmed ? "released" : "draft");
  const teamId = String(meta?.teamId || (meta?.teamProjectId || meta?.projectType === "collaboration" ? "" : projectId));
  const teamVersionNumber = Number.isInteger(meta?.teamVersionNumber) && meta.teamVersionNumber > 0 ? meta.teamVersionNumber : 1;
  return {
    projectId,
    name: String(meta?.name || "New team"),
    intent: String(meta?.intent || ""),
    templateId: meta?.templateId || "empty",
    projectStatus: confirmed ? "confirmed" : "draft",
    projectDigest: confirmed ? meta.projectDigest : null,
    confirmedAt: confirmed ? meta.confirmedAt : null,
    createdAt: meta?.createdAt || new Date().toISOString(),
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    source: meta?.source || "created",
    teamId: teamId || undefined,
    teamVersionId: meta?.teamVersionId || (teamId ? projectId : undefined),
    teamVersionNumber,
    teamVersionStatus,
    teamName: String(meta?.teamName || meta?.name || "New team"),
    parentTeamVersionId: meta?.parentTeamVersionId || undefined,
    releasedAt: meta?.releasedAt || (teamVersionStatus === "released" ? meta?.confirmedAt || null : null),
    archivedAt: meta?.archivedAt || null,
    ...(meta?.teamProjectId ? { teamProjectId: meta.teamProjectId } : {}),
    ...(meta?.workspaceKey ? { workspaceKey: String(meta.workspaceKey) } : {}),
    ...(meta?.caseId ? { caseId: meta.caseId } : {}),
    ...(meta?.ogsProjectId ? { ogsProjectId: meta.ogsProjectId } : {})
    ,projectType: meta?.projectType || (meta?.teamProjectId ? "workspace" : "team")
    ,mountedTeams: Array.isArray(meta?.mountedTeams) ? meta.mountedTeams : []
    ,taskRecords: Array.isArray(meta?.taskRecords) ? meta.taskRecords : []
  };
}

function projectStage(project) {
  // This is a UI projection only. Authorization uses projectStatus, run state, and locks.
  if (project.projectStatus !== "confirmed") return "draft";
  if ((project.runs || []).some((run) => ["running", "planning", "waiting_review", "paused"].includes(run.status))) return "running";
  return "ready";
}

async function withProjectWriteLock(projectId, operation, action) {
  const lock = await acquireProjectWriteLock(projectPath(projectId), operation);
  try { return await action(); } finally { await lock.release(); }
}

async function semanticProjectDigest(project) {
  return computeProjectAssetDigest(project.workdir);
}

function requireConfirmed(project) {
  // A confirmed team is eligible for a project workspace; each run still creates its own snapshot.
  if (project.projectStatus !== "confirmed" || !project.projectDigest || !project.confirmedAt) {
    throw new Error("PROJECT_NOT_CONFIRMED: confirm the team design before preparing or running a task.");
  }
}

function isTrustedTeamTopology(project) {
  return project.source === "classic" || project.source === "classic-template";
}

async function requireCurrentConfirmation(project) {
  requireConfirmed(project);
  const currentDigest = await semanticProjectDigest(project);
  if (currentDigest !== project.projectDigest) throw new Error("PROJECT_CONFIRMATION_STALE: semantic project files changed; confirm the project again.");
}

async function readProject(projectId) {
  const workdir = projectPath(projectId);
  const meta = await readJson(join(workdir, ".site", "project.json"));
  if (!meta) throw new Error("Project not found.");
  const workspace = await inspectProjectWorkspace(workdir);
  const materials = await readJson(join(workdir, "workspace", "index.json"), { version: 1, materials: [] });
  const runs = await readJson(join(workdir, ".ogs", "runs-index.json"), { runs: [] });
  const normalized = normalizeMeta(meta, projectId);
  const project = { ...normalized, workdir, workspace, materials, runs: runs.runs || [] };
  return { ...project, projectStage: projectStage(project) };
}

export async function listProjects() {
  await mkdir(projectsRoot, { recursive: true });
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await readJson(join(projectsRoot, entry.name, ".site", "project.json"));
    if (meta) {
      const normalized = normalizeMeta(meta, entry.name);
      const runIndex = await readJson(join(projectsRoot, entry.name, ".ogs", "runs-index.json"), { runs: [] });
      projects.push({
        ...normalized,
        projectStage: projectStage({ ...normalized, runs: runIndex.runs || [] })
      });
    }
  }
  return projects.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

export async function createProject({ name, intent, templateId = "empty", caseId, source = "created", locale = "zh-CN", teamId, teamName, teamVersionNumber = 1, parentTeamVersionId }) {
  await mkdir(projectsRoot, { recursive: true });
  const projectId = slug(name) + "-" + randomUUID().slice(0, 8);
  const normalizedName = String(name || "New team").trim().slice(0, 120) || "New team";
  const existingProjects = await listProjects();
  const resolvedTeamName = String(teamName || normalizedName).trim().slice(0, 120) || normalizedName;
  const isTeamAsset = source !== "collaboration-project" && source !== "workspace";
  if (isTeamAsset && !teamId && existingProjects.some((project) => !project.teamProjectId && project.teamName.toLocaleLowerCase() === resolvedTeamName.toLocaleLowerCase() && project.teamVersionStatus !== "archived")) {
    throw new Error("TEAM_NAME_EXISTS: a team with this name already exists.");
  }
  const workdir = projectPath(projectId);
  await mkdir(workdir, { recursive: true });
  const created = await createProjectVisualization({
    currentWorkdir: workdir,
    projectName: slug(name),
    templateId: templateId === "minimal" ? "minimal" : "empty",
    conflictStrategy: "reject"
  });
  const now = new Date().toISOString();
  await writeJson(join(workdir, ".site", "project.json"), {
    projectId,
    name: normalizedName,
    teamName: resolvedTeamName,
    teamId: teamId || projectId,
    teamVersionId: projectId,
    teamVersionNumber,
    teamVersionStatus: "draft",
    ...(parentTeamVersionId ? { parentTeamVersionId } : {}),
    intent: String(intent || "").trim().slice(0, 4000),
    templateId,
    projectStatus: "draft",
    projectDigest: null,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
    ogsProjectId: created.projectId,
    source,
    ...(caseId ? { caseId } : {})
  });
  await writeJson(join(workdir, "workspace", "index.json"), { version: 1, materials: [] });
  if (caseId) await materializeCaseTeam(caseId, workdir, locale === "en" ? "en" : "zh-CN");
  return readProject(projectId);
}

export async function createCollaborationProject({ name, workspaceKey, intent = "" } = {}) {
  const project = await createProject({
    name: String(name || "协作项目").trim() || "协作项目",
    intent,
    templateId: "empty",
    source: "collaboration-project"
  });
  const metaPath = join(project.workdir, ".site", "project.json");
  const meta = await readJson(metaPath, {});
  await writeJson(metaPath, {
    ...meta,
    projectType: "collaboration",
    teamId: undefined,
    teamVersionId: undefined,
    teamName: undefined,
    mountedTeams: [],
    taskRecords: [],
    workspaceKey: String(workspaceKey || slug(name || "collaboration-project"))
  });
  return readProject(project.projectId);
}

export async function mountProjectTeam(projectId, teamVersionId) {
  return withProjectWriteLock(projectId, "project-team-mount", async () => {
    const project = await readProject(projectId);
    if (project.projectType !== "collaboration") throw new Error("PROJECT_TYPE_INVALID: only collaboration projects can mount teams.");
    const requestedTeamId = String(teamVersionId || "");
    let team;
    if (requestedTeamId.startsWith("case:")) {
      const caseId = requestedTeamId.slice(5);
      const caseSpec = getCase(caseId);
      if (!caseSpec) throw new Error("TEAM_NOT_FOUND: the selected built-in team does not exist.");
      const language = "zh-CN";
      const teamName = caseSpec.title?.[language] || caseSpec.title?.en || caseId;
      const intent = caseSpec.detail?.scenario?.[language] || caseSpec.short?.[language] || "";
      team = {
        projectId: requestedTeamId,
        teamId: requestedTeamId,
        teamVersionId: requestedTeamId,
        teamVersionNumber: 1,
        teamName,
        name: teamName,
        intent,
        teamVersionStatus: "released",
        builtIn: true
      };
    } else {
      team = await readProject(requestedTeamId);
    }
    if (team.teamProjectId || team.teamVersionStatus !== "released") throw new Error("TEAM_VERSION_NOT_RELEASED: only a released team version can be mounted.");
    const mountedTeams = Array.isArray(project.mountedTeams) ? project.mountedTeams : [];
    if (mountedTeams.some((item) => item.teamVersionId === team.teamVersionId)) return project;
    const next = {
      ...normalizeMeta(project, projectId),
      projectType: "collaboration",
      mountedTeams: [...mountedTeams, {
        teamId: team.teamId || team.projectId,
        teamVersionId: team.teamVersionId || team.projectId,
        teamVersionNumber: team.teamVersionNumber || 1,
        teamName: team.teamName || team.name,
        mountedAt: new Date().toISOString(),
        status: "ready"
      }],
      updatedAt: new Date().toISOString()
    };
    await writeJson(join(project.workdir, ".site", "project.json"), next);
    return readProject(projectId);
  });
}

export async function listCollaborationProjects() {
  return (await listProjects()).filter((project) => project.projectType === "collaboration");
}

export async function createProjectTask(projectId, { input, teamVersionId, idempotencyKey } = {}) {
  return withProjectWriteLock(projectId, "project-task-create", async () => {
    const project = await readProject(projectId);
    if (project.projectType !== "collaboration") throw new Error("PROJECT_TYPE_INVALID: only collaboration projects can create tasks.");
    const taskInput = String(input || "").trim();
    if (!taskInput || taskInput.length > 4000) throw new Error("Task input must contain 1 to 4,000 characters.");
    const mountedTeams = project.mountedTeams || [];
    const team = mountedTeams.find((item) => item.teamVersionId === teamVersionId) || mountedTeams[0];
    if (!team) throw new Error("PROJECT_TEAM_REQUIRED: mount a team before creating a task.");
    const requestKey = idempotencyKey ? String(idempotencyKey).trim().slice(0, 160) : "";
    const requestFingerprint = createHash("sha256").update(JSON.stringify({
      projectId,
      input: taskInput,
      teamVersionId: team.teamVersionId
    })).digest("hex");
    const existing = (project.taskRecords || []).find((item) => requestKey && item.idempotencyKey === requestKey);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new Error("IDEMPOTENCY_KEY_REUSE: idempotency key was already used with a different task.");
      return { ...existing, idempotentReplay: true };
    }
    const task = {
      taskId: createRunId(new Date()),
      projectId,
      input: taskInput,
      teamId: team.teamId,
      teamVersionId: team.teamVersionId,
      teamVersionNumber: team.teamVersionNumber,
      teamName: team.teamName,
      status: "queued",
      idempotencyKey: requestKey || null,
      requestFingerprint,
      runId: null,
      startedAt: null,
      completedAt: null,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      review: null,
      roundNumber: (project.taskRecords || []).length + 1,
      outputSummary: "",
      commitPlaceholder: null
    };
    const next = { ...normalizeMeta(project, projectId), taskRecords: [...(project.taskRecords || []), task], updatedAt: new Date().toISOString() };
    await writeJson(join(project.workdir, ".site", "project.json"), next);
    return task;
  });
}

function findTask(project, taskId) {
  const task = (project.taskRecords || []).find((item) => item.taskId === taskId);
  if (!task || task.deletedAt) throw new Error("TASK_NOT_FOUND: task does not exist.");
  return task;
}

const activeTaskStatuses = new Set(["running", "planning", "pause_requested", "paused", "waiting_review", "ready"]);

function assertProjectTaskExecutionSlot(project, taskId) {
  const active = (project.taskRecords || []).find((item) => item.taskId !== taskId && !item.deletedAt && activeTaskStatuses.has(item.status));
  if (active) throw new Error(`PROJECT_TASK_CONCURRENCY_LIMIT: task ${active.taskId} is currently ${active.status}; finish or stop it before starting another task.`);
}

async function saveTaskRecord(project, taskId, update) {
  const now = new Date().toISOString();
  const task = findTask(project, taskId);
  const nextTask = { ...task, ...update, updatedAt: now };
  const taskRecords = (project.taskRecords || []).map((item) => item.taskId === taskId ? nextTask : item);
  await writeJson(join(project.workdir, ".site", "project.json"), {
    ...normalizeMeta(project, project.projectId),
    taskRecords,
    updatedAt: now
  });
  return nextTask;
}

export async function controlProjectTask(projectId, taskId, control) {
  if (!["start", "pause", "resume", "stop"].includes(control)) throw new Error("TASK_CONTROL_INVALID: unsupported task control.");
  const project = await readProject(projectId);
  const task = findTask(project, taskId);
  if (["completed", "failed", "stopped", "cancelled", "deleted"].includes(task.status)) {
    if (control === "stop" && ["stopped", "cancelled"].includes(task.status)) return task;
    throw new Error(`TASK_CONTROL_INVALID: task is already ${task.status}.`);
  }
  if (task.runId) {
    if (control === "start") throw new Error("TASK_CONTROL_INVALID: task already has a run.");
    if (control === "resume") assertProjectTaskExecutionSlot(project, taskId);
    const runControl = control === "stop" ? "cancel" : control;
    const result = await controlProjectRun(task.runProjectId || projectId, task.runId, runControl);
    const status = result.state?.status || (control === "stop" ? "cancel_requested" : control === "pause" ? "pause_requested" : "running");
    return withProjectWriteLock(projectId, "project-task-control", async () => {
      const latest = await readProject(projectId);
      return saveTaskRecord(latest, taskId, { status: status === "cancelled" ? "stopped" : status, runId: task.runId });
    });
  }
  if (control === "start") {
    if (task.status !== "queued") throw new Error(`TASK_START_NOT_ALLOWED: task status is ${task.status}.`);
    assertProjectTaskExecutionSlot(project, taskId);
    return withProjectWriteLock(projectId, "project-task-start", async () => {
      const latest = await readProject(projectId);
      const latestTask = findTask(latest, taskId);
      if (latestTask.status !== "queued") throw new Error(`TASK_START_NOT_ALLOWED: task status is ${latestTask.status}.`);
      assertProjectTaskExecutionSlot(latest, taskId);
      return saveTaskRecord(latest, taskId, { status: "running", startedAt: new Date().toISOString() });
    });
  }
  if (control === "pause") {
    if (["paused", "pause_requested"].includes(task.status)) return task;
    return withProjectWriteLock(projectId, "project-task-pause", async () => saveTaskRecord(await readProject(projectId), taskId, { status: "paused" }));
  }
  if (control === "resume") {
    if (!["paused", "ready"].includes(task.status)) throw new Error(`TASK_RESUME_NOT_ALLOWED: task status is ${task.status}.`);
    return withProjectWriteLock(projectId, "project-task-resume", async () => saveTaskRecord(await readProject(projectId), taskId, { status: "queued" }));
  }
  return withProjectWriteLock(projectId, "project-task-stop", async () => saveTaskRecord(await readProject(projectId), taskId, { status: "stopped", completedAt: new Date().toISOString() }));
}

export async function startProjectTask(projectId, taskId, { mode = "dry-run" } = {}) {
  if (!["dry-run", "sandbox"].includes(mode)) throw new Error("TASK_MODE_INVALID: unsupported task mode.");
  let project = await readProject(projectId);
  let task = findTask(project, taskId);
  if (!["queued", "paused"].includes(task.status)) {
    if (task.runId) return { task, idempotentReplay: true };
    throw new Error(`TASK_START_NOT_ALLOWED: task status is ${task.status}.`);
  }
  if (task.runId) return controlProjectTask(projectId, taskId, "resume");
  const reserved = await withProjectWriteLock(projectId, "project-task-reserve", async () => {
    const latest = await readProject(projectId);
    const latestTask = findTask(latest, taskId);
    if (!["queued", "paused"].includes(latestTask.status)) {
      if (latestTask.runId) return { project: latest, task: latestTask };
      throw new Error(`TASK_START_NOT_ALLOWED: task status is ${latestTask.status}.`);
    }
    assertProjectTaskExecutionSlot(latest, taskId);
    const nextTask = await saveTaskRecord(latest, taskId, { status: "planning", startedAt: latestTask.startedAt || new Date().toISOString(), lastError: null });
    return { project: await readProject(projectId), task: nextTask };
  });
  project = reserved.project;
  task = reserved.task;
  if (task.runId) return task;
  const team = (project.mountedTeams || []).find((item) => item.teamVersionId === task.teamVersionId);
  if (!team || String(team.teamVersionId || "").startsWith("case:")) {
    await withProjectWriteLock(projectId, "project-task-start-unavailable", async () => saveTaskRecord(await readProject(projectId), taskId, { status: "queued", lastError: "TASK_EXECUTION_UNAVAILABLE" })).catch(() => undefined);
    throw new Error("TASK_EXECUTION_UNAVAILABLE: copy the built-in team into a released team version before running this task.");
  }
  const materials = (project.materials?.materials || []).map((item) => ({
    materialId: item.materialId,
    sourcePath: resolve(project.workdir, item.path),
    contentType: item.contentType
  }));
  let run;
  try {
    run = await startProjectRun(team.teamVersionId, {
      prompt: task.input,
      mode,
      idempotencyKey: `task:${projectId}:${taskId}`,
      materialInputsOverride: materials
    });
  } catch (error) {
    await withProjectWriteLock(projectId, "project-task-start-failure", async () => saveTaskRecord(await readProject(projectId), taskId, { status: "queued", lastError: error instanceof Error ? error.message : String(error) })).catch(() => undefined);
    throw error;
  }
  return withProjectWriteLock(projectId, "project-task-bind-run", async () => {
    const latest = await readProject(projectId);
    return saveTaskRecord(latest, taskId, {
      runId: run.runId,
      runProjectId: team.teamVersionId,
      status: run.state?.status || "running",
      startedAt: task.startedAt || new Date().toISOString(),
      completedAt: ["completed", "failed", "cancelled"].includes(run.state?.status) ? (run.state?.finishedAt || new Date().toISOString()) : null,
      outputSummary: typeof run.result?.finalOutput === "string" ? run.result.finalOutput.slice(0, 500) : task.outputSummary
    });
  });
}

export async function reviewProjectTask(projectId, taskId, { decision, comment, reviewId } = {}) {
  if (!["approve", "rework", "pause", "terminate"].includes(decision)) throw new Error("TASK_REVIEW_INVALID: unsupported review decision.");
  const project = await readProject(projectId);
  const task = findTask(project, taskId);
  if (!["waiting_review", "paused", "ready"].includes(task.status) && !task.runId) throw new Error(`TASK_REVIEW_NOT_ALLOWED: task status is ${task.status}.`);
  let reviewResult;
  if (task.runId) {
    const runProject = task.runProjectId ? await readProject(task.runProjectId) : project;
    const reviewList = await listHumanReviews(runProject.workdir, task.runId).catch(() => ({ reviews: [] }));
    const candidates = (Array.isArray(reviewList?.reviews) ? reviewList.reviews : []).filter((item) => item && ["pending", "paused"].includes(item.currentStatus));
    const selected = reviewId ? candidates.find((item) => item.reviewId === reviewId) : candidates[0];
    if (selected?.reviewId) {
      reviewResult = await writeHumanReviewDecision({
        workdir: runProject.workdir,
        runId: task.runId,
        reviewId: selected.reviewId,
        decision,
        comment,
        principal: createLocalControlPlanePrincipal(),
        ...(decision === "terminate" ? { scope: "run" } : {})
      });
    }
  }
  const nextStatus = decision === "approve" || decision === "rework" ? "ready" : decision === "pause" ? "paused" : "stopped";
  const updated = await withProjectWriteLock(projectId, "project-task-review", async () => saveTaskRecord(await readProject(projectId), taskId, {
    status: nextStatus,
    review: { decision, comment: String(comment || "").trim().slice(0, 4000), reviewId: reviewId || reviewResult?.reviewId || null, decidedAt: new Date().toISOString() }
  }));
  if (reviewResult && (decision === "approve" || decision === "rework")) {
    await controlProjectRun(task.runProjectId || projectId, task.runId, "resume").catch(() => undefined);
  }
  if (reviewResult && decision === "terminate") {
    await controlProjectRun(task.runProjectId || projectId, task.runId, "cancel").catch(() => undefined);
  }
  return { task: updated, review: reviewResult || updated.review };
}

export async function deleteProjectTask(projectId, taskId) {
  const project = await readProject(projectId);
  const task = findTask(project, taskId);
  if (["running", "planning", "waiting_review", "paused", "ready", "pause_requested"].includes(task.status)) {
    if (task.runId) await controlProjectRun(projectId, task.runId, "cancel").catch(() => undefined);
  }
  return withProjectWriteLock(projectId, "project-task-delete", async () => saveTaskRecord(await readProject(projectId), taskId, {
    status: "deleted",
    deletedAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  }));
}

export async function createProjectWorkspace(teamProjectId, { name, workspaceKey, locale = "zh-CN" } = {}) {
  const bindingLock = await acquireProjectWriteLock(join(projectsRoot, ".workspace-binding"), "workspace-binding");
  try {
    const team = await readProject(teamProjectId);
    requireConfirmed(team);
    const key = slug(workspaceKey || name || `${team.name}-workspace`);
    const existing = (await listProjects()).find((project) => project.workspaceKey === key);
    if (existing) {
      if (existing.teamProjectId === teamProjectId) return existing;
      throw new Error("WORKSPACE_BOUND_TO_OTHER_TEAM: this work directory is already bound to another team.");
    }
    const project = await createProject({
      name: name || `${team.name} 项目`,
      intent: team.intent,
      templateId: "empty",
      source: "workspace",
      locale
    });
    try {
      const bundle = await exportTeamPackage(team.workdir);
      const loaded = await loadTeamPackage({ workdir: project.workdir, bundle });
      if (loaded.validation?.ok === false) throw new Error("PROJECT_WORKSPACE_INVALID: the selected team could not be copied.");
      const current = await readJson(join(project.workdir, ".site", "project.json"), {});
      await writeJson(join(project.workdir, ".site", "project.json"), {
        ...current,
        teamProjectId,
        teamId: team.teamId || team.projectId,
        teamVersionId: team.teamVersionId || team.projectId,
        teamVersionNumber: team.teamVersionNumber || 1,
        teamVersionStatus: team.teamVersionStatus || "released",
        teamName: team.teamName || team.name,
        workspaceKey: key,
        projectStatus: "draft",
        projectDigest: null,
        confirmedAt: null,
        updatedAt: new Date().toISOString()
      });
      await confirmProjectTeam(project.projectId, { trustedClassic: isTrustedTeamTopology(team) });
      return readProject(project.projectId);
    } catch (error) {
      await rm(project.workdir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  } finally {
    await bindingLock.release();
  }
}

export async function createClassicTeamProject({ caseId, asTemplate = false, name, intent, locale = "zh-CN" } = {}) {
  const caseSpec = getCase(caseId);
  if (!caseSpec) throw new Error("Unknown example team.");
  const language = locale === "en" ? "en" : "zh-CN";
  const defaultName = caseSpec.title?.[language] || caseSpec.title?.["zh-CN"] || caseSpec.title?.en || caseId;
  const defaultIntent = caseSpec.detail?.scenario?.[language] || caseSpec.detail?.scenario?.["zh-CN"] || caseSpec.short?.[language] || caseSpec.short?.["zh-CN"] || "";
  if (!asTemplate && !name) {
    const existing = (await listProjects()).find((project) => !project.teamProjectId && project.source === "classic" && project.caseId === caseId && project.teamVersionStatus === "released");
    if (existing) return existing;
    const template = (await listProjects()).find((project) => !project.teamProjectId && project.source === "classic-template" && project.caseId === caseId && project.teamVersionStatus !== "archived" && String(project.name || "").toLocaleLowerCase() === defaultName.toLocaleLowerCase());
    if (template) return confirmProjectTeam(template.projectId, { trustedClassic: true, release: true });
  }
  const project = await createProject({
    name: name || defaultName,
    intent: intent || defaultIntent,
    templateId: `classic:${caseId}`,
    caseId,
    source: asTemplate ? "classic-template" : "classic",
    locale: language
  });
  return asTemplate ? project : confirmProjectTeam(project.projectId, { trustedClassic: true });
}

export async function listTeamFactory() {
  return (await listProjects()).filter((project) => !project.teamProjectId && project.teamVersionStatus !== "released" && project.teamVersionStatus !== "archived");
}

export async function listTeamRepository() {
  return (await listProjects()).filter((project) => !project.teamProjectId && project.teamVersionStatus === "released" && !project.archivedAt);
}

export async function forkTeamVersion(teamVersionId) {
  const source = await readProject(teamVersionId);
  if (source.teamProjectId || source.teamVersionStatus !== "released") throw new Error("TEAM_VERSION_NOT_RELEASED: only a released team version can be edited.");
  const versions = (await listProjects()).filter((project) => !project.teamProjectId && project.teamId === source.teamId);
  const nextVersionNumber = Math.max(...versions.map((project) => project.teamVersionNumber || 0), 0) + 1;
  const project = await createProject({
    name: source.name,
    teamName: source.teamName || source.name,
    teamId: source.teamId,
    teamVersionNumber: nextVersionNumber,
    parentTeamVersionId: source.teamVersionId || source.projectId,
    intent: source.intent,
    templateId: source.templateId,
    source: "version-edit"
  });
  const bundle = await exportTeamPackage(source.workdir);
  const loaded = await loadTeamPackage({ workdir: project.workdir, bundle });
  if (loaded.validation?.ok === false) throw new Error("TEAM_VERSION_COPY_INVALID: the released version could not be copied.");
  await writeJson(join(project.workdir, ".site", "project.json"), {
    ...(await readJson(join(project.workdir, ".site", "project.json"), {})),
    name: source.name,
    teamName: source.teamName || source.name,
    teamId: source.teamId,
    teamVersionId: project.projectId,
    teamVersionNumber: nextVersionNumber,
    teamVersionStatus: "editing",
    parentTeamVersionId: source.teamVersionId || source.projectId,
    projectStatus: "draft",
    projectDigest: null,
    confirmedAt: null,
    releasedAt: null,
    updatedAt: new Date().toISOString()
  });
  return readProject(project.projectId);
}

export async function releaseTeamVersion(projectId) {
  return confirmProjectTeam(projectId, { release: true });
}

export async function archiveTeamVersion(projectId) {
  return withProjectWriteLock(projectId, "team-version-archive", async () => {
    const project = await readProject(projectId);
    if (project.teamProjectId) throw new Error("TEAM_VERSION_INVALID: project workspaces cannot be archived as team versions.");
    if (project.teamVersionStatus !== "released") throw new Error("TEAM_VERSION_NOT_RELEASED: only a released team version can be archived.");
    const projects = await listProjects();
    if (projects.some((item) => item.teamProjectId && item.teamVersionId === project.teamVersionId)) {
      const next = { ...normalizeMeta(project, projectId), teamVersionStatus: "archived", archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await writeJson(join(project.workdir, ".site", "project.json"), next);
      return readProject(projectId);
    }
    const next = { ...normalizeMeta(project, projectId), teamVersionStatus: "archived", archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await writeJson(join(project.workdir, ".site", "project.json"), next);
    return readProject(projectId);
  });
}

export async function listRecentProjectRuns(limit = 50) {
  const projects = await listProjects();
  const teams = new Map((await listProjects()).filter((project) => !project.teamProjectId).map((project) => [project.teamVersionId || project.projectId, project]));
  const runs = [];
  for (const project of projects.filter((item) => item.teamProjectId || item.projectType === "collaboration")) {
    if (project.projectType === "collaboration" && Array.isArray(project.taskRecords) && project.taskRecords.length) {
      project.taskRecords.filter((task) => !task.deletedAt && task.status !== "deleted").forEach((task, index) => runs.push({
        runId: task.runId || task.taskId,
        taskId: task.taskId,
        projectId: project.projectId,
        projectName: project.name,
        workspaceKey: project.workspaceKey || "",
        teamId: task.teamId || project.mountedTeams?.[0]?.teamId || null,
        teamVersionId: task.teamVersionId || project.mountedTeams?.[0]?.teamVersionId || null,
        teamName: task.teamName || project.mountedTeams?.[0]?.teamName || "未选择团队",
        teamVersionNumber: task.teamVersionNumber || project.mountedTeams?.[0]?.teamVersionNumber || 1,
        roundNumber: task.roundNumber || index + 1,
        input: task.input || "",
        status: task.status,
        mode: "task",
        updatedAt: task.completedAt || task.startedAt,
        durationMs: 0,
        pendingReviewCount: 0
      }));
      continue;
    }
    const team = teams.get(project.teamVersionId) || teams.get(project.teamProjectId);
    const ordered = [...(project.runs || [])].sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
    ordered.forEach((run, index) => runs.push({
      runId: run.runId,
      projectId: project.projectId,
      projectName: project.name,
      workspaceKey: project.workspaceKey || "",
      teamId: project.teamId || team?.teamId || project.teamProjectId,
      teamVersionId: project.teamVersionId || team?.teamVersionId || project.teamProjectId,
      teamName: project.teamName || team?.teamName || team?.name || "团队",
      teamVersionNumber: project.teamVersionNumber || team?.teamVersionNumber || 1,
      roundNumber: index + 1,
      input: run.prompt || run.input || "",
      status: run.status,
      mode: run.isSimulation ? "dry-run" : "sandbox",
      updatedAt: run.updatedAt,
      durationMs: run.durationMs || 0,
      pendingReviewCount: run.pendingReviewCount || 0
    }));
  }
  return runs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, Math.max(1, Math.min(limit, 200)));
}

export async function updateProject(projectId, changes = {}) {
  return withProjectWriteLock(projectId, "project-edit", async () => {
    const project = await readProject(projectId);
    const nextName = changes.name === undefined ? project.name : String(changes.name).trim().slice(0, 120);
    const nextIntent = changes.intent === undefined ? project.intent : String(changes.intent).trim().slice(0, 4000);
    if (!nextName) throw new Error("Project name is required.");
    const semanticChanged = nextIntent !== project.intent || changes.semanticChanged === true;
    const next = {
      ...normalizeMeta(project, projectId),
      name: nextName,
      intent: nextIntent,
      updatedAt: new Date().toISOString()
    };
    if (semanticChanged) {
      next.projectStatus = "draft";
      next.projectDigest = null;
      next.confirmedAt = null;
    }
    await writeJson(join(project.workdir, ".site", "project.json"), next);
    return readProject(projectId);
  });
}

export async function invalidateProjectConfirmation(projectId, reason = "semantic-edit") {
  return withProjectWriteLock(projectId, `invalidate:${reason}`, async () => {
    const project = await readProject(projectId);
    const next = { ...normalizeMeta(project, projectId), projectStatus: "draft", projectDigest: null, confirmedAt: null, updatedAt: new Date().toISOString(), invalidatedReason: reason };
    await writeJson(join(project.workdir, ".site", "project.json"), next);
    return readProject(projectId);
  });
}

export async function confirmProjectTeam(projectId, { trustedClassic = false, release = true } = {}) {
  return withProjectWriteLock(projectId, "project-confirm", async () => {
    const project = await readProject(projectId);
    const systemSource = await readFile(join(project.workdir, "system.mmd"), "utf8");
    const executionPlan = createExecutionPlan(parseSystemFromMermaidSource(systemSource));
    const nodeGraph = Array.from(executionPlan.nodesByRoleId.values()).map((node) => ({
      nodeId: node.roleId,
      incoming: node.incoming.map((flow) => ({ from: flow.fromRoleId, event: flow.eventType })),
      outgoing: node.outgoing.map((flow) => ({ to: flow.toRoleId, event: flow.eventType })),
      reviewRequired: node.review?.mode === "required",
      loopMax: node.loopMax
    }));
    if (!trustedClassic && !isTrustedTeamTopology(project)) validateLinearProjectTopology(nodeGraph, executionPlan.entryRoleId);
    const digest = await semanticProjectDigest(project);
    if (project.projectStatus === "confirmed" && project.projectDigest === digest) return project;
    const releasedAt = new Date().toISOString();
    const next = { ...normalizeMeta(project, projectId), projectStatus: "confirmed", projectDigest: digest, confirmedAt: releasedAt, teamVersionStatus: release ? "released" : (project.teamVersionStatus || "draft"), releasedAt: release ? releasedAt : null, updatedAt: releasedAt };
    await writeJson(join(project.workdir, ".site", "project.json"), next);
    return readProject(projectId);
  });
}

export async function getProject(projectId) {
  return readProject(projectId);
}

export async function getProjectReadiness(projectId) {
  const project = await readProject(projectId);
  const readiness = await inspectProjectReadiness(project.workdir);
  const projectIssue = (issue) => {
    const messageByCode = {
      READINESS_CONTRACT_BUNDLE_UNREADABLE: "Handoff contract bundle cannot be inspected. Check the configured contract file.",
      READINESS_CONTRACT_PLAN_INVALID: "Handoff contract plan is invalid. Check the contract definitions and schemas.",
      READINESS_MODEL_CATALOG_INVALID: "Model catalog is invalid. Repair .ogs/model-catalog.json.",
      READINESS_ROLE_PACKAGE_INVALID: `Role package "${issue.roleId}" is invalid. Check role.json and its referenced package files.`
    };
    return {
      code: issue.code,
      severity: issue.severity,
      ...(issue.roleId ? { roleId: issue.roleId } : {}),
      message: messageByCode[issue.code] ?? issue.message
    };
  };
  return {
    projectId,
    projectStatus: project.projectStatus,
    projectDigest: project.projectDigest,
    confirmedAt: project.confirmedAt,
    canDryRun: readiness.canDryRun,
    blockers: readiness.blockers.map(projectIssue),
    warnings: readiness.warnings.map(projectIssue),
    missingBindings: readiness.missingBindings
  };
}

export async function getProjectGraph(projectId, locale = "zh-CN") {
  const project = await readProject(projectId);
  const systemPath = join(project.workdir, "system.mmd");
  const systemSource = await readFile(systemPath, "utf8");
  const system = parseSystemFromMermaidSource(systemSource);
  const design = await readJson(join(project.workdir, "system.design.json"), {});
  const roleDisplayNames = new Map(
    Object.entries(design?.seats && typeof design.seats === "object" ? design.seats : {})
      .flatMap(([roleId, seat]) => {
        const title = seat && typeof seat === "object" && !Array.isArray(seat) ? seat.title : undefined;
        return typeof title === "string" && title.trim() ? [[roleId, title.trim()]] : [];
      })
  );
  const authoring = importMermaidToAuthoring({
    workdir: project.workdir,
    systemPath: "system.mmd",
    systemSource,
    roleDisplayNames
  });
  const boundaryLabels = locale === "en"
    ? { input: "Task", output: "Outcome" }
    : { input: "任务", output: "结果" };
  const graph = buildGraphViewModel({
    authoring,
    mode: "design",
    presentation: { boundaryLabels }
  });
  return {
    projectId,
    projectDigest: project.projectDigest,
    systemSource,
    authoring,
    canvas: authoringToCanvasDocument(authoring),
    viewModel: graph
  };
}

export async function getProjectDesign(projectId, locale = "zh-CN") {
  const graph = await getProjectGraph(projectId, locale);
  const project = await readProject(projectId);
  return { ...graph, projectStatus: project.projectStatus, confirmedAt: project.confirmedAt };
}

export async function validateProjectDesign(projectId, body = {}) {
  const project = await readProject(projectId);
  const systemSource = typeof body.systemSource === "string"
    ? body.systemSource
    : body.authoring && typeof body.authoring === "object"
      ? serializeAuthoringToMermaid(body.authoring)
      : await readFile(join(project.workdir, "system.mmd"), "utf8");
  return validateProjectSystemSource({ workdir: project.workdir, systemSource, systemPath: join(project.workdir, "system.mmd") });
}

export async function saveProjectDesign(projectId, body = {}) {
  return withProjectWriteLock(projectId, "design-save", async () => {
    const project = await readProject(projectId);
    if (body.expectedProjectDigest && body.expectedProjectDigest !== project.projectDigest) {
      throw new Error("PROJECT_DIGEST_CONFLICT: the project changed in another editor.");
    }
    const systemSource = typeof body.systemSource === "string"
      ? body.systemSource
      : body.authoring && typeof body.authoring === "object"
        ? serializeAuthoringToMermaid(body.authoring)
        : "";
    if (!systemSource) throw new Error("SYSTEM_SOURCE_REQUIRED: design source is required.");
    const saved = await saveProjectSystemSource({ workdir: project.workdir, systemSource });
    if (saved.validation?.ok !== true) throw new Error("PROJECT_DESIGN_INVALID: design validation failed.");
    return getProjectDesign(projectId);
  });
}

export async function addProjectMaterial(projectId, { filename, content, contentType }) {
  return withProjectWriteLock(projectId, "material-upload", async () => {
  const project = await readProject(projectId);
  await requireCurrentConfirmation(project);
  const safeName = basename(String(filename || "material.txt"));
  const extension = extname(safeName).toLowerCase();
  if (!allowedExtensions.has(extension)) throw new Error("Only md, txt, json, yaml, yml, and csv materials are supported.");
  if (typeof content !== "string" || content.length > 1024 * 1024) throw new Error("Material content must be text up to 1 MB.");
  const materialId = slug(safeName.slice(0, -extension.length)) + "-" + randomUUID().slice(0, 6);
  const target = resolve(project.workdir, "workspace", "files", materialId + extension);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, content, "utf8");
  const entry = {
    materialId,
    filename: safeName,
    path: "workspace/files/" + basename(target),
    contentType: contentType || "text/plain",
    size: Buffer.byteLength(content),
    contentHash: createHash("sha256").update(content).digest("hex"),
    status: "indexed",
    createdAt: new Date().toISOString()
  };
  const index = project.materials && Array.isArray(project.materials.materials)
    ? project.materials
    : { version: 1, materials: [] };
  index.materials = [...index.materials, entry];
  await writeJson(join(project.workdir, "workspace", "index.json"), index);
  const meta = await readJson(join(project.workdir, ".site", "project.json"), {});
  await writeJson(join(project.workdir, ".site", "project.json"), { ...meta, updatedAt: new Date().toISOString() });
  return entry;
  });
}

export async function startProjectRun(projectId, { prompt, mode = "dry-run", idempotencyKey, materialInputsOverride, resumeRunId, resumeRunDir } = {}) {
  if (mode === "real") throw new Error("REAL_RUN_UNSUPPORTED: real project runs are disabled in the first phase.");
  if (mode !== "dry-run" && mode !== "sandbox") throw new Error("Unsupported project run mode.");
  const initialProject = await readProject(projectId);
  if (mode === "sandbox") {
    await requireCurrentConfirmation(initialProject);
    const readiness = await inspectProjectReadiness(initialProject.workdir);
    if (!readiness.canDryRun) {
      throw new Error(`PROJECT_NOT_READY: resolve ${readiness.blockers.length} static readiness blocker(s) before Sandbox Run. Inspect project readiness for details.`);
    }
  }
  const requestKey = idempotencyKey ? String(idempotencyKey).slice(0, 160) : undefined;
  const requestPath = join(initialProject.workdir, ".site", "run-requests.json");
  let writeLock;
  let writeLockReleased = false;
  let lock;
  let runId;
  let requestFingerprint;
  let pendingLedgerEntry;
  try {
  if (resumeRunDir && !resumeRunId) throw new Error("RUN_RESUME_INVALID: resumeRunId is required when resuming a run.");
  if (resumeRunId) assertSafeId(resumeRunId, "resumeRunId");
  const allowedRunsDir = resolve(initialProject.workdir, ".ogs", "runs");
  const canonicalResumeRunDir = resumeRunId ? resolve(allowedRunsDir, resumeRunId) : undefined;
  if (canonicalResumeRunDir && !canonicalResumeRunDir.startsWith(`${allowedRunsDir}${sep}`)) {
    throw new Error("RUN_RESUME_INVALID: resume run must belong to the requested project.");
  }
  if (resumeRunDir && canonicalResumeRunDir && resolve(resumeRunDir) !== canonicalResumeRunDir) {
    throw new Error("RUN_RESUME_INVALID: resume run directory does not match resumeRunId.");
  }
  resumeRunDir = canonicalResumeRunDir;
  const task = resumeRunDir ? await readJson(join(resumeRunDir, "task.json"), {}) : undefined;
  const resumePlan = resumeRunDir ? await loadProjectRunPlan(resumeRunDir) : undefined;
  if (resumePlan?.projectId && resumePlan.projectId !== projectId) {
    throw new Error("RUN_SNAPSHOT_INVALID: run snapshot belongs to another project.");
  }
  const input = String(prompt || task?.prompt || "").trim();
  if (!input || input.length > 4000) throw new Error("Task must contain 1 to 4,000 characters.");
  requestFingerprint = createHash("sha256").update(JSON.stringify({
    projectId,
    prompt: input,
    mode,
    materialInputsOverride: materialInputsOverride ?? null,
    resumeRunId: resumeRunId ?? null
  })).digest("hex");
  writeLock = await acquireProjectWriteLock(initialProject.workdir, "run-snapshot");
  let project = await readProject(projectId);
  if (!resumeRunDir) await requireCurrentConfirmation(project);
  const requestLedger = await readJson(requestPath, {});
  if (requestKey && requestLedger[requestKey]) {
    const prior = requestLedger[requestKey];
    if (prior.requestFingerprint !== requestFingerprint) throw new Error("IDEMPOTENCY_KEY_REUSE: idempotency key was already used with a different request.");
    if (prior.status === "running" && prior.runId) {
      const priorRunDir = resolve(project.workdir, ".ogs", "runs", prior.runId);
      const priorState = await loadProjectRunState(priorRunDir).catch(() => undefined);
      const priorPlan = await loadProjectRunPlan(priorRunDir).catch(() => undefined);
      if (priorState && priorPlan && ["completed", "failed", "cancelled", "paused", "waiting_review"].includes(priorState.status)) {
        return {
          projectId,
          runId: prior.runId,
          mode: prior.mode,
          runPlan: priorPlan,
          state: priorState,
          quality: evaluateProjectRunResult({ plan: priorPlan, state: priorState }),
          status: priorState.status,
          idempotentReplay: true,
          recovered: true
        };
      }
      // A process can die after reserving the ledger entry but before runtime
      // creates its immutable run files. Reuse that reserved run id so the
      // next identical request replays the same request instead of creating a
      // second run. An existing non-terminal snapshot remains owned by the
      // original worker and is returned as-is.
      if (!priorPlan && !priorState) {
        runId = prior.runId;
      } else {
        return prior.response || { ...prior, idempotentReplay: true };
      }
    } else {
      return prior.response || { ...prior, idempotentReplay: true };
    }
  }
  runId ||= resumeRunId || createRunId(new Date());
  if (requestKey) {
    pendingLedgerEntry = {
      status: "running",
      projectId,
      runId,
      mode,
      requestFingerprint,
      prompt: input,
      ...(materialInputsOverride ? { materialInputsOverride } : {}),
      ...(resumeRunId ? { resumeRunId } : {}),
      startedAt: new Date().toISOString()
    };
    await writeJson(requestPath, { ...requestLedger, [requestKey]: pendingLedgerEntry });
  }
  // Reserve the idempotency record while the project write lock is held, then
  // acquire the long lived run lock before releasing that write lock. A crash
  // in either gap leaves a durable reservation and cannot create a second run.
  lock = await acquireActiveRunLock(initialProject.workdir, runId);
  if (resumeRunDir) await writeProjectRunControl(resumeRunDir, "resume", "project-run-resume");
  const materialInputs = materialInputsOverride || (project.materials.materials || []).map((item) => ({
    materialId: item.materialId,
    sourcePath: resolve(project.workdir, item.path),
    contentType: item.contentType
  }));
  const result = await runSystemWithAdapter({
    systemPath: resolve(project.workdir, "system.mmd"),
    prompt: input,
    workdir: project.workdir,
    runId,
    resumeRunDir,
    dryRun: mode === "dry-run",
    projectId,
    projectRunMode: mode,
    trustedProjectTopology: isTrustedTeamTopology(project),
    projectDigest: resumePlan?.projectDigest ?? project.projectDigest,
    projectRunLock: false,
    materialInputs,
    onProjectRunPrepared: async () => {
      if (!resumeRunDir) {
        const latest = await readProject(projectId);
        await requireCurrentConfirmation(latest);
        if (latest.projectDigest !== project.projectDigest) {
          throw new Error("PROJECT_CONFIRMATION_CHANGED: project confirmation changed while preparing the run.");
        }
        project = latest;
      }
      await writeLock.release();
      writeLockReleased = true;
    },
    logRun: false
  });
  await rebuildRunsIndex(project.workdir);
  const runPlan = await loadProjectRunPlan(resolve(project.workdir, ".ogs", "runs", runId));
  const runDir = resolve(project.workdir, ".ogs", "runs", runId);
  const state = await loadProjectRunState(runDir);
  const quality = evaluateProjectRunResult({ plan: runPlan, state });
  const response = { projectId, runId, mode, result, runPlan, state, quality, materials: materialInputs };
  const taskRecord = {
    taskId: runId,
    runId,
    projectId,
    input,
    status: state.status,
    startedAt: state.startedAt || pendingLedgerEntry?.startedAt || new Date().toISOString(),
    completedAt: state.finishedAt || new Date().toISOString(),
    roundNumber: ((project.taskRecords || []).length || 0) + 1,
    teamVersionId: project.teamVersionId || project.mountedTeams?.[0]?.teamVersionId || null,
    teamName: project.teamName || project.mountedTeams?.[0]?.teamName || null,
    outputSummary: typeof result?.finalOutput === "string" ? result.finalOutput.slice(0, 500) : "",
    commitPlaceholder: null
  };
  const latestMeta = await readJson(join(project.workdir, ".site", "project.json"), {});
  await writeJson(join(project.workdir, ".site", "project.json"), {
    ...latestMeta,
    taskRecords: [...(Array.isArray(latestMeta.taskRecords) ? latestMeta.taskRecords : []), taskRecord],
    updatedAt: new Date().toISOString()
  });
  if (requestKey) {
    const ledgerLock = writeLockReleased
      ? await acquireProjectWriteLock(initialProject.workdir, "run-ledger")
      : undefined;
    try {
      const currentLedger = await readJson(requestPath, {});
      await writeJson(requestPath, {
        ...currentLedger,
        [requestKey]: { ...response, status: "completed", requestFingerprint }
      });
    } finally {
      await ledgerLock?.release();
    }
  }
  return response;
  } catch (error) {
    if (requestKey && requestFingerprint && runId) {
      const ledgerLock = writeLockReleased
        ? await acquireProjectWriteLock(initialProject.workdir, "run-ledger-failure").catch(() => undefined)
        : undefined;
      try {
        const currentLedger = await readJson(requestPath, {});
        await writeJson(requestPath, {
          ...currentLedger,
          [requestKey]: {
            ...(pendingLedgerEntry || {}),
            projectId,
            runId,
            mode,
            status: "failed",
            requestFingerprint,
            error: error instanceof Error ? error.message : String(error)
          }
        });
      } finally {
        await ledgerLock?.release();
      }
    }
    throw error;
  } finally {
    if (writeLock && !writeLockReleased) await writeLock.release();
    await lock?.release();
  }
}

export async function retryProjectRun(projectId, originalRunId, { mode = "dry-run" } = {}) {
  assertSafeId(originalRunId, "runId");
  const project = await readProject(projectId);
  await requireCurrentConfirmation(project);
  const originalRunDir = resolve(project.workdir, ".ogs", "runs", originalRunId);
  const originalState = await loadProjectRunState(originalRunDir);
  if (originalState.status !== "failed") throw new Error("RUN_RETRY_UNSUPPORTED: only failed runs can be retried as a new run.");
  const task = await readJson(join(originalRunDir, "task.json"));
  if (!task || typeof task.prompt !== "string") throw new Error("RUN_RETRY_INVALID: original task snapshot is missing.");
  const snapshots = await loadProjectMaterialSnapshots(originalRunDir);
  const inputs = snapshots.map((item) => ({
    materialId: item.materialId,
    sourcePath: resolve(originalRunDir, item.snapshotPath),
    contentType: item.contentType,
    selectedRanges: item.selectedRanges,
    consumingNodeIds: item.consumingNodeIds
  }));
  return startProjectRun(projectId, { prompt: task.prompt, mode, materialInputsOverride: inputs });
}

export async function controlProjectRun(projectId, runId, control) {
  assertSafeId(runId, "runId");
  if (!["pause", "resume", "cancel"].includes(control)) throw new Error("RUN_CONTROL_INVALID: unsupported control.");
  const project = await readProject(projectId);
  const runDir = resolve(project.workdir, ".ogs", "runs", runId);
  const state = await loadProjectRunState(runDir);
  if (control === "resume") {
      const latestControl = await readLatestProjectRunControl(runDir);
      if (latestControl?.action === "cancel") {
        throw new Error("RUN_RESUME_NOT_ALLOWED: cancellation has already been requested.");
      }
      if (!["waiting_review", "paused", "ready"].includes(state.status)) {
        throw new Error(`RUN_RESUME_NOT_ALLOWED: run status is ${state.status}.`);
      }
      const plan = await loadProjectRunPlan(runDir);
      const task = await readJson(join(runDir, "task.json"), {});
      return await startProjectRun(projectId, {
        prompt: task.prompt,
        mode: plan.executionPolicy.mode,
        resumeRunId: runId,
        resumeRunDir: runDir
      });
  }
  const request = await writeProjectRunControl(runDir, control);
  const safeCancelled = await updateProjectRunState(runDir, (currentState) => {
    const next = writeRunStateControl(currentState, control);
    return control === "cancel" && ["waiting_review", "paused", "ready"].includes(currentState.status)
      ? { ...next, status: "cancelled", updatedAt: new Date().toISOString() }
      : next;
  });
  return { projectId, runId, state: safeCancelled, controlRequest: request };
}

export async function exportProjectTeam(projectId) {
  const project = await readProject(projectId);
  const bundle = await exportTeamPackage(project.workdir);
  return {
    mode: "single-project-v1",
    team: {
      ...(bundle.team || {}),
      project: { name: project.name, intent: project.intent, source: "exported" }
    }
  };
}

export async function importTeamPackage(bundle) {
  if (!bundle || bundle.mode !== "single-project-v1" || !bundle.team || typeof bundle.team.systemSource !== "string") {
    throw new Error("Unsupported project package format; expected mode=single-project-v1.");
  }
  const manifestPaths = bundle.team.releaseManifest?.artifactScope || [];
  if (!Array.isArray(manifestPaths) || manifestPaths.some((path) => typeof path !== "string" || path.startsWith("/") || path.includes("..") || path.includes("\\"))) {
    throw new Error("PROJECT_IMPORT_INVALID: unsafe artifact path.");
  }
  if (bundle.team.systemSource.length > 2 * 1024 * 1024) throw new Error("TEAM_IMPORT_INVALID: system source is too large.");
  const credentialFields = new Set([
    "apikey", "accesstoken", "refreshtoken", "password", "clientsecret", "clientpassword",
    "secretvalue", "credentialvalue", "privatekey"
  ]);
  const findCredentialField = (value, path = "") => {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const found = findCredentialField(value[index], `${path}[${index}]`);
        if (found) return found;
      }
      return undefined;
    }
    if (!value || typeof value !== "object") return undefined;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, "");
      if (credentialFields.has(normalizedKey) && child !== undefined && child !== null && !(typeof child === "string" && !child.trim())) return `${path}.${key}`;
      const found = findCredentialField(child, path ? `${path}.${key}` : key);
      if (found) return found;
    }
    return undefined;
  };
  const credentialPath = findCredentialField(bundle);
  if (credentialPath) throw new Error(`PROJECT_IMPORT_INVALID: credential field is not accepted: ${credentialPath}.`);
  const metadata = bundle.team.project || {};
  const libraryLock = await acquireProjectWriteLock(projectsRoot, "project-import");
  let project;
  try {
    project = await createProject({ name: metadata.name || "Imported team", intent: metadata.intent || "", templateId: "empty" });
    const loaded = await loadTeamPackage({ workdir: project.workdir, bundle });
    if (loaded.validation?.ok === false) throw new Error("PROJECT_IMPORT_INVALID: imported Mermaid system failed validation.");
    await withProjectWriteLock(project.projectId, "project-import", async () => {
      const current = await readProject(project.projectId);
      await writeJson(join(current.workdir, ".site", "project.json"), { ...normalizeMeta(current, current.projectId), source: "imported", updatedAt: new Date().toISOString() });
    });
    return getProject(project.projectId);
  } catch (error) {
    if (project?.workdir) await rm(project.workdir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(`PROJECT_IMPORT_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await libraryLock.release();
  }
}

export { projectsRoot };
