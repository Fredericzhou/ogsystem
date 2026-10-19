import { createTaskRetryUseCases } from "../application/task-retry-use-cases.mjs";
import { createFileTaskRetryStore } from "../infrastructure/file-task-retry-store.mjs";

export function createTaskRetryOperation(store) {
  const retry = createTaskRetryUseCases({
    taskStore: { getTask: store.getProjectTask, startTask: store.startProjectTask },
    projectStore: { getProject: store.getProject },
    runStore: createFileTaskRetryStore()
  });
  return retry.retryProjectTask;
}
