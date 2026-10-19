import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTeamVersionLifecycleUseCases } from "../application/team-version-lifecycle-use-cases.mjs";
import { createFileTeamVersionLifecycle } from "../infrastructure/file-team-version-lifecycle.mjs";

test("archive persists TeamVersion state and keeps metadata reference files consistent", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-version-archive-"));
  const workdir = join(projectsRoot, "team-v1");
  await mkdir(join(workdir, ".site"), { recursive: true });
  await writeFile(join(workdir, ".site", "project.json"), JSON.stringify({
    name: "Team", teamId: "team", teamRootId: "team", teamVersionId: "team-v1", teamVersionNumber: 1,
    teamVersionStatus: "released", projectStatus: "confirmed", teamCoreDigest: "digest", createdAt: "2026-01-01",
    releasedAt: "2026-01-02", updatedAt: "2026-01-02"
  }));
  try {
    const getTeamVersion = async (id) => {
      const meta = JSON.parse(await readFile(join(projectsRoot, id, ".site", "project.json"), "utf8"));
      return { ...meta, projectId: id };
    };
    const persistence = createFileTeamVersionLifecycle({ projectsRoot, getTeamVersion });
    const useCases = createTeamVersionLifecycleUseCases({ teamVersions: { ...persistence, getTeamVersion } });
    const archived = await useCases.archiveTeamVersion("team-v1");
    assert.equal(archived.teamVersionStatus, "archived");
    assert.ok(archived.archivedAt);
    const teamVersionRef = JSON.parse(await readFile(join(workdir, ".site", "team-version.json"), "utf8"));
    assert.equal(teamVersionRef.status, "archived");
    assert.equal(teamVersionRef.archivedAt, archived.archivedAt);
    assert.equal(JSON.parse(await readFile(join(workdir, ".site", "project.json"), "utf8")).projectStatus, "confirmed");
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
