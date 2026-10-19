import { createTaskExecutionUseCases } from "../application/task-execution-use-cases.mjs";
import { createFileTaskExecutionStore } from "../infrastructure/file-task-execution-store.mjs";
import { taskWorkers } from "../infrastructure/in-memory-task-workers.mjs";
import { createTaskExecutionIdentifiers } from "../infrastructure/task-execution-identifiers.mjs";
import { createRuntimeTaskExecutionReadiness } from "../infrastructure/runtime-task-execution-readiness.mjs";
import { withProjectRunUseCases } from "./project-run-test-helpers.mjs";
import { createProjectQueryUseCases } from "../application/project-query-use-cases.mjs";
import { createProjectCreationUseCases } from "../application/project-creation-use-cases.mjs";
import { createFileRecentRunStore } from "../infrastructure/file-recent-run-store.mjs";
import { projectVisualizerStore } from "../infrastructure/project-visualizer-store.mjs";
import { caseTeamMaterializer } from "../infrastructure/case-team-materializer.mjs";
import { waitForActiveTaskWorker } from "../infrastructure/in-memory-task-workers.mjs";
import { createFilePackageStore } from "../infrastructure/file-package-store.mjs";

const projectCreationComposed = Symbol.for("ogs.team-site.test.project-creation-composed");

export function withTaskExecutionUseCases(repository) {
  const projectQueries = createProjectQueryUseCases({
    projectStore: { getProject: repository.getProject },
    taskAttemptStore: createFileRecentRunStore({ projectsRoot: repository.fileProjectStoreInternals.projectsRoot }),
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
    filePackageStore: createFilePackageStore(repository.fileProjectStoreInternals)
  };
  repository = withProjectRunUseCases(repository);
  return {
    ...repository,
    ...createTaskExecutionUseCases({
      projectStore: { getProject: repository.getProject },
      teamStore: { getTeamVersion: repository.getProject },
      attemptStore: createFileTaskExecutionStore({
        projectStore: {
          getProject: repository.getProject,
          withProjectWriteLock: repository.withProjectWriteLock,
          saveTaskRecord: repository.saveTaskRecord
        }
      }),
      workerStore: taskWorkers,
      runStore: { execute: repository.startProjectRun },
      readiness: createRuntimeTaskExecutionReadiness(),
      identifiers: createTaskExecutionIdentifiers()
    })
  };
}
