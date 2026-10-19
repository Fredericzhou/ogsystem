import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { computeProjectAssetDigest } from "../../../dist/runtime/project-asset-digest.js";
import { assertCanonicalTeamVersionId } from "../domain/team.mjs";
import { computePackageDigest, computeProjectDefinitionDigest, teamCorePayload } from "./package-integrity.mjs";

export function createFilePackageTransactionStore({
  projectsRoot,
  stagingRoot,
  projectPath,
  readProject,
  getProject,
  listProjects,
  listTeamRepository,
  createProject,
  createProjectAt,
  withProjectWriteLock,
  acquireProjectWriteLock,
  readJson,
  writeJson,
  normalizeMeta,
  writeTeamReferenceFiles,
  computeTeamCoreDigest,
  exportTeamPackage,
  loadTeamPackage,
  createWorkspace,
  normalizeMaterialPath,
  computeProjectDefinitionDigest: definitionDigest = computeProjectDefinitionDigest,
  packageDigest: digestPackage = computePackageDigest,
  slug
}) {
  const dependencies = {
    projectsRoot, stagingRoot, projectPath, readProject, getProject, listProjects, listTeamRepository,
    createProject, createProjectAt, withProjectWriteLock, acquireProjectWriteLock, readJson, writeJson,
    normalizeMeta, writeTeamReferenceFiles, computeTeamCoreDigest, exportTeamPackage, loadTeamPackage, createWorkspace,
    normalizeMaterialPath, definitionDigest, digestPackage, slug
  };
  for (const [name, implementation] of Object.entries(dependencies)) {
    if (implementation === undefined || implementation === null) throw new TypeError(`File package transaction store requires ${name}.`);
  }

  async function exportProjectTeam(projectId) {
    const project = await readProject(projectId);
    const bundle = await exportTeamPackage(project.workdir);
    const exported = {
      ...bundle,
      team: {
        ...bundle.team,
        project: {
          ...(bundle.team?.project || {}),
          name: project.teamName || project.name,
          teamName: project.teamName || project.name,
          overview: project.overview,
          teamVersionStatus: project.teamVersionStatus,
          teamVersionNumber: project.teamVersionNumber,
          projectId: project.projectId,
          teamRootId: project.teamRootId || project.teamId || project.projectId,
          teamVersionId: project.teamVersionId || project.projectId
        }
      },
      teamCoreDigest: bundle.teamCoreDigest || await computeTeamCoreDigest(project.workdir)
    };
    return { ...exported, packageDigest: digestPackage(exported) };
  }

  async function exportMountedTeamPackage(mountedTeam) {
    const teamVersionId = String(mountedTeam.teamVersionId || "");
    assertCanonicalTeamVersionId(teamVersionId);
    const team = await readProject(teamVersionId);
    if (team.teamProjectId || team.teamVersionStatus !== "released") throw new Error("TEAM_VERSION_NOT_RELEASED: only a released team version can be exported.");
    const rawPackage = await exportTeamPackage(team.workdir);
    const teamPackage = {
      ...rawPackage,
      team: {
        ...rawPackage.team,
        project: {
          ...(rawPackage.team?.project || {}),
          name: team.teamName || team.name,
          teamName: team.teamName || team.name,
          overview: team.overview,
          teamVersionStatus: team.teamVersionStatus || "released",
          teamVersionNumber: team.teamVersionNumber || mountedTeam.teamVersionNumber || 1,
          projectId: team.projectId || teamVersionId,
          teamRootId: team.teamRootId || team.teamId || teamVersionId,
          teamVersionId: team.teamVersionId || teamVersionId
        }
      }
    };
    const teamCoreDigest = mountedTeam.teamCoreDigest || team.teamCoreDigest || createHash("sha256").update(JSON.stringify(teamCorePayload(teamPackage))).digest("hex");
    return {
      teamVersionId,
      teamRootId: team.teamRootId || team.teamId || teamVersionId,
      teamVersionNumber: team.teamVersionNumber || mountedTeam.teamVersionNumber || 1,
      teamName: team.teamName || team.name || mountedTeam.teamName,
      teamCoreDigest,
      builtIn: Boolean(mountedTeam.builtIn),
      source: {
        sourceWorkspaceId: String(process.env.OGS_WORKSPACE_ID || "team-site-local"),
        sourceProjectId: team.projectId || teamVersionId,
        sourceTeamRootId: team.teamRootId || team.teamId || teamVersionId,
        sourceTeamVersionId: team.teamVersionId || teamVersionId
      },
      teamPackage
    };
  }

  async function exportProjectBundle(projectId) {
    const project = await readProject(projectId);
    const materials = [];
    for (const item of project.materials?.materials || []) {
      const content = await readFile(resolve(project.workdir, item.path), "utf8").catch(() => "");
      materials.push({ ...item, content });
    }
    const mountedTeams = [];
    const seenTeamVersions = new Set();
    for (const mountedTeam of project.mountedTeams || []) {
      const teamVersionId = String(mountedTeam.teamVersionId || "");
      if (seenTeamVersions.has(teamVersionId)) continue;
      seenTeamVersions.add(teamVersionId);
      mountedTeams.push(await exportMountedTeamPackage(mountedTeam));
    }
    const projectDefinitionDigest = definitionDigest({
      ...project,
      mountedTeams,
      materials: {
        version: 1,
        materials: materials.map(({ content, ...item }) => ({
          ...item,
          contentHash: item.contentHash || createHash("sha256").update(content).digest("hex")
        }))
      }
    });
    const bundle = {
      mode: "project-v2",
      packageVersion: 2,
      source: {
        sourceWorkspaceId: String(process.env.OGS_WORKSPACE_ID || "team-site-local"),
        sourceProjectId: project.projectId
      },
      project: {
        name: project.name,
        overview: project.overview,
        projectDefinitionDigest,
        mountedTeams,
        materials
      },
      projectSummary: {
        name: project.name,
        overview: project.overview,
        teamCount: mountedTeams.length,
        materialCount: materials.length,
        projectDefinitionDigest
      },
      packageSummary: {
        mode: "project-v2",
        teamCount: mountedTeams.length,
        materialCount: materials.length,
        projectDefinitionDigest
      }
    };
    return { ...bundle, packageDigest: digestPackage(bundle) };
  }

  async function importTeamPackage(bundle, { name, preview, previewOperation } = {}) {
    if (!preview && typeof previewOperation !== "function") throw new TypeError("Validated Team package preview is required before persistence.");
    const checkedPreview = preview || await previewOperation(bundle, { name });
    const metadata = bundle.team.project || {};
    const requestedName = String(name || checkedPreview.name || metadata.name || "Imported team").trim() || "Imported team";
    const importName = uniqueImportedName(requestedName, await listProjects(), "Imported team", "team");
    const libraryLock = await acquireProjectWriteLock(projectsRoot, "project-import");
    let project;
    try {
      project = await createProject({ name: importName, teamName: importName, overview: metadata.overview || "", templateId: "empty", source: "imported" });
      await createWorkspace({ currentWorkdir: project.workdir, projectId: project.projectId, projectName: slug(importName), templateId: "empty", conflictStrategy: "init-current" });
      const loaded = await loadTeamPackage({ workdir: project.workdir, bundle });
      if (loaded.validation?.ok === false) throw new Error("PROJECT_IMPORT_INVALID: imported Mermaid system failed validation.");
      await withProjectWriteLock(project.projectId, "project-import", async () => {
        const current = await readProject(project.projectId);
        const importedMeta = {
          ...normalizeMeta(current, current.projectId),
          source: "imported",
          teamCoreDigest: bundle.teamCoreDigest || await computeTeamCoreDigest(current.workdir),
          updatedAt: new Date().toISOString()
        };
        await writeJson(join(current.workdir, ".site", "project.json"), importedMeta);
        await writeTeamReferenceFiles(current.workdir, importedMeta);
      });
      return getProject(project.projectId);
    } catch (error) {
      if (project?.workdir) await rm(project.workdir, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`PROJECT_IMPORT_FAILED: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await libraryLock.release();
    }
  }

  async function stageImportedTeamPackage(transactionRoot, bundle, name) {
    const projectId = slug(name) + "-" + randomUUID().slice(0, 8);
    const teamRootId = `team-${randomUUID().slice(0, 12)}`;
    const workdir = join(transactionRoot, "teams", projectId);
    await createProjectAt(workdir, {
      projectId,
      name,
      teamName: name,
      overview: bundle.team?.project?.overview || "",
      source: "imported",
      teamId: teamRootId,
      teamRootId,
      teamVersionId: projectId
    });
    await createWorkspace({ currentWorkdir: workdir, projectId, projectName: slug(name), templateId: "empty", conflictStrategy: "init-current" });
    const loaded = await loadTeamPackage({ workdir, bundle });
    if (loaded.validation?.ok === false) throw new Error("PROJECT_IMPORT_INVALID: imported Mermaid system failed validation.");
    const now = new Date().toISOString();
    const teamCoreDigest = createHash("sha256").update(JSON.stringify(teamCorePayload(bundle))).digest("hex");
    const current = await readJson(join(workdir, ".site", "project.json"), {});
    const next = {
      ...current,
      name,
      teamName: name,
      projectType: "team",
      teamId: teamRootId,
      teamRootId,
      teamVersionId: projectId,
      teamVersionStatus: "released",
      projectStatus: "confirmed",
      projectDigest: await computeProjectAssetDigest(workdir),
      teamCoreDigest,
      confirmedAt: now,
      releasedAt: now,
      source: "imported",
      updatedAt: now
    };
    await writeJson(join(workdir, ".site", "project.json"), next);
    await writeTeamReferenceFiles(workdir, next);
    return { projectId, workdir, teamRootId, teamVersionNumber: 1, teamName: name, teamCoreDigest };
  }

  async function stageProjectMaterials(workdir, materials = []) {
    const entries = [];
    const batchId = randomUUID();
    const root = resolve(workdir, "workspace", "files", batchId);
    for (const material of materials) {
      const filename = normalizeMaterialPath(material.filename);
      const target = resolve(root, filename);
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, material.content, "utf8");
      entries.push({
        materialId: slug(filename.replaceAll("/", "-").slice(0, -extname(filename).length)) + "-" + randomUUID().slice(0, 6),
        filename,
        path: `workspace/files/${batchId}/${filename}`,
        contentType: material.contentType || "text/plain",
        size: Buffer.byteLength(material.content),
        contentHash: createHash("sha256").update(material.content).digest("hex"),
        status: "indexed",
        createdAt: new Date().toISOString()
      });
    }
    const index = { version: 1, materials: entries };
    await writeJson(join(workdir, "workspace", "index.json"), index);
    return index;
  }

  async function importProjectBundle(bundle, { conflictStrategy = "create-new", preview, previewOperation } = {}) {
    if (!preview && typeof previewOperation !== "function") throw new TypeError("Validated Project package preview is required before persistence.");
    const checkedPreview = preview || await previewOperation(bundle);
    const strategy = ["reject", "reuse", "create-new"].includes(conflictStrategy) ? conflictStrategy : "reject";
    const existing = await listProjects();
    const projectName = strategy === "create-new" ? uniqueImportedName(checkedPreview.name, existing, "Imported project", "project") : checkedPreview.name;
    const source = checkedPreview.project;
    const transactionRoot = join(stagingRoot, `project-import-${randomUUID()}`);
    const committed = [];
    const stagedTeams = [];
    try {
      await mkdir(join(transactionRoot, "teams"), { recursive: true });
      const existingTeams = existing.filter((item) => !item.teamProjectId && item.projectType !== "collaboration");
      const stagedNames = [];
      const mountedTeams = [];
      for (const dependency of source.mountedTeams) {
        const teamMeta = dependency.teamPackage.team?.project || {};
        const sourceName = String(dependency.teamName || teamMeta.teamName || teamMeta.name || "Imported team").trim() || "Imported team";
        const digestMatch = existingTeams.find((item) => item.teamCoreDigest === dependency.teamCoreDigest);
        const nameMatch = existingTeams.find((item) => String(item.teamName || item.name).trim().toLocaleLowerCase() === sourceName.toLocaleLowerCase() && item.teamCoreDigest !== dependency.teamCoreDigest);
        if (digestMatch && strategy === "reuse") {
          mountedTeams.push({
            teamId: digestMatch.teamId || digestMatch.teamRootId || digestMatch.projectId,
            teamVersionId: digestMatch.teamVersionId || digestMatch.projectId,
            teamVersionNumber: digestMatch.teamVersionNumber || dependency.teamVersionNumber || 1,
            teamName: digestMatch.teamName || digestMatch.name || sourceName,
            teamCoreDigest: dependency.teamCoreDigest,
            status: "available",
            source: dependency.source
          });
          continue;
        }
        if ((digestMatch || nameMatch) && strategy === "reject") {
          throw new Error(digestMatch
            ? "TEAM_IMPORT_CONFLICT: an identical team version already exists."
            : "TEAM_NAME_EXISTS: an imported team name is already in use.");
        }
        const importedName = strategy === "create-new"
          ? uniqueImportedName(sourceName, [...existingTeams, ...stagedNames.map((name) => ({ name, projectType: "team" }))], "Imported team", "team")
          : sourceName;
        stagedNames.push(importedName);
        const stagedTeam = await stageImportedTeamPackage(transactionRoot, dependency.teamPackage, importedName);
        stagedTeams.push(stagedTeam);
        mountedTeams.push({
          teamId: stagedTeam.teamRootId,
          teamVersionId: stagedTeam.projectId,
          teamVersionNumber: stagedTeam.teamVersionNumber,
          teamName: stagedTeam.teamName,
          teamCoreDigest: stagedTeam.teamCoreDigest,
          status: "available",
          source: dependency.source
        });
      }
      const projectId = slug(projectName) + "-" + randomUUID().slice(0, 8);
      const projectStage = join(transactionRoot, "project", projectId);
      await createProjectAt(projectStage, {
        projectId,
        name: projectName,
        overview: source.overview || "",
        source: "collaboration-project"
      });
      await createWorkspace({ currentWorkdir: projectStage, projectId, projectName: slug(projectName), templateId: "empty", conflictStrategy: "init-current" });
      const projectMeta = await readJson(join(projectStage, ".site", "project.json"), {});
      const materialIndex = await stageProjectMaterials(projectStage, source.materials);
      const nextProjectMeta = {
        ...projectMeta,
        projectType: "collaboration",
        teamId: undefined,
        teamVersionId: undefined,
        teamName: undefined,
        mountedTeams,
        taskRecords: [],
        nextTaskNumber: 1,
        workspaceKey: projectId,
        projectDefinitionDigest: definitionDigest({ ...projectMeta, projectType: "collaboration", name: projectName, overview: source.overview || "", mountedTeams, materials: materialIndex })
      };
      await writeJson(join(projectStage, ".site", "project.json"), nextProjectMeta);
      const finalTargets = [...stagedTeams.map((team) => ({ source: team.workdir, target: projectPath(team.projectId) })), { source: projectStage, target: projectPath(projectId) }];
      for (const target of finalTargets) {
        if (await readJson(join(target.target, ".site", "project.json"))) throw new Error("PROJECT_IMPORT_CONFLICT: an imported target identity already exists.");
      }
      for (const target of finalTargets) {
        await mkdir(resolve(target.target, ".."), { recursive: true });
        await rename(target.source, target.target);
        committed.push(target.target);
      }
      return readProject(projectId);
    } catch (error) {
      for (const target of committed.reverse()) await rm(target, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`PROJECT_IMPORT_FAILED: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await rm(transactionRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return Object.freeze({
    getTeam: getProject,
    getProject,
    importTeamPackage,
    importProjectBundle,
    exportTeamPackage: exportProjectTeam,
    exportProjectBundle
  });
}

function uniqueImportedName(name, existing, prefix = "Imported", scope = "project") {
  const base = String(name || prefix).trim().slice(0, 120) || prefix;
  const used = new Set(existing
    .filter((item) => scope === "team"
      ? !item.teamProjectId && item.projectType !== "collaboration"
      : item.projectType === "collaboration")
    .map((item) => String(scope === "team" ? (item.teamName || item.name) : item.name).trim().toLocaleLowerCase()));
  if (!used.has(base.toLocaleLowerCase())) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} (${index})`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new Error("IMPORT_NAME_CONFLICT: unable to allocate a unique imported name.");
}
