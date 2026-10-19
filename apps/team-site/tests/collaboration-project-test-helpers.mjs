import { createCollaborationProjectUseCases } from "../application/collaboration-project-use-cases.mjs";
import { createFileCollaborationProjectStore } from "../infrastructure/file-collaboration-project-store.mjs";
import { computeProjectDefinitionDigest } from "../infrastructure/package-integrity.mjs";
import { withTeamLifecycleUseCases } from "./team-lifecycle-test-helpers.mjs";
import { createFileTeamLifecycleLocks } from "../infrastructure/file-team-lifecycle-locks.mjs";

export function withCollaborationProjectUseCases(repository) {
  repository = withTeamLifecycleUseCases(repository);
  const locks = createFileTeamLifecycleLocks();
  return {
    ...repository,
    ...createCollaborationProjectUseCases({
      projectStore: createFileCollaborationProjectStore({
        getProject: repository.getProject,
        withProjectWriteLock: repository.withProjectWriteLock,
        saveProjectMetadata: repository.saveProjectMetadata,
        listProjects: repository.listProjects,
        createProject: repository.createProject,
        initializeCollaborationProject: repository.initializeCollaborationProject,
        removeProject: repository.removeProject,
        withCollaborationProjectNameLock: locks.withCollaborationProjectNameLock
      }),
      teamStore: { getTeamVersion: repository.getProject },
      computeProjectDefinitionDigest
    })
  };
}
