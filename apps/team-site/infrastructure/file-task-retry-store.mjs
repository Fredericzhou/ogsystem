import { join, resolve, sep } from "node:path";
import { lstat, readFile } from "node:fs/promises";
import { loadProjectMaterialSnapshots } from "../../../dist/runtime/project-run.js";
import { loadProjectRunState } from "../../../dist/runtime/project-run-state.js";
import { homedir } from "node:os";
import { readProjectRunOwner } from "./project-run-evidence-paths.mjs";
import { assertSafeEvidencePath } from "./safe-evidence-path.mjs";

function safeRoot(workdir) {
  if (typeof workdir !== "string" || !workdir.trim()) {
    throw new Error("TASK_RETRY_STORAGE_INVALID: project workspace is required.");
  }
  const root = resolve(workdir);
  return root;
}

function safeRunId(runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(runId || ""))) {
    throw new Error("TASK_RETRY_STORAGE_INVALID: Run ID is invalid.");
  }
  return runId;
}

function safeProjectId(projectId) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(String(projectId || ""))) {
    throw new Error("TASK_RETRY_STORAGE_INVALID: Project ID is invalid.");
  }
  return projectId;
}

function safeTaskId(taskId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(taskId || ""))) {
    throw new Error("TASK_RETRY_STORAGE_INVALID: Task ID is invalid.");
  }
  return taskId;
}

export function createFileTaskRetryStore({ projectsRoot = resolve(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects")) } = {}) {
  const root = resolve(projectsRoot);
  async function loadProjectTask(projectId, taskId) {
    safeProjectId(projectId);
    safeTaskId(taskId);
    const workdir = safeRoot(join(root, projectId));
    await assertSafeEvidencePath(workdir, [], { kind: "directory", label: "Project workspace" });
    await assertSafeEvidencePath(workdir, [".site"], { kind: "directory", label: "Project metadata" });
    await assertSafeEvidencePath(workdir, [".site", "project.json"], { kind: "file", label: "Project metadata" });
    let metadata;
    try { metadata = JSON.parse(await readFile(resolve(workdir, ".site", "project.json"), "utf8")); }
    catch { throw new Error("RUN_NOT_FOUND: run does not belong to this Project Task."); }
    const task = (metadata.taskRecords || []).find((item) => item.taskId === taskId && !item.deletedAt);
    if (metadata.projectType !== "collaboration" || !task) throw new Error("RUN_NOT_FOUND: run does not belong to this Project Task.");
    return { workdir, task };
  }

  async function evidenceRoot(projectId, taskId, runId) {
    safeRunId(runId);
    const { workdir, task } = await loadProjectTask(projectId, taskId);
    const project = { projectId, workdir };
    await readProjectRunOwner(project, task, runId);
    return { workdir, task };
  }

  async function runDirectoryExists(workdir, runId) {
    const segments = [".ogs", "runs", safeRunId(runId)];
    for (let index = 0; index < segments.length; index += 1) {
      let path;
      try {
        path = await assertSafeEvidencePath(workdir, segments.slice(0, index + 1), {
          kind: "directory",
          allowMissingFinal: true,
          label: "Run evidence"
        });
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
      try {
        const stats = await lstat(path);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw new Error("RUN_EVIDENCE_PATH_INVALID: Run evidence must be a regular directory.");
        }
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    }
    return true;
  }

  async function safeRunArtifact(workdir, runId, relativePath) {
    const value = String(relativePath || "");
    if (!value || value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value)) {
      throw new Error("TASK_RETRY_STORAGE_INVALID: material snapshot path is invalid.");
    }
    const segments = value.split(/[\\/]+/);
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error("TASK_RETRY_STORAGE_INVALID: material snapshot path is invalid.");
    }
    return assertSafeEvidencePath(workdir, [".ogs", "runs", safeRunId(runId), ...segments], {
      kind: "file", label: "Run material snapshot"
    });
  }

  function isMissingReservation(task, runId) {
    const taskRunIds = Array.isArray(task.runIds) ? task.runIds : task.currentRunId ? [task.currentRunId] : [];
    return task.currentRunId === runId && taskRunIds.includes(runId) && task.status === "failed"
      && /^RUN_STATE_MISSING:/.test(task.lastError || "");
  }
  return Object.freeze({
    async readRunState(projectId, taskId, runId) {
      safeRunId(runId);
      const { workdir, task } = await loadProjectTask(projectId, taskId);
      const missingReservation = isMissingReservation(task, runId);
      const directoryExists = await runDirectoryExists(workdir, runId);
      if (!directoryExists) {
        if (missingReservation) return undefined;
        throw new Error("RUN_NOT_FOUND: run evidence does not exist.");
      }
      await readProjectRunOwner({ projectId, workdir }, task, runId);
      await assertSafeEvidencePath(workdir, [".ogs", "runs", safeRunId(runId), "control", "state.json"], {
        kind: "file", label: "Run state"
      });
      try {
        return await loadProjectRunState(resolve(workdir, ".ogs", "runs", safeRunId(runId)));
      } catch (error) {
        if (error?.code === "ENOENT" && missingReservation) return undefined;
        throw error;
      }
    },
    async loadMaterialSnapshots(projectId, taskId, runId) {
      const { workdir } = await evidenceRoot(projectId, taskId, runId);
      const runRoot = [".ogs", "runs", safeRunId(runId)];
      await assertSafeEvidencePath(workdir, [...runRoot, "control", "materials.json"], { kind: "file", label: "Run materials" });
      const snapshots = await loadProjectMaterialSnapshots(resolve(workdir, ...runRoot));
      for (const snapshot of snapshots) await safeRunArtifact(workdir, runId, snapshot.snapshotPath);
      return snapshots;
    },
    resolveMaterialPath(projectId, relativePath) {
      const projectRoot = safeRoot(join(root, safeProjectId(projectId)));
      const target = resolve(projectRoot, String(relativePath || ""));
      if (!target.startsWith(`${projectRoot}${sep}`)) throw new Error("TASK_RETRY_STORAGE_INVALID: material path escapes the Project workspace.");
      return target;
    },
    async resolveRunArtifactPath(projectId, taskId, runId, relativePath) {
      const { workdir } = await evidenceRoot(projectId, taskId, runId);
      return safeRunArtifact(workdir, runId, relativePath);
    }
  });
}
