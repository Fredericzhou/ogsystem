import { isSupportedMaterialPath } from "../domain/material-path.mjs";

export function createProjectPackageUseCases({
  validateTeamPackage,
  packageIntegrity,
  normalizeMaterialPath,
  projectCatalog,
  packageStore
}) {
  if (typeof validateTeamPackage !== "function") {
    throw new TypeError("Project package operations require a Team package validator.");
  }
  if (!packageIntegrity
    || typeof packageIntegrity.computePackageDigest !== "function"
    || typeof packageIntegrity.computeProjectDefinitionDigest !== "function"
    || typeof packageIntegrity.computeContentDigest !== "function") {
    throw new TypeError("Project package operations require package integrity functions.");
  }
  if (typeof normalizeMaterialPath !== "function") {
    throw new TypeError("Project package operations require material path normalization.");
  }
  if (!projectCatalog || typeof projectCatalog.listProjects !== "function") {
    throw new TypeError("Project package operations require a project catalog.");
  }
  if (packageStore && (typeof packageStore.importProjectBundle !== "function" || typeof packageStore.getProject !== "function" || typeof packageStore.exportProjectBundle !== "function")) {
    throw new TypeError("Project package operations require an import store port.");
  }

  async function validateProjectBundle(bundle) {
    if (!bundle || bundle.mode !== "project-v2") throw new Error("PROJECT_PACKAGE_VERSION_UNSUPPORTED: expected mode=project-v2.");
    if (!bundle.project || typeof bundle.project !== "object") throw new Error("PROJECT_IMPORT_INVALID: project package is missing project contents.");
    if (bundle.packageDigest && bundle.packageDigest !== packageIntegrity.computePackageDigest(bundle)) {
      throw new Error("PROJECT_IMPORT_DIGEST_MISMATCH: packageDigest does not match package contents.");
    }
    const materials = Array.isArray(bundle.project.materials) ? bundle.project.materials : [];
    if (materials.length > 200) throw new Error("PROJECT_IMPORT_INVALID: project package contains too many materials.");
    let totalSize = 0;
    for (const material of materials) {
      const filename = normalizeMaterialPath(material?.filename);
      if (!isSupportedMaterialPath(filename)) {
        throw new Error("PROJECT_IMPORT_INVALID: unsupported material format.");
      }
      if (typeof material?.content !== "string" || material.content.length > 1024 * 1024) {
        throw new Error("PROJECT_IMPORT_INVALID: material content is too large.");
      }
      totalSize += new TextEncoder().encode(material.content).length;
    }
    if (totalSize > 8 * 1024 * 1024) throw new Error("PROJECT_IMPORT_INVALID: material content exceeds the package limit.");
    if (!Array.isArray(bundle.project.mountedTeams)) throw new Error("PROJECT_IMPORT_INVALID: mountedTeams must be an array.");
    if (bundle.project.mountedTeams.length !== 1) throw new Error("PROJECT_SINGLE_TEAM_REQUIRED: a project package must contain exactly one mounted TeamVersion.");
    const mountedTeams = [];
    for (const mountedTeam of bundle.project.mountedTeams) {
      if (!mountedTeam || typeof mountedTeam !== "object" || !mountedTeam.teamPackage) {
        throw new Error("PROJECT_IMPORT_INVALID: mounted team package is missing.");
      }
      const checkedTeam = await validateTeamPackage(mountedTeam.teamPackage);
      if (mountedTeam.teamCoreDigest && mountedTeam.teamCoreDigest !== checkedTeam.teamCoreDigest) {
        throw new Error("PROJECT_IMPORT_DIGEST_MISMATCH: teamCoreDigest does not match nested team contents.");
      }
      const teamMeta = checkedTeam.bundle.team?.project || {};
      if (teamMeta.teamVersionStatus && teamMeta.teamVersionStatus !== "released") {
        throw new Error("TEAM_VERSION_NOT_RELEASED: only released team versions can be mounted.");
      }
      mountedTeams.push({
        ...mountedTeam,
        teamCoreDigest: checkedTeam.teamCoreDigest,
        ...(Number.isInteger(checkedTeam.teamDigestVersion) ? { teamDigestVersion: checkedTeam.teamDigestVersion } : {}),
        teamPackage: checkedTeam.bundle
      });
    }
    const project = { ...bundle.project, mountedTeams, materials };
    const expectedDefinitionDigest = packageIntegrity.computeProjectDefinitionDigest({
      ...project,
      materials: {
        version: 1,
        materials: materials.map(({ content, ...item }) => ({
          ...item,
          contentHash: item.contentHash || packageIntegrity.computeContentDigest(content)
        }))
      }
    });
    if (typeof project.projectDefinitionDigest !== "string" || project.projectDefinitionDigest !== expectedDefinitionDigest) {
      throw new Error("PROJECT_IMPORT_DIGEST_MISMATCH: projectDefinitionDigest does not match project contents.");
    }
    return { bundle, project, packageDigest: bundle.packageDigest || packageIntegrity.computePackageDigest(bundle) };
  }

  async function previewProjectBundle(bundle) {
    const checked = await validateProjectBundle(bundle);
    const allProjects = await projectCatalog.listProjects();
    const projects = allProjects.filter((project) => project.projectType === "collaboration");
    const teams = allProjects.filter((project) => !project.teamProjectId && project.projectType !== "collaboration");
    const projectName = String(checked.project.name || "Imported project").trim() || "Imported project";
    const duplicate = projects.find((project) => project.projectDefinitionDigest === checked.project.projectDefinitionDigest && checked.project.projectDefinitionDigest);
    const nameConflict = projects.find((project) => String(project.name).trim().toLocaleLowerCase() === projectName.toLocaleLowerCase() && project.projectId !== duplicate?.projectId);
    const teamDependencies = checked.project.mountedTeams.map((dependency) => {
      const match = teams.find((team) => team.teamCoreDigest === dependency.teamCoreDigest);
      const sameName = teams.find((team) => String(team.teamName || team.name).trim().toLocaleLowerCase() === String(dependency.teamName || "").trim().toLocaleLowerCase());
      return {
        sourceTeamVersionId: dependency.teamVersionId || null,
        teamCoreDigest: dependency.teamCoreDigest,
        name: dependency.teamName,
        sameDigestVersion: match ? { teamVersionId: match.teamVersionId || match.projectId, name: match.teamName || match.name } : null,
        nameConflict: sameName && sameName.teamCoreDigest !== dependency.teamCoreDigest ? { teamVersionId: sameName.teamVersionId || sameName.projectId, name: sameName.teamName || sameName.name } : null,
        action: match ? "reuse" : "create-new"
      };
    });
    return {
      mode: "project-v2",
      project: checked.project,
      packageDigest: checked.packageDigest,
      projectDefinitionDigest: checked.project.projectDefinitionDigest || null,
      teamDependencies,
      missingItems: teamDependencies.filter((dependency) => !dependency.sameDigestVersion).map((dependency) => dependency.name),
      idMappingPlan: teamDependencies.map((dependency) => ({ sourceTeamVersionId: dependency.sourceTeamVersionId, action: dependency.action })),
      name: projectName,
      duplicate: duplicate ? { projectId: duplicate.projectId, name: duplicate.name } : null,
      conflicts: nameConflict ? [{ type: "name", projectId: nameConflict.projectId, name: nameConflict.name }] : [],
      suggestedStrategy: duplicate ? "reuse" : nameConflict ? "create-new" : "create"
    };
  }

  async function importProjectBundle(bundle, { conflictStrategy = "create-new" } = {}) {
    if (!packageStore) throw new TypeError("Project package import store is not configured.");
    const preview = await previewProjectBundle(bundle);
    const strategy = ["reject", "reuse", "create-new"].includes(conflictStrategy) ? conflictStrategy : "reject";
    if (preview.duplicate) {
      if (strategy === "reuse") return packageStore.getProject(preview.duplicate.projectId);
      if (strategy === "reject") throw new Error("PROJECT_IMPORT_CONFLICT: an identical project definition already exists.");
    }
    if (preview.conflicts.length && strategy === "reject") throw new Error("PROJECT_IMPORT_CONFLICT: the imported project name is already in use.");
    return packageStore.importProjectBundle(bundle, { conflictStrategy: strategy, preview });
  }

  async function exportProjectBundle(projectId) {
    if (!packageStore) throw new TypeError("Project package store is not configured.");
    return packageStore.exportProjectBundle(projectId);
  }

  return Object.freeze({ previewProjectBundle, importProjectBundle, exportProjectBundle });
}
