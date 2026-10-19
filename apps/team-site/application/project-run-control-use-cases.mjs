import { ACTIVE_RUN_STATUSES } from "../domain/contracts.mjs";

export function createProjectRunControlUseCases({ projectStore, runControlStore, startProjectRun }) {
  if (typeof projectStore?.getProject !== "function") throw new TypeError("Project Run control requires Project reads.");
  for (const operation of ["readState", "writeControl", "updateState", "readResumeData"]) {
    if (typeof runControlStore?.[operation] !== "function") throw new TypeError(`Project Run control requires Run ${operation}.`);
  }
  if (typeof startProjectRun !== "function") throw new TypeError("Project Run control requires the Run start use case.");

  return Object.freeze({
    async controlProjectRun(projectId, runId, control) {
      if (!projectId || !runId) throw new Error("RUN_CONTROL_INVALID: projectId and runId are required.");
      if (!["pause", "resume", "cancel"].includes(control)) throw new Error("RUN_CONTROL_INVALID: unsupported control.");
      const project = await projectStore.getProject(projectId);
      const state = await runControlStore.readState(project, runId);
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
        const { runDir, plan, task } = await runControlStore.readResumeData(project, runId);
        return startProjectRun(projectId, {
          prompt: task.prompt,
          mode: plan.executionPolicy.mode,
          resumeRunId: runId,
          resumeRunDir: runDir
        });
      }

      const controlRequest = await runControlStore.writeControl(project, runId, control);
      const updatedState = await runControlStore.updateState(project, runId, control);
      return { projectId, runId, state: updatedState, controlRequest };
    }
  });
}
