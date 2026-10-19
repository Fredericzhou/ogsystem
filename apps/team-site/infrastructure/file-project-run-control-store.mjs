import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { loadProjectRunPlan } from "../../../dist/runtime/project-run.js";
import { applyRunControl, loadProjectRunState, updateProjectRunState } from "../../../dist/runtime/project-run-state.js";
import { readLatestProjectRunControl, writeProjectRunControl } from "../../../dist/runtime/project-run-control.js";

function runDirectory(project, runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(runId || ""))) throw new Error("runId is invalid.");
  const runsDirectory = resolve(project.workdir, ".ogs", "runs");
  const runDir = resolve(runsDirectory, runId);
  if (!runDir.startsWith(`${runsDirectory}${sep}`)) throw new Error("RUN_CONTROL_INVALID: Run is outside the Project workspace.");
  return runDir;
}

async function readJson(path, fallback = {}) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

export function createFileProjectRunControlStore() {
  return Object.freeze({
    readState(project, runId) {
      return loadProjectRunState(runDirectory(project, runId));
    },
    writeControl(project, runId, control) {
      return writeProjectRunControl(runDirectory(project, runId), control);
    },
    updateState(project, runId, update) {
      const runDir = runDirectory(project, runId);
      return updateProjectRunState(runDir, (state) => {
        const next = applyRunControl(state, update);
        if (update === "cancel" && ["waiting_review", "paused"].includes(state.status)) {
          next.status = "cancelled";
          next.finishedAt = new Date().toISOString();
        }
        return next;
      });
    },
    async readLatestControl(project, runId) {
      return readLatestProjectRunControl(runDirectory(project, runId));
    },
    async readResumeData(project, runId) {
      const runDir = runDirectory(project, runId);
      const [plan, task] = await Promise.all([
        loadProjectRunPlan(runDir),
        readJson(join(runDir, "task.json"))
      ]);
      if (!plan?.executionPolicy?.mode) throw new Error("RUN_RESUME_INVALID: Run plan is missing its execution mode.");
      return { runDir, plan, task };
    }
  });
}
