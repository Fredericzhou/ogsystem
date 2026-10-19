import { createProjectMaterialUseCases } from "../application/project-material-use-cases.mjs";
import { createFileProjectMaterialStore } from "../infrastructure/file-project-material-store.mjs";
import { computeProjectDefinitionDigest } from "../infrastructure/package-integrity.mjs";
import { createRuntimeTaskExecutionReadiness } from "../infrastructure/runtime-task-execution-readiness.mjs";

export function withProjectMaterialUseCases(repository) {
  return {
    ...repository,
    ...createProjectMaterialUseCases({
      projectStore: repository,
      materialStore: createFileProjectMaterialStore({ computeProjectDefinitionDigest }),
      confirmation: { assertCurrent: createRuntimeTaskExecutionReadiness().requireCurrentConfirmation }
    })
  };
}
