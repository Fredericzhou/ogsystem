import assert from "node:assert/strict";
import test from "node:test";
import { createTeamPackagePreviewUseCases } from "../application/team-package-preview-use-cases.mjs";

function createUseCases(teams = []) {
  const calls = [];
  const useCases = createTeamPackagePreviewUseCases({
    validateTeamPackage: async (bundle) => {
      calls.push(["validate", bundle]);
      return {
        bundle: { mode: "team-v2" },
        metadata: { name: "Source Team" },
        packageDigest: "package-digest",
        teamCoreDigest: bundle.teamCoreDigest
      };
    },
    teamCatalog: {
      listTeamRepository: async () => (calls.push(["catalog"]), teams)
    }
  });
  return { useCases, calls };
}

test("team package preview recommends reuse for an identical team version", async () => {
  const { useCases } = createUseCases([
    { projectId: "team-v1", teamName: "Existing Name", teamCoreDigest: "same", builtIn: true }
  ]);

  assert.deepEqual(await useCases.previewTeamPackage({ teamCoreDigest: "same" }), {
    mode: "team-v2",
    packageDigest: "package-digest",
    teamCoreDigest: "same",
    name: "Source Team",
    duplicate: { projectId: "team-v1", name: "Existing Name", builtIn: true },
    conflicts: [],
    suggestedStrategy: "reuse"
  });
});

test("team package preview detects case-insensitive name conflicts and honors the requested name", async () => {
  const { useCases } = createUseCases([
    { projectId: "team-v2", name: "Overridden", teamCoreDigest: "other" }
  ]);

  const result = await useCases.previewTeamPackage({ teamCoreDigest: "new" }, { name: "  overridden  " });
  assert.equal(result.name, "overridden");
  assert.deepEqual(result.conflicts, [{ type: "name", projectId: "team-v2", name: "Overridden" }]);
  assert.equal(result.suggestedStrategy, "create-new");
});

test("team package preview allows a free name and validates before querying the catalog", async () => {
  const { useCases, calls } = createUseCases([]);
  const result = await useCases.previewTeamPackage({ teamCoreDigest: "new" }, { name: "  Fresh Team  " });
  assert.equal(result.name, "Fresh Team");
  assert.equal(result.suggestedStrategy, "create");
  assert.deepEqual(calls.map(([kind]) => kind), ["validate", "catalog"]);
});

test("team package preview stops before catalog lookup when validation fails", async () => {
  const calls = [];
  const useCases = createTeamPackagePreviewUseCases({
    validateTeamPackage: async () => { calls.push("validate"); throw new Error("invalid package"); },
    teamCatalog: { listTeamRepository: async () => (calls.push("catalog"), []) }
  });

  await assert.rejects(() => useCases.previewTeamPackage({}), /invalid package/);
  assert.deepEqual(calls, ["validate"]);
});

test("team package import applies conflict policy before invoking persistence", async () => {
  const calls = [];
  const useCases = createTeamPackagePreviewUseCases({
    validateTeamPackage: async (bundle) => ({ bundle: { mode: "team-v2" }, metadata: { name: "Source Team" }, packageDigest: "p", teamCoreDigest: bundle.teamCoreDigest }),
    teamCatalog: { listTeamRepository: async () => [{ projectId: "same", name: "Existing", teamCoreDigest: "same" }] },
    packageStore: {
      getTeam: async (id) => ({ projectId: id }),
      exportTeamPackage: async (id) => ({ projectId: id }),
      importTeamPackage: async (...args) => (calls.push(args), { projectId: "created" })
    }
  });

  await assert.rejects(() => useCases.importTeamPackage({ teamCoreDigest: "same" }, { conflictStrategy: "reject" }), /TEAM_NAME_EXISTS/);
  assert.deepEqual(calls, []);
  assert.deepEqual(await useCases.importTeamPackage({ teamCoreDigest: "same" }, { conflictStrategy: "reuse" }), { projectId: "same" });
  assert.deepEqual(await useCases.importTeamPackage({ teamCoreDigest: "new" }, { conflictStrategy: "create-new" }), { projectId: "created" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].preview.teamCoreDigest, "new");
});
