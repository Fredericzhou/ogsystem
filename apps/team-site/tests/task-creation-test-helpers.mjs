import { createTaskCreationUseCases } from "../application/task-creation-use-cases.mjs";
import { computeContentDigest } from "../infrastructure/package-integrity.mjs";
import { createTaskIdentifiers } from "../infrastructure/task-identifiers.mjs";
import { withCollaborationProjectUseCases } from "./collaboration-project-test-helpers.mjs";
import { createTaskLifecycleUseCases } from "../application/task-lifecycle-use-cases.mjs";
import { createFileTaskLifecycleStore } from "../infrastructure/file-task-lifecycle-store.mjs";
import { withProjectRunUseCases } from "./project-run-test-helpers.mjs";
import { createProjectQueryUseCases } from "../application/project-query-use-cases.mjs";
import { createFileRecentRunStore } from "../infrastructure/file-recent-run-store.mjs";
import { projectsRoot } from "../infrastructure/file-project-store.mjs";
import { waitForActiveTaskWorker } from "../infrastructure/in-memory-task-workers.mjs";
import { projectVisualizerStore } from "../infrastructure/project-visualizer-store.mjs";

export function withTaskCreationUseCases(store) {
  store = withProjectRunUseCases(withCollaborationProjectUseCases(store));
  const composed = {
    ...store,
    ...createTaskLifecycleUseCases({
      projectStore: createFileTaskLifecycleStore({
        getProject: store.getProject,
        withProjectWriteLock: store.withProjectWriteLock,
        saveTaskRecord: store.saveTaskRecord,
        controlRun: store.controlProjectRun
      }),
      runControlStore: { controlRun: store.controlProjectRun },
      reviewStore: { listReviews: async () => ({ reviews: [] }), decideReview: async () => undefined }
    }),
    ...createTaskCreationUseCases({
      projectStore: store,
      taskStore: createTaskIdentifiers(),
      fingerprintRequest: computeContentDigest
    })
  };
  const projectQueries = createProjectQueryUseCases({
    projectStore: { getProject: store.getProject },
    taskAttemptStore: createFileRecentRunStore({ projectsRoot }),
    waitForActiveTaskWorker,
    workspaceInspector: projectVisualizerStore.inspectWorkspace
  });
  return {
    ...composed,
    getProject: projectQueries.getProject,
    getProjectTask: projectQueries.getProjectTask,
    waitForActiveTaskWorker
  };
}
