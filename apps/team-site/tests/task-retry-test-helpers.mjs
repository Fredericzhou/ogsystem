import { createTaskRetryUseCases } from "../application/task-retry-use-cases.mjs";
import { createV2AwareTaskRetryStore } from "./v2-task-run-test-adapters.mjs";

export function createTaskRetryOperation(store) {
  const retry = createTaskRetryUseCases({
    taskStore: { getTask: store.getProjectTask, startTask: store.startProjectTask },
    projectStore: { getProject: store.getProject },
    runStore: createV2AwareTaskRetryStore({ projectsRoot: store.fileProjectStoreInternals.projectsRoot })
  });
  return retry.retryProjectTask;
}
