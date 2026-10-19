export function createTeamPackagePreviewUseCases({ validateTeamPackage, teamCatalog, packageStore }) {
  if (typeof validateTeamPackage !== "function") {
    throw new TypeError("Team package preview requires a package validator.");
  }
  if (!teamCatalog || typeof teamCatalog.listTeamRepository !== "function") {
    throw new TypeError("Team package preview requires a team catalog port.");
  }

  if (packageStore && (typeof packageStore.importTeamPackage !== "function" || typeof packageStore.getTeam !== "function" || typeof packageStore.exportTeamPackage !== "function")) {
    throw new TypeError("Team package operations require an import store port.");
  }

  async function previewTeamPackage(bundle, { name } = {}) {
    const checked = await validateTeamPackage(bundle);
    const teams = await teamCatalog.listTeamRepository();
    const metadataName = String(name || checked.metadata.name || "Imported team").trim() || "Imported team";
    const duplicate = teams.find((team) => team.teamCoreDigest === checked.teamCoreDigest);
    const nameConflict = teams.find((team) => String(team.teamName || team.name).trim().toLocaleLowerCase() === metadataName.toLocaleLowerCase()
      && team.teamCoreDigest !== checked.teamCoreDigest);

    return {
      mode: checked.bundle.mode,
      packageDigest: checked.packageDigest,
      teamCoreDigest: checked.teamCoreDigest,
      name: metadataName,
      duplicate: duplicate ? { projectId: duplicate.projectId, name: duplicate.teamName || duplicate.name, builtIn: Boolean(duplicate.builtIn) } : null,
      conflicts: nameConflict ? [{ type: "name", projectId: nameConflict.projectId, name: nameConflict.teamName || nameConflict.name }] : [],
      suggestedStrategy: duplicate ? "reuse" : nameConflict ? "create-new" : "create"
    };
  }

  async function importTeamPackage(bundle, { conflictStrategy = "create-new", name } = {}) {
    if (!packageStore) throw new TypeError("Team package import store is not configured.");
    const preview = await previewTeamPackage(bundle, { name });
    const strategy = ["reject", "reuse", "create-new"].includes(conflictStrategy) ? conflictStrategy : "reject";
    if (preview.duplicate) {
      if (strategy === "reuse") return packageStore.getTeam(preview.duplicate.projectId);
      if (strategy === "reject") throw new Error("TEAM_NAME_EXISTS: an identical team version already exists.");
    }
    if (preview.conflicts.length && strategy === "reject") throw new Error("TEAM_IMPORT_CONFLICT: the imported team name is already in use.");
    return packageStore.importTeamPackage(bundle, {
      name: preview.name,
      conflictStrategy: strategy,
      preview
    });
  }

  async function exportTeamPackage(projectId) {
    if (!packageStore) throw new TypeError("Team package store is not configured.");
    return packageStore.exportTeamPackage(projectId);
  }

  return Object.freeze({
    previewTeamPackage,
    importTeamPackage,
    exportTeamPackage
  });
}
