import { withTeamLifecycleUseCases } from "./team-lifecycle-test-helpers.mjs";

export async function seedReleasedClassicTeam(projectsRoot, caseId = "software-team") {
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  const previousBackend = process.env.OGS_DEMO_BACKEND;
  const previousModel = process.env.OGS_DEMO_MODEL;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  process.env.OGS_DEMO_BACKEND = "codex";
  process.env.OGS_DEMO_MODEL = "gpt-6-luna";
  try {
    const repository = await import(`../infrastructure/file-project-store.mjs?classic-fixture=${Date.now()}-${Math.random()}`);
    return await withTeamLifecycleUseCases(repository).createClassicTeamProject({ caseId });
  } finally {
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
    if (previousBackend === undefined) delete process.env.OGS_DEMO_BACKEND;
    else process.env.OGS_DEMO_BACKEND = previousBackend;
    if (previousModel === undefined) delete process.env.OGS_DEMO_MODEL;
    else process.env.OGS_DEMO_MODEL = previousModel;
  }
}
