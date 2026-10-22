import { ACTIVE_RUN_STATUSES } from "../domain/contracts.mjs";

export function createProjectRunControlUseCases({ projectStore, runControlStore, startProjectRun }) {
  if (typeof projectStore?.getProject !== "function") throw new TypeError("Project Run control requires Project reads.");
  if (typeof projectStore?.withProjectWriteLock !== "function") throw new TypeError("Project Run control requires Project write locking.");
  for (const operation of ["readState", "writeControl", "updateState", "readResumeData"]) {
    if (typeof runControlStore?.[operation] !== "function") throw new TypeError(`Project Run control requires Run ${operation}.`);
  }
  if (typeof startProjectRun !== "function") throw new TypeError("Project Run control requires the Run start use case.");

  return Object.freeze({
    async controlProjectRun(projectId, runId, control, { projectLockHeld = false } = {}) {
      if (!projectId || !runId) throw new Error("RUN_CONTROL_INVALID: projectId and runId are required.");
      if (!["pause", "resume", "cancel"].includes(control)) throw new Error("RUN_CONTROL_INVALID: unsupported control.");
      const execute = async () => {
      const project = await projectStore.getProject(projectId);
      const state = await runControlStore.readState(project, runId);
      if (control === "resume" && state.status === "running") return { projectId, runId, state, idempotent: true };
      if (control === "resume" && !ACTIVE_RUN_STATUSES.has(state.status)) {
        throw new Error(`RUN_RESUME_NOT_ALLOWED: run status is ${state.status}.`);
      }
      if (!ACTIVE_RUN_STATUSES.has(state.status)) throw new Error("RUN_CONTROL_INVALID: only an active Run can be controlled.");

      if (control === "resume") {
        const latestControl = await runControlStore.readLatestControl(project, runId);
        if (latestControl?.action === "cancel") throw new Error("RUN_RESUME_NOT_ALLOWED: cancellation has already been requested.");
        if (!["waiting_review", "paused"].includes(state.status)) {
          throw new Error(`RUN_RESUME_NOT_ALLOWED: run status is ${state.status}.`);
        }
        const { runDir, plan, task, projectTask, owner } = await runControlStore.readResumeData(project, runId);
        const persistedTask = (project.taskRecords || []).find((item) => item.taskId === projectTask?.taskId && !item.deletedAt);
        const taskRunIds = Array.isArray(persistedTask?.runIds) ? persistedTask.runIds : [];
        if (!persistedTask || persistedTask.currentRunId !== runId || !taskRunIds.includes(runId)
          || owner?.projectId !== project.projectId || owner?.taskId !== persistedTask.taskId
          || owner?.runId !== runId || owner?.teamVersionId !== persistedTask.teamVersionId
          || owner?.taskNumber !== persistedTask.taskNumber
          || (persistedTask.teamCoreDigest && owner?.teamCoreDigest !== persistedTask.teamCoreDigest)
          || owner?.attemptNumber !== taskRunIds.indexOf(runId) + 1) {
          throw new Error("RUN_RESUME_INVALID: persisted Project Task and Run owner do not match.");
        }
        return { resume: {
          prompt: task.prompt,
          mode: plan.executionPolicy.mode,
          resumeRunId: runId,
          resumeRunDir: runDir,
          runKind: "project_task",
          taskId: projectTask.taskId,
          taskNumber: projectTask.taskNumber,
          attemptNumber: owner.attemptNumber,
          teamVersionId: projectTask.teamVersionId
        } };
      }

      const controlRequest = await runControlStore.writeControl(project, runId, control);
      const updatedState = await runControlStore.updateState(project, runId, control, { projectLockHeld: true });
      return { projectId, runId, state: updatedState, controlRequest };
      };
      const result = projectLockHeld
        ? execute()
        : projectStore.withProjectWriteLock(projectId, `project-run-${control}`, execute);
      const resolved = await result;
      if (resolved?.resume) return startProjectRun(projectId, resolved.resume);
      return resolved;
    }
  });
}
