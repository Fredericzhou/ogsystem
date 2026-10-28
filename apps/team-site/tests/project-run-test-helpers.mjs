import { join } from "node:path";
import { FileTeamRunStore, TeamRuntime } from "../../../dist/team-ir/index.js";

export function withProjectRunUseCases(repository) {
  return {
    ...repository,
    async startProjectRun() {
      throw new Error("TEAM_IR_V2_REQUIRED: Project Runs must be started through a Collaboration Task.");
    },
    async controlProjectRun(projectId, runId, action) {
      if (action !== "cancel") {
        throw new Error("TEAM_IR_V2_CONTROL_UNSUPPORTED: only cancellation is available in the Team IR v2 test adapter.");
      }
      const project = await repository.getProject(projectId);
      if (!project || project.projectType !== "collaboration") throw new Error("RUN_NOT_FOUND: Task Run owner is unavailable.");
      const store = new FileTeamRunStore(join(project.workdir, ".ogs", "runs", runId, "team-ir-v2-state"));
      const runtime = new TeamRuntime({ store, clock: { now: Date.now, sleep: async () => undefined }, bindings: {} });
      const state = await runtime.cancel(runId);
      return { state };
    }
  };
}
