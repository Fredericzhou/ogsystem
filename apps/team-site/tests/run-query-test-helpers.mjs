import { createRunQueryUseCases } from "../application/run-query-use-cases.mjs";
import { createTaskRetryUseCases } from "../application/task-retry-use-cases.mjs";
import { createFileRunQueryStore } from "../infrastructure/file-run-query-store.mjs";
import { createFileTaskRetryStore } from "../infrastructure/file-task-retry-store.mjs";
import { withTaskCreationUseCases } from "./task-creation-test-helpers.mjs";
import { withProjectUpdateUseCases } from "./project-update-test-helpers.mjs";
import { withProjectRunUseCases } from "./project-run-test-helpers.mjs";

export function withRunQueryUseCases(repository, projectsRoot) {
  repository = withProjectRunUseCases(withProjectUpdateUseCases(withTaskCreationUseCases(repository), projectsRoot));
  return {
    ...repository,
    ...createRunQueryUseCases({
      getProject: repository.getProject,
      waitForActiveTaskWorker: repository.waitForActiveTaskWorker,
      runQueryStore: createFileRunQueryStore({ projectsRoot })
    }),
    ...createTaskRetryUseCases({
      taskStore: { startTask: repository.startProjectTask },
      projectStore: { getProject: repository.getProject },
      runStore: createFileTaskRetryStore()
    })
  };
}
