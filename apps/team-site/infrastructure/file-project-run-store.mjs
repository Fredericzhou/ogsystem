import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { acquireActiveRunLock, acquireProjectWriteLock } from "../../../dist/runtime/project-run-lock.js";
import { rebuildRunsIndex } from "../../../dist/runtime/project-lifecycle.js";
import { writeProjectRunControl } from "../../../dist/runtime/project-run-control.js";
import { assertSafeEvidencePath, readSafeEvidenceFile } from "./safe-evidence-path.mjs";
import { readProjectRunOwner } from "./project-run-evidence-paths.mjs";

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

async function validateOwnedRun(project, runId, { allowMissing = false } = {}) {
  const task = (project.taskRecords || []).find((item) => !item.deletedAt
    && Array.isArray(item.runIds) && item.runIds.includes(runId));
  if (!task) throw new Error("RUN_NOT_FOUND: run does not belong to a Project Task.");
  const root = resolve(project.workdir);
  const runDir = await assertSafeEvidencePath(root, [".ogs", "runs", runId], {
    kind: "directory", allowMissingFinal: allowMissing, label: "Run evidence"
  });
  try {
    await readProjectRunOwner(project, task, runId);
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return { runDir, task, missing: true };
    throw error;
  }
  return { runDir, task, missing: false };
}

async function assertProjectSiteFile(project, filename, { allowMissing = false } = {}) {
  const root = resolve(project.workdir);
  await assertSafeEvidencePath(root, [".site"], { kind: "directory", label: "Project metadata" });
  return assertSafeEvidencePath(root, [".site", filename], {
    kind: "file", allowMissingFinal: allowMissing, label: "Project metadata"
  });
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
      const owned = await validateOwnedRun(project, resumeRunId);
      const root = resolve(project.workdir);
      await assertSafeEvidencePath(root, [".ogs", "runs", resumeRunId, "task.json"], { kind: "file", label: "Run task snapshot" });
      await assertSafeEvidencePath(root, [".ogs", "runs", resumeRunId, "run-plan.json"], { kind: "file", label: "Run plan" });
      const task = JSON.parse(await readSafeEvidenceFile(root, [".ogs", "runs", resumeRunId, "task.json"], "utf8", "Run task snapshot"));
      const plan = JSON.parse(await readSafeEvidenceFile(root, [".ogs", "runs", resumeRunId, "run-plan.json"], "utf8", "Run plan"));
      if (plan?.projectId && plan.projectId !== project.projectId) {
        throw new Error("RUN_SNAPSHOT_INVALID: run snapshot belongs to another project.");
      }
      return { runId: resumeRunId, runDir, task, plan };
    },

    async readLedger(project) {
      await assertProjectSiteFile(project, "run-requests.json", { allowMissing: true });
      return readJson(join(project.workdir, ".site", "run-requests.json"), {});
    },

    async writeLedger(project, ledger) {
      await assertProjectSiteFile(project, "run-requests.json", { allowMissing: true });
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
      runDirectory(project, runId);
      const owned = await validateOwnedRun(project, runId, { allowMissing });
      if (owned.missing) return { plan: undefined, state: undefined };
      const runDir = owned.runDir;
      const root = resolve(project.workdir);
      await assertSafeEvidencePath(root, [".ogs", "runs", runId, "run-plan.json"], { kind: "file", label: "Run plan" });
      await assertSafeEvidencePath(root, [".ogs", "runs", runId, "control"], { kind: "directory", label: "Run control" });
      await assertSafeEvidencePath(root, [".ogs", "runs", runId, "control", "state.json"], { kind: "file", label: "Run state" });
      const readSnapshotFile = async (segments, label) => {
        try {
          return JSON.parse(await readSafeEvidenceFile(root, segments, "utf8", label));
        } catch (error) {
          if (allowMissing && error?.code === "ENOENT") return undefined;
          throw error;
        }
      };
      const [plan, state] = await Promise.all([
        readSnapshotFile([".ogs", "runs", runId, "run-plan.json"], "Run plan"),
        readSnapshotFile([".ogs", "runs", runId, "control", "state.json"], "Run state")
      ]);
      return { plan, state };
    },

    async recordTask(project, taskRecord) {
      await assertProjectSiteFile(project, "project.json");
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
