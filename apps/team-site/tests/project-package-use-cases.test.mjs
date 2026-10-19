import assert from "node:assert/strict";
import test from "node:test";
import { createProjectPackageUseCases } from "../application/project-package-use-cases.mjs";
import { normalizeMaterialPath } from "../domain/material-path.mjs";

function createOperations({ projects = [], projectDefinitionDigest = "definition", validateTeamPackage = async (bundle) => ({
  bundle,
  teamCoreDigest: bundle.teamCoreDigest,
  packageDigest: bundle.packageDigest
}) } = {}) {
  const calls = [];
  const useCases = createProjectPackageUseCases({
    validateTeamPackage,
    packageIntegrity: {
      computePackageDigest: () => "package",
      computeProjectDefinitionDigest: () => projectDefinitionDigest,
      computeContentDigest: () => "content"
    },
    normalizeMaterialPath,
    projectCatalog: { listProjects: async () => (calls.push("catalog"), projects) }
  });
  return { useCases, calls };
}

function bundle(overrides = {}) {
  return {
    mode: "project-v2",
    project: {
      name: "Imported Project",
      overview: "Package preview",
      projectDefinitionDigest: "definition",
      mountedTeams: [],
      materials: [],
      ...overrides
    }
  };
}

test("project package preview detects duplicate definition and returns stable empty dependency plans", async () => {
  const { useCases, calls } = createOperations({
    projects: [{ projectId: "existing", projectType: "collaboration", name: "Existing", projectDefinitionDigest: "definition" }]
  });

  assert.deepEqual(await useCases.previewProjectBundle(bundle()), {
    mode: "project-v2",
    project: bundle().project,
    packageDigest: "package",
    projectDefinitionDigest: "definition",
    teamDependencies: [],
    missingItems: [],
    idMappingPlan: [],
    name: "Imported Project",
    duplicate: { projectId: "existing", name: "Existing" },
    conflicts: [],
    suggestedStrategy: "reuse"
  });
  assert.deepEqual(calls, ["catalog"]);
});

test("project package preview maps mounted TeamVersion digest and name conflicts", async () => {
  const { useCases } = createOperations({
    projects: [
      { projectId: "same", teamVersionId: "same", teamName: "Dependency A", teamCoreDigest: "digest-a" },
      { projectId: "conflict", teamVersionId: "conflict", teamName: "Dependency B", teamCoreDigest: "different" }
    ]
  });
  const project = bundle({ mountedTeams: [
    { teamVersionId: "source-a", teamName: "Dependency A", teamCoreDigest: "digest-a", teamPackage: { teamCoreDigest: "digest-a", team: { project: { teamVersionStatus: "released" } } } },
    { teamVersionId: "source-b", teamName: "Dependency B", teamCoreDigest: "digest-b", teamPackage: { teamCoreDigest: "digest-b", team: { project: { teamVersionStatus: "released" } } } }
  ] });

  const preview = await useCases.previewProjectBundle(project);
  assert.deepEqual(preview.teamDependencies, [
    {
      sourceTeamVersionId: "source-a",
      teamCoreDigest: "digest-a",
      name: "Dependency A",
      sameDigestVersion: { teamVersionId: "same", name: "Dependency A" },
      nameConflict: null,
      action: "reuse"
    },
    {
      sourceTeamVersionId: "source-b",
      teamCoreDigest: "digest-b",
      name: "Dependency B",
      sameDigestVersion: null,
      nameConflict: { teamVersionId: "conflict", name: "Dependency B" },
      action: "create-new"
    }
  ]);
  assert.deepEqual(preview.missingItems, ["Dependency B"]);
});

test("project package validation checks nested released teams before catalog reads", async () => {
  const calls = [];
  const { useCases } = createOperations({
    validateTeamPackage: async (teamBundle) => {
      calls.push(teamBundle.teamVersionStatus);
      return { bundle: { team: { project: { teamVersionStatus: teamBundle.teamVersionStatus } } }, teamCoreDigest: "nested-digest" };
    }
  });
  const project = bundle({ mountedTeams: [{ teamPackage: { teamVersionStatus: "draft" }, teamCoreDigest: "nested-digest" }] });

  await assert.rejects(() => useCases.previewProjectBundle(project), /TEAM_VERSION_NOT_RELEASED/);
  assert.deepEqual(calls, ["draft"]);
});

test("project package validation rejects invalid material paths, formats, and definition digests", async () => {
  const { useCases } = createOperations();

  await assert.rejects(() => useCases.previewProjectBundle(bundle({ materials: [{ filename: "../escape.md", content: "x" }] })), /MATERIAL_PATH_INVALID/);
  await assert.rejects(() => useCases.previewProjectBundle(bundle({ materials: [{ filename: "notes.exe", content: "x" }] })), /unsupported material format/);
  const wrongDigest = createProjectPackageUseCases({
    validateTeamPackage: async () => ({}),
    packageIntegrity: {
      computePackageDigest: () => "package",
      computeProjectDefinitionDigest: () => "wrong",
      computeContentDigest: () => "content"
    },
    normalizeMaterialPath,
    projectCatalog: { listProjects: async () => [] }
  });
  await assert.rejects(() => wrongDigest.previewProjectBundle(bundle()), /PROJECT_IMPORT_DIGEST_MISMATCH: projectDefinitionDigest/);
});

test("project package import applies conflict policy before invoking persistence", async () => {
  const calls = [];
  const useCases = createProjectPackageUseCases({
    validateTeamPackage: async (nested) => ({ bundle: nested, teamCoreDigest: nested.teamCoreDigest }),
    packageIntegrity: {
      computePackageDigest: () => "package",
      computeProjectDefinitionDigest: (project) => project.projectDefinitionDigest,
      computeContentDigest: () => "content"
    },
    normalizeMaterialPath,
    projectCatalog: { listProjects: async () => [{ projectId: "existing", projectType: "collaboration", name: "Project", projectDefinitionDigest: "definition" }] },
    packageStore: {
      getProject: async (id) => ({ projectId: id }),
      exportProjectBundle: async (id) => ({ projectId: id }),
      importProjectBundle: async (...args) => (calls.push(args), { projectId: "created" })
    }
  });

  await assert.rejects(() => useCases.importProjectBundle(bundle(), { conflictStrategy: "reject" }), /PROJECT_IMPORT_CONFLICT/);
  assert.deepEqual(calls, []);
  assert.deepEqual(await useCases.importProjectBundle(bundle(), { conflictStrategy: "reuse" }), { projectId: "existing" });
  assert.deepEqual(await useCases.importProjectBundle(bundle({ projectDefinitionDigest: "new" }), { conflictStrategy: "create-new" }), { projectId: "created" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].preview.project.projectDefinitionDigest, "new");
});
