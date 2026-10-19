import assert from "node:assert/strict";
import test from "node:test";
import { createTeamVersionLifecycleUseCases } from "../application/team-version-lifecycle-use-cases.mjs";

function setup(team, versions = [team]) {
  const calls = [];
  const teamVersions = {
    getTeamVersion: async () => team,
    archiveReleasedTeamVersion: async (...args) => (calls.push(args), { ...team, teamVersionStatus: "archived" })
  };
  return { calls, useCases: createTeamVersionLifecycleUseCases({ teamVersions }) };
}

test("TeamVersion archive allows an in-use released version and delegates persistence", async () => {
  const version = { projectId: "team-v1", teamVersionId: "team-v1", teamVersionStatus: "released" };
  const { calls, useCases } = setup(version, [version, { teamProjectId: "workspace-a", teamVersionId: "team-v1" }]);
  assert.equal((await useCases.archiveTeamVersion("team-v1")).teamVersionStatus, "archived");
  assert.deepEqual(calls, [["team-v1"]]);
});

test("TeamVersion archive rejects workspaces and unreleased versions", async () => {
  const workspace = setup({ projectId: "workspace-a", teamProjectId: "team-v1", teamVersionStatus: "editing" });
  await assert.rejects(() => workspace.useCases.archiveTeamVersion("workspace-a"), /TEAM_VERSION_INVALID/);
  const draft = setup({ projectId: "team-draft", teamVersionStatus: "editing" });
  await assert.rejects(() => draft.useCases.archiveTeamVersion("team-draft"), /TEAM_VERSION_NOT_RELEASED/);
  assert.equal(workspace.calls.length + draft.calls.length, 0);
});

test("TeamVersion lifecycle use cases require persistence operations", () => {
  assert.throws(() => createTeamVersionLifecycleUseCases({}), /require team version operations/);
});
