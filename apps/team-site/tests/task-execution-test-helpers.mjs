import { createTaskExecutionUseCases } from "../application/task-execution-use-cases.mjs";
import { createFileTaskExecutionStore } from "../infrastructure/file-task-execution-store.mjs";
import { taskWorkers } from "../infrastructure/in-memory-task-workers.mjs";
import { createTaskExecutionIdentifiers } from "../infrastructure/task-execution-identifiers.mjs";
import { createRuntimeTaskExecutionReadiness } from "../infrastructure/runtime-task-execution-readiness.mjs";
import { withProjectRunUseCases } from "./project-run-test-helpers.mjs";
import { createProjectQueryUseCases } from "../application/project-query-use-cases.mjs";
import { createProjectCreationUseCases } from "../application/project-creation-use-cases.mjs";
import { createFileRecentRunStore } from "../infrastructure/file-recent-run-store.mjs";
import { createV2AwareTaskAttemptStore } from "./v2-task-run-test-adapters.mjs";
import { projectVisualizerStore } from "../infrastructure/project-visualizer-store.mjs";
import { caseTeamMaterializer } from "../infrastructure/case-team-materializer.mjs";
import { waitForActiveTaskWorker } from "../infrastructure/in-memory-task-workers.mjs";
import { createFilePackageStore } from "../infrastructure/file-package-store.mjs";
import { computeTeamPackageCoreDigest } from "../infrastructure/package-integrity.mjs";
import { normalizeMaterialPath } from "../domain/material-path.mjs";
import { createRuntimeTeamIrProjectRunExecutor } from "../infrastructure/runtime-team-ir-project-run-executor.mjs";
import { classicSoftwareTeamClosure, classicSoftwareTeamIr, classicSoftwareTeamSnapshot, createClassicSoftwareTeamFakeBindings } from "./team-ir-test-runtime.mjs";

const projectCreationComposed = Symbol.for("ogs.team-site.test.project-creation-composed");

export function withTaskExecutionUseCases(repository) {
  const projectsRoot = repository.fileProjectStoreInternals.projectsRoot;
  const projectQueries = createProjectQueryUseCases({
    projectStore: { getProject: repository.getProject },
    taskAttemptStore: createV2AwareTaskAttemptStore({
      projectsRoot,
      legacyStore: createFileRecentRunStore({ projectsRoot })
    }),
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
    caseMaterializer: caseTeamMaterializer,
    projectQuery: { getProject: projectQueries.getProject }
  });
  repository = {
    ...repository,
    createProject: projectCreation?.createProject || repository.createProject,
    [projectCreationComposed]: true,
    getProject: projectQueries.getProject,
    getProjectTask: projectQueries.getProjectTask,
    filePackageStore: createFilePackageStore({
      projectStore: repository.fileProjectStoreInternals,
      visualizer: projectVisualizerStore,
      packageIntegrity: { computeTeamPackageCoreDigest },
      normalizeMaterialPath
    })
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
    teamIrStore: {
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
      runStore: { execute: repository.startProjectRun },
      teamIrRunStore,
      readiness: createRuntimeTaskExecutionReadiness(),
      identifiers: createTaskExecutionIdentifiers()
    })
  };
}
