import { createFilePackageTransactionStore } from "./file-package-transaction-store.mjs";
import { projectVisualizerStore } from "./project-visualizer-store.mjs";
import { computeTeamPackageCoreDigest } from "./package-integrity.mjs";
import { normalizeMaterialPath } from "../domain/material-path.mjs";
import { fileProjectStoreInternals as projectStore } from "./file-project-store.mjs";

async function computeTeamCoreDigest(workdir) {
  const bundle = await projectVisualizerStore.exportTeamPackage(workdir);
  return computeTeamPackageCoreDigest(bundle);
}

export function createFilePackageStore(projectStorePorts = projectStore) {
  return createFilePackageTransactionStore({
    ...projectStorePorts,
    computeTeamCoreDigest,
    exportTeamPackage: projectVisualizerStore.exportTeamPackage,
    loadTeamPackage: projectVisualizerStore.loadTeamPackage,
    createWorkspace: projectVisualizerStore.createWorkspace,
    normalizeMaterialPath
  });
}
