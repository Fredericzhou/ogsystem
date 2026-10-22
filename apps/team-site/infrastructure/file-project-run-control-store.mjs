import { join, resolve, sep } from "node:path";
import { applyRunControl, updateProjectRunState, updateProjectRunStateWithHeldLock } from "../../../dist/runtime/project-run-state.js";
import { readLatestProjectRunControl, writeProjectRunControl } from "../../../dist/runtime/project-run-control.js";
import { readProjectRunOwner } from "./project-run-evidence-paths.mjs";
import { assertSafeEvidencePath, readSafeEvidenceFile } from "./safe-evidence-path.mjs";

function runDirectory(project, runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(runId || ""))) throw new Error("runId is invalid.");
  const runsDirectory = resolve(project.workdir, ".ogs", "runs");
  const runDir = resolve(runsDirectory, runId);
  if (!runDir.startsWith(`${runsDirectory}${sep}`)) throw new Error("RUN_CONTROL_INVALID: Run is outside the Project workspace.");
  return runDir;
}

async function resolveOwnedRun(project, runId) {
  if (project?.projectType !== "collaboration") {
    throw new Error("RUN_NOT_FOUND: Task Runs are owned by Collaboration Projects.");
  }
  const task = (project.taskRecords || []).find((item) =>
    !item.deletedAt && item.currentRunId === runId
  );
  if (!task) throw new Error("RUN_NOT_FOUND: run does not belong to a current Project Task.");
  const owner = await readProjectRunOwner(project, task, runId);
  const runDir = runDirectory(project, runId);
  await assertSafeEvidencePath(project.workdir, [".ogs", "runs", runId, "control"], {
    kind: "directory", label: "Run control"
  });
  await assertSafeEvidencePath(project.workdir, [".ogs", "runs", runId, "control", "state.json"], {
    kind: "file", label: "Run state"
  });
  return { task, owner, runDir };
}

export function createFileProjectRunControlStore() {
  return Object.freeze({
    async readState(project, runId) {
      const { runDir } = await resolveOwnedRun(project, runId);
      return JSON.parse(await readSafeEvidenceFile(project.workdir, [".ogs", "runs", runId, "control", "state.json"], "utf8", "Run state"));
    },
    async writeControl(project, runId, control) {
      const { runDir } = await resolveOwnedRun(project, runId);
      await assertSafeEvidencePath(project.workdir, [".ogs", "runs", runId, "control", "requests"], {
        kind: "directory", allowMissingFinal: true, label: "Run control requests"
      });
      return writeProjectRunControl(runDir, control);
    },
    async updateState(project, runId, update, { projectLockHeld = false } = {}) {
      const { runDir } = await resolveOwnedRun(project, runId);
      const updateState = projectLockHeld ? updateProjectRunStateWithHeldLock : updateProjectRunState;
      return updateState(runDir, (state) => {
        const next = applyRunControl(state, update);
        if (update === "cancel" && ["waiting_review", "paused"].includes(state.status)) {
          next.status = "cancelled";
          next.finishedAt = new Date().toISOString();
        }
        return next;
      });
    },
    async readLatestControl(project, runId) {
      const { runDir } = await resolveOwnedRun(project, runId);
      await assertSafeEvidencePath(project.workdir, [".ogs", "runs", runId, "control", "requests"], {
        kind: "directory", allowMissingFinal: true, label: "Run control requests"
      });
      return readLatestProjectRunControl(runDir);
    },
    async readResumeData(project, runId) {
      const { runDir, task: projectTask, owner } = await resolveOwnedRun(project, runId);
      await assertSafeEvidencePath(project.workdir, [".ogs", "runs", runId, "run-plan.json"], {
        kind: "file", label: "Run plan"
      });
      await assertSafeEvidencePath(project.workdir, [".ogs", "runs", runId, "task.json"], {
        kind: "file", label: "Run task snapshot"
      });
      const [plan, task] = await Promise.all([
        readSafeEvidenceFile(project.workdir, [".ogs", "runs", runId, "run-plan.json"], "utf8", "Run plan").then(JSON.parse),
        readSafeEvidenceFile(project.workdir, [".ogs", "runs", runId, "task.json"], "utf8", "Run task snapshot").then(JSON.parse)
      ]);
      if (!plan?.executionPolicy?.mode) throw new Error("RUN_RESUME_INVALID: Run plan is missing its execution mode.");
      if (!task?.prompt || !projectTask.teamVersionId || owner.taskId !== projectTask.taskId) {
        throw new Error("RUN_RESUME_INVALID: Run snapshot is missing its persisted Project Task owner.");
      }
      return { runDir, plan, task, projectTask, owner };
    }
  });
}
