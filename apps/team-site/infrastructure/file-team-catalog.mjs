import { mkdir, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { assertLatestProjectOverview } from "../domain/contracts.mjs";
import { assertCanonicalTeamVersionId } from "../domain/team.mjs";
import { getCase } from "../cases.mjs";

function normalizeTeamMeta(meta, projectId) {
  assertLatestProjectOverview(meta);
  const teamVersionId = meta?.teamVersionId || meta?.teamId && projectId;
  if (teamVersionId) assertCanonicalTeamVersionId(teamVersionId);
  if (meta?.teamId) assertCanonicalTeamVersionId(meta.teamId);
  if (meta?.teamRootId) assertCanonicalTeamVersionId(meta.teamRootId);
  if (meta?.parentTeamVersionId) assertCanonicalTeamVersionId(meta.parentTeamVersionId);
  for (const mountedTeam of meta?.mountedTeams || []) assertCanonicalTeamVersionId(mountedTeam?.teamVersionId);
  for (const task of meta?.taskRecords || []) {
    if (task?.teamVersionId) assertCanonicalTeamVersionId(task.teamVersionId);
    if (task?.runProjectId) assertCanonicalTeamVersionId(task.runProjectId);
  }
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
    teamVersionId: teamVersionId || (teamId ? projectId : undefined),
    teamVersionNumber,
    teamVersionStatus,
    teamName: String(meta?.teamName || meta?.name || "New team"),
    parentTeamVersionId: meta?.parentTeamVersionId || undefined,
    releasedAt: meta?.releasedAt || (teamVersionStatus === "released" ? meta?.confirmedAt || null : null),
    archivedAt: meta?.archivedAt || null,
    ...(meta?.teamProjectId ? { teamProjectId: meta.teamProjectId } : {}),
    ...(meta?.workspaceKey ? { workspaceKey: String(meta.workspaceKey) } : {}),
    ...(meta?.caseId ? { caseId: meta.caseId } : {}),
    ...(meta?.source === "classic" && meta?.caseId ? { builtIn: true, category: getCase(meta.caseId)?.category } : {}),
    ...(meta?.ogsProjectId ? { ogsProjectId: meta.ogsProjectId } : {}),
    projectType: meta?.projectType || (meta?.teamProjectId ? "workspace" : "team"),
    mountedTeams: Array.isArray(meta?.mountedTeams) ? meta.mountedTeams : [],
    taskRecords: Array.isArray(meta?.taskRecords) ? meta.taskRecords : []
  };
}

function projectStage(project, runs) {
  if (project.projectStatus !== "confirmed") return "draft";
  if (runs.some((run) => ["running", "planning", "waiting_review", "paused"].includes(run.status))) return "running";
  return "idle";
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

export function createFileTeamCatalog({ projectsRoot = resolve(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects")) } = {}) {
  const root = resolve(projectsRoot);

  async function listTeamRepository({ includeUnreleased = false, includeCollaboration = false } = {}) {
    await mkdir(root, { recursive: true });
    const entries = await readdir(root, { withFileTypes: true });
    const storedTeams = [];
    const teamVersionIds = new Set();
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".staging") continue;
      const meta = await readJson(join(root, entry.name, ".site", "project.json"));
      if (!meta) continue;
      if (meta.teamVersionId && meta.teamVersionId !== entry.name) {
        throw new Error("TEAM_VERSION_ID_INVALID: stored TeamVersion identity does not match its workspace.");
      }
      const team = normalizeTeamMeta(meta, entry.name);
      const teamVersionId = team.teamVersionId || team.projectId;
      if (teamVersionIds.has(teamVersionId)) throw new Error("TEAM_VERSION_ID_INVALID: duplicate TeamVersion identity in catalog.");
      teamVersionIds.add(teamVersionId);
      if (team.teamProjectId || (!includeCollaboration && team.projectType === "collaboration")) continue;
      if (!includeUnreleased && (team.teamVersionStatus !== "released" || team.archivedAt)) continue;
      const runIndex = await readJson(join(root, entry.name, ".ogs", "runs-index.json"), { runs: [] });
      const runs = Array.isArray(runIndex?.runs) ? runIndex.runs : [];
      storedTeams.push({ ...team, projectStage: projectStage(team, runs) });
    }
    storedTeams.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    return storedTeams;
  }

  async function listTeamFactory() {
    return (await listTeamRepository({ includeUnreleased: true, includeCollaboration: true })).filter((team) =>
      !team.builtIn && team.teamVersionStatus !== "released" && team.teamVersionStatus !== "archived"
    );
  }

  async function getTeamVersion(teamVersionId) {
    assertCanonicalTeamVersionId(teamVersionId);
    const projectId = String(teamVersionId).trim();
    const meta = await readJson(join(root, projectId, ".site", "project.json"));
    if (!meta) throw new Error("Project not found.");
    const team = normalizeTeamMeta(meta, projectId);
    if ((team.teamVersionId || team.projectId) !== projectId) throw new Error("TEAM_VERSION_ID_INVALID: stored TeamVersion identity does not match its workspace.");
    return { ...team, workdir: join(root, projectId) };
  }

  async function assertTeamNameAvailable(name, { excludeProjectId, teamRootId } = {}) {
    const normalized = String(name || "").trim().toLocaleLowerCase();
    if (!normalized) return;
    const conflict = (await listTeamRepository({ includeUnreleased: true, includeCollaboration: true })).find((team) => {
      if (team.projectId === excludeProjectId || team.teamProjectId || team.projectType === "collaboration") return false;
      if (team.teamVersionStatus === "archived") return false;
      if (teamRootId && team.teamRootId === teamRootId) return false;
      return String(team.teamName || team.name).trim().toLocaleLowerCase() === normalized;
    });
    if (conflict) throw new Error("TEAM_NAME_EXISTS: a team with this name already exists.");
  }

  return Object.freeze({ listTeamFactory, listTeamRepository, getTeamVersion, assertTeamNameAvailable });
}
