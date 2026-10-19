import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, rename } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { acquireProjectWriteLock } from "../../../dist/runtime/project-run-lock.js";
import { assertLatestProjectOverview } from "../domain/contracts.mjs";
import { assertCanonicalTeamVersionId } from "../domain/team.mjs";
import { createFileTeamCatalog } from "./file-team-catalog.mjs";
import { createFileTeamLifecycleLocks } from "./file-team-lifecycle-locks.mjs";

const projectsRoot = resolve(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects"));
const fileTeamCatalog = createFileTeamCatalog({ projectsRoot });
const fileTeamLifecycleLocks = createFileTeamLifecycleLocks({ projectsRoot });
const stagingRoot = resolve(projectsRoot, ".staging");
const activeProjectCreations = new Set();
const projectWriteQueues = new Map();
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
  for (const field of ["teamId", "teamRootId", "teamVersionId", "parentTeamVersionId"]) {
    if (meta?.[field]) assertCanonicalTeamVersionId(meta[field]);
  }
  const confirmed = meta?.projectStatus === "confirmed" && typeof meta?.projectDigest === "string" && typeof meta?.confirmedAt === "string";
  const teamVersionStatus = meta?.teamVersionStatus || (confirmed ? "released" : "draft");
  const teamRootId = String(meta?.teamRootId || meta?.teamId || (meta?.teamProjectId || meta?.projectType === "collaboration" ? "" : projectId));
  const teamId = teamRootId;
  const teamVersionNumber = Number.isInteger(meta?.teamVersionNumber) && meta.teamVersionNumber > 0 ? meta.teamVersionNumber : 1;
  const normalized = {
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
    ...(meta?.trustedClassicTopologyDigest ? { trustedClassicTopologyDigest: meta.trustedClassicTopologyDigest } : {}),
    ...(meta?.ogsProjectId ? { ogsProjectId: meta.ogsProjectId } : {})
    ,projectType: meta?.projectType || (meta?.teamProjectId ? "workspace" : "team")
    ,mountedTeams: Array.isArray(meta?.mountedTeams) ? meta.mountedTeams : []
    ,taskRecords: Array.isArray(meta?.taskRecords) ? meta.taskRecords : []
    ,nextTaskNumber: meta?.nextTaskNumber
  };
  if (normalized.teamId) assertCanonicalTeamVersionId(normalized.teamId);
  if (normalized.teamRootId) assertCanonicalTeamVersionId(normalized.teamRootId);
  if (normalized.teamVersionId) assertCanonicalTeamVersionId(normalized.teamVersionId);
  if (normalized.parentTeamVersionId) assertCanonicalTeamVersionId(normalized.parentTeamVersionId);
  for (const mountedTeam of normalized.mountedTeams) assertCanonicalTeamVersionId(mountedTeam?.teamVersionId);
  for (const task of normalized.taskRecords) {
    if (task?.teamVersionId) assertCanonicalTeamVersionId(task.teamVersionId);
    if (task?.runProjectId) assertCanonicalTeamVersionId(task.runProjectId);
  }
  return normalized;
}

export async function withProjectWriteLock(projectId, operation, action) {
  const previous = projectWriteQueues.get(projectId) || Promise.resolve();
  let releaseQueue;
  const turn = new Promise((resolveTurn) => { releaseQueue = resolveTurn; });
  const queued = previous.then(() => turn);
  projectWriteQueues.set(projectId, queued);
  await previous;
  let lock;
  try {
    lock = await acquireProjectWriteLock(projectPath(projectId), operation);
    return await action();
  } finally {
    await lock?.release();
    releaseQueue();
    if (projectWriteQueues.get(projectId) === queued) projectWriteQueues.delete(projectId);
  }
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
  return fileTeamCatalog.assertTeamNameAvailable(name, { excludeProjectId, teamRootId });
}

async function readProject(projectId) {
  const workdir = projectPath(projectId);
  const meta = await readJson(join(workdir, ".site", "project.json"));
  if (!meta) throw new Error("Project not found.");
  const materials = await readJson(join(workdir, "workspace", "index.json"), { version: 1, materials: [] });
  const runs = await readJson(join(workdir, ".ogs", "runs-index.json"), { runs: [] });
  const normalized = normalizeMeta(meta, projectId);
  return { ...normalized, workdir, materials, runs: runs.runs || [] };
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
      projects.push(normalized);
    }
  }
  return projects.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

async function createProjectAt(workdir, { projectId, name, overview, templateId = "empty", caseId, source = "created", teamId, teamRootId, teamVersionId, teamName, teamVersionNumber = 1, parentTeamVersionId }) {
  const normalizedName = String(name || "New team").trim().slice(0, 120) || "New team";
  const resolvedTeamName = String(teamName || normalizedName).trim().slice(0, 120) || normalizedName;
  const isTeamAsset = source !== "collaboration-project" && source !== "workspace";
  await mkdir(workdir, { recursive: true });
  const now = new Date().toISOString();
  const metadata = {
      projectId,
      name: normalizedName,
      teamName: resolvedTeamName,
      teamId: teamId || (isTeamAsset ? projectId : undefined),
      teamVersionId: teamVersionId || (isTeamAsset ? projectId : undefined),
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
      ogsProjectId: projectId,
      source,
      ...(isTeamAsset ? { teamRootId: teamRootId || teamId || projectId } : {}),
      ...(caseId ? { caseId } : {})
    };
  await writeJson(join(workdir, ".site", "project.json"), metadata);
  await writeJson(join(workdir, "workspace", "index.json"), { version: 1, materials: [] });
  await writeTeamReferenceFiles(workdir, metadata);
  return { projectId, workdir };
}

