import { computeProjectDefinitionDigest } from "../infrastructure/package-integrity.mjs";
import { createFileTeamCatalog } from "../infrastructure/file-team-catalog.mjs";
import { createProjectUpdateUseCases } from "../application/project-update-use-cases.mjs";
import { withCollaborationProjectUseCases } from "./collaboration-project-test-helpers.mjs";
import { withTeamLifecycleUseCases } from "./team-lifecycle-test-helpers.mjs";

export function withProjectUpdateUseCases(repository, projectsRoot) {
  repository = withTeamLifecycleUseCases(withCollaborationProjectUseCases(repository));
  const teamCatalog = createFileTeamCatalog({ projectsRoot });
  return {
    ...repository,
    ...createProjectUpdateUseCases({
      projectStore: repository,
      teamCatalog,
      computeProjectDefinitionDigest
    })
  };
}
