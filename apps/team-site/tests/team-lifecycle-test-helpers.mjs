import { cases, getCase } from "../cases.mjs";
import { createTeamLifecycleUseCases } from "../application/team-lifecycle-use-cases.mjs";
import { exportTeamPackage, loadTeamPackage } from "../../../dist/visualizer/project-projection.js";
import { createFileTeamLifecycleLocks } from "../infrastructure/file-team-lifecycle-locks.mjs";
import { createRuntimeTeamConfirmation } from "../infrastructure/runtime-team-confirmation.mjs";
import { withTaskExecutionUseCases } from "./task-execution-test-helpers.mjs";
import { classicSoftwareTeamSnapshot } from "./team-ir-test-runtime.mjs";

export function withTeamLifecycleUseCases(repository) {
  repository = withTaskExecutionUseCases(repository);
  const projectStore = { ...repository };
  return {
    ...repository,
    ...createTeamLifecycleUseCases({
      projectStore,
      packageStore: { exportTeamPackage, loadTeamPackage },
      locks: createFileTeamLifecycleLocks(),
      confirmation: createRuntimeTeamConfirmation(),
      releaseEvidence: {
        async validateTeamIrReleaseEvidence() { return { ok: true }; },
        async prepareBuiltInTeamVersion() {}
      },
      teamIrRelease: {
        async getTeamIrReleaseSnapshot(teamVersionId) {
          return { teamVersionId, ...classicSoftwareTeamSnapshot };
        },
        async copyTeamIr() { return { copied: true }; }
      },
      caseCatalog: { getCase, listCases: () => cases },
      assertTrustedTeamTopology: (team) => ["classic", "classic-template"].includes(team.source) && Boolean(team.caseId)
    })
  };
}
