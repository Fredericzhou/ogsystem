import { createFilePackageTransactionStore } from "./file-package-transaction-store.mjs";

export function createFilePackageStore({ projectStore, visualizer, packageIntegrity, normalizeMaterialPath } = {}) {
  const dependencies = { projectStore, visualizer, packageIntegrity, normalizeMaterialPath };
  for (const [name, implementation] of Object.entries(dependencies)) {
    if (!implementation) throw new TypeError(`File package store requires ${name}.`);
  }
  if (typeof visualizer.exportTeamPackage !== "function"
    || typeof visualizer.loadTeamPackage !== "function"
    || typeof visualizer.createWorkspace !== "function") {
    throw new TypeError("File package store requires Team Package and workspace operations.");
  }
  if (typeof packageIntegrity.computeTeamPackageCoreDigest !== "function") {
    throw new TypeError("File package store requires package integrity operations.");
  }

  const computeTeamCoreDigest = async (workdir) =>
    packageIntegrity.computeTeamPackageCoreDigest(await visualizer.exportTeamPackage(workdir));

  return createFilePackageTransactionStore({
    ...projectStore,
    computeTeamCoreDigest,
    exportTeamPackage: visualizer.exportTeamPackage,
    loadTeamPackage: visualizer.loadTeamPackage,
    createWorkspace: visualizer.createWorkspace,
    normalizeMaterialPath
  });
}
