import { evaluateProjectRunResult } from "../../../dist/runtime/project-quality.js";
import { createProjectRunUseCases } from "../application/project-run-use-cases.mjs";
import { createProjectRunControlUseCases } from "../application/project-run-control-use-cases.mjs";
import { createFileProjectRunStore } from "../infrastructure/file-project-run-store.mjs";
import { createFileProjectRunControlStore } from "../infrastructure/file-project-run-control-store.mjs";
import { createRuntimeProjectRunExecutor } from "../infrastructure/runtime-project-run-executor.mjs";
import { createRuntimeTaskExecutionReadiness } from "../infrastructure/runtime-task-execution-readiness.mjs";
import { createTaskExecutionIdentifiers } from "../infrastructure/task-execution-identifiers.mjs";

export function withProjectRunUseCases(repository) {
  const readiness = createRuntimeTaskExecutionReadiness();
  const projectRunUseCases = createProjectRunUseCases({
    projectStore: { getProject: repository.getProject },
    teamStore: { getTeamVersion: repository.getProject },
    runStore: { ...createFileProjectRunStore(), ...createRuntimeProjectRunExecutor() },
    readiness,
    identifiers: createTaskExecutionIdentifiers(),
    evaluateResult: evaluateProjectRunResult
  });
  const projectRunControlUseCases = createProjectRunControlUseCases({
    projectStore: { getProject: repository.getProject, withProjectWriteLock: repository.withProjectWriteLock },
    runControlStore: createFileProjectRunControlStore(),
    startProjectRun: projectRunUseCases.startProjectRun
  });
  return {
    ...repository,
    ...projectRunUseCases,
    ...projectRunControlUseCases
  };
}
