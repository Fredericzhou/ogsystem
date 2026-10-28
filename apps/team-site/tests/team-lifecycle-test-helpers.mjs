import { cases, getCase } from "../cases.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTeamLifecycleUseCases } from "../application/team-lifecycle-use-cases.mjs";
import { createTeamIrUseCases } from "../application/team-ir-use-cases.mjs";
import { createFileTeamLifecycleLocks } from "../infrastructure/file-team-lifecycle-locks.mjs";
import { createRuntimeTeamConfirmation } from "../infrastructure/runtime-team-confirmation.mjs";
import { createFileTeamIrStore } from "../infrastructure/file-team-ir-store.mjs";
import { withTaskExecutionUseCases } from "./task-execution-test-helpers.mjs";
import { compileTeamIr, teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
import { classicSoftwareTeamIr } from "./team-ir-test-runtime.mjs";

const testDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const teamIrFixtures = Object.fromEntries(cases.map(({ id }) => [
  id,
  JSON.parse(readFileSync(resolve(testDirectory, "../../../examples/team-ir-v2", `classic-${id}.json`), "utf8"))
]));

export function withTeamLifecycleUseCases(repository) {
  const locks = createFileTeamLifecycleLocks();
  const teamIrStore = createFileTeamIrStore();
  const projectStore = {
    ...repository,
    createNativeTeamIrProject: repository.fileProjectStoreInternals.createProject
  };
  repository = withTaskExecutionUseCases(repository, { teamIrStore });
  const teamIrUseCases = createTeamIrUseCases({
    teamCatalog: { getTeamVersion: repository.getProject },
    teamIrStore,
    withTeamVersionLock: locks.withTeamVersionLock
  });
  const createProject = repository.createProject;
  return {
    ...repository,
    async createProject(input) {
      const project = await createProject(input);
      if (["collaboration-project", "workspace"].includes(input.source)) return project;
      const teamIR = structuredClone(classicSoftwareTeamIr);
      teamIR.team.id = project.teamVersionId || project.projectId;
      await teamIrStore.save({ workdir: project.workdir, teamIR });
      return project;
    },
    ...createTeamLifecycleUseCases({
      projectStore,
      locks,
      confirmation: createRuntimeTeamConfirmation({ teamIrStore }),
      releaseEvidence: {
        async validateTeamIrReleaseEvidence() { return { ok: true }; },
        async prepareBuiltInTeamVersion() {}
      },
      teamIrRelease: {
        ...teamIrUseCases,
        async getTeamIrReleaseSnapshot(teamVersionId) {
          const team = await repository.fileProjectStoreInternals.getProject(teamVersionId);
          const { teamIR } = await teamIrStore.read({ workdir: team.workdir });
          const closure = {
            complete: true,
            packageDigests: Object.fromEntries(teamIR.agents.map((agent) => [agent.packageRef, "a".repeat(64)])),
            bindingDigests: Object.fromEntries(teamIR.bindings.map((binding) => [binding.id, "b".repeat(64)])),
            adapterVersions: { model: "team-site-test-fake/1" },
            schemaDigests: {}
          };
          const plan = compileTeamIr(teamIR, closure);
          return {
            teamVersionId,
            teamIrSemanticDigest: teamIRSemanticDigest(teamIR),
            compiledPlanDigest: plan.compiledPlanDigest,
            compilerSemanticsVersion: plan.compilerSemanticsVersion
          };
        },
        async copyTeamIr(sourceTeamVersionId, destinationWorkdir) {
          return teamIrUseCases.copyTeamIr(sourceTeamVersionId, destinationWorkdir);
        }
      },
      teamIrFixtures,
      caseCatalog: { getCase, listCases: () => cases },
      assertTrustedTeamTopology: (team) => ["classic", "classic-template"].includes(team.source) && Boolean(team.caseId)
    })
  };
}