export async function createProject({ name, overview, templateId = "empty", caseId, source = "created", locale = "zh-CN", teamId, teamName, teamVersionNumber = 1, parentTeamVersionId }) {
  await mkdir(projectsRoot, { recursive: true });
  const projectId = slug(name) + "-" + randomUUID().slice(0, 8);
  const normalizedName = String(name || "New team").trim().slice(0, 120) || "New team";
  const resolvedTeamName = String(teamName || normalizedName).trim().slice(0, 120) || normalizedName;
  const isTeamAsset = source !== "collaboration-project" && source !== "workspace";
  const workdir = projectPath(projectId);
  const stagingWorkdir = join(stagingRoot, projectId);
  const create = async () => {
    activeProjectCreations.add(stagingWorkdir);
    try {
      await createProjectAt(stagingWorkdir, { projectId, name: normalizedName, overview, templateId, caseId, source, teamId, teamName, teamVersionNumber, parentTeamVersionId });
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
  };
  if (!isTeamAsset) return create();
  return fileTeamLifecycleLocks.withTeamNameLock(async () => {
    await assertTeamNameAvailable(resolvedTeamName, { teamRootId: teamId || undefined });
    return create();
  });
}

export async function initializeCollaborationProject(projectId, { mountedTeams = [], projectDefinitionDigest } = {}) {
  if (typeof projectDefinitionDigest !== "string" || !/^[a-f0-9]{64}$/.test(projectDefinitionDigest)) {
    throw new TypeError("Collaboration Project initialization requires an Application-computed definition digest.");
  }
  const project = await readProject(projectId);
  const metaPath = join(project.workdir, ".site", "project.json");
  const meta = await readJson(metaPath, {});
  if (meta.source !== "collaboration-project" || meta.projectType === "collaboration") {
    throw new Error("Only a new collaboration Project can be initialized.");
  }
  const collaborationMeta = {
    ...meta,
    projectType: "collaboration",
    teamId: undefined,
    teamVersionId: undefined,
    teamName: undefined,
    mountedTeams,
    taskRecords: [],
    nextTaskNumber: 1
  };
  await writeJson(metaPath, { ...collaborationMeta, projectDefinitionDigest });
  return readProject(project.projectId);
}

export async function removeProject(projectId) {
  const project = await readProject(projectId);
  const metadata = await readJson(join(project.workdir, ".site", "project.json"), {});
  if (metadata.source !== "collaboration-project") throw new Error("Only a newly-created collaboration Project can be compensated.");
  await rm(project.workdir, { recursive: true, force: true });
}

function findTask(project, taskId) {
  const task = (project.taskRecords || []).find((item) => item.taskId === taskId);
  if (!task || task.deletedAt) throw new Error("TASK_NOT_FOUND: task does not exist.");
  return task;
}

export async function saveTaskRecord(project, taskId, update) {
  const now = new Date().toISOString();
  const task = findTask(project, taskId);
  const nextTask = { ...task, ...update, updatedAt: now };
  const taskRecords = (project.taskRecords || []).map((item) => {
    const saved = item.taskId === taskId ? nextTask : item;
    const { runAttempts, ...persisted } = saved;
    return persisted;
  });
  await writeJson(join(project.workdir, ".site", "project.json"), {
    ...normalizeMeta(project, project.projectId),
    taskRecords,
    updatedAt: now
  });
  return nextTask;
}

export async function listTeamRepository({ includeUnreleased = false } = {}) {
  return fileTeamCatalog.listTeamRepository({ includeUnreleased });
}

export async function getProject(projectId) {
  return readProject(projectId);
}

export async function removeProjectData(projectId) {
  await rm(projectPath(projectId), { recursive: true, force: true });
}

export async function saveProjectMetadata(projectId, metadata) {
  const project = await readProject(projectId);
  const normalized = normalizeMeta(metadata, projectId);
  const taskRecords = normalized.taskRecords.map((task) => {
    const { runAttempts, ...persisted } = task;
    return persisted;
  });
  const persisted = { ...normalized, taskRecords };
  await writeJson(join(project.workdir, ".site", "project.json"), persisted);
  await writeTeamReferenceFiles(project.workdir, persisted);
  return readProject(projectId);
}

export const fileProjectStoreInternals = Object.freeze({
  projectsRoot,
  stagingRoot,
  projectPath,
  createProjectAt,
  readProject,
  getProject,
  listProjects,
  listTeamRepository,
  createProject,
  withProjectWriteLock,
  acquireProjectWriteLock,
  readJson,
  writeJson,
  normalizeMeta,
  writeTeamReferenceFiles,
  slug
});
export { projectsRoot };
