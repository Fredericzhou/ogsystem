import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { acquireActiveRunLock, acquireProjectWriteLock } from "../../../dist/runtime/project-run-lock.js";
import { rebuildRunsIndex } from "../../../dist/runtime/project-lifecycle.js";
import { loadProjectRunPlan } from "../../../dist/runtime/project-run.js";
import { loadProjectRunState } from "../../../dist/runtime/project-run-state.js";
import { writeProjectRunControl } from "../../../dist/runtime/project-run-control.js";

function assertSafeId(value, field) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value || ""))) throw new Error(`${field} is invalid.`);
}

async function readJson(path, fallback = undefined) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function runDirectory(project, runId) {
  assertSafeId(runId, "runId");
  const allowedRunsDir = resolve(project.workdir, ".ogs", "runs");
  const runDir = resolve(allowedRunsDir, runId);
  if (!runDir.startsWith(`${allowedRunsDir}${sep}`)) throw new Error("RUN_RESUME_INVALID: resume run must belong to the requested project.");
  return runDir;
}

export function createFileProjectRunStore() {
  return Object.freeze({
    async validateResume(project, resumeRunId, resumeRunDir, requestedRunId) {
      if (resumeRunDir && !resumeRunId) throw new Error("RUN_RESUME_INVALID: resumeRunId is required when resuming a run.");
      if (requestedRunId) assertSafeId(requestedRunId, "requestedRunId");
      if (!resumeRunId) return undefined;
      const runDir = runDirectory(project, resumeRunId);
      if (resumeRunDir && resolve(resumeRunDir) !== runDir) {
        throw new Error("RUN_RESUME_INVALID: resume run directory does not match resumeRunId.");
      }
      const task = await readJson(join(runDir, "task.json"), {});
      const plan = await loadProjectRunPlan(runDir);
      if (plan?.projectId && plan.projectId !== project.projectId) {
        throw new Error("RUN_SNAPSHOT_INVALID: run snapshot belongs to another project.");
      }
      return { runId: resumeRunId, runDir, task, plan };
    },

    async readLedger(project) {
      return readJson(join(project.workdir, ".site", "run-requests.json"), {});
    },

    async writeLedger(project, ledger) {
      return writeJson(join(project.workdir, ".site", "run-requests.json"), ledger);
    },

    acquireProjectWriteLock(project, operation) {
      return acquireProjectWriteLock(project.workdir, operation);
    },

    acquireRunLock(project, runId) {
      return acquireActiveRunLock(project.workdir, runId);
    },

    async writeResumeControl(runDir) {
      await writeProjectRunControl(runDir, "resume", "project-run-resume");
    },

    materialInputs(project, override) {
      return override || (project.materials?.materials || []).map((item) => ({
        materialId: item.materialId,
        sourcePath: resolve(project.workdir, item.path),
        contentType: item.contentType
      }));
    },

    async rebuildIndex(project) {
      return rebuildRunsIndex(project.workdir);
    },

    async readSnapshot(project, runId, { allowMissing = false } = {}) {
      const runDir = runDirectory(project, runId);
      const [plan, state] = await Promise.all([
        loadProjectRunPlan(runDir).catch((error) => allowMissing ? undefined : Promise.reject(error)),
        loadProjectRunState(runDir).catch((error) => allowMissing ? undefined : Promise.reject(error))
      ]);
      return { plan, state };
    },

    async recordTask(project, taskRecord) {
      const metadataPath = join(project.workdir, ".site", "project.json");
      const metadata = await readJson(metadataPath, {});
      await writeJson(metadataPath, {
        ...metadata,
        taskRecords: [...(Array.isArray(metadata.taskRecords) ? metadata.taskRecords : []), taskRecord],
        updatedAt: new Date().toISOString()
      });
    }
  });
}
