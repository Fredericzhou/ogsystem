import { serializeAuthoringToMermaid } from "../../../dist/visualizer/studio-authoring.js";
import { createTeamDesignUseCases } from "../application/team-design-use-cases.mjs";
import { createVisualizerProjectDesignStore } from "../infrastructure/visualizer-project-design-store.mjs";
import { createVisualizerProjectDesignProjector } from "../infrastructure/visualizer-project-design-projector.mjs";
import { createVisualizerProjectDesignValidator } from "../infrastructure/visualizer-project-design-validator.mjs";
import { createFileTeamLifecycleLocks } from "../infrastructure/file-team-lifecycle-locks.mjs";
import { computeReleaseBaselineDigest } from "../infrastructure/package-integrity.mjs";

export function createTeamDesignUseCasesForStore(store, projectsRoot = process.env.OGS_SITE_PROJECTS_DIR) {
  return createTeamDesignUseCases({
    teamCatalog: { getTeamVersion: store.getProject, assertTeamNameAvailable: store.assertTeamNameAvailable || (async () => undefined) },
    withTeamVersionLock: createFileTeamLifecycleLocks({ projectsRoot }).withTeamVersionLock,
    teamMetadataStore: { saveTeamMetadata: store.saveProjectMetadata },
    designStore: createVisualizerProjectDesignStore(),
    designProjector: createVisualizerProjectDesignProjector(),
    designSerializer: { serialize: serializeAuthoringToMermaid },
    designValidator: createVisualizerProjectDesignValidator(),
    packageIntegrity: { computeReleaseBaselineDigest }
  });
}
