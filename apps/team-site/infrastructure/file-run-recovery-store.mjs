import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { loadProjectRunState, updateProjectRunState } from "../../../dist/runtime/project-run-state.js";

const validId = (value) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value || ""));

export function createFileRunRecoveryStore({ projectsRoot = resolve(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects")) } = {}) {
  function runDirectory(projectId, runId) {
    if (!validId(projectId) || !validId(runId)) throw new Error("Invalid recovery resource ID.");
    return join(projectsRoot, projectId, ".ogs", "runs", runId);
  }

  async function readJson(path) {
    try { return JSON.parse(await readFile(path, "utf8")); }
    catch (error) { if (error?.code === "ENOENT") return undefined; throw error; }
  }

  async function writeJson(path, value) {
    await mkdir(resolve(path, ".."), { recursive: true });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  }

  return Object.freeze({
    async listProjectIds() {
      await mkdir(projectsRoot, { recursive: true });
      const entries = await readdir(projectsRoot, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory() && entry.name !== ".staging").map((entry) => entry.name);
    },
    async listRunIds(projectId) {
      const entries = await readdir(join(projectsRoot, projectId, ".ogs", "runs"), { withFileTypes: true }).catch(() => []);
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    },
    async readRunState(projectId, runId) {
      return loadProjectRunState(runDirectory(projectId, runId)).catch(() => undefined);
    },
    async updateRunState(projectId, runId, update) {
      return updateProjectRunState(runDirectory(projectId, runId), update);
    },
    async removeRunDirectory(projectId, runId) {
      await rm(runDirectory(projectId, runId), { recursive: true, force: true });
    },
    async readProjectMetadata(projectId) {
      if (!validId(projectId)) throw new Error("Invalid project ID.");
      return readJson(join(projectsRoot, projectId, ".site", "project.json"));
    },
    async writeProjectMetadata(projectId, metadata) {
      if (!validId(projectId)) throw new Error("Invalid project ID.");
      return writeJson(join(projectsRoot, projectId, ".site", "project.json"), metadata);
    }
  });
}
