import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { acquireProjectWriteLock } from "../../../dist/runtime/project-run-lock.js";

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export function createFileTeamVersionLifecycle({ projectsRoot = resolve(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects")), getTeamVersion }) {
  if (typeof getTeamVersion !== "function") throw new TypeError("File TeamVersion lifecycle requires a TeamVersion reader.");
  const root = resolve(projectsRoot);

  async function archiveReleasedTeamVersion(teamVersionId) {
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(String(teamVersionId || ""))) throw new Error("Invalid project id.");
    const workdir = join(root, teamVersionId);
    return acquireProjectWriteLock(workdir, "team-version-archive").then(async (lock) => {
      try {
        const metaPath = join(workdir, ".site", "project.json");
        const meta = await readJson(metaPath);
        if (!meta) throw new Error("Project not found.");
        if (meta.teamProjectId) throw new Error("TEAM_VERSION_INVALID: project workspaces cannot be archived as team versions.");
        if (meta.teamVersionStatus !== "released") throw new Error("TEAM_VERSION_NOT_RELEASED: only a released team version can be archived.");
        const now = new Date().toISOString();
        const next = {
          ...meta,
          teamVersionId: meta.teamVersionId || teamVersionId,
          teamVersionStatus: "archived",
          archivedAt: now,
          updatedAt: now
        };
        await writeJson(metaPath, next);
        const teamId = String(next.teamRootId || next.teamId || "").trim();
        const versionId = String(next.teamVersionId || "").trim();
        if (next.projectType !== "collaboration" && !next.teamProjectId && teamId && versionId) {
          await writeJson(join(workdir, ".site", "team.json"), {
            version: 1,
            teamId,
            name: String(next.teamName || next.name || "New team"),
            createdAt: next.createdAt,
            updatedAt: next.updatedAt
          });
          await writeJson(join(workdir, ".site", "team-version.json"), {
            version: 1,
            teamVersionId: versionId,
            teamId,
            versionNumber: next.teamVersionNumber || 1,
            parentTeamVersionId: next.parentTeamVersionId || null,
            status: next.teamVersionStatus,
            teamCoreDigest: next.teamCoreDigest || null,
            createdAt: next.createdAt,
            updatedAt: next.updatedAt,
            releasedAt: next.releasedAt || null,
            archivedAt: next.archivedAt
          });
        }
        return getTeamVersion(teamVersionId);
      } finally {
        await lock.release();
      }
    });
  }

  return Object.freeze({ archiveReleasedTeamVersion });
}
