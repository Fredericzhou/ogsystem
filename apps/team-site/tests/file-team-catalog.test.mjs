import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFileTeamCatalog } from "../infrastructure/file-team-catalog.mjs";

test("file Team Catalog projects released teams, built-ins, factory drafts, and excludes workspaces", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-catalog-"));
  const writeProject = async (id, meta) => {
    const site = join(projectsRoot, id, ".site");
    await mkdir(site, { recursive: true });
    await writeFile(join(site, "project.json"), JSON.stringify({ overview: "Overview", ...meta }), "utf8");
  };
  try {
    await writeProject("released-team", { name: "Released Team", teamVersionStatus: "released", projectStatus: "confirmed", projectDigest: "digest", confirmedAt: "2026-01-01", teamId: "team-a", teamVersionNumber: 1, category: "Product", teamIrSemanticDigest: "a".repeat(64), compiledPlanDigest: "b".repeat(64), compilerSemanticsVersion: "team-ir-v2/1" });
    await writeProject("legacy-released-team", { name: "Legacy Released Team", projectStatus: "confirmed", projectDigest: "legacy-digest", confirmedAt: "2025-12-31", teamId: "legacy-root", teamVersionNumber: 1 });
    await writeProject("software-team-v1", { name: "软件研发", teamName: "软件研发", source: "classic", caseId: "software-team", teamId: "software-team", teamVersionId: "software-team-v1", teamVersionNumber: 1, teamVersionStatus: "released", projectStatus: "confirmed", projectDigest: "builtin-digest", confirmedAt: "2026-01-01" });
    await writeProject("draft-team", { name: "Draft Team", teamVersionStatus: "draft", teamId: "team-b", teamVersionNumber: 2 });
    await writeProject("archived-team", { name: "Archived Team", teamVersionStatus: "archived", archivedAt: "2026-01-03" });
    await writeProject("project-workspace", { name: "Workspace", teamProjectId: "released-team", teamVersionStatus: "draft" });
    await writeProject("collaboration", { name: "Collaboration", projectType: "collaboration", teamVersionStatus: "draft" });
    await writeProject(".staging", { name: "Staging", teamVersionStatus: "draft" });

    const catalog = createFileTeamCatalog({ projectsRoot });
    const repository = await catalog.listTeamRepository();
    const builtInTeams = repository.filter((team) => team.builtIn);
    assert.deepEqual(builtInTeams.map((team) => team.teamVersionId), ["software-team-v1"]);
    assert.ok(builtInTeams.every((team) => !team.teamVersionId.startsWith("case:")));
    assert.ok(!repository.some((team) => team.projectId === "case:software-team"));
    assert.ok(repository.some((team) => team.projectId === "released-team" && team.teamVersionId === "released-team"));
    const legacyReleasedTeam = await catalog.getTeamVersion("legacy-released-team");
    assert.equal(legacyReleasedTeam.teamVersionStatus, "released");
    assert.equal(legacyReleasedTeam.releasedAt, "2025-12-31");
    const releasedTeam = await catalog.getTeamVersion("released-team");
    assert.equal(releasedTeam.teamVersionStatus, "released");
    assert.equal(releasedTeam.teamIrSemanticDigest, "a".repeat(64));
    assert.equal(releasedTeam.compiledPlanDigest, "b".repeat(64));
    assert.equal(releasedTeam.compilerSemanticsVersion, "team-ir-v2/1");
    assert.equal(Object.hasOwn(releasedTeam, "projectStatus"), false, "TeamVersion DTO must expose one lifecycle field");
    assert.equal(Object.hasOwn(releasedTeam, "confirmedAt"), false, "TeamVersion DTO must not expose legacy confirmation state");
    assert.ok(!repository.some((team) => ["draft-team", "archived-team", "project-workspace", "collaboration"].includes(team.projectId)));

    const all = await catalog.listTeamRepository({ includeUnreleased: true });
    assert.ok(all.some((team) => team.projectId === "draft-team"));
    assert.ok(all.some((team) => team.projectId === "archived-team"));
    assert.ok(!all.some((team) => ["project-workspace", "collaboration"].includes(team.projectId)));

    const factory = await catalog.listTeamFactory();
    assert.deepEqual(factory.map((team) => team.projectId).sort(), ["collaboration", "draft-team"]);

    const emptyRoot = await mkdtemp(join(tmpdir(), "ogs-empty-team-catalog-"));
    try {
      assert.deepEqual(await createFileTeamCatalog({ projectsRoot: emptyRoot }).listTeamRepository(), []);
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("file Team Catalog rejects a persisted TeamVersion ID that does not match its workspace", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-catalog-identities-"));
  const writeProject = async (id, meta) => {
    const site = join(projectsRoot, id, ".site");
    await mkdir(site, { recursive: true });
    await writeFile(join(site, "project.json"), JSON.stringify({ overview: "Overview", ...meta }), "utf8");
  };
  try {
    const catalog = createFileTeamCatalog({ projectsRoot });
    await writeProject("team-one", { name: "Team One", teamId: "team-one", teamVersionId: "elsewhere", teamVersionStatus: "released" });
    await assert.rejects(catalog.listTeamRepository({ includeUnreleased: true }), /does not match its workspace/);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
