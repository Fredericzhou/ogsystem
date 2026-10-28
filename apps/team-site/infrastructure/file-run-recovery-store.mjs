import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { FileTeamRunStore } from "../../../dist/team-ir/index.js";
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

  async function readTeamIrV2Record(projectId, runId) {
    const stateDirectory = join(runDirectory(projectId, runId), "team-ir-v2-state");
    try {
      await assertSafeEvidencePath(root, [projectId, ".ogs", "runs", runId, "team-ir-v2-state", `${runId}.json`], {
        kind: "file", label: "Team IR v2 Run state"
      });
      return await new FileTeamRunStore(stateDirectory).load(runId);
    } catch (error) {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    }
  }

  function projectTaskState(record, owner) {
    const status = record.status === "waiting_human_review" ? "waiting_review"
      : record.status === "paused_input_required" ? "paused"
      : record.status === "queued" ? "planning"
      : record.status;
    return {
      version: 1,
      runId: record.runId,
      attemptNumber: owner.attemptNumber,
      status,
      startedAt: record.status === "queued" ? undefined : new Date(record.createdAt).toISOString(),
      updatedAt: new Date(record.updatedAt).toISOString(),
      finishedAt: ["completed", "failed", "cancelled"].includes(record.status) ? new Date(record.updatedAt).toISOString() : undefined,
      error: record.events.findLast((event) => event.type === "run.failing")?.data?.code,
      result: record.result,
      resultWritten: record.resultWritten,
      taskReservation: {
        kind: "task-attempt",
        projectId: owner.projectId,
        taskId: owner.taskId,
        teamVersionId: owner.teamVersionId,
        runId: record.runId
      },
      teamIrV2: true
    };
  }

  async function updateTeamIrV2State(projectId, runId, update) {
    const stateDirectory = join(runDirectory(projectId, runId), "team-ir-v2-state");
    const store = new FileTeamRunStore(stateDirectory);
    const owner = await readRunOwner(projectId, runId);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const record = await store.load(runId);
      if (!record) return undefined;
      const projected = projectTaskState(record, owner);
      const next = update(projected);
      if (next === projected || next.status === projected.status) return projected;
      if (next.status !== "failed") throw new Error("RUN_RECOVERY_TRANSITION_INVALID: Team IR v2 recovery only supports fail-closed interruption.");
      const timestamp = Date.parse(next.updatedAt) || Date.now();
      const updated = structuredClone(record);
      updated.revision += 1;
      updated.status = "failed";
      updated.terminalIntent = "failed";
      updated.updatedAt = timestamp;
      updated.result = undefined;
      updated.resultWritten = false;
      delete updated.pendingResult;
      updated.error = next.error;
      for (const invocation of Object.values(updated.invocations || {})) {
        if (invocation.status !== "running") continue;
        invocation.status = "failed";
        invocation.error = "BINDING_OUTCOME_UNKNOWN_AFTER_RESTART";
        invocation.outcomeUnknown = true;
        updated.events.push({
          id: `${invocation.id}:restart-outcome-unknown`, type: "binding.outcome_unknown", at: timestamp,
          data: { reason: "scheduler_recovery_found_active_invocation" }
        });
      }
      if (!updated.events.some((event) => event.id === `${runId}:failure-intent`)) {
        updated.events.push({ id: `${runId}:failure-intent`, type: "run.failing", at: timestamp, data: { code: next.error } });
      }
      if (!updated.events.some((event) => event.id === `${runId}:settled:failed`)) {
        updated.events.push({ id: `${runId}:settled:failed`, type: "run.failed", at: timestamp });
      }
      if (await store.compareAndSet(runId, record.revision, updated)) return projectTaskState(updated, owner);
    }
    throw new Error("RUN_RECOVERY_BUSY: Team IR v2 Run changed during interruption recovery.");
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
      const runIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      const v2RunIds = [];
      for (const runId of runIds) {
        if (await readTeamIrV2Record(projectId, runId)) v2RunIds.push(runId);
      }
      return v2RunIds;
    },
    async readRunState(projectId, runId) {
      await assertProjectDirectory(projectId);
      const teamIrRun = await readTeamIrV2Record(projectId, runId);
      if (teamIrRun) return projectTaskState(teamIrRun, await readRunOwner(projectId, runId));
      return undefined;
    },
    async readRunOwner(projectId, runId) {
      await assertProjectDirectory(projectId);
      const project = { projectId, workdir: resolve(root, projectId) };
      return readProjectRunOwnerFile(project, runId);
    },
    async updateRunState(projectId, runId, update) {
      await assertProjectDirectory(projectId);
      await assertProjectWriteLockPath(projectId);
      if (await readTeamIrV2Record(projectId, runId)) return updateTeamIrV2State(projectId, runId, update);
      throw new Error("TEAM_IR_V2_REQUIRED: Project Task recovery requires a Team IR v2 checkpoint.");
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
