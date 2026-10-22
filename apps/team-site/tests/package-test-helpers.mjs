import { createTeamPackagePreviewUseCases } from "../application/team-package-preview-use-cases.mjs";
import { createProjectPackageUseCases } from "../application/project-package-use-cases.mjs";
import { createTeamPackageValidationUseCases } from "../application/team-package-validation-use-cases.mjs";
import { normalizeMaterialPath } from "../domain/material-path.mjs";
import {
  computeContentDigest,
  computePackageDigest,
  computeProjectDefinitionDigest,
  computeTeamPackageCoreDigest
} from "../infrastructure/package-integrity.mjs";
import { projectVisualizerStore } from "../infrastructure/project-visualizer-store.mjs";
import { createFilePackageStore } from "../infrastructure/file-package-store.mjs";

function packageStoreFor(repository) {
  return repository.filePackageStore || createFilePackageStore({
    projectStore: repository.fileProjectStoreInternals,
    visualizer: projectVisualizerStore,
    packageIntegrity: { computeTeamPackageCoreDigest },
    normalizeMaterialPath
  });
}

const { validateTeamPackage } = createTeamPackageValidationUseCases({
  packageIntegrity: { computePackageDigest, computeTeamPackageCoreDigest }
});

export function createTeamPackageOperations(repository) {
  const packageStore = packageStoreFor(repository);
  const useCases = createTeamPackagePreviewUseCases({
    validateTeamPackage,
    teamCatalog: { listTeamRepository: repository.listTeamRepository },
    packageStore
  });
  return {
    previewTeamPackage: useCases.previewTeamPackage,
    importTeamPackage: useCases.importTeamPackage,
    exportTeamPackage: useCases.exportTeamPackage
  };
}

export function createProjectPackageOperations(repository) {
  const packageStore = packageStoreFor(repository);
  const useCases = createProjectPackageUseCases({
    validateTeamPackage,
    packageIntegrity: { computeContentDigest, computePackageDigest, computeProjectDefinitionDigest },
    normalizeMaterialPath,
    projectCatalog: { listProjects: repository.listProjects },
    packageStore
  });
  return {
    previewProjectBundle: useCases.previewProjectBundle,
    importProjectBundle: useCases.importProjectBundle,
    exportProjectBundle: useCases.exportProjectBundle
  };
}
