import { withTeamLifecycleUseCases } from "./team-lifecycle-test-helpers.mjs";

export async function seedReleasedClassicTeam(projectsRoot, caseId = "software-team") {
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  try {
    const repository = await import(`../infrastructure/file-project-store.mjs?classic-fixture=${Date.now()}-${Math.random()}`);
    return await withTeamLifecycleUseCases(repository).createClassicTeamProject({ caseId });
  } finally {
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
  }
}
