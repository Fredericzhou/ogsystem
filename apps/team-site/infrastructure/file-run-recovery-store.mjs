import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { loadProjectRunState, updateProjectRunState } from "../../../dist/runtime/project-run-state.js";
import { readProjectRunOwnerFile } from "./project-run-evidence-paths.mjs";
import { assertSafeEvidencePath } from "./safe-evidence-path.mjs";

const validProjectId = (value) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(value || ""));
const validRunId = (value) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value || ""));

export function createFileRunRecoveryStore({ projectsRoot = resolve(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects")) } = {}) {
  const root = resolve(projectsRoot);

  function runDirectory(projectId, runId) {
    if (!validProjectId(projectId) || !validRunId(runId)) throw new Error("Invalid recovery resource ID.");
    return join(root, projectId, ".ogs", "runs", runId);
  }

  async function assertProjectDirectory(projectId) {
    if (!validProjectId(projectId)) throw new Error("Invalid project ID.");
    return assertSafeEvidencePath(root, [projectId], { kind: "directory", label: "Project" });
  }

  async function assertRunStateFile(projectId, runId, { allowMissing = false } = {}) {
    runDirectory(projectId, runId);
    return assertSafeEvidencePath(root, [projectId, ".ogs", "runs", runId, "control", "state.json"], {
      kind: "file", allowMissingFinal: allowMissing, label: "Run state"
    });
  }

  async function assertProjectWriteLockPath(projectId) {
    await assertSafeEvidencePath(root, [projectId, ".site"], { kind: "directory", label: "Project metadata" });
    await assertSafeEvidencePath(root, [projectId, ".site", "project-write.lock"], {
      kind: "file", allowMissingFinal: true, label: "Project write lock"
    });
  }

  async function readRunOwner(projectId, runId) {
    await assertProjectDirectory(projectId);
    const project = { projectId, workdir: resolve(root, projectId) };
    return readProjectRunOwnerFile(project, runId);
  }

  async function readJsonFile(path, { allowMissing = false } = {}) {
    if (allowMissing) {
      try { return JSON.parse(await readFile(path, "utf8")); }
      catch (error) { if (error?.code === "ENOENT") return undefined; throw error; }
    }
    return JSON.parse(await readFile(path, "utf8"));
  }

  async function writeJsonFile(path, value) {
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  return Object.freeze({
    async listProjectIds() {
      await mkdir(root, { recursive: true }).catch((error) => {
        if (error?.code !== "EEXIST") throw error;
      });
      await assertSafeEvidencePath(root, [], { kind: "directory", label: "Projects root" });
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink() && validProjectId(entry.name)) {
          await assertSafeEvidencePath(root, [entry.name], { kind: "directory", label: "Project" });
        }
      }
      return entries.filter((entry) => entry.isDirectory() && entry.name !== ".staging").map((entry) => entry.name);
    },
    async listRunIds(projectId) {
      await assertProjectDirectory(projectId);
      let runsDirectory;
      try {
        runsDirectory = await assertSafeEvidencePath(root, [projectId, ".ogs", "runs"], {
          kind: "directory", label: "Run evidence"
        });
      } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
      }
      const entries = await readdir(runsDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          await assertSafeEvidencePath(root, [projectId, ".ogs", "runs", entry.name], {
            kind: "directory", label: "Run evidence"
          });
        }
      }
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    },
    async readRunState(projectId, runId) {
      const runDir = runDirectory(projectId, runId);
      await assertProjectDirectory(projectId);
      try {
        await assertRunStateFile(projectId, runId);
      } catch (error) {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      }
      return loadProjectRunState(runDir).catch((error) => {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      });
    },
    async readRunOwner(projectId, runId) {
      await assertProjectDirectory(projectId);
      const project = { projectId, workdir: resolve(root, projectId) };
      return readProjectRunOwnerFile(project, runId);
    },
    async updateRunState(projectId, runId, update) {
      const runDir = runDirectory(projectId, runId);
      await assertProjectDirectory(projectId);
      await assertProjectWriteLockPath(projectId);
      await assertRunStateFile(projectId, runId);
      return updateProjectRunState(runDir, update);
    },
    async removeRunDirectory(projectId, runId) {
      const runDir = runDirectory(projectId, runId);
      await assertProjectDirectory(projectId);
      await assertSafeEvidencePath(root, [projectId, ".ogs", "runs", runId], {
        kind: "directory", label: "Run evidence"
      });
      await readRunOwner(projectId, runId);
      await rm(runDir, { recursive: true, force: false });
    },
    async readProjectMetadata(projectId) {
      await assertProjectDirectory(projectId);
      let metadataPath;
      try {
        metadataPath = await assertSafeEvidencePath(root, [projectId, ".site", "project.json"], {
          kind: "file", allowMissingFinal: true, label: "Project metadata"
        });
      } catch (error) {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      }
      return readJsonFile(metadataPath, { allowMissing: true });
    },
    async writeProjectMetadata(projectId, metadata) {
      await assertProjectDirectory(projectId);
      await assertProjectWriteLockPath(projectId);
      const metadataPath = await assertSafeEvidencePath(root, [projectId, ".site", "project.json"], {
        kind: "file", label: "Project metadata"
      });
      await writeJsonFile(metadataPath, metadata);
    }
  });
}
