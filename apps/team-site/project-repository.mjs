import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, rename } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
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
import { applyRunControl as writeRunStateControl, loadProjectRunState, saveProjectRunState, updateProjectRunState } from "../../dist/runtime/project-run-state.js";
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
import { loadRunEventsSnapshot } from "../../dist/visualizer/run-query-service.js";
import { cases, getCase } from "./cases.mjs";
import { materializeCaseTeam, runCase } from "./demo-runner.mjs";
import { ACTIVE_RUN_STATUSES, assertLatestProjectOverview } from "./domain/contracts.mjs";

const projectsRoot = resolve(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects"));
const stagingRoot = resolve(projectsRoot, ".staging");
const allowedExtensions = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv"]);
const activeTaskWorkers = new Map();
const activeProjectCreations = new Set();

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

async function cleanupProjectStaging() {
  const entries = await readdir(stagingRoot, { withFileTypes: true }).catch(() => []);
  let hasActiveCreation = false;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(stagingRoot, entry.name);
    if (activeProjectCreations.has(candidate)) {
      hasActiveCreation = true;
      continue;
    }
    await rm(candidate, { recursive: true, force: true });
  }
  if (!hasActiveCreation) await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
}

function normalizeMeta(meta, projectId) {
  assertLatestProjectOverview(meta);
  const confirmed = meta?.projectStatus === "confirmed" && typeof meta?.projectDigest === "string" && typeof meta?.confirmedAt === "string";
  const teamVersionStatus = meta?.teamVersionStatus || (confirmed ? "released" : "draft");
  const teamRootId = String(meta?.teamRootId || meta?.teamId || (meta?.teamProjectId || meta?.projectType === "collaboration" ? "" : projectId));
  const teamId = teamRootId;
  const teamVersionNumber = Number.isInteger(meta?.teamVersionNumber) && meta.teamVersionNumber > 0 ? meta.teamVersionNumber : 1;
  return {
    projectId,
    name: String(meta?.name || "New team"),
    overview: String(meta.overview),
    templateId: meta?.templateId || "empty",
    projectStatus: confirmed ? "confirmed" : "draft",
    projectDigest: confirmed ? meta.projectDigest : null,
    teamCoreDigest: typeof meta?.teamCoreDigest === "string" ? meta.teamCoreDigest : null,
    projectDefinitionDigest: typeof meta?.projectDefinitionDigest === "string" ? meta.projectDefinitionDigest : null,
    confirmedAt: confirmed ? meta.confirmedAt : null,
    createdAt: meta?.createdAt || new Date().toISOString(),
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    source: meta?.source || "created",
    teamId: teamId || undefined,
    teamRootId: teamRootId || undefined,
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
  return "idle";
}

async function withProjectWriteLock(projectId, operation, action) {
  const lock = await acquireProjectWriteLock(projectPath(projectId), operation);
  try { return await action(); } finally { await lock.release(); }
}

async function semanticProjectDigest(project) {
  return computeProjectAssetDigest(project.workdir);
}

function teamCorePayload(bundle) {
  const design = bundle?.team?.design;
  return {
    systemSource: bundle?.team?.systemSource || "",
    design: design && typeof design === "object" ? {
      schemaVersion: design.schemaVersion,
      intent: design.intent,
      system: design.system,
      seats: design.seats,
      transitions: design.transitions,
      state: design.state,
      contracts: design.contracts,
      policies: design.policies,
      bindings: design.bindings
    } : null,
    laws: bundle?.team?.laws || null,
    executableFiles: Array.isArray(bundle?.team?.executableFiles)
      ? bundle.team.executableFiles.map(({ path, content }) => ({ path, content }))
      : []
  };
}

async function computeTeamCoreDigest(workdir) {
  const bundle = await exportTeamPackage(workdir);
  return createHash("sha256").update(JSON.stringify(teamCorePayload(bundle))).digest("hex");
}

function builtInTeamCoreDigest(caseSpec) {
  return createHash("sha256").update(JSON.stringify({
    id: caseSpec.id,
    roles: caseSpec.roles,
    flows: caseSpec.flows,
    joins: caseSpec.joins,
    entryRole: caseSpec.entryRole,
    projections: caseSpec.projections
  })).digest("hex");
}

function projectDefinitionPayload(project) {
  return {
    overview: project.overview,
    workspaceKey: project.workspaceKey || null,
    mountedTeams: (project.mountedTeams || []).map(({ mountedAt, status, ...team }) => team),
    materials: (project.materials?.materials || []).map(({ content, ...item }) => item)
  };
}

function computeProjectDefinitionDigest(project) {
  return createHash("sha256").update(JSON.stringify(projectDefinitionPayload(project))).digest("hex");
}

function packageDigestPayload(bundle) {
  const { packageDigest: _packageDigest, ...withoutDigest } = bundle || {};
  if (withoutDigest.team && typeof withoutDigest.team === "object") {
    const { project: _project, ...teamWithoutIdentity } = withoutDigest.team;
    withoutDigest.team = teamWithoutIdentity;
  }
  if (withoutDigest.releaseManifest && typeof withoutDigest.releaseManifest === "object") {
    withoutDigest.releaseManifest = { ...withoutDigest.releaseManifest, generatedAt: null };
  }
  return withoutDigest;
}

function computePackageDigest(bundle) {
  return createHash("sha256").update(JSON.stringify(packageDigestPayload(bundle))).digest("hex");
}

async function writeTeamReferenceFiles(workdir, meta) {
  if (!meta || meta.projectType === "collaboration" || meta.teamProjectId) return;
  const teamId = String(meta.teamRootId || meta.teamId || "").trim();
  const versionId = String(meta.teamVersionId || "").trim();
  if (!teamId || !versionId) return;
  await writeJson(join(workdir, ".site", "team.json"), {
    version: 1,
    teamId,
    name: String(meta.teamName || meta.name || "New team"),
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt
  });
  await writeJson(join(workdir, ".site", "team-version.json"), {
    version: 1,
    teamVersionId: versionId,
    teamId,
    versionNumber: meta.teamVersionNumber || 1,
    parentTeamVersionId: meta.parentTeamVersionId || null,
    status: meta.teamVersionStatus || "draft",
    teamCoreDigest: meta.teamCoreDigest || null,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    releasedAt: meta.releasedAt || null,
    archivedAt: meta.archivedAt || null
  });
}

async function assertTeamNameAvailable(name, { excludeProjectId, teamRootId } = {}) {
  const normalized = String(name || "").trim().toLocaleLowerCase();
  if (!normalized) return;
  const conflict = (await listProjects()).find((project) => {
    if (project.projectId === excludeProjectId || project.teamProjectId || project.projectType === "collaboration") return false;
    if (project.teamVersionStatus === "archived") return false;
    if (teamRootId && project.teamRootId === teamRootId) return false;
    return String(project.teamName || project.name).trim().toLocaleLowerCase() === normalized;
  });
  if (conflict) throw new Error("TEAM_NAME_EXISTS: a team with this name already exists.");
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
  if (project.projectType === "collaboration") {
    project.taskRecords = await Promise.all(project.taskRecords.map(async (task) => {
      if (!task.runId || !task.runProjectId) return task;
      const runDir = resolve(projectPath(task.runProjectId), ".ogs", "runs", task.runId);
      const state = await loadProjectRunState(runDir).catch(() => undefined);
      if (!state?.status) return task;
      if (activeTaskWorkers.has(`${project.projectId}:${task.taskId}`) && !["completed", "failed", "cancelled", "deleted"].includes(task.status)) return task;
      return {
        ...task,
        status: state.status,
        startedAt: task.startedAt || state.startedAt || null,
        completedAt: task.completedAt || state.finishedAt || null,
        lastError: state.error || task.lastError || null,
        updatedAt: state.updatedAt || task.updatedAt
      };
    }));
  }
  return { ...project, projectStage: projectStage(project) };
}

export async function listProjects() {
  await mkdir(projectsRoot, { recursive: true });
  await cleanupProjectStaging();
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

export async function createProject({ name, overview, templateId = "empty", caseId, source = "created", locale = "zh-CN", teamId, teamName, teamVersionNumber = 1, parentTeamVersionId }) {
  await mkdir(projectsRoot, { recursive: true });
  const projectId = slug(name) + "-" + randomUUID().slice(0, 8);
  const normalizedName = String(name || "New team").trim().slice(0, 120) || "New team";
  const resolvedTeamName = String(teamName || normalizedName).trim().slice(0, 120) || normalizedName;
  const isTeamAsset = source !== "collaboration-project" && source !== "workspace";
  if (isTeamAsset) await assertTeamNameAvailable(resolvedTeamName, { teamRootId: teamId || undefined });
  const workdir = projectPath(projectId);
  const stagingWorkdir = join(stagingRoot, projectId);
  activeProjectCreations.add(stagingWorkdir);
  try {
    await mkdir(stagingWorkdir, { recursive: true });
    const created = await createProjectVisualization({
      currentWorkdir: stagingWorkdir,
      projectName: slug(name),
      templateId: templateId === "minimal" ? "minimal" : "empty",
      conflictStrategy: "reject"
    });
    const now = new Date().toISOString();
    await writeJson(join(stagingWorkdir, ".site", "project.json"), {
      projectId,
      name: normalizedName,
      teamName: resolvedTeamName,
      teamId: teamId || projectId,
      teamVersionId: projectId,
      teamVersionNumber,
      teamVersionStatus: "draft",
      ...(parentTeamVersionId ? { parentTeamVersionId } : {}),
      overview: String(overview || "").trim().slice(0, 4000),
      templateId,
      projectStatus: "draft",
      projectDigest: null,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
      ogsProjectId: created.projectId,
      source,
      ...(isTeamAsset ? { teamRootId: teamId || projectId } : {}),
      ...(caseId ? { caseId } : {})
    });
    await writeJson(join(stagingWorkdir, "workspace", "index.json"), { version: 1, materials: [] });
    await writeTeamReferenceFiles(stagingWorkdir, await readJson(join(stagingWorkdir, ".site", "project.json"), {}));
    if (caseId) await materializeCaseTeam(caseId, stagingWorkdir, locale === "en" ? "en" : "zh-CN");
    await rename(stagingWorkdir, workdir);
    return readProject(projectId);
  } catch (error) {
    await rm(stagingWorkdir, { recursive: true, force: true }).catch(() => undefined);
    await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    activeProjectCreations.delete(stagingWorkdir);
    await cleanupProjectStaging();
  }
}

export async function createCollaborationProject({ name, workspaceKey, overview = "", teamVersionIds = [] } = {}) {
  const requestedIds = [...new Set((Array.isArray(teamVersionIds) ? teamVersionIds : []).map((value) => String(value || "").trim()).filter(Boolean))];
  // An empty collaboration shell remains valid for the project workspace API;
  // the current project form submits its team list through this atomic path.
  const mountedTeams = [];
  for (const requestedTeamId of requestedIds) {
    let team;
    if (requestedTeamId.startsWith("case:")) {
      const caseId = requestedTeamId.slice(5);
      const caseSpec = getCase(caseId);
      if (!caseSpec) throw new Error("TEAM_NOT_FOUND: the selected built-in team does not exist.");
      const language = "zh-CN";
      team = {
        projectId: requestedTeamId,
        teamId: requestedTeamId,
        teamVersionId: requestedTeamId,
        teamVersionNumber: 1,
        teamName: caseSpec.title?.[language] || caseSpec.title?.en || caseId,
        name: caseSpec.title?.[language] || caseId,
        overview: caseSpec.detail?.scenario?.[language] || caseSpec.short?.[language] || "",
        teamVersionStatus: "released",
        teamCoreDigest: builtInTeamCoreDigest(caseSpec),
        builtIn: true
      };
    } else {
      team = await readProject(requestedTeamId);
    }
    if (team.teamProjectId || team.teamVersionStatus !== "released") throw new Error("TEAM_VERSION_NOT_RELEASED: only a released team version can be mounted.");
    mountedTeams.push({
      teamId: team.teamId || team.projectId,
      teamVersionId: team.teamVersionId || team.projectId,
      teamVersionNumber: team.teamVersionNumber || 1,
      teamName: team.teamName || team.name,
      mountedAt: new Date().toISOString(),
      status: "available",
      ...(team.teamCoreDigest ? { teamCoreDigest: team.teamCoreDigest } : {}),
      ...(team.builtIn ? { builtIn: true } : {})
    });
  }
  let project;
  try {
    const normalizedName = String(name || "协作项目").trim() || "协作项目";
    const existingProject = (await listProjects()).find((item) => item.projectType === "collaboration" && String(item.name).trim().toLocaleLowerCase() === normalizedName.toLocaleLowerCase());
    if (existingProject) throw new Error("PROJECT_NAME_EXISTS: a project with this name already exists.");
    project = await createProject({
      name: normalizedName,
      overview: String(overview),
      templateId: "empty",
      source: "collaboration-project"
    });
    const metaPath = join(project.workdir, ".site", "project.json");
    const meta = await readJson(metaPath, {});
    const collaborationMeta = {
      ...meta,
      projectType: "collaboration",
      teamId: undefined,
      teamVersionId: undefined,
      teamName: undefined,
      mountedTeams,
      taskRecords: [],
      workspaceKey: String(workspaceKey || project.projectId)
    };
    await writeJson(metaPath, {
      ...collaborationMeta,
      projectDefinitionDigest: computeProjectDefinitionDigest({
        ...normalizeMeta(collaborationMeta, project.projectId),
        materials: { version: 1, materials: [] }
      })
    });
    return readProject(project.projectId);
  } catch (error) {
    if (project?.workdir) await rm(project.workdir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
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
      const overview = caseSpec.detail?.scenario?.[language] || caseSpec.short?.[language] || "";
      team = {
        projectId: requestedTeamId,
        teamId: requestedTeamId,
        teamVersionId: requestedTeamId,
        teamVersionNumber: 1,
        teamName,
        name: teamName,
        overview,
        teamVersionStatus: "released",
        teamCoreDigest: builtInTeamCoreDigest(caseSpec),
        builtIn: true
      };
    } else {
      team = await readProject(requestedTeamId);
    }
    if (team.teamProjectId || team.teamVersionStatus !== "released") throw new Error("TEAM_VERSION_NOT_RELEASED: only a released team version can be mounted.");
    const mountedTeams = Array.isArray(project.mountedTeams) ? project.mountedTeams : [];
    if (mountedTeams.some((item) => item.teamVersionId === team.teamVersionId)) return project;
    const mounted = [...mountedTeams, {
      teamId: team.teamId || team.projectId,
      teamVersionId: team.teamVersionId || team.projectId,
      teamVersionNumber: team.teamVersionNumber || 1,
      teamName: team.teamName || team.name,
      mountedAt: new Date().toISOString(),
      status: "available",
      ...(team.teamCoreDigest ? { teamCoreDigest: team.teamCoreDigest } : {}),
      ...(team.builtIn ? { builtIn: true } : {})
    }];
    const next = {
      ...normalizeMeta(project, projectId),
      projectType: "collaboration",
      mountedTeams: mounted,
      projectDefinitionDigest: computeProjectDefinitionDigest({ ...project, mountedTeams: mounted }),
      updatedAt: new Date().toISOString()
    };
    await writeJson(join(project.workdir, ".site", "project.json"), next);
    return readProject(projectId);
  });
}

export async function listCollaborationProjects() {
  return (await listProjects()).filter((project) => project.projectType === "collaboration");
}

export async function getProjectRun(projectId, runId) {
  assertSafeId(runId, "runId");
  const project = await readProject(projectId);
  const task = (project.taskRecords || []).find((item) => item.runId === runId && !item.deletedAt);
  if (!task) throw new Error("RUN_NOT_FOUND: run does not belong to this project.");
  const runProjectId = task.runProjectId || projectId;
  const runProject = await readProject(runProjectId);
  const runDir = resolve(runProject.workdir, ".ogs", "runs", runId);
  const state = await loadProjectRunState(runDir);
  const activeWorker = activeTaskWorkers.get(`${projectId}:${task.taskId}`);
  if (activeWorker && ["completed", "failed", "cancelled"].includes(state.status)) await activeWorker.catch(() => undefined);
  const plan = await loadProjectRunPlan(runDir).catch(() => undefined);
  const latestProject = activeWorker ? await readProject(projectId) : project;
  const latestTask = (latestProject.taskRecords || []).find((item) => item.taskId === task.taskId) || task;
  return { projectId, taskId: latestTask.taskId, runId, state, plan, task: latestTask };
}

export async function getProjectTask(projectId, taskId) {
  return findTask(await readProject(projectId), taskId);
}

export async function getProjectRunEvents(projectId, runId, options = {}) {
  assertSafeId(runId, "runId");
  const project = await readProject(projectId);
  const task = (project.taskRecords || []).find((item) => item.runId === runId && !item.deletedAt);
  if (!task) throw new Error("RUN_NOT_FOUND: run does not belong to this project.");
  const runProject = await readProject(task.runProjectId || projectId);
  return {
    projectId,
    taskId: task.taskId,
    runId,
    ...(await loadRunEventsSnapshot({ workdir: runProject.workdir, runId, ...options }))
  };
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
      outputSummary: ""
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

const activeTaskStatuses = ACTIVE_RUN_STATUSES;

function assertProjectTaskExecutionSlot(project, taskId) {
  const active = (project.taskRecords || []).find((item) => item.taskId !== taskId && !item.deletedAt && activeTaskStatuses.has(item.status));
  if (active) throw new Error(`PROJECT_TASK_CONCURRENCY_LIMIT: task ${active.taskId} is currently ${active.status}; finish or cancel it before starting another task.`);
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
  if (!["start", "pause", "resume", "cancel"].includes(control)) throw new Error("TASK_CONTROL_INVALID: unsupported task control.");
  const project = await readProject(projectId);
  const task = findTask(project, taskId);
  if (["completed", "failed", "cancelled", "deleted"].includes(task.status)) {
    throw new Error(`TASK_CONTROL_INVALID: task is already ${task.status}.`);
  }
  if (task.runId) {
    if (control === "start") throw new Error("TASK_CONTROL_INVALID: task already has a run.");
    if (control === "resume") assertProjectTaskExecutionSlot(project, taskId);
    const runControl = control === "cancel" ? "cancel" : control;
    const result = await controlProjectRun(task.runProjectId || projectId, task.runId, runControl);
    const status = result.state?.status || (control === "cancel" ? "cancel_requested" : control === "pause" ? "pause_requested" : "running");
    return withProjectWriteLock(projectId, "project-task-control", async () => {
      const latest = await readProject(projectId);
      return saveTaskRecord(latest, taskId, { status, runId: task.runId });
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
    if (task.status !== "paused") throw new Error(`TASK_RESUME_NOT_ALLOWED: task status is ${task.status}.`);
    return withProjectWriteLock(projectId, "project-task-resume", async () => saveTaskRecord(await readProject(projectId), taskId, { status: "queued" }));
  }
  return withProjectWriteLock(projectId, "project-task-cancel", async () => saveTaskRecord(await readProject(projectId), taskId, { status: "cancelled", completedAt: new Date().toISOString() }));
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
  const reservedRunId = createRunId(new Date());
  const reservedTask = await withProjectWriteLock(projectId, "project-task-bind-run", async () => {
    const latest = await readProject(projectId);
    const latestTask = findTask(latest, taskId);
    if (latestTask.runId) return latestTask;
    return saveTaskRecord(latest, taskId, {
      runId: reservedRunId,
      runProjectId: team.teamVersionId,
      status: "planning",
      startedAt: task.startedAt || new Date().toISOString(),
      lastError: null
    });
  });
  if (reservedTask.runId !== reservedRunId || activeTaskWorkers.has(`${projectId}:${taskId}`)) return reservedTask;
  const runProject = await readProject(team.teamVersionId);
  const reservedRunDir = resolve(runProject.workdir, ".ogs", "runs", reservedRunId);
  await saveProjectRunState(reservedRunDir, {
    version: 1,
    runId: reservedRunId,
    status: "planning",
    control: { paused: false, cancelRequested: false },
    nodes: {},
    attempts: [],
    reviews: [],
    updatedAt: new Date().toISOString()
  });
  const workerKey = `${projectId}:${taskId}`;
  const worker = (async () => {
    try {
      const run = await startProjectRun(team.teamVersionId, {
        prompt: task.input,
        mode,
        requestedRunId: reservedRunId,
        idempotencyKey: `task:${projectId}:${taskId}`,
        materialInputsOverride: materials,
        materialSourceRoot: project.workdir
      });
      await withProjectWriteLock(projectId, "project-task-finish", async () => {
        const latest = await readProject(projectId);
        return saveTaskRecord(latest, taskId, {
          status: run.state?.status || "running",
          startedAt: task.startedAt || run.state?.startedAt || new Date().toISOString(),
          completedAt: ["completed", "failed", "cancelled"].includes(run.state?.status) ? (run.state?.finishedAt || new Date().toISOString()) : null,
          outputSummary: typeof run.result?.finalOutput === "string" ? run.result.finalOutput.slice(0, 500) : task.outputSummary
        });
      });
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : String(error);
      const currentState = await loadProjectRunState(reservedRunDir).catch(() => undefined);
      if (currentState) {
        await saveProjectRunState(reservedRunDir, {
          ...currentState,
          status: "failed",
          error: failureMessage,
          finishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }).catch(() => undefined);
      }
      await withProjectWriteLock(projectId, "project-task-start-failure", async () => saveTaskRecord(await readProject(projectId), taskId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        lastError: failureMessage
      })).catch(() => undefined);
    } finally {
      activeTaskWorkers.delete(workerKey);
    }
  })();
  activeTaskWorkers.set(workerKey, worker);
  void worker.catch(() => undefined);
  return reservedTask;
}

export async function reviewProjectTask(projectId, taskId, { decision, comment, reviewId } = {}) {
  if (!["approve", "rework", "pause", "terminate"].includes(decision)) throw new Error("TASK_REVIEW_INVALID: unsupported review decision.");
  const project = await readProject(projectId);
  const task = findTask(project, taskId);
  if (!["waiting_review", "paused"].includes(task.status) && !task.runId) throw new Error(`TASK_REVIEW_NOT_ALLOWED: task status is ${task.status}.`);
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
  const nextStatus = decision === "approve" || decision === "rework" ? "queued" : decision === "pause" ? "paused" : "cancelled";
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
  if (["running", "planning", "waiting_review", "paused", "pause_requested", "cancel_requested"].includes(task.status)) {
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
      overview: team.overview,
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

export async function createClassicTeamProject({ caseId, asTemplate = false, name, overview, locale = "zh-CN" } = {}) {
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
    overview: overview || defaultIntent,
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

export async function listTeamRepository({ includeUnreleased = false } = {}) {
  const released = (await listProjects()).filter((project) => !project.teamProjectId
    && project.projectType !== "collaboration"
    && (includeUnreleased || project.teamVersionStatus === "released")
    && (includeUnreleased || !project.archivedAt));
  const builtIns = cases.map((item) => ({
    projectId: `case:${item.id}`,
    teamId: `case:${item.id}`,
    teamVersionId: `case:${item.id}`,
    teamVersionNumber: 1,
    teamName: item.title?.["zh-CN"] || item.title?.en || item.id,
    name: item.title?.["zh-CN"] || item.title?.en || item.id,
    overview: item.detail?.scenario?.["zh-CN"] || item.short?.["zh-CN"] || "",
    teamVersionStatus: "released",
    teamCoreDigest: builtInTeamCoreDigest(item),
    source: "classic",
    builtIn: true,
    category: item.category
  }));
  return [...builtIns, ...released];
}

export async function queryTeamRepository({ query = "", category = "", status = "released", sort = "updated", page = 1, pageSize = 12 } = {}) {
  const allTeams = await listTeamRepository({ includeUnreleased: true });
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
  const normalizedCategory = String(category || "").trim().toLocaleLowerCase();
  const normalizedStatus = String(status || "").trim().toLocaleLowerCase();
  const filtered = allTeams.filter((team) => {
    const teamStatus = String(team.teamVersionStatus || "released").toLocaleLowerCase();
    const teamCategory = typeof team.category === "object" ? (team.category["zh-CN"] || team.category.en || "") : (team.category || "");
    const haystack = [team.teamName, team.name, team.overview, teamCategory].join(" ").toLocaleLowerCase();
    return (!normalizedQuery || haystack.includes(normalizedQuery))
      && (!normalizedCategory || String(teamCategory).toLocaleLowerCase() === normalizedCategory)
      && (!normalizedStatus || normalizedStatus === "all" || teamStatus === normalizedStatus);
  }).sort((left, right) => {
    if (sort === "name") return String(left.teamName || left.name).localeCompare(String(right.teamName || right.name), "zh-CN");
    if (sort === "version") return (right.teamVersionNumber || 0) - (left.teamVersionNumber || 0) || String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
  });
  const safePageSize = Math.max(1, Math.min(50, Number.parseInt(pageSize, 10) || 12));
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.max(1, Math.min(totalPages, Number.parseInt(page, 10) || 1));
  const stats = {
    total: allTeams.length,
    released: allTeams.filter((team) => team.teamVersionStatus === "released").length,
    builtIn: allTeams.filter((team) => team.builtIn).length,
    custom: allTeams.filter((team) => !team.builtIn).length,
    categories: Object.fromEntries([...new Set(allTeams.map((team) => typeof team.category === "object" ? (team.category["zh-CN"] || team.category.en || "未分类") : (team.category || "未分类")))].sort().map((item) => [item, allTeams.filter((team) => {
      const categoryValue = typeof team.category === "object" ? (team.category["zh-CN"] || team.category.en || "未分类") : (team.category || "未分类");
      return categoryValue === item;
    }).length]))
  };
  return {
    teams: filtered.slice((safePage - 1) * safePageSize, safePage * safePageSize),
    stats,
    pagination: { page: safePage, pageSize: safePageSize, total, totalPages }
  };
}

export async function simulateTeamVersion(teamVersionId, { prompt, locale = "zh-CN" } = {}) {
  const input = String(prompt || "").trim();
  if (!input || input.length > 1200) throw new Error("Enter a task between 1 and 1,200 characters.");
  const requestedId = String(teamVersionId || "").trim();
  if (requestedId.startsWith("case:")) {
    return { ...(await runCase({ caseId: requestedId.slice(5), prompt: input, locale, mode: "simulation" })), teamVersionId: requestedId, persisted: false };
  }
  const team = await readProject(requestedId);
  if (team.teamProjectId || team.teamVersionStatus !== "released") throw new Error("TEAM_VERSION_NOT_RELEASED: only a released team version can be simulated.");
  const workdir = await mkdtemp(join(tmpdir(), "ogs-team-simulation-"));
  const runId = `simulation-${randomUUID()}`;
  try {
    await mkdir(join(workdir, ".ogs"), { recursive: true });
    const bundle = await exportTeamPackage(team.workdir);
    const loaded = await loadTeamPackage({ workdir, bundle });
    if (loaded.validation?.ok === false) throw new Error("TEAM_SIMULATION_INVALID: team version failed validation.");
    const result = await runSystemWithAdapter({
      systemPath: resolve(workdir, "system.mmd"),
      prompt: input,
      workdir,
      runId,
      dryRun: true,
      projectRunMode: "dry-run",
      projectId: `preview:${requestedId}`,
      trustedProjectTopology: isTrustedTeamTopology(team),
      projectDigest: team.projectDigest,
      projectRunLock: false,
      logRun: false
    });
    return {
      teamVersionId: requestedId,
      mode: "simulation",
      persisted: false,
      status: result.status,
      finalRoleId: result.finalRoleId,
      finalOutput: result.finalOutput,
      stages: Array.isArray(result.stages) ? result.stages : [],
      auditTrail: Array.isArray(result.auditTrail) ? result.auditTrail.map((item) => ({
        roleId: item.roleId,
        selectedEvent: item.selectedEvent,
        status: item.status,
        durationMs: item.durationMs,
        backend: item.backend,
        modelId: item.modelId,
        failure: item.error
      })) : [],
      summary: result.runSummary || {},
      durationMs: 0
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
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
    overview: source.overview,
    templateId: source.templateId,
    source: "version-edit"
  });
  const bundle = await exportTeamPackage(source.workdir);
  const loaded = await loadTeamPackage({ workdir: project.workdir, bundle });
  if (loaded.validation?.ok === false) throw new Error("TEAM_VERSION_COPY_INVALID: the released version could not be copied.");
  const next = {
    ...(await readJson(join(project.workdir, ".site", "project.json"), {})),
    name: source.name,
    teamName: source.teamName || source.name,
    teamId: source.teamId,
    teamRootId: source.teamRootId || source.teamId,
    teamVersionId: project.projectId,
    teamVersionNumber: nextVersionNumber,
    teamVersionStatus: "editing",
    parentTeamVersionId: source.teamVersionId || source.projectId,
    projectStatus: "draft",
    projectDigest: null,
    confirmedAt: null,
    releasedAt: null,
    updatedAt: new Date().toISOString()
  };
  await writeJson(join(project.workdir, ".site", "project.json"), next);
  await writeTeamReferenceFiles(project.workdir, next);
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
      await writeTeamReferenceFiles(project.workdir, next);
      return readProject(projectId);
    }
    const next = { ...normalizeMeta(project, projectId), teamVersionStatus: "archived", archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await writeJson(join(project.workdir, ".site", "project.json"), next);
    await writeTeamReferenceFiles(project.workdir, next);
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
    const nextOverview = changes.overview === undefined ? project.overview : String(changes.overview).trim().slice(0, 4000);
    if (!nextName) throw new Error("Project name is required.");
    if (changes.name !== undefined && project.projectType === "team") {
      await assertTeamNameAvailable(nextName, { excludeProjectId: projectId, teamRootId: project.teamRootId });
    }
    const semanticChanged = nextOverview !== project.overview || changes.semanticChanged === true;
    const next = {
      ...normalizeMeta(project, projectId),
      name: nextName,
      ...(project.projectType === "team" && changes.name !== undefined ? { teamName: nextName } : {}),
      overview: nextOverview,
      updatedAt: new Date().toISOString()
    };
    if (project.projectType === "collaboration") next.projectDefinitionDigest = computeProjectDefinitionDigest({ ...project, ...next });
    if (semanticChanged) {
      next.projectStatus = "draft";
      next.projectDigest = null;
      next.confirmedAt = null;
    }
    await writeJson(join(project.workdir, ".site", "project.json"), next);
    await writeTeamReferenceFiles(project.workdir, next);
    return readProject(projectId);
  });
}

export async function invalidateProjectConfirmation(projectId, reason = "semantic-edit") {
  return withProjectWriteLock(projectId, `invalidate:${reason}`, async () => {
    const project = await readProject(projectId);
    const next = { ...normalizeMeta(project, projectId), projectStatus: "draft", projectDigest: null, confirmedAt: null, updatedAt: new Date().toISOString(), invalidatedReason: reason };
    await writeJson(join(project.workdir, ".site", "project.json"), next);
    await writeTeamReferenceFiles(project.workdir, next);
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
    const teamCoreDigest = await computeTeamCoreDigest(project.workdir);
    if (project.projectStatus === "confirmed" && project.projectDigest === digest && project.teamCoreDigest === teamCoreDigest) return project;
    const releasedAt = new Date().toISOString();
    const next = { ...normalizeMeta(project, projectId), projectStatus: "confirmed", projectDigest: digest, teamCoreDigest, confirmedAt: releasedAt, teamVersionStatus: release ? "released" : (project.teamVersionStatus || "draft"), releasedAt: release ? releasedAt : null, updatedAt: releasedAt };
    await writeJson(join(project.workdir, ".site", "project.json"), next);
    await writeTeamReferenceFiles(project.workdir, next);
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

function normalizeMaterialPath(filename) {
  const normalized = String(filename || "material.txt").replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.split("/").some((part) => part === "..")) throw new Error("MATERIAL_PATH_INVALID: material path must stay inside the project workspace.");
  const parts = normalized.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part.includes("\0"))) throw new Error("MATERIAL_PATH_INVALID: material path is invalid.");
  return parts.join("/");
}

export async function addProjectMaterials(projectId, files = []) {
  return withProjectWriteLock(projectId, "material-upload", async () => {
    const project = await readProject(projectId);
    if (project.projectType !== "collaboration") await requireCurrentConfirmation(project);
    const normalizedFiles = Array.isArray(files) ? files : [];
    if (!normalizedFiles.length || normalizedFiles.length > 200) throw new Error("MATERIAL_BATCH_INVALID: provide between 1 and 200 files.");
    const batchId = randomUUID();
    const tempRoot = resolve(project.workdir, ".site", "material-upload", batchId);
    const entries = [];
    let totalSize = 0;
    try {
      for (const file of normalizedFiles) {
        const filename = normalizeMaterialPath(file?.filename);
        const extension = extname(filename).toLowerCase();
        if (!allowedExtensions.has(extension)) throw new Error("Only md, txt, json, yaml, yml, and csv materials are supported.");
        if (typeof file?.content !== "string" || file.content.length > 1024 * 1024) throw new Error("Material content must be text up to 1 MB.");
        totalSize += Buffer.byteLength(file.content);
        if (totalSize > 8 * 1024 * 1024) throw new Error("Material batch must be no larger than 8 MB.");
        const materialId = slug(filename.replaceAll("/", "-").slice(0, -extension.length)) + "-" + randomUUID().slice(0, 6);
        const tempPath = resolve(tempRoot, filename);
        await mkdir(resolve(tempPath, ".."), { recursive: true });
        await writeFile(tempPath, file.content, "utf8");
        entries.push({
          materialId,
          filename,
          path: `workspace/files/${batchId}/${filename}`,
          contentType: file.contentType || "text/plain",
          size: Buffer.byteLength(file.content),
          contentHash: createHash("sha256").update(file.content).digest("hex"),
          status: "indexed",
          createdAt: new Date().toISOString()
        });
      }
      const finalRoot = resolve(project.workdir, "workspace", "files", batchId);
      await mkdir(resolve(finalRoot, ".."), { recursive: true });
      await rename(tempRoot, finalRoot);
      const index = project.materials && Array.isArray(project.materials.materials) ? project.materials : { version: 1, materials: [] };
      index.materials = [...index.materials, ...entries];
      await writeJson(join(project.workdir, "workspace", "index.json"), index);
      const meta = await readJson(join(project.workdir, ".site", "project.json"), {});
      await writeJson(join(project.workdir, ".site", "project.json"), {
        ...meta,
        projectDefinitionDigest: computeProjectDefinitionDigest({ ...project, ...meta, materials: index }),
        updatedAt: new Date().toISOString()
      });
      return entries;
    } catch (error) {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  });
}

export async function addProjectMaterial(projectId, material) {
  const entries = await addProjectMaterials(projectId, [material]);
  return entries[0];
}

export async function startProjectRun(projectId, { prompt, mode = "dry-run", idempotencyKey, materialInputsOverride, materialSourceRoot, resumeRunId, resumeRunDir, requestedRunId } = {}) {
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
  let runId = requestedRunId;
  let requestFingerprint;
  let pendingLedgerEntry;
  try {
  if (resumeRunDir && !resumeRunId) throw new Error("RUN_RESUME_INVALID: resumeRunId is required when resuming a run.");
  if (resumeRunId) assertSafeId(resumeRunId, "resumeRunId");
  if (requestedRunId) assertSafeId(requestedRunId, "requestedRunId");
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
    materialSourceRoot,
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
    outputSummary: typeof result?.finalOutput === "string" ? result.finalOutput.slice(0, 500) : ""
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
  let project = await readProject(projectId);
  const taskOwner = project.projectType === "collaboration"
    ? (project.taskRecords || []).find((item) => item.runId === runId && item.runProjectId)
    : undefined;
  if (taskOwner?.runProjectId) {
    projectId = taskOwner.runProjectId;
    project = await readProject(projectId);
  }
  const runDir = resolve(project.workdir, ".ogs", "runs", runId);
  const state = await loadProjectRunState(runDir);
  if (control === "resume") {
      const latestControl = await readLatestProjectRunControl(runDir);
      if (latestControl?.action === "cancel") {
        throw new Error("RUN_RESUME_NOT_ALLOWED: cancellation has already been requested.");
      }
      if (!["waiting_review", "paused"].includes(state.status)) {
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
    return control === "cancel" && ["waiting_review", "paused"].includes(currentState.status)
      ? { ...next, status: "cancelled", updatedAt: new Date().toISOString() }
      : next;
  });
  return { projectId, runId, state: safeCancelled, controlRequest: request };
}

export async function exportProjectTeam(projectId) {
  const project = await readProject(projectId);
  const bundle = await exportTeamPackage(project.workdir);
  const exported = {
    mode: "single-project-v1",
    releaseManifest: bundle.releaseManifest,
    teamCoreDigest: bundle.teamCoreDigest || await computeTeamCoreDigest(project.workdir),
    team: {
      ...(bundle.team || {}),
      project: { name: project.name, overview: project.overview, source: "exported" }
    }
  };
  return { ...exported, packageDigest: computePackageDigest(exported) };
}

export async function exportProjectBundle(projectId) {
  const project = await readProject(projectId);
  const materials = [];
  for (const item of project.materials?.materials || []) {
    const content = await readFile(resolve(project.workdir, item.path), "utf8").catch(() => "");
    materials.push({ ...item, content });
  }
  const taskRecords = (project.taskRecords || []).filter((task) => !task.deletedAt).map(({ requestFingerprint, ...task }) => task);
  const projectDefinitionDigest = computeProjectDefinitionDigest({
    ...project,
    materials: {
      version: 1,
      materials: materials.map(({ content, ...item }) => ({
        ...item,
        contentHash: item.contentHash || createHash("sha256").update(content).digest("hex")
      }))
    }
  });
  const bundle = {
    mode: "project-v1",
    project: {
      name: project.name,
      overview: project.overview,
      workspaceKey: project.workspaceKey || null,
      projectDefinitionDigest,
      mountedTeams: project.mountedTeams || [],
      materials,
      taskRecords,
      runs: (project.runs || []).map((run) => ({ runId: run.runId, status: run.status, updatedAt: run.updatedAt, outputSummary: run.outputSummary || "" }))
    }
  };
  return { ...bundle, packageDigest: computePackageDigest(bundle) };
}

async function validateTeamPackage(bundle) {
  if (!bundle || bundle.mode !== "single-project-v1" || !bundle.team || typeof bundle.team.systemSource !== "string") {
    throw new Error("Unsupported project package format; expected mode=single-project-v1.");
  }
  const manifestPaths = bundle.releaseManifest?.artifactScope || bundle.team.releaseManifest?.artifactScope || [];
  if (!Array.isArray(manifestPaths) || manifestPaths.some((path) => {
    if (typeof path !== "string" || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return true;
    return path.split("/").some((part) => part === ".." || part === "");
  })) throw new Error("PROJECT_IMPORT_INVALID: unsafe artifact path.");
  if (bundle.team.systemSource.length > 2 * 1024 * 1024) throw new Error("TEAM_IMPORT_INVALID: system source is too large.");
  if (bundle.packageDigest && bundle.packageDigest !== computePackageDigest(bundle)) throw new Error("TEAM_IMPORT_DIGEST_MISMATCH: packageDigest does not match package contents.");
  const calculatedTeamCoreDigest = createHash("sha256").update(JSON.stringify(teamCorePayload(bundle))).digest("hex");
  if (bundle.teamCoreDigest && bundle.teamCoreDigest !== calculatedTeamCoreDigest) throw new Error("TEAM_IMPORT_DIGEST_MISMATCH: teamCoreDigest does not match team contents.");
  const credentialFields = new Set(["apikey", "accesstoken", "refreshtoken", "password", "clientsecret", "clientpassword", "secretvalue", "credentialvalue", "privatekey"]);
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
  return {
    bundle,
    metadata: bundle.team.project || {},
    teamCoreDigest: bundle.teamCoreDigest || calculatedTeamCoreDigest,
    packageDigest: bundle.packageDigest || computePackageDigest(bundle)
  };
}

function validateProjectBundle(bundle) {
  if (!bundle || bundle.mode !== "project-v1" || !bundle.project || typeof bundle.project !== "object") throw new Error("Unsupported project package format; expected mode=project-v1.");
  if (bundle.packageDigest && bundle.packageDigest !== computePackageDigest(bundle)) throw new Error("PROJECT_IMPORT_DIGEST_MISMATCH: packageDigest does not match package contents.");
  const materials = Array.isArray(bundle.project.materials) ? bundle.project.materials : [];
  if (materials.length > 200) throw new Error("PROJECT_IMPORT_INVALID: project package contains too many materials.");
  let totalSize = 0;
  for (const material of materials) {
    const filename = normalizeMaterialPath(material?.filename);
    if (!allowedExtensions.has(extname(filename).toLowerCase())) throw new Error("PROJECT_IMPORT_INVALID: unsupported material format.");
    if (typeof material?.content !== "string" || material.content.length > 1024 * 1024) throw new Error("PROJECT_IMPORT_INVALID: material content is too large.");
    totalSize += Buffer.byteLength(material.content);
  }
  if (totalSize > 8 * 1024 * 1024) throw new Error("PROJECT_IMPORT_INVALID: material content exceeds the package limit.");
  if (!Array.isArray(bundle.project.mountedTeams)) throw new Error("PROJECT_IMPORT_INVALID: mountedTeams must be an array.");
  const project = { ...bundle.project, materials };
  const expectedDefinitionDigest = computeProjectDefinitionDigest({
    ...project,
    materials: {
      version: 1,
      materials: materials.map(({ content, ...item }) => ({
        ...item,
        contentHash: item.contentHash || createHash("sha256").update(content).digest("hex")
      }))
    }
  });
  if (typeof project.projectDefinitionDigest !== "string" || project.projectDefinitionDigest !== expectedDefinitionDigest) {
    throw new Error("PROJECT_IMPORT_DIGEST_MISMATCH: projectDefinitionDigest does not match project contents.");
  }
  return { bundle, project, packageDigest: bundle.packageDigest || computePackageDigest(bundle) };
}

function uniqueImportedName(name, existing, prefix = "Imported", scope = "project") {
  const base = String(name || prefix).trim().slice(0, 120) || prefix;
  const used = new Set(existing
    .filter((item) => scope === "team"
      ? !item.teamProjectId && item.projectType !== "collaboration"
      : item.projectType === "collaboration")
    .map((item) => String(scope === "team" ? (item.teamName || item.name) : item.name).trim().toLocaleLowerCase()));
  if (!used.has(base.toLocaleLowerCase())) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} (${index})`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new Error("IMPORT_NAME_CONFLICT: unable to allocate a unique imported name.");
}

export async function previewTeamPackage(bundle) {
  if (bundle?.mode === "project-v1") return previewProjectBundle(bundle);
  const checked = await validateTeamPackage(bundle);
  const teams = await listTeamRepository();
  const metadataName = String(checked.metadata.name || "Imported team").trim() || "Imported team";
  const duplicate = teams.find((team) => team.teamCoreDigest === checked.teamCoreDigest);
  const nameConflict = teams.find((team) => String(team.teamName || team.name).trim().toLocaleLowerCase() === metadataName.toLocaleLowerCase() && team.teamCoreDigest !== checked.teamCoreDigest);
  return {
    mode: "single-project-v1",
    packageDigest: checked.packageDigest,
    teamCoreDigest: checked.teamCoreDigest,
    name: metadataName,
    duplicate: duplicate ? { projectId: duplicate.projectId, name: duplicate.teamName || duplicate.name, builtIn: Boolean(duplicate.builtIn) } : null,
    conflicts: nameConflict ? [{ type: "name", projectId: nameConflict.projectId, name: nameConflict.teamName || nameConflict.name }] : [],
    suggestedStrategy: duplicate ? "reuse" : nameConflict ? "create-new" : "create"
  };
}

export async function previewProjectBundle(bundle) {
  const checked = validateProjectBundle(bundle);
  const projects = (await listProjects()).filter((project) => project.projectType === "collaboration");
  const projectName = String(checked.project.name || "Imported project").trim() || "Imported project";
  const duplicate = projects.find((project) => project.projectDefinitionDigest === checked.project.projectDefinitionDigest && checked.project.projectDefinitionDigest);
  const nameConflict = projects.find((project) => String(project.name).trim().toLocaleLowerCase() === projectName.toLocaleLowerCase() && project.projectId !== duplicate?.projectId);
  return {
    mode: "project-v1",
    project: checked.project,
    packageDigest: checked.packageDigest,
    projectDefinitionDigest: checked.project.projectDefinitionDigest || null,
    name: projectName,
    duplicate: duplicate ? { projectId: duplicate.projectId, name: duplicate.name } : null,
    conflicts: nameConflict ? [{ type: "name", projectId: nameConflict.projectId, name: nameConflict.name }] : [],
    suggestedStrategy: duplicate ? "reuse" : nameConflict ? "create-new" : "create"
  };
}

export async function importTeamPackage(bundle, { conflictStrategy = "create-new" } = {}) {
  const preview = await previewTeamPackage(bundle);
  const strategy = ["reject", "reuse", "create-new"].includes(conflictStrategy) ? conflictStrategy : "reject";
  if (preview.duplicate) {
    if (strategy === "reuse") {
      if (preview.duplicate.builtIn) return (await listTeamRepository()).find((team) => team.projectId === preview.duplicate.projectId);
      return getProject(preview.duplicate.projectId);
    }
    if (strategy === "reject") {
      if (preview.duplicate.name?.trim().toLocaleLowerCase() === preview.name.trim().toLocaleLowerCase()) throw new Error("TEAM_NAME_EXISTS: an identical team version already exists.");
      throw new Error("TEAM_IMPORT_CONFLICT: an identical team version already exists.");
    }
  }
  if (preview.conflicts.length && strategy === "reject") throw new Error("TEAM_IMPORT_CONFLICT: the imported team name is already in use.");
  if (!bundle || bundle.mode !== "single-project-v1" || !bundle.team || typeof bundle.team.systemSource !== "string") {
    throw new Error("Unsupported project package format; expected mode=single-project-v1.");
  }
  const manifestPaths = bundle.releaseManifest?.artifactScope || bundle.team.releaseManifest?.artifactScope || [];
  if (!Array.isArray(manifestPaths) || manifestPaths.some((path) => {
    if (typeof path !== "string" || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return true;
    return path.split("/").some((part) => part === ".." || part === "");
  })) {
    throw new Error("PROJECT_IMPORT_INVALID: unsafe artifact path.");
  }
  if (bundle.team.systemSource.length > 2 * 1024 * 1024) throw new Error("TEAM_IMPORT_INVALID: system source is too large.");
  if (bundle.packageDigest && bundle.packageDigest !== computePackageDigest(bundle)) {
    throw new Error("TEAM_IMPORT_DIGEST_MISMATCH: packageDigest does not match package contents.");
  }
  if (bundle.teamCoreDigest && bundle.teamCoreDigest !== createHash("sha256").update(JSON.stringify(teamCorePayload(bundle))).digest("hex")) {
    throw new Error("TEAM_IMPORT_DIGEST_MISMATCH: teamCoreDigest does not match team contents.");
  }
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
  const importName = strategy === "create-new" ? uniqueImportedName(metadata.name || "Imported team", await listProjects(), "Imported", "team") : (metadata.name || "Imported team");
  const libraryLock = await acquireProjectWriteLock(projectsRoot, "project-import");
  let project;
  try {
    project = await createProject({ name: importName, teamName: importName, overview: metadata.overview || "", templateId: "empty", source: "imported" });
    const loaded = await loadTeamPackage({ workdir: project.workdir, bundle });
    if (loaded.validation?.ok === false) throw new Error("PROJECT_IMPORT_INVALID: imported Mermaid system failed validation.");
    await withProjectWriteLock(project.projectId, "project-import", async () => {
      const current = await readProject(project.projectId);
      const importedMeta = { ...normalizeMeta(current, current.projectId), source: "imported", teamCoreDigest: bundle.teamCoreDigest || await computeTeamCoreDigest(current.workdir), updatedAt: new Date().toISOString() };
      await writeJson(join(current.workdir, ".site", "project.json"), importedMeta);
      await writeTeamReferenceFiles(current.workdir, importedMeta);
    });
    return getProject(project.projectId);
  } catch (error) {
    if (project?.workdir) await rm(project.workdir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(`PROJECT_IMPORT_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await libraryLock.release();
  }
}

export async function importProjectBundle(bundle, { conflictStrategy = "create-new" } = {}) {
  const preview = await previewProjectBundle(bundle);
  const strategy = ["reject", "reuse", "create-new"].includes(conflictStrategy) ? conflictStrategy : "reject";
  if (preview.duplicate) {
    if (strategy === "reuse") return getProject(preview.duplicate.projectId);
    if (strategy === "reject") throw new Error("PROJECT_IMPORT_CONFLICT: an identical project definition already exists.");
  }
  if (preview.conflicts.length && strategy === "reject") throw new Error("PROJECT_IMPORT_CONFLICT: the imported project name is already in use.");
  const existing = await listProjects();
  const projectName = strategy === "create-new" ? uniqueImportedName(preview.name, existing, "Imported project", "project") : preview.name;
  const source = preview.project;
  const project = await createCollaborationProject({
    name: projectName,
    overview: source.overview || "",
    teamVersionIds: source.mountedTeams.map((team) => team.teamVersionId || team.teamId).filter(Boolean)
  });
  try {
    if (source.materials.length) await addProjectMaterials(project.projectId, source.materials.map((material) => ({
      filename: material.filename,
      content: material.content,
      contentType: material.contentType
    })));
    return getProject(project.projectId);
  } catch (error) {
    await rm(project.workdir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(`PROJECT_IMPORT_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export { projectsRoot };
