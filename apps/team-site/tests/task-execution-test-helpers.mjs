import { createTaskExecutionUseCases } from "../application/task-execution-use-cases.mjs";
import { createFileTaskExecutionStore } from "../infrastructure/file-task-execution-store.mjs";
import { taskWorkers } from "../infrastructure/in-memory-task-workers.mjs";
import { createTaskExecutionIdentifiers } from "../infrastructure/task-execution-identifiers.mjs";
import { withProjectRunUseCases } from "./project-run-test-helpers.mjs";
import { createProjectQueryUseCases } from "../application/project-query-use-cases.mjs";
import { createProjectCreationUseCases } from "../application/project-creation-use-cases.mjs";
import { createTeamIrTaskAttemptStore } from "../infrastructure/v2-aware-task-attempt-store.mjs";
import { projectVisualizerStore } from "../infrastructure/project-visualizer-store.mjs";
import { waitForActiveTaskWorker } from "../infrastructure/in-memory-task-workers.mjs";
import { createRuntimeTeamIrProjectRunExecutor } from "../infrastructure/runtime-team-ir-project-run-executor.mjs";
import { classicSoftwareTeamClosure, classicSoftwareTeamIr, classicSoftwareTeamSnapshot, createClassicSoftwareTeamFakeBindings } from "./team-ir-test-runtime.mjs";

const projectCreationComposed = Symbol.for("ogs.team-site.test.project-creation-composed");

export function withTaskExecutionUseCases(repository, { teamIrStore } = {}) {
  const projectsRoot = repository.fileProjectStoreInternals.projectsRoot;
  const projectQueries = createProjectQueryUseCases({
    projectStore: { getProject: repository.getProject },
    taskAttemptStore: createTeamIrTaskAttemptStore({ projectsRoot }),
    waitForActiveTaskWorker,
    workspaceInspector: projectVisualizerStore.inspectWorkspace
  });
  const projectCreation = repository[projectCreationComposed] ? null : createProjectCreationUseCases({
    projectStore: {
      createProject: repository.createProject,
      saveProjectMetadata: repository.saveProjectMetadata,
      removeProjectData: repository.removeProjectData
    },
    workspaceStore: {
      createWorkspace: projectVisualizerStore.createWorkspace,
      inspectWorkspace: projectVisualizerStore.inspectWorkspace
    },
    projectQuery: { getProject: projectQueries.getProject }
  });
  repository = {
    ...repository,
    createProject: projectCreation?.createProject || repository.createProject,
    [projectCreationComposed]: true,
    getProject: projectQueries.getProject,
    getProjectTask: projectQueries.getProjectTask
  };
  repository = withProjectRunUseCases(repository);
  const attemptStore = createFileTaskExecutionStore({
    projectStore: {
      getProject: repository.getProject,
      withProjectWriteLock: repository.withProjectWriteLock,
      saveTaskRecord: repository.saveTaskRecord
    }
  });
  const runtimeTeamIrRunStore = createRuntimeTeamIrProjectRunExecutor({
    teamStore: { getTeamVersion: repository.getProject },
    teamIrStore: teamIrStore || {
      async read() {
        return { teamIR: classicSoftwareTeamIr, semanticDigest: classicSoftwareTeamSnapshot.teamIrSemanticDigest };
      }
    },
    resolveReleaseClosure: async () => classicSoftwareTeamClosure,
    resolveBindings: async () => createClassicSoftwareTeamFakeBindings(),
    clock: { now: Date.now, sleep: async () => undefined }
  });
  const teamIrRunStore = {
    async execute(project, options) {
      return runtimeTeamIrRunStore.execute(project, { ...options, mode: "sandbox" });
    }
  };
  return {
    ...repository,
    ...createTaskExecutionUseCases({
      projectStore: { getProject: repository.getProject },
      teamStore: { getTeamVersion: repository.getProject },
      attemptStore,
      workerStore: taskWorkers,
      teamIrRunStore,
      readiness: { async inspect() { return { canDryRun: true, blockers: [] }; }, async requireCurrentConfirmation() {} },
      identifiers: createTaskExecutionIdentifiers()
    })
  };
}
