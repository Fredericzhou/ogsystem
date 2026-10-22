import assert from "node:assert/strict";
import test from "node:test";
import { createTeamCatalogUseCases } from "../application/team-catalog-use-cases.mjs";

const teams = [
  { projectId: "builtin-a", teamName: "软件研发", name: "软件研发", overview: "Plan delivery", teamVersionStatus: "released", builtIn: true, category: { "zh-CN": "产品研发", en: "Product development" } },
  { projectId: "custom-v2", teamName: "Ops Team", name: "Operations", overview: "Coordinate releases", teamVersionStatus: "released", teamVersionNumber: 2, updatedAt: "2026-02-02", category: "Operations" },
  { projectId: "custom-draft", teamName: "Ops Draft", name: "Operations draft", overview: "Draft", teamVersionStatus: "editing", teamVersionNumber: 3, updatedAt: "2026-03-01", category: "Operations" },
  { projectId: "archived", teamName: "Old Ops", name: "Old Ops", overview: "Archived", teamVersionStatus: "archived", archivedAt: "2026-03-01", category: "Operations" }
];

function setup() {
  const calls = [];
  const teamCatalog = {
    listTeamFactory: async () => [{ projectId: "custom-draft" }],
    listTeamRepository: async (options) => (calls.push(options), teams)
  };
  return { calls, useCases: createTeamCatalogUseCases({ teamCatalog }) };
}

test("Team Catalog use cases delegate the factory collection and query the complete catalog", async () => {
  const { calls, useCases } = setup();
  assert.deepEqual(await useCases.listTeamFactory(), [{ projectId: "custom-draft" }]);
  const result = await useCases.queryTeamRepository();
  assert.deepEqual(calls, [{ includeUnreleased: true }]);
  assert.equal(result.stats.total, 4);
  assert.equal(result.stats.builtIn, 1);
  assert.equal(result.stats.custom, 3);
  assert.equal(result.pagination.total, 4);
  assert.equal(result.teams[0].projectId, "custom-draft");
});

test("Team Catalog filters by localized category and query and supports explicit statuses", async () => {
  const { useCases } = setup();
  const result = await useCases.queryTeamRepository({ query: "coordinate", category: "operations", status: "released" });
  assert.deepEqual(result.teams.map((team) => team.projectId), ["custom-v2"]);
  assert.equal(result.pagination.total, 1);

  const drafts = await useCases.queryTeamRepository({ status: "editing", category: "Operations" });
  assert.deepEqual(drafts.teams.map((team) => team.projectId), ["custom-draft"]);
});

test("Team Catalog supports name/version ordering and clamps pagination", async () => {
  const { useCases } = setup();
  const byName = await useCases.queryTeamRepository({ status: "all", sort: "name", page: 1, pageSize: 2 });
  assert.deepEqual(byName.teams.map((team) => team.projectId), ["builtin-a", "archived"]);
  assert.deepEqual(byName.pagination, { page: 1, pageSize: 2, total: 4, totalPages: 2 });

  const byVersion = await useCases.queryTeamRepository({ status: "all", sort: "version", page: 99, pageSize: 500 });
  assert.deepEqual(byVersion.teams.map((team) => team.projectId), ["custom-draft", "custom-v2", "builtin-a", "archived"]);
  assert.deepEqual(byVersion.pagination, { page: 1, pageSize: 50, total: 4, totalPages: 1 });
});

test("Team Catalog rejects a missing catalog port", () => {
  assert.throws(() => createTeamCatalogUseCases({}), /Team catalog use cases require/);
});
